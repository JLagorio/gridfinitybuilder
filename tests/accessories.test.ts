import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binLabelTabs, binSize, buildBin, removableInserts, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import {
  DEFAULT_ACCESSORIES,
  RAIL_SLOT,
  SLIDE,
  SLIDE_LID_HEIGHT,
  TRAY,
  accessoryParts,
  assembledParts,
  lipOpeningInset,
  planAccessories,
  sanitizeAccessoryOptions,
  slideLidBox,
  type AccessoryPartPlan,
  type RailPlatePart,
} from '../src/lib/geometry/accessories';
import { buildAccessoryPart } from '../src/lib/geometry/accessoryGeometry';
import { slideBump } from '../src/lib/geometry/slidingLid';
import { DIVIDER, LIP_DEPTH, LIP_SUPPORT_HEIGHT, WALL } from '../src/lib/geometry/spec';
import { binBodyHeight } from '../src/lib/geometry/variants';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_PROJECT, buildMesh, planJob, type MeshSpec, type PlacedBin } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { billOfMaterials, bomText } from '../src/lib/bom';
import { uniformLayout } from '../src/lib/dividers';

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

/** Volume shared by a bin and a part moved to (dx, dy, dz) (optionally turned first). */
function overlap(a: MeshData, b: MeshData, dx: number, dy: number, dz: number, turn?: (m: Manifold) => Manifold) {
  const ma = toManifold(a);
  const mb = toManifold(b);
  const t = turn ? turn(mb) : mb;
  const moved = t.translate([dx, dy, dz]);
  const both = ma.intersect(moved);
  const v = both.volume();
  [ma, mb, moved, both].forEach((m) => m.delete());
  if (t !== mb) t.delete();
  return v;
}

/** Bin material inside a box (bin-centered mm). */
function solidIn(mesh: MeshData, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const m = toManifold(mesh);
  const box = w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
  const both = m.intersect(box);
  const v = both.volume();
  [m, box, both].forEach((x) => x.delete());
  return v;
}

const parts = (o: BinOptions) => {
  const { w: W, d: D } = binSize(o);
  return accessoryParts(o, W, D);
};
const ofSlot = (ps: AccessoryPartPlan[], slot: string) => ps.filter((p) => p.slot === slot);

describe('defaults keep old bins exactly as they were', () => {
  it('an old bin without accessory fields sanitizes to the defaults', () => {
    const old = { unitsX: 2, unitsY: 1, heightUnits: 4, lip: true, holes: 'none', divX: 2, divY: 1, scoop: 0, label: 'none', fillet: true };
    const o = sanitizeBin(old as unknown as BinOptions);
    for (const [k, v] of Object.entries(DEFAULT_ACCESSORIES)) expect(o[k as keyof BinOptions]).toEqual(v);
    expect(binKey(o)).toBe('2-1-4-L-none-2-1-0-none-F');
  });

  it('classic keys are unchanged, and settings that do nothing leave the key alone', () => {
    expect(binKey(DEFAULT_BIN)).toBe('1-1-3-L-none-1-1-0-none-F');
    const base = binKey(bin());
    // Fields of features that are off.
    expect(binKey(bin({ trayHeight: 30, trayCount: 3, trayDivX: 4, railPitch: 7, railPlates: 5, slideLidText: 'Hi' }))).toBe(base);
    // A sliding lid needs the lip off; trays and rails need compartments.
    expect(binKey(bin({ slideLid: true }))).toBe(base);
    expect(binKey(bin({ tray: true, interior: 'pockets' }))).toBe(binKey(bin({ interior: 'pockets' })));
    expect(binKey(bin({ rails: 'x', interior: 'cutouts' }))).toBe(binKey(bin({ interior: 'cutouts' })));
    // ...and no parts either.
    expect(parts(bin({ slideLid: true }))).toEqual([]);
    expect(parts(bin({ tray: true, interior: 'pockets' }))).toEqual([]);
  });

  it('the default mesh is identical with or without the accessory fields', () => {
    const a = buildBin(w, DEFAULT_BIN);
    const b = buildBin(w, bin({ trayHeight: 33, slideLid: true, railPlates: 9 }));
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);
  });

  it('every accessory changes the key', () => {
    const tall = { heightUnits: 6 };
    const keys = [
      binKey(bin(tall)),
      binKey(bin({ ...tall, tray: true })),
      binKey(bin({ ...tall, tray: true, trayHeight: 12 })),
      binKey(bin({ ...tall, tray: true, trayCount: 2 })),
      binKey(bin({ ...tall, lip: false })),
      binKey(bin({ ...tall, lip: false, slideLid: true })),
      binKey(bin({ ...tall, rails: 'x' })),
      binKey(bin({ ...tall, rails: 'y' })),
      binKey(bin({ ...tall, rails: 'xy' })),
      binKey(bin({ ...tall, rails: 'x', railPitch: 8 })),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    // Tray compartments, plate counts and lid text change only the parts.
    expect(binKey(bin({ ...tall, tray: true, trayDivX: 4 }))).toBe(binKey(bin({ ...tall, tray: true })));
    expect(binKey(bin({ ...tall, rails: 'x', railPlates: 7 }))).toBe(binKey(bin({ ...tall, rails: 'x' })));
    expect(binKey(bin({ ...tall, lip: false, slideLid: true, slideLidText: 'A' }))).toBe(binKey(bin({ ...tall, lip: false, slideLid: true })));
  });

  it('sanitizing clamps every field', () => {
    const o = sanitizeAccessoryOptions({
      tray: 1 as unknown as boolean,
      trayHeight: -4,
      trayCount: 9,
      trayDivX: 0,
      trayDivY: 99,
      rails: 'z' as never,
      railPitch: 1,
      railPlates: -3,
      slideLidText: 'a\u0001b\n2\n3\n4' + 'x'.repeat(100),
    });
    expect(o).toMatchObject({ tray: true, trayHeight: TRAY.minHeight, trayCount: TRAY.maxCount, trayDivX: 1, trayDivY: TRAY.maxDiv, rails: '', railPitch: 5, railPlates: 0 });
    expect(o.slideLidText.split('\n').length).toBeLessThanOrEqual(3);
    expect(o.slideLidText).not.toContain('\u0001');
    expect(sanitizeAccessoryOptions({})).toEqual(DEFAULT_ACCESSORIES);
  });
});

describe('lift-out trays', () => {
  const cases: { name: string; o: Partial<BinOptions> }[] = [
    { name: 'normal lip', o: { heightUnits: 6 } },
    { name: 'reduced lip, 2×1, dividers and a label tab', o: { unitsX: 2, heightUnits: 6, lipStyle: 'reduced', divX: 3, label: 'left' } },
    { name: 'lip notches, 2×2', o: { unitsX: 2, unitsY: 2, heightUnits: 6, lipNotches: true } },
    { name: 'no lip, lite base', o: { heightUnits: 5, lip: false, base: 'lite' } },
    { name: 'two trays', o: { heightUnits: 8, trayCount: 2, trayHeight: 12 } },
    { name: 'three trays, 2×2', o: { unitsX: 2, unitsY: 2, heightUnits: 10, trayCount: 3, trayHeight: 12, divX: 2 } },
  ];
  for (const { name, o: oo } of cases) {
    it(`${name}: one closed solid; each tray rests on its ledge and lifts straight out`, () => {
      const o = bin({ tray: true, ...oo });
      const { w: W, d: D } = binSize(o);
      const mesh = buildBin(w, o);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      const b = meshBounds(mesh);
      expect(b.max[0] - b.min[0]).toBeCloseTo(W, 2);
      expect(b.max[1] - b.min[1]).toBeCloseTo(D, 2);
      const trays = ofSlot(parts(o), 'tray');
      expect(trays.length).toBe(o.trayCount);
      const top = binBodyHeight(o) + 5;
      for (const t of trays) {
        const tm = buildAccessoryPart(w, t.part);
        expect(check(tm)).toMatchObject({ status: 'NoError', components: 1 });
        const tb = meshBounds(tm);
        expect(tb.max[0] - tb.min[0]).toBeCloseTo(t.w, 2);
        expect(tb.max[1] - tb.min[1]).toBeCloseTo(t.d, 2);
        expect(tb.max[2] - tb.min[2]).toBeCloseTo(t.h, 2);
        // Fits through the lip's opening with clearance.
        expect(t.w).toBeLessThanOrEqual(W - 2 * (lipOpeningInset(o) + TRAY.clearance) + 1e-6);
        const x = -W / 2 + t.assembled!.x;
        const y = -D / 2 + t.assembled!.y;
        const z = t.assembled!.z;
        // Rests on the ledge: clear where it sits, collides a little lower.
        expect(overlap(mesh, tm, x, y, z + 0.01)).toBeLessThan(1e-3);
        expect(overlap(mesh, tm, x, y, z - 0.3)).toBeGreaterThan(0.5);
        // Nothing in the way all the way up and out (through the lip and any ledges above).
        for (let zz = z + 1; zz < top; zz += 1.5) expect(overlap(mesh, tm, x, y, zz)).toBeLessThan(1e-3);
      }
    });
  }

  it('compartments stop just under the lowest tray', () => {
    const o = bin({ tray: true, heightUnits: 6, divX: 2 });
    const p = planAccessories(o, ...(Object.values(binSize(o)) as [number, number]));
    expect(p.interiorTop).toBeCloseTo(p.tray!.levels[0].z - TRAY.gap, 6);
    const mesh = buildBin(w, o);
    // The middle divider ends at the interior top; above it the cavity is open.
    expect(solidIn(mesh, -0.3, -5, p.interiorTop - 2, 0.3, 5, p.interiorTop - 0.1)).toBeGreaterThan(0.5);
    expect(solidIn(mesh, -0.3, -5, p.interiorTop + 0.05, 0.3, 5, p.infillTop + 3)).toBeLessThan(1e-6);
    // Label tabs and removable plates follow the lowered top.
    const tabbed = bin({ tray: true, heightUnits: 6, label: 'full' });
    expect(binLabelTabs(tabbed)[0].z).toBeCloseTo(p.interiorTop, 6);
    const layout = uniformLayout(2, 1);
    layout.walls[0].removable = true;
    const removable = bin({ tray: true, heightUnits: 6, layout });
    const plain = bin({ heightUnits: 6, layout });
    expect(removableInserts(removable)[0].height).toBeCloseTo(removableInserts(plain)[0].height - (p.infillTop - p.interiorTop), 3);
  });

  it('trays: two levels get smaller toward the bottom, compartments and lift tabs', () => {
    const o = bin({ tray: true, heightUnits: 8, trayCount: 2, trayHeight: 12, trayDivX: 3, trayDivY: 2 });
    const [top, low] = ofSlot(parts(o), 'tray');
    expect(low.w).toBeCloseTo(top.w - 2 * (TRAY.bearing + TRAY.clearance), 6);
    expect(top.assembled!.z - low.assembled!.z).toBeCloseTo(12, 6);
    expect(top.part).toMatchObject({ divX: 3, divY: 2 });
    // More compartments, less volume; lift tabs add some back.
    const one = check(buildAccessoryPart(w, { ...top.part, divX: 1, divY: 1 } as never)).volume;
    expect(check(buildAccessoryPart(w, top.part)).volume).toBeGreaterThan(one);
  });

  it('too short a bin gets no tray, a warning, and keeps its key', () => {
    const o = bin({ tray: true, heightUnits: 2 });
    expect(ofSlot(parts(o), 'tray')).toEqual([]);
    expect(binKey(o)).toBe(binKey(bin({ heightUnits: 2 })));
    expect(planAccessories(o, 41.5, 41.5).notes.join(' ')).toMatch(/too short/);
    // A bin with a little room gets a shorter tray, and says so.
    const short = bin({ tray: true, heightUnits: 3, trayHeight: 15 });
    const p = planAccessories(short, 41.5, 41.5);
    expect(p.tray!.h).toBeLessThan(15);
    expect(p.tray!.shortened).toBe(true);
    expect(p.notes.join(' ')).toMatch(/Only room/);
  });
});

describe('sliding lid', () => {
  const lidCases: { name: string; o: Partial<BinOptions> }[] = [
    { name: '1×1, 4u', o: { heightUnits: 4 } },
    { name: '2×1 with dividers and a label tab', o: { unitsX: 2, heightUnits: 5, divX: 2, label: 'full' } },
    { name: 'pocket grid', o: { unitsX: 2, unitsY: 2, heightUnits: 6, interior: 'pockets' } },
    { name: 'with a tray under it', o: { heightUnits: 6, tray: true, trayHeight: 10 } },
  ];
  for (const { name, o: oo } of lidCases) {
    it(`${name}: bin and lid are valid; the lid fits closed, can't lift out, clicks and slides`, () => {
      const o = bin({ lip: false, slideLid: true, ...oo });
      const { w: W, d: D } = binSize(o);
      const mesh = buildBin(w, o);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      const b = meshBounds(mesh);
      expect(b.max[0] - b.min[0]).toBeCloseTo(W, 2);
      expect(b.max[2]).toBeCloseTo(binBodyHeight(o), 2);
      const [lid] = ofSlot(parts(o), 'slidelid');
      expect(lid.kind).toBe('lid');
      const lm = buildAccessoryPart(w, lid.part);
      expect(check(lm)).toMatchObject({ status: 'NoError', components: 1 });
      const lb = meshBounds(lm);
      const box = slideLidBox(W, D);
      expect(lb.max[0] - lb.min[0]).toBeCloseTo(box.x1 - box.x0, 2);
      expect(lb.max[1] - lb.min[1]).toBeCloseTo(box.y1 - box.y0, 2);
      expect(lb.max[2] - lb.min[2]).toBeCloseTo(SLIDE_LID_HEIGHT, 2);
      const x = -W / 2 + lid.assembled!.x;
      const y = -D / 2 + lid.assembled!.y;
      const z = lid.assembled!.z;
      // Closed: no collision, lid below the top of the walls.
      expect(overlap(mesh, lm, x, y, z + 0.01)).toBeLessThan(1e-3);
      expect(z + SLIDE_LID_HEIGHT).toBeLessThan(binBodyHeight(o));
      // The grooves hold it down and in.
      expect(overlap(mesh, lm, x, y, z + SLIDE.play + 0.3)).toBeGreaterThan(0.1);
      expect(overlap(mesh, lm, x + 0.6, y, z + 0.01)).toBeGreaterThan(0.1);
      expect(overlap(mesh, lm, x, y + 0.6, z + 0.01)).toBeGreaterThan(0.1);
      // The detent: sliding out 1–2 mm runs the tooth into the bump...
      expect(overlap(mesh, lm, x, y - 1.5, z + 0.01)).toBeGreaterThan(1e-3);
      // ...past it, the bump runs in the channel and the lid slides freely out the front.
      for (const out of [6, 12, D * 0.6, D + 1]) expect(overlap(mesh, lm, x, y - out, z + 0.01)).toBeLessThan(1e-3);
    });
  }

  it('compartments stop under the lid; the front wall is cut down to the groove floor', () => {
    const o = bin({ lip: false, slideLid: true, heightUnits: 5, divX: 2 });
    const { w: W, d: D } = binSize(o);
    const p = planAccessories(o, W, D);
    expect(p.slide!.zG).toBeCloseTo(binBodyHeight(o) - SLIDE.keeper - SLIDE.play - SLIDE.thickness, 6);
    expect(p.interiorTop).toBeCloseTo(p.slide!.zG - SLIDE.drop, 6);
    const mesh = buildBin(w, o);
    expect(solidIn(mesh, -0.3, -5, p.interiorTop - 1, 0.3, 5, p.interiorTop - 0.05)).toBeGreaterThan(0.2);
    expect(solidIn(mesh, -0.3, -5, p.interiorTop + 0.05, 0.3, 5, p.slide!.zG + 3)).toBeLessThan(1e-6);
    // Front wall: open above the groove floor away from the bump, solid below.
    const bump = slideBump(W, D);
    const x0 = bump.length / 2 + 1;
    expect(solidIn(mesh, x0, -D / 2 - 1, p.slide!.zG + 0.05, x0 + 5, -D / 2 + 1, 50)).toBeLessThan(1e-6);
    expect(solidIn(mesh, x0, -D / 2, p.slide!.zG - 1, x0 + 5, -D / 2 + WALL, p.slide!.zG - 0.05)).toBeGreaterThan(1);
    // The bump stands on the sill.
    expect(solidIn(mesh, -1, bump.y - 0.3, p.slide!.zG + 0.05, 1, bump.y + 0.3, p.slide!.zG + 0.4)).toBeGreaterThan(0.1);
    // The back wall still stands to the top.
    expect(solidIn(mesh, -5, D / 2 - WALL, binBodyHeight(o) - 0.5, 5, D / 2, binBodyHeight(o))).toBeGreaterThan(1);
  });

  it('lid text is engraved when the font is loaded', () => {
    const o = bin({ lip: false, slideLid: true, heightUnits: 4 });
    const plain = check(buildAccessoryPart(w, ofSlot(parts(o), 'slidelid')[0].part)).volume;
    const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
    registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const [lid] = ofSlot(parts(bin({ lip: false, slideLid: true, heightUnits: 4, slideLidText: 'M3 SCREWS' })), 'slidelid');
    const r = check(buildAccessoryPart(w, lid.part));
    expect(r.status).toBe('NoError');
    expect(r.volume).toBeLessThan(plain - 5);
    expect(lid.meshKey).not.toBe(ofSlot(parts(o), 'slidelid')[0].meshKey);
    expect(lid.name).toContain('M3 SCREWS');
  });

  it('with the stacking lip on, nothing changes and the planner says why', () => {
    const o = bin({ slideLid: true, heightUnits: 4 });
    expect(planAccessories(o, 41.5, 41.5).notes.join(' ')).toMatch(/stacking lip off/);
    expect(binKey(o)).toBe(binKey(bin({ heightUnits: 4 })));
  });
});

/** Put a rail plate (printed lying flat) where it stands in a bin. */
const standX = (r: number, start: number, z0: number) => (m: Manifold) => m.rotate([90, 0, 0]).rotate([0, 0, 90]).translate([r - DIVIDER / 2, start, z0]);
const standY = (r: number, start: number, z0: number) => (m: Manifold) => m.rotate([90, 0, 0]).translate([start, r + DIVIDER / 2, z0]);

describe('divider rails', () => {
  it('rails sit every pitch, centered, clear of the walls and of fixed dividers', () => {
    const o = bin({ unitsX: 2, heightUnits: 5, rails: 'x' });
    expect(planAccessories(o, 83.5, 41.5).rails!.xs).toEqual([-31.5, -21, -10.5, 0, 10.5, 21, 31.5]);
    const split = planAccessories(bin({ unitsX: 2, heightUnits: 5, rails: 'x', divX: 2 }), 83.5, 41.5).rails!;
    expect(split.xs).toEqual([-31.5, -21, -10.5, 10.5, 21, 31.5]);
    expect(split.skipped).toBe(1);
    const y = planAccessories(bin({ heightUnits: 5, rails: 'y', railPitch: 8 }), 41.5, 41.5).rails!;
    expect(y.ys).toEqual([-8, 0, 8]);
    expect(y.xs).toEqual([]);
    // Plates clear the lip's overhang by the removable-divider clearance; ribs reach 2 mm past.
    expect(y.endGap).toBeCloseTo(LIP_DEPTH - WALL + 0.25, 6);
    expect(y.ribDepth).toBeCloseTo(y.endGap + 2, 6);
    // Fixed dividers across the plates' path are counted (they get slots).
    expect(planAccessories(bin({ unitsX: 2, heightUnits: 5, rails: 'x', divY: 2 }), 83.5, 41.5).rails!.crossed).toBe(1);
  });

  it('ribs on both walls guide each plate; the plate stands in its slot and slides in from above', () => {
    const o = bin({ unitsX: 2, heightUnits: 5, rails: 'x', divY: 2, label: 'full', scoop: 0.5 });
    const { w: W, d: D } = binSize(o);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    const p = planAccessories(o, W, D);
    const R = p.rails!;
    const fy = D / 2 - WALL;
    const r = R.xs[2];
    const half = RAIL_SLOT / 2;
    // A rib beside the slot at both walls, nothing in the slot where the plate's end goes.
    for (const yy of [-fy + R.endGap, fy - R.endGap - 1]) {
      expect(solidIn(mesh, r + half + 0.1, yy, p.zFloor + 3, r + half + 0.7, yy + 1, p.zFloor + 6)).toBeGreaterThan(0.5);
      expect(solidIn(mesh, r - half + 0.05, yy, p.zFloor + 0.1, r + half - 0.05, yy + 1, p.interiorTop)).toBeLessThan(1e-6);
    }
    // The plate: sized to the span and the height, from the groove to the top of the compartments.
    const plates = ofSlot(parts(o), 'rail');
    expect(plates.length).toBe(o.railPlates);
    const pl = plates[0].part as RailPlatePart;
    expect(pl.length).toBeCloseTo(D - 2 * WALL - 2 * R.endGap, 3);
    expect(pl.height).toBeCloseTo(p.interiorTop - p.zFloor + R.groove, 3);
    expect(pl.slots).toEqual([]);
    const pm = buildAccessoryPart(w, pl);
    expect(check(pm)).toMatchObject({ status: 'NoError', components: 1 });
    const start = -fy + R.endGap;
    // Through the label tab, the scoop and the crossing divider: nothing in the way, top to bottom.
    for (const dz of [0.01, 3, 8, 20]) expect(overlap(mesh, pm, 0, 0, dz, standX(r, start, R.z0))).toBeLessThan(1e-3);
    // Pushed sideways it hits a rib.
    expect(overlap(mesh, pm, 0.5, 0, 0.01, standX(r, start, R.z0))).toBeGreaterThan(0.05);
    // Lowered it hits the floor.
    expect(overlap(mesh, pm, 0, 0, -0.3, standX(r, start, R.z0))).toBeGreaterThan(0.05);
  });

  it('rails both ways make an egg-crate: slotted plates cross without touching', () => {
    const o = bin({ heightUnits: 6, rails: 'xy', railPlates: 1 });
    const { w: W, d: D } = binSize(o);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    const p = planAccessories(o, W, D);
    const R = p.rails!;
    expect(R.xs.length).toBeGreaterThan(0);
    expect(R.ys.length).toBeGreaterThan(0);
    const ps = ofSlot(parts(o), 'rail');
    const px = ps.find((q) => q.index.startsWith('x'))!.part as RailPlatePart;
    const py = ps.find((q) => q.index.startsWith('y'))!.part as RailPlatePart;
    expect(px.slotsFrom).toBe('top');
    expect(py.slotsFrom).toBe('bottom');
    expect(px.slots.length).toBe(R.ys.length);
    expect(py.slots.length).toBe(R.xs.length);
    const mx = buildAccessoryPart(w, px);
    const my = buildAccessoryPart(w, py);
    const sx = -(D / 2 - WALL) + R.endGap;
    const sy = -(W / 2 - WALL) + R.endGap;
    // Each fits the bin.
    expect(overlap(mesh, mx, 0, 0, 0.01, standX(R.xs[0], sx, R.z0))).toBeLessThan(1e-3);
    expect(overlap(mesh, my, 0, 0, 0.01, standY(R.ys[0], sy, R.z0))).toBeLessThan(1e-3);
    // Together: stand both, then intersect.
    const a = standX(R.xs[0], sx, R.z0)(toManifold(mx));
    const b = standY(R.ys[0], sy, R.z0)(toManifold(my));
    const both = a.intersect(b);
    expect(both.volume()).toBeLessThan(1e-3);
    [a, b, both].forEach((m) => m.delete());
  });

  it('under trays and a sliding lid, every plate drops in past the ledges and bands', () => {
    const o = bin({ heightUnits: 8, lip: false, slideLid: true, tray: true, trayCount: 3, trayHeight: 12, rails: 'x', railPitch: 6, railPlates: 1 });
    const { w: W, d: D } = binSize(o);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    const R = planAccessories(o, W, D).rails!;
    const pm = buildAccessoryPart(w, ofSlot(parts(o), 'rail')[0].part);
    const start = -(D / 2 - WALL) + R.endGap;
    for (const r of [R.xs[0], R.xs[R.xs.length - 1]]) {
      for (const dz of [0.01, 4, 12, 30, 60]) expect(overlap(mesh, pm, 0, 0, dz, standX(r, start, R.z0))).toBeLessThan(1e-3);
    }
  });

  it('a rail through a label tab leaves one solid (the cut-off front of the tab goes)', () => {
    const o = bin({ heightUnits: 5, rails: 'y', label: 'full', divY: 2 });
    expect(check(buildBin(w, o))).toMatchObject({ status: 'NoError', components: 1 });
  });

  it('a hollow base keeps its full floor under rails (like removable dividers)', () => {
    const lite = check(buildBin(w, bin({ heightUnits: 4, base: 'lite', rails: 'x' })));
    const solid = check(buildBin(w, bin({ heightUnits: 4, rails: 'x' })));
    expect(lite.status).toBe('NoError');
    expect(lite.volume).toBeCloseTo(solid.volume, 3);
    expect(check(buildBin(w, bin({ heightUnits: 4, base: 'lite' }))).volume).toBeLessThan(solid.volume - 1000);
  });
});

describe('planning', () => {
  const layoutBins: PlacedBin[] = [
    { id: 'a', x: 0, y: 0, opts: bin({ heightUnits: 8, tray: true, trayCount: 2, trayHeight: 12 }) },
    { id: 'b', x: 1, y: 0, opts: bin({ heightUnits: 4, lip: false, slideLid: true }) },
    { id: 'c', x: 2, y: 0, opts: bin({ heightUnits: 5, rails: 'xy', railPlates: 2 }) },
    { id: 'd', x: 3, y: 0, opts: bin({ heightUnits: 2, tray: true }) },
  ];
  const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 1 }, bins: layoutBins });

  it('plans trays, sliding lids and rail plates as print parts with the bins', () => {
    const keys = Object.keys(job.parts).filter((k) => /^(tray|slidelid|rail):/.test(k)).sort();
    expect(keys).toEqual(['rail:c:x0', 'rail:c:x1', 'rail:c:y0', 'rail:c:y1', 'slidelid:b:0', 'tray:a:0', 'tray:a:1']);
    expect(job.parts['tray:a:0'].kind).toBe('tray');
    expect(job.parts['slidelid:b:0'].kind).toBe('lid');
    expect(job.parts['rail:c:x0'].kind).toBe('divider');
    // Identical plates share a mesh; the two directions differ.
    expect(job.parts['rail:c:x0'].meshKey).toBe(job.parts['rail:c:x1'].meshKey);
    expect(job.parts['rail:c:x0'].meshKey).not.toBe(job.parts['rail:c:y0'].meshKey);
    const placed = job.plates.flatMap((p) => p.placements.map((q) => q.key));
    expect(placed).toEqual(expect.arrayContaining(keys));
    // The too-short tray is a warning, not a part.
    expect(job.warnings.join(' ')).toMatch(/too short/);
  });

  it('every accessory mesh builds to its planned size', () => {
    for (const k of Object.keys(job.parts).filter((key) => /^(tray|slidelid|rail):/.test(key))) {
      const part = job.parts[k];
      const spec = job.meshes[part.meshKey] as Extract<MeshSpec, { kind: 'accessory' }>;
      expect(spec.kind).toBe('accessory');
      const m = buildMesh(w, spec);
      const b = meshBounds(m);
      expect(b.min[0]).toBeCloseTo(0, 3);
      expect(b.min[1]).toBeCloseTo(0, 3);
      expect(b.min[2]).toBeCloseTo(0, 3);
      expect(b.max[0]).toBeCloseTo(part.w, 2);
      expect(b.max[1]).toBeCloseTo(part.d, 2);
      expect(b.max[2]).toBeCloseTo(part.h, 2);
    }
  });

  it('the BOM counts trays, sliding lids and rail plates', () => {
    const bom = billOfMaterials(job);
    expect(bom.parts).toMatchObject({ bins: 4, trays: 2, lids: 1, dividers: 4, keys: 0 });
    expect(bomText(bom)).toContain('2 trays');
  });

  it('trays and the sliding lid know where they sit in their bin', () => {
    const a = assembledParts(job, 'a');
    expect(a.map((p) => p.key)).toEqual(['tray:a:0', 'tray:a:1']);
    const o = layoutBins[0].opts;
    const H = binBodyHeight(o);
    expect(a[0].assembled.z + a[0].h).toBeCloseTo(H - LIP_SUPPORT_HEIGHT, 3);
    const [lid] = assembledParts(job, 'b');
    expect(lid.key).toBe('slidelid:b:0');
    expect(lid.assembled.y).toBe(0);
    expect(assembledParts(job, 'c')).toEqual([]);
  });

  it('old projects plan exactly the same parts', () => {
    const old = planJob({ ...DEFAULT_PROJECT, bins: [{ id: 'x', x: 0, y: 0, opts: bin({ heightUnits: 5, divX: 2 }) }] });
    expect(Object.keys(old.parts).filter((k) => !k.startsWith('piece:'))).toEqual(['bin:x']);
    expect(old.parts['bin:x'].meshKey).toBe('bin|1-1-5-L-none-2-1-0-none-F');
  });
});
