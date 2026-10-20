import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { meshVolume } from '../src/lib/geometry/volume';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, planBaseplate } from '../src/lib/layout/plan';
import { DEFAULT_PROJECT, buildMesh, planJob, type PlacedBin } from '../src/lib/project';
import { billOfMaterials, bomCsv, bomText, filamentFor } from '../src/lib/bom';
import { planTestFit } from '../src/lib/testfit';

const bin = (id: string, x: number, y: number, o: Partial<BinOptions> = {}): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, ...o } });
const grid = (gridX: number, gridY: number): DrawerInput => ({ ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY });
const hw = (b: ReturnType<typeof billOfMaterials>, re: RegExp) => b.hardware.filter((h) => re.test(h.item)).reduce((t, h) => t + h.count, 0);

describe('bill of materials', () => {
  it('counts magnets in the baseplate and in bins', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer: grid(3, 2),
      baseplate: { ...DEFAULT_BASEPLATE, magnets: true },
      bins: [bin('a', 0, 0, { unitsX: 2, holes: 'magnets' }), bin('b', 2, 0, { holes: 'both' }), bin('c', 0, 1)],
    });
    const b = billOfMaterials(job);
    expect(hw(b, /baseplate/)).toBe(6 * 4);
    expect(hw(b, /Magnets.*bins/)).toBe(2 * 4 + 4);
    expect(hw(b, /screws \(bins\)/)).toBe(4);
    expect(b.parts).toEqual({ pieces: 1, bins: 3, lids: 0, keys: 0 });
  });

  it('partial edge cells get no holes', () => {
    // 40 mm of leftover depth becomes one partial row at the back.
    const drawer: DrawerInput = { ...DEFAULT_DRAWER, width: 126.5, depth: 124.5, clearance: 0.5, fill: 'fit', alignY: 0 };
    const layout = computeLayout(drawer);
    expect(layout.ny).toBe(3);
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer,
      baseplate: { ...DEFAULT_BASEPLATE, magnets: true },
      bins: [bin('a', 0, 1, { unitsY: 2, holes: 'magnets' })],
    });
    const b = billOfMaterials(job);
    expect(hw(b, /baseplate/)).toBe(3 * 2 * 4);
    expect(hw(b, /bins/)).toBe(4);
  });

  it('counts connector keys, screws and no magnets without a floor', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer: { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 },
      baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie', screws: true },
    });
    const b = billOfMaterials(job);
    expect(b.parts.keys).toBe(job.connectors.length);
    expect(b.parts.keys).toBeGreaterThan(0);
    expect(hw(b, /countersunk/)).toBe(12 * 8);
    expect(hw(b, /Magnets/)).toBe(0);
  });

  it('turns volumes into grams and metres, per plate and in total', () => {
    expect(filamentFor(1000).grams).toBeCloseTo(1.116, 3);
    expect(filamentFor(1000).meters).toBeCloseTo(0.3742, 3);
    const job = planJob({ ...DEFAULT_PROJECT, drawer: grid(2, 2), bins: [bin('a', 0, 0), bin('b', 1, 0)] });
    const none = billOfMaterials(job);
    expect(none.total.grams).toBeNull();
    const b = billOfMaterials(job, () => 10_000);
    expect(b.plates.map((p) => p.parts)).toEqual([1, 2]);
    expect(b.plates[1].volume).toBe(20_000);
    expect(b.total.grams).toBeCloseTo(3 * 11.16, 2);
    const csv = bomCsv(b);
    expect(csv.split('\n')[0]).toMatch(/^Section,Item,Quantity/);
    expect(csv).toContain('Total,2 plates,3,30,33.5,11.2');
    expect(bomText(b)).toContain('Filament total: 33 g');
  });
});

describe('mesh volume', () => {
  let w: Wasm;
  beforeAll(async () => {
    w = await Module();
    w.setup();
  });
  const manifoldVolume = (mesh: MeshData) => {
    const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
    const v = m.volume();
    m.delete();
    return v;
  };

  it('matches Manifold for bins and baseplate pieces', () => {
    const b = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, divX: 2, holes: 'magnets', scoop: 0.5 });
    expect(meshVolume(b)).toBeCloseTo(manifoldVolume(b), 1);
    const layout = computeLayout(grid(2, 2));
    const plan = planBaseplate(layout, DEFAULT_SETUP);
    const p = buildBaseplatePiece(w, layout, plan.pieces[0], { ...DEFAULT_BASEPLATE, magnets: true });
    expect(meshVolume(p)).toBeCloseTo(manifoldVolume(p), 1);
    // A 1×1×3u bin is a few cm³ of plastic.
    expect(meshVolume(buildBin(w, DEFAULT_BIN)) / 1000).toBeGreaterThan(5);
    expect(meshVolume(buildBin(w, DEFAULT_BIN)) / 1000).toBeLessThan(20);
  });

  it('test-fit kit: a 2×2 sample split for one connector, plus a 1×1 bin, on one plate', () => {
    const kit = planTestFit({ ...DEFAULT_BASEPLATE, connector: 'bowtie', magnets: true }, { ...DEFAULT_BIN, unitsX: 3, holes: 'magnets' }, DEFAULT_SETUP);
    expect(kit.plates).toHaveLength(1);
    const kinds = kit.plates[0].placements.map((p) => kit.parts[p.key].kind).sort();
    expect(kinds).toEqual(['bin', 'key', 'piece', 'piece']);
    const b = billOfMaterials(kit);
    expect(hw(b, /baseplate/)).toBe(16);
    expect(hw(b, /bins/)).toBe(4);
    // Every part builds.
    for (const p of kit.plates[0].placements) expect(buildMesh(w, kit.meshes[kit.parts[p.key].meshKey]).indices.length).toBeGreaterThan(0);
    const plain = planTestFit(DEFAULT_BASEPLATE, DEFAULT_BIN, DEFAULT_SETUP);
    expect(plain.plates[0].placements.map((p) => plain.parts[p.key].kind).sort()).toEqual(['bin', 'piece']);
    expect(plain.parts['piece:1'].w).toBe(84);
  });
});
