import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin } from '../src/lib/geometry/bin';
import { meshVolume } from '../src/lib/geometry/volume';
import { exportPlatesStlZip, writeSTL } from '../src/lib/export/stl';
import { placeTransform } from '../src/lib/export/threemf';
import { DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

/** Minimal binary STL reader for the tests. */
function readSTL(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  const tris: { n: number[]; v: number[][] }[] = [];
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50;
    const f = (k: number) => dv.getFloat32(o + k * 4, true);
    tris.push({ n: [f(0), f(1), f(2)], v: [0, 1, 2].map((j) => [f(3 + j * 3), f(4 + j * 3), f(5 + j * 3)]) });
  }
  return { header: new TextDecoder().decode(bytes.slice(0, 80)).replace(/\0+$/, ''), count, tris };
}

/** Unit cube [0,1]³, outward-facing triangles. */
const cube: MeshData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
};

const stlVolume = (tris: { v: number[][] }[]) =>
  tris.reduce((t, { v: [a, b, c] }) => t + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

describe('binary STL', () => {
  it('writes header, count, outward unit normals and vertices', () => {
    const bytes = writeSTL([{ mesh: cube }], 'cube');
    expect(bytes.length).toBe(84 + 50 * 12);
    const stl = readSTL(bytes);
    expect(stl.header.startsWith('solid')).toBe(false);
    expect(stl.header).toContain('cube');
    expect(stl.count).toBe(12);
    for (const t of stl.tris) {
      expect(Math.hypot(...t.n)).toBeCloseTo(1, 6);
      // Normal points away from the cube's center.
      const c = [0, 1, 2].map((k) => (t.v[0][k] + t.v[1][k] + t.v[2][k]) / 3 - 0.5);
      expect(c[0] * t.n[0] + c[1] * t.n[1] + c[2] * t.n[2]).toBeGreaterThan(0);
    }
    expect(stlVolume(stl.tris)).toBeCloseTo(1, 6);
  });

  it('applies placement transforms and merges items', () => {
    const rotated = placeTransform(10, 20, true, 1);
    const stl = readSTL(writeSTL([{ mesh: cube }, { mesh: cube, transform: rotated }]));
    expect(stl.count).toBe(24);
    const second = stl.tris.slice(12).flatMap((t) => t.v);
    const min = [0, 1, 2].map((k) => Math.min(...second.map((v) => v[k])));
    const max = [0, 1, 2].map((k) => Math.max(...second.map((v) => v[k])));
    expect(min).toEqual([10, 20, 0]);
    expect(max).toEqual([11, 21, 1]);
    // Rotation keeps the triangles facing outward.
    expect(stlVolume(stl.tris)).toBeCloseTo(2, 5);
  });

  describe('with real geometry', () => {
    let w: Wasm;
    beforeAll(async () => {
      w = await Module();
      w.setup();
    });

    it('a bin round-trips with the same volume', () => {
      const mesh = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, holes: 'magnets' });
      const stl = readSTL(writeSTL([{ mesh }], 'bin'));
      expect(stl.count).toBe(mesh.indices.length / 3);
      expect(stlVolume(stl.tris)).toBeCloseTo(meshVolume(mesh), 0);
    });

    it('zips one STL per plate plus the assembly map', () => {
      const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 2, gridY: 1 } });
      const cache = new Map<string, MeshData>();
      const get = (k: string) => {
        if (!cache.has(k)) cache.set(k, buildMesh(w, job.meshes[k]));
        return cache.get(k)!;
      };
      const files = unzipSync(exportPlatesStlZip(job, get));
      const names = Object.keys(files);
      expect(names.filter((n) => n.endsWith('.stl'))).toHaveLength(job.plates.length);
      expect(names).toContain('assembly-map.txt');
      expect(readSTL(files[names.find((n) => n.endsWith('.stl'))!]).count).toBeGreaterThan(100);
    });
  });
});
