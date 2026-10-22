import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentPart, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { PIN } from '../src/lib/wall/kinds/hinge';
import { TILT, tiltPlan, type TiltBinOptions } from '../src/lib/wall/kinds/tiltBin';
import { LID, lidPlan, type LidBoxOptions } from '../src/lib/wall/kinds/lidBox';
import { CAB, cabPlan, type CabinetOptions } from '../src/lib/wall/kinds/cabinet';
import { SWIVEL, swivelPlan, type SwivelTowerOptions } from '../src/lib/wall/kinds/swivelTower';
import { FOLD, foldPlan, type FoldHookOptions } from '../src/lib/wall/kinds/foldHook';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

// Every solid made here, freed when the file is done.
const live: Manifold[] = [];
const keep = (m: Manifold) => (live.push(m), m);
afterAll(() => live.forEach((m) => m.delete()));
const toManifold = (mesh: MeshData) => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
/** Turn a printed mesh the way it sits and move its min corner to `at`. */
const put = (mesh: MeshData, turn: Vec3, at: Vec3) => {
  const r = keep(toManifold(mesh).rotate(turn));
  const b = r.boundingBox();
  return keep(r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]));
};
const shared = (a: Manifold, b: Manifold) => {
  const i = a.intersect(b);
  const v = i.volume();
  i.delete();
  return v;
};
/** Turned `deg` about an axis along x through (y, z): positive tips +y toward +z. */
const turnedX = (m: Manifold, y: number, z: number, deg: number) => keep(keep(keep(m.translate([0, -y, -z])).rotate([deg, 0, 0])).translate([0, y, z]));
/** Turned `deg` about an axis along y through (x, z): positive turns +z toward +x. */
const turnedY = (m: Manifold, x: number, z: number, deg: number) => keep(keep(keep(m.translate([-x, 0, -z])).rotate([0, deg, 0])).translate([x, 0, z]));
const unionAll = (ms: Manifold[]) => keep(w.Manifold.union(ms));

/** Helpers for one kind. */
function kind<O extends object>(type: string) {
  const def = () => attachmentDef(type)!;
  const opts = (o: Partial<O> = {}) => def().sanitize(o) as O;
  const layout = (o: O) => def().layout(o, CTX);
  const bodyMesh = (o: O) => buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout: layout(o), ctx: CTX });
  const parts = (o: O) => def().parts?.(o, CTX) ?? [];
  const partMesh = (p: AttachmentPart) => buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
  /** The body in its own frame (front view's bottom-left at the origin, z out from the board). */
  const body = (o: O) => {
    const l = layout(o);
    const b = partBounds(l, CTX);
    return put(bodyMesh(o), viewTurn(l.pose), [b.x0, b.y0, b.z0]);
  };
  const placed = (p: AttachmentPart) => put(partMesh(p), p.place!.turn, p.place!.at);
  const part = (o: O, key: string) => parts(o).find((p) => p.key === key)!;
  /** Body and every part build clean at their planned sizes, and every part sits clear of the body and the others. */
  const clean = (o: O, what: string) => {
    const l = layout(o);
    const mesh = bodyMesh(o);
    expect(
      checkPart(w, mesh).issues.filter((i) => i.severity === 'error'),
      what,
    ).toEqual([]);
    const b = meshBounds(mesh);
    const want = printedSize(l, CTX);
    const near = (got: number[], wanted: number[], msg: string) => got.forEach((v, i) => expect(v, `${msg} [${i}]`).toBeCloseTo(wanted[i], 1));
    near([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], [want.w, want.d, want.h], what);
    const seen = new Map<string, MeshData>();
    const ps = parts(o);
    for (const p of ps) {
      const key = JSON.stringify(p.spec);
      if (!seen.has(key)) {
        const pm = partMesh(p);
        seen.set(key, pm);
        expect(
          checkPart(w, pm).issues.filter((i) => i.severity === 'error'),
          `${what} ${p.key}`,
        ).toEqual([]);
        const pb = meshBounds(pm);
        near([pb.max[0] - pb.min[0], pb.max[1] - pb.min[1], pb.max[2] - pb.min[2]], [p.w, p.d, p.h], `${what} ${p.key}`);
      }
    }
    const frame = body(o);
    const solids = ps.filter((p) => p.place).map((p) => put(seen.get(JSON.stringify(p.spec))!, p.place!.turn, p.place!.at));
    const shown = ps.filter((p) => p.place);
    solids.forEach((m, i) => {
      expect(shared(frame, m), `${what} ${shown[i].key}`).toBeLessThan(0.02);
      for (let j = i + 1; j < solids.length; j++) expect(shared(m, solids[j]), `${what} ${shown[i].key} ${shown[j].key}`).toBeLessThan(0.02);
    });
    return { frame, solids, shown };
  };
  return { def, opts, layout, bodyMesh, parts, partMesh, body, placed, part, clean };
}

describe('tip-out bin', () => {
  const k = kind<TiltBinOptions>('tiltBin');

  it('plans a frame, a bin and four pins a bin, stacked', () => {
    const o = k.opts();
    expect(o).toMatchObject({ width: 100, height: 70, depth: 70, angle: 45, stack: 1 });
    const l = k.layout(o);
    expect(l.pose).toBe('upright');
    expect(l.w).toBe(100);
    expect(l.h).toBeCloseTo(70 + TILT.gap + TILT.floor, 6);
    expect(l.depth).toBe(70);
    expect(l.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(2);
    expect(l.mounts.some((m) => m.kind === 'stud')).toBe(true);
    expect(k.parts(o).map((p) => p.key)).toEqual(['b0', 'p0l', 'p0r', 's0l', 's0r']);
    const three = k.opts({ stack: 3 });
    expect(k.layout(three).h).toBeCloseTo(3 * 71 + TILT.floor, 6);
    expect(k.parts(three)).toHaveLength(15);
    expect(k.def().summary(three)).toBe('Tip-out bin × 3 100 × 70 × 70');
    expect(attachmentUi('tiltBin')?.group).toBe('storage');
    expect(k.opts({ angle: 90, stack: 9, height: 10 })).toMatchObject({ angle: 60, stack: 4, height: 40 });
  });

  it('builds clean at its sizes, with every part where it sits and clear of the frame', () => {
    for (const o of [
      k.opts(),
      k.opts({ stack: 2, dividers: 3, liftOff: true, angle: 60, width: 160, height: 60 }),
      k.opts({ label: false, angle: 30, depth: 100, height: 110, width: 70 }),
    ])
      k.clean(o, JSON.stringify(o));
  });

  for (const o of [{}, { angle: 30 }, { angle: 60, liftOff: true }, { stack: 2, height: 50, depth: 55 }] as Partial<TiltBinOptions>[])
    it(`tips out to its stop and no further (${JSON.stringify(o)})`, () => {
      const op = k.opts(o);
      const p = tiltPlan(op);
      const frame = k.body(op);
      const ps = k.parts(op);
      const pins = unionAll(ps.filter((q) => q.key.startsWith('p') || q.key.startsWith('s')).map((q) => k.placed(q)));
      const fixed = keep(frame.add(pins));
      for (let n = 0; n < op.stack; n++) {
        const bin = k.placed(k.part(op, `b${n}`));
        const y = p.yP(n);
        // Closed, open to its angle, and every step between: clear of the frame, the pins and the bins above and below.
        const others = ps.filter((q) => q.key.startsWith('b') && q.key !== `b${n}`).map((q) => k.placed(q));
        for (let a = 0; a <= op.angle; a += op.angle / 6) {
          const m = turnedX(bin, y, p.zP, a);
          expect(shared(fixed, m), `${n} at ${a}°`).toBeLessThan(0.02);
          for (const q of others) expect(shared(q, m), `${n} at ${a}° with another`).toBeLessThan(0.02);
        }
        // A little further, the stop pins catch the ends of its slots; a little back past closed, too.
        expect(shared(pins, turnedX(bin, y, p.zP, op.angle + 2)), `${n} past the stop`).toBeGreaterThan(0.05);
        expect(shared(pins, turnedX(bin, y, p.zP, -2)), `${n} past closed`).toBeGreaterThan(0.05);
      }
    });

  it('with lift off, a closed bin lifts off its pins; open, it does not', () => {
    const o = k.opts({ liftOff: true });
    const p = tiltPlan(o);
    const fixed = keep(
      k.body(o).add(
        unionAll(
          k
            .parts(o)
            .filter((q) => q.key !== 'b0')
            .map((q) => k.placed(q)),
        ),
      ),
    );
    const bin = k.placed(k.part(o, 'b0'));
    expect(shared(fixed, keep(bin.translate([0, 20, 0])))).toBeLessThan(0.02);
    expect(shared(fixed, keep(turnedX(bin, p.yP(0), p.zP, o.angle).translate([0, 3, 0])))).toBeGreaterThan(0.05);
    // Without it, the pins hold it closed too.
    const o2 = k.opts();
    const fixed2 = keep(
      k.body(o2).add(
        unionAll(
          k
            .parts(o2)
            .filter((q) => q.key !== 'b0')
            .map((q) => k.placed(q)),
        ),
      ),
    );
    expect(shared(fixed2, keep(k.placed(k.part(o2, 'b0')).translate([0, 3, 0])))).toBeGreaterThan(0.05);
  });

  it('its pins: a push fit in the frame, free in the bin, the heads sunk in the sides', () => {
    expect(PIN.free).toBeGreaterThanOrEqual(0.4);
    const o = k.opts();
    const pin = k.part(o, 'p0l');
    expect(pin.place!.at[0]).toBeGreaterThanOrEqual(0);
    const right = k.placed(k.part(o, 'p0r'));
    expect(right.boundingBox().max[0]).toBeLessThanOrEqual(o.width);
  });

  it('notes a bin too deep for its height, and lists label cards', () => {
    const notes = (o: Partial<TiltBinOptions>) => k.def().notes!(k.opts(o), CTX).join(' ');
    expect(notes({})).toBe('');
    expect(notes({ depth: 150, height: 60 })).toMatch(/at most about as deep as it is tall/);
    expect(k.layout(k.opts({ depth: 150, height: 60 })).depth).toBeLessThan(150);
    expect(notes({ width: 60, dividers: 4 })).toMatch(/hard to reach into/);
    expect(k.def().hardware!(k.opts({ stack: 2 }))).toEqual([{ item: 'Label card', count: 2, note: '58 × 12.5 mm' }]);
    expect(k.def().hardware!(k.opts({ label: false }))).toEqual([]);
  });
});

describe('box with a lid', () => {
  const k = kind<LidBoxOptions>('lidBox');

  it('plans its lid, top, flap and pin', () => {
    expect(k.opts()).toMatchObject({ lid: 'hinge', pin: 'printed', magnets: false });
    expect(k.parts(k.opts()).map((p) => p.key)).toEqual(['lid', 'pin']);
    expect(k.parts(k.opts({ lid: 'slide' })).map((p) => p.key)).toEqual(['lid']);
    expect(k.parts(k.opts({ lid: 'flip' })).map((p) => p.key)).toEqual(['top', 'flap', 'pin']);
    expect(k.parts(k.opts({ lid: 'flip', pin: 'steel' })).map((p) => p.key)).toEqual(['top', 'flap']);
    const l = k.layout(k.opts());
    expect([l.w, l.h, l.depth, l.pose]).toEqual([100, 60, 60, 'upright']);
    expect(k.def().summary(k.opts({ lid: 'slide' }))).toBe('Box with sliding lid 100 × 60 × 60');
    expect(k.def().summary(k.opts({ lid: 'flip', width: 80 }))).toBe('Box with flap 80 × 60 × 60');
    expect(attachmentUi('lidBox')?.group).toBe('storage');
  });

  it('builds clean at its sizes, every part where it sits', () => {
    for (const o of [
      k.opts(),
      k.opts({ lid: 'slide', label: true, width: 160, height: 45 }),
      k.opts({ lid: 'hinge', magnets: true, label: true, pin: 'steel', depth: 90 }),
      k.opts({ lid: 'flip', magnets: true }),
      k.opts({ lid: 'flip', pin: 'steel', width: 60, height: 40, depth: 40, wall: 3 }),
    ])
      k.clean(o, JSON.stringify(o));
  });

  it('a sliding lid slides out the front, and only that way', () => {
    const o = k.opts({ lid: 'slide' });
    const box = k.body(o);
    const lid = k.placed(k.part(o, 'lid'));
    expect(shared(box, lid)).toBeLessThan(0.02);
    // Its bevelled edges under the grooves' 45° ceilings: it can't lift out, or drop.
    expect(shared(box, keep(lid.translate([0, 0.6, 0])))).toBeGreaterThan(0.05);
    expect(shared(box, keep(lid.translate([0, -0.4, 0])))).toBeGreaterThan(0.05);
    // Back, it meets the back plate; forward, it slides all the way out.
    expect(shared(box, keep(lid.translate([0, 0, -0.5])))).toBeGreaterThan(0.05);
    for (const dz of [10, 30, o.depth]) expect(shared(box, keep(lid.translate([0, 0, dz]))), `${dz}`).toBeLessThan(0.02);
  });

  for (const pin of ['printed', 'steel'] as const)
    it(`a hinged lid swings up on its pin, clear all the way (${pin} pin)`, () => {
      const o = k.opts({ lid: 'hinge', magnets: true, label: true, pin });
      const p = lidPlan(o);
      const box = k.body(o);
      const fixed = pin === 'printed' ? keep(box.add(k.placed(k.part(o, 'pin')))) : box;
      const lid = k.placed(k.part(o, 'lid'));
      // Opening turns its front up (negative about x).
      for (const a of [0, 15, 30, 45, 60, 75, 90]) expect(shared(fixed, turnedX(lid, p.yh, p.zh, -a)), `${a}°`).toBeLessThan(0.02);
      // It can't fall into the box: closed, it rests on the walls.
      expect(shared(box, turnedX(lid, p.yh, p.zh, 2))).toBeGreaterThan(0.05);
      // Off its pin, it would drop out of the knuckles: the pin is what holds it.
      if (pin === 'printed') expect(shared(k.placed(k.part(o, 'pin')), keep(lid.translate([0, -1, 0])))).toBeGreaterThan(0.05);
    });

  it('a hinged lid: its magnets over the box’s, its pin a push fit in the box and free in the lid', () => {
    const o = k.opts({ lid: 'hinge', magnets: true });
    const box = k.body(o);
    const lid = k.placed(k.part(o, 'lid'));
    // A magnet-sized plug in each pocket of the box, and in each of the lid's, at the same place.
    const p = lidPlan(o);
    for (const xm of [o.width / 4, (3 * o.width) / 4]) {
      const zm = o.depth - (o.wall + 6.5) / 2;
      const plug = (y0: number, y1: number) => keep(keep(keep(w.Manifold.cylinder(y1 - y0, 2.9, 2.9, 32)).rotate([-90, 0, 0])).translate([xm, y0, zm]));
      expect(shared(box, plug(p.top - LID.pocketD + 0.05, p.top))).toBeLessThan(0.02);
      expect(shared(lid, plug(p.top, p.top + LID.pocketD - 0.05))).toBeLessThan(0.02);
    }
    const pin = k.placed(k.part(o, 'pin'));
    expect(shared(box, pin)).toBeLessThan(0.02);
    expect(shared(lid, pin)).toBeLessThan(0.02);
    expect(PIN.free / 2).toBeGreaterThanOrEqual(0.25);
    expect(PIN.gap).toBeGreaterThanOrEqual(0.4);
  });

  it('a flap drops open onto its ledge, a little past level, and holds the top plate in', () => {
    const o = k.opts({ lid: 'flip', magnets: true });
    const p = lidPlan(o);
    const box = keep(k.body(o).add(k.placed(k.part(o, 'pin'))));
    const flap = k.placed(k.part(o, 'flap'));
    for (const a of [0, 30, 60, 90]) expect(shared(box, turnedX(flap, p.yh, p.zh, a)), `${a}°`).toBeLessThan(0.02);
    expect(shared(box, turnedX(flap, p.yh, p.zh, 100)), 'past the ledge').toBeGreaterThan(0.05);
    // Shut, it rests against the box (the magnets' pillars).
    expect(shared(box, keep(flap.translate([0, 0, -0.6])))).toBeGreaterThan(0.05);
    const top = k.placed(k.part(o, 'top'));
    expect(shared(box, top)).toBeLessThan(0.02);
    expect(shared(flap, top)).toBeLessThan(0.02);
    expect(shared(flap, keep(top.translate([0, 0, 1])))).toBeGreaterThan(0.05);
    expect(shared(box, keep(top.translate([0, 0, 40])))).toBeLessThan(0.02);
  });

  it('lists pins, magnets and a label card', () => {
    const hw = (o: Partial<LidBoxOptions>) => k.def().hardware!(k.opts(o));
    expect(hw({})).toEqual([]);
    expect(hw({ lid: 'slide', magnets: true })).toEqual([]);
    expect(hw({ magnets: true, pin: 'steel', label: true })).toEqual([
      { item: 'Steel rod or nail ⌀3 mm', count: 1, note: 'cut to 99 mm' },
      { item: 'Magnets 6 × 2 mm', count: 4, note: 'glued in, poles facing each other to attract' },
      { item: 'Label card', count: 1, note: '58 × 12.5 mm' },
    ]);
    expect(hw({ lid: 'flip', label: true })).toEqual([]);
    expect(k.def().notes!(k.opts({ depth: 200, height: 40 }), CTX).join()).toMatch(/three times/);
  });
});

describe('cabinet', () => {
  const k = kind<CabinetOptions>('cabinet');

  it('plans a door, a top, its shelves and a pin', () => {
    const o = k.opts();
    expect(o).toMatchObject({ width: 120, height: 120, depth: 80, shelves: 1, door: 'left', magnets: true });
    expect(k.parts(o).map((p) => p.key)).toEqual(['top', 'shelf0', 'door', 'pin']);
    expect(k.parts(k.opts({ shelves: 3, pin: 'steel' })).map((p) => p.key)).toEqual(['top', 'shelf0', 'shelf1', 'shelf2', 'door']);
    expect(k.def().summary(o)).toBe('Cabinet 120 × 80 × 120, 1 shelf');
    expect(k.def().summary(k.opts({ shelves: 2 }))).toBe('Cabinet 120 × 80 × 120, 2 shelves');
    expect(k.def().summary(k.opts({ shelves: 0 }))).toBe('Cabinet 120 × 80 × 120');
    expect(k.layout(o).pose).toBe('upright');
    expect(attachmentUi('cabinet')?.group).toBe('storage');
  });

  it('builds clean at its sizes, every part where it sits', () => {
    for (const o of [
      k.opts(),
      k.opts({ door: 'right', window: true, shelves: 3, pin: 'steel', width: 160 }),
      k.opts({ width: 60, height: 60, depth: 40, shelves: 0, magnets: false, wall: 3 }),
    ])
      k.clean(o, JSON.stringify(o));
  });

  for (const door of ['left', 'right'] as const)
    it(`its door swings open past 90° on its pin, clear of everything (${door} hinge)`, () => {
      const o = k.opts({ door, window: true, shelves: 2 });
      const p = cabPlan(o);
      const fixed = unionAll([
        k.body(o),
        ...k
          .parts(o)
          .filter((q) => q.key !== 'door')
          .map((q) => k.placed(q)),
      ]);
      const d = k.placed(k.part(o, 'door'));
      const x = door === 'left' ? p.xh : o.width - p.xh;
      const sign = door === 'left' ? -1 : 1;
      for (const a of [0, 20, 45, 70, 90, 100]) expect(shared(fixed, turnedY(d, x, p.zh, sign * a)), `${a}°`).toBeLessThan(0.02);
      // The other way it runs into the cabinet; it can't lift off its knuckles.
      expect(shared(fixed, turnedY(d, x, p.zh, -sign * 3)), 'shut further').toBeGreaterThan(0.05);
      expect(shared(fixed, keep(d.translate([0, 3, 0]))), 'lifted').toBeGreaterThan(0.05);
    });

  it('the top plate and the shelves slide out the front with the door open; the closed door and the pin hold the top in', () => {
    const o = k.opts({ shelves: 2 });
    const body = k.body(o);
    const door = k.placed(k.part(o, 'door'));
    const pin = k.placed(k.part(o, 'pin'));
    const top = k.placed(k.part(o, 'top'));
    // The top in its grooves: it can't lift or drop; the pin through it and the door in front of it.
    expect(shared(body, keep(top.translate([0, 0.6, 0])))).toBeGreaterThan(0.05);
    expect(shared(body, keep(top.translate([0, -0.4, 0])))).toBeGreaterThan(0.05);
    expect(shared(pin, keep(top.translate([0, 0, 1])))).toBeGreaterThan(0.05);
    expect(shared(door, keep(top.translate([0, 0, 1])))).toBeGreaterThan(0.05);
    for (const dz of [5, 20, o.depth]) expect(shared(body, keep(top.translate([0, 0, dz]))), `top ${dz}`).toBeLessThan(0.02);
    for (const key of ['shelf0', 'shelf1']) {
      const sh = k.placed(k.part(o, key));
      // On its ledges, clear of the hinge as it slides out.
      expect(shared(body, keep(sh.translate([0, -0.3, 0]))), key).toBeGreaterThan(0.05);
      for (const dz of [5, 20, o.depth]) expect(shared(keep(body.add(pin)), keep(sh.translate([0, 0, dz]))), `${key} ${dz}`).toBeLessThan(0.02);
    }
  });

  it('its magnets meet: a pocket in the floor block and one in the door, face to face', () => {
    const o = k.opts();
    const p = cabPlan(o);
    const body = k.body(o);
    const door = k.placed(k.part(o, 'door'));
    const x = o.width - o.wall - 5;
    const y = LID.floor + 4;
    const plug = (z0: number, z1: number) => keep(keep(w.Manifold.cylinder(z1 - z0, 2.9, 2.9, 32)).translate([x, y, z0]));
    expect(shared(body, plug(p.sides - LID.pocketD + 0.05, p.sides))).toBeLessThan(0.02);
    expect(shared(door, plug(o.depth - CAB.door, o.depth - CAB.door + LID.pocketD - 0.05))).toBeLessThan(0.02);
    expect(o.depth - CAB.door - p.sides).toBeCloseTo(CAB.behind, 6);
  });

  it('lists the pin, the magnets and a clear sheet, and notes shelves too close', () => {
    const hw = (o: Partial<CabinetOptions>) => k.def().hardware!(k.opts(o));
    expect(hw({ magnets: false })).toEqual([]);
    expect(hw({ pin: 'steel', window: true }).map((h) => h.item)).toEqual([
      'Steel rod or nail ⌀3 mm',
      'Magnets 6 × 2 mm',
      'Clear sheet (PET or acrylic, up to 1 mm)',
    ]);
    expect(k.def().notes!(k.opts(), CTX)).toEqual([]);
    expect(k.def().notes!(k.opts({ height: 60, shelves: 4 }), CTX).join()).toMatch(/hard to reach between/);
  });
});

describe('swivel tower', () => {
  const k = kind<SwivelTowerOptions>('swivelTower');

  it('plans its trays, the axle and its height', () => {
    const o = k.opts();
    expect(o).toMatchObject({ count: 4, trayH: 25, length: 100, width: 60, axle: 8, source: 'printed', spacer: 2 });
    expect(k.parts(o).map((p) => p.key)).toEqual(['t0', 't1', 't2', 't3', 'axle']);
    expect(k.parts(k.opts({ source: 'dowel', count: 2 })).map((p) => p.key)).toEqual(['t0', 't1']);
    const p = swivelPlan(o);
    const l = k.layout(o);
    expect(l.h).toBeCloseTo(p.h, 6);
    expect(l.w).toBeCloseTo(p.xa + 100 + 1, 6);
    expect(l.mounts.filter((m) => m.kind === 'stud').length).toBeGreaterThanOrEqual(2);
    // Trays a tray and a spacer apart, the bottom one on the bottom arm.
    expect(p.y(1) - p.y(0)).toBeCloseTo(27, 6);
    expect(p.y(0)).toBeCloseTo(SWIVEL.arm + 0.1, 6);
    expect(k.def().summary(o)).toBe('Swivel tower, 4 trays 100 × 60');
    expect(attachmentUi('swivelTower')?.group).toBe('storage');
    expect(k.opts({ trayH: 100, spacer: 0, count: 20 })).toMatchObject({ trayH: 75, spacer: 1, count: 8 });
  });

  it('builds clean at its sizes, every part where it sits', () => {
    for (const o of [
      k.opts(),
      k.opts({ count: 2, trayH: 60, axle: 12, source: 'dowel', spacer: 8, width: 100, length: 160 }),
      k.opts({ count: 8, trayH: 10, axle: 6, width: 30, length: 50, spacer: 1 }),
    ])
      k.clean(o, JSON.stringify(o));
  });

  for (const o of [{}, { count: 2, trayH: 60, axle: 12, spacer: 8, width: 100, length: 160 }] as Partial<SwivelTowerOptions>[])
    it(`each tray swings out on its own, half a turn, clear of the rest (${JSON.stringify(o)})`, () => {
      const op = k.opts(o);
      const p = swivelPlan(op);
      const frame = keep(k.body(op).add(k.placed(k.part(op, 'axle'))));
      const trays = k
        .parts(op)
        .filter((q) => q.key.startsWith('t'))
        .map((q) => k.placed(q));
      trays.forEach((t, i) => {
        const others = unionAll([frame, ...trays.filter((_, j) => j !== i)]);
        // Forward (toward the front) it swings up to half a turn; back, the back plate stops it.
        for (const a of [0, 30, 60, 90, 120, 150, 180]) expect(shared(others, turnedY(t, p.xa, p.za, -a)), `${i} at ${a}°`).toBeLessThan(0.02);
        expect(shared(frame, turnedY(t, p.xa, p.za, 3)), `${i} back`).toBeGreaterThan(0.05);
        // On the axle: it can't slide off sideways.
        expect(shared(frame, keep(t.translate([1, 0, 0]))), `${i} off`).toBeGreaterThan(0.05);
      });
    });

  it('lists a dowel or a rod, and notes long trays and a long printed axle', () => {
    const hw = (o: Partial<SwivelTowerOptions>) => k.def().hardware!(k.opts(o));
    expect(hw({})).toEqual([]);
    const L = Math.round(swivelPlan(k.opts()).axleL);
    expect(hw({ source: 'dowel' })).toEqual([{ item: 'Dowel ⌀8 mm', count: 1, note: `cut to ${L} mm` }]);
    expect(hw({ source: 'bolt', axle: 10 })[0].item).toBe('Threaded rod or bolt M10');
    const notes = (o: Partial<SwivelTowerOptions>) => k.def().notes!(k.opts(o), CTX).join(' ');
    expect(notes({})).toBe('');
    expect(notes({ length: 200, width: 40 })).toMatch(/near the axle/);
    expect(notes({ count: 8, trayH: 40 })).toMatch(/use a dowel or a rod/);
  });
});

describe('folding hook', () => {
  const k = kind<FoldHookOptions>('foldHook');

  it('plans an arm and a pin, folded up at home', () => {
    const o = k.opts();
    expect(o).toMatchObject({ style: 'hook', reach: 60, width: 10, pin: 'printed' });
    expect(k.parts(o).map((p) => p.key)).toEqual(['arm', 'pin']);
    expect(k.parts(k.opts({ pin: 'steel' })).map((p) => p.key)).toEqual(['arm']);
    const p = foldPlan(o);
    const l = k.layout(o);
    // As high as the arm folded up, as wide as the cheeks (or the cup's ring).
    expect(l.h).toBeCloseTo(p.yp + 60 + 2, 6);
    expect(l.w).toBeCloseTo(2 * FOLD.cheek + 2 * FOLD.gap + 10, 6);
    expect(k.layout(k.opts({ style: 'cup', cup: 80 })).w).toBeCloseTo(80 + 1 + 2 * FOLD.ring + 2, 6);
    expect(k.def().summary(o)).toBe('Folding hook 60 mm');
    expect(k.def().summary(k.opts({ style: 'cup', cup: 86 }))).toBe('Folding cup holder ⌀86');
    expect(attachmentUi('foldHook')?.group).toBe('hooks');
  });

  it('builds clean at its sizes, the arm folded where it sits', () => {
    for (const o of [
      k.opts(),
      k.opts({ style: 'cup' }),
      k.opts({ reach: 120, width: 20, arm: 12, tip: 25, pin: 'steel' }),
      k.opts({ style: 'cup', cup: 110, width: 30 }),
      k.opts({ reach: 30, width: 8, arm: 6, tip: 5 }),
    ])
      k.clean(o, JSON.stringify(o));
  });

  for (const o of [{}, { style: 'cup' }, { reach: 120, arm: 12, tip: 25 }] as Partial<FoldHookOptions>[])
    it(`unfolds to level, clicking in folded and open, and stops (${JSON.stringify(o)})`, () => {
      const op = k.opts(o);
      const p = foldPlan(op);
      const base = keep(k.body(op).add(op.pin === 'printed' ? k.placed(k.part(op, 'pin')) : keep(w.Manifold.cube([0.01, 0.01, 0.01]))));
      const arm = k.placed(k.part(op, 'arm'));
      const at = (a: number) => turnedX(arm, p.yp, p.zp, a);
      // Folded (home) and open, its bump sits in a dimple: clear.
      expect(shared(base, at(0)), 'folded').toBeLessThan(0.02);
      expect(shared(base, at(90)), 'open').toBeLessThan(0.02);
      // Between, only the bump rubs on the right cheek: the click.
      const xr = p.xc + op.width / 2 + FOLD.gap;
      for (const a of [30, 45, 60]) {
        const both = keep(base.intersect(at(a)));
        expect(both.volume(), `${a}°`).toBeGreaterThan(0.05);
        expect(both.volume(), `${a}°`).toBeLessThan(2);
        expect(both.boundingBox().min[0], `${a}°`).toBeGreaterThan(xr - 0.05);
      }
      // Loaded past level, the heel meets the back plate (or its pad) within a few degrees; folded further, it meets the board side.
      expect(shared(base, at(96)), 'past level').toBeGreaterThan(2);
      expect(shared(base, at(-8)), 'past folded').toBeGreaterThan(0.05);
      // The pin holds it.
      if (op.pin === 'printed') expect(shared(k.placed(k.part(op, 'pin')), keep(arm.translate([0, 0, 1])))).toBeGreaterThan(0.05);
    });

  it('a cup holder takes its cup, open: every preset, and a cup 2 mm wider does not fit', () => {
    const field = attachmentUi('foldHook')!.fields.find((f) => f.kind === 'preset');
    expect(field?.kind).toBe('preset');
    const presets = field!.kind === 'preset' ? field!.presets : [];
    expect(presets.length).toBeGreaterThanOrEqual(3);
    for (const pr of presets) {
      const o = k.opts({ style: 'cup', ...pr.set });
      k.clean(o, pr.value);
      const p = foldPlan(o);
      const open = turnedX(k.placed(k.part(o, 'arm')), p.yp, p.zp, 90);
      // A cup standing on the ring's floor, at its middle.
      const cup = (d: number) =>
        keep(keep(keep(w.Manifold.cylinder(40, d / 2, d / 2, 96)).rotate([-90, 0, 0])).translate([p.xc, p.yp - p.k + FOLD.floor + 0.05, p.zp + p.rc]));
      expect(shared(open, cup(o.cup)), pr.value).toBeLessThan(0.02);
      expect(shared(open, cup(o.cup + 2)), pr.value).toBeGreaterThan(0.05);
    }
  });

  it('lists a steel pin when it has one', () => {
    expect(k.def().hardware!(k.opts())).toEqual([]);
    expect(k.def().hardware!(k.opts({ pin: 'steel' }))).toEqual([{ item: 'Steel rod or nail ⌀3 mm', count: 1, note: 'cut to 18 mm' }]);
  });
});

describe('on a board', () => {
  it('every hinged kind places on a 560 × 560 board without warnings', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('tilt', 'tiltBin', 40, 520),
      a('box', 'lidBox', 200, 520, { magnets: true }),
      a('slide', 'lidBox', 360, 520, { lid: 'slide', label: true }),
      a('flap', 'lidBox', 480, 520, { lid: 'flip', magnets: true }),
      a('tilt3', 'tiltBin', 40, 400, { stack: 3, height: 50, depth: 55 }),
      a('cab', 'cabinet', 200, 400, { window: true }),
      a('cab2', 'cabinet', 360, 400, { door: 'right', shelves: 2, width: 80, height: 90 }),
      a('tower', 'swivelTower', 480, 400, { count: 3, trayH: 20, length: 80, width: 50 }),
      a('fold', 'foldHook', 200, 200),
      a('foldCup', 'foldHook', 320, 200, { style: 'cup' }),
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
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of Object.values(job.parts).filter((q) => q.kind === 'attachment')) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
