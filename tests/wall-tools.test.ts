import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { wrenchHead } from '../src/lib/geometry/containers/rack';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { mountBox, partBounds, printedSize, siteAt, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { SHELF_DEFAULTS } from '../src/lib/wall/kinds/shelf';
import { ROD, rodGeometry, ROD_DEFAULTS } from '../src/lib/wall/kinds/rod';
import { TOOL, TOOL_RACK_DEFAULTS, parseSizes, toolLayout, type ToolRackOptions } from '../src/lib/wall/kinds/toolRack';
import { CRADLE, cradlePocket } from '../src/lib/wall/kinds/cradle';
import { PLATE_SCREWS, tieRow } from '../src/lib/wall/kinds/plate';
import { PLATE } from '../src/lib/wall/kinds/plate.geom';

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
  keep(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
/** A round bar along x (axis at y, z) or along y (axis at x, z). */
const barX = (x0: number, x1: number, r: number, y: number, z: number) =>
  keep(keep(keep(w.Manifold.cylinder(x1 - x0, r, r, 64)).rotate([0, 90, 0])).translate([x0, y, z]));
const barY = (y0: number, y1: number, r: number, x: number, z: number) =>
  keep(keep(keep(w.Manifold.cylinder(y1 - y0, r, r, 64)).rotate([-90, 0, 0])).translate([x, y0, z]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

/** Build a kind with options, check it prints, and turn it back into its own frame. */
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

/** No errors, no overhangs or islands (everything self-supporting as printed), and as big as planned. */
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

describe('shelf', () => {
  it('builds clean with side walls, drain slots and no lip, as wide and deep as asked', () => {
    const b = build('shelf', { width: 240, depth: 120, height: 70, lip: 0, sides: true, holes: 'slots' });
    expectClean(b, 'shelf');
    expect(b.layout).toMatchObject({ w: 240, h: 70, depth: 120, pose: 'upright' });
    // Clips across the top, studs low on the back.
    expect(b.layout.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(5);
    expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
  });

  it('lies on the bed and carries the load in gussets in the corner', () => {
    const b = build('shelf', { width: 120, depth: 80, height: 60, lip: 10 });
    expectClean(b, 'shelf');
    // A 45° gusset fills the corner at each end (3 mm thick), 20 mm up and out; the middle stays clear.
    const corner = (x0: number, x1: number) => overlap(b.hung, box(x0, 4, SHELF_DEFAULTS.floor + 4, x1, 22, 22));
    expect(corner(0.2, 2.8)).toBeCloseTo(2.6 * 18 * 15, 0);
    expect(corner(117.2, 119.8)).toBeCloseTo(2.6 * 18 * 15, 0);
    expect(corner(40, 80)).toBeLessThan(0.01);
    // The lip along the front, 10 mm over the shelf.
    expect(overlap(b.hung, box(10, 3.5, 78.5, 110, 12.5, 79.5))).toBeCloseTo(100 * 9, 0);
  });

  it('drain slots go through the shelf', () => {
    const solid = build('shelf', { width: 120, depth: 80 });
    const slotted = build('shelf', { width: 120, depth: 80, holes: 'slots' });
    const shelf = () => box(0, 0, 10, 120, 3, 70);
    expect(overlap(slotted.hung, shelf())).toBeLessThan(overlap(solid.hung, shelf()) - 1000);
  });

  it('says when it reaches out too far for its back', () => {
    const def = attachmentDef('shelf')!;
    expect(def.notes!(def.sanitize({ depth: 200, height: 40 }), CTX).join()).toMatch(/three times/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({ width: 200, depth: 100 }))).toBe('Shelf 200 × 100');
  });
});

describe('roll holder', () => {
  it('builds clean, as wide as the roll and reaching past its radius', () => {
    const b = build('rod', { width: 200, diameter: 150, rod: 16, height: 70 });
    expectClean(b, 'rod');
    const g = rodGeometry(b.o as typeof ROD_DEFAULTS);
    expect(b.layout.w).toBeCloseTo(200 + 2 * ROD.side + 2 * ROD.arm, 6);
    // The roll clears the board's front: the rod is out further than the roll's radius.
    expect(g.z - 150 / 2).toBeGreaterThan(ROD.back);
    expect(b.layout.depth).toBeCloseTo(g.z + g.pocket + ROD.lip, 6);
  });

  for (const rod of [8, 12, 25]) {
    it(`its pockets hold a ⌀${rod} rod, which lifts out but can't slide out`, () => {
      const b = build('rod', { rod, source: 'dowel' });
      const g = rodGeometry(b.o as typeof ROD_DEFAULTS);
      const W = b.layout.w;
      // The rod, as long as it is, lies in the pockets without touching them...
      expect(overlap(b.hung, barX(ROD.stop + 0.5, W - ROD.stop - 0.5, rod / 2, g.y, g.z))).toBeLessThan(0.01);
      // ...snugly: a bar 0.3 mm thicker than the pocket's clearance would rub.
      expect(overlap(b.hung, barX(ROD.stop + 0.5, W - ROD.stop - 0.5, rod / 2 + ROD.fit + 0.3, g.y, g.z))).toBeGreaterThan(1);
      // Nothing above it in the pockets: it lifts straight out.
      for (const x of [ROD.stop + 0.5, W - ROD.arm])
        expect(overlap(b.hung, box(x, g.y, g.z - rod / 2, x + ROD.arm - ROD.stop - 1, b.layout.h + 1, g.z + rod / 2))).toBeLessThan(0.01);
      // The stops on the outside keep it from sliding out sideways.
      expect(overlap(b.hung, barX(-1, ROD.stop, rod / 2, g.y, g.z))).toBeGreaterThan(1);
      expect(overlap(b.hung, barX(W - ROD.stop, W + 1, rod / 2, g.y, g.z))).toBeGreaterThan(1);
    });
  }

  it('prints its rod lying down, and shows it in its pockets', () => {
    const b = build('rod', { width: 100, rod: 14 });
    const def = attachmentDef('rod')!;
    const [part] = def.parts!(b.o, CTX);
    expect(part.key).toBe('rod');
    const mesh = buildMesh(w, { kind: 'attachmentPart', key: part.key, type: 'rod', part: part.spec, ctx: CTX });
    expect(checkPart(w, mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang')).toEqual([]);
    const mb = meshBounds(mesh);
    expect([mb.max[0] - mb.min[0], mb.max[1] - mb.min[1], mb.max[2] - mb.min[2]].map((v) => Math.round(v * 10) / 10)).toEqual(
      [part.w, part.d, part.h].map((v) => Math.round(v * 10) / 10),
    );
    // In place: turned as it sits, its min corner where `place` says; it touches nothing and lies along the pockets.
    const turned = keep(toManifold(mesh).rotate(part.place!.turn));
    const tb = turned.boundingBox();
    const at = part.place!.at;
    const placed = keep(turned.translate([at[0] - tb.min[0], at[1] - tb.min[1], at[2] - tb.min[2]]));
    expect(overlap(placed, b.hung)).toBeLessThan(0.01);
    const g = rodGeometry(b.o as typeof ROD_DEFAULTS);
    const pb = placed.boundingBox();
    expect((pb.min[2] + pb.max[2]) / 2).toBeCloseTo(g.z, 1);
    expect(pb.max[1]).toBeCloseTo(g.y + 7, 1);
    expect(pb.min[0]).toBeCloseTo(ROD.stop + 0.5, 3);
    expect(pb.max[0]).toBeCloseTo(b.layout.w - ROD.stop - 0.5, 3);
    // Flat side down.
    expect(pb.min[1]).toBeGreaterThan(g.y - 7);
  });

  it('a dowel instead: no printed rod, a dowel to cut on the list', () => {
    const def = attachmentDef('rod')!;
    const o = def.sanitize({ source: 'dowel', rod: 10, width: 100 });
    expect(def.parts!(o, CTX)).toEqual([]);
    const len = Math.round(rodGeometry(o as typeof ROD_DEFAULTS).length);
    expect(def.hardware!(o)).toEqual([{ item: 'Dowel ⌀10 mm', count: 1, note: `cut to ${len} mm` }]);
    expect(def.hardware!(def.sanitize({}))).toEqual([]);
  });

  it('says when a printed rod is too long for a printer', () => {
    const def = attachmentDef('rod')!;
    expect(def.notes!(def.sanitize({ width: 280 }), CTX).join()).toMatch(/use a dowel/);
    expect(def.notes!(def.sanitize({ width: 280, source: 'dowel' }), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('Roll holder 120 × ⌀110');
  });
});

describe('tool rack', () => {
  const rack = (o: Partial<ToolRackOptions>) => ({ ...TOOL_RACK_DEFAULTS, ...o });

  it('reads sizes as typed', () => {
    expect(parseSizes('3, 4,5 mm; 6.5  8')).toEqual([3, 4, 5, 6.5, 8]);
    expect(parseSizes('')).toEqual([]);
    expect(parseSizes('2 x 100')).toEqual([2, 40]);
  });

  for (const mode of ['drivers', 'pliers', 'wrenches', 'bits', 'hexKeys'] as const) {
    it(`${mode}: builds clean, holes through the ledge where planned`, () => {
      const b = build('toolRack', rack({ mode, height: 45 }));
      expectClean(b, mode);
      const l = toolLayout(b.o as ToolRackOptions);
      expect(b.layout.w).toBeCloseTo(l.w, 6);
      expect(b.layout.depth).toBeCloseTo(l.d, 6);
      for (const h of l.holes) {
        // Every hole is open, inside the ledge, and clear of the back.
        expect(overlap(b.hung, box(h.x - h.sx / 4, l.t - 1, h.z - h.sz / 4, h.x + h.sx / 4, l.t + 1, h.z + h.sz / 4)), `${mode} ${h.x}`).toBeLessThan(0.01);
        expect(h.x - h.sx / 2).toBeGreaterThan(TOOL.end);
        expect(h.x + h.sx / 2).toBeLessThan(l.w - TOOL.end);
        expect(h.z - h.sz / 2).toBeGreaterThan(TOOL.back);
      }
    });
  }

  it('screwdrivers: one round hole per size, the size plus clearance, all the way through', () => {
    const o = rack({ drivers: '3, 4.5, 6, 6', clearance: 0.5, handle: 24 });
    const b = build('toolRack', o);
    const l = toolLayout(b.o as ToolRackOptions);
    expect(l.holes.map((h) => h.sx)).toEqual([3.5, 5, 6.5, 6.5]);
    expect(attachmentDef('toolRack')!.summary(b.o)).toBe('Screwdriver rack, 4 holes');
    for (const h of l.holes) {
      // The shaft passes through (a hair under the hole), a 0.3 mm bigger one doesn't.
      expect(overlap(b.hung, barY(-1, l.t + 1, h.sx / 2 - 0.05, h.x, h.z))).toBeLessThan(0.02);
      expect(overlap(b.hung, barY(0.5, l.t - 1, h.sx / 2 + 0.3, h.x, h.z))).toBeGreaterThan(0.5);
    }
    // Handles 24 across don't touch, and clear the back.
    for (let i = 1; i < l.holes.length; i++) expect(l.holes[i].x - l.holes[i - 1].x).toBeGreaterThanOrEqual(24 + 1 - 1e-9);
    expect(l.holes[0].z - 12).toBeGreaterThanOrEqual(TOOL.back);
  });

  it('hex keys: hex holes the size across flats plus clearance', () => {
    const b = build('toolRack', rack({ mode: 'hexKeys', hexKeys: '2, 5, 10', clearance: 0.4 }));
    const l = toolLayout(b.o as ToolRackOptions);
    expect(l.holes.map((h) => h.sz)).toEqual([2.4, 5.4, 10.4]);
    expect(attachmentDef('toolRack')!.summary(b.o)).toBe('Hex key rack, 3 holes');
    for (const h of l.holes) {
      // The key fits across flats (front to back), not a hair wider.
      expect(overlap(b.hung, box(h.x - h.sz / 4, 0.5, h.z - h.sz / 2 + 0.05, h.x + h.sz / 4, l.t - 0.5, h.z + h.sz / 2 - 0.05))).toBeLessThan(0.02);
      expect(overlap(b.hung, box(h.x - h.sz / 4, 0.5, h.z - h.sz / 2 - 0.3, h.x + h.sz / 4, l.t - 0.5, h.z + h.sz / 2 + 0.3))).toBeGreaterThan(0.1);
    }
  });

  it('wrenches: comb slots open at the front, sized from the Gridfinity rack’s wrench heads', () => {
    const o = rack({ mode: 'wrenches', wrenches: '8, 13, 19', clearance: 0.6 });
    const b = build('toolRack', o);
    const l = toolLayout(b.o as ToolRackOptions);
    [8, 13, 19].forEach((s, i) => {
      const head = wrenchHead(s);
      expect(l.holes[i].sz).toBeCloseTo(head.width / 2 + 0.6, 2);
      expect(l.holes[i].sx).toBeCloseTo(0.75 * head.thick + 0.6, 2);
      // The ring end can't drop through the slot; the head's width clears the back.
      expect(l.holes[i].sx).toBeLessThan(head.thick);
      expect(l.holes[i].z - head.width / 2).toBeGreaterThan(TOOL.back);
      // Open through the front edge.
      const h = l.holes[i];
      expect(overlap(b.hung, box(h.x - h.sx / 4, 0.5, h.z, h.x + h.sx / 4, l.t - 0.5, l.d + 1))).toBeLessThan(0.01);
    });
    expect(attachmentDef('toolRack')!.summary(b.o)).toBe('Wrench rack, 3 slots');
  });

  it('bits: blind 1/4″ hex sockets in rows, a floor under them', () => {
    const b = build('toolRack', rack({ mode: 'bits', bits: 10, rows: 2 }));
    const l = toolLayout(b.o as ToolRackOptions);
    expect(l.holes).toHaveLength(10);
    expect(new Set(l.holes.map((h) => h.z)).size).toBe(2);
    expect(l.holes[0].sz).toBeCloseTo(6.35 + TOOL.bitFit, 6);
    for (const h of l.holes) {
      expect(overlap(b.hung, box(h.x - 1, l.t - 9.5, h.z - 1, h.x + 1, l.t + 1, h.z + 1))).toBeLessThan(0.01);
      expect(overlap(b.hung, box(h.x - 1, 0.2, h.z - 1, h.x + 1, 1.8, h.z + 1))).toBeCloseTo(2 * 2 * 1.6, 2);
    }
    expect(attachmentDef('toolRack')!.summary(b.o)).toBe('Bit holder, 10 bits');
  });

  it('notes an empty list and holes too tight', () => {
    const def = attachmentDef('toolRack')!;
    expect(def.notes!(def.sanitize({ drivers: '' }), CTX).join()).toMatch(/No sizes/);
    expect(def.notes!(def.sanitize({ clearance: 0.1 }), CTX).join()).toMatch(/too tight/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    // An empty list still builds: a plain ledge.
    expectClean(build('toolRack', { drivers: '' }), 'empty');
  });

  it('the form shows the fields of the mode picked', () => {
    const ui = attachmentUi('toolRack')!;
    const shown = (o: Partial<ToolRackOptions>) => ui.fields.filter((f) => !f.when || (f.when as (v: object) => boolean)(rack(o))).map((f) => f.key);
    expect(shown({ mode: 'pliers' })).toContain('pliers');
    expect(shown({ mode: 'pliers' })).not.toContain('drivers');
    expect(shown({ mode: 'bits' })).toEqual(expect.arrayContaining(['bits', 'rows']));
    expect(shown({ mode: 'bits' })).not.toContain('clearance');
  });
});

describe('device holder', () => {
  for (const front of ['open', 'lip', 'u'] as const) {
    it(`${front} front: builds clean, the pocket the device plus clearance`, () => {
      const o = { width: 120, depth: 30, height: 50, front, cable: true, notches: true };
      const b = build('cradle', o);
      expectClean(b, front);
      const p = cradlePocket(b.o as never);
      expect(p.x1 - p.x0).toBeCloseTo(120 + 2 * CRADLE.fit, 6);
      expect(p.z1 - p.z0).toBeCloseTo(30 + 2 * CRADLE.fit, 6);
      // The device (and its clearance) fits; 0.3 mm more each way hits the walls, the back and the floor.
      expect(overlap(b.hung, box(p.x0 + 0.01, p.y0 + 0.01, p.z0 + 0.01, p.x1 - 0.01, p.y0 + p.h, p.z1 - 0.01))).toBeLessThan(0.01);
      expect(overlap(b.hung, box(p.x0 - 0.3, p.y0 + 10, p.z0 + 5, p.x0 + 1, p.y0 + 20, p.z1 - 5))).toBeGreaterThan(1);
      expect(overlap(b.hung, box(p.x0 + 20, p.y0 + 10, p.z0 - 0.3, p.x1 - 20, p.y0 + 20, p.z0 + 1))).toBeGreaterThan(1);
      expect(overlap(b.hung, box(p.x0 + 2, p.y0 - 0.3, p.z0 + 2, p.x0 + 10, p.y0 + 1, p.z0 + 6))).toBeGreaterThan(1);
    });
  }

  it('the front: open but for the corners, a low lip, or full height with a U', () => {
    const front = (f: string) => {
      const b = build('cradle', { width: 80, depth: 20, height: 60, front: f, cable: false });
      const p = cradlePocket(b.o as never);
      // The middle of the front wall, from 10 mm up to the top.
      return overlap(b.hung, box(30, p.y0 + 10, p.z1, 50, p.y0 + p.h - 0.5, p.z1 + 2));
    };
    expect(front('open')).toBeLessThan(0.01);
    expect(front('u')).toBeLessThan(0.01);
    expect(front('lip')).toBeGreaterThan(0);
    expect(front('lip')).toBeLessThan(20 * 2 * 10);
  });

  it('a cable hole through the floor, notches in the sides', () => {
    const b = build('cradle', { width: 60, depth: 30, front: 'lip', cable: true, notches: true });
    const p = cradlePocket(b.o as never);
    const zm = (p.z0 + p.z1) / 2;
    expect(overlap(b.hung, box(b.layout.w / 2 - 2, -1, zm - 2, b.layout.w / 2 + 2, p.y0 + 1, zm + 2))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(-1, p.y0 + 12, zm - 2, b.layout.w + 1, p.y0 + p.h, zm + 2))).toBeLessThan(0.01);
    const plain = build('cradle', { width: 60, depth: 30, front: 'lip', cable: false, notches: false });
    expect(overlap(plain.hung, box(b.layout.w / 2 - 2, 0.2, zm - 2, b.layout.w / 2 + 2, p.y0 - 0.2, zm + 2))).toBeGreaterThan(1);
    expect(attachmentDef('cradle')!.summary(b.o)).toBe('Holder 60 × 30 × 60');
  });
});

describe('adapter plate', () => {
  it('builds clean with everything on, holes clear of the mounts', () => {
    const b = build('plate', { width: 120, height: 100, thick: 6, screws: 'm4', pitch: 15, ties: true, magnets: true, tape: true });
    expectClean(b, 'plate');
    expect(b.layout).toMatchObject({ w: 120, h: 100, depth: 6 });
    // Solid round every mount: no hole there.
    for (const m of b.layout.mounts) {
      const mb = mountBox(m.kind, siteAt(b.layout, m, CTX), CTX);
      const x = (mb.x0 + mb.x1) / 2;
      expect(overlap(b.hung, box(x - 1.5, mb.y0, 0.5, x + 1.5, mb.y1, 3))).toBeCloseTo(3 * (mb.y1 - mb.y0) * 2.5, 1);
    }
  });

  it('countersunk from the back, so the head sits flush on the board', () => {
    const b = build('plate', { width: 60, height: 60, screws: 'm3', pitch: 20 });
    const [hole, head] = PLATE_SCREWS.m3;
    // The middle hole is clear of the mounts: a screw shank passes, a head fits flush in the back.
    const x = 30;
    const y = 30;
    expect(overlap(b.hung, keep(keep(w.Manifold.cylinder(7, hole / 2 - 0.05, hole / 2 - 0.05, 48)).translate([x, y, -1])))).toBeLessThan(0.02);
    expect(overlap(b.hung, keep(keep(w.Manifold.cylinder(0.3, head / 2 - 0.4, head / 2 - 0.4, 48)).translate([x, y, 0.05])))).toBeLessThan(0.02);
    expect(overlap(b.hung, keep(keep(w.Manifold.cylinder(0.3, head / 2 + 0.5, head / 2 + 0.5, 48)).translate([x, y, 4])))).toBeGreaterThan(1);
  });

  it('zip-tie slots with a channel behind, magnet pockets, a tape recess', () => {
    const b = build('plate', { width: 80, height: 80, screws: 'none', ties: true, magnets: true, tape: true });
    const T = 5;
    const ty = tieRow(b.layout, CTX)!;
    // The first pair: two slots through and the channel between them at the back.
    const xa = 80 / 2 - 30 / 2 - PLATE.tieSpan / 2;
    expect(overlap(b.hung, box(xa - 0.5, ty - 2, -0.5, xa + 0.5, ty + 2, T + 0.5))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(xa, ty - 2, 0.1, xa + PLATE.tieSpan, ty + 2, PLATE.channel - 0.1))).toBeLessThan(0.01);
    // A 6 × 2 magnet drops into each front corner.
    for (const [x, y] of [
      [8, 8],
      [72, 72],
    ])
      expect(overlap(b.hung, keep(keep(w.Manifold.cylinder(2, 3, 3, 48)).translate([x, y, T - 2])))).toBeLessThan(0.01);
    // The tape recess: 0.6 mm deep, 3 mm in from the edges.
    expect(overlap(b.hung, box(40, 40, T - 0.55, 45, 45, T))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(0.5, 40, T - 0.55, 2.5, 45, T))).toBeGreaterThan(0.5);
    const hw = attachmentDef('plate')!.hardware!(b.o);
    expect(hw.map((h) => h.item)).toEqual(['Magnets 6 × 2 mm (adapter plate)', 'Zip ties, up to 5 mm wide', 'VHB double-sided tape']);
    expect(hw[1].count).toBe(2);
  });

  it('lists the screws it takes and says when zip ties don’t fit', () => {
    const def = attachmentDef('plate')!;
    expect(def.hardware!(def.sanitize({}))).toEqual([
      { item: 'Countersunk screws M3', count: 4, note: 'from the back, into what it holds (the plate is 5 mm)' },
    ]);
    expect(def.notes!(def.sanitize({ ties: true, width: 20, height: 20 }), CTX).join()).toMatch(/zip-tie/);
    expect(def.notes!(def.sanitize({ ties: true }), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('Adapter plate 80 × 80');
  });
});

describe('on a board', () => {
  it('every new kind places on a 560 × 560 board without warnings, the rod printing beside its holder', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('shelf', 'shelf', 100, 500),
      a('rod', 'rod', 340, 500),
      a('drivers', 'toolRack', 120, 400),
      a('cradle', 'cradle', 420, 400, { front: 'open', notches: true }),
      a('plate', 'plate', 60, 280, { ties: true, magnets: true, tape: true }),
      a('wrenches', 'toolRack', 200, 280, { mode: 'wrenches' }),
      a('bits', 'toolRack', 340, 280, { mode: 'bits' }),
      a('hex', 'toolRack', 100, 140, { mode: 'hexKeys' }),
      a('pliers', 'toolRack', 300, 140, { mode: 'pliers' }),
      a('dowel', 'rod', 460, 140, { source: 'dowel', width: 40, diameter: 50 }),
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
    expect(parts).toHaveLength(list.length + 1);
    expect(parts.some((p) => p.key.endsWith('att:rod:rod'))).toBe(true);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
