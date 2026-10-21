import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { meshVolume } from '../src/lib/geometry/volume';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, planBaseplate } from '../src/lib/layout/plan';
import { DEFAULT_PROJECT, buildMesh, planJob, type PlacedBin } from '../src/lib/project';
import { billOfMaterials, bomCsv, bomText, filamentFor, filamentNote } from '../src/lib/bom';
import type { PlateEstimate } from '../src/lib/estimate';
import { planTestFit } from '../src/lib/testfit';

const bin = (id: string, x: number, y: number, o: Partial<BinOptions> = {}): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, ...o } });
const grid = (gridX: number, gridY: number): DrawerInput => ({ ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY });
const hw = (b: ReturnType<typeof billOfMaterials>, re: RegExp) => b.hardware.filter((h) => re.test(h.item)).reduce((t, h) => t + h.count, 0);
/** A sliced plate's estimate: what the BOM reads from it. */
const sliced = (extruded: number, seconds = 1800): PlateEstimate => ({
  seconds,
  printSeconds: seconds,
  prepareSeconds: 0,
  layers: 100,
  swaps: 0,
  wasteGrams: 0,
  extruded,
  breakdown: { walls: 0, skin: 0, infill: 0, travel: 0, cooling: 0, swaps: 0 },
});

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
    expect(b.parts).toEqual({ pieces: 1, bins: 3, lids: 0, keys: 0, dividers: 0, labels: 0 });
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
    // Volumes are already "as printed", so this is just density and cross-section.
    expect(filamentFor(1000).grams).toBeCloseTo(1.24, 3);
    expect(filamentFor(1000).meters).toBeCloseTo(0.4158, 3);
    const job = planJob({ ...DEFAULT_PROJECT, drawer: grid(2, 2), bins: [bin('a', 0, 0), bin('b', 1, 0)] });
    const none = billOfMaterials(job);
    expect(none.total.grams).toBeNull();
    const b = billOfMaterials(job, () => 10_000);
    expect(b.plates.map((p) => p.parts)).toEqual([1, 2]);
    expect(b.plates[1].volume).toBe(20_000);
    expect(b.total.grams).toBeCloseTo(3 * 12.4, 2);
    const csv = bomCsv(b);
    expect(csv.split('\n')[0]).toMatch(/^Section,Item,Quantity/);
    expect(csv).toContain('Total,2 plates,3,30,37.2,12.5');
    expect(bomText(b)).toContain('Filament total: 37 g');
    expect(b.plates.every((p) => !p.sliced)).toBe(true);
  });

  it("takes a sliced plate's filament from its estimate, the rest from the mesh volumes, in every figure", () => {
    const job = planJob({ ...DEFAULT_PROJECT, drawer: grid(2, 2), bins: [bin('a', 0, 0), bin('b', 1, 0)] });
    const setup = { ...DEFAULT_SETUP, filamentPrice: 30 };
    // The baseplate plate isn't sliced yet; the bins plate is, and extrudes less than its mesh volumes say.
    const b = billOfMaterials(job, () => 10_000, { plates: [null, sliced(15_000)], setup, printer: 'x' });
    expect(b.plates.map((p) => [p.volume, p.sliced])).toEqual([
      [10_000, false],
      [15_000, true],
    ]);
    const g = filamentFor(15_000);
    expect(b.plates[1].grams).toBeCloseTo(g.grams, 9);
    expect(b.plates[1].meters).toBeCloseTo(g.meters, 9);
    // Cost is those grams at the price per kg.
    expect(b.plates[1].cost!.filament).toBeCloseTo((g.grams * 30) / 1000, 9);
    expect(b.plates[0].cost).toBeNull();
    expect(b.total.volume).toBe(25_000);
    expect(b.total.sliced).toBe(false);
    expect(b.total.grams).toBeCloseTo(filamentFor(25_000).grams, 9);
    // The exports show the same numbers.
    const csv = bomCsv(b);
    expect(csv).toContain(`Plate,2. ${b.plates[1].name},2,15,18.6,6.2,30`);
    expect(csv).toContain('Total,2 plates,3,25,31,10.4');
    const text = bomText(b);
    expect(text).toContain(`2. ${b.plates[1].name}: 2 parts, 19 g, 6.2 m`);
    expect(text).toContain('Filament total: 31 g, 10.4 m');

    // Sliced plates need no mesh volumes.
    const all = billOfMaterials(job, () => undefined, { plates: [sliced(5_000), sliced(15_000)], setup, printer: 'x' });
    expect(all.total.volume).toBe(20_000);
    expect(all.total.sliced).toBe(true);
    expect(all.total.cost!.filament).toBeCloseTo((filamentFor(20_000).grams * 30) / 1000, 9);
  });

  it('says where the filament figure comes from', () => {
    const note = filamentNote();
    expect(note).toContain('1.75 mm PLA at 1.24 g/cm³');
    expect(note).toContain('sliced layers');
    expect(note).toContain('15 % infill');
    expect(note).toContain('±10 %');
    expect(note).toContain('before a plate is sliced');
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
  it('counts thin walls fully and solid bases at infill density', async () => {
    const { printedVolume } = await import('../src/lib/geometry/volume');
    const bin = buildBin(w, DEFAULT_BIN);
    const solid = meshVolume(bin);
    const printed = printedVolume(bin);
    // A 1×1×3u bin's solid base is mostly infill, so well under its solid volume.
    expect(printed).toBeLessThan(solid * 0.8);
    expect(printed).toBeGreaterThan(solid * 0.3);
    // Grams in the range slicers report for a 1×1×3u bin (≈ 8–15 g).
    const g = filamentFor(printed).grams;
    expect(g).toBeGreaterThan(7);
    expect(g).toBeLessThan(16);
  });
});
