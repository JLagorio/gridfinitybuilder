import type { Pt } from './image';

/** Plain-number polygon helpers shared by the tracer, importers and the cutout editor. */

/** Signed area (shoelace); positive = counter-clockwise in a y-up frame. */
export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return a / 2;
}

export function perimeter(p: Pt[]): number {
  let l = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) l += Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
  return l;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bounds(p: Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of p) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Drop repeated points (and a closing point equal to the first). */
export function dedupe(p: Pt[], eps = 1e-9): Pt[] {
  const out: Pt[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > eps || Math.abs(last[1] - q[1]) > eps) out.push(q);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= eps && Math.abs(out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdpOpen(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(p[i], p[a], p[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

/** Ramer–Douglas–Peucker for a closed polygon (split at two far-apart points). */
export function simplifyClosed(p: Pt[], eps: number): Pt[] {
  if (p.length <= 4 || eps <= 0) return p.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdpOpen(p.slice(0, far + 1), eps);
  const b = rdpOpen([...p.slice(far), p[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : p.slice();
}

/** Chaikin corner cutting on a closed polygon (each pass doubles the points and rounds corners). */
export function chaikin(p: Pt[], iterations: number): Pt[] {
  let cur = p;
  for (let k = 0; k < iterations && cur.length >= 3; k++) {
    const out: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = out;
  }
  return cur;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon([x, y]: Pt, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest distance between the boundaries of two polygons, with the two closest points. */
export function boundaryDistance(a: Pt[], b: Pt[]): { d: number; pa: Pt; pb: Pt } {
  let best = { d: Infinity, pa: a[0], pb: b[0] };
  const closest = (p: Pt, s0: Pt, s1: Pt): Pt => {
    const dx = s1[0] - s0[0];
    const dy = s1[1] - s0[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - s0[0]) * dx + (p[1] - s0[1]) * dy) / l2)) : 0;
    return [s0[0] + t * dx, s0[1] + t * dy];
  };
  const visit = (P: Pt[], Q: Pt[], flip: boolean) => {
    for (const p of P) {
      for (let j = 0, k = Q.length - 1; j < Q.length; k = j++) {
        const c = closest(p, Q[k], Q[j]);
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < best.d) best = flip ? { d, pa: c, pb: p } : { d, pa: p, pb: c };
      }
    }
  };
  visit(a, b, false);
  visit(b, a, true);
  return best;
}

/** Closest point on a closed polygon's boundary. */
export function nearestOnPolygon(p: Pt, poly: Pt[]): Pt {
  let best: Pt = poly[0];
  let bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** True when the segments of the two polygons cross, or one lies inside the other. */
export function polygonsIntersect(a: Pt[], b: Pt[]): boolean {
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.x1 < bb.x0 || bb.x1 < ba.x0 || ba.y1 < bb.y0 || bb.y1 < ba.y0) return false;
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return true;
  const cross = (o: Pt, p: Pt, q: Pt) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (let i = 0, k = a.length - 1; i < a.length; k = i++) {
    for (let j = 0, l = b.length - 1; j < b.length; l = j++) {
      const d1 = cross(b[l], b[j], a[k]);
      const d2 = cross(b[l], b[j], a[i]);
      const d3 = cross(a[k], a[i], b[l]);
      const d4 = cross(a[k], a[i], b[j]);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

/** Rotate (degrees CCW) then translate. */
export function transformPoints(p: Pt[], dx: number, dy: number, deg: number): Pt[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return p.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy] as Pt);
}
