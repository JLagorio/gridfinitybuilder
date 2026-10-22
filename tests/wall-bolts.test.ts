import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { registerFont } from '../src/lib/geometry/text';
import { attachmentDefs, type AttachmentDef, type AttachmentLayout, type BackPlate, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { BOLT, partBounds, viewTurn } from '../src/lib/wall/mount';
import { planExtras } from '../src/lib/wall/plan';

/**
 * Every kind's say in the common options: where its back is solid with nothing in front (AttachmentDef.backPlate), it
 * is, and a bolt goes in there clear of everything; where it has a face for a label (labelFace), the text is cut into
 * that face; and the kinds with no way for a screwdriver to reach their back say so (null).
 */

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** A part's mesh back in its own frame, as it hangs (back on the board at z = 0). */
function hanging(mesh: MeshData, layout: AttachmentLayout): Manifold {
  const m = toManifold(mesh);
  const r = m.rotate(viewTurn(layout.pose));
  const b = r.boundingBox();
  const pb = partBounds(layout, CTX);
  const out = r.translate([pb.x0 - b.min[0], pb.y0 - b.min[1], pb.z0 - b.min[2]]);
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

const plates = (p: BackPlate | BackPlate[] | null | undefined): BackPlate[] => (p ? (Array.isArray(p) ? p : [p]) : []);

/** More option sets to check each kind's back plate and label face at (sizes and counts its form's choices don't reach). */
const MORE: Record<string, object[]> = {
  batteryDock: [{ count: 2 }, { mode: 'stem', count: 2 }, { mode: 'body', count: 2 }, { latch: 'none' }],
  toolDock: [{ count: 2, tilt: 0 }],
  chargerCradle: [{ lip: 60, back: 50 }],
  cellDispenser: [
    { shape: 'coin', diameter: 11.6, thick: 5.4, columns: 1, capacity: 20, window: 0 },
    { shape: 'coin', diameter: 11.6, thick: 5.4, columns: 1, capacity: 20 },
    { shape: 'block', diameter: 26.5, length: 48.5, thick: 17.5, columns: 1, window: 0 },
  ],
  mediaBlock: [{ rows: 1, depth: 30 }],
  spoolRack: [{ height: 100 }, { mode: 'pegs', rows: 2 }, { teeth: true, eyelet: 0 }],
  boxSleeve: [
    { open: 'top', front: 60 },
    { open: 'top', front: 10, width: 40 },
  ],
  receiver: [
    { system: 'openconnect', pitch: 28, columns: 3, rows: 2 },
    { columns: 1, height: 100 },
  ],
  cleatStrip: [{ angle: 30, size: 12 }],
  mountBoss: [{ tilt: 30 }, { fixing: 'gopro', tilt: 20 }, { fixing: 'arca', height: 100 }, { height: 100 }, { fixing: 'gopro', tilt: 0, reach: 20 }],
  slotRack: [{ tilt: 0 }, { tilt: 25, slot: 6 }],
  displayLedge: [{ lip: 8 }, { mode: 'bases', tiers: 3, lip: 4 }],
  planter: [{ mode: 'tubes', count: 3, tube: 12 }],
  caddy: [{ width: 240, height: 120, handle: 0 }],
  faceout: [{ label: true, angle: 20 }],
  saddle: [{ height: 100 }, { height: 100, cleat: true, shelf: 40 }, { mode: 'yoke', heavy: true }],
  magnetBar: [{ height: 60 }, { fix: 'skin', height: 50, lip: 10 }, { shape: 'block', magD: 60, height: 50 }],
  measureHanger: [{ height: 70 }, { tool: 'ruler', count: 3, height: 60 }, { tool: 'tape', height: 70 }, { tool: 'square', beamAt: 30 }],
  eyewear: [
    { width: 44, spacing: 80 },
    { style: 'temple', pairs: 3 },
  ],
  clampRack: [{ springs: 0 }, { pitch: 30, count: 5 }],
  clipTab: [{ width: 20, count: 2, pitch: 40 }],
  bottleRack: [
    { rows: 1, cup: 12 },
    { rows: 1, cup: 12, tilt: 20 },
  ],
  stickRack: [{ rows: 1, cup: 10 }],
  holster: [{ heat: true, cord: true }, { width: 30, depth: 30, back: 100 }, { tilt: 0 }],
  gripper: [{ count: 2 }, { axis: 'horizontal', count: 2 }, { length: 10 }],
  tiltBin: [{ stack: 2 }],
  lidBox: [
    { lid: 'flip', magnets: true, height: 90 },
    { lid: 'slide', label: false },
  ],
  cabinet: [
    { door: 'right', shelves: 2 },
    { magnets: false, shelves: 0 },
  ],
  swivelTower: [{ count: 2 }],
  foldHook: [{ style: 'cup' }],
  hook: [{ width: 30 }],
  cradle: [{ front: 'lip' }],
  bin: [{ width: 120, height: 90, front: 30 }],
};

/**
 * The option sets each kind is checked at: its defaults, every other choice of each select field and each toggle
 * turned over (from its form), and MORE's.
 */
function variants(def: AttachmentDef<object>): object[] {
  const out: object[] = [{}];
  const d = def.defaults as Record<string, unknown>;
  for (const f of attachmentUi(def.type)?.fields ?? []) {
    if (f.kind === 'select') for (const c of f.options) if (c.value !== String(d[f.key])) out.push({ [f.key]: c.value });
    if (f.kind === 'toggle') out.push({ [f.key]: !d[f.key] });
  }
  return [...out, ...(MORE[def.type] ?? [])];
}

const SIZE = 560;
const onBoard = (attachments: PlacedAttachment[]): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: SIZE, height: SIZE }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});

/** One attachment planned on a 560 board with its common options, and built as the print job builds it. */
function planned(type: string, opts: object, common: Pick<PlacedAttachment, 'bolt' | 'label'>) {
  const job = planPrint([onBoard([{ id: 'a', type, x: SIZE / 2, y: SIZE / 2, opts: { ...opts }, ...common }])], DEFAULT_SETUP, { baseplate: true, bins: true });
  const p = job.drawers[0].enclosure!.wall!.placed[0];
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: p.opts, layout: p.layout, ctx: CTX, ...(p.extras ? { extras: p.extras } : {}) });
  return { job, p, mesh };
}

/**
 * Kinds with no way for a screwdriver to reach their back at their defaults: backPlate says null (each kind says why
 * there). The ones with an option that opens a way are in BOLT_AT too.
 */
const NO_BOLT = [
  'fitTest',
  'cup',
  'rail',
  'ledBar',
  'cableClip',
  'cableChannel',
  'cableComb',
  'gridPlate',
  'gridClip',
  'labelTag',
  'mediaBlock',
  'pegboardBridge',
  'slotRack',
  'displayLedge',
  'faceout',
  'cellDispenser',
  'bottleRack',
  'stickRack',
  'lidBox',
  'planter',
];

/**
 * Options that give a kind a lattice slot behind its back plate where its defaults have none (the plate is there, but
 * the slots behind it are a clip's, or fall off it), or open a way to its back at all.
 */
const BOLT_AT: Record<string, object> = {
  hook: { width: 30 },
  bin: { width: 120, height: 90, front: 30 },
  cradle: { front: 'lip' },
  cellDispenser: { shape: 'coin', diameter: 11.6, thick: 5.4, columns: 1, capacity: 20, window: 0 },
  bottleRack: { rows: 1, cup: 12 },
  stickRack: { rows: 1, cup: 10 },
  lidBox: { lid: 'flip', height: 90 },
  planter: { shape: 'square' },
  spoolRack: { height: 100 },
  magnetBar: { height: 60 },
  measureHanger: { height: 70 },
  eyewear: { width: 44, spacing: 80 },
  clipTab: { width: 20, count: 2, pitch: 40 },
  gripper: { count: 2 },
  saddle: { height: 100 },
};

/** Where BOLT_AT's options (or the defaults) leave room for an M3 but not an M4's bigger head, options that do. */
const BOLT_M4: Record<string, object> = {
  mountBoss: { height: 100 },
};

describe('back plates and label faces', () => {
  // Where a kind says its back is solid with nothing in front: plastic all through the plate where a head can go, and
  // nothing in front of it where the head's bore can go (an M3's, the smallest: an M4 takes less of the region). Its
  // label face: plastic just inside it, none just outside.
  const R = BOLT.m3.head / 2;
  for (const def of attachmentDefs()) {
    it(`${def.type}: as it says, at each of its choices`, () => {
      for (const opts of variants(def)) {
        const o = def.sanitize({ ...def.defaults, ...opts });
        const layout = def.layout(o, CTX);
        // (The adapter plate's back plate is all of it, though its screw grid, magnets, zip-tie slots and tape recess cut into it.)
        const regions = def.type === 'plate' ? [] : plates(def.backPlate?.(o, layout)).filter((r) => r.x1 - r.x0 >= 2 * R + 2 && r.y1 - r.y0 >= 2 * R + 2);
        const f = def.labelFace?.(o, layout) ?? null;
        if (!regions.length && !f) continue;
        const mesh = buildMesh(w, { kind: 'attachment', key: def.type, type: def.type, opts: o, layout, ctx: CTX });
        const body = hanging(mesh, layout);
        const s = new Scope();
        try {
          for (const r of regions) {
            const what = `${def.type} ${JSON.stringify(opts)} ${JSON.stringify(r)}`;
            expect(r.z, what).toBeGreaterThan(0);
            expect(r.z, what).toBeLessThanOrEqual(layout.depth + 1e-6);
            expect(r.x0 >= -1e-6 && r.x1 <= layout.w + 1e-6 && r.y0 >= -1e-6 && r.y1 <= layout.h + 1e-6, what).toBe(true);
            // Every place a head (and 1 mm round it) can go: the region with its corners rounded.
            const round = (rad: number, z0: number, z1: number) => {
              const c = R + 1;
              const pts = [
                [r.x0 + c, r.y0 + c],
                [r.x1 - c, r.y0 + c],
                [r.x1 - c, r.y1 - c],
                [r.x0 + c, r.y1 - c],
              ].map(([x, y]) => s.t(s.t(w.Manifold.cylinder(z1 - z0, rad, rad, 24)).translate([x, y, z0])));
              return s.t(w.Manifold.hull(pts));
            };
            const plate = round(R + 1, 0.05, r.z - 0.05);
            expect(shared(body, plate), `${what}: solid`).toBeGreaterThan(plate.volume() - 0.05);
            const bore = round(R + 0.3, r.z + 0.05, layout.depth + 2);
            expect(shared(body, bore), `${what}: clear`).toBeLessThan(0.05);
          }
          if (f) {
            const what = `${def.type} ${JSON.stringify(opts)} label`;
            expect(f.w, what).toBeGreaterThan(10);
            expect(f.h, what).toBeGreaterThanOrEqual(4);
            for (const [u, v] of [
              [0.05, 0.05],
              [0.95, 0.05],
              [0.5, 0.5],
              [0.05, 0.95],
              [0.95, 0.95],
            ]) {
              const x = f.x + u * f.w;
              const y = f.normal === 'front' ? f.y + v * f.h : f.y;
              const z = f.normal === 'front' ? f.z : f.z + v * f.h;
              const probe = (dy: number, dz: number) => s.t(w.Manifold.cube([0.2, 0.2, 0.2]).translate([x - 0.1, y - 0.1 + dy, z - 0.1 + dz]));
              // Inside: 0.3 mm short of the text's depth (which takes in a leaning face's lean), and 0.25 mm past it.
              const d = (f.depth ?? 0.6) - 0.3;
              const [inY, inZ, deepY, deepZ, outY, outZ] = f.normal === 'front' ? [0, -d, 0, -d - 0.55, 0, 0.3] : [-d, 0, -d - 0.55, 0, 0.3, 0];
              expect(shared(body, probe(inY, inZ)), `${what} inside ${u} ${v}`).toBeGreaterThan(0.007);
              expect(shared(body, probe(deepY, deepZ)), `${what} behind ${u} ${v}`).toBeGreaterThan(0.007);
              expect(shared(body, probe(outY, outZ)), `${what} outside ${u} ${v}`).toBeLessThan(0.001);
            }
          }
        } finally {
          s.dispose();
          body.delete();
        }
      }
    });
  }
});

describe('bolts', () => {
  for (const def of attachmentDefs()) {
    it(`${def.type}: a bolt goes through its back clear of everything, or it says there's no way`, () => {
      const o = def.sanitize(def.defaults);
      const layout = def.layout(o, CTX);
      const declared = def.backPlate?.(o, layout);
      if (NO_BOLT.includes(def.type)) expect(declared, def.type).toBeNull();
      else {
        expect(declared, def.type).toBeTruthy();
        expect(plates(declared).length, def.type).toBeGreaterThan(0);
      }
      if (NO_BOLT.includes(def.type) && !BOLT_AT[def.type]) return;
      const opts = BOLT_AT[def.type] ?? {};
      // Where the defaults have a plate but no slot behind it, they say so.
      if (BOLT_AT[def.type] && declared) expect(planExtras({ bolt: 'm3' }, def, o, layout, CTX).notes.join(), def.type).toMatch(/No room for a bolt/);
      for (const size of ['m3', 'm4'] as const) {
        const { job, p, mesh } = planned(def.type, size === 'm4' ? (BOLT_M4[def.type] ?? opts) : opts, { bolt: size });
        const what = `${def.type} ${size}`;
        expect(job.warnings, what).toEqual([]);
        const bolts = p.extras?.bolts ?? [];
        expect(bolts.length, what).toBeGreaterThan(0);
        const c = checkPart(w, mesh);
        expect(
          c.issues.filter((i) => i.severity === 'error'),
          what,
        ).toEqual([]);
        const body = hanging(mesh, p.layout);
        const s = new Scope();
        try {
          for (const b of bolts) {
            // A countersunk screw seated at its plate's front, into the T-nut behind the board, and the way in to it
            // from the front: clear of the part, but for the head bearing on its countersink.
            const R = BOLT[size].head / 2;
            const r = size === 'm3' ? 1.5 : 2;
            const L = b.screw;
            const at = (m: Manifold, z: number) => s.t(s.t(m).translate([b.x, b.y, z]));
            const screw = s.t(w.Manifold.union([at(w.Manifold.cylinder(L, r, r, 48), b.seat - L), at(w.Manifold.cylinder(R - r, r, R, 48), b.seat - (R - r))]));
            const way = at(w.Manifold.cylinder(p.layout.depth + 20, R, R, 48), b.seat + 0.01);
            expect(shared(screw, body), `${what} screw`).toBeLessThan(0.02);
            expect(shared(way, body), `${what} way in`).toBeLessThan(0.02);
            expect(shared(s.t(screw.translate([0, 0, -0.2])), body), `${what} seat`).toBeGreaterThan(0.05);
          }
        } finally {
          s.dispose();
          body.delete();
        }
      }
    });
  }
});

/** Options that give a kind a label face where its defaults have none. */
const LABEL_AT: Record<string, object> = {
  batteryDock: { mode: 'body' },
  displayLedge: { lip: 8 },
  planter: { shape: 'square' },
  faceout: { label: true },
  magnetBar: { fix: 'skin' },
};

/** Kinds with no face for a label (labelFace unset, or null at their defaults and at LABEL_AT's options). */
const NO_LABEL = [
  'hook',
  'cup',
  'fitTest',
  'rod',
  'rail',
  'ledBar',
  'cableClip',
  'powerStrip',
  'cableComb',
  'gridPlate',
  'gridClip',
  'toolDock',
  'leadHanger',
  'labelTag',
  'receiver',
  'pegboardBridge',
  'cleatStrip',
  'dinRail',
  'mountBoss',
  'caddy',
  'saddle',
  'eyewear',
  'clampRack',
  'clipTab',
  'bottleRack',
  'stickRack',
  'holster',
  'gripper',
  'tiltBin',
  'cabinet',
  'swivelTower',
  'foldHook',
];

describe('labels', () => {
  for (const def of attachmentDefs()) {
    it(`${def.type}: a label cut into its face, or none`, () => {
      const face = (opts: object) => {
        const o = def.sanitize({ ...def.defaults, ...opts });
        return def.labelFace?.(o, def.layout(o, CTX)) ?? null;
      };
      if (NO_LABEL.includes(def.type) || LABEL_AT[def.type]) expect(face({}), def.type).toBeNull();
      if (NO_LABEL.includes(def.type)) return;
      const opts = LABEL_AT[def.type] ?? {};
      const f = face(opts);
      expect(f, def.type).toBeTruthy();
      if (!f) return;
      const plain = planned(def.type, opts, {});
      const lab = planned(def.type, opts, { label: 'TEST' });
      // (A label adds no warnings of its own.)
      expect(lab.job.warnings, def.type).toEqual(plain.job.warnings);
      expect(lab.p.extras?.label?.face, def.type).toEqual(f);
      const c = checkPart(w, lab.mesh);
      expect(
        c.issues.filter((i) => i.severity === 'error'),
        def.type,
      ).toEqual([]);
      const a = hanging(plain.mesh, plain.p.layout);
      const b = hanging(lab.mesh, lab.p.layout);
      const s = new Scope();
      try {
        // The text is cut into it, all within the face and its depth (what else differs is only the meshes' slivers).
        const cut = s.t(a.subtract(b));
        expect(cut.volume(), def.type).toBeGreaterThan(0.5);
        const depth = (f.depth ?? 0.6) + 0.05;
        const [lo, hi] =
          f.normal === 'front'
            ? [
                [f.x, f.y, f.z - depth],
                [f.x + f.w, f.y + f.h, f.z + 0.05],
              ]
            : [
                [f.x, f.y - depth, f.z],
                [f.x + f.w, f.y + 0.05, f.z + f.h],
              ];
        const box = s.t(w.Manifold.cube([hi[0] - lo[0] + 0.1, hi[1] - lo[1] + 0.1, hi[2] - lo[2] + 0.1]).translate([lo[0] - 0.05, lo[1] - 0.05, lo[2] - 0.05]));
        expect(cut.volume() - shared(cut, box), def.type).toBeLessThan(0.01);
      } finally {
        s.dispose();
        a.delete();
        b.delete();
      }
    });
  }
});
