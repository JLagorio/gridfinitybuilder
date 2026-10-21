import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { Scope, type Manifold, type MeshData, type Vec2, type Wasm } from '../src/lib/geometry/kernel';
import { loftRoundedRect } from '../src/lib/geometry/shapes';
import {
  BASE_PROFILE,
  BASE_PROFILE_DEPTH,
  BASE_PROFILE_HEIGHT,
  BASE_TOP,
  BASE_TOP_RADIUS,
  GRID,
  HEIGHT_UNIT,
  LIP_TOP_FLAT,
  LIP_HEIGHT,
} from '../src/lib/geometry/spec';
import { lipCavityKnots } from '../src/lib/geometry/lip';
import { DEFAULT_BASEPLATE, baseplateFloor, baseplateHeight, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { makePieces } from '../src/lib/layout/split';
import { DEFAULT_DRAWER, computeLayout } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { mountBox, partBounds, prismX, printedSize, siteAt, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { GRID_FLOOR, GRID_TOP } from '../src/lib/wall/kinds/grid';
import { SHELF, shelfSide, type GridShelfOptions } from '../src/lib/wall/kinds/gridShelf';
import { PLATE_LEDGE } from '../src/lib/wall/kinds/gridPlate';
import { CLIP, clipSide, type GridClipOptions } from '../src/lib/wall/kinds/gridClip';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** A kind's options, layout and mesh. */
function build(type: string, opts: object = {}) {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  return { def, o, layout, mesh };
}

/** The printed part turned back to hang as on the wall, in its own frame (front view bottom-left at the origin, z out). */
function inWall(mesh: MeshData, layout: AttachmentLayout): Manifold {
  const m = toManifold(mesh);
  const r = m.rotate(viewTurn(layout.pose));
  const b = r.boundingBox();
  const pb = partBounds(layout, CTX);
  const out = r.translate([pb.x0 - b.min[0], pb.y0 - b.min[1], pb.z0 - b.min[2]]);
  m.delete();
  r.delete();
  return out;
}

/** How much two solids share, mm³ (frees both). */
function shared(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  const v = i.volume();
  for (const x of [a, b, i]) x.delete();
  return v;
}

/** A 1 × 1 bin's base and body, its bottom at z = 0, centred on (cx, cy): the base profile of geometry/bin.ts. */
function binFoot(cx: number, cy: number, height = 20): Manifold {
  return loftRoundedRect(w, cx, cy, BASE_TOP, BASE_TOP, BASE_TOP_RADIUS, [
    { z: 0, inset: BASE_PROFILE_DEPTH },
    { z: BASE_PROFILE.chamfer1, inset: BASE_PROFILE.chamfer2 },
    { z: BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical, inset: BASE_PROFILE.chamfer2 },
    { z: BASE_PROFILE_HEIGHT, inset: 0 },
    { z: height, inset: 0 },
  ]);
}

describe('Gridfinity shelf', () => {
  /** A bin seated in cell (i, j) of a shelf, `drop` lower and `dx` to the right, in the shelf's frame. */
  function binOnShelf(o: GridShelfOptions, i: number, j: number, drop = 0, dx = 0): Manifold {
    const sd = shelfSide(o);
    const f = binFoot(SHELF.cheek + (i + 0.5) * GRID + dx, -(SHELF.root + (j + 0.5) * GRID));
    // As the builder lays the shelf: flat (y up, z out from its back-bottom edge), tilted about that edge, on the back plate.
    const flat = f.rotate([-90, 0, 0]).translate([0, GRID_FLOOR - drop, 0]);
    const tilted = flat.rotate([o.tilt, 0, 0]).translate([0, sd.y0, SHELF.plate]);
    for (const x of [f, flat]) x.delete();
    return tilted;
  }

  it('is cells × 42 of receptacles between its cheeks, and a bin seats in every cell', () => {
    const { o, layout, mesh } = build('gridShelf', { cellsX: 3, cellsY: 2 });
    const s = o as GridShelfOptions;
    expect(layout.w).toBe(3 * GRID + 2 * SHELF.cheek);
    expect(layout.depth).toBeCloseTo(SHELF.plate + SHELF.root + 2 * GRID + SHELF.front, 6);
    for (const [i, j] of [
      [0, 0],
      [2, 1],
      [1, 0],
    ]) {
      const shelf = inWall(mesh, layout);
      // Seated: it touches the receptacle's chamfers and nothing else.
      expect(shared(shelf, binOnShelf(s, i, j))).toBeLessThan(0.05);
      // Any lower, or 0.5 mm over, and it would be in the shelf: the receptacle holds it where it is.
      expect(shared(inWall(mesh, layout), binOnShelf(s, i, j, 0.3))).toBeGreaterThan(1);
      expect(shared(inWall(mesh, layout), binOnShelf(s, i, j, 0, 0.5))).toBeGreaterThan(0.1);
    }
  });

  it('tilted 30° with magnets: prints upright with no overhangs, and bins seat leaning out', () => {
    const { o, layout, mesh } = build('gridShelf', { cellsX: 2, cellsY: 3, tilt: '30', lip: 12, magnets: true });
    const s = o as GridShelfOptions;
    expect(s.tilt).toBe(30);
    const c = checkPart(w, mesh);
    expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(c.issues.filter((i) => i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
    const b = c.topology.bounds;
    const want = printedSize(layout, CTX);
    expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 1);
    expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
    expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
    for (const [i, j] of [
      [0, 0],
      [1, 2],
    ]) {
      expect(shared(inWall(mesh, layout), binOnShelf(s, i, j))).toBeLessThan(0.05);
      expect(shared(inWall(mesh, layout), binOnShelf(s, i, j, 0.3))).toBeGreaterThan(1);
    }
    // Leaning out: the front of the shelf is lower than its back, by the tilt.
    const sd = shelfSide(s);
    expect(sd.top - GRID_TOP * Math.cos(Math.PI / 6)).toBeCloseTo((SHELF.root + 3 * GRID + SHELF.front) * 0.5, 6);
    expect(attachmentDef('gridShelf')!.hardware!(s)).toEqual([{ item: 'Magnets 6 × 2 mm (Gridfinity shelf)', count: 4 * 6 }]);
  });

  it('flat, it prints upright with no overhangs: the shelf lies on the bed', () => {
    const { mesh } = build('gridShelf', { cellsX: 4, cellsY: 1, lip: 0, magnets: true });
    const c = checkPart(w, mesh);
    expect(c.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
    // Its whole underside is the first layer: the shelf, the back plate and the cheeks.
    expect(c.slices!.contact).toBeGreaterThan(0.9 * (4 * GRID + 2 * SHELF.cheek) * (SHELF.plate + SHELF.root + GRID + SHELF.front));
  });

  it('cheeks at its ends up to the top of the back plate, nothing between the cells', () => {
    const { layout, mesh } = build('gridShelf');
    const at = (x0: number, x1: number) => w.Manifold.cube([x1 - x0, 4, 2]).translate([x0, layout.h - 8, SHELF.plate + 1]);
    expect(shared(inWall(mesh, layout), at(0.5, SHELF.cheek - 0.5))).toBeCloseTo(4 * 2 * (SHELF.cheek - 1), 1);
    expect(shared(inWall(mesh, layout), at(layout.w - SHELF.cheek + 0.5, layout.w - 0.5))).toBeCloseTo(4 * 2 * (SHELF.cheek - 1), 1);
    expect(shared(inWall(mesh, layout), at(SHELF.cheek + 1, layout.w - SHELF.cheek - 1))).toBe(0);
  });

  it('clips across the top, studs in every slot between and below them, down to the shelf', () => {
    const { layout } = build('gridShelf', { cellsX: 3, back: 100 });
    const clips = layout.mounts.filter((m) => m.kind === 'clip');
    const studs = layout.mounts.filter((m) => m.kind === 'stud');
    expect(clips.length).toBe(4);
    expect(clips.every((m) => m.dj === 0)).toBe(true);
    // Every column and every slot between, each row down.
    expect(new Set(studs.map((m) => m.dj))).toEqual(new Set([-1, -2, -3, -4]));
    expect(studs.length).toBeGreaterThanOrEqual(12);
    // The lowest stud is just above the shelf.
    const low = Math.min(...studs.map((m) => mountBox('stud', siteAt(layout, m, CTX), CTX).y0));
    expect(low).toBeLessThan(GRID_TOP + 10);
    // Every mount on the staggered lattice, on the part.
    for (const m of layout.mounts) {
      expect(Math.abs(m.di + m.dj) % 2).toBe(0);
      const b = mountBox(m.kind, siteAt(layout, m, CTX), CTX);
      expect(b.x0).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(b.x1).toBeLessThanOrEqual(layout.w - 2 + 1e-6);
      expect(b.y0).toBeGreaterThanOrEqual(2 - 1e-6);
    }
  });

  it('says when it is tilted with no lip, and when its back plate is short for its depth', () => {
    const def = attachmentDef('gridShelf')!;
    const n = (o: object) => def.notes!(def.sanitize(o), CTX);
    expect(n({})).toEqual([]);
    expect(n({ tilt: '15', lip: 2 }).join()).toMatch(/low front lip/);
    expect(n({ cellsY: 4, back: 40 }).join()).toMatch(/back plate is short/);
    expect(def.summary(def.sanitize({ cellsX: 4, cellsY: 1, tilt: 15 }))).toBe('Gridfinity shelf 4 × 1, 15°');
    expect((def.sanitize({ tilt: 20 }) as GridShelfOptions).tilt).toBe(0);
    expect(attachmentUi('gridShelf')?.group).toBe('gridfinity');
  });
});

describe('Gridfinity wall plate', () => {
  it('its receptacles are a baseplate’s: the same pocket at every height above the floor', () => {
    // A 3 × 3 baseplate with magnets, and a wall plate with them: the middle cell of each.
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 3 });
    const piece = makePieces(layout, [0, 3 * GRID], [0, 3 * GRID])[0];
    const bo = { ...DEFAULT_BASEPLATE, magnets: true, pieceNumbers: false };
    const base = toManifold(buildBaseplatePiece(w, layout, piece, bo));
    const plate = build('gridPlate', { cellsX: 3, cellsY: 3, ledge: false });
    const wall = inWall(plate.mesh, plate.layout);
    expect(baseplateHeight(bo) - baseplateFloor(bo)).toBeCloseTo(GRID_TOP - GRID_FLOOR, 6);
    // Plastic in the cell's square at a height above the floor.
    const solid = (m: Manifold, z: number) => {
      const cs = m.slice(z);
      const sq0 = w.CrossSection.square([GRID, GRID]);
      const sq = sq0.translate([GRID, GRID]);
      const both = cs.intersect(sq);
      const a = both.area();
      for (const x of [cs, sq0, sq, both]) x.delete();
      return a;
    };
    for (const dz of [0.1, 0.3, 0.7, 1.5, 3, 4, 4.5]) {
      expect(solid(wall, GRID_FLOOR + dz), `${dz} mm up`).toBeCloseTo(solid(base, baseplateFloor(bo) + dz), 0);
    }
    // And the magnet pockets in the floor.
    expect(solid(wall, GRID_FLOOR - 1)).toBeCloseTo(solid(base, baseplateFloor(bo) - 1), 0);
    base.delete();
    wall.delete();
  });

  it('a bin with its base in a receptacle sits there, the ledge under the bottom row', () => {
    const { layout, mesh } = build('gridPlate', { cellsX: 2, cellsY: 3 });
    expect(layout.w).toBe(2 * GRID);
    expect(layout.h).toBe(3 * GRID + PLATE_LEDGE.t);
    expect(layout.depth).toBeCloseTo(GRID_TOP + PLATE_LEDGE.out, 6);
    const bin = (i: number, j: number, push = 0) => binFoot((i + 0.5) * GRID, PLATE_LEDGE.t + (j + 0.5) * GRID).translate([0, 0, GRID_FLOOR - push]);
    for (const [i, j] of [
      [0, 0],
      [1, 2],
    ]) {
      expect(shared(inWall(mesh, layout), bin(i, j))).toBeLessThan(0.05);
      expect(shared(inWall(mesh, layout), bin(i, j, 0.3))).toBeGreaterThan(1);
    }
    // The ledge: right under the bottom row (its cells start on top of it), out past the receptacles.
    const ledge = () => w.Manifold.cube([2 * GRID, PLATE_LEDGE.t, PLATE_LEDGE.out]).translate([0, 0, GRID_TOP]);
    expect(shared(inWall(mesh, layout), ledge())).toBeCloseTo(2 * GRID * PLATE_LEDGE.t * PLATE_LEDGE.out, 0);
    expect(shared(ledge(), bin(0, 0).translate([0, -0.5, 0]))).toBeGreaterThan(1);
  });

  it('prints standing up, the receptacles sideways, with no overhangs', () => {
    const { layout, mesh } = build('gridPlate', { cellsX: 1, cellsY: 4, ledge: false, magnets: false });
    expect(layout.h).toBe(4 * GRID);
    const c = checkPart(w, mesh);
    expect(c.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
    const b = c.topology.bounds;
    const want = printedSize(layout, CTX);
    expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
    expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
    // Clips in the top row, studs every row below.
    expect(layout.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(3);
  });

  it('counts its magnets, and says the bins fall off without them', () => {
    const def = attachmentDef('gridPlate')!;
    expect(def.hardware!(def.sanitize({ cellsX: 3, cellsY: 2 }))).toEqual([
      { item: 'Magnets 6 × 2 mm (Gridfinity wall plate)', count: 24, note: 'bins need them too' },
    ]);
    expect(def.hardware!(def.sanitize({ magnets: false }))).toEqual([]);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ magnets: false }), CTX).join()).toMatch(/bottom row/);
    expect(def.summary(def.sanitize({ cellsX: 2, cellsY: 5 }))).toBe('Gridfinity wall plate 2 × 5');
  });
});

describe('Bin lip clip', () => {
  /** A bin's back wall with its stacking lip (geometry/lip.ts), against the clip's plate, from 10 mm up its wall: (z out, y up). */
  function backWall(o: GridClipOptions, W: number, drop = 0, out = 0): Manifold {
    const { yb } = clipSide(o);
    const H = o.units * HEIGHT_UNIT;
    const top = H + LIP_HEIGHT - LIP_TOP_FLAT;
    const knots = lipCavityKnots({ lip: true, lipStyle: 'normal' }, H, 0, 10).filter((k) => k.z < top);
    const z = CLIP.plate + out;
    const y = yb - drop;
    const pts: Vec2[] = [[z, y + 10], ...knots.map((k) => [z + k.inset, y + k.z] as Vec2), [z + LIP_TOP_FLAT, y + top], [z, y + top]];
    // Left to the test's end: the scope would free the result too.
    return prismX(
      w,
      new Scope(),
      pts.map(([a, b]) => [-a, b]),
      -5,
      W + 10,
    );
  }

  it('lip: the bin’s lip passes the plate and tongue, hangs on the catches, and the tongue keeps it in', () => {
    const { o, layout, mesh } = build('gridClip', { cells: 2, units: 4 });
    const c = o as GridClipOptions;
    expect(layout.pose).toBe('side');
    expect(layout.w).toBe(2 * GRID - 8);
    // Seated: clear of the clip (its back on the plate).
    expect(shared(inWall(mesh, layout), backWall(c, layout.w))).toBeLessThan(0.05);
    // It rests on the catches: half a millimetre lower and it would be in them.
    expect(shared(inWall(mesh, layout), backWall(c, layout.w, 0.5))).toBeGreaterThan(0.1);
    // Its top can't come away from the board: 1.5 mm out and the lip is in the tongue.
    expect(shared(inWall(mesh, layout), backWall(c, layout.w, 0, 1.5))).toBeGreaterThan(1);
    // There's room to push it up past the catches (4 mm) under the arm.
    expect(shared(inWall(mesh, layout), backWall(c, layout.w, -4))).toBeLessThan(0.05);
  });

  it('cradle: the bin’s base sits on a receptacle ledge, its lip behind the tongue', () => {
    const { o, layout, mesh } = build('gridClip', { cells: 1, units: 3, style: 'cradle' });
    const c = o as GridClipOptions;
    const { yb } = clipSide(c);
    // The clip starts 3.75 mm in from the bin's side; the bin's back on the plate.
    const base = (drop: number) =>
      binFoot(GRID / 2 - 0.25 - 3.75, -(CLIP.plate + BASE_TOP / 2), 10)
        .rotate([-90, 0, 0])
        .translate([0, yb - drop, 0]);
    expect(shared(inWall(mesh, layout), base(0))).toBeLessThan(0.05);
    expect(shared(inWall(mesh, layout), base(0.3))).toBeGreaterThan(0.5);
    expect(shared(inWall(mesh, layout), backWall(c, layout.w))).toBeLessThan(0.05);
    expect(shared(inWall(mesh, layout), backWall(c, layout.w, 0, 2))).toBeGreaterThan(1);
    const check = checkPart(w, mesh);
    expect(check.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
  });

  it('prints on its side: a hook at the left, studs further along, as tall as the bin', () => {
    const { layout, mesh } = build('gridClip', { cells: 3, units: 8 });
    const hooks = layout.mounts.filter((m) => m.kind === 'hook');
    expect(hooks).toEqual([{ di: 0, dj: 0, kind: 'hook' }]);
    expect(layout.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(5);
    // From the bin's base to above its lip.
    expect(layout.h).toBeCloseTo(8 * HEIGHT_UNIT + LIP_HEIGHT - LIP_TOP_FLAT + CLIP.room + CLIP.arm, 6);
    const c = checkPart(w, mesh);
    expect(c.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
    const b = c.topology.bounds;
    expect(b.max[2] - b.min[2]).toBeCloseTo(printedSize(layout, CTX).h, 1);
  });

  it('says when a bin is too tall to hang by its lip', () => {
    const def = attachmentDef('gridClip')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ units: 15 }), CTX).join()).toMatch(/heavy for its lip/);
    expect(def.notes!(def.sanitize({ units: 15, style: 'cradle' }), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({ cells: 2, units: 6, style: 'cradle' }))).toBe('Bin cradle, 2 wide 6u');
    expect(def.summary(def.sanitize({}))).toBe('Bin lip clip, 1 wide 6u');
  });
});

describe('Gridfinity on a board', () => {
  const att = (id: string, type: string, x: number, y: number, opts: object = {}): PlacedAttachment => ({ id, type, x, y, opts: { ...opts } });
  const board = (attachments: PlacedAttachment[]): NamedDrawer => ({
    id: 'b',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS }, attachments },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  });

  it('every kind places on a 560 × 560 board, where it is put, without warnings', () => {
    const list = [
      att('s', 'gridShelf', 60, 500),
      att('p', 'gridPlate', 300, 500),
      att('l', 'gridClip', 100, 300),
      att('c', 'gridClip', 300, 300, { style: 'cradle', cells: 2, units: 3 }),
      att('t', 'gridShelf', 60, 200, { tilt: '15', cellsX: 2, lip: 10 }),
    ];
    const job = planPrint([board(list)], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.map((p) => p.ok)).toEqual(list.map(() => true));
    expect(wall.placed.map((p) => p.name)).toEqual([
      'Gridfinity shelf 3 × 2',
      'Gridfinity wall plate 3 × 2',
      'Bin lip clip, 1 wide 6u',
      'Bin cradle, 2 wide 3u',
      'Gridfinity shelf 2 × 2, 15°',
    ]);
    // Each prints, on the board's plates.
    const atts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    expect(atts).toHaveLength(list.length);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of atts) expect(onPlates.has(p.key)).toBe(true);
  });
});
