import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { readFileSync } from 'node:fs';
import type { MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds, toMeshData } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_BASEPLATE, baseplateFloor, baseplateHeight, binSeatHeight, buildBaseplatePiece, type BaseplateOptions } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN, binTotalHeight, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER, computeLayout, spacerMargins, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { binOrigin, buildMesh, planPrint, type MeshSpec, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { CASE, HINGE_CLEARANCE, HINGE_SPAN, LID_OPEN_DEG, PIN_LENGTH, caseFrame, rotatedBounds, lidBounds } from '../src/lib/geometry/case';
import { WALL, cleatBand, holeLines } from '../src/lib/geometry/wallmount';
import { SPACER, SPACER_TAB_REACH } from '../src/lib/geometry/spacers';
import { buildEnclosurePart, planEnclosure, type EnclosurePart } from '../src/lib/enclosures';
import { billOfMaterials } from '../src/lib/bom';
import { useStore } from '../src/state/store';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const out = { status: m.status(), volume: m.volume() };
  m.delete();
  return out;
}

/** Volume shared by two meshes, each moved to its place. */
function overlap(a: MeshData, at: Vec3, b: MeshData, bt: Vec3): number {
  const ma = toManifold(a);
  const mb = toManifold(b);
  const pa = ma.translate(at);
  const pb = mb.translate(bt);
  const both = pa.intersect(pb);
  const v = both.volume();
  for (const m of [ma, mb, pa, pb, both]) m.delete();
  return v;
}

/** Does any of the mesh fill this small box (in its own coordinates)? */
function filled(mesh: MeshData, min: Vec3, max: Vec3): number {
  const m = toManifold(mesh);
  const box = w.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min);
  const both = m.intersect(box);
  const v = both.volume();
  for (const x of [m, box, both]) x.delete();
  return v;
}

/** A cylinder along X, as a mesh. */
function cylX(x0: number, x1: number, y: number, z: number, r: number): MeshData {
  const c = w.Manifold.cylinder(x1 - x0, r, r, 48);
  const t = c.rotate([0, 90, 0]).translate([x0, y, z]);
  const m = toMeshData(t);
  c.delete();
  t.delete();
  return m;
}

/** A small box around (x, y) between two heights, in the coordinates of a mesh that sits at `at`. */
const near = (at: Vec3, x: number, y: number, r: number, z0: number, z1: number): [Vec3, Vec3] => [
  [x - r - at[0], y - r - at[1], z0 - at[2]],
  [x + r - at[0], y + r - at[1], z1 - at[2]],
];

const plain = (o: Partial<BaseplateOptions> = {}): BaseplateOptions => ({ ...DEFAULT_BASEPLATE, pieceNumbers: false, ...o });
const bin = (id: string, x: number, y: number, ux: number, uy: number, o: Partial<BinOptions> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: { ...DEFAULT_BIN, unitsX: ux, unitsY: uy, ...o },
});
const drawerOf = (drawer: Partial<DrawerInput>, bins: PlacedBin[] = [], baseplate: BaseplateOptions = plain()): NamedDrawer => ({
  id: 'd1',
  name: 'Test',
  drawer: { ...DEFAULT_DRAWER, ...drawer },
  baseplate,
  bins,
});
const plan = (d: NamedDrawer, setup: PrintSetup = DEFAULT_SETUP): PrintJob => planPrint([d], setup, { baseplate: true, bins: true });

const meshCache = new Map<string, MeshData>();
const meshOf = (job: PrintJob, key: string): MeshData => {
  if (!meshCache.has(key)) meshCache.set(key, buildMesh(w, job.meshes[key]));
  return meshCache.get(key)!;
};
const partMesh = (job: PrintJob, partKey: string) => meshOf(job, job.parts[partKey].meshKey);

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('old projects', () => {
  const s = () => useStore.getState();
  beforeEach(() => s().resetAll());

  it('load without enclosure fields and plan exactly as before', () => {
    const old = { width: 400, depth: 300, fill: 'fit', alignX: 0 };
    const raw = drawerOf(old as Partial<DrawerInput>, [bin('a', 0, 0, 2, 1)], DEFAULT_BASEPLATE);
    const before = plan(raw);
    s().loadProject({ app: 'gridfit', drawer: old, baseplate: DEFAULT_BASEPLATE, bins: raw.bins });
    const d = s().drawer;
    for (const k of ['enclosure', 'carryCase', 'wallMount', 'spacers'] as const) expect(k in d).toBe(false);
    const after = plan({ ...raw, drawer: d, baseplate: s().baseplate, bins: s().bins });
    expect(Object.keys(after.meshes).sort()).toEqual(Object.keys(before.meshes).sort());
    expect(after.plates.map((p) => p.placements.map((q) => q.key))).toEqual(before.plates.map((p) => p.placements.map((q) => q.key)));
    expect(after.drawers[0].enclosure).toBeUndefined();
    // Plain pieces carry no enclosure data.
    for (const m of Object.values(after.meshes)) if (m.kind === 'piece') expect(m.enclosure).toBeUndefined();
  });

  it('cleans bad enclosure values and keeps good ones', () => {
    s().loadProject({
      app: 'gridfit',
      drawer: { width: 400, depth: 300, enclosure: 'boat', fill: 'spacers', carryCase: { wall: 99, handle: 'rope', label: 7 }, wallMount: 'x', spacers: { style: 'solid' } },
    });
    const d = s().drawer;
    expect(d.enclosure).toBeUndefined();
    expect(d.fill).toBe('spacers');
    expect(d.carryCase).toMatchObject({ wall: 8, handle: 'fold', label: '' });
    expect(d.wallMount).toBeUndefined();
    expect(d.spacers).toEqual({ style: 'solid', tabs: true });
    s().loadProject({ app: 'gridfit', drawer: { mode: 'grid', enclosure: 'case', fill: 'nope' } });
    expect(s().drawer.enclosure).toBe('case');
    expect(s().drawer.fill).toBe('solid');
  });

  it('builds plain pieces exactly as the baseplate builder does', () => {
    const job = plan(drawerOf({ width: 300, depth: 200 }));
    const spec = job.meshes[job.parts['piece:1'].meshKey] as Extract<MeshSpec, { kind: 'piece' }>;
    const viaJob = buildMesh(w, spec);
    const direct = buildBaseplatePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors);
    expect(viaJob.indices).toEqual(direct.indices);
    expect(viaJob.positions.length).toBe(direct.positions.length);
  });

  it('a drawer with spacer settings but another fill is a plain drawer', () => {
    const job = plan(drawerOf({ width: 400, depth: 300, spacers: { style: 'solid', tabs: true } }));
    expect(job.drawers[0].enclosure).toBeUndefined();
    expect(spacerMargins({ ...DEFAULT_DRAWER, width: 400, depth: 300 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Carry case
// ---------------------------------------------------------------------------

describe('carry case', () => {
  const bins = [bin('a', 0, 0, 2, 1, { heightUnits: 4 }), bin('b', 2, 1, 1, 2, { heightUnits: 6 })];
  const d = drawerOf({ mode: 'grid', gridX: 3, gridY: 3, enclosure: 'case', carryCase: { label: 'BITS', handle: 'fold', feet: 'printed' } }, bins);
  const job = plan(d);
  const scene = job.drawers[0].enclosure!;
  const body = () => partMesh(job, 'piece:1');
  const bodyAt = () => scene.pieceAt[1];

  it('plans a body, a lid and its hardware on plates', () => {
    expect(scene.kind).toBe('case');
    expect(job.plan.pieces).toHaveLength(1);
    const kinds = Object.values(job.parts).map((p) => p.enclosure ?? p.kind);
    expect(kinds.filter((k) => k === 'lid')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'pin')).toHaveLength(scene.info.hinges!);
    expect(kinds.filter((k) => k === 'handle')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'foot')).toHaveLength(4);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const k of Object.keys(job.parts)) expect(onPlates.has(k)).toBe(true);
    expect(job.plates.map((p) => p.name)).toContain('Case body 1');
    expect(job.warnings).toEqual([]);
  });

  it('builds valid geometry for every part and pose', () => {
    for (const [key, spec] of Object.entries(job.meshes)) {
      if (spec.kind === 'bin') continue;
      const c = check(meshOf(job, key));
      expect(c.status, key).toBe('NoError');
      expect(c.volume, key).toBeGreaterThan(0);
    }
  });

  it('meshes sit inside their planned footprints', () => {
    for (const p of Object.values(job.parts)) {
      if (p.kind === 'bin') continue;
      const b = meshBounds(partMesh(job, p.key));
      expect(b.min[0]).toBeGreaterThan(-0.01);
      expect(b.min[1]).toBeGreaterThan(-0.01);
      expect(b.min[2]).toBeGreaterThan(-0.01);
      expect(b.max[0], p.name).toBeLessThan(p.w + 0.01);
      expect(b.max[1], p.name).toBeLessThan(p.d + 0.01);
      expect(b.max[2], p.name).toBeLessThan(p.h + 0.01);
    }
  });

  it('walls clear the bins, and the tallest bin sets their height', () => {
    const g = caseFrame(job.layout, { ...CASE_DEFAULTS(), feet: 'printed' }, plain(), binTotalHeight(bins[1].opts));
    expect(scene.info.wallTop).toBeCloseTo(g.geom.wallTop, 6);
    expect(scene.info.room).toBeCloseTo(binTotalHeight(bins[1].opts) + 2, 6);
    for (const b of bins) {
      const at = binOrigin(job.layout, b);
      const mesh = partMesh(job, `bin:${b.id}`);
      expect(overlap(body(), bodyAt(), mesh, [at.x, at.y, scene.seat])).toBeLessThan(1e-3);
      expect(scene.seat + meshBounds(mesh).max[2]).toBeLessThanOrEqual(scene.info.wallTop! + 1e-6);
    }
    // The bins' seat is the case floor (closed, at least CASE.floor, raised for the feet recesses).
    const floor = (job.meshes[job.parts['piece:1'].meshKey] as Extract<MeshSpec, { kind: 'piece' }>).opts;
    expect(floor.style).toBe('solid');
    expect(scene.seat).toBeCloseTo(binSeatHeight(floor), 6);
    expect(scene.seat).toBeGreaterThanOrEqual(CASE.floor + CASE.foot.printed.depth - 1e-6);
  });

  it('the closed lid fits the case without touching it, and seats on the walls', () => {
    const lid = scene.items.find((i) => i.role === 'lid' && i.when === 'closed')!;
    const lidMesh = meshOf(job, lid.meshKey);
    expect(overlap(body(), bodyAt(), lidMesh, [lid.x, lid.y, lid.z])).toBeLessThan(1e-3);
    // Dropped 0.3 mm, it would hit the walls: it really rests on them.
    expect(overlap(body(), bodyAt(), lidMesh, [lid.x, lid.y, lid.z - 0.3])).toBeGreaterThan(1);
    // Nudged sideways, its rabbet hits the wall lip: it can't slide.
    expect(overlap(body(), bodyAt(), lidMesh, [lid.x + 1, lid.y, lid.z])).toBeGreaterThan(1);
  });

  it('the lid swings open about its hinges without touching the body', () => {
    const spec = Object.values(job.meshes).find((m) => m.kind === 'enclosure' && m.part.kind === 'lid')! as Extract<MeshSpec, { kind: 'enclosure' }>;
    const part = spec.part as Extract<EnclosurePart, { kind: 'lid' }>;
    const g = part.geom;
    const off = g.T + CASE.clearance;
    for (const deg of [-20, -60, -100, LID_OPEN_DEG, -150, -180]) {
      const b = rotatedBounds(g, lidBounds(g, part.piece), deg);
      const mesh = buildEnclosurePart(w, part, { open: deg, origin: b.min });
      expect(overlap(body(), bodyAt(), mesh, [b.min[0] - off, b.min[1] - off, b.min[2]]), `${deg}°`).toBeLessThan(1e-3);
    }
  });

  it('hinge pins sit in the knuckles with clearance and reach past the far knuckle', () => {
    expect(HINGE_CLEARANCE).toBeGreaterThan(0.1);
    expect(PIN_LENGTH).toBeGreaterThan(CASE.hinge.headLen + HINGE_SPAN);
    const lid = scene.items.find((i) => i.role === 'lid' && i.when === 'closed')!;
    const lidMesh = meshOf(job, lid.meshKey);
    const pins = scene.items.filter((i) => i.role === 'hardware');
    expect(pins).toHaveLength(scene.info.hinges!);
    for (const p of pins) {
      const pin = meshOf(job, p.meshKey);
      expect(overlap(body(), bodyAt(), pin, [p.x, p.y, p.z])).toBeLessThan(1e-3);
      expect(overlap(lidMesh, [lid.x, lid.y, lid.z], pin, [p.x, p.y, p.z])).toBeLessThan(1e-3);
      // On the knuckles' axis: the hole is clear all the way round the pin, and knuckle material starts just past it.
      const axisY = p.y + p.d / 2;
      const axisZ = p.z + p.h / 2;
      const x0 = p.x + CASE.hinge.headLen;
      const x1 = x0 + HINGE_SPAN;
      const clear = cylX(x0 - 1, x1 + 0.1, axisY, axisZ, CASE.hinge.pin / 2 + HINGE_CLEARANCE - 0.02);
      expect(overlap(body(), bodyAt(), clear, [0, 0, 0])).toBeLessThan(1e-3);
      expect(overlap(lidMesh, [lid.x, lid.y, lid.z], clear, [0, 0, 0])).toBeLessThan(1e-3);
      const snug = cylX(x0 + 1, x0 + 3, axisY, axisZ, CASE.hinge.hole / 2 + 0.3);
      expect(overlap(body(), bodyAt(), snug, [0, 0, 0])).toBeGreaterThan(0.1);
      const mid = cylX((x0 + x1) / 2 - 1, (x0 + x1) / 2 + 1, axisY, axisZ, CASE.hinge.hole / 2 + 0.3);
      expect(overlap(lidMesh, [lid.x, lid.y, lid.z], mid, [0, 0, 0])).toBeGreaterThan(0.1);
      // Head and barbs are wider than the hole, so the pin stays in.
      expect(CASE.hinge.head).toBeGreaterThan(CASE.hinge.hole);
      expect(meshBounds(pin).max[0]).toBeCloseTo(PIN_LENGTH, 4);
    }
  });

  it('the handle stands on its pegs clear of the lid and body', () => {
    const lid = scene.items.find((i) => i.role === 'lid' && i.when === 'closed')!;
    const handle = scene.items.find((i) => i.role === 'handle' && i.when === 'closed')!;
    const hm = meshOf(job, handle.meshKey);
    expect(check(hm).status).toBe('NoError');
    expect(overlap(meshOf(job, lid.meshKey), [lid.x, lid.y, lid.z], hm, [handle.x, handle.y, handle.z])).toBeLessThan(1e-3);
    expect(overlap(body(), bodyAt(), hm, [handle.x, handle.y, handle.z])).toBeLessThan(1e-3);
    // Its grip clears the lid top by the finger room.
    expect(handle.z + handle.h - CASE.handle.grip).toBeGreaterThan(lid.z + lid.h + CASE.handle.room - 1);
  });

  it('builds tiny and half-grid cases', () => {
    for (const drawer of [
      { mode: 'grid' as const, gridX: 1, gridY: 1, enclosure: 'case' as const, carryCase: { handle: 'arch' as const, feet: 'none' as const } },
      { mode: 'grid' as const, gridX: 2.5, gridY: 1.5, halfGrid: true, enclosure: 'case' as const },
    ]) {
      const j = plan(drawerOf(drawer, [bin('h', 0, 0, 1, 1)]));
      expect(j.drawers[0].enclosure!.info.hinges).toBeGreaterThanOrEqual(1);
      for (const [key, spec] of Object.entries(j.meshes)) {
        if (spec.kind === 'bin' || (spec.kind === 'enclosure' && spec.view)) continue;
        expect(check(buildMesh(w, spec)).status, key).toBe('NoError');
      }
    }
  });

  it('latches hook under ridges on the body: the closed lid cannot lift', () => {
    expect(scene.info.latches).toBeGreaterThan(0);
    // The arm hangs clear of the wall face and the ridge, with its hook tip under the ridge.
    expect(CASE.latch.gap).toBeGreaterThan(CASE.latch.ridge + 0.2);
    expect(CASE.latch.gap - CASE.latch.tip).toBeGreaterThan(CASE.latch.ridge);
    const spec = Object.values(job.meshes).find((m) => m.kind === 'enclosure' && m.part.kind === 'lid')! as Extract<MeshSpec, { kind: 'enclosure' }>;
    const part = spec.part as Extract<EnclosurePart, { kind: 'lid' }>;
    const g = part.geom;
    const off = g.T + CASE.clearance;
    // Lifted at the front by under a millimetre, the hooks already hit the ridges.
    const b = rotatedBounds(g, lidBounds(g, part.piece), -0.3);
    const lifted = buildEnclosurePart(w, part, { open: -0.3, origin: b.min });
    expect(overlap(body(), bodyAt(), lifted, [b.min[0] - off, b.min[1] - off, b.min[2]])).toBeGreaterThan(0.01);
  });

  it('warns about bins taller than the case and a case too big to carry', () => {
    const tall = plan(drawerOf({ mode: 'grid', gridX: 2, gridY: 2, enclosure: 'case', carryCase: { height: 30 } }, [bin('t', 0, 0, 1, 1, { heightUnits: 8 })]));
    expect(tall.warnings.some((m) => /taller than the case/.test(m))).toBe(true);
    const big = plan(drawerOf({ mode: 'grid', gridX: 12, gridY: 4, enclosure: 'case' }));
    expect(big.warnings.some((m) => /bigger than is practical/.test(m))).toBe(true);
  });

  it('keeps a case that fits the bed in one piece', () => {
    const one = plan(drawerOf({ width: 220, depth: 170, enclosure: 'case' }));
    expect(one.plan.pieces).toHaveLength(1);
    const usable = DEFAULT_SETUP.bedW - 2 * DEFAULT_SETUP.plateMargin;
    for (const p of Object.values(one.parts)) expect(Math.max(p.w, p.d), p.name).toBeLessThanOrEqual(usable + 1e-6);
  });

  it('splits a case bigger than the bed into pieces that fit, with lid keys across the seams', () => {
    const setup = { ...DEFAULT_SETUP };
    // Connectors 'none': a split case still gets bowtie keys in its floor.
    const job2 = plan(drawerOf({ mode: 'grid', gridX: 7, gridY: 3, enclosure: 'case', carryCase: { handle: 'arch' } }, [], plain()), setup);
    const sc = job2.drawers[0].enclosure!;
    expect(sc.info.pieces).toBe(2);
    expect(sc.info.joints).toBe('bowtie');
    const usable = setup.bedW - 2 * setup.plateMargin;
    for (const p of Object.values(job2.parts)) {
      expect(Math.min(p.w, p.d), p.name).toBeLessThanOrEqual(usable + 1e-6);
      expect(Math.max(p.w, p.d), p.name).toBeLessThanOrEqual(usable + 1e-6);
    }
    // Lid keys are ordinary connector keys; the floor has its own bowtie keys.
    expect(sc.info.lidKeys).toBeGreaterThan(0);
    expect(Object.values(job2.parts).filter((p) => p.key.startsWith('lidkey:'))).toHaveLength(sc.info.lidKeys!);
    expect(job2.drawers[0].connectors.length).toBeGreaterThan(0);
    // Hinges and latches stay clear of the seam.
    const seam = job2.plan.pieces[0].x1;
    const lid = Object.values(job2.meshes).find((m) => m.kind === 'enclosure' && m.part.kind === 'lid') as Extract<MeshSpec, { kind: 'enclosure' }>;
    const g = (lid.part as Extract<EnclosurePart, { kind: 'lid' }>).geom;
    for (const x of g.hinges) expect(Math.abs(x - seam)).toBeGreaterThan(HINGE_SPAN / 2);
    for (const x of g.latches) expect(Math.abs(x - seam)).toBeGreaterThan(CASE.latch.width / 2);
    // Both lid pieces build, and together they don't touch the body pieces.
    for (const p of job2.plan.pieces) {
      const item = sc.items.find((i) => i.id === `case-lid-${p.id}-closed`)!;
      const lidMesh = meshOf(job2, item.meshKey);
      expect(check(lidMesh).status).toBe('NoError');
      for (const q of job2.plan.pieces) {
        expect(overlap(partMesh(job2, `piece:${q.id}`), sc.pieceAt[q.id], lidMesh, [item.x, item.y, item.z])).toBeLessThan(1e-3);
      }
    }
    // The two body pieces meet at the seam without overlapping.
    expect(overlap(partMesh(job2, 'piece:1'), sc.pieceAt[1], partMesh(job2, 'piece:2'), sc.pieceAt[2])).toBeLessThan(1e-3);
  });
});

function CASE_DEFAULTS() {
  return { height: 0, headroom: 2, wall: 3, lidHeight: 12, hinges: 0, latches: 0, handle: 'fold' as const, feet: 'bumpers' as const, label: '', labelSize: 12 };
}

// ---------------------------------------------------------------------------
// Wall grid
// ---------------------------------------------------------------------------

describe('wall grid', () => {
  const bp = plain({ magnets: true });
  const d = drawerOf({ mode: 'grid', gridX: 4, gridY: 3, enclosure: 'wall', wallMount: { mount: 'countersunk', every: 2, cleat: true } }, [], bp);
  const job = plan(d);
  const piece = job.meshes[job.parts['piece:1'].meshKey] as Extract<MeshSpec, { kind: 'piece' }>;

  it('puts screw holes at the expected cell corners', () => {
    expect(holeLines(job.layout.xs, 0, 4, 2)).toEqual([42, 126]);
    expect(holeLines(job.layout.ys, 0, 3, 2)).toEqual([42, 84]);
    const holes = piece.enclosure!.cuts.filter((c) => c.kind === 'cyl' && c.z0 === -1).map((c) => (c.kind === 'cyl' ? [c.x, c.y] : []));
    expect(holes.sort()).toEqual(
      [
        [42, 42],
        [42, 84],
        [126, 42],
        [126, 84],
      ].sort(),
    );
    const mesh = partMesh(job, 'piece:1');
    const at = job.drawers[0].enclosure!.pieceAt[1];
    // A hole goes through the floor at each corner, and the floor is solid at a corner without one.
    for (const [x, y] of holes) expect(filled(mesh, ...near(at, x, y, 1, 0.5, 1))).toBeLessThan(1e-6);
    expect(filled(mesh, ...near(at, 84, 42, 1, 0.5, 1))).toBeGreaterThan(0.5);
    // The countersink opens into the floor's top, under the post where the four cells meet.
    expect(filled(mesh, ...near(at, 42, 42, 2.9, baseplateFloor(piece.opts) + 0.05, baseplateHeight(piece.opts) - 0.2))).toBeLessThan(1e-6);
    expect(job.warnings).toEqual([]);
  });

  it('builds a valid plate with a ledge and a cleat groove, and a cleat that hangs in it', () => {
    const mesh = partMesh(job, 'piece:1');
    expect(check(mesh).status).toBe('NoError');
    const b = meshBounds(mesh);
    const sc = job.drawers[0].enclosure!;
    // The ledge stands above the plate along the bottom (front) edge.
    expect(b.max[2]).toBeCloseTo(baseplateHeight(piece.opts) + 8, 4);
    expect(sc.pieceAt[1][1]).toBeCloseTo(-WALL.ledge, 6);
    const cleat = sc.items.find((i) => i.role === 'cleat')!;
    const cm = meshOf(job, cleat.meshKey);
    expect(check(cm).status).toBe('NoError');
    expect(overlap(mesh, sc.pieceAt[1], cm, [cleat.x, cleat.y, cleat.z])).toBeLessThan(1e-3);
    // Lifted off the groove's slope it is free; pushed up it would bind: it really hangs on the slope.
    expect(overlap(mesh, sc.pieceAt[1], cm, [cleat.x, cleat.y + 0.5, cleat.z])).toBeGreaterThan(0.1);
    const band = cleatBand(job.layout.plateD);
    expect(cleat.y).toBeGreaterThan(band.y0);
  });

  it('keyhole slots run up the wall from the round entry', () => {
    const kj = plan(drawerOf({ mode: 'grid', gridX: 3, gridY: 3, enclosure: 'wall', wallMount: { mount: 'keyhole', every: 1, ledge: false } }, [], bp));
    const mesh = partMesh(kj, 'piece:1');
    expect(check(mesh).status).toBe('NoError');
    // Shaft slot through the back layer above the entry (toward +Y), solid below it.
    expect(filled(mesh, [42 - 0.5, 42 + 6, 0.2], [42 + 0.5, 42 + 8, 1])).toBeLessThan(1e-6);
    expect(filled(mesh, [42 - 0.5, 42 - 8, 0.2], [42 + 0.5, 42 - 6, 1])).toBeGreaterThan(0.1);
  });

  it('warns without magnets, and counts the screws', () => {
    const nm = plan(drawerOf({ mode: 'grid', gridX: 4, gridY: 3, enclosure: 'wall' }));
    expect(nm.warnings.some((m) => /magnet/i.test(m))).toBe(true);
    // Bins without magnets in their feet are called out too.
    const wd = { mode: 'grid' as const, gridX: 4, gridY: 3, enclosure: 'wall' as const };
    const loose = plan(drawerOf(wd, [bin('a', 0, 0, 1, 1), bin('b', 1, 0, 1, 1, { holes: 'magnets' })], bp));
    expect(loose.warnings.filter((m) => /1 bin has no magnets/.test(m))).toHaveLength(1);
    expect(plan(drawerOf(wd, [bin('b', 1, 0, 1, 1, { holes: 'both' })], bp)).warnings).toEqual([]);
    const bom = billOfMaterials(job);
    expect(bom.hardware.find((h) => /wall grid/.test(h.item))?.count).toBe(4);
    expect(bom.hardware.find((h) => /French cleat/.test(h.item))?.count).toBeGreaterThanOrEqual(2);
    expect(bom.parts.enclosure?.cleat).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Spacer strips
// ---------------------------------------------------------------------------

describe('spacer strips', () => {
  const drawer: Partial<DrawerInput> = { width: 330, depth: 250, fill: 'spacers', alignX: 0 };
  const d = drawerOf(drawer);
  const job = plan(d);
  const sc = job.drawers[0].enclosure!;
  const strips = Object.values(job.parts).filter((p) => p.enclosure === 'spacer');

  it('leave the baseplate as just the grid', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, ...drawer });
    expect([l.nx, l.ny]).toEqual([7, 5]);
    expect([l.plateW, l.plateD]).toEqual([294, 210]);
    expect(l.margins).toEqual({ left: 0, right: 0, front: 0, back: 0 });
  });

  it('fill each margin to within the fit clearance', () => {
    const m = spacerMargins({ ...DEFAULT_DRAWER, ...drawer })!;
    expect(m.left).toBe(0);
    expect(m.right).toBeCloseTo(330 - 0.5 - 294, 6);
    expect(m.front + m.back).toBeCloseTo(250 - 0.5 - 210, 6);
    const segs = Object.values(job.meshes).flatMap((s) => (s.kind === 'enclosure' && s.part.kind === 'spacer' ? [s.part.seg] : []));
    const widthOf = (side: string) => segs.filter((s) => s.side === side).map((s) => (side === 'right' ? s.x1 - s.x0 : s.y1 - s.y0));
    for (const v of widthOf('right')) expect(v).toBeCloseTo(m.right, 6);
    for (const v of widthOf('front')) expect(v).toBeCloseTo(m.front, 6);
    // Across X: grid + right strip = drawer less its clearance. Along each side the segments cover the whole length.
    expect(294 + m.right).toBeCloseTo(330 - 0.5, 6);
    const along = (side: string, a: 'x' | 'y') =>
      segs.filter((s) => s.side === side).reduce((t, s) => t + (a === 'x' ? s.x1 - s.x0 : s.y1 - s.y0), 0);
    expect(along('right', 'y')).toBeCloseTo(250 - 0.5, 6);
    expect(along('front', 'x')).toBeCloseTo(294, 6);
    expect(along('back', 'x')).toBeCloseTo(294, 6);
    expect(sc.shift).toEqual({ x: 0, y: m.front });
  });

  it('fit the bed, split with dovetails', () => {
    const usable = DEFAULT_SETUP.bedW - 2 * DEFAULT_SETUP.plateMargin;
    for (const p of strips) {
      expect(Math.max(p.w, p.d), p.name).toBeLessThanOrEqual(usable + 1e-6);
      const b = meshBounds(partMesh(job, p.key));
      expect(b.max[0]).toBeLessThan(p.w + 0.01);
      expect(b.max[1]).toBeLessThan(p.d + 0.01);
      expect(check(partMesh(job, p.key)).status).toBe('NoError');
    }
    // Neighbouring lengths of a strip interlock without overlapping.
    const front = sc.items.filter((i) => i.id.startsWith('spacer-front-'));
    expect(front.length).toBeGreaterThan(1);
    expect(overlap(meshOf(job, front[0].meshKey), [front[0].x, front[0].y, 0], meshOf(job, front[1].meshKey), [front[1].x, front[1].y, 0])).toBeLessThan(1e-3);
  });

  it('key into sockets in the baseplate edge without touching it', () => {
    const segs = Object.values(job.meshes).flatMap((s) => (s.kind === 'enclosure' && s.part.kind === 'spacer' ? [s.part.seg] : []));
    expect(segs.some((s) => s.tabs.length > 0)).toBe(true);
    for (const p of job.plan.pieces) {
      const pm = partMesh(job, `piece:${p.id}`);
      for (const it of sc.items) {
        expect(overlap(pm, sc.pieceAt[p.id], meshOf(job, it.meshKey), [it.x, it.y, it.z]), `${it.id} on piece ${p.id}`).toBeLessThan(1e-3);
      }
    }
    // The tabs reach into the plate (they'd hit it without the sockets).
    const withTabs = sc.items.find((i) => i.id.startsWith('spacer-right-'))!;
    expect(withTabs.w).toBeGreaterThan(SPACER_TAB_REACH);
    const plain1 = plan(drawerOf({ ...drawer, spacers: { style: 'solid', tabs: false } }));
    for (const m of Object.values(plain1.meshes)) if (m.kind === 'piece') expect(m.enclosure).toBeUndefined();
  });

  it('skip margins too thin to print, and count in the bill of materials', () => {
    const thin = plan(drawerOf({ width: 300, depth: 250, fill: 'spacers' }));
    expect(thin.warnings.some((m) => new RegExp(`under ${SPACER.minWidth} mm`).test(m))).toBe(true);
    const bom = billOfMaterials(job);
    expect(bom.parts.enclosure?.spacer).toBe(strips.length);
    expect(planEnclosure(d, computeLayout(d.drawer), DEFAULT_SETUP)?.kind).toBe('spacers');
  });
});
