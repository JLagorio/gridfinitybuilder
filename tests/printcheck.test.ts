import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { readFileSync } from 'node:fs';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { toMeshData } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { checkPart, meshTopology, type PrintIssueKind } from '../src/lib/geometry/printcheck';
import { DEFAULT_BIN, buildBin } from '../src/lib/geometry/bin';
import { buildMesh, type PrintJob } from '../src/lib/project';
import { usableBed } from '../src/lib/bedfit';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { SAMPLE_GROUPS, printedParts } from '../scripts/sampler-cases';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

/** A Manifold made into a mesh, the Manifold freed. */
const mesh = (make: () => Manifold): MeshData => {
  const m = make();
  const out = toMeshData(m);
  m.delete();
  return out;
};
const cube = (x: number, y: number, z: number, at: [number, number, number] = [0, 0, 0]) => w.Manifold.cube([x, y, z]).translate(at);
const kinds = (issues: { kind: PrintIssueKind }[]) => [...new Set(issues.map((i) => i.kind))].sort();

describe('mesh topology (no WASM)', () => {
  it('a cube is one closed body', () => {
    const t = meshTopology(mesh(() => cube(10, 10, 10)));
    expect(t.openEdges).toBe(0);
    expect(t.badEdges).toBe(0);
    expect(t.components).toHaveLength(1);
    expect(t.volume).toBeCloseTo(1000, 3);
  });

  it('finds open edges, flipped triangles and separate bodies', () => {
    const m = mesh(() => cube(10, 10, 10));
    const open = { positions: m.positions, indices: m.indices.slice(3) };
    expect(meshTopology(open).openEdges).toBe(3);
    const flipped = m.indices.slice();
    [flipped[0], flipped[1]] = [flipped[1], flipped[0]];
    expect(meshTopology({ positions: m.positions, indices: flipped }).badEdges).toBeGreaterThan(0);
    const two = meshTopology(mesh(() => cube(10, 10, 10).add(cube(2, 2, 2, [20, 0, 0]))));
    expect(two.components.map((c) => Math.round(c.volume))).toEqual([1000, 8]);
    expect(two.components[1].bounds.min).toEqual([20, 0, 0]);
  });

  it('flags coordinates that are not finite', () => {
    const m = mesh(() => cube(1, 1, 1));
    m.positions[0] = NaN;
    expect(meshTopology(m).finite).toBe(false);
  });
});

describe('print checks', () => {
  it('a plain bin passes everything', () => {
    const c = checkPart(w, buildBin(w, { ...DEFAULT_BIN, unitsX: 2, holes: 'magnets' }), { bed: usableBed(DEFAULT_SETUP) });
    expect(c.issues).toEqual([]);
    expect(c.slices!.contact).toBeGreaterThan(2000);
  });

  it('reports a loose piece and the island it starts as', () => {
    const c = checkPart(w, mesh(() => cube(20, 20, 10).add(cube(10, 10, 3, [30, 0, 5]))));
    expect(c.ok).toBe(false);
    expect(kinds(c.issues)).toEqual(['island', 'pieces']);
    expect(c.issues.find((i) => i.kind === 'pieces')!.at).toEqual([35, 5, 6.5]);
    expect(c.slices!.islands[0].z).toBeCloseTo(5.1, 1);
  });

  it('a part above or below the bed is not flat on it', () => {
    expect(kinds(checkPart(w, mesh(() => cube(10, 10, 10, [0, 0, 2]))).issues)).toEqual(['bed-z']);
    expect(kinds(checkPart(w, mesh(() => cube(10, 10, 10, [0, 0, -1]))).issues)).toEqual(['bed-z']);
  });

  it('flags a tiny first layer, and a tall part on a small one', () => {
    expect(kinds(checkPart(w, mesh(() => w.Manifold.cylinder(10, 1, 1, 16))).issues)).toEqual(['contact']);
    const needle = checkPart(w, mesh(() => w.Manifold.cylinder(60, 1.5, 1.5, 16)));
    expect(needle.ok).toBe(true);
    expect(kinds(needle.issues)).toEqual(['contact']);
  });

  it('tells a ledge from a bridge', () => {
    // A slab on a post: a ledge all round.
    const tee = checkPart(w, mesh(() => cube(5, 5, 10, [7.5, 7.5, 0]).add(cube(40, 20, 2, [-10, 0, 10]))));
    expect(tee.slices!.overhangs).toHaveLength(1);
    expect(tee.slices!.overhangs[0].bridge).toBe(false);
    expect(tee.slices!.overhangs[0].reach).toBeGreaterThan(15);
    // A 20 mm bridge between two posts is fine; a 70 mm one is not.
    const span = (gap: number) => checkPart(w, mesh(() => cube(5, 10, 10).add(cube(5, 10, 10, [5 + gap, 0, 0])).add(cube(10 + gap, 10, 2, [0, 0, 10]))));
    expect(span(20).issues).toEqual([]);
    const long = span(70).slices!.overhangs;
    expect(long).toHaveLength(1);
    expect(long[0].bridge).toBe(true);
    // A 45° overhang needs nothing.
    expect(checkPart(w, mesh(() => w.Manifold.cylinder(10, 5, 15, 32))).issues).toEqual([]);
  });

  it('measures walls thinner than two lines, but not ones exactly two lines wide', () => {
    const thin = checkPart(w, mesh(() => cube(20, 20, 1).add(cube(20, 0.5, 10))));
    expect(kinds(thin.issues)).toEqual(['thin']);
    expect(thin.slices!.thin[0].width).toBeCloseTo(0.5, 1);
    expect(checkPart(w, mesh(() => cube(20, 20, 1).add(cube(20, 0.8, 10)))).issues).toEqual([]);
  });

  it('checks the footprint and height against the printer, either way round', () => {
    const bed = { w: 236, d: 200, h: 100 };
    expect(checkPart(w, mesh(() => cube(230, 10, 5)), { bed, noSlices: true }).issues).toEqual([]);
    expect(checkPart(w, mesh(() => cube(10, 230, 5)), { bed, noSlices: true }).issues).toEqual([]);
    expect(kinds(checkPart(w, mesh(() => cube(240, 10, 5)), { bed, noSlices: true }).issues)).toEqual(['bed-fit']);
    expect(kinds(checkPart(w, mesh(() => cube(10, 10, 120)), { bed, noSlices: true }).issues)).toEqual(['bed-fit']);
  });

  it('overlays must not overlap the body', () => {
    const body = mesh(() => cube(10, 10, 5));
    const touching = { name: 'text', filament: 2, ...mesh(() => cube(4, 4, 1, [3, 3, 5])) };
    expect(checkPart(w, { ...body, overlays: [touching] }).issues).toEqual([]);
    const inside = { name: 'text', filament: 2, ...mesh(() => cube(4, 4, 2, [3, 3, 4])) };
    expect(kinds(checkPart(w, { ...body, overlays: [inside] }).issues)).toEqual(['overlay']);
  });

  it('reports an empty or open mesh without slicing it', () => {
    expect(kinds(checkPart(w, { positions: new Float32Array(), indices: new Uint32Array() }).issues)).toEqual(['empty']);
    const m = mesh(() => cube(10, 10, 10));
    const c = checkPart(w, { positions: m.positions, indices: m.indices.slice(3) });
    expect(kinds(c.issues)).toEqual(['manifold']);
    expect(c.slices).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sampler parts (scripts/sampler-cases.ts): built and checked like `npm run sampler`
// ---------------------------------------------------------------------------

const jobs = new Map<string, PrintJob>();
/** One part of the sampler, by its file name ("bases/magnets.stl"). */
function sample(file: string): MeshData {
  const group = SAMPLE_GROUPS.find((g) => file.startsWith(`${g.name}/`));
  if (!group) throw new Error(`no sample group for ${file}`);
  let job = jobs.get(group.name);
  if (!job) jobs.set(group.name, (job = group.job()));
  const p = printedParts(group, job).find((x) => x.file === file);
  if (!p) throw new Error(`no sample part ${file}`);
  return buildMesh(w, job.meshes[p.part.meshKey]);
}

/**
 * A representative part of each family, checked like `npm run sampler` does
 * (the full run is in docs/print-check.md): what each may still be flagged for, by design.
 */
const SUBSET: [string, PrintIssueKind[]][] = [
  ['bases/lite-magnets-printable.stl', []],
  ['bases/efficient-magnets.stl', []],
  ['bases/refined.stl', []],
  ['lips/lip-notches.stl', []],
  ['lips/lid-stack.lid.stl', []],
  ['accessories/slide-lid.slidelid-0.stl', []],
  ['accessories/tray-1.tray-0.stl', []],
  ['accessories/cups-notch-scoop.cup-0.stl', []],
  ['accessories/crate.crate-0.stl', []],
  ['walls/pattern-small-web.stl', []],
  ['compartments/floor-steps.stl', []],
  ['compartments/wall-round-notch.stl', []],
  ['pockets/lean-45-notch.stl', []],
  ['pockets/nozzle-stepped.stl', []],
  ['tools/shadow-label.stl', []],
  ['labels/icons.stl', []],
  ['labels/plate-inlaid.label-0.stl', []],
  ['labels/pred.label-0.stl', []],
  ['labels/front-two-tone.stl', []],
  ['containers/box-default.lid-0.stl', []],
  ['containers/drawers-grip-1x1.drawer-0.stl', []],
  ['containers/hopper-steep-slot.stl', []],
  ['containers/rack-hexkeys-labels.stl', []],
  ['placement/half-1x1.stl', []],
  ['enclosures/case-default.pin-1.stl', []],
  ['testfit/puzzle/test-fit.piece-1.stl', []],
  // A stretched bin's overhang over the margin needs supports (README: "starts just above the baseplate").
  ['placement/stretched.stl', ['overhang']],
  // The walls beside bowtie pockets are 0.65 mm (README, CONNECTOR_MIN_WALL), one line.
  ['baseplates/bowtie.piece-4.stl', ['thin']],
  // A vase-mode bin is drawn as it prints: one line of wall above its bottom layers.
  ['vase/3x2-dividers.stl', ['thin']],
];

describe('sampler parts', () => {
  it.each(SUBSET)('%s', (file, allowed) => {
    const c = checkPart(w, sample(file), { bed: usableBed(DEFAULT_SETUP) });
    expect(c.ok, c.issues.map((i) => i.message).join('\n')).toBe(true);
    expect(kinds(c.issues)).toEqual([...allowed].sort());
  });
});
