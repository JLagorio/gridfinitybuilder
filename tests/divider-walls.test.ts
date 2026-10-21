/**
 * Divider walls: finger notches, shaped tops, diagonal / curved walls,
 * mirror / rotate, and copying layouts between bins.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import {
  DEFAULT_BIN,
  binInnerSize,
  binKey,
  binSize,
  buildBin,
  buildDividerInsert,
  insertKey,
  removableInserts,
  sanitizeBin,
  type BinOptions,
} from '../src/lib/geometry/bin';
import { DIVIDER, HEIGHT_UNIT, LIP_SUPPORT_HEIGHT, WALL } from '../src/lib/geometry/spec';
import { defaultNotch, fitNotch, topProfile } from '../src/lib/geometry/wallExtras';
import {
  EDGE,
  MIN_FREE_WALL,
  PRESETS,
  addFreeWall,
  addWall,
  compartmentAt,
  fitLayout,
  freeWallAt,
  freeWallMeasure,
  freeWallMid,
  freeWallOutline,
  freeWallShape,
  layoutKey,
  makeWall,
  mirrorLayout,
  moveWall,
  removeFreeWall,
  removeWall,
  resolveFreeWalls,
  resolveLayout,
  rotateLayout,
  sanitizeLayout,
  setAllWallProps,
  setCompartmentOptions,
  setWallProps,
  snapPoint,
  uniformLayout,
  updateFreeWall,
  wallSpans,
  type DividerLayout,
  type DividerWall,
  type InnerSize,
} from '../src/lib/dividers';
import { allDrawers, history, useStore } from '../src/state/store';

const T = DIVIDER;
const inner = (ux: number, uy: number): InnerSize => binInnerSize({ unitsX: ux, unitsY: uy });
const resolveIn = (l: DividerLayout, s: InnerSize) => resolveLayout(l, s.w, s.d);
const v = (id: string, t: number, o: Partial<DividerWall> = {}): DividerWall => ({
  id,
  orient: 'v',
  lo: EDGE,
  hi: EDGE,
  pos: { kind: 'ratio', t },
  start: EDGE,
  end: EDGE,
  ...o,
});
const h = (id: string, t: number, o: Partial<DividerWall> = {}): DividerWall => ({ ...v(id, t, o), orient: 'h', ...o });

/** Deep equality with a numeric tolerance. */
function expectClose(a: unknown, b: unknown, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThan(1e-9);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    expect(ka, path).toEqual(Object.keys(b as object).sort());
    for (const k of ka) expectClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

/** A layout with a bit of everything: ratio and exact walls, an L corner, options, a free wall. */
function sample(size: InnerSize): DividerLayout {
  let l: DividerLayout = {
    walls: [
      v('a', 1 / 3),
      v('b', 0, { lo: 'a', pos: { kind: 'exact', mm: 20, from: 'hi' }, end: 'c' }),
      h('c', 0.6, { lo: EDGE, hi: EDGE, start: 'a' }),
      h('d', 0, { lo: EDGE, hi: 'c', pos: { kind: 'exact', mm: 12, from: 'lo' }, end: 'a' }),
    ],
  };
  l = setWallProps(l, 'a', { notch: { width: 18, depth: 6 }, top: 'round' });
  const r = resolveIn(l, size);
  for (const [k, c] of r.compartments.entries()) l = setCompartmentOptions(l, c.key, { scoop: (k + 1) / 10, labelText: `C${k}` });
  return addFreeWall(l, size, [size.w * 0.4, size.d * 0.1], [size.w * 0.9, size.d * 0.5], 6)!.layout;
}

// ---------------------------------------------------------------------------
// Data model: sanitize, keys
// ---------------------------------------------------------------------------

describe('sanitize and keys', () => {
  it('cleans notches, tops and free walls; idempotent', () => {
    const dirty = {
      walls: [
        { ...v('x1', 0.5), notch: { width: '20', depth: 8 }, top: 'round' },
        { ...h('y1', 0.5), notch: { width: 0, depth: 5 }, top: 'flat' },
        { ...h('y2', 0.25), notch: 'deep', top: 'spiky' },
      ],
      free: [
        { id: 'x1', a: [-1, 0.5], b: [2, 'x'], bend: 'nope', lower: -3 },
        { id: 'f9', a: [0.2, 0.2], b: [0.2, 0.2] },
        { a: [0.1, 0.9], b: [0.8, 0.123456789], bend: 12.3456, lower: 4 },
        null,
        { id: 'f3', a: [0.5] },
      ],
    };
    const l = sanitizeLayout(dirty)!;
    expect(l.walls[0].notch).toEqual({ width: 20, depth: 8 });
    expect(l.walls[0].top).toBe('round');
    expect(l.walls[1]).not.toHaveProperty('notch');
    expect(l.walls[1]).not.toHaveProperty('top');
    expect(l.walls[2]).not.toHaveProperty('notch');
    expect(l.walls[2]).not.toHaveProperty('top');
    expect(l.free).toEqual([
      { id: 'x1_2', a: [0, 0.5], b: [1, 0] },
      { id: 'f3', a: [0.1, 0.9], b: [0.8, 0.123457], bend: 12.35, lower: 4 },
    ]);
    expect(sanitizeLayout(l)).toEqual(l);
    expect(sanitizeLayout({ walls: [], free: 'nope' })).toEqual({ walls: [] });
  });

  it('layouts without the new fields keep their exact keys', () => {
    // Recorded before notches, tops and free walls existed.
    let l: DividerLayout = setWallProps(uniformLayout(3, 2), 'x1', { lower: 5 });
    l = setWallProps(l, 'y1', { removable: true });
    l = { ...l, walls: l.walls.map((w) => (w.id === 'x2' ? { ...w, pos: { kind: 'exact', mm: 12.5, from: 'hi' } } : w)) };
    const r = resolveLayout(l, 124.6, 79.6);
    l = setCompartmentOptions(l, r.compartments[0].key, { scoop: 0.5, label: 'left', floor: 3, labelText: 'M3' });
    expect(layoutKey(sanitizeLayout(l))).toBe(
      'x1:v:edge:edge:r0.3333333:edge:edge:5:;x2:v:x1:edge:ehi12.5:edge:edge:0:;y1:h:edge:edge:r0.5:edge:edge:0:R|^F,^L,x1<,y1<=0.5/left/3/"M3"',
    );
    const o: BinOptions = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, layout: l };
    expect(binKey(o)).toBe(
      '3-2-3-L-none-1-1-0-none-F-D{x1:v:edge:edge:r0.3333333:edge:edge:5:;x2:v:x1:edge:ehi12.5:edge:edge:0:;y1:h:edge:edge:r0.5:edge:edge:0:R|^F,^L,x1<,y1<=0.5/left/3/"M3"}-Traised',
    );
    expect(removableInserts(o).map(insertKey)).toEqual(['insert|38.25x13.6x1.2', 'insert|67.8x13.6x1.2', 'insert|10.35x13.6x1.2']);
    const presets: Record<string, string> = {
      halves: 'p1:v:edge:edge:r0.5:edge:edge:0:|',
      'big-3-small': 'p1:h:edge:edge:r0.3333333:edge:edge:0:;p2:v:edge:edge:r0.3333333:edge:p1:0:;p3:v:p2:edge:r0.5:edge:p1:0:|',
      'tool-tray': 'p1:v:edge:edge:r0.25:edge:edge:0:;p2:h:edge:edge:r0.5:p1:edge:0:|',
    };
    for (const p of PRESETS.filter((x) => presets[x.id])) {
      expect(binKey({ ...DEFAULT_BIN, unitsX: 2, unitsY: 2, layout: p.layout })).toBe(`2-2-3-L-none-1-1-0-none-F-D{${presets[p.id]}}`);
    }
    // A flat top is the same as none.
    expect(layoutKey(sanitizeLayout(setWallProps(l, 'x1', { top: 'flat' })))).toBe(layoutKey(sanitizeLayout(l)));
  });

  it('notch, top and free walls reach the bin key', () => {
    const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, layout: uniformLayout(2, 2) };
    const s = inner(2, 2);
    const keys = new Set([
      binKey(o),
      binKey({ ...o, layout: setWallProps(o.layout!, 'x1', { notch: { width: 20, depth: 5 } }) }),
      binKey({ ...o, layout: setWallProps(o.layout!, 'x1', { notch: { width: 20, depth: 6 } }) }),
      binKey({ ...o, layout: setWallProps(o.layout!, 'x1', { top: 'chamfer' }) }),
      binKey({ ...o, layout: setWallProps(o.layout!, 'x1', { top: 'round' }) }),
      binKey({ ...o, layout: addFreeWall(o.layout!, s, [1, 1], [30, 30])!.layout }),
      binKey({ ...o, layout: addFreeWall(o.layout!, s, [1, 1], [30, 30], 5)!.layout }),
      binKey({ ...o, layout: updateFreeWall(addFreeWall(o.layout!, s, [1, 1], [30, 30])!.layout, s, 'f1', { lower: 4 }) }),
    ]);
    expect(keys.size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Free walls, spans, snapping (pure)
// ---------------------------------------------------------------------------

describe('free walls', () => {
  const s = inner(2, 2); // 81.6 × 81.6

  it('resolve from cavity fractions, survive resizing, drop degenerate ones', () => {
    const l = addFreeWall({ walls: [] }, s, [0, 0], [s.w, s.d / 2])!.layout;
    expect(l.free).toEqual([{ id: 'f1', a: [0, 0], b: [1, 0.5] }]);
    const big = inner(4, 2);
    const [f] = resolveFreeWalls(l, big.w, big.d);
    expect(f.b).toEqual([big.w, big.d / 2]);
    expect(f.length).toBeCloseTo(Math.hypot(big.w, big.d / 2), 9);
    expect(addFreeWall({ walls: [] }, s, [10, 10], [11, 11])).toBeNull();
    expect(resolveFreeWalls({ walls: [], free: [{ id: 'z', a: [0.5, 0.5], b: [0.5, 0.51] }] }, s.w, s.d)).toEqual([]);
    expect(MIN_FREE_WALL).toBeGreaterThan(0);
  });

  it('arcs: sagitta, length, apex, clamped to a half circle', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [40, 0];
    const st = freeWallShape(a, b, 10);
    const R = (20 * 20 + 10 * 10) / 20; // 25
    expect(st.arc!.r).toBeCloseTo(R, 9);
    expect(st.length).toBeCloseTo(R * 2 * Math.asin(20 / R), 9);
    expect(freeWallMid({ a, b, arc: st.arc })).toEqual([expect.closeTo(20, 9), expect.closeTo(10, 9)]);
    // Bulges left of a → b (here: +y); negative to the right.
    expect(Math.min(...freeWallShape(a, b, -10).path.map((p) => p[1]))).toBeCloseTo(-10, 6);
    const half = freeWallShape(a, b, 100);
    expect(half.bend).toBe(20);
    expect(half.length).toBeCloseTo(Math.PI * 20, 9);
    expect(freeWallShape(a, b, 0.001).path).toEqual([a, b]);
    expect(freeWallMeasure([0, 0], [0, 10]).angle).toBeCloseTo(90, 9);
    expect(freeWallMeasure([10, 10], [0, 0]).angle).toBeCloseTo(45, 9);
  });

  it('outline is a closed CCW band T wide with round ends', () => {
    for (const bend of [0, 8, -15]) {
      const sh = freeWallShape([5, 5], [45, 25], bend);
      const ring = freeWallOutline(sh);
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        area += x0 * y1 - x1 * y0;
      }
      area /= 2;
      expect(area).toBeGreaterThan(0);
      expect(area).toBeCloseTo(sh.length * T + Math.PI * (T / 2) ** 2, 0);
    }
  });

  it('hit testing, edits keep free walls, delete', () => {
    let l = addFreeWall(uniformLayout(2, 1), s, [0, 0], [s.w, s.d])!.layout;
    const r = resolveIn(l, s);
    expect(freeWallAt(r, 20, 20)?.id).toBe('f1');
    expect(freeWallAt(r, 20, 22)).toBeNull();
    // Straight-wall edits carry the free walls along.
    const R = resolveIn(l, s);
    const w = makeWall(l, 'h', s.d / 2, { lo: { ref: EDGE, pos: -T / 2 }, hi: { ref: EDGE, pos: s.d + T / 2 } }, { start: EDGE, end: 'x1' });
    l = addWall(l, s, w);
    l = moveWall(l, s, 'x1', R.byId.get('x1')!.pos + 5);
    l = removeWall(l, s, w.id);
    l = setAllWallProps(l, { top: 'chamfer' });
    expect(l.free).toHaveLength(1);
    expect(removeFreeWall(l, 'f1')).not.toHaveProperty('free');
    expect(addFreeWall(l, s, [1, 1], [20, 1])!.id).toBe('f2');
  });

  it('wall spans split at crossing and meeting walls', () => {
    const r = resolveIn(uniformLayout(2, 2), s);
    const sp = wallSpans(r, 'x1');
    expect(sp).toHaveLength(2);
    expect(sp[0]).toEqual({ a: 0, b: expect.closeTo(s.d / 2 - T / 2, 9), aEdge: true, bEdge: false });
    expect(sp[1].b - sp[1].a).toBeCloseTo(s.d / 2 - T / 2, 9);
    // A T junction from one side also splits it.
    const t = resolveIn({ walls: [h('y1', 0.5), v('x1', 0.5, { end: 'y1' })] }, s);
    expect(wallSpans(t, 'y1')).toHaveLength(2);
    expect(wallSpans(t, 'x1')).toHaveLength(1);
  });

  it('notch sizes clamp to the room they have', () => {
    expect(defaultNotch(30)).toEqual({ width: 20, depth: 12 });
    expect(fitNotch({ width: 20, depth: 12 }, 40, 30)).toEqual({ width: 20, depth: 12 });
    expect(fitNotch({ width: 20, depth: 50 }, 12, 30)).toEqual({ width: 10, depth: 29 });
    expect(fitNotch({ width: 20, depth: 5 }, 4, 30)).toBeNull();
    expect(topProfile('flat')).toEqual([]);
    expect(topProfile('chamfer')).toHaveLength(2);
  });

  it('point snapping: corners, ends, quarter points, edges, 15° steps, Alt', () => {
    const r = resolveIn(uniformLayout(2, 1), s); // x1 down the middle
    const o = { tolerance: 1.5, step: 0.5 };
    expect(snapPoint(r, 0.6, 0.7, o)).toMatchObject({ x: 0, y: 0, kind: 'corner' });
    expect(snapPoint(r, s.w / 2 + 0.4, s.d - 0.3, o)).toMatchObject({ x: expect.closeTo(s.w / 2, 9), y: s.d, kind: 'end' });
    expect(snapPoint(r, s.w / 2 + 0.5, s.d / 4 + 0.5, o)).toMatchObject({ x: expect.closeTo(s.w / 2, 9), y: s.d / 4, label: '25%' });
    expect(snapPoint(r, s.w / 2 - 0.3, s.d / 2 + 0.2, o)).toMatchObject({ x: expect.closeTo(s.w / 2, 9), y: s.d / 2, kind: 'mid' });
    expect(snapPoint(r, 0.8, 30.3, o)).toMatchObject({ x: 0, y: 30.3, kind: 'edge' });
    expect(snapPoint(r, s.w / 2 + 0.8, 33, o)).toMatchObject({ x: expect.closeTo(s.w / 2, 9), y: expect.closeTo(33, 9), kind: 'on-wall' });
    expect(snapPoint(r, 10.3, 20.2, o)).toMatchObject({ x: 10.5, y: 20, kind: 'step' });
    expect(snapPoint(r, 10.3, 20.2, { ...o, free: true })).toMatchObject({ x: 10.3, y: 20.2, kind: 'free' });
    expect(snapPoint(r, -5, 200, { ...o, free: true })).toMatchObject({ x: 0, y: s.d });
    const c = snapPoint(r, 30, 18, { ...o, from: [10, 10], constrain: true });
    expect(c.kind).toBe('angle');
    expect(c.label).toBe('15°');
    expect(Math.atan2(c.y - 10, c.x - 10)).toBeCloseTo(Math.PI / 12, 9);
    // Lining up with the other end, and where that line meets a wall (only where the wall is).
    expect(snapPoint(r, 10.6, 30, { ...o, from: [10, 10] })).toMatchObject({ x: 10, y: 30, label: '90°' });
    const t = resolveIn({ walls: [v('x1', 0.5), h('y1', 0.5, { end: 'x1' })] }, s);
    expect(snapPoint(t, 15.3, s.d / 2 + 0.8, { ...o, from: [15, 10] })).toMatchObject({ x: 15, y: expect.closeTo(s.d / 2, 9), label: 'on wall · 90°' });
    expect(snapPoint(t, 60.3, s.d / 2 + 0.8, { ...o, from: [60, 10] })).toMatchObject({ x: 60, kind: 'axis' });
  });
});

// ---------------------------------------------------------------------------
// Mirror / rotate / fit
// ---------------------------------------------------------------------------

describe('mirror and rotate', () => {
  const sq = inner(2, 2);
  const rect = inner(3, 2);

  it('mirroring twice is the identity (walls, options, free walls)', () => {
    for (const size of [sq, rect]) {
      const l = sample(size);
      for (const axis of ['x', 'y'] as const) expectClose(mirrorLayout(mirrorLayout(l, axis, size), axis, size), l);
    }
  });

  it('rotating four times is the identity', () => {
    for (const size of [sq, rect]) {
      const l = sample(size);
      let r = l;
      for (let k = 0; k < 4; k++) r = rotateLayout(r, size.w, size.d);
      expectClose(r, l);
      expect(layoutKey(sanitizeLayout(r))).toBe(layoutKey(sanitizeLayout(l)));
    }
  });

  it('mirror x reflects every wall and free wall', () => {
    const l = sample(rect);
    const a = resolveIn(l, rect);
    const b = resolveIn(mirrorLayout(l, 'x', rect), rect);
    expect(b.walls.map((w) => w.id).sort()).toEqual(a.walls.map((w) => w.id).sort());
    for (const W of a.walls) {
      const M = b.byId.get(W.id)!;
      if (W.orient === 'v') {
        expect(M.pos).toBeCloseTo(rect.w - W.pos, 6);
        expect([M.start, M.end]).toEqual([expect.closeTo(W.start, 6), expect.closeTo(W.end, 6)]);
      } else {
        expect(M.pos).toBeCloseTo(W.pos, 6);
        expect([M.start, M.end]).toEqual([expect.closeTo(rect.w - W.end, 6), expect.closeTo(rect.w - W.start, 6)]);
      }
    }
    const [f0] = a.free;
    const [f1] = b.free;
    expect(f1.a[0]).toBeCloseTo(rect.w - f0.a[0], 6);
    expect(f1.bend).toBeCloseTo(-f0.bend, 9);
    const m0 = freeWallMid(f0);
    const m1 = freeWallMid(f1);
    expect(m1[0]).toBeCloseTo(rect.w - m0[0], 6);
    expect(m1[1]).toBeCloseTo(m0[1], 6);
    // Notch and top come along.
    expect(mirrorLayout(l, 'y', rect).walls.find((w) => w.id === 'a')).toMatchObject({ notch: { width: 18, depth: 6 }, top: 'round' });
  });

  it('rotate turns a square layout a quarter turn clockwise', () => {
    const l = sample(sq);
    const a = resolveIn(l, sq);
    const b = resolveIn(rotateLayout(l, sq.w, sq.d), sq);
    const S = sq.w;
    for (const W of a.walls) {
      const R = b.byId.get(W.id)!;
      expect(R.orient).not.toBe(W.orient);
      // (x, y) → (y, S − x)
      if (W.orient === 'v') {
        expect(R.pos).toBeCloseTo(S - W.pos, 6);
        expect([R.start, R.end]).toEqual([expect.closeTo(W.start, 6), expect.closeTo(W.end, 6)]);
      } else {
        expect(R.pos).toBeCloseTo(W.pos, 6);
        expect([R.start, R.end]).toEqual([expect.closeTo(S - W.end, 6), expect.closeTo(S - W.start, 6)]);
      }
    }
    expect(b.free[0].a[0]).toBeCloseTo(a.free[0].a[1], 6);
    expect(b.free[0].a[1]).toBeCloseTo(S - a.free[0].a[0], 6);
  });

  it('per-compartment options stay with their compartments', () => {
    for (const size of [sq, rect]) {
      const l = sample(size);
      const a = resolveIn(l, size);
      const check = (next: DividerLayout, map: (x: number, y: number) => [number, number]) => {
        const b = resolveIn(next, size);
        expect(Object.keys(next.comps ?? {})).toHaveLength(Object.keys(l.comps!).length);
        for (const c of a.compartments) {
          const [x, y] = map(c.point[0], c.point[1]);
          const nc = compartmentAt(b, x, y)!;
          expect(next.comps?.[nc.key], c.key).toEqual(l.comps![c.key]);
        }
      };
      check(mirrorLayout(l, 'x', size), (x, y) => [size.w - x, y]);
      check(mirrorLayout(l, 'y', size), (x, y) => [x, size.d - y]);
      // Rotation within a non-square cavity scales; map through fractions.
      check(rotateLayout(l, size.w, size.d), (x, y) => [(y / size.d) * size.w, (1 - x / size.w) * size.d]);
    }
  });

  it('fitLayout drops fixed-size walls that do not fit, keeps ratios', () => {
    const big = inner(4, 2);
    const small = inner(1, 1);
    let l: DividerLayout = { walls: [v('r', 0.5), v('e', 0, { lo: 'r', pos: { kind: 'exact', mm: 60, from: 'lo' } }), h('k', 0.5, { end: 'r' })] };
    l = setCompartmentOptions(l, resolveIn(l, big).compartments[0].key, { scoop: 1 });
    expect(fitLayout(l, big)).toEqual({ layout: l, dropped: [] });
    const fit = fitLayout(l, small);
    expect(fit.dropped).toEqual(['e']);
    expect(fit.layout.walls.map((w) => w.id)).toEqual(['r', 'k']);
    expect(Object.values(fit.layout.comps ?? {})).toEqual([{ scoop: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Copying layouts between bins (store)
// ---------------------------------------------------------------------------

describe('copyLayout (store)', () => {
  const st = () => useStore.getState();
  beforeEach(() => {
    st().resetAll();
    history.clear();
  });

  it('copies walls, options and free walls to bins in this and other drawers, as one undo step', () => {
    const d1 = st().activeDrawerId;
    const A = st().addBin(0, 0, 2, 2);
    const B = st().addBin(2, 0, 3, 1);
    const d2 = st().addDrawer('Other');
    const C = st().addBin(0, 0, 1, 1);
    st().switchDrawer(d1);
    const sa = inner(2, 2);
    let l: DividerLayout = {
      walls: [v('x1', 0.5), h('y1', 0.5, { end: 'x1' }), h('e1', 0, { start: 'x1', pos: { kind: 'exact', mm: 40, from: 'lo' } })],
    };
    l = setCompartmentOptions(l, compartmentAt(resolveIn(l, sa), 5, 5)!.key, { scoop: 0.9, label: 'full' });
    l = addFreeWall(l, sa, [0, 0], [sa.w / 2, sa.d / 2])!.layout;
    st().updateBin(A, { opts: { layout: l } });
    history.checkpoint();
    const before = history.getVersion();
    const rep = st().copyLayout(A, [
      { drawerId: d1, binId: B },
      { drawerId: d2, binId: C },
      { drawerId: d1, binId: A }, // itself: skipped
    ]);
    expect(history.getVersion()).toBe(before + 1);
    expect(rep.copied).toBe(2);
    // 40 mm from the front doesn't fit a 1-unit-deep bin.
    expect(rep.dropped).toEqual([
      { drawerId: d1, binId: B, walls: 1 },
      { drawerId: d2, binId: C, walls: 1 },
    ]);
    const b = st().bins.find((x) => x.id === B)!.opts.layout!;
    expect(b.walls.map((w) => w.id)).toEqual(['x1', 'y1']);
    expect(b.free).toEqual(sanitizeLayout(l)!.free);
    const sb = inner(3, 1);
    expect(b.comps?.[compartmentAt(resolveIn(b, sb), 5, 5)!.key]).toEqual({ scoop: 0.9, label: 'full' });
    expect(resolveIn(b, sb).byId.get('x1')!.pos).toBeCloseTo(sb.w / 2, 9);
    const c = allDrawers(st()).find((d) => d.id === d2)!.bins.find((x) => x.id === C)!.opts.layout!;
    expect(c.walls.map((w) => w.id)).toEqual(['x1', 'y1']);
    // One undo puts both back.
    history.undo();
    expect(st().bins.find((x) => x.id === B)!.opts.layout).toBeNull();
    expect(allDrawers(st()).find((d) => d.id === d2)!.bins[0].opts.layout).toBeNull();
    expect(st().bins.find((x) => x.id === A)!.opts.layout).toEqual(sanitizeLayout(l));
  });

  it('a bin without a layout copies its columns × rows; layouts can come from the clipboard', () => {
    const d1 = st().activeDrawerId;
    const A = st().addBin(0, 0, 2, 1);
    const B = st().addBin(2, 0, 1, 1);
    st().updateBin(B, { opts: { layout: uniformLayout(3, 3) } });
    st().updateBin(A, { opts: { divX: 2, divY: 3 } });
    expect(st().copyLayout(A, [{ drawerId: d1, binId: B }])).toEqual({ copied: 1, dropped: [] });
    expect(st().bins.find((x) => x.id === B)!.opts).toMatchObject({ divX: 2, divY: 3, layout: null });
    const src = { layout: uniformLayout(1, 2), divX: 1, divY: 1 };
    st().copyLayout(src, [{ drawerId: d1, binId: A }]);
    expect(st().bins.find((x) => x.id === A)!.opts.layout).toEqual(uniformLayout(1, 2));
    expect(st().copyLayout('nope', [{ drawerId: d1, binId: A }])).toEqual({ copied: 0, dropped: [] });
  });
});

// ---------------------------------------------------------------------------
// Geometry (WASM)
// ---------------------------------------------------------------------------

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const parts = m.decompose();
  const big = parts.filter((p) => p.volume() > 1e-3).length;
  const out = { status: m.status(), components: big, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

/** Volume of material inside a box (bin coordinates). */
function materialIn(mesh: MeshData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const m = toManifold(mesh);
  const b = w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
  const i = m.intersect(b);
  const vol = i.volume();
  [m, b, i].forEach((x) => x.delete());
  return vol;
}

describe('wall geometry', () => {
  const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 6 };
  const s = inner(2, 2);
  const top = HEIGHT_UNIT * 6 - LIP_SUPPORT_HEIGHT; // 40.8
  const floor = 7;
  const ix0 = -s.w / 2;
  const iy0 = -s.d / 2;
  const base = uniformLayout(2, 2); // x1 at x = 0, y1 at y = 0 (bin coordinates)

  it('finger notches: one per wall segment, U-shaped, nothing else changes', () => {
    const plain = buildBin(w, { ...o, layout: base });
    const mesh = buildBin(w, { ...o, layout: setAllWallProps(base, { notch: { width: 20, depth: 12 } }) });
    const p = check(plain);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    // 4 notches: 20 × 2 straight + a half disc of radius 10, through the 1.2 mm wall.
    const area = 20 * 2 + (Math.PI * 100) / 2;
    expect(p.volume - c.volume).toBeGreaterThan(4 * area * (T - 0.05) * 0.97);
    expect(p.volume - c.volume).toBeLessThan(4 * area * T * 1.01);
    const cy = (s.d / 2 - T / 2) / 2 + T / 2; // middle of x1's back segment
    expect(materialIn(mesh, -0.4, cy - 5, top - 7, 0.4, cy + 5, top - 0.1)).toBeLessThan(1e-6);
    expect(materialIn(mesh, -0.4, cy - 5, floor + 1, 0.4, cy + 5, top - 13)).toBeGreaterThan(1);
    expect(materialIn(mesh, -0.4, cy + 12, top - 7, 0.4, cy + 16, top - 0.1)).toBeGreaterThan(1);
    // Too short a segment gets no notch; a removable wall gets none in the bin.
    const r = resolveIn(base, s);
    expect(wallSpans(r, 'x1').every((sp) => fitNotch({ width: 20, depth: 12 }, sp.b - sp.a, 30))).toBe(true);
  });

  it('chamfered and rounded tops take the top edges off', () => {
    const plain = buildBin(w, { ...o, layout: base });
    const vol0 = check(plain).volume;
    const len = 2 * (s.d - T); // both walls, without the crossing
    for (const [shape, cut] of [
      ['chamfer', 2 * (0.45 ** 2 / 2)],
      ['round', 2 * 0.55 ** 2 * (1 - Math.PI / 4)],
    ] as const) {
      const mesh = buildBin(w, { ...o, layout: setAllWallProps(base, { top: shape }) });
      const c = check(mesh);
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
      expect(vol0 - c.volume).toBeGreaterThan(len * cut * 0.85);
      expect(vol0 - c.volume).toBeLessThan(len * cut * 1.15);
      // The corner of x1's top is gone, the middle of its top is still there.
      expect(materialIn(mesh, 0.45, 10, top - 0.1, 0.59, 15, top - 0.01)).toBeLessThan(1e-6);
      expect(materialIn(mesh, -0.05, 10, top - 0.1, 0.05, 15, top - 0.01)).toBeGreaterThan(1e-3);
      expect(materialIn(plain, 0.45, 10, top - 0.1, 0.59, 15, top - 0.01)).toBeGreaterThan(1e-3);
    }
  });

  it('removable walls: notch and top go on the plate', () => {
    const l = setWallProps(setWallProps(uniformLayout(2, 1), 'x1', { removable: true }), 'x1', { notch: { width: 20, depth: 8 }, top: 'round' });
    const ob: BinOptions = { ...o, heightUnits: 4, layout: l };
    const [ins] = removableInserts(ob);
    expect(ins.notch).toEqual({ width: 20, depth: 8 });
    expect(ins.top).toBe('round');
    expect(insertKey(ins)).toBe(`${insertKey({ ...ins, notch: undefined, top: undefined })}|n20x8|tround`);
    const plain = check(buildDividerInsert(w, { ...ins, notch: undefined, top: undefined }));
    const mesh = buildDividerInsert(w, ins);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const notch = 20 * (8 - 10) + (Math.PI * 100) / 2; // depth < radius: the U is a 20 mm round-bottomed dip 8 deep
    expect(plain.volume - c.volume).toBeGreaterThan(0.6 * Math.max(notch, 20 * 8 * 0.6) * T);
    const b = meshBounds(mesh);
    expect(b.max[0]).toBeCloseTo(ins.length, 4);
    expect(b.max[1]).toBeCloseTo(ins.height, 4);
    expect(b.max[2]).toBeCloseTo(ins.thickness, 4);
    // The notch is in the middle of the top edge.
    expect(materialIn(mesh, ins.length / 2 - 3, ins.height - 4, -1, ins.length / 2 + 3, ins.height + 1, 2)).toBeLessThan(1e-6);
    expect(materialIn(mesh, 1, ins.height - 4, -1, 4, ins.height - 1, 2)).toBeGreaterThan(1);
    // The bin itself is the same as without the extras.
    expect(check(buildBin(w, ob)).volume).toBeCloseTo(check(buildBin(w, { ...ob, layout: setWallProps(uniformLayout(2, 1), 'x1', { removable: true }) })).volume, 6);
  });

  it('a diagonal wall stands from the floor to the top, clipped to the cavity', () => {
    const none = buildBin(w, { ...o, layout: { walls: [] } });
    const lay = addFreeWall({ walls: [] }, s, [0, 0], [s.w, s.d])!.layout;
    const mesh = buildBin(w, { ...o, layout: lay });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(meshBounds(mesh)).toEqual(meshBounds(none));
    const full = Math.hypot(s.w, s.d) * T * (top - floor);
    const added = c.volume - check(none).volume;
    expect(added).toBeGreaterThan(full * 0.9);
    expect(added).toBeLessThan(full * 1.0);
    // Solid on the diagonal from the floor to the top, nothing beside it.
    expect(materialIn(mesh, 9.6, 9.6, floor + 0.5, 10.4, 10.4, top - 0.05)).toBeCloseTo(0.64 * (top - 0.05 - floor - 0.5), 3);
    expect(materialIn(mesh, 9.6, 12, floor + 0.5, 10.4, 13, top - 0.05)).toBeLessThan(1e-6);
    expect(materialIn(mesh, 9.6, 9.6, top + 0.05, 10.4, 10.4, top + 3)).toBeLessThan(1e-6);
  });

  it('a curved wall follows its arc; a lowered one stops short', () => {
    const lay = addFreeWall({ walls: [] }, s, [5, 5], [s.w - 5, 5], 20)!.layout;
    const mesh = buildBin(w, { ...o, layout: lay });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const apexY = iy0 + 25;
    expect(materialIn(mesh, -0.4, apexY - 0.4, 15, 0.4, apexY + 0.4, 30)).toBeGreaterThan(0.8 * 0.8 * 15 * 0.99);
    expect(materialIn(mesh, -0.4, iy0 + 4.6, 15, 0.4, iy0 + 5.4, 30)).toBeLessThan(1e-6); // chord midpoint
    const [f] = resolveFreeWalls(lay, s.w, s.d);
    const added = c.volume - check(buildBin(w, { ...o, layout: { walls: [] } })).volume;
    expect(added).toBeGreaterThan(f.length * T * (top - floor) * 0.95);
    expect(added).toBeLessThan(f.length * T * (top - floor) * 1.05);

    const low = buildBin(w, { ...o, layout: updateFreeWall(lay, s, 'f1', { lower: 10 }) });
    expect(check(low).status).toBe('NoError');
    expect(materialIn(low, -0.4, apexY - 0.4, top - 9.9, 0.4, apexY + 0.4, top - 0.1)).toBeLessThan(1e-6);
    expect(materialIn(low, -0.4, apexY - 0.4, top - 15, 0.4, apexY + 0.4, top - 10.1)).toBeGreaterThan(1);
  });

  it('free walls go down into lite feet, leave removable slots open, and work with everything else', () => {
    const lay = addFreeWall({ walls: [] }, s, [0, 0], [s.w, s.d])!.layout;
    const lite = buildBin(w, { ...o, base: 'lite', layout: lay });
    const lc = check(lite);
    expect(lc.status).toBe('NoError');
    expect(lc.components).toBe(1);
    // Inside the foot pocket of the back-right cell, under the floor line.
    expect(materialIn(lite, 9.6, 9.6, 2, 10.4, 10.4, 6)).toBeGreaterThan(0.64 * 4 * 0.99);
    expect(materialIn(buildBin(w, { ...o, base: 'lite', layout: { walls: [] } }), 9.6, 9.6, 2, 10.4, 10.4, 6)).toBeLessThan(1e-6);

    const slot = addFreeWall(setWallProps(uniformLayout(2, 1), 'x1', { removable: true }), s, [0, 0], [s.w, s.d])!.layout;
    const sm = buildBin(w, { ...o, layout: slot });
    expect(check(sm).status).toBe('NoError');
    expect(materialIn(sm, -0.7, -0.3, 10, 0.7, 0.3, 30)).toBeLessThan(1e-6);

    // Everything at once: scoops, tabs, lowered and removable walls, notches, tops, curves.
    let all = sample(inner(3, 2));
    all = setWallProps(all, 'c', { lower: 6, top: 'chamfer', notch: { width: 15, depth: 5 } });
    all = setWallProps(all, 'b', { removable: true, notch: { width: 10, depth: 4 } });
    const ob: BinOptions = { ...o, unitsX: 3, unitsY: 2, scoop: 0.5, label: 'full', labelText: 'X', layout: all };
    const ac = check(buildBin(w, sanitizeBin(ob)));
    expect(ac.status).toBe('NoError');
    expect(ac.components).toBe(1);
    for (const ins of removableInserts(ob)) expect(check(buildDividerInsert(w, ins)).status).toBe('NoError');
    // Bin bounds don't change.
    const { w: W, d: D } = binSize(ob);
    const bb = meshBounds(buildBin(w, ob));
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(W, 4);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(D, 4);
    expect(WALL).toBeGreaterThan(0);
    expect(ix0).toBeLessThan(0);
  });
});
