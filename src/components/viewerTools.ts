/**
 * Tools of the 3D view (cross-section, measure, x-ray, lift bins): their UI state,
 * kept out of the project store on purpose (transient, never saved or undone),
 * and the pure geometry behind them, which the tests cover.
 */
import { create } from 'zustand';

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
export const AXES: Axis[] = ['x', 'y', 'z'];
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The parts of a scene item the helpers need (structurally a SceneItem). */
export interface BoxItem {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotated?: boolean;
  /** Floats up with "Lift bins". */
  lift?: boolean;
}

/** Box of one scene item (footprint min corner + size; rotation swaps w and d), raised by `lift` if it lifts. */
export function itemBox(it: BoxItem, lift = 0): Box {
  const w = it.rotated ? it.d : it.w;
  const d = it.rotated ? it.w : it.d;
  const z = it.z + (it.lift ? lift : 0);
  return { min: [it.x, it.y, z], max: [it.x + w, it.y + d, z + it.h] };
}

/** Bounding box of scene items, with liftable items raised. */
export function itemsBounds(items: BoxItem[], lift = 0): Box | null {
  if (!items.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const it of items) {
    const b = itemBox(it, lift);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Cross-section
// ---------------------------------------------------------------------------

/** A plane as three.js clips with it: points with normal·p + constant < 0 are cut away. */
export interface PlaneSpec {
  normal: Vec3;
  constant: number;
}

/**
 * The section plane through `pos` on `axis`. Unflipped it keeps the side the preset
 * views look at the cut from: below a Z cut (seen from above), behind a Y cut (seen
 * from the front) and left of an X cut (seen from the right).
 */
export function sectionPlane(axis: Axis, pos: number, flip = false): PlaneSpec {
  const i = AXIS_INDEX[axis];
  // Kept: x ≤ pos, y ≥ pos, z ≤ pos.
  const sign = (axis === 'y' ? 1 : -1) * (flip ? -1 : 1);
  const normal: Vec3 = [0, 0, 0];
  normal[i] = sign;
  return { normal, constant: -sign * pos };
}

/** True when the point survives the cut (on the plane counts as kept). */
export function isKept(plane: PlaneSpec, p: Vec3, eps = 1e-6): boolean {
  const [a, b, c] = plane.normal;
  return a * p[0] + b * p[1] + c * p[2] + plane.constant >= -eps;
}

/** Where along `axis` the slider can put the plane: the bounds, pulled in a hair so the end stops still cut. */
export function sectionRange(box: Box, axis: Axis): [number, number] {
  const i = AXIS_INDEX[axis];
  const lo = box.min[i];
  const hi = box.max[i];
  const pad = Math.min(0.05, (hi - lo) / 4);
  return [lo + pad, hi - pad];
}

/**
 * Where a new cut goes: the middle of the range, unless nothing is there (two print
 * plates side by side, say); then the middle of the part nearest to it.
 */
export function defaultSectionPos(boxes: Box[], axis: Axis, range: [number, number]): number {
  const i = AXIS_INDEX[axis];
  const mid = (range[0] + range[1]) / 2;
  if (!boxes.length || boxes.some((b) => b.min[i] < mid && b.max[i] > mid)) return mid;
  let best = mid;
  let bestD = Infinity;
  for (const b of boxes) {
    const c = (b.min[i] + b.max[i]) / 2;
    if (Math.abs(c - mid) < bestD) {
      bestD = Math.abs(c - mid);
      best = c;
    }
  }
  return Math.min(range[1], Math.max(range[0], best));
}

/** A stored position, or `fallback` (the default cut) when there is none or it fell outside (the scene changed). */
export function sectionPos(pos: number | null, range: [number, number], fallback = (range[0] + range[1]) / 2): number {
  const [lo, hi] = range;
  if (pos === null || !Number.isFinite(pos) || pos < lo - 1e-6 || pos > hi + 1e-6) return fallback;
  return pos;
}

/**
 * Placement of a unit square (three.js PlaneGeometry, in its XY plane) so it lies in the
 * section plane and covers the box with a margin on each side: position, Euler rotation
 * (XYZ order) and the size to scale it to.
 */
export function planeFrame(axis: Axis, pos: number, box: Box, margin = 0): { position: Vec3; rotation: Vec3; size: [number, number] } {
  const c: Vec3 = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as Vec3;
  const s: Vec3 = [0, 1, 2].map((k) => box.max[k] - box.min[k] + 2 * margin) as Vec3;
  const position: Vec3 = [...c];
  position[AXIS_INDEX[axis]] = pos;
  if (axis === 'z') return { position, rotation: [0, 0, 0], size: [s[0], s[1]] };
  // Rotating about Y by 90° turns the square's normal to +X; its local x then runs along world Z.
  if (axis === 'x') return { position, rotation: [0, Math.PI / 2, 0], size: [s[2], s[1]] };
  // Rotating about X by 90° turns the normal to -Y; local y then runs along world Z.
  return { position, rotation: [Math.PI / 2, 0, 0], size: [s[0], s[2]] };
}

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

/**
 * Index of the screen point nearest `target` within `radius` pixels, or -1.
 * Used to snap a measure point to a corner of the triangle under the pointer.
 */
export function nearestWithin(target: [number, number], candidates: [number, number][], radius: number): number {
  let best = -1;
  let bestD = radius;
  candidates.forEach((c, i) => {
    const d = Math.hypot(c[0] - target[0], c[1] - target[1]);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

export interface Measurement {
  distance: number;
  /** Absolute differences along each axis. */
  dx: number;
  dy: number;
  dz: number;
}

export function measure(a: Vec3, b: Vec3): Measurement {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const dz = Math.abs(b[2] - a[2]);
  return { distance: Math.hypot(dx, dy, dz), dx, dy, dz };
}

/**
 * "ΔX 10 · ΔY 40 · ΔZ 5 mm" or "ΔX 3/8 · ΔY 1 9/16 · ΔZ 3/16″": the unit once, at the end
 * (" mm" with its space, "″" without). `fmt` formats a length without its unit.
 */
export function deltaSummary(m: Measurement, fmt: (mm: number) => string, unitSuffix: string): string {
  return `ΔX ${fmt(m.dx)} · ΔY ${fmt(m.dy)} · ΔZ ${fmt(m.dz)}${unitSuffix}`;
}

/**
 * Corners of the axis-aligned path from a to b (along X, then Y, then Z), for drawing
 * the ΔX/ΔY/ΔZ legs; legs shorter than `minLen` are dropped.
 */
export function deltaLegs(a: Vec3, b: Vec3, minLen = 1e-3): { axis: Axis; from: Vec3; to: Vec3 }[] {
  const p1: Vec3 = [b[0], a[1], a[2]];
  const p2: Vec3 = [b[0], b[1], a[2]];
  const legs: { axis: Axis; from: Vec3; to: Vec3 }[] = [
    { axis: 'x', from: a, to: p1 },
    { axis: 'y', from: p1, to: p2 },
    { axis: 'z', from: p2, to: b },
  ];
  return legs.filter((l) => Math.abs(l.to[AXIS_INDEX[l.axis]] - l.from[AXIS_INDEX[l.axis]]) >= minLen);
}

// ---------------------------------------------------------------------------
// Lift bins
// ---------------------------------------------------------------------------

export const LIFT_MAX = 60;
export const LIFT_DEFAULT = 30;

/**
 * One frame of the lift animation: an exponential ease toward the target that is
 * frame-rate independent and snaps the last hair so it settles exactly.
 */
export function easeToward(current: number, target: number, dtMs: number, rate = 12): number {
  const k = 1 - Math.exp((-rate * Math.max(0, dtMs)) / 1000);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.02 ? target : next;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SectionState {
  on: boolean;
  axis: Axis;
  /** Plane position along the axis in mm (scene coordinates); null = middle of the scene. */
  pos: number | null;
  flip: boolean;
  /** Show the faint outline of the cutting plane. */
  outline: boolean;
}

interface ViewerToolsState {
  section: SectionState;
  xray: boolean;
  measure: boolean;
  /** Bins float above the baseplate (drawer scene with bins only). */
  liftOn: boolean;
  /** Lift height in mm while lifted. */
  lift: number;
  set(p: Partial<Omit<ViewerToolsState, 'set' | 'setSection'>>): void;
  setSection(p: Partial<SectionState>): void;
}

export const useViewerTools = create<ViewerToolsState>((set) => ({
  section: { on: false, axis: 'z', pos: null, flip: false, outline: true },
  xray: false,
  measure: false,
  liftOn: false,
  lift: LIFT_DEFAULT,
  set: (p) => set(p),
  setSection: (p) => set((s) => ({ section: { ...s.section, ...p } })),
}));
