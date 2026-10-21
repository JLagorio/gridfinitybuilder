/**
 * Rectangle packing onto printer plates (MaxRects, best-short-side-fit, with 90° rotation).
 *
 * Some printers keep part of the bed free (Bambu X1 / P1: the front-left
 * corner, printers.ts `exclude`), and Bambu Studio won't slice a plate with a
 * part there. Those areas, grown by the part spacing, are taken out of every
 * plate before anything is packed; centring stops short of them; and a part
 * fits the printer only if it fits beside or behind them (`clearAreas`, which
 * bedfit.ts holds bins to as well).
 */
import { bedExclusion, type BedRect } from '../printers';

export interface PackItem {
  key: string;
  w: number;
  d: number;
}

export interface Placement {
  key: string;
  /** Min corner on the bed (bed front-left = 0,0), after rotation. */
  x: number;
  y: number;
  /** Original (unrotated) footprint. */
  w: number;
  d: number;
  /** Rotated 90° CCW about Z. */
  rotated: boolean;
}

export interface PlateLayout {
  placements: Placement[];
}

export interface PackOptions {
  bedW: number;
  bedD: number;
  /** Keep-out from the bed edge, mm. */
  margin: number;
  /** Gap between parts, mm. */
  spacing: number;
  /** Allow more than one part per plate. */
  nest: boolean;
  /** Bed areas no part may stand in (printers.ts `exclude`), bed coordinates. */
  exclude?: readonly BedRect[];
  /** Gap kept between parts and `exclude`, mm; unset: the spacing. Never less than MIN_EXCLUDE_GAP. */
  excludeGap?: number;
}

/** What a plate's bed is: its size, edge margin and exclusion areas, and the gaps parts keep to them. */
export type PlateBed = Pick<PackOptions, 'bedW' | 'bedD' | 'margin' | 'exclude' | 'excludeGap'> & { spacing?: number };

/** Parts stay at least this far from an exclusion area whatever the spacing, mm. */
export const MIN_EXCLUDE_GAP = 1;

/** Gap between bins (and the small parts printed with them) on a plate: the setup's spacing, at least 2 mm (as project.ts packs them). */
export const binSpacing = (spacing = 0) => Math.max(spacing, 2);

/** The bed fields of the pack options for a printer: its bed, edge margin and exclusion areas (printers.ts). */
export function plateBed(p: { printerId: string; bedW: number; bedD: number; plateMargin: number }): Pick<PackOptions, 'bedW' | 'bedD' | 'margin' | 'exclude'> {
  const exclude = bedExclusion(p.printerId);
  return { bedW: p.bedW, bedD: p.bedD, margin: p.plateMargin, ...(exclude.length ? { exclude } : {}) };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

class MaxRectsBin {
  free: Rect[];
  placed: { key: string; x: number; y: number; w: number; d: number; rotated: boolean }[] = [];
  constructor(
    public W: number,
    public H: number,
    blocked: readonly Rect[] = [],
  ) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
    for (const b of blocked) this.free = subtract(this.free, b);
  }

  find(w: number, h: number, allowRotate: boolean) {
    let best: { x: number; y: number; rotated: boolean; s1: number; s2: number } | null = null;
    for (const fr of this.free) {
      for (const rot of allowRotate && Math.abs(w - h) > EPS ? [false, true] : [false]) {
        const rw = rot ? h : w;
        const rh = rot ? w : h;
        if (rw <= fr.w + EPS && rh <= fr.h + EPS) {
          const s1 = Math.min(fr.w - rw, fr.h - rh);
          const s2 = Math.max(fr.w - rw, fr.h - rh);
          if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) < EPS && s2 < best.s2)) {
            best = { x: fr.x, y: fr.y, rotated: rot, s1, s2 };
          }
        }
      }
    }
    return best;
  }

  /** Records a part of real size w×d; `pad` (the spacing) is reserved on its far sides. */
  place(key: string, x: number, y: number, w: number, d: number, rotated: boolean, pad: number) {
    const rw = (rotated ? d : w) + pad;
    const rh = (rotated ? w : d) + pad;
    this.free = subtract(this.free, { x, y, w: rw, h: rh });
    this.placed.push({ key, x, y, w, d, rotated });
  }
}

/** The free rectangles less `used`: what's left of each one around it, the ones inside others dropped (MaxRects). */
function subtract(free: Rect[], used: Rect): Rect[] {
  const next: Rect[] = [];
  for (const fr of free) {
    if (!intersects(fr, used)) {
      next.push(fr);
      continue;
    }
    if (used.x > fr.x + EPS) next.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
    if (used.x + used.w < fr.x + fr.w - EPS)
      next.push({ x: used.x + used.w, y: fr.y, w: fr.x + fr.w - (used.x + used.w), h: fr.h });
    if (used.y > fr.y + EPS) next.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
    if (used.y + used.h < fr.y + fr.h - EPS)
      next.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: fr.y + fr.h - (used.y + used.h) });
  }
  return next.filter((a, i) => !next.some((b, j) => j !== i && contains(b, a) && (!contains(a, b) || j < i)));
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function contains(a: Rect, b: Rect) {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

const gapOf = (o: PlateBed) => Math.max(MIN_EXCLUDE_GAP, o.excludeGap ?? o.spacing ?? 0);

/** The exclusion areas grown by the gap parts keep to them, bed coordinates. */
function keepOuts(o: PlateBed): Rect[] {
  const g = gapOf(o);
  return (o.exclude ?? []).filter((e) => e.w > 0 && e.d > 0).map((e) => ({ x: e.x - g, y: e.y - g, w: e.w + 2 * g, h: e.d + 2 * g }));
}

/**
 * The keep-outs in a plate's MaxRects coordinates: from the margin's corner,
 * where every part reserves the spacing `s` past its right and back sides. A
 * part clears a keep-out exactly when its padded rectangle clears the
 * keep-out's [start + s, end). One narrower than the spacing keeps a sliver
 * at its end, so it still blocks (a part left of it then keeps a little more).
 */
function binObstacles(o: PlateBed, s: number): Rect[] {
  const cut = (len: number) => Math.min(s, Math.max(0, len - 1e-3));
  return keepOuts(o).map((k) => ({ x: k.x - o.margin + cut(k.w), y: k.y - o.margin + cut(k.h), w: k.w - cut(k.w), h: k.h - cut(k.h) }));
}

/** An empty plate: the bed inside the edge margin (plus a spacing, so the last part in a row may touch the edge), the exclusion areas taken out. */
function emptyBin(o: PlateBed, s: number): MaxRectsBin {
  return new MaxRectsBin(o.bedW - 2 * o.margin + s, o.bedD - 2 * o.margin + s, binObstacles(o, s));
}

/**
 * Where a part may stand on an empty plate: the bed inside the edge margin,
 * less the exclusion areas and the gap parts keep to them, as the largest
 * rectangles that make it up (the packer's free rectangles, bed coordinates).
 * A part fits the plate when it fits one of them, either way round. Without
 * exclusion areas it is just the usable bed; with the X1 / P1 front-left
 * corner, the strip right of the corner (full depth) and the strip behind it
 * (full width).
 */
export function clearAreas(o: PlateBed): BedRect[] {
  const W = o.bedW - 2 * o.margin;
  const D = o.bedD - 2 * o.margin;
  if (!o.exclude?.length) return W > 0 && D > 0 ? [{ x: o.margin, y: o.margin, w: W, d: D }] : [];
  const s = Math.max(0, o.spacing ?? 0);
  return emptyBin(o, s)
    .free.map((f) => ({ x: f.x + o.margin, y: f.y + o.margin, w: f.w - s, d: f.h - s }))
    .filter((a) => a.w > EPS && a.d > EPS);
}

const fitsArea = (w: number, d: number, a: { w: number; d: number }) => (w <= a.w + EPS && d <= a.d + EPS) || (d <= a.w + EPS && w <= a.d + EPS);

/** Does a w × d part fit an empty plate (either way round, clear of the exclusion areas)? */
export function fitsOnBed(w: number, d: number, o: PlateBed): boolean {
  if (!o.exclude?.length) return fitsArea(w, d, { w: o.bedW - 2 * o.margin, d: o.bedD - 2 * o.margin });
  return clearAreas(o).some((a) => fitsArea(w, d, a));
}

/**
 * Pack items onto as few plates as possible. Items that can't fit any plate are
 * returned in `oversize` instead of being dropped silently.
 */
export function packPlates(items: PackItem[], o: PackOptions): { plates: PlateLayout[]; oversize: PackItem[] } {
  const around = packAround(items, o);
  if (!o.exclude?.length || around.plates.length < 2) return around;
  // Packed as on a bed without the exclusion areas, then each plate moved (or
  // mirrored) clear of them, sometimes takes fewer plates: a part can stand in
  // front of the corner when a shorter one goes behind it. Plates that can't be
  // cleared are packed again around the areas. The fewer plates win.
  const left = new Set(around.oversize.map((it) => it.key));
  const plain = packAround(
    items.filter((it) => !left.has(it.key)),
    { ...o, exclude: undefined },
  );
  const byKey = new Map(items.map((it) => [it.key, it]));
  const plates: PlateLayout[] = [];
  const redo: PackItem[] = [];
  for (const pl of plain.plates) {
    const moved = clearPlate(pl.placements, o);
    if (moved) plates.push({ placements: moved });
    else for (const p of pl.placements) redo.push(byKey.get(p.key)!);
  }
  const again = packAround(redo, o);
  if (again.oversize.length || plates.length + again.plates.length >= around.plates.length) return around;
  return { plates: [...plates, ...again.plates], oversize: around.oversize };
}

/** A packed plate moved clear of the exclusion areas as it is, or mirrored (either way, or both); null when none of those clears them. */
function clearPlate(placements: Placement[], o: PlateBed): Placement[] | null {
  const feet = placements.map(footOf);
  const x0 = Math.min(...feet.map((f) => f.x));
  const y0 = Math.min(...feet.map((f) => f.y));
  const x1 = Math.max(...feet.map((f) => f.x + f.w));
  const y1 = Math.max(...feet.map((f) => f.y + f.h));
  for (const [mx, my] of [[false, false], [true, false], [false, true], [true, true]]) {
    const flipped = placements.map((p, i) => ({
      ...p,
      x: mx ? x0 + x1 - feet[i].x - feet[i].w : p.x,
      y: my ? y0 + y1 - feet[i].y - feet[i].h : p.y,
    }));
    const moved = movePlate(flipped, o);
    if (moved) return moved;
  }
  return null;
}

/** packPlates, the exclusion areas taken out of every plate before anything goes on it. */
function packAround(items: PackItem[], o: PackOptions): { plates: PlateLayout[]; oversize: PackItem[] } {
  const s = Math.max(0, o.spacing);
  const oversize: PackItem[] = [];
  const ok: PackItem[] = [];
  const areas = clearAreas(o);
  for (const it of items) (areas.some((a) => fitsArea(it.w, it.d, a)) ? ok : oversize).push(it);

  // Big things first: they constrain the layout the most.
  const sorted = [...ok].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || b.w * b.d - a.w * a.d);
  const bins: MaxRectsBin[] = [];
  for (const it of sorted) {
    let placed = false;
    if (o.nest) {
      for (const bin of bins) {
        const f = bin.find(it.w + s, it.d + s, true);
        if (f) {
          bin.place(it.key, f.x, f.y, it.w, it.d, f.rotated, s);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const bin = emptyBin(o, s);
      const f = bin.find(it.w + s, it.d + s, true);
      // It fits clearAreas, so it fits an empty plate: this is only a guard.
      if (!f) {
        oversize.push(it);
        continue;
      }
      bin.place(it.key, f.x, f.y, it.w, it.d, f.rotated, s);
      bins.push(bin);
    }
  }

  return { plates: bins.map((bin) => centerOnBed(bin, o)), oversize };
}

/** A part's footprint after rotation. */
const footOf = (p: { x: number; y: number; w: number; d: number; rotated: boolean }): Rect => ({
  x: p.x,
  y: p.y,
  w: p.rotated ? p.d : p.w,
  h: p.rotated ? p.w : p.d,
});

/** Center a packed group on the bed, as far as the exclusion areas let it. */
function centerOnBed(bin: MaxRectsBin, o: PackOptions): PlateLayout {
  // Where it was packed (from the margin's corner) is clear of them already.
  const [dx, dy] = clearOffset(bin.placed.map(footOf), o, [o.margin, o.margin]) ?? [o.margin, o.margin];
  return {
    placements: bin.placed.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

/**
 * A packed plate moved onto another bed (another printer's): centred, as far
 * as that bed's exclusion areas let it, the layout kept. Null when the parts
 * don't fit inside its edge margin clear of them.
 */
export function movePlate(placements: Placement[], o: PlateBed): Placement[] | null {
  const off = clearOffset(placements.map(footOf), o);
  return off && placements.map((p) => ({ ...p, x: p.x + off[0], y: p.y + off[1] }));
}

const TOL = 1e-6;
/** Strictly inside the span [a, a + len], by more than the tolerance. */
const within = (v: number, a: number, len: number) => v > a + TOL && v < a + len - TOL;

/**
 * The offset to add to every part (x and y) so the group is centred on the
 * bed; when that puts a part in an exclusion area (or within its gap), the
 * clear offset nearest the centre, looked for along x, along y, toward
 * `fallback` (an offset known to be clear) and, without one, at every pair of
 * edges the keep-outs make. Offsets keep the group inside the edge margin.
 * Null when it doesn't fit or no clear offset is found.
 */
function clearOffset(feet: Rect[], o: PlateBed, fallback?: [number, number]): [number, number] | null {
  if (!feet.length) return [0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of feet) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }
  const target: [number, number] = [(o.bedW - (maxX - minX)) / 2 - minX, (o.bedD - (maxY - minY)) / 2 - minY];
  const lo = [o.margin - minX, o.margin - minY];
  const hi = [o.bedW - o.margin - maxX, o.bedD - o.margin - maxY];
  if (hi[0] < lo[0] - EPS || hi[1] < lo[1] - EPS) return null;
  const keep = keepOuts(o);
  if (!keep.length) return target;
  // The offsets that put a part inside a keep-out (open: touching one is fine).
  const bad: Rect[] = [];
  for (const f of feet) for (const k of keep) bad.push({ x: k.x - f.x - f.w, y: k.y - f.y - f.h, w: k.w + f.w, h: k.h + f.h });
  const clear = (t: [number, number]) =>
    t[0] >= lo[0] - TOL &&
    t[0] <= hi[0] + TOL &&
    t[1] >= lo[1] - TOL &&
    t[1] <= hi[1] + TOL &&
    !bad.some((b) => within(t[0], b.x, b.w) && within(t[1], b.y, b.h));
  if (clear(target)) return target;

  const found: [number, number][] = [];
  // Along one axis, the other kept centred: either end of the run of bad offsets the centre is in.
  for (const axis of [0, 1] as const) {
    const other = 1 - axis;
    const spans = bad
      .filter((b) => within(target[other], other ? b.y : b.x, other ? b.h : b.w))
      .map((b) => (axis ? [b.y, b.y + b.h] : [b.x, b.x + b.w]))
      .sort((a, b) => a[0] - b[0]);
    const runs: number[][] = [];
    for (const sp of spans) {
      const last = runs[runs.length - 1];
      if (last && sp[0] < last[1] - TOL) last[1] = Math.max(last[1], sp[1]);
      else runs.push([...sp]);
    }
    const run = runs.find((r) => within(target[axis], r[0], r[1] - r[0]));
    for (const v of run ?? []) {
      const t: [number, number] = [...target];
      t[axis] = v;
      found.push(t);
    }
  }
  if (fallback) {
    // Toward the fallback: the first clear point on the way (t = 0 at the centre, 1 at the fallback).
    const dir = [fallback[0] - target[0], fallback[1] - target[1]];
    const span = (a: number, len: number, k: 0 | 1): [number, number] => {
      if (Math.abs(dir[k]) < TOL) return within(target[k], a, len) ? [-Infinity, Infinity] : [1, 0];
      const u = (a - target[k]) / dir[k];
      const v = (a + len - target[k]) / dir[k];
      return [Math.min(u, v), Math.max(u, v)];
    };
    const runs = bad.map((b) => {
      const x = span(b.x, b.w, 0);
      const y = span(b.y, b.h, 1);
      return [Math.max(x[0], y[0]), Math.min(x[1], y[1])];
    });
    let t = 0;
    for (let moved = true; moved && t < 1; ) {
      moved = false;
      for (const [a, b] of runs) {
        if (a < b && t > a && t < b) {
          t = b;
          moved = true;
        }
      }
    }
    t = Math.min(1, t);
    found.push([target[0] + t * dir[0], target[1] + t * dir[1]], fallback);
  } else {
    // Every pair of edges: the margin's, the centre's and the bad offsets'.
    const edges = (k: 0 | 1) =>
      [target[k], lo[k], hi[k], ...bad.flatMap((b) => (k ? [b.y, b.y + b.h] : [b.x, b.x + b.w]))].filter((v) => v >= lo[k] - TOL && v <= hi[k] + TOL);
    const ys = edges(1);
    for (const x of edges(0)) for (const y of ys) found.push([x, y]);
  }
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const t of found) {
    const d = (t[0] - target[0]) ** 2 + (t[1] - target[1]) ** 2;
    if (d < bestD - 1e-9 && clear(t)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * Fit small items into the free space left on plates that are already packed,
 * leaving what's there in place. Whatever doesn't fit goes on new plates.
 */
export function packIntoPlates(
  plates: PlateLayout[],
  items: PackItem[],
  o: PackOptions,
): { plates: PlateLayout[]; extra: PlateLayout[]; oversize: PackItem[] } {
  const s = Math.max(0, o.spacing);
  const sorted = [...items].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || b.w * b.d - a.w * a.d);
  // The exclusion areas are taken out of every plate, like a part already there.
  const bins = plates.map((pl) => {
    const bin = emptyBin(o, s);
    for (const p of pl.placements) bin.place(p.key, p.x - o.margin, p.y - o.margin, p.w, p.d, p.rotated, s);
    return bin;
  });
  const added: Placement[][] = plates.map(() => []);
  const rest: PackItem[] = [];
  for (const it of sorted) {
    let placed = false;
    for (let i = 0; i < bins.length && !placed; i++) {
      const f = bins[i].find(it.w + s, it.d + s, true);
      if (f) {
        bins[i].place(it.key, f.x, f.y, it.w, it.d, f.rotated, s);
        added[i].push({ key: it.key, x: f.x + o.margin, y: f.y + o.margin, w: it.w, d: it.d, rotated: f.rotated });
        placed = true;
      }
    }
    if (!placed) rest.push(it);
  }
  const more = packPlates(rest, { ...o, nest: true });
  return {
    plates: plates.map((pl, i) => ({ placements: [...pl.placements, ...added[i]] })),
    extra: more.plates,
    oversize: more.oversize,
  };
}
