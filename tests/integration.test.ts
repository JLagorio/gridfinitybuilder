import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, removableInserts, type BinOptions } from '../src/lib/geometry/bin';
import { PRESETS } from '../src/lib/dividers';

/** Features built in parallel, checked together. */
let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

function check(mesh: MeshData) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.layout;
const removable = () => {
  const l = structuredClone(preset('half-quarters'));
  l.walls[0].removable = true;
  return l;
};

describe('divider layouts on bin variants', () => {
  it.each([
    { name: 'L-ish layout on a lite base', o: { base: 'lite', layout: preset('big-3-small') } },
    { name: 'layout on an efficient floor', o: { base: 'efficient', layout: preset('tool-tray'), scoop: 0.6, label: 'full' } },
    { name: 'layout on a flat bin', o: { base: 'flat', layout: preset('half-quarters') } },
    { name: 'removable wall on a lite base', o: { base: 'lite', layout: removable() } },
    { name: 'removable wall, reduced lip, magnets', o: { lipStyle: 'reduced', holes: 'magnets', layout: removable() } },
    { name: 'layout + finger slide + wall cutout', o: { layout: preset('rows-2x4'), slideWalls: 'f', cutoutWalls: 'f', patternWalls: 'lr', heightUnits: 8 } },
    { name: 'layout ignored in pocket mode', o: { interior: 'pockets', layout: preset('rows-2x4') } },
    { name: 'inside-depth height with layout', o: { heightMode: 'internal', heightMm: 30, layout: preset('sorter-3x3') } },
  ])('$name is one valid solid', ({ o }) => {
    const opts = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, ...o } as BinOptions;
    // Every option name in the table must be a real BinOptions field.
    for (const k of Object.keys(o)) expect(k in DEFAULT_BIN).toBe(true);
    const c = check(buildBin(w, opts));
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.volume).toBeGreaterThan(1000);
  });

  it('removable inserts follow the bin height mode and floor', () => {
    const base = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, layout: removable() } as BinOptions;
    const units = removableInserts(base);
    const tall = removableInserts({ ...base, heightMode: 'internal', heightMm: 60 } as BinOptions);
    expect(units.length).toBeGreaterThan(0);
    expect(tall[0].height).toBeGreaterThan(units[0].height + 20);
    expect(removableInserts({ ...base, interior: 'pockets' } as BinOptions)).toEqual([]);
  });
});

describe('tool bins and blocked cells', () => {
  it('"Make a bin" skips blocked cells', async () => {
    const { firstFreeSpot } = await import('../src/lib/tools');
    const { computeLayout, DEFAULT_DRAWER } = await import('../src/lib/layout/drawer');
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 2, mask: ['0,0', '1,0'] });
    expect(firstFreeSpot(layout, [], 2, 1)).toEqual({ x: 2, y: 0 });
  });
});
