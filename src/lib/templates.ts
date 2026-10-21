import { DEFAULT_BIN, MIN_HEIGHT_UNITS, binLayout, sanitizeBin, type BinOptions } from './geometry/bin';
import { binBodyHeight, heightMmFor } from './geometry/variants';
import { HEIGHT_UNIT } from './geometry/spec';
import { activeContainer } from './geometry/containers';
import { findPocketPreset, presetFields } from './geometry/pocketPresets';
import { contentsFragment } from './geometry/labelContents';
import { PRESETS } from './dividers';
import { maxBinUnits, newId } from './bins';

/**
 * Saved bin settings, shared by every drawer in the project. `opts` is kept
 * whole (including fields this module doesn't know about) and only sanitized
 * when it's applied.
 */
export interface BinTemplate {
  id: string;
  name: string;
  opts: BinOptions;
}

export function makeTemplate(name: string, opts: BinOptions, taken: string[] = []): BinTemplate {
  return { id: newId(), name: uniqueTemplateName(name.trim() || 'Template', taken), opts: structuredClone(opts) };
}

export function uniqueTemplateName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Templates from a saved file or storage; anything malformed is dropped. */
export function cleanTemplates(v: unknown): BinTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: BinTemplate[] = [];
  for (const t of v) {
    if (!t || typeof t !== 'object' || !t.opts || typeof t.opts !== 'object') continue;
    const id = String(t.id ?? newId());
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, name: String(t.name ?? `Template ${out.length + 1}`), opts: { ...t.opts } });
  }
  return out;
}

/** Templates from an opened project join the library: same id replaces, new ones are added. */
export function mergeTemplates(current: BinTemplate[], incoming: BinTemplate[]): BinTemplate[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const out = current.map((t) => byId.get(t.id) ?? t);
  for (const t of incoming) if (!current.some((c) => c.id === t.id)) out.push(t);
  return out;
}

/**
 * A template's settings for a bin, keeping the bin's own footprint. Tool
 * pockets are placed for one bin size, so they only carry over to bins of the
 * same footprint; other sizes get the template's other settings and an empty
 * cutout bin.
 */
export function applyTemplate(t: BinTemplate, target: Pick<BinOptions, 'unitsX' | 'unitsY'>): BinOptions {
  const opts = structuredClone(t.opts);
  if (opts.cutouts?.length && (opts.unitsX !== target.unitsX || opts.unitsY !== target.unitsY)) opts.cutouts = [];
  return sanitizeBin({ ...DEFAULT_BIN, ...opts, unitsX: target.unitsX, unitsY: target.unitsY });
}

/** One-line description: "3u · lip · magnets · 2×1 compartments". */
export function templateSummary(o: BinOptions): string {
  const parts = [o.heightMode && o.heightMode !== 'units' ? `${heightMmFor(o, 'external')} mm` : `${o.heightUnits}u`];
  if (o.base && o.base !== 'standard') parts.push(`${o.base} base`);
  if (o.lip) parts.push(o.lipStyle === 'reduced' ? 'reduced lip' : 'lip');
  if (o.lip && o.lid) parts.push('lid');
  if (o.holes && o.holes !== 'none') parts.push(o.holes === 'both' ? 'magnets + screws' : o.holes);
  if (o.interior === 'pockets') parts.push('pocket grid');
  else if (o.layout) {
    const n = binLayout(o).compartments.length;
    if (n > 1) parts.push(`${n} compartments`);
  } else if (o.divX * o.divY > 1) parts.push(`${o.divX}×${o.divY} compartments`);
  if (o.scoop > 0) parts.push('scoop');
  if (o.label && o.label !== 'none') parts.push(`${o.label === 'center' ? 'mid' : o.label} label`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

/** How much height the drawer leaves for a bin (above the baseplate floor, mm); unknown when its inside height isn't set. */
export interface PresetRoom {
  mm?: number;
}

/**
 * A built-in starting point, the "Start from" row of the bin panel. It applies
 * like a template (to the selected bins, or to new bins), but only sets what
 * it's about: each bin keeps its size, and its base, holes and lip unless the
 * preset is about them.
 */
export interface BinPreset {
  id: string;
  name: string;
  /** What it does, in a sentence. */
  hint: string;
  /** The options it sets, for a bin with options `o`. */
  patch: (o: BinOptions, room: PresetRoom) => Partial<BinOptions>;
}

/** Height in 7 mm units of a bin (whichever way its height is given). */
const unitsOf = (o: BinOptions) => (o.heightMode && o.heightMode !== 'units' ? Math.round(binBodyHeight(o) / HEIGHT_UNIT) : o.heightUnits);

/** Height `want` (in units), but no taller than the drawer leaves room for. */
function heightFor(o: BinOptions, want: number, room: PresetRoom): Partial<BinOptions> {
  const most = room.mm ? maxBinUnits(room.mm, o.lip) : Infinity;
  return { heightMode: 'units', heightUnits: Math.max(MIN_HEIGHT_UNITS, Math.min(want, most)) };
}

/** A plain bin with compartments. */
const PLAIN_COMPARTMENTS = { container: undefined, interior: 'compartments' } as const;

const TOOL_TRAY = PRESETS.find((p) => p.id === 'tool-tray')!;
const AA = findPocketPreset('aa')!;

export const BIN_PRESETS: BinPreset[] = [
  {
    id: 'small-parts',
    name: 'Screws & small parts',
    hint: 'Three compartments side by side, each with a scoop and a label tab.',
    patch: () => ({ ...PLAIN_COMPARTMENTS, layout: null, divX: 3, divY: 1, scoop: 0.8, label: 'full' }),
  },
  {
    id: 'batteries',
    name: 'Batteries',
    hint: 'A grid of AA pockets, tall enough for them. Pick another battery under Inside.',
    patch: (o, room) => ({ container: undefined, interior: 'pockets', ...presetFields(AA), ...heightFor(o, Math.max(unitsOf(o), 5), room) }),
  },
  {
    id: 'deep',
    name: 'Deep bin',
    hint: 'One tall open compartment for bulky things: 9 units, or as tall as the drawer allows.',
    patch: (o, room) => ({ ...PLAIN_COMPARTMENTS, layout: null, divX: 1, divY: 1, ...heightFor(o, 9, room) }),
  },
  {
    id: 'tool-tray',
    name: 'Tool tray',
    hint: 'A low tray with a long slot for pens and tools, and two compartments.',
    patch: (o, room) => ({ ...PLAIN_COMPARTMENTS, layout: structuredClone(TOOL_TRAY.layout), scoop: 0, label: 'none', ...heightFor(o, 3, room) }),
  },
  {
    id: 'label-all',
    name: 'Label everything',
    hint: 'A label on every bin, its text from What’s in it unless it has some: a tab on bins with compartments, the front wall on the others.',
    patch: (o) => {
      // Containers have labels of their own (on the lid, the drawer fronts).
      if (activeContainer(o)) return {};
      const text = o.labelText.trim() ? {} : { labelText: contentsFragment(1) };
      if (o.interior === 'compartments') return { label: o.label === 'none' ? 'full' : o.label, ...text };
      return { frontLabel: o.frontLabel === 'none' ? 'engraved' : o.frontLabel, ...text };
    },
  },
];

export const findPreset = (id: string) => BIN_PRESETS.find((p) => p.id === id);

/** A preset's settings for a bin: its own options with the preset's on top, the same size. */
export function applyPreset(p: BinPreset, target: BinOptions, room: PresetRoom = {}): BinOptions {
  const o = sanitizeBin({ ...DEFAULT_BIN, ...target });
  return sanitizeBin({ ...o, ...p.patch(o, room), unitsX: o.unitsX, unitsY: o.unitsY });
}
