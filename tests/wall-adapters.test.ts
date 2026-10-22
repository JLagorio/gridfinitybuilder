import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec2, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentLayout, type AttachmentPart, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { mountBox, partBounds, printedSize, siteAt, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { RECEIVER_HEADS, RECEIVER_PLATE, receiverPlan, type ReceiverOptions } from '../src/lib/wall/kinds/receiver';
import { OPENCONNECT, ROUND_HEADS, receiverCheck } from '../src/lib/wall/kinds/receiver.geom';
import { PEG, type PegboardBridgeOptions } from '../src/lib/wall/kinds/pegboardBridge';
import { pegHoles } from '../src/lib/wall/kinds/pegboardBridge.geom';
import { HANGER, cleatProfile, type CleatStripOptions } from '../src/lib/wall/kinds/cleatStrip';
import { DIN, type DinRailOptions } from '../src/lib/wall/kinds/dinRail';
import { BOSS_BACK, bossPlan, type MountBossOptions } from '../src/lib/wall/kinds/mountBoss';
import { ARCA, BOSS_BOLTS, GOPRO, SHOE } from '../src/lib/wall/kinds/mountBoss.geom';
import { HOLE_PATTERNS, PI_STANDOFF, PLATE_SCREWS, patternHoles, type PlateOptions } from '../src/lib/wall/kinds/plate';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

// Every Manifold a test makes, freed after it.
let live: Manifold[] = [];
const keep = (m: Manifold) => (live.push(m), m);
afterEach(() => {
  const all = new Set(live);
  live = [];
  for (const m of all) m.delete();
});

const toManifold = (mesh: MeshData) => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  keep(keep(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();
const moved = (m: Manifold, v: Vec3) => keep(m.translate(v));
const union = (ms: Manifold[]) => keep(w.Manifold.union(ms));
/** A polygon in (x, y) extruded from z0 to z1. */
const prismZ = (pts: Vec2[], z0: number, z1: number) => keep(keep(w.Manifold.extrude([ccw(pts)], z1 - z0)).translate([0, 0, z0]));
/** A polygon in (x, z) extruded from y0 to y1. */
const prismY = (pts: Vec2[], y0: number, y1: number) =>
  keep(keep(keep(w.Manifold.extrude([ccw(pts.map(([x, z]) => [x, -z] as Vec2))], y1 - y0)).rotate([-90, 0, 0])).translate([0, y0, 0]));
function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  return a >= 0 ? pts : [...pts].reverse();
}
const hull = (pts: Vec3[]) => keep(w.Manifold.hull(pts));
/** A round bar along z (axis at x, y), along x (axis at y, z). */
const barZ = (z0: number, z1: number, r: number, x: number, y: number, n = 48) => keep(keep(w.Manifold.cylinder(z1 - z0, r, r, n)).translate([x, y, z0]));
const barX = (x0: number, x1: number, r: number, y: number, z: number) =>
  keep(keep(keep(w.Manifold.cylinder(x1 - x0, r, r, 48)).rotate([0, 90, 0])).translate([x0, y, z]));

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

/** Build a kind with options and turn it back into its own frame. */
function build(type: string, opts: object = {}): Built {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  const turned = keep(toManifold(mesh).rotate(viewTurn(layout.pose)));
  const bb = turned.boundingBox();
  const pb = partBounds(layout, CTX);
  const hung = keep(turned.translate([pb.x0 - bb.min[0], pb.y0 - bb.min[1], pb.z0 - bb.min[2]]));
  return { o, layout, mesh, hung };
}

/** No errors, no overhangs (everything self-supporting as printed), and as big as planned. */
function expectClean(b: Built, what: string) {
  const c = checkPart(w, b.mesh);
  expect(
    c.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang'),
    what,
  ).toEqual([]);
  const mb = meshBounds(b.mesh);
  const want = printedSize(b.layout, CTX);
  expect(mb.max[0] - mb.min[0], what).toBeCloseTo(want.w, 1);
  expect(mb.max[1] - mb.min[1], what).toBeCloseTo(want.d, 1);
  expect(mb.max[2] - mb.min[2], what).toBeCloseTo(want.h, 1);
}

/** Every preset of a kind's form, as options. */
const presets = (type: string) => attachmentUi(type)!.fields.flatMap((f) => (f.kind === 'preset' ? f.presets.map((p) => ({ name: p.value, set: p.set })) : []));

/** An extra part where it sits, in the attachment's frame. */
function placed(type: string, p: AttachmentPart): Manifold {
  const mesh = buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
  expect(
    checkPart(w, mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang'),
    p.key,
  ).toEqual([]);
  const mb = meshBounds(mesh);
  expect(mb.max[0] - mb.min[0]).toBeCloseTo(p.w, 1);
  expect(mb.max[1] - mb.min[1]).toBeCloseTo(p.d, 1);
  expect(mb.max[2] - mb.min[2]).toBeCloseTo(p.h, 1);
  const r = keep(toManifold(mesh).rotate(p.place!.turn));
  const b = r.boundingBox();
  return moved(r, [p.place!.at[0] - b.min[0], p.place!.at[1] - b.min[1], p.place!.at[2] - b.min[2]]);
}

describe('other systems’ accessories (receiver)', () => {
  it('builds clean for every system and preset, as big as planned', () => {
    const sets: object[] = [
      {},
      { system: 'openconnect', pitch: 28, columns: 3, rows: 2 },
      { system: 'multipoint', columns: 1, height: 40 },
      { system: 'multiconnect', pitch: 28, columns: 4, rows: 2 },
      ...presets('receiver').map((p) => p.set),
    ];
    for (const s of sets) {
      const b = build('receiver', s);
      expectClean(b, JSON.stringify(s));
      expect(b.layout.pose).toBe('upright');
      // Two columns of clips at least, studs below on a plate tall enough for them.
      expect(b.layout.mounts.filter((m) => m.kind === 'clip').length, JSON.stringify(s)).toBeGreaterThanOrEqual(2);
      expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(b.layout.h >= 56);
    }
    expect(presets('receiver')).toHaveLength(4);
  });

  it('puts its heads on the system’s own grid, standing out as far as planned', () => {
    for (const [system, pitch] of [
      ['multiconnect', 25],
      ['openconnect', 28],
      ['multipoint', 25],
    ] as const) {
      const o = attachmentDef('receiver')!.sanitize({ system, pitch, columns: 3, rows: 2 }) as ReceiverOptions;
      const p = receiverPlan(o, CTX);
      expect(p.heads).toHaveLength(6);
      expect(p.heads[1][0] - p.heads[0][0]).toBeCloseTo(pitch, 9);
      expect(p.heads[0][1] - p.heads[3][1]).toBeCloseTo(pitch, 9);
      // Inside the plate.
      for (const [x, y] of p.heads) {
        expect(x - RECEIVER_HEADS[system].side).toBeGreaterThan(0);
        expect(x + RECEIVER_HEADS[system].side).toBeLessThan(p.w);
        expect(y - RECEIVER_HEADS[system].down).toBeGreaterThan(0);
        expect(y + RECEIVER_HEADS[system].up).toBeLessThan(p.h);
      }
      expect(attachmentDef('receiver')!.layout(o, CTX).depth).toBeCloseTo(RECEIVER_PLATE + receiverCheck[system], 9);
      expect(RECEIVER_HEADS[system].out).toBeCloseTo(receiverCheck[system], 9);
    }
    // Multiconnect's connector: ⌀20, a ⌀15 neck, 4 mm out.
    expect(ROUND_HEADS.multiconnect.r * 2).toBe(20);
    expect((ROUND_HEADS.multiconnect.r - ROUND_HEADS.multiconnect.flare) * 2).toBe(15);
  });

  /**
   * An accessory's Multiconnect (or Multipoint) slot, from the published profile with its 0.15 mm offset: a
   * rim, a 45° flare in to the neck, the neck (radius, lengths, out from the slot's floor), round at the top
   * (centred on the head when it is on), open below.
   */
  function roundSlotAccessory(r: number, d1: number, d2: number, d3: number, x: number, y: number, T: number): Manifold {
    const off = 0.15;
    const s45 = Math.SQRT1_2 * off * 2;
    const prof: Vec2[] = [
      [0, 0],
      [r + off, 0],
      [r + off, d1 + s45],
      [r - d2 + off, d2 + d1 + s45],
      [r - d2 + off, d1 + d2 + d3 + off + 1],
      [0, d1 + d2 + d3 + off + 1],
    ];
    const D = d1 + d2 + d3 + off;
    // The round end (revolved: profile x → radius, y → z), turned so its floor is D out from the plate's face.
    const end = keep(keep(keep(w.Manifold.revolve([prof], 96)).mirror([0, 0, 1])).translate([x, y, T + D]));
    const half = prof.slice(1, 5).map(([px, py]) => [px, T + D - py] as Vec2);
    const channel = prismY([...half.map(([px, z]) => [x + px, z] as Vec2), ...[...half].reverse().map(([px, z]) => [x - px, z] as Vec2)], y - 60, y);
    return keep(box(x - 16, y - 50, T, x + 16, y + 16, T + 8).subtract(union([end, channel])));
  }

  it('a Multiconnect accessory slides down over a head: clear when on, held when pulled off or pushed down', () => {
    for (const system of ['multiconnect', 'multipoint'] as const) {
      const b = build('receiver', { system, columns: 1 });
      const [x, y] = receiverPlan(b.o as ReceiverOptions, CTX).heads[0];
      const { r, rim, flare, neck } = ROUND_HEADS[system];
      const acc = roundSlotAccessory(r, rim, flare, neck, x, y, RECEIVER_PLATE);
      expect(overlap(b.hung, acc), system).toBeLessThan(0.02);
      // Pulled straight out, the dovetail holds it; pushed down, the top of the slot stops on the head.
      expect(overlap(b.hung, moved(acc, [0, 0, 1])), system).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(acc, [0, -1, 0])), system).toBeGreaterThan(0.5);
      // Lifted, it slides off up the slot.
      expect(overlap(b.hung, moved(acc, [0, 30, 0])), system).toBeLessThan(0.02);
    }
  });

  it('an openConnect accessory drops onto a head: clear when on (its nubs in the notches), held when pulled off', () => {
    const b = build('receiver', { system: 'openconnect', pitch: 28, columns: 1 });
    const [x, y] = receiverPlan(b.o as ReceiverOptions, CTX).heads[0];
    const T = RECEIVER_PLATE;
    // The published slot: the head 0.1 mm bigger all round (its bottom too), 0.1 deeper; open below for the 10.6 mm drop.
    const c = 0.1;
    const t22 = Math.tan(Math.PI / 8) * c;
    const outline = (inset: number): Vec2[] => {
      const h = 8.5 - inset;
      const t = 8.9 - inset;
      const k = 13.4 - inset * Math.SQRT2;
      return [
        [x - h, y - 1.7 - c],
        [x + h, y - 1.7 - c],
        [x + h, y + k - h],
        [x + k - t, y + t],
        [x - (k - t), y + t],
        [x - h, y + k - h],
      ];
    };
    const small = outline(1.4 - c);
    const large = outline(-c);
    const z1 = T + 0.6 - t22;
    const z2 = z1 + 1.4;
    const z3 = T + 2.6 + c;
    const swept = (pts: Vec2[], za: number, zb: number) =>
      hull([...pts.flatMap(([px, py]) => [[px, py, za] as Vec3, [px, py, zb] as Vec3, [px, py - 12, za] as Vec3, [px, py - 12, zb] as Vec3])]);
    const flare = hull([small, large].flatMap((pts, k) => pts.flatMap(([px, py]) => [[px, py, k ? z2 : z1] as Vec3, [px, py - 12, k ? z2 : z1] as Vec3])));
    const slot = union([swept(small, T - 1, z1 + 0.01), flare, swept(large, z2 - 0.01, z3)]);
    // The nubs: 0.6 mm in from the slot's sides, 1.2 wide at their tips, 7.2 below the head's top, in the large part.
    const yn = y + 8.9 - 7.2;
    const nubs = [-1, 1].map((d) =>
      prismZ(
        [
          [x + d * (8.5 + c + 0.01), yn - 1.21],
          [x + d * (8.5 + c - 0.6), yn - 0.6],
          [x + d * (8.5 + c - 0.6), yn + 0.6],
          [x + d * (8.5 + c + 0.01), yn + 1.21],
        ],
        z2,
        z3,
      ),
    );
    const acc = keep(
      box(x - 14, y - 30, T, x + 14, y + 14, T + 6)
        .subtract(slot)
        .add(union(nubs)),
    );
    expect(overlap(b.hung, acc)).toBeLessThan(0.02);
    expect(overlap(b.hung, moved(acc, [0, 0, 1]))).toBeGreaterThan(1);
    expect(overlap(b.hung, moved(acc, [0, -0.5, 0]))).toBeGreaterThan(0.5);
    // Pushed on 10.6 mm higher, then dropped: clear all the way down (the nubs ride over the head's sides).
    const noNubs = keep(box(x - 14, y - 30, T, x + 14, y + 14, T + 6).subtract(slot));
    for (const up of [10.6, 5, 0]) expect(overlap(b.hung, moved(noNubs, [0, up, 0]))).toBeLessThan(0.02);
    expect(OPENCONNECT.root + OPENCONNECT.flare + OPENCONNECT.face).toBeCloseTo(2.6, 9);
  });

  it('names itself and cleans its options', () => {
    const def = attachmentDef('receiver')!;
    expect(def.summary(def.sanitize({}))).toBe('Multiconnect plate 2 × 1');
    expect(def.summary(def.sanitize({ system: 'openconnect', columns: 3, rows: 2 }))).toBe('openConnect plate 3 × 2');
    expect(def.sanitize({ system: 'gridfinity', columns: 20, rows: 0, pitch: 5 })).toMatchObject({ system: 'multiconnect', columns: 8, rows: 1, pitch: 20 });
    expect(def.notes?.(def.sanitize({}), CTX) ?? []).toEqual([]);
    expect(def.hardware?.(def.sanitize({})) ?? []).toEqual([]);
    expect(attachmentUi('receiver')?.group).toBe('adapters');
  });
});

describe('1″ pegboard plate', () => {
  it('builds clean, as big as planned, its holes on a 1″ grid', () => {
    for (const s of [{}, { columns: 2, rows: 1, cavity: 6 }, { columns: 6, rows: 5, cavity: 14 }]) {
      const b = build('pegboardBridge', s);
      expectClean(b, JSON.stringify(s));
      const o = b.o as PegboardBridgeOptions;
      expect(b.layout).toMatchObject({ w: o.columns * 25.4, h: (o.rows + 0.5) * 25.4, depth: PEG.back + o.cavity + PEG.face, pose: 'upright' });
      expect(b.layout.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(2);
      const holes = pegHoles(o);
      expect(holes).toHaveLength(o.columns * o.rows);
      expect(holes[1][0] - holes[0][0]).toBeCloseTo(25.4, 9);
    }
    // The face is no thicker than 1/4″ board, so hooks made for it go in; the holes take a 1/4″ peg.
    expect(PEG.face).toBeLessThanOrEqual(6.35);
    expect(PEG.hole).toBeGreaterThanOrEqual(6.5);
    expect(PEG.hole).toBeLessThanOrEqual(7);
  });

  it('takes a 1/4″ pin in every hole, and a hook’s L tail behind the face', () => {
    const b = build('pegboardBridge', { columns: 3, rows: 2 });
    const o = b.o as PegboardBridgeOptions;
    const D = b.layout.depth;
    const zf = PEG.back + o.cavity;
    for (const [x, y] of pegHoles(o)) expect(overlap(b.hung, barZ(zf - 1, D + 1, 6.35 / 2, x, y)), `${x},${y}`).toBeLessThan(0.02);
    // A hook of 4.8 mm wire: through the hole resting on its bottom, bent up behind the face, a 15 mm tail.
    const r = 2.4;
    const [x, y] = pegHoles(o)[o.columns + 1];
    const yw = y - PEG.hole / 2 + r + 0.05;
    const zt = zf - r - 0.3;
    const hook = union([barZ(zt, D + 20, r, x, yw), keep(keep(keep(w.Manifold.cylinder(15, r, r, 48)).rotate([-90, 0, 0])).translate([x, yw, zt]))]);
    expect(overlap(b.hung, hook)).toBeLessThan(0.05);
    // The tail clears the back plate.
    expect(zt - r).toBeGreaterThan(PEG.back);
    // And the hook can't go deeper: pushed in, the bend hits the face.
    expect(overlap(b.hung, moved(hook, [0, 0, 1.5]))).toBeGreaterThan(1);
  });

  it('says when the cavity is too shallow for hooks’ tails', () => {
    const def = attachmentDef('pegboardBridge')!;
    expect(def.notes!(def.sanitize({ cavity: 4 }), CTX).join()).toMatch(/6 mm/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('1″ pegboard 4 × 3');
    expect(def.sanitize({ columns: 1 })).toMatchObject({ columns: 2 });
  });
});

describe('French cleat strip', () => {
  it('builds clean with every preset, the bevel at its angle', () => {
    for (const s of [
      {},
      { length: 60, size: 12, height: 30 },
      { length: 250, size: 25, height: 100, angle: 30, hanger: true },
      ...presets('cleatStrip').map((p) => p.set),
    ]) {
      const b = build('cleatStrip', s);
      expectClean(b, JSON.stringify(s));
      const o = b.o as CleatStripOptions;
      const p = cleatProfile(o, CTX);
      expect(b.layout).toMatchObject({ w: o.length, depth: o.size, pose: 'upright' });
      expect(b.layout.h).toBeCloseTo(p.hb + (o.size - 1) * Math.tan((o.angle * Math.PI) / 180), 9);
      // The mounts stay on the back under the bevel.
      for (const m of b.layout.mounts) expect(mountBox(m.kind, siteAt(b.layout, m, CTX), CTX).y1).toBeLessThan(p.hb);
    }
    // A strip with a 60 mm back takes a row of studs.
    expect(build('cleatStrip').layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
  });

  it('a holder’s cleat (the hanger) drops into the groove: clear on the bevel, and it can’t come off forward', () => {
    for (const s of [{ hanger: true }, { hanger: true, size: 12, height: 30, length: 60 }, { hanger: true, angle: 30 }]) {
      const b = build('cleatStrip', s);
      const def = attachmentDef('cleatStrip')!;
      const parts = def.parts!(b.o, CTX);
      expect(parts.map((p) => p.key)).toEqual(['hanger']);
      const h = placed('cleatStrip', parts[0]);
      const what = JSON.stringify(s);
      expect(overlap(b.hung, h), what).toBeLessThan(0.05);
      // 0.3 mm clear of the bevel (square to it): it can drop that far before it bears.
      const o = b.o as CleatStripOptions;
      const drop = (HANGER.gap - 0.05) / Math.cos((o.angle * Math.PI) / 180);
      expect(overlap(b.hung, moved(h, [0, -drop, 0])), what).toBeLessThan(0.05);
      // Down, it bears on the bevel; out from the board without lifting, its cleat hits the strip's.
      expect(overlap(b.hung, moved(h, [0, -0.5, 0])), what).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(h, [0, 0, 1])), what).toBeGreaterThan(1);
      // Lifted over the strip's top, it comes off.
      expect(overlap(b.hung, moved(h, [0, HANGER.above + 25, 2])), what).toBeLessThan(0.05);
      // Its back is on the board, its plate in front of the strip.
      expect(h.boundingBox().min[2]).toBeCloseTo(0, 3);
    }
    expect(attachmentDef('cleatStrip')!.parts!(attachmentDef('cleatStrip')!.sanitize({}), CTX)).toEqual([]);
  });

  it('lists the hanger’s screws and says when it’s long', () => {
    const def = attachmentDef('cleatStrip')!;
    expect(def.hardware!(def.sanitize({ hanger: true }))).toEqual([{ item: 'Screws M4 (cleat hanger)', count: 2, note: 'to fix your holder to it' }]);
    expect(def.hardware!(def.sanitize({}))).toEqual([]);
    expect(def.notes!(def.sanitize({ length: 300 }), CTX).join()).toMatch(/250 mm/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('French cleat 150 mm');
    expect(def.sanitize({ angle: 60 })).toMatchObject({ angle: 45 });
  });
});

describe('DIN rail', () => {
  /** A module's foot: its back on the flanges' front, a hook behind the top flange and a latch behind the bottom one, 1.5 mm in, 0.2 clear. */
  function moduleFoot(b: Built, x0: number): Manifold {
    const o = b.o as DinRailOptions;
    const yc = b.layout.h / 2;
    const z1 = DIN.plate + +o.depth;
    const tip = DIN.width / 2;
    const parts = [box(x0, yc - 22.5, z1, x0 + 18, yc + 22.5, z1 + 40)];
    for (const d of [-1, 1]) {
      const ya = yc + d * (tip + 0.2);
      const yb = yc + d * (tip + 2);
      const yl = yc + d * (tip - 1.5);
      const zb = z1 - DIN.flange - 0.2;
      parts.push(box(x0, Math.min(ya, yb), zb - 1, x0 + 18, Math.max(ya, yb), z1 + 0.01), box(x0, Math.min(yl, yb), zb - 1, x0 + 18, Math.max(yl, yb), zb));
    }
    return union(parts);
  }

  it('builds clean on its side, the rail standing up from the bed', () => {
    for (const s of [{}, { depth: '15', length: 60, stops: false }, { length: 200 }]) {
      const b = build('dinRail', s);
      expectClean(b, JSON.stringify(s));
      expect(b.layout.pose).toBe('side');
      // A hook at the left, studs further along.
      expect(b.layout.mounts.filter((m) => m.kind === 'hook')).toHaveLength(1);
      expect(b.layout.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is a TS35 rail: 35 mm over 1.5 mm flanges, 7.5 or 15 mm out', () => {
    for (const depth of ['7.5', '15'] as const) {
      const b = build('dinRail', { depth, stops: false });
      const yc = b.layout.h / 2;
      const z1 = DIN.plate + +depth;
      // Across the flanges at x = 50: 35 mm over their tips, the hat open between the walls (27 mm over them, 2 thick).
      const front = keep(b.hung.intersect(box(49.5, yc - 30, DIN.plate + +depth - DIN.flange + 0.05, 50.5, yc + 30, z1 - 0.05)));
      expect(front.boundingBox().max[1] - front.boundingBox().min[1]).toBeCloseTo(DIN.width, 3);
      expect(front.volume()).toBeCloseTo(2 * (DIN.width - DIN.hat + 2 * DIN.wall) * 0.5 * (DIN.flange - 0.1), 2);
      // 1.5 thick: solid through, free behind (where a module's hook goes) and in front.
      expect(overlap(b.hung, box(49.5, yc + 14, z1 - DIN.flange + 0.05, 50.5, yc + 17, z1 - 0.05))).toBeCloseTo(3 * (DIN.flange - 0.1), 2);
      expect(overlap(b.hung, box(49.5, yc + 14, DIN.plate + 0.05, 50.5, yc + 17, z1 - DIN.flange - 0.05))).toBeLessThan(0.01);
      expect(overlap(b.hung, box(49.5, yc - 30, z1 + 0.05, 50.5, yc + 30, z1 + 2))).toBeLessThan(0.01);
      expect(b.layout.depth).toBeCloseTo(DIN.plate + +depth, 9);
    }
  });

  it('a module clips on: clear when on, held when pulled off, stopped by the end stops', () => {
    for (const depth of ['7.5', '15'] as const) {
      const b = build('dinRail', { depth });
      const foot = moduleFoot(b, 40);
      expect(overlap(b.hung, foot), depth).toBeLessThan(0.02);
      expect(overlap(b.hung, moved(foot, [0, 0, 0.5])), depth).toBeGreaterThan(1);
      // Slid along to an end, it stops at the ramp's foot.
      const S = DIN.stop + DIN.ramp;
      expect(overlap(b.hung, moduleFoot(b, S + 0.1)), depth).toBeLessThan(0.02);
      expect(overlap(b.hung, moduleFoot(b, S - 2)), depth).toBeGreaterThan(1);
      expect(overlap(b.hung, moduleFoot(b, b.layout.w - S - 18 - 2 + 4)), depth).toBeGreaterThan(1);
    }
  });

  it('names itself and says when it prints tall', () => {
    const def = attachmentDef('dinRail')!;
    expect(def.summary(def.sanitize({}))).toBe('DIN rail 100 mm');
    expect(def.summary(def.sanitize({ depth: 15, length: 150 }))).toBe('DIN rail 150 mm, 15 deep');
    expect(def.notes!(def.sanitize({ length: 240 }), CTX).join()).toMatch(/240 mm tall/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.hardware?.(def.sanitize({})) ?? []).toEqual([]);
  });
});

describe('device mount', () => {
  /** Platform frame → the mount's frame: tilt about x, then out to the arm's end. */
  function platform(b: Built, m: Manifold): Manifold {
    const o = b.o as MountBossOptions;
    const p = bossPlan(o);
    return moved(keep(m.rotate([o.tilt, 0, 0])), [b.layout.w / 2, p.y0, p.zc]);
  }

  it('builds clean with every fixing, tilt and preset, as big as planned', () => {
    const sets: object[] = [
      {},
      { fixing: '3/8-16', tilt: 30, reach: 80 },
      { fixing: '5/8-27', tilt: 45, reach: 20 },
      { fixing: 'gopro', fingers: 2, tilt: 45, reach: 90 },
      { fixing: 'gopro', tilt: 10 },
      { fixing: 'arca', tilt: 30 },
      { fixing: 'coldshoe', tilt: 15, height: 100 },
      ...presets('mountBoss').map((p) => p.set),
    ];
    for (const s of sets) {
      const b = build('mountBoss', s);
      expectClean(b, JSON.stringify(s));
      expect(b.layout.pose).toBe('upright');
      expect(b.layout.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(2);
      expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
      // Its arm reaches the platform: one piece (checkPart counts loose pieces as errors), out to the fixing.
      expect(b.layout.depth).toBeGreaterThanOrEqual((b.o as MountBossOptions).reach);
    }
    expect(presets('mountBoss')).toHaveLength(6);
  });

  it('a hex bolt’s head sits in the platform, its thread up as the stud; it can’t turn', () => {
    for (const [fixing, af, head, shank, len] of [
      ['1/4-20', 11.11, 4.4, 6.35, 9.53],
      ['3/8-16', 14.29, 6, 9.53, 12.7],
    ] as const) {
      for (const tilt of [0, 25]) {
        const b = build('mountBoss', { fixing, tilt });
        const { pocket } = BOSS_BOLTS[fixing];
        const bh = bossPlan(b.o as MountBossOptions).bh;
        const hex = (a: number, turn = 0): Vec2[] =>
          Array.from(
            { length: 6 },
            (_, k) => [(a / Math.sqrt(3)) * Math.cos((k * Math.PI) / 3 + turn), (a / Math.sqrt(3)) * Math.sin((k * Math.PI) / 3 + turn)] as Vec2,
          );
        const boltAt = (turn: number) =>
          platform(
            b,
            union([
              prismY(hex(af, turn), pocket - head, pocket),
              keep(keep(keep(w.Manifold.cylinder(len, shank / 2, shank / 2, 48)).rotate([-90, 0, 0])).translate([0, pocket, 0])),
            ]),
          );
        const what = `${fixing} ${tilt}`;
        expect(overlap(b.hung, boltAt(0)), what).toBeLessThan(0.02);
        expect(overlap(b.hung, boltAt(0.2)), what).toBeGreaterThan(0.5);
        // The stud stands 5–8 mm above the platform: what camera and ball-head sockets take.
        expect(pocket + len - bh, what).toBeGreaterThan(5);
        expect(pocket + len - bh, what).toBeLessThan(8);
        // A nut fits the same hexagon (7/32″ or 21/64″ thick).
        expect(pocket).toBeGreaterThan(fixing === '1/4-20' ? 5.56 : 8.33);
      }
    }
  });

  it('GoPro fingers take the other side’s fingers and an M5 bolt', () => {
    for (const fingers of [3, 2]) {
      const b = build('mountBoss', { fixing: 'gopro', fingers });
      const bh = bossPlan(b.o as MountBossOptions).bh;
      const { finger, gap, r, axis } = GOPRO;
      const span = fingers * finger + (fingers - 1) * gap;
      // The other side's fingers (3 mm) in the gaps, and outside for two: discs round the bolt.
      const slots = Array.from({ length: fingers - 1 }, (_, k) => -span / 2 + finger + k * (finger + gap) + gap / 2);
      if (fingers === 2) slots.push(-span / 2 - gap / 2, span / 2 + gap / 2);
      const disc = (x: number) => keep(keep(keep(w.Manifold.cylinder(3, r, r, 48)).rotate([0, 90, 0])).translate([x - 1.5, bh + axis, 0]));
      const mate = platform(b, union([...slots.map(disc), barX(-20, 20, 2.5, bh + axis, 0)]));
      expect(overlap(b.hung, mate), `${fingers}`).toBeLessThan(0.05);
      expect(overlap(b.hung, moved(mate, [0.3, 0, 0])), `${fingers}`).toBeGreaterThan(0.5);
    }
  });

  it('an Arca-Swiss plate slides into the seat and can’t lift out; a cold-shoe foot likewise', () => {
    const arca = build('mountBoss', { fixing: 'arca' });
    const pa = bossPlan(arca.o as MountBossOptions);
    const y0 = pa.bh - ARCA.side;
    // A 38 mm plate, its 45° bevel 4 mm tall, 10 thick, in from the front to 1 mm off the stop.
    const plate = platform(
      arca,
      prismZ(
        [
          [-19, y0],
          [19, y0],
          [15, y0 + 4],
          [15, y0 + 10],
          [-15, y0 + 10],
          [-15, y0 + 4],
        ],
        -pa.bd / 2 + 6,
        pa.bd / 2 + 20,
      ),
    );
    expect(overlap(arca.hung, plate)).toBeLessThan(0.02);
    expect(overlap(arca.hung, moved(plate, [0, 0.6, 0]))).toBeGreaterThan(1);
    expect(overlap(arca.hung, moved(plate, [0, 0, -2]))).toBeGreaterThan(1);
    const shoe = build('mountBoss', { fixing: 'coldshoe' });
    const ps = bossPlan(shoe.o as MountBossOptions);
    const yf = ps.bh - SHOE.edge - (SHOE.width - SHOE.opening) / 2 - SHOE.slot;
    // The foot: 18.6 × 2 mm, its stem 10 wide up through the opening.
    const foot = platform(shoe, union([box(-9.3, yf, -ps.bd / 2 + 5, 9.3, yf + 2, ps.bd / 2 + 5), box(-5, yf + 1, -ps.bd / 2 + 7, 5, yf + 15, ps.bd / 2 - 2)]));
    expect(overlap(shoe.hung, foot)).toBeLessThan(0.02);
    expect(overlap(shoe.hung, moved(foot, [0, 1, 0]))).toBeGreaterThan(1);
  });

  it('lists its hardware, and warns when it reaches far out', () => {
    const def = attachmentDef('mountBoss')!;
    const hw = (f: string) => def.hardware!(def.sanitize({ fixing: f })).map((h) => h.item);
    expect(hw('1/4-20')).toEqual(['1/4″-20 hex bolt, 3/8″ long']);
    expect(hw('3/8-16')).toEqual(['3/8″-16 hex bolt, 1/2″ long']);
    expect(hw('5/8-27')).toEqual(['3/8″-16 hex bolt, 1/2″ long', '5/8″-27 male to 3/8″-16 female thread adapter']);
    expect(hw('gopro')).toEqual(['GoPro thumb screw (M5) and nut']);
    expect(hw('arca')[0]).toMatch(/M5 thumb screw/);
    expect(hw('coldshoe')).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('Device mount 1/4″-20');
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ reach: 150, height: 40 }), CTX).join()).toMatch(/three times/);
    // The arm keeps clear of the back plate's mounts: its root is on the back plate's face.
    expect(bossPlan(def.sanitize({ reach: 20 }) as MountBossOptions).zc).toBeGreaterThan(BOSS_BACK + 15);
  });
});

describe('adapter plate hole patterns', () => {
  it('builds clean with every preset, holes where the devices have them', () => {
    for (const p of presets('plate')) {
      const b = build('plate', p.set);
      expectClean(b, p.name);
      const o = b.o as PlateOptions;
      const { at } = patternHoles(o, b.layout.w, b.layout.h);
      if (o.pattern === 'grid') continue;
      const [dx, dy, screw] = HOLE_PATTERNS[o.pattern];
      expect(at[2][0] - at[0][0]).toBeCloseTo(dx, 9);
      expect(at[1][1] - at[0][1]).toBeCloseTo(dy, 9);
      for (const [x, y] of at) {
        if (screw === 'm2.5') {
          // A standoff 5 mm out, a pilot hole down it.
          expect(overlap(b.hung, barZ(o.thick + 0.5, o.thick + PI_STANDOFF.h - 0.1, 2.6, x, y)), p.name).toBeGreaterThan(Math.PI * (2.6 ** 2 - 1.2 ** 2) * 4);
          expect(overlap(b.hung, barZ(1.5, o.thick + PI_STANDOFF.h + 1, PI_STANDOFF.pilot / 2 - 0.05, x, y)), p.name).toBeLessThan(0.02);
        } else {
          // A screw passes; its countersunk head sits flush in the back.
          const [hole, head] = PLATE_SCREWS[screw];
          expect(overlap(b.hung, barZ(-1, o.thick + 1, hole / 2 - 0.05, x, y)), p.name).toBeLessThan(0.02);
          expect(overlap(b.hung, barZ(0.05, 0.35, head / 2 - 0.4, x, y)), p.name).toBeLessThan(0.02);
        }
      }
      // The presets keep every hole off the mounts.
      expect(
        attachmentDef('plate')!.notes!(b.o, CTX).filter((n) => /lands on/.test(n)),
        p.name,
      ).toEqual([]);
    }
  });

  it('warns for monitors and for holes on the mounts, and lists the screws', () => {
    const def = attachmentDef('plate')!;
    expect(def.notes!(def.sanitize({ pattern: 'vesa100', width: 120, height: 120 }), CTX).join()).toMatch(/2 kg.*studs/);
    expect(def.notes!(def.sanitize({ pattern: 'vesa75', width: 100, height: 100 }), CTX).join()).toMatch(/lands on a clip/);
    expect(def.hardware!(def.sanitize({ pattern: 'vesa100', thick: 6 }))).toEqual([
      { item: 'Countersunk screws M4 × 10', count: 4, note: 'from the back, into the monitor' },
    ]);
    expect(def.hardware!(def.sanitize({ pattern: 'ssd' }))[0].item).toBe('Countersunk screws M3 × 8');
    expect(def.hardware!(def.sanitize({ pattern: 'pi' }))[0].item).toBe('Screws M2.5 × 6');
    expect(def.summary(def.sanitize({ pattern: 'piZero' }))).toBe('Pi Zero plate');
    // Too small a plate grows to take the pattern.
    expect(def.layout(def.sanitize({ pattern: 'vesa100', width: 50, height: 50 }), CTX).w).toBeGreaterThan(108);
    expect(attachmentUi('plate')?.group).toBe('adapters');
  });
});

describe('on a 560 × 560 board', () => {
  it('every adapter places without warnings, its extra parts printing alongside', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('mc', 'receiver', 60, 500),
      a('peg', 'pegboardBridge', 200, 500),
      a('cleat', 'cleatStrip', 340, 500, { hanger: true }),
      a('din', 'dinRail', 60, 360),
      a('cam', 'mountBoss', 220, 360, { tilt: 15 }),
      a('pi', 'plate', 320, 360, { pattern: 'pi', width: 80, height: 70, thick: 4 }),
      a('ssd', 'plate', 440, 360, { pattern: 'ssd', width: 80, height: 100 }),
      a('gopro', 'mountBoss', 60, 180, { fixing: 'gopro' }),
      a('oc', 'receiver', 200, 180, { system: 'openconnect', pitch: 28, columns: 3 }),
      a('arca', 'mountBoss', 320, 180, { fixing: 'arca' }),
      a('din15', 'dinRail', 440, 180, { depth: '15', length: 80 }),
      a('shoe', 'mountBoss', 100, 60, { fixing: 'coldshoe' }),
      a('mp', 'receiver', 260, 60, { system: 'multipoint', columns: 3 }),
    ];
    const d: NamedDrawer = {
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 }, attachments: list },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    };
    const job = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.every((p) => p.ok)).toBe(true);
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // The cleat's hanger prints too, and a lock key for each part with hooks.
    expect(parts.filter((p) => !p.name.startsWith('Lock key'))).toHaveLength(list.length + 1);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
