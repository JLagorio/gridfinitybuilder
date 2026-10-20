import type { Pt } from './image';
import { dedupe } from './polygon';
import type { ImportResult, ImportedShape } from './svg';

/**
 * Minimal DXF outline reader: closed loops from LWPOLYLINE, POLYLINE, CIRCLE,
 * ELLIPSE and SPLINE, plus LINE / ARC / open polylines chained end to end.
 * Units come from $INSUNITS (unitless drawings are assumed to be mm).
 * Output is in mm, y up (DXF's own orientation).
 */

/** $INSUNITS code → mm. */
const INSUNITS: Record<number, number> = {
  1: 25.4,
  2: 304.8,
  3: 1609344,
  4: 1,
  5: 10,
  6: 1000,
  8: 25.4e-6,
  9: 0.0254,
  10: 914.4,
  14: 100,
};

interface Pair {
  code: number;
  value: string;
}

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) throw new Error(`Bad DXF group code on line ${i + 1}.`);
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

/** Segments for an arc of the given angle and radius (in drawing units × mmPerUnit), ~0.4 mm chords. */
function arcSegs(angle: number, rMm: number) {
  return Math.max(4, Math.min(256, Math.ceil((Math.abs(angle) * rMm) / 0.4)));
}

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, k: number, includeStart = true): Pt[] {
  const n = arcSegs(a1 - a0, r * k);
  const out: Pt[] = [];
  for (let s = includeStart ? 0 : 1; s <= n; s++) {
    const t = a0 + ((a1 - a0) * s) / n;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** Points along a polyline with bulges (bulge = tan(θ/4) of the arc to the next vertex). */
function bulgePolyline(verts: { x: number; y: number; bulge: number }[], closed: boolean, k: number): Pt[] {
  const out: Pt[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    out.push([a.x, a.y]);
    if (!closed && i === n - 1) break;
    const b = verts[(i + 1) % n];
    if (!a.bulge) continue;
    const theta = 4 * Math.atan(a.bulge);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 1e-12) continue;
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // Center: from the chord midpoint along the normal.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(a.bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const nx = -(b.y - a.y) / chord;
    const ny = (b.x - a.x) / chord;
    const cx = mx + nx * h;
    const cy = my + ny * h;
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const pts = arcPoints(cx, cy, r, a0, a0 + theta, k, false);
    pts.pop(); // the end point is the next vertex
    out.push(...pts);
  }
  return out;
}

/** de Boor evaluation of a (rational) B-spline. */
function splinePoints(degree: number, knots: number[], ctrl: Pt[], weights: number[], k: number): Pt[] {
  const n = ctrl.length;
  if (n < 2 || knots.length !== n + degree + 1) return ctrl.slice();
  const w = weights.length === n ? weights : ctrl.map(() => 1);
  const t0 = knots[degree];
  const t1 = knots[n];
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
  const steps = Math.max(8, Math.min(2000, Math.ceil((len * k) / 0.4)));
  const out: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = t0 + ((t1 - t0) * s) / steps;
    let span = degree;
    while (span < n - 1 && t >= knots[span + 1]) span++;
    const d: [number, number, number][] = [];
    for (let j = 0; j <= degree; j++) {
      const c = ctrl[span - degree + j];
      const ww = w[span - degree + j];
      d.push([c[0] * ww, c[1] * ww, ww]);
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = span - degree + j;
        const den = knots[i + degree - r + 1] - knots[i];
        const alpha = den ? (t - knots[i]) / den : 0;
        for (let q = 0; q < 3; q++) d[j][q] = (1 - alpha) * d[j - 1][q] + alpha * d[j][q];
      }
    }
    const [X, Y, W] = d[degree];
    out.push([X / W, Y / W]);
  }
  return out;
}

/** Join open pieces whose ends meet (within tol) into closed loops. */
export function chainLoops(pieces: Pt[][], tol: number): { loops: Pt[][]; open: number } {
  const left = pieces.filter((p) => p.length >= 2).map((p) => p.slice());
  const loops: Pt[][] = [];
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  let open = 0;
  while (left.length) {
    const chain = left.shift()!;
    let grew = true;
    while (grew && !near(chain[0], chain[chain.length - 1])) {
      grew = false;
      const end = chain[chain.length - 1];
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        if (near(end, p[0])) chain.push(...p.slice(1));
        else if (near(end, p[p.length - 1])) chain.push(...p.slice(0, -1).reverse());
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (near(chain[0], chain[chain.length - 1]) && chain.length >= 4) loops.push(chain.slice(0, -1));
    else open++;
  }
  return { loops, open };
}

export function parseDXF(text: string, o: { mmPerUnit?: number } = {}): ImportResult {
  const ps = pairs(text);
  const warnings: string[] = [];
  let insunits = 0;
  for (let i = 0; i + 1 < ps.length; i++) {
    if (ps[i].code === 9 && ps[i].value === '$INSUNITS' && ps[i + 1].code === 70) insunits = parseInt(ps[i + 1].value, 10) || 0;
  }
  const known = INSUNITS[insunits];
  const mmPerUnit = o.mmPerUnit ?? known ?? 1;
  const unitsAssumed = o.mmPerUnit === undefined && known === undefined;
  const k = mmPerUnit;

  // Split the ENTITIES section into entities (code 0 starts each).
  let start = -1;
  let end = ps.length;
  for (let i = 0; i + 1 < ps.length; i++) {
    if (ps[i].code === 2 && ps[i].value === 'ENTITIES' && i > 0 && ps[i - 1].code === 0 && ps[i - 1].value === 'SECTION') start = i + 1;
    else if (start >= 0 && ps[i].code === 0 && ps[i].value === 'ENDSEC') {
      end = i;
      break;
    }
  }
  if (start < 0) {
    if (!ps.some((p) => p.code === 0)) throw new Error('Not a DXF file.');
    start = 0;
  }
  const ents: { type: string; g: Pair[] }[] = [];
  for (let i = start; i < end; i++) {
    if (ps[i].code === 0) ents.push({ type: ps[i].value, g: [] });
    else ents[ents.length - 1]?.g.push(ps[i]);
  }

  const shapes: ImportedShape[] = [];
  const pieces: Pt[][] = [];
  const num = (g: Pair[], code: number, def = 0) => {
    const p = g.find((q) => q.code === code);
    return p ? parseFloat(p.value) : def;
  };
  const closedShape = (pts: Pt[], source: string) => {
    const p = dedupe(pts);
    if (p.length >= 3) shapes.push({ points: p.map(([x, y]) => [x * k, y * k] as Pt), source });
  };
  const skipped = new Set<string>();

  for (let e = 0; e < ents.length; e++) {
    const { type, g } = ents[e];
    switch (type) {
      case 'LWPOLYLINE': {
        const closed = (num(g, 70) & 1) === 1;
        const verts: { x: number; y: number; bulge: number }[] = [];
        for (const p of g) {
          if (p.code === 10) verts.push({ x: parseFloat(p.value), y: 0, bulge: 0 });
          else if (p.code === 20 && verts.length) verts[verts.length - 1].y = parseFloat(p.value);
          else if (p.code === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(p.value);
        }
        const pts = bulgePolyline(verts, closed, k);
        if (closed) closedShape(pts, 'LWPOLYLINE');
        else pieces.push(pts);
        break;
      }
      case 'POLYLINE': {
        const closed = (num(g, 70) & 1) === 1;
        const verts: { x: number; y: number; bulge: number }[] = [];
        while (e + 1 < ents.length && ents[e + 1].type === 'VERTEX') {
          const v = ents[++e].g;
          verts.push({ x: num(v, 10), y: num(v, 20), bulge: num(v, 42) });
        }
        if (ents[e + 1]?.type === 'SEQEND') e++;
        const pts = bulgePolyline(verts, closed, k);
        if (closed) closedShape(pts, 'POLYLINE');
        else pieces.push(pts);
        break;
      }
      case 'LINE':
        pieces.push([
          [num(g, 10), num(g, 20)],
          [num(g, 11), num(g, 21)],
        ]);
        break;
      case 'ARC': {
        const a0 = (num(g, 50) * Math.PI) / 180;
        let a1 = (num(g, 51) * Math.PI) / 180;
        while (a1 <= a0) a1 += 2 * Math.PI;
        pieces.push(arcPoints(num(g, 10), num(g, 20), num(g, 40), a0, a1, k));
        break;
      }
      case 'CIRCLE': {
        const pts = arcPoints(num(g, 10), num(g, 20), num(g, 40), 0, 2 * Math.PI, k);
        pts.pop();
        closedShape(pts, 'CIRCLE');
        break;
      }
      case 'ELLIPSE': {
        const cx = num(g, 10);
        const cy = num(g, 20);
        const mx = num(g, 11);
        const my = num(g, 21);
        const ratio = num(g, 40, 1);
        const p0 = num(g, 41, 0);
        let p1 = num(g, 42, 2 * Math.PI);
        while (p1 <= p0) p1 += 2 * Math.PI;
        const a = Math.hypot(mx, my);
        const rot = Math.atan2(my, mx);
        const n = arcSegs(p1 - p0, a * k);
        const pts: Pt[] = [];
        for (let s = 0; s <= n; s++) {
          const t = p0 + ((p1 - p0) * s) / n;
          const ex = a * Math.cos(t);
          const ey = a * ratio * Math.sin(t);
          pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
        }
        if (Math.abs(p1 - p0 - 2 * Math.PI) < 1e-6) {
          pts.pop();
          closedShape(pts, 'ELLIPSE');
        } else pieces.push(pts);
        break;
      }
      case 'SPLINE': {
        const flags = num(g, 70);
        const degree = num(g, 71, 3);
        const knots = g.filter((p) => p.code === 40).map((p) => parseFloat(p.value));
        const weights = g.filter((p) => p.code === 41).map((p) => parseFloat(p.value));
        const ctrl: Pt[] = [];
        const fit: Pt[] = [];
        for (const p of g) {
          if (p.code === 10) ctrl.push([parseFloat(p.value), 0]);
          else if (p.code === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = parseFloat(p.value);
          else if (p.code === 11) fit.push([parseFloat(p.value), 0]);
          else if (p.code === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(p.value);
        }
        const pts = ctrl.length >= 2 ? splinePoints(degree, knots, ctrl, weights, k) : fit;
        const closed = (flags & 1) === 1;
        if (pts.length < 2) break;
        if (closed) closedShape(pts, 'SPLINE');
        else pieces.push(pts);
        break;
      }
      default:
        if (!['VERTEX', 'SEQEND', 'POINT', 'TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'VIEWPORT'].includes(type)) skipped.add(type);
    }
  }

  // Chain loose pieces into loops. Tolerance scales with the drawing.
  const all = pieces.flat();
  let span = 0;
  if (all.length) {
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  const { loops, open } = chainLoops(pieces, Math.max(1e-6, span * 1e-5, 0.01 / k));
  for (const l of loops) closedShape(l, 'LINE/ARC chain');
  if (open) warnings.push(`${open} open outline${open === 1 ? '' : 's'} skipped (ends don't meet).`);
  if (skipped.size) warnings.push(`Ignored: ${[...skipped].join(', ')}.`);
  return { shapes, mmPerUnit, unitsAssumed, warnings };
}
