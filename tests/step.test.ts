import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import { toMeshData, type MeshData, type Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin } from '../src/lib/geometry/bin';
import { buildLabelPlate } from '../src/lib/geometry/labels';
import { registerFont } from '../src/lib/geometry/text';
import { meshVolume } from '../src/lib/geometry/volume';
import { binSeatHeight } from '../src/lib/geometry/baseplate';
import {
  assemblySTEP,
  drawerAssemblies,
  exportPlateSTEP,
  exportPlatesStepZip,
  exportSingleSTEP,
  meshToShells,
  plateAssembly,
  stepReal,
  stepString,
  writeStep,
} from '../src/lib/export/step';
import { DEFAULT_PROJECT, binOrigin, buildMesh, planJob, type PlacedBin, type PrintJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

// ---------------------------------------------------------------------------
// A small ISO 10303-21 reader, independent of the writer.
// ---------------------------------------------------------------------------

type Param = string | number | null | '*' | { ref: number } | { enum: string } | { typed: string; args: Param[] } | Param[];
interface Part {
  type: string;
  args: Param[];
}
interface Entity {
  id: number;
  /** One part for a simple entity, several for a complex one. */
  parts: Part[];
}

function parseStep(text: string) {
  expect(text.startsWith('ISO-10303-21;')).toBe(true);
  expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  const header = text.slice(0, text.indexOf('DATA;'));
  const data = text.slice(text.indexOf('DATA;') + 5, text.lastIndexOf('ENDSEC;'));
  let i = 0;
  const ws = () => {
    while (i < data.length && /\s/.test(data[i])) i++;
  };
  const ident = () => {
    const m = /^[A-Z_][A-Z0-9_]*/.exec(data.slice(i, i + 80));
    if (!m) throw new Error(`identifier expected at ${data.slice(i, i + 40)}`);
    i += m[0].length;
    return m[0];
  };
  const param = (): Param => {
    ws();
    const c = data[i];
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (data[i] === "'" && data[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (data[i] === "'") {
          i++;
          break;
        } else s += data[i++];
      }
      return s.replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, hex: string) =>
        String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))),
      );
    }
    if (c === '#') {
      i++;
      const m = /^\d+/.exec(data.slice(i, i + 12))!;
      i += m[0].length;
      return { ref: Number(m[0]) };
    }
    if (c === '$') {
      i++;
      return null;
    }
    if (c === '*') {
      i++;
      return '*';
    }
    if (c === '.') {
      const m = /^\.([A-Z_]+)\./.exec(data.slice(i, i + 40))!;
      i += m[0].length;
      return { enum: m[1] };
    }
    if (c === '(') return list();
    if (/[-+0-9]/.test(c)) {
      const m = /^[-+]?\d+(\.\d*)?(E[-+]?\d+)?/.exec(data.slice(i, i + 40))!;
      // STEP reals need a decimal point; integers are only used as counts.
      i += m[0].length;
      return Number(m[0]);
    }
    const type = ident();
    return { typed: type, args: list() };
  };
  const list = (): Param[] => {
    ws();
    expect(data[i]).toBe('(');
    i++;
    const out: Param[] = [];
    ws();
    if (data[i] === ')') {
      i++;
      return out;
    }
    for (;;) {
      out.push(param());
      ws();
      if (data[i] === ',') i++;
      else if (data[i] === ')') {
        i++;
        return out;
      } else throw new Error(`bad list at ${data.slice(i, i + 40)}`);
    }
  };
  const entities = new Map<number, Entity>();
  for (;;) {
    ws();
    if (i >= data.length) break;
    expect(data[i]).toBe('#');
    i++;
    const m = /^\d+/.exec(data.slice(i, i + 12))!;
    i += m[0].length;
    const id = Number(m[0]);
    ws();
    expect(data[i]).toBe('=');
    i++;
    ws();
    const parts: Part[] = [];
    if (data[i] === '(') {
      i++;
      for (;;) {
        ws();
        if (data[i] === ')') {
          i++;
          break;
        }
        parts.push({ type: ident(), args: list() });
      }
    } else parts.push({ type: ident(), args: list() });
    ws();
    expect(data[i]).toBe(';');
    i++;
    expect(entities.has(id)).toBe(false);
    entities.set(id, { id, parts });
  }
  return { header, entities };
}

type Vec = [number, number, number];

/** Structure and geometry checks of a parsed file; returns what's in it. */
function checkStep(text: string) {
  const { header, entities } = parseStep(text);
  expect(header).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN");
  const refs = (p: Param, out: number[] = []): number[] => {
    if (Array.isArray(p)) p.forEach((q) => refs(q, out));
    else if (p && typeof p === 'object' && 'ref' in p) out.push(p.ref);
    else if (p && typeof p === 'object' && 'typed' in p) refs(p.args, out);
    return out;
  };
  // Every reference resolves.
  for (const e of entities.values()) for (const part of e.parts) for (const r of refs(part.args)) expect(entities.has(r), `#${r} in #${e.id}`).toBe(true);
  const byType = new Map<string, Entity[]>();
  for (const e of entities.values()) {
    if (e.parts.length !== 1) continue;
    const list = byType.get(e.parts[0].type) ?? [];
    list.push(e);
    byType.set(e.parts[0].type, list);
  }
  const ofType = (type: string) => byType.get(type) ?? [];
  const get = (p: Param, type?: string) => {
    const e = entities.get((p as { ref: number }).ref)!;
    if (type) expect(e.parts[0].type).toBe(type);
    return e.parts[0].args;
  };
  // Units: millimetres.
  const units = [...entities.values()].filter((e) => e.parts.some((p) => p.type === 'LENGTH_UNIT'));
  expect(units).toHaveLength(1);
  expect(units[0].parts.find((p) => p.type === 'SI_UNIT')!.args).toEqual([{ enum: 'MILLI' }, { enum: 'METRE' }]);

  const point = (p: Param): Vec => get(p, 'CARTESIAN_POINT')[1] as Vec;
  const dir = (p: Param): Vec => get(p, 'DIRECTION')[1] as Vec;
  const vertex = (p: Param) => (p as { ref: number }).ref;
  const vertexPoint = (v: number) => point(entities.get(v)!.parts[0].args[1]);

  const shellInfo = (shellRef: Param) => {
    const faces = get(shellRef, 'CLOSED_SHELL')[1] as Param[];
    const edgeUses = new Map<number, number[]>();
    const verts = new Set<number>();
    let loops = 0;
    let volume = 0;
    let maxOff = 0;
    for (const fRef of faces) {
      const [, bounds, surface, same] = get(fRef, 'ADVANCED_FACE');
      expect(same).toEqual({ enum: 'T' });
      const [, place] = get(surface, 'PLANE');
      const [, loc, axis] = get(place, 'AXIS2_PLACEMENT_3D');
      const o = point(loc);
      const n = dir(axis);
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      const kinds = (bounds as Param[]).map((b) => entities.get((b as { ref: number }).ref)!.parts[0].type);
      expect(kinds.filter((k) => k === 'FACE_OUTER_BOUND')).toHaveLength(1);
      let area = 0;
      for (const bRef of bounds as Param[]) {
        const [, loopRef, orient] = entities.get((bRef as { ref: number }).ref)!.parts[0].args;
        expect(orient).toEqual({ enum: 'T' });
        const oes = get(loopRef, 'EDGE_LOOP')[1] as Param[];
        loops++;
        const seq: Vec[] = [];
        let prevEnd = -1;
        let firstStart = -1;
        for (const oeRef of oes) {
          const [, s1, s2, ecRef, sense] = get(oeRef, 'ORIENTED_EDGE');
          expect(s1).toBe('*');
          expect(s2).toBe('*');
          const ec = (ecRef as { ref: number }).ref;
          const [, va, vb, curve, sameSense] = get(ecRef, 'EDGE_CURVE');
          expect(sameSense).toEqual({ enum: 'T' });
          const [, lp, vec] = get(curve, 'LINE');
          const [, vd] = get(vec, 'VECTOR');
          // The line runs from the start vertex toward the end vertex.
          const A = vertexPoint(vertex(va));
          const B = vertexPoint(vertex(vb));
          expect(point(lp)).toEqual(A);
          const d = dir(vd);
          const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
          expect(len).toBeGreaterThan(0);
          for (let k = 0; k < 3; k++) expect(Math.abs(d[k] - (B[k] - A[k]) / len)).toBeLessThan(1e-4);
          const fwd = (sense as { enum: string }).enum === 'T';
          const [from, to] = fwd ? [vertex(va), vertex(vb)] : [vertex(vb), vertex(va)];
          if (prevEnd >= 0) expect(from).toBe(prevEnd);
          else firstStart = from;
          prevEnd = to;
          verts.add(from);
          verts.add(to);
          edgeUses.set(ec, [...(edgeUses.get(ec) ?? []), fwd ? 1 : -1]);
          seq.push(vertexPoint(from));
        }
        expect(prevEnd).toBe(firstStart);
        // Signed area in the face's plane (Newell), and every corner on the plane.
        let ax = 0, ay = 0, az = 0;
        seq.forEach((p, k) => {
          const q = seq[(k + 1) % seq.length];
          ax += (p[1] - q[1]) * (p[2] + q[2]);
          ay += (p[2] - q[2]) * (p[0] + q[0]);
          az += (p[0] - q[0]) * (p[1] + q[1]);
          maxOff = Math.max(maxOff, Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]));
        });
        area += (ax * n[0] + ay * n[1] + az * n[2]) / 2;
      }
      // Holes are clockwise, so the face's area is positive.
      expect(area).toBeGreaterThan(0);
      volume += ((o[0] * n[0] + o[1] * n[1] + o[2] * n[2]) * area) / 3;
    }
    // Closed: every edge is used by exactly two faces, once each way.
    for (const uses of edgeUses.values()) expect(uses.sort()).toEqual([-1, 1]);
    const V = verts.size;
    const E = edgeUses.size;
    const F = faces.length;
    return { V, E, F, loops, euler: V - E + 2 * F - loops, volume, maxOff };
  };

  const solids = [
    ...ofType('MANIFOLD_SOLID_BREP').map((e) => ({ name: e.parts[0].args[0] as string, shells: [shellInfo(e.parts[0].args[1])] })),
    ...ofType('BREP_WITH_VOIDS').map((e) => {
      const [name, outer, voids] = e.parts[0].args;
      const inner = (voids as Param[]).map((v) => {
        const [, , shell, orient] = get(v, 'ORIENTED_CLOSED_SHELL');
        expect(orient).toEqual({ enum: 'F' });
        return shellInfo(shell);
      });
      return { name: name as string, shells: [shellInfo(outer), ...inner] };
    }),
  ];
  // Every solid sits in exactly one B-rep representation.
  const reps = ofType('ADVANCED_BREP_SHAPE_REPRESENTATION');
  const inReps = reps.flatMap((r) => refs(r.parts[0].args[1]));
  expect(new Set(inReps).size).toBe(inReps.length);
  const products = ofType('PRODUCT').map((e) => e.parts[0].args[1] as string);
  const nauo = ofType('NEXT_ASSEMBLY_USAGE_OCCURRENCE');
  // Placement of each instance: the product it places and its transform.
  const instances = ofType('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION').map((e) => {
    const rel = entities.get((e.parts[0].args[0] as { ref: number }).ref)!;
    expect(rel.parts.map((p) => p.type)).toEqual([
      'REPRESENTATION_RELATIONSHIP',
      'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION',
      'SHAPE_REPRESENTATION_RELATIONSHIP',
    ]);
    const idt = get(rel.parts[1].args[0], 'ITEM_DEFINED_TRANSFORMATION');
    const [, loc, axis, ref] = get(idt[3], 'AXIS2_PLACEMENT_3D');
    const [, , occ] = get(e.parts[0].args[1], 'PRODUCT_DEFINITION_SHAPE');
    const [, name, , , related] = get(occ, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE');
    const [, , formation] = get(related, 'PRODUCT_DEFINITION');
    const [, , prod] = get(formation, 'PRODUCT_DEFINITION_FORMATION');
    // The component's B-rep, through its shape representation.
    const partRep = (rel.parts[0].args[2] as { ref: number }).ref;
    const brep = ofType('SHAPE_REPRESENTATION_RELATIONSHIP').find((r) => (r.parts[0].args[2] as { ref: number }).ref === partRep)!;
    const brepItems = get(brep.parts[0].args[3], 'ADVANCED_BREP_SHAPE_REPRESENTATION')[1] as Param[];
    return { name: name as string, product: get(prod, 'PRODUCT')[1] as string, at: point(loc), axis: dir(axis), ref: dir(ref), brepItems, refsOf: refs };
  });
  return { entities, solids, products, nauo: nauo.length, instances, pointsOf: (items: Param[]) => collectPoints(items) };

  function collectPoints(items: Param[]): Vec[] {
    const out: Vec[] = [];
    const seen = new Set<number>();
    const walk = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      const e = entities.get(id)!;
      if (e.parts[0].type === 'VERTEX_POINT') out.push(point(e.parts[0].args[1]));
      for (const r of refs(e.parts[0].args)) if (entities.get(r)!.parts[0].type !== 'AXIS2_PLACEMENT_3D') walk(r);
    };
    for (const r of refs(items)) walk(r);
    return out;
  }
}

/** V − E + F of an indexed triangle mesh: 2 − 2·genus for a closed surface. */
function meshEuler(mesh: { indices: ArrayLike<number> }) {
  const verts = new Set<number>();
  const edges = new Set<string>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      verts.add(p);
      edges.add(p < q ? `${p},${q}` : `${q},${p}`);
    }
  }
  return verts.size - edges.size + mesh.indices.length / 3;
}

const text = (bytes: Uint8Array) => strFromU8(bytes);
/** Real parts make files of a few MB; give them time when the suite runs in parallel. */
const HEAVY = 60_000;

let w: Wasm;
const manifoldMesh = (m: ReturnType<Wasm['Manifold']['cube']>): MeshData => {
  const mesh = toMeshData(m);
  m.delete();
  return mesh;
};

beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

describe('STEP text encoding', () => {
  it('writes reals with a decimal point', () => {
    expect(stepReal(1)).toBe('1.');
    expect(stepReal(-0.25)).toBe('-0.25');
    expect(stepReal(-0)).toBe('0.');
    expect(stepReal(1e-9)).toBe('0.');
    expect(stepReal(1.23456789e-8, 10)).toBe('1.23E-8');
    expect(stepReal(41.99999999)).toBe('42.');
  });

  it('escapes quotes, backslashes and non-ASCII', () => {
    expect(stepString("Bin 2×1 'a'")).toBe("'Bin 2\\X2\\00D7\\X0\\1 ''a'''");
    expect(stepString('“Ab”\\')).toBe("'\\X2\\201C\\X0\\Ab\\X2\\201D\\X0\\\\\\'");
  });
});

describe('planar B-rep from meshes', () => {
  it('merges a finely tessellated box into six faces', () => {
    const box = manifoldMesh(w.Manifold.cube([10, 20, 30]).refine(8));
    expect(box.indices.length / 3).toBeGreaterThan(500);
    const [s] = meshToShells(box.positions, box.indices);
    expect(s.faces).toHaveLength(6);
    expect(s.edges.length / 2).toBe(12);
    expect(s.points.length / 3).toBe(8);
    expect(s.volume).toBeCloseTo(6000, 3);
    // Exact axis normals.
    for (const f of s.faces) expect(f.normal.filter((v) => v === 0)).toHaveLength(2);
  });

  it('gives a face with a hole an inner loop (genus 1)', () => {
    const box = w.Manifold.cube([30, 30, 10], true);
    const hole = w.Manifold.cube([10, 10, 20], true);
    const mesh = manifoldMesh(box.subtract(hole));
    box.delete();
    hole.delete();
    const [s] = meshToShells(mesh.positions, mesh.indices);
    expect(s.faces).toHaveLength(10);
    expect(s.faces.filter((f) => f.loops.length === 2)).toHaveLength(2);
    const loops = s.faces.reduce((t, f) => t + f.loops.length, 0);
    expect(s.points.length / 3 - s.edges.length / 2 + 2 * s.faces.length - loops).toBe(0);
    expect(s.meshEuler).toBe(0);
    const step = checkStep(writeStep({ name: 'Frame', parts: [{ name: 'Frame', bodies: [{ name: 'Frame', shells: [s] }] }] }));
    expect(step.solids[0].shells[0]).toMatchObject({ F: 10, euler: 0 });
    expect(step.solids[0].shells[0].volume).toBeCloseTo(8000, 2);
  });

  it('writes a sealed cavity as a void', () => {
    const box = w.Manifold.cube([20, 20, 20], true);
    const cavity = w.Manifold.cube([10, 10, 10], true);
    const mesh = manifoldMesh(box.subtract(cavity));
    box.delete();
    cavity.delete();
    const shells = meshToShells(mesh.positions, mesh.indices);
    expect(shells.map((s) => Math.round(s.volume)).sort((a, b) => a - b)).toEqual([-1000, 8000]);
    const step = checkStep(writeStep({ name: 'Hollow', parts: [{ name: 'Hollow', bodies: [{ name: 'Hollow', shells }] }] }));
    expect(step.solids).toHaveLength(1);
    // The void is written as the cavity's outward shell, used reversed.
    expect(step.solids[0].shells.map((s) => Math.round(s.volume))).toEqual([8000, 1000]);
  });

  it('collapses micron-short edges instead of writing them', () => {
    // Booleans leave vertices a micron apart in a bin's corners; CAD kernels drop such edges.
    const mesh = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, holes: 'magnets' });
    const len = (pos: ArrayLike<number>, a: number, b: number) =>
      Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    let shortest = Infinity;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) shortest = Math.min(shortest, len(mesh.positions, mesh.indices[t + k], mesh.indices[t + ((k + 1) % 3)]));
    }
    expect(shortest).toBeLessThan(1e-4);
    const [s] = meshToShells(mesh.positions, mesh.indices);
    for (let e = 0; e < s.edges.length; e += 2) expect(len(s.points, s.edges[e], s.edges[e + 1])).toBeGreaterThan(1e-3);
    expect(s.meshEuler).toBe(meshEuler(mesh));
  });

  it('rejects an open mesh', () => {
    const open = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    expect(() => meshToShells(open.positions, open.indices)).toThrow(/closed/);
  });
});

describe('STEP export of real parts', () => {
  const expectValid = (mesh: MeshData, step: ReturnType<typeof checkStep>, solids = 1) => {
    const shells = step.solids.flatMap((s) => s.shells);
    expect(step.solids).toHaveLength(solids);
    for (const s of shells) {
      expect(s.maxOff).toBeLessThan(1e-3);
    }
    // One body: its Euler characteristic is the mesh's.
    if (solids === 1) expect(shells[0].euler).toBe(meshEuler(mesh));
    expect(shells.reduce((t, s) => t + s.volume, 0)).toBeCloseTo(meshVolume(mesh), 0);
  };

  it('a bin with magnet holes: one closed solid with far fewer faces than triangles', () => {
    const mesh = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, holes: 'magnets' });
    const step = checkStep(text(exportSingleSTEP('Bin 2×1', mesh)));
    expectValid(mesh, step);
    expect(step.products).toEqual(['Bin 2×1']);
    expect(step.nauo).toBe(0);
    expect(step.solids[0].name).toBe('Bin 2×1');
    expect(step.solids[0].shells[0].F).toBeLessThan(mesh.indices.length / 3 / 2.5);
    // A bin's genus: no through-holes.
    expect(step.solids[0].shells[0].euler).toBe(2);
  }, HEAVY);

  it('a baseplate piece with magnets and screws', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      baseplate: { ...DEFAULT_PROJECT.baseplate, magnets: true, screws: true },
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 2, gridY: 1 },
    });
    const key = job.parts['piece:1'].meshKey;
    const mesh = buildMesh(w, job.meshes[key]);
    const step = checkStep(text(exportSingleSTEP('Baseplate piece 1', mesh)));
    expectValid(mesh, step);
    // The magnets need a floor under the cells; one screw hole goes through it per cell: genus 2.
    expect(step.solids[0].shells[0].euler).toBe(2 - 2 * 2);
  }, HEAVY);

  it('a label plate with raised text', () => {
    const mesh = buildLabelPlate(w, { width: 30, depth: 10, thickness: 1, text: 'M4', style: 'raised', relief: 0.5 });
    expect(mesh.indices.length / 3).toBeGreaterThan(100);
    const step = checkStep(text(exportSingleSTEP('Label plate “M4”', mesh)));
    expectValid(mesh, step);
    expect(step.products).toEqual(['Label plate “M4”']);
  });

  it('a bin with inlaid text: the letters are solids of their own', () => {
    const mesh = buildBin(w, { ...DEFAULT_BIN, unitsX: 2, label: 'full', labelText: 'AB', labelStyle: 'inlaid' });
    expect(mesh.overlays?.length).toBeGreaterThan(0);
    const step = checkStep(text(exportSingleSTEP('Bin', mesh)));
    expect(step.solids.length).toBeGreaterThanOrEqual(3);
    expect(step.solids[0].name).toBe('Bin');
    expect(step.solids.slice(1).every((s) => s.name.startsWith('Bin – '))).toBe(true);
    const total = step.solids.flatMap((s) => s.shells).reduce((t, s) => t + s.volume, 0);
    expect(total).toBeCloseTo(meshVolume(mesh), 0);
  }, HEAVY);

  describe('plates and assemblies', () => {
    let job: PrintJob;
    const cache = new Map<string, MeshData>();
    const get = (k: string) => {
      if (!cache.has(k)) cache.set(k, buildMesh(w, job.meshes[k]));
      return cache.get(k)!;
    };
    const bins: PlacedBin[] = [
      { id: 'a', x: 0, y: 0, opts: { ...DEFAULT_BIN, heightUnits: 2 } },
      { id: 'b', x: 1, y: 0, opts: { ...DEFAULT_BIN, label: 'full', labelText: 'Nuts', labelPlates: true } },
      { id: 'c', x: 2, y: 0, opts: { ...DEFAULT_BIN, heightUnits: 2 } },
    ];
    const baseplate = { ...DEFAULT_PROJECT.baseplate, connector: 'bowtie' as const };
    beforeAll(() => {
      // 3 × 1 grid on a small bed: two baseplate pieces with a connector key.
      job = planJob({
        ...DEFAULT_PROJECT,
        baseplate,
        bins,
        drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 1 },
        setup: { ...DEFAULT_PROJECT.setup, bedW: 120, bedD: 120 },
      });
    });

    it('a plate of several parts: one product per distinct mesh, one instance per part', () => {
      const i = job.plates.findIndex((p) => p.group === 'bins');
      const pl = job.plates[i];
      const step = checkStep(text(exportPlateSTEP(job, i, get)));
      const meshKeys = new Set(pl.placements.map((p) => job.parts[p.key].meshKey));
      expect(step.nauo).toBe(pl.placements.length);
      expect(step.products).toHaveLength(meshKeys.size + 1);
      expect(step.products[0]).toBe(pl.name);
      // Two identical bins share one product.
      expect(meshKeys.size).toBeLessThan(pl.placements.length);
      // Each instance lands where the plate puts it (rotated ones too).
      for (const p of pl.placements) {
        const part = job.parts[p.key];
        const inst = step.instances.find((s) => s.name === part.name && Math.abs(s.at[0] - (p.rotated ? p.x + part.d : p.x)) < 1e-6 && Math.abs(s.at[1] - p.y) < 1e-6);
        expect(inst, part.name).toBeDefined();
        expect(inst!.axis).toEqual([0, 0, 1]);
        expect(inst!.ref).toEqual(p.rotated ? [0, 1, 0] : [1, 0, 0]);
        const pts = step.pointsOf(inst!.brepItems).map(([x, y, z]) => (p.rotated ? [inst!.at[0] - y, inst!.at[1] + x, z] : [x + inst!.at[0], y + inst!.at[1], z]));
        const min = [0, 1].map((k) => Math.min(...pts.map((q) => q[k])));
        const max = [0, 1].map((k) => Math.max(...pts.map((q) => q[k])));
        expect(min[0]).toBeCloseTo(p.x, 3);
        expect(min[1]).toBeCloseTo(p.y, 3);
        expect(max[0]).toBeCloseTo(p.x + (p.rotated ? p.d : p.w), 3);
        expect(max[1]).toBeCloseTo(p.y + (p.rotated ? p.w : p.d), 3);
      }
      for (const s of step.solids) for (const sh of s.shells) expect(sh.maxOff).toBeLessThan(1e-3);
    }, HEAVY);

    it('zips one .step per plate with the assembly map', () => {
      const files = unzipSync(exportPlatesStepZip(job, get));
      const names = Object.keys(files);
      expect(names.filter((n) => n.endsWith('.step'))).toHaveLength(job.plates.length);
      expect(names).toContain('assembly-map.txt');
      const keys = names.find((n) => n.includes('baseplate'))!;
      const step = checkStep(strFromU8(files[keys]));
      expect(step.nauo).toBe(job.plates[names.filter((n) => n.endsWith('.step')).sort().indexOf(keys)].placements.length);
    }, HEAVY);

    it('the drawer assembled: pieces in place, bins seated on the baseplate, label plates in their tabs', () => {
      const [asm] = drawerAssemblies(job, [{ id: '', name: 'Kitchen', baseplate, bins }]);
      expect(asm.name).toBe('Kitchen assembled');
      const pieces = asm.items.filter((it) => it.name.startsWith('Baseplate piece'));
      expect(pieces).toHaveLength(job.plan.pieces.length);
      const seat = binSeatHeight(baseplate);
      for (const b of bins) {
        const item = asm.items.find((it) => it.meshKey === job.parts[`bin:${b.id}`].meshKey && it.transform[9] === binOrigin(job.layout, b).x && it.transform[10] === binOrigin(job.layout, b).y);
        expect(item).toBeDefined();
        expect(item!.transform[11]).toBe(seat);
      }
      expect(asm.items.filter((it) => it.name.startsWith('Label plate'))).toHaveLength(1);
      // No connector keys in the assembled drawer.
      expect(asm.items.some((it) => it.name.startsWith('Connector key'))).toBe(false);
      const step = checkStep(assemblySTEP(asm, get));
      expect(step.nauo).toBe(asm.items.length);
      expect(step.products[0]).toBe('Kitchen assembled');
      // One solid per distinct part (identical bins share theirs).
      expect(step.solids).toHaveLength(new Set(asm.items.map((it) => it.meshKey)).size);
      for (const s of step.solids) expect(Math.abs(s.shells[0].euler) % 2).toBe(0);
    }, HEAVY);

    it('plate assemblies list every placement', () => {
      job.plates.forEach((pl, i) => expect(plateAssembly(job, i).items).toHaveLength(pl.placements.length));
    });
  });
});
