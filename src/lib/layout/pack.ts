/**
 * Rectangle packing onto printer plates (MaxRects, best-short-side-fit, with 90° rotation).
 */

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
    const rw = (rotated ? d : w) + pad;
    const rh = (rotated ? w : d) + pad;
    const used: Rect = { x, y, w: rw, h: rh };
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
    this.placed.push({ key, x, y, w, d, rotated });
  }
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function contains(a: Rect, b: Rect) {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

export function fitsOnBed(w: number, d: number, o: PackOptions): boolean {
  const W = o.bedW - 2 * o.margin;
  const D = o.bedD - 2 * o.margin;
  return (w <= W + EPS && d <= D + EPS) || (d <= W + EPS && w <= D + EPS);
}

/**
 * Pack items onto as few plates as possible. Items that can't fit any plate are
 * returned in `oversize` instead of being dropped silently.
 */
export function packPlates(items: PackItem[], o: PackOptions): { plates: PlateLayout[]; oversize: PackItem[] } {
  const W = o.bedW - 2 * o.margin;
  const D = o.bedD - 2 * o.margin;
  const s = Math.max(0, o.spacing);
  const oversize: PackItem[] = [];
  const ok: PackItem[] = [];
  for (const it of items) (fitsOnBed(it.w, it.d, o) ? ok : oversize).push(it);

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
      // Inflate the bin by one spacing so the last item in a row may touch the edge.
      const bin = new MaxRectsBin(W + s, D + s);
      const f = bin.find(it.w + s, it.d + s, true)!;
      bin.place(it.key, f.x, f.y, it.w, it.d, f.rotated, s);
      bins.push(bin);
    }
  }

  return { plates: bins.map((bin) => centerOnBed(bin, o)), oversize };
}

/** Center a packed group on the bed. */
function centerOnBed(bin: MaxRectsBin, o: PackOptions): PlateLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of bin.placed) {
    const rw = p.rotated ? p.d : p.w;
    const rh = p.rotated ? p.w : p.d;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + rw);
    maxY = Math.max(maxY, p.y + rh);
  }
  const dx = (o.bedW - (maxX - minX)) / 2 - minX;
  const dy = (o.bedD - (maxY - minY)) / 2 - minY;
  return {
    placements: bin.placed.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
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
  const W = o.bedW - 2 * o.margin;
  const D = o.bedD - 2 * o.margin;
  const s = Math.max(0, o.spacing);
  const sorted = [...items].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || b.w * b.d - a.w * a.d);
  const bins = plates.map((pl) => {
    const bin = new MaxRectsBin(W + s, D + s);
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
