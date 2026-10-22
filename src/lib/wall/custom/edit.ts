/**
 * Editing a custom attachment's side profile (components/ProfileEditor.tsx), as plain functions: snapping a dragged
 * point to the 1 mm grid and its edges to 15° steps, moving a point only where the profile stays usable, adding and
 * removing points with the features on the edges following along.
 */
import type { Vec2 } from '../../geometry/kernel';
import { CUSTOM, edgeFrame, profileProblem, type Feature } from './profile';

/** Within this of a 15° step, an edge snaps to it, degrees; edges shorter than this don't, mm. */
const ANGLE_SNAP = 2.5;
const SHORT = 2;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Where a point dragged to `raw` goes: its edges to its neighbours snap to the nearest 15° when they're within 2.5° of
 * it (both, where the two lines meet near the pointer), else to the 1 mm grid; never behind the board or under the
 * bed, nor above `top`.
 */
export function snapPoint(p: readonly Vec2[], i: number, raw: Vec2, top: number = CUSTOM.tall): Vec2 {
  const n = p.length;
  const step = (15 * Math.PI) / 180;
  const lines: { q: Vec2; u: Vec2 }[] = [];
  for (const q of [p[(i + n - 1) % n], p[(i + 1) % n]]) {
    const dz = raw[0] - q[0];
    const dy = raw[1] - q[1];
    if (Math.hypot(dz, dy) < SHORT) continue;
    const a = Math.atan2(dy, dz);
    const s = Math.round(a / step) * step;
    if (Math.abs(a - s) <= (ANGLE_SNAP * Math.PI) / 180) lines.push({ q, u: [Math.cos(s), Math.sin(s)] });
  }
  const on = ({ q, u }: { q: Vec2; u: Vec2 }): Vec2 => {
    const t = (raw[0] - q[0]) * u[0] + (raw[1] - q[1]) * u[1];
    return [q[0] + u[0] * t, q[1] + u[1] * t];
  };
  let at: Vec2 = [Math.round(raw[0]), Math.round(raw[1])];
  if (lines.length === 2) {
    // Where the two snapped lines cross, if they do near the pointer.
    const [a, b] = lines;
    const den = a.u[0] * b.u[1] - a.u[1] * b.u[0];
    if (Math.abs(den) > 1e-6) {
      const t = ((b.q[0] - a.q[0]) * b.u[1] - (b.q[1] - a.q[1]) * b.u[0]) / den;
      const x: Vec2 = [a.q[0] + a.u[0] * t, a.q[1] + a.u[1] * t];
      if (Math.hypot(x[0] - raw[0], x[1] - raw[1]) < 3) at = x;
      else lines.pop();
    } else lines.pop();
  }
  if (lines.length === 1) {
    const x = on(lines[0]);
    // A line along the grid: on the grid along it too.
    const u = lines[0].u;
    at = Math.abs(u[0]) < 1e-9 ? [x[0], Math.round(x[1])] : Math.abs(u[1]) < 1e-9 ? [Math.round(x[0]), x[1]] : x;
  }
  return [r1(Math.min(CUSTOM.reach, Math.max(0, at[0]))), r1(Math.min(top, Math.max(0, at[1])))];
}

/** The profile with point `i` at `to`; null when that would make it unusable (edges crossing, off the plate, too small). */
export function movePoint(p: readonly Vec2[], i: number, to: Vec2): Vec2[] | null {
  const q = p.map((v, k) => (k === i ? ([...to] as Vec2) : v));
  // Not onto a neighbour.
  const n = q.length;
  for (const k of [(i + n - 1) % n, (i + 1) % n]) if (Math.hypot(q[k][0] - to[0], q[k][1] - to[1]) < 0.5) return null;
  return profileProblem(q) ? null : q;
}

/** Point `i` dragged by (dz, dy) as one move (the arrow keys): snapped to the grid, kept usable; null where it can't go. */
export const nudgePoint = (p: readonly Vec2[], i: number, dz: number, dy: number, top: number = CUSTOM.tall): Vec2[] | null =>
  movePoint(p, i, [r1(Math.min(CUSTOM.reach, Math.max(0, p[i][0] + dz))), r1(Math.min(top, Math.max(0, p[i][1] + dy)))]);

/**
 * A point in the middle of edge `i` (it becomes point i + 1). The features on the edge go to whichever half their
 * middle is on; those on later edges move along with their edges.
 */
export function addPoint(p: readonly Vec2[], features: readonly Feature[], i: number): { profile: Vec2[]; features: Feature[] } | null {
  if (p.length >= CUSTOM.points) return null;
  const a = p[i];
  const b = p[(i + 1) % p.length];
  const mid: Vec2 = [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)];
  const profile = [...p.slice(0, i + 1), mid, ...p.slice(i + 1)];
  if (profileProblem(profile)) return null;
  const { len } = edgeFrame(a, b);
  return {
    profile,
    features: features.map((f) => {
      if (f.f > i) return { ...f, f: f.f + 1 };
      if (f.f !== i) return f;
      // Its middle along the old edge, on the half it's in.
      return f.v < 0 ? { ...f, v: r1(f.v + len / 4) } : { ...f, f: i + 1, v: r1(f.v - len / 4) };
    }),
  };
}

/** Point `i` taken out (a profile keeps three at least): its two edges become one, with the features of both. */
export function removePoint(p: readonly Vec2[], features: readonly Feature[], i: number): { profile: Vec2[]; features: Feature[] } | null {
  const n = p.length;
  if (n <= 3) return null;
  const profile = p.filter((_, k) => k !== i);
  if (profileProblem(profile)) return null;
  // Edge k ran from point k to k + 1: the two either side of i merge into the one from i − 1.
  const edge = (k: number) => (i === 0 ? (k === 0 || k === n - 1 ? n - 2 : k - 1) : k === i ? i - 1 : k > i ? k - 1 : k);
  return { profile, features: features.map((f) => (f.f < 0 ? f : { ...f, f: edge(f.f) })) };
}
