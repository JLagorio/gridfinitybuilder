import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDefs, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { MOUNT, backMounts, clipReach, clipWidth, mountBox, partBounds, printedSize } from '../src/lib/wall/mount';
import { placeAttachments, slotKeys, snapAnchor } from '../src/lib/wall/plan';
import { cleanAttachments } from '../src/lib/enclosureOptions';
import { attachmentUi, attachmentUis } from '../src/lib/wall/ui';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const board = (attachments: PlacedAttachment[], skadis: Partial<SkadisOptions> = {}, extra: object = {}): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 400, height: 300, ...skadis }, attachments, ...extra },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
const att = (id: string, type: string, x: number, y: number, opts: object = {}): PlacedAttachment => ({ id, type, x, y, opts: { ...opts } });

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

describe('mounts', () => {
  it('a clip passes through its slot and reaches past the board', () => {
    const b = mountBox('clip', [0, 0], CTX);
    expect(clipWidth(CTX)).toBeLessThan(CTX.slotW);
    // The barbs spring out wider than the slot behind the board, and stay clear of the wall.
    expect(b.x1 - b.x0).toBeGreaterThan(CTX.slotW);
    expect(clipReach(CTX)).toBeGreaterThan(CTX.t);
    expect(clipReach(CTX) - CTX.t).toBeLessThan(CTX.behind);
    // In the slot: it rests on the bottom and its top stays below the slot's top.
    expect(b.y0).toBeGreaterThan(-CTX.slotL / 2);
    expect(b.y1).toBeLessThan(CTX.slotL / 2);
  });

  it('a hook and its lip fit through the slot together', () => {
    const b = mountBox('hook', [0, 0], CTX);
    expect(b.y1 - b.y0).toBeLessThan(CTX.slotL);
    expect(b.x1 - b.x0).toBeLessThan(CTX.slotW);
  });

  it('columns two steps apart, studs below, all on the part', () => {
    const m = backMounts(120, 70, CTX);
    const clips = m.mounts.filter((s) => s.kind === 'clip');
    expect(clips.map((s) => s.di)).toEqual([0, 2, 4]);
    expect(m.mounts.filter((s) => s.kind === 'stud').every((s) => s.dj === -2)).toBe(true);
    for (const s of m.mounts) {
      const b = mountBox(s.kind, [m.anchor[0] + s.di * 20, m.anchor[1] + s.dj * 20], CTX);
      expect(b.x0).toBeGreaterThanOrEqual(MOUNT.margin - 1e-6);
      expect(b.x1).toBeLessThanOrEqual(120 - MOUNT.margin + 1e-6);
      expect(b.y0).toBeGreaterThanOrEqual(MOUNT.margin - 1e-6);
      expect(b.y1).toBeLessThanOrEqual(70 - MOUNT.margin + 1e-6);
    }
  });
});

describe('every attachment kind', () => {
  for (const def of attachmentDefs()) {
    it(`${def.type}: valid, printable, as big as planned`, () => {
      const o = def.sanitize(def.defaults);
      const layout = def.layout(o, CTX);
      const mesh = buildMesh(w, { kind: 'attachment', key: def.type, type: def.type, opts: o, layout, ctx: CTX });
      const c = checkPart(w, mesh);
      expect(
        c.issues.filter((i) => i.severity === 'error'),
        def.type,
      ).toEqual([]);
      // No mount pokes out past its sides: a part printed on its side lies flat on the bed.
      const pb = partBounds(layout, CTX);
      expect(pb.x0, def.type).toBeGreaterThanOrEqual(-1e-9);
      expect(pb.x1, def.type).toBeLessThanOrEqual(layout.w + 1e-9);
      const b = meshBounds(mesh);
      const want = printedSize(layout, CTX);
      expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 1);
      expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
      expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
      for (const p of def.parts?.(o, CTX) ?? []) {
        const pm = buildMesh(w, { kind: 'attachmentPart', key: p.key, type: def.type, part: p.spec, ctx: CTX });
        expect(checkPart(w, pm).ok, `${def.type} ${p.key}`).toBe(true);
      }
    });
    it(`${def.type}: options clean up, and the tab knows it`, () => {
      expect(attachmentUi(def.type)?.label).toBeTruthy();
      expect(def.sanitize(undefined)).toEqual(def.sanitize(def.defaults));
      expect(def.summary(def.sanitize({}))).toBeTruthy();
    });
  }
});

describe('the tab', () => {
  it('has a form for every kind planning knows, and no more', () => {
    expect(
      attachmentUis()
        .map((u) => u.type)
        .sort(),
    ).toEqual(
      attachmentDefs()
        .map((d) => d.type)
        .sort(),
    );
    for (const u of attachmentUis()) {
      const d = attachmentDefs().find((x) => x.type === u.type)!;
      // Every field edits an option the kind has (a preset, the options it sets).
      for (const f of u.fields) {
        if (f.kind !== 'preset') expect(Object.keys(d.defaults), `${u.type}.${f.key}`).toContain(f.key);
        else for (const p of f.presets) for (const k of Object.keys(p.set)) expect(Object.keys(d.defaults), `${u.type}.${f.key}.${p.value}.${k}`).toContain(k);
      }
    }
  });
});

describe('on a board', () => {
  it('snaps to the slots its mounts need', () => {
    const job = plan(board([att('a', 'bin', 100, 150), att('h', 'hook', 300, 200)]));
    const wall = job.drawers[0].enclosure!.wall!;
    const keys = slotKeys(wall.board.slots);
    for (const p of wall.placed) {
      expect(p.ok).toBe(true);
      for (const m of p.mounts) expect(keys.has(`${m.x},${m.y}`)).toBe(true);
    }
    expect(job.warnings).toEqual([]);
  });

  it('prints with the bins, on plates of its own, and counts in the parts', () => {
    const job = plan(board([att('a', 'bin', 100, 150), att('c', 'cup', 250, 150), att('f', 'fitTest', 200, 60)]));
    const atts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // The fit test prints three tabs.
    expect(atts).toHaveLength(5);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of atts) expect(onPlates.has(p.key)).toBe(true);
    expect(job.plates.some((p) => p.name.startsWith('Board attachments'))).toBe(true);
  });

  it('hangs where it is in the drawer view, through the board and no further', () => {
    const job = plan(board([att('a', 'bin', 100, 150)]));
    const enc = job.drawers[0].enclosure!;
    const item = enc.items.find((i) => i.role === 'attachment')!;
    const front = enc.wall!.board.front;
    // Its back on the board's front; the clips reach in through the slots.
    expect(item.z).toBeCloseTo(front - clipReach(enc.wall!.board.ctx), 3);
    const mesh = buildMesh(w, job.meshes[item.meshKey]);
    const m = toManifold(mesh);
    const t = item.turn!;
    const turned = m.rotate(t as Vec3);
    const bb = turned.boundingBox();
    const placed = turned.translate([item.x - bb.min[0], item.y - bb.min[1], item.z - bb.min[2]]);
    const pb = placed.boundingBox();
    // Out from the board as deep as the bin.
    expect(pb.max[2]).toBeCloseTo(front + 50, 1);
    for (const x of [m, turned, placed]) x.delete();
  });

  it('passes through its slots without touching the board', () => {
    // Each on a slot of the 220 × 200 board's lattice (columns and rows every 20 from 20 in, (i + j) even).
    const job = plan(
      board([att('a', 'bin', 60, 180, { width: 100 }), att('h', 'hook', 180, 180), att('c', 'cup', 60, 100, { diameter: 20, height: 40 })], {
        width: 220,
        height: 200,
      }),
    );
    const enc = job.drawers[0].enclosure!;
    expect(job.warnings).toEqual([]);
    const place = (mesh: MeshData, at: Vec3, turn?: Vec3) => {
      const m = toManifold(mesh);
      const r = turn ? m.rotate(turn) : m.translate([0, 0, 0]);
      const b = r.boundingBox();
      const out = r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]);
      m.delete();
      r.delete();
      return out;
    };
    const tiles = job.plan.pieces.map((p) => place(buildMesh(w, job.meshes[job.parts[`piece:${p.id}`].meshKey]), enc.pieceAt[p.id], enc.pieceTurn as Vec3));
    for (const it of enc.items.filter((i) => i.role === 'attachment')) {
      const a = place(buildMesh(w, job.meshes[it.meshKey]), [it.x, it.y, it.z], it.turn as Vec3);
      for (const t of tiles) {
        // Its back lies on the board's front: float32 positions leave a film of a few thousandths of a mm³ there.
        const both = a.intersect(t);
        expect(both.volume(), it.id).toBeLessThan(0.02);
        both.delete();
      }
      // And it reaches through: some of it is behind the board's front.
      expect(a.boundingBox().min[2]).toBeLessThan(enc.wall!.board.front - DEFAULT_SKADIS.thickness);
      a.delete();
    }
    for (const t of tiles) t.delete();
  });

  it('says when it does not fit, and when two overlap', () => {
    const job = plan(board([att('a', 'bin', 100, 150, { width: 380 }), att('b', 'bin', 100, 150)]));
    expect(job.warnings.join()).toMatch(/overlap/);
    const wide = plan(board([att('a', 'bin', 100, 150, { width: 300 })], { width: 160 }));
    expect(wide.warnings.join()).toMatch(/doesn't fit on the board/);
  });

  it('just attachments: the board you have is not printed', () => {
    const job = plan(board([att('h', 'hook', 200, 150)], {}, { haveBaseplate: true }));
    expect(Object.values(job.parts).filter((p) => p.kind === 'attachment')).toHaveLength(1);
    expect(job.plates.every((p) => p.placements.every((q) => job.parts[q.key].kind === 'attachment'))).toBe(true);
  });

  it('snapping looks for the nearest slot that takes every mount', () => {
    const slots: [number, number][] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2 === 0) slots.push([i * 20, j * 20]);
    const keys = slotKeys(slots);
    const layout = {
      mounts: [
        { di: 0, dj: 0, kind: 'clip' as const },
        { di: 2, dj: 0, kind: 'clip' as const },
      ],
    };
    // (60, 40) isn't a slot on the staggered lattice; (60, 60) and (100, 60) are.
    expect(snapAnchor(slots, keys, layout, CTX, 81, 41)).toEqual([60, 60]);
    expect(snapAnchor(slots, keys, layout, CTX, 3, 1)).toEqual([0, 0]);
    const placed = placeAttachments([], { W: 0, H: 0, slots, ctx: CTX, outlines: [], front: 25 });
    expect(placed.placed).toEqual([]);
  });

  it('saved attachments clean up', () => {
    expect(
      cleanAttachments([att('a', 'bin', 1, 2), { id: 'a', type: 'bin', x: 3, y: 4 }, { type: 'x' }, 'no', { id: 'b', type: 'hook', x: 'n', y: 1 }]),
    ).toEqual([att('a', 'bin', 1, 2)]);
  });
});
