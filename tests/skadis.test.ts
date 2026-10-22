import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { assemblyMaps, buildMesh, planPrint, type MeshSpec, type NamedDrawer, type PrintJob } from '../src/lib/project';
import {
  DEFAULT_SKADIS,
  SKADIS,
  buildSkadisTile,
  maxHexWidth,
  planSkadis,
  sanitizeSkadis,
  skadisLattice,
  skadisTileSpecs,
  tileBounds,
  type SkadisOptions,
  type SkadisPlan,
} from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { billOfMaterials } from '../src/lib/bom';
import { specRole } from '../src/lib/geometry/colourRegions';
import { exportBambuProject } from '../src/lib/export/bambu';
import { exportPlateSTEP, stepString } from '../src/lib/export/step';
import { strFromU8, unzipSync } from 'fflate';
import { projectFile, useStore } from '../src/state/store';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const P = SKADIS.pitch;
const BED = [{ w: 236, d: 236 }];
const opts = (o: Partial<SkadisOptions> = {}) => sanitizeSkadis({ ...DEFAULT_SKADIS, ...o });

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Volume of the mesh inside a box (its own coordinates). */
function filled(mesh: MeshData, min: Vec3, max: Vec3): number {
  const m = toManifold(mesh);
  const box = w.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min);
  const both = m.intersect(box);
  const v = both.volume();
  for (const x of [m, box, both]) x.delete();
  return v;
}

/** Volume two meshes share, each moved to its place (its min corner there, after `turn`: degrees about x, y, z, as the 3D view turns it). */
function overlap(a: MeshData, at: Vec3, b: MeshData, bt: Vec3, turnB?: Vec3): number {
  const ma = toManifold(a);
  const mb = toManifold(b);
  const pa = ma.translate(at);
  const rb = turnB ? mb.rotate(turnB) : mb.translate([0, 0, 0]);
  const bb = rb.boundingBox();
  const pb = rb.translate([bt[0] - bb.min[0], bt[1] - bb.min[1], bt[2] - bb.min[2]]);
  const both = pa.intersect(pb);
  const v = both.volume();
  for (const m of [ma, mb, pa, rb, pb, both]) m.delete();
  return v;
}

/** Every slot centre of a rectangle plan, in wall coordinates. */
function slotCentres(plan: SkadisPlan): [number, number][] {
  const L = plan.lattice!;
  const seams = new Set(plan.seamsX.map((x) => Math.round((x - L.ox) / P)));
  const out: [number, number][] = [];
  for (let i = 0; i < L.nx; i++) if (!seams.has(i)) for (let j = 0; j < L.ny; j++) if ((i + j) % 2 === 0) out.push([L.ox + P * i, L.oy + P * j]);
  return out;
}

/** Distance from a point to the nearest edge of a slot (negative inside). */
function toSlot(x: number, y: number, s: [number, number], o: SkadisOptions): number {
  const a = (o.slotL - o.slotW) / 2;
  return Math.hypot(x - s[0], Math.max(0, Math.abs(y - s[1]) - a)) - o.slotW / 2;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe('options', () => {
  it('defaults to a standard board: its measured 5.1 × 15.3 slots (printed ones come out a little small), 5 mm thick, 56 cm square', () => {
    const o = sanitizeSkadis(undefined);
    expect(o).toEqual(DEFAULT_SKADIS);
    expect([o.slotW, o.slotL, o.thickness, o.width, o.height]).toEqual([5.1, 15.3, 5, 560, 560]);
  });

  it('cleans bad values', () => {
    const o = sanitizeSkadis({
      width: -5,
      height: 'x',
      shape: 'round',
      join: 'glue',
      standoff: 'rim',
      slotW: 7,
      slotL: 6,
      chamfer: 9,
      thickness: 4,
      numbers: 0,
    });
    expect(o.width).toBe(60);
    expect(o.height).toBe(DEFAULT_SKADIS.height);
    expect(o.shape).toBe('rect');
    expect(o.join).toBe('both');
    expect(o.standoff).toBe('posts');
    // A slot stays longer than it is wide, and the chamfer leaves straight walls.
    expect(o.slotL).toBe(9);
    expect(o.chamfer).toBeCloseTo(4 / 3, 5);
    expect(o.numbers).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The pattern
// ---------------------------------------------------------------------------

describe('slot pattern', () => {
  it('is the standard pattern: columns 20 mm apart, 40 mm in a column, every other column 20 mm up', () => {
    const plan = planSkadis(opts(), [{ w: 1000, d: 1000 }]);
    const slots = slotCentres(plan);
    const col = slots.filter((s) => Math.abs(s[0] - slots[0][0]) < 1e-6).map((s) => s[1]);
    for (let k = 1; k < col.length; k++) expect(col[k] - col[k - 1]).toBeCloseTo(40, 6);
    const next = slots.filter((s) => Math.abs(s[0] - slots[0][0] - 20) < 1e-6).map((s) => s[1]);
    expect(Math.abs(next[0] - col[0])).toBeCloseTo(20, 6);
    // In a row, every 40 mm.
    const row = slots.filter((s) => Math.abs(s[1] - slots[0][1]) < 1e-6).map((s) => s[0]);
    for (let k = 1; k < row.length; k++) expect(row[k] - row[k - 1]).toBeCloseTo(40, 6);
  });

  it('is centred in the space, a border clear all round', () => {
    for (const [W, H] of [
      [560, 560],
      [763, 412],
      [200, 120],
    ]) {
      const o = opts({ width: W, height: H });
      const L = skadisLattice(W, H, o);
      expect(L.ox - o.slotW / 2).toBeGreaterThanOrEqual(o.border - 1e-6);
      expect(L.oy - o.slotL / 2).toBeGreaterThanOrEqual(o.border - 1e-6);
      expect(L.ox + P * (L.nx - 1)).toBeCloseTo(W - L.ox, 6);
      expect(L.oy + P * (L.ny - 1)).toBeCloseTo(H - L.oy, 6);
      // And no room for another column or row.
      expect(P * L.nx + 2 * o.border + o.slotW).toBeGreaterThan(W);
      expect(P * L.ny + 2 * o.border + o.slotL).toBeGreaterThan(H);
    }
  });

  it('a space too small for a slot is an error', () => {
    const plan = planSkadis(opts({ width: 60, height: 60, border: 30 }), BED);
    expect(plan.error).toMatch(/too small/);
    expect(plan.tiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

describe('rectangle tiles', () => {
  const o = opts({ width: 1000, height: 700 });
  const plan = planSkadis(o, BED);
  const specs = skadisTileSpecs(plan, o);

  it('split the board into tiles that fit the bed, tabs included', () => {
    expect(plan.error).toBeUndefined();
    expect(plan.tiles.length).toBe(plan.cols * plan.rows);
    const area = plan.tiles.reduce((a, t) => a + (t.x1 - t.x0) * (t.y1 - t.y0), 0);
    expect(area).toBeCloseTo(o.width * o.height, 3);
    for (const sp of specs) {
      const b = tileBounds(sp);
      expect(Math.max(b.w, b.d)).toBeLessThanOrEqual(236 + 1e-6);
      expect(Math.min(b.w, b.d)).toBeLessThanOrEqual(236 + 1e-6);
    }
  });

  it('upright seams take a column of slots, level seams cut through a row of them', () => {
    const L = plan.lattice!;
    expect(plan.seamsX.length).toBe(plan.cols - 1);
    expect(plan.seamsY.length).toBe(plan.rows - 1);
    for (const x of plan.seamsX) {
      expect(((x - L.ox) / P) % 1).toBeCloseTo(0, 6);
      // A whole column's pitch of plastic either side, less half a slot.
      for (const s of slotCentres(plan)) expect(Math.abs(s[0] - x) - o.slotW / 2).toBeGreaterThanOrEqual(P - o.slotW / 2 - 1e-6);
    }
    for (const y of plan.seamsY) {
      expect(((y - L.oy) / P) % 1).toBeCloseTo(0, 6);
      const cut = slotCentres(plan).filter((s) => Math.abs(s[1] - y) < 1e-6);
      expect(cut.length).toBeGreaterThan(0);
      // Every other slot is cut in half, the rest are well clear.
      for (const s of slotCentres(plan)) {
        const d = Math.abs(s[1] - y);
        expect(d < 1e-6 || d - o.slotL / 2 >= P - o.slotL / 2 - 1e-6).toBe(true);
      }
    }
    // A cut slot is on both tiles, so each cuts its half.
    const y = plan.seamsY[0];
    const below = specs[plan.tiles.findIndex((t) => t.y1 === y)];
    const above = specs[plan.tiles.findIndex((t) => t.y0 === y)];
    expect(below.slots.some((s) => Math.abs(s[1] - (y - plan.tiles.find((t) => t.y1 === y)!.y0)) < 1e-6)).toBe(true);
    expect(above.slots.some((s) => Math.abs(s[1]) < 1e-6)).toBe(true);
  });

  it('joints and mounts sit on solid plastic, clear of every slot', () => {
    const slots = slotCentres(plan);
    for (const j of plan.joints) {
      if (j.kind === 'plate') {
        // The pocket (a square) against each slot's box: at least 1.5 mm of plastic between.
        const half = SKADIS.plate.size / 2 + SKADIS.plate.gap;
        for (const s of slots) {
          const dx = Math.max(0, Math.abs(s[0] - j.x) - half - o.slotW / 2);
          const dy = Math.max(0, Math.abs(s[1] - j.y) - half - o.slotL / 2);
          expect(Math.hypot(dx, dy), `plate at ${j.x}, ${j.y}`).toBeGreaterThan(1.5);
        }
      } else {
        const clear = Math.min(...slots.map((s) => toSlot(j.x, j.y, s, o)));
        expect(clear, `tab at ${j.x}, ${j.y}`).toBeGreaterThan(SKADIS.tab.depth + 2);
      }
    }
    for (const m of plan.mounts) {
      const clear = Math.min(...slots.map((s) => toSlot(m.x, m.y, s, o)));
      expect(clear, `mount at ${m.x}, ${m.y}`).toBeGreaterThan(SKADIS.post.r0 + 1);
    }
  });

  it('plates sit where seams cross, tabs and plates take turns along the seams', () => {
    const crossings = plan.joints.filter((j) => j.seam === 'xy');
    expect(crossings.length).toBe(plan.seamsX.length * plan.seamsY.length);
    expect(crossings.every((j) => j.kind === 'plate')).toBe(true);
    const along = plan.joints.filter((j) => j.seam !== 'xy');
    expect(along.filter((j) => j.kind === 'tab').length).toBeGreaterThan(0);
    expect(along.filter((j) => j.kind === 'plate').length).toBeGreaterThan(0);
    // Every stretch of seam has at least one joint.
    for (const x of plan.seamsX) {
      for (let r = 0; r < plan.rows; r++) {
        const t = plan.tiles.find((q) => q.row === r && q.x1 === x)!;
        expect(along.some((j) => j.seam === 'x' && j.x === x && j.y > t.y0 && j.y < t.y1)).toBe(true);
      }
    }
  });

  it('every tile has its corners screwed', () => {
    for (const t of plan.tiles) {
      const ms = plan.mounts.filter((m) => m.tile === t.id);
      expect(ms.length).toBeGreaterThanOrEqual(4);
      const cx = (t.x0 + t.x1) / 2;
      const cy = (t.y0 + t.y1) / 2;
      // One in each quarter.
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        expect(ms.some((m) => Math.sign(m.x - cx) === sx && Math.sign(m.y - cy) === sy)).toBe(true);
    }
  });

  it('just tabs, just plates or nothing', () => {
    expect(planSkadis(opts({ width: 1000, height: 700, join: 'tabs' }), BED).joints.every((j) => j.kind === 'tab')).toBe(true);
    expect(planSkadis(opts({ width: 1000, height: 700, join: 'plates' }), BED).joints.every((j) => j.kind === 'plate')).toBe(true);
    expect(planSkadis(opts({ width: 1000, height: 700, join: 'none' }), BED).joints).toEqual([]);
    // Too thin for a plate's pocket and pins: tabs instead, and a warning.
    const thin = planSkadis(opts({ width: 1000, height: 700, thickness: 3.5 }), BED);
    expect(thin.joints.every((j) => j.kind === 'tab')).toBe(true);
    expect(thin.warnings.join()).toMatch(/too thin for joint plates/);
  });

  it('a board that fits the bed is one tile, no joints', () => {
    const one = planSkadis(opts({ width: 200, height: 150 }), BED);
    expect(one.tiles.length).toBe(1);
    expect(one.joints).toEqual([]);
    expect(one.tiles[0].outer).toEqual({ left: true, right: true, bottom: true, top: true });
  });
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('tile geometry', () => {
  const o = opts({ width: 500, height: 400 });
  const plan = planSkadis(o, BED);
  const specs = skadisTileSpecs(plan, o);
  let meshes: MeshData[] = [];
  beforeAll(() => {
    meshes = specs.map((sp) => buildSkadisTile(w, sp));
  });
  /** A wall point on tile i in its mesh's coordinates (face down: x turned over). */
  const onMesh = (i: number, x: number, y: number): [number, number] => {
    const t = plan.tiles[i];
    const b = tileBounds(specs[i]);
    return [b.w - (x - t.x0 - b.x0), y - t.y0 - b.y0];
  };

  it('every tile is one closed solid that prints face down without trouble', () => {
    for (const m of meshes) {
      const c = checkPart(w, m);
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('as big as planned: the board, then the posts', () => {
    meshes.forEach((m, i) => {
      const b = meshBounds(m);
      const want = tileBounds(specs[i]);
      expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 2);
      expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 2);
      expect(b.max[2]).toBeCloseTo(o.thickness + o.depth, 3);
      expect(b.min.every((v) => Math.abs(v) < 1e-3)).toBe(true);
    });
  });

  it('slots go through, solid lattice points are plastic', () => {
    const i = 0;
    const t = plan.tiles[i];
    const inside = slotCentres(plan).filter((s) => s[0] > t.x0 + 10 && s[0] < t.x1 - 10 && s[1] > t.y0 + 10 && s[1] < t.y1 - 10);
    expect(inside.length).toBeGreaterThan(10);
    for (const s of inside.slice(0, 6)) {
      const [x, y] = onMesh(i, s[0], s[1]);
      expect(filled(meshes[i], [x - 2, y - 6, -1], [x + 2, y + 6, o.thickness + 1])).toBe(0);
      // Solid 20 mm beside it, where the next column has no slot at this height.
      const [ex, ey] = onMesh(i, s[0], s[1] + 20);
      if (ey < t.y1 - t.y0 - 3) expect(filled(meshes[i], [ex - 2, ey - 2, 0.5], [ex + 2, ey + 2, o.thickness - 0.5])).toBeGreaterThan(0);
    }
  });

  it('the front is flat on the bed and the slots open with a chamfer', () => {
    const s = slotCentres(plan).find((c) => c[0] > plan.tiles[0].x0 + 20 && c[1] > plan.tiles[0].y0 + 20)!;
    const [x, y] = onMesh(0, s[0], s[1]);
    const half = o.slotW / 2;
    // Just past the slot's side: open at the face, plastic deeper in.
    expect(filled(meshes[0], [x + half + 0.05, y - 1, 0], [x + half + 0.25, y + 1, 0.1])).toBe(0);
    expect(filled(meshes[0], [x + half + 0.05, y - 1, o.chamfer + 0.2], [x + half + 0.25, y + 1, o.chamfer + 0.4])).toBeGreaterThan(0);
  });

  it('countersunk screw holes through the posts', () => {
    const m = plan.mounts.find((q) => q.tile === plan.tiles[0].id)!;
    const [x, y] = onMesh(0, m.x, m.y);
    // The hole is open all the way up.
    expect(filled(meshes[0], [x - 1.5, y - 1.5, -1], [x + 1.5, y + 1.5, o.thickness + o.depth + 1])).toBe(0);
    // The countersink at the face, the post around it at the top.
    const head = (2 * o.screw + 0.5) / 2;
    expect(filled(meshes[0], [x + head - 1, y - 0.3, 0], [x + head - 0.6, y + 0.3, 0.2])).toBe(0);
    expect(
      filled(meshes[0], [x + SKADIS.post.r1 - 1, y - 0.3, o.thickness + o.depth - 1], [x + SKADIS.post.r1 - 0.5, y + 0.3, o.thickness + o.depth - 0.5]),
    ).toBeGreaterThan(0);
  });

  it('the tiles fit together: tabs in their sockets, nothing overlapping', () => {
    // Placed on the wall, face down (as the drawer view shows them).
    const at = plan.tiles.map((t, i): Vec3 => {
      const b = tileBounds(specs[i]);
      return [o.width - (t.x0 + b.x0 + b.w), t.y0 + b.y0, 0];
    });
    for (let a = 0; a < meshes.length; a++) for (let b = a + 1; b < meshes.length; b++) expect(overlap(meshes[a], at[a], meshes[b], at[b])).toBeLessThan(1e-3);
    // A tab fills most of its socket.
    const tab = plan.joints.find((j) => j.kind === 'tab' && j.seam === 'x')!;
    const right = plan.tiles.findIndex((t) => Math.abs(t.x0 - tab.x) < 1e-6 && tab.y > t.y0 && tab.y < t.y1);
    const left = plan.tiles.findIndex((t) => Math.abs(t.x1 - tab.x) < 1e-6 && tab.y > t.y0 && tab.y < t.y1);
    const [lx, ly] = onMesh(left, tab.x + SKADIS.tab.depth / 2, tab.y);
    expect(filled(meshes[left], [lx - 1, ly - 1, 0.5], [lx + 1, ly + 1, o.thickness - 0.5])).toBeGreaterThan(3);
    const [rx, ry] = onMesh(right, tab.x + SKADIS.tab.depth / 2, tab.y);
    expect(filled(meshes[right], [rx - 1, ry - 1, -1], [rx + 1, ry + 1, o.thickness + 1])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hexagons
// ---------------------------------------------------------------------------

describe('hexagon tiles', () => {
  const o = opts({ shape: 'hex', width: 900, height: 600 });
  const plan = planSkadis(o, BED);
  const specs = skadisTileSpecs(plan, o);

  it('as large as the bed takes, in a honeycomb inside the space', () => {
    expect(plan.hex!.w).toBe(maxHexWidth(BED));
    expect(plan.hex!.h).toBeCloseTo((plan.hex!.w * Math.sqrt(3)) / 2, 2);
    expect(plan.tiles.length).toBeGreaterThan(4);
    for (const t of plan.tiles) {
      expect(t.x0).toBeGreaterThanOrEqual(-1e-6);
      expect(t.y0).toBeGreaterThanOrEqual(-1e-6);
      expect(t.x1).toBeLessThanOrEqual(o.width + 1e-6);
      expect(t.y1).toBeLessThanOrEqual(o.height + 1e-6);
    }
    // Neighbours are a hexagon height plus the gap apart, centre to centre.
    const c = plan.hex!.centres;
    const nearest = Math.min(...c.slice(1).map((q) => Math.hypot(q[0] - c[0][0], q[1] - c[0][1])));
    expect(nearest).toBeCloseTo(plan.hex!.h + o.hexGap, 2);
  });

  it('identical tiles, two screws and six posts each', () => {
    // Not even numbered: they go up in any order.
    for (const sp of specs) expect(sp).toEqual(specs[0]);
    expect(specs[0].number).toBeUndefined();
    expect(specs[0].mounts.length).toBe(6);
    expect(specs[0].mounts.filter((m) => m.screw).length).toBe(2);
    const m = buildSkadisTile(w, specs[0]);
    expect(checkPart(w, m).ok).toBe(true);
  });

  it('slots stay inside the border and clear of the posts', () => {
    const sp = specs[0];
    const hw = plan.hex!.w;
    const hh = plan.hex!.h;
    for (const s of sp.slots) {
      // Distance to the slanted and level edges of the hexagon.
      const dx = Math.abs(s[0] - hw / 2);
      const dy = Math.abs(s[1] - hh / 2) + (o.slotL - o.slotW) / 2;
      expect(hh / 2 - dy - o.slotW / 2).toBeGreaterThanOrEqual(o.border - 1e-3);
      expect((hh - dy - dx * Math.sqrt(3)) / 2 - o.slotW / 2).toBeGreaterThanOrEqual(o.border - 1e-3);
      for (const m of sp.mounts) expect(toSlot(m.x, m.y, s, o)).toBeGreaterThan(SKADIS.post.r0);
    }
  });

  it('a size the bed can’t take, or a space smaller than one, is an error', () => {
    expect(planSkadis(opts({ shape: 'hex', hexWidth: 400 }), BED).error).toMatch(/bigger than the bed/);
    expect(planSkadis(opts({ shape: 'hex', width: 150, height: 100, hexWidth: 200 }), BED).error).toMatch(/smaller than one/);
  });
});

// ---------------------------------------------------------------------------
// In a print job
// ---------------------------------------------------------------------------

describe('print job', () => {
  const board = (skadis: Partial<SkadisOptions> = {}, drawer: Partial<DrawerInput> = {}): NamedDrawer => ({
    id: 'd1',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, ...skadis }, ...drawer },
    baseplate: { ...DEFAULT_BASEPLATE, magnets: true, connector: 'bowtie', pads: 'strips' },
    // Bins have no place on a pegboard.
    bins: [{ id: 'b', x: 0, y: 0, opts: { ...DEFAULT_BIN } }],
  });
  const plan = (d: NamedDrawer, setup: PrintSetup = DEFAULT_SETUP): PrintJob => planPrint([d], setup, { baseplate: true, bins: true });
  const job = plan(board({ width: 600, height: 400, standoff: 'spacers' }));
  const scene = job.drawers[0].enclosure!;

  it('prints tiles, joint plates and spacers, and nothing of a baseplate or bins', () => {
    const kinds = Object.values(job.parts).map((p) => p.enclosure ?? p.kind);
    const info = scene.info.skadis!;
    expect(kinds.filter((k) => k === 'piece')).toHaveLength(info.tiles);
    expect(kinds.filter((k) => k === 'skadisPlate')).toHaveLength(info.plates);
    expect(kinds.filter((k) => k === 'skadisSpacer')).toHaveLength(info.screws);
    expect(kinds.filter((k) => k === 'bin' || k === 'key' || k === 'pad')).toEqual([]);
    expect(job.plates.map((p) => p.name)).toContain('Skådis board 1');
    // Both small, so they share plates.
    expect(job.plates.map((p) => p.name)).toContain('Joint plates & spacers');
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const k of Object.keys(job.parts)) expect(onPlates.has(k), k).toBe(true);
    expect(job.warnings).toEqual([]);
  });

  it('every mesh is valid and inside its planned footprint', () => {
    for (const p of Object.values(job.parts)) {
      const m = buildMesh(w, job.meshes[p.meshKey]);
      const b = meshBounds(m);
      expect(
        b.min.every((v) => v > -0.01),
        p.name,
      ).toBe(true);
      expect(b.max[0], p.name).toBeLessThan(p.w + 0.01);
      expect(b.max[1], p.name).toBeLessThan(p.d + 0.01);
      expect(b.max[2], p.name).toBeLessThan(p.h + 0.01);
    }
  });

  it('the drawer view puts the plates in their pockets and the spacers on the back', () => {
    const tiles = job.plan.pieces.map((p) => ({ mesh: buildMesh(w, job.meshes[job.parts[`piece:${p.id}`].meshKey]), at: scene.pieceAt[p.id] }));
    const plates = scene.items.filter((it) => it.role === 'joint');
    expect(plates.length).toBe(scene.info.skadis!.plates);
    const plateMesh = buildMesh(w, job.meshes[plates[0].meshKey]);
    // Face up: the tiles turned over, on their spacers.
    expect(scene.pieceTurn).toEqual([0, 180, 0]);
    const back = DEFAULT_SKADIS.depth;
    for (const t of tiles) expect(t.at[2]).toBe(back);
    for (const it of plates) {
      for (const t of tiles) expect(overlap(plateMesh, [it.x, it.y, it.z], t.mesh, t.at, scene.pieceTurn as Vec3)).toBeLessThan(1e-3);
    }
    // A hair inside the board's back, in the pocket, pins up into the board.
    expect(plates[0].z).toBeCloseTo(back + SKADIS.plate.pocket - SKADIS.plate.t, 3);
    const spacers = scene.items.filter((it) => it.role === 'standoff');
    expect(spacers.length).toBe(scene.info.skadis!.screws);
    expect(spacers.every((s) => s.z === 0 && s.h === back)).toBe(true);
  });

  it('roles, hardware and the assembly map', () => {
    const tile = job.meshes[job.parts['piece:1'].meshKey] as MeshSpec;
    expect(specRole(tile)).toBe('wallGrid');
    const bom = billOfMaterials(job);
    const screws = bom.hardware.filter((h) => /Countersunk screws ⌀4/.test(h.item));
    expect(screws).toHaveLength(1);
    expect(screws[0].count).toBe(scene.info.skadis!.screws);
    // No magnets or bowtie keys from the drawer's baseplate settings.
    expect(bom.hardware.filter((h) => /magnet|key/i.test(h.item))).toEqual([]);
    const maps = assemblyMaps(job);
    const text = maps['assembly-map.txt'];
    expect(text).toMatch(/SKÅDIS BOARD ASSEMBLY MAP/);
    expect(text).toMatch(/Plate 1: tile/);
    expect(text).toMatch(/joint plates/);
  });

  it('exports as a Bambu Studio project and STEP', () => {
    const cache = new Map<string, MeshData>();
    const getMesh = (k: string) => {
      if (!cache.has(k)) cache.set(k, buildMesh(w, job.meshes[k]));
      return cache.get(k)!;
    };
    const files = unzipSync(exportBambuProject(job, DEFAULT_SETUP, getMesh));
    const settings = strFromU8(files['Metadata/model_settings.config']);
    for (const pl of job.plates) expect(settings).toContain(`plater_name" value="${pl.name.replace(/&/g, '&amp;')}"`);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect([...model.matchAll(/<item /g)].length).toBe(Object.keys(job.parts).length);
    const step = new TextDecoder().decode(exportPlateSTEP(job, 0, getMesh));
    expect(step).toMatch(/^ISO-10303-21;/);
    expect(step).toContain(stepString('Skådis tile').slice(1, -1));
  });

  it('hexagons share one mesh', () => {
    const hex = plan(board({ shape: 'hex', width: 700, height: 500 }));
    const keys = new Set(hex.plan.pieces.map((p) => hex.parts[`piece:${p.id}`].meshKey));
    expect(hex.plan.pieces.length).toBeGreaterThan(1);
    expect(keys.size).toBe(1);
    expect(hex.plates.every((p) => p.name.startsWith('Skådis board'))).toBe(true);
  });

  it('errors reach the job’s warnings', () => {
    const bad = plan(board({ width: 60, height: 60, border: 30 }));
    expect(bad.warnings.join()).toMatch(/too small/);
    expect(bad.plates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Saved projects
// ---------------------------------------------------------------------------

describe('saved boards', () => {
  const s = () => useStore.getState();
  beforeEach(() => s().resetAll());

  it('load cleaned, "just attachments" kept', () => {
    s().loadProject({ app: 'gridfit', drawer: { enclosure: 'skadis', haveBaseplate: true, skadis: { width: 'wide', shape: 'hex', depth: 999 } } });
    const d = s().drawer;
    expect(d.enclosure).toBe('skadis');
    expect(d.haveBaseplate).toBe(true);
    expect(d.skadis).toMatchObject({ width: DEFAULT_SKADIS.width, shape: 'hex', depth: 60 });
  });

  it('a new board comes back from its project file beside the drawers', () => {
    const drawerId = s().activeDrawerId;
    const id = s().addDrawer(undefined, { skadis: true });
    expect(s().drawer).toMatchObject({ enclosure: 'skadis', skadis: DEFAULT_SKADIS });
    expect(s().drawers.find((d) => d.id === id)?.name).toBe('Skådis board');
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 760, shape: 'hex' } });
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    s().resetAll();
    s().loadProject(file);
    s().switchDrawer(id);
    expect(s().drawer.enclosure).toBe('skadis');
    expect(s().drawer.skadis).toMatchObject({ width: 760, shape: 'hex' });
    s().switchDrawer(drawerId);
    expect(s().drawer.enclosure).toBeUndefined();
  });
});
