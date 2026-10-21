import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binInnerSize, binKey, binSize, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { CUP, DEFAULT_INSERTS, SHADOW, sanitizeInsertOptions, wantsInserts } from '../src/lib/geometry/insertOptions';
import { insertParts, planInserts, type CratePart, type CupPart, type InsertPartPlan } from '../src/lib/geometry/cups';
import { buildInsertPart } from '../src/lib/geometry/insertGeometry';
import { LID_HEIGHT, buildBinLid, lidKey, lidSize, lidStackHeight } from '../src/lib/geometry/lid';
import { lidPocketOpts, pocketLidLayout } from '../src/lib/geometry/pocketLid';
import { PAD, padSites, padThickness } from '../src/lib/geometry/pads';
import { assembledParts } from '../src/lib/geometry/accessories';
import { cutoutFloor, cutoutStyle, pocketFloorZ, type BinCutout } from '../src/lib/geometry/cutouts';
import { BASE_PROFILE_HEIGHT, LIP_DEPTH, LIP_SUPPORT_HEIGHT, WALL } from '../src/lib/geometry/spec';
import { binBodyHeight } from '../src/lib/geometry/variants';
import { DEFAULT_BASEPLATE, type BaseplateOptions } from '../src/lib/geometry/baseplate';
import { DEFAULT_PROJECT, buildMesh, pieceMeshKey, planJob, plateContents, usesSecondFilament, type PlacedBin, type ProjectState } from '../src/lib/project';
import { exportBambuProject } from '../src/lib/export/bambu';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { billOfMaterials, bomCsv, bomText } from '../src/lib/bom';
import { cleanCompartmentOptions, layoutKey, resolveLayout, setCompartmentOptions, setWallEnd, setWallProps, uniformLayout, type DividerLayout } from '../src/lib/dividers';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const toManifold = (mesh: MeshData): Manifold =>
  w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const bin = (o: Partial<BinOptions> = {}) => sanitizeBin({ ...DEFAULT_BIN, ...o } as BinOptions);

/** Volume shared by two meshes, the second moved by (dx, dy, dz). */
function overlap(a: MeshData, b: MeshData, dx = 0, dy = 0, dz = 0) {
  const ma = toManifold(a);
  const mb = toManifold(b);
  const moved = mb.translate([dx, dy, dz]);
  const both = ma.intersect(moved);
  const v = both.volume();
  [ma, mb, moved, both].forEach((m) => m.delete());
  return v;
}

/** Solid volume of a mesh inside a box. */
function solidIn(mesh: MeshData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const m = toManifold(mesh);
  const box = w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
  const both = m.intersect(box);
  const v = both.volume();
  [m, box, both].forEach((x) => x.delete());
  return v;
}

/** Build each part and check it is valid, one piece, and clear of the bin (bin-centered) where it sits. */
function fitsInBin(o: BinOptions, parts: InsertPartPlan[]) {
  const binMesh = buildBin(w, o);
  const { w: W, d: D } = binSize(o);
  const meshes = parts.map((p) => {
    const m = buildInsertPart(w, p.part);
    expect(check(m)).toMatchObject({ status: 'NoError', components: 1 });
    const b = meshBounds(m);
    // Footprint at the origin, inside the planned size.
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(b.max[0]).toBeLessThanOrEqual(p.w + 1e-4);
    expect(b.max[1]).toBeLessThanOrEqual(p.d + 1e-4);
    expect(b.max[2]).toBeCloseTo(p.h, 4);
    expect(overlap(binMesh, m, p.assembled.x - W / 2, p.assembled.y - D / 2, p.assembled.z)).toBeLessThan(1e-3);
    return m;
  });
  // Parts never touch one another either.
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const [a, b] = [parts[i], parts[j]];
      expect(overlap(meshes[i], meshes[j], b.assembled.x - a.assembled.x, b.assembled.y - a.assembled.y, b.assembled.z - a.assembled.z)).toBeLessThan(1e-6);
    }
  }
  return meshes;
}

function lShape(ux: number, uy: number) {
  let l = uniformLayout(2, 2);
  const s = binInnerSize({ unitsX: ux, unitsY: uy });
  l = setWallEnd(l, s, 'x1', 'end', 'y1')!;
  l = setWallEnd(l, s, 'y1', 'end', 'x1')!;
  return l;
}

function keysOf(o: Partial<BinOptions>, l: DividerLayout): string[] {
  const s = binInnerSize({ unitsX: o.unitsX ?? 1, unitsY: o.unitsY ?? 1 });
  return resolveLayout(l, s.w, s.d)
    .compartments.slice()
    .sort((a, b) => a.bounds.y0 - b.bounds.y0 || a.bounds.x0 - b.bounds.x0)
    .map((c) => c.key);
}

const crates = (ps: InsertPartPlan[]) => ps.filter((p) => p.slot === 'crate');

describe('insert options', () => {
  it('defaults change nothing: same keys, same geometry, no parts', () => {
    expect(sanitizeInsertOptions({})).toEqual(DEFAULT_INSERTS);
    // Old projects' bins (no insert fields at all) keep their classic key.
    const { cups: _c, cupGrip: _g, cupScoop: _s, crate: _k, crateDivX: _x, crateDivY: _y, crateHeight: _h, crateWall: _w, lidStyle: _l, shadowFloor: _f, ...old } = DEFAULT_BIN;
    expect(binKey(sanitizeBin(old as BinOptions))).toBe('1-1-3-L-none-1-1-0-none-F');
    expect(binKey(bin())).toBe('1-1-3-L-none-1-1-0-none-F');
    expect(insertParts(bin({ unitsX: 2, divX: 2 }))).toEqual([]);
    expect(wantsInserts(bin())).toBe(false);
  });

  it('cups, grids and pocket lids never change the bin itself', () => {
    const base = { unitsX: 2, unitsY: 2, heightUnits: 4, divX: 2, divY: 2, lid: true };
    const plain = bin(base);
    for (const extra of [{ cups: true }, { crate: true }, { lidStyle: 'pockets' as const }, { shadowFloor: true }]) {
      const o = bin({ ...base, ...extra });
      expect(binKey(o)).toBe(binKey(plain));
    }
    const a = buildBin(w, plain);
    const b = buildBin(w, bin({ ...base, cups: true }));
    expect(b.positions).toEqual(a.positions);
  });

  it('cleans bad values and per-compartment fields', () => {
    const o = sanitizeInsertOptions({ cupGrip: 'hook' as never, crateDivX: 99, crateDivY: -3, crateHeight: 1, crateWall: 0, lidStyle: 'x' as never, lidPockets: { pocketW: 'nope', pocketDepth: 9 } as never });
    expect(o).toMatchObject({ cupGrip: 'tab', crateDivX: 12, crateDivY: 1, crateHeight: 3, crateWall: 0.8, lidStyle: 'stack', lidPockets: { pocketDepth: 9 } });
    expect(sanitizeInsertOptions({ lidPockets: 'junk' as never }).lidPockets).toBeUndefined();
    expect(cleanCompartmentOptions({ cup: true, crate: 'yes' })).toEqual({ cup: true });
    expect(cleanCompartmentOptions({ cup: false })).toEqual({ cup: false });
    // A compartment's cup choice is not part of the bin's key.
    const l = setCompartmentOptions(uniformLayout(2, 1), keysOf({ unitsX: 2 }, uniformLayout(2, 1))[0], { cup: true });
    expect(layoutKey(l)).toBe(layoutKey(setCompartmentOptions(l, keysOf({ unitsX: 2 }, l)[0], { cup: undefined })));
  });
});

describe('lift-out cups', () => {
  it('fits a cup in every compartment of a divX × divY bin, clear of the walls by the clearance', () => {
    const o = bin({ unitsX: 2, unitsY: 1, heightUnits: 4, divX: 3, divY: 1, cups: true, lip: false });
    const parts = insertParts(o);
    expect(parts).toHaveLength(3);
    fitsInBin(o, parts);
    const inner = binInnerSize(o);
    const cw = (inner.w - 2 * 1.2) / 3;
    const c = CUP.clearance;
    for (const p of parts) {
      expect(p.kind).toBe('tray');
      expect(p.w).toBeCloseTo(cw - 2 * c, 2);
      expect(p.d).toBeCloseTo(inner.d - 2 * c, 2);
      // As deep as the compartment, rim a little under the top.
      expect(p.h).toBeCloseTo(binBodyHeight(o) - 7 - CUP.headroom, 2);
      expect(p.assembled.z).toBeCloseTo(7, 6);
    }
    // The left cup is the clearance away from the left wall.
    expect(parts[0].assembled.x).toBeCloseTo(WALL + c, 2);
  });

  it('stays inside the stacking lip’s opening, so it lifts straight out', () => {
    const o = bin({ unitsX: 1, unitsY: 1, heightUnits: 3, cups: true });
    const [p] = insertParts(o);
    expect(p.assembled.x).toBeCloseTo(LIP_DEPTH + CUP.clearance, 2);
    expect(p.w).toBeCloseTo(binSize(o).w - 2 * (LIP_DEPTH + CUP.clearance), 2);
    expect(p.h).toBeCloseTo(binBodyHeight(o) - LIP_SUPPORT_HEIGHT - 7 - CUP.headroom, 2);
    fitsInBin(o, [p]);
  });

  it('clears scoops, label tabs, finger slides and lip notches', () => {
    for (const extra of [
      { scoop: 1, label: 'full' as const, heightUnits: 6 },
      { scoop: 0.5, label: 'left' as const, heightUnits: 3 },
      { slideWalls: 'flr', lipNotches: true, heightUnits: 5 },
      { base: 'flat' as const, heightUnits: 4, label: 'center' as const },
    ]) {
      const o = bin({ unitsX: 2, unitsY: 2, divX: 2, divY: 2, cups: true, ...extra });
      const parts = insertParts(o);
      expect(parts).toHaveLength(4);
      fitsInBin(o, parts);
    }
    // A scoop gives the cup's front a bigger chamfer; a tall bin's label tab cuts the cup's back.
    const tall = insertParts(bin({ unitsX: 2, unitsY: 1, heightUnits: 6, divX: 2, cups: true, scoop: 1, label: 'full' }));
    const part = tall[0].part as CupPart;
    expect(part.sides[0]).toBeGreaterThan(part.chamfer);
    expect(part.tab).not.toBeNull();
    expect(part.gripSide).toBe('front');
    // A short bin's tab leaves too little back wall: the cup stops in front of it instead.
    const short = insertParts(bin({ unitsX: 1, unitsY: 1, heightUnits: 3, cups: true, label: 'full' }))[0];
    expect((short.part as CupPart).tab).toBeNull();
    expect(short.d).toBeLessThan(binInnerSize(bin()).d - 10);
  }, 60_000);

  it('builds every grip, with and without the scoop inside', () => {
    for (const grip of ['tab', 'notch', 'none'] as const) {
      for (const cupScoop of [false, true]) {
        const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 5, divX: 2, divY: 1, cups: true, cupGrip: grip, cupScoop });
        const parts = insertParts(o);
        expect((parts[0].part as CupPart).grip).toBe(grip);
        const [m] = fitsInBin(o, parts.slice(0, 1));
        const p = parts[0].part as CupPart;
        if (cupScoop) {
          // Solid inside the front-bottom of the cup.
          expect(solidIn(m, 2, p.wall + 0.3, p.floor + 0.2, p.w - 2, p.wall + 2, p.floor + 1)).toBeGreaterThan(1);
        }
      }
    }
  }, 60_000);

  it('gives L-shaped compartments a cup per rectangle, and skips filled ones', () => {
    const lo = { unitsX: 3, unitsY: 2, heightUnits: 4, cups: true };
    const l = lShape(3, 2);
    const s = binInnerSize(lo as BinOptions);
    const comps = resolveLayout(l, s.w, s.d).compartments;
    expect(comps.some((c) => !c.isRect)).toBe(true);
    const o = bin({ ...lo, layout: l });
    const parts = insertParts(o);
    // A cup per rectangle of each compartment.
    expect(parts.length).toBe(comps.reduce((t, c) => t + c.rects.length, 0));
    const lKey = comps.find((c) => !c.isRect)!.key;
    expect(parts.filter((p) => p.compartment === lKey).length).toBeGreaterThan(1);
    fitsInBin(o, parts);
    // A pocket compartment and a ramp get none (and say so when asked).
    let l2 = setCompartmentOptions(uniformLayout(2, 2), keysOf(lo, uniformLayout(2, 2))[0], { inside: 'pockets' });
    l2 = setCompartmentOptions(l2, keysOf(lo, l2)[1], { floorShape: 'ramp', cup: true });
    const plan = planInserts(bin({ ...lo, layout: l2 }));
    expect(plan.cups).toHaveLength(2);
    expect(plan.misses).toEqual([{ key: keysOf(lo, l2)[1], kind: 'cup', why: 'is filled or has a ramp or steps' }]);
    expect(plan.notes[0]).toMatch(/1 compartment gets no cup/);
  }, 60_000);

  it('lets compartments opt in or out, and clears removable dividers’ ribs', () => {
    const lo = { unitsX: 2, unitsY: 1, heightUnits: 4 };
    const l = uniformLayout(2, 1);
    const [k0, k1] = keysOf(lo, l);
    expect(insertParts(bin({ ...lo, layout: setCompartmentOptions(l, k0, { cup: true }) })).map((p) => p.compartment)).toEqual([k0]);
    expect(insertParts(bin({ ...lo, cups: true, layout: setCompartmentOptions(l, k1, { cup: false }) })).map((p) => p.compartment)).toEqual([k0]);
    // A grid where the bin says cup; a cup wins over a grid.
    const mixed = insertParts(bin({ ...lo, cups: true, layout: setCompartmentOptions(l, k1, { cup: false, crate: true }) }));
    expect(mixed.map((p) => p.slot)).toEqual(['cup', 'crate']);
    // Removable wall: the cups stay clear of its guide ribs.
    const rem = setWallProps(l, 'x1', { removable: true });
    const o = bin({ ...lo, cups: true, layout: rem });
    const parts = insertParts(o);
    const plain = insertParts(bin({ ...lo, cups: true, layout: l }));
    expect(parts[0].w).toBeLessThan(plain[0].w - 0.9);
    fitsInBin(o, parts);
  }, 60_000);

  it('says why a bin gets none', () => {
    expect(planInserts(bin({ cups: true, base: 'lite' })).notes[0]).toMatch(/flat floor/);
    expect(planInserts(bin({ cups: true, tray: true, heightUnits: 8 })).notes[0]).toMatch(/trays/);
    expect(planInserts(bin({ cups: true, interior: 'pockets' })).notes[0]).toMatch(/Compartments interior/);
    expect(planInserts(bin({ unitsX: 1, divX: 6, divY: 6, cups: true })).notes[0]).toMatch(/too small/);
  });

  it('plans cups as parts that show in the drawer and go on the bin plates', () => {
    const placed: PlacedBin = { id: 'a', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 1, heightUnits: 4, divX: 2, cups: true, crate: true }) };
    const job = planJob({ ...DEFAULT_PROJECT, bins: [placed] });
    const cupParts = Object.values(job.parts).filter((p) => p.key.startsWith('cup:'));
    expect(cupParts).toHaveLength(2);
    expect(cupParts[0].name).toMatch(/^Cup [\d.]+ × [\d.]+ × [\d.]+ mm \(bin 2×1\)$/);
    expect(new Set(cupParts.map((p) => p.meshKey)).size).toBe(1);
    expect(assembledParts(job, 'a').map((p) => p.key)).toEqual(['cup:a:0', 'cup:a:1']);
    const onPlates = job.plates.filter((p) => p.group === 'bins').flatMap((p) => p.placements.map((x) => x.key));
    expect(onPlates).toEqual(expect.arrayContaining(['cup:a:0', 'cup:a:1']));
    const mesh = buildMesh(w, job.meshes[cupParts[0].meshKey]);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    const bom = billOfMaterials(job);
    expect(bom.parts.trays).toBe(2);
  });
});

describe('egg-crate grid inserts', () => {
  it('drops a one-piece lattice into a one-compartment bin', () => {
    const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 4, crate: true, crateDivX: 3, crateDivY: 4 });
    const parts = insertParts(o);
    expect(parts).toHaveLength(1);
    const p = parts[0];
    expect(p.kind).toBe('divider');
    expect(p.name).toMatch(/^Grid insert 3×4, /);
    const [m] = fitsInBin(o, parts);
    // Inside the lip's opening, as deep as the bin.
    const { w: W } = binSize(o);
    expect(p.w).toBeCloseTo(W - 2 * (LIP_DEPTH + CUP.clearance), 2);
    expect(p.h).toBeCloseTo(binBodyHeight(o) - LIP_SUPPORT_HEIGHT - 7 - CUP.headroom, 2);
    // A lattice: little plastic, open cells top to bottom (looking straight down through the middle of a cell).
    const c = check(m);
    expect(c.volume).toBeLessThan(0.25 * p.w * p.d * p.h);
    const part = p.part as CratePart;
    const cw = (p.w - 2 * part.wall - 2 * part.wall) / 3;
    // (Clear of the rim's 45° foot.)
    expect(solidIn(m, part.wall + 5, part.wall + 5, -1, part.wall + cw - 1, part.wall + 8, p.h + 1)).toBe(0);
  });

  it('fits each compartment, clears tabs and scoops, and keeps cells printable', () => {
    for (const extra of [
      { divX: 2, divY: 1, scoop: 0.6, label: 'left' as const, heightUnits: 6 },
      { divX: 2, divY: 2, fillet: false, crateHeight: 8, heightUnits: 3 },
      { layout: lShape(3, 2), unitsX: 3, heightUnits: 4 },
    ]) {
      const o = bin({ unitsX: 2, unitsY: 2, crate: true, crateDivX: 2, crateDivY: 2, ...extra });
      const parts = crates(insertParts(o));
      expect(parts.length).toBeGreaterThan(1);
      fitsInBin(o, parts);
    }
    // Fixed height, when it is lower than the compartment.
    expect(insertParts(bin({ crate: true, crateHeight: 8 }))[0].h).toBe(8);
    // Too many cells for the space: fewer, at least CRATE.minCell each.
    const many = insertParts(bin({ crate: true, crateDivX: 12 }))[0].part as CratePart;
    expect(many.divX).toBeLessThan(12);
    expect(check(buildInsertPart(w, many)).components).toBe(1);
  }, 60_000);
});

describe('pocket-grid lids', () => {
  const lidBin = (o: Partial<BinOptions> = {}) => bin({ unitsX: 2, unitsY: 1, lid: true, lidStyle: 'pockets', pocketPreset: 'aa', pocketShape: 'round', pocketW: 15, pocketDepth: 12, ...o });

  it('builds a valid lid with the pocket grid on top', () => {
    const o = lidBin();
    const L = pocketLidLayout(o);
    expect(L.pockets.length).toBeGreaterThan(4);
    const mesh = buildBinLid(w, o);
    const c = check(mesh);
    expect(c).toMatchObject({ status: 'NoError', components: 1 });
    const size = lidSize(o);
    expect(size.h).toBeCloseTo(BASE_PROFILE_HEIGHT + 1.25 + 12, 6);
    expect(meshBounds(mesh).max[2]).toBeCloseTo(size.h, 4);
    // A pocket goes from the top down to its floor.
    const [x, y] = L.centers[0];
    expect(solidIn(mesh, x - 3, y - 3, BASE_PROFILE_HEIGHT + 1.35, x + 3, y + 3, size.h + 1)).toBeLessThan(1e-6);
    expect(solidIn(mesh, x - 3, y - 3, BASE_PROFILE_HEIGHT + 0.1, x + 3, y + 3, BASE_PROFILE_HEIGHT + 1.15)).toBeGreaterThan(30);
    // Same feet as the stacking lid, so it seats in the lip the same way.
    const stack = buildBinLid(w, { ...o, lidStyle: 'stack' });
    const { w: W, d: D } = binSize(o);
    expect(solidIn(mesh, -W, -D, -1, W, D, BASE_PROFILE_HEIGHT)).toBeCloseTo(solidIn(stack, -W, -D, -1, W, D, BASE_PROFILE_HEIGHT), 1);
  });

  it('keys on its pockets, takes its own pocket settings, and works with magnets and sets', () => {
    const o = lidBin();
    expect(lidKey(o)).toMatch(/\|P\{Pround15d12/);
    expect(lidKey({ ...o, lidStyle: 'stack' })).toBe('42/42x42');
    expect(lidSize({ ...o, lidStyle: 'stack' }).h).toBe(LID_HEIGHT);
    expect(lidStackHeight(o)).toBeCloseTo(lidStackHeight({ ...o, lidStyle: 'stack' }) - LID_HEIGHT + lidSize(o).h, 6);
    const own = lidBin({ lidPockets: { pocketShape: 'hex', pocketMagnet: true, pocketTilt: 15 } });
    expect(lidPocketOpts(own)).toMatchObject({ pocketShape: 'hex', pocketMagnet: true, pocketTilt: 15, pocketW: 15 });
    expect(lidKey(own)).not.toBe(lidKey(o));
    for (const lo of [own, lidBin({ lidPockets: { pocketSizes: [3, 4, 5, 6, 8, 10], pocketSizeLabels: 'mm', pocketDepth: 15 } })]) {
      expect(check(buildBinLid(w, lo))).toMatchObject({ status: 'NoError', components: 1 });
    }
  }, 60_000);

  it('is planned as the bin’s lid', () => {
    const job = planJob({ ...DEFAULT_PROJECT, bins: [{ id: 'a', x: 0, y: 0, opts: lidBin() }] });
    const lid = job.parts['lid:a'];
    expect(lid.name).toMatch(/^Pocket-grid lid for bin/);
    expect(lid.h).toBeCloseTo(lidSize(lidBin()).h, 6);
    expect(check(buildMesh(w, job.meshes[lid.meshKey]))).toMatchObject({ status: 'NoError', components: 1 });
  });
});

describe('two-colour shadow boards', () => {
  const tool = (x: number, y: number, depth = 8): BinCutout => ({
    toolId: 't',
    name: 'Tool',
    x,
    y,
    rotation: 15,
    outline: [
      [-14, -5],
      [14, -5],
      [18, 0],
      [14, 5],
      [-14, 5],
    ],
    depth,
    clearance: 0.5,
    notches: [[0, 5]],
  });
  const board = (o: Partial<BinOptions> = {}) => bin({ unitsX: 2, unitsY: 1, heightUnits: 4, interior: 'cutouts', cutouts: [tool(-10, 2), tool(15, -5, 12)], ...o });

  it('adds a filament-2 floor in each pocket only when on', () => {
    expect(buildBin(w, board()).overlays).toBeUndefined();
    const mesh = buildBin(w, board({ shadowFloor: true }));
    expect(mesh.overlays).toHaveLength(1);
    const ov = mesh.overlays![0];
    expect(ov.filament).toBe(2);
    const c = check(ov as MeshData);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(2);
    // It fills exactly what the deeper floors took away, touching the bin without overlapping it.
    const plain = check(buildBin(w, board()));
    const body = check(mesh);
    expect(body.volume + c.volume).toBeCloseTo(plain.volume, 0);
    expect(overlap(mesh, ov as MeshData)).toBeLessThan(1e-3);
    // Inside the pockets: at their floors, under their outlines.
    const o = board({ shadowFloor: true });
    const top = binBodyHeight(o) - LIP_SUPPORT_HEIGHT;
    const floors = o.cutouts!.map((t) => pocketFloorZ(top, t, cutoutStyle(o), cutoutFloor(o)));
    const b = meshBounds(ov as MeshData);
    expect(b.min[2]).toBeCloseTo(Math.min(...floors) - SHADOW.depth, 4);
    expect(b.max[2]).toBeCloseTo(Math.max(...floors), 4);
    expect(c.volume).toBeGreaterThan(SHADOW.depth * 2 * 28 * 10);
    expect(c.volume).toBeLessThan(SHADOW.depth * 2 * 40 * 12);
    // The key says so.
    expect(binKey(o)).toBe(`${binKey(board())}-Sh${SHADOW.depth}`);
    // No tools: nothing to do, same key.
    expect(binKey(board({ shadowFloor: true, cutouts: [] }))).toBe(binKey(board({ cutouts: [] })));
  }, 60_000);

  it('works in tool compartments, only inside them', () => {
    const lo = { unitsX: 2, unitsY: 1, heightUnits: 4 };
    const l = setCompartmentOptions(uniformLayout(2, 1), keysOf(lo, uniformLayout(2, 1))[0], { inside: 'tools' });
    // One tool in the tools compartment (left), one across the other.
    const o = bin({ ...lo, layout: l, cutouts: [tool(-20, 0, 6), tool(20, 0, 6)], shadowFloor: true });
    const mesh = buildBin(w, o);
    const ov = mesh.overlays![0] as MeshData;
    expect(meshBounds(ov).max[0]).toBeLessThan(0);
    expect(overlap(mesh, ov)).toBeLessThan(1e-3);
  });

  it('is printed in filament 2 by the Bambu export', () => {
    const project = (opts: BinOptions): ProjectState => ({ ...DEFAULT_PROJECT, include: { baseplate: false, bins: true }, bins: [{ id: 'a', x: 0, y: 0, opts }] });
    expect(usesSecondFilament(planJob(project(board())))).toBe(false);
    const job = planJob(project(board({ shadowFloor: true })));
    expect(usesSecondFilament(job)).toBe(true);
    const get = (k: string) => buildMesh(w, job.meshes[k]);
    const files = unzipSync(exportBambuProject(job, { ...DEFAULT_PROJECT.setup, labelColour: '#ff0000' }, get));
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(cfg).toContain('<metadata key="extruder" value="2"/>');
    expect(cfg).toContain('Tool shadows');
  });
});

describe('TPU non-slip pads', () => {
  const drawer = { ...DEFAULT_DRAWER, width: 300, depth: 220 };
  /** A recess's volume below the plate (the part of the cutter above z = 0). */
  const recessOf = (s: ReturnType<typeof padSites>[number]) => {
    const r = s.kind === 'dot' ? PAD.dot / 2 : PAD.strip / 2;
    const len = s.kind === 'dot' ? 0 : Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    return (Math.PI * r * r + 2 * r * len) * PAD.depth;
  };
  const project = (bp: Partial<BaseplateOptions>): ProjectState => ({ ...DEFAULT_PROJECT, drawer, baseplate: { ...DEFAULT_BASEPLATE, ...bp }, bins: [] });

  it('leaves plates without pads as they were', () => {
    const job = planJob(project({}));
    expect(Object.values(job.parts).some((p) => p.kind === 'pad')).toBe(false);
    const spec = job.meshes[job.parts['piece:1'].meshKey];
    expect(spec.key).not.toContain('pads');
    expect(spec.kind === 'piece' && spec.key).toBe(spec.kind === 'piece' && pieceMeshKey(spec.layout, spec.piece, DEFAULT_BASEPLATE, spec.connectors));
  });

  for (const pads of ['dots', 'strips'] as const) {
    for (const style of ['frame', 'solid', 'weighted'] as const) {
      it(`${pads} under a ${style} plate match their recesses`, () => {
        const job = planJob(project({ pads, style, connector: 'bowtie' }));
        const padParts = Object.values(job.parts).filter((p) => p.kind === 'pad');
        expect(padParts.length).toBeGreaterThan(pads === 'dots' ? 10 : 2);
        expect(padParts.every((p) => /\(TPU\)$/.test(p.name))).toBe(true);
        // On a plate of their own.
        const plate = job.plates.find((p) => p.name.startsWith('TPU pads'))!;
        expect(plate.group).toBe('baseplate');
        expect(plate.placements.map((p) => job.parts[p.key].kind).every((k) => k === 'pad')).toBe(true);
        expect(job.plates.filter((p) => p !== plate).flatMap((p) => p.placements).some((p) => job.parts[p.key].kind === 'pad')).toBe(false);
        expect(plateContents(job, plate)).toEqual([`${padParts.length} TPU non-slip pads`]);
        let recesses = 0;
        let recessVolume = 0;
        for (const piece of job.plan.pieces) {
          const spec = job.meshes[job.parts[`piece:${piece.id}`].meshKey];
          if (spec.kind !== 'piece') throw new Error('piece');
          const sites = padSites(spec.layout, spec.piece, spec.opts, spec.connectors);
          recesses += sites.length;
          recessVolume += sites.reduce((t, s) => t + recessOf(s), 0);
          // Build one piece (the next test builds them all, with and without pads).
          if (piece.id !== 1) continue;
          const with_ = buildMesh(w, spec);
          expect(check(with_)).toMatchObject({ status: 'NoError', components: 1 });
          // Recesses are in the underside only, PAD.depth deep.
          for (const s of sites) {
            const [x, y] = s.kind === 'dot' ? [s.x, s.y] : [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2];
            const px = x - spec.piece.x0;
            const py = y - spec.piece.y0;
            expect(solidIn(with_, px - 0.5, py - 0.5, 0, px + 0.5, py + 0.5, PAD.depth - 0.01)).toBeLessThan(1e-6);
            expect(solidIn(with_, px - 0.5, py - 0.5, PAD.depth + 0.01, px + 0.5, py + 0.5, PAD.depth + 0.3)).toBeCloseTo(0.29, 4);
          }
        }
        expect(padParts.length).toBe(recesses);
        // Each pad is its recess less the fit, PAD.proud thicker than the recess is deep.
        let padVolume = 0;
        const built = new Map<string, MeshData>();
        for (const p of padParts) {
          if (!built.has(p.meshKey)) built.set(p.meshKey, buildMesh(w, job.meshes[p.meshKey]));
          const m = built.get(p.meshKey)!;
          const c = check(m);
          expect(c).toMatchObject({ status: 'NoError', components: 1 });
          const b = meshBounds(m);
          expect(b.max[2]).toBeCloseTo(padThickness(), 5);
          expect(padThickness()).toBeCloseTo(PAD.depth + PAD.proud, 6);
          expect(b.max[0] - b.min[0]).toBeCloseTo(p.w - 2 * PAD.fit, 2);
          expect(b.max[1] - b.min[1]).toBeCloseTo(p.d - 2 * PAD.fit, 2);
          padVolume += (c.volume * PAD.depth) / padThickness();
        }
        // The pads fill their recesses (less the fit and the foot chamfer).
        expect(padVolume).toBeLessThan(recessVolume);
        expect(padVolume).toBeGreaterThan(0.85 * recessVolume);
      }, 60_000);
    }
  }

  it('keeps clear of seams, joints, cut-out cells, magnets and the edge', () => {
    const drawerMask = { ...drawer, mask: ['1,1', '3,2'], maskStyle: 'void' as const };
    for (const [bp, d] of [
      [{ pads: 'dots', connector: 'screw', bottomChamfer: 1 }, drawer],
      [{ pads: 'strips', style: 'skeletonized', magnets: true, magnetSide: 'bottom', connector: 'pin' }, drawer],
      [{ pads: 'dots', style: 'solid', magnets: true, screws: true }, drawerMask],
    ] as [Partial<BaseplateOptions>, typeof drawer][]) {
      const job = planJob({ ...project(bp), drawer: d });
      expect(Object.values(job.parts).some((p) => p.kind === 'pad')).toBe(true);
      for (const piece of job.plan.pieces) {
        const spec = job.meshes[job.parts[`piece:${piece.id}`].meshKey];
        if (spec.kind !== 'piece') continue;
        const sites = padSites(spec.layout, spec.piece, spec.opts, spec.connectors);
        const a = check(buildMesh(w, spec));
        const b = check(buildMesh(w, { ...spec, opts: { ...spec.opts, pads: undefined } }));
        expect(a).toMatchObject({ status: 'NoError', components: 1 });
        // Each recess takes its own full volume: it runs into nothing else.
        expect(b.volume - a.volume).toBeCloseTo(sites.reduce((t, s) => t + recessOf(s), 0), -1);
      }
    }
  }, 60_000);

  it('keeps dots off seams and the plate edge', () => {
    const job = planJob(project({ pads: 'dots', connector: 'screw', bottomChamfer: 1 }));
    for (const piece of job.plan.pieces) {
      const spec = job.meshes[job.parts[`piece:${piece.id}`].meshKey];
      if (spec.kind !== 'piece') continue;
      for (const s of padSites(spec.layout, spec.piece, spec.opts, spec.connectors)) {
        if (s.kind !== 'dot') continue;
        expect(s.x - PAD.dot / 2).toBeGreaterThanOrEqual(piece.x0 + PAD.edge - 1e-6);
        expect(s.x + PAD.dot / 2).toBeLessThanOrEqual(piece.x1 - PAD.edge + 1e-6);
        expect(s.y - PAD.dot / 2).toBeGreaterThanOrEqual(piece.y0 + PAD.edge - 1e-6);
        expect(s.y + PAD.dot / 2).toBeLessThanOrEqual(piece.y1 - PAD.edge + 1e-6);
      }
      expect(check(buildMesh(w, spec))).toMatchObject({ status: 'NoError', components: 1 });
    }
  }, 60_000);

  it('goes one per 42 mm unit on a half grid', () => {
    for (const pads of ['dots', 'strips'] as const) {
      const job = planJob({ ...project({ pads }), drawer: { ...drawer, halfGrid: true } });
      const { xs, ys } = job.layout;
      const even = (b: number[], v: number) => b.findIndex((x) => Math.abs(x - v) < 1e-3) % 2 === 0;
      let n = 0;
      for (const piece of job.plan.pieces) {
        const spec = job.meshes[job.parts[`piece:${piece.id}`].meshKey];
        if (spec.kind !== 'piece') continue;
        for (const s of padSites(spec.layout, spec.piece, spec.opts, spec.connectors)) {
          n++;
          if (s.kind === 'dot') expect(even(xs, s.x) && even(ys, s.y)).toBe(true);
          else expect(s.y0 === s.y1 ? even(ys, s.y0) : even(xs, s.x0)).toBe(true);
        }
      }
      expect(n).toBeGreaterThan(0);
      expect(Object.values(job.parts).filter((p) => p.kind === 'pad')).toHaveLength(n);
    }
  });

  it('is in the bill of materials as TPU', () => {
    const job = planJob(project({ pads: 'strips' }));
    const bom = billOfMaterials(job);
    const n = Object.values(job.parts).filter((p) => p.kind === 'pad').length;
    expect(bom.parts.pads).toBe(n);
    expect(bom.parts.keys).toBe(0);
    expect(bomText(bom)).toContain(`${n} non-slip pads in TPU`);
    expect(bomCsv(bom)).toContain('Non-slip pads (TPU)');
  });
});
