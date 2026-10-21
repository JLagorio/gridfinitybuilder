import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds, toMeshData } from '../src/lib/geometry/kernel';
import { boxAt, hullOf } from '../src/lib/geometry/shapes';
import { DEFAULT_BIN, binCells, binKey, binLabel, binSize, binTotalHeight, buildBin, sanitizeBin, type BinCells, type BinOptions } from '../src/lib/geometry/bin';
import { activeContainer, containerDef } from '../src/lib/geometry/containers';
import {
  DEFAULT_DRAWER_UNIT,
  DRAWER_UNIT,
  buildDrawerPart,
  drawerUnitHeight,
  drawerUnitNotes,
  drawerUnitParts,
  planDrawerUnit,
  sanitizeDrawerUnit,
  type DrawerUnitOptions,
} from '../src/lib/geometry/containers/drawers';
import { registerFont } from '../src/lib/geometry/text';
import { meshVolume } from '../src/lib/geometry/volume';
import { BASE_PROFILE_HEIGHT, LIP_HEIGHT, LIP_TOP_FLAT } from '../src/lib/geometry/spec';
import { DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

let w: Wasm;
const live: { delete(): void }[] = [];
const keep = <T extends { delete(): void }>(m: T) => (live.push(m), m);

beforeAll(async () => {
  w = await Module();
  w.setup();
});
afterAll(() => live.forEach((m) => m.delete()));

const solid = (m: MeshData): Manifold => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices })));

const unit = (o: Partial<DrawerUnitOptions> = {}, b: Partial<BinOptions> = {}): BinOptions =>
  sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 9, ...b, container: 'drawers', containers: { drawers: o } });
const optsOf = (b: BinOptions) => activeContainer(b)!.opts as DrawerUnitOptions;

function expectSingleSolid(m: Manifold) {
  expect(m.status()).toBe('NoError');
  const parts = m.decompose();
  expect(parts.length).toBe(1);
  parts.forEach((p) => p.delete());
}

/**
 * Down-facing triangles steeper than 45° (FDM overhangs), that aren't on the
 * bed, in the base (same as a bin) or at one of the allowed bridge heights.
 */
function overhangs(mesh: MeshData, allowedZ: number[], baseTop = 0): number[] {
  const p = mesh.positions;
  const t = mesh.indices;
  const bad = new Set<number>();
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || nz / len > -0.72) continue;
    const z = Math.max(p[a + 2], p[b + 2], p[c + 2]);
    if (z <= baseTop + 1e-3) continue;
    if (allowedZ.some((q) => Math.abs(q - z) < 1e-3)) continue;
    bad.add(Math.round(z * 100) / 100);
  }
  return [...bad];
}

interface Built {
  bin: BinOptions;
  o: DrawerUnitOptions;
  cells: BinCells;
  chest: Manifold;
  chestMesh: MeshData;
}

function build(o: Partial<DrawerUnitOptions> = {}, b: Partial<BinOptions> = {}, cellsIn?: Partial<BinCells>): Built {
  const bin = unit(o, b);
  const cells = binCells(bin, cellsIn);
  const chestMesh = buildBin(w, bin, cells);
  return { bin, o: optsOf(bin), cells, chestMesh, chest: solid(chestMesh) };
}

/** A drawer part at its assembled place in the chest's (bin-centered) frame, moved by (dx, dy, dz). */
function placed(B: Built, i: number, dx = 0, dy = 0, dz = 0): Manifold {
  const parts = drawerUnitParts(B.bin, B.o, B.cells);
  const p = parts[i];
  const { w: W, d: D } = binSize(B.bin, B.cells);
  const m = solid(buildDrawerPart(w, p.spec));
  return keep(m.translate([-W / 2 + p.assembled!.x + dx, -D / 2 + p.assembled!.y + dy, p.assembled!.z + dz]));
}

/**
 * Meshes are float32, so a drawer resting on a shelf can read a few thousandths
 * of a mm³ into it; a real collision here is tens of mm³.
 */
const CLEAR = 0.02;
const HIT = 0.1;

const overlap = (a: Manifold, b: Manifold) => {
  const x = a.intersect(b);
  const v = x.volume();
  x.delete();
  return v;
};

describe('drawer unit options', () => {
  it('sanitize clamps and fills in', () => {
    expect(sanitizeDrawerUnit(undefined)).toEqual(DEFAULT_DRAWER_UNIT);
    const o = sanitizeDrawerUnit({
      rows: 99,
      cols: 0,
      rowSizes: [9, 0, 'x', 2],
      shell: 0.2,
      drawerWall: 10,
      clearance: -1,
      pull: 'handle',
      stops: 0,
      divX: 50,
      divY: -3,
      labels: 1,
      labelStyle: 'inlaid',
      labelTexts: ['A\u0007B', 7, 'x'.repeat(200), '', ''],
      top: 'dome',
    });
    expect(o.rows).toBe(DRAWER_UNIT.maxRows);
    expect(o.cols).toBe(1);
    expect(o.rowSizes).toEqual([4, 1, 1, 2, 1, 1, 1, 1]);
    expect(o.shell).toBe(DRAWER_UNIT.shell.min);
    expect(o.drawerWall).toBe(DRAWER_UNIT.drawerWall.max);
    expect(o.clearance).toBe(DRAWER_UNIT.clearance.min);
    expect(o).toMatchObject({ pull: 'notch', stops: false, divX: DRAWER_UNIT.maxDiv, divY: 1, labels: true, labelStyle: 'raised', top: 'lip' });
    expect(o.labelTexts[0]).toBe('AB');
    expect(o.labelTexts[1]).toBe('');
    expect(o.labelTexts[2].length).toBeLessThanOrEqual(60);
    // Blank entries at the end are dropped; sizes past `rows` are kept for later.
    expect(o.labelTexts.length).toBe(3);
    expect(sanitizeDrawerUnit({ rows: 2, rowSizes: [1, 3, 2] }).rowSizes).toEqual([1, 3, 2]);
    expect(sanitizeDrawerUnit({ rows: 4, rowSizes: [2] }).rowSizes).toEqual([2, 1, 1, 1]);
    // The bin keeps them cleaned.
    expect(optsOf(unit({ cols: 7, pull: 'knob' }))).toMatchObject({ cols: 4, pull: 'knob' });
    expect(sanitizeBin(unit({ cols: 7 })).containers?.drawers).toMatchObject({ cols: 4 });
  });

  it('names itself, takes its height from the units and adds a lip on top', () => {
    const b = unit({ rows: 3 });
    expect(containerDef('drawers')?.label).toBe('Drawer unit');
    expect(binLabel(b)).toBe('2×2×9u drawer unit 3 drawers');
    expect(binLabel(unit({ rows: 2, cols: 2 }))).toBe('2×2×9u drawer unit 4 drawers (2 × 2)');
    expect(binTotalHeight(b)).toBeCloseTo(63 + LIP_HEIGHT - LIP_TOP_FLAT, 6);
    expect(binTotalHeight(unit({ top: 'flat' }))).toBe(63);
    expect(binTotalHeight(unit({ top: 'grid' }))).toBe(63);
    expect(drawerUnitHeight({ heightUnits: 4 }, { top: 'flat' })).toBe(28);
  });

  it('changes the mesh keys with every option', () => {
    const base: Partial<DrawerUnitOptions> = { rows: 2, cols: 2, labels: true, labelTexts: ['A'] };
    const keyOf = (o: Partial<DrawerUnitOptions>) => {
      const b = unit({ ...base, ...o });
      const parts = drawerUnitParts(b, optsOf(b), binCells(b));
      return [binKey(b), ...parts.map((p) => p.meshKey)].join(' ');
    };
    const k0 = keyOf({});
    const changes: Partial<DrawerUnitOptions>[] = [
      { rows: 3 },
      { cols: 1 },
      { rowSizes: [1, 2] },
      { shell: 2 },
      { drawerWall: 1.6 },
      { clearance: 0.5 },
      { pull: 'tab' },
      { pull: 'knob' },
      { pull: 'grip' },
      { stops: false },
      { divX: 2 },
      { divY: 3 },
      { labels: false },
      { labelStyle: 'engraved' },
      { labelTexts: ['B'] },
      { top: 'flat' },
      { top: 'grid' },
    ];
    for (const c of changes) expect(keyOf(c), JSON.stringify(c)).not.toBe(k0);
    // Sizes of rows that aren't used and texts of drawers that don't exist don't matter.
    expect(keyOf({ rowSizes: [1, 1, 3] })).toBe(k0);
    expect(keyOf({ labelTexts: ['A', '', '', '', '', 'Z'] })).not.toContain('"Z"');
    // Identical drawers share one mesh.
    const b = unit({ rows: 3, cols: 2 });
    expect(new Set(drawerUnitParts(b, optsOf(b), binCells(b)).map((p) => p.meshKey)).size).toBe(1);
  });
});

describe('drawer unit geometry', () => {
  it('(the overhang check finds overhangs)', () => {
    const s = new Scope();
    try {
      const floating = toMeshData(s.t(boxAt(w, 0, 0, 5, 10, 10, 8)));
      expect(overhangs(floating, [])).toEqual([5]);
      expect(overhangs(floating, [5])).toEqual([]);
      const wedge = toMeshData(s.t(hullOf(w, [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0], [0, 0, 4], [0, 10, 4], [-6, 0, 4], [-6, 10, 4]])));
      expect(overhangs(wedge, [])).toEqual([4]);
    } finally {
      s.dispose();
    }
  });

  const configs: [string, Partial<DrawerUnitOptions>, Partial<BinOptions>][] = [
    ['1×1, lip, notch', { rows: 2 }, { unitsX: 1, unitsY: 1, heightUnits: 6 }],
    ['1×1, flat', { rows: 1, top: 'flat' }, { unitsX: 1, unitsY: 1, heightUnits: 3 }],
    ['1×1, grid', { rows: 2, top: 'grid', pull: 'grip' }, { unitsX: 1, unitsY: 1, heightUnits: 7 }],
    ['2×2, tab, 3×2', { rows: 3, cols: 2, pull: 'tab', divY: 2 }, {}],
    ['2×2, knob, uneven rows, grid', { rows: 3, rowSizes: [1, 1, 2], cols: 2, pull: 'knob', top: 'grid' }, { holes: 'magnets' }],
    ['2×2, grip, compartments, screws', { rows: 2, cols: 2, pull: 'grip', divX: 2, divY: 2 }, { heightUnits: 8, holes: 'screws' }],
    ['3×2, flat base', { rows: 4, cols: 3, pull: 'notch', top: 'flat' }, { unitsX: 3, heightUnits: 10, base: 'flat' }],
    ['4×3, knob, 4 columns', { rows: 3, cols: 4, pull: 'knob', stops: false, top: 'lip' }, { unitsX: 4, unitsY: 3, heightUnits: 12 }],
  ];

  for (const [name, o, b] of configs) {
    it(`builds a valid chest and drawers that fit: ${name}`, () => {
      const B = build(o, b);
      expectSingleSolid(B.chest);
      const { w: W, d: D } = binSize(B.bin, B.cells);
      const bb = meshBounds(B.chestMesh);
      expect(bb.min[0]).toBeCloseTo(-W / 2, 3);
      expect(bb.max[1]).toBeCloseTo(D / 2, 3);
      expect(bb.min[2]).toBeCloseTo(0, 6);
      expect(bb.max[2]).toBeCloseTo(binTotalHeight(B.bin), 3);

      const plan = planDrawerUnit(B.bin, B.o, B.cells);
      const parts = drawerUnitParts(B.bin, B.o, B.cells);
      expect(parts.length).toBe(plan.rows * plan.cols);
      expect(parts.length).toBeGreaterThan(0);
      // Shelves and roof are the only bridges; nothing else hangs past 45°.
      expect(overhangs(B.chestMesh, plan.slots.map((s) => s.bay.z1), plan.floorTop)).toEqual([]);

      const c = B.o.clearance;
      parts.forEach((p, i) => {
        const mesh = buildDrawerPart(w, p.spec);
        const m = solid(mesh);
        expectSingleSolid(m);
        const pb = meshBounds(mesh);
        expect(pb.min[0]).toBeCloseTo(0, 3);
        expect(pb.min[1]).toBeCloseTo(0, 3);
        expect(pb.min[2]).toBeCloseTo(0, 3);
        expect(pb.max[0]).toBeCloseTo(p.w, 3);
        expect(pb.max[1]).toBeCloseTo(p.d, 3);
        expect(pb.max[2]).toBeCloseTo(p.h, 3);
        // Prints upright without supports (no label text here).
        expect(overhangs(mesh, [])).toEqual([]);
        // Inside the footprint, and clear of the chest where it sits...
        expect(p.assembled!.x).toBeGreaterThanOrEqual(0);
        expect(p.assembled!.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.assembled!.x + p.w).toBeLessThanOrEqual(W + 1e-6);
        expect(p.assembled!.y + p.d).toBeLessThanOrEqual(D + 1e-6);
        if (i > 1 && i < parts.length - 1 && parts.length > 4) return; // the corners and edges are enough
        expect(overlap(B.chest, placed(B, i))).toBeLessThan(CLEAR);
        // ...with the clearance on the sides and above, but not more.
        const pr = p.spec as { stop: unknown };
        const side = pr.stop ? c - (c + Math.min(0.3, Math.max(0.1, c / 2))) / 2 : c;
        expect(overlap(B.chest, placed(B, i, -(side - 0.05)))).toBeLessThan(CLEAR);
        expect(overlap(B.chest, placed(B, i, -(side + 0.05)))).toBeGreaterThan(HIT);
        expect(overlap(B.chest, placed(B, i, 0, 0, c - 0.05))).toBeLessThan(CLEAR);
        expect(overlap(B.chest, placed(B, i, 0, 0, c + 0.05))).toBeGreaterThan(HIT);
      });
    });
  }

  it('builds on partial, half-grid and stretched cells', () => {
    for (const cells of [{ x: [42, 30], y: [42, 25] }, { x: [21, 21, 21], y: [21, 21], half: true }, { stretch: { left: 4, right: 0, front: 6, back: 0 } }]) {
      const b: Partial<BinOptions> = 'half' in cells ? { unitsX: 3, unitsY: 2 } : {};
      for (const top of ['lip', 'grid'] as const) {
        const B = build({ rows: 2, cols: 2, top }, b, cells);
        expectSingleSolid(B.chest);
        const parts = drawerUnitParts(B.bin, B.o, B.cells);
        expect(parts.length).toBeGreaterThan(0);
        expect(overlap(B.chest, placed(B, 0))).toBeLessThan(CLEAR);
        expect(overlap(B.chest, placed(B, parts.length - 1))).toBeLessThan(CLEAR);
      }
    }
  });

  it('stops catch a drawer part of the way out', () => {
    const B = build({ rows: 2, cols: 1, stops: true });
    const plan = planDrawerUnit(B.bin, B.o, B.cells);
    const spec = drawerUnitParts(B.bin, B.o, B.cells)[0].spec as { stop: { y: number } | null };
    expect(spec.stop).not.toBeNull();
    // Pulled out until its ridge meets the bay's: they overlap (by about half the clearance).
    const travel = spec.stop!.y - plan.stopFront!;
    expect(overlap(B.chest, placed(B, 0))).toBeLessThan(CLEAR);
    expect(overlap(B.chest, placed(B, 0, 0, -travel / 2))).toBeLessThan(CLEAR);
    expect(overlap(B.chest, placed(B, 0, 0, -travel))).toBeGreaterThan(HIT);
    // That is past half the drawer's depth, so it stays supported.
    expect(travel).toBeGreaterThan(0.5 * plan.slots[0].spec!.d);
    // Without stops it slides right out.
    const N = build({ rows: 2, cols: 1, stops: false });
    expect(overlap(N.chest, placed(N, 0, 0, -travel))).toBeLessThan(CLEAR);
  });

  it('keeps every pull inside the footprint, with the fronts set back', () => {
    for (const pull of ['notch', 'tab', 'knob', 'grip'] as const) {
      const B = build({ rows: 2, cols: 2, pull });
      const plan = planDrawerUnit(B.bin, B.o, B.cells);
      expect(plan.inset).toBe(DRAWER_UNIT.reach[pull]);
      for (const p of drawerUnitParts(B.bin, B.o, B.cells)) {
        expect(p.assembled!.y).toBeCloseTo(0, 6);
        const mesh = buildDrawerPart(w, p.spec);
        // The pull reaches the chest's front exactly.
        expect(meshBounds(mesh).min[1]).toBeCloseTo(0, 3);
      }
    }
  });
});

describe('drawer unit parts and notes', () => {
  it('plans a drawer part per drawer, with sizes and places', () => {
    const o = unit({ rows: 3, cols: 2, pull: 'tab', labels: true, labelTexts: ['Screws'] }, { lid: true, label: 'full', labelText: 'X' });
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 }, bins: [{ id: 'c', x: 0, y: 0, opts: o }] });
    const keys = Object.keys(job.parts);
    expect(keys).toContain('bin:c');
    for (let i = 0; i < 6; i++) expect(keys).toContain(`drawer:c:${i}`);
    expect(keys.some((k) => k.startsWith('lid:') || k.startsWith('label:'))).toBe(false);
    expect(job.parts['bin:c'].h).toBeCloseTo(binTotalHeight(o), 6);
    const plan = planDrawerUnit(o, optsOf(o), binCells(o));
    const p0 = job.parts['drawer:c:0'];
    const s0 = plan.slots[0];
    expect(p0).toMatchObject({ kind: 'bin', bin: 'c', assembled: s0.assembled });
    expect(p0.name).toContain('Drawer 1 “Screws”');
    expect(p0.w).toBeCloseTo(s0.spec!.w + 2 * s0.spec!.ox, 3);
    expect(p0.d).toBeCloseTo(s0.spec!.d + s0.spec!.oy, 3);
    expect(p0.h).toBeCloseTo(plan.bayH[0] - optsOf(o).clearance, 3);
    // Drawers sit in their bays: row by row from the top, left to right.
    const p1 = job.parts['drawer:c:1'];
    const p2 = job.parts['drawer:c:2'];
    expect(p1.assembled!.x).toBeGreaterThan(p0.assembled!.x);
    expect(p1.assembled!.z).toBeCloseTo(p0.assembled!.z, 6);
    expect(p2.assembled!.z).toBeLessThan(p0.assembled!.z);
    const mesh = buildMesh(w, job.meshes[p2.meshKey]);
    const bb = meshBounds(mesh);
    expect(bb.max[0]).toBeCloseTo(p2.w, 3);
    expect(bb.max[1]).toBeCloseTo(p2.d, 3);
    expect(bb.max[2]).toBeCloseTo(p2.h, 3);
  });

  it('warns about shallow drawers, wide bays and what doesn’t fit', () => {
    const notes = (o: Partial<DrawerUnitOptions>, b: Partial<BinOptions> = {}) => {
      const bin = unit(o, b);
      return drawerUnitNotes(bin, optsOf(bin), binCells(bin)).join(' | ');
    };
    expect(notes({ rows: 2, cols: 2 })).toBe('');
    expect(notes({ rows: 3 }, { heightUnits: 4 })).toMatch(/only 2 of 3 drawers fit/);
    expect(notes({ rows: 3 }, { heightUnits: 3 })).toMatch(/only 1 of 3 drawers fit/);
    expect(notes({ rows: 1 }, { heightUnits: 3 })).toMatch(/deep inside/);
    expect(notes({ rows: 2, cols: 1 })).toMatch(/bridge .* sag/);
    expect(notes({ rows: 2, cols: 4 }, { unitsX: 1, unitsY: 1 })).toMatch(/only 3 of 4 columns/);
    expect(notes({ rows: 2, cols: 2, divX: 6, divY: 6 })).toMatch(/compartments are only/);
    // Too short for any drawer: a solid chest, still valid.
    const B = build({ rows: 1, top: 'grid', shell: 4 }, { heightUnits: 2, holes: 'screws' });
    expect(drawerUnitNotes(B.bin, B.o, B.cells)[0]).toMatch(/too short/);
    expect(drawerUnitParts(B.bin, B.o, B.cells)).toEqual([]);
    expectSingleSolid(B.chest);
    expect(planDrawerUnit(B.bin, B.o, B.cells).slots).toEqual([]);
    // The bins' floor height under the bottom drawers clears screw holes.
    expect(planDrawerUnit(B.bin, B.o, B.cells).floorTop).toBeGreaterThan(6);
    expect(planDrawerUnit(unit({}), optsOf(unit({})), binCells(unit({}))).floorTop).toBeCloseTo(BASE_PROFILE_HEIGHT + 1.2, 6);
  });
});

describe('drawer front labels', () => {
  beforeAll(() => {
    const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
    registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });

  const vol = (o: Partial<DrawerUnitOptions>, b: Partial<BinOptions> = {}, i = 0) => {
    const bin = unit(o, b);
    const p = drawerUnitParts(bin, optsOf(bin), binCells(bin))[i];
    const mesh = buildDrawerPart(w, p.spec);
    expectSingleSolid(solid(mesh));
    return { v: meshVolume(mesh), p, mesh };
  };

  it('raises or engraves the text on each front', () => {
    for (const pull of ['notch', 'tab', 'knob', 'grip'] as const) {
      const plain = vol({ rows: 2, cols: 2, pull }).v;
      const raised = (i: number) => vol({ rows: 2, cols: 2, pull, labels: true, labelTexts: ['M3'] }, {}, i).v;
      const engraved = (i: number) => vol({ rows: 2, cols: 2, pull, labels: true, labelStyle: 'engraved', labelTexts: ['M3'] }, {}, i).v;
      // Drawer 1 has the text, drawer 2 none.
      expect(raised(0), pull).toBeGreaterThan(raised(1) + 5);
      expect(engraved(0), pull).toBeLessThan(plain - 5);
      expect(engraved(1), pull).toBeCloseTo(plain, 3);
    }
    // Raised text on a flush front (notch, grip) sets every front back by its height, so it stays inside the footprint.
    const o: Partial<DrawerUnitOptions> = { rows: 2, pull: 'notch', labels: true, labelTexts: ['M3'] };
    const r = vol(o);
    expect(r.p.assembled!.y).toBeCloseTo(0, 6);
    expect(meshBounds(r.mesh).min[1]).toBeCloseTo(0, 3);
    expect(planDrawerUnit(unit(o), optsOf(unit(o))).inset).toBe(DRAWER_UNIT.label.raise);
    expect(vol(o, {}, 1).p.assembled!.y).toBeCloseTo(DRAWER_UNIT.label.raise, 6);
    // Tabs and knobs reach further than the text: their fronts stay put.
    expect(planDrawerUnit(unit({ ...o, pull: 'knob' }), optsOf(unit({ ...o, pull: 'knob' }))).inset).toBe(DRAWER_UNIT.reach.knob);
  });

  it('puts the label beside the pull on shallow drawers', () => {
    // 3 rows at 6u: about 10 mm fronts, too short for text under a knob or a grip.
    for (const pull of ['knob', 'grip'] as const) {
      const plain = vol({ rows: 3, cols: 2, pull }, { heightUnits: 6 }).v;
      const label = vol({ rows: 3, cols: 2, pull, labels: true, labelStyle: 'engraved', labelTexts: ['Resistors'] }, { heightUnits: 6 }).v;
      expect(label, pull).toBeLessThan(plain - 2);
    }
    const bin = unit({ rows: 3, cols: 2, pull: 'knob', labels: true, labelTexts: ['Resistors'] }, { heightUnits: 6 });
    expect(drawerUnitNotes(bin, optsOf(bin), binCells(bin)).join(' ')).not.toMatch(/label/);
  });
});
