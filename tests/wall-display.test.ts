import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec2, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentPart, type AttachmentPreset, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { ccw, partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { RACK_BACK, rackPlan, type SlotRackOptions } from '../src/lib/wall/kinds/slotRack';
import { rackPoint, rackSlot } from '../src/lib/wall/kinds/slotRack.geom';
import { LEDGE, STUDS, ledgePlan, type DisplayLedgeOptions } from '../src/lib/wall/kinds/displayLedge';
import { LEDGE_FIT, ledgeSpots, ledgeTier } from '../src/lib/wall/kinds/displayLedge.geom';
import { LUG, POT, potPlan, type PlanterOptions } from '../src/lib/wall/kinds/planter';
import { tubeAt } from '../src/lib/wall/kinds/planter.geom';
import { CADDY, caddyPlan, type CaddyOptions } from '../src/lib/wall/kinds/caddy';
import { HOOK, cleatTop } from '../src/lib/wall/kinds/caddy.geom';
import { FACEOUT, faceoutPlan, type FaceoutOptions } from '../src/lib/wall/kinds/faceout';
import { faceoutNotches } from '../src/lib/wall/kinds/faceout.geom';
import { SHELF, SHELF_BACK, type ShelfOptions } from '../src/lib/wall/kinds/shelf';
import { shelfDepthAt } from '../src/lib/wall/kinds/shelf.geom';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const SLOW = 300_000;

// Every Manifold a test makes, freed after it.
let live: Manifold[] = [];
const keep = (m: Manifold) => (live.push(m), m);
afterEach(() => {
  const all = new Set(live);
  live = [];
  for (const m of all) m.delete();
});

const def = (type: string) => attachmentDef(type)!;
const toManifold = (mesh: MeshData) => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
/** Turn a printed mesh the way it sits and move its min corner to `at`. */
const put = (mesh: MeshData, turn: Vec3, at: Vec3) => {
  const r = keep(toManifold(mesh).rotate(turn));
  const b = r.boundingBox();
  return keep(r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]));
};
const bodyMesh = (type: string, o: object) => buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout: def(type).layout(o, CTX), ctx: CTX });
const partMesh = (type: string, p: AttachmentPart) => buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
/** A kind's body as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
function inFrame(type: string, o: object): Manifold {
  const layout = def(type).layout(o, CTX);
  const b = partBounds(layout, CTX);
  return put(bodyMesh(type, o), viewTurn(layout.pose), [b.x0, b.y0, b.z0]);
}
/** An extra part where it sits. */
const placed = (type: string, p: AttachmentPart) => put(partMesh(type, p), p.place!.turn, p.place!.at);
const shared = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();
const moved = (m: Manifold, v: Vec3) => keep(m.translate(v));
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  keep(keep(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
/** A side view in (z, y) extruded across x0..x1. */
const sideBar = (pts: Vec2[], x0: number, x1: number) =>
  keep(keep(keep(w.Manifold.extrude([ccw(pts.map(([z, y]) => [-z, y] as Vec2))], x1 - x0)).rotate([0, 90, 0])).translate([x0, 0, 0]));
/** A cylinder standing on y0, `h` tall (r0 at its foot, r1 at its top), its axis at (x, z). */
const post = (x: number, z: number, y0: number, h: number, r0: number, r1 = r0) =>
  keep(keep(keep(w.Manifold.cylinder(h, r0, r1, 96)).rotate([-90, 0, 0])).translate([x, y0, z]));

/** Print errors, and overhangs: everything self-supporting as printed. */
const faults = (mesh: MeshData) => checkPart(w, mesh).issues.filter((i) => i.severity === 'error' || i.kind === 'overhang');
const size = (mesh: MeshData) => {
  const b = meshBounds(mesh);
  return [0, 1, 2].map((k) => b.max[k] - b.min[k]);
};
const expectSize = (got: number[], want: number[], what: string) => got.forEach((v, k) => expect(v, `${what} [${k}]`).toBeCloseTo(want[k], 1));

/** Builds clean (no errors or overhangs) at the planned size, and so does every extra part. */
function expectBuilds(type: string, raw: object) {
  const what = `${type} ${JSON.stringify(raw)}`;
  const d = def(type);
  const o = d.sanitize(raw);
  const layout = d.layout(o, CTX);
  const mesh = bodyMesh(type, o);
  expect(faults(mesh), what).toEqual([]);
  const want = printedSize(layout, CTX);
  expectSize(size(mesh), [want.w, want.d, want.h], what);
  for (const p of d.parts?.(o, CTX) ?? []) {
    const pm = partMesh(type, p);
    expect(faults(pm), `${what} ${p.key}`).toEqual([]);
    expectSize(size(pm), [p.w, p.d, p.h], `${what} ${p.key}`);
  }
}

const presets = (type: string): AttachmentPreset[] => {
  const f = attachmentUi(type)!.fields.find((x) => x.kind === 'preset');
  return f && f.kind === 'preset' ? f.presets : [];
};
/** Defaults, every preset, and the option sets given: each builds clean, and the presets say nothing's off. */
function expectAll(type: string, others: object[]) {
  const d = def(type);
  expect(presets(type).length, type).toBeGreaterThan(2);
  for (const p of presets(type)) {
    const o = d.sanitize({ ...d.defaults, ...p.set });
    expect(d.notes?.(o, CTX) ?? [], `${type} ${p.value}`).toEqual([]);
    expectBuilds(type, o);
  }
  for (const o of [{}, ...others]) expectBuilds(type, o);
}

const board = (attachments: PlacedAttachment[]): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });

// ---------------------------------------------------------------------------

describe('slot rack', () => {
  const opts = (o: Partial<SlotRackOptions> = {}) => def('slotRack').sanitize(o) as SlotRackOptions;

  it(
    'builds clean at its defaults, every preset and other options, as big as planned',
    () =>
      expectAll('slotRack', [
        { tilt: 0, floor: 'drain', notch: false, count: 1, slot: 30 },
        { tilt: 25, slot: 2, count: 12, width: 30, height: 15, lip: 5 },
        { slot: 60, count: 2, height: 150, width: 240, floor: 'drain', lip: 150 },
      ]),
    SLOW,
  );

  it('a thing in each slot stands on the floor against the divider behind, clear of the rest', () => {
    for (const o of [opts(), opts({ tilt: 20, slot: 24, count: 3, floor: 'drain' }), opts({ tilt: 0, slot: 3, count: 6 })]) {
      const rack = inFrame('slotRack', o);
      const p = rackPlan(o);
      const U: Vec3 = [0, Math.sin(p.a), Math.cos(p.a)];
      const V: Vec3 = [0, Math.cos(p.a), -Math.sin(p.a)];
      const along = (m: Manifold, v: Vec3, d: number) => moved(m, [v[0] * d, v[1] * d, v[2] * d]);
      for (let k = 0; k < o.count; k++) {
        const { u0, v0 } = rackSlot(o, k);
        // As thick as the slot less 0.6, leaning with the dividers, sticking out 40 either side of the rack and 100 above it.
        const thing = sideBar(
          [
            rackPoint(o, u0 + 0.3, v0 + 0.3),
            rackPoint(o, u0 + o.slot - 0.3, v0 + 0.3),
            rackPoint(o, u0 + o.slot - 0.3, v0 + o.height + 100),
            rackPoint(o, u0 + 0.3, v0 + o.height + 100),
          ],
          -40,
          o.width + 40,
        );
        expect(shared(rack, thing), `${k}`).toBeLessThan(0.02);
        // Down onto the floor, back onto the divider behind, out onto the one in front.
        expect(shared(rack, along(thing, V, -0.5))).toBeGreaterThan(0.1);
        expect(shared(rack, along(thing, U, -0.5))).toBeGreaterThan(0.1);
        expect(shared(rack, along(thing, U, 0.5))).toBeGreaterThan(0.1);
      }
    }
  });

  it('leans back, each floor square to its dividers; the front wall lower than them', () => {
    const o = opts({ tilt: 15, lip: 20, notch: false });
    const p = rackPlan(o);
    const rack = inFrame('slotRack', o);
    expect(p.top).toBeCloseTo(p.f + o.height, 9);
    expect(p.front).toBeCloseTo(p.f + o.slot * Math.sin(p.a) + 20, 9);
    // A wall square to the slots at run u: its middle at height y.
    const wallAt = (u: number, y: number) => p.z0 + u / Math.cos(p.a) - (y - p.f) * Math.tan(p.a);
    // The front wall: there up to its top, gone above it, where the dividers carry on.
    const { u0 } = rackSlot(o, o.count - 1);
    const zw = wallAt(p.u - p.t / 2, p.front - 1.75);
    expect(shared(rack, box(20, p.front - 2, zw - 0.3, 40, p.front - 1.5, zw + 0.3))).toBeGreaterThan(0.5 * 20 * 0.5 * 0.6);
    expect(shared(rack, box(20, p.front + 1, zw - 3, 40, p.top + 1, p.depth + 1))).toBeLessThan(0.01);
    const zd = wallAt(u0 - p.t / 2, p.top - 2.25);
    expect(shared(rack, box(20, p.top - 2.5, zd - 0.3, 40, p.top - 2, zd + 0.3))).toBeGreaterThan(0.5 * 20 * 0.5 * 0.6);
    // It meets the back plate at the dividers' tops: the first slot's back reaches the plate there, and behind the first divider it's hollow.
    expect(rackPoint(o, 0, (p.top - p.f) / Math.cos(p.a))[0]).toBeCloseTo(RACK_BACK, 6);
    expect(shared(rack, box(20, p.f + 1, RACK_BACK + 0.5, 40, p.f + 5, wallAt(-p.t, p.f + 5) - 0.5))).toBeLessThan(0.01);
    const z0 = wallAt(-p.t, p.f + 1) + 0.2;
    const z1 = wallAt(0, p.f + 5) - 0.2;
    expect(shared(rack, box(20, p.f + 1, z0, 40, p.f + 5, z1))).toBeCloseTo(20 * 4 * (z1 - z0), 1);
    // Its foot reaches out as far as planned.
    expect(def('slotRack').layout(o, CTX).depth).toBeCloseTo(rackPoint(o, p.u, -(p.f + p.u * Math.sin(p.a)) / Math.cos(p.a))[0], 6);
  });

  it('drain holes go through the floors; the finger notch cuts the dividers, not the back plate', () => {
    const base = { slot: 20, count: 3, notch: false };
    const solid = inFrame('slotRack', opts(base));
    const drain = inFrame('slotRack', opts({ ...base, floor: 'drain' }));
    const notch = inFrame('slotRack', opts({ ...base, notch: true }));
    const o = opts(base);
    const p = rackPlan(o);
    const floor = () => box(0, 0, RACK_BACK + 1, o.width, p.f, p.depth);
    expect(shared(drain, floor())).toBeLessThan(shared(solid, floor()) - 500);
    const back = () => box(0, 0, 0, o.width, p.top, RACK_BACK);
    expect(shared(notch, back())).toBeCloseTo(shared(solid, back()), 0);
    // In front of the first divider (it leans back into the back plate and stays whole).
    const tops = () => box(o.width / 2 - 5, p.top - 10, RACK_BACK + 2, o.width / 2 + 5, p.top, p.depth);
    expect(shared(notch, tops())).toBeLessThan(0.01);
    expect(shared(solid, tops())).toBeGreaterThan(100);
  });

  it("a short rack builds, its finger notch's round end below the dividers' tops", () => {
    // A random audit: these threw InvalidConstruction (the notch's radius was more than its depth).
    for (const raw of [
      { count: 2, slot: 49, height: 28.8, notch: true },
      { count: 2, height: 28, tilt: 15.5 },
    ]) {
      const what = JSON.stringify(raw);
      const o = opts({ ...def('slotRack').defaults, ...raw });
      const mesh = bodyMesh('slotRack', o);
      expect(checkPart(w, mesh).issues.filter((i) => i.severity === 'error'), what).toEqual([]);
      // The notch is still cut.
      expect(toManifold(mesh).volume(), what).toBeLessThan(toManifold(bodyMesh('slotRack', { ...o, notch: false })).volume() - 100);
    }
  });

  it('names itself and says when it reaches out too far for its back', () => {
    const d = def('slotRack');
    expect(d.summary(opts())).toBe('Slot rack 4 × 12 mm');
    expect(d.summary(opts({ count: 6, slot: 2.5 }))).toBe('Slot rack 6 × 2.5 mm');
    expect(d.notes!(opts(), CTX)).toEqual([]);
    expect(d.notes!(opts({ count: 8, slot: 40, height: 20 }), CTX).join()).toMatch(/three times/);
    expect(d.hardware).toBeUndefined();
    expect(attachmentUi('slotRack')?.group).toBe('storage');
    // Upright, clips across the top and studs below.
    const l = d.layout(opts({ slot: 24, count: 2, height: 80, width: 160 }), CTX);
    expect(l.pose).toBe('upright');
    expect(l.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(3);
    expect(l.mounts.some((m) => m.kind === 'stud')).toBe(true);
  });
});

describe('display ledge', () => {
  const opts = (o: Partial<DisplayLedgeOptions> = {}) => def('displayLedge').sanitize(o) as DisplayLedgeOptions;

  it(
    'builds clean at its defaults, every preset and other options, as big as planned',
    () =>
      expectAll('displayLedge', [
        { mode: 'bases', lip: 6, tiers: 1, base: 60, columns: 3 },
        { mode: 'studs', system: 'duplo', tol: 0.1, tiers: 4, rise: 10, columns: 4, rows: 3, lip: 4 },
        { mode: 'cars', recess: 0, columns: 1, tiers: 6, rise: 6 },
        { mode: 'steps', recess: 4, lip: 20, tiers: 2, rise: 80 },
      ]),
    SLOW,
  );

  it('studs on the pitch, their diameter as tuned', () => {
    for (const [system, tol] of [
      ['lego', 0],
      ['lego', 0.1],
      ['duplo', -0.1],
    ] as const) {
      const o = opts({ system, tol, columns: 6, rows: 2, tiers: 2 });
      const S = STUDS[system];
      // Slice through the top tier's studs: printed upright, print z is wall y.
      const top = ledgeTier(o, 1).y;
      const m = toManifold(bodyMesh('displayLedge', o));
      const cut = m.slice(top + S.h / 2);
      // The studs: round pieces as wide as one.
      const above = cut.decompose().filter((c) => {
        const b = c.bounds();
        return Math.abs(b.max[0] - b.min[0] - S.d) < 0.5 && Math.abs(b.max[1] - b.min[1] - S.d) < 0.5;
      });
      expect(above.length, `${system} ${tol}`).toBe(12);
      const r = (S.d + tol) / 2;
      // A 32-gon's area.
      for (const c of above) expect(c.area()).toBeCloseTo(16 * r * r * Math.sin(Math.PI / 16), 2);
      const xs = [...new Set(above.map((c) => +((c.bounds().min[0] + c.bounds().max[0]) / 2).toFixed(2)))].sort((a, b) => a - b);
      expect(xs).toHaveLength(6);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(S.pitch, 2);
      for (const c of above) c.delete();
      cut.delete();
    }
  });

  it('a fit coupon: three 2 × 2 patches 0.05 mm apart, one, two and three notches', () => {
    const o = opts({ tol: 0.05 });
    const [coupon] = def('displayLedge').parts!(o, CTX);
    expect(coupon).toMatchObject({ key: 'coupon', w: 52, d: 16, h: 4.9 });
    const m = toManifold(partMesh('displayLedge', coupon));
    const studs = m.slice(3.2 + 0.85);
    const pieces = studs.decompose();
    expect(pieces).toHaveLength(12);
    const radii = pieces
      .map((c) => ({ x: (c.bounds().min[0] + c.bounds().max[0]) / 2, r: Math.sqrt(c.area() / (16 * Math.sin(Math.PI / 16))) }))
      .sort((a, b) => a.x - b.x);
    for (let g = 0; g < 3; g++) for (const s of radii.slice(4 * g, 4 * g + 4)) expect(2 * s.r).toBeCloseTo(4.8 + 0.05 + (g - 1) * 0.05, 3);
    // The notches along its front edge.
    const plate = m.slice(1.6);
    const strip = plate.intersect(w.CrossSection.square([60, 0.3]).translate([-1, 0]));
    const bits = strip.decompose().map((c) => c.bounds());
    expect(bits).toHaveLength(7);
    const gaps = bits
      .sort((a, b) => a.min[0] - b.min[0])
      .slice(1)
      .map((b) => b.min[0]);
    const group = (x: number) => Math.floor(x / 18);
    expect([0, 1, 2].map((g) => gaps.filter((x) => group(x) === g).length)).toEqual([1, 2, 3]);
    for (const c of [...pieces, studs, plate, strip]) c.delete();
    // Only a stud ledge has one.
    expect(def('displayLedge').parts!(opts({ mode: 'bases' }), CTX)).toEqual([]);
  });

  it('each tier a step up and back on its riser, hollow underneath in cells with short bridges', () => {
    const o = opts({ mode: 'steps', recess: 0, tiers: 3, rise: 30, itemD: 40 });
    const p = ledgePlan(o);
    const t = p.t;
    const m = inFrame('displayLedge', o);
    for (let k = 0; k < 3; k++) {
      const { y, nose } = ledgeTier(o, k);
      expect(nose).toBeCloseTo(LEDGE.back + (3 - k) * p.tread, 9);
      // The tread: solid just under its top, clear just over it.
      expect(shared(m, box(10, y - 0.5, nose - p.tread + 2, 30, y - 0.1, nose - 2))).toBeCloseTo(20 * 0.4 * (p.tread - 4), 0);
      expect(shared(m, box(10, y + 0.1, nose - p.tread + 2, 30, y + 5, nose - 2))).toBeLessThan(0.01);
      if (k === 0) continue;
      // Its riser stands on the bed.
      expect(shared(m, box(10, 0, nose - t + 0.2, 30, y - 0.2, nose - 0.2))).toBeCloseTo(20 * (y - 0.2) * (t - 0.4), 0);
      // Under the tread: cells at most 20 wide, hollow, their ceilings bridging at most 8 mm between 45° fillets.
      const zb = k === 2 ? LEDGE.back : ledgeTier(o, k + 1).nose;
      const zf = nose - t;
      const n = Math.ceil((zf - zb + t) / (LEDGE.cell + t));
      const cw = (zf - zb - (n - 1) * t) / n;
      expect(n).toBe(2);
      expect(cw).toBeLessThanOrEqual(LEDGE.cell);
      const yc = y - t;
      for (let i = 0; i < n; i++) {
        const zm = zb + i * (cw + t) + cw / 2;
        expect(shared(m, box(10, 1, zm - cw / 2 + 0.2, 30, yc / 2, zm + cw / 2 - 0.2)), `${k} ${i}`).toBeLessThan(0.01);
        expect(shared(m, box(10, yc - 1, zm - LEDGE.bridge / 2 + 0.2, 30, yc - 0.1, zm + LEDGE.bridge / 2 - 0.2))).toBeLessThan(0.01);
        // A fillet in each corner: 2 mm in from the cell's wall, solid from 2 mm under the ceiling.
        expect(shared(m, box(10, yc - 1.8, zm - cw / 2, 30, yc, zm - cw / 2 + 1.8))).toBeGreaterThan(20 * 1.8 * 1.8 * 0.5);
        expect(shared(m, box(10, yc - 1.8, zm + cw / 2 - 1.8, 30, yc, zm + cw / 2))).toBeGreaterThan(20 * 1.8 * 1.8 * 0.5);
      }
    }
  });

  it('a base sits in its socket and a car in its pocket: clear seated, caught when pushed', () => {
    const bases = opts({ mode: 'bases', base: 32, columns: 3, recess: 2 });
    const ledge = inFrame('displayLedge', bases);
    const { y } = ledgeTier(bases, 0);
    const { x, z } = ledgeSpots(bases, 0);
    const disc = post(x[1], z[0], y - bases.recess + 0.05, 4, 16);
    expect(shared(ledge, disc)).toBeLessThan(0.02);
    expect(shared(ledge, moved(disc, [LEDGE_FIT.socket + 0.2, 0, 0]))).toBeGreaterThan(0.05);
    expect(shared(ledge, moved(disc, [0, 0, -LEDGE_FIT.socket - 0.2]))).toBeGreaterThan(0.05);
    const cars = opts({ mode: 'cars', columns: 2 });
    const shelf = inFrame('displayLedge', cars);
    const t = ledgeTier(cars, 1);
    const s = ledgeSpots(cars, 1);
    const car = box(s.x[0] - 37.5, t.y - cars.recess + 0.05, s.z[0] - 16, s.x[0] + 37.5, t.y + 25, s.z[0] + 16);
    expect(shared(shelf, car)).toBeLessThan(0.02);
    expect(shared(shelf, moved(car, [0.7, 0, 0]))).toBeGreaterThan(0.05);
    expect(shared(shelf, moved(car, [0, 0, 0.7]))).toBeGreaterThan(0.05);
  });

  it('names itself, and says when it reaches out too far for its back', () => {
    const d = def('displayLedge');
    expect(d.summary(opts())).toBe('LEGO stud ledge 12 × 2, 2 tiers');
    expect(d.summary(opts({ system: 'duplo', tiers: 1 }))).toBe('Duplo stud ledge 12 × 2');
    expect(d.summary(opts({ mode: 'bases', base: 28.5, columns: 6, tiers: 3 }))).toBe('Base display ⌀28.5 × 6, 3 tiers');
    expect(d.summary(opts({ mode: 'steps', columns: 2 }))).toBe('Display steps 2 wide, 2 tiers');
    expect(d.notes!(opts(), CTX)).toEqual([]);
    expect(d.notes!(opts({ mode: 'steps', itemD: 120, tiers: 4, rise: 6 }), CTX).join()).toMatch(/three times/);
    expect(attachmentUi('displayLedge')?.group).toBe('display');
    expect(opts({ tol: 0.3 }).tol).toBe(0.1);
  });
});

describe('planter', () => {
  const opts = (o: Partial<PlanterOptions> = {}) => def('planter').sanitize(o) as PlanterOptions;
  const saucer = (o: PlanterOptions) => placed('planter', def('planter').parts!(o, CTX)[0]);
  /** Turn a solid about the round pot's axis. */
  const turned = (m: Manifold, o: PlanterOptions, deg: number) => {
    const p = potPlan(o);
    return keep(keep(keep(m.translate([-p.cx, 0, -p.cz])).rotate([0, deg, 0])).translate([p.cx, 0, p.cz]));
  };

  it(
    'builds clean at its defaults, every preset and other options, as big as planned',
    () =>
      expectAll('planter', [
        { shape: 'round', size: 160, potH: 200 },
        { shape: 'square', size: 40, potH: 30 },
        { mode: 'tubes', tube: 10, tubeLen: 60, count: 1 },
        { mode: 'tubes', tube: 32, tubeLen: 200, count: 3 },
      ]),
    SLOW,
  );

  it('round: the saucer twists in from below, held up by its lugs, out only turned back to the slots', () => {
    for (const size of [52, 102]) {
      const o = opts({ size, potH: size });
      const body = inFrame('planter', o);
      const dish = saucer(o);
      expect(shared(body, dish), `${size}`).toBeLessThan(0.02);
      // Held: it can't drop, and turned a little either way it still sits on the slots' floors.
      expect(shared(body, moved(dish, [0, -0.5, 0]))).toBeGreaterThan(0.05);
      expect(shared(body, moved(turned(dish, o, -LUG.turn / 2), [0, -0.5, 0]))).toBeGreaterThan(0.05);
      // Past its stop it runs into the slots' ends.
      expect(shared(body, turned(dish, o, 3))).toBeGreaterThan(0.05);
      // Turned back to the slots, it drops out.
      const back = turned(dish, o, -LUG.turn);
      expect(shared(body, back)).toBeLessThan(0.02);
      for (const d of [1, 4, 8, POT.saucer + 1]) expect(shared(body, moved(back, [0, -d, 0])), `down ${d}`).toBeLessThan(0.02);
    }
  });

  it('square: the tray slides out of the front and nowhere else', () => {
    const o = opts({ shape: 'square', size: 85, potH: 104 });
    const p = potPlan(o);
    const body = inFrame('planter', o);
    const tray = saucer(o);
    expect(shared(body, tray)).toBeLessThan(0.02);
    for (const d of [10, 40, p.si + 5]) expect(shared(body, moved(tray, [0, 0, d])), `out ${d}`).toBeLessThan(0.02);
    expect(shared(body, moved(tray, [0, 0, -0.6]))).toBeGreaterThan(0.05);
    expect(shared(body, moved(tray, [0.6, 0, 0]))).toBeGreaterThan(0.05);
    expect(shared(body, moved(tray, [-0.6, 0, 0]))).toBeGreaterThan(0.05);
    expect(shared(body, moved(tray, [0, -0.2, 0]))).toBeGreaterThan(0.05);
  });

  it('a pot hangs by its rim on the sleeve, clear of the saucer', () => {
    for (const o of [opts({ size: 77, potH: 70 }), opts({ shape: 'square', size: 85, potH: 104 })]) {
      const p = potPlan(o);
      const body = inFrame('planter', o);
      const dish = saucer(o);
      // A tapered pot, its rim 3 mm deep resting on the sleeve's top edge.
      const H = def('planter').layout(o, CTX).h;
      const top = o.size / 2 - POT.grip - 0.3;
      let pot: Manifold;
      if (o.shape === 'round') pot = keep(post(p.cx, p.cz, H - o.potH, o.potH, 0.75 * top, top).add(post(p.cx, p.cz, H + 0.05, 3, o.size / 2)));
      else {
        const x0 = POT.wall;
        const half = p.si / 2 - 0.3;
        const c: Vec3 = [x0 + p.si / 2, 0, p.z0 + p.si / 2];
        pot = keep(
          box(c[0] - 0.75 * half, H - o.potH, c[2] - 0.75 * half, c[0] + 0.75 * half, H - o.potH + 1, c[2] + 0.75 * half)
            .add(box(c[0] - half, H - 20, c[2] - half, c[0] + half, H, c[2] + half))
            .add(box(c[0] - o.size / 2, H + 0.05, c[2] - o.size / 2, c[0] + o.size / 2, H + 3, c[2] + o.size / 2)),
        );
      }
      expect(shared(body, pot), o.shape).toBeLessThan(0.02);
      expect(shared(dish, pot), o.shape).toBe(0);
      expect(shared(body, moved(pot, [0, -0.5, 0])), o.shape).toBeGreaterThan(0.1);
      // Its bottom over the saucer's rim.
      expect(H - o.potH - (o.shape === 'round' ? 0 : POT.floor) - POT.saucer).toBeCloseTo(POT.room, 9);
    }
  });

  it('test tubes stand in cups at the foot and through square holes in the ledge', () => {
    const o = opts({ mode: 'tubes', tube: 20, tubeLen: 150, count: 4 });
    const p = potPlan(o);
    const rack = inFrame('planter', o);
    for (let i = 0; i < 4; i++) {
      const [x, z] = tubeAt(o, i);
      const tube = post(x, z, 3.05, o.tubeLen, o.tube / 2);
      expect(shared(rack, tube), `${i}`).toBeLessThan(0.02);
      expect(shared(rack, moved(tube, [0.6, 0, 0]))).toBeGreaterThan(0.05);
      expect(shared(rack, moved(tube, [0, 0, 0.6]))).toBeGreaterThan(0.05);
      // It stands on the cup's floor, and the ledge holds it most of the way up.
      expect(shared(rack, moved(tube, [0, -0.1, 0]))).toBeGreaterThan(0.01);
    }
    expect(p.h).toBeCloseTo(3 + 0.55 * o.tubeLen, 9);
    expect(def('planter').hardware!(o)).toEqual([{ item: 'Test tube ⌀20 × 150', count: 4 }]);
  });

  it('names itself, notes and hardware', () => {
    const d = def('planter');
    expect(d.summary(opts())).toBe('Planter ⌀77');
    expect(d.summary(opts({ shape: 'square', size: 85 }))).toBe('Planter 85 × 85');
    expect(d.summary(opts({ mode: 'tubes' }))).toBe('Propagation rack, 5 × ⌀20');
    expect(d.notes!(opts(), CTX)).toEqual([]);
    expect(d.notes!(opts({ mode: 'tubes', tube: 16, count: 12 }), CTX).join()).toMatch(/Over 250 mm wide/);
    expect(d.hardware!(opts())).toEqual([]);
    expect(d.parts!(opts({ mode: 'tubes' }), CTX)).toEqual([]);
    expect(d.parts!(opts(), CTX).map((p) => p.name)).toEqual(['Saucer']);
    expect(d.parts!(opts({ shape: 'square' }), CTX).map((p) => p.name)).toEqual(['Drip tray']);
    expect(attachmentUi('planter')?.description).toMatch(/PETG/);
  });
});

describe('lift-off caddy', () => {
  const opts = (o: Partial<CaddyOptions> = {}) => def('caddy').sanitize(o) as CaddyOptions;
  const caddy = (o: CaddyOptions) => placed('caddy', def('caddy').parts!(o, CTX)[0]);

  it(
    'builds clean at its defaults, every preset and other options, as big as planned',
    () =>
      expectAll('caddy', [
        { width: 60, depth: 40, height: 35, handle: 0, dividers: 0 },
        { width: 240, depth: 150, height: 150, handle: 100, dividers: 8 },
      ]),
    SLOW,
  );

  it('hangs on the cleats clear of the dock, and only comes off lifted', () => {
    for (const o of [opts(), opts({ width: 60, height: 35, handle: 0 }), opts({ width: 240, depth: 150 })]) {
      const dock = inFrame('caddy', o);
      const c = caddy(o);
      const what = JSON.stringify(o);
      expect(shared(dock, c), what).toBeLessThan(0.02);
      // It can't slide forward or down, back or sideways.
      for (const v of [
        [0, 0, 1],
        [0, -0.7, 0],
        [0, 0, -0.7],
        [0.7, 0, 0],
        [-0.7, 0, 0],
      ] as Vec3[])
        expect(shared(dock, moved(c, v)), `${what} ${v}`).toBeGreaterThan(0.02);
      // Pulled forward lifted 6 mm, it catches on the way; lifted 8 mm it comes away.
      const caught = (lift: number) => Array.from({ length: 21 }, (_, d) => shared(dock, moved(c, [0, lift, d]))).some((v) => v > 0.02);
      expect(caught(6), what).toBe(true);
      expect(caught(8), what).toBe(false);
    }
  });

  it('its hooks drop behind the cleats: the weight wedges it toward the board', () => {
    const o = opts();
    const { y, z } = cleatTop(o);
    const p = caddyPlan(o);
    expect(z).toBe(CADDY.back + CADDY.cleat);
    // Hooks spread across; on the cleat's 45° top a hook pushed down moves toward the board.
    expect(p.hooks).toHaveLength(3);
    const c = caddy(o);
    // Over a cleat, the finger's underside runs down toward the board at 45°, 0.5 over the cleat's top.
    const x = p.hooks[1];
    const lowest = (z: number) => keep(c.intersect(box(x - 1, 0, z - 0.1, x + 1, 200, z + 0.1))).boundingBox().min[1];
    const back = CADDY.back + HOOK.back + 0.5;
    expect(lowest(back + 5) - lowest(back)).toBeCloseTo(5, 1);
    expect(lowest(back)).toBeCloseTo(y - (CADDY.back + CADDY.cleat - back) + HOOK.over - 0.1, 1);
  });

  it('names itself; the dock is as big on the wall as the caddy and its handle', () => {
    const d = def('caddy');
    const o = opts();
    expect(d.summary(o)).toBe('Lift-off caddy 160 × 90');
    expect(d.notes!(o, CTX)).toEqual([]);
    const l = d.layout(o, CTX);
    expect(l).toMatchObject({ w: 160, h: CADDY.foot + 70 + 50 + 2, depth: CADDY.back + CADDY.cleat, pose: 'upright' });
    expect(l.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(3);
    const [part] = d.parts!(o, CTX);
    expect(part).toMatchObject({ key: 'caddy', w: 160, h: 70 + 50, place: { at: [0, CADDY.foot, CADDY.back + CADDY.gap], turn: [-90, 0, 0] } });
    expect(attachmentUi('caddy')?.group).toBe('hobby');
  });
});

describe('faceout', () => {
  const opts = (o: Partial<FaceoutOptions> = {}) => def('faceout').sanitize(o) as FaceoutOptions;

  it(
    'builds clean at its defaults, every preset and other options, as big as planned',
    () =>
      expectAll('faceout', [
        { stopper: 'ball', notches: 12, length: 250, angle: 0, arm: 14, width: 16 },
        { length: 50, angle: 30, label: true, labelW: 80 },
        { stopper: 'none', angle: 0, length: 100, notches: 3 },
      ]),
    SLOW,
  );

  it('slopes up, stops things at its tip, and its notches hold a tab in place', () => {
    const o = opts({ notches: 5, length: 200, arm: 8 });
    const layout = def('faceout').layout(o, CTX);
    const p = faceoutPlan(o, CTX);
    const arm = inFrame('faceout', o);
    expect(layout.pose).toBe('side');
    expect(layout.mounts[0].kind).toBe('hook');
    expect(layout.h).toBeGreaterThanOrEqual(o.length / 3);
    // Its top rises with the angle (on one without notches).
    const plain = inFrame('faceout', opts({ length: 200, arm: 8 }));
    const topAt = (z: number) => keep(plain.intersect(box(0, -1, z - 0.2, o.width, 300, z + 0.2))).boundingBox().max[1];
    expect(topAt(100) - topAt(60)).toBeCloseTo(40 * Math.tan((10 * Math.PI) / 180), 1);
    // The upturned tip stands above the arm.
    expect(topAt(o.length - o.arm / 2)).toBeCloseTo(p.top(o.length) + p.tip, 1);
    // A hang tab's top bar in each notch: clear there, caught moved along.
    const n = faceoutNotches(o, layout.h, p);
    expect(n.z).toHaveLength(5);
    for (const z of n.z) {
      const tab = box(-6, p.top(z) - n.depth + 0.6, z - 0.4, o.width + 6, p.top(z) + 10, z + 0.4);
      expect(shared(arm, tab), `${z}`).toBeLessThan(0.02);
      expect(shared(arm, moved(tab, [0, 0, n.depth + 0.5]))).toBeGreaterThan(0.05);
      expect(shared(arm, moved(tab, [0, 0, -n.depth - 0.5]))).toBeGreaterThan(0.05);
    }
  });

  it('a label plate at the tip, beside the arm on the bed', () => {
    const o = opts({ label: true, labelW: 50 });
    const layout = def('faceout').layout(o, CTX);
    expect(layout.w).toBe(50);
    const arm = inFrame('faceout', o);
    const p = faceoutPlan(o, CTX);
    const z0 = o.length - FACEOUT.labelT;
    expect(shared(arm, box(30, p.bottom(z0) + 2, z0 + 0.2, 48, p.bottom(z0) + FACEOUT.labelH - 2, o.length - 0.2))).toBeCloseTo(18 * 21 * 2, 0);
    expect(def('faceout').hardware!(o)).toEqual([{ item: 'Label', count: 1, note: '50 × 25 mm' }]);
  });

  it('names itself and notes a long thin arm or nothing on the end', () => {
    const d = def('faceout');
    expect(d.summary(opts())).toBe('Faceout 150 mm');
    expect(d.summary(opts({ notches: 6 }))).toBe('Faceout 150 mm, 6 notches');
    expect(d.notes!(opts(), CTX)).toEqual([]);
    expect(d.notes!(opts({ length: 250, arm: 6 }), CTX).join()).toMatch(/bends/);
    expect(d.notes!(opts({ stopper: 'none', angle: 0 }), CTX).join()).toMatch(/Nothing keeps things on/);
    expect(d.hardware!(opts())).toEqual([]);
    expect(attachmentUi('faceout')?.group).toBe('display');
  });
});

describe('shelf shapes', () => {
  const opts = (o: Partial<ShelfOptions> = {}) => def('shelf').sanitize(o) as ShelfOptions;
  const SHAPES = ['rounded', 'hexagon', 'halfRound'] as const;

  it(
    'builds clean in every shape, with lips and drain slots, as big as planned',
    () => {
      for (const shape of SHAPES) {
        expectBuilds('shelf', { shape });
        expectBuilds('shelf', { shape, width: 240, depth: 160, height: 80, lip: 12, holes: 'slots' });
        expectBuilds('shelf', { shape, width: 60, depth: 30, lip: 0, floor: 5 });
      }
    },
    SLOW,
  );

  it('the floor follows the outline; nothing reaches past it', () => {
    for (const shape of ['rect', ...SHAPES] as const) {
      const o = opts({ shape, width: 200, depth: 120, lip: 0 });
      const m = toManifold(bodyMesh('shelf', o));
      // Printed upright, the floor is the first few mm: its area is the outline's.
      const floor = m.slice(1);
      let want = 0;
      for (let x = 0.05; x < 200; x += 0.1) want += 0.1 * shelfDepthAt(o, 200, x);
      expect(floor.area() / want, shape).toBeCloseTo(1, 2);
      floor.delete();
      // Over the floor near its ends, nothing past the outline.
      const hung = inFrame('shelf', o);
      for (const x of [1, 10, 100, 190, 199]) {
        const d = Math.max(shelfDepthAt(o, 200, x - 0.5), shelfDepthAt(o, 200, x + 0.5));
        expect(shared(hung, box(x - 0.5, 0, d + 0.3, x + 0.5, 60, 130)), `${shape} ${x}`).toBeLessThan(0.01);
      }
    }
    expect(shelfDepthAt(opts({ shape: 'halfRound' }), 160, 0)).toBeCloseTo(SHELF_BACK, 6);
    expect(shelfDepthAt(opts({ shape: 'hexagon', depth: 100 }), 160, 80)).toBe(100);
  });

  it('the lip runs round the front', () => {
    const o = opts({ shape: 'halfRound', width: 200, depth: 120, lip: 10 });
    const m = inFrame('shelf', o);
    const lipAt = (x: number) => {
      const d = shelfDepthAt(o, 200, x);
      return shared(m, box(x - 0.5, o.floor + 2, d - SHELF.lip + 0.3, x + 0.5, o.floor + 8, d - 0.3));
    };
    for (const x of [30, 100, 170]) expect(lipAt(x), `${x}`).toBeGreaterThan(0.5);
    // And none inside it.
    expect(shared(m, box(80, o.floor + 2, 40, 120, o.floor + 8, 100))).toBeLessThan(0.01);
    expect(def('shelf').summary(o)).toBe('Half-round shelf 200 × 120');
    expect(def('shelf').summary(opts())).toBe('Shelf 160 × 100');
  });
});

describe('on a board', () => {
  it(
    'all of them place on a 560 × 560 board without warnings, and their parts print',
    () => {
      const list: PlacedAttachment[] = [
        { id: 'r', type: 'slotRack', x: 80, y: 520, opts: {} },
        { id: 'l', type: 'displayLedge', x: 260, y: 520, opts: {} },
        { id: 'p', type: 'planter', x: 420, y: 520, opts: {} },
        { id: 'c', type: 'caddy', x: 60, y: 360, opts: {} },
        { id: 'f', type: 'faceout', x: 280, y: 360, opts: { label: true } },
        { id: 's', type: 'shelf', x: 400, y: 360, opts: { shape: 'halfRound', width: 140 } },
        { id: 't', type: 'planter', x: 60, y: 160, opts: { mode: 'tubes', count: 4 } },
        { id: 'q', type: 'planter', x: 220, y: 160, opts: { shape: 'square', size: 85, potH: 104 } },
        { id: 'b', type: 'displayLedge', x: 380, y: 160, opts: { mode: 'bases', columns: 4, tiers: 3 } },
      ];
      const job = plan(board(list));
      expect(job.warnings).toEqual([]);
      const wall = job.drawers[0].enclosure!.wall!;
      for (const p of wall.placed) expect(p.ok, p.id).toBe(true);
      // (Lock keys aside: the faceout hangs on a hook.)
      const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment' && !p.name.startsWith('Lock key'));
      // Nine bodies, the stud coupon, two saucers and the caddy.
      expect(parts).toHaveLength(9 + 1 + 2 + 1);
      // The extra parts that show in place do.
      const items = job.drawers[0].enclosure!.items.filter((i) => i.role === 'attachment' && !i.id.includes('-lock'));
      expect(items).toHaveLength(9 + 2 + 1);
    },
    SLOW,
  );
});
