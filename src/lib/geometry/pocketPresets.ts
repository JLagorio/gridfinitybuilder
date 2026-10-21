/**
 * Pocket-grid presets ("Holds" list), graduated sets (drill index, sockets,
 * hex keys) and "fit an item": everything that turns an item into pocket
 * options. Pure data and math; the geometry is in pockets.ts.
 *
 * Sizes are real item dimensions plus clearance. Items that are wider than
 * they are thick (coin cells, cards, cartridges) stand on edge in slots.
 */
import { MM_PER_IN, formatLength, inchFraction, isRounded, parseLength, type InchPrecision, type Units } from '../units';
import type { PocketFields, PocketFloor, PocketShape, PocketSizeLabels } from './variants';

export interface PocketPreset {
  id: string;
  label: string;
  /** Option group in the "Holds" list. */
  group: string;
  shape: PocketShape;
  /** Diameter, width, or across-flats (hex), clearance included. */
  w: number;
  /** Square pockets: size along Y. */
  d?: number;
  depth: number;
  spacing: number;
  chamfer: number;
  floor?: PocketFloor;
  /** Stepped floors: bore width and depth. */
  stepW?: number;
  stepDepth?: number;
  /** Graduated sets: item sizes in mm (before clearance), smallest first. */
  sizes?: number[];
  /** Graduated sets: label per size when it isn't the size itself (sockets). */
  names?: string[];
  labels?: PocketSizeLabels;
  clearance?: number;
  /** Shown under the list. */
  note?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => round2(from + i * step));
const inches = (...v: number[]) => v.map((x) => round2(x * MM_PER_IN));

/** One item preset per row: [id, label, shape, w, d | null, depth, spacing, chamfer, extra]. */
type Row = [string, string, PocketShape, number, number | null, number, number, number, Partial<PocketPreset>?];

function group(name: string, rows: Row[]): PocketPreset[] {
  return rows.map(([id, label, shape, w, d, depth, spacing, chamfer, extra]) => ({
    id,
    label,
    group: name,
    shape,
    w,
    ...(d === null ? {} : { d }),
    depth,
    spacing,
    chamfer,
    ...extra,
  }));
}

/** Graduated set preset. Pocket sizes are each item size + clearance. */
function set(
  id: string,
  label: string,
  shape: PocketShape,
  sizes: number[],
  o: { labels: PocketSizeLabels; clearance: number; depth: number; spacing: number; chamfer: number; floor?: PocketFloor; names?: string[]; note?: string },
): PocketPreset {
  const w = round2(Math.max(...sizes) + o.clearance);
  return { id, label, group: 'Graduated sets', shape, w, d: w, ...o, sizes };
}

/** Typical outside diameters (mm) of shallow 6-point metric sockets, by size. They vary by brand: measure yours if they're tight. */
const SOCKETS_14: [number, number][] = [
  [4, 12],
  [4.5, 12],
  [5, 12],
  [5.5, 12],
  [6, 12],
  [7, 12],
  [8, 12.6],
  [9, 13.6],
  [10, 14.6],
  [11, 15.8],
  [12, 16.8],
  [13, 17.8],
  [14, 19],
];
const SOCKETS_38: [number, number][] = [
  [8, 17],
  [9, 17],
  [10, 17],
  [11, 17.5],
  [12, 17.8],
  [13, 19],
  [14, 20],
  [15, 21],
  [16, 22.4],
  [17, 23.5],
  [18, 25],
  [19, 26],
];
const SOCKET_NOTE = 'Pockets fit typical socket outside diameters, which vary by brand. Measure yours and use Custom sizes if they are tight.';

/** Item presets. Sizes include clearance; coin cells, cards and cartridges stand on edge in slots. */
export const POCKET_PRESETS: PocketPreset[] = [
  ...group('Batteries', [
    ['aa', 'AA battery', 'round', 15, null, 20, 2, 1],
    ['aaa', 'AAA battery', 'round', 11, null, 18, 2, 1],
    ['c', 'C battery', 'round', 26.8, null, 22, 2, 1],
    ['d', 'D battery', 'round', 34.8, null, 22, 2, 1],
    ['9v', '9V battery', 'square', 27.1, 18.1, 25, 2, 1],
    ['14500', '14500 cell', 'round', 15, null, 22, 2, 1],
    ['18650', '18650 cell', 'round', 19, null, 25, 2, 1],
    ['21700', '21700 cell', 'round', 21.6, null, 28, 2, 1],
    ['cr123a', 'CR123A', 'round', 17.6, null, 20, 2, 1],
    ['cr2032', 'CR2032 coin cell', 'square', 20.8, 3.8, 12, 2, 0.8],
    ['cr2025', 'CR2025 coin cell', 'square', 20.8, 3.1, 12, 2, 0.8],
    ['cr2016', 'CR2016 coin cell', 'square', 20.8, 2.2, 12, 2, 0.6],
    ['lr44', 'LR44 / AG13 stack', 'round', 12.2, null, 11, 2, 0.8],
  ]),
  ...group('Memory & cards', [
    ['sd', 'SD card', 'square', 24.6, 2.8, 16, 2.5, 0.8],
    ['microsd', 'microSD card', 'square', 11.6, 1.6, 9, 2.5, 0.6],
    ['cfexpress-b', 'CFexpress Type B', 'square', 30.2, 4.4, 22, 2.5, 0.8],
    ['nanosim', 'Nano SIM', 'square', 12.9, 1.4, 6, 2, 0.4],
    ['usb-a', 'USB-A stick (plug down)', 'square', 12.6, 5.1, 10, 3, 0.6],
    ['usb-c', 'USB-C stick (plug down)', 'square', 8.9, 3.1, 6, 3, 0.5],
    ['switch', 'Nintendo Switch cartridge', 'square', 21.6, 3.9, 20, 2.5, 0.8],
    ['gameboy', 'Game Boy cartridge', 'square', 57.8, 8.4, 30, 3, 1, { note: 'Needs a bin at least 2 units wide.' }],
  ]),
  ...group('Bits & drivers', [
    ['hexbit', '1/4″ hex bit', 'hex', 6.65, null, 12, 2, 0.6],
    ['hexbit-4', '4 mm precision bit', 'hex', 4.3, null, 12, 2, 0.4],
    ['powerbit', '1/4″ power bit (standing)', 'hex', 6.65, null, 22, 4, 0.6],
  ]),
  ...group('Router bits', [
    ['router-14', '1/4″ shank', 'round', 6.75, null, 20, 10, 0.6],
    ['router-8', '8 mm shank', 'round', 8.4, null, 22, 11, 0.6],
    ['router-12', '1/2″ shank', 'round', 13.1, null, 25, 13, 0.8],
  ]),
  ...group('Screws', [
    ['m2', 'M2 screw', 'round', 2.4, null, 6, 3, 0.4],
    ['m2.5', 'M2.5 screw', 'round', 2.9, null, 8, 3.2, 0.4],
    ['m3', 'M3 screw', 'round', 3.4, null, 10, 3.6, 0.5],
    ['m4', 'M4 screw', 'round', 4.5, null, 12, 4, 0.6],
    ['m5', 'M5 screw', 'round', 5.5, null, 14, 4.5, 0.7],
    ['m6', 'M6 screw', 'round', 6.5, null, 16, 5.5, 0.8],
    ['m8', 'M8 screw', 'round', 8.6, null, 20, 6.4, 1],
  ]),
  ...group('Hobby', [
    ['dropper', 'Vallejo / Army Painter dropper (17 ml)', 'round', 25.8, null, 25, 2, 1],
    ['citadel', 'Citadel paint pot', 'round', 34.6, null, 15, 2, 1],
    ['marker', 'Marker / Sharpie (end down)', 'round', 12.4, null, 30, 2, 0.8],
    ['pen', 'Pen', 'round', 11.5, null, 30, 2, 0.8],
    ['copic', 'Copic marker', 'round', 17, null, 30, 2, 1],
    ['nozzle', 'M6 printer nozzle (E3D V6 / MK8)', 'hex', 7.4, null, 10, 3, 0.4, { floor: 'stepped', stepW: 6.4, stepDepth: 7.5 }],
    ['testtube', 'Test tube, 16 mm', 'round', 16.6, null, 30, 2, 0.8, { floor: 'round' }],
    ['oil5', 'Essential-oil bottle (5 ml)', 'round', 22.6, null, 20, 2, 1],
  ]),
  ...group('Coins', [
    ['quarter', 'US quarter stack', 'round', 24.8, null, 15, 2, 0.8],
    ['dime', 'US dime stack', 'round', 18.5, null, 15, 2, 0.8],
    ['nickel', 'US nickel stack', 'round', 21.8, null, 15, 2, 0.8],
    ['penny', 'US penny stack', 'round', 19.6, null, 15, 2, 0.8],
    ['euro1', '€1 stack', 'round', 23.8, null, 15, 2, 0.8],
    ['euro2', '€2 stack', 'round', 26.3, null, 15, 2, 0.8],
  ]),
  set('drills-10', 'Metric drills 1–10 mm', 'round', range(1, 10, 0.5), { labels: 'mm', clearance: 0.4, depth: 15, spacing: 2, chamfer: 0.4, floor: 'cone' }),
  set('drills-13', 'Metric drills 1–13 mm', 'round', range(1, 13, 0.5), { labels: 'mm', clearance: 0.4, depth: 15, spacing: 2, chamfer: 0.4, floor: 'cone' }),
  set('drills-inch', 'Drills 1/16–1/2″ by 1/64', 'round', inches(...range(4, 32, 1).map((n) => n / 64)), {
    labels: 'inch',
    clearance: 0.4,
    depth: 15,
    spacing: 2,
    chamfer: 0.4,
    floor: 'cone',
  }),
  set('sockets-14', '1/4″-drive sockets 4–14 mm', 'round', SOCKETS_14.map(([, od]) => od), {
    names: SOCKETS_14.map(([n]) => String(n)),
    labels: 'mm',
    clearance: 0.8,
    depth: 12,
    spacing: 2.5,
    chamfer: 0.8,
    note: SOCKET_NOTE,
  }),
  set('sockets-38', '3/8″-drive sockets 8–19 mm', 'round', SOCKETS_38.map(([, od]) => od), {
    names: SOCKETS_38.map(([n]) => String(n)),
    labels: 'mm',
    clearance: 0.8,
    depth: 14,
    spacing: 2.5,
    chamfer: 0.8,
    note: SOCKET_NOTE,
  }),
  set('hexkeys', 'Metric hex keys 1.5–10 mm', 'hex', [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], { labels: 'mm', clearance: 0.4, depth: 15, spacing: 2.5, chamfer: 0.4 }),
  set('hexkeys-inch', 'Hex keys 1/16–3/8″', 'hex', inches(1 / 16, 5 / 64, 3 / 32, 7 / 64, 1 / 8, 9 / 64, 5 / 32, 3 / 16, 7 / 32, 1 / 4, 5 / 16, 3 / 8), {
    labels: 'inch',
    clearance: 0.4,
    depth: 15,
    spacing: 2.5,
    chamfer: 0.4,
  }),
];

/** Group order in the "Holds" list. */
export const POCKET_GROUPS = [...new Set(POCKET_PRESETS.map((p) => p.group))];

/** Preset id for a graduated set typed in by hand. */
export const CUSTOM_SET = 'custom-set';

export function findPocketPreset(id: string): PocketPreset | undefined {
  return POCKET_PRESETS.find((p) => p.id === id);
}

/** The option fields a preset sets. Lean, finger access and magnets are left as they are. */
export function presetFields(p: PocketPreset): Partial<PocketFields> {
  return {
    pocketPreset: p.id,
    pocketShape: p.shape,
    pocketW: p.w,
    pocketD: p.d ?? p.w,
    pocketDepth: p.depth,
    pocketSpacing: p.spacing,
    pocketChamfer: p.chamfer,
    pocketFloor: p.floor ?? 'flat',
    ...(p.floor === 'stepped' ? { pocketStepW: p.stepW, pocketStepDepth: p.stepDepth } : {}),
    pocketSizes: p.sizes ?? [],
    pocketSizeNames: p.names ?? [],
    ...(p.sizes ? { pocketSizeLabels: p.labels ?? 'mm', pocketClearance: p.clearance ?? 0.4 } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fit an item
// ---------------------------------------------------------------------------

export interface PocketItem {
  /** round: `w` is the diameter; square: `w` × `d`; hex: `w` across flats. */
  shape: PocketShape;
  w: number;
  d?: number;
  /** How tall the item stands in the pocket. */
  height: number;
}

export const FIT_DEFAULTS = {
  /** Added to the item's size (total, not per side), mm. */
  clearance: 0.5,
  /** Share of the item's height that sits in the pocket. */
  share: 2 / 3,
} as const;

/**
 * Pocket options that hold an item: the pocket is the item plus `clearance`,
 * as deep as `share` of its height, with a chamfer and spacing that suit its size.
 */
export function fitItem(item: PocketItem, clearance: number = FIT_DEFAULTS.clearance, share: number = FIT_DEFAULTS.share): Partial<PocketFields> {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cl = clamp(Number(clearance) || 0, 0, 5);
  const w = round2(clamp(item.w + cl, 1, 200));
  const d = round2(clamp((item.shape === 'square' ? (item.d ?? item.w) : item.w) + cl, 1, 200));
  const depth = round2(clamp(item.height * clamp(share, 0.05, 1), 1, 200));
  const small = Math.min(w, d);
  return {
    pocketPreset: 'custom',
    pocketShape: item.shape,
    pocketW: w,
    pocketD: d,
    pocketDepth: depth,
    pocketSpacing: round2(clamp(small * 0.12, 1.2, 3)),
    pocketChamfer: round2(Math.min(clamp(small * 0.06, 0.3, 1.2), depth / 4)),
    pocketFloor: 'flat',
    pocketSizes: [],
    pocketSizeNames: [],
  };
}

// ---------------------------------------------------------------------------
// Graduated sets: size labels and typed size lists
// ---------------------------------------------------------------------------

const trim = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/** How a graduated set writes one size: "2.5", "13/64", or the given name. */
export function sizeLabelText(size: number, mode: PocketSizeLabels, name = ''): string {
  if (mode === 'none') return '';
  if (name) return name;
  if (mode === 'mm') return trim(size, 2);
  const inch = size / MM_PER_IN;
  return isRounded(size, 64) ? trim(inch, 3).replace(/^0\./, '.') : inchFraction(inch, 64);
}

/**
 * Parse a typed size list: sizes separated by commas or semicolons, each a
 * length in the given units ("3/16", "4.5mm", "0.25in"), optionally followed by
 * "=name" for its label ("12.6=8" is a 12.6 mm socket labelled 8). Returns null
 * when any entry isn't a length.
 */
export function parseSizeList(text: string, units: Units): { sizes: number[]; names: string[] } | null {
  const sizes: number[] = [];
  const names: string[] = [];
  for (const raw of text.split(/[;,\n]/)) {
    const part = raw.trim();
    if (!part) continue;
    const [len, ...rest] = part.split('=');
    const mm = parseLength(len.trim(), units);
    if (mm === null || !(mm > 0)) return null;
    sizes.push(round2(mm));
    names.push(rest.join('=').trim().slice(0, 12));
  }
  return { sizes, names: names.some(Boolean) ? names : [] };
}

/** A size list as text for editing, in the given units: "1, 1.5, 2" or "1/16, 5/64". */
export function formatSizeList(sizes: number[], names: string[], units: Units, precision: InchPrecision = 64): string {
  return sizes
    .map((mm, i) => {
      const len =
        units === 'mm' ? trim(mm, 2) : formatLength(mm, 'in', { unit: false, precision: isRounded(mm, precision || 64) ? 0 : precision || 64 });
      return names[i] ? `${len}=${names[i]}` : len;
    })
    .join(', ');
}
