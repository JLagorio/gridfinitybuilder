/**
 * Rectangle packing onto printer plates (MaxRects, best-short-side-fit, with 90° rotation).
 */

import type { BedRect } from '../printers';

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
  /** Bed areas parts must stay out of, by at least the spacing. */
  exclude?: BedRect[];
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
  ) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
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
    this.reserve({ x, y, w: (rotated ? d : w) + pad, h: (rotated ? w : d) + pad });
    this.placed.push({ key, x, y, w, d, rotated });
  }

  /** Takes an area out of the free space without putting a part there. */
  reserve(used: Rect) {
    const next: Rect[] = [];
    for (const fr of this.free) {
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
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i && contains(b, a) && (!contains(a, b) || j < i)));
  }
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function contains(a: Rect, b: Rect) {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

/**
 * An empty plate, in plate coordinates (usable area front-left = 0,0). It is one
 * spacing larger than the usable area so the last part in a row may touch the edge.
 * With `avoid`, the exclusion areas are taken out, grown by the spacing towards the parts.
 */
function emptyPlate(o: PackOptions, avoid: boolean): MaxRectsBin {
  const s = Math.max(0, o.spacing);
  const bin = new MaxRectsBin(o.bedW - 2 * o.margin + s, o.bedD - 2 * o.margin + s);
  if (avoid) {
    for (const e of o.exclude ?? []) {
      const x0 = Math.max(0, e.x - o.margin);
      const y0 = Math.max(0, e.y - o.margin);
      const x1 = Math.min(bin.W, e.x + e.w - o.margin + s);
      const y1 = Math.min(bin.H, e.y + e.d - o.margin + s);
      if (x1 > x0 + EPS && y1 > y0 + EPS) bin.reserve({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return bin;
}

/** The largest parts (w × d, unrotated) an empty plate takes: one per free area. */
export function plateLimits(o: PackOptions): [number, number][] {
  const s = Math.max(0, o.spacing);
  return emptyPlate(o, true).free.map((r) => [r.w - s, r.h - s]);
}

export function fitsOnBed(w: number, d: number, o: PackOptions): boolean {
  const s = Math.max(0, o.spacing);
  return emptyPlate(o, true).find(w + s, d + s, true) !== null;
}

/**
 * Pack items onto as few plates as possible. Items that can't fit any plate are
 * returned in `oversize` instead of being dropped silently.
 */
export function packPlates(items: PackItem[], o: PackOptions): { plates: PlateLayout[]; oversize: PackItem[] } {
  const oversize: PackItem[] = [];
  const ok: PackItem[] = [];
  for (const it of items) (fitsOnBed(it.w, it.d, o) ? ok : oversize).push(it);

  // Pack as if the bed were clear, then center each plate, moving it off any exclusion area.
  const bins = fill(ok, o, false);
  const settled = bins.map((bin) => settle(bin, o));
  const kept = settled.filter((pl): pl is PlateLayout => pl !== null);
  if (kept.length === bins.length) return { plates: kept, oversize };

  // Some plates are too full to move clear. Pack their parts around the exclusion areas
  // instead, or everything if that takes fewer plates. Either way every plate settles.
  const stuck = bins.flatMap((bin, i) => (settled[i] ? [] : bin.placed.map(({ key, w, d }) => ({ key, w, d }))));
  const mixed = [...kept, ...fill(stuck, o, true).map((bin) => settle(bin, o)!)];
  const avoiding = fill(ok, o, true).map((bin) => settle(bin, o)!);
  return { plates: avoiding.length < mixed.length ? avoiding : mixed, oversize };
}

/** First fit, biggest parts first: they constrain the layout the most. */
function fill(items: PackItem[], o: PackOptions, avoid: boolean): MaxRectsBin[] {
  const s = Math.max(0, o.spacing);
  const sorted = [...items].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || b.w * b.d - a.w * a.d);
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
      const bin = emptyPlate(o, avoid);
      const f = bin.find(it.w + s, it.d + s, true)!;
      bin.place(it.key, f.x, f.y, it.w, it.d, f.rotated, s);
      bins.push(bin);
    }
  }
  return bins;
}

/**
 * Center a packed group on the bed. If that brings a part within one spacing of an
 * exclusion area, move the group as little as possible to clear it, mirroring it if
 * that puts a part that can move clear into the corner; null if nothing clears it.
 */
function settle(bin: MaxRectsBin, o: PackOptions): PlateLayout | null {
  const boxes: Rect[] = bin.placed.map((p) => ({ x: p.x, y: p.y, w: p.rotated ? p.d : p.w, h: p.rotated ? p.w : p.d }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  let best: { at: Rect[]; dx: number; dy: number; dist: number } | null = null;
  for (const [flipX, flipY] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const at = boxes.map((b) => ({
      ...b,
      x: flipX ? minX + maxX - b.x - b.w : b.x,
      y: flipY ? minY + maxY - b.y - b.h : b.y,
    }));
    const f = nearestClear(at, { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, o);
    if (f && (!best || f.dist < best.dist - EPS)) best = { at, ...f };
  }
  if (!best) return null;
  const { at, dx, dy } = best;
  return { placements: bin.placed.map((p, i) => ({ ...p, x: at[i].x + dx, y: at[i].y + dy })) };
}

/**
 * The offset from plate to bed coordinates closest to centering the group (bounding
 * box `g`) that keeps it inside the margins and every part one spacing clear of the
 * exclusion areas, with its squared distance from centered.
 */
function nearestClear(boxes: Rect[], g: Rect, o: PackOptions): { dx: number; dy: number; dist: number } | null {
  const s = Math.max(0, o.spacing);
  const cx = (o.bedW - g.w) / 2 - g.x;
  const cy = (o.bedD - g.h) / 2 - g.y;
  const lo = { x: o.margin - g.x, y: o.margin - g.y };
  const hi = { x: o.bedW - o.margin - g.x - g.w, y: o.bedD - o.margin - g.y - g.h };
  // Offsets that would bring some part within one spacing of an exclusion area (open boxes).
  const banned: Rect[] = [];
  for (const e of o.exclude ?? []) {
    for (const b of boxes) {
      const r = { x: e.x - s - b.x - b.w, y: e.y - s - b.y - b.h, w: e.w + 2 * s + b.w, h: e.d + 2 * s + b.h };
      if (r.x < hi.x && r.x + r.w > lo.x && r.y < hi.y && r.y + r.h > lo.y) banned.push(r);
    }
  }
  const clear = (dx: number, dy: number) =>
    !banned.some((r) => dx > r.x + EPS && dx < r.x + r.w - EPS && dy > r.y + EPS && dy < r.y + r.h - EPS);
  // The nearest clear offset has each coordinate centered or on the edge of a banned box.
  // The margin is where the parts were packed, which is clear when they were packed around the areas.
  const xs = [cx, o.margin, lo.x, hi.x, ...banned.flatMap((r) => [r.x, r.x + r.w])].filter(
    (v) => v >= lo.x - EPS && v <= hi.x + EPS,
  );
  const ys = [cy, o.margin, lo.y, hi.y, ...banned.flatMap((r) => [r.y, r.y + r.h])].filter(
    (v) => v >= lo.y - EPS && v <= hi.y + EPS,
  );
  let best: { dx: number; dy: number; dist: number } | null = null;
  for (const dx of xs) {
    for (const dy of ys) {
      const dist = (dx - cx) ** 2 + (dy - cy) ** 2;
      if ((!best || dist < best.dist - EPS) && clear(dx, dy)) best = { dx, dy, dist };
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
  const bins = plates.map((pl) => {
    const bin = emptyPlate(o, true);
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
