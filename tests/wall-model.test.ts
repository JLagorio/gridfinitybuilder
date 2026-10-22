import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { Scope, meshBounds, type Manifold, type Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { mountBox, printedSize, siteAt } from '../src/lib/wall/mount';
import { centred, weld, type RawMesh } from '../src/lib/imported/meshOps';
import { encodeMesh, meshHash } from '../src/lib/imported/format';
import { dropImported, putImported } from '../src/lib/imported/registry';
import { projectMeshHashes } from '../src/lib/imported/meshStore';
import { shareableProject } from '../src/lib/externalShare';
import { flatMasks, orientModel } from '../src/lib/wall/modelMesh';
import { MODEL, decodeMask, modelPlan, type ModelOptions, type ModelRef } from '../src/lib/wall/kinds/model';
import { modelBuilder } from '../src/lib/wall/kinds/model.geom';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const def = () => attachmentDef('model')!;
const opts = (o: Partial<ModelOptions>): ModelOptions => def().sanitize(o) as ModelOptions;
const layoutOf = (o: Partial<ModelOptions>): AttachmentLayout => def().layout(opts(o), CTX);

/** A solid made with Manifold as an imported file would come: welded, centred on its footprint, bottom at z = 0, kept in memory by its hash. */
function imported(make: (s: Scope) => Manifold, file = 'model.stl', drop?: (m: RawMesh) => RawMesh): ModelRef {
  const s = new Scope();
  try {
    const g = make(s).getMesh();
    let raw = centred(weld(g.vertProperties, g.triVerts));
    if (drop) raw = drop(raw);
    const hash = meshHash(encodeMesh(raw));
    putImported(hash, { positions: raw.positions, indices: raw.indices });
    const b = meshBounds({ positions: raw.positions, indices: raw.indices });
    const size = [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 1000) / 1000) as [number, number, number];
    return { hash, file, size, triangles: raw.indices.length / 3, closed: !drop, flat: flatMasks(raw) };
  } finally {
    s.dispose();
  }
}

const cube = (s: Scope, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  s.t(s.t(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));

/** A solid box 80 across (x), 30 deep (y), 60 tall (z). */
const box = () => imported((s) => cube(s, 0, 0, 0, 80, 30, 60), 'Box.stl');
/** An L-bracket: an upright 60 × 5 × 80 slab (its back the +Y face), a 40 mm shelf along its foot reaching toward −Y. */
const bracket = () => imported((s) => s.t(w.Manifold.union([cube(s, 0, 0, 0, 60, 5, 80), cube(s, 0, -40, 0, 60, 0, 5)])), 'Bracket.3mf');
/** An 80 × 30 × 100 box with a 10 mm deep notch across the top 30 mm of its back (+Y): flat below 70 mm only. */
const notched = () => imported((s) => s.t(cube(s, 0, 0, 0, 80, 30, 100).subtract(cube(s, -1, 20, 70, 81, 31, 101))), 'Notched.obj');

/** The body in the part's frame (before the mounts), for probing. */
function body(o: ModelOptions, run: (m: Manifold) => void) {
  const s = new Scope();
  try {
    run(modelBuilder.body(w, s, o, def().layout(o, CTX), CTX));
  } finally {
    s.dispose();
  }
}
/** Whether a point of the part's frame is inside the solid. */
const solidAt = (m: Manifold, x: number, y: number, z: number) => {
  const s = new Scope();
  try {
    return s.t(m.intersect(cube(s, x - 0.1, y - 0.1, z - 0.1, x + 0.1, y + 0.1, z + 0.1))).volume() > 1e-4;
  } finally {
    s.dispose();
  }
};

const build = (o: ModelOptions) => buildMesh(w, { kind: 'attachment', key: 'm', type: 'model', opts: o, layout: def().layout(o, CTX), ctx: CTX });

describe('your own model', () => {
  it('maps where each face is flat and solid', () => {
    const n = notched();
    const m = decodeMask(n.flat!['+y'])!;
    // 80 × 100: cells of 3.125 mm; the back's flat below the notch (70 mm) only.
    expect([m.nu, m.nv]).toEqual([26, 32]);
    const row = (j: number) => [...m.bits.slice(j * m.nu, (j + 1) * m.nu)];
    expect(row(5).every((v) => v === 1)).toBe(true);
    expect(row(21).every((v) => v === 1)).toBe(true);
    expect(row(22).every((v) => v === 0)).toBe(true);
    expect(row(31).every((v) => v === 0)).toBe(true);
    // Its other faces are flat all over (the cells at the notch's step aside).
    const bottom = decodeMask(n.flat!['-z'])!;
    expect(bottom.bits.every((v) => v === 1)).toBe(true);
    // Turned to hang by its +Y face, it's as big as the box says.
    expect(orientModel(new Float32Array([0, 0, 0, 10, 20, 30]), '+y').size).toEqual([10, 30, 20]);
  });

  it('takes its size on the wall from the face on the board, the turn and the scale', () => {
    const mesh = box();
    const size = (o: Partial<ModelOptions>) => {
      const l = layoutOf({ mesh, ...o });
      return [l.w, l.h, l.depth];
    };
    expect(size({ back: '+y' })).toEqual([80, 60, 30]);
    expect(size({ back: '-y' })).toEqual([80, 60, 30]);
    expect(size({ back: '-z' })).toEqual([80, 30, 60]);
    expect(size({ back: '+x' })).toEqual([30, 60, 80]);
    expect(size({ back: '+y', turn: '90' })).toEqual([60, 80, 30]);
    expect(size({ back: '+y', scale: 50 })).toEqual([40, 30, 15]);
    // Auto: the largest flat face (a ±Y side of the box, 80 × 60).
    expect(size({})).toEqual([80, 60, 30]);
    // The bracket's largest flat face is its upright's back.
    expect(modelPlan(opts({ mesh: bracket() }), CTX).face).toBe('+y');
    // Each builds as big as planned.
    for (const o of [{ back: '+y' }, { back: '-z' }, { back: '+x', turn: '90' }, { back: '+y', scale: 50 }] as Partial<ModelOptions>[]) {
      const oo = opts({ mesh, ...o });
      const b = meshBounds(build(oo));
      const want = printedSize(def().layout(oo, CTX), CTX);
      expect([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => Math.round(v * 10) / 10)).toEqual(
        [want.w, want.d, want.h].map((v) => Math.round(v * 10) / 10),
      );
    }
  });

  it('puts its clips on the flat back, as high as it is flat', () => {
    const o = opts({ mesh: notched(), back: '+y' });
    const l = def().layout(o, CTX);
    const p = modelPlan(o, CTX);
    expect(p.mode).toBe('clips');
    const clips = l.mounts.filter((m) => m.kind === 'clip');
    expect(clips.length).toBe(2);
    expect(l.mounts.some((m) => m.kind === 'stud')).toBe(true);
    for (const m of l.mounts) {
      const b = mountBox(m.kind, siteAt(l, m, CTX), CTX);
      // Under the notch (70 mm up), clear of the edges.
      expect(b.y1).toBeLessThanOrEqual(70 + 1e-6);
      expect(b.y0).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(b.x0).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(b.x1).toBeLessThanOrEqual(78 + 1e-6);
    }
    // As high as the flat back goes (to a millimetre's step and the half millimetre round it).
    const top = mountBox('clip', siteAt(l, clips[0], CTX), CTX).y1;
    expect(top).toBeGreaterThan(70 - 5);
    // And on the plain box, right up at the top.
    const plain = layoutOf({ mesh: box(), back: '+y' });
    expect(mountBox('clip', siteAt(plain, plain.mounts[0], CTX), CTX).y1).toBeGreaterThan(60 - 2 - 0.5 - 1);
    // One piece: no clip stands off the back in the air.
    const c = checkPart(w, build(o));
    expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
    body(o, (m) => {
      // The model's back at the clips: solid just in front of the board.
      for (const s of clips) {
        const [x, y] = siteAt(l, s, CTX);
        expect(solidAt(m, x, y, 0.4)).toBe(true);
      }
    });
  });

  it('is valid, and its clips print without support', () => {
    for (const o of [opts({ mesh: box(), back: '+y' }), opts({ mesh: bracket(), back: '+y', turn: '180' })]) {
      const mesh = build(o);
      const c = checkPart(w, mesh);
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
      // In the upright pose the board's face is print y = depth: the clips are behind it, the model in front.
      const depth = def().layout(o, CTX).depth;
      const overhangs = c.issues.filter((i) => i.kind === 'overhang' || i.kind === 'island');
      expect(overhangs.filter((i) => i.at![1] > depth - 0.5)).toEqual([]);
      if (o.turn === '180') expect(overhangs.length).toBeGreaterThan(0);
      else expect(overhangs).toEqual([]);
    }
  });

  it('puts a back that isn’t flat on a plate that fills in behind it', () => {
    // The bracket by its shelf's tip: only a 5 mm strip touches the board, too little for a clip.
    const mesh = bracket();
    const asked = opts({ mesh, back: '-y' });
    const p = modelPlan(asked, CTX);
    expect([p.mode, p.fellBack]).toEqual(['plate', true]);
    expect(def().notes!(asked, CTX).join(' ')).toMatch(/back plate/);
    const o = opts({ mesh, back: '-y', attach: 'plate' });
    const l = def().layout(o, CTX);
    expect([l.w, l.h, l.depth]).toEqual([60, 80, MODEL.plate + 45]);
    expect(l.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThan(0);
    expect(def().notes!(o, CTX)).toEqual([]);
    body(o, (m) => {
      // The plate, all over.
      expect(solidAt(m, 30, 70, 1.5)).toBe(true);
      // Filled in from the plate to the upright, 40 mm out, above the shelf…
      for (const z of [5, 20, 40]) expect(solidAt(m, 30, 70, MODEL.plate + z)).toBe(true);
      // … rising from the shelf at 45°, not out over it.
      expect(solidAt(m, 30, 10, MODEL.plate + 30)).toBe(false);
      expect(solidAt(m, 30, 40, MODEL.plate + 20)).toBe(true);
    });
    const c = checkPart(w, build(o));
    expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(c.issues.filter((i) => i.kind === 'overhang' || i.kind === 'island')).toEqual([]);
  });

  it('says what’s wrong with its mesh', () => {
    // None chosen: a box stands in.
    expect(def().notes!(opts({}), CTX).join(' ')).toMatch(/Choose its file/);
    expect(def().summary(opts({ mesh: box() }))).toBe('Box');
    // Not a closed solid: nothing can be fused to it.
    const open = imported(
      (s) => cube(s, 0, 0, 0, 50, 20, 40),
      'Open.stl',
      (m) => ({ positions: m.positions, indices: m.indices.slice(3) }),
    );
    const o = opts({ mesh: open, back: '+y' });
    expect(def().notes!(o, CTX).join(' ')).toMatch(/closed solid/);
    expect(() => build(o)).toThrow(/closed solid/);
    // Not in this browser.
    const gone = box();
    dropImported(gone.hash!);
    expect(() => build(opts({ mesh: gone }))).toThrow(/isn’t in this browser/);
  });

  const board = (attachments: PlacedAttachment[]): NamedDrawer => ({
    id: 'b',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 }, attachments },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  });
  const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });

  it('hangs on a board and prints with its attachments', () => {
    const mesh = bracket();
    const job = plan(board([{ id: 'm', type: 'model', x: 200, y: 150, opts: { mesh, back: '+y' } }]));
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed[0].ok).toBe(true);
    expect(wall.placed[0].name).toBe('Bracket');
    const part = Object.values(job.parts).find((p) => p.attachment === 'm')!;
    expect(job.plates.some((pl) => pl.placements.some((q) => q.key === part.key))).toBe(true);
    const spec = job.meshes[part.meshKey];
    expect(spec.kind === 'attachment' && (spec.opts as ModelOptions).mesh?.hash).toBe(mesh.hash);
    expect(checkPart(w, buildMesh(w, spec)).ok).toBe(true);
  });

  it('goes in project files with its mesh, and in share links as a box of its size', () => {
    const mesh = box();
    const a: PlacedAttachment = { id: 'm', type: 'model', x: 200, y: 150, opts: { mesh, back: '+y' } };
    const d = board([a]);
    const file = { bins: [], drawer: d.drawer, drawers: [d] };
    expect(projectMeshHashes(file)).toEqual([mesh.hash]);
    const shared = shareableProject(file);
    expect(shared.models).toBe(1);
    expect(shared.dropped).toBe(0);
    expect(JSON.stringify(shared.file)).not.toContain(mesh.hash!);
    // The box that stands in hangs just as the model did.
    const o = opts(shared.file.drawers[0].drawer.attachments![0].opts);
    expect(o.mesh?.hash).toBeUndefined();
    expect(def().layout(o, CTX)).toEqual(layoutOf({ mesh, back: '+y' }));
    expect(def().notes!(o, CTX).join(' ')).toMatch(/link/);
    expect(checkPart(w, build(o)).ok).toBe(true);
  });
});
