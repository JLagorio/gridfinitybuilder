import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binLabel, binSize, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import {
  autoNotches,
  cutoutArea,
  cutoutStyle,
  labelPlacement,
  pocketBox,
  sanitizeCutouts,
  toBin,
  toTool,
  type BinCutout,
  type Pt,
} from '../src/lib/geometry/cutouts';
import { registerFont } from '../src/lib/geometry/text';
import { HEIGHT_UNIT, LIP_SUPPORT_HEIGHT } from '../src/lib/geometry/spec';
import {
  cutoutFromTool,
  cutoutIssues,
  findFreePlacement,
  fitBinForTools,
  firstFreeSpot,
  heightUnitsFor,
  normalizeOutline,
  pocketGap,
  type Tool,
} from '../src/lib/tools';
import { allDrawers, projectFile, useStore } from '../src/state/store';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { signedArea } from '../src/lib/trace/polygon';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

function check(mesh: MeshData) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const rect = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

const wrench: Pt[] = normalizeOutline([
  // A crude open-end wrench: a bar with a jaw notch at one end (non-convex).
  [0, 0],
  [90, 0],
  [90, 4],
  [100, 4],
  [104, 10],
  [100, 16],
  [90, 16],
  [90, 20],
  [0, 20],
  [-8, 14],
  [-4, 10],
  [-8, 6],
]);

const cut = (o: Partial<BinCutout> = {}): BinCutout => ({
  toolId: 't',
  name: 'Tool',
  x: 0,
  y: 0,
  rotation: 0,
  outline: rect(30, 15),
  depth: 8,
  clearance: 0,
  ...o,
});

const bin = (cutouts: BinCutout[], o: Partial<BinOptions> = {}): BinOptions => ({
  ...DEFAULT_BIN,
  unitsX: 2,
  unitsY: 1,
  heightUnits: 4,
  cutouts,
  cutoutStyle: { edge: 'none' },
  ...o,
});

describe('pocket geometry', () => {
  it('cuts a pocket exactly as deep and as big as the tool', () => {
    const shallow = check(buildBin(w, bin([cut({ depth: 5 })])));
    const deep = check(buildBin(w, bin([cut({ depth: 10 })])));
    expect(deep.status).toBe('NoError');
    expect(deep.components).toBe(1);
    expect(deep.genus).toBe(0);
    expect(shallow.volume - deep.volume).toBeCloseTo(30 * 15 * 5, 1);
    // Clearance grows the outline by c on every side (round joins): + perimeter·c + πc².
    const loose = check(buildBin(w, bin([cut({ depth: 10, clearance: 1 })])));
    const grown = (30 * 2 + 15 * 2) * 1 + Math.PI;
    expect(deep.volume - loose.volume).toBeGreaterThan((grown - 0.05) * 10);
    expect(deep.volume - loose.volume).toBeLessThan((grown + 0.01) * 10);
  });

  it('fills the bin solid (no compartments) and keeps its outside dimensions', () => {
    const o = bin([cut()], { divX: 3, label: 'full', scoop: 1 });
    const mesh = buildBin(w, o);
    const b = meshBounds(mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(2 * 42 - 0.5, 3);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(o), 3);
    // Same as without the compartment settings: they're ignored.
    const plain = check(buildBin(w, bin([cut()])));
    expect(check(mesh).volume).toBeCloseTo(plain.volume, 3);
  });

  it.each([
    { name: 'chamfered edge', style: { edge: 'chamfer' as const, edgeSize: 1 } },
    { name: 'rounded edge', style: { edge: 'round' as const, edgeSize: 1.5 } },
    { name: 'deeper than the tool', style: { edge: 'none' as const, extraDepth: 1.5 } },
  ])('$name: one valid solid, more removed than the plain pocket', ({ style }) => {
    const plain = check(buildBin(w, bin([cut({ outline: wrench, clearance: 0.8 })])));
    const styled = check(buildBin(w, bin([cut({ outline: wrench, clearance: 0.8 })], { cutoutStyle: style })));
    expect(styled.status).toBe('NoError');
    expect(styled.components).toBe(1);
    expect(styled.genus).toBe(0);
    expect(styled.volume).toBeLessThan(plain.volume - 1);
  });

  it('finger notches, labels, rotation and several tools stay valid', () => {
    const o = bin(
      [
        cut({ outline: wrench, clearance: 1, x: 0, y: 5, rotation: 15, notches: autoNotches(wrench), label: true, name: 'Wrench 10' }),
        cut({ outline: rect(20, 6), x: -25, y: -10, rotation: 90, depth: 4, notches: [[0, 3]], label: true, name: 'Bit' }),
      ],
      { unitsX: 3, unitsY: 2, cutoutStyle: { edge: 'chamfer', edgeSize: 0.6 }, holes: 'magnets' },
    );
    const withAll = check(buildBin(w, o));
    expect(withAll.status).toBe('NoError');
    expect(withAll.components).toBe(1);
    const noLabels = check(buildBin(w, { ...o, cutouts: o.cutouts!.map((c) => ({ ...c, label: false })) }));
    const noNotches = check(buildBin(w, { ...o, cutouts: o.cutouts!.map((c) => ({ ...c, notches: [] })) }));
    expect(noLabels.volume - withAll.volume).toBeGreaterThan(5);
    expect(noNotches.volume - withAll.volume).toBeGreaterThan(100);
  });

  it('a pocket hanging over the edge is clipped by the wall, never through it', () => {
    const inside = buildBin(w, bin([cut({ x: 0 })]));
    const over = buildBin(w, bin([cut({ x: 40, y: 15 })]));
    const c = check(over);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    expect(meshBounds(over)).toEqual(meshBounds(inside));
  });

  it('never cuts below the standard floor', () => {
    const o = bin([cut({ depth: 200 })], { heightUnits: 3 });
    const deepest = check(buildBin(w, o));
    const room = HEIGHT_UNIT * 3 - LIP_SUPPORT_HEIGHT - 7;
    const atRoom = check(buildBin(w, bin([cut({ depth: room })], { heightUnits: 3 })));
    expect(deepest.volume).toBeCloseTo(atRoom.volume, 3);
    expect(cutoutIssues(o, binSize(o).w, binSize(o).d, HEIGHT_UNIT * 3 - LIP_SUPPORT_HEIGHT)[0].tooDeep).toBe(true);
  });
});

describe('cutout data', () => {
  it('binKey changes with the tool and stays the same for plain bins', () => {
    const base = binKey(sanitizeBin(DEFAULT_BIN));
    expect(binKey(sanitizeBin({ ...DEFAULT_BIN, cutouts: [] }))).toBe(base);
    const a = binKey(bin([cut()]));
    expect(a).not.toBe(base);
    expect(binKey(bin([cut({ depth: 9 })]))).not.toBe(a);
    expect(binKey(bin([cut({ outline: rect(30, 16) })]))).not.toBe(a);
    expect(binKey(bin([cut()], { cutoutStyle: { edge: 'round' } }))).not.toBe(a);
    expect(binKey(bin([cut()]))).toBe(a);
    expect(binLabel(bin([cut(), cut()]))).toBe('2×1×4u 2 tool pockets');
  });

  it('sanitizes cutouts', () => {
    expect(sanitizeCutouts([])).toBeUndefined();
    expect(sanitizeCutouts('nope')).toBeUndefined();
    const s = sanitizeCutouts([
      { outline: [[0, 0]] },
      { toolId: 7, x: '3', y: null, rotation: 540, outline: rect(1, 1), depth: -5, clearance: 99, notches: [[1, 'x'], [2, 3]], label: 1 },
    ])!;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ toolId: '7', x: 3, y: 0, rotation: 180, depth: 0.2, clearance: 10, notches: [[2, 3]], label: true });
    const o = sanitizeBin({ ...DEFAULT_BIN, cutouts: [], cutoutStyle: { edge: 'bogus' as never, edgeSize: 99 } });
    expect(o.cutouts).toBeUndefined();
    expect(cutoutStyle(o)).toMatchObject({ edge: 'chamfer', edgeSize: 5 });
  });

  it('frames, boxes, notches and label placement', () => {
    const c = cut({ x: 10, y: -5, rotation: 90, clearance: 1 });
    const p = toBin(c, [15, 0]);
    expect(p[0]).toBeCloseTo(10, 9);
    expect(p[1]).toBeCloseTo(10, 9);
    const back = toTool(c, p);
    expect(back[0]).toBeCloseTo(15, 9);
    expect(back[1]).toBeCloseTo(0, 9);
    const b = pocketBox(c);
    expect(b.x1 - b.x0).toBeCloseTo(17, 9);
    expect(b.y1 - b.y0).toBeCloseTo(32, 9);
    expect(autoNotches(rect(30, 10))).toEqual([
      [0, 5],
      [0, -5],
    ]);
    expect(autoNotches(rect(10, 30))).toEqual([
      [5, 0],
      [-5, 0],
    ]);
    const area = cutoutArea(83.5, 41.5, true);
    const st = cutoutStyle({});
    // In front of the pocket when there's room, behind it when not.
    expect(labelPlacement(cut({ y: 5 }), st, area).y).toBeCloseTo(5 - 7.5 - 1.5 - 2.5, 9);
    expect(labelPlacement(cut({ y: -10 }), st, area).y).toBeGreaterThan(-2.5);
    expect(labelPlacement(cut({ labelOffset: [3, 4] }), st, area)).toMatchObject({ x: 3, y: 4 });
  });
});

describe('tools and bin fitting', () => {
  const tool = (o: Partial<Tool> = {}): Tool => ({ id: 'a', name: 'A', outline: rect(100, 20), depth: 12, clearance: 1, ...o });

  it('normalizes outlines: counter-clockwise, centered on the bounding box', () => {
    const cw: Pt[] = [
      [10, 10],
      [10, 30],
      [50, 30],
      [50, 10],
    ];
    const n = normalizeOutline(cw);
    expect(signedArea(n)).toBeGreaterThan(0);
    expect(n).toContainEqual([-20, -10]);
    expect(n).toContainEqual([20, 10]);
    expect(normalizeOutline([[0, 0], [1, 1]])).toEqual([]);
  });

  it('sizes a bin for one tool, rotating it if that saves cells', () => {
    const f = fitBinForTools([tool()], { lip: true });
    // 102 × 22 mm pocket + 2 × 3 mm margin + 2 × 2.6 mm lip → 3 × 1 units.
    expect([f.unitsX, f.unitsY]).toEqual([3, 1]);
    expect(f.heightUnits).toBe(heightUnitsFor(12, true));
    expect(f.heightUnits).toBe(3); // 7 + 12 + 1.2 = 20.2 mm → 3 u
    expect(f.fits).toBe(true);
    // A tool traced at an angle gets straightened.
    const tilted = normalizeOutline(rect(100, 20).map(([x, y]) => [x * Math.cos(0.5236) - y * Math.sin(0.5236), x * Math.sin(0.5236) + y * Math.cos(0.5236)] as Pt));
    const t = fitBinForTools([tool({ outline: tilted })], { lip: true });
    expect(t.unitsX * t.unitsY).toBe(3);
    expect(Math.round(t.cutouts[0].rotation) % 90).toBe(60);
    // The pocket fits inside the opening with the margin.
    const o = { ...DEFAULT_BIN, unitsX: t.unitsX, unitsY: t.unitsY, heightUnits: t.heightUnits, cutouts: t.cutouts };
    const { w: W, d: D } = binSize(o);
    const issues = cutoutIssues(o, W, D, 7 * o.heightUnits - LIP_SUPPORT_HEIGHT);
    expect(issues[0]).toEqual({ outside: false, overlaps: [], tooDeep: false });
  });

  it('lays out several tools side by side without overlaps', () => {
    const tools = [tool({ id: 'a' }), tool({ id: 'b', outline: rect(80, 15), depth: 20 }), tool({ id: 'c', outline: rect(60, 30) })];
    const f = fitBinForTools(tools, { lip: true });
    expect(f.heightUnits).toBe(heightUnitsFor(20, true));
    const o = { ...DEFAULT_BIN, unitsX: f.unitsX, unitsY: f.unitsY, heightUnits: f.heightUnits, cutouts: f.cutouts };
    const { w: W, d: D } = binSize(o);
    const issues = cutoutIssues(o, W, D, 7 * o.heightUnits - LIP_SUPPORT_HEIGHT);
    expect(issues.every((i) => !i.outside && !i.overlaps.length && !i.tooDeep)).toBe(true);
    expect(f.unitsX * f.unitsY).toBeLessThanOrEqual(9);
    expect(pocketGap(f.cutouts[0], f.cutouts[1]).d).toBeGreaterThanOrEqual(3.9);
    const valid = check(buildBin(w, o));
    expect(valid.status).toBe('NoError');
    expect(valid.components).toBe(1);
  });

  it('finds a free spot for another tool', () => {
    const area = cutoutArea(125.5, 83.5, true);
    const first = cutoutFromTool(tool(), 0, 0, 0);
    const spot = findFreePlacement([first], tool({ id: 'b' }), area);
    const second = cutoutFromTool(tool({ id: 'b' }), spot.x, spot.y, spot.rotation);
    expect(pocketGap(first, second).d).toBeGreaterThanOrEqual(4 - 1e-6);
    const b = pocketBox(second);
    expect(b.y0).toBeGreaterThanOrEqual(area.y0 - 1e-6);
    expect(b.y1).toBeLessThanOrEqual(area.y1 + 1e-6);
  });

  it('finds the first free spot on full cells', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 });
    expect(firstFreeSpot(layout, [], 3, 1)).toEqual({ x: 0, y: 0 });
    const taken = [{ id: 'x', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2 } }];
    expect(firstFreeSpot(layout, taken, 3, 1)).toEqual({ x: 0, y: 1 });
    expect(firstFreeSpot(layout, taken, 5, 1)).toBeNull();
  });
});

describe('tool library in the store', () => {
  const s = () => useStore.getState();
  // The library survives a reset (like templates), so clear it too.
  beforeEach(() => {
    s().resetAll();
    useStore.setState({ tools: [] });
  });

  it('adds, updates (bins follow, in every drawer) and removes tools', () => {
    const id = s().addTool({ name: 'Pliers', outline: rect(120, 40).map(([x, y]) => [x + 500, y + 500] as Pt), depth: 15, clearance: 1 });
    expect(s().tools).toHaveLength(1);
    expect(s().tools[0].outline).toContainEqual([-60, -20]);
    const tool = s().tools[0];
    const b1 = s().addBin(0, 0, 3, 1);
    s().updateBin(b1, { opts: { cutouts: [cutoutFromTool(tool)] } });
    const first = s().activeDrawerId;
    s().addDrawer('Other');
    const b2 = s().addBin(0, 0, 3, 1);
    expect(s().bins.find((b) => b.id === b2)!.opts.cutouts).toBeUndefined(); // new bins don't inherit pockets
    s().updateBin(b2, { opts: { cutouts: [cutoutFromTool(tool, 5, 0, 0)] } });

    s().updateTool(id, { depth: 18, name: 'Big pliers' });
    const pockets = allDrawers(s()).flatMap((d) => d.bins.flatMap((b) => b.opts.cutouts ?? []));
    expect(pockets).toHaveLength(2);
    expect(pockets.every((c) => c.depth === 18 && c.name === 'Big pliers')).toBe(true);
    expect(pockets[0].outline).toBe(s().tools[0].outline); // untouched outline stays the same object

    // Saved files carry the library.
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    expect(file.tools).toHaveLength(1);
    s().removeTool(id);
    expect(s().tools).toHaveLength(0);
    expect(allDrawers(s()).flatMap((d) => d.bins.flatMap((b) => b.opts.cutouts ?? []))).toHaveLength(0);
    s().loadProject(file);
    expect(s().tools.map((t) => t.name)).toEqual(['Big pliers']);
    s().switchDrawer(first);
    expect(s().bins[0].opts.cutouts?.[0].depth).toBe(18);
  });

  it('"Use for new bins" never copies pockets', () => {
    s().setNewBin({ heightUnits: 5, cutouts: [cut()] });
    expect(s().newBin.cutouts).toBeUndefined();
    expect(s().newBin.heightUnits).toBe(5);
  });
});
