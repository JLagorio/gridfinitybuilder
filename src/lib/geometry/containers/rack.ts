/**
 * Tool rack ('rack'): a solid block on Gridfinity feet that holds tools upright.
 *
 * - drivers: screwdrivers, hex keys, files… stand in round or hex holes sized
 *   from a list of shaft sizes, their handles resting on the top;
 * - pliers: jaws down in slots sized by jaw thickness, handles standing up;
 * - wrenches: heads down in slots sized from the wrench size (typical
 *   combination-wrench head width and thickness, see `wrenchHead`).
 *
 * Tools stand in rows from the front, smallest first. Rows can be staggered
 * (alternate rows hold one fewer and sit between, so round handles nest) and
 * stepped (each row higher than the one in front, so the tools behind stay in
 * view), and every hole and slot can lean back so the handles lean back. A
 * leaning hole is a sheared prism: its walls are at most 45° from vertical and
 * its bottom is flat, so the rack prints upright without supports. Sizes can be
 * engraved into the top in front of each hole.
 *
 * The block is solid (the slicer's infill keeps it light), which keeps the
 * weight low and over the feet; `rackNotes` warns when the tools stand tall or
 * lean far for the footprint.
 */
import type { Manifold, Wasm } from '../kernel';
import { Scope, toMeshData } from '../kernel';
import { HEIGHT_UNIT } from '../spec';
import { boxAt, cylinderAt, extrudePolygon, ringAt, roundedRectRing } from '../shapes';
import { hasFont, textOutline, textSolid } from '../text';
import { MM_PER_IN } from '../../units';
import { sizeLabelText } from '../pocketPresets';
import { binFloorZ, type PocketSizeLabels } from '../variants';
import { binCells, binSize, type BinCells, type BinOptions } from '../bin';
import { containerBase } from './base';
import { registerContainer, type ContainerDef } from './registry';

export type RackStyle = 'drivers' | 'pliers' | 'wrenches';
export const RACK_STYLES: readonly RackStyle[] = ['drivers', 'pliers', 'wrenches'];
export type RackHole = 'round' | 'hex';

export interface RackOptions {
  style: RackStyle;
  /** Preset the sizes came from (UI only), or 'custom'. */
  preset: string;
  /**
   * One tool per entry, mm before clearance: shaft diameters (drivers, round
   * holes) or across flats (hex holes); jaw thicknesses (pliers); wrench sizes (wrenches).
   */
  sizes: number[];
  /** Engraved label per size when it isn't the size itself ("" = the size). */
  names: string[];
  /** Drivers: hole shape. Hex holes have their flats facing front and back. */
  hole: RackHole;
  /** Added to every size (and to plier heads and wrench heads). */
  clearance: number;
  /** Drivers: handle diameter, so neighbouring handles don't touch (0 = no handles, e.g. hex keys). Pliers: handle thickness. */
  handle: number;
  /** Pliers: head width across the jaws, the slot's length front to back. */
  head: number;
  /** How far the tools go in, along the hole (capped by the block). */
  depth: number;
  /** Least plastic between two holes or slots. */
  spacing: number;
  /** Rows of tools; 0 = as many per row as fit, then the next row. */
  rows: number;
  /** Alternate rows hold one fewer tool and sit between the others. */
  stagger: boolean;
  /** Each row stands this much higher than the one in front (mm). */
  step: number;
  /** Lean back from vertical, degrees. */
  tilt: number;
  /** Engrave each size in front of its hole. */
  labels: PocketSizeLabels;
  /** How far the tools stand above the rack, for the tipping check (0 = a typical length). */
  reach: number;
}

/** Fixed dimensions and limits. */
export const RACK = {
  /** Plastic kept between a hole and the outside. */
  edge: 2,
  /** Room between neighbouring handles. */
  handleGap: 1,
  /** The front row keeps holes at least this deep (vertically) when steps have to shrink. */
  minHold: 12,
  /** 45° chamfer at each hole's mouth. */
  chamfer: 0.8,
  labelSize: 3,
  /** Label box height and its gap to the hole. */
  labelBox: 3.6,
  labelGap: 0.6,
  labelDepth: 0.6,
  maxTilt: { drivers: 30, pliers: 45, wrenches: 45 } as Record<RackStyle, number>,
  maxRows: 6,
  maxSizes: 40,
  maxStep: 30,
} as const;

const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? clamp(n, lo, hi) : d;
};
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const inches = (...v: number[]) => v.map((x) => r2(x * MM_PER_IN));

/**
 * Typical head of a combination wrench of this size (mm across flats), after
 * DIN 3113 / ISO 7738 dimensions: width of the open end, thickness of the
 * thicker (ring) end, and overall length. Brands vary by a millimetre or two;
 * the clearance covers that.
 */
export function wrenchHead(size: number): { width: number; thick: number; length: number } {
  return { width: r2(2.2 * size + 3.5), thick: r2(0.32 * size + 3.4), length: r2(7.5 * size + 65) };
}

export interface RackPreset {
  id: string;
  label: string;
  style: RackStyle;
  sizes: number[];
  names?: string[];
  /** Fields that differ from the style's defaults. */
  set?: Partial<RackOptions>;
  /** Shown under the list. */
  note?: string;
}

/** Defaults per style, applied when a preset of that style is picked. */
const STYLE_DEFAULTS: Record<RackStyle, Omit<RackOptions, 'style' | 'preset' | 'sizes' | 'names'>> = {
  drivers: { hole: 'round', clearance: 0.8, handle: 30, head: 28, depth: 60, spacing: 2, rows: 0, stagger: false, step: 0, tilt: 0, labels: 'none', reach: 0 },
  pliers: { hole: 'round', clearance: 1, handle: 20, head: 28, depth: 25, spacing: 2, rows: 0, stagger: false, step: 0, tilt: 10, labels: 'none', reach: 0 },
  wrenches: { hole: 'round', clearance: 1, handle: 0, head: 28, depth: 18, spacing: 2, rows: 0, stagger: false, step: 6, tilt: 15, labels: 'mm', reach: 0 },
};

export const RACK_PRESETS: RackPreset[] = [
  {
    id: 'screwdrivers',
    label: 'Screwdrivers',
    style: 'drivers',
    sizes: [3, 4, 5, 6, 6, 8],
    note: 'Shaft diameters; handles rest on top, so their diameter sets the spacing.',
  },
  { id: 'precision', label: 'Precision screwdrivers', style: 'drivers', sizes: [2, 2.5, 3, 3, 3, 4], set: { clearance: 0.6, handle: 16, depth: 40 } },
  {
    id: 'hexkeys',
    label: 'Metric hex keys 1.5–10 mm',
    style: 'drivers',
    sizes: [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],
    set: { hole: 'hex', clearance: 0.4, handle: 0, depth: 40, labels: 'mm' },
    note: 'Long legs down, short legs all pointing the same way.',
  },
  {
    id: 'hexkeys-inch',
    label: 'Hex keys 1/16–3/8″',
    style: 'drivers',
    sizes: inches(1 / 16, 5 / 64, 3 / 32, 1 / 8, 5 / 32, 3 / 16, 7 / 32, 1 / 4, 5 / 16, 3 / 8),
    set: { hole: 'hex', clearance: 0.4, handle: 0, depth: 40, labels: 'inch' },
  },
  {
    id: 'files',
    label: 'Files',
    style: 'drivers',
    sizes: [10, 14, 18, 22],
    set: { clearance: 1, handle: 32 },
    note: 'Each size is the blade’s width: flat blades fit across the round hole.',
  },
  { id: 'needle-files', label: 'Needle files', style: 'drivers', sizes: [5, 5, 5, 5, 5, 5], set: { clearance: 0.8, handle: 12, depth: 40 } },
  {
    id: 'pliers',
    label: 'Pliers & cutters',
    style: 'pliers',
    sizes: [10, 11, 12, 13],
    note: 'Jaw thickness at the joint, per tool. Handles open front to back, so one row works best.',
  },
  { id: 'mini-pliers', label: 'Electronics pliers', style: 'pliers', sizes: [8, 8, 8, 8], set: { head: 18, handle: 16, depth: 18 } },
  {
    id: 'wrenches-8-19',
    label: 'Combination wrenches 8–19 mm',
    style: 'wrenches',
    sizes: range(8, 19),
    note: 'Slots fit typical combination-wrench heads, which vary by brand: add clearance if yours are tight.',
  },
  { id: 'wrenches-6-14', label: 'Combination wrenches 6–14 mm', style: 'wrenches', sizes: range(6, 14) },
  { id: 'wrenches-10-19', label: 'Combination wrenches 10–19 mm', style: 'wrenches', sizes: range(10, 19) },
  {
    id: 'wrenches-sae',
    label: 'Combination wrenches 1/4–3/4″',
    style: 'wrenches',
    sizes: inches(1 / 4, 5 / 16, 3 / 8, 7 / 16, 1 / 2, 9 / 16, 5 / 8, 11 / 16, 3 / 4),
    set: { labels: 'inch' },
  },
];

export function findRackPreset(id: string): RackPreset | undefined {
  return RACK_PRESETS.find((p) => p.id === id);
}

/** The option fields a preset sets: the style's defaults, then the preset's own. */
export function rackPresetFields(p: RackPreset): RackOptions {
  return { style: p.style, preset: p.id, ...STYLE_DEFAULTS[p.style], ...p.set, sizes: [...p.sizes], names: [...(p.names ?? [])] };
}

const firstPreset = (style: RackStyle) => RACK_PRESETS.find((p) => p.style === style)!;

export const RACK_DEFAULTS: RackOptions = rackPresetFields(RACK_PRESETS[0]);

/** Clean saved or edited options; missing fields come from the style's first preset. */
export function sanitizeRack(raw: unknown): RackOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RackOptions, unknown>>;
  const style = RACK_STYLES.includes(r.style as RackStyle) ? (r.style as RackStyle) : RACK_DEFAULTS.style;
  const d = rackPresetFields(firstPreset(style));
  const sizes = Array.isArray(r.sizes)
    ? r.sizes
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
        .slice(0, RACK.maxSizes)
        .map((v) => r2(clamp(v, 0.5, 80)))
    : d.sizes;
  const rawNames = Array.isArray(r.names) ? r.names : [];
  const names = sizes.map((_, i) => (typeof rawNames[i] === 'string' ? (rawNames[i] as string).trim().slice(0, 12) : ''));
  return {
    style,
    preset: typeof r.preset === 'string' && r.preset.length <= 40 ? r.preset : d.preset,
    sizes,
    names: names.some(Boolean) ? names : [],
    hole: r.hole === 'hex' || r.hole === 'round' ? r.hole : d.hole,
    clearance: r2(num(r.clearance, 0, 5, d.clearance)),
    handle: r2(num(r.handle, 0, 80, d.handle)),
    head: r2(num(r.head, 3, 80, d.head)),
    depth: r2(num(r.depth, 3, 200, d.depth)),
    spacing: r2(num(r.spacing, 0.8, 20, d.spacing)),
    rows: int(r.rows, 0, RACK.maxRows, d.rows),
    stagger: typeof r.stagger === 'boolean' ? r.stagger : d.stagger,
    step: r2(num(r.step, 0, RACK.maxStep, d.step)),
    tilt: r2(num(r.tilt, 0, RACK.maxTilt[style], d.tilt)),
    labels: r.labels === 'none' || r.labels === 'mm' || r.labels === 'inch' ? r.labels : d.labels,
    reach: r2(num(r.reach, 0, 500, d.reach)),
  };
}

/** Mesh-key text: every field that changes the geometry. */
export function rackKey(o: RackOptions): string {
  return [
    o.style,
    o.sizes.join(','),
    o.labels === 'none' ? '' : o.names.join(','),
    o.style === 'drivers' ? o.hole : '',
    o.clearance,
    o.handle,
    o.style === 'pliers' ? o.head : '',
    o.depth,
    o.spacing,
    o.rows,
    o.stagger ? 's' : '',
    o.step,
    o.tilt,
    o.labels,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface RackItem {
  /** Size as given (mm, before clearance), its index in `sizes`, and its engraved label ("" = none). */
  size: number;
  index: number;
  label: string;
  shape: 'round' | 'hex' | 'slot';
  /** Hole or slot size, clearance included: across (X) and through (Y, square to the lean). */
  sx: number;
  sy: number;
  /** Width in Y on a horizontal plane (sy / cos tilt). */
  wy: number;
  /** Label width at RACK.labelSize. */
  lw: number;
  /** Half-width kept clear of the rack's sides: hole + plastic, handle, label. */
  ex: number;
}

export interface RackPlace extends RackItem {
  /** Hole axis where it meets the top of its row, bin-centered mm. */
  x: number;
  y: number;
  row: number;
  /** Top of the row, and how deep the hole goes below it (vertically). */
  z: number;
  dz: number;
  /** Engraved label: center and width. */
  labelAt?: { x: number; y: number; w: number };
}

export interface RackRow {
  /** Top of the row, and where its step ends at the back (the riser to the next row, or the back of the rack). */
  z: number;
  back: number;
  places: RackPlace[];
}

export interface RackLayout {
  /** Overall height, the floor the holes stop at, and the footprint. */
  top: number;
  floor: number;
  W: number;
  D: number;
  /** Lean (degrees) and the step between rows actually used. */
  tilt: number;
  step: number;
  rows: RackRow[];
  places: RackPlace[];
  /** Tools asked for, and how many didn't fit. */
  total: number;
  dropped: number;
}

/** Label width at RACK.labelSize (Roboto Condensed Bold advances, as pocket labels). */
function labelWidth(text: string): number {
  const adv: Record<string, number> = { '.': 0.409, '/': 0.467, ' ': 0.324, '-': 0.508, '"': 0.451, '″': 0.451 };
  let w = 0;
  for (const ch of text) w += adv[ch] ?? (ch >= '0' && ch <= '9' ? 0.711 : 0.75);
  return r3(w * RACK.labelSize);
}

/** Handle size that spaces tools across (X), and the handle that rests on the top (drivers only, round). */
const handleX = (o: RackOptions) => (o.style === 'wrenches' ? 0 : o.handle);
const handleTop = (o: RackOptions) => (o.style === 'drivers' ? o.handle : 0);

function rackItems(o: RackOptions): RackItem[] {
  const cosT = Math.cos(o.tilt * DEG);
  const hx = handleX(o);
  return o.sizes
    .map((size, index) => ({ size, index, name: o.names[index] ?? '' }))
    .sort((a, b) => a.size - b.size || a.index - b.index)
    .map(({ size, index, name }) => {
      let shape: RackItem['shape'] = 'slot';
      let sx: number;
      let sy: number;
      if (o.style === 'drivers') {
        const d = size + o.clearance;
        shape = o.hole;
        sx = o.hole === 'hex' ? (d * 2) / SQRT3 : d;
        sy = d;
      } else if (o.style === 'pliers') {
        sx = size + o.clearance;
        sy = o.head + o.clearance;
      } else {
        const h = wrenchHead(size);
        sx = h.width + o.clearance;
        sy = h.thick + o.clearance;
      }
      const label = o.labels !== 'none' ? sizeLabelText(size, o.labels, name) : '';
      const lw = label ? labelWidth(label) : 0;
      return { size, index, label, shape, sx: r3(sx), sy: r3(sy), wy: r3(sy / cosT), lw, ex: Math.max(sx / 2 + RACK.edge, hx / 2, lw / 2 + 0.5) };
    });
}

/** Center distance of two neighbours in a row. */
function pitchOf(o: RackOptions, a: RackItem, b: RackItem): number {
  const hx = handleX(o);
  return Math.max((a.sx + b.sx) / 2 + o.spacing, hx > 0 ? hx + RACK.handleGap : 0, (a.lw + b.lw) / 2 + 1);
}

function rowWidth(o: RackOptions, row: RackItem[]): number {
  let w = row[0].ex + row[row.length - 1].ex;
  for (let i = 1; i < row.length; i++) w += pitchOf(o, row[i - 1], row[i]);
  return w;
}

/** Tools per row, front row first; those too wide for the rack are dropped. */
function assignRows(o: RackOptions, items: RackItem[], W: number): { rows: RackItem[][]; dropped: number } {
  const fits = (row: RackItem[]) => rowWidth(o, row) <= W + 1e-9;
  const rows: RackItem[][] = [];
  let dropped = 0;
  if (o.rows === 0) {
    for (const it of items) {
      if (!fits([it])) {
        dropped++;
        continue;
      }
      const idx = rows.length - 1;
      const row = rows[idx];
      const cap = row && o.stagger && idx % 2 === 1 ? Math.max(1, rows[idx - 1].length - 1) : Infinity;
      if (row && row.length < cap && fits([...row, it])) row.push(it);
      else rows.push([it]);
    }
    return { rows, dropped };
  }
  const R = o.rows;
  const n = items.length;
  // Staggered rows alternate c and c - 1 tools.
  const c = o.stagger && R > 1 ? Math.ceil((n + Math.floor(R / 2)) / R) : Math.ceil(n / R);
  let k = 0;
  for (let r = 0; r < R && k < n; r++) {
    const count = o.stagger && r % 2 === 1 ? Math.max(1, c - 1) : c;
    const row = items.slice(k, k + count);
    k += row.length;
    while (row.length && !fits(row)) {
      row.pop();
      dropped++;
    }
    if (row.length) rows.push(row);
  }
  return { rows, dropped: dropped + (n - k) };
}

/**
 * Centers across of a row: centered on the rack, or for a staggered row,
 * between the tools of the row in front (spread evenly over the gaps when it
 * has fewer), as long as neighbours keep their pitch and it stays inside.
 */
function rowXs(o: RackOptions, row: RackItem[], front: number[] | null, W: number): number[] {
  const centered: number[] = [];
  let x = -rowWidth(o, row) / 2 + row[0].ex;
  row.forEach((it, i) => {
    if (i) x += pitchOf(o, row[i - 1], it);
    centered.push(x);
  });
  if (!front || front.length < 2) return centered;
  const gaps = front.slice(1).map((v, i) => (v + front[i]) / 2);
  if (row.length > gaps.length) return centered;
  const xs = row.map((_, i) => gaps[Math.round(((i + 0.5) * gaps.length) / row.length - 0.5)]);
  const ok =
    xs.every((v, i) => !i || v - xs[i - 1] >= pitchOf(o, row[i - 1], row[i]) - 1e-9) &&
    xs[0] - row[0].ex >= -W / 2 - 1e-9 &&
    xs[xs.length - 1] + row[row.length - 1].ex <= W / 2 + 1e-9;
  return ok ? xs : centered;
}

/** Rows placed front to back with every clearance kept, or null when they don't fit the depth. */
function placeRows(o: RackOptions, rows: RackItem[][], g: { W: number; D: number; top: number; floor: number }): Omit<RackLayout, 'total' | 'dropped'> | null {
  const T = Math.tan(o.tilt * DEG);
  const cosT = Math.cos(o.tilt * DEG);
  const sp = o.spacing;
  const hy = handleTop(o);
  const P = hy + RACK.handleGap;
  const { labelBox: LB, labelGap: LG, labelDepth: LD } = RACK;
  const Y0 = -g.D / 2;
  const Y1 = g.D / 2;
  const R = rows.length;
  const want = o.depth * cosT;
  const room = Math.max(0, g.top - g.floor - Math.min(want, RACK.minHold));
  const step = R > 1 ? clamp(o.step, 0, room / (R - 1)) : 0;
  const zs = rows.map((_, r) => g.top - (R - 1 - r) * step);
  const dzs = zs.map((z) => Math.max(0, Math.min(want, z - g.floor)));
  const placed: RackPlace[][] = [];
  const backs: number[] = [];
  for (let r = 0; r < R; r++) {
    const row = rows[r];
    const xs = rowXs(o, row, r > 0 && o.stagger && r % 2 === 1 ? placed[r - 1].map((p) => p.x) : null, g.W);
    const z = zs[r];
    const dz = dzs[r];
    // A row's labels share one line, in front of its widest hole: how far that is from the holes' center line.
    const labelReach = Math.max(0, ...row.filter((it) => it.label).map((it) => it.wy / 2 + LD * T + LG + LB));
    // Rows go back from the front, and every hole stays inside the front edge all the way down.
    let y = r > 0 ? placed[r - 1][0].y : -Infinity;
    row.forEach((it, i) => {
      y = Math.max(y, Y0 + RACK.edge + it.wy / 2 + dz * T);
      if (it.label) y = Math.max(y, Y0 + 0.8 + labelReach);
      if (hy > 0) y = Math.max(y, Y0 + hy / 2);
      if (r > 0 && step > 0) {
        // Behind the riser, all the way down to the step below; the label on this step.
        const b = backs[r - 1];
        y = Math.max(y, b + sp + it.wy / 2 + Math.min(step, dz) * T);
        if (it.label) y = Math.max(y, b + 0.8 + labelReach);
      }
      for (let q = 0; q < r; q++) {
        const rise = z - zs[q];
        for (const a of placed[q]) {
          const dx = Math.abs(xs[i] - a.x);
          // Holes that reach the same heights keep `spacing` between them (they lean in parallel).
          if (dx < (a.sx + it.sx) / 2 + sp && z - dz < zs[q]) y = Math.max(y, a.y + (a.wy + it.wy) / 2 + rise * T + sp);
          // Round handles nest between the ones in front.
          if (hy > 0 && dx < P) y = Math.max(y, a.y + Math.sqrt(P * P - dx * dx));
          // This label stays clear of the hole in front, on the same level…
          if (rise < 1e-9 && it.label && dx < (it.lw + a.sx) / 2 + 0.5) y = Math.max(y, a.y + a.wy / 2 + 0.8 + labelReach);
          // …and this hole of the label in front.
          if (a.labelAt && dx < (it.sx + a.lw) / 2 + 0.5 && z - dz < zs[q] - LD) {
            y = Math.max(y, a.labelAt.y + LB / 2 + 0.5 + it.wy / 2 + (rise + LD) * T);
          }
        }
      }
    });
    placed.push(
      row.map((it, i) => ({
        ...it,
        x: r3(xs[i]),
        y,
        row: r,
        z,
        dz,
        ...(it.label ? { labelAt: { x: r3(xs[i]), y: y - labelReach + LB / 2, w: it.lw } } : {}),
      })),
    );
    if (r < R - 1 && step > 0) {
      let b = y + Math.max(...row.map((it) => it.wy / 2)) + Math.max(sp, step * T + 0.5);
      // A tool leaning back clears the step behind it; so does a handle resting on this step.
      if (hy > 0) b = Math.max(b, y + hy / 2 + step * T + 0.5);
      backs.push(b);
    }
  }
  const all = placed.flat();
  const need = Math.max(...all.map((p) => Math.max(p.y + p.wy / 2 + RACK.edge, hy > 0 ? p.y + hy / 2 : -Infinity)));
  if (need > Y1 + 1e-9) return null;
  // Center what's used in the depth.
  const shift = (Y1 - need) / 2;
  const move = (v: number) => r3(v + shift);
  for (const p of all) {
    p.y = move(p.y);
    if (p.labelAt) p.labelAt.y = move(p.labelAt.y);
  }
  return {
    top: g.top,
    floor: g.floor,
    W: g.W,
    D: g.D,
    tilt: o.tilt,
    step: r3(step),
    rows: placed.map((places, r) => ({ z: zs[r], back: r < R - 1 && step > 0 ? move(backs[r]) : Y1, places })),
    places: all,
  };
}

/** Where every tool goes. Pure: the sidebar and the planner use it too. */
export function rackLayout(bin: BinOptions, o: RackOptions, cells?: BinCells | null): RackLayout {
  const c = cells ?? binCells(bin);
  const { w: W, d: D } = binSize(bin, c);
  const g = { W, D, top: HEIGHT_UNIT * bin.heightUnits, floor: binFloorZ(bin) };
  const items = rackItems(o);
  const { rows, dropped } = assignRows(o, items, W);
  for (let n = rows.length, lost = dropped; n >= 1; n--) {
    const L = placeRows(o, rows.slice(0, n), g);
    if (L) return { ...L, total: items.length, dropped: lost };
    lost += rows[n - 1].length;
  }
  return { ...g, tilt: o.tilt, step: 0, rows: [], places: [], total: items.length, dropped: items.length };
}

/** Typical length of a tool above the rack (for the tipping check). */
function reachOf(o: RackOptions, p: RackPlace): number {
  if (o.reach > 0) return o.reach;
  const inHole = p.dz / Math.cos(o.tilt * DEG);
  if (o.style === 'wrenches') return Math.max(10, wrenchHead(p.size).length - inHole);
  if (o.style === 'pliers') return 5.5 * o.head + 10;
  // Screwdrivers and files: about 3.5 handle diameters above; hex keys: the long leg (≈ 7.6 × size + 45).
  return o.handle > 0 ? 3.5 * o.handle : Math.max(10, 7.6 * p.size + 45 - inHole);
}

const NOUN: Record<RackStyle, [string, string]> = { drivers: ['hole', 'holes'], pliers: ['slot', 'slots'], wrenches: ['wrench', 'wrenches'] };
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Planning warnings: tools that don't fit, steps or holes cut short, and a rack that may tip. */
export function rackNotes(bin: BinOptions, o: RackOptions, cells?: BinCells | null): string[] {
  const L = rackLayout(bin, o, cells);
  const out: string[] = [];
  const tools = o.style === 'drivers' ? 'tools' : o.style === 'pliers' ? 'pliers' : 'wrenches';
  if (!o.sizes.length) return ['No tool sizes yet.'];
  if (L.dropped) out.push(`${L.dropped} of ${L.total} ${tools} don’t fit: make the rack bigger, use more rows or less spacing.`);
  if (L.rows.length > 1 && L.step + 0.05 < o.step) out.push(`Rows step up only ${round1(L.step)} mm instead of ${o.step}: make the rack taller.`);
  const cosT = Math.cos(o.tilt * DEG);
  const sinT = Math.sin(o.tilt * DEG);
  if (L.places.length) {
    const shallow = Math.min(...L.places.map((p) => p.dz));
    if (shallow + 0.5 < Math.min(o.depth * cosT, 15)) {
      out.push(`${o.style === 'drivers' ? 'Holes are' : 'Slots are'} only ${round1(shallow)} mm deep: make the rack taller so the tools stand firmly.`);
    }
    // Tipping: where the tools' weight sits (the middle of each tool, leaning with it) and how tall they stand.
    const Y1 = L.D / 2;
    let com = 0;
    let lean = -Infinity;
    let tall = 0;
    for (const p of L.places) {
      const reach = reachOf(o, p);
      const inHole = p.dz / cosT;
      com += p.y + Math.max(0, (reach - inHole) / 2) * sinT;
      lean = Math.max(lean, p.y + reach * sinT - Y1);
      tall = Math.max(tall, p.z + reach * cosT);
    }
    com /= L.places.length;
    if (com > Y1 - RACK.edge) {
      out.push(`The tools lean up to ${Math.round(lean)} mm past the back and their weight sits behind the feet, so it may tip backwards: use less tilt, a deeper rack or magnets.`);
    }
    const magnets = bin.holes === 'magnets' || bin.holes === 'both' || bin.holes === 'refined';
    const small = Math.min(L.W, L.D);
    if (tall > (magnets ? 3.5 : 2.5) * small) {
      const base = `${Math.round(L.W)} × ${Math.round(L.D)} mm`;
      out.push(`The tools stand about ${Math.round(tall)} mm tall on a ${base} base, so it may tip when the drawer moves: ${magnets ? 'a bigger footprint helps' : 'magnets or a bigger footprint help'}.`);
    }
  }
  return out;
}

export function rackSummary(bin: BinOptions, o: RackOptions): string {
  const L = rackLayout(bin, o);
  const n = L.places.length;
  const noun = NOUN[o.style][n === 1 ? 0 : 1];
  const kind = o.style === 'drivers' && o.hole === 'hex' ? `hex ${noun}` : noun;
  if (o.style !== 'wrenches' || !n) return `${n} ${kind}`;
  const mode = o.labels === 'none' ? 'mm' : o.labels;
  const sizes = L.places.map((p) => p.size);
  const lo = sizeLabelText(Math.min(...sizes), mode);
  const hi = sizeLabelText(Math.max(...sizes), mode);
  return `${n} ${kind} ${lo === hi ? lo : `${lo}–${hi}`}`;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** One hole or slot, from its bottom to above the top, with its chamfered mouth; leaning back by the tilt. */
function placeCutter(w: Wasm, s: Scope, p: RackPlace, tilt: number): Manifold {
  const zb = p.z - p.dz;
  const zt = p.z + 1;
  const ch = Math.min(RACK.chamfer, p.sx * 0.12, p.sy * 0.12, p.dz / 3);
  const parts: Manifold[] = [];
  if (p.shape === 'round') {
    const r = p.sx / 2;
    parts.push(s.t(cylinderAt(w, p.x, p.y, zb, zt, r, r, 40)));
    if (ch > 0.05) parts.push(s.t(cylinderAt(w, p.x, p.y, p.z - ch, p.z + 0.02, r, r + ch + 0.02, 40)));
  } else if (p.shape === 'hex') {
    // Manifold's 6-sided cylinder has corners on ±X, so the flats face front and back.
    const R = p.sy / SQRT3;
    parts.push(s.t(s.t(w.Manifold.cylinder(zt - zb, R, R, 6)).translate([p.x, p.y, zb])));
    if (ch > 0.05) parts.push(s.t(s.t(w.Manifold.cylinder(ch + 0.02, R, R + ((ch + 0.02) * 2) / SQRT3, 6)).translate([p.x, p.y, p.z - ch])));
  } else {
    const [hx, hy] = [p.sx / 2, p.sy / 2];
    const rr = Math.min(0.5, hx - 0.05, hy - 0.05);
    const ring = roundedRectRing(p.x - hx, p.y - hy, p.x + hx, p.y + hy, rr);
    parts.push(s.t(extrudePolygon(w, ring, zb, zt)));
    if (ch > 0.05) {
      const g = ch + 0.02;
      const big = roundedRectRing(p.x - hx - g, p.y - hy - g, p.x + hx + g, p.y + hy + g, rr + g);
      parts.push(s.t(w.Manifold.hull([...ringAt(ring, p.z - ch), ...ringAt(big, p.z + 0.02)])));
    }
  }
  const cut = parts.length === 1 ? parts[0] : s.t(w.Manifold.union(parts));
  if (tilt <= 0) return cut;
  // Lean back: stretch across the lean (so it stays this wide square to its axis), then shear forward going down.
  const T = Math.tan(tilt * DEG);
  const k = 1 / Math.cos(tilt * DEG);
  return s.t(
    cut.warp((v) => {
      v[1] = p.y + (v[1] - p.y) * k + (v[2] - p.z) * T;
    }),
  );
}

/** The rack body: a block on the base, stepped, with every hole, slot and label cut in. */
function buildRackMesh(w: Wasm, bin: BinOptions, o: RackOptions, cells: BinCells) {
  const s = new Scope();
  try {
    const L = rackLayout(bin, o, cells);
    const body = containerBase(w, s, bin, cells, L.top);
    const cuts: Manifold[] = [];
    const big = Math.max(L.W, L.D);
    for (const row of L.rows) if (row.back < L.D / 2 - 1e-6 && row.z < L.top - 1e-6) cuts.push(s.t(boxAt(w, -big, -big, row.z, big, row.back, L.top + 1)));
    for (const p of L.places) if (p.dz > 0.3) cuts.push(placeCutter(w, s, p, L.tilt));
    if (hasFont()) {
      for (const p of L.places) {
        if (!p.labelAt) continue;
        const t = textOutline(p.label, { size: RACK.labelSize, maxWidth: p.labelAt.w + 0.01 });
        const m = textSolid(w, t, p.labelAt.x, p.labelAt.y, p.z - RACK.labelDepth, RACK.labelDepth + 1);
        if (m) cuts.push(s.t(m));
      }
    }
    const out = cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

export const RACK_DEF: ContainerDef<RackOptions> = {
  kind: 'rack',
  label: 'Tool rack',
  description: 'Holds screwdrivers, hex keys, files, pliers or wrenches upright in holes and slots, handles up.',
  defaults: RACK_DEFAULTS,
  sanitize: (raw) => sanitizeRack(raw),
  key: rackKey,
  height: (bin) => HEIGHT_UNIT * bin.heightUnits,
  build: buildRackMesh,
  summary: rackSummary,
  notes: rackNotes,
};

registerContainer(RACK_DEF);
