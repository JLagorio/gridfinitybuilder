import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshVolume } from '../src/lib/geometry/volume';
import {
  DEFAULT_BIN,
  binCompartmentPockets,
  binInnerSize,
  binKey,
  binLabel,
  binLabelPlates,
  binLabelTabs,
  binLabelTexts,
  binLayout,
  binSize,
  buildBin,
  sanitizeBin,
  type BinOptions,
} from '../src/lib/geometry/bin';
import { BASE_HEIGHT, DIVIDER, HEIGHT_UNIT, LIP_SUPPORT_HEIGHT, WALL } from '../src/lib/geometry/spec';
import { pocketLayout } from '../src/lib/geometry/pockets';
import { compartmentFloorShape, floorShapeHeight, outlineEdges, usesToolCompartments } from '../src/lib/geometry/compartments';
import type { BinCutout } from '../src/lib/geometry/cutouts';
import {
  PRESETS,
  cleanCompartmentOptions,
  layoutKey,
  resolveLayout,
  sanitizeLayout,
  setCompartmentOptions,
  setWallEnd,
  setWallProps,
  uniformLayout,
  type CompartmentOptions,
  type DividerLayout,
} from '../src/lib/dividers';
import { interiorOf } from '../src/components/interiorState';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const toManifold = (mesh: MeshData): Manifold =>
  w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

/** Solid volume of the mesh inside an axis-aligned box. */
function materialIn(mesh: MeshData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const m = toManifold(mesh);
  const b = w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
  const i = m.intersect(b);
  const v = i.volume();
  [m, b, i].forEach((x) => x.delete());
  return v;
}

const bin = (o: Partial<BinOptions>): BinOptions => ({ ...DEFAULT_BIN, ...o }) as BinOptions;
const topInfillOf = (o: BinOptions) => HEIGHT_UNIT * o.heightUnits - (o.lip ? LIP_SUPPORT_HEIGHT : 0);

/** Compartment keys front-left first, row by row. */
function keysOf(o: Partial<BinOptions>, l: DividerLayout): string[] {
  const s = binInnerSize({ unitsX: o.unitsX ?? 1, unitsY: o.unitsY ?? 1 });
  return resolveLayout(l, s.w, s.d)
    .compartments.slice()
    .sort((a, b) => a.bounds.y0 - b.bounds.y0 || a.bounds.x0 - b.bounds.x0)
    .map((c) => c.key);
}

/** A layout with options set on some of its compartments (by keysOf index). */
function withComps(o: Partial<BinOptions>, l: DividerLayout, opts: [number, CompartmentOptions][]): DividerLayout {
  const keys = keysOf(o, l);
  for (const [i, co] of opts) l = setCompartmentOptions(l, keys[i], co);
  return l;
}

function lShape(ux: number, uy: number) {
  let l = uniformLayout(2, 2);
  const s = binInnerSize({ unitsX: ux, unitsY: uy });
  l = setWallEnd(l, s, 'x1', 'end', 'y1')!;
  l = setWallEnd(l, s, 'y1', 'end', 'x1')!;
  return l;
}

/** A 20 × 10 mm rectangular tool, `depth` deep, centered at (x, y) in bin coordinates. */
const tool = (x: number, y: number, depth = 8): BinCutout => ({
  toolId: 't',
  name: 'Tool',
  x,
  y,
  rotation: 0,
  outline: [
    [-10, -5],
    [10, -5],
    [10, 5],
    [-10, 5],
  ],
  depth,
  clearance: 0.5,
});

// A 2 × 1 bin split down the middle: compartment 0 on the left, 1 on the right (x > 0).
const TWO = { unitsX: 2, unitsY: 1, heightUnits: 4, label: 'none', scoop: 0 } as const;
const two = (right: CompartmentOptions | null, o: Partial<BinOptions> = {}) =>
  bin({ ...TWO, ...o, layout: right ? withComps(TWO, uniformLayout(2, 1), [[1, right]]) : uniformLayout(2, 1) });
// Clear size of each half of TWO.
const TWO_W = (binInnerSize(TWO).w - DIVIDER) / 2;
const TWO_D = binInnerSize(TWO).d;

describe('sanitizing compartment insides and floor shapes', () => {
  it('keeps valid values and drops the rest', () => {
    expect(
      cleanCompartmentOptions({
        inside: 'pockets',
        pockets: { pocketW: 12, pocketShape: 'hex', pocketDepth: '15', pocketPreset: 'custom' },
        floorShape: 'tiers',
        floorRise: 8,
        floorHigh: 'left',
        tiers: 4,
      }),
    ).toEqual({
      inside: 'pockets',
      pockets: { pocketW: 12, pocketShape: 'hex', pocketDepth: 15, pocketPreset: 'custom' },
      floorShape: 'tiers',
      floorRise: 8,
      floorHigh: 'left',
      tiers: 4,
    });
    const bad = cleanCompartmentOptions({
      inside: 'lava',
      pockets: { pocketW: 'wide', pocketShape: 'oval', pocketFoo: 3, scoop: 1, pocketSpacing: null },
      floorShape: 'dome',
      floorRise: 'high',
      floorHigh: 'up',
      tiers: 'many',
      scoop: 0.5,
    });
    expect(bad).toEqual({ scoop: 0.5 });
    // Defaults are dropped so they key (and build) like old layouts.
    expect(cleanCompartmentOptions({ inside: 'open', floorShape: 'flat', floorHigh: 'back' })).toBeNull();
    expect(cleanCompartmentOptions({ pockets: 'nope' })).toBeNull();
  });

  it('clamps numbers', () => {
    expect(cleanCompartmentOptions({ tiers: 1 })).toEqual({ tiers: 2 });
    expect(cleanCompartmentOptions({ tiers: 9.4 })).toEqual({ tiers: 6 });
    expect(cleanCompartmentOptions({ tiers: 3.6 })).toEqual({ tiers: 4 });
    expect(cleanCompartmentOptions({ floorRise: -3 })).toEqual({ floorRise: 0 });
    expect(cleanCompartmentOptions({ floorRise: 999 })).toEqual({ floorRise: 200 });
    expect(cleanCompartmentOptions({ pockets: { pocketW: 500, pocketSpacing: 0.1, pocketDepth: -4 } })).toEqual({
      pockets: { pocketW: 200, pocketSpacing: 0.8, pocketDepth: 1 },
    });
  });

  it('sanitizeLayout is idempotent with the new fields', () => {
    const l = withComps(TWO, uniformLayout(2, 1), [
      [0, { inside: 'tools', floorShape: 'ramp', floorRise: 7 }],
      [1, { inside: 'pockets', pockets: { pocketW: 9.123456, pocketShape: 'square', pocketD: 4 } }],
    ]);
    const once = sanitizeLayout(l);
    expect(sanitizeLayout(once)).toEqual(once);
    expect(once?.comps?.[keysOf(TWO, l)[1]].pockets?.pocketW).toBe(9.12);
  });
});

describe('mesh keys', () => {
  it('old layouts without the new fields keep their keys', () => {
    const l = withComps(TWO, uniformLayout(2, 1), [[0, { scoop: 0.5, label: 'full', floor: 3, labelText: 'X' }]]);
    const k = keysOf(TWO, l)[0];
    expect(layoutKey(l)).toBe(`x1:v:edge:edge:r0.5:edge:edge:0:|${k}=0.5/full/3/"X"`);
    expect(layoutKey(sanitizeLayout({ ...l, comps: { [k]: { ...l.comps![k], inside: 'open', floorShape: 'flat' } as CompartmentOptions } }))).toBe(layoutKey(l));
  });

  it('insides and floor shapes are part of the key; filled insides ignore the floor shape', () => {
    const base = binKey(two(null));
    const keys = [
      binKey(two({ inside: 'solid' })),
      binKey(two({ inside: 'tools' })),
      binKey(two({ inside: 'pockets' })),
      binKey(two({ inside: 'pockets', pockets: { pocketW: 9 } })),
      binKey(two({ floorShape: 'ramp' })),
      binKey(two({ floorShape: 'ramp', floorRise: 4 })),
      binKey(two({ floorShape: 'ramp', floorHigh: 'left' })),
      binKey(two({ floorShape: 'tiers' })),
      binKey(two({ floorShape: 'tiers', tiers: 5 })),
    ];
    expect(new Set([base, ...keys]).size).toBe(keys.length + 1);
    expect(binKey(two({ inside: 'solid', floorShape: 'ramp' }))).toBe(binKey(two({ inside: 'solid' })));
  });

  it('pocket compartments key on the bin’s pocket fields, tool compartments on its cutouts', () => {
    expect(binKey(two(null, { pocketW: 9 }))).toBe(binKey(two(null)));
    expect(binKey(two({ inside: 'pockets' }, { pocketW: 9 }))).not.toBe(binKey(two({ inside: 'pockets' })));
    // The preset name is UI only.
    expect(binKey(two({ inside: 'pockets' }, { pocketPreset: 'custom' }))).toBe(binKey(two({ inside: 'pockets' })));
    expect(binKey(two(null, { cutouts: [tool(20, 0)] }))).toBe(binKey(two(null)));
    expect(binKey(two({ inside: 'tools' }, { cutouts: [tool(20, 0)] }))).not.toBe(binKey(two({ inside: 'tools' })));
  });

  it('options of compartments that no longer exist change neither key nor geometry', () => {
    const o = two(null, { base: 'lite' });
    const stale = bin({ ...o, layout: { ...o.layout!, comps: { 'gone,^X': { inside: 'solid' } } } });
    expect(binKey(stale)).toBe(binKey(o));
    expect(check(buildBin(w, stale)).volume).toBeCloseTo(check(buildBin(w, o)).volume, 3);
  });
});

describe('old layouts build the same bins', () => {
  // Keys, volumes and tab counts recorded from the generator before compartment insides existed.
  const CASES: [string, Partial<BinOptions>, () => DividerLayout, { key: string; volume: number; tabs: number }][] = [
    [
      '3x2 comps',
      { unitsX: 3, unitsY: 2, label: 'none' },
      () =>
        withComps({ unitsX: 3, unitsY: 2 }, uniformLayout(3, 2), [
          [0, { scoop: 1, label: 'full' }],
          [2, { floor: 6 }],
          [4, { labelText: 'M3' }],
        ]),
      {
        key: '3-2-3-L-none-1-1-0-none-F-D{x1:v:edge:edge:r0.3333333:edge:edge:0:;x2:v:x1:edge:r0.5:edge:edge:0:;y1:h:edge:edge:r0.5:edge:edge:0:|^B,x1>,x2<,y1>=///"M3";^F,^L,x1<,y1<=1/full/;^F,^R,x2>,y1<=//6}-Traised',
        volume: 94927.6949,
        tabs: 1,
      },
    ],
    [
      'L flat',
      { unitsX: 4, unitsY: 2, scoop: 0.6, label: 'full', fillet: false },
      () => lShape(4, 2),
      { key: '4-2-3-L-none-1-1-60-full-n-D{x1:v:edge:edge:r0.5:edge:y1:0:;y1:h:edge:edge:r0.5:edge:x1:0:|}', volume: 124355.0364, tabs: 2 },
    ],
    [
      'lite floor',
      { unitsX: 2, unitsY: 2, base: 'lite', label: 'left' },
      () => withComps({ unitsX: 2, unitsY: 2 }, uniformLayout(2, 2), [[1, { floor: 3 }]]),
      { key: '2-2-3-L-none-1-1-0-left-F-D{x1:v:edge:edge:r0.5:edge:edge:0:;y1:h:edge:edge:r0.5:edge:edge:0:|^F,^R,x1>,y1<=//3}-Blite', volume: 40358.6774, tabs: 4 },
    ],
    [
      'lowered',
      { unitsX: 2, unitsY: 2, heightUnits: 6, label: 'full', scoop: 0.5 },
      () => withComps({ unitsX: 2, unitsY: 2 }, setWallProps(uniformLayout(2, 2), 'x1', { lower: 15 }), [[0, { scoop: 0.2 }]]),
      { key: '2-2-6-L-none-1-1-50-full-F-D{x1:v:edge:edge:r0.5:edge:edge:15:;y1:h:edge:edge:r0.5:edge:edge:0:|^F,^L,x1<,y1<=0.2//}', volume: 84687.4484, tabs: 4 },
    ],
    [
      'removable',
      { unitsX: 2, unitsY: 1, heightUnits: 4, label: 'center' },
      () => setWallProps(uniformLayout(2, 1), 'x1', { removable: true }),
      { key: '2-1-4-L-none-1-1-0-center-F-D{x1:v:edge:edge:r0.5:edge:edge:0:R|}', volume: 37933.153, tabs: 2 },
    ],
    [
      'efficient',
      { unitsX: 2, unitsY: 1, base: 'efficient', scoop: 0.3 },
      () => withComps({ unitsX: 2, unitsY: 1 }, uniformLayout(2, 1), [[0, { label: 'right', labelText: 'Bits' }]]),
      { key: '2-1-3-L-none-1-1-30-none-F-D{x1:v:edge:edge:r0.5:edge:edge:0:|^B,^F,^L,x1<=/right//"Bits"}-Befficient-Traised', volume: 16038.5776, tabs: 1 },
    ],
    [
      'preset, flat floors',
      { unitsX: 3, unitsY: 3, heightUnits: 4, label: 'left', scoop: 0.3, fillet: false },
      () => PRESETS[PRESETS.length - 1].layout,
      { key: '3-3-4-L-none-1-1-30-left-n-D{p1:v:edge:edge:r0.25:edge:edge:0:;p2:h:edge:edge:r0.5:p1:edge:0:|}', volume: 130721.6902, tabs: 3 },
    ],
  ];
  it.each(CASES)('%s', (_, o, make, ref) => {
    const opts = bin({ ...o, layout: make() });
    expect(binKey(opts)).toBe(ref.key);
    expect(meshVolume(buildBin(w, opts))).toBeCloseTo(ref.volume, 2);
    expect(binLabelTabs(opts).length).toBe(ref.tabs);
  });
});

describe('filled compartments', () => {
  const topInfill = topInfillOf(bin(TWO));
  const area = TWO_W * TWO_D;
  // The right compartment's clear rect, bin coordinates.
  const rx0 = DIVIDER / 2;
  const rx1 = rx0 + TWO_W;
  const ry0 = -TWO_D / 2;
  const ry1 = TWO_D / 2;

  it('solid fills the compartment flat, with no tab', () => {
    const open = buildBin(w, two(null));
    const solid = buildBin(w, two({ inside: 'solid' }));
    const c = check(solid);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    expect(check(buildBin(w, two({ inside: 'solid' }, { label: 'full', scoop: 1 }))).status).toBe('NoError');
    // Roughly the compartment's clear volume (less its rounded corners and bottom).
    const added = c.volume - check(open).volume;
    const full = area * (topInfill - BASE_HEIGHT);
    expect(added).toBeGreaterThan(full * 0.97);
    expect(added).toBeLessThan(full * 1.005);
    expect(materialIn(solid, rx0 + 5, ry0 + 5, BASE_HEIGHT + 1, rx1 - 5, ry1 - 5, topInfill - 0.05)).toBeCloseTo((TWO_W - 10) * (TWO_D - 10) * (topInfill - BASE_HEIGHT - 1.05), 1);
    expect(binLabelTabs(two({ inside: 'solid' }, { label: 'full' })).length).toBe(1);
  });

  it('a pocket compartment can hold a graduated set (sizes survive sanitizing and reach the key)', () => {
    const set = { pocketSizes: [3, 4, 5, 6], pocketSizeNames: [], pocketClearance: 0.3, pocketDepth: 12 };
    const o = two({ inside: 'pockets', pockets: set });
    const clean = sanitizeBin(o);
    const comps = Object.values(clean.layout!.comps ?? {});
    expect(comps.some((co) => co.pockets?.pocketSizes?.join() === '3,4,5,6')).toBe(true);
    expect(binKey(clean)).not.toBe(binKey(sanitizeBin(two({ inside: 'pockets', pockets: { ...set, pocketSizes: [3, 4, 5] } }))));
    const comp = binLayout(clean).compartments.find((x) => x.key === keysOf(TWO, clean.layout!)[1])!;
    const L = binCompartmentPockets(clean, null, comp);
    expect(L[0].pockets.map((p) => p.size)).toEqual([3, 4, 5, 6]);
    const c = check(buildBin(w, clean));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
  });

  it('pockets fill up to the pocket depth and cut their own grid', () => {
    const pk = { pocketShape: 'round', pocketW: 10, pocketDepth: 12, pocketSpacing: 2, pocketChamfer: 0 } as const;
    const o = two({ inside: 'pockets', pockets: pk });
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const r = binLayout(o);
    const comp = r.compartments.find((x) => x.key === keysOf(TWO, o.layout!)[1])!;
    const L = binCompartmentPockets(o, null, comp);
    expect(L.length).toBe(1);
    expect(L[0].centers.length).toBe(9);
    expect(L[0].fillTop).toBeCloseTo(BASE_HEIGHT + 12, 6);
    // The open compartment's pocket query is empty.
    expect(binCompartmentPockets(o, null, r.compartments.find((x) => x !== comp)!)).toEqual([]);
    // Fill minus the pockets (48-gons, a hair smaller than circles).
    const added = c.volume - check(buildBin(w, two(null))).volume;
    const expected = area * 12 - 9 * Math.PI * 25 * 12;
    expect(added).toBeGreaterThan(expected * 0.95);
    expect(added).toBeLessThan(expected * 1.02);
    const fill = L[0].fillTop;
    const [px, py] = L[0].centers[4];
    expect(materialIn(mesh, px - 2, py - 2, BASE_HEIGHT + 0.5, px + 2, py + 2, fill - 0.5)).toBeLessThan(1e-6);
    // Between pockets and along the walls: solid.
    expect(materialIn(mesh, px + 5.5, py - 1, BASE_HEIGHT + 0.5, px + 6.5, py + 1, fill - 0.05)).toBeCloseTo(2 * (fill - BASE_HEIGHT - 0.55), 2);
    expect(materialIn(mesh, rx0 + 0.2, ry0 + 5, BASE_HEIGHT + 0.5, rx0 + 1.2, ry1 - 5, fill - 0.05)).toBeGreaterThan(0.99 * (TWO_D - 10) * (fill - BASE_HEIGHT - 0.55));
    // Open above the fill, and the other compartment stays open.
    expect(materialIn(mesh, rx0 + 5, ry0 + 5, fill + 0.05, rx1 - 5, ry1 - 5, topInfill)).toBeLessThan(1e-6);
    expect(materialIn(mesh, -rx1 + 5, ry0 + 5, BASE_HEIGHT + 3, -rx0 - 5, ry1 - 5, topInfill)).toBeLessThan(1e-6);
  });

  it('a pocket compartment spanning the whole bin matches the whole-bin pocket grid', () => {
    for (const pocketDepth of [10, 40]) {
      const o = bin({ unitsX: 2, unitsY: 1, heightUnits: 4, pocketDepth, layout: { walls: [] } });
      const key = keysOf(o, o.layout!)[0];
      const comp = bin({ ...o, layout: { walls: [], comps: { [key]: { inside: 'pockets' } } } });
      const whole = bin({ ...o, interior: 'pockets', layout: null });
      const { w: W, d: D } = binSize(o);
      const ref = pocketLayout(sanitizeBin(whole), W, D, BASE_HEIGHT, topInfillOf(o));
      const mine = binCompartmentPockets(comp, null, binLayout(comp).compartments[0]);
      expect(mine[0].centers).toEqual(ref.centers);
      expect(mine[0].fillTop).toBeCloseTo(ref.fillTop, 9);
      const a = check(buildBin(w, comp));
      expect(a.status).toBe('NoError');
      expect(a.volume / check(buildBin(w, whole)).volume).toBeCloseTo(1, 3);
    }
  });

  it('tools are cut only inside a tool compartment', () => {
    const style = { edge: 'none' as const };
    const solid = buildBin(w, two({ inside: 'solid' }, { cutouts: [tool(20.6, 0)], cutoutStyle: style }));
    const o = two({ inside: 'tools' }, { cutouts: [tool(20.6, 0), tool(0, 12, 6)], cutoutStyle: style });
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(usesToolCompartments(o)).toBe(true);
    // The tool in the compartment is cut...
    expect(materialIn(mesh, 15, -3, topInfill - 7.5, 26, 3, topInfill - 0.5)).toBeLessThan(1e-6);
    // ...and the rest of the compartment is filled to the top.
    expect(materialIn(mesh, rx1 - 6, ry0 + 1, BASE_HEIGHT + 1, rx1 - 1, ry0 + 4, topInfill - 0.05)).toBeCloseTo(5 * 3 * (topInfill - BASE_HEIGHT - 1.05), 2);
    // A tool across the wall only cuts the tool compartment's side: the wall stays.
    expect(materialIn(mesh, -0.4, 9, topInfill - 5.5, 0.4, 15, topInfill - 0.5)).toBeCloseTo(0.8 * 6 * 5, 2);
    expect(materialIn(mesh, 2, 9, topInfill - 5.5, 8, 15, topInfill - 0.5)).toBeLessThan(1e-6);
    // Volume: the solid compartment minus both pockets (the second one only on its right of the wall).
    const pocket = (l: number, d: number) => (l + 1) * (d + 1) - (4 - Math.PI) * 0.25;
    const firstOnly = check(buildBin(w, two({ inside: 'tools' }, { cutouts: [tool(20.6, 0)], cutoutStyle: style }))).volume;
    expect(check(solid).volume - firstOnly).toBeCloseTo(pocket(20, 10) * 8, -1);
    // The whole-bin mode is untouched by compartment insides.
    const whole = bin({ ...o, interior: 'cutouts' });
    expect(check(buildBin(w, whole)).volume).toBeCloseTo(check(buildBin(w, bin({ ...whole, layout: uniformLayout(2, 1) }))).volume, 3);
    expect(usesToolCompartments(whole)).toBe(false);
  });

  it('label tabs, label text and label plates skip filled compartments', () => {
    const o3 = { unitsX: 3, unitsY: 1, heightUnits: 4, label: 'full', labelText: 'A', labelPlates: true } as const;
    const l = withComps(o3, uniformLayout(3, 1), [
      [1, { inside: 'solid' }],
      [2, { inside: 'pockets', pockets: { pocketDepth: 8 } }],
    ]);
    const o = bin({ ...o3, layout: l });
    const keys = keysOf(o3, l);
    const tabs = binLabelTabs(o);
    expect(tabs.map((t) => t.key)).toEqual([keys[0]]);
    expect(binLabelPlates(o).length).toBe(1);
    expect(binLabelTexts(bin({ ...o, labelPlates: false }))).toEqual(['A']);
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    // No tab at the back of the pocket compartment (open above its fill).
    const top = topInfillOf(o);
    const { w: W, d: D } = binSize(o);
    const x2 = W / 2 - WALL - 10;
    expect(materialIn(mesh, x2 - 5, D / 2 - WALL - 6, top - 3, x2, D / 2 - WALL - 3, top - 1)).toBeLessThan(1e-6);
    expect(materialIn(mesh, -x2, D / 2 - WALL - 6, top - 3, -x2 + 5, D / 2 - WALL - 3, top - 1)).toBeGreaterThan(1);
  });

  it('hollow bases keep a full floor when any compartment is filled', () => {
    for (const base of ['lite', 'efficient'] as const) {
      const open = buildBin(w, two(null, { base, label: 'full' }));
      const o = two({ inside: 'solid' }, { base, label: 'full' });
      const mesh = buildBin(w, o);
      const c = check(mesh);
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
      // Under the open (left) compartment, inside its foot: hollow on its own, solid next to a filled compartment.
      const probe = (m: MeshData) => materialIn(m, -25, -5, 2, -17, 5, 5);
      expect(probe(open)).toBeLessThan(1);
      expect(probe(mesh)).toBeCloseTo(8 * 10 * 3, 2);
      // The label tabs come from that same floor.
      expect(binLabelTabs(o)).toEqual(binLabelTabs(two({ inside: 'solid' }, { label: 'full' })));
    }
  });

  it('a lowered wall next to a filled compartment leaves the fill whole', () => {
    const o3 = { unitsX: 3, unitsY: 1, heightUnits: 6, label: 'none', scoop: 0 } as const;
    const l = withComps(o3, setWallProps(uniformLayout(3, 1), 'x1', { lower: 15 }), [[1, { inside: 'solid' }]]);
    const o = bin({ ...o3, layout: l });
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const top = topInfillOf(o);
    const zL = top - 15;
    const r = binLayout(o);
    const x1 = r.byId.get('x1')!.pos - binInnerSize(o).w / 2;
    const x2 = r.byId.get('x2')!.pos - binInnerSize(o).w / 2;
    // The lowered wall's top is gone; the fill beside it stays to the top.
    expect(materialIn(mesh, x1 - 0.4, -10, zL + 0.5, x1 + 0.4, 10, top - 0.5)).toBeLessThan(1e-6);
    expect(materialIn(mesh, x1 + 1, -10, zL + 0.5, x1 + 5, 10, top - 0.05)).toBeCloseTo(4 * 20 * (top - 0.05 - zL - 0.5), 2);
    // No slit between the fill and the full-height wall on its other side.
    const face = x2 - DIVIDER / 2;
    expect(materialIn(mesh, face - 0.2, -5, zL + 1, face + 0.2, 5, zL + 11)).toBeCloseTo(0.4 * 10 * 10, 3);
  });

  it('bins with divX × divY get a layout for per-compartment options', () => {
    const o = bin({ unitsX: 2, unitsY: 2, divX: 2, divY: 2 });
    const info = interiorOf(o);
    expect(info.custom).toBe(false);
    const key = info.resolved.compartments[0].key;
    const next = bin({ ...o, layout: setCompartmentOptions(info.layout, key, { inside: 'pockets', pockets: { pocketDepth: 8 } }) });
    expect(binLayout(next).compartments.length).toBe(4);
    const c = check(buildBin(w, next));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.volume).toBeGreaterThan(check(buildBin(w, o)).volume + 1000);
    expect(binLabel(next)).toBe('2×2×3u 4 compartments, 1 pocket grid');
  });

  it('insides only apply to compartment interiors', () => {
    const o = two({ inside: 'solid' });
    const pockets = bin({ ...o, interior: 'pockets' });
    expect(check(buildBin(w, pockets)).volume).toBeCloseTo(check(buildBin(w, bin({ ...pockets, layout: null }))).volume, 3);
    expect(binLabel(two({ inside: 'tools' }))).toBe('2×1×4u 2 compartments, 1 for tools');
    expect(binLabel(bin({ ...TWO, layout: { walls: [], comps: { [keysOf(TWO, { walls: [] })[0]]: { inside: 'solid' } } } }))).toBe('2×1×4u 1 solid');
  });
});

describe('floor shapes', () => {
  // One compartment filling a 1 × 1 bin, 6 units tall, without fillets, scoop or tab.
  const ONE = { unitsX: 1, unitsY: 1, heightUnits: 6, label: 'none', scoop: 0, fillet: false } as const;
  const one = (co: CompartmentOptions | null, o: Partial<BinOptions> = {}) => {
    const l: DividerLayout = { walls: [] };
    return bin({ ...ONE, ...o, layout: co ? { walls: [], comps: { [keysOf(ONE, l)[0]]: co } } : l });
  };
  const inner = binInnerSize(ONE);
  const flat = () => check(buildBin(w, one(null))).volume;

  it('a ramp and steps add half the rise over the compartment', () => {
    const base = flat();
    const area = inner.w * inner.d;
    for (const co of [
      { floorShape: 'ramp', floorRise: 10 },
      { floorShape: 'ramp', floorRise: 10, floorHigh: 'left' },
      { floorShape: 'tiers', floorRise: 9, tiers: 4 },
      { floorShape: 'tiers', floorRise: 12, tiers: 2, floorHigh: 'right' },
    ] as CompartmentOptions[]) {
      const c = check(buildBin(w, one(co)));
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
      expect(c.genus).toBe(0);
      // Steps from 0 to the rise, or a ramp: the same average height.
      expect((c.volume - base) / ((area * co.floorRise!) / 2)).toBeCloseTo(1, 1);
    }
  });

  it('the ramp rises toward the high side; steps are flat', () => {
    const iy0 = -inner.d / 2;
    const ramp = buildBin(w, one({ floorShape: 'ramp', floorRise: 10 }));
    expect(materialIn(ramp, -5, iy0 + 36, BASE_HEIGHT + 0.5, 5, iy0 + 38, BASE_HEIGHT + 8.5)).toBeCloseTo(10 * 2 * 8, 2);
    expect(materialIn(ramp, -5, iy0 + 2, BASE_HEIGHT + 1.5, 5, iy0 + 4, BASE_HEIGHT + 8.5)).toBeLessThan(1e-6);
    const steps = buildBin(w, one({ floorShape: 'tiers', floorRise: 9, tiers: 4 }));
    const band = inner.d / 4;
    // Second step: 3 mm up, from a quarter to half the depth.
    expect(materialIn(steps, -5, iy0 + band + 1, BASE_HEIGHT + 0.5, 5, iy0 + 2 * band - 1, BASE_HEIGHT + 2.95)).toBeCloseTo(10 * (band - 2) * 2.45, 2);
    expect(materialIn(steps, -5, iy0 + band + 1, BASE_HEIGHT + 3.05, 5, iy0 + 2 * band - 1, BASE_HEIGHT + 8)).toBeLessThan(1e-6);
  });

  it('the rise is clamped to the depth, and a bare shape gets a default rise', () => {
    const depth = topInfillOf(bin(ONE)) - BASE_HEIGHT;
    expect(compartmentFloorShape({ floorShape: 'ramp', floorRise: 500 }, depth)?.rise).toBeCloseTo(depth - 2, 9);
    expect(compartmentFloorShape({ floorShape: 'ramp' }, depth)?.rise).toBe(10);
    expect(compartmentFloorShape({ floorShape: 'ramp', floorRise: 0.2 }, depth)).toBeNull();
    expect(compartmentFloorShape({ floorShape: 'tiers', inside: 'solid' }, depth)).toBeNull();
    const f = compartmentFloorShape({ floorShape: 'tiers', floorRise: 6, tiers: 3, floorHigh: 'front' }, depth)!;
    const b = { x0: 0, y0: 0, x1: 30, y1: 30 };
    expect([5, 15, 25].map((y) => floorShapeHeight(f, b, 10, y))).toEqual([6, 3, 0]);
    const c = check(buildBin(w, one({ floorShape: 'ramp', floorRise: 500 })));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
  });

  it('a tab over the high side shrinks to stay clear of it', () => {
    const plain = binLabelTabs(one(null, { label: 'full' }))[0];
    const tab = binLabelTabs(one({ floorShape: 'ramp', floorRise: 25 }, { label: 'full' }))[0];
    expect(tab.z).toBeCloseTo(plain.z, 9);
    expect(tab.y1 - tab.y0).toBeLessThan(plain.y1 - plain.y0 - 4);
    const c = check(buildBin(w, one({ floorShape: 'ramp', floorRise: 25 }, { label: 'full' })));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    // Rising to the front leaves the tab alone.
    expect(binLabelTabs(one({ floorShape: 'ramp', floorRise: 25, floorHigh: 'front' }, { label: 'full' }))[0]).toEqual(plain);
  });

  it('works with scoops, raised floors, lowered walls and L-shaped compartments', () => {
    const o = { unitsX: 4, unitsY: 2, heightUnits: 5, scoop: 0.6, label: 'full' } as const;
    let l = lShape(4, 2);
    l = setWallProps(l, 'y1', { lower: 10 });
    l = withComps(o, l, [
      [0, { floorShape: 'tiers', tiers: 3, floor: 2 }],
      [1, { floorShape: 'ramp', floorRise: 6, floorHigh: 'right' }],
    ]);
    const shaped = buildBin(w, bin({ ...o, layout: l }));
    const c = check(shaped);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    expect(c.volume).toBeGreaterThan(check(buildBin(w, bin({ ...o, layout: setWallProps(lShape(4, 2), 'y1', { lower: 10 }) }))).volume + 1000);
    // Hollow base: the shape sits on the real floor, never down in the feet.
    const lite = check(buildBin(w, bin({ ...o, layout: l, base: 'lite' })));
    expect(lite.status).toBe('NoError');
    expect(lite.components).toBe(1);
  });
});

describe('rounded floors in L-shaped compartments', () => {
  const o = { unitsX: 4, unitsY: 2, scoop: 0, label: 'none' } as const;
  const L = () => bin({ ...o, layout: lShape(4, 2) });
  const ix0 = -binInnerSize(o).w / 2;
  const iy0 = -binInnerSize(o).d / 2;

  it('fillet all along the walls, as much as a rolling ball leaves', () => {
    const round = buildBin(w, L());
    const flat = buildBin(w, bin({ ...L(), fillet: false }));
    const c = check(round);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const comp = binLayout(L()).compartments.find((x) => !x.isRect)!;
    const perimeter = outlineEdges(comp).reduce((t, e) => t + e.b - e.a, 0);
    expect(perimeter).toBeCloseTo(2 * (comp.bounds.x1 - comp.bounds.x0 + comp.bounds.y1 - comp.bounds.y0), 6);
    // Fillet cross-section (1 − π/4)·r² along both compartments' walls (the rectangular one is flat
    // too with fillets off), give or take the corners.
    const added = c.volume - check(flat).volume;
    const rect = binLayout(L()).compartments.find((x) => x.isRect)!;
    const rectPerimeter = 2 * (rect.bounds.x1 - rect.bounds.x0 + rect.bounds.y1 - rect.bounds.y0);
    const section = (1 - Math.PI / 4) * 2.8 ** 2;
    expect(added).toBeGreaterThan((perimeter + rectPerimeter) * section * 0.85);
    expect(added).toBeLessThan((perimeter + rectPerimeter) * section * 1.15);
  });

  it('material in the corner where floor meets wall, including around a reflex corner', () => {
    const round = buildBin(w, L());
    const flat = buildBin(w, bin({ ...L(), fillet: false }));
    const comp = binLayout(L()).compartments.find((x) => !x.isRect)!;
    // Along the front wall of the L's lower strip.
    const strip = comp.rects.find((r) => r.y0 < 1)!;
    const mx = ix0 + (strip.x0 + strip.x1) / 2;
    const fillet = (m: MeshData) => materialIn(m, mx - 5, iy0 + strip.y0 + 0.02, BASE_HEIGHT + 0.05, mx + 5, iy0 + strip.y0 + 0.5, BASE_HEIGHT + 0.5);
    expect(fillet(round)).toBeCloseTo(10 * 0.48 * 0.45, 2);
    expect(fillet(flat)).toBeLessThan(1e-6);
    // Away from the walls the floor is flat.
    expect(materialIn(round, mx - 5, iy0 + 15, BASE_HEIGHT + 0.05, mx + 5, iy0 + 20, BASE_HEIGHT + 1)).toBeLessThan(1e-6);
    // The reflex corner: where the upper strip's front wall meets the lower strip's left wall.
    const vx = ix0 + strip.x0;
    const vy = iy0 + strip.y1;
    const blend = (m: MeshData) => materialIn(m, vx + 0.2, vy + 0.2, BASE_HEIGHT + 0.05, vx + 0.4, vy + 0.4, BASE_HEIGHT + 0.15);
    expect(blend(round)).toBeCloseTo(0.2 * 0.2 * 0.1, 5);
    expect(blend(flat)).toBeLessThan(1e-6);
  });

  it('every preset builds a valid bin with rounded floors, scoops and tabs', () => {
    for (const p of PRESETS) {
      for (const label of ['full', 'left'] as const) {
        const c = check(buildBin(w, bin({ unitsX: 3, unitsY: 3, heightUnits: 4, layout: p.layout, scoop: 0.5, label })));
        expect(c.status).toBe('NoError');
        expect(c.components).toBe(1);
        expect(c.genus).toBe(0);
      }
    }
    // A U shape around a short compartment, on a hollow base.
    let u = uniformLayout(3, 2);
    const s = binInnerSize({ unitsX: 3, unitsY: 2 });
    u = setWallEnd(u, s, 'y1', 'start', 'x1')!;
    u = setWallEnd(u, s, 'y1', 'end', 'x2')!;
    u = setWallEnd(u, s, 'x1', 'end', 'y1')!;
    u = setWallEnd(u, s, 'x2', 'end', 'y1')!;
    const ou = bin({ unitsX: 3, unitsY: 2, heightUnits: 4, layout: u, base: 'lite', scoop: 0.4, label: 'center' });
    expect(binLayout(ou).compartments.some((x) => x.rects.length >= 2)).toBe(true);
    const cu = check(buildBin(w, ou));
    expect(cu.status).toBe('NoError');
    expect(cu.components).toBe(1);
  });
});
