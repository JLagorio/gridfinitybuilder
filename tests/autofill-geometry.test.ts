import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_PROJECT, buildMesh, planJob, type PlacedBin } from '../src/lib/project';
import { planFill, plannedBins } from '../src/lib/autofill';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

function check(mesh: MeshData) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const out = { status: m.status(), volume: m.volume() };
  m.delete();
  return out;
}

describe('bins from a list', () => {
  it('build as valid solids, labels and all', () => {
    const drawer = { ...DEFAULT_DRAWER, height: 70 };
    const plan = planFill(
      '200 M3 screws\n50 M3 nuts\n100 M3 washers\n12 AA batteries\n10 CR2032\nhex keys 2-6mm\nzip ties\nsharpies x6\nmisc small parts\nelectrical tape',
      { layout: computeLayout(drawer), drawer, baseplate: DEFAULT_BASEPLATE, setup: DEFAULT_SETUP, bins: [], tools: [], newBin: DEFAULT_BIN },
    );
    const bins: PlacedBin[] = plannedBins(plan.placed).map((b, i) => ({ id: `b${i}`, ...b }));
    expect(bins).toHaveLength(plan.proposals.length);
    const job = planJob({ ...DEFAULT_PROJECT, drawer, bins });
    // No bin is taller than the drawer.
    expect(job.warnings.filter((x) => /taller|tall/i.test(x))).toEqual([]);
    const specs = Object.values(job.meshes).filter((m) => m.kind !== 'piece' && m.kind !== 'key');
    expect(specs.length).toBeGreaterThanOrEqual(bins.length);
    for (const spec of specs) {
      const c = check(buildMesh(w, spec));
      expect(c.status, spec.key).toBe('NoError');
      expect(c.volume).toBeGreaterThan(0);
    }
  });
});
