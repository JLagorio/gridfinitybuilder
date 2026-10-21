import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binSize, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { binBodyHeight, heightMmFor, DEFAULT_VARIANTS, FLAT_FLOOR, MIN_BODY_HEIGHT } from '../src/lib/geometry/variants';
import { holeSites } from '../src/lib/geometry/holes';
import { POCKET_PRESETS, pocketLayout, presetFields } from '../src/lib/geometry/pockets';
import { LID_FLOOR, LID_HEIGHT, LID_SEAT_DROP, buildBinLid, lidSize, lidStackHeight } from '../src/lib/geometry/lid';
import { LIP_SUPPORT_HEIGHT } from '../src/lib/geometry/spec';
import { maxBinUnits } from '../src/lib/bins';
import { DEFAULT_PROJECT, buildMesh, planJob, type MeshSpec, type PlacedBin } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_BASEPLATE, binSeatHeight } from '../src/lib/geometry/baseplate';
import { useStore } from '../src/state/store';
import { billOfMaterials } from '../src/lib/bom';

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

const bin = (o: Partial<BinOptions> = {}) => ({ ...DEFAULT_BIN, ...o }) as BinOptions;
const vol = (o: Partial<BinOptions>, cells?: { x: number[]; y: number[] }) => check(buildBin(w, bin(o), cells)).volume;

/** Volume shared by two meshes after moving the second one. */
function overlap(a: MeshData, b: MeshData, dx: number, dy: number, dz: number) {
  const ma = toManifold(a);
  const mb = toManifold(b);
  const moved = mb.translate([dx, dy, dz]);
  const both = ma.intersect(moved);
  const v = both.volume();
  [ma, mb, moved, both].forEach((m) => m.delete());
  return v;
}

describe('defaults keep the classic bin', () => {
  it('a bin without any variant fields (an old project) sanitizes to the defaults', () => {
    const old = { unitsX: 2, unitsY: 1, heightUnits: 4, lip: false, holes: 'magnets', divX: 2, divY: 1, scoop: 0, label: 'none', fillet: true };
    const o = sanitizeBin({ ...DEFAULT_BIN, ...old } as BinOptions);
    expect(o.lip).toBe(false);
    for (const [k, v] of Object.entries(DEFAULT_VARIANTS)) expect(o[k as keyof BinOptions]).toEqual(v);
    expect(binTotalHeight(o)).toBe(28);
  });

  it('classic mesh keys are unchanged', () => {
    expect(binKey(DEFAULT_BIN)).toBe('1-1-3-L-none-1-1-0-none-F');
    expect(binKey(bin({ unitsX: 2, lip: false, holes: 'both' }))).toBe('2-1-3-n-both-1-1-0-none-F');
  });

  it('every variant changes the key, and equal geometry shares one', () => {
    const variants: Partial<BinOptions>[] = [
      { base: 'lite' },
      { base: 'flat' },
      { base: 'efficient' },
      { lipStyle: 'reduced' },
      { lipNotches: true },
      { holes: 'magnets', holeCrushRibs: true },
      { holes: 'magnets', holeChamfer: true },
      { holes: 'magnets', holePrintable: true },
      { holes: 'magnets', holeCorners: true },
      { holes: 'refined' },
      { cutoutWalls: 'f' },
      { slideWalls: 'b' },
      { patternWalls: 'l' },
      { interior: 'pockets' },
      { heightMode: 'internal', heightMm: 30 },
    ];
    const keys = variants.map((v) => binKey(sanitizeBin(bin(v))));
    expect(new Set([binKey(DEFAULT_BIN), ...keys]).size).toBe(variants.length + 1);
    // 3u with a lip is 25 mm overall and 14 mm inside.
    expect(binKey(sanitizeBin(bin({ heightMode: 'external', heightMm: 25 })))).toBe(binKey(DEFAULT_BIN));
    expect(binKey(sanitizeBin(bin({ heightMode: 'internal', heightMm: 14 })))).toBe(binKey(DEFAULT_BIN));
    // Options that don't apply don't split meshes.
    expect(binKey(sanitizeBin(bin({ holeCrushRibs: true })))).toBe(binKey(DEFAULT_BIN));
    expect(binKey(sanitizeBin(bin({ lid: true })))).toBe(binKey(DEFAULT_BIN));
    expect(binKey(sanitizeBin(bin({ lip: false, lipStyle: 'reduced', lipNotches: true })))).toBe(binKey(bin({ lip: false })));
  });

  it('sanitizeBin clamps the new fields', () => {
    const o = sanitizeBin(
      bin({
        base: 'bogus' as never,
        cutoutWidth: 5,
        cutoutWalls: 'rfx',
        pocketSpacing: 0,
        pocketChamfer: -1,
        pocketW: 1e6,
        slideRadius: 0,
        heightMode: 'internal',
        heightMm: 1,
        holes: 'lasers' as never,
      }),
    );
    expect(o.base).toBe('standard');
    expect(o.cutoutWidth).toBe(1);
    expect(o.cutoutWalls).toBe('fr');
    expect(o.pocketSpacing).toBe(0.8);
    expect(o.pocketChamfer).toBe(0);
    expect(o.pocketW).toBe(200);
    expect(o.slideRadius).toBe(1);
    expect(o.holes).toBe('none');
    expect(binBodyHeight(o)).toBe(MIN_BODY_HEIGHT);
  });
});

describe('every variant is one closed solid with the right outside size', () => {
  it.each<{ name: string; o: Partial<BinOptions>; cells?: { x: number[]; y: number[] } }>([
    { name: 'refined holes', o: { holes: 'refined' } },
    { name: 'magnets: ribs, chamfer, printable top', o: { holes: 'magnets', holeCrushRibs: true, holeChamfer: true, holePrintable: true } },
    { name: 'magnets + screws: printable, chamfer', o: { holes: 'both', holeChamfer: true, holePrintable: true } },
    { name: 'screws: printable, chamfer', o: { holes: 'screws', holeChamfer: true, holePrintable: true } },
    { name: '3×2 corner-only magnets', o: { unitsX: 3, unitsY: 2, holes: 'magnets', holeCorners: true } },
    { name: 'lite', o: { base: 'lite' } },
    { name: 'lite 2×2, dividers, scoop, label, magnets', o: { base: 'lite', unitsX: 2, unitsY: 2, divX: 3, scoop: 0.5, label: 'full', holes: 'both' } },
    { name: 'lite on partial cells', o: { base: 'lite', unitsX: 2, holes: 'magnets' }, cells: { x: [42, 21], y: [30] } },
    { name: 'efficient 2×1, refined holes', o: { base: 'efficient', unitsX: 2, holes: 'refined', divX: 2 } },
    { name: 'flat 2×1 with dividers', o: { base: 'flat', unitsX: 2, divX: 2, holes: 'magnets' } },
    { name: 'flat without a lip', o: { base: 'flat', lip: false, heightUnits: 2 } },
    { name: 'reduced lip', o: { lipStyle: 'reduced', unitsX: 2, divX: 2 } },
    { name: 'notches 2×2', o: { unitsX: 2, unitsY: 2, lipNotches: true } },
    { name: 'notches, reduced lip, 3×1', o: { unitsX: 3, lipStyle: 'reduced', lipNotches: true } },
    { name: 'notches on partial cells', o: { unitsX: 2, unitsY: 2, lipNotches: true }, cells: { x: [42, 21], y: [42, 42] } },
    { name: 'inside height 30 mm', o: { heightMode: 'internal', heightMm: 30 } },
    { name: 'overall height 40 mm, no lip', o: { heightMode: 'external', heightMm: 40, lip: false } },
    { name: 'overall height 13.5 mm (minimum)', o: { heightMode: 'external', heightMm: 13.5 } },
    { name: 'cutouts on all walls', o: { unitsX: 2, unitsY: 2, heightUnits: 6, cutoutWalls: 'fblr', cutoutWidth: 0.6, cutoutDepth: 25 } },
    { name: 'deep cutout, clamped above the floor', o: { cutoutWalls: 'f', cutoutDepth: 200, cutoutWidth: 1 } },
    { name: 'finger slide front, dividers', o: { slideWalls: 'f', divX: 2 } },
    { name: 'finger slides, lite, label', o: { base: 'lite', unitsX: 2, slideWalls: 'fb', slideRadius: 6, label: 'left' } },
    { name: 'pockets: AA, 2×2×6u', o: { unitsX: 2, unitsY: 2, heightUnits: 6, interior: 'pockets' } },
    { name: 'pockets: hex bits on a lite base with a cutout', o: { unitsX: 2, interior: 'pockets', base: 'lite', cutoutWalls: 'f', ...presetFields(POCKET_PRESETS.find((p) => p.id === 'hexbit')!) } },
    { name: 'pockets: SD cards, flat base', o: { unitsX: 2, interior: 'pockets', base: 'flat', ...presetFields(POCKET_PRESETS.find((p) => p.id === 'sd')!) } },
    { name: 'pockets filled to the top', o: { interior: 'pockets', pocketW: 5, pocketDepth: 200 } },
    { name: 'hex pattern on every wall, tall', o: { unitsX: 2, unitsY: 2, heightUnits: 8, patternWalls: 'fblr', divX: 3 } },
    { name: 'hex pattern with a cutout, notches, lite', o: { unitsX: 2, heightUnits: 6, base: 'lite', patternWalls: 'fl', cutoutWalls: 'f', lipNotches: true, label: 'full' } },
    { name: 'hex pattern, no lip, small holes', o: { unitsX: 2, heightUnits: 4, lip: false, patternWalls: 'b', patternSize: 4, patternWeb: 1.5 } },
    { name: 'everything at once', o: { unitsX: 2, unitsY: 2, base: 'lite', lipStyle: 'reduced', lipNotches: true, holes: 'both', holePrintable: true, holeChamfer: true, holeCorners: true, cutoutWalls: 'fb', slideWalls: 'l', divX: 2, label: 'full' } },
  ])('$name', ({ o, cells }) => {
    const opts = sanitizeBin(bin(o));
    const mesh = buildBin(w, opts, cells);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const b = meshBounds(mesh);
    const size = binSize(opts, cells);
    expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(size.d, 3);
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(opts), 3);
  });
});

describe('bottom holes', () => {
  it('corner-only puts four holes on a multi-cell bin and skips partial corner cells', () => {
    const full = { x: [42, 42, 42], y: [42, 42] };
    expect(holeSites(full, false)).toHaveLength(24);
    const corners = holeSites(full, true);
    expect(corners).toHaveLength(4);
    expect(corners.map((s) => [Math.round(s.x * 100) / 100, Math.round(s.y * 100) / 100]).sort()).toEqual(
      [
        [-55, -34],
        [-55, 34],
        [55, -34],
        [55, 34],
      ].sort(),
    );
    expect(holeSites({ x: [42, 21], y: [42] }, true)).toHaveLength(2);
    // Same material removed per hole either way.
    const plain = vol({ unitsX: 3, unitsY: 2 });
    const all = plain - vol({ unitsX: 3, unitsY: 2, holes: 'magnets' });
    const four = plain - vol({ unitsX: 3, unitsY: 2, holes: 'magnets', holeCorners: true });
    expect(all / four).toBeCloseTo(6, 3);
  });

  it('refined slots open to the side and have a push-out hole through the bottom', () => {
    const c = check(buildBin(w, bin({ holes: 'refined' })));
    expect(c.genus).toBe(4);
    expect(c.volume).toBeLessThan(vol({}));
  });

  it('crush ribs leave material in the pocket; chamfers and printable tops remove more', () => {
    const plain = vol({ holes: 'magnets' });
    expect(vol({ holes: 'magnets', holeCrushRibs: true })).toBeGreaterThan(plain);
    expect(vol({ holes: 'magnets', holeChamfer: true })).toBeLessThan(plain);
    expect(vol({ holes: 'magnets', holePrintable: true })).toBeLessThan(plain);
  });

  it('printable tops stay blind: no hole reaches into the bin', () => {
    for (const holes of ['magnets', 'screws', 'both'] as const) {
      expect(check(buildBin(w, bin({ holes, holePrintable: true, holeChamfer: true }))).genus).toBe(0);
      expect(check(buildBin(w, bin({ holes, base: 'lite', holePrintable: true }))).genus).toBe(0);
    }
  });
});

describe('bases', () => {
  it('lite and efficient bases save plastic, lite the most', () => {
    const std = vol({ unitsX: 2, unitsY: 2 });
    const lite = vol({ unitsX: 2, unitsY: 2, base: 'lite' });
    const eff = vol({ unitsX: 2, unitsY: 2, base: 'efficient' });
    expect(lite).toBeLessThan(std * 0.6);
    expect(eff).toBeLessThan(std * 0.8);
    expect(lite).toBeLessThan(eff);
  });

  it('lite feet keep the base profile outside', () => {
    // The bottom face of a lite bin is the same 35.6 mm square as a solid one.
    const mesh = buildBin(w, bin({ base: 'lite' }));
    const p = mesh.positions;
    let max = -Infinity;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]) < 1e-6) max = Math.max(max, p[i]);
    expect(2 * max).toBeCloseTo(35.6, 3);
  });

  it('a flat bin has a flat bottom over its whole footprint and a thin floor', () => {
    const mesh = buildBin(w, bin({ base: 'flat', unitsX: 2 }));
    const p = mesh.positions;
    let maxX = -Infinity;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]) < 1e-6) maxX = Math.max(maxX, p[i]);
    expect(2 * maxX).toBeCloseTo(83.5, 3);
    // Same overall height, deeper inside.
    expect(binTotalHeight(bin({ base: 'flat' }))).toBe(binTotalHeight(DEFAULT_BIN));
    const s = toManifold(mesh);
    // Everything under the floor line is solid.
    const t = FLAT_FLOOR - 0.01;
    const below = s.trimByPlane([0, 0, -1], -t);
    expect(below.volume()).toBeCloseTo((83.5 * 41.5 - (4 - Math.PI) * 3.75 ** 2) * t, -1);
    [s, below].forEach((m) => m.delete());
  });
});

describe('lips', () => {
  it('a reduced lip opens up the inside and keeps the height', () => {
    expect(vol({ lipStyle: 'reduced' })).toBeLessThan(vol({}));
    expect(binTotalHeight(bin({ lipStyle: 'reduced' }))).toBe(binTotalHeight(DEFAULT_BIN));
  });

  it('notches only appear between cells', () => {
    expect(vol({ lipNotches: true })).toBeCloseTo(vol({}), 6);
    expect(vol({ unitsX: 2, unitsY: 2, lipNotches: true })).toBeGreaterThan(vol({ unitsX: 2, unitsY: 2 }) + 1);
  });

  it('notches stop a smaller bin stacked on top from sliding', () => {
    const H = binBodyHeight(DEFAULT_BIN);
    const small = buildBin(w, DEFAULT_BIN);
    const seat = H - LID_SEAT_DROP + 0.05;
    for (const lipNotches of [false, true]) {
      const big = buildBin(w, bin({ unitsX: 2, unitsY: 2, lipNotches }));
      // A 1×1 bin seated in the front-left cell fits either way...
      expect(overlap(big, small, -21, -21, seat)).toBeLessThan(1e-3);
      // ...but slid 2 mm toward the middle it only hits something with notches.
      const slid = overlap(big, small, -19, -21, seat);
      if (lipNotches) expect(slid).toBeGreaterThan(0.05);
      else expect(slid).toBeLessThan(1e-3);
    }
  });
});

describe('height modes', () => {
  it('inside and overall heights convert to the wall height', () => {
    expect(binTotalHeight(bin({ heightMode: 'internal', heightMm: 30 }))).toBeCloseTo(30 + 7 + 4, 6);
    expect(binTotalHeight(bin({ heightMode: 'internal', heightMm: 30, lip: false }))).toBeCloseTo(37, 6);
    expect(binTotalHeight(bin({ heightMode: 'internal', heightMm: 30, base: 'flat' }))).toBeCloseTo(30 + FLAT_FLOOR + 4, 6);
    expect(binTotalHeight(bin({ heightMode: 'external', heightMm: 33.3 }))).toBeCloseTo(33.3, 6);
    expect(binTotalHeight(bin({ heightMode: 'external', heightMm: 33.3, lip: false }))).toBeCloseTo(33.3, 6);
    // Switching modes keeps the bin the same.
    const o = bin({ heightUnits: 5 });
    expect(binTotalHeight({ ...o, heightMode: 'internal', heightMm: heightMmFor(o, 'internal') })).toBeCloseTo(binTotalHeight(o), 6);
    expect(binTotalHeight({ ...o, heightMode: 'external', heightMm: heightMmFor(o, 'external') })).toBeCloseTo(binTotalHeight(o), 6);
  });

  it('the mesh is as tall as binTotalHeight says, and planning warns with the same height', () => {
    const o = sanitizeBin(bin({ heightMode: 'external', heightMm: 47.5 }));
    expect(meshBounds(buildBin(w, o)).max[2]).toBeCloseTo(47.5, 3);
    // Exactly 47.5 mm of room above the baseplate floor.
    const drawer = { ...DEFAULT_DRAWER, height: binSeatHeight(DEFAULT_BASEPLATE) + 47.5 };
    const plan = (opts: BinOptions) => planJob({ ...DEFAULT_PROJECT, drawer, bins: [{ id: 'a', x: 0, y: 0, opts }] });
    const tooTall = (opts: BinOptions) => plan(opts).warnings.some((m) => m.includes('taller than the drawer'));
    expect(tooTall(o)).toBe(false);
    expect(tooTall(sanitizeBin({ ...o, heightMm: 47.6 }))).toBe(true);
    expect(tooTall(sanitizeBin(bin({ heightMode: 'internal', heightMm: 47.5 - 7 - 4 })))).toBe(false);
    expect(tooTall(sanitizeBin(bin({ heightMode: 'internal', heightMm: 47.5 - 7 - 4 + 0.1 })))).toBe(true);
    expect(plan(o).parts['bin:a'].h).toBeCloseTo(47.5, 6);
  });

  it('maxBinUnits agrees with binTotalHeight', () => {
    for (const room of [20, 25, 42.3, 60]) {
      for (const lip of [true, false]) {
        const u = maxBinUnits(room, lip);
        expect(binTotalHeight({ heightUnits: u, lip })).toBeLessThanOrEqual(room + 1e-6);
        expect(binTotalHeight({ heightUnits: u + 1, lip })).toBeGreaterThan(room);
      }
    }
  });
});

describe('wall cutouts and finger slides', () => {
  it('cutouts remove wall, slides add a ramp, neither changes the outside', () => {
    const plain = vol({ unitsX: 2 });
    expect(vol({ unitsX: 2, cutoutWalls: 'f' })).toBeLessThan(plain - 50);
    expect(vol({ unitsX: 2, cutoutWalls: 'fb' })).toBeLessThan(vol({ unitsX: 2, cutoutWalls: 'f' }) - 50);
    expect(vol({ unitsX: 2, slideWalls: 'f' })).toBeGreaterThan(plain + 50);
    // The hex pattern goes through the wall: one hole per hexagon, and less plastic.
    const tall = { unitsX: 2, heightUnits: 6 };
    const hex = check(buildBin(w, bin({ ...tall, patternWalls: 'f' })));
    expect(hex.genus).toBeGreaterThan(5);
    expect(hex.volume).toBeLessThan(vol(tall) - 100);
    expect(check(buildBin(w, bin({ heightUnits: 2, patternWalls: 'f' }))).genus).toBe(0); // too short: no holes
    // A cutout stops above the floor: the floor is intact.
    const deep = buildBin(w, bin({ cutoutWalls: 'f', cutoutDepth: 200, cutoutWidth: 1 }));
    expect(check(deep).genus).toBe(0);
  });
});

describe('pocket grid', () => {
  const area = (o: Partial<BinOptions>) => {
    const opts = sanitizeBin(bin(o));
    const { w: W, d: D } = binSize(opts);
    const H = binBodyHeight(opts);
    return pocketLayout(opts, W, D, 7, opts.lip ? H - LIP_SUPPORT_HEIGHT : H);
  };

  it('fits as many pockets as it can, staggering rows when that holds more', () => {
    const aa = area({ unitsX: 2, unitsY: 2, heightUnits: 6, interior: 'pockets' });
    expect(aa.centers.length).toBe(20); // 5 staggered rows of 4; a square grid holds 16
    expect(aa.depth).toBe(20);
    const sd = area({ unitsX: 2, interior: 'pockets', ...presetFields(POCKET_PRESETS.find((p) => p.id === 'sd')!) });
    expect(sd.centers.length).toBe(12);
    // Pockets never overlap and keep the spacing.
    for (const L of [aa]) {
      for (let i = 0; i < L.centers.length; i++)
        for (let j = i + 1; j < L.centers.length; j++) {
          const [a, b] = [L.centers[i], L.centers[j]];
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(15 + 2 - 1e-6);
        }
    }
  });

  it('cuts exactly the pockets it lays out', () => {
    const o = { unitsX: 2, unitsY: 1, heightUnits: 4, interior: 'pockets' as const, pocketW: 10, pocketDepth: 12, pocketChamfer: 0 };
    const n = area(o).centers.length;
    expect(n).toBeGreaterThan(4);
    const filled = vol({ ...o, pocketW: 199 }); // nothing fits: just the fill
    const polygon = 24 * 5 * 5 * Math.sin((2 * Math.PI) / 48); // 48-sided pocket, r = 5
    expect(filled - vol(o)).toBeCloseTo(n * polygon * 12, -1);
  });

  it('every preset fits at least one pocket in a 1×1 bin (2×1 for the widest) and builds', () => {
    for (const p of POCKET_PRESETS) {
      const o = { interior: 'pockets' as const, heightUnits: 5, unitsX: p.w > 36 ? 2 : 1, ...presetFields(p) };
      expect(area(o).centers.length, p.id).toBeGreaterThan(0);
      const c = check(buildBin(w, bin(o)));
      expect(c.status, p.id).toBe('NoError');
      expect(c.components, p.id).toBe(1);
    }
  });

  it('hex pockets have flats facing their neighbours', () => {
    const o = { unitsX: 2, interior: 'pockets' as const, ...presetFields(POCKET_PRESETS.find((p) => p.id === 'hexbit')!), pocketChamfer: 0 };
    const L = area(o);
    const filled = vol({ ...o, pocketW: 199 });
    const hexArea = (Math.sqrt(3) / 2) * 6.65 ** 2;
    expect(filled - vol(o)).toBeCloseTo(L.centers.length * hexArea * L.depth, -1);
    // Nearest neighbours sit exactly one flat-to-flat pitch apart.
    let min = Infinity;
    for (let i = 1; i < L.centers.length; i++) min = Math.min(min, Math.hypot(L.centers[i][0] - L.centers[0][0], L.centers[i][1] - L.centers[0][1]));
    expect(min).toBeCloseTo(6.65 + 2, 6);
  });
});

describe('lids', () => {
  it('is one closed solid the size of the bin', () => {
    for (const [o, cells] of [
      [{}, undefined],
      [{ unitsX: 3, unitsY: 2 }, undefined],
      [{ unitsX: 2 }, { x: [42, 21], y: [30] }],
    ] as [Partial<BinOptions>, { x: number[]; y: number[] } | undefined][]) {
      const mesh = buildBinLid(w, bin(o), cells);
      const c = check(mesh);
      expect(c.status).toBe('NoError');
      expect(c.components).toBe(1);
      expect(c.genus).toBe(0);
      const b = meshBounds(mesh);
      const size = lidSize(bin(o), cells);
      expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 3);
      expect(b.max[1] - b.min[1]).toBeCloseTo(size.d, 3);
      expect(b.max[2] - b.min[2]).toBeCloseTo(LID_HEIGHT, 3);
    }
  });

  it('sits in the lip of its bin, and a bin stacks on it', () => {
    for (const o of [{ unitsX: 2 }, { unitsX: 2, lipNotches: true }, { unitsX: 2, lipStyle: 'reduced' as const }]) {
      const b = buildBin(w, bin(o));
      const lid = buildBinLid(w, bin(o));
      const H = binBodyHeight(bin(o));
      expect(overlap(b, lid, 0, 0, H - LID_SEAT_DROP + 0.05)).toBeLessThan(1e-3);
      // It rests there: any lower and it would collide.
      expect(overlap(b, lid, 0, 0, H - LID_SEAT_DROP - 0.2)).toBeGreaterThan(0.1);
      // A bin on top of the lid stands on the receptacle floor.
      expect(overlap(lid, b, 0, 0, LID_FLOOR + 0.02)).toBeLessThan(1e-3);
      expect(overlap(lid, b, 0, 0, LID_FLOOR - 0.2)).toBeGreaterThan(0.1);
      expect(lidStackHeight(bin(o))).toBeCloseTo(H - LID_SEAT_DROP + LID_HEIGHT, 6);
    }
  });

  it('planning prints one lid per bin that has one, packed with the bins', () => {
    const bins: PlacedBin[] = [
      { id: 'a', x: 0, y: 0, opts: sanitizeBin(bin({ lid: true })) },
      { id: 'b', x: 1, y: 0, opts: sanitizeBin(bin({ lid: true, heightUnits: 6 })) },
      { id: 'c', x: 2, y: 0, opts: sanitizeBin(bin({ lid: true, lip: false })) },
      { id: 'd', x: 3, y: 0, opts: sanitizeBin(bin({ unitsX: 2 })) },
    ];
    const job = planJob({ ...DEFAULT_PROJECT, bins });
    const lids = Object.values(job.parts).filter((p) => p.kind === 'lid');
    expect(lids.map((p) => p.key).sort()).toEqual(['lid:a', 'lid:b']);
    // Same footprint, same mesh.
    expect(new Set(lids.map((p) => p.meshKey)).size).toBe(1);
    const placed = job.plates.flatMap((pl) => pl.placements.map((p) => p.key));
    expect(placed).toEqual(expect.arrayContaining(['lid:a', 'lid:b', 'bin:a', 'bin:d']));
    const spec = job.meshes[lids[0].meshKey] as Extract<MeshSpec, { kind: 'lid' }>;
    expect(spec.kind).toBe('lid');
    const mesh = buildMesh(w, spec);
    const b = meshBounds(mesh);
    expect(b.min.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0]);
    expect(b.max[0]).toBeCloseTo(41.5, 3);
    // Bins only: no lids.
    const off = planJob({ ...DEFAULT_PROJECT, bins, include: { baseplate: true, bins: false } });
    expect(off.plates.flatMap((pl) => pl.placements).some((p) => p.key.startsWith('lid:'))).toBe(false);
  });

  it('warns when a bin fits the drawer but not with its lid on', () => {
    const opts = sanitizeBin(bin({ lid: true, heightUnits: 3 }));
    const total = binTotalHeight(opts); // 25; with the lid on, 21 − 0.35 + 10 = 30.65
    const plan = (room: number) =>
      planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, height: binSeatHeight(DEFAULT_BASEPLATE) + room }, bins: [{ id: 'a', x: 0, y: 0, opts }] });
    expect(plan(lidStackHeight(opts)).warnings).toEqual([]);
    expect(plan(total + 1).warnings.join(' ')).toMatch(/with its lid is taller than the drawer/);
    expect(plan(total - 1).warnings.join(' ')).not.toMatch(/with its lid/);
  });
});

describe('bill of materials', () => {
  const bomFor = (bins: PlacedBin[]) => {
    const b = billOfMaterials(planJob({ ...DEFAULT_PROJECT, bins }));
    const count = (item: string) => b.hardware.find((h) => h.item.startsWith(item))?.count ?? 0;
    return { b, magnets: count('Magnets 6'), screws: count('M3 screws') };
  };
  const at = (id: string, x: number, o: Partial<BinOptions>): PlacedBin => ({ id, x, y: 0, opts: sanitizeBin(bin(o)) });

  it('counts bin magnets and screws the way the holes are cut', () => {
    expect(bomFor([at('a', 0, { unitsX: 3, unitsY: 2, holes: 'magnets' })]).magnets).toBe(24);
    expect(bomFor([at('a', 0, { unitsX: 3, unitsY: 2, holes: 'magnets', holeCorners: true })]).magnets).toBe(4);
    const both = bomFor([at('a', 0, { unitsX: 2, holes: 'both', holeCorners: true })]);
    expect([both.magnets, both.screws]).toEqual([4, 4]);
    expect(bomFor([at('a', 0, { holes: 'refined' })]).magnets).toBe(4);
    expect(bomFor([at('a', 0, { holes: 'magnets', base: 'flat' })]).magnets).toBe(0);
    expect(bomFor([at('a', 0, { holes: 'magnets', base: 'lite' })]).magnets).toBe(4);
  });

  it('lists lids as their own parts', () => {
    const { b } = bomFor([at('a', 0, { lid: true }), at('b', 1, { lid: true }), at('c', 2, {})]);
    expect(b.parts).toEqual({ pieces: expect.any(Number), bins: 3, lids: 2, keys: 0, dividers: 0, labels: 0 });
  });
});

describe('store', () => {
  it('loads an old project and keeps lip: false', () => {
    const s = useStore.getState();
    s.resetAll();
    s.loadProject({
      app: 'gridfit',
      version: 2,
      bins: [{ id: 'x', x: 0, y: 0, opts: { unitsX: 1, unitsY: 1, heightUnits: 4, lip: false, holes: 'magnets', divX: 1, divY: 1, scoop: 0, label: 'none', fillet: true } }],
    });
    const b = useStore.getState().bins[0];
    expect(b.opts.lip).toBe(false);
    expect(b.opts.base).toBe('standard');
    expect(b.opts.heightMode).toBe('units');
    expect(binTotalHeight(b.opts)).toBe(28);
    useStore.getState().updateBin('x', { opts: { heightMode: 'external', heightMm: 30, cutoutWidth: 9 } });
    const u = useStore.getState().bins[0].opts;
    expect(binTotalHeight(u)).toBeCloseTo(30, 6);
    expect(u.cutoutWidth).toBe(1);
    s.resetAll();
  });
});
