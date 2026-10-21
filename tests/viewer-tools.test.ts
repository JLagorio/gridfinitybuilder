import { describe, expect, it } from 'vitest';
import {
  LIFT_DEFAULT,
  LIFT_MAX,
  defaultSectionPos,
  deltaLegs,
  deltaSummary,
  easeToward,
  isKept,
  itemBox,
  itemsBounds,
  measure,
  nearestWithin,
  planeFrame,
  sectionPlane,
  sectionPos,
  sectionRange,
  useViewerTools,
  type Axis,
  type Box,
  type Vec3,
} from '../src/components/viewerTools';
import { formatLength } from '../src/lib/units';

const box = (min: Vec3, max: Vec3): Box => ({ min, max });

describe('itemsBounds', () => {
  it('is null for an empty scene', () => {
    expect(itemsBounds([])).toBeNull();
  });

  it('spans footprints and heights; rotation swaps width and depth', () => {
    const b = itemsBounds([
      { x: 0, y: 0, z: 0, w: 84, d: 42, h: 5 },
      { x: 100, y: 10, z: 0, w: 84, d: 42, h: 21, rotated: true },
    ]);
    expect(b).toEqual({ min: [0, 0, 0], max: [142, 94, 21] });
  });

  it('raises only liftable items by the lift', () => {
    const items = [
      { x: 0, y: 0, z: 0, w: 168, d: 126, h: 5 },
      { x: 0.25, y: 0.25, z: 5, w: 83.5, d: 83.5, h: 28, lift: true },
    ];
    expect(itemsBounds(items, 30)).toEqual({ min: [0, 0, 0], max: [168, 126, 63] });
    expect(itemBox(items[0], 30).max[2]).toBe(5);
    expect(itemBox(items[1], 30).min[2]).toBe(35);
  });
});

describe('sectionPlane', () => {
  // Unflipped, the kept side is the one the preset views look at the cut from.
  it.each([
    ['z', [0, 0, 5], [0, 0, 15]],
    ['y', [0, 15, 0], [0, 5, 0]],
    ['x', [5, 0, 0], [15, 0, 0]],
  ] as [Axis, Vec3, Vec3][])('%s at 10 keeps %j, cuts %j; flip swaps them', (axis, keep, cut) => {
    const p = sectionPlane(axis, 10);
    expect(isKept(p, keep)).toBe(true);
    expect(isKept(p, cut)).toBe(false);
    const f = sectionPlane(axis, 10, true);
    expect(isKept(f, keep)).toBe(false);
    expect(isKept(f, cut)).toBe(true);
  });

  it('keeps points on the plane from both sides', () => {
    expect(isKept(sectionPlane('z', 7), [3, 4, 7])).toBe(true);
    expect(isKept(sectionPlane('z', 7, true), [3, 4, 7])).toBe(true);
  });

  it('is a unit normal along the axis, in three.js form (normal·p + constant)', () => {
    const p = sectionPlane('y', 42);
    expect(p.normal).toEqual([0, 1, 0]);
    expect(p.constant).toBe(-42);
    expect(sectionPlane('x', 42).normal).toEqual([-1, 0, 0]);
    expect(sectionPlane('x', 42).constant).toBe(42);
  });
});

describe('section range and position', () => {
  const b = box([0, -10, 0], [168, 116, 40]);

  it('spans the bounds on the axis, pulled in a hair', () => {
    const [lo, hi] = sectionRange(b, 'y');
    expect(lo).toBeCloseTo(-9.95, 6);
    expect(hi).toBeCloseTo(115.95, 6);
    expect(sectionRange(box([0, 0, 0], [1, 1, 0.1]), 'z')[0]).toBeLessThan(sectionRange(box([0, 0, 0], [1, 1, 0.1]), 'z')[1]);
  });

  it('uses the stored position while it is inside the range', () => {
    expect(sectionPos(12, [0, 40])).toBe(12);
    expect(sectionPos(null, [0, 40])).toBe(20);
    // The scene shrank under it: back to the default.
    expect(sectionPos(55, [0, 40])).toBe(20);
    expect(sectionPos(55, [0, 40], 7)).toBe(7);
    expect(sectionPos(Number.NaN, [0, 40])).toBe(20);
  });

  it('cuts through a part by default, even when the middle is empty', () => {
    const plates = [box([0, 0, 0], [256, 256, 5]), box([300, 0, 0], [380, 84, 30]), box([400, 0, 0], [500, 42, 30])];
    // Middle of 0..500 is 250, inside the first plate's part.
    expect(defaultSectionPos(plates, 'x', [0, 500])).toBe(250);
    // Middle of 0..600 is 300... on the edge of the second part: the nearest part centre wins.
    const two = [box([0, 0, 0], [256, 256, 5]), box([344, 0, 0], [600, 84, 30])];
    expect(defaultSectionPos(two, 'x', [0, 600])).toBe(128);
    expect(defaultSectionPos([], 'z', [0, 10])).toBe(5);
  });
});

describe('planeFrame', () => {
  const b = box([0, 0, 0], [100, 60, 20]);

  it('lies flat for a Z cut and covers X × Y', () => {
    const f = planeFrame('z', 12, b, 5);
    expect(f.position).toEqual([50, 30, 12]);
    expect(f.rotation).toEqual([0, 0, 0]);
    expect(f.size).toEqual([110, 70]);
  });

  // A unit square's corners, rotated by the frame, must span the right world axes.
  const rotate = ([x, y, z]: Vec3, [rx, ry]: Vec3): Vec3 => {
    // X then Y rotation (only one is non-zero in these frames).
    const y1 = y * Math.cos(rx) - z * Math.sin(rx);
    const z1 = y * Math.sin(rx) + z * Math.cos(rx);
    return [x * Math.cos(ry) + z1 * Math.sin(ry), y1, -x * Math.sin(ry) + z1 * Math.cos(ry)];
  };

  it.each([
    ['x', 0, [20, 60]],
    ['y', 1, [100, 20]],
  ] as [Axis, number, [number, number]][])('stands upright for an %s cut', (axis, i, size) => {
    const f = planeFrame(axis, 33, b);
    expect(f.position[i]).toBe(33);
    expect(f.size).toEqual(size);
    // The square's normal (local +Z) ends up along the cut axis.
    const n = rotate([0, 0, 1], f.rotation);
    expect(Math.abs(n[i])).toBeCloseTo(1, 9);
    // Its local axes, scaled by size, span the box on the other two axes.
    const ex = rotate([f.size[0], 0, 0], f.rotation).map(Math.abs);
    const ey = rotate([0, f.size[1], 0], f.rotation).map(Math.abs);
    const span = ex.map((v, k) => Math.round(v + ey[k]));
    const want = [100, 60, 20];
    want[i] = 0;
    expect(span).toEqual(want);
  });
});

describe('measure helpers', () => {
  it('snaps to the nearest corner within the radius', () => {
    const corners: [number, number][] = [
      [100, 100],
      [108, 100],
      [140, 140],
    ];
    expect(nearestWithin([105, 101], corners, 12)).toBe(1);
    expect(nearestWithin([101, 100], corners, 12)).toBe(0);
    expect(nearestWithin([120, 120], corners, 12)).toBe(-1);
    expect(nearestWithin([0, 0], [], 12)).toBe(-1);
    // Exactly on the radius still snaps.
    expect(nearestWithin([152, 140], corners, 12)).toBe(2);
  });

  it('measures distance and absolute axis deltas', () => {
    const m = measure([10, 20, 5], [7, 24, 5]);
    expect(m.distance).toBeCloseTo(5, 9);
    expect(m.dx).toBe(3);
    expect(m.dy).toBe(4);
    expect(m.dz).toBe(0);
  });

  it('summarises deltas in the current units with the unit once', () => {
    const m = measure([0, 0, 0], [42, 21, 7]);
    const mm = (v: number) => formatLength(v, 'mm', { unit: false });
    expect(deltaSummary(m, mm, ' mm')).toBe('ΔX 42 · ΔY 21 · ΔZ 7 mm');
    const inch = (v: number) => formatLength(v, 'in', { unit: false });
    expect(deltaSummary(measure([0, 0, 0], [25.4, 12.7, 3.175]), inch, '″')).toBe('ΔX 1 · ΔY 1/2 · ΔZ 1/8″');
  });

  it('draws the delta legs along X, then Y, then Z, skipping empty ones', () => {
    const legs = deltaLegs([0, 0, 0], [10, 0, 5]);
    expect(legs.map((l) => l.axis)).toEqual(['x', 'z']);
    expect(legs[0].to).toEqual([10, 0, 0]);
    expect(legs[1].from).toEqual([10, 0, 0]);
    expect(legs[1].to).toEqual([10, 0, 5]);
    expect(deltaLegs([1, 2, 3], [1, 2, 3])).toEqual([]);
  });
});

describe('lift easing', () => {
  it('moves toward the target, faster with longer frames, and settles exactly', () => {
    const a = easeToward(0, 30, 16);
    const b = easeToward(0, 30, 32);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(30);
    expect(b).toBeGreaterThan(a);
    let v = 0;
    let frames = 0;
    while (v !== 30 && frames < 500) {
      v = easeToward(v, 30, 16);
      frames++;
    }
    expect(v).toBe(30);
    // About half a second at 60 fps.
    expect(frames).toBeLessThan(60);
    // Back down to seated.
    while (v !== 0 && frames < 1000) {
      v = easeToward(v, 0, 16);
      frames++;
    }
    expect(v).toBe(0);
    expect(easeToward(5, 5, 16)).toBe(5);
    expect(easeToward(0, 30, -5)).toBe(0);
  });

  it('has sensible defaults', () => {
    expect(LIFT_DEFAULT).toBeGreaterThan(0);
    expect(LIFT_DEFAULT).toBeLessThanOrEqual(LIFT_MAX);
  });
});

describe('tool state', () => {
  it('merges section changes and starts with every tool off', () => {
    const s = useViewerTools.getState();
    expect(s.section.on).toBe(false);
    expect(s.xray || s.measure || s.liftOn).toBe(false);
    s.setSection({ on: true, axis: 'x' });
    expect(useViewerTools.getState().section).toMatchObject({ on: true, axis: 'x', flip: false, outline: true });
    s.setSection({ on: false });
    expect(useViewerTools.getState().section.axis).toBe('x');
  });
});
