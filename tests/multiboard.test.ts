import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { meshBounds, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { assemblyMaps, buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { checkPart } from '../src/lib/geometry/printcheck';
import { billOfMaterials } from '../src/lib/bom';
import { octagon } from '../src/lib/geometry/opengrid';
import {
  DEFAULT_MULTIBOARD,
  MULTIBOARD,
  buildMultiboardTile,
  multiboardThread,
  multiboardTileSize,
  multiboardTileSpecs,
  planMultiboard,
  sanitizeMultiboard,
  toothReach,
  type MultiboardOptions,
} from '../src/lib/geometry/multiboard';
import { cleanEnclosure } from '../src/lib/enclosureOptions';
import { setGridBoardBuilders } from '../src/lib/gridBoards';
import * as gridBuild from '../src/lib/geometry/gridBoardBuild';
// Registers the boards' planning, as the app's lazy load does.
import '../src/lib/gridBoardPlan';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  setGridBoardBuilders(gridBuild);
});

const P = MULTIBOARD.pitch;
const BED = [{ w: 236, d: 236 }];
const opts = (o: Partial<MultiboardOptions> = {}) => sanitizeMultiboard({ ...DEFAULT_MULTIBOARD, ...o });

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Volume a mesh (moved to `at`) shares with a solid. */
function shared(mesh: MeshData, at: Vec3, solid: Manifold): number {
  const m = toManifold(mesh);
  const moved = m.translate(at);
  const both = moved.intersect(solid);
  const v = both.volume();
  for (const x of [m, moved, both]) x.delete();
  return v;
}

const prism = (pts: Vec2[], z0: number, z1: number) => w.Manifold.extrude([pts], z1 - z0).translate([0, 0, z0]);
const regular = (cx: number, cy: number, across: number, z0: number, z1: number) => prism(octagon(cx, cy, across / 2, (across / 2) * Math.SQRT2), z0, z1);
const disc = (x: number, y: number, d: number, z0: number, z1: number) => w.Manifold.cylinder(z1 - z0, d / 2, d / 2, 48).translate([x, y, z0]);

describe('Multiboard planning', () => {
  it('cleans saved options, the measured sizes within reason', () => {
    expect(sanitizeMultiboard(undefined)).toEqual(DEFAULT_MULTIBOARD);
    const o = sanitizeMultiboard({ cols: 0, thickness: 40, hole: 22, holeFace: 20, ring: 99, peg: 'x', screws: 'all', threads: 1 });
    expect(o).toMatchObject({ cols: 1, thickness: 12, hole: 22, holeFace: 22, ring: 12, peg: 6.1, screws: 'corners', threads: false });
    expect(cleanEnclosure({ ...DEFAULT_DRAWER, enclosure: 'multiboard', multiboard: { cols: 3 } })).toMatchObject({
      enclosure: 'multiboard',
      multiboard: { cols: 3 },
    });
  });

  it('splits to the bed with room for the teeth, and gives each tile its crossings', () => {
    // 236 mm less a tooth (7.3) takes 9 squares (225).
    const plan = planMultiboard(opts({ cols: 20, rows: 10 }), BED);
    expect([plan.tileCols, plan.tileRows]).toEqual([3, 2]);
    expect(plan).toMatchObject({ holes: 200, pegs: 19 * 9 });
    const specs = multiboardTileSpecs(plan, opts({ cols: 20, rows: 10 }));
    for (const s of specs) {
      const size = multiboardTileSize(s);
      expect(size.w).toBeLessThanOrEqual(236);
      expect(size.d).toBeLessThanOrEqual(236);
    }
    // Every peg hole of the board is in exactly one tile.
    const pegs = new Set<string>();
    plan.tiles.forEach((t, i) => {
      for (const [x, y] of specs[i].pegs) {
        const k = `${x + t.c0 * P},${y + t.r0 * P}`;
        expect(pegs.has(k), k).toBe(false);
        pegs.add(k);
      }
    });
    expect(pegs.size).toBe(plan.pegs);
    // The bottom-left tile has teeth on its right and top seams (and their corner), notches round the board's edge.
    const t0 = plan.tiles[0];
    const W = (t0.c1 - t0.c0) * P;
    const H = (t0.r1 - t0.r0) * P;
    expect(specs[0].teeth).toContainEqual([W, H]);
    expect(specs[0].teeth.filter(([x]) => x === W)).toHaveLength(t0.r1 - t0.r0);
    expect(specs[0].teeth.filter(([x, y]) => x === 0 || y === 0)).toEqual([]);
    expect(specs[0].notches).toContainEqual([0, 0]);
    // Its right neighbour has the notches its teeth go in.
    expect(specs[1].notches).toEqual(expect.arrayContaining(specs[0].teeth.filter(([x, y]) => x === W && y < H).map(([, y]) => [0, y])));
    expect(planMultiboard(opts({ test: true }), BED)).toMatchObject({ cols: 2, rows: 2, holes: 4, pegs: 1 });
  });
});

describe('Multiboard tiles', () => {
  it('measure 25 mm squares, 6.4 mm thick, the teeth sticking out on the seams', () => {
    const plan = planMultiboard(opts({ cols: 6, rows: 4, maxTile: 3 }), BED);
    const specs = multiboardTileSpecs(plan, opts());
    const b = meshBounds(buildMultiboardTile(w, specs[0]));
    expect(b.min.map((v) => Math.abs(v) < 1e-4)).toEqual([true, true, true]);
    const reach = toothReach(specs[0].fit);
    expect(b.max[0]).toBeCloseTo(3 * 25 + reach, 3);
    expect(b.max[1]).toBeCloseTo(2 * 25 + reach, 3);
    expect(b.max[2]).toBeCloseTo(6.4, 3);
    expect(multiboardTileSize(specs[0])).toEqual({ w: 3 * 25 + reach, d: 2 * 25 + reach, h: 6.4 });
    // The top-right tile is just its squares.
    const last = specs[specs.length - 1];
    const bl = meshBounds(buildMultiboardTile(w, last));
    expect(bl.max[0]).toBeCloseTo(75, 3);
    expect(bl.max[1]).toBeCloseTo(50, 3);
  });

  it('large holes: 21.4 mm across the flats in the middle 2.4 mm, 23.4 at the faces; peg holes ⌀6.1 at the crossings', () => {
    const o = opts({ cols: 2, rows: 2, screws: 'none' });
    const spec = multiboardTileSpecs(planMultiboard(o, BED), o)[0];
    const m = buildMultiboardTile(w, spec);
    const c = P / 2;
    // The ring: a 21.2 octagon passes through, a 21.6 hits the ring.
    expect(shared(m, [0, 0, 0], regular(c, c, 21.2, -1, 7.4))).toBeLessThan(1e-4);
    expect(shared(m, [0, 0, 0], regular(c, c, 21.6, 2.1, 4.3))).toBeGreaterThan(0.1);
    // At the faces it opens to 23.4 (a 23.2 octagon clears the first 0.1 mm, a 23.6 doesn't).
    expect(shared(m, [0, 0, 0], regular(c, c, 23.2, -1, 0.05))).toBeLessThan(1e-4);
    expect(shared(m, [0, 0, 0], regular(c, c, 23.6, 0, 0.05))).toBeGreaterThan(1e-4);
    // The peg hole, in the square where four holes meet.
    expect(shared(m, [0, 0, 0], disc(25, 25, 6.0, -1, 7.4))).toBeLessThan(1e-4);
    expect(shared(m, [0, 0, 0], disc(25, 25, 6.3, 1, 5))).toBeGreaterThan(0.1);
    // The board's edge: an octagon's flat, a V notch at each grid line.
    expect(
      shared(
        m,
        [0, 0, 0],
        prism(
          [
            [0.1, 25],
            [-3, 22],
            [-3, 28],
          ],
          0,
          6.4,
        ),
      ),
    ).toBeLessThan(1e-4);
    expect(
      shared(
        m,
        [0, 0, 0],
        prism(
          [
            [2, 23],
            [6, 25],
            [2, 27],
          ],
          0,
          6.4,
        ),
      ),
    ).toBeLessThan(1e-4);
  });

  it('teeth fit the next tile’s notches with clearance and lock the tiles along the seam', () => {
    const o = opts({ cols: 4, rows: 2, maxTile: 2, screws: 'none' });
    const plan = planMultiboard(o, BED);
    expect(plan.tiles).toHaveLength(2);
    const [a, b] = multiboardTileSpecs(plan, o).map((s) => buildMultiboardTile(w, s));
    const mb = toManifold(b);
    const at = (dx: number, dy: number) => mb.translate([50 + dx, dy, 0]);
    const clash = (dx: number, dy: number) => {
      const placed = at(dx, dy);
      const v = shared(a, [0, 0, 0], placed);
      placed.delete();
      return v;
    };
    expect(clash(0, 0)).toBeLessThan(1e-4);
    // The tooth fills the notch (only the clearance left): tile A has plastic past the seam there.
    expect(shared(a, [0, 0, 0], regular(50 + 4.6, 25, 1, 0, 6.4))).toBeGreaterThan(0.1);
    // Slid along the seam by more than the clearance, the tooth hits the notch.
    expect(clash(0, 0.3)).toBeGreaterThan(1e-3);
    expect(clash(0, -0.3)).toBeGreaterThan(1e-3);
    // Within it, it doesn't.
    expect(clash(0, 0.1)).toBeLessThan(1e-4);
    mb.delete();
  });

  it('threads: a right-hand helix, cut into the holes, the outer walls untouched', () => {
    const g = multiboardThread(w, 21.4 / 2, 'big', 0, 6.4);
    expect(g.status()).toBe('NoError');
    expect(g.volume()).toBeGreaterThan(0);
    const b0 = g.boundingBox();
    expect(b0.max[2] - b0.min[2]).toBeGreaterThan(6.4);
    g.delete();
    // Right-hand: going round anticlockwise (seen from the front) it rises, a quarter of its 2.5 mm pitch a quarter turn.
    const h = multiboardThread(w, 21.4 / 2, 'big', -1.25, 6.4);
    const middle = (x0: number, y0: number, x1: number, y1: number) => {
      const box = w.Manifold.cube([x1 - x0, y1 - y0, 2]).translate([x0, y0, 0.3]);
      const both = h.intersect(box);
      const b = both.boundingBox();
      box.delete();
      both.delete();
      return (b.min[2] + b.max[2]) / 2;
    };
    // In 0.3–2.3 mm: whole at 0° (1.25 ± 0.79), at 90° from 1.875 − 0.79 up.
    expect(middle(9, -0.1, 12, 0.1)).toBeCloseTo(1.25, 1);
    expect(middle(-0.1, 9, 0.1, 12)).toBeCloseTo((1.875 - 0.79 + 2.3) / 2, 1);
    expect(middle(-0.1, -12, 0.1, -9)).toBeCloseTo((0.3 + 0.625 + 0.79) / 2, 1);
    h.delete();
    const tile = (o: MultiboardOptions) => toManifold(buildMultiboardTile(w, multiboardTileSpecs(planMultiboard(o, BED), o)[0]));
    const mp = tile(opts({ cols: 2, rows: 2 }));
    const mt = tile(opts({ cols: 2, rows: 2, threads: true }));
    expect(mt.volume()).toBeLessThan(mp.volume() - 10);
    // The big thread stays inside the holes: the faces (wider there) and the walls round them are the same.
    const within = (m: Manifold, s: Manifold) => {
      const both = m.intersect(s);
      const v = both.volume();
      both.delete();
      s.delete();
      return v;
    };
    const face = (z0: number) => w.Manifold.cube([60, 60, 0.1]).translate([-5, -5, z0]);
    expect(within(mt, face(6.3))).toBeCloseTo(within(mp, face(6.3)), 2);
    expect(within(mt, face(0))).toBeCloseTo(within(mp, face(0)), 2);
    const wall = () => {
      const cell = regular(12.5, 12.5, 25, 0, 6.4);
      const hole = regular(12.5, 12.5, 22.7, -1, 7.4);
      const out = cell.subtract(hole);
      cell.delete();
      hole.delete();
      return out;
    };
    expect(within(mt, wall())).toBeCloseTo(within(mp, wall()), 2);
    // The small thread runs out at the faces, as a threaded hole does.
    const mpt = tile(opts({ cols: 2, rows: 2, threads: true, pegThreads: true }));
    expect(mpt.volume()).toBeLessThan(mt.volume() - 1);
    for (const o of [opts({ cols: 2, rows: 2, threads: true, pegThreads: true }), opts({ cols: 3, rows: 2, threads: true, screws: 'grid' })]) {
      const c = checkPart(w, buildMultiboardTile(w, multiboardTileSpecs(planMultiboard(o, BED), o)[0]));
      expect(c.ok, JSON.stringify(c.issues)).toBe(true);
    }
    for (const m of [mp, mt, mpt]) m.delete();
  });

  it('print clean, every tile of a board', () => {
    for (const o of [opts({ cols: 5, rows: 4, maxTile: 3, screws: 'grid', screwEvery: 1 }), opts({ cols: 3, rows: 3, fit: 'loose', screw: 3 })]) {
      for (const spec of multiboardTileSpecs(planMultiboard(o, BED), o)) {
        const c = checkPart(w, buildMultiboardTile(w, spec));
        expect(c.ok, JSON.stringify(c.issues)).toBe(true);
      }
    }
  });
});

describe('Multiboard board print job', () => {
  const board = (o: Partial<MultiboardOptions> = {}): NamedDrawer => ({
    id: 'm1',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'multiboard', multiboard: { ...DEFAULT_MULTIBOARD, ...o } },
    baseplate: { ...DEFAULT_BASEPLATE, magnets: true, connector: 'bowtie' },
    bins: [],
  });

  it('prints its tiles with no warnings; screws on the bill; the map', () => {
    const job = planPrint([board()], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const info = job.drawers[0].enclosure!.info.grid!;
    expect(info).toMatchObject({ kind: 'multiboard', cols: 12, rows: 8, boardW: 300, boardH: 200, T: 6.4, tiles: 2, holes: 96, pegs: 77, screws: 8 });
    const parts = Object.values(job.parts);
    expect(parts.map((p) => p.kind)).toEqual(['piece', 'piece']);
    expect(job.plates.map((p) => p.name)).toContain('Multiboard board 1');
    for (const p of parts) {
      const m = buildMesh(w, job.meshes[p.meshKey]);
      const b = meshBounds(m);
      expect(b.max[0], p.name).toBeLessThan(p.w + 0.01);
      expect(b.max[1], p.name).toBeLessThan(p.d + 0.01);
      expect(b.max[2], p.name).toBeLessThan(p.h + 0.01);
    }
    const bom = billOfMaterials(job);
    expect(bom.hardware.map((h) => [h.item, h.count])).toEqual([['Countersunk screws ⌀4 × 35 mm or longer (Multiboard board)', 8]]);
    const text = assemblyMaps(job)['assembly-map.txt'];
    expect(text).toMatch(/MULTIBOARD BOARD ASSEMBLY MAP/);
    expect(text).toMatch(/measured/);
  });
});
