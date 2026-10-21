import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binHoleSites, binKey, binLabel, binSize, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { HALF_PITCH, STRETCH_Z, cleanStretch, halfHoleSites, stretchOffset } from '../src/lib/geometry/placement';
import { holeSites } from '../src/lib/geometry/holes';
import { computeLayout, DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { convertMask, switchHalfGrid, unitsAcross } from '../src/lib/layout/halfgrid';
import { autoStretch, effectiveStretch, stretchRoom } from '../src/lib/layout/stretch';
import { makePieces } from '../src/lib/layout/split';
import { DEFAULT_SETUP, planBaseplate } from '../src/lib/layout/plan';
import { DEFAULT_PROJECT, binCellsAt, binOrigin, binSpec, lidSpec, planJob, type PlacedBin } from '../src/lib/project';
import { firstFreeSpot, fitBinForTools } from '../src/lib/tools';
import { planTestFit } from '../src/lib/testfit';
import { billOfMaterials } from '../src/lib/bom';
import { rectsOverlap } from '../src/lib/bins';
import { history, useStore } from '../src/state/store';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

/** Outline of a mesh at height z: how many separate pieces, and its bounding box. */
function sliceAt(mesh: MeshData, z: number) {
  const m = toManifold(mesh);
  const cs = m.slice(z);
  const pieces = cs.decompose();
  const b = cs.bounds();
  const out = { pieces: pieces.length, x0: b.min[0], x1: b.max[0], y0: b.min[1], y1: b.max[1] };
  pieces.forEach((p) => p.delete());
  cs.delete();
  m.delete();
  return out;
}

/** The reference drawer: 510 × 376 mm plate, 3 mm side and 20 mm front/back margins on the full grid. */
const REF: DrawerInput = { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 };
const HALF: DrawerInput = { ...REF, halfGrid: true };

const bin = (id: string, x: number, y: number, unitsX: number, unitsY: number, extra: Partial<PlacedBin> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: { ...DEFAULT_BIN, unitsX, unitsY },
  ...extra,
});

const diffs = (b: number[]) => b.slice(1).map((v, i) => Math.round((v - b[i]) * 1e4) / 1e4);

describe('half-grid layout', () => {
  it('puts cell boundaries every 21 mm', () => {
    const l = computeLayout(HALF);
    expect(l.halfGrid).toBe(true);
    expect([l.pitchX, l.pitchY]).toEqual([21, 21]);
    expect([l.plateW, l.plateD]).toEqual([510, 376]);
    // 510 = 24 × 21 + 6; 376 = 17 × 21 + 19
    expect([l.nx, l.ny]).toEqual([24, 17]);
    expect(new Set(diffs(l.xs))).toEqual(new Set([21]));
    expect(new Set(diffs(l.ys))).toEqual(new Set([21]));
    expect(l.margins).toEqual({ left: 3, right: 3, front: 9.5, back: 9.5 });
    expect(unitsAcross(l)).toEqual({ x: 12, y: 8.5 });
  });

  it('leaves classic layouts exactly as they were', () => {
    const l = computeLayout(REF);
    expect('halfGrid' in l).toBe(false);
    expect([l.nx, l.ny, l.pitchX]).toEqual([12, 8, 42]);
    expect(computeLayout({ ...REF, halfGrid: false })).toEqual(l);
  });

  it('grid mode counts full units, in half steps', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4.5, gridY: 2, halfGrid: true });
    expect([l.nx, l.ny, l.plateW, l.plateD]).toEqual([9, 4, 189, 84]);
    // Half units are ignored on the full grid.
    expect(computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4.5, gridY: 2 }).nx).toBe(4);
  });

  it("'half' edge fill leaves the margin solid (the cells already are half cells); 'fit' still works", () => {
    const wide = { ...HALF, width: 540.5, alignX: 0 }; // 540 = 25 × 21 + 15
    expect(computeLayout({ ...wide, fill: 'half' }).xs).toEqual(computeLayout({ ...wide, fill: 'solid' }).xs);
    const fit = computeLayout({ ...wide, fill: 'fit', minFill: 10 });
    expect(fit.nx).toBe(26);
    expect(fit.xs.at(-1)! - fit.xs.at(-2)!).toBeCloseTo(15, 6);
    expect(fit.margins.right).toBe(0);
  });

  it('splits into printable pieces at 21 mm cell boundaries', () => {
    const l = computeLayout(HALF);
    const plan = planBaseplate(l, DEFAULT_SETUP);
    expect(plan.error).toBeUndefined();
    expect(plan.pieces.length).toBeGreaterThan(1);
    const onBoundary = (v: number, b: number[], total: number) => v === 0 || Math.abs(v - total) < 1e-6 || b.some((x) => Math.abs(x - v) < 1e-6);
    for (const p of plan.pieces) {
      expect(onBoundary(p.x0, l.xs, l.plateW) && onBoundary(p.x1, l.xs, l.plateW)).toBe(true);
      expect(onBoundary(p.y0, l.ys, l.plateD) && onBoundary(p.y1, l.ys, l.plateD)).toBe(true);
      expect(p.x1 - p.x0).toBeLessThanOrEqual(DEFAULT_SETUP.bedW - 2 * DEFAULT_SETUP.plateMargin + 1e-6);
    }
    // Every cell is in exactly one piece.
    const cells = plan.pieces.reduce((t, p) => t + (p.cells.x1 - p.cells.x0) * (p.cells.y1 - p.cells.y0), 0);
    expect(cells).toBe(l.nx * l.ny);
  });
});

describe('half-unit bins', () => {
  const layout = computeLayout(HALF);

  it('get one 21 mm foot per cell, sized in half units', () => {
    const b = bin('a', 2, 3, 3, 5);
    const cells = binCellsAt(layout, b)!;
    expect(cells.half).toBe(true);
    expect(cells.x).toEqual([21, 21, 21]);
    expect(cells.y).toEqual([21, 21, 21, 21, 21]);
    expect(binSize(b.opts, cells)).toEqual({ w: 62.5, d: 104.5 });
    expect(binLabel(b.opts, cells)).toBe('1.5×2.5×3u');
    expect(binOrigin(layout, b)).toEqual({ x: 3 + 2 * 21 + 0.25, y: 9.5 + 3 * 21 + 0.25 });
  });

  it('a 1 × 1 u bin stands on 2 × 2 half feet', () => {
    const b = bin('a', 0, 0, 2, 2);
    const mesh = buildBin(w, b.opts, binCellsAt(layout, b));
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const bb = meshBounds(mesh);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(41.5, 3);
    expect(sliceAt(mesh, 0.1).pieces).toBe(4);
    // The classic 1 × 1 has one foot.
    expect(sliceAt(buildBin(w, { ...b.opts, unitsX: 1, unitsY: 1 }), 0.1).pieces).toBe(1);
  });

  it('builds odd half sizes with magnets as one solid', () => {
    const b = { ...bin('a', 1, 1, 3, 1), opts: { ...DEFAULT_BIN, unitsX: 3, unitsY: 1, holes: 'magnets', divX: 2 } as BinOptions };
    const cells = binCellsAt(layout, b);
    const c = check(buildBin(w, b.opts, cells));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const plain = check(buildBin(w, { ...b.opts, holes: 'none' }, cells));
    expect(c.volume).toBeLessThan(plain.volume - 50);
  });

  it('put magnets at the corners of each 42 mm unit, one per half foot', () => {
    const half = (nx: number, ny: number, corners = false) =>
      halfHoleSites({ x: Array(nx).fill(HALF_PITCH), y: Array(ny).fill(HALF_PITCH) }, corners).map((s) => [s.x, s.y]);
    const sortPts = (p: number[][]) => p.map((q) => q.map((v) => Math.round(v * 100) / 100)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // 1 × 1 u: the same four holes as a classic 1 × 1 bin.
    expect(sortPts(half(2, 2))).toEqual(sortPts(holeSites({ x: [42], y: [42] }, false).map((s) => [s.x, s.y])));
    // 1.5 × 0.5 u: the third foot starts a new 42 mm unit (Gridfinity Extended), 8 mm in from its edge.
    expect(sortPts(half(3, 1)).map((p) => p[0])).toEqual([-23.5, 2.5, 18.5]);
    // Corners only: just the feet at the bin's corners.
    expect(half(4, 4, true)).toHaveLength(4);
    expect(binHoleSites({ ...DEFAULT_BIN, unitsX: 3, unitsY: 3, holes: 'magnets' }, { half: true, x: [21, 21, 21], y: [21, 21, 21] })).toHaveLength(9);
    // Partial cells get none.
    expect(halfHoleSites({ x: [21, 15], y: [21] }, false)).toHaveLength(1);
  });

  it('have their own mesh keys; classic bins keep theirs', () => {
    const classic = computeLayout(REF);
    const b = bin('a', 0, 0, 2, 2);
    expect(binSpec(classic, b).key).toBe(`bin|${binKey(b.opts)}`);
    expect(binCellsAt(classic, b)).toBeUndefined();
    const k = binSpec(layout, b).key;
    expect(k).toContain('c21/21x21/21');
    expect(k).toContain('-h-');
    // Holes differ between half-grid feet and 21 mm edge-fill cells on a full grid, so the key does too.
    expect(binKey(b.opts, { x: [21, 21], y: [21, 21] })).not.toBe(binKey(b.opts, { x: [21, 21], y: [21, 21], half: true }));
  });

  it('count their holes in the bill of materials', () => {
    const opts = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, holes: 'magnets' } as BinOptions;
    const job = planJob({ ...DEFAULT_PROJECT, drawer: HALF, bins: [{ id: 'a', x: 0, y: 0, opts }] });
    const magnets = billOfMaterials(job).hardware.find((h) => h.item.startsWith('Magnets') && h.item.includes('bins'));
    expect(magnets?.count).toBe(6);
    expect(job.parts['bin:a'].name).toContain('1.5×1×3u');
  });

  it('"Make a bin" and free spots work in half units', () => {
    const tool = { id: 't', name: 'T', outline: [[-25, -8], [25, -8], [25, 8], [-25, 8]] as [number, number][], depth: 10, clearance: 1 };
    const full = fitBinForTools([tool], { lip: true });
    const half = fitBinForTools([tool], { lip: true, half: true });
    expect(half.unitsX).toBeLessThanOrEqual(full.unitsX * 2);
    expect(binSize({ unitsX: half.unitsX, unitsY: 1 }, { x: Array(half.unitsX).fill(21) }).w).toBeGreaterThan(52);
    expect(half.fits).toBe(true);
    // A taken half cell at the corner: the next 2 × 2 spot lines up with whole units (magnets).
    expect(firstFreeSpot(layout, [bin('a', 0, 0, 1, 1)], 2, 2)).toEqual({ x: 2, y: 0 });
  });

  it('the test-fit kit is a 3 × 3 half-cell sample with a 1 u bin on half feet', () => {
    const kit = planTestFit(DEFAULT_BASEPLATE, DEFAULT_BIN, DEFAULT_SETUP, { x: 42, y: 42, halfGrid: true });
    expect([kit.layout.nx, kit.layout.ny, kit.layout.plateW]).toEqual([3, 3, 63]);
    const spec = kit.meshes[kit.parts['bin:test-bin'].meshKey];
    expect(spec.kind === 'bin' && spec.cells?.half).toBe(true);
    expect(kit.parts['bin:test-bin'].w).toBeCloseTo(41.5, 6);
    // The classic kit is unchanged.
    expect(planTestFit(DEFAULT_BASEPLATE, DEFAULT_BIN, DEFAULT_SETUP).layout.nx).toBe(2);
  });

  it('half-grid baseplate pieces build (magnets and weight pockets skip 21 mm cells)', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 1.5, gridY: 1, halfGrid: true });
    const [piece] = makePieces(l, [0, l.plateW], [0, l.plateD]);
    for (const style of ['frame', 'weighted', 'skeletonized'] as const) {
      const c = check(buildBaseplatePiece(w, l, piece, { ...DEFAULT_BASEPLATE, style, magnets: true }));
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
    }
  });
});

describe('switching the half grid', () => {
  it('doubles positions, sizes and blocked cells, and halves them back exactly', () => {
    const drawer = { ...REF, mask: ['5,5'] };
    const bins = [bin('a', 0, 0, 2, 1), bin('b', 3, 2, 1, 3, { stretch: { left: 2 } }), bin('c', 11, 7, 1, 1)];
    const on = switchHalfGrid(drawer, bins, true);
    expect(on.drawer.halfGrid).toBe(true);
    expect(on.adjusted).toBe(0);
    expect(on.bins.map((b) => [b.x, b.y, b.opts.unitsX, b.opts.unitsY])).toEqual([
      [0, 0, 4, 2],
      [6, 4, 2, 6],
      [22, 14, 2, 2],
    ]);
    // Same place in the drawer, in mm.
    const L0 = computeLayout(drawer);
    const L1 = computeLayout(on.drawer);
    for (let i = 0; i < bins.length; i++) {
      expect(binOrigin(L1, on.bins[i]).x).toBeCloseTo(binOrigin(L0, { ...bins[i], stretch: undefined }).x, 6);
    }
    expect(on.bins[1].stretch).toEqual({ left: 2 });
    // X lines up (3 mm margins both ways); Y is offset by half a cell (20 vs 9.5 mm), so three rows.
    expect(on.drawer.mask).toEqual(['10,10', '10,11', '10,12', '11,10', '11,11', '11,12']);
    const off = switchHalfGrid(on.drawer, on.bins, false);
    expect('halfGrid' in off.drawer).toBe(false);
    expect(off.drawer.mask).toEqual(['5,5']);
    expect(off.bins).toEqual(bins);
    expect(off.adjusted).toBe(0);
  });

  it('keeps bins in place when the half grid is offset from the full one', () => {
    // 530 mm: 12 full cells with 13 mm margins, or 25 half cells with 2.5 mm margins.
    const drawer = { ...REF, width: 530.5 };
    const bins = [bin('a', 0, 0, 1, 1), bin('b', 1, 0, 2, 1)];
    const on = switchHalfGrid(drawer, bins, true);
    expect(computeLayout(on.drawer).nx).toBe(25);
    expect(on.bins.map((b) => [b.x, b.opts.unitsX])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    const shift = binOrigin(computeLayout(on.drawer), on.bins[0]).x - binOrigin(computeLayout(drawer), bins[0]).x;
    expect(Math.abs(shift)).toBeLessThanOrEqual(10.5 + 1e-6);
    expect(switchHalfGrid(on.drawer, on.bins, false).bins).toEqual(bins);
  });

  it('shrinks odd half-unit bins to whole units without overlaps', () => {
    const bins = [bin('a', 0, 0, 3, 1), bin('b', 3, 0, 1, 2), bin('c', 4, 0, 2, 2), bin('d', 0, 1, 1, 1)];
    const off = switchHalfGrid(HALF, bins, false);
    const L = computeLayout(off.drawer);
    expect(off.adjusted).toBeGreaterThan(0);
    const rects = off.bins.map((b) => ({ x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY }));
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(L.nx);
      expect(r.w).toBeGreaterThanOrEqual(1);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i], rects[j])).toBe(false);
    expect(off.bins.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    // 2 × 2 half cells is exactly 1 × 1 u.
    expect(off.bins[2]).toMatchObject({ x: 2, y: 0, opts: { unitsX: 1, unitsY: 1 } });
  });

  it('blocked cells cover at least the same area, and survive a round trip', () => {
    // Aligned in X, offset in Y: a blocked half cell inside a full cell blocks it; one across two blocks both.
    expect(convertMask(computeLayout({ ...HALF, mask: ['3,3'] }), computeLayout(REF))).toEqual(['1,1']);
    expect(convertMask(computeLayout({ ...HALF, mask: ['3,2'] }), computeLayout(REF))).toEqual(['1,0', '1,1']);
    const offset = { ...REF, width: 530.5 };
    const full = computeLayout({ ...offset, mask: ['2,0'] });
    const halfL = computeLayout({ ...offset, halfGrid: true });
    // Offset by half a cell both ways: the 42 mm cell touches 3 × 3 half cells.
    const there = convertMask(full, halfL);
    expect(there).toEqual(['4,0', '4,1', '4,2', '5,0', '5,1', '5,2', '6,0', '6,1', '6,2']);
    expect(convertMask({ ...halfL, mask: there }, computeLayout(offset))).toEqual(['2,0']);
  });

  it('is one undo step in the store', () => {
    const s = () => useStore.getState();
    s().resetAll();
    history.clear();
    s().addBin(1, 1, 2, 1);
    history.checkpoint();
    expect(s().setHalfGrid(true)).toBe(0);
    expect(s().drawer.halfGrid).toBe(true);
    expect(s().bins[0]).toMatchObject({ x: 2, y: 2, opts: { unitsX: 4, unitsY: 2 } });
    history.undo();
    expect(s().drawer.halfGrid).toBeUndefined();
    expect(s().bins[0]).toMatchObject({ x: 1, y: 1, opts: { unitsX: 2, unitsY: 1 } });
    history.redo();
    expect(s().bins[0].opts.unitsX).toBe(4);
    // Toggling to the state it's already in changes nothing.
    expect(s().setHalfGrid(true)).toBe(0);
  });

  it('"Fill empty" uses 1 × 1 u bins on a half grid, then half units', () => {
    const s = () => useStore.getState();
    s().resetAll();
    // 5 × 4 half cells: four 1 u bins, then a column of four half-unit bins.
    s().setDrawer({ mode: 'grid', gridX: 2.5, gridY: 2, halfGrid: true });
    expect(s().fillEmpty()).toBe(8);
    const sizes = s().bins.map((b) => `${b.opts.unitsX}x${b.opts.unitsY}`).sort();
    expect(sizes).toEqual(['1x1', '1x1', '1x1', '1x1', '2x2', '2x2', '2x2', '2x2']);
  });
});

describe('stretching into the gap', () => {
  const layout = computeLayout(REF); // margins: left/right 3, front/back 20

  it('has room only on sides that touch the grid edge, up to the plate edge', () => {
    expect(stretchRoom(layout, bin('a', 0, 0, 1, 1))).toEqual({ left: 3.25, right: 0, front: 20.25, back: 0 });
    expect(stretchRoom(layout, bin('a', 10, 6, 2, 2))).toEqual({ left: 0, right: 3.25, front: 0, back: 20.25 });
    expect(stretchRoom(layout, bin('a', 4, 3, 2, 2))).toEqual({ left: 0, right: 0, front: 0, back: 0 });
    // Grid mode has no margin to stretch into.
    const grid = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 });
    expect(autoStretch(grid, bin('a', 0, 0, 1, 1))).toBeUndefined();
  });

  it('is cut to the room the bin has, and ignored away from the edge', () => {
    const b = bin('a', 0, 0, 1, 1, { stretch: { left: 50, front: 5, right: 9 } });
    expect(effectiveStretch(layout, b)).toEqual({ left: 3.25, right: 0, front: 5, back: 0 });
    expect(effectiveStretch(layout, { ...b, x: 3, y: 2 })).toBeUndefined();
    expect(binCellsAt(layout, { ...b, x: 3, y: 2 })).toBeUndefined();
  });

  it('never runs into another bin or past the drawer', () => {
    const bins = [bin('a', 0, 0, 2, 1), bin('b', 0, 1, 1, 7), bin('c', 2, 0, 10, 1), bin('d', 11, 1, 1, 7), bin('e', 1, 1, 10, 7)];
    const rects = bins.map((b) => {
      const s = { ...b, stretch: autoStretch(layout, b) };
      const o = binOrigin(layout, s);
      const size = binSize(s.opts, binCellsAt(layout, s));
      return { x0: o.x, y0: o.y, x1: o.x + size.w, y1: o.y + size.d };
    });
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y0).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x1).toBeLessThanOrEqual(layout.plateW + 1e-6);
      expect(r.y1).toBeLessThanOrEqual(layout.plateD + 1e-6);
    }
    expect(rects[0]).toEqual({ x0: 0, y0: 0, x1: 3 + 84 - 0.25, y1: 20 + 42 - 0.25 });
    const overlap = (a: (typeof rects)[number], b: (typeof rects)[number]) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
  });

  it('grows the body; the feet stay on the grid, offset inside it', () => {
    const b = bin('a', 0, 0, 1, 1, { stretch: { left: 3.25, front: 20.25 } });
    const cells = binCellsAt(layout, b)!;
    expect(cells.stretch).toEqual({ left: 3.25, right: 0, front: 20.25, back: 0 });
    expect(binSize(b.opts, cells)).toEqual({ w: 44.75, d: 61.75 });
    expect(stretchOffset(cells.stretch)).toEqual({ fx: 1.625, fy: 10.125 });
    expect(binOrigin(layout, b)).toEqual({ x: 0, y: 0 });

    const mesh = buildBin(w, { ...b.opts, label: 'full', divX: 2 }, cells);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const bb = meshBounds(mesh);
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(44.75, 3);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(61.75, 3);
    // The foot is the classic one, moved to (fx, fy) from the body's center.
    const foot = sliceAt(mesh, 0.1);
    expect((foot.x0 + foot.x1) / 2).toBeCloseTo(1.625, 3);
    expect((foot.y0 + foot.y1) / 2).toBeCloseTo(10.125, 3);
    // Below STRETCH_Z only the feet's footprint; above it the whole body.
    const under = sliceAt(mesh, STRETCH_Z - 0.2);
    expect(under.x1 - under.x0).toBeCloseTo(41.5, 2);
    expect(under.y1 - under.y0).toBeCloseTo(41.5, 2);
    const over = sliceAt(mesh, STRETCH_Z + 0.2);
    expect(over.x1 - over.x0).toBeCloseTo(44.75, 2);
    expect(over.y1 - over.y0).toBeCloseTo(61.75, 2);
  });

  it('clears the top of the baseplate', () => {
    // A seated bin's bottom is 5 − topTrim below the plate's top; topTrim is never below 0.02.
    expect(STRETCH_Z).toBeGreaterThan(5 - 0.02 + 0.5 - 1e-9);
  });

  it.each([
    { name: 'lite base, magnets', o: { base: 'lite', holes: 'magnets' } },
    { name: 'efficient floor, compartments', o: { base: 'efficient', divX: 3, divY: 2 } },
    { name: 'flat base', o: { base: 'flat' } },
    { name: 'pocket grid, no lip', o: { interior: 'pockets', lip: false } },
    { name: 'lip notches (left off)', o: { lipNotches: true, scoop: 0.5 } },
  ])('stretched $name is one valid solid', ({ o }) => {
    const opts = { ...DEFAULT_BIN, unitsX: 2, unitsY: 1, ...o } as BinOptions;
    const b = { id: 'a', x: 10, y: 7, opts, stretch: { right: 3.25, back: 12 } };
    const c = check(buildBin(w, opts, binCellsAt(layout, b)));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
  });

  it('stretches half-grid bins too', () => {
    const half = computeLayout(HALF); // front margin 9.5
    const b = bin('a', 0, 0, 3, 2, { stretch: { front: 9.75, left: 3.25 } });
    const cells = binCellsAt(half, b)!;
    expect(cells.half && cells.stretch?.front).toBe(9.75);
    const c = check(buildBin(w, { ...b.opts, holes: 'magnets' }, cells));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
  });

  it('is in the mesh key, and the job uses the stretched footprint (no lid)', () => {
    const opts = { ...DEFAULT_BIN, lid: true };
    const plain = bin('a', 0, 0, 1, 1);
    const st = { ...plain, opts, stretch: { left: 3 } };
    expect(binSpec(layout, st).key).toContain('S3/0/0/0');
    expect(binSpec(layout, st).key).not.toBe(binSpec(layout, { ...st, stretch: { left: 2 } }).key);
    expect(binSpec(layout, { ...st, stretch: { left: 3 } }).key).toBe(binSpec(layout, st).key);
    // The lid only depends on the cells.
    expect(lidSpec(layout, st).key).toBe(lidSpec(layout, plain).key);
    const job = planJob({ ...DEFAULT_PROJECT, drawer: REF, bins: [st] });
    expect(job.parts['bin:a'].w).toBeCloseTo(44.5, 6);
    expect(job.parts['lid:a']).toBeUndefined();
    expect(job.warnings.some((m) => m.includes('no lid'))).toBe(true);
  });

  it('is sanitized', () => {
    expect(cleanStretch({ left: -3, right: 'x', front: 1e9, back: 2.345 })).toEqual({ left: 0, right: 0, front: 60, back: 2.35 });
    expect(cleanStretch({ left: 0 })).toBeUndefined();
    expect(cleanStretch('nope')).toBeUndefined();
  });
});

describe('saved projects', () => {
  const s = () => useStore.getState();
  beforeEach(() => s().resetAll());

  it('old drawers and bins load and build exactly as before', () => {
    s().loadProject({
      app: 'gridfit',
      drawer: { width: 510.5, depth: 376.5, clearance: 0.5, fill: 'half' },
      bins: [{ id: 'a', x: 0, y: 0, opts: { unitsX: 2, unitsY: 1 } }],
    });
    expect('halfGrid' in s().drawer).toBe(false);
    expect('stretch' in s().bins[0]).toBe(false);
    const job = planJob({ ...DEFAULT_PROJECT, drawer: s().drawer, bins: s().bins });
    expect(job.layout.nx).toBe(12);
    expect(job.parts['bin:a'].meshKey).toBe(`bin|${binKey(s().bins[0].opts)}`);
  });

  it('keep the half grid and stretch, cleaned', () => {
    s().loadProject({
      app: 'gridfit',
      drawers: [
        {
          id: 'd1',
          name: 'Half',
          drawer: { width: 300, depth: 200, halfGrid: true },
          bins: [
            { id: 'a', x: 0, y: 0, opts: { unitsX: 30, unitsY: 3 }, stretch: { left: 2, right: -1, front: 'junk' } },
            { id: 'b', x: 2, y: 0, opts: { unitsX: 1, unitsY: 1 }, stretch: { left: 0 } },
          ],
        },
        { id: 'd2', name: 'Odd', drawer: { width: 300, depth: 200, halfGrid: 'yes' }, bins: [] },
      ],
    });
    expect(s().drawer.halfGrid).toBe(true);
    expect(s().bins[0].opts.unitsX).toBe(24);
    expect(s().bins[0].stretch).toEqual({ left: 2, right: 0, front: 0, back: 0 });
    expect('stretch' in s().bins[1]).toBe(false);
    expect('halfGrid' in s().drawers[1].drawer).toBe(false);
  });

  it('updateBin sets and clears the stretch', () => {
    const id = s().addBin(0, 0, 1, 1);
    s().updateBin(id, { stretch: { front: 4 } });
    expect(s().bins[0].stretch).toEqual({ left: 0, right: 0, front: 4, back: 0 });
    s().updateBin(id, { x: 1 });
    expect(s().bins[0].stretch?.front).toBe(4);
    s().updateBin(id, { stretch: null });
    expect('stretch' in s().bins[0]).toBe(false);
  });
});
