import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strToU8, zipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { meshVolume } from '../src/lib/geometry/volume';
import { buildMesh } from '../src/lib/project';
import { writeSTL } from '../src/lib/export/stl';
import { exportSingle3MF, placeTransform, write3MF } from '../src/lib/export/threemf';
import { parseMeshFile } from '../src/lib/imported/parse';
import { detectFootprint, detectHeight, fitAxis, footprintNote } from '../src/lib/imported/footprint';
import { bounds, boxSize, decimate, isClosed, placeMesh, weld } from '../src/lib/imported/meshOps';
import { decodeMesh, encodeMesh, isMeshHash, meshHash } from '../src/lib/imported/format';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

/** One of Gridfit's own bins, as a part (min corner at the origin). */
const gridfitBin = (o: Partial<BinOptions> = {}): MeshData => buildMesh(w, { kind: 'bin', key: 'test', opts: { ...DEFAULT_BIN, ...o } });

function asciiSTL(m: MeshData, name = 'bin'): string {
  const p = m.positions;
  const lines = [`solid ${name}`];
  for (let i = 0; i < m.indices.length; i += 3) {
    lines.push(' facet normal 0 0 0', '  outer loop');
    for (let k = 0; k < 3; k++) {
      const v = m.indices[i + k] * 3;
      lines.push(`   vertex ${p[v].toExponential(7)} ${p[v + 1].toExponential(7)} ${p[v + 2].toExponential(7)}`);
    }
    lines.push('  endloop', ' endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

const near = (a: readonly number[], b: readonly number[], eps = 0.01) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('reading STL', () => {
  it('reads a binary STL of a Gridfit bin back: size, triangles, a closed solid', () => {
    const mesh = gridfitBin();
    const objs = parseMeshFile('bin-1x1.stl', writeSTL([{ mesh }], 'Gridfit bin'));
    expect(objs).toHaveLength(1);
    const o = objs[0];
    expect(o.name).toBe('bin-1x1');
    expect(near(o.size, [41.5, 41.5, 25])).toBe(true);
    // Slivers whose corners meet in float32 collapse (and go): a few at most.
    expect(o.triangles).toBeLessThanOrEqual(mesh.indices.length / 3);
    expect(o.triangles).toBeGreaterThan(0.97 * (mesh.indices.length / 3));
    expect(o.closed).toBe(true);
    expect(o.volume).toBeCloseTo(meshVolume(mesh), 0);
    // Centred on its footprint, bottom at z = 0.
    const b = bounds(o.mesh.positions);
    expect(near([b.min[0], b.max[0], b.min[2]], [-20.75, 20.75, 0])).toBe(true);
  });

  it('reads ASCII STL, even when the binary sniff could be fooled by "solid"', () => {
    const mesh = gridfitBin({ unitsX: 2, unitsY: 3, heightUnits: 6 });
    const objs = parseMeshFile('tall.stl', strToU8(asciiSTL(mesh, 'Tall bin')));
    expect(objs[0].name).toBe('Tall bin');
    expect(near(objs[0].size, [83.5, 125.5, 46])).toBe(true);
    expect(objs[0].closed).toBe(true);
    expect(objs[0].triangles).toBeGreaterThan(0.97 * (mesh.indices.length / 3));
  });

  it('turns an inside-out solid the right way, and says when a mesh is open', () => {
    const cube = gridfitBin();
    const inside = { positions: cube.positions, indices: cube.indices.slice() };
    for (let i = 0; i < inside.indices.length; i += 3) [inside.indices[i + 1], inside.indices[i + 2]] = [inside.indices[i + 2], inside.indices[i + 1]];
    const flipped = parseMeshFile('x.stl', writeSTL([{ mesh: inside }]))[0];
    expect(flipped.closed).toBe(true);
    expect(flipped.volume).toBeCloseTo(meshVolume(cube), 0);
    const open = { positions: cube.positions, indices: cube.indices.slice(3) };
    expect(parseMeshFile('open.stl', writeSTL([{ mesh: open }]))[0].closed).toBe(false);
  });

  it('scales files in other units and rejects what it can’t read', () => {
    const inch = parseMeshFile('a.stl', writeSTL([{ mesh: { positions: gridfitBin().positions.map((v) => v / 25.4), indices: gridfitBin().indices } }]), 25.4)[0];
    expect(near(inch.size, [41.5, 41.5, 25], 0.02)).toBe(true);
    expect(() => parseMeshFile('x.step', strToU8('ISO-10303-21;'))).toThrow(/\.stl, \.3mf and \.obj/);
    expect(() => parseMeshFile('x.stl', strToU8('hello'))).toThrow();
  });
});

describe('reading 3MF', () => {
  it('reads a 3MF written by Gridfit’s exporter, with the object’s name', () => {
    const mesh = gridfitBin({ unitsX: 2 });
    const objs = parseMeshFile('bin.3mf', exportSingle3MF('Screw bin', mesh));
    expect(objs.map((o) => o.name)).toEqual(['Screw bin']);
    expect(near(objs[0].size, [83.5, 41.5, 25])).toBe(true);
    expect(objs[0].closed).toBe(true);
  });

  it('applies build item transforms: one object per item, the user picks', () => {
    const mesh = gridfitBin({ unitsX: 2 });
    const bytes = write3MF(
      [{ name: 'A', mesh }],
      [
        { object: 0, transform: placeTransform(0, 0, false, 41.5) },
        { object: 0, transform: placeTransform(100, 0, true, 41.5) },
      ],
    );
    const objs = parseMeshFile('plate.3mf', bytes);
    expect(objs).toHaveLength(2);
    expect(near(objs[0].size, [83.5, 41.5, 25])).toBe(true);
    // The second item is turned 90° on the plate.
    expect(near(objs[1].size, [41.5, 83.5, 25])).toBe(true);
  });

  it('follows components into other model files (Bambu / Prusa projects), with their transforms and units', () => {
    const mesh = gridfitBin();
    const verts = Array.from({ length: mesh.positions.length / 3 }, (_, i) => `<vertex x="${mesh.positions[i * 3] / 25.4}" y="${mesh.positions[i * 3 + 1] / 25.4}" z="${mesh.positions[i * 3 + 2] / 25.4}"/>`).join('');
    const tris = Array.from({ length: mesh.indices.length / 3 }, (_, i) => `<triangle v1="${mesh.indices[i * 3]}" v2="${mesh.indices[i * 3 + 1]}" v3="${mesh.indices[i * 3 + 2]}"/>`).join('');
    const part = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object></resources><build/></model>`;
    // The component doubles it along X; the build item moves it (translations are in inches too).
    const root = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>
      <object id="2" type="model" name="Big bin"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="2 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
      <object id="3" type="support" name="Support"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
      </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 4 4 0"/><item objectid="3"/></build></model>`;
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
    const bytes = zipSync({ '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(root), '3D/Objects/object_1.model': strToU8(part) });
    const objs = parseMeshFile('bambu.3mf', bytes);
    // Supports are left out.
    expect(objs.map((o) => o.name)).toEqual(['Big bin']);
    expect(near(objs[0].size, [83, 41.5, 25], 0.02)).toBe(true);
    expect(objs[0].closed).toBe(true);
  });

  it('says so when a 3MF is damaged or empty', () => {
    expect(() => parseMeshFile('x.3mf', strToU8('PK not a zip'))).toThrow(/damaged/);
    expect(() => parseMeshFile('x.3mf', zipSync({ 'a.txt': strToU8('x') }))).toThrow(/No 3D model/);
  });
});

describe('reading OBJ', () => {
  it('fans polygons into triangles, one object per o', () => {
    const text = ['o Box', 'v 0 0 0', 'v 10 0 0', 'v 10 20 0', 'v 0 20 0', 'v 0 0 5', 'v 10 0 5', 'v 10 20 5', 'v 0 20 5', 'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join('\n');
    const [o] = parseMeshFile('box.obj', strToU8(text));
    expect(o.name).toBe('Box');
    expect(o.triangles).toBe(12);
    expect(o.closed).toBe(true);
    expect(o.volume).toBeCloseTo(1000, 6);
    expect(near(o.size, [10, 20, 5])).toBe(true);
  });
});

describe('footprint detection', () => {
  it('finds whole units from n × 42 − 0.5, with a little give', () => {
    expect(detectFootprint(41.5, 41.5)).toMatchObject({ exact: true, x: { cells: 1, units: 1 }, y: { cells: 1 } });
    const f = detectFootprint(83.5, 125.5);
    expect([f.x.cells, f.y.cells, f.exact]).toEqual([2, 3, true]);
    // A model drawn at exactly 42 mm, or a hair small.
    expect(fitAxis(42).exact).toBe(true);
    expect(fitAxis(40.8).exact).toBe(true);
  });

  it('reads half-grid sizes: cells on a half grid, a note on a full one', () => {
    const full = detectFootprint(62.5, 41.5, false);
    expect(full.x.units).toBe(1.5);
    expect(full.needsHalf).toBe(true);
    expect(full.exact).toBe(false);
    expect(footprintNote(full, false)).toMatch(/half-grid bin/);
    const half = detectFootprint(62.5, 41.5, true);
    expect([half.x.cells, half.y.cells, half.exact, half.needsHalf]).toEqual([3, 2, true, false]);
  });

  it('swaps with the bin turned 90°', () => {
    const f = detectFootprint(125.5, 83.5);
    expect([f.x.cells, f.y.cells]).toEqual([3, 2]);
    const turned = detectFootprint(83.5, 125.5);
    expect([turned.x.cells, turned.y.cells]).toEqual([2, 3]);
  });

  it('rounds off-grid sizes to the nearest, and knows what holds them', () => {
    const f = detectFootprint(90, 60);
    expect(f.exact).toBe(false);
    expect([f.x.cells, f.y.cells]).toEqual([2, 1]);
    expect([f.x.up, f.y.up]).toEqual([3, 2]);
    expect(f.x.off).toBeCloseTo(6.5, 6);
    expect(footprintNote(f, false)).toMatch(/isn’t a Gridfinity size.*3 × 2 cells hold it/);
    // Smaller than its cells: it sits centred on them.
    expect(footprintNote(detectFootprint(70, 30), false)).toMatch(/sits centred/);
    // Never less than one cell.
    expect(fitAxis(5).cells).toBe(1);
  });

  it('reads the height in 7 mm units, with or without a stacking lip', () => {
    expect(detectHeight(25.4)).toEqual({ mm: 25.4, units: 3, lip: true, exact: true });
    // Gridfit's own (lip top 4 mm above the wall).
    expect(detectHeight(25)).toMatchObject({ units: 3, lip: true });
    expect(detectHeight(21)).toMatchObject({ units: 3, lip: false, exact: true });
    expect(detectHeight(46.4)).toMatchObject({ units: 6, lip: true });
    expect(detectHeight(31)).toMatchObject({ units: 5, exact: false });
  });
});

describe('mesh helpers', () => {
  it('welds a triangle soup into a closed mesh and drops what collapses', () => {
    const m = gridfitBin();
    const soup = new Float32Array(m.indices.length * 3);
    m.indices.forEach((v, i) => soup.set(m.positions.subarray(v * 3, v * 3 + 3), i * 3));
    const welded = weld(soup);
    expect(welded.indices.length).toBeLessThanOrEqual(m.indices.length);
    expect(welded.indices.length).toBeGreaterThan(0.97 * m.indices.length);
    expect(welded.positions.length).toBeLessThanOrEqual(m.positions.length);
    expect(isClosed(welded)).toBe(true);
    expect(weld(new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1])).indices.length).toBe(0);
  });

  it('places a mesh like Gridfit’s parts, turned or not', () => {
    const m = { positions: new Float32Array([-5, -10, 0, 5, -10, 0, 5, 10, 3]), indices: new Uint32Array([0, 1, 2]) };
    expect(boxSize(bounds(placeMesh(m).positions))).toEqual([10, 20, 3]);
    const turned = bounds(placeMesh(m, true).positions);
    expect(turned.min).toEqual([0, 0, 0]);
    expect(boxSize(turned)).toEqual([20, 10, 3]);
  });

  it('decimates for the 3D view, keeping the size', () => {
    const m = gridfitBin({ unitsX: 3, unitsY: 3 });
    const n = m.indices.length / 3;
    const d = decimate(m, Math.floor(n / 4));
    expect(d.indices.length / 3).toBeLessThanOrEqual(n / 4);
    expect(d.indices.length).toBeGreaterThan(0);
    const [a, b] = [boxSize(bounds(m.positions)), boxSize(bounds(d.positions))];
    expect(near(a, b, 3)).toBe(true);
    expect(decimate(m, n)).toBe(m);
  });

  it('encodes meshes to bytes and back, hashed by content', () => {
    const m = gridfitBin();
    const bytes = encodeMesh(m);
    const back = decodeMesh(bytes);
    expect([...back.positions]).toEqual([...m.positions]);
    expect([...back.indices]).toEqual([...m.indices]);
    const h = meshHash(bytes);
    expect(isMeshHash(h)).toBe(true);
    expect(meshHash(encodeMesh(back))).toBe(h);
    expect(meshHash(encodeMesh(gridfitBin({ unitsX: 2 })))).not.toBe(h);
    // A copy at an odd offset decodes too.
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    expect(decodeMesh(shifted.subarray(1)).indices.length).toBe(m.indices.length);
    expect(() => decodeMesh(bytes.subarray(0, bytes.length - 4))).toThrow(/damaged/);
  });
});
