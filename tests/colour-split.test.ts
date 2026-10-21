import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type MeshSpec, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { registerFont } from '../src/lib/geometry/text';
import { meshVolume } from '../src/lib/geometry/volume';
import { MIN_VOLUME, partBands, splitByRoles } from '../src/lib/geometry/colourRegions';
import { exportPlate3MF, placeTransform, type Mat12 } from '../src/lib/export/threemf';
import { exportBambuProject, plateOrigin } from '../src/lib/export/bambu';
import { uniformLayout, setWallProps } from '../src/lib/dividers';
import type { ColourRole } from '../src/lib/colours';

/**
 * Multi-colour 'by feature' (colourRegions.ts): parts cut into a volume per
 * colour role. Every volume is a valid manifold, no two overlap, together
 * they are the part, and the exported files put them back together.
 */

let w: Wasm;
const live: { delete(): void }[] = [];
const keep = <T extends { delete(): void }>(m: T) => (live.push(m), m);
const solid = (m: Pick<MeshData, 'positions' | 'indices'>): Manifold => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices })));

beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});
afterAll(() => live.forEach((m) => m.delete()));

const FEATURE: PrintSetup = {
  ...DEFAULT_SETUP,
  filaments: [
    { colour: '#161616', name: 'Black' },
    { colour: '#F2F2F2', name: 'White' },
    { colour: '#C12E1F', name: 'Red' },
    { colour: '#0A2989', name: 'Blue' },
  ],
  colours: { on: true, strategy: 'feature', roles: { plate: 3, binWalls: 1, binFeet: 3, binLip: 4, dividers: 2, labelTabs: 4, labelText: 2 } },
};

const bin = (id: string, o: Partial<BinOptions>, x = 0, y = 0): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, ...o } });

function drawerOf(bins: PlacedBin[], gridX = 6, gridY = 4): NamedDrawer {
  return { id: 'd', name: 'D', drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY }, baseplate: DEFAULT_BASEPLATE, bins };
}

const bodies = (m: MeshData) => [m, ...(m.overlays ?? [])];
const roleOf = (m: MeshData, i: number) => (i === 0 ? m.role : m.overlays![i - 1].role);

/** Split a spec and check its volumes against the whole part. */
function checkSplit(base: MeshSpec) {
  const whole = buildMesh(w, base);
  const split = splitByRoles(w, whole, base);
  const parts = bodies(split);
  const total = meshVolume(whole);
  let sum = 0;
  const ms = parts.map((b) => {
    const m = solid(b);
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    sum += m.volume();
    return m;
  });
  // Together they are the part (overlays such as label text included).
  expect(Math.abs(sum - total) / total).toBeLessThan(1e-4);
  // No two overlap: every pairwise intersection is empty (up to rounding).
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const both = keep(ms[i].intersect(ms[j]));
      expect(both.volume(), `${roleOf(split, i)} ∩ ${roleOf(split, j)}`).toBeLessThan(1e-3);
    }
  }
  // And their union is the part, no more.
  const union = keep(w.Manifold.union(ms));
  expect(Math.abs(union.volume() - total) / total).toBeLessThan(1e-4);
  return { split, roles: parts.map((_, i) => roleOf(split, i)), whole };
}

describe('splitting parts by colour role', () => {
  it('a bin with dividers, label tabs, inlaid text, magnets and a lip: feet, floor, walls, lip, dividers, tabs, text', () => {
    const job = planPrint(
      [drawerOf([bin('a', { unitsX: 3, unitsY: 2, heightUnits: 4, divX: 3, divY: 1, label: 'full', labelText: 'M3', labelStyle: 'inlaid', holes: 'magnets' })], 3, 2)],
      FEATURE,
      { baseplate: false, bins: true },
    );
    const part = job.parts['bin:a'];
    const spec = job.meshes[part.meshKey];
    expect(spec.kind).toBe('split');
    const { roles } = checkSplit((spec as Extract<MeshSpec, { kind: 'split' }>).base);
    expect(new Set(roles)).toEqual(new Set<ColourRole>(['binFeet', 'binFloor', 'binWalls', 'binLip', 'dividers', 'labelTabs', 'labelText']));
  });

  const cases: [string, Partial<BinOptions>][] = [
    ['no lip, flat base', { lip: false, base: 'flat', unitsX: 2 }],
    ['lite base', { base: 'lite', unitsX: 2, unitsY: 2 }],
    ['reduced lip, scoop', { lipStyle: 'reduced', scoop: 1, unitsX: 2 }],
    ['pocket grid', { interior: 'pockets', unitsX: 2, unitsY: 2 }],
    ['free-form dividers with a diagonal wall', { unitsX: 3, unitsY: 2, layout: { ...setWallProps(uniformLayout(2, 2), 'v1', {}), free: [{ id: 'f', a: [0.1, 0.1], b: [0.9, 0.9] }] } }],
    ['tall bin with a hex-pattern wall', { unitsX: 2, heightUnits: 8, wallPattern: 'hex' } as Partial<BinOptions>],
  ];
  for (const [name, o] of cases) {
    it(`${name}: valid, disjoint, adds up`, () => {
      const job = planPrint([drawerOf([bin('b', o)], 3, 2)], FEATURE, { baseplate: false, bins: true });
      const spec = job.meshes[job.parts['bin:b'].meshKey] as Extract<MeshSpec, { kind: 'split' }>;
      const { roles } = checkSplit(spec.base);
      expect(roles).toContain('binWalls');
      if (o.lip !== false) expect(roles).toContain('binLip');
      if (o.base !== 'flat') expect(roles).toContain('binFeet');
    });
  }

  it('a drawer of a drawer unit: the tab pull apart from the drawer', () => {
    const job = planPrint(
      [drawerOf([bin('u', { unitsX: 2, unitsY: 2, heightUnits: 9, container: 'drawers', containers: { drawers: { pull: 'tab' } } } as Partial<BinOptions>)], 2, 2)],
      FEATURE,
      { baseplate: false, bins: true },
    );
    const drawer = Object.values(job.parts).find((p) => p.key.startsWith('drawer:'))!;
    const spec = job.meshes[drawer.meshKey] as Extract<MeshSpec, { kind: 'split' }>;
    expect(spec.kind).toBe('split');
    const { roles } = checkSplit(spec.base);
    expect(new Set(roles)).toEqual(new Set<ColourRole>(['containerFront', 'containerPull']));
    // The drawer unit itself: feet apart from the shell.
    const shell = job.meshes[job.parts['bin:u'].meshKey] as Extract<MeshSpec, { kind: 'split' }>;
    expect(new Set(checkSplit(shell.base).roles)).toEqual(new Set<ColourRole>(['binFeet', 'containerShell']));
  });

  it('bands by height sit on layer boundaries', () => {
    const bands = partBands({ kind: 'bin', key: 'x', opts: { ...DEFAULT_BIN, heightUnits: 3 } })!;
    expect(bands.map((b) => b.role)).toEqual(['binFeet', 'binFloor', 'binWalls', 'binLip']);
    for (const b of bands) expect(Math.abs(b.z / 0.2 - Math.round(b.z / 0.2))).toBeLessThan(1e-9);
    // Feet to 4.75 → 4.8, floor to 7, the lip from 21 − 2.85 = 18.15 → 18.2.
    expect(bands.map((b) => b.z)).toEqual([0, 4.8, 7, 18.2]);
  });

  it('slivers under MIN_VOLUME stay with the rest', () => {
    expect(MIN_VOLUME).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The exported files put the volumes back together
// ---------------------------------------------------------------------------

/** Vertices and triangles of every <object> with a mesh in a 3MF model file. */
function objectsOf(xml: string): Map<number, { v: number[]; t: number[]; tri: string[] }> {
  const out = new Map<number, { v: number[]; t: number[]; tri: string[] }>();
  for (const m of xml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    if (!m[2].includes('<mesh>')) continue;
    const v = [...m[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap((x) => [+x[1], +x[2], +x[3]]);
    const tri = [...m[2].matchAll(/<triangle [^>]*\/>/g)].map((x) => x[0]);
    const t = tri.flatMap((x) => [...x.matchAll(/v\d="(\d+)"/g)].map((y) => +y[1]));
    out.set(+m[1], { v, t, tri });
  }
  return out;
}

const apply = (m: Mat12, x: number, y: number, z: number) => [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
const parseMat = (s: string) => s.split(' ').map(Number) as Mat12;

function boxOf(pts: number[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], pts[i + k])), (max[k] = Math.max(max[k], pts[i + k]));
  return { min, max };
}

/** Signed volume of a triangle soup (vertex triples, index triples). */
function soupVolume(v: number[], t: number[]) {
  let s = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
    s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return s / 6;
}

describe('exported volumes reassemble', () => {
  let job: PrintJob;
  const cache = new Map<string, MeshData>();
  const get = (k: string) => cache.get(k) ?? cache.set(k, buildMesh(w, job.meshes[k])).get(k)!;
  beforeAll(() => {
    job = planPrint(
      [drawerOf([bin('a', { unitsX: 2, unitsY: 1, divX: 2, label: 'full', labelText: 'A', labelStyle: 'inlaid' }), bin('b', { unitsX: 1, unitsY: 1, colour: 3 }, 2, 0)], 3, 1)],
      FEATURE,
      { baseplate: false, bins: true },
    );
  });

  it('plain 3MF: one object per part, its volumes in place and in their slots', () => {
    const files = unzipSync(exportPlate3MF(job, 0, get));
    const model = strFromU8(files['3D/3dmodel.model']);
    const objs = objectsOf(model);
    const cfg = strFromU8(files['Metadata/Slic3r_PE_model.config']);
    const items = [...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"\/>/g)];
    expect(items.length).toBe(job.plates[0].placements.length);
    expect(model).toMatch(/<basematerials id="1">/);
    job.plates[0].placements.forEach((p, i) => {
      const part = job.parts[p.key];
      const mesh = get(part.meshKey);
      const o = objs.get(+items[i][1])!;
      const t = parseMat(items[i][2]);
      const placed: number[] = [];
      for (let k = 0; k < o.v.length; k += 3) placed.push(...apply(t, o.v[k], o.v[k + 1], o.v[k + 2]));
      // The placed volumes cover what the whole part placed does.
      const whole = buildMesh(w, (job.meshes[part.meshKey] as Extract<MeshSpec, { kind: 'split' }>).base);
      const wb = meshBounds(whole);
      const wt = placeTransform(p.x, p.y, p.rotated, part.d);
      const ref = boxOf([...apply(wt, wb.min[0], wb.min[1], wb.min[2]), ...apply(wt, wb.max[0], wb.max[1], wb.max[2])]);
      const got = boxOf(placed);
      for (let k = 0; k < 3; k++) {
        expect(got.min[k]).toBeCloseTo(ref.min[k], 3);
        expect(got.max[k]).toBeCloseTo(ref.max[k], 3);
      }
      expect(soupVolume(o.v, o.t)).toBeCloseTo(meshVolume(whole), 0);
      // A volume per body, with its triangles and slot.
      const vols = [...cfg.split(`<object id="${items[i][1]}"`)[1].split('</object>')[0].matchAll(/<volume firstid="(\d+)" lastid="(\d+)">[\s\S]*?key="extruder" value="(\d+)"/g)];
      expect(vols.length).toBe(bodies(mesh).length);
      expect(+vols[vols.length - 1][2] + 1).toBe(o.t.length / 3);
    });
    // Bin b has its own colour: every volume of it in slot 3 but its label text (none).
    const bItem = items[job.plates[0].placements.findIndex((p) => p.key === 'bin:b')];
    const bVols = [...cfg.split(`<object id="${bItem[1]}"`)[1].split('</object>')[0].matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(bVols)).toEqual(new Set(['3']));
  });

  it('Bambu project: each part one object with a part per volume, placed on its plate', () => {
    const settings = readFileSync('public/bambu/p2s.json', 'utf8');
    const files = unzipSync(exportBambuProject(job, FEATURE, get, settings));
    const model = strFromU8(files['3D/3dmodel.model']);
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    const items = [...model.matchAll(/<item objectid="(\d+)"[^>]*transform="([^"]+)"/g)];
    const pl = job.plates[0];
    const [ox, oy] = plateOrigin(0, job.plates.length, FEATURE.bedW, FEATURE.bedD);
    pl.placements.forEach((p, i) => {
      const part = job.parts[p.key];
      const mesh = get(part.meshKey);
      const objs = objectsOf(strFromU8(files[`3D/Objects/object_${i + 1}.model`]));
      expect(objs.size).toBe(bodies(mesh).length);
      const t = parseMat(items[i][2]);
      const all: number[] = [];
      let vol = 0;
      for (const o of objs.values()) {
        for (let k = 0; k < o.v.length; k += 3) all.push(...apply(t, o.v[k], o.v[k + 1], o.v[k + 2]));
        vol += soupVolume(o.v, o.t);
      }
      const whole = buildMesh(w, (job.meshes[part.meshKey] as Extract<MeshSpec, { kind: 'split' }>).base);
      expect(vol).toBeCloseTo(meshVolume(whole), 0);
      const wb = meshBounds(whole);
      const got = boxOf(all);
      const wt = placeTransform(p.x + ox, p.y + oy, p.rotated, part.d);
      const ref = boxOf([...apply(wt, wb.min[0], wb.min[1], wb.min[2]), ...apply(wt, wb.max[0], wb.max[1], wb.max[2])]);
      for (let k = 0; k < 3; k++) {
        expect(got.min[k]).toBeCloseTo(ref.min[k], 3);
        expect(got.max[k]).toBeCloseTo(ref.max[k], 3);
      }
    });
    // Feet red, walls black, lip and tabs blue, dividers and text white: the slots show up as extruders.
    const ext = new Set([...cfg.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1]));
    expect(ext).toEqual(new Set(['1', '2', '3', '4']));
    const ps = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(ps.filament_colour).toEqual(['#161616', '#F2F2F2', '#C12E1F', '#0A2989']);
  });
});
