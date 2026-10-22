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
import { attachmentDef, type AttachmentLayout, type AttachmentPreset, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { mountBox, partBounds, printedSize, siteAt, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { SADDLE, saddleStack, yokeShape, type SaddleOptions } from '../src/lib/wall/kinds/saddle';
import { MAG, magnetPlan, magnetRow, type MagnetBarOptions } from '../src/lib/wall/kinds/magnetBar';
import { MEASURE, measurePlan, type MeasureHangerOptions } from '../src/lib/wall/kinds/measureHanger';
import { EYE, eyeShape, type EyewearOptions } from '../src/lib/wall/kinds/eyewear';
import { CLAMP, clampPlan, type ClampRackOptions } from '../src/lib/wall/kinds/clampRack';
import { TAB, tabPlan, type ClipTabOptions } from '../src/lib/wall/kinds/clipTab';

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
/** A round bar along z (out from the board), axis at (x, y). */
const barZ = (z0: number, z1: number, r: number, x: number, y: number) => keep(keep(w.Manifold.cylinder(z1 - z0, r, r, 96)).translate([x, y, z0]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();
/** The part's extent inside a box (null when nothing of it is there). */
const within = (a: Manifold, b: Manifold) => {
  const i = keep(a.intersect(b));
  return i.isEmpty() ? null : i.boundingBox();
};

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

/** Build a kind with options, and turn it back into its own frame. */
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

const presetsOf = (type: string): AttachmentPreset[] => {
  const f = attachmentUi(type)!.fields.find((x) => x.kind === 'preset');
  return f && f.kind === 'preset' ? f.presets : [];
};
const columns = (l: AttachmentLayout) => new Set(l.mounts.map((m) => m.di)).size;
const rows = (l: AttachmentLayout) => new Set(l.mounts.map((m) => m.dj)).size;

/** Each kind: a few option sets and every preset build clean at their planned size. */
function cleanBuilds(type: string, sets: object[]) {
  for (const opts of sets)
    it(`${type} ${JSON.stringify(opts)} builds clean`, () => {
      expectClean(build(type, opts), `${type} ${JSON.stringify(opts)}`);
    });
  it(`${type}: every preset builds clean`, () => {
    const presets = presetsOf(type);
    expect(presets.length).toBeGreaterThan(2);
    for (const p of presets) expectClean(build(type, p.set), `${type} ${p.value}`);
  });
}

describe('headphone & controller hanger', () => {
  cleanBuilds('saddle', [
    { count: 3, cleat: true, shelf: 50, reach: 200 },
    { width: 75, radius: 20, lip: 0, arm: 14 },
    { mode: 'yoke', tilt: 30, reach: 150, tip: 40, pad: true },
  ]);

  it('prints a saddle on its side with a hook and a stud, a yoke upright with two columns of clips', () => {
    const s = build('saddle');
    expect(s.layout.pose).toBe('side');
    expect(s.layout.mounts.map((m) => m.kind)).toEqual(['hook', 'stud']);
    const y = build('saddle', { mode: 'yoke' });
    expect(y.layout.pose).toBe('upright');
    expect(columns(y.layout)).toBe(2);
    expect(y.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
    // A guitar: a back at least 100 mm tall, clips and two rows of studs.
    const g = build('saddle', presetsOf('saddle').find((p) => p.value === 'guitar')!.set);
    expect(g.layout.h).toBeGreaterThanOrEqual(100);
    expect(columns(g.layout)).toBe(2);
    expect(rows(g.layout)).toBe(3);
  });

  it('a headband rests along the whole curve of the saddle, and the lip keeps it on', () => {
    const b = build('saddle');
    const o = b.o as SaddleOptions;
    const st = saddleStack(o, CTX);
    const [z0, z1] = st.seats[0];
    const W = b.layout.w;
    // The band: a shell round the saddle's curve, as wide as its seat; resting, it doesn't cut in.
    const band = (drop: number, za: number, zb: number) =>
      keep(barZ(za, zb, o.radius + 3, W / 2, st.crown - o.radius - drop).subtract(barZ(za - 1, zb + 1, o.radius + 0.05, W / 2, st.crown - o.radius - drop)));
    expect(overlap(b.hung, band(0, z0 + 0.5, z1 - 0.5))).toBeLessThan(0.05);
    // Pressed 0.5 mm in, it meets the saddle right across: the load spreads over the curve, not an edge.
    const pressed = within(b.hung, band(0.5, z0 + 0.5, z1 - 0.5))!;
    expect(pressed.min[0]).toBeLessThan(3);
    expect(pressed.max[0]).toBeGreaterThan(W - 3);
    // Slid forward, it meets the lip.
    expect(overlap(b.hung, band(0, st.D - SADDLE.lipT + 0.5, st.D - 0.5))).toBeGreaterThan(10);
    // The saddle's edges drop by the curve's sag: 70 mm radius over 50 mm.
    expect(st.sag).toBeCloseTo(70 - Math.sqrt(70 ** 2 - 25 ** 2), 6);
  });

  it('a guitar neck goes between the prongs, the headstock rests on them and the tips keep it on', () => {
    const b = build('saddle', presetsOf('saddle').find((p) => p.value === 'guitar')!.set);
    const o = b.o as SaddleOptions;
    const y = yokeShape(o, CTX);
    const W = b.layout.w;
    // The neck, a little narrower than the gap, all the way down and up.
    expect(overlap(b.hung, box(o.prong + 0.5, -200, 40, W - o.prong - 0.5, 200, y.D - 1))).toBeLessThan(0.01);
    // The headstock, wider than the gap, on the prongs in front of the gussets.
    const head = (bottom: number) => box(4, bottom, 60, W - 4, bottom + 40, 75);
    expect(overlap(b.hung, head(y.top(75) + 0.05))).toBeLessThan(0.01);
    expect(overlap(b.hung, head(y.top(60) - 0.5))).toBeGreaterThan(10);
    // Pulled forward, it meets the tips.
    expect(overlap(b.hung, box(4, y.top(y.D) + 1, y.D - 3, W - 4, y.top(y.D) + 10, y.D + 5))).toBeGreaterThan(10);
    // Felt grooves along the prongs, and the felt on the list.
    const bare = build('saddle', { ...b.o, pad: false });
    expect(keep(bare.hung).volume() - b.hung.volume()).toBeGreaterThan(2 * SADDLE.grooveD * 6 * 40);
    expect(attachmentDef('saddle')!.hardware!(b.o)).toEqual([
      { item: 'Self-adhesive felt strip, 8 mm wide', count: 2, note: '84 mm each, in the prongs’ grooves' },
    ]);
  });

  it('notes a heavy load, ear cups near the board and a long reach; names itself', () => {
    const def = attachmentDef('saddle')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize(presetsOf('saddle').find((p) => p.value === 'guitar')!.set), CTX).join()).toMatch(/3–4 kg.*PETG/);
    expect(def.notes!(def.sanitize({ count: 3 }), CTX).join()).toMatch(/ear cups may touch the board/);
    expect(def.notes!(def.sanitize({ mode: 'yoke', reach: 200, tip: 0, tilt: 0, height: 20 }), CTX).join()).toMatch(/three times/);
    expect(def.summary(def.sanitize({}))).toBe('Headphone hanger 50 mm');
    expect(def.summary(def.sanitize({ count: 2 }))).toBe('Headphone hanger × 2');
    expect(def.summary(def.sanitize({ mode: 'yoke', gap: 38 }))).toBe('Yoke hanger, 38 mm gap');
    expect(def.hardware!(def.sanitize({}))).toEqual([]);
  });
});

describe('magnetic tool bar', () => {
  cleanBuilds('magnetBar', [
    { fix: 'skin', angle: 15, lip: 10, magD: 12 },
    { shape: 'block', magD: 60, magW: 10, magT: 5, length: 300 },
    { magD: 18, magT: 1, height: 80, angle: 10 },
  ]);

  it('glued: each magnet fits its pocket with 0.15 mm all round, behind 1 mm of plastic, pushed in from the back', () => {
    const b = build('magnetBar');
    const o = b.o as MagnetBarOptions;
    const p = magnetPlan(o, CTX);
    expect(p.n).toBe(8);
    for (const x of p.xs) {
      // Seated against the front of its pocket, it touches nothing; 0.3 mm bigger, it would rub.
      expect(overlap(b.hung, barZ(p.zf - o.magT, p.zf - 0.01, o.magD / 2, x, p.yc))).toBeLessThan(0.01);
      expect(overlap(b.hung, barZ(p.zf - o.magT, p.zf - 0.01, o.magD / 2 + 0.3, x, p.yc))).toBeGreaterThan(0.5);
      // Its way in from the back is clear.
      expect(overlap(b.hung, barZ(-1, p.zf - 0.01, o.magD / 2, x, p.yc))).toBeLessThan(0.01);
      // 1 mm of plastic in front of it, then the face.
      expect(overlap(b.hung, barZ(p.zf + 0.05, p.zf + MAG.cover - 0.05, o.magD / 2, x, p.yc))).toBeCloseTo(Math.PI * 25 * 0.9, 0);
      expect(overlap(b.hung, barZ(p.zf + MAG.cover + 0.05, p.zf + 3, o.magD / 2, x, p.yc))).toBeLessThan(0.01);
    }
    // The pockets keep clear of the clips, which need the back solid.
    for (const m of b.layout.mounts) {
      const mb = mountBox(m.kind, siteAt(b.layout, m, CTX), CTX);
      expect(mb.y0).toBeGreaterThan(p.yc + p.py1);
    }
  });

  it('glued in a tall bar: the studs keep clear of the pockets too', () => {
    const b = build('magnetBar', { height: 80, magD: 18, magT: 1 });
    const p = magnetPlan(b.o as MagnetBarOptions, CTX);
    expect(b.layout.mounts.some((m) => m.kind === 'stud')).toBe(true);
    for (const m of b.layout.mounts) {
      const mb = mountBox(m.kind, siteAt(b.layout, m, CTX), CTX);
      expect(mb.y0 > p.yc + p.py1 || mb.y1 < p.yc - p.py0).toBe(true);
    }
  });

  it('sealed: closed pockets under a 0.5 mm skin, open until the pause, a pin-hole to let air out', () => {
    const b = build('magnetBar', { fix: 'skin', length: 120 });
    const o = b.o as MagnetBarOptions;
    const p = magnetPlan(o, CTX);
    expect(p.n).toBe(5);
    const r = o.magD / 2;
    for (const x of p.xs) {
      expect(overlap(b.hung, barZ(p.zf - o.magT, p.zf - 0.01, r, x, p.yc))).toBeLessThan(0.01);
      expect(overlap(b.hung, barZ(p.zf - o.magT, p.zf - 0.01, r + 0.4, x, p.yc))).toBeGreaterThan(0.5);
      // The skin: 0.5 mm of plastic over the magnet, then the face.
      expect(overlap(b.hung, box(x - 4, p.yc - 4, p.zf + 0.05, x + 4, p.yc + 4, p.zf + 0.45))).toBeCloseTo(64 * 0.4, 1);
      expect(overlap(b.hung, box(x - 4, p.yc - 4, p.zf + 0.55, x + 4, p.yc + 4, p.zf + 2))).toBeLessThan(0.01);
      // Open just under the pause height, closed over the pocket.
      expect(overlap(b.hung, box(x - r, p.pause - 0.15, p.zf - p.mt + 0.05, x + r, p.pause - 0.05, p.zf - 0.05))).toBeLessThan(0.01);
      expect(overlap(b.hung, box(x - r, p.yc + p.py1 + 0.05, p.zf - p.mt + 0.05, x + r, p.yc + p.py1 + 0.5, p.zf - 0.05))).toBeGreaterThan(1);
      // The pin-hole down to the underside.
      const zm = p.zf - p.mt / 2;
      expect(overlap(b.hung, box(x - 0.3, -1, zm - 0.3, x + 0.3, p.yc - p.py0, zm + 0.3))).toBeLessThan(0.01);
    }
    expect(p.pause).toBeCloseTo(p.yc + p.py1, 1);
    expect(attachmentDef('magnetBar')!.notes!(o, CTX)).toEqual([
      `Pause the print at Z = ${p.pause} mm, before the layer that closes the pockets, and drop the magnets in.`,
    ]);
  });

  it('bar magnets fit their pockets too', () => {
    const b = build('magnetBar', { shape: 'block', magD: 60, magW: 10, magT: 5, length: 300 });
    const p = magnetPlan(b.o as MagnetBarOptions, CTX);
    expect(p.n).toBe(4);
    for (const x of p.xs) {
      expect(overlap(b.hung, box(x - 30, p.yc - 5, p.zf - 5, x + 30, p.yc + 5, p.zf - 0.01))).toBeLessThan(0.01);
      expect(overlap(b.hung, box(x - 30.3, p.yc - 5.3, p.zf - 5, x + 30.3, p.yc + 5.3, p.zf - 0.01))).toBeGreaterThan(1);
    }
  });

  it('the face leans back as asked, the lip catches at the foot', () => {
    const b = build('magnetBar', { angle: 15, lip: 10 });
    const p = magnetPlan(b.o as MagnetBarOptions, CTX);
    const H = b.layout.h;
    expect((p.Tb - p.Tt) / H).toBeCloseTo(Math.tan((15 * Math.PI) / 180), 6);
    // At the top it is as thin as planned (the box's lowest point is 1 mm down the slope).
    expect(within(b.hung, box(-1, H - 1, -0.01, 300, H - 0.5, 50))!.max[2]).toBeCloseTo(p.Tt + Math.tan((15 * Math.PI) / 180), 2);
    expect(b.layout.depth).toBeCloseTo(p.Tb + 10, 6);
    expect(within(b.hung, box(50, 0, p.Tb + 9, 60, 20, p.Tb + 9.5))!.max[1]).toBeCloseTo(MAG.lipT + MAG.lipUp, 3);
  });

  it('lists the magnets, with the glue warning', () => {
    const def = attachmentDef('magnetBar')!;
    expect(def.hardware!(def.sanitize({}))).toEqual([
      { item: 'Magnets 10 × 3 mm (magnetic bar)', count: 8, note: 'glue them in from the back (superglue or epoxy): unglued magnets work loose' },
    ]);
    expect(def.hardware!(def.sanitize({ shape: 'block', magD: 60, magW: 10, magT: 5 }))[0]).toMatchObject({
      item: 'Magnets 60 × 10 × 5 mm (magnetic bar)',
      count: 3,
    });
    expect(magnetRow(def.sanitize({ pitch: 8 }) as MagnetBarOptions).n).toBe(14);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.summary(def.sanitize({}))).toBe('Magnetic bar 200 mm, 8 magnets');
  });
});

describe('measuring tool hanger', () => {
  cleanBuilds('measureHanger', [
    { tool: 'square', beamAt: -10 },
    { tool: 'ruler', beamW: 25, beamT: 1, count: 3 },
    { beamAt: 38, clearance: 3, height: 100 },
  ]);

  it('a caliper: the beam hangs down a slot, the slider rests in its pocket, and it goes in from the front', () => {
    const b = build('measureHanger');
    const o = b.o as MeasureHangerOptions;
    const p = measurePlan(o);
    const B = MEASURE.back;
    const slot = p.slots[0];
    const sx = (slot.x0 + slot.x1) / 2;
    const zb = B + 2;
    const beam = (dz: number) => box(sx - o.beamW / 2, -100, zb + dz, sx + o.beamW / 2, p.floor + 0.5, zb + o.beamT + dz);
    const slider = (y0: number, dz = 0) => box(sx + o.beamAt - o.bodyW, y0, B + 1 + dz, sx + o.beamAt, y0 + o.bodyH, B + 1 + o.bodyD + dz);
    expect(overlap(b.hung, beam(0))).toBeLessThan(0.01);
    expect(overlap(b.hung, slider(p.floor + 0.01))).toBeLessThan(0.01);
    // It rests on the ledge: it can't drop through.
    expect(overlap(b.hung, slider(p.floor - 1))).toBeGreaterThan(10);
    // In from the front: the beam slides along its slot, the slider over the front lip.
    for (const dz of [5, 15, 30]) {
      expect(overlap(b.hung, beam(dz))).toBeLessThan(0.01);
      expect(overlap(b.hung, slider(p.front + 0.1, dz))).toBeLessThan(0.01);
    }
    // The pocket's walls keep it from swinging: 15 mm for a 75 mm slider, the front 6.
    expect(p.top - p.floor).toBeCloseTo(15, 6);
    expect(p.front - p.floor).toBeCloseTo(MEASURE.lip, 6);
    expect(columns(b.layout)).toBe(2);
  });

  it('a combination square: the blade at the end of the head', () => {
    const b = build('measureHanger', presetsOf('measureHanger').find((q) => q.value === 'combo300')!.set);
    const o = b.o as MeasureHangerOptions;
    const p = measurePlan(o);
    const sx = (p.slots[0].x0 + p.slots[0].x1) / 2;
    expect(p.pocket!.x1 - o.clearance - sx).toBeCloseTo(14, 6);
    expect(overlap(b.hung, box(sx - 12.5, -100, 6, sx + 12.5, 10, 6 + o.beamT))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(sx + 14 - 100, p.floor + 0.01, 4, sx + 14, 60, 29))).toBeLessThan(0.01);
  });

  it('rulers stand in slots one in front of the other, on the floor', () => {
    const b = build('measureHanger', { tool: 'ruler', beamW: 25, beamT: 1, count: 3 });
    const p = measurePlan(b.o as MeasureHangerOptions);
    expect(p.slots).toHaveLength(3);
    for (const s of p.slots) {
      const xm = (s.x0 + s.x1) / 2;
      const zm = (s.z0 + s.z1) / 2;
      const ruler = (y0: number) => box(xm - 12.5, y0, zm - 0.5, xm + 12.5, 300, zm + 0.5);
      expect(overlap(b.hung, ruler(MEASURE.floor + 0.01))).toBeLessThan(0.01);
      expect(overlap(b.hung, ruler(MEASURE.floor - 0.5))).toBeGreaterThan(5);
    }
    expect(attachmentDef('measureHanger')!.summary(b.o)).toBe('Ruler rack, 3 rulers');
  });

  it('a speed square: the plate through its slot, the fence on the ledge', () => {
    const b = build('measureHanger', presetsOf('measureHanger').find((q) => q.value === 'speed7')!.set);
    const o = b.o as MeasureHangerOptions;
    const p = measurePlan(o);
    const s = p.slots[0];
    const zm = (s.z0 + s.z1) / 2;
    const xm = (s.x0 + s.x1) / 2;
    expect(overlap(b.hung, box(xm - 89, -150, zm - 2.5, xm + 89, p.floor + 1, zm + 2.5))).toBeLessThan(0.01);
    // The fence, 20 mm thick, on the ledge; it can't go through.
    expect(overlap(b.hung, box(xm - 89, p.floor + 0.01, zm - 10, xm + 89, p.floor + 20, zm + 10))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(xm - 89, p.floor - 1, zm - 10, xm + 89, p.floor + 20, zm + 10))).toBeGreaterThan(10);
  });

  it('a tape measure sits in its cradle', () => {
    const b = build('measureHanger', presetsOf('measureHanger').find((q) => q.value === 'tape8')!.set);
    const o = b.o as MeasureHangerOptions;
    const q = measurePlan(o).pocket!;
    expect(overlap(b.hung, box(q.x0 + o.clearance, MEASURE.floor + 0.01, q.z0 + o.clearance, q.x1 - o.clearance, 200, q.z1 - o.clearance))).toBeLessThan(0.01);
    expect(attachmentDef('measureHanger')!.summary(b.o)).toBe('Tape measure cradle');
  });

  it('notes a beam off the slider', () => {
    const def = attachmentDef('measureHanger')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ beamAt: 60 }), CTX).join()).toMatch(/off the slider/);
    expect(def.summary(def.sanitize({}))).toBe('Caliper hanger');
  });
});

describe('glasses rest', () => {
  cleanBuilds('eyewear', [
    { style: 'temple', pairs: 4, tip: 25 },
    { pairs: 4, angle: 30, reach: 120, width: 60, tip: 40, spacing: 30 },
    { pairs: 1, angle: 0, width: 14, tip: 4, reach: 25 },
  ]);

  it('one arm per pair, one above the other; on its side with a hook and studs', () => {
    const b = build('eyewear', { pairs: 3 });
    const e = eyeShape(b.o as EyewearOptions, CTX);
    expect(e.arms).toHaveLength(3);
    expect(e.arms[1] - e.arms[0]).toBeCloseTo(60, 6);
    expect(e.tipTop(e.arms[2])).toBeCloseTo(b.layout.h, 0);
    expect(b.layout.pose).toBe('side');
    expect(b.layout.mounts.map((m) => m.kind)).toEqual(['hook', 'stud', 'stud']);
    for (const yb of e.arms) expect(overlap(b.hung, box(0, yb + 1, 20, b.layout.w, yb + 3, 30))).toBeGreaterThan(10);
  });

  it('the nose: a flat crest, sides at 45° down to the arm', () => {
    const b = build('eyewear');
    const o = b.o as EyewearOptions;
    const e = eyeShape(o, CTX);
    const top = e.tipTop(e.arms[1]);
    const R = e.R;
    const across = (below: number) => {
      const bb = within(b.hung, box(-1, top - below - 0.05, R - 3.5, 100, top - below + 0.05, R - 1.5))!;
      return bb.max[0] - bb.min[0];
    };
    expect(across(0.5)).toBeCloseTo(2 * (EYE.crest + 0.5), 0);
    expect(across(6)).toBeCloseTo(2 * (EYE.crest + 6), 0);
    expect(across(o.tip + 1)).toBeCloseTo(b.layout.w, 1);
  });

  it('a temple drops into its slot; one too thick does not', () => {
    const b = build('eyewear', presetsOf('eyewear').find((p) => p.value === 'pocket')!.set);
    const e = eyeShape(b.o as EyewearOptions, CTX);
    for (const yb of e.arms) {
      const temple = (t: number) => box(4, yb + EYE.arm + 0.05, EYE.back + 2.5 - t / 2, 20, yb + 45, EYE.back + 2.5 + t / 2);
      expect(overlap(b.hung, temple(3))).toBeLessThan(0.01);
      expect(overlap(b.hung, temple(5.6))).toBeGreaterThan(1);
    }
    expect(attachmentDef('eyewear')!.summary(b.o)).toBe('Glasses hanger, 2 pairs');
  });

  it('goggles: the strap rests on a wide arm behind the lip', () => {
    const b = build('eyewear', presetsOf('eyewear').find((p) => p.value === 'goggles')!.set);
    const o = b.o as EyewearOptions;
    const e = eyeShape(o, CTX);
    const yb = e.arms[0];
    const armTop = (z: number) => yb + (z - EYE.back) * e.t + EYE.arm;
    const strap = (z0: number, z1: number) => box(0, armTop(z1) + 0.05, z0, o.width, armTop(z1) + 5, z1);
    expect(overlap(b.hung, strap(20, e.R - EYE.tipT - 0.1))).toBeLessThan(0.01);
    expect(overlap(b.hung, strap(e.R - EYE.tipT + 0.5, e.R - 0.5))).toBeGreaterThan(10);
    expect(attachmentDef('eyewear')!.summary(b.o)).toBe('Goggle hook × 2');
  });
});

describe('clamp rack', () => {
  cleanBuilds('clampRack', [
    { count: 6, barW: 25, barT: 8, pitch: 55, springs: 0 },
    { count: 1, springs: 0, pitch: 25, barW: 15, barT: 5 },
    { count: 3, pitch: 30, springs: 150, edge: 15, depth: 200, height: 200 },
  ]);

  it('heavy: clips across the top, two rows of studs, gussets between the slots', () => {
    const b = build('clampRack');
    expect(columns(b.layout)).toBeGreaterThanOrEqual(5);
    expect(rows(b.layout)).toBe(3);
    const p = clampPlan(b.o as ClampRackOptions);
    expect(p.gussets).toHaveLength(5);
    // A 45° gusset in the tooth between the first two slots: solid 20 mm up and out of the corner.
    const g = p.gussets[2];
    expect(overlap(b.hung, box(g + 0.2, CLAMP.ledge + 5, CLAMP.back + 5, g + CLAMP.gusset - 0.2, CLAMP.ledge + 20, CLAMP.back + 20))).toBeCloseTo(
      3.6 * 15 * 15,
      0,
    );
  });

  it('a bar slides into its slot from the front, the fixed jaw rests on the ledge behind it', () => {
    const b = build('clampRack');
    const o = b.o as ClampRackOptions;
    const p = clampPlan(o);
    const L = CLAMP.ledge;
    for (const x of p.slots) {
      const bar = (t: number, dz = 0) => box(x - t / 2, -150, p.z0 + 1 + dz, x + t / 2, L + 40, p.z0 + 1 + o.barW + dz);
      expect(overlap(b.hung, bar(o.barT))).toBeLessThan(0.01);
      expect(overlap(b.hung, bar(o.barT + 2 * o.clearance + 0.4))).toBeGreaterThan(1);
      expect(overlap(b.hung, bar(o.barT, 20))).toBeLessThan(0.01);
      // The jaw, 16 mm thick, reaching back toward the board: on the ledge, clear of the gussets.
      const jaw = (y0: number) => box(x - 8, y0, CLAMP.back + 6, x + 8, y0 + 25, p.z0 + 1);
      expect(overlap(b.hung, jaw(L + 0.01))).toBeLessThan(0.01);
      expect(overlap(b.hung, jaw(L - 0.5))).toBeGreaterThan(10);
    }
  });

  it('spring clamps grip a rail as thick as asked, with room behind it', () => {
    const b = build('clampRack', { edge: 14 });
    const p = clampPlan(b.o as ClampRackOptions);
    const rail = within(b.hung, box(p.rail!.x0 + 5, 20, CLAMP.back + 0.5, p.rail!.x0 + 15, 21, 200))!;
    expect(rail.max[2] - rail.min[2]).toBeCloseTo(14, 3);
    expect(rail.max[2]).toBeCloseTo(p.D, 3);
    expect(overlap(b.hung, box(p.rail!.x0 + 2, CLAMP.ledge + 5, p.D - 14 - 15, p.rail!.x1 - 2, 40, p.D - 14.05))).toBeLessThan(0.01);
  });

  it('notes slots too close; names itself', () => {
    const def = attachmentDef('clampRack')!;
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ pitch: 25, barT: 15 }), CTX).join()).toMatch(/closer than the teeth/);
    expect(def.summary(def.sanitize({}))).toBe('Clamp rack, 3 slots + spring rail');
    expect(def.summary(def.sanitize({ count: 1, springs: 0 }))).toBe('Clamp rack, 1 slot');
  });
});

describe('clip tab', () => {
  cleanBuilds('clipTab', [
    { width: 8, thick: 2, length: 25, gap: 1.5, bump: 0.5, pitch: 16, count: 8 },
    { count: 3, pitch: 80, width: 40, bump: 2, gap: 2 },
    { thick: 1.5, bump: 0, length: 80, width: 60 },
  ]);

  it('a belt clip’s leaf slides down behind the tongue, past the bump that keeps it on', () => {
    const b = build('clipTab');
    const o = b.o as ClipTabOptions;
    const p = tabPlan(o, CTX);
    const z0 = TAB.back + o.gap;
    const x = p.xs[0];
    const leaf = (za: number, zb: number, y0: number, y1: number) => box(x - o.width / 2 + 2, y0, za, x + o.width / 2 - 2, y1, zb);
    // A 1 mm leaf goes all the way down.
    expect(overlap(b.hung, leaf(TAB.back + 0.2, TAB.back + 1.2, TAB.foot + 0.05, 80))).toBeLessThan(0.01);
    // The gap is as wide as asked above and below the bump, and the bump narrows it.
    expect(overlap(b.hung, leaf(TAB.back + 0.05, z0 - 0.05, p.bumpY + o.bump + 0.05, 80))).toBeLessThan(0.01);
    expect(overlap(b.hung, leaf(TAB.back + 0.05, z0 - 0.05, TAB.foot + 0.05, p.bumpY - o.bump - 0.05))).toBeLessThan(0.01);
    expect(overlap(b.hung, leaf(z0 - o.bump + 0.1, z0 - 0.05, p.bumpY - 0.2, p.bumpY + 0.2))).toBeGreaterThan(0.1);
    // The tongue: as thick as a belt.
    const t = within(b.hung, box(x - 1, 30, TAB.back + 0.01, x + 1, 31, 50))!;
    expect(t.max[2] - t.min[2]).toBeCloseTo(o.thick, 3);
    expect(columns(b.layout)).toBe(2);
  });

  it('several in a row, as far apart as asked', () => {
    const def = attachmentDef('clipTab')!;
    const p = tabPlan(def.sanitize({ count: 3, pitch: 60 }) as ClipTabOptions, CTX);
    expect(p.xs.map((x) => x - p.xs[0])).toEqual([0, 60, 120]);
    expect(p.W).toBeCloseTo(120 + 32 + 2 * TAB.edge, 6);
    expect(def.summary(def.sanitize({ count: 3 }))).toBe('Clip tabs 3 × 32 mm');
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    expect(def.notes!(def.sanitize({ gap: 1.2, bump: 1 }), CTX).join()).toMatch(/bump is cut to 0.4 mm/);
  });
});

describe('hangers on a board', () => {
  it('every hanger places on a 560 × 560 board without warnings', () => {
    const a = (id: string, type: string, x: number, y: number, opts: Record<string, unknown> = {}): PlacedAttachment => ({ id, type, x, y, opts });
    const list = [
      a('clamps', 'clampRack', 40, 500),
      a('magnets', 'magnetBar', 340, 520),
      a('headphones', 'saddle', 320, 420),
      a('uke', 'saddle', 400, 420, presetsOf('saddle').find((p) => p.value === 'ukulele')!.set),
      a('glasses', 'eyewear', 60, 300),
      a('caliper', 'measureHanger', 140, 300),
      a('rulers', 'measureHanger', 240, 300, { tool: 'ruler', count: 3 }),
      a('tape', 'clipTab', 340, 300),
      a('pens', 'clipTab', 440, 300, { width: 8, thick: 2, length: 25, gap: 1.5, bump: 0.5, pitch: 16, count: 4 }),
      a('goggles', 'eyewear', 60, 140, { style: 'strap', width: 45, pairs: 1 }),
    ];
    const d: NamedDrawer = {
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 }, attachments: list },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    };
    const job = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
    const wall = job.drawers[0].enclosure!.wall!;
    expect(job.warnings).toEqual([]);
    expect(wall.placed.every((p) => p.ok)).toBe(true);
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    expect(parts).toHaveLength(list.length);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});
