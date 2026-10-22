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
import { roundedRectRing } from '../src/lib/geometry/shapes';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { ccw, partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { BOTTLE_RACK_DEFAULTS, RACK, bottleSpec, neckRadius, rackLip, rackPlan, type BottleRackOptions } from '../src/lib/wall/kinds/bottleRack';
import { STICK_RACK_DEFAULTS, listRows, stickSpec, type StickRackOptions } from '../src/lib/wall/kinds/stickRack';
import { HOLSTER, HOLSTER_DEFAULTS, holsterGeometry, obround, type HolsterOptions } from '../src/lib/wall/kinds/holster';
import { GRIP, GRIPPER_DEFAULTS, gripGeometry, type GripperOptions } from '../src/lib/wall/kinds/gripper';

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
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();
/** A rod of radius r along an axis through `at` leaning `deg` toward the front (negative: toward the board), from t0 to t1 along it. */
const rod = (at: Vec3, deg: number, r: number, t0: number, t1: number) =>
  keep(keep(keep(keep(w.Manifold.cylinder(t1 - t0, r, r, 96)).translate([0, 0, t0])).rotate([deg - 90, 0, 0])).translate(at));
/** A prism of a section (its +y toward the board) along the same kind of axis. */
const prism = (pts: Vec2[], at: Vec3, deg: number, t0: number, t1: number) =>
  keep(keep(keep(keep(w.Manifold.extrude([ccw(pts)], t1 - t0)).translate([0, 0, t0])).rotate([deg - 90, 0, 0])).translate(at));

interface Built {
  o: Record<string, unknown>;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

/** Build a kind with options and turn it back into its own frame. */
function build(type: string, opts: object = {}): Built {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts) as Record<string, unknown>;
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  const turned = keep(toManifold(mesh).rotate(viewTurn(layout.pose)));
  const bb = turned.boundingBox();
  const pb = partBounds(layout, CTX);
  const hung = keep(turned.translate([pb.x0 - bb.min[0], pb.y0 - bb.min[1], pb.z0 - bb.min[2]]));
  return { o, layout, mesh, hung };
}

/** No errors, no overhangs or islands (everything self-supporting as printed), and as big as planned. */
function expectClean(b: Built, what: string, layer = 0.2) {
  const c = checkPart(w, b.mesh, { layer });
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

/** Every preset of a kind's form builds clean (sliced in thicker layers: they only change sizes). */
function presetsBuild(type: string, base: object = {}) {
  const f = attachmentUi(type)!.fields.find((x) => x.kind === 'preset');
  expect(f?.kind).toBe('preset');
  if (f?.kind !== 'preset') return;
  for (const p of f.presets) expectClean(build(type, { ...base, ...p.set }), `${type} ${p.value}`, 0.4);
}

/** The back plate is whole: nothing cuts into it where the mounts are. */
function expectWholeBack(b: Built, back: number) {
  const { w: W, h: H } = b.layout;
  expect(overlap(b.hung, box(0, 0, 0, W, H, back))).toBeCloseTo(W * H * back, 0);
}

const bottle = (o: Partial<BottleRackOptions>) => ({ ...BOTTLE_RACK_DEFAULTS, ...o });
const sticks = (o: Partial<StickRackOptions>) => ({ ...STICK_RACK_DEFAULTS, ...o });

describe('bottle rack', () => {
  it('builds clean as planned: defaults, square, tilted, staggered, every bottom', () => {
    for (const o of [
      {},
      { shape: 'square', diameter: 28, corner: 4, rows: 2, columns: 4, floor: 'closed' },
      { tilt: 20, step: 10, floor: 'neck', columns: 4 },
      { stagger: true, rows: 4, columns: 4, tilt: 12, floor: 'ring', label: false },
      { diameter: 67, columns: 3, rows: 2, step: 25, cup: 60, wall: 2.4, tilt: 30, floor: 'closed' },
      // A closed floor's hollow leans back under a high back row: it still opens at the bed.
      { diameter: 6, columns: 1, rows: 2, step: 15, tilt: 23, floor: 'closed', cup: 40 },
    ]) {
      const b = build('bottleRack', o);
      expectClean(b, JSON.stringify(o));
      expectWholeBack(b, RACK.back);
      expect(b.layout.pose).toBe('upright');
    }
  }, 180_000);

  it('every preset builds clean', () => presetsBuild('bottleRack', { columns: 2, rows: 2 }), 300_000);

  it('rows step up toward the back, each one cup apart and a wall between', () => {
    const o = bottle({});
    const p = rackPlan(bottleSpec(o));
    const r = o.diameter / 2 + o.clearance;
    expect(p.cups).toHaveLength(18);
    expect([...new Set(p.cups.map((c) => c.y))]).toEqual([p.y0, p.y0 + 12, p.y0 + 24]);
    // Upright, the rows are a cup and a wall apart, the back row's cups against the back plate.
    expect([...new Set(p.cups.map((c) => Math.round(c.z * 100) / 100))]).toEqual(
      [3 + 3 * r + 2 * (r + o.wall), 3 + 2 * r + r + o.wall, 3 + r].map((v) => Math.round(v * 100) / 100),
    );
    expect(p.w).toBeCloseTo(6 * 2 * r + 7 * o.wall, 6);
    // Room for a stud row under the clips: a full rack is heavy.
    const b = build('bottleRack');
    expect(b.layout.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(4);
    expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
  });

  for (const o of [
    {},
    { tilt: 20, step: 8, stagger: true, rows: 4, columns: 5 },
    { shape: 'square', diameter: 28, tilt: 10 },
    { tilt: 30, step: 0, rows: 3, columns: 3 },
  ] as Partial<BottleRackOptions>[]) {
    it(`a bottle drops into every cup, rests on its floor and stays clear of the next rows: ${JSON.stringify(o)}`, () => {
      const b = build('bottleRack', o);
      const opts = b.o as unknown as BottleRackOptions;
      const p = rackPlan(bottleSpec(opts), b.layout.w);
      const R = opts.diameter / 2;
      // Bottles 80 tall in every cup (square jars: a square prism, its corners as round as the cups').
      const item = (c: (typeof p.cups)[number], r: number, t0: number, t1: number) =>
        opts.shape === 'round'
          ? rod([c.x, c.y, c.z], opts.tilt, r, t0, t1)
          : prism(roundedRectRing(-r, -r, r, r, opts.corner), [c.x, c.y, c.z], opts.tilt, t0, t1);
      const all = keep(w.Manifold.union(p.cups.map((c) => item(c, R, 0.05, 80))));
      expect(overlap(b.hung, all)).toBeLessThan(0.05);
      // None of the bottles touch each other.
      expect(all.volume()).toBeCloseTo(
        p.cups.reduce((t, c) => t + item(c, R, 0.05, 80).volume(), 0),
        0,
      );
      // Pushed 1 mm further down, a bottle meets its floor's lip; a bottle a hair bigger than the hole meets the cup.
      const c = p.cups[p.cups.length - 1];
      expect(overlap(b.hung, item(c, R, -1, 80))).toBeGreaterThan(20);
      expect(overlap(b.hung, item(c, R + opts.clearance + 0.1, 0.5, 80))).toBeGreaterThan(1);
    });
  }

  it('each bottom: a closed floor, a lip round a hole, a ring right through, a funnel for a cap', () => {
    const at = (b: Built) => {
      const c = rackPlan(bottleSpec(b.o as unknown as BottleRackOptions), b.layout.w).cups[0];
      return { c, at: [c.x, c.y, c.z] as Vec3 };
    };
    for (const tilt of [0, 20]) {
      const closed = build('bottleRack', { floor: 'closed', tilt, rows: 2, columns: 2 });
      const hole = build('bottleRack', { floor: 'hole', tilt, rows: 2, columns: 2 });
      const ring = build('bottleRack', { floor: 'ring', tilt, rows: 2, columns: 2 });
      const neck = build('bottleRack', { floor: 'neck', tilt, rows: 2, columns: 2 });
      const { c, at: a } = at(hole);
      // A rod up the middle from below the bed: stopped by the closed floor, through the hole, through the ring.
      expect(overlap(closed.hung, rod(a, tilt, 2, -60, -0.2))).toBeGreaterThan(1);
      expect(overlap(hole.hung, rod(a, tilt, c.r - rackLip(c.r) - 0.3, -60, 1))).toBeLessThan(0.05);
      expect(overlap(ring.hung, rod(a, tilt, 12.5, -60, 80))).toBeLessThan(0.05);
      // Upside down: the body rests in the funnel, the cap hangs through the neck hole.
      const n = at(neck);
      const rn = neckRadius(bottleSpec(neck.o as unknown as BottleRackOptions), n.c.r);
      expect(rn).toBeCloseTo(8.5 + 0.5, 6);
      expect(overlap(neck.hung, rod(n.at, tilt, 12.5, 0.05, 60))).toBeLessThan(0.05);
      expect(overlap(neck.hung, rod(n.at, tilt, 8.5, -(n.c.r - rn) - 25, 1))).toBeLessThan(0.05);
      expect(overlap(neck.hung, rod(n.at, tilt, 12.5, -1, 60))).toBeGreaterThan(5);
    }
  });

  it('the label strip faces up at 45° along the front', () => {
    const b = build('bottleRack');
    const none = build('bottleRack', { label: false });
    expect(b.layout.depth - none.layout.depth).toBeCloseTo(RACK.label, 6);
    // A thin slab just under the 45° face, 3 mm in front of the cups: all plastic; just over it, none.
    const p = rackPlan(bottleSpec(b.o as unknown as BottleRackOptions), b.layout.w);
    const z = p.zf - 3;
    expect(overlap(b.hung, box(10, 0, z - 0.5, b.layout.w - 10, 2.4, z))).toBeCloseTo((b.layout.w - 20) * 2.4 * 0.5, 0);
    expect(overlap(b.hung, box(10, 3.6, z - 0.5, b.layout.w - 10, 6, z))).toBeLessThan(0.01);
  });

  it('notes, summary', () => {
    const def = attachmentDef('bottleRack')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ diameter: 67, rows: 8, step: 0, cup: 30, columns: 2 }), CTX).join()).toMatch(/three times/);
    expect(def.summary(def.sanitize({}))).toBe('Bottle rack 6 × 3, ⌀25');
    expect(def.summary(def.sanitize({ shape: 'square', diameter: 52 }))).toBe('Bottle rack 6 × 3, □52');
    expect(def.hardware).toBeUndefined();
  });
});

describe('stick rack', () => {
  it('builds clean: defaults, a list of sizes, open and drained bottoms, upright', () => {
    for (const o of [
      {},
      { mode: 'list', rows: 2, floor: 'drain', tilt: 0 },
      { mode: 'list', sizes: '18, 5, 5.6, 18.7', rows: 2, tilt: 27, step: 8, floor: 'drain' },
      { diameter: 6, columns: 6, rows: 3, floor: 'open', tilt: 20, step: 5 },
      { diameter: 15.5, columns: 4, rows: 1, cup: 60, label: false, tilt: 0 },
    ]) {
      const b = build('stickRack', o);
      expectClean(b, JSON.stringify(o));
      expectWholeBack(b, RACK.back);
    }
  }, 180_000);

  it('every preset builds clean', () => presetsBuild('stickRack', { columns: 2 }), 300_000);

  it('fills a list of sizes into rows, front row first', () => {
    expect(listRows([2, 3, 4, 5, 6], 2)).toEqual([
      [2, 3, 4],
      [5, 6],
    ]);
    const s = stickSpec(sticks({ mode: 'list', sizes: '2, 3, 4, 5, 6', rows: 2 }));
    expect(s.rows).toEqual([
      [3, 4, 5],
      [6, 7],
    ]);
    // One size, staggered: every other row a hole shorter, set between the others.
    const g = rackPlan(stickSpec(sticks({})));
    expect(g.cups.filter((c) => c.y === g.y0)).toHaveLength(8);
    expect(g.cups.filter((c) => c.y !== g.y0)).toHaveLength(7);
    const front = g.cups.filter((c) => c.y === g.y0).map((c) => c.x);
    const back = g.cups.filter((c) => c.y !== g.y0).map((c) => c.x);
    expect(back[0]).toBeCloseTo((front[0] + front[1]) / 2, 6);
  });

  it('every stick stands in its hole, clear of the rest, snug to its size', () => {
    for (const o of [{}, { mode: 'list', rows: 2 }] as Partial<StickRackOptions>[]) {
      const b = build('stickRack', o);
      const opts = b.o as unknown as StickRackOptions;
      const p = rackPlan(stickSpec(opts), b.layout.w);
      const sticksIn = keep(w.Manifold.union(p.cups.map((c) => rod([c.x, c.y, c.z], opts.tilt, c.r - opts.clearance, 0.05, 150))));
      expect(overlap(b.hung, sticksIn)).toBeLessThan(0.05);
      const c = p.cups[2];
      expect(overlap(b.hung, rod([c.x, c.y, c.z], opts.tilt, c.r + 0.1, 0.5, 40))).toBeGreaterThan(0.5);
    }
  });

  it('open: brushes hang right through; drained: a hole under each; closed: none', () => {
    const at = (b: Built) => {
      const c = rackPlan(stickSpec(b.o as unknown as StickRackOptions), b.layout.w).cups[3];
      return { c, at: [c.x, c.y, c.z] as Vec3, tilt: (b.o as unknown as StickRackOptions).tilt };
    };
    const open = at(build('stickRack', { floor: 'open' }));
    expect(overlap(build('stickRack', { floor: 'open' }).hung, rod(open.at, open.tilt, 5.5, -60, 150))).toBeLessThan(0.05);
    const drained = build('stickRack', { floor: 'drain' });
    const d = at(drained);
    expect(overlap(drained.hung, rod(d.at, d.tilt, d.c.r - rackLip(d.c.r) - 0.3, -60, 1))).toBeLessThan(0.05);
    const closed = build('stickRack', { floor: 'closed' });
    expect(overlap(closed.hung, rod(at(closed).at, d.tilt, 1.5, -60, -0.2))).toBeGreaterThan(0.5);
  });

  it('rows of any sizes, stepped and tilted, share a wall where they meet and come no closer', () => {
    for (const s of [
      stickSpec(sticks({ mode: 'list', sizes: '18, 5, 5.6, 18.7, 3', rows: 2, tilt: 27, step: 8 })),
      stickSpec(sticks({ mode: 'list', rows: 3, tilt: 0, step: 0 })),
      stickSpec(sticks({ tilt: 15, step: 12 })),
      bottleSpec(bottle({ stagger: true, rows: 4, tilt: 20, step: 10 })),
      bottleSpec(bottle({ rows: 3, tilt: 30, step: 60 })),
    ]) {
      const p = rackPlan(s);
      const [cos, sin] = [Math.cos((s.tilt * Math.PI) / 180), Math.sin((s.tilt * Math.PI) / 180)];
      const ys = [...new Set(p.cups.map((c) => c.y))];
      for (let k = 0; k + 1 < ys.length; k++) {
        const a = p.cups.filter((c) => c.y === ys[k]);
        const b = p.cups.filter((c) => c.y === ys[k + 1]);
        // Between parallel tubes leaning `tilt`: how much more than a wall lies between the nearest two.
        const spare = Math.min(
          ...a.flatMap((u) =>
            b.map((v) => {
              const d = [v.x - u.x, v.y - u.y, v.z - u.z];
              const along = d[1] * cos + d[2] * sin;
              return Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - along ** 2) - (u.r + v.r + s.wall);
            }),
          ),
        );
        expect(spare).toBeCloseTo(0, 6);
      }
    }
    // A step too big for the tilt is cut back to what keeps them joined, and says so.
    const big = sticks({ tilt: 30, step: 30 });
    expect(rackPlan(stickSpec(big)).steps[0]).toBeLessThan(30);
    const def = attachmentDef('stickRack')!;
    expect(def.notes!(def.sanitize(big), CTX).join()).toMatch(/step up .* at most/);
  });

  it('notes, summary', () => {
    const def = attachmentDef('stickRack')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ mode: 'list', sizes: '' }), CTX).join()).toMatch(/No sizes yet/);
    expect(def.summary(def.sanitize({}))).toBe('Stick rack, 15 × ⌀11');
    expect(def.summary(def.sanitize({ mode: 'list' }))).toBe('Stick rack, 14 holes');
  });
});

describe('holster', () => {
  const holster = (o: Partial<HolsterOptions>) => ({ ...HOLSTER_DEFAULTS, ...o });

  it('builds clean as planned: drill, heat-safe with a cord notch, closed, oval, upright', () => {
    for (const o of [
      {},
      { width: 20, depth: 20, slot: 0, heat: true, cord: true, tilt: 15 },
      { width: 62, depth: 62, slot: 0, tilt: 0, ring: 20, back: 60 },
      { width: 45, depth: 32, slot: 0, heat: true, tilt: 5 },
      { width: 30, depth: 30, slot: 28.5, ring: 8, tilt: 30, offset: 0 },
    ]) {
      const b = build('holster', o);
      expectClean(b, JSON.stringify(o));
      expectWholeBack(b, HOLSTER.back);
      expect(b.layout.pose).toBe('upright');
    }
  });

  it('every preset builds clean', () => presetsBuild('holster'));

  /** The opening's axis where it meets the ring's top. */
  const axis = (b: Built): Vec3 => {
    const g = holsterGeometry(b.o as unknown as HolsterOptions, CTX);
    return [b.layout.w / 2, g.oy, g.oz];
  };

  for (const tilt of [0, 10, 25]) {
    it(`a tool drops in along its lean (${tilt}°), through the opening and the slot, and no bigger`, () => {
      const b = build('holster', { tilt });
      const o = b.o as unknown as HolsterOptions;
      const at = axis(b);
      // The tool's nose, just under the opening's size, from below the bed to above the ring.
      expect(overlap(b.hung, prism(obround(o.width - 0.4, o.depth - 0.4), at, -tilt, -300, 20))).toBeLessThan(0.05);
      expect(overlap(b.hung, prism(obround(o.width + 1, o.depth + 1), at, -tilt, -300, 0))).toBeGreaterThan(10);
      // The handle out through the slot, and not a wider one.
      const slot = (half: number): Vec2[] => [
        [-half, -200],
        [half, -200],
        [half, 0],
        [-half, 0],
      ];
      expect(overlap(b.hung, prism(slot(o.slot / 2 - 0.2), at, -tilt, -300, 20))).toBeLessThan(0.05);
      expect(overlap(b.hung, prism(slot(o.slot / 2 + 1), at, -tilt, -300, 0))).toBeGreaterThan(10);
      if (tilt >= 10) {
        // Straight down it doesn't go: the opening leans with the tool.
        expect(overlap(b.hung, prism(obround(o.width - 0.4, o.depth - 0.4), at, 0, -300, 0))).toBeGreaterThan(1);
      }
    });
  }

  it('stands off the board by the gap; heat-safe by 20 at least, on ribs with air between', () => {
    const b = build('holster', holster({ tilt: 0, offset: 12 }));
    const g = holsterGeometry(b.o as unknown as HolsterOptions, CTX);
    expect(g.oz - HOLSTER.back - (b.o.depth as number) / 2).toBeCloseTo(12, 6);
    // Plastic between the plate and the opening, then the opening.
    const x = b.layout.w / 2;
    expect(overlap(b.hung, box(x - 3, 2, HOLSTER.back + 0.5, x + 3, 10, HOLSTER.back + 11.5))).toBeCloseTo(6 * 8 * 11, 0);
    expect(overlap(b.hung, box(x - 3, 2, HOLSTER.back + 12.5, x + 3, 10, HOLSTER.back + 20))).toBeLessThan(0.01);
    const hot = build('holster', holster({ width: 20, depth: 20, slot: 0, heat: true, offset: 5 }));
    const cold = build('holster', holster({ width: 20, depth: 20, slot: 0, offset: 5 }));
    expect(holsterGeometry(hot.o as unknown as HolsterOptions, CTX).gap).toBe(HOLSTER.standoff);
    // The tool's size passes; a millimetre more only touches the ribs, where in the plain ring it meets the whole wall.
    const at = axis(hot);
    expect(overlap(hot.hung, prism(obround(19.6, 19.6), at, -10, -300, 20))).toBeLessThan(0.05);
    const tight = (b: Built) => overlap(b.hung, prism(obround(21, 21), axis(b), -10, -300, 0));
    expect(tight(hot)).toBeGreaterThan(0.5);
    expect(tight(hot)).toBeLessThan(tight(cold) / 3);
  });

  it('a cord notch at the back of the opening, when there is room', () => {
    const o = holster({ width: 20, depth: 20, slot: 0, tilt: 0, offset: 15 });
    const with_ = build('holster', { ...o, cord: true });
    const without = build('holster', o);
    const x = with_.layout.w / 2;
    const z = HOLSTER.back + 15 - 4;
    const probe = () => box(x - 3, -1, z - 1, x + 3, 40, z + 1);
    expect(overlap(with_.hung, probe())).toBeLessThan(0.01);
    expect(overlap(without.hung, probe())).toBeGreaterThan(50);
    const def = attachmentDef('holster')!;
    expect(def.notes!(def.sanitize({ ...o, cord: true, offset: 4 }), CTX).join()).toMatch(/cord notch/);
  });

  it('a big ring hangs on three clip columns and studs, a small one on two', () => {
    const big = build('holster').layout;
    expect(big.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(3);
    expect(big.mounts.some((m) => m.kind === 'stud')).toBe(true);
    const small = build('holster', { width: 15, depth: 15, slot: 0 }).layout;
    expect(small.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(2);
  });

  it('notes, summary', () => {
    const def = attachmentDef('holster')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ width: 150, depth: 150, back: 30 }), CTX).join()).toMatch(/three times/);
    expect(def.summary(def.sanitize({}))).toBe('Holster ⌀77');
    expect(def.summary(def.sanitize({ width: 45, depth: 32, heat: true }))).toBe('Holster 45 × 32, heat-safe');
  });
});

describe('gripper', () => {
  const grip = (o: Partial<GripperOptions>) => ({ ...GRIPPER_DEFAULTS, ...o });

  it('builds clean: upright, lying across, several, every wrap', () => {
    for (const o of [
      {},
      { axis: 'horizontal', count: 3, pitch: 40 },
      { count: 3, wrap: 180, ribs: false, diameter: 15, arm: 2 },
      { wrap: 260, diameter: 38.5, arm: 4, length: 40 },
      { axis: 'horizontal', diameter: 30, wrap: 220, length: 30 },
    ]) {
      const b = build('gripper', o);
      expectClean(b, JSON.stringify(o));
      expectWholeBack(b, GRIP.back);
    }
  });

  it('every preset builds clean, both ways', () => {
    presetsBuild('gripper');
    presetsBuild('gripper', { axis: 'horizontal' });
  });

  it('prints with its arms flexing in the layers: upright standing up, on its side lying across', () => {
    expect(build('gripper').layout.pose).toBe('upright');
    const side = build('gripper', { axis: 'horizontal' }).layout;
    expect(side.pose).toBe('side');
    expect(side.mounts.map((m) => m.kind).sort()).toEqual(['hook', 'stud']);
  });

  for (const axis of ['vertical', 'horizontal'] as const) {
    it(`an item of its diameter fits, a bigger one doesn't, and it snaps in through a narrower mouth (${axis})`, () => {
      const b = build('gripper', grip({ axis, ribs: false, count: 2, pitch: 40 }));
      const o = b.o as unknown as GripperOptions;
      const g = gripGeometry(o, CTX);
      const span = axis === 'vertical' ? b.layout.w : b.layout.h;
      const u0 = (span - g.run) / 2 + g.R;
      // The item along the C's axis: upright (along y) or across (along x).
      const item = (u: number, v: number, r: number) =>
        axis === 'vertical'
          ? keep(keep(keep(w.Manifold.cylinder(200, r, r, 96)).rotate([-90, 0, 0])).translate([u, -50, v]))
          : keep(keep(keep(w.Manifold.cylinder(200, r, r, 96)).rotate([0, 90, 0])).translate([-50, u, v]));
      for (const u of [u0, u0 + 40]) {
        expect(overlap(b.hung, item(u, g.zc, o.diameter / 2))).toBeLessThan(0.05);
        expect(overlap(b.hung, item(u, g.zc, o.diameter / 2 + 0.25))).toBeGreaterThan(1);
      }
      // At the mouth it meets the tips: they spring apart to let it in. In front of them it's clear.
      expect(g.mouth / o.diameter).toBeGreaterThan(0.83);
      expect(g.mouth / o.diameter).toBeLessThan(0.9);
      const lips = g.zc + (g.r + o.arm / 2) * Math.cos(g.half);
      expect(overlap(b.hung, item(u0, lips, o.diameter / 2))).toBeGreaterThan(1);
      expect(overlap(b.hung, item(u0, g.depth + o.diameter / 2 + 0.2, o.diameter / 2))).toBeLessThan(0.01);
    });
  }

  it('grip ribs: only the ribs touch the handle', () => {
    const b = build('gripper', grip({ ribs: true }));
    const g = gripGeometry(b.o as unknown as GripperOptions, CTX);
    const rod = (r: number) => keep(keep(keep(w.Manifold.cylinder(200, r, r, 96)).rotate([-90, 0, 0])).translate([b.layout.w / 2, -50, g.zc]));
    const touch = overlap(b.hung, rod(12.5));
    expect(touch).toBeGreaterThan(0.5);
    expect(touch).toBeLessThan(80);
    expect(overlap(b.hung, rod(12.5 + GRIP.fit - GRIP.rib - 0.05))).toBeLessThan(0.01);
  });

  it('several sit centre to centre, across the back or up it', () => {
    const g = gripGeometry(grip({ count: 3, pitch: 40 }), CTX);
    expect(g.run).toBeCloseTo(80 + 2 * g.R, 6);
    expect(build('gripper', { count: 3, pitch: 40 }).layout.w).toBeCloseTo(g.run, 6);
    expect(build('gripper', { count: 3, pitch: 40, axis: 'horizontal' }).layout.h).toBeCloseTo(g.run + 4, 6);
    // Never closer than the clips themselves.
    expect(gripGeometry(grip({ count: 2, pitch: 10 }), CTX).pitch).toBeCloseTo(2 * g.R + 2, 6);
  });

  it('notes, summary', () => {
    const def = attachmentDef('gripper')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ wrap: 180 }), CTX).join()).toMatch(/200°/);
    expect(def.notes!(def.sanitize({ diameter: 8, arm: 5 }), CTX).join()).toMatch(/crack/);
    expect(def.summary(def.sanitize({}))).toBe('Gripper ⌀25');
    expect(def.summary(def.sanitize({ count: 3, diameter: 22 }))).toBe('3 grippers ⌀22');
  });
});

describe('on a 560 × 560 board', () => {
  it('every new kind places without a warning, and prints', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('paint', 'bottleRack', 120, 500),
      a('spice', 'bottleRack', 380, 500, { diameter: 45.5, columns: 3, rows: 2, cup: 40, tilt: 15 }),
      a('pens', 'stickRack', 100, 380),
      a('needles', 'stickRack', 300, 380, { mode: 'list' }),
      a('drill', 'holster', 100, 260),
      a('iron', 'holster', 260, 260, { width: 15, depth: 15, slot: 0, heat: true }),
      a('broom', 'gripper', 400, 260),
      a('pump', 'gripper', 480, 160, { axis: 'horizontal', diameter: 30 }),
      a('mops', 'gripper', 300, 100, { count: 3, pitch: 45 }),
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
    expect(wall.placed.map((p) => p.ok)).toEqual(list.map(() => true));
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    expect(parts).toHaveLength(list.length);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
