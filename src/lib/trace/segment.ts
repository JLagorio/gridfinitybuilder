import { createGray, type GrayImage, type Mask, type Pt } from './image';

/** Otsu's threshold: pixels with value > t are foreground. Optionally only over pixels where `within` is set. */
export function otsu(g: GrayImage, within?: Mask): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < g.data.length; i++) {
    if (within && !within.data[i]) continue;
    hist[g.data[i]]++;
    n++;
  }
  if (!n) return 127;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestT = 127;
  for (let t = 0; t < 255; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

export function threshold(g: GrayImage, t: number): Mask {
  const out = createGray(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) out.data[i] = g.data[i] > t ? 1 : 0;
  return out;
}

/**
 * Binary dilation (`grow`) or erosion with a (2r+1)² square, via prefix sums
 * per axis. Pixels outside the image are ignored (the window is clipped).
 */
function morph(m: Mask, r: number, grow: boolean): Mask {
  if (r <= 0) return { width: m.width, height: m.height, data: m.data.slice() };
  const { width: w, height: h } = m;
  const pass = (src: Uint8Array, len: number, count: number, stride: number, step: number) => {
    const out = new Uint8Array(src.length);
    const pre = new Int32Array(len + 1);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[base + i * step];
      for (let i = 0; i < len; i++) {
        const a = Math.max(0, i - r);
        const b = Math.min(len - 1, i + r);
        const s = pre[b + 1] - pre[a];
        out[base + i * step] = grow ? (s > 0 ? 1 : 0) : s === b - a + 1 ? 1 : 0;
      }
    }
    return out;
  };
  const horiz = pass(m.data, w, h, w, 1);
  return { width: w, height: h, data: pass(horiz, h, w, 1, w) };
}

export const dilate = (m: Mask, r: number) => morph(m, r, true);
export const erode = (m: Mask, r: number) => morph(m, r, false);
/** Fill small gaps and dents. */
export const closeMask = (m: Mask, r: number) => erode(dilate(m, r), r);
/** Remove specks and thin whiskers. */
export const openMask = (m: Mask, r: number) => dilate(erode(m, r), r);

export interface Component {
  /** Label value (1-based). */
  id: number;
  area: number;
  /** Inclusive pixel bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  touchesBorder: boolean;
}

/** 8-connected component labelling. labels[i] = component id, 0 = background. */
export function labelComponents(m: Mask): { labels: Int32Array; comps: Component[] } {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < m.data.length; start++) {
    if (!m.data[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c: Component = { id, area: 0, x0: w, y0: h, x1: -1, y1: -1, touchesBorder: false };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touchesBorder = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (m.data[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/**
 * Which components are the tool: the ones under the clicked points (or the
 * nearest within `snapRadius` px), else the largest one not touching the
 * image border (the paper's edges and whatever lies beyond them).
 */
export function pickComponents(
  labels: Int32Array,
  comps: Component[],
  width: number,
  o: { points?: Pt[]; minArea?: number; snapRadius?: number } = {},
): number[] {
  const height = labels.length / width;
  const minArea = o.minArea ?? 1;
  const picked = new Set<number>();
  for (const [px, py] of o.points ?? []) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x]) {
      picked.add(labels[y * width + x]);
      continue;
    }
    // Nearest component by bounding box, within the snap radius.
    let best = -1;
    let bestD = o.snapRadius ?? 25;
    for (const c of comps) {
      if (c.area < minArea) continue;
      const dx = Math.max(c.x0 - px, 0, px - (c.x1 + 1));
      const dy = Math.max(c.y0 - py, 0, py - (c.y1 + 1));
      const d = Math.hypot(dx, dy);
      if (d <= bestD) {
        bestD = d;
        best = c.id;
      }
    }
    if (best > 0) picked.add(best);
  }
  if (picked.size || o.points?.length) return [...picked];
  const inner = comps.filter((c) => !c.touchesBorder && c.area >= minArea);
  const pool = inner.length ? inner : comps.filter((c) => c.area >= minArea);
  if (!pool.length) return [];
  return [pool.reduce((a, b) => (b.area > a.area ? b : a)).id];
}

/** Mask of just the given components, cropped to their bounds plus `pad` pixels. */
export function componentMask(
  labels: Int32Array,
  comps: Component[],
  width: number,
  ids: number[],
  pad = 2,
): { mask: Mask; ox: number; oy: number } | null {
  const sel = comps.filter((c) => ids.includes(c.id));
  if (!sel.length) return null;
  const height = labels.length / width;
  const x0 = Math.max(0, Math.min(...sel.map((c) => c.x0)) - pad);
  const y0 = Math.max(0, Math.min(...sel.map((c) => c.y0)) - pad);
  const x1 = Math.min(width - 1, Math.max(...sel.map((c) => c.x1)) + pad);
  const y1 = Math.min(height - 1, Math.max(...sel.map((c) => c.y1)) + pad);
  const mask = createGray(x1 - x0 + 1, y1 - y0 + 1);
  const want = new Set(ids);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (want.has(labels[y * width + x])) mask.data[(y - y0) * mask.width + (x - x0)] = 1;
    }
  }
  return { mask, ox: x0, oy: y0 };
}

/**
 * Join separate pieces (a tool split by a glare spot) by closing with a growing
 * radius until it's one piece, up to `maxR` px. Returns the mask unchanged if it already is.
 */
export function joinPieces(m: Mask, maxR: number): Mask {
  let cur = m;
  for (let r = 1; labelComponents(cur).comps.length > 1 && r <= maxR; r *= 2) cur = closeMask(m, r);
  return cur;
}

/**
 * Marching squares on a scalar field (pixel centers at x + 0.5, y + 0.5),
 * with values outside the image taken as 0. Returns every closed iso-contour
 * at `iso`, in pixel coordinates. Saddles are resolved as connected when the
 * cell's mean is above the iso level.
 */
export function marchingSquares(field: ArrayLike<number>, w: number, h: number, iso: number): Pt[][] {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : field[j * w + i]);
  const cols = w + 2;
  // Edge ids: corner (i, j) with i in [-1, w], j in [-1, h] → c = (j + 1) * cols + (i + 1).
  // Horizontal edge (i,j)-(i+1,j) = 2c; vertical edge (i,j)-(i,j+1) = 2c + 1.
  const points = new Map<number, Pt>();
  const links = new Map<number, number[]>();
  const edgePoint = (id: number): Pt => {
    let p = points.get(id);
    if (p) return p;
    const c = id >> 1;
    const i = (c % cols) - 1;
    const j = Math.floor(c / cols) - 1;
    const a = at(i, j);
    const b = id & 1 ? at(i, j + 1) : at(i + 1, j);
    const t = b === a ? 0.5 : (iso - a) / (b - a);
    p = id & 1 ? [i + 0.5, j + 0.5 + t] : [i + 0.5 + t, j + 0.5];
    points.set(id, p);
    return p;
  };
  const link = (a: number, b: number) => {
    edgePoint(a);
    edgePoint(b);
    let la = links.get(a);
    if (!la) links.set(a, (la = []));
    la.push(b);
    let lb = links.get(b);
    if (!lb) links.set(b, (lb = []));
    lb.push(a);
  };
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      const k = (v0 >= iso ? 1 : 0) | (v1 >= iso ? 2 : 0) | (v2 >= iso ? 4 : 0) | (v3 >= iso ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const c0 = (j + 1) * cols + (i + 1);
      const e0 = 2 * c0; // top: c0-c1
      const e1 = 2 * (c0 + 1) + 1; // right: c1-c2
      const e2 = 2 * (c0 + cols); // bottom: c3-c2
      const e3 = 2 * c0 + 1; // left: c0-c3
      const joined = (v0 + v1 + v2 + v3) / 4 >= iso;
      switch (k) {
        case 1:
        case 14:
          link(e3, e0);
          break;
        case 2:
        case 13:
          link(e0, e1);
          break;
        case 3:
        case 12:
          link(e3, e1);
          break;
        case 4:
        case 11:
          link(e1, e2);
          break;
        case 6:
        case 9:
          link(e0, e2);
          break;
        case 7:
        case 8:
          link(e3, e2);
          break;
        case 5:
          if (joined) {
            link(e0, e1);
            link(e2, e3);
          } else {
            link(e3, e0);
            link(e1, e2);
          }
          break;
        case 10:
          if (joined) {
            link(e3, e0);
            link(e1, e2);
          } else {
            link(e0, e1);
            link(e2, e3);
          }
          break;
      }
    }
  }
  // Every edge point has exactly two neighbours: walk the loops.
  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(points.get(cur)!);
      const nb = links.get(cur)!;
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
      if (cur === undefined) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
