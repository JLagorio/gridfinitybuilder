import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binSize, buildBin } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { cellSizes, computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { planBaseplate, DEFAULT_SETUP } from '../src/lib/layout/plan';
import { maxBinUnits } from '../src/lib/bins';
import { DEFAULT_PROJECT, binCellsAt, planJob, planPrint, type NamedDrawer } from '../src/lib/project';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

function check(mesh: MeshData) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const REF = { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 };

describe('edge fill', () => {
  it('solid keeps the classic layout', () => {
    const l = computeLayout(REF);
    expect([l.nx, l.ny]).toEqual([12, 8]);
    expect(l.xs[0]).toBe(3);
    expect(l.xs.at(-1)).toBe(507);
  });

  it('partial cells turn the margins into narrower cells', () => {
    const l = computeLayout({ ...REF, fill: 'fit', alignY: 0 });
    // 40 mm of leftover depth goes into one partial row at the back.
    expect(l.ny).toBe(9);
    expect(l.ys.at(-1)! - l.ys.at(-2)!).toBeCloseTo(40, 6);
    expect(l.margins.back).toBe(0);
    // 3 mm side margins are too thin and stay solid.
    expect(l.nx).toBe(12);
    expect(l.margins.left).toBe(3);
  });

  it('centered partial cells split the gap into two rows', () => {
    const l = computeLayout({ ...REF, fill: 'fit' });
    expect(l.ny).toBe(10);
    expect(l.ys[1] - l.ys[0]).toBeCloseTo(20, 6);
  });

  it('half cells add 21 mm cells and leave the rest solid', () => {
    const l = computeLayout({ ...REF, fill: 'half', alignY: 0 });
    expect(l.ny).toBe(9);
    expect(l.ys.at(-1)! - l.ys.at(-2)!).toBeCloseTo(21, 6);
    expect(l.margins.back).toBeCloseTo(19, 6);
  });

  it('uses the smallest of several measurements', () => {
    const l = computeLayout({ ...REF, widthSamples: [508.2, 512], depthSamples: [380] });
    expect(l.plateW).toBeCloseTo(507.7, 6);
    expect(l.plateD).toBeCloseTo(376, 6);
  });

  it('splits the baseplate on partial-cell boundaries', () => {
    const l = computeLayout({ ...REF, fill: 'fit', alignY: 0 });
    const plan = planBaseplate(l, DEFAULT_SETUP);
    expect(plan.error).toBeUndefined();
    const covered = plan.pieces.reduce((t, p) => t + (p.cells.x1 - p.cells.x0) * (p.cells.y1 - p.cells.y0), 0);
    expect(covered).toBe(l.nx * l.ny);
  });

  it('a piece with partial cells is one valid solid with one hole per cell', () => {
    const l = computeLayout({ ...REF, width: 200, depth: 160, fill: 'fit', alignX: 0, alignY: 0 });
    const plan = planBaseplate(l, DEFAULT_SETUP);
    expect(plan.pieces).toHaveLength(1);
    const piece = plan.pieces[0];
    const c = check(buildBaseplatePiece(w, l, piece, DEFAULT_BASEPLATE));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(l.nx * l.ny);
    const m = check(buildBaseplatePiece(w, l, piece, { ...DEFAULT_BASEPLATE, magnets: true }));
    expect(m.status).toBe('NoError');
  });
});

describe('bins on partial cells', () => {
  it('get feet sized to each cell', () => {
    const cells = { x: [42, 30], y: [21] };
    const opts = { ...DEFAULT_BIN, unitsX: 2, unitsY: 1, holes: 'magnets' as const, divX: 2, label: 'full' as const };
    const mesh = buildBin(w, opts, cells);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const b = meshBounds(mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(71.5, 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(20.5, 3);
    expect(binSize(opts, cells)).toEqual({ w: 71.5, d: 20.5 });
  });

  it('planJob gives bins on partial cells their own mesh', () => {
    const drawer = { ...REF, fill: 'fit' as const, alignY: 0 };
    const l = computeLayout(drawer);
    const back = l.ny - 1;
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer,
      bins: [
        { id: 'a', x: 0, y: back, opts: { ...DEFAULT_BIN } },
        { id: 'b', x: 1, y: 0, opts: { ...DEFAULT_BIN } },
      ],
    });
    expect(binCellsAt(l, { id: 'a', x: 0, y: back, opts: DEFAULT_BIN })).toEqual({ x: [42], y: [40] });
    expect(job.parts['bin:a'].d).toBeCloseTo(39.5, 6);
    expect(job.parts['bin:b'].d).toBeCloseTo(41.5, 6);
    expect(job.parts['bin:a'].meshKey).not.toBe(job.parts['bin:b'].meshKey);
    expect(cellSizes(l.ys, back, 2, 42)).toEqual([40, 42]);
  });
});

describe('drawer height', () => {
  it('finds the tallest bin that fits', () => {
    // 3u with a lip is 21 + 3.99 = 24.99 mm tall.
    expect(maxBinUnits(25, true)).toBe(3);
    expect(maxBinUnits(24.9, true)).toBe(2);
    expect(maxBinUnits(28, false)).toBe(4);
    expect(maxBinUnits(0, true)).toBe(0);
  });

  it('warns about bins taller than the drawer', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer: { ...REF, height: 30 },
      bins: [{ id: 'a', x: 0, y: 0, opts: { ...DEFAULT_BIN, heightUnits: 6 } }],
    });
    expect(job.warnings.some((m) => m.includes('taller than the drawer'))).toBe(true);
  });
});

describe('multi-drawer print', () => {
  const drawers: NamedDrawer[] = [
    { id: 'k', name: 'Kitchen', drawer: { ...REF, width: 300, depth: 250 }, baseplate: DEFAULT_BASEPLATE, bins: [{ id: 'x', x: 0, y: 0, opts: DEFAULT_BIN }] },
    { id: 'g', name: 'Garage', drawer: { ...REF, width: 200, depth: 200 }, baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' }, bins: [{ id: 'x', x: 1, y: 1, opts: DEFAULT_BIN }] },
  ];

  it('gives each drawer its baseplate plates and pools the bins', () => {
    const job = planPrint(drawers, DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.drawers.map((d) => d.name)).toEqual(['Kitchen', 'Garage']);
    // Part keys are namespaced so bins with the same id in two drawers don't collide.
    expect(job.parts['k/bin:x']).toBeDefined();
    expect(job.parts['g/bin:x']).toBeDefined();
    expect(job.parts['k/bin:x'].meshKey).toBe(job.parts['g/bin:x'].meshKey);
    const binPlates = job.plates.filter((p) => p.group === 'bins');
    expect(binPlates).toHaveLength(1);
    expect(binPlates[0].placements).toHaveLength(2);
    for (const pl of job.plates.filter((p) => p.group === 'baseplate')) {
      const owners = new Set(pl.placements.map((p) => job.parts[p.key].drawer));
      expect(owners.size).toBe(1);
      expect(pl.name.startsWith('Kitchen') || pl.name.startsWith('Garage')).toBe(true);
    }
    // Every placement points at a real part.
    for (const pl of job.plates) for (const p of pl.placements) expect(job.parts[p.key]).toBeDefined();
    expect(job.drawers[1].plateOffset).toBe(job.drawers[0].plateCount);
  });

  it('a single drawer keeps plain keys', () => {
    const job = planPrint([drawers[0]], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.parts['bin:x']).toBeDefined();
    expect(job.parts['piece:1']).toBeDefined();
  });
});
