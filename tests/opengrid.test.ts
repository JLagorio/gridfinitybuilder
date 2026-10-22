import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { meshBounds, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { assemblyMaps, buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { checkPart } from '../src/lib/geometry/printcheck';
import { billOfMaterials } from '../src/lib/bom';
import {
  DEFAULT_OPENGRID,
  OPENGRID,
  buildOpenGridConnector,
  buildOpenGridTile,
  connectorHoleZ,
  connectorOutline,
  octagon,
  openGridConnectorPart,
  openGridConnectorSize,
  openGridTileSpecs,
  planOpenGrid,
  sanitizeOpenGrid,
  type OpenGridOptions,
} from '../src/lib/geometry/opengrid';
import { splitGrid, tileScrews } from '../src/lib/geometry/gridTiles';
import { cleanEnclosure } from '../src/lib/enclosureOptions';
import { gridBoardsVersion, planGridBoard, setGridBoardBuilders } from '../src/lib/gridBoards';
import * as gridBuild from '../src/lib/geometry/gridBoardBuild';
// Registers the boards' planning, as the app's lazy load does.
import '../src/lib/gridBoardPlan';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  setGridBoardBuilders(gridBuild);
});

const P = OPENGRID.pitch;
const BED = [{ w: 236, d: 236 }];
const opts = (o: Partial<OpenGridOptions> = {}) => sanitizeOpenGrid({ ...DEFAULT_OPENGRID, ...o });

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Volume a mesh (at `at`) shares with a solid in the same frame. */
function shared(mesh: MeshData, at: Vec3, solid: Manifold): number {
  const m = toManifold(mesh);
  const moved = m.translate(at);
  const both = moved.intersect(solid);
  const v = both.volume();
  for (const x of [m, moved, both]) x.delete();
  return v;
}

/** A prism of a CCW outline from z0 to z1. */
const prism = (pts: Vec2[], z0: number, z1: number) => w.Manifold.extrude([pts], z1 - z0).translate([0, 0, z0]);

/** One tile of w × h squares, cut out of a board by its options. */
function tileOf(o: OpenGridOptions, which = 0) {
  const plan = planOpenGrid(o, BED);
  return { plan, spec: openGridTileSpecs(plan, o)[which] };
}

describe('openGrid planning', () => {
  it('cleans saved options', () => {
    expect(sanitizeOpenGrid(undefined)).toEqual(DEFAULT_OPENGRID);
    const o = sanitizeOpenGrid({ variant: 'heavy', cols: 500, rows: -3, screws: 'everywhere', fit: 'loose', connectors: 'yes', maxTile: 3.6 });
    expect(o).toMatchObject({ variant: 'lite', cols: 80, rows: 1, screws: 'corners', fit: 'loose', connectors: true, maxTile: 4 });
    // A saved board keeps its options as they were; planning cleans them.
    const d = cleanEnclosure({ ...DEFAULT_DRAWER, enclosure: 'opengrid', opengrid: { cols: 3 } });
    expect(d.enclosure).toBe('opengrid');
    expect(d.opengrid).toEqual({ cols: 3 });
  });

  it('splits the board into the fewest tiles that fit the bed, on the lines between squares', () => {
    const plan = planOpenGrid(opts({ cols: 20, rows: 10 }), BED);
    // 236 mm takes 8 squares (224): 3 × 2 tiles.
    expect([plan.tileCols, plan.tileRows]).toEqual([3, 2]);
    let area = 0;
    for (const t of plan.tiles) {
      expect((t.c1 - t.c0) * P).toBeLessThanOrEqual(236);
      expect((t.r1 - t.r0) * P).toBeLessThanOrEqual(236);
      area += (t.c1 - t.c0) * (t.r1 - t.r0);
    }
    expect(area).toBe(200);
    // As even as can be: 7 + 7 + 6 across, 5 + 5 up.
    expect(plan.tiles.filter((t) => t.row === 0).map((t) => t.c1 - t.c0)).toEqual([7, 7, 6]);
    expect(planOpenGrid(opts({ cols: 20, rows: 10, maxTile: 4 }), BED).tiles).toHaveLength(15);
    // A test tile is 2 × 2 whatever the board.
    expect(planOpenGrid(opts({ cols: 20, rows: 10, test: true }), BED)).toMatchObject({ cols: 2, rows: 2, tileCols: 1, tileRows: 1 });
    expect(splitGrid(3, 3, P, [{ w: 20, d: 20 }], { reach: 0, max: 0 }).error).toBeTruthy();
  });

  it('puts connectors at every crossing along the seams but the tiles’ corners, and screws one in from each tile’s corners', () => {
    const plan = planOpenGrid(opts({ cols: 12, rows: 8 }), BED);
    // Two 6 × 8 tiles: one upright seam, 7 crossings along it.
    expect(plan.tiles).toHaveLength(2);
    expect(plan.connectors).toHaveLength(7);
    expect(plan.connectors.every((c) => c.dir === 'x' && c.x === 6 * P)).toBe(true);
    expect(plan.screws).toHaveLength(8);
    expect(tileScrews(6, 8, 'corners', 3)).toEqual([
      [1, 1],
      [5, 1],
      [1, 7],
      [5, 7],
    ]);
    expect(tileScrews(8, 8, 'grid', 3).length).toBe(9);
    expect(tileScrews(1, 8, 'corners', 3)).toEqual([]);
    // Holes on both sides of the seam.
    const specs = openGridTileSpecs(plan, opts());
    expect(specs[0].holes.map((h) => h.side)).toEqual(Array(7).fill('right'));
    expect(specs[1].holes.map((h) => h.side)).toEqual(Array(7).fill('left'));
    expect(specs[0].corners).toEqual(['bl', 'tl']);
    expect(planOpenGrid(opts({ connectors: false }), BED).connectors).toEqual([]);
  });
});

describe('openGrid tiles', () => {
  it('match openGrid’s numbers: 28 mm squares, 6.8 mm full and 4 mm lite', () => {
    for (const variant of ['full', 'lite'] as const) {
      const { spec } = tileOf(opts({ variant, cols: 3, rows: 2 }));
      const b = meshBounds(buildOpenGridTile(w, spec));
      expect(b.min.map((v) => Math.abs(v) < 1e-4)).toEqual([true, true, true]);
      expect(b.max[0]).toBeCloseTo(3 * 28, 3);
      expect(b.max[1]).toBeCloseTo(2 * 28, 3);
      expect(b.max[2]).toBeCloseTo(variant === 'full' ? 6.8 : 4, 3);
    }
    // The squares at the crossings: 11.14 mm a side.
    expect(2 * OPENGRID.node).toBeCloseTo(11.14, 2);
  });

  it('openings: 25 mm square at the lips, 26.4 behind them; a snap passes and its latches catch', () => {
    for (const variant of ['full', 'lite'] as const) {
      const T = variant === 'full' ? 6.8 : 4;
      const mesh = buildOpenGridTile(w, tileOf(opts({ variant, cols: 2, rows: 2, screws: 'none' })).spec);
      const c = P / 2;
      // A square with its corners cut, round the first square's middle.
      const probe = (half: number, k: number, z0: number, z1: number) => prism(octagon(c, c, half, k), z0, z1);
      // openGrid's snap (24.8 square, corners cut 4.82 each way) goes right through.
      const snap = probe(OPENGRID.snap.w / 2, OPENGRID.snap.w - OPENGRID.snap.corner, -1, T + 1);
      expect(shared(mesh, [0, 0, 0], snap)).toBeLessThan(1e-4);
      // The lip at the front: 25 mm (a 25.2 mm square hits it, 24.9 doesn't); 1.4 mm down from the front, flat for 1 mm.
      const lipZ: [number, number] = [T - 1.35, T - 0.45];
      expect(shared(mesh, [0, 0, 0], probe(12.45, 20, ...lipZ))).toBeLessThan(1e-4);
      expect(shared(mesh, [0, 0, 0], probe(12.6, 20, ...lipZ))).toBeGreaterThan(0.1);
      // Behind it, the undercut: 26.4 (a 26.3 mm square doesn't touch, 26.6 does), where the snap's latches go.
      const under: [number, number] = variant === 'full' ? [2.45, 4.35] : [0.05, 1.55];
      expect(shared(mesh, [0, 0, 0], probe(13.15, 20, ...under))).toBeLessThan(1e-4);
      expect(shared(mesh, [0, 0, 0], probe(13.3, 20, ...under))).toBeGreaterThan(0.1);
      // A lite snap's latches (0.4 mm proud of its 24.8 sides, 0.2–2 mm up from its bottom, 3.4 mm under the front) sit in it.
      if (variant === 'lite') {
        const latchZ: [number, number] = [T - OPENGRID.snap.lite + 0.2, T - OPENGRID.snap.lite + 1.2];
        const latch = probe(OPENGRID.snap.w / 2 + OPENGRID.snap.latch, 20, ...latchZ);
        expect(shared(mesh, [0, 0, 0], latch)).toBeLessThan(1e-4);
      }
      for (const m of [snap]) m.delete();
    }
  });

  it('screw holes at the crossings and cut corners', () => {
    const { spec } = tileOf(opts({ variant: 'lite', cols: 4, rows: 4 }));
    expect(spec.screws).toEqual([
      [28, 28],
      [84, 28],
      [28, 84],
      [84, 84],
    ]);
    const mesh = buildOpenGridTile(w, spec);
    const T = 4;
    const at = (x: number, y: number, r: number, z0: number, z1: number) => w.Manifold.cylinder(z1 - z0, r, r, 32).translate([x, y, z0]);
    // ⌀4.1 through, the head ⌀7.2 sunk 1 mm.
    expect(shared(mesh, [0, 0, 0], at(28, 28, 2, -1, T + 1))).toBeLessThan(1e-4);
    expect(shared(mesh, [0, 0, 0], at(28, 28, 3.55, T - 0.95, T + 1))).toBeLessThan(1e-4);
    expect(shared(mesh, [0, 0, 0], at(28, 28, 2.3, 0.1, 1))).toBeGreaterThan(0.01);
    // A crossing without a screw is solid.
    expect(shared(mesh, [0, 0, 0], at(56, 56, 2, 0.1, T - 0.1))).toBeGreaterThan(10);
    // The board's corner is cut 4.2 mm each way.
    const corner = prism(
      [
        [0, 0],
        [4.1, 0],
        [0, 4.1],
      ],
      0,
      T,
    );
    expect(shared(mesh, [0, 0, 0], corner)).toBeLessThan(1e-4);
  });

  it('print clean, the connector too', () => {
    const plan = planOpenGrid(opts({ cols: 5, rows: 5, maxTile: 3, screws: 'grid', screwEvery: 1 }), BED);
    for (const variant of ['full', 'lite'] as const) {
      for (const spec of openGridTileSpecs(plan, opts({ variant, cols: 5, rows: 5, maxTile: 3 }))) {
        const c = checkPart(w, buildOpenGridTile(w, spec));
        expect(c.ok, JSON.stringify(c.issues)).toBe(true);
      }
    }
    for (const fit of ['snug', 'normal', 'loose'] as const) {
      const part = openGridConnectorPart({ fit });
      const m = buildOpenGridConnector(w, part);
      const c = checkPart(w, m);
      expect(c.ok, JSON.stringify(c.issues)).toBe(true);
      const b = meshBounds(m);
      const size = openGridConnectorSize(part);
      expect(b.max[0]).toBeCloseTo(size.w, 3);
      expect(b.max[1]).toBeCloseTo(size.d, 3);
      expect(b.max[2]).toBeCloseTo(size.h, 3);
    }
  });
});

describe('openGrid connectors', () => {
  // Two tiles side by side (a 4 × 2 board, 2 × 2 tiles), the connector in its holes across the seam.
  for (const variant of ['full', 'lite'] as const) {
    it(`fit the holes either side of a seam and hold the tiles together (${variant})`, () => {
      const o = opts({ variant, cols: 4, rows: 2, maxTile: 2, screws: 'none' });
      const plan = planOpenGrid(o, BED);
      expect(plan.connectors).toEqual([{ x: 56, y: 28, dir: 'x' }]);
      const [a, b] = openGridTileSpecs(plan, o).map((s) => buildOpenGridTile(w, s));
      const part = openGridConnectorPart(o);
      const size = openGridConnectorSize(part);
      const z = connectorHoleZ(variant === 'lite') + part.c;
      const conn = toManifold(buildOpenGridConnector(w, part));
      const placed = (dx: number) => conn.translate([56 - size.w / 2 + dx, 28 - size.d / 2, z]);
      const inA = (dx: number) => shared(a, [0, 0, 0], placed(dx));
      const inB = (dx: number) => shared(b, [56, 0, 0], placed(dx));
      expect(inA(0)).toBeLessThan(1e-4);
      expect(inB(0)).toBeLessThan(1e-4);
      // It fills its holes, a clearance smaller.
      expect(conn.volume()).toBeGreaterThan(0.75 * size.w * size.d * size.h);
      // Pulled either way it hits the pinched mouths: it clicks in and holds.
      expect(inA(0.6) + inB(0.6)).toBeGreaterThan(0.01);
      expect(inA(-0.6) + inB(-0.6)).toBeGreaterThan(0.01);
      // Its lobes are wider than the mouth they click past.
      const halfW = Math.max(...connectorOutline(part.c).map(([, y]) => y));
      expect(halfW).toBeGreaterThan(OPENGRID.hole.mouth);
      conn.delete();
    });
  }
});

describe('openGrid board print job', () => {
  const board = (o: Partial<OpenGridOptions> = {}): NamedDrawer => ({
    id: 'g1',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'opengrid', opengrid: { ...DEFAULT_OPENGRID, ...o } },
    baseplate: { ...DEFAULT_BASEPLATE, magnets: true, connector: 'bowtie', pads: 'strips' },
    // Bins have no place on a board.
    bins: [{ id: 'b', x: 0, y: 0, opts: { ...DEFAULT_BIN } }],
  });
  const plan = (d: NamedDrawer, setup: PrintSetup = DEFAULT_SETUP): PrintJob => planPrint([d], setup, { baseplate: true, bins: true });

  it('plans once its planning has loaded', () => {
    expect(gridBoardsVersion()).toBeGreaterThan(0);
    expect(planGridBoard(board(), { nx: 0 } as never, DEFAULT_SETUP).kind).toBe('opengrid');
  });

  it('prints tiles and connectors, no warnings, nothing of a baseplate or bins', () => {
    const job = plan(board());
    const scene = job.drawers[0].enclosure!;
    const info = scene.info.grid!;
    expect(info).toMatchObject({ kind: 'opengrid', cols: 12, rows: 8, boardW: 336, boardH: 224, T: 4, tiles: 2, connectors: 7, screws: 8 });
    expect(job.warnings).toEqual([]);
    const kinds = Object.values(job.parts).map((p) => p.enclosure ?? p.kind);
    expect(kinds.filter((k) => k === 'piece')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'openGridConnector')).toHaveLength(7);
    expect(kinds.filter((k) => k === 'bin' || k === 'key' || k === 'pad')).toEqual([]);
    expect(job.plates.map((p) => p.name)).toEqual(expect.arrayContaining(['openGrid board 1', 'openGrid connectors']));
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const k of Object.keys(job.parts)) expect(onPlates.has(k), k).toBe(true);
    // Every tile fits the bed.
    for (const pl of job.plates) for (const q of pl.placements) expect(q.x + (q.rotated ? job.parts[q.key].d : job.parts[q.key].w)).toBeLessThanOrEqual(256);
    // Screws on the bill, nothing of the drawer's baseplate settings.
    const bom = billOfMaterials(job);
    const screws = bom.hardware.filter((h) => /Countersunk screws ⌀4/.test(h.item));
    expect(screws.map((s) => s.count)).toEqual([8]);
    expect(bom.hardware.filter((h) => /magnet|key|pin/i.test(h.item))).toEqual([]);
    const text = assemblyMaps(job)['assembly-map.txt'];
    expect(text).toMatch(/OPENGRID BOARD ASSEMBLY MAP/);
    expect(text).toMatch(/12 × 8 squares of 28 mm: 336 × 224 mm, Lite/);
  });

  it('every mesh is valid, inside its footprint, and the connectors sit in their holes', () => {
    const job = plan(board({ variant: 'full', cols: 10, rows: 10 }));
    expect(job.warnings).toEqual([]);
    const scene = job.drawers[0].enclosure!;
    const meshes = new Map<string, MeshData>();
    const mesh = (k: string) => meshes.get(k) ?? (meshes.set(k, buildMesh(w, job.meshes[k])), meshes.get(k)!);
    for (const p of Object.values(job.parts)) {
      const b = meshBounds(mesh(p.meshKey));
      expect(
        b.min.every((v) => v > -0.01),
        p.name,
      ).toBe(true);
      expect(b.max[0], p.name).toBeLessThan(p.w + 0.01);
      expect(b.max[1], p.name).toBeLessThan(p.d + 0.01);
      expect(b.max[2], p.name).toBeLessThan(p.h + 0.01);
    }
    // 2 × 2 tiles of 5 × 5: 4 seams of 4 crossings each.
    const conns = scene.items.filter((it) => it.role === 'joint');
    expect(conns).toHaveLength(16);
    expect(conns.filter((c) => c.turn)).toHaveLength(8);
    const tiles = job.plan.pieces.map((p) => ({ m: toManifold(mesh(job.parts[`piece:${p.id}`].meshKey)), at: scene.pieceAt[p.id] }));
    for (const it of conns) {
      const c = toManifold(mesh(it.meshKey));
      const turned = it.turn ? c.rotate(it.turn) : c.translate([0, 0, 0]);
      const bb = turned.boundingBox();
      const placed = turned.translate([it.x - bb.min[0], it.y - bb.min[1], it.z - bb.min[2]]);
      for (const t of tiles) {
        const moved = t.m.translate(t.at);
        const both = moved.intersect(placed);
        expect(both.volume()).toBeLessThan(1e-4);
        for (const x of [moved, both]) x.delete();
      }
      for (const x of [c, turned, placed]) x.delete();
    }
  });
});
