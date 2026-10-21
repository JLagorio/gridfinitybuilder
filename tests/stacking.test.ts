import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binTotalHeight, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { buildBinLid, lidStackHeight, LID_HEIGHT } from '../src/lib/geometry/lid';
import { BASE_PROFILE_HEIGHT, LIP_TOP_FLAT } from '../src/lib/geometry/spec';
import { binSeatHeight, DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { computeLayout, DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planJob, planPrint, type PlacedBin } from '../src/lib/project';
import {
  SOCKET_SINK,
  STACK_SINK,
  alignStacks,
  binForStack,
  followFootprint,
  cleanStacks,
  columnIds,
  seatHeight,
  stackPlaces,
  stackProblem,
  stackWarnings,
  stacksOf,
  standingHeight,
  tallestStack,
  withBinsAbove,
  withNewIds,
} from '../src/lib/stacking';
import { canPlace, occupancy } from '../src/lib/bins';
import { switchHalfGrid } from '../src/lib/layout/halfgrid';
import { binEntries, drawerMaps, searchInventory } from '../src/lib/inventory';
import { billOfMaterials } from '../src/lib/bom';
import { encodeProject, decodeProject } from '../src/lib/share';
import { drawerAssemblies } from '../src/lib/export/step';
import { liftFactor } from '../src/components/viewerTools';
import { history, projectFile, selectedIds, useStore } from '../src/state/store';
import { copySelection, moveBins, nudgeSelection, pasteClipboard, removeSelection, resizeBin, selectBins } from '../src/state/selection';
import { roomForStack, stackBin, unstackBin } from '../src/state/stacks';
import { applyTemplateToBins, saveTemplate } from '../src/state/templates';

const opts = (o: Partial<BinOptions> = {}): BinOptions => ({ ...DEFAULT_BIN, ...o });
const bin = (id: string, x: number, y: number, o: Partial<BinOptions> = {}, on?: string): PlacedBin => ({ id, x, y, opts: opts(o), ...(on ? { on } : {}) });
const grid = (gridX = 4, gridY = 3): DrawerInput => ({ ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY });
const layout4 = computeLayout(grid());
const bed = { w: 236, d: 236, h: 250 };

describe('stack structure', () => {
  const bins = [bin('a', 0, 0, { unitsX: 2, unitsY: 2 }), bin('b', 0, 0, { unitsX: 2, unitsY: 2 }, 'a'), bin('c', 0, 0, { unitsX: 2, unitsY: 2 }, 'b'), bin('d', 2, 0)];

  it('finds columns, levels and floor bins', () => {
    const st = stacksOf(bins);
    expect(st.depth).toBe(3);
    expect(st.columns.get('a')!.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(st.columns.get('d')!.map((b) => b.id)).toEqual(['d']);
    expect([...st.level.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 0],
    ]);
    expect(st.root.get('c')).toBe('a');
  });

  it('a bin carries the bins above it; a column moves as one', () => {
    expect(withBinsAbove(bins, ['b'])).toEqual(['b', 'c']);
    expect(withBinsAbove(bins, ['a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(columnIds(bins, ['c'])).toEqual(['a', 'b', 'c']);
  });

  it('stacked bins take no floor space of their own', () => {
    const occ = occupancy(bins, 4, 3);
    expect(occ[0][0]).toBe('a');
    expect(occ[1][1]).toBe('a');
    // The column's own rect is free once its floor bin is left out, from any level.
    expect(canPlace(bins, { x: 0, y: 0, w: 3, d: 2 }, 4, 3, 'a')).toBe(false); // d is in the way
    expect(canPlace(bins, { x: 0, y: 0, w: 2, d: 3 }, 4, 3, 'a')).toBe(true);
    expect(canPlace(bins, { x: 0, y: 0, w: 2, d: 3 }, 4, 3, 'c')).toBe(true);
    expect(canPlace(bins, { x: 0, y: 0, w: 2, d: 3 }, 4, 3)).toBe(false);
  });

  it('gives fresh ids with the links remapped', () => {
    const copy = withNewIds(bins);
    expect(copy.map((b) => b.id)).not.toContain('a');
    expect(copy[1].on).toBe(copy[0].id);
    expect(copy[2].on).toBe(copy[1].id);
    expect(copy[3].on).toBeUndefined();
  });
});

describe('footprint and lip rules', () => {
  it('a stacked bin always has its floor bin’s footprint and stretch', () => {
    const odd = [bin('a', 1, 0, { unitsX: 2, unitsY: 1 }), { ...bin('b', 0, 2, { unitsX: 1, unitsY: 3 }, 'a'), stretch: { left: 3 } }];
    const out = alignStacks([{ ...odd[0], stretch: { right: 5 } }, odd[1]]);
    expect(out[1]).toMatchObject({ x: 1, y: 0, opts: { unitsX: 2, unitsY: 1 }, stretch: { right: 5 } });
    // Nothing to fix: the same array back.
    expect(alignStacks(out)).toBe(out);
  });

  it('only a top that takes bins can hold one', () => {
    const can = (o: Partial<BinOptions>, wall = false) => stackProblem(layout4, bin('x', 0, 0, o), wall);
    expect(can({})).toBeNull();
    expect(can({ lipStyle: 'reduced' })).toBeNull();
    expect(can({ lip: false })).toMatch(/no stacking lip/);
    // A sliding lid needs the lip off, so it never holds a bin.
    expect(can({ lip: false, slideLid: true })).toMatch(/no stacking lip/);
    // A stacking lid has a receptacle per cell on top; a pocket-grid lid doesn't.
    expect(can({ lid: true })).toBeNull();
    expect(can({ lid: true, lidStyle: 'pockets' })).toMatch(/pocket-grid lid/);
    expect(can({ container: 'drawers', heightUnits: 6 })).toBeNull();
    expect(can({ container: 'drawers', heightUnits: 6, containers: { drawers: { top: 'grid' } } })).toBeNull();
    expect(can({ container: 'drawers', heightUnits: 6, containers: { drawers: { top: 'flat' } } })).toMatch(/flat top/);
    expect(can({ container: 'box', containers: { box: { top: 'grid' } } })).toBeNull();
    expect(can({ container: 'box', containers: { box: { top: 'flat' } } })).toMatch(/flat lid/);
    expect(can({ container: 'hopper', containers: { hopper: { lip: true } } })).toBeNull();
    expect(can({ container: 'hopper' })).toMatch(/no stacking lip/);
    expect(can({ container: 'rack' })).toMatch(/no stacking lip/);
    expect(can({}, true)).toMatch(/wall grid/);
  });

  it('a bin stretched over the margin can’t hold one (its lip is off the grid)', () => {
    const d = { ...DEFAULT_DRAWER, width: 200, depth: 150 };
    const l = computeLayout(d);
    const edge = { ...bin('x', 0, 0), stretch: { left: 10 } };
    expect(stackProblem(l, edge)).toMatch(/margin/);
    // Kept but not used away from the edge: fine.
    expect(stackProblem(l, { ...edge, x: 1 })).toBeNull();
  });

  it('the new bin takes the footprint, the stretch and the height of the bin below', () => {
    const below = { ...bin('a', 1, 0, { unitsX: 2, unitsY: 2, heightUnits: 5 }), stretch: { back: 4 } };
    const r = binForStack(layout4, [below], below, opts({ heightUnits: 3, holes: 'magnets' }), bed);
    expect(r.error).toBeUndefined();
    expect(r.bin).toMatchObject({ x: 1, y: 0, on: 'a', stretch: { back: 4 }, opts: { unitsX: 2, unitsY: 2, heightUnits: 5, holes: 'magnets' } });
    expect(binForStack(layout4, [bin('n', 0, 0, { lip: false })], bin('n', 0, 0, { lip: false }), DEFAULT_BIN, bed).error).toMatch(/lip/);
  });

  it('stacking on a stacked bin goes on top of the stack', () => {
    const bins = [bin('a', 0, 0), bin('b', 0, 0, {}, 'a')];
    expect(binForStack(layout4, bins, bins[0], DEFAULT_BIN, bed).bin?.on).toBe('b');
  });

  it('cleans links from saved files', () => {
    const out = cleanStacks([
      bin('a', 0, 0, { unitsX: 2 }),
      bin('b', 3, 2, {}, 'a'), // wrong footprint
      bin('c', 1, 1, {}, 'a'), // a second bin on a: goes on top of the stack
      bin('d', 2, 2, {}, 'gone'), // missing base: on the floor
      bin('e', 0, 2, {}, 'f'), // a loop
      bin('f', 0, 2, {}, 'e'),
      bin('g', 3, 0, {}, 'g'), // itself
    ]);
    const on = Object.fromEntries(out.map((b) => [b.id, b.on]));
    expect(on).toEqual({ a: undefined, b: 'a', c: 'b', d: undefined, e: undefined, f: 'e', g: undefined });
    expect(out.find((b) => b.id === 'c')).toMatchObject({ x: 0, y: 0, opts: { unitsX: 2, unitsY: 1 } });
    expect('on' in out.find((b) => b.id === 'd')!).toBe(false);
    // Plain bins come back as they were.
    const plain = [bin('p', 0, 0)];
    expect(cleanStacks(plain)[0]).toBe(plain[0]);
  });
});

describe('height math', () => {
  it('a bin sinks 4.35 mm into the lip below (the foot profile less the lip’s trimmed top), 4 mm into floored sockets', () => {
    expect(STACK_SINK).toBeCloseTo(BASE_PROFILE_HEIGHT - LIP_TOP_FLAT, 9);
    expect(STACK_SINK).toBeCloseTo(4.35, 9);
    expect(SOCKET_SINK).toBeCloseTo(4, 9);
  });

  it('stacks two 3u bins 45.65 mm tall', () => {
    const bins = [bin('a', 0, 0), bin('b', 0, 0, {}, 'a')];
    const p = stackPlaces(layout4, bins);
    expect(binTotalHeight(DEFAULT_BIN)).toBeCloseTo(25, 9);
    expect(p.get('a')).toEqual({ z: 0, top: 25, level: 0 });
    expect(p.get('b')!.z).toBeCloseTo(20.65, 9);
    expect(p.get('b')!.top).toBeCloseTo(45.65, 9);
    expect(p.get('b')!.level).toBe(1);
  });

  it('counts lids, container tops and flat bases', () => {
    // On a stacking lid: on the lid's receptacles.
    const lidded = opts({ lid: true });
    expect(standingHeight(lidded)).toBeCloseTo(lidStackHeight(lidded), 9);
    expect(seatHeight(lidded, DEFAULT_BIN)).toBeCloseTo(21 - 0.35 + LID_HEIGHT - SOCKET_SINK, 9);
    // A stretched bin gets no lid printed, so nothing sits on one.
    expect(standingHeight(lidded, true)).toBeCloseTo(25, 9);
    // A drawer unit's lip starts at 7 mm × units; its bin sockets are sunk into the top.
    const unit = (top: string) => opts({ container: 'drawers', heightUnits: 6, containers: { drawers: { top } } });
    expect(seatHeight(unit('lip'), DEFAULT_BIN)).toBeCloseTo(42 - 0.35, 9);
    expect(seatHeight(unit('grid'), DEFAULT_BIN)).toBeCloseTo(42 - SOCKET_SINK, 9);
    // A parts box's lid has sockets too (grid or lip top).
    const box = opts({ container: 'box', containers: { box: { top: 'grid' } } });
    expect(seatHeight(box, DEFAULT_BIN)).toBeCloseTo(standingHeight(box) - 4, 9);
    // A flat base has no feet: it rests on the lip.
    expect(seatHeight(DEFAULT_BIN, { base: 'flat' })).toBeCloseTo(25, 9);
  });

  it('warns when a stack is taller than the drawer, or stands on a bin that can’t hold it', () => {
    const bins = [bin('a', 0, 0), bin('b', 0, 0, {}, 'a'), bin('c', 2, 0, { lip: false }), bin('d', 2, 0, {}, 'c')];
    expect(stackWarnings(layout4, bins, 100)).toEqual(['Bin 1×1×3u can’t hold the bin stacked on it. It has no stacking lip.']);
    const tall = stackWarnings(layout4, bins.slice(0, 2), 40);
    expect(tall).toEqual([expect.stringMatching(/stack on bin 1×1×3u is 45.65 mm tall, taller than the drawer \(40 mm/)]);
    // A bin too tall on its own already has a warning of its own.
    expect(stackWarnings(layout4, bins.slice(0, 2), 20)).toEqual([]);
  });

  it('planning warns about stacks taller than the drawer', () => {
    const drawer: DrawerInput = { ...grid(), mode: 'drawer', width: 200, depth: 150, height: 50 };
    const room = 50 - binSeatHeight(DEFAULT_BASEPLATE);
    const bins = [bin('a', 0, 0, { heightUnits: 4 }), bin('b', 0, 0, { heightUnits: 4 }, 'a')];
    const job = planJob({ drawer, baseplate: DEFAULT_BASEPLATE, setup: DEFAULT_SETUP, bins, include: { baseplate: true, bins: true } });
    expect(job.drawers[0].room).toBeCloseTo(room, 9);
    expect(job.warnings.some((w) => /The stack on bin 1×1×4u is 59.65 mm tall, taller than the drawer/.test(w))).toBe(true);
    // Each bin fits on its own, so there's no other height warning.
    expect(job.warnings.filter((w) => /taller than/.test(w))).toHaveLength(1);
  });

  it('the new bin is lowered to fit the room left above the stack, and refused when none is left', () => {
    const below = bin('a', 0, 0, { heightUnits: 6 });
    // 6u + lip = 46; the next bin starts at 41.65.
    const r = binForStack(layout4, [below], below, DEFAULT_BIN, bed, 41.65 + 7 * 3 + 4);
    expect(r.bin?.opts.heightUnits).toBe(3);
    expect(binForStack(layout4, [below], below, DEFAULT_BIN, bed, 50).error).toMatch(/No room on top/);
    // And to the printer's height.
    expect(binForStack(layout4, [below], below, DEFAULT_BIN, { ...bed, h: 7 * 4 + 4 }).bin?.opts.heightUnits).toBe(4);
  });

  it('a carry case of automatic height grows to the tallest stack', () => {
    expect(tallestStack([{ id: 'a', opts: DEFAULT_BIN }, { id: 'b', on: 'a', opts: DEFAULT_BIN }])).toBeCloseTo(45.65, 9);
    const drawer: DrawerInput = { ...DEFAULT_DRAWER, width: 200, depth: 150, enclosure: 'case' };
    const bins = [bin('a', 0, 0, { heightUnits: 6 }), bin('b', 0, 0, { heightUnits: 6 }, 'a')];
    const job = planJob({ drawer, baseplate: DEFAULT_BASEPLATE, setup: DEFAULT_SETUP, bins, include: { baseplate: true, bins: true } });
    expect(job.drawers[0].room).toBeGreaterThan(46 + 41.65);
    expect(job.warnings.filter((w) => /taller than/.test(w))).toEqual([]);
    // So a new stacked bin always has room; a case of set height doesn't grow.
    expect(roomForStack(drawer, 50)).toBe(Infinity);
    expect(roomForStack({ ...drawer, carryCase: { height: 80 } }, 50)).toBe(50);
    expect(roomForStack(DEFAULT_DRAWER, 50)).toBe(50);
  });
});

describe('the seat matches the geometry', () => {
  let w: Wasm;
  beforeAll(async () => {
    w = await Module();
    w.setup();
  });
  const solid = (m: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
  /** Overlap (mm³) of the bin above with the part below when it's put `dz` lower than the seat. */
  const overlap = (below: MeshData, above: MeshData, seat: number, dz: number) => {
    const a = solid(below);
    const b = solid(above).translate([0, 0, seat - dz]);
    const i = a.intersect(b);
    const v = i.volume();
    [a, b, i].forEach((m) => m.delete());
    return v;
  };

  it('a bin rests in the lip of the bin below: lower would collide, higher floats', () => {
    const below = buildBin(w, opts({ heightUnits: 2 }));
    const above = buildBin(w, opts({ heightUnits: 2 }));
    const seat = seatHeight(opts({ heightUnits: 2 }), DEFAULT_BIN);
    expect(overlap(below, above, seat, 0)).toBeLessThan(0.5);
    expect(overlap(below, above, seat, 0.15)).toBeGreaterThan(5);
  });

  it('a bin rests on the floor of a stacking lid’s sockets', () => {
    const o = opts({ heightUnits: 2, lid: true });
    const lid = buildBinLid(w, o);
    const above = buildBin(w, opts({ heightUnits: 2 }));
    // The lid's bottom sits where lidStackHeight puts it; the bin's seat is measured from the bin's bottom.
    const lidBottom = lidStackHeight(o) - LID_HEIGHT;
    const seat = seatHeight(o, DEFAULT_BIN) - lidBottom;
    expect(overlap(lid, above, seat, 0)).toBeLessThan(0.5);
    expect(overlap(lid, above, seat, 0.15)).toBeGreaterThan(5);
  });

  it.each(['lip', 'grid'])('a bin rests on a drawer unit’s %s top', (top) => {
    const o = opts({ container: 'drawers', heightUnits: 4, containers: { drawers: { top, rows: 1, cols: 1 } } });
    const below = buildBin(w, o);
    const above = buildBin(w, opts({ heightUnits: 2 }));
    const seat = seatHeight(o, DEFAULT_BIN);
    expect(overlap(below, above, seat, 0)).toBeLessThan(0.5);
    expect(overlap(below, above, seat, 0.15)).toBeGreaterThan(5);
  });
});

describe('store: stacking', () => {
  const s = () => useStore.getState();
  const sel = () => selectedIds(s().ui);
  const find = (id: string) => s().bins.find((b) => b.id === id)!;
  const rect = (id: string) => {
    const b = find(id);
    return [b.x, b.y, b.opts.unitsX, b.opts.unitsY];
  };

  beforeEach(() => {
    s().resetAll();
    s().setDrawer({ mode: 'grid', gridX: 4, gridY: 3 });
    history.clear();
  });

  it('stacks a bin on the selected one and selects it; undo takes it off', () => {
    const a = s().addBin(0, 0, 2, 2);
    history.checkpoint();
    const r = stackBin(a);
    expect(r.error).toBeUndefined();
    const up = r.id!;
    expect(find(up)).toMatchObject({ on: a, x: 0, y: 0, opts: { unitsX: 2, unitsY: 2, heightUnits: 3 } });
    expect(sel()).toEqual([up]);
    history.undo();
    expect(s().bins.map((b) => b.id)).toEqual([a]);
    history.redo();
    expect(find(up).on).toBe(a);
  });

  it('refuses a bin without a lip, and on a wall grid', () => {
    const a = s().addBin(0, 0, 1, 1);
    s().updateBin(a, { opts: { lip: false } });
    expect(stackBin(a).error).toMatch(/lip/);
    s().updateBin(a, { opts: { lip: true } });
    s().setDrawer({ mode: 'drawer', width: 200, depth: 150, enclosure: 'wall' });
    expect(stackBin(a).error).toMatch(/wall grid/);
  });

  it('moving the floor bin (or nudging any level) moves the whole stack', () => {
    const a = s().addBin(0, 0, 2, 2);
    const up = stackBin(a).id!;
    const top = stackBin(up).id!;
    expect(moveBins([a], 1, 0)).toBe(true);
    expect([rect(a), rect(up), rect(top)]).toEqual([
      [1, 0, 2, 2],
      [1, 0, 2, 2],
      [1, 0, 2, 2],
    ]);
    selectBins([top]);
    expect(nudgeSelection(0, 1)).toBe(true);
    expect(rect(a)).toEqual([1, 1, 2, 2]);
    expect(rect(up)).toEqual([1, 1, 2, 2]);
    // Bins beside a stack still block it.
    s().addBin(3, 0, 1, 1);
    expect(moveBins([up], 1, -1)).toBe(false);
  });

  it('resizing any level resizes the whole stack; undo puts it back', () => {
    const a = s().addBin(0, 0, 1, 1);
    const up = stackBin(a).id!;
    history.checkpoint();
    resizeBin(a, { x: 0, y: 0, w: 2, d: 3 });
    expect(rect(up)).toEqual([0, 0, 2, 3]);
    history.checkpoint();
    s().updateBin(up, { opts: { unitsX: 3 } });
    expect(rect(a)).toEqual([0, 0, 3, 3]);
    history.undo();
    expect([rect(a), rect(up)]).toEqual([
      [0, 0, 2, 3],
      [0, 0, 2, 3],
    ]);
    history.undo();
    expect([rect(a), rect(up)]).toEqual([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it('a resize the printer can’t take is refused for the whole stack', () => {
    s().setSetup({ bedW: 150, bedD: 150, plateMargin: 5, maxH: 250 });
    const a = s().addBin(0, 0, 1, 1);
    const up = stackBin(a).id!;
    resizeBin(up, { x: 0, y: 0, w: 3, d: 3 });
    expect([rect(a), rect(up)]).toEqual([
      [0, 0, 3, 3],
      [0, 0, 3, 3],
    ]);
    // 4 × 3 is 167.5 mm: past the 140 mm the bed takes.
    resizeBin(a, { x: 0, y: 0, w: 4, d: 3 });
    expect([rect(a), rect(up)]).toEqual([
      [0, 0, 3, 3],
      [0, 0, 3, 3],
    ]);
    // Any bin of the stack that would fit worse stops the others too.
    const prev = s().bins;
    const next = prev.map((b) => (b.id === a ? { ...b, opts: { ...b.opts, unitsX: 4 } } : b));
    expect(followFootprint(prev, next, a, computeLayout(s().drawer), { w: 140, d: 140, h: 250 })).toBe(prev);
  });

  it('deleting a bin takes the bins stacked on it; undo brings them back', () => {
    const a = s().addBin(0, 0, 2, 2);
    const up = stackBin(a).id!;
    const top = stackBin(up).id!;
    const other = s().addBin(2, 0, 1, 1);
    history.checkpoint();
    selectBins([up]);
    removeSelection();
    expect(s().bins.map((b) => b.id)).toEqual([a, other]);
    history.undo();
    expect(s().bins.map((b) => b.id)).toEqual([a, up, top, other]);
    history.checkpoint();
    s().removeBin(a);
    expect(s().bins.map((b) => b.id)).toEqual([other]);
  });

  it('moves a stacked bin (and what’s on it) to the floor', () => {
    const a = s().addBin(0, 0, 2, 2);
    const up = stackBin(a).id!;
    const top = stackBin(up).id!;
    expect(unstackBin(up)).toBe(true);
    expect(find(up).on).toBeUndefined();
    expect(find(top).on).toBe(up);
    expect(rect(up)).toEqual([2, 0, 2, 2]);
    expect(rect(top)).toEqual([2, 0, 2, 2]);
    expect(rect(a)).toEqual([0, 0, 2, 2]);
    // No room left on the floor.
    const again = stackBin(a).id!;
    expect(unstackBin(again)).toBe(false);
  });

  it('copy and paste bring the stack along, linked to the copies', () => {
    const a = s().addBin(0, 0, 1, 1);
    const up = stackBin(a).id!;
    s().setBinContents(up, 'M3 screws');
    selectBins([a]);
    expect(copySelection()).toBe(1);
    const pasted = pasteClipboard([2, 1]);
    expect(pasted).toHaveLength(2);
    const [pa, pu] = pasted.map(find);
    expect(rect(pa.id)).toEqual([2, 1, 1, 1]);
    expect(pu).toMatchObject({ on: pa.id, x: 2, y: 1, contents: 'M3 screws' });
    // An upper bin copied on its own lands on the floor.
    selectBins([up]);
    copySelection();
    const [alone] = pasteClipboard([3, 2]).map(find);
    expect(alone.on).toBeUndefined();
  });

  it('templates keep the stack’s footprint', () => {
    const a = s().addBin(0, 0, 2, 1);
    const up = stackBin(a).id!;
    const t = saveTemplate('Tall', opts({ unitsX: 1, unitsY: 1, heightUnits: 6 }));
    applyTemplateToBins(t, [up]);
    expect(find(up).opts).toMatchObject({ unitsX: 2, unitsY: 1, heightUnits: 6 });
  });

  it('half-grid conversion keeps stacks together', () => {
    const a = s().addBin(1, 0, 2, 1);
    const up = stackBin(a).id!;
    s().setHalfGrid(true);
    expect(rect(a)).toEqual([2, 0, 4, 2]);
    expect(rect(up)).toEqual(rect(a));
    expect(find(up).on).toBe(a);
    s().setHalfGrid(false);
    expect(rect(up)).toEqual([1, 0, 2, 1]);
    // Straight from the library function too.
    const r = switchHalfGrid(grid(), [bin('x', 0, 0), bin('y', 0, 0, {}, 'x'), bin('z', 1, 0)], true);
    expect(r.bins.map((b) => [b.id, b.x, b.y, b.opts.unitsX, b.on])).toEqual([
      ['x', 0, 0, 2, undefined],
      ['y', 0, 0, 2, 'x'],
      ['z', 2, 0, 2, undefined],
    ]);
  });

  it('duplicating a drawer keeps its stacks', () => {
    const a = s().addBin(0, 0, 1, 1);
    stackBin(a);
    s().duplicateDrawer(s().activeDrawerId);
    const [x, y] = s().bins;
    expect(x.id).not.toBe(a);
    expect(y.on).toBe(x.id);
  });

  it('project files and share links keep stacks; old files load as floor bins', () => {
    const a = s().addBin(0, 0, 2, 2);
    const up = stackBin(a).id!;
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    s().resetAll();
    s().loadProject(decodeProject(encodeProject(file)));
    expect(find(up)).toMatchObject({ on: a, x: 0, y: 0, opts: { unitsX: 2, unitsY: 2 } });
    s().loadProject({ app: 'gridfit', version: 2, drawers: [{ id: 'd1', name: 'Old', bins: [{ id: 'q', x: 1, y: 1, opts: { unitsX: 2 } }] }] });
    expect(s().bins).toHaveLength(1);
    expect('on' in s().bins[0]).toBe(false);
  });
});

describe('everything else that lists bins', () => {
  const drawer: DrawerInput = { ...DEFAULT_DRAWER, mode: 'drawer', width: 200, depth: 150, height: 100 };
  const bins: PlacedBin[] = [
    { ...bin('a', 0, 0, { unitsX: 2, label: 'full', labelText: 'Floor' }), contents: 'Washers' },
    { ...bin('b', 0, 0, { unitsX: 2, holes: 'magnets', label: 'full', labelText: 'Upper' }, 'a'), contents: 'Hex keys' },
    bin('c', 2, 0),
  ];
  const doc = { id: 'd1', name: 'Bench', drawer, baseplate: DEFAULT_BASEPLATE, bins };

  it('plans, prints and counts stacked bins like any other', () => {
    const job = planPrint([doc], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.parts['bin:b']).toBeDefined();
    expect(job.plates.some((pl) => pl.placements.some((p) => p.key === 'bin:b'))).toBe(true);
    expect(job.warnings.filter((w) => /stack/i.test(w))).toEqual([]);
    const bom = billOfMaterials(job);
    expect(bom.parts.bins).toBe(3);
    expect(bom.hardware.find((h) => /Magnets.*bins/.test(h.item))?.count).toBe(8);
  });

  it('puts stacked bins on the bin below in the assembled drawer', () => {
    const job = planPrint([doc], DEFAULT_SETUP, { baseplate: true, bins: true });
    const [asm] = drawerAssemblies(job, [doc]);
    const z = (name: RegExp) => asm.items.find((i) => name.test(i.name))!.transform[11];
    const seat = binSeatHeight(DEFAULT_BASEPLATE);
    expect(z(/Floor/)).toBeCloseTo(seat, 9);
    expect(z(/Upper/)).toBeCloseTo(seat + 20.65, 9);
  });

  it('lists and finds stacked bins with their level', () => {
    const entries = binEntries([doc]);
    expect(entries.map((e) => [e.bin.id, e.pos, e.level])).toEqual([
      ['a', 'A1', 0],
      ['b', 'A1 · level 2', 1],
      ['c', 'C1', 0],
    ]);
    const hit = searchInventory([doc], 'hex keys')[0];
    expect(hit).toMatchObject({ binId: 'b', pos: 'A1 · level 2' });
  });

  it('draws a drawer map per level', () => {
    const maps = drawerMaps(doc);
    expect(maps.map((m) => [m.id, m.name])).toEqual([
      ['d1', 'Bench'],
      ['d1:level2', 'Bench · level 2'],
    ]);
    expect(maps[0].body).toContain('data-bin="a"');
    expect(maps[0].body).not.toContain('data-bin="b"');
    expect(maps[0].body).toContain('+1 on top');
    expect(maps[1].body).toContain('data-bin="b"');
    expect(maps[1].body).toContain('Hex keys');
    expect(maps[1].body).not.toContain('data-bin="c"');
    // Without stacks there's just the one map.
    expect(drawerMaps({ ...doc, bins: [bins[2]] })).toHaveLength(1);
  });

  it('lifts each level by one more lift height in the 3D view', () => {
    expect([liftFactor({ lift: true }), liftFactor({ lift: 2 }), liftFactor({})]).toEqual([1, 2, 0]);
  });
});
