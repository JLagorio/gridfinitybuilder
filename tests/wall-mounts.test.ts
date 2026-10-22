import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec2, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { registerFont } from '../src/lib/geometry/text';
import { billOfMaterials } from '../src/lib/bom';
import { cleanAttachments } from '../src/lib/enclosureOptions';
import { attachmentDef, attachmentDefs, type AttachmentExtras, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import {
  BOLT,
  MOUNT,
  hookDrop,
  hookReach,
  lockKey,
  lockKeySolid,
  mountBox,
  partBounds,
  printedSize,
  seatOf,
  siteAt,
  tNut,
  viewTurn,
} from '../src/lib/wall/mount';
import { MOUNT_PARTS, attachmentKey, boltSites, canLock, extrasHardware, mountParts, planExtras } from '../src/lib/wall/plan';
import { labelCut } from '../src/lib/wall/build';
import { Scope } from '../src/lib/geometry/kernel';
import { FIT_TAB, GAUGE, fitTabLayout, fitTabs, gaugeSize, tabCtx, type FitTestOptions } from '../src/lib/wall/kinds/fitTest';
import { TAG, type LabelTagOptions } from '../src/lib/wall/kinds/labelTag';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Turned and moved so its min corner is at `at` (frees `m`). */
function moved(m: Manifold, turn: [number, number, number], at: [number, number, number]): Manifold {
  const r = m.rotate(turn);
  const b = r.boundingBox();
  const out = r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]);
  m.delete();
  r.delete();
  return out;
}

/** Volume two solids share, mm³. */
function shared(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  const v = i.volume();
  i.delete();
  return v;
}

/** `m` moved (a new solid). */
const shift = (m: Manifold, v: Vec3) => m.translate(v);

/** An attachment planned with common options, built, and as it hangs in its own frame (back on the board at z = 0). */
function hung(type: string, opts: object = {}, common: Pick<PlacedAttachment, 'lock' | 'bolt' | 'label' | 'barbs'> = {}, ctx = CTX) {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const e = planExtras(common, def, o, def.layout(o, ctx), ctx);
  const layout = e.layout;
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx, ...(e.extras ? { extras: e.extras } : {}) });
  const pb = partBounds(layout, ctx);
  const body = moved(toManifold(mesh), viewTurn(layout.pose), [pb.x0, pb.y0, pb.z0]);
  return { def, o, layout, mesh, body, extras: e.extras, lock: e.lock, notes: e.notes };
}

/**
 * A board in a part's frame: a slab from its front (z = 0) back `t`, over `x0..x1 × y0..y1` and `margin` round it,
 * with a round-ended slot (ctx's size) at each of `slots`.
 */
function slab(slots: Vec2[], b: { x0: number; x1: number; y0: number; y1: number }, ctx = CTX, t = ctx.t, margin = 20): Manifold {
  const s = new Scope();
  try {
    const W = ctx.slotW;
    const L = ctx.slotL;
    const holes = slots.flatMap(([x, y]) => [
      s.t(w.Manifold.cube([W, L - W, t + 2]).translate([x - W / 2, y - (L - W) / 2, -t - 1])),
      s.t(w.Manifold.cylinder(t + 2, W / 2, W / 2, 96).translate([x, y + (L - W) / 2, -t - 1])),
      s.t(w.Manifold.cylinder(t + 2, W / 2, W / 2, 96).translate([x, y - (L - W) / 2, -t - 1])),
    ]);
    const plate = s.t(w.Manifold.cube([b.x1 - b.x0 + 2 * margin, b.y1 - b.y0 + 2 * margin, t]).translate([b.x0 - margin, b.y0 - margin, -t]));
    return plate.subtract(s.t(w.Manifold.union(holes)));
  } finally {
    s.dispose();
  }
}

/** The slots a part's mounts are in (part frame). */
const mountSlots = (layout: ReturnType<typeof hung>['layout'], ctx = CTX) => layout.mounts.map((m) => siteAt(layout, m, ctx));

const att = (id: string, type: string, x: number, y: number, opts: object = {}, common: Partial<PlacedAttachment> = {}): PlacedAttachment => ({
  id,
  type,
  x,
  y,
  opts: { ...opts },
  ...common,
});
const onBoard = (attachments: PlacedAttachment[], size = 560): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: size, height: size }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (list: PlacedAttachment[], size = 560) => planPrint([onBoard(list, size)], DEFAULT_SETUP, { baseplate: true, bins: true });

describe('hooks', () => {
  it('sit flush with the top of their part, so the slot over the neck is open from the front', () => {
    for (const type of ['hook', 'cableClip', 'gridClip']) {
      const def = attachmentDef(type)!;
      const layout = def.layout(def.sanitize({}), CTX);
      const hook = layout.mounts.find((m) => m.kind === 'hook')!;
      expect(mountBox('hook', siteAt(layout, hook, CTX), CTX).y1, type).toBeCloseTo(layout.h, 2);
      expect(canLock(layout, CTX), type).toBe(true);
    }
    // Parts with clips take no keys (their barbs already hold them on).
    const bin = attachmentDef('bin')!;
    expect(canLock(bin.layout(bin.sanitize({}), CTX), CTX)).toBe(false);
  });

  it('drop on easily and hang snug: the lip closes in toward the neck', () => {
    const { layout, body } = hung('hook');
    const pb = partBounds(layout, CTX);
    const board = (t: number) => slab(mountSlots(layout), pb, CTX, t);
    const nominal = board(CTX.t);
    // Seated, clear of the board. Its play out from the board: the lip catches the board's back at the slot's
    // round end, under the neck, about 0.2 mm out (it was 0.35 mm with a straight lip).
    expect(shared(body, nominal)).toBeLessThan(0.02);
    const catches = (dz: number) => {
      const m = shift(body, [0, 0, dz]);
      const v = shared(m, nominal);
      m.delete();
      return v > 1e-4;
    };
    let lo = 0;
    let hi = 0.6;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      if (catches(mid)) hi = mid;
      else lo = mid;
    }
    expect(lo).toBeGreaterThan(MOUNT.hook.grip - 0.01);
    expect(hi).toBeLessThan(0.26);
    const out = shift(body, [0, 0, 0.35]);
    expect(shared(out, nominal)).toBeGreaterThan(0.01);
    // A board 0.3 mm thicker than set still goes in: it wedges the part a little higher (the weight pulls it tight).
    const thick = board(CTX.t + 0.3);
    expect(shared(body, thick)).toBeGreaterThan(1e-3);
    const wedge = ((0.3 - MOUNT.hook.grip) / (MOUNT.hook.lead - MOUNT.hook.grip)) * MOUNT.hook.ramp;
    const up = shift(body, [0, wedge + 0.1, 0]);
    expect(shared(up, thick)).toBeLessThan(0.02);
    // Its print still lies flat and holds together.
    expect(checkPart(w, hung('hook').mesh).ok).toBe(true);
    for (const m of [body, nominal, out, thick, up]) m.delete();
  });
});

describe('lock keys', () => {
  it('fill the slot over the hook: lifting stops within half a millimetre', () => {
    const { layout, body } = hung('hook', {}, { lock: true });
    const pb = partBounds(layout, CTX);
    const at = siteAt(layout, layout.mounts.find((m) => m.kind === 'hook')!, CTX);
    // The board round the hook's slot (its stud, two slots down, swings out first to take the part off).
    const board = slab([at], { x0: pb.x0 - 10, x1: pb.x1 + 10, y0: at[1] - 18, y1: at[1] + 25 }, CTX, CTX.t, 0);
    const k = lockKey(at, CTX);
    const s = new Scope();
    try {
      const key = s.t(lockKeySolid(w, s, at, CTX));
      // In place: clear of the part, only its crush ribs pressing on the slot's sides.
      expect(shared(key, body)).toBeLessThan(0.01);
      const ribs = shared(key, board);
      expect(ribs).toBeGreaterThan(0);
      expect(ribs).toBeLessThan(0.5);
      // The play: over the hook's neck, and under the slot's end.
      const neck = mountBox('hook', at, CTX).y1;
      const end = at[1] + CTX.slotL / 2 - seatOf(CTX, k.kw);
      expect(k.y0 - neck + (end - k.y1)).toBeLessThanOrEqual(0.5);
      expect(
        s
          .t(shift(key, [0, 0.1, 0]))
          .intersect(board)
          .volume() - ribs,
      ).toBeLessThan(0.01);
      expect(shared(s.t(shift(body, [0, k.y0 - neck - 0.05, 0])), key)).toBeLessThan(0.01);
      // Lifted 0.7 mm, the part pushes the key 0.4 mm up into the slot's end.
      expect(shared(s.t(shift(body, [0, 0.7, 0])), key)).toBeGreaterThan(0.05);
      expect(
        s
          .t(shift(key, [0, 0.7 - (k.y0 - neck), 0]))
          .intersect(board)
          .volume() - ribs,
      ).toBeGreaterThan(0.1);
      // Without it the part lifts until its lip clears the slot, and comes straight out.
      const lift = hookDrop(CTX) + 0.6;
      for (const z of [0, hookReach(CTX) / 2, hookReach(CTX) + 0.5]) {
        expect(shared(s.t(shift(body, [0, lift, z])), board), `lifted, out ${z}`).toBeLessThan(0.02);
      }
      // With it, lifted that far it is deep in the key.
      expect(shared(s.t(shift(body, [0, lift, 0])), key)).toBeGreaterThan(5);
    } finally {
      s.dispose();
      body.delete();
      board.delete();
    }
  });

  it('print upright with no support, and show where they go', () => {
    const { layout, lock } = hung('hook', {}, { lock: true });
    expect(lock).toBe(true);
    const [part] = mountParts({ layout, lock }, CTX);
    expect(part.name).toBe('Lock key');
    const mesh = buildMesh(w, { kind: 'attachmentPart', key: 'k', type: MOUNT_PARTS, part: part.spec, ctx: CTX });
    const c = checkPart(w, mesh);
    expect(c.issues.filter((i) => i.severity === 'error' || i.kind === 'island')).toEqual([]);
    const b = c.topology.bounds;
    expect([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => Math.round(v * 10) / 10)).toEqual(
      [part.w, part.d, part.h].map((v) => Math.round(v * 10) / 10),
    );
    // Its place puts the printed key where the key's solid is.
    const at = siteAt(layout, layout.mounts.find((m) => m.kind === 'hook')!, CTX);
    const s = new Scope();
    try {
      const placed = s.t(moved(toManifold(mesh), part.place!.turn, part.place!.at));
      const want = s.t(lockKeySolid(w, s, at, CTX));
      expect(shared(placed, want)).toBeCloseTo(want.volume(), 0);
    } finally {
      s.dispose();
    }
  });

  it('are an option of parts with hooks, on unless turned off, in the parts list and the 3D view', () => {
    const job = plan([att('h', 'hook', 100, 300), att('c', 'cableClip', 200, 300, {}, { lock: false }), att('b', 'bin', 300, 300, {}, { lock: true })]);
    expect(job.warnings).toEqual([]);
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    expect(parts.filter((p) => p.name.startsWith('Lock key')).map((p) => p.attachment)).toEqual(['h']);
    const items = job.drawers[0].enclosure!.items.filter((i) => i.id.startsWith('att-h-lock'));
    expect(items).toHaveLength(1);
    // Above the hook part, in front of the board.
    const p = job.drawers[0].enclosure!.wall!.placed.find((q) => q.id === 'h')!;
    expect(items[0].y).toBeGreaterThan(p.y1 - 0.01);
    // It takes room on the board above the part: a bin just above it overlaps the key, not the hook.
    const near = (lock: boolean) => plan([att('h', 'hook', 100, 300, {}, { lock }), att('b', 'bin', 120, 360)]).warnings.join();
    expect(near(false)).not.toMatch(/overlap/);
    expect(near(true)).toMatch(/overlap/);
  });
});

describe('bolts', () => {
  it('go through a free slot behind a shelf, the screw clear all the way into its T-nut', () => {
    const { layout, body, extras, mesh } = hung('shelf', { width: 160, height: 80 }, { bolt: 'm3' });
    const bolts = extras!.bolts!;
    // Two on a wide part, at its ends, each on a slot of the lattice and clear of every mount.
    expect(bolts).toHaveLength(2);
    expect(bolts[0].x).toBeLessThan(bolts[1].x);
    for (const b of bolts) {
      const di = (b.x - layout.anchor[0]) / CTX.pitch;
      const dj = (b.y - layout.anchor[1]) / CTX.pitch;
      expect(Number.isInteger(Math.round(di * 1e6) / 1e6) && (Math.round(di + dj) & 1) === 0).toBe(true);
      expect(layout.mounts.some((m) => Math.abs(siteAt(layout, m, CTX)[0] - b.x) < 1e-6 && Math.abs(siteAt(layout, m, CTX)[1] - b.y) < 1e-6)).toBe(false);
      expect(b.seat).toBe(3);
      expect(b.boss).toBe(false);
    }
    expect(checkPart(w, mesh).ok).toBe(true);
    const pb = partBounds(layout, CTX);
    expect(mesh.positions.length).toBeGreaterThan(0);
    const s = new Scope();
    try {
      const slots = [...mountSlots(layout), ...bolts.map((b) => [b.x, b.y] as Vec2)];
      const board = s.t(slab(slots, pb));
      for (const b of bolts) {
        const n = tNut('m3', CTX);
        const [part] = mountParts({ layout, extras: { bolts: [b] } }, CTX);
        const nm = buildMesh(w, { kind: 'attachmentPart', key: 'n', type: MOUNT_PARTS, part: part.spec, ctx: CTX });
        expect(checkPart(w, nm).ok).toBe(true);
        const nut = s.t(moved(toManifold(nm), part.place!.turn, part.place!.at));
        // Behind the board, its boss in the slot, its bar wider than the slot.
        expect(shared(nut, board)).toBeLessThan(0.02);
        expect(n.len).toBeGreaterThan(CTX.slotW + 10);
        expect(nut.boundingBox().max[2]).toBeGreaterThan(-CTX.t);
        expect(nut.boundingBox().max[2]).toBeLessThan(0);
        // An M3 countersunk screw (head flush at the seat, 90°) to the nut's far face: clear of part, board and T-nut.
        const R = BOLT.m3.head / 2;
        const r = 1.5;
        const L = b.screw;
        const screw = s.t(
          w.Manifold.union([
            s.t(w.Manifold.cylinder(L, r, r, 48).translate([b.x, b.y, b.seat - L])),
            s.t(w.Manifold.cylinder(R - r, r, R, 48).translate([b.x, b.y, b.seat - (R - r)])),
          ]),
        );
        for (const m of [body, board, nut]) expect(shared(screw, m)).toBeLessThan(0.02);
        // It reaches through the nut (2.4 mm thick, in its pocket at the T-nut's back).
        expect(b.seat - L).toBeLessThanOrEqual(-(CTX.t + n.t) + 0.2 + 1e-6);
        // The head bears on the countersink: 0.2 mm deeper and it's in the part.
        expect(shared(s.t(shift(screw, [0, 0, -0.2])), body)).toBeGreaterThan(0.05);
      }
    } finally {
      s.dispose();
      body.delete();
    }
  });

  it('list their screws and nuts, warn when there is no room, and take a stud’s slot when they must', () => {
    const job = plan([att('s', 'shelf', 100, 400, { width: 160, height: 80 }, { bolt: 'm4' })]);
    expect(job.warnings).toEqual([]);
    const n = job.drawers[0].enclosure!.wall!.placed[0].extras!.bolts!.length;
    expect(n).toBeGreaterThan(0);
    expect(Object.values(job.parts).filter((p) => p.name.startsWith('T-nut M4'))).toHaveLength(n);
    const bom = billOfMaterials(job);
    const screws = bom.hardware.find((h) => h.item.startsWith('Countersunk screws M4'))!;
    expect(screws.count).toBe(n);
    expect(screws.item).toMatch(/M4 × \d+ \(bolt-on\)/);
    expect(bom.hardware.find((h) => h.item === 'M4 hex nuts (bolt-on)')!.count).toBe(n);
    expect(extrasHardware(undefined)).toEqual([]);
    // A low-fronted bin has no free slot above its front wall; a cable clip takes none.
    const binNotes = hung('bin', {}, { bolt: 'm3' }).notes;
    expect(binNotes.join()).toMatch(/No room for a bolt/);
    expect(boltSites(attachmentDef('cableClip')!, {}, attachmentDef('cableClip')!.layout(attachmentDef('cableClip')!.sanitize({}), CTX), CTX, 'm3')).toEqual(
      [],
    );
    // A bin with a low front: over it.
    const low = hung('bin', { width: 120, height: 90, front: 30 }, { bolt: 'm3' });
    expect(low.extras?.bolts?.length).toBeGreaterThan(0);
    expect(checkPart(w, low.mesh).ok).toBe(true);
    // A Gridfinity shelf has studs in every slot under its clips: a bolt takes one's place.
    const gs = hung('gridShelf', {}, { bolt: 'm3' });
    const before = attachmentDef('gridShelf')!.layout(attachmentDef('gridShelf')!.sanitize({}), CTX).mounts.length;
    expect(gs.extras!.bolts!.length).toBeGreaterThan(0);
    expect(gs.layout.mounts.length).toBe(before - gs.extras!.bolts!.length);
    expect(checkPart(w, gs.mesh).ok).toBe(true);
    // Not enough room behind the board for the T-nut.
    expect(hung('shelf', { width: 160, height: 80 }, { bolt: 'm3' }, { ...CTX, behind: 4 }).notes.join()).toMatch(/behind the board/);
    for (const x of [low, gs]) x.body.delete();
  });

  it('kinds that don’t say where their back is get them next to a top-row clip, on a boss', () => {
    // A shelf as a kind that doesn't say (no backPlate): one step down and across from a clip.
    const def = attachmentDef('shelf')!;
    const o = def.sanitize({ width: 160, height: 80 });
    const layout = def.layout(o, CTX);
    const e = planExtras({ bolt: 'm3' }, {}, o, layout, CTX);
    const bolts = e.extras!.bolts!;
    expect(bolts).toHaveLength(2);
    const top = layout.mounts.filter((m) => m.kind === 'clip').map((m) => siteAt(layout, m, CTX));
    for (const b of bolts) {
      expect(b.boss).toBe(true);
      expect(b.seat).toBeCloseTo((BOLT.m3.head - BOLT.m3.hole) / 2 + 0.8, 6);
      expect(top.some(([x, y]) => Math.abs(Math.abs(x - b.x) - CTX.pitch) < 1e-6 && Math.abs(y - CTX.pitch - b.y) < 1e-6)).toBe(true);
    }
    // Kinds that say there's no room get none; the fallback never takes a stud's slot.
    expect(boltSites({ backPlate: () => null }, o, layout, CTX, 'm3')).toEqual([]);
    expect(boltSites({}, o, layout, CTX, 'm3').some((b) => b.stud)).toBe(false);
    // A bin's back is 2.4 mm: too thin for an M4's head, so it gets a boss inside the bin, and stays as big as planned.
    const bin = hung('bin', { width: 120, height: 90, front: 30 }, { bolt: 'm4' });
    expect(bin.extras!.bolts!.every((b) => b.boss && b.seat > 2.4)).toBe(true);
    const c = checkPart(w, bin.mesh);
    expect(c.ok).toBe(true);
    const want = printedSize(bin.layout, CTX);
    const bb = c.topology.bounds;
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(want.w, 1);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(want.d, 1);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(want.h, 1);
    // The boss is there: plastic just in front of the bin's back round the hole.
    const b = bin.extras!.bolts![0];
    const probe = w.Manifold.cube([1, 1, 0.3]).translate([b.x + BOLT.m4.head / 2 + 0.6, b.y - 0.5, 2.45]);
    expect(shared(bin.body, probe)).toBeGreaterThan(0.25);
    probe.delete();
    bin.body.delete();
  });
});

describe('barbs on the end clips only', () => {
  it('leaves the clips between them plain pegs, the part the same size', () => {
    const all = hung('shelf', { width: 200 });
    const ends = hung('shelf', { width: 200 }, { barbs: 'ends' });
    expect(ends.extras?.barbs).toBe('ends');
    const clips = all.layout.mounts.filter((m) => m.kind === 'clip');
    expect(clips.length).toBeGreaterThan(2);
    const middle = siteAt(all.layout, clips[1], CTX);
    const b = mountBox('clip', middle, CTX);
    const s = new Scope();
    try {
      // Where a middle clip's barb is, behind the board.
      const barb = s.t(w.Manifold.cube([1, b.y1 - b.y0, 1.5]).translate([b.x1 - 1, b.y0, b.z0 + 0.2]));
      expect(shared(all.body, barb)).toBeGreaterThan(0.05);
      expect(shared(ends.body, barb)).toBeLessThan(0.001);
      // The end clips keep theirs.
      const e = mountBox('clip', siteAt(all.layout, clips[0], CTX), CTX);
      const endBarb = s.t(w.Manifold.cube([1, e.y1 - e.y0, 1.5]).translate([e.x0, e.y0, e.z0 + 0.2]));
      expect(shared(ends.body, endBarb)).toBeGreaterThan(0.05);
    } finally {
      s.dispose();
    }
    expect(checkPart(w, ends.mesh).ok).toBe(true);
    const sa = checkPart(w, all.mesh).topology.bounds;
    const se = checkPart(w, ends.mesh).topology.bounds;
    for (let k = 0; k < 3; k++) expect(se.max[k] - se.min[k]).toBeCloseTo(sa.max[k] - sa.min[k], 3);
    // Two clips: nothing to choose.
    expect(hung('shelf', { width: 80 }, { barbs: 'ends' }).extras).toBeUndefined();
    for (const x of [all, ends]) x.body.delete();
  });
});

describe('labels', () => {
  const cases: [string, object][] = [
    ['bin', {}],
    ['bin', { label: true }],
    ['shelf', {}],
    ['gridShelf', {}],
    ['cradle', {}],
    ['cradle', { front: 'lip' }],
    ['plate', {}],
    ['toolRack', {}],
    ['cableChannel', {}],
  ];
  for (const [type, opts] of cases) {
    it(`${type} ${JSON.stringify(opts)}: cut into a face of the part`, () => {
      const def = attachmentDef(type)!;
      const o = def.sanitize(opts);
      const layout = def.layout(o, CTX);
      const f = def.labelFace!(o, layout)!;
      expect(f, type).toBeTruthy();
      // The face is the part's: just inside it is plastic, just outside isn't (both near its corners and middle).
      const plain = hung(type, opts);
      const s = new Scope();
      try {
        for (const [u, v] of [
          [0.1, 0.1],
          [0.5, 0.5],
          [0.9, 0.9],
        ]) {
          const x = f.x + u * f.w;
          const y = f.y + v * f.h;
          const probe = (z: number) => s.t(w.Manifold.cube([0.2, 0.2, 0.2]).translate([x - 0.1, y - 0.1, z]));
          expect(shared(plain.body, probe(f.z - 0.5)), `${type} inside ${u}`).toBeGreaterThan(0.007);
          expect(shared(plain.body, probe(f.z + 0.1)), `${type} outside ${u}`).toBeLessThan(0.001);
        }
      } finally {
        s.dispose();
      }
      const lab = hung(type, opts, { label: 'Screws' });
      expect(lab.extras?.label?.text).toBe('Screws');
      const c = checkPart(w, lab.mesh);
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(c.topology.volume).toBeLessThan(checkPart(w, plain.mesh).topology.volume - 1);
      for (const x of [plain, lab]) x.body.delete();
    });
  }

  it('on a face looking up too, reading from the front', () => {
    const s = new Scope();
    try {
      // A ledge 40 wide, 10 out from the board, its top at y = 5.
      const ledge = s.t(w.Manifold.cube([40, 5, 10]));
      const cut = labelCut(w, s, 'AB', { x: 2, y: 5, w: 36, h: 8, z: 1, normal: 'up' })!;
      const b = cut.boundingBox();
      // Down into the top 0.6 mm, inside the box; wider (x) than it is deep (z), the letters' tops toward the board.
      expect(b.min[1]).toBeCloseTo(5 - 0.6, 6);
      expect(b.min[0]).toBeGreaterThan(2 - 1e-6);
      expect(b.max[0]).toBeLessThan(38 + 1e-6);
      expect(b.min[2]).toBeGreaterThan(1 - 1e-6);
      expect(b.max[2]).toBeLessThan(9 + 1e-6);
      const left = s.t(cut.intersect(s.t(w.Manifold.cube([20, 10, 20]).translate([0, 0, 0]))));
      const right = s.t(cut.intersect(s.t(w.Manifold.cube([20, 10, 20]).translate([20, 0, 0]))));
      // An 'A' on the left, a 'B' on the right.
      expect(left.volume()).toBeGreaterThan(0.5);
      expect(right.volume()).toBeGreaterThan(0.5);
      expect(s.t(ledge.subtract(cut)).volume()).toBeLessThan(ledge.volume() - 1);
      // An 'A' is narrow at its top: read from the front, its top is toward the board (low z).
      const a = s.t(cut.intersect(s.t(w.Manifold.cube([20, 10, 20]))));
      const ab = a.boundingBox();
      const near = s.t(a.intersect(s.t(w.Manifold.cube([20, 10, 1.5]).translate([0, 0, ab.min[2]])))).volume();
      const far = s.t(a.intersect(s.t(w.Manifold.cube([20, 10, 1.5]).translate([0, 0, ab.max[2] - 1.5])))).volume();
      expect(near).toBeLessThan(far);
    } finally {
      s.dispose();
    }
  });

  it('only where a kind has a face for one', () => {
    expect(attachmentDef('hook')!.labelFace).toBeUndefined();
    expect(
      planExtras({ label: 'x' }, attachmentDef('hook')!, {}, attachmentDef('hook')!.layout(attachmentDef('hook')!.sanitize({}), CTX), CTX).extras,
    ).toBeUndefined();
    // A tilted Gridfinity shelf's lip leans: no label; nor down a cable channel with exits.
    const gs = attachmentDef('gridShelf')!;
    expect(gs.labelFace!(gs.sanitize({ tilt: '15' }), gs.layout(gs.sanitize({ tilt: '15' }), CTX))).toBeNull();
    const ch = attachmentDef('cableChannel')!;
    expect(ch.labelFace!(ch.sanitize({ exits: 40 }), ch.layout(ch.sanitize({ exits: 40 }), CTX))).toBeNull();
  });
});

describe('fit test', () => {
  it('names each tab on its front; five tabs make a ladder of slot widths', () => {
    const def = attachmentDef('fitTest')!;
    const three = def.sanitize({}) as FitTestOptions;
    expect(fitTabs(three, CTX).map((t) => t.text)).toEqual(['SNUG', 'NORMAL', 'LOOSE']);
    expect(def.parts!(three, CTX).map((p) => p.key)).toEqual(['snug', 'loose']);
    const five = def.sanitize({ steps: '5' }) as FitTestOptions;
    expect(five.steps).toBe(5);
    const tabs = fitTabs(five, CTX);
    expect(tabs.map((t) => t.text)).toEqual(['4.9', '5.0', '5.1', '5.2', '5.3']);
    const parts = def.parts!(five, CTX);
    expect(parts).toHaveLength(4);
    // Each tab's clip is made for its own slot width: 0.1 mm a step.
    const widths = tabs.map((t) => mountBox('clip', [0, 0], tabCtx(t, CTX)).x1 - mountBox('clip', [0, 0], tabCtx(t, CTX)).x0);
    for (let k = 1; k < widths.length; k++) expect(widths[k] - widths[k - 1]).toBeCloseTo(0.1, 6);
    // Built, with their text cut in (more than the notches take).
    const plain = (tab: (typeof tabs)[number]) => {
      const c = tabCtx(tab, CTX);
      return printedSize(fitTabLayout(c), c);
    };
    for (const p of parts) {
      const mesh = buildMesh(w, { kind: 'attachmentPart', key: p.key, type: 'fitTest', part: p.spec, ctx: CTX });
      const c = checkPart(w, mesh);
      expect(c.ok, p.key).toBe(true);
      const tab = (p.spec as { tab: (typeof tabs)[number] }).tab;
      const size = plain(tab);
      const b = c.topology.bounds;
      expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 1);
      expect(b.max[2] - b.min[2]).toBeCloseTo(size.h, 1);
      // Its text is cut into its front, under the notches: a sliver just under the face there is part gone.
      const l = fitTabLayout(tabCtx(tab, CTX));
      const tb = partBounds(l, tabCtx(tab, CTX));
      const turned = moved(toManifold(mesh), viewTurn('upright'), [tb.x0, tb.y0, tb.z0]);
      const sliver = w.Manifold.cube([l.w - 4, l.h - 10, 0.3]).translate([2, 2, FIT_TAB.depth - 0.4]);
      expect(shared(turned, sliver), p.key).toBeLessThan(sliver.volume() - 1);
      for (const m of [turned, sliver]) m.delete();
    }
  });

  it('has a thickness gauge: numbered notches 4.6 to 5.6 mm, as wide as they say', () => {
    const def = attachmentDef('fitTest')!;
    const o = def.sanitize({ gauge: true });
    const g = def.parts!(o, CTX).find((p) => p.key === 'gauge')!;
    expect(g.name).toBe('Thickness gauge');
    const mesh = buildMesh(w, { kind: 'attachmentPart', key: 'gauge', type: 'fitTest', part: g.spec, ctx: CTX });
    const c = checkPart(w, mesh);
    expect(c.ok).toBe(true);
    const size = gaugeSize();
    expect([g.w, g.d, g.h]).toEqual([size.w, size.d, size.h]);
    const body = toManifold(mesh);
    const s = new Scope();
    try {
      let x = GAUGE.end;
      for (const n of GAUGE.notches) {
        // A board n − 0.02 thick slides in; n + 0.1 doesn't.
        const board = (t: number) => s.t(w.Manifold.cube([t, GAUGE.depth - 0.5, 10]).translate([x + n / 2 - t / 2, -1, -3]));
        expect(shared(body, board(n - 0.02))).toBeLessThan(0.001);
        expect(shared(body, board(n + 0.1))).toBeGreaterThan(0.1);
        // Its number is cut into the band behind it.
        const band = s.t(
          w.Manifold.cube([n + GAUGE.tooth - 1, GAUGE.band - 1, 0.6]).translate([x + n / 2 - (n + GAUGE.tooth - 1) / 2, GAUGE.depth + 0.5, GAUGE.t - 0.6]),
        );
        expect(shared(body, band)).toBeLessThan(band.volume() - 0.3);
        x += n + GAUGE.tooth;
      }
    } finally {
      s.dispose();
      body.delete();
    }
  });
});

describe('label tag', () => {
  it('a card with a clip, its text raised in a rim or cut in, as big as planned', () => {
    const volume = (opts: object) => checkPart(w, hung('labelTag', opts).mesh).topology.volume;
    for (const opts of [{}, { style: 'engraved' }, { width: 120, height: 30, text: 'Spare batteries', size: 8 }, { text: '' }]) {
      const { layout, mesh, def, o, body } = hung('labelTag', opts);
      body.delete();
      const c = checkPart(w, mesh);
      expect(c.ok, JSON.stringify(opts)).toBe(true);
      const want = printedSize(layout, CTX);
      const b = c.topology.bounds;
      expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 1);
      expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
      expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
      const style = (o as LabelTagOptions).style;
      expect(want.d).toBeCloseTo(TAG.card + (style === 'raised' ? TAG.relief : 0) + mountBox('clip', [0, 0], CTX).z1 - mountBox('clip', [0, 0], CTX).z0, 6);
      // The text stands out of the card, or is cut into it.
      const text = (o as { text: string }).text.trim();
      const blank = volume({ ...opts, text: '' });
      if (text) expect(style === 'raised' ? c.topology.volume - blank : blank - c.topology.volume, JSON.stringify(opts)).toBeGreaterThan(2);
      expect(def.summary(o)).toBe(text ? `Label “${text}”` : 'Label tag');
    }
    const wide = attachmentDef('labelTag')!;
    expect(wide.layout(wide.sanitize({ width: 120 }), CTX).mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThanOrEqual(2);
    expect(wide.notes!(wide.sanitize({ text: ' ' }), CTX)).toEqual(['It has no text yet.']);
    expect(attachmentUi('labelTag')?.group).toBe('board');
  });
});

describe('common options', () => {
  it('save and load with the attachment, and leave mesh keys as they were without them', () => {
    const a = att('a', 'shelf', 1, 2, {}, { lock: false, bolt: 'm4', label: 'Paint', barbs: 'ends' });
    expect(cleanAttachments([a, { ...att('b', 'bin', 3, 4), bolt: 'm5', barbs: 'all', label: '  ', lock: 'yes' }])).toEqual([a, att('b', 'bin', 3, 4)]);
    const extras: AttachmentExtras = { barbs: 'ends' };
    expect(attachmentKey('bin', {}, CTX)).toBe(`att|bin|{}|${JSON.stringify(CTX)}`);
    expect(attachmentKey('bin', {}, CTX, extras)).not.toBe(attachmentKey('bin', {}, CTX));
  });

  it('every kind still builds as big as planned with a bolt and a label asked for, or says why not', () => {
    for (const def of attachmentDefs()) {
      const o = def.sanitize(def.defaults);
      const e = planExtras({ bolt: 'm3', label: 'Test', lock: true, barbs: 'ends' }, def, o, def.layout(o, CTX), CTX);
      if (!e.extras) continue;
      const mesh = buildMesh(w, { kind: 'attachment', key: def.type, type: def.type, opts: o, layout: e.layout, ctx: CTX, extras: e.extras });
      const c = checkPart(w, mesh);
      expect(
        c.issues.filter((i) => i.severity === 'error'),
        def.type,
      ).toEqual([]);
      const want = printedSize(e.layout, CTX);
      const b = c.topology.bounds;
      expect(b.max[0] - b.min[0], def.type).toBeCloseTo(want.w, 1);
      expect(b.max[1] - b.min[1], def.type).toBeCloseTo(want.d, 1);
      expect(b.max[2] - b.min[2], def.type).toBeCloseTo(want.h, 1);
    }
  });

  it('all of it on a 560 × 560 board, without warnings', () => {
    const list = [
      att('f', 'fitTest', 60, 520, { steps: '5', gauge: true }),
      att('t', 'labelTag', 200, 520, { text: 'Tools' }),
      att('h', 'hook', 300, 520, {}, { lock: true }),
      att('s', 'shelf', 60, 420, { width: 160, height: 80 }, { bolt: 'm3', label: 'Paint', barbs: 'ends' }),
      att('b', 'bin', 300, 420, { label: true }, { label: 'Screws' }),
      att('g', 'gridClip', 460, 420, {}, { lock: true }),
      att('r', 'toolRack', 60, 260, {}, { bolt: 'm4' }),
    ];
    const job = plan(list);
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.map((p) => p.ok)).toEqual(list.map(() => true));
    const names = Object.values(job.parts)
      .filter((p) => p.kind === 'attachment')
      .map((p) => p.name);
    expect(names.filter((n) => n.startsWith('Fit test tab'))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith('Thickness gauge'))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith('Lock key'))).toHaveLength(2);
    const bolts = wall.placed.flatMap((p) => p.extras?.bolts ?? []);
    expect(bolts.length).toBeGreaterThanOrEqual(2);
    expect(names.filter((n) => n.startsWith('T-nut'))).toHaveLength(bolts.length);
    // Every part prints, on the board's plates.
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of Object.values(job.parts).filter((q) => q.kind === 'attachment')) expect(onPlates.has(p.key)).toBe(true);
    // Each bolt's slot is one of the board's.
    const keys = new Set(wall.board.slots.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`));
    for (const p of wall.placed)
      for (const b of p.extras?.bolts ?? []) {
        const x = p.x - p.layout.anchor[0] + b.x;
        const y = p.y - p.layout.anchor[1] + b.y;
        expect(keys.has(`${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`)).toBe(true);
      }
  });
});
