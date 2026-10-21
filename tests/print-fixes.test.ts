import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { readFileSync } from 'node:fs';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { checkPart, sliceReport } from '../src/lib/geometry/printcheck';
import { DEFAULT_BIN, binLabelTabs, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, buildBaseplatePiece, type BaseplateOptions } from '../src/lib/geometry/baseplate';
import { CONNECTOR_MIN_WALL } from '../src/lib/geometry/spec';
import { DEFAULT_DRAWER, computeLayout } from '../src/lib/layout/drawer';
import { makePieces } from '../src/lib/layout/split';
import { buildMesh, type PrintJob } from '../src/lib/project';
import { setWallProps, uniformLayout } from '../src/lib/dividers';
import { SAMPLE_GROUPS, printedParts } from '../scripts/sampler-cases';

/**
 * Regression tests for the defects the print checks found (docs/print-check.md),
 * each on the sampler part (scripts/sampler-cases.ts) or the option that showed it.
 */

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

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

/** Contours of a slice that lie inside a box: their [width, depth]. */
function contoursIn(m: MeshData, z: number, box: [number, number, number, number]): number[][] {
  const man = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
  const cs = man.slice(z);
  const out = cs
    .toPolygons()
    .filter((p) => p.every(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]))
    .map((p) => [0, 1].map((k) => Math.max(...p.map((q) => q[k])) - Math.min(...p.map((q) => q[k]))));
  cs.delete();
  man.delete();
  return out;
}

describe('print fixes', () => {
  /** A 1 × 1 baseplate piece: its magnet pockets are 13 mm from the cell center, at (8, 8). */
  const onePiece = (o: Partial<BaseplateOptions>) => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 1, gridY: 1 });
    const [p] = makePieces(layout, [0, layout.plateW], [0, layout.plateD]);
    return buildBaseplatePiece(w, layout, p, { ...DEFAULT_BASEPLATE, pieceNumbers: false, ...o }, []);
  };
  const pocketAt = (m: MeshData, z: number) => contoursIn(m, z, [2, 2, 14, 14]).map(([x]) => Math.round(x * 100) / 100);

  it('chamfered magnet pockets stay straight below the chamfer (not one cone)', () => {
    // Bottom-loaded: 2.2 mm deep, a 0.8 mm mouth chamfer at z = 0.
    const bottom = onePiece({ magnets: true, magnetSide: 'bottom', magnetChamfer: true });
    expect(pocketAt(bottom, 1.0)).toEqual(pocketAt(bottom, 2.1));
    expect(pocketAt(bottom, 1.5)[0]).toBeCloseTo(6.2, 1);
    expect(pocketAt(bottom, 0.1)[0]).toBeGreaterThan(7.5);
    // Top-loaded: from 0.6 up to the 2.8 mm floor, the chamfer in its top 0.8 mm.
    const top = onePiece({ magnets: true, magnetChamfer: true });
    expect(pocketAt(top, 0.7)).toEqual(pocketAt(top, 1.9));
    expect(pocketAt(top, 1.3)[0]).toBeCloseTo(6.2, 1);
  });

  it('bowtie pockets, puzzle sockets and spacer-tab sockets keep their walls (no tapered flare)', () => {
    for (const file of ['baseplates/bowtie.piece-4.stl', 'testfit/puzzle/test-fit.piece-2.stl', 'enclosures/spacers-lattice.piece-1.stl']) {
      // Walls beside the joints are CONNECTOR_MIN_WALL by design (0.65 mm), not the 0.2 mm a flare tapering the whole depth left:
      // none thinner in any layer up to the joints' tops (the receptacles' top ridge, higher up, is thin by design).
      const thin = sliceReport(w, sample(file), { minWidth: CONNECTOR_MIN_WALL, minThinRun: 0, minThinArea: 0.05 }).thin;
      expect(thin.filter((t) => t.z0 < 3), file).toEqual([]);
    }
  });

  it('a removable wall’s slot has no knife-edge horns where the rounded compartment bottoms meet it', () => {
    expect(sliceReport(w, sample('compartments/removable.stl')).thin).toEqual([]);
    expect(sliceReport(w, sample('compartments/removable-notch.stl')).thin).toEqual([]);
  });

  it('a label tab in front of a removable wall hangs between the side walls, or there is none', () => {
    const layout = setWallProps(uniformLayout(1, 2), 'y1', { removable: true });
    for (const label of ['left', 'center', 'right'] as const) {
      const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 5, label, layout };
      const c = checkPart(w, buildBin(w, o));
      expect(c.topology.components, label).toHaveLength(1);
      expect(c.slices!.islands, label).toEqual([]);
      // The front compartment's tab spans its width, side wall to side wall.
      const front = binLabelTabs(o).sort((a, b) => a.y0 - b.y0)[0];
      expect(front.x1 - front.x0, label).toBeGreaterThan(75);
    }
    // With a removable wall beside it too, it has nothing to hang from: only the back row keeps tabs.
    const grid = setWallProps(setWallProps(uniformLayout(2, 2), 'y1', { removable: true }), 'x1', { removable: true });
    const o: BinOptions = { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 5, label: 'left', layout: grid };
    const tabs = binLabelTabs(o);
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.every((t) => t.y0 > 0)).toBe(true);
    expect(checkPart(w, buildBin(w, o)).ok).toBe(true);
  });
});
