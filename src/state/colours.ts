import { history, useStore } from './store';
import { cleanSlot, type ColourRole, type ColourSetup, type FilamentSlot } from '../lib/colours';
import { CODED_SLOTS, presetSetup, type ColourPresetId } from '../lib/colourPresets';
import type { PlacedBin } from '../lib/project';
import type { DrawerDoc } from './store';

/**
 * Colour edits (lib/colours.ts) that touch more than the setup: presets that
 * colour bins, and the palette. Each is one undo step.
 */

/** Change the colour fields of the setup. */
export function setColours(patch: Partial<ColourSetup>) {
  const s = useStore.getState();
  s.setSetup({ colours: { ...s.setup.colours, ...patch } });
}

/** One role's slot (undefined: follow what it follows). */
export function setRoleSlot(role: ColourRole, slot: number | undefined) {
  const roles = { ...useStore.getState().setup.colours?.roles };
  if (slot === undefined) delete roles[role];
  else roles[role] = slot;
  setColours({ roles });
}

/** Replace the palette. */
export function setPalette(filaments: FilamentSlot[]) {
  useStore.getState().setSetup({ filaments });
}

/** What a colour-coded bin goes by: the first thing in it, else its footprint. */
function codeOf(b: PlacedBin): string {
  const first = (b.contents ?? '').split('\n').map((l) => l.trim().toLowerCase()).find(Boolean);
  return first ? `c:${first.replace(/^\d+\s*[x×]?\s*/, '')}` : `s:${b.opts.unitsX}x${b.opts.unitsY}`;
}

/** Every bin of every drawer a colour of its own kind (CODED_SLOTS in turn). */
function codedBins(drawers: DrawerDoc[]): Map<string, Map<string, number>> {
  const slots = new Map<string, number>();
  const out = new Map<string, Map<string, number>>();
  for (const d of drawers) {
    const mine = new Map<string, number>();
    for (const b of d.bins) {
      const k = codeOf(b);
      if (!slots.has(k)) slots.set(k, CODED_SLOTS[slots.size % CODED_SLOTS.length]);
      mine.set(b.id, slots.get(k)!);
    }
    out.set(d.id, mine);
  }
  return out;
}

/** A colour preset (colours.ts COLOUR_PRESETS), as one undo step. "Colour-coded bins" also gives each bin its colour. */
export function applyColourPreset(id: ColourPresetId) {
  const s = useStore.getState();
  history.checkpoint();
  s.setSetup(presetSetup(s.setup, id));
  if (id === 'coded') {
    const live = useStore.getState();
    const all = live.drawers.map((d) => (d.id === live.activeDrawerId ? { ...d, bins: live.bins } : d));
    const coded = codedBins(all);
    const paint = (d: DrawerDoc) => d.bins.map((b) => ({ ...b, opts: { ...b.opts, colour: coded.get(d.id)?.get(b.id) } }));
    const active = all.find((d) => d.id === live.activeDrawerId);
    useStore.setState({
      bins: active ? paint(active) : live.bins,
      drawers: live.drawers.map((d) => (d.id === live.activeDrawerId ? d : { ...d, bins: paint(d) })),
    });
  }
  history.checkpoint();
}

/** The bins' own colour (undefined: the Bins colour), for every bin given. */
export function setBinsColour(ids: string[], slot: number | undefined) {
  const s = useStore.getState();
  history.checkpoint();
  for (const id of ids) s.updateBin(id, { opts: { colour: cleanSlot(slot) } });
  history.checkpoint();
}
