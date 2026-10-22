/**
 * Traced tools on the wall: the outlines shadow boards (./shadowBoard.ts) and
 * tool holders (./toolCradle.ts) are made from, traced from a photo on a sheet
 * of paper or imported from an SVG or DXF file (components/TraceDialog.tsx),
 * or taken from the tool library. Each is kept in the attachment's options in
 * the bins' pocket format (geometry/cutouts.ts BinCutout): its outline in mm,
 * counter-clockwise round the centre of its bounding box, its thickness and
 * the clearance round it, where it was in the photo or file (x, y) and a turn
 * of its own; on a shadow board, what holds it too.
 *
 * Options travel in the project file and in share links, so an outline is
 * simplified to at most TRACED.points points on a 0.1 mm grid (well under
 * the 0.4 mm line a nozzle draws) and a board takes at most TRACED.tools of
 * them: a full board is about 40 kB of project, a few tools a few kB of link.
 *
 * Plain math (front view, mm), shared with the geometry and the form.
 */
import type { Vec2 } from '../../geometry/kernel';
import { autoNotches, type BinCutout } from '../../geometry/cutouts';
import { bounds, dedupe, nearestOnPolygon, pointInPolygon, polygonsIntersect, signedArea, simplifyClosed } from '../../trace/polygon';
import { num, obj, pick, str } from '../registry';

/** What holds a tool on a shadow board: two pegs under it, a ledge round its bottom, or magnets in its shadow. */
export const HOLDS = ['pegs', 'ledge', 'magnets', 'none'] as const;
export type Hold = (typeof HOLDS)[number];

/** A traced tool as an attachment keeps it: the bins' pocket format, and what holds it. */
export type TracedTool = Pick<BinCutout, 'toolId' | 'name' | 'outline' | 'depth' | 'clearance' | 'x' | 'y' | 'rotation'> & { hold: Hold };

/** What the trace dialog gives back: an outline in mm (y up, anywhere), its name, thickness and clearance. */
export interface TracedOutline {
  name: string;
  outline: Vec2[];
  depth: number;
  clearance: number;
}

/** Most tools a board keeps, most points an outline keeps, the grid they're on and the largest tool, mm. */
export const TRACED = { tools: 12, points: 300, grid: 0.1, size: 400 } as const;

const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * An outline cleaned for keeping: finite points, simplified to TRACED.points, counter-clockwise, on the 0.1 mm grid
 * round the centre of its bounding box, which is (cx, cy). One already round the origin stays put, so cleaning
 * twice changes nothing. Null when it isn't a shape (fewer than three points, or less than 2 mm either way).
 */
export function cleanOutline(raw: unknown): { outline: Vec2[]; cx: number; cy: number } | null {
  if (!Array.isArray(raw)) return null;
  let p: Vec2[] = [];
  for (const q of raw.slice(0, 50000)) {
    if (!Array.isArray(q)) continue;
    const x = Number(q[0]);
    const y = Number(q[1]);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e5 && Math.abs(y) < 1e5) p.push([x, y]);
  }
  p = dedupe(p);
  if (p.length < 3) return null;
  for (let eps = 0.05; p.length > TRACED.points && eps < 100; eps *= 2) p = simplifyClosed(p, eps);
  if (p.length > TRACED.points) return null;
  const b = bounds(p);
  if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 2 || b.x1 - b.x0 > TRACED.size || b.y1 - b.y0 > TRACED.size) return null;
  const mx = (b.x0 + b.x1) / 2;
  const my = (b.y0 + b.y1) / 2;
  const [cx, cy] = Math.abs(mx) <= 0.1 && Math.abs(my) <= 0.1 ? [0, 0] : [r1(mx), r1(my)];
  let outline = dedupe(p.map(([x, y]) => [r1(x - cx), r1(y - cy)] as Vec2));
  if (signedArea(outline) < 0) outline = outline.reverse();
  return outline.length >= 3 && Math.abs(signedArea(outline)) >= 4 ? { outline, cx, cy } : null;
}

/** Saved or traced tools, cleaned: at most `max` (a new tool's outline anywhere: its centre becomes its x, y). */
export function cleanTraced(raw: unknown, max: number = TRACED.tools): TracedTool[] {
  if (!Array.isArray(raw)) return [];
  const out: TracedTool[] = [];
  for (const v of raw) {
    if (out.length >= max) break;
    const r = obj(v);
    const c = cleanOutline(r.outline);
    if (!c) continue;
    const turn = num(r.rotation, -1e6, 1e6, 0) % 360;
    out.push({
      toolId: str(r.toolId, 40),
      name: str(r.name, 40).trim() || 'Tool',
      outline: c.outline,
      depth: r1(num(r.depth, 0.5, 60, 10)),
      clearance: Math.round(num(r.clearance, 0, 5, 1) * 20) / 20,
      x: r1(num(r.x, -2000, 2000, 0) + c.cx),
      y: r1(num(r.y, -2000, 2000, 0) + c.cy),
      rotation: r1(turn < 0 ? turn + 360 : turn) % 360,
      hold: pick(r.hold, HOLDS, 'pegs'),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outline math
// ---------------------------------------------------------------------------

/** Points turned `deg` counter-clockwise round the origin. */
export function turned(p: Vec2[], deg: number): Vec2[] {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return p.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2);
}

/** Points moved so the centre of their bounding box is at the origin. */
export function centred(p: Vec2[]): Vec2[] {
  const b = bounds(p);
  const mx = (b.x0 + b.x1) / 2;
  const my = (b.y0 + b.y1) / 2;
  return p.map(([x, y]) => [x - mx, y - my] as Vec2);
}

/** The turn (whole degrees) that stands an outline's long side up (`up`) or lays it across: its narrowest (or lowest) bounding box, a square turn when it costs little. */
export function longTurn(p: Vec2[], up: boolean): number {
  let best = 0;
  let least = Infinity;
  for (let a = 0; a < 180; a++) {
    const b = bounds(turned(p, a));
    const v = (up ? b.x1 - b.x0 : b.y1 - b.y0) * (a % 90 === 0 ? 0.97 : 1);
    if (v < least - 1e-9) {
      least = v;
      best = a;
    }
  }
  return best;
}

/** Where a horizontal (`axis` 1) or vertical (`axis` 0) line at `at` crosses the outline, sorted. */
function crossings(p: Vec2[], at: number, axis: 0 | 1): number[] {
  const o = 1 - axis;
  const out: number[] = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j];
    const b = p[i];
    if (a[axis] > at !== b[axis] > at) out.push(a[o] + ((at - a[axis]) / (b[axis] - a[axis])) * (b[o] - a[o]));
  }
  return out.sort((u, v) => u - v);
}

/** The outline's lowest point straight down at `x`, or null where it isn't over x. */
export function lowestAt(p: Vec2[], x: number): number | null {
  const c = crossings(p, x, 0);
  return c.length ? c[0] : null;
}

/** Its area above and below the line y = `y`. */
function areaSplit(p: Vec2[], y: number): { up: number; down: number } {
  const b = bounds(p);
  const n = 48;
  const out = { up: 0, down: 0 };
  for (let k = 0; k < n; k++) {
    const yy = b.y0 + ((k + 0.5) * (b.y1 - b.y0)) / n;
    const c = crossings(p, yy, 1);
    let len = 0;
    for (let i = 0; i + 1 < c.length; i += 2) len += c[i + 1] - c[i];
    out[yy > y ? 'up' : 'down'] += (len * (b.y1 - b.y0)) / n;
  }
  return out;
}

/** The turn that stands a tool up with its heavier end (a handle, a hammer's head) at the top: tools hang that way. */
export function uprightTurn(p: Vec2[]): number {
  const a = longTurn(p, true);
  const s = areaSplit(centred(turned(p, a)), 0);
  return s.down > s.up * 1.05 ? a + 180 : a;
}

/** The centre of its area. */
export function centroid(p: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f;
    cx += (p[j][0] + p[i][0]) * f;
    cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = bounds(p);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Where pegs hold an outline (its frame): the middle of each one's top, under an edge of the outline that faces
 * down, the peg (`w` wide, reaching `below` down under its top) `gap` clear of the outline everywhere. One either
 * side of the outline's centre, each as high as it goes with a pull toward the ends: a screwdriver's straddle its
 * shaft under the handle, an upright wrench's its shaft under the top head, a lying one's sit under its shaft by the
 * heads. Tools hang best with as much of them as can be below the pegs. One under the middle when it's too narrow for two.
 */
export function pegSpots(p: Vec2[], w: number, gap: number, below: number): { x: number; y: number }[] {
  const b = bounds(p);
  const [cx] = centroid(p);
  // The peg and its gusset, `gap` round, clear of the outline (touching it at the top is fine: the tool rests there).
  const clear = (x: number, y: number) => {
    const x0 = x - w / 2 - gap + 0.05;
    const x1 = x + w / 2 + gap - 0.05;
    const y0 = y - below - gap + 0.05;
    const y1 = y + gap - 0.05;
    return !polygonsIntersect(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      p,
    );
  };
  const side = (dir: -1 | 1) => {
    let best: { x: number; y: number } | null = null;
    let score = -Infinity;
    for (let x = cx + dir * (w / 2 + 1); dir < 0 ? x >= b.x0 + w / 2 : x <= b.x1 - w / 2; x += dir) {
      // The bottoms of the stretches of outline straight above x: under each, as high as it's clear (an edge
      // sloping across the peg's width puts it a little lower).
      const c = crossings(p, x, 0);
      for (let k = 0; k < c.length; k += 2) {
        for (let n = 0, y = c[k] - gap; n < 12; n++, y -= 0.5) {
          if (!clear(x, y)) continue;
          const v = y + 0.25 * Math.abs(x - cx);
          if (v > score) {
            score = v;
            best = { x: r1(x), y: r1(y) };
          }
          break;
        }
      }
    }
    return best;
  };
  const l = side(-1);
  const r = side(1);
  if (l && r) return [l, r];
  const low = lowestAt(p, cx) ?? b.y0;
  return [{ x: r1(cx), y: r1(Math.min(low, ...p.filter(([x]) => Math.abs(x - cx) < w / 2 + gap).map(([, y]) => y)) - gap) }];
}

/**
 * Where magnets `d` across go in an outline (its frame): each at least `inset` in from its edge, one as far from the
 * middle as there's room and the other as far from that one; one when they'd be closer than two magnets apart, none
 * when it's too narrow.
 */
export function magnetSpots(p: Vec2[], d: number, inset: number): Vec2[] {
  const b = bounds(p);
  const r = d / 2 + inset;
  const step = Math.max(1, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 80);
  const ok: Vec2[] = [];
  for (let x = b.x0 + r; x <= b.x1 - r + 1e-9; x += step) {
    for (let y = b.y0 + r; y <= b.y1 - r + 1e-9; y += step) {
      const q: Vec2 = [x, y];
      if (!pointInPolygon(q, p)) continue;
      const n = nearestOnPolygon(q, p);
      if (Math.hypot(n[0] - x, n[1] - y) >= r - 1e-9) ok.push(q);
    }
  }
  if (!ok.length) return [];
  const far = (from: Vec2) => ok.reduce((a, q) => (Math.hypot(q[0] - from[0], q[1] - from[1]) > Math.hypot(a[0] - from[0], a[1] - from[1]) ? q : a));
  const a = far(centroid(p));
  const c = far(a);
  return Math.hypot(c[0] - a[0], c[1] - a[1]) >= 2 * d + 4 ? [a, c] : [a];
}

/** Finger notches for an outline (its frame): the bins' own, at the middle of its long sides. */
export const notchSpots = (p: Vec2[]): Vec2[] => autoNotches(p);

/** A stand-in tool (a 120 × 24 mm bar with round ends) for a holder with none traced yet. */
export const PLACEHOLDER: TracedTool = {
  toolId: '',
  name: 'Tool',
  outline: Array.from({ length: 24 }, (_, k) => {
    const a = (k < 12 ? -Math.PI / 2 : Math.PI / 2) + ((k % 12) / 11) * Math.PI;
    return [r1((k < 12 ? 48 : -48) + 12 * Math.cos(a)), r1(12 * Math.sin(a))] as Vec2;
  }),
  depth: 8,
  clearance: 1,
  x: 0,
  y: 0,
  rotation: 0,
  hold: 'pegs',
};
