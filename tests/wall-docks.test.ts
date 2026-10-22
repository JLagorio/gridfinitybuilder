import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import {
  DEFAULT_SKADIS,
  SKADIS,
  buildSkadisTile,
  capSize,
  coverHole,
  headDiameter,
  planSkadis,
  sanitizeSkadis,
  skadisCapPart,
  skadisTileSpecs,
  type SkadisOptions,
} from '../src/lib/geometry/skadis';
import { buildSkadisCap } from '../src/lib/geometry/skadisParts';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentLayout, type AttachmentPreset, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { BATTERY, BATTERY_DOCK_DEFAULTS, dockSize, railSection, type BatteryDockOptions } from '../src/lib/wall/kinds/batteryDock';
import { TOOL_DOCK, type ToolDockOptions } from '../src/lib/wall/kinds/toolDock';
import { CHARGER, chargerPocket, type ChargerCradleOptions } from '../src/lib/wall/kinds/chargerCradle';
import { DRIVES, INDEX, TOOL, TOOL_RACK_DEFAULTS, toolLayout, type ToolRackOptions } from '../src/lib/wall/kinds/toolRack';
import { ROD_DEFAULTS } from '../src/lib/wall/kinds/rod';
import { CRADLE_DEFAULTS } from '../src/lib/wall/kinds/cradle';
import { CUP_DEFAULTS } from '../src/lib/wall/kinds/cup';

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
/** A round bar along y (axis at x, z) or along z (axis at x, y). */
const barY = (y0: number, y1: number, r: number, x: number, z: number) =>
  keep(keep(keep(w.Manifold.cylinder(y1 - y0, r, r, 64)).rotate([-90, 0, 0])).translate([x, y0, z]));
const barZ = (z0: number, z1: number, r0: number, x: number, y: number, r1 = r0) => keep(w.Manifold.cylinder(z1 - z0, r0, r1, 64).translate([x, y, z0]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

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

/** No errors, no overhangs (everything self-supporting as printed), as big as planned, no planning notes. */
function expectClean(b: Built, what: string, type: string) {
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
  expect(attachmentDef(type)!.notes?.(b.o, CTX) ?? [], what).toEqual([]);
}

/** Its extra parts build clean, as big as planned. */
function expectParts(type: string, o: object) {
  const def = attachmentDef(type)!;
  for (const p of def.parts?.(o, CTX) ?? []) {
    const mesh = buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
    expect(
      checkPart(w, mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang'),
      `${type} ${p.key}`,
    ).toEqual([]);
    const mb = meshBounds(mesh);
    expect([mb.max[0] - mb.min[0], mb.max[1] - mb.min[1], mb.max[2] - mb.min[2]].map((v) => Math.round(v * 10) / 10)).toEqual(
      [p.w, p.d, p.h].map((v) => Math.round(v * 10) / 10),
    );
  }
}

/** The kind's preset fields, with the options they apply to (a field shown only in some modes is tried in them). */
function presets(type: string): { field: string; p: AttachmentPreset; base: object }[] {
  const def = attachmentDef(type)!;
  const out: { field: string; p: AttachmentPreset; base: object }[] = [];
  for (const f of attachmentUi(type)!.fields) {
    if (f.kind !== 'preset') continue;
    const modes = type === 'batteryDock' ? ['rail', 'stem', 'body'] : [undefined];
    const base = modes
      .map((mode) => (mode ? { ...def.defaults, mode } : def.defaults))
      .find((o) => !f.when || (f.when as (v: object) => boolean)(def.sanitize(o)))!;
    for (const p of f.presets) out.push({ field: f.key, p, base });
  }
  return out;
}

/** Columns of clips in a bay from x0 to x1. */
const clipColumns = (b: Built, x0: number, x1: number) =>
  b.layout.mounts.filter((m) => m.kind === 'clip' && b.layout.anchor[0] + m.di * CTX.pitch > x0 && b.layout.anchor[0] + m.di * CTX.pitch < x1).length;

describe('battery dock', () => {
  const dock = (o: Partial<BatteryDockOptions>) => ({ ...BATTERY_DOCK_DEFAULTS, ...o });

  it('builds clean at its defaults and in every mode, two clip columns a bay and studs low on the back', () => {
    for (const o of [
      dock({}),
      dock({ count: 3, latch: 'none', clearance: 0.5, packW: 74, packD: 56 }),
      dock({ count: 2, packW: 40 }),
      dock({ mode: 'stem', count: 2, packW: 74, packD: 54, packL: 100, stemW: 32, stemD: 24 }),
      dock({ mode: 'body', count: 2, packW: 75, packD: 62, packL: 113 }),
    ]) {
      const b = build('batteryDock', o);
      expectClean(b, JSON.stringify(o), 'batteryDock');
      expectParts('batteryDock', b.o);
      const z = dockSize(b.o as BatteryDockOptions, CTX);
      expect(b.layout.w).toBeCloseTo(z.w, 6);
      expect(b.layout.pose).toBe('upright');
      expect(clipColumns(b, 0, b.layout.w)).toBeGreaterThanOrEqual(2 * o.count);
      expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
    }
  });

  it('every pack preset builds clean', () => {
    const list = presets('batteryDock');
    expect(list.length).toBeGreaterThanOrEqual(9 + 7 + 2);
    for (const { field, p, base } of list) {
      const b = build('batteryDock', { ...base, ...p.set });
      expectClean(b, `${field} ${p.value}`, 'batteryDock');
    }
    // The defaults are the M18's: the form shows it, marked as a starting point.
    const rail = list.find((q) => q.field === 'railPack' && q.p.value === 'm18')!;
    expect(attachmentDef('batteryDock')!.sanitize({ ...BATTERY_DOCK_DEFAULTS, ...rail.p.set })).toEqual(attachmentDef('batteryDock')!.sanitize({}));
    expect(rail.p.label).toMatch(/starting point/);
  });

  /** A pack's top as the receiver sees it, seated on the stop: its rails under the receiver's, its neck between them, its body in front. */
  function pack(o: BatteryDockOptions, cx: number, dy = 0, dz = 0, grow = 0) {
    const B = BATTERY.back;
    const S = BATTERY.stop + dy;
    const fw = o.spacing + 2 * o.railW + 2 * grow;
    const front = B + o.groove + o.railT;
    const parts = [
      box(cx - fw / 2, S + 0.01, B + 0.01 + dz, cx + fw / 2, S + o.packL, B + o.groove - 0.01 + dz),
      box(cx - o.spacing / 2 - grow, S + 0.01, B + 0.01 + dz, cx + o.spacing / 2 + grow, S + o.packL, front + dz),
      box(cx - o.packW / 2, S + 0.01, front + 0.01 + dz, cx + o.packW / 2, S + o.packL, front + o.packD - o.groove - o.railT + dz),
    ];
    return keep(w.Manifold.union(parts));
  }

  it('the pack slides down onto the rails to the stop, and can’t come off forward or go further', () => {
    for (const c of [0.2, 0.3, 0.6]) {
      const b = build('batteryDock', dock({ clearance: c, latch: 'none' }));
      const o = b.o as BatteryDockOptions;
      const cx = b.layout.w / 2;
      // Seated: it touches nothing.
      expect(overlap(b.hung, pack(o, cx)), `c ${c}`).toBeLessThan(0.02);
      // Past the stop, out from the board (its rails under the receiver's) or its rails 0.1 mm wider than the clearance: it hits.
      expect(overlap(b.hung, pack(o, cx, -1))).toBeGreaterThan(1);
      expect(overlap(b.hung, pack(o, cx, 0, c + 0.5))).toBeGreaterThan(1);
      expect(overlap(b.hung, pack(o, cx, 0, 0, c + 0.1))).toBeGreaterThan(0.1);
      // It lifts straight up and off the open top.
      expect(overlap(b.hung, pack(o, cx, 40))).toBeLessThan(0.02);
    }
  });

  it('its latch clicks into the recess and holds it down until the button is pressed', () => {
    const b = build('batteryDock', dock({}));
    const o = b.o as BatteryDockOptions;
    const cx = b.layout.w / 2;
    const B = BATTERY.back;
    // The latch: a tab on the pack's rail face, sprung out toward the deck, 2 mm into the recess.
    const latch = (dy: number) => box(cx - 5, BATTERY.stop + o.latchAt - 4 + dy, B - 2, cx + 5, BATTERY.stop + o.latchAt + 4 + dy, B + 0.5);
    expect(overlap(b.hung, latch(0))).toBeLessThan(0.02);
    expect(overlap(b.hung, latch(8))).toBeGreaterThan(1);
    // Without a recess the deck is flat: the latch stays pressed.
    const flat = build('batteryDock', dock({ latch: 'none' }));
    expect(overlap(flat.hung, latch(0))).toBeGreaterThan(1);
    // The recess stops short of the back: the back plate stays solid behind it.
    expect(overlap(b.hung, box(cx - 5, BATTERY.stop + o.latchAt - 2, 0.1, cx + 5, BATTERY.stop + o.latchAt + 2, B - BATTERY.latchD - 0.1))).toBeCloseTo(
      10 * 4 * (B - BATTERY.latchD - 0.2),
      1,
    );
  });

  it('prints three fit coupons, tighter, as set and looser, one to three notches', () => {
    const def = attachmentDef('batteryDock')!;
    const o = def.sanitize({ clearance: 0.4 });
    const parts = def.parts!(o, CTX);
    expect(parts.map((p) => p.key)).toEqual(['coupon1', 'coupon2', 'coupon3']);
    expect(parts.map((p) => (p.spec as BatteryDockOptions).clearance)).toEqual([0.2, 0.4, 0.6].map((v) => expect.closeTo(v, 6)));
    // Each a short length of the dock's own rails at its clearance.
    for (const p of parts) expect(p.w).toBeCloseTo(railSection(o as BatteryDockOptions, (p.spec as BatteryDockOptions).clearance).width, 6);
    expect(parts.map((p) => p.h)).toEqual([BATTERY.coupon, BATTERY.coupon, BATTERY.coupon]);
    parts.forEach((p, k) => {
      // Printed standing up as it hangs: wall (x, y, z) is print (x, front - z, y). Notches in the back plate's top, left to right.
      const m = toManifold(buildMesh(w, { kind: 'attachmentPart', key: p.key, type: 'batteryDock', part: p.spec, ctx: CTX }));
      const r = railSection(o as BatteryDockOptions, (p.spec as BatteryDockOptions).clearance);
      for (let i = 0; i < 3; i++) {
        const x = r.width / 2 - r.gap / 2 + 2 + 3 * i + 0.75;
        const solid = overlap(m, box(x - 0.5, r.front - BATTERY.back + 0.5, BATTERY.coupon - 1.2, x + 0.5, r.front - 0.5, BATTERY.coupon - 0.2));
        if (i <= k) expect(solid, `${p.key} notch ${i}`).toBeLessThan(0.01);
        else expect(solid, `${p.key} notch ${i}`).toBeGreaterThan(1);
      }
    });
    expect(def.parts!(def.sanitize({ coupons: false }), CTX)).toEqual([]);
    expect(def.parts!(def.sanitize({ mode: 'body' }), CTX)).toEqual([]);
  });

  it('stem packs: the stem drops through its socket, the pack rests on the ledge', () => {
    const b = build('batteryDock', dock({ mode: 'stem', packW: 74, packD: 54, stemW: 32, stemD: 24, clearance: 0.4 }));
    const o = b.o as BatteryDockOptions;
    const T = BATTERY.stemLedge;
    const cx = b.layout.w / 2;
    const zc = BATTERY.back + (b.layout.depth - BATTERY.back - BATTERY.edge) / 2;
    // A stem with its corners rounded (as the socket's are, 3 mm).
    const stem = (g: number) =>
      keep(
        w.Manifold.union([
          box(cx - o.stemW / 2 - g, -20, zc - o.stemD / 2 + 3, cx + o.stemW / 2 + g, T + 1, zc + o.stemD / 2 - 3),
          box(cx - o.stemW / 2 + 3, -20, zc - o.stemD / 2 - g, cx + o.stemW / 2 - 3, T + 1, zc + o.stemD / 2 + g),
        ]),
      );
    expect(overlap(b.hung, stem(0))).toBeLessThan(0.02);
    expect(overlap(b.hung, stem(o.clearance + 0.2))).toBeGreaterThan(1);
    // The pack's base (upside down) on the ledge, in front of the back plate.
    expect(overlap(b.hung, box(cx - o.packW / 2, T + 0.01, BATTERY.back + 0.5, cx + o.packW / 2, T + 30, BATTERY.back + o.packD))).toBeLessThan(0.02);
    expect(overlap(b.hung, box(cx - o.packW / 2, T - 1, BATTERY.back + 0.5, cx + o.packW / 2, T, BATTERY.back + o.packD))).toBeGreaterThan(100);
  });

  it('any pack in a pocket: its outside plus clearance, a lip in front', () => {
    const b = build('batteryDock', dock({ mode: 'body', packW: 75, packD: 62, packL: 113, clearance: 0.5 }));
    const o = b.o as BatteryDockOptions;
    const x0 = BATTERY.side;
    const B = BATTERY.back;
    const F = BATTERY.floor;
    const packAt = (dz: number, g = 0) =>
      box(x0 + 0.01 - g, F + 0.01, B + 0.01 + dz, x0 + o.packW + 2 * o.clearance - 0.01 + g, F + o.packL, B + o.packD + 2 * o.clearance - 0.01 + dz);
    expect(overlap(b.hung, packAt(0))).toBeLessThan(0.02);
    expect(overlap(b.hung, packAt(0, 0.3))).toBeGreaterThan(1);
    // The lip stops it sliding out forward; it lifts out of the top.
    expect(overlap(b.hung, packAt(3))).toBeGreaterThan(1);
    expect(dockSize(o, CTX).cover).toBeGreaterThanOrEqual(40);
  });

  it('notes, summary and the form', () => {
    const def = attachmentDef('batteryDock')!;
    expect(def.summary(def.sanitize({}))).toBe('Battery dock');
    expect(def.summary(def.sanitize({ mode: 'body', count: 2 }))).toBe('Battery pocket, 2 bays');
    expect(def.summary(def.sanitize({ mode: 'stem' }))).toBe('Battery dock (stem)');
    expect(def.notes!(def.sanitize({ railT: 2, clearance: 0.6 }), CTX).join()).toMatch(/under 1.6 mm/);
    expect(def.notes!(def.sanitize({ latchAt: 78 }), CTX).join()).toMatch(/latch recess/);
    expect(def.notes!(def.sanitize({ count: 4 }), CTX).join()).toMatch(/250 mm/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.hardware?.(def.sanitize({})) ?? []).toEqual([]);
    const ui = attachmentUi('batteryDock')!;
    const shown = (o: Partial<BatteryDockOptions>) => ui.fields.filter((f) => !f.when || (f.when as (v: object) => boolean)(dock(o))).map((f) => f.key);
    expect(shown({ mode: 'rail' })).toEqual(expect.arrayContaining(['railPack', 'spacing', 'latch', 'coupons']));
    expect(shown({ mode: 'stem' })).toEqual(expect.arrayContaining(['stemPack', 'stemW', 'stemD']));
    expect(shown({ mode: 'stem' })).not.toContain('spacing');
    expect(shown({ mode: 'body' })).toContain('bodyPack');
    expect(ui.description).toMatch(/charge/);
  });
});

describe('drill dock', () => {
  const dock = (o: Partial<ToolDockOptions>) => ({ ...attachmentDef('toolDock')!.defaults, ...o }) as ToolDockOptions;

  it('builds clean: one to three tools, three clip columns each, gussets and studs', () => {
    for (const o of [
      dock({}),
      dock({ count: 3, tilt: 0, battery: 'up', setback: 70, reach: 130 }),
      dock({ count: 2, gap: 50, tilt: 15, pitch: 110, height: 120 }),
    ]) {
      const b = build('toolDock', o);
      // Three tools, three clip columns each, come to 330 mm: more than most printers take.
      if (o.count === 3) {
        expect(attachmentDef('toolDock')!.notes!(b.o, CTX)).toEqual([expect.stringMatching(/250 mm/)]);
        expect(checkPart(w, b.mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang')).toEqual([]);
      } else expectClean(b, JSON.stringify(o), 'toolDock');
      expect(b.layout).toMatchObject({ depth: o.reach, pose: 'upright' });
      expect(b.layout.w).toBeGreaterThanOrEqual(o.count * o.pitch);
      expect(clipColumns(b, 0, b.layout.w)).toBeGreaterThanOrEqual(3 * o.count);
      expect(b.layout.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(2 * 3 * o.count);
      // A 45° gusset at each end, 20 mm up and out.
      expect(overlap(b.hung, box(0.2, 20, 20, 2.8, 21, 21))).toBeGreaterThan(0.5);
    }
    for (const { p } of presets('toolDock')) expectClean(build('toolDock', p.set), p.value, 'toolDock');
  });

  it('the handle drops into the slot to its end, the head rests on the prongs, which rise toward their tips', () => {
    const o = dock({ tilt: 10 });
    const b = build('toolDock', o);
    const T = TOOL_DOCK.ledge;
    const k = Math.tan((10 * Math.PI) / 180);
    const cx = o.pitch / 2;
    // A handle a hair under the gap, down through the slot at its end: clear; a wider one isn't.
    const handle = (r: number, z: number) => barY(-30, T + o.reach * k + 5, r, cx, z);
    expect(overlap(b.hung, handle(o.gap / 2 - 0.1, o.setback))).toBeLessThan(0.02);
    expect(overlap(b.hung, handle(o.gap / 2 - 0.1, o.reach))).toBeLessThan(0.02);
    expect(overlap(b.hung, handle(o.gap / 2 + 1, o.setback))).toBeGreaterThan(1);
    // It can't go further back than the slot's end.
    expect(overlap(b.hung, handle(o.gap / 2 - 0.1, o.setback - 3))).toBeGreaterThan(1);
    // The prongs' tops: up 10° toward their tips.
    const x = cx + o.gap / 2 + 10;
    for (const z of [30, o.reach - 3]) {
      const y = T + z * k;
      expect(overlap(b.hung, box(x - 1, y - 0.6, z - 1, x + 1, y - 0.2, z + 1)), `z ${z}`).toBeCloseTo(2 * 0.4 * 2, 2);
      expect(overlap(b.hung, box(x - 1, y + 0.2, z - 1, x + 1, y + 0.6, z + 1)), `z ${z}`).toBeLessThan(0.01);
    }
  });

  it('battery down: a V along the slot cradles the head; battery up: flat prongs for the battery', () => {
    const edge = (b: Built, o: ToolDockOptions) => {
      const x = o.pitch / 2 + o.gap / 2;
      const z = (o.setback + o.reach) / 2;
      const k = Math.tan((o.tilt * Math.PI) / 180);
      const y = TOOL_DOCK.ledge + z * k;
      return overlap(b.hung, box(x + 0.2, y - 1.5, z - 1, x + 1.2, y - 0.5, z + 1));
    };
    const down = dock({});
    const up = dock({ battery: 'up' });
    expect(edge(build('toolDock', down), down)).toBeLessThan(0.01);
    expect(edge(build('toolDock', up), up)).toBeCloseTo(2, 1);
  });

  it('notes and summary', () => {
    const def = attachmentDef('toolDock')!;
    expect(def.summary(def.sanitize({}))).toBe('Drill dock, battery down');
    expect(def.summary(def.sanitize({ count: 2, battery: 'up' }))).toBe('Drill dock, 2 tools, battery up');
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ reach: 200, height: 40 }), CTX).join()).toMatch(/three times/);
    expect(def.notes!(def.sanitize({ gap: 40 }), CTX).join()).toMatch(/45 mm/);
    expect(def.notes!(def.sanitize({ battery: 'up', setback: 50 }), CTX).join()).toMatch(/battery up/);
    // The slot never reaches the back plate, nor out past the prongs' tips.
    const o = def.sanitize({ gap: 90, setback: 0, reach: 60 }) as ToolDockOptions;
    expect(o.setback - o.gap / 2).toBeGreaterThanOrEqual(TOOL_DOCK.back + 5);
    expect(def.sanitize({ setback: 200 })).toMatchObject({ setback: 90 });
    expect(attachmentUi('toolDock')!.fields.find((f) => f.kind === 'preset')!.hint).toMatch(/PETG/);
  });
});

describe('charger cradle', () => {
  const charger = (o: Partial<ChargerCradleOptions>) => ({ ...attachmentDef('chargerCradle')!.defaults, ...o }) as ChargerCradleOptions;

  it('builds clean flat or on its end, every preset too', () => {
    for (const o of [charger({}), charger({ stand: 'upright', cord: 'side' }), charger({ cord: 'none', lip: 40, back: 100 })]) {
      const b = build('chargerCradle', o);
      expectClean(b, JSON.stringify(o), 'chargerCradle');
      expect(clipColumns(b, 0, b.layout.w)).toBeGreaterThanOrEqual(3);
    }
    const list = presets('chargerCradle');
    expect(list.map((q) => q.p.value)).toEqual(['dcb112', 'm12m18', 'dc18rc']);
    for (const { p } of list) expectClean(build('chargerCradle', p.set), p.value, 'chargerCradle');
  });

  for (const stand of ['flat', 'upright'] as const) {
    it(`${stand}: the charger fits with 1 mm all round and the lip keeps it in`, () => {
      const b = build('chargerCradle', charger({ stand, cord: 'none' }));
      const o = b.o as ChargerCradleOptions;
      const p = chargerPocket(o, CTX);
      const F = CHARGER.floor;
      const unit = (g: number, dz = 0) => box(p.x0 + 0.01 - g, F + 0.01, p.z0 + 0.01 + dz - g, p.x1 - 0.01 + g, F + p.tall, p.z1 - 0.01 + dz + g);
      expect(p.x1 - p.x0).toBeCloseTo(o.width + 2, 6);
      expect(p.z1 - p.z0).toBeCloseTo((stand === 'flat' ? o.depth : o.height) + 2, 6);
      expect(overlap(b.hung, unit(0))).toBeLessThan(0.02);
      expect(overlap(b.hung, unit(0.3))).toBeGreaterThan(1);
      expect(overlap(b.hung, unit(0, 3))).toBeGreaterThan(1);
    });
  }

  it('the cord goes out through the floor at the back, or a notch in the side', () => {
    const floor = build('chargerCradle', charger({ cord: 'floor' }));
    const W = floor.layout.w;
    const B = CHARGER.back;
    expect(overlap(floor.hung, box(W / 2 - 3, -1, B + 6, W / 2 + 3, CHARGER.floor + 1, B + 18))).toBeLessThan(0.01);
    const side = build('chargerCradle', charger({ cord: 'side' }));
    const p = chargerPocket(side.o as ChargerCradleOptions, CTX);
    expect(overlap(side.hung, box(p.x1 - 0.5, CHARGER.floor + 3, B + 8, side.layout.w + 1, side.layout.h, B + 18))).toBeLessThan(0.01);
    const none = build('chargerCradle', charger({ cord: 'none' }));
    expect(overlap(none.hung, box(W / 2 - 3, 0.5, B + 6, W / 2 + 3, CHARGER.floor - 0.5, B + 18))).toBeGreaterThan(10);
  });

  it('notes and summary', () => {
    const def = attachmentDef('chargerCradle')!;
    expect(def.summary(def.sanitize({}))).toBe('Charger cradle 145 × 115');
    expect(def.summary(def.sanitize({ stand: 'upright' }))).toBe('Charger cradle 145 × 115, on its end');
    expect(def.notes!(def.sanitize({ depth: 250, back: 30 }), CTX).join()).toMatch(/three times/);
  });
});

describe('presets for the roll holder, device holder, cups and tool rack', () => {
  for (const type of ['rod', 'cradle', 'cup', 'toolRack']) {
    it(`${type}: every preset builds clean at its planned size, with no notes`, () => {
      const list = presets(type);
      expect(list.length).toBeGreaterThanOrEqual(4);
      for (const { p } of list) {
        const b = build(type, { ...attachmentDef(type)!.defaults, ...p.set });
        expectClean(b, `${type} ${p.value}`, type);
        expectParts(type, b.o);
      }
    });
  }

  it('the defaults stay as they were, so saved projects don’t change', () => {
    expect(ROD_DEFAULTS).toEqual({ width: 120, diameter: 110, rod: 12, source: 'printed', height: 60 });
    expect(CRADLE_DEFAULTS).toEqual({ width: 80, depth: 16, height: 60, front: 'u', cable: true, notches: false, wall: 2 });
    expect(CUP_DEFAULTS).toEqual({ diameter: 40, height: 60, count: 1, gap: 4, wall: 1.6, bottom: 'closed' });
    // A tool rack saved before sockets, the drill index and room behind: the same holes.
    const def = attachmentDef('toolRack')!;
    const old = def.sanitize({ mode: 'drivers', drivers: '3, 4, 5', handle: 24 }) as ToolRackOptions;
    expect(old.reach).toBe(0);
    expect(toolLayout(old).holes.map((h) => h.z)).toEqual([TOOL.back + 13, TOOL.back + 13, TOOL.back + 13]);
    expect(TOOL_RACK_DEFAULTS.mode).toBe('drivers');
  });
});

describe('tool rack: sockets and the drill index', () => {
  const rack = (o: Partial<ToolRackOptions>) => ({ ...TOOL_RACK_DEFAULTS, ...o });

  for (const drive of ['1/4', '3/8', '1/2'] as const) {
    it(`${drive}″ sockets press onto square posts, spaced by their diameters`, () => {
      const b = build('toolRack', rack({ mode: 'sockets', drive, sockets: '16, 18, 22', clearance: 0.6 }));
      expectClean(b, drive, 'toolRack');
      const l = toolLayout(b.o as ToolRackOptions);
      const [a, ph] = DRIVES[drive];
      const square = { '1/4': 6.35, '3/8': 9.525, '1/2': 12.7 }[drive];
      expect(a).toBeLessThan(square);
      expect(a).toBeGreaterThan(square - 0.3);
      expect(attachmentDef('toolRack')!.summary(b.o)).toBe('Socket rail, 3 posts');
      l.holes.forEach((h, i) => {
        // A socket (its drive hole the square, its outside the diameter) seated over its post: clear of the rack.
        const od = [16, 18, 22][i];
        const socket = keep(
          barY(l.t + 0.02, l.t + 30, od / 2, h.x, h.z).subtract(
            box(h.x - square / 2, l.t, h.z - square / 2, h.x + square / 2, l.t + ph + 0.5, h.z + square / 2),
          ),
        );
        expect(overlap(b.hung, socket), `${drive} ${od}`).toBeLessThan(0.02);
        // The post is there, as tall as the drive wants.
        expect(overlap(b.hung, box(h.x - 1, l.t, h.z - 1, h.x + 1, l.t + ph - 1.2, h.z + 1))).toBeCloseTo(4 * (ph - 1.2), 1);
        if (i) expect(h.x - l.holes[i - 1].x).toBeGreaterThanOrEqual(([16, 18, 22][i - 1] + od) / 2);
      });
    });
  }

  it('a drill index: blind holes 1–10 mm by 0.5, each size engraved in front', () => {
    const def = attachmentDef('toolRack')!;
    const set = presets('toolRack').find((q) => q.p.value === 'index')!.p.set;
    const b = build('toolRack', rack(set as Partial<ToolRackOptions>));
    const l = toolLayout(b.o as ToolRackOptions);
    expect(l.holes).toHaveLength(19);
    expect(l.holes.map((h) => h.label)).toEqual(Array.from({ length: 19 }, (_, i) => String(1 + i / 2)));
    expect(def.summary(b.o)).toBe('Drill index, 19 holes');
    expect(l.t).toBe(INDEX.ledge);
    for (const h of l.holes) {
      // A bit stands in its hole, point down to the floor; there is a floor under it.
      const r = h.sx / 2 - 0.05;
      expect(overlap(b.hung, barY(l.t - INDEX.depth + 0.05, l.t + 20, r, h.x, h.z))).toBeLessThan(0.02);
      expect(overlap(b.hung, barY(0.3, l.t - INDEX.depth - 0.3, Math.min(r, 1), h.x, h.z))).toBeGreaterThan(0.1);
      // Its size engraved in the top in front of it: some of the strip is cut away, not all of it.
      const zt = h.z + Math.max(...l.holes.map((q) => q.sz / 2)) + 1;
      const strip = overlap(b.hung, box(h.x - 2, l.t - 0.5, zt, h.x + 2, l.t, zt + INDEX.text));
      expect(strip, h.label).toBeLessThan(4 * 0.5 * INDEX.text - 0.2);
      expect(strip, h.label).toBeGreaterThan(0.5);
    }
    // Neighbours' sizes don't run together.
    for (let i = 1; i < l.holes.length; i++) expect(l.holes[i].x - l.holes[i - 1].x).toBeGreaterThan(4);
  });

  it('T-handle hex keys: holes far enough out for the handles to lie front to back', () => {
    const set = presets('toolRack').find((q) => q.p.value === 'tHandles')!.p.set;
    const b = build('toolRack', rack(set as Partial<ToolRackOptions>));
    const l = toolLayout(b.o as ToolRackOptions);
    expect(l.holes).toHaveLength(7);
    // Half a 100 mm handle behind each shaft clears the back plate.
    for (const h of l.holes) expect(h.z - 50).toBeGreaterThanOrEqual(TOOL.back);
    // A 10 mm key's corners pass.
    expect(l.holes[6].sx).toBeGreaterThan((2 * 10) / Math.sqrt(3));
  });
});

describe('board screw covers', () => {
  const board = (o: Partial<SkadisOptions>, attachments: PlacedAttachment[] = []): NamedDrawer => ({
    id: 'b',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, ...o }, attachments },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  });
  const plan = (d: NamedDrawer) => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
  const covers = (job: ReturnType<typeof plan>) => Object.values(job.parts).filter((p) => p.key.includes('cover:'));

  it('off by default: the board is as it was', () => {
    expect(DEFAULT_SKADIS.covers).toBe(false);
    expect(sanitizeSkadis(undefined).covers).toBe(false);
    expect(coverHole(DEFAULT_SKADIS)).toBeNull();
    const job = plan(board({}));
    expect(covers(job)).toEqual([]);
    expect(job.drawers[0].enclosure!.info.skadis!.covers).toBeUndefined();
    const o = sanitizeSkadis(DEFAULT_SKADIS);
    for (const s of skadisTileSpecs(planSkadis(o, [{ w: 256, d: 256 }]), o)) expect(s.cover).toBeUndefined();
  });

  it('on: a cover for every screw, counted with the board parts, a step and a line on the map', () => {
    const job = plan(board({ covers: true }));
    const info = job.drawers[0].enclosure!.info.skadis!;
    const list = covers(job);
    expect(list.length).toBe(info.screws);
    expect(info.covers).toBe(info.screws);
    expect(list[0].name).toBe('Screw cover 1');
    expect(job.warnings).toEqual([]);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of list) expect(onPlates.has(p.key), p.key).toBe(true);
    expect(job.drawers[0].steps.join('\n')).toMatch(/cover onto each of the \d+ screw heads/);
    expect(job.drawers[0].map).toMatch(/Screw covers: \d+/);
    // Without posts behind the screws there is nothing to sink the head into: none, and a warning.
    const spacers = plan(board({ covers: true, standoff: 'spacers' }));
    expect(covers(spacers)).toEqual([]);
    expect(spacers.warnings.join()).toMatch(/Screw covers need/);
    expect(covers(plan(board({ covers: true, hang: 'cleat' })))).toEqual([]);
    // Hexagons are screwed through their side corners' posts: covers for those.
    const hex = plan(board({ covers: true, shape: 'hex' }));
    expect(hex.warnings).toEqual([]);
    expect(covers(hex).length).toBe(hex.drawers[0].enclosure!.info.skadis!.screws);
    expect(covers(hex).length).toBeGreaterThan(0);
    expect(coverHole({ ...DEFAULT_SKADIS, covers: true, screw: 6 })).toBeNull();
  });

  it('the cap prints clean, cap down', () => {
    const hole = coverHole({ ...DEFAULT_SKADIS, covers: true })!;
    const cap = skadisCapPart(hole);
    const mesh = buildSkadisCap(w, cap);
    expect(checkPart(w, mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang')).toEqual([]);
    const mb = meshBounds(mesh);
    const size = capSize(cap);
    expect([mb.max[0] - mb.min[0], mb.max[1] - mb.min[1], mb.max[2] - mb.min[2]].map((v) => Math.round(v * 100) / 100)).toEqual([size.w, size.d, size.h]);
    // ~14 mm over the hole's mouth, its legs short of the screw head.
    expect(cap.d).toBe(14);
    expect(cap.d / 2).toBeGreaterThan(hole.r + 2);
    expect(cap.legs).toBeLessThan(hole.sink + (hole.groove - headDiameter(DEFAULT_SKADIS.screw) / 2) - 0.3);
    // The barb is wider than the mouth (it clicks in) and narrower than the groove (it sits free).
    expect(cap.barb).toBeGreaterThan(hole.r + 0.2);
    expect(cap.barb).toBeLessThan(hole.groove);
  });

  it('snaps into the hole made for it, and can’t be pulled straight out', () => {
    const o = sanitizeSkadis({ ...DEFAULT_SKADIS, width: 160, height: 160, covers: true });
    const p = planSkadis(o, [{ w: 256, d: 256 }]);
    expect(p.tiles).toHaveLength(1);
    const [spec] = skadisTileSpecs(p, o);
    expect(spec.cover).toBeDefined();
    const tile = toManifold(buildSkadisTile(w, spec));
    expect(checkPart(w, buildSkadisTile(w, spec)).issues.filter((i) => i.severity === 'error')).toEqual([]);
    // Face down: x mirrored (the tile is 160 wide), the front on the bed, deeper is up.
    const m = spec.mounts.find((q) => q.screw)!;
    const at: [number, number] = [160 - m.x, m.y];
    const cap = skadisCapPart(spec.cover!);
    const placed = (dz: number) => keep(toManifold(buildSkadisCap(w, cap)).translate([at[0] - cap.d / 2, at[1] - cap.d / 2, -cap.t + dz]));
    // Seated, its legs in the groove: it touches nothing (its face on the board's front).
    expect(overlap(tile, placed(0))).toBeLessThan(0.05);
    // Pulled out 0.5 mm, the barb meets the mouth.
    expect(overlap(tile, placed(-0.5))).toBeGreaterThan(0.5);
    // The screw head sits under the legs, in the post: a head ⌀ wide, from where it seats.
    const head = headDiameter(o.screw) / 2;
    const seat = spec.cover!.sink + spec.cover!.groove - head;
    expect(overlap(tile, barZ(seat + 0.05, seat + 1, head - 0.1, at[0], at[1], head - 0.1 - 0.95))).toBeLessThan(0.02);
    expect(seat).toBeGreaterThan(cap.legs);
    expect(seat + head - (o.screw + SKADIS.screwClear) / 2).toBeLessThan(o.thickness + o.depth);
  });
});

describe('on a board', () => {
  it('the new kinds place on a 560 × 560 board without warnings, the coupons and screw covers printing too', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('rail', 'batteryDock', 60, 520, { count: 2 }),
      a('drill', 'toolDock', 260, 520),
      a('charger', 'chargerCradle', 420, 520),
      a('stem', 'batteryDock', 40, 380, { mode: 'stem', packW: 74, packD: 54, packL: 100 }),
      a('pocket', 'batteryDock', 160, 380, { mode: 'body' }),
      a('sockets', 'toolRack', 300, 380, { mode: 'sockets' }),
      a('index', 'toolRack', 60, 240, { mode: 'index' }),
      a('upright', 'chargerCradle', 300, 240, { stand: 'upright', cord: 'side' }),
    ];
    const d: NamedDrawer = {
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560, covers: true }, attachments: list },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    };
    const job = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.every((p) => p.ok)).toBe(true);
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // The rail dock prints its three fit coupons.
    expect(parts).toHaveLength(list.length + 3);
    expect(Object.values(job.parts).filter((p) => p.key.includes('cover:')).length).toBe(job.drawers[0].enclosure!.info.skadis!.screws);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
