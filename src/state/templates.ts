import type { BinOptions } from '../lib/geometry/bin';
import { applyPreset, applyTemplate, findPreset, makeTemplate, type PresetRoom } from '../lib/templates';
import { history, useStore } from './store';
import { computeLayout } from '../lib/layout/drawer';
import { binSeatHeight } from '../lib/geometry/baseplate';
import { placedOvershoot, shrinkToBed, usableBeds } from '../lib/bedfit';
import type { PlacedBin } from '../lib/project';
import { alignStacks } from '../lib/stacking';

/** Bin template library actions. Templates live in the store, so they're saved, shared in files and undoable. */

const state = () => useStore.getState();
const find = (id: string) => state().templates.find((t) => t.id === id);

export function saveTemplate(name: string, opts: BinOptions): string {
  const t = makeTemplate(name, opts, state().templates.map((x) => x.name));
  useStore.setState({ templates: [...state().templates, t] });
  return t.id;
}

export function renameTemplate(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  useStore.setState({ templates: state().templates.map((t) => (t.id === id ? { ...t, name: n } : t)) });
}

export function deleteTemplate(id: string) {
  useStore.setState({ templates: state().templates.filter((t) => t.id !== id) });
}

/** Newly drawn bins get the template's settings. */
export function applyTemplateToNew(id: string) {
  const t = find(id);
  if (t) useStore.setState({ newBin: applyTemplate(t, state().newBin) });
}

/** What applying settings to bins did: how many bins changed, and how many were cut down to fit the printer. */
export interface ApplyReport {
  changed: number;
  shrunk: number;
}

/**
 * Give bins new settings (`next`), keeping their size and place. Settings
 * that would push a bin past the print bed cut it down to fit (bedfit.ts), and
 * stacked bins keep the footprint of the bin they stand on (stacking.ts).
 */
function setBinOpts(binIds: string[], next: (b: PlacedBin) => BinOptions): ApplyReport {
  const set = new Set(binIds);
  const s = state();
  const layout = computeLayout(s.drawer);
  const bed = usableBeds(s.setup);
  const report: ApplyReport = { changed: 0, shrunk: 0 };
  const apply = (b: PlacedBin): PlacedBin => {
    const out = { ...b, opts: next(b) };
    if (JSON.stringify(out.opts) === JSON.stringify(b.opts)) return b;
    report.changed++;
    if (placedOvershoot(layout, out, bed) <= placedOvershoot(layout, b, bed) + 1e-6) return out;
    report.shrunk++;
    return shrinkToBed(layout, out, bed);
  };
  // Bins from elsewhere (lib/external.ts) have none of these settings.
  const bins = s.bins.map((b) => (set.has(b.id) && !b.external ? apply(b) : b));
  if (report.changed) useStore.setState({ bins: alignStacks(bins) });
  return report;
}

/** The bins take the template's settings but keep their size and place. */
export function applyTemplateToBins(id: string, binIds: string[]) {
  const t = find(id);
  if (!t || !binIds.length) return;
  setBinOpts(binIds, (b) => applyTemplate(t, b.opts));
}

/** How tall the active drawer lets a bin be (its inside height, when set). */
function presetRoom(): PresetRoom {
  const s = state();
  return s.drawer.height > 0 ? { mm: s.drawer.height - binSeatHeight(s.baseplate) } : {};
}

/** A built-in preset (lib/templates.ts BIN_PRESETS) on the selected bins, as one undo step. */
export function applyPresetToBins(id: string, binIds: string[]): ApplyReport {
  const p = findPreset(id);
  if (!p || !binIds.length) return { changed: 0, shrunk: 0 };
  const room = presetRoom();
  history.checkpoint();
  const r = setBinOpts(binIds, (b) => applyPreset(p, b.opts, room));
  history.checkpoint();
  return r;
}

/**
 * A built-in preset on the settings for new bins, as one undo step. Like any
 * new-bin setting, it has to leave a 1 × 1 bin the printer takes: too tall
 * comes down to fit.
 */
export function applyPresetToNew(id: string): ApplyReport {
  const p = findPreset(id);
  if (!p) return { changed: 0, shrunk: 0 };
  const s = state();
  const next = applyPreset(p, s.newBin, presetRoom());
  const one: PlacedBin = { id: '#new', x: 0, y: 0, opts: { ...next, unitsX: 1, unitsY: 1 } };
  const fit = shrinkToBed(computeLayout(s.drawer), one, usableBeds(s.setup));
  const before = s.newBin;
  history.checkpoint();
  s.setNewBin({ ...next, heightMode: fit.opts.heightMode, heightUnits: fit.opts.heightUnits });
  history.checkpoint();
  return { changed: JSON.stringify(state().newBin) === JSON.stringify(before) ? 0 : 1, shrunk: fit === one ? 0 : 1 };
}
