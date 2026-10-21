import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentPart, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { GROUP_LABELS, attachmentUis } from '../src/lib/wall/ui';
import { LED, diffuserPieces, ledFrame, type LedBarOptions } from '../src/lib/wall/kinds/ledBar';
import { CH, channelExits, channelSize, type CableChannelOptions } from '../src/lib/wall/kinds/cableChannel';
import { clipHeight, clipSeat, type CableClipOptions } from '../src/lib/wall/kinds/cableClip';
import { PS, stripSize, type PowerStripOptions } from '../src/lib/wall/kinds/powerStrip';
import { combSize, type CableCombOptions } from '../src/lib/wall/kinds/cableComb';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const KINDS = ['ledBar', 'cableClip', 'cableChannel', 'powerStrip', 'cableComb'];

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Turned and moved so its min corner is at `at`. */
function moved(m: Manifold, turn: [number, number, number], at: [number, number, number]): Manifold {
  const r = m.rotate(turn);
  const b = r.boundingBox();
  const out = r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]);
  m.delete();
  r.delete();
  return out;
}

/** An attachment as it hangs, in its own frame (back on the board at z = 0), and its extra parts where they sit. */
function hung(type: string, opts: object) {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  const pb = partBounds(layout, CTX);
  const body = moved(toManifold(mesh), viewTurn(layout.pose), [pb.x0, pb.y0, pb.z0]);
  const parts = (def.parts?.(o, CTX) ?? []).map((p: AttachmentPart) => {
    const pm = buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
    return { p, mesh: pm, m: p.place ? moved(toManifold(pm), p.place.turn, p.place.at) : null };
  });
  return { def, o, layout, mesh, body, parts };
}

/** Volume two solids share, mm³ (frees `b`). */
function shared(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  const v = i.volume();
  i.delete();
  b.delete();
  return v;
}

/** A rod of diameter d along x (or y), its axis through (·, y, z) (or (x, ·, z)). */
function rod(d: number, len: number, at: [number, number, number], along: 'x' | 'y'): Manifold {
  const c = w.Manifold.cylinder(len, d / 2, d / 2, 64);
  const r = c.rotate(along === 'x' ? [0, 90, 0] : [-90, 0, 0]);
  const out = r.translate(at);
  c.delete();
  r.delete();
  return out;
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

describe('lighting and cables: every kind, other options', () => {
  const cases: [string, object][] = [
    ['ledBar', { length: 160, strip: 12, angle: 45, wire: 'both' }],
    ['ledBar', { length: 120, strip: 8, angle: 0, caps: false }],
    ['ledBar', { angle: 60, diffuser: false }],
    ['cableClip', { style: 'flat', flatW: 16, flatT: 2, count: 3 }],
    ['cableClip', { diameter: 12, count: 4, gap: 2, width: 14 }],
    ['cableChannel', { length: 240, width: 30, height: 25, exits: 50 }],
    ['cableChannel', { width: 8, height: 10, lid: false }],
    ['powerStrip', { style: 'tray', cable: 'left', strap: true }],
    ['powerStrip', { width: 30, height: 60, lip: 20, cable: 'right', length: 150 }],
    ['cableComb', { count: 8, diameter: 12, gap: 4 }],
  ];
  for (const [type, opts] of cases) {
    it(`${type} ${JSON.stringify(opts)}: clean, no support, as big as planned`, () => {
      const def = attachmentDef(type)!;
      const o = def.sanitize(opts);
      const layout = def.layout(o, CTX);
      const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
      // Not even a warning: no overhangs, ledges or thin walls.
      expect(checkPart(w, mesh).issues).toEqual([]);
      const b = meshBounds(mesh);
      const want = printedSize(layout, CTX);
      expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 1);
      expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
      expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
      for (const p of def.parts?.(o, CTX) ?? []) {
        const pm = buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
        expect(checkPart(w, pm).issues, p.key).toEqual([]);
        const pb = meshBounds(pm);
        expect(pb.max[0] - pb.min[0]).toBeCloseTo(p.w, 1);
        expect(pb.max[1] - pb.min[1]).toBeCloseTo(p.d, 1);
        expect(pb.max[2] - pb.min[2]).toBeCloseTo(p.h, 1);
      }
    });
  }

  it('options clean up', () => {
    const led = attachmentDef('ledBar')!;
    expect(led.sanitize({ angle: '45', strip: '12' })).toMatchObject({ angle: 45, strip: 12 });
    expect(led.sanitize({ angle: 20, strip: 9 })).toMatchObject({ angle: 30, strip: 10 });
    expect(attachmentDef('cableChannel')!.sanitize({ exits: 10 })).toMatchObject({ exits: 0 });
    expect(attachmentDef('powerStrip')!.sanitize({ height: 20, lip: 50 })).toMatchObject({ height: 20, lip: 20 });
    expect(attachmentDef('cableClip')!.sanitize({ style: 'x', count: 2.6 })).toMatchObject({ style: 'round', count: 3 });
  });

  it('are in the picker under Lighting and cables', () => {
    expect(GROUP_LABELS.power).toBe('Lighting and cables');
    const power = attachmentUis()
      .filter((u) => u.group === 'power')
      .map((u) => u.type);
    expect(power.sort()).toEqual([...KINDS].sort());
  });
});

describe('LED light bar', () => {
  for (const angle of [0, 30, 45, 60]) {
    it(`aimed ${angle}°: the diffuser sits in place without touching, and can't come off`, () => {
      const { o, body, parts } = hung('ledBar', { angle, strip: angle === 60 ? 12 : 10 });
      const d = parts.find((x) => x.p.key === 'diffuser')!;
      expect(d.p.name).toMatch(/PETG/);
      const m = d.m!;
      // Seated: float32 meshes leave a film of a few thousandths of a mm³ at most.
      expect(shared(body, m.translate([0, 0, 0]))).toBeLessThan(0.02);
      // Pulled straight out along the light, or down, its hooks catch the lips.
      const a = (angle * Math.PI) / 180;
      const pull = 0.5;
      expect(shared(body, m.translate([0, -Math.sin(a) * pull, Math.cos(a) * pull]))).toBeGreaterThan(20);
      expect(shared(body, m.translate([0, -pull, 0]))).toBeGreaterThan(20);
      // It covers the strip: its panel spans the floor, the strip's width and more.
      const f = ledFrame(o as LedBarOptions, CTX);
      const panel = diffuserPieces(f.s)[0];
      expect(Math.min(...panel.map((p) => p[0]))).toBeLessThanOrEqual(LED.c);
      expect(Math.max(...panel.map((p) => p[0]))).toBeGreaterThan((o as LedBarOptions).strip + 1);
      // Between the end caps, 0.3 mm clear of each.
      const mb = m.boundingBox();
      expect(mb.min[0]).toBeCloseTo(LED.cap + 0.3, 3);
      expect(mb.max[0]).toBeCloseTo((o as LedBarOptions).length - LED.cap - 0.3, 3);
      body.delete();
      m.delete();
    });
  }

  it('its hooks overlap the lips they snap behind, in profile', () => {
    const { D, c, lip, gw, gd } = LED;
    const s = 12;
    const [, , lower, , upper] = diffuserPieces(s);
    const us = (q: [number, number][]) => q.map((p) => p[0]);
    const vs = (q: [number, number][]) => q.map((p) => p[1]);
    // The low wall's lip is u ∈ [-gd, 0], v ∈ [D - lip, D]; its groove v ∈ [D - lip - gw, D - lip].
    expect(Math.min(...us(lower))).toBeCloseTo(-gd + c, 6);
    expect(0 - Math.min(...us(lower))).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...vs(lower))).toBeLessThanOrEqual(D - lip - c + 1e-9);
    expect(Math.min(...vs(lower))).toBeGreaterThanOrEqual(D - lip - gw + c - 1e-9);
    // The top's lip is u ∈ [s - gd, s], v ∈ [-lip, 0].
    expect(s - Math.min(...us(upper))).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...vs(upper))).toBeLessThanOrEqual(-lip - c + 1e-9);
  });

  it('notes a steep aim, lists the strip', () => {
    const def = attachmentDef('ledBar')!;
    const o = (x: object) => def.sanitize(x);
    for (const angle of [0, 30, 45]) expect(def.notes!(o({ angle }), CTX)).toEqual([]);
    expect(def.notes!(o({ angle: 60 }), CTX).join()).toMatch(/45°/);
    expect(def.hardware!(o({ length: 200, strip: 12 }))).toEqual([{ item: 'LED strip 12 mm wide', count: 1, note: expect.stringMatching(/^196 mm/) }]);
    expect(def.hardware!(o({ length: 200, caps: false }))[0].note).toMatch(/^200 mm/);
    expect(def.parts!(o({ diffuser: false }), CTX)).toEqual([]);
  });

  it('a wire hole only in the capped ends asked for', () => {
    const vol = (opts: object) => {
      const { body } = hung('ledBar', { length: 80, ...opts });
      const v = body.volume();
      body.delete();
      return v;
    };
    const one = vol({ caps: true, wire: 'right' });
    const both = vol({ caps: true, wire: 'both' });
    // Each hole takes a 5 mm square on its corner (12.5 mm²) out of a 2 mm cap.
    expect(one - both).toBeGreaterThan(20);
    expect(one - both).toBeLessThan(50);
  });
});

describe('cable channel', () => {
  it('the lid snaps on: in place without touching, caught when pulled', () => {
    for (const opts of [{}, { width: 40, height: 30, exits: 60 }]) {
      const { body, parts } = hung('cableChannel', opts);
      const lid = parts.find((x) => x.p.key === 'lid')!.m!;
      expect(shared(body, lid.translate([0, 0, 0]))).toBeLessThan(0.02);
      expect(shared(body, lid.translate([0, 0.5, 0]))).toBeGreaterThan(20);
      // Over the walls: the plate covers the channel from the board to its front.
      const lb = lid.boundingBox();
      const bb = body.boundingBox();
      expect(lb.max[2]).toBeCloseTo(bb.max[2], 3);
      expect(lb.min[2]).toBeCloseTo(0, 3);
      body.delete();
      lid.delete();
    }
  });

  it('side exits: notches in the front wall, the lid open over them', () => {
    const o: CableChannelOptions = { length: 200, width: 20, height: 15, lid: true, exits: 50 };
    const xs = channelExits(o);
    expect(xs).toEqual([25, 75, 125, 175]);
    const { body, parts } = hung('cableChannel', o);
    const lid = parts[0].m!;
    const { H, Z } = channelSize(o, CTX);
    // A cable leaving forward through an exit passes the front wall and the lid's front leg.
    const cable = w.Manifold.cylinder(Z, 3, 3, 48).translate([75, H - 4, CH.back + 2]);
    expect(shared(body, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
    expect(shared(lid, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
    // Where there's no exit, the front wall is there.
    expect(shared(body, cable.translate([25, 0, 0]))).toBeGreaterThan(1);
    cable.delete();
    body.delete();
    lid.delete();
    expect(H - CH.floor).toBeCloseTo(15, 6);
  });
});

describe('cable clip', () => {
  it('round: a cable sits in each seat, and it takes a push to get it out', () => {
    const opts: CableClipOptions = { style: 'round', diameter: 8, flatW: 12, flatT: 3, count: 3, gap: 3, width: 10 };
    const { body } = hung('cableClip', opts);
    const seat = clipSeat(opts);
    const { st, H } = clipHeight(opts, CTX);
    // The opening is 90% of the cable.
    expect(seat.o / opts.diameter).toBeCloseTo(0.9, 6);
    for (let k = 0; k < opts.count; k++) {
      const yc = (H - st) / 2 + k * (seat.h + opts.gap) + seat.h / 2;
      const cable = rod(opts.diameter, 30, [-10, yc, seat.zc], 'x');
      expect(shared(body, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
      // Pulled out by a quarter of its diameter it runs into the arms.
      expect(shared(body, cable.translate([0, 0, opts.diameter / 4]))).toBeGreaterThan(0.5);
      cable.delete();
    }
    body.delete();
  });

  it('flat: the cable slides into its slot past the lips', () => {
    const opts: CableClipOptions = { style: 'flat', diameter: 6, flatW: 15, flatT: 2.5, count: 2, gap: 4, width: 12 };
    const { body, layout } = hung('cableClip', opts);
    const seat = clipSeat(opts);
    const { st, H } = clipHeight(opts, CTX);
    for (let k = 0; k < opts.count; k++) {
      const yc = (H - st) / 2 + k * (seat.h + opts.gap) + seat.h / 2;
      const cable = box(-5, yc - opts.flatT / 2, 3.05, layout.w + 5, yc + opts.flatT / 2, 3.05 + opts.flatW);
      expect(shared(body, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
      expect(shared(body, cable.translate([0, 0, 1]))).toBeGreaterThan(0.5);
      cable.delete();
    }
    body.delete();
  });
});

describe('power strip holder', () => {
  for (const opts of [
    { style: 'brackets', cable: 'left', strap: true },
    { style: 'tray', cable: 'open', width: 40, height: 30, lip: 10 },
  ] as Partial<PowerStripOptions>[]) {
    it(`${JSON.stringify(opts)}: the strip fits, and stays put`, () => {
      const { o, body } = hung('powerStrip', opts);
      const p = o as PowerStripOptions;
      const { L } = stripSize(p, CTX);
      const x0 = p.cable === 'open' ? -20 : PS.end + PS.c / 2;
      const len = p.cable === 'open' ? L + 40 : p.length;
      // The strip on the floor, against the back plate (touching faces leave a film of float32 noise).
      const strip = box(x0, PS.floor, PS.back, x0 + len, PS.floor + p.height, PS.back + p.width);
      expect(shared(body, strip.translate([0, 0, 0]))).toBeLessThan(0.05);
      // The lip stops it sliding off the front; end walls stop it sliding out of the ends.
      expect(shared(body, strip.translate([0, 0, PS.c + 1]))).toBeGreaterThan(1);
      if (p.cable !== 'open') expect(shared(body, strip.translate([PS.c, 0, 0]))).toBeGreaterThan(1);
      strip.delete();
      body.delete();
    });
  }

  it('the cable leaves through the notch on its side; straps are listed', () => {
    const { body, o } = hung('powerStrip', { cable: 'right' });
    const p = o as PowerStripOptions;
    const { L } = stripSize(p, CTX);
    const zm = PS.back + (p.width + PS.c) / 2;
    const cable = rod(6, 20, [L - 10, PS.floor + 8, zm], 'x');
    expect(shared(body, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
    expect(shared(body, cable.translate([-L, 0, 0]))).toBeGreaterThan(1);
    cable.delete();
    body.delete();
    const def = attachmentDef('powerStrip')!;
    expect(def.hardware!(def.sanitize({}))).toEqual([]);
    expect(def.hardware!(def.sanitize({ strap: true, width: 50, height: 40 }))).toEqual([
      { item: 'Hook-and-loop strap, 20 mm wide', count: 2, note: 'at least 220 mm long' },
    ]);
  });
});

describe('cable comb', () => {
  it('each cable clicks into its own slot', () => {
    const opts: CableCombOptions = { count: 3, diameter: 5, gap: 5 };
    const { body } = hung('cableComb', opts);
    const { r, zc } = combSize(opts);
    for (let k = 0; k < opts.count; k++) {
      const x = opts.gap + r + k * (2 * r + opts.gap);
      const cable = rod(opts.diameter, 40, [x, -10, zc], 'y');
      expect(shared(body, cable.translate([0, 0, 0]))).toBeLessThan(0.01);
      expect(shared(body, cable.translate([0, 0, opts.diameter / 4]))).toBeGreaterThan(0.2);
      cable.delete();
    }
    body.delete();
  });
});

describe('on a 560 × 560 board', () => {
  it('every kind places without a warning, and its extra parts print with it', () => {
    const atts: PlacedAttachment[] = [
      { id: 'led', type: 'ledBar', x: 60, y: 520, opts: {} },
      { id: 'ch', type: 'cableChannel', x: 60, y: 440, opts: {} },
      { id: 'ps', type: 'powerStrip', x: 320, y: 520, opts: { cable: 'left', strap: true } },
      { id: 'cl', type: 'cableClip', x: 60, y: 300, opts: {} },
      { id: 'co', type: 'cableComb', x: 300, y: 300, opts: {} },
    ];
    const d: NamedDrawer = {
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 }, attachments: atts },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    };
    const job = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.map((p) => p.ok)).toEqual(atts.map(() => true));
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // Five attachments, the diffuser and the lid.
    expect(parts).toHaveLength(7);
    expect(parts.map((p) => p.name).join()).toMatch(/Diffuser \(clear or white PETG\)/);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key)).toBe(true);
  });
});
