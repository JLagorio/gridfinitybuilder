import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds, toMeshData } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binLabel, binSize, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { boxAt } from '../src/lib/geometry/shapes';
import {
  activeContainer,
  containerBase,
  containerDefs,
  registerContainer,
  sanitizeContainerFields,
  type ContainerDef,
} from '../src/lib/geometry/containers';
import { DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const solid = (m: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));

/** A stand-in type: a base with a block on top, and one loose plate per `plates`. */
interface TestOpts {
  plates: number;
  top: number;
}
const TEST: ContainerDef<TestOpts> = {
  kind: 'dispenser',
  label: 'Test box',
  description: 'For tests.',
  defaults: { plates: 1, top: 20 },
  sanitize(raw) {
    const r = (raw ?? {}) as Partial<TestOpts>;
    return { plates: Math.max(0, Math.min(4, Math.round(Number(r.plates ?? 1)))), top: Math.max(10, Math.min(60, Number(r.top) || 20)) };
  },
  key: (o) => `${o.plates}/${o.top}`,
  height: (_bin, o) => o.top,
  build(w, bin, o, cells) {
    const s = new Scope();
    try {
      const { w: W, d: D } = binSize(bin, cells);
      const base = containerBase(w, s, bin, cells, 7);
      return toMeshData(s.t(w.Manifold.union([base, s.t(boxAt(w, -W / 2 + 2, -D / 2 + 2, 6.9, W / 2 - 2, D / 2 - 2, o.top))])));
    } finally {
      s.dispose();
    }
  },
  parts: (_bin, o) =>
    Array.from({ length: o.plates }, (_, i) => ({
      slot: 'plate',
      index: i,
      name: `Plate ${i + 1}`,
      kind: 'lid' as const,
      meshKey: `testplate|${o.top}`,
      spec: { size: o.top },
      w: o.top,
      d: 10,
      h: 2,
      assembled: { x: 1, y: 2, z: o.top },
    })),
  buildPart(w, spec) {
    const s = new Scope();
    try {
      const { size } = spec as { size: number };
      return toMeshData(s.t(boxAt(w, 0, 0, 0, size, 10, 2)));
    } finally {
      s.dispose();
    }
  },
  summary: (_bin, o) => `${o.plates} plates`,
  notes: (_bin, o) => (o.top > 50 ? ['very tall'] : []),
};
registerContainer(TEST);

const bin = (o: Partial<BinOptions> = {}): BinOptions => ({ ...DEFAULT_BIN, unitsX: 2, unitsY: 1, ...o });
const asTest = (o: Partial<TestOpts> = {}, more: Partial<BinOptions> = {}) => bin({ container: 'dispenser', containers: { dispenser: o }, ...more });

describe('container types', () => {
  it('leave plain bins exactly as they were', () => {
    const plain = sanitizeBin(bin());
    expect('container' in plain && plain.container !== undefined).toBe(false);
    expect(plain.containers).toBeUndefined();
    expect(binKey(plain)).toBe(binKey(sanitizeBin(bin({ container: 'bin' }))));
    expect(activeContainer(plain)).toBeNull();
    // A bad type is dropped; options of a type are kept while another type is active.
    expect(sanitizeBin(bin({ container: 'nope' as never })).container).toBeUndefined();
    const kept = sanitizeBin(bin({ containers: { dispenser: { plates: 9 } } }));
    expect(kept.containers?.dispenser).toEqual({ plates: 4, top: 20 });
    expect(binKey(kept)).toBe(binKey(plain));
    expect(sanitizeContainerFields({ containers: { box: { anything: 1 } } }).containers).toEqual({ box: { anything: 1 } });
  });

  it('dispatch the key, height, name and body to the type', () => {
    const o = sanitizeBin(asTest({ plates: 2, top: 30 }));
    expect(containerDefs().map((d) => d.kind)).toContain('dispenser');
    expect(binTotalHeight(o)).toBe(30);
    expect(binKey(o)).not.toBe(binKey(sanitizeBin(asTest({ plates: 2, top: 31 }))));
    expect(binKey(o)).toContain('Kdispenser{2/30}');
    expect(binLabel(o)).toBe('2×1×3u test box 2 plates');
    const m = buildBin(w, o);
    const b = meshBounds(m);
    expect(b.max[2]).toBeCloseTo(30, 5);
    const sol = solid(m);
    expect(sol.status()).toBe('NoError');
    expect(sol.decompose().length).toBe(1);
  });

  it('plan their parts instead of the bin’s lid and plates, with where they sit', () => {
    const o = asTest({ plates: 2, top: 55 }, { lid: true, label: 'full', labelText: 'X', labelPlates: true });
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 2 }, bins: [{ id: 'c', x: 0, y: 0, opts: o }] });
    const kinds = Object.values(job.parts).map((p) => p.key);
    expect(kinds).toContain('bin:c');
    expect(kinds).toContain('plate:c:0');
    expect(kinds).toContain('plate:c:1');
    expect(kinds.some((k) => k.startsWith('lid:') || k.startsWith('label:'))).toBe(false);
    const p = job.parts['plate:c:1'];
    expect(p).toMatchObject({ kind: 'lid', bin: 'c', assembled: { x: 1, y: 2, z: 55 }, w: 55, d: 10, h: 2 });
    expect(job.warnings.some((x) => x.includes('very tall'))).toBe(true);
    const mesh = buildMesh(w, job.meshes[p.meshKey]);
    expect(meshBounds(mesh).max).toEqual([55, 10, 2]);
  });

  it('stand on a base with feet and holes', () => {
    const s = new Scope();
    try {
      const o = sanitizeBin(bin({ holes: 'magnets' }));
      const cells = { x: [42, 42], y: [42] };
      const base = containerBase(w, s, o, cells, 7);
      expect(base.status()).toBe('NoError');
      const plain = containerBase(w, s, sanitizeBin(bin()), cells, 7);
      // Two cells × four magnet holes, 6.5 × 2.4 mm.
      expect(plain.volume() - base.volume()).toBeCloseTo(8 * Math.PI * 3.25 ** 2 * 2.4, -1);
    } finally {
      s.dispose();
    }
  });
});
