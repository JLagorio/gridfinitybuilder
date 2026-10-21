import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import {
  DEFAULT_BIN,
  binInnerSize,
  binKey,
  binLabel,
  binLayout,
  binSize,
  buildBin,
  buildDividerInsert,
  removableInserts,
  sanitizeBin,
  type BinOptions,
} from '../src/lib/geometry/bin';
import { BASE_HEIGHT, DIVIDER, HEIGHT_UNIT, LIP_DEPTH, LIP_SUPPORT_HEIGHT, WALL } from '../src/lib/geometry/spec';
import {
  EDGE,
  MIN_GAP,
  PRESETS,
  SLOT_DEPTH,
  autoOrient,
  carryOptions,
  cellLines,
  clampDrag,
  compartmentAt,
  countForMinSize,
  dependents,
  distributeEvenly,
  ghostAt,
  layoutKey,
  makeWall,
  moveWall,
  parseRatio,
  removeWall,
  resolveLayout,
  sanitizeLayout,
  setCompartmentOptions,
  setWallEnd,
  setWallGap,
  setWallProps,
  snapAcross,
  splitByMinSize,
  splitCompartment,
  uniformLayout,
  wallGaps,
  type DividerLayout,
  type DividerWall,
  type InnerSize,
} from '../src/lib/dividers';
import { snapStep } from '../src/lib/units';

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
const widths = (l: DividerLayout, s: InnerSize) =>
  resolveIn(l, s)
    .compartments.map((c) => c.bounds)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .map((b) => Math.round((b.x1 - b.x0) * 1e6) / 1e6);

describe('resolveLayout', () => {
  const s = inner(4, 2); // 163.6 × 79.6

  it('uniformLayout reproduces the divX × divY compartments exactly', () => {
    for (const [nx, ny] of [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 3],
      [12, 1],
    ]) {
      const r = resolveIn(uniformLayout(nx, ny), s);
      const cw = (s.w - (nx - 1) * T) / nx;
      const cd = (s.d - (ny - 1) * T) / ny;
      expect(r.compartments.length).toBe(nx * ny);
      expect(r.dropped).toEqual([]);
      for (const c of r.compartments) {
        expect(c.isRect).toBe(true);
        expect(c.bounds.x1 - c.bounds.x0).toBeCloseTo(cw, 9);
        expect(c.bounds.y1 - c.bounds.y0).toBeCloseTo(cd, 9);
        // Each compartment starts on a pitch boundary.
        const q = c.bounds.x0 / (cw + T);
        expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-9);
      }
      expect(new Set(r.compartments.map((c) => c.key)).size).toBe(nx * ny);
    }
  });

  it('binLayout falls back to the uniform split and matches the explicit layout', () => {
    const o = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, divX: 3, divY: 2 };
    const a = binLayout(o);
    const b = binLayout({ ...o, layout: uniformLayout(3, 2) });
    expect(a.compartments.map((c) => c.bounds)).toEqual(b.compartments.map((c) => c.bounds));
  });

  it('ratio walls scale with the bin, exact walls keep their size', () => {
    const l: DividerLayout = { walls: [v('a', 0.5), v('b', 0, { lo: 'a', pos: { kind: 'exact', mm: 30, from: 'lo' } })] };
    for (const ux of [3, 4, 6]) {
      const r = resolveIn(l, inner(ux, 1));
      const A = r.byId.get('a')!;
      const B = r.byId.get('b')!;
      expect(A.pos).toBeCloseTo((inner(ux, 1).w + T) / 2 - T / 2, 9);
      expect(B.pos - A.pos - T).toBeCloseTo(30, 9);
    }
  });

  it('a ratio wall stays proportional when its neighbor moves', () => {
    const l: DividerLayout = { walls: [v('a', 0.3), v('b', 0.5, { lo: 'a' })] };
    for (const t of [0.2, 0.3, 0.6]) {
      const r = resolveIn({ walls: [{ ...l.walls[0], pos: { kind: 'ratio', t } }, l.walls[1]] }, s);
      const A = r.byId.get('a')!;
      const B = r.byId.get('b')!;
      // Equal compartments either side of b.
      expect(B.pos - A.pos).toBeCloseTo(s.w + T / 2 - B.pos, 9);
    }
    expect([...dependents(l, 'a')]).toEqual(['b']);
  });

  it('attached ends follow the wall they attach to', () => {
    const l: DividerLayout = { walls: [h('y', 1 / 3), v('a', 0.5, { end: 'y' })] };
    for (const t of [1 / 3, 0.6]) {
      const r = resolveIn({ walls: [{ ...l.walls[0], pos: { kind: 'ratio', t } }, l.walls[1]] }, s);
      expect(r.byId.get('a')!.end).toBeCloseTo(r.byId.get('y')!.pos, 9);
      expect(r.compartments.length).toBe(3);
    }
  });

  it('derives L-shaped compartments when walls stop at each other', () => {
    let l = uniformLayout(2, 2);
    l = setWallEnd(l, s, 'x1', 'end', 'y1')!; // vertical wall only below the horizontal one
    expect(resolveIn(l, s).compartments.length).toBe(3);
    l = setWallEnd(l, s, 'y1', 'end', 'x1')!; // horizontal wall only left of the vertical one
    const r = resolveIn(l, s);
    expect(r.compartments.length).toBe(2);
    const L = r.compartments.find((c) => !c.isRect)!;
    expect(L.rects.length).toBe(2);
    // Compartments + walls tile the cavity: no slivers left at the corner.
    const wallArea = r.walls.reduce((t, w) => t + (w.end - w.start) * T, 0) - T * T; // corner counted twice
    const compArea = r.compartments.reduce((t, c) => t + c.area, 0);
    expect(compArea + wallArea).toBeCloseTo(s.w * s.d, 6);
    // The reflex corner is sharp, the outer corners round.
    const [bottom, top] = L.rects;
    expect(bottom.convex).toEqual([true, true, false, false]);
    expect(top.convex).toEqual([true, false, true, true]);
    expect(bottom.open.front && !bottom.open.back && top.open.back && !top.open.front).toBe(true);
  });

  it('keeps compartment keys when walls move and when the bin is resized', () => {
    const l = uniformLayout(3, 2);
    const keys = (lay: DividerLayout, sz: InnerSize) => resolveIn(lay, sz).compartments.map((c) => c.key).sort();
    const base = keys(l, s);
    expect(keys(l, inner(6, 5))).toEqual(base);
    expect(keys(moveWall(l, s, 'x1', 30), s)).toEqual(base);
  });

  it('degrades gracefully on bad data', () => {
    const bad = sanitizeLayout({
      walls: [
        v('a', 0.5, { lo: 'b' }),
        v('b', 0.5, { lo: 'a' }), // cycle
        { id: 'c', orient: 'diagonal' },
        v('d', NaN as unknown as number, { start: 'missing', end: 'a' }), // end on a parallel wall → edge
        v('e', 0.5, { pos: { kind: 'exact', mm: 5000, from: 'lo' } }), // clamped
        h('f', 0.5, { start: 'f' }), // self reference
        null,
      ],
      comps: { k: { scoop: 7, label: 'bogus', floor: -3 }, j: 'x' },
    } as unknown)!;
    expect(bad.walls.map((w) => w.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
    expect(bad.walls.find((w) => w.id === 'd')).toMatchObject({ start: EDGE, end: EDGE, pos: { kind: 'ratio', t: 0.5 } });
    expect(bad.walls.find((w) => w.id === 'f')!.start).toBe(EDGE);
    expect(bad.comps).toEqual({ k: { scoop: 1 } });
    expect(sanitizeLayout(bad)).toEqual(bad);
    const r = resolveIn(bad, s);
    for (const w of r.walls) {
      expect(Number.isFinite(w.pos)).toBe(true);
      expect(w.pos).toBeGreaterThanOrEqual(T / 2 + MIN_GAP - 1e-9);
      expect(w.pos).toBeLessThanOrEqual(s.w - T / 2 - MIN_GAP + 1e-9);
    }
    expect(sanitizeLayout('nope')).toBeNull();
    // Walls that can't fit are dropped instead of producing slivers.
    const tight = resolveIn({ walls: [v('a', 0.5), v('b', 0.5, { lo: 'a' }), v('c', 0.5, { lo: 'b' })] }, { w: 10, d: 20 });
    expect(tight.dropped.length).toBeGreaterThan(0);
    for (const c of tight.compartments) expect(c.bounds.x1 - c.bounds.x0).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    // A wall attached to one that vanished runs to the edge instead.
    const r2 = resolveIn({ walls: [h('y', 0.5, { pos: { kind: 'exact', mm: 999, from: 'lo' } }), v('a', 0.5, { end: 'y' })] }, { w: 50, d: 3 });
    expect(r2.byId.has('y')).toBe(false);
    expect(r2.byId.get('a')!.end).toBe(3);
  });

  it('layoutKey ignores wall order and stale compartment options', () => {
    const l = setCompartmentOptions(uniformLayout(2, 2), 'stale', { scoop: 0.5 });
    const rev: DividerLayout = { ...l, walls: [...l.walls].reverse() };
    const live = new Set(resolveIn(l, s).compartments.map((c) => c.key));
    expect(layoutKey(rev, live)).toBe(layoutKey(l, live));
    expect(layoutKey(l, live)).toBe(layoutKey(uniformLayout(2, 2), live));
    expect(layoutKey(l)).not.toBe(layoutKey(uniformLayout(2, 2)));
  });
});

describe('BinOptions integration', () => {
  it('bins without a layout keep their old key; layouts are part of the key', () => {
    const o = { ...DEFAULT_BIN, unitsX: 2, divX: 2 };
    expect(binKey(o)).toBe('2-1-3-L-none-2-1-0-none-F');
    const withLayout = { ...o, layout: uniformLayout(2, 1) };
    expect(binKey(withLayout)).not.toBe(binKey(o));
    expect(binKey(withLayout)).toBe(binKey({ ...o, layout: uniformLayout(2, 1) }));
    expect(binLabel({ ...withLayout, layout: PRESETS[1].layout })).toBe('2×1×3u 4 compartments');
  });

  it('sanitizeBin cleans the layout and old saved bins stay layout-free', () => {
    const old = { ...DEFAULT_BIN } as Partial<BinOptions>;
    delete old.layout;
    expect(sanitizeBin(old as BinOptions).layout).toBeNull();
    const o = sanitizeBin({ ...DEFAULT_BIN, layout: { walls: [v('a', 3)] } });
    expect(o.layout!.walls[0].pos).toEqual({ kind: 'ratio', t: 1 });
  });
});

describe('snapping', () => {
  const s = inner(4, 2);
  const lo = { ref: EDGE, pos: -T / 2 };
  const hi = { ref: EDGE, pos: s.w + T / 2 };
  const mid = (lo.pos + hi.pos) / 2;
  const base = { lo, hi, inner: s.w, tolerance: 2, step: 1 };

  it('snaps to fractions of the span', () => {
    expect(snapAcross({ ...base, pointer: mid + 1.5 })).toMatchObject({ kind: 'fraction', label: '50%', t: 0.5, pos: mid });
    const third = lo.pos + (hi.pos - lo.pos) / 3;
    expect(snapAcross({ ...base, pointer: third - 1 })).toMatchObject({ kind: 'fraction', label: '33%', pos: third });
    expect(snapAcross({ ...base, pointer: lo.pos + (hi.pos - lo.pos) * 0.75 })).toMatchObject({ label: '75%' });
  });

  it('lines up with other walls, cell seams and fractions of the whole bin', () => {
    const half = { ref: 'a', pos: mid };
    expect(snapAcross({ ...base, lo: half, pointer: 120, align: [{ id: 'q', pos: 121 }] })).toMatchObject({ kind: 'align', wallId: 'q', pos: 121 });
    const seams = cellLines([42, 42, 42, 42]);
    expect(seams).toEqual([40.8, 82.8, 124.8].map((x) => expect.closeTo(x, 9)));
    expect(snapAcross({ ...base, lo: half, pointer: 126, cells: seams })).toMatchObject({ kind: 'cell', pos: seams[2] });
    // 75% of the whole bin, from inside the right half.
    expect(snapAcross({ ...base, lo: half, pointer: lo.pos + (hi.pos - lo.pos) * 0.75 + 1 }).kind).toBe('fraction'); // 50% of the half = 75% of bin
    expect(snapAcross({ ...base, lo: half, pointer: lo.pos + (hi.pos - lo.pos) * (2 / 3) }).matches.map((m) => m.kind)).toContain('bin-fraction');
  });

  it('fractions beat alignment at equal distance; specials beat the fine step', () => {
    const r = snapAcross({ ...base, pointer: mid, align: [{ id: 'q', pos: mid }] });
    expect(r.kind).toBe('fraction');
    expect(r.matches.map((m) => m.kind).sort()).toEqual(['align', 'fraction']);
    expect(snapAcross({ ...base, pointer: mid + 1.9 }).kind).toBe('fraction');
    expect(snapAcross({ ...base, pointer: mid + 2.5 }).kind).toBe('step');
  });

  it('falls back to the fine step (mm or 1/16 in), and Alt turns snapping off', () => {
    const r = snapAcross({ ...base, pointer: 30.3 });
    expect(r.kind).toBe('step');
    expect(r.pos - lo.pos - T).toBeCloseTo(30, 9); // 30 mm clear from the left edge
    const inch = snapAcross({ ...base, step: snapStep('in'), pointer: 30.3 });
    expect(((inch.pos - lo.pos - T) / snapStep('in')) % 1).toBeCloseTo(0, 6);
    expect(snapAcross({ ...base, pointer: mid + 0.4, free: true })).toMatchObject({ kind: 'free' });
  });

  it('never leaves less than MIN_GAP on either side', () => {
    expect(snapAcross({ ...base, pointer: -50 }).pos - lo.pos - T).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    expect(hi.pos - snapAcross({ ...base, pointer: 500 }).pos - T).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
  });

  it('a ghost wall spans its compartment from wall to wall', () => {
    const l: DividerLayout = { walls: [h('y', 0.5), v('a', 0.5)] };
    const r = resolveIn(l, s);
    const g = ghostAt(r, 120, 10, 'v', { tolerance: 2, step: 1 })!;
    expect(g).toMatchObject({ startRef: EDGE, endRef: 'y', lo: { ref: 'a' }, hi: { ref: EDGE } });
    expect(g.snap.label).toBe('');
    const g50 = ghostAt(r, (r.byId.get('a')!.pos + s.w + T / 2) / 2 + 1, 10, 'v', { tolerance: 2, step: 1 })!;
    expect(g50.snap).toMatchObject({ kind: 'fraction', label: '50%', loRef: 'a', hiRef: EDGE });
    expect(ghostAt(r, r.byId.get('a')!.pos, 10, 'v', { tolerance: 2, step: 1 })).toBeNull(); // on a wall
    // Placing it: a ratio wall at exactly 50% of a..edge.
    const w = makeWall(l, 'v', g50.pos, g50, { start: g50.startRef, end: g50.endRef }, g50.snap);
    expect(w).toMatchObject({ lo: 'a', hi: EDGE, pos: { kind: 'ratio', t: 0.5 }, start: EDGE, end: 'y' });
  });

  it('picks the orientation toward the nearer midline', () => {
    const r = resolveIn({ walls: [] }, s);
    expect(autoOrient(r, s.w / 2 + 3, 5)).toBe('v');
    expect(autoOrient(r, 10, s.d / 2 + 1)).toBe('h');
  });

  it('drags stop before a wall would cross a neighbor', () => {
    const l = uniformLayout(3, 1);
    const r = resolveIn(l, s);
    const x2 = r.byId.get('x2')!.pos;
    // x2 depends on x1 (50% of x1..edge), so x1 can go almost to the right edge.
    const far = clampDrag(l, s, 'x1', 1000);
    expect(far.resolved.compartments.length).toBe(3);
    const rr = far.resolved;
    expect(s.w + T / 2 - rr.byId.get('x2')!.pos - T).toBeCloseTo(MIN_GAP, 2);
    // x2 can't pass x1.
    const back = clampDrag(l, s, 'x2', 0);
    expect(back.resolved.byId.get('x2')!.pos - back.resolved.byId.get('x1')!.pos - T).toBeCloseTo(MIN_GAP, 2);
    expect(x2).toBeGreaterThan(back.pos);
  });
});

describe('editing', () => {
  const s = inner(4, 3);

  it('removing a wall re-attaches walls that ended on it and keeps the rest in place', () => {
    // a | b split; c splits b's left part... c ends on a.
    const l: DividerLayout = { walls: [v('a', 0.5), h('c', 0.5, { start: EDGE, end: 'a' }), v('b', 0.5, { lo: 'a' })] };
    const r0 = resolveIn(l, s);
    const out = removeWall(l, s, 'a');
    const r1 = resolveIn(out, s);
    expect(r1.byId.get('c')).toMatchObject({ start: 0, end: expect.closeTo(r0.byId.get('b')!.pos, 6) });
    expect(out.walls.find((w) => w.id === 'c')!.end).toBe('b');
    expect(r1.byId.get('b')!.pos).toBeCloseTo(r0.byId.get('b')!.pos, 9);
    expect(out.walls.find((w) => w.id === 'b')!.lo).toBe(EDGE);
  });

  it('removing a wall merges walls that become one', () => {
    const l: DividerLayout = { walls: [v('a', 0.5), h('l', 0.5, { end: 'a' }), h('r', 0.5, { start: 'a' })] };
    const out = removeWall(l, s, 'a');
    expect(out.walls.map((w) => w.id)).toEqual(['l']);
    expect(resolveIn(out, s).compartments.length).toBe(2);
  });

  it('typing a gap makes an exact wall; a neighbor that followed the wall is detached first', () => {
    const l: DividerLayout = { walls: [v('a', 0.5), v('b', 0.5, { lo: 'a' })] };
    const out = setWallGap(l, s, 'a', 'hi', 25);
    const r = resolveIn(out, s);
    expect(wallGaps(r, 'a')!.hiGap).toBeCloseTo(25, 9);
    expect(r.byId.get('b')!.pos).toBeCloseTo(resolveIn(l, s).byId.get('b')!.pos, 9);
    expect(out.walls.find((w) => w.id === 'a')!.pos).toEqual({ kind: 'exact', mm: 25, from: 'hi' });
    const left = setWallGap(l, s, 'a', 'lo', 30);
    expect(wallGaps(resolveIn(left, s), 'a')!.loGap).toBeCloseTo(30, 9);
  });

  it('moving to a snapped fraction stores the exact ratio', () => {
    const l: DividerLayout = { walls: [v('a', 0.3)] };
    const r = resolveIn(l, s);
    const p = (r.byId.get('a')!.loPos + r.byId.get('a')!.hiPos) / 2;
    const out = moveWall(l, s, 'a', p, { kind: 'fraction', t: 0.5, loRef: EDGE, hiRef: EDGE });
    expect(out.walls[0].pos).toEqual({ kind: 'ratio', t: 0.5 });
    const cell = moveWall(l, s, 'a', 40.8, { kind: 'cell' });
    expect(cell.walls[0].pos).toEqual({ kind: 'exact', mm: expect.closeTo(40.8 - T / 2, 9), from: 'lo' });
  });

  it('splits a compartment into equal parts, by ratio and by minimum size', () => {
    const one = splitCompartment({ walls: [] }, s, null, 'v', [1, 1, 1, 1]);
    expect(widths(one.layout!, s)).toEqual(Array(4).fill(Math.round(((s.w - 3 * T) / 4) * 1e6) / 1e6));
    const ratio = splitCompartment({ walls: [] }, s, null, 'v', parseRatio('1:2:1')!);
    const pitch = (s.w + T) / 4;
    expect(widths(ratio.layout!, s)).toEqual([pitch - T, 2 * pitch - T, pitch - T].map((x) => Math.round(x * 1e6) / 1e6));
    expect(parseRatio('1 : 2 : 1')).toEqual([1, 2, 1]);
    expect(parseRatio('3')).toBeNull();
    expect(parseRatio('1:0')).toBeNull();
    expect(countForMinSize(s.w + T, 30)).toBe(5);
    const min = splitByMinSize({ walls: [] }, s, null, 'v', 30);
    expect(widths(min.layout!, s).every((x) => x >= 30)).toBe(true);
    expect(widths(min.layout!, s).length).toBe(5);
    // Split one compartment of an existing layout (rows inside the right half).
    const base: DividerLayout = { walls: [v('a', 0.5)] };
    const right = resolveIn(base, s).compartments.find((c) => c.bounds.x0 > 10)!;
    const rows = splitCompartment(base, s, right.key, 'h', [1, 1, 1]).layout!;
    const rr = resolveIn(rows, s);
    expect(rr.compartments.length).toBe(4);
    for (const w of rr.walls.filter((x) => x.orient === 'h')) expect(w.wall.start).toBe('a');
    expect(splitCompartment(base, s, null, 'v', [1, 1]).error).toBeTruthy(); // ambiguous target
    expect(splitCompartment({ walls: [] }, { w: 8, d: 8 }, null, 'v', [1, 1, 1]).error).toBeTruthy();
  });

  it('distributes a run of parallel walls evenly', () => {
    const l: DividerLayout = { walls: [v('a', 0.1), v('b', 0.2, { lo: 'a' }), v('c', 0.9, { lo: 'b' })] };
    const out = distributeEvenly(l, s, 'b');
    const ws = widths(out, s);
    expect(ws.length).toBe(4);
    for (const x of ws) expect(x).toBeCloseTo(ws[0], 6);
  });

  it('carries compartment options through splits and merges', () => {
    const l0: DividerLayout = { walls: [v('a', 0.5)] };
    const r0 = resolveIn(l0, s);
    const left = r0.compartments.find((c) => c.bounds.x0 < 1)!;
    const l1 = setCompartmentOptions(l0, left.key, { scoop: 0.7, label: 'left' });
    const split = splitCompartment(l1, s, left.key, 'h', [1, 1]).layout!;
    const rs = resolveIn(split, s);
    const halves = rs.compartments.filter((c) => c.bounds.x0 < 1);
    expect(halves.length).toBe(2);
    for (const c of halves) expect(split.comps![c.key]).toEqual({ scoop: 0.7, label: 'left' });
    const merged = removeWall(split, s, rs.walls.find((w) => w.orient === 'h')!.id);
    const rm = resolveIn(merged, s);
    expect(merged.comps![compartmentAt(rm, 5, 5)!.key]).toEqual({ scoop: 0.7, label: 'left' });
    expect(Object.keys(merged.comps!).length).toBe(1);
    // Clearing every option drops the entry.
    const cleared = setCompartmentOptions(l1, left.key, { scoop: undefined, label: undefined });
    expect(cleared.comps).toBeUndefined();
    expect(carryOptions(l0, l0, s).comps).toBeUndefined();
  });

  it('presets fit any bin size', () => {
    const counts: Record<string, number> = { halves: 2, 'big-3-small': 4, 'rows-2x4': 8, 'sorter-3x3': 9, 'half-quarters': 5, 'tool-tray': 3 };
    for (const p of PRESETS) {
      for (const [ux, uy] of [
        [1, 1],
        [2, 3],
        [6, 4],
      ]) {
        const r = resolveIn(p.layout, inner(ux, uy));
        expect(r.dropped).toEqual([]);
        expect(r.compartments.length).toBe(counts[p.id]);
        for (const c of r.compartments) expect(Math.min(c.bounds.x1 - c.bounds.x0, c.bounds.y1 - c.bounds.y0)).toBeGreaterThan(MIN_GAP);
      }
    }
  });
});

describe('removable inserts', () => {
  it('one plate per segment; lip ends are shortened so the plate drops in', () => {
    const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 4, layout: setWallProps(uniformLayout(2, 2), 'x1', { removable: true }) };
    const ins = removableInserts(o);
    expect(ins.length).toBe(2); // split by the crossing wall y1
    const s = binInnerSize(o);
    const topInfill = HEIGHT_UNIT * 4 - LIP_SUPPORT_HEIGHT;
    const seg = (s.d - T) / 2 - 0.25 - (LIP_DEPTH - WALL + 0.25);
    for (const p of ins) {
      expect(p.length).toBeCloseTo(seg, 3);
      expect(p.height).toBeCloseTo(topInfill - BASE_HEIGHT + SLOT_DEPTH, 3);
      expect(p.thickness).toBe(DIVIDER);
    }
    const noLip = removableInserts({ ...o, lip: false, layout: setWallProps(setWallProps(uniformLayout(2, 1), 'x1', { removable: true }), 'x1', { lower: 5 }) });
    // No lip: the plate runs edge to edge (minus clearance); lowered by 5 mm.
    expect(noLip).toEqual([
      { wallId: 'x1', segment: 0, length: expect.closeTo(s.d - 2 * 0.25, 3), height: expect.closeTo(28 - 5 - BASE_HEIGHT + SLOT_DEPTH, 3), thickness: DIVIDER },
    ]);
    expect(removableInserts({ ...o, layout: null })).toEqual([]);
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

describe('bins with divider layouts', () => {
  it('divX × divY without a layout is unchanged', () => {
    // Volumes recorded from the generator before divider layouts existed.
    const cases: [Partial<BinOptions>, number][] = [
      [{}, 14583.2765],
      [{ unitsX: 2, divX: 2, scoop: 0.7, label: 'full' }, 36451.3604],
      [{ unitsX: 3, unitsY: 2, divX: 3, divY: 2, label: 'left' }, 102964.5085],
      [{ unitsX: 2, unitsY: 2, fillet: false, label: 'right', heightUnits: 6 }, 61647.6401],
      [{ unitsX: 2, unitsY: 1, divX: 3, lip: false, heightUnits: 4 }, 29192.8477],
    ];
    for (const [o, vol] of cases) expect(check(buildBin(w, { ...DEFAULT_BIN, ...o })).volume).toBeCloseTo(vol, 3);
  });

  it('the equivalent explicit layout builds the same bin', () => {
    const o = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, divX: 3, divY: 2, label: 'left' as const, scoop: 0.4 };
    const a = check(buildBin(w, o));
    const b = check(buildBin(w, { ...o, layout: uniformLayout(3, 2) }));
    expect(b.status).toBe('NoError');
    expect(b.volume).toBeCloseTo(a.volume, 2);
  });

  it.each([
    ['L-shaped compartment', { unitsX: 4, unitsY: 2, scoop: 0.6, label: 'full' as const }],
    ['L-shaped, flat floors', { unitsX: 4, unitsY: 2, fillet: false, label: 'center' as const }],
  ])('%s is one valid solid', (_, o) => {
    let l = uniformLayout(2, 2);
    const s = inner(o.unitsX, o.unitsY);
    l = setWallEnd(l, s, 'x1', 'end', 'y1')!;
    l = setWallEnd(l, s, 'y1', 'end', 'x1')!;
    const mesh = buildBin(w, { ...DEFAULT_BIN, ...o, layout: l });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const b = meshBounds(mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(42 * o.unitsX - 0.5, 3);
  });

  it('a lowered wall stops N mm below the top of the infill', () => {
    const o = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 6, label: 'full' as const, scoop: 0.5 };
    const mesh = buildBin(w, { ...o, layout: setWallProps(uniformLayout(2, 2), 'x1', { lower: 15 }) });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const topInfill = HEIGHT_UNIT * 6 - LIP_SUPPORT_HEIGHT;
    // x1 sits at the bin's center line; y1 crosses it at y = 0.
    const probe = (z0: number, z1: number) => materialIn(mesh, -0.4, 10, z0, 0.4, 20, z1);
    expect(probe(topInfill - 15 - 2, topInfill - 15 - 0.05)).toBeGreaterThan(0.5);
    expect(probe(topInfill - 15 + 0.05, topInfill)).toBeLessThan(1e-6);
    // The crossing full-height wall is untouched.
    expect(materialIn(mesh, 10, -0.4, topInfill - 3, 20, 0.4, topInfill - 0.05)).toBeGreaterThan(0.5);
  });

  it('a label tab on a lowered back wall comes down with it', () => {
    const mesh = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 6, label: 'full', layout: setWallProps(uniformLayout(1, 2), 'y1', { lower: 15 }) });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
  });

  it('removable walls become slots with guide ribs, and the plates fit', () => {
    const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 4, layout: setWallProps(uniformLayout(2, 2), 'x1', { removable: true }) };
    const fixed = check(buildBin(w, { ...o, layout: uniformLayout(2, 2) }));
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    // The slot is empty from the groove up, across the plate's thickness + clearance.
    expect(materialIn(mesh, -0.74, 10, BASE_HEIGHT - SLOT_DEPTH + 0.05, 0.74, 25, 30)).toBeLessThan(1e-6);
    // ...and the floor is still there under the groove.
    expect(materialIn(mesh, -0.5, 10, BASE_HEIGHT - SLOT_DEPTH - 0.5, 0.5, 25, BASE_HEIGHT - SLOT_DEPTH - 0.05)).toBeGreaterThan(1);
    // Ribs at the ends of each slot segment (next to the outer wall).
    const { d } = binSize(o);
    expect(materialIn(mesh, 0.76, d / 2 - WALL - 3, 12, 1.5, d / 2 - WALL - 0.05, 14)).toBeGreaterThan(1);
    expect(fixed.volume).toBeGreaterThan(c.volume - 20); // wall removed, ribs added
    for (const ins of removableInserts(o)) {
      const plate = buildDividerInsert(w, ins);
      const pc = check(plate);
      expect(pc.status).toBe('NoError');
      expect(pc.components).toBe(1);
      const b = meshBounds(plate);
      expect(b.min).toEqual([0, 0, 0]);
      expect(b.max[0]).toBeCloseTo(ins.length, 4);
      expect(b.max[1]).toBeCloseTo(ins.height, 4);
      expect(b.max[2]).toBeCloseTo(ins.thickness, 4);
    }
  });

  it('per-compartment scoop, label and floor raise', () => {
    const o = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, label: 'none' as const };
    const s = inner(3, 2);
    const r = resolveIn(uniformLayout(3, 2), s);
    const front = r.compartments.filter((c) => c.bounds.y0 < 1).sort((a, b) => a.bounds.x0 - b.bounds.x0);
    let l = uniformLayout(3, 2);
    l = setCompartmentOptions(l, front[0].key, { scoop: 1, label: 'full' });
    l = setCompartmentOptions(l, front[2].key, { floor: 6 });
    const plain = buildBin(w, { ...o, layout: uniformLayout(3, 2) });
    const mesh = buildBin(w, { ...o, layout: l });
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const ix0 = -binSize(o).w / 2 + WALL;
    const iy0 = -binSize(o).d / 2 + WALL;
    const at = (cmp: (typeof front)[number], dx0: number, dy0: number, dx1: number, dy1: number, z0: number, z1: number, m: MeshData) =>
      materialIn(m, ix0 + cmp.bounds.x0 + dx0, iy0 + cmp.bounds.y0 + dy0, z0, ix0 + cmp.bounds.x0 + dx1, iy0 + cmp.bounds.y0 + dy1, z1);
    // Scoop ramp at the front of compartment 0 only.
    // (probe above the rounded-bottom fillet, which every compartment has)
    expect(at(front[0], 10, 0.5, 20, 1.5, BASE_HEIGHT + 3.5, BASE_HEIGHT + 4.5, mesh)).toBeGreaterThan(1);
    expect(at(front[1], 10, 0.5, 20, 1.5, BASE_HEIGHT + 3.5, BASE_HEIGHT + 4.5, mesh)).toBeLessThan(1e-6);
    // Label tab at the back of compartment 0.
    const topInfill = HEIGHT_UNIT * 3 - LIP_SUPPORT_HEIGHT;
    const cd = front[0].bounds.y1 - front[0].bounds.y0;
    expect(at(front[0], 10, cd - 3, 20, cd - 0.2, topInfill - 1, topInfill - 0.1, mesh)).toBeGreaterThan(1);
    expect(at(front[0], 10, cd - 3, 20, cd - 0.2, topInfill - 1, topInfill - 0.1, plain)).toBeLessThan(1e-6);
    // Raised floor in compartment 2.
    expect(at(front[2], 10, 10, 20, 20, BASE_HEIGHT + 0.5, BASE_HEIGHT + 5.9, mesh)).toBeCloseTo(10 * 10 * 5.4, 1);
    expect(at(front[2], 10, 10, 20, 20, BASE_HEIGHT + 6.1, topInfill, mesh)).toBeLessThan(1e-6);
  });

  it('every preset builds a valid bin', () => {
    for (const p of PRESETS) {
      const c = check(buildBin(w, { ...DEFAULT_BIN, unitsX: 3, unitsY: 3, heightUnits: 4, layout: p.layout, scoop: p.defaults?.scoop ?? 0.3, label: p.defaults?.label ?? 'left' }));
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
    }
  });
});
