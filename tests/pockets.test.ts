import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binSize, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import {
  DEFAULT_VARIANTS,
  MAX_POCKET_SIZES,
  POCKET_KEYS,
  binBodyHeight,
  binFloorZ,
  pocketFields,
  pocketKeyPart,
  sanitizePocketFields,
  type PocketFields,
} from '../src/lib/geometry/variants';
import {
  CUSTOM_SET,
  FIT_DEFAULTS,
  POCKET_GROUPS,
  POCKET_LABEL_SIZE,
  POCKET_MAGNET_FIT,
  POCKET_PRESETS,
  findPocketPreset,
  fitItem,
  formatSizeList,
  hull2,
  magnetLimit,
  parseSizeList,
  pocketFill,
  pocketLayout,
  pocketSummary,
  polyDistance,
  presetFields,
  regionPocketCutters,
  regionPocketLayout,
  sizeLabelText,
  type PocketLayout,
  type PocketOpts,
  type PocketRegion,
} from '../src/lib/geometry/pockets';
import { LIP_SUPPORT_HEIGHT } from '../src/lib/geometry/spec';
import { registerFont } from '../src/lib/geometry/text';
import { parseLength } from '../src/lib/units';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  // Engraved size labels need the font (the worker loads it the same way).
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
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

const bin = (o: Partial<BinOptions> = {}) => sanitizeBin({ ...DEFAULT_BIN, interior: 'pockets', ...o } as BinOptions);
const vol = (o: Partial<BinOptions>) => check(buildBin(w, bin(o))).volume;
const preset = (id: string) => presetFields(findPocketPreset(id)!);

/** The bin's pocket layout, as buildBin lays it out. */
function layoutOf(o: Partial<BinOptions>): PocketLayout {
  const opts = bin(o);
  const { w: W, d: D } = binSize(opts);
  const H = binBodyHeight(opts);
  return pocketLayout(opts, W, D, binFloorZ(opts), opts.lip ? H - LIP_SUPPORT_HEIGHT : H);
}

/** Every pair of footprints and label boxes keeps at least `gap` apart (a pocket's own label at least `ownLabel`). */
function expectApart(L: PocketLayout, gap: number, ownLabel = 0.6) {
  const shapes: { of: number; pts: [number, number][] }[] = [];
  L.pockets.forEach((p, i) => {
    shapes.push({ of: i, pts: p.footprint });
    if (p.label) {
      const { x, y, w: lw, h } = p.label;
      shapes.push({
        of: i,
        pts: [
          [x - lw / 2, y - h / 2],
          [x + lw / 2, y + h / 2],
          [x - lw / 2, y + h / 2],
          [x + lw / 2, y - h / 2],
        ],
      });
    }
  });
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      const min = shapes[i].of === shapes[j].of ? ownLabel : gap;
      expect(polyDistance(shapes[i].pts, shapes[j].pts)).toBeGreaterThanOrEqual(min - 1e-6);
    }
}

/** Everything the layout cuts stays inside `r` shrunk by `margin`. */
function expectInside(L: PocketLayout, r: PocketRegion, margin: number) {
  const pts = [
    ...L.pockets.flatMap((p) => p.footprint),
    ...L.pockets.flatMap((p) => (p.label ? [[p.label.x - p.label.w / 2, p.label.y - p.label.h / 2] as const, [p.label.x + p.label.w / 2, p.label.y + p.label.h / 2] as const] : [])),
  ];
  for (const [x, y] of pts) {
    expect(x).toBeGreaterThanOrEqual(r.x0 + margin - 1e-6);
    expect(x).toBeLessThanOrEqual(r.x1 - margin + 1e-6);
    expect(y).toBeGreaterThanOrEqual(r.y0 + margin - 1e-6);
    expect(y).toBeLessThanOrEqual(r.y1 - margin + 1e-6);
  }
}

/** Volume of a mesh below height z. */
function volumeBelow(mesh: MeshData, z: number): number {
  const m = toManifold(mesh);
  const low = m.trimByPlane([0, 0, -1], -z);
  const v = low.volume();
  low.delete();
  m.delete();
  return v;
}

describe('every pocket option builds one closed solid with the right outside size', () => {
  it.each<{ name: string; o: Partial<BinOptions> }>([
    { name: 'round bottoms, round pockets', o: { unitsX: 2, heightUnits: 5, pocketFloor: 'round' } },
    { name: 'round bottoms, hex', o: { unitsX: 2, heightUnits: 4, ...preset('hexbit'), pocketFloor: 'round' } },
    { name: 'round bottoms, SD slots', o: { unitsX: 2, heightUnits: 5, ...preset('sd'), pocketFloor: 'round' } },
    { name: 'round bottoms, wide square pockets', o: { unitsX: 2, heightUnits: 5, pocketShape: 'square', pocketW: 18, pocketD: 12, pocketDepth: 15, pocketFloor: 'round' } },
    { name: 'cone bottoms, screws', o: { unitsX: 2, heightUnits: 4, ...preset('m4'), pocketFloor: 'cone' } },
    { name: 'cone bottoms, shallower than the cone', o: { heightUnits: 3, pocketW: 30, pocketDepth: 4, pocketFloor: 'cone' } },
    { name: 'cone bottoms, square', o: { unitsX: 2, heightUnits: 4, ...preset('cr2032'), pocketFloor: 'cone' } },
    { name: 'stepped: printer nozzles', o: { unitsX: 2, heightUnits: 3, ...preset('nozzle') } },
    { name: 'stepped: round, bore wider than the pocket', o: { heightUnits: 4, pocketFloor: 'stepped', pocketStepW: 50, pocketStepDepth: 6 } },
    { name: 'stepped: square', o: { unitsX: 2, heightUnits: 5, pocketShape: 'square', pocketW: 12, pocketD: 8, pocketFloor: 'stepped', pocketStepW: 6, pocketStepDepth: 8 } },
    { name: 'tilted 30°, round', o: { unitsX: 2, unitsY: 2, heightUnits: 6, pocketTilt: 30 } },
    { name: 'tilted 45°, hex, chamfered', o: { unitsX: 2, unitsY: 2, heightUnits: 5, ...preset('powerbit'), pocketTilt: 45, pocketChamfer: 1.5 } },
    { name: 'tilted 20°, SD slots', o: { unitsX: 2, unitsY: 2, heightUnits: 5, ...preset('sd'), pocketTilt: 20 } },
    { name: 'tilted 45° in a short bin (lean reduced)', o: { unitsX: 2, heightUnits: 2, pocketTilt: 45 } },
    { name: 'tilted, round bottoms, magnets', o: { unitsX: 2, unitsY: 2, heightUnits: 6, pocketTilt: 25, pocketFloor: 'round', pocketMagnet: true } },
    { name: 'tilted, cone bottoms', o: { unitsX: 2, unitsY: 2, heightUnits: 6, ...preset('router-12'), pocketTilt: 15, pocketFloor: 'cone' } },
    { name: 'tilted, stepped', o: { unitsX: 2, unitsY: 2, heightUnits: 5, ...preset('nozzle'), pocketTilt: 20 } },
    { name: 'tilted, notches, filled to the top', o: { unitsX: 2, unitsY: 2, heightUnits: 4, pocketTilt: 30, pocketGrip: 'notch', pocketDepth: 200 } },
    { name: 'magnets, flat bottoms', o: { unitsX: 2, unitsY: 2, heightUnits: 4, pocketMagnet: true } },
    { name: 'magnets, round bottoms', o: { unitsX: 2, heightUnits: 4, pocketMagnet: true, pocketFloor: 'round' } },
    { name: 'magnets, cone bottoms', o: { unitsX: 2, heightUnits: 4, pocketMagnet: true, pocketFloor: 'cone', pocketW: 12 } },
    { name: 'magnets, stepped (bore holds the magnet)', o: { unitsX: 2, heightUnits: 4, pocketMagnet: true, pocketFloor: 'stepped', pocketStepW: 8 } },
    { name: 'magnets, flat base', o: { unitsX: 2, heightUnits: 3, base: 'flat', pocketMagnet: true } },
    { name: 'magnets, square and hex', o: { unitsX: 2, heightUnits: 4, pocketMagnet: true, pocketShape: 'hex', pocketW: 9 } },
    { name: 'magnets too wide for the pockets', o: { unitsX: 2, heightUnits: 4, pocketMagnet: true, ...preset('m3') } },
    { name: 'grooves, staggered AA', o: { unitsX: 2, unitsY: 2, heightUnits: 6, pocketGrip: 'groove' } },
    { name: 'grooves, SD columns', o: { unitsX: 2, heightUnits: 5, ...preset('sd'), pocketGrip: 'groove' } },
    { name: 'grooves, hex columns, tilted', o: { unitsX: 3, unitsY: 2, heightUnits: 5, ...preset('hexbit'), pocketGrip: 'groove', pocketTilt: 15 } },
    { name: 'notches, coins', o: { unitsX: 2, unitsY: 2, heightUnits: 4, ...preset('quarter'), pocketGrip: 'notch' } },
    { name: 'notches, hex, round bottoms, magnets', o: { unitsX: 2, unitsY: 2, heightUnits: 4, pocketShape: 'hex', pocketW: 10, pocketGrip: 'notch', pocketFloor: 'round', pocketMagnet: true } },
    { name: 'drill index 1–10 mm', o: { unitsX: 3, unitsY: 2, heightUnits: 4, ...preset('drills-10') } },
    { name: 'inch drills, grooves, tilted', o: { unitsX: 4, unitsY: 2, heightUnits: 4, ...preset('drills-inch'), pocketGrip: 'groove', pocketTilt: 10 } },
    { name: '1/4″ sockets, magnets, notches', o: { unitsX: 3, unitsY: 2, heightUnits: 4, ...preset('sockets-14'), pocketMagnet: true, pocketGrip: 'notch' } },
    { name: 'hex keys, no labels, lite base, front cutout', o: { unitsX: 2, unitsY: 2, heightUnits: 4, base: 'lite', cutoutWalls: 'f', ...preset('hexkeys'), pocketSizeLabels: 'none' } },
    { name: 'graduated set that only partly fits', o: { heightUnits: 3, ...preset('sockets-38') } },
  ])('$name', ({ o }) => {
    const opts = bin(o);
    const mesh = buildBin(w, opts);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const b = meshBounds(mesh);
    const size = binSize(opts);
    expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(size.d, 3);
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(opts), 3);
    // Nothing breaks through the floor: below it (below the magnets' limit) the bin is as solid as an unpocketed fill.
    const zFloor = binFloorZ(opts);
    const z = (opts.pocketMagnet ? magnetLimit(zFloor) : zFloor) - 1e-3;
    const solid = buildBin(w, bin({ ...o, pocketSizes: [], pocketW: 199, pocketMagnet: false }));
    expect(volumeBelow(mesh, z)).toBeCloseTo(volumeBelow(solid, z), 0);
  });
});

/** Area of the 48-sided polygon round pockets are cut with. */
const area48 = (r: number) => 24 * r * r * Math.sin((2 * Math.PI) / 48);

describe('cartridge blocks build one closed solid with a pocket per round', () => {
  it.each<{ name: string; id: string; o: Partial<BinOptions>; least: number }>([
    { name: '.22 LR, 2 × 1 × 6u', id: 'ammo-22lr', o: { unitsX: 2, heightUnits: 6 }, least: 30 },
    { name: '9mm Luger, 3 × 2 × 6u', id: 'ammo-9mm', o: { unitsX: 3, unitsY: 2, heightUnits: 6 }, least: 60 },
    { name: '.308 Win, 2 × 2 × 12u', id: 'ammo-308', o: { unitsX: 2, unitsY: 2, heightUnits: 12 }, least: 25 },
    { name: '12 ga 2¾″, 2 × 2 × 11u', id: 'ammo-12ga', o: { unitsX: 2, unitsY: 2, heightUnits: 11 }, least: 9 },
    { name: '12 ga 2¾″, one shell in a 1 × 1, flat base', id: 'ammo-12ga', o: { heightUnits: 10, base: 'flat' }, least: 1 },
  ])('$name', ({ id, o, least }) => {
    const p = findPocketPreset(id)!;
    const opts = bin({ ...o, ...preset(id) });
    const L = layoutOf(opts);
    expect(L.pockets.length).toBeGreaterThanOrEqual(least);
    expect(L.depth).toBeCloseTo(p.depth, 6);
    const mesh = buildBin(w, opts);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const b = meshBounds(mesh);
    const size = binSize(opts);
    expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(size.d, 3);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(opts), 3);
    // Every pocket is cut its full depth (and no more than its chamfered mouth): compared with the same fill without pockets.
    const solid = check(buildBin(w, bin({ ...o, ...preset(id), pocketW: 199 }))).volume;
    const removed = solid - c.volume;
    expect(removed).toBeGreaterThan(L.pockets.length * area48(p.w / 2) * p.depth * 0.999);
    expect(removed).toBeLessThan(L.pockets.length * area48(p.w / 2 + p.chamfer) * p.depth);
  });
});
const fmt = (v: number) => `${Math.round(v * 100) / 100} mm`;
const DEG = Math.PI / 180;

describe('projects saved before the new options', () => {
  const stored = { unitsX: 2, unitsY: 2, heightUnits: 6, lip: true, holes: 'none', divX: 1, divY: 1, scoop: 0, label: 'none', fillet: true, interior: 'pockets' };
  const old = { ...stored, pocketPreset: 'aa', pocketShape: 'round', pocketW: 15, pocketD: 15, pocketDepth: 20, pocketSpacing: 2, pocketChamfer: 1 } as unknown as BinOptions;

  it('get the defaults, the same mesh key and the same mesh', () => {
    const o = sanitizeBin(old);
    for (const k of POCKET_KEYS) expect(o[k], k).toEqual(DEFAULT_VARIANTS[k]);
    expect(binKey(o)).toBe('2-2-6-L-none-1-1-0-none-F-Pround15d20s2c1');
    expect(pocketKeyPart(o)).toBe('Pround15d20s2c1');
    const a = buildBin(w, old);
    const b = buildBin(w, bin({ unitsX: 2, unitsY: 2, heightUnits: 6 }));
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
  });

  it('cut the classic pockets: one straight pocket and one chamfer each, reaching the floor', () => {
    const L = layoutOf(old);
    expect(L.pockets).toHaveLength(20);
    expect(L.grooves).toEqual([]);
    expect(L.missing).toEqual([]);
    for (const p of L.pockets) {
      expect(p).toMatchObject({ w: 15, d: 15, depth: 20, tilt: 0, bottom: 7, magnet: false });
      expect(p.notch).toBeUndefined();
      expect(p.label).toBeUndefined();
      expect(p.footprint).toHaveLength(48);
    }
    const s = new Scope();
    try {
      expect(regionPocketCutters(w, s, old, L, 7, 40)).toHaveLength(40);
    } finally {
      s.dispose();
    }
  });

  it('the region functions take the classic six fields alone', () => {
    const six: PocketOpts = { pocketShape: 'hex', pocketW: 6.65, pocketD: 6.65, pocketDepth: 12, pocketSpacing: 2, pocketChamfer: 0.6 };
    const region: PocketRegion = { x0: -30, y0: -20, x1: 30, y1: 20 };
    expect(regionPocketLayout(six, region, 7, 30)).toEqual(regionPocketLayout({ ...DEFAULT_VARIANTS, ...six }, region, 7, 30));
    expect(pocketFill(six, 7, 30)).toEqual({ fillTop: 19, depth: 12 });
  });
});

describe('mesh keys', () => {
  it('every new option changes the key; options that do not apply leave it alone', () => {
    const base = bin({});
    const variants: Partial<BinOptions>[] = [
      { pocketFloor: 'round' },
      { pocketFloor: 'cone' },
      { pocketFloor: 'stepped' },
      { pocketFloor: 'stepped', pocketStepW: 4 },
      { pocketFloor: 'stepped', pocketStepDepth: 3 },
      { pocketTilt: 10 },
      { pocketTilt: 20 },
      { pocketGrip: 'groove' },
      { pocketGrip: 'notch' },
      { pocketMagnet: true },
      { pocketMagnet: true, pocketMagnetD: 8 },
      { pocketMagnet: true, pocketMagnetH: 3 },
      { pocketSizes: [1, 2, 3] },
      { pocketSizes: [1, 2, 4] },
      { pocketSizes: [1, 2, 3], pocketClearance: 0.6 },
      { pocketSizes: [1, 2, 3], pocketSizeLabels: 'inch' },
      { pocketSizes: [1, 2, 3], pocketSizeLabels: 'none' },
      { pocketSizes: [1, 2, 3], pocketSizeNames: ['a', '', ''] },
    ];
    const keys = variants.map((v) => binKey(bin(v)));
    expect(new Set([binKey(base), ...keys]).size).toBe(variants.length + 1);
    expect(binKey(bin({ pocketStepW: 3, pocketStepDepth: 9 }))).toBe(binKey(base));
    expect(binKey(bin({ pocketMagnetD: 10, pocketMagnetH: 4 }))).toBe(binKey(base));
    expect(binKey(bin({ pocketClearance: 1, pocketSizeLabels: 'inch', pocketSizeNames: ['x'] }))).toBe(binKey(base));
    expect(binKey(bin({ pocketSizes: [1, 2], pocketSizeLabels: 'none', pocketSizeNames: ['a', 'b'] }))).toBe(binKey(bin({ pocketSizes: [1, 2], pocketSizeLabels: 'none' })));
    expect(binKey(bin({ pocketPreset: 'custom' }))).toBe(binKey(base));
    // Pocket options don't split the meshes of other interiors.
    expect(binKey(bin({ interior: 'compartments', pocketTilt: 30, pocketMagnet: true, pocketSizes: [3] }))).toBe(binKey(sanitizeBin(DEFAULT_BIN)));
  });

  it('pocketFields picks out every pocket option and nothing else', () => {
    expect(POCKET_KEYS).toHaveLength(19);
    const f = pocketFields(bin({ pocketTilt: 12 }));
    expect(Object.keys(f).sort()).toEqual([...POCKET_KEYS].sort());
    expect(f.pocketTilt).toBe(12);
    expect(pocketFields({ pocketW: 3 })).toEqual({ pocketW: 3 });
  });
});

describe('sanitizing', () => {
  it('clamps the new fields and falls back to the defaults', () => {
    const o = sanitizePocketFields({
      pocketFloor: 'spiky' as never,
      pocketTilt: 80,
      pocketGrip: 'claw' as never,
      pocketMagnet: 1 as never,
      pocketMagnetD: 100,
      pocketMagnetH: 0,
      pocketStepW: -2,
      pocketStepDepth: 1e6,
      pocketSizes: [3, -1, NaN, 'x' as never, 1e4, 0.1, '4.567' as never],
      pocketSizeNames: [' a ', 'lost', 'lost', 'lost', 7 as never, '', 'a very long label'],
      pocketSizeLabels: 'roman' as never,
      pocketClearance: -1,
    });
    expect(o).toMatchObject({
      pocketFloor: 'flat',
      pocketTilt: 45,
      pocketGrip: 'none',
      pocketMagnet: true,
      pocketMagnetD: 30,
      pocketMagnetH: 0.5,
      pocketStepW: 0.5,
      pocketStepDepth: 200,
      pocketSizes: [3, 200, 0.5, 4.57],
      pocketSizeNames: ['a', '', '', 'a very long'],
      pocketSizeLabels: 'mm',
      pocketClearance: 0,
    });
    expect(sanitizePocketFields({ pocketTilt: -5, pocketSizes: 'nope' as never, pocketSizeNames: ['x'] })).toMatchObject({ pocketTilt: 0, pocketSizes: [], pocketSizeNames: [] });
    expect(sanitizePocketFields({ pocketSizes: [1, 2], pocketSizeNames: ['', ' '] }).pocketSizeNames).toEqual([]);
    expect(sanitizePocketFields({ pocketSizes: Array.from({ length: 500 }, (_, i) => i + 1) }).pocketSizes).toHaveLength(MAX_POCKET_SIZES);
    expect(sanitizeBin(bin({ pocketTilt: 99 })).pocketTilt).toBe(45);
    // Defaults in, defaults out.
    const d = sanitizePocketFields({});
    for (const k of POCKET_KEYS) expect(d[k], k).toEqual(DEFAULT_VARIANTS[k]);
  });
});

describe('presets', () => {
  it('keeps the old ids and sizes', () => {
    const old: Record<string, [number, number]> = {
      aa: [15, 20],
      aaa: [11, 18],
      '18650': [19, 25],
      cr2032: [20.8, 12],
      sd: [24.6, 16],
      microsd: [11.6, 9],
      hexbit: [6.65, 12],
      m3: [3.4, 10],
      m4: [4.5, 12],
      m5: [5.5, 14],
    };
    for (const [id, [size, depth]] of Object.entries(old)) expect(findPocketPreset(id), id).toMatchObject({ w: size, depth });
    expect(DEFAULT_VARIANTS).toMatchObject(presetFields(findPocketPreset('aa')!));
  });

  it('has unique ids, survives sanitizing, and lists sets smallest first', () => {
    expect(new Set(POCKET_PRESETS.map((p) => p.id)).size).toBe(POCKET_PRESETS.length);
    expect(POCKET_PRESETS.length).toBeGreaterThanOrEqual(55);
    expect(POCKET_GROUPS).toEqual(['Batteries', 'Memory & cards', 'Bits & drivers', 'Router bits', 'Screws', 'Hobby', 'Coins', 'Ammunition', 'Graduated sets']);
    for (const p of POCKET_PRESETS) {
      const f = presetFields(p);
      const s = sanitizePocketFields(f);
      for (const k of Object.keys(f) as (keyof PocketFields)[]) expect(s[k], `${p.id} ${k}`).toEqual(f[k]);
      if (p.sizes) {
        expect(p.group).toBe('Graduated sets');
        for (let i = 1; i < p.sizes.length; i++) expect(p.sizes[i], p.id).toBeGreaterThanOrEqual(p.sizes[i - 1]);
        if (p.names) expect(p.names).toHaveLength(p.sizes.length);
      }
    }
    expect(findPocketPreset('drills-10')!.sizes).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
    expect(findPocketPreset('drills-13')!.sizes).toHaveLength(25);
    const inch = findPocketPreset('drills-inch')!.sizes!;
    expect(inch).toHaveLength(29);
    expect(inch.map((v) => sizeLabelText(v, 'inch'))).toEqual([...Array(29)].map((_, i) => sizeLabelText(((4 + i) / 64) * 25.4, 'inch')));
    expect([inch[0], inch[28]].map((v) => sizeLabelText(v, 'inch'))).toEqual(['1/16', '1/2']);
    expect(findPocketPreset('sockets-14')!.names).toEqual(['4', '4.5', '5', '5.5', '6', '7', '8', '9', '10', '11', '12', '13', '14']);
    expect(findPocketPreset('hexkeys')!).toMatchObject({ shape: 'hex', sizes: [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] });
  });

  it('switch between a set and a single item, resetting what the item defines', () => {
    const set = bin(preset('drills-10'));
    expect(set).toMatchObject({ pocketPreset: 'drills-10', pocketFloor: 'cone', pocketSizeLabels: 'mm' });
    const back = bin({ ...set, ...preset('18650') });
    expect(back).toMatchObject({ pocketPreset: '18650', pocketFloor: 'flat', pocketSizes: [], pocketSizeNames: [] });
    expect(bin({ ...set, pocketTilt: 20, ...preset('aa') }).pocketTilt).toBe(20); // the lean is a style, kept
    expect(bin(preset('nozzle'))).toMatchObject({ pocketFloor: 'stepped', pocketStepW: 6.4, pocketStepDepth: 7.5 });
    expect(CUSTOM_SET).toBe('custom-set');
  });
});

describe('fit an item', () => {
  it('makes the pocket the item plus clearance, a share of its height deep', () => {
    const aa = fitItem({ shape: 'round', w: 14.5, height: 50.5 });
    expect(aa).toMatchObject({ pocketPreset: 'custom', pocketShape: 'round', pocketW: 15, pocketD: 15, pocketDepth: 33.67, pocketSpacing: 1.8, pocketChamfer: 0.9, pocketSizes: [] });
    expect(FIT_DEFAULTS).toEqual({ clearance: 0.5, share: 2 / 3 });
    const card = fitItem({ shape: 'square', w: 24, d: 2.1, height: 32 }, 0.6, 0.5);
    expect(card).toMatchObject({ pocketShape: 'square', pocketW: 24.6, pocketD: 2.7, pocketDepth: 16, pocketSpacing: 1.2, pocketChamfer: 0.3 });
    const bit = fitItem({ shape: 'hex', w: 6.35, height: 25 }, 0.3, 1);
    expect(bit).toMatchObject({ pocketShape: 'hex', pocketW: 6.65, pocketD: 6.65, pocketDepth: 25 });
    // Clamped: at least 1 mm, chamfer at most a quarter of the depth.
    expect(fitItem({ shape: 'round', w: 0.2, height: 1 }, 0, 0.5)).toMatchObject({ pocketW: 1, pocketDepth: 1, pocketChamfer: 0.25 });
    expect(fitItem({ shape: 'round', w: 500, height: 900 }, -3, 7)).toMatchObject({ pocketW: 200, pocketDepth: 200 });
  });

  it('builds a bin that holds the item', () => {
    const o = { unitsX: 2, heightUnits: 8, ...fitItem({ shape: 'round', w: 18.5, height: 65 }) };
    const L = layoutOf(o);
    expect(L.pockets.length).toBeGreaterThan(2);
    expect(L.depth).toBeCloseTo(43.33, 2);
    expect(check(buildBin(w, bin(o))).components).toBe(1);
  });
});

describe('size lists and labels', () => {
  it('writes sizes in mm, inch fractions, or by name', () => {
    expect(sizeLabelText(2.5, 'mm')).toBe('2.5');
    expect(sizeLabelText(10, 'mm')).toBe('10');
    expect(sizeLabelText(1.59, 'inch')).toBe('1/16');
    expect(sizeLabelText(5.16, 'inch')).toBe('13/64');
    expect(sizeLabelText(25.4, 'inch')).toBe('1');
    expect(sizeLabelText(1.27, 'inch')).toBe('.05');
    expect(sizeLabelText(14.6, 'mm', '10')).toBe('10');
    expect(sizeLabelText(3, 'none', 'x')).toBe('');
  });

  it('parses typed lists in either unit, with names', () => {
    expect(parseSizeList('1, 1.5; 2mm', 'mm')).toEqual({ sizes: [1, 1.5, 2], names: [] });
    expect(parseSizeList('1/16, 5/64, 0.25', 'in')).toEqual({ sizes: [1.59, 1.98, 6.35], names: [] });
    expect(parseSizeList('12.6=8, 13.6 = 9 , 15', 'mm')).toEqual({ sizes: [12.6, 13.6, 15], names: ['8', '9', ''] });
    expect(parseSizeList('3, x', 'mm')).toBeNull();
    expect(parseSizeList('3, 0', 'mm')).toBeNull();
    expect(parseSizeList(' , ', 'mm')).toEqual({ sizes: [], names: [] });
    expect(formatSizeList([1, 1.5], [], 'mm')).toBe('1, 1.5');
    expect(formatSizeList([1.59, 1.98, 6.35], [], 'in')).toBe('1/16, 5/64, 1/4');
    expect(formatSizeList([12.6, 15], ['8', ''], 'mm')).toBe('12.6=8, 15');
    const inch = findPocketPreset('drills-inch')!.sizes!;
    expect(parseSizeList(formatSizeList(inch, [], 'in'), 'in')!.sizes).toEqual(inch);
    // Fractions with two-digit numerators aren't read as a whole number and a fraction.
    expect(parseLength('11/64', 'in')).toBeCloseTo((11 / 64) * 25.4, 9);
    expect(parseLength('20 1/8', 'in')).toBeCloseTo(20.125 * 25.4, 9);
    expect(parseLength('20-1/8in', 'mm')).toBeCloseTo(20.125 * 25.4, 9);
    expect(parseLength('3/4"', 'mm')).toBeCloseTo(0.75 * 25.4, 9);
  });
});

describe('leaning pockets', () => {
  it.each(['round', 'hex', 'square'] as const)('%s: lean back without running into each other, the walls or the floor', (shape) => {
    const o = { unitsX: 3, unitsY: 2, heightUnits: 6, pocketShape: shape, pocketW: 12, pocketD: 9, pocketTilt: 30 };
    const L = layoutOf(o);
    const upright = layoutOf({ ...o, pocketTilt: 0 });
    expect(L.pockets.length).toBeGreaterThan(4);
    expect(L.pockets.length).toBeLessThan(upright.pockets.length); // a lean takes more room
    expectApart(L, 2);
    const { w: W, d: D } = binSize(bin(o));
    expectInside(L, { x0: -W / 2 + 0.95, y0: -D / 2 + 0.95, x1: W / 2 - 0.95, y1: D / 2 - 0.95 }, 2);
    for (const p of L.pockets) {
      expect(p.tilt).toBe(30);
      expect(p.depth).toBeCloseTo(20, 6);
      // The deep end is behind the mouth: items tip toward the front.
      const ys = p.footprint.map((q) => q[1]);
      expect(Math.max(...ys) - p.y).toBeGreaterThan(p.y - Math.min(...ys) + 5);
      expect(p.bottom).toBeCloseTo(L.fillTop - 20 * Math.cos(30 * DEG), 6);
    }
    // Round: the lowest point of the bottom touches the floor.
    if (shape === 'round') expect(L.fillTop - 20 * Math.cos(30 * DEG) - 6 * Math.sin(30 * DEG)).toBeCloseTo(7, 6);
  });

  it('staggers leaning rows when that holds more', () => {
    const L = layoutOf({ unitsX: 3, unitsY: 3, heightUnits: 6, pocketTilt: 10 });
    const rowY = [...new Set(L.pockets.map((p) => p.y.toFixed(3)))];
    const xs = new Set(L.pockets.map((p) => p.x.toFixed(3)));
    const perRow = L.pockets.filter((p) => p.y.toFixed(3) === rowY[0]).length;
    expect(xs.size).toBeGreaterThan(perRow);
    expectApart(L, 2);
  });

  it('leans less in a bin too short for the lean, and says so', () => {
    const o = bin({ unitsX: 2, heightUnits: 2, pocketTilt: 45 });
    const L = layoutOf(o);
    expect(L.pockets.length).toBeGreaterThan(0);
    for (const p of L.pockets) {
      expect(p.tilt).toBeLessThan(45);
      expect(p.tilt).toBeGreaterThan(0);
    }
    expect(pocketSummary(o, L, fmt).warnings.some((m) => m.includes('lean'))).toBe(true);
  });
});

describe('pocket bottoms', () => {
  const o = { unitsX: 2, heightUnits: 5, pocketW: 12, pocketDepth: 16, pocketChamfer: 0 };
  const removed = (x: Partial<BinOptions>) => vol({ ...o, pocketW: 199 }) - vol({ ...o, ...x });

  it('cut what they should: cone, bore and round bottoms remove less than flat ones', () => {
    const n = layoutOf(o).pockets.length;
    const A = area48(6);
    expect(removed({})).toBeCloseTo(n * A * 16, -1);
    const hc = 6 / Math.tan(59 * DEG); // 118° point
    expect(removed({ pocketFloor: 'cone' })).toBeCloseTo(n * A * (16 - hc + hc / 3), -1);
    expect(removed({ pocketFloor: 'stepped', pocketStepW: 6, pocketStepDepth: 5 })).toBeCloseTo(n * A * (11 + 0.25 * 5), -1);
    const round = removed({ pocketFloor: 'round' });
    const hemisphere = (2 / 3) * Math.PI * 6 ** 3;
    expect(round).toBeGreaterThan(n * (A * 10 + 0.95 * hemisphere));
    expect(round).toBeLessThan(n * (A * 10 + hemisphere));
  });

  it('keep the pockets where they were', () => {
    const flat = layoutOf(o);
    for (const pocketFloor of ['round', 'cone', 'stepped'] as const) expect(layoutOf({ ...o, pocketFloor }).centers).toEqual(flat.centers);
  });
});

describe('magnets in pocket floors', () => {
  const o = { unitsX: 2, unitsY: 2, heightUnits: 6, pocketMagnet: true };
  const h = 2 + POCKET_MAGNET_FIT.depth;

  it('raise the floor to keep 0.6 mm of plastic under the recess', () => {
    expect(magnetLimit(7)).toBeGreaterThanOrEqual(4.75 + 0.6);
    expect(magnetLimit(1.2)).toBe(0.6);
    const L = layoutOf(o);
    expect(L.pockets).toHaveLength(20);
    for (const p of L.pockets) {
      expect(p.magnet).toBe(true);
      expect(p.bottom).toBeCloseTo(magnetLimit(7) + h, 6);
    }
    // The fill rises with the floor, so the pockets stay as deep as asked.
    expect(L.depth).toBeCloseTo(20, 6);
    expect(L.fillTop).toBeCloseTo(magnetLimit(7) + h + 20, 6);
    const F = layoutOf({ ...o, base: 'flat' });
    for (const p of F.pockets) expect(p.bottom).toBeCloseTo(0.6 + h, 6);
    // Too short for both: the magnets keep their floor, the pockets get shallower.
    const short = layoutOf({ ...o, heightUnits: 3 });
    expect(short.depth).toBeLessThan(20);
    expect(short.pockets[0].bottom).toBeCloseTo(magnetLimit(7) + h, 6);
  });

  it('cut a press-fit recess under each pocket', () => {
    const n = layoutOf(o).pockets.length;
    const r = (d: number) => (d + POCKET_MAGNET_FIT.diameter) / 2;
    expect(vol({ ...o, pocketMagnetD: 4 }) - vol(o)).toBeCloseTo(n * (area48(r(6)) - area48(r(4))) * h, 0);
  });

  it('sit where a round or pointed bottom is wide enough, so the floor rises less', () => {
    const flat = layoutOf(o).pockets[0].bottom;
    for (const pocketFloor of ['round', 'cone'] as const) {
      const p = layoutOf({ ...o, pocketFloor }).pockets[0];
      expect(p.magnet).toBe(true);
      expect(p.bottom).toBeLessThan(flat - 0.3);
    }
    // In a stepped pocket the magnet goes in the bore, if it fits.
    expect(layoutOf({ ...o, pocketFloor: 'stepped', pocketStepW: 8 }).pockets[0].magnet).toBe(true);
    expect(layoutOf({ ...o, pocketFloor: 'stepped', pocketStepW: 5 }).pockets[0].magnet).toBe(false);
  });

  it('skip pockets too narrow for them, and say so', () => {
    const m3 = bin({ ...o, ...preset('m3') });
    const L = layoutOf(m3);
    expect(L.pockets.every((p) => !p.magnet)).toBe(true);
    expect(L.pockets[0].bottom).toBe(7);
    expect(pocketSummary(m3, L, fmt).warnings).toContain('No pockets are wide enough for a 6 mm magnet.');
    // A 1/4″ hex bit pocket holds a 6 mm magnet.
    expect(layoutOf({ ...o, ...preset('hexbit') }).pockets.every((p) => p.magnet)).toBe(true);
  });
});

describe('finger grooves', () => {
  it('run along each row of staggered pockets without reaching the next row', () => {
    const L = layoutOf({ unitsX: 2, unitsY: 2, heightUnits: 6, pocketGrip: 'groove' });
    const rows = new Set(L.pockets.map((p) => p.y.toFixed(3)));
    expect(L.grooves).toHaveLength(rows.size);
    for (const g of L.grooves) {
      expect(g.y0).toBe(g.y1);
      expect(g.width).toBeGreaterThan(3);
      expect(g.width).toBeLessThanOrEqual(0.6 * 15 + 1e-9);
      expect(g.depth).toBeCloseTo(10, 6); // half the pockets' depth
      const row = L.pockets.filter((p) => Math.abs(p.y - g.y0) < 1e-6);
      expect(Math.min(...row.map((p) => p.x))).toBeCloseTo(g.x0, 6);
      expect(Math.max(...row.map((p) => p.x))).toBeCloseTo(g.x1, 6);
      const seg: [number, number][] = [
        [g.x0, g.y0],
        [g.x1, g.y1],
      ];
      for (const p of L.pockets.filter((q) => !row.includes(q))) expect(polyDistance(seg, p.footprint) - g.width / 2).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
    expect(vol({ unitsX: 2, unitsY: 2, heightUnits: 6, pocketGrip: 'groove' })).toBeLessThan(vol({ unitsX: 2, unitsY: 2, heightUnits: 6 }) - 100);
  });

  it('run across card slots, through each column', () => {
    const L = layoutOf({ unitsX: 2, heightUnits: 5, ...preset('sd'), pocketGrip: 'groove' });
    expect(L.grooves.length).toBeGreaterThan(0);
    for (const g of L.grooves) expect(g.x0).toBe(g.x1);
  });

  it('skip single pockets', () => {
    const L = layoutOf({ pocketW: 30, pocketGrip: 'groove' });
    expect(L.pockets).toHaveLength(1);
    expect(L.grooves).toEqual([]);
  });
});

describe('thumb notches', () => {
  it('sit on the front edge of every pocket and keep their distance', () => {
    const o = { unitsX: 2, unitsY: 2, heightUnits: 4, ...preset('quarter'), pocketGrip: 'notch' as const };
    const L = layoutOf(o);
    expect(L.pockets.length).toBeGreaterThan(2);
    expect(L.pockets.length).toBeLessThanOrEqual(layoutOf({ ...o, pocketGrip: 'none' }).pockets.length);
    for (const p of L.pockets) {
      expect(p.notch).toBeDefined();
      expect(p.notch!.x).toBeCloseTo(p.x, 9);
      expect(p.notch!.y).toBeCloseTo(p.y - p.d / 2, 9);
      expect(p.notch!.r).toBeCloseTo(0.3 * 24.8, 9);
      expect(p.notch!.depth).toBeCloseTo(7.5, 6);
    }
    expectApart(L, 2);
    // The notches cut more than the same pockets without them.
    const s = new Scope();
    try {
      const cut = (lay: PocketLayout) => s.t(w.Manifold.union(regionPocketCutters(w, s, bin(o), lay, 7, 30))).volume();
      expect(cut(L)).toBeGreaterThan(cut({ ...L, pockets: L.pockets.map((p) => ({ ...p, notch: undefined })) }) + L.pockets.length * 20);
    } finally {
      s.dispose();
    }
  });
});

describe('graduated sets', () => {
  it('pack sizes smallest first from the front, each labelled in front of its pocket', () => {
    const o = bin({ unitsX: 3, unitsY: 2, heightUnits: 4, ...preset('drills-10') });
    const L = layoutOf(o);
    expect(L.missing).toEqual([]);
    expect(L.pockets.map((p) => p.size).sort((a, b) => a! - b!)).toEqual(o.pocketSizes);
    const rows = [...new Set(L.pockets.map((p) => p.y))].sort((a, b) => a - b);
    expect(rows.length).toBeGreaterThan(1);
    let last = 0;
    for (const y of rows) {
      const row = L.pockets.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
      for (const p of row) {
        expect(p.size!).toBeGreaterThanOrEqual(last);
        last = p.size!;
        expect(p.w).toBeCloseTo(p.size! + 0.4, 9);
        expect(p.label!.text).toBe(sizeLabelText(p.size!, 'mm'));
        expect(p.label!.x).toBeCloseTo(p.x, 9);
        expect(p.label!.y + p.label!.h / 2).toBeLessThan(p.y - p.w / 2);
        expect(p.label!.h).toBeGreaterThan(POCKET_LABEL_SIZE);
      }
      // One label line per row.
      expect(new Set(row.map((p) => p.label!.y.toFixed(6))).size).toBe(1);
    }
    expectApart(L, 2);
    const { w: W, d: D } = binSize(o);
    expectInside(L, { x0: -W / 2 + 0.95, y0: -D / 2 + 0.95, x1: W / 2 - 0.95, y1: D / 2 - 0.95 }, 2);
    expect(pocketSummary(o, L, fmt).text).toBe('19 of 19 sizes, 15 mm deep');
  });

  it('say which sizes do not fit, by name', () => {
    const o = bin(preset('sockets-38'));
    const L = layoutOf(o);
    expect(L.pockets.length).toBeGreaterThan(0);
    expect(L.missing).toEqual([...Array(12).keys()].slice(L.pockets.length));
    expect(pocketSummary(o, L, fmt).warnings).toContain(`No room for sizes ${o.pocketSizeNames.slice(L.pockets.length).join(', ')}.`);
  });

  it('engrave the labels, and hex keys get hex pockets', () => {
    const o = { unitsX: 2, unitsY: 2, heightUnits: 4, ...preset('hexkeys') };
    expect(vol(o)).toBeLessThan(vol({ ...o, pocketSizeLabels: 'none' }) - 5);
    const L = layoutOf(o);
    expect(L.hexFlatX).toBe(true);
    expect(L.pockets.every((p) => p.footprint.length === 6)).toBe(true);
  });

  it('write inch sizes as fractions', () => {
    const L = layoutOf({ unitsX: 4, unitsY: 2, heightUnits: 4, ...preset('drills-inch') });
    expect(L.missing).toEqual([]);
    expect(L.pockets.map((p) => p.label!.text)).toContain('13/64');
  });
});

describe('pocket grids in a region', () => {
  const region: PocketRegion = { x0: -38, y0: -14, x1: 26, y1: 33 };
  const opts = (o: Partial<PocketFields>) => ({ ...DEFAULT_VARIANTS, ...o }) as PocketOpts;
  it.each<[string, PocketOpts]>([
    ['classic hex bits', opts(preset('hexbit'))],
    ['leaning, notched, round-bottomed, magnets', opts({ pocketTilt: 25, pocketGrip: 'notch', pocketFloor: 'round', pocketMagnet: true, pocketW: 11 })],
    ['grooves, cones, staggered', opts({ pocketGrip: 'groove', pocketFloor: 'cone', pocketW: 9, pocketDepth: 12 })],
    ['square slots leaning, stepped', opts({ ...preset('sd'), pocketTilt: 15, pocketFloor: 'stepped', pocketStepW: 12, pocketStepDepth: 4 })],
    ['drill index with grooves', opts({ ...preset('drills-10'), pocketGrip: 'groove' })],
    ['sockets with magnets and notches', opts({ ...preset('sockets-14'), pocketMagnet: true, pocketGrip: 'notch' })],
  ])('%s: everything stays inside the region and cuts cleanly', (_, o) => {
    const L = regionPocketLayout(o, region, 7, 30);
    expect(L.pockets.length).toBeGreaterThan(0);
    expectInside(L, region, Math.max(o.pocketSpacing, o.pocketChamfer + 0.4));
    const s = new Scope();
    try {
      const cut = s.t(w.Manifold.union(regionPocketCutters(w, s, o, L, 7, 31)));
      const inside = s.t(w.Manifold.cube([region.x1 - region.x0, region.y1 - region.y0, 100]).translate([region.x0, region.y0, -20]));
      expect(s.t(cut.subtract(inside)).volume()).toBeLessThan(1e-6);
      // Nothing reaches below the floor, except magnet recesses (down to their limit).
      expect(cut.boundingBox().min[2]).toBeGreaterThanOrEqual((o.pocketMagnet ? magnetLimit(7) : 7) - 1e-6);
      // Cut from a solid block, the pockets leave one valid solid.
      const block = s.t(w.Manifold.cube([region.x1 - region.x0 + 4, region.y1 - region.y0 + 4, L.fillTop]).translate([region.x0 - 2, region.y0 - 2, 0]));
      const result = s.t(block.subtract(cut));
      expect(result.status()).toBe('NoError');
      const parts = result.decompose();
      expect(parts.length).toBe(1);
      parts.forEach((p) => p.delete());
      expect(result.genus()).toBe(0);
    } finally {
      s.dispose();
    }
  });
});

describe('summary', () => {
  it('counts the pockets and warns when the bin is too short or nothing fits', () => {
    const tall = bin({ unitsX: 2, unitsY: 2, heightUnits: 6 });
    expect(pocketSummary(tall, layoutOf(tall), fmt)).toEqual({ text: '20 pockets, 20 mm deep', warnings: [] });
    const short = bin({ heightUnits: 3 });
    const s = pocketSummary(short, layoutOf(short), fmt);
    expect(s.text).toBe('4 pockets, 12.8 mm deep');
    expect(s.warnings).toEqual(['The bin is too short for 20 mm deep pockets.']);
    const none = bin({ pocketW: 199 });
    expect(pocketSummary(none, layoutOf(none), fmt).warnings).toEqual(['Nothing fits: make the bin bigger or the pockets smaller.']);
    const lean = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, pocketTilt: 30, pocketGrip: 'groove' });
    expect(pocketSummary(lean, layoutOf(lean), fmt).text).toMatch(/^\d+ pockets, 20 mm deep, leaning 30°, \d+ grooves?$/);
  });
});

describe('2D helpers', () => {
  it('hull and distance', () => {
    const sq = (x: number, y: number): [number, number][] => [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x + 0.5, y + 0.5],
    ];
    expect(hull2(sq(0, 0))).toHaveLength(4);
    expect(polyDistance(sq(0, 0), sq(3, 0))).toBeCloseTo(2, 9);
    expect(polyDistance(sq(0, 0), sq(4, 5))).toBeCloseTo(5, 9);
    expect(polyDistance(sq(0, 0), sq(0.5, 0.5))).toBe(0);
  });
});
