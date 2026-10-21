import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type AttachmentPart, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { RAIL_BACK, RAIL_BAY, RAIL_SEAT, railPlan, type RailOptions } from '../src/lib/wall/kinds/rail';
import { RAIL, RAIL_FIT, railCheck, railProfile, railRidges } from '../src/lib/wall/kinds/rail.geom';
import { attachmentUi } from '../src/lib/wall/ui';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const def = () => attachmentDef('rail')!;
const opts = (o: Partial<RailOptions> = {}) => def().sanitize(o) as RailOptions;

const board = (attachments: PlacedAttachment[], skadis: Partial<SkadisOptions> = {}): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, ...skadis }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });

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
const bodyMesh = (o: RailOptions, ctx = CTX) => buildMesh(w, { kind: 'attachment', key: 'rail', type: 'rail', opts: o, layout: def().layout(o, ctx), ctx });
const partMesh = (p: AttachmentPart, ctx = CTX) => buildMesh(w, { kind: 'attachmentPart', key: p.key, type: 'rail', part: p.spec, ctx });
/** The rail in its own frame (front view's bottom-left at the origin, z out from the board). */
function railInFrame(o: RailOptions, ctx = CTX): Manifold {
  const layout = def().layout(o, ctx);
  const b = partBounds(layout, ctx);
  return put(bodyMesh(o, ctx), viewTurn(layout.pose), [b.x0, b.y0, b.z0]);
}
/** A part where it sits on the rail. */
const placed = (p: AttachmentPart, ctx = CTX) => put(partMesh(p, ctx), p.place!.turn, p.place!.at);
const parts = (o: RailOptions, ctx = CTX) => def().parts!(o, ctx);
const part = (o: RailOptions, key: string, ctx = CTX) => parts(o, ctx).find((p) => p.key === key)!;
const shared = (a: Manifold, b: Manifold) => {
  const i = a.intersect(b);
  const v = i.volume();
  i.delete();
  return v;
};
const moved = (m: Manifold, v: Vec3) => keep(m.translate(v));
/** A box, to cut slabs out of solids. */
const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  keep(keep(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));

describe('storage rail: planning', () => {
  it('fills the rails by default, and counts what it says', () => {
    const o = opts();
    expect(o.count).toBe(0);
    const ps = parts(o);
    expect(ps.filter((p) => p.key.startsWith('c'))).toHaveLength(5);
    expect(ps.filter((p) => p.key.startsWith('s'))).toHaveLength(1);
    expect(def().summary(o)).toBe('Rail 5 units, 5 bins 1×1');
    // Two rails, two units wide: two on each (a unit left over); three when asked for three.
    const two = opts({ rows: 2, size: '2x1' });
    expect(parts(two).filter((p) => p.key.startsWith('c'))).toHaveLength(4);
    expect(def().notes!(two, CTX).join()).toMatch(/1 unit left empty/);
    expect(parts(opts({ rows: 2, size: '2x1', count: 3 })).filter((p) => p.key.startsWith('c'))).toHaveLength(3);
    expect(def().summary(opts({ length: 6, kind: 'drawer', count: 4 }))).toBe('Rail 6 units, 4 drawers 1×1');
    // A sleeve holds a drawer in each unit.
    expect(parts(opts({ kind: 'drawer', size: '2x2', length: 4 })).filter((p) => p.key.startsWith('d'))).toHaveLength(8);
  });

  it('is as long as its units, an end panel and room for the stop, and as high as its rails', () => {
    for (const unit of ['40', '42'] as const) {
      const o = opts({ length: 6, unit, rows: 3, unitH: 35 });
      const l = def().layout(o, CTX);
      expect(l.w).toBeCloseTo(RAIL.end + 6 * +unit + RAIL.stop, 6);
      expect(l.h).toBeCloseTo(3 * 35, 6);
      expect(l.depth).toBe(o.depth);
      expect(l.pose).toBe('upright');
      // Clips across the top, studs below on a tall one.
      expect(l.mounts.filter((m) => m.kind === 'clip').length).toBeGreaterThan(2);
      expect(l.mounts.some((m) => m.kind === 'stud')).toBe(true);
    }
    // Two units high: the rails are twice as far apart.
    expect(def().layout(opts({ rows: 2, size: '1x2' }), CTX).h).toBe(160);
  });

  it('agrees with the geometry on where things are', () => {
    expect(railCheck.seat).toBeCloseTo(RAIL_SEAT, 9);
    expect(railCheck.back).toBeCloseTo(RAIL_BACK, 9);
    expect(railCheck.bay).toBeCloseTo(RAIL_BAY, 9);
  });

  it('cleans its options', () => {
    expect(opts({ length: 20, unit: '41' as never, rows: 0, size: '4x4' as never, count: -2, depth: 500 })).toMatchObject({
      length: 14,
      unit: '40',
      rows: 1,
      size: '1x1',
      count: 0,
      depth: 150,
    });
    expect(attachmentUi('rail')?.group).toBe('containers');
  });

  it('notes what is off, and lists label cards', () => {
    const notes = (o: Partial<RailOptions>) => def().notes!(opts(o), CTX).join(' ');
    expect(notes({})).toBe('');
    expect(notes({ length: 2, size: '3x1' })).toMatch(/don't fit/);
    expect(notes({ depth: 130 })).toMatch(/heavy things at the back/);
    // Asking for fewer leaves room on purpose: no note.
    expect(notes({ size: '2x1', count: 1 })).toBe('');
    const hw = (o: Partial<RailOptions>) => def().hardware!(opts(o));
    expect(hw({})).toEqual([{ item: 'Label card', count: 5, note: '31 × 12.5 mm' }]);
    expect(hw({ label: false })).toEqual([]);
    expect(hw({ kind: 'drawer', size: '2x2', length: 4 })[0]).toMatchObject({ item: 'Label card', count: 8 });
    // Drawers too low for a card slot under the pull have none.
    expect(hw({ kind: 'drawer', unitH: 30 })).toEqual([]);
  });
});

describe('storage rail: geometry', () => {
  it('builds clean and as big as planned, the rail and every part', () => {
    for (const o of [
      opts({ length: 4, unit: '42', rows: 2, size: '2x1', kind: 'drawer', links: true, depth: 80 }),
      opts({ size: '1x2', links: true, unitH: 30, depth: 45 }),
    ]) {
      const layout = def().layout(o, CTX);
      const mesh = bodyMesh(o);
      expect(checkPart(w, mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
      const b = meshBounds(mesh);
      const want = printedSize(layout, CTX);
      expect(b.max[0] - b.min[0]).toBeCloseTo(want.w, 1);
      expect(b.max[1] - b.min[1]).toBeCloseTo(want.d, 1);
      expect(b.max[2] - b.min[2]).toBeCloseTo(want.h, 1);
      const seen = new Set<string>();
      for (const p of parts(o)) {
        const key = JSON.stringify(p.spec);
        if (seen.has(key)) continue;
        seen.add(key);
        const pm = partMesh(p);
        const c = checkPart(w, pm);
        expect(
          c.issues.filter((i) => i.severity === 'error'),
          p.key,
        ).toEqual([]);
        const pb = meshBounds(pm);
        expect(
          [pb.max[0] - pb.min[0], pb.max[1] - pb.min[1], pb.max[2] - pb.min[2]].map((v) => +v.toFixed(2)),
          p.key,
        ).toEqual([p.w, p.d, p.h].map((v) => +v.toFixed(2)));
      }
    }
  });

  it('prints its containers to their sizes', () => {
    const o = opts();
    const p = railPlan(o);
    const bin = part(o, 'c0');
    // A unit wide less the gap between neighbours, a row high less the rail, from the teeth to the front.
    expect(bin.w).toBeCloseTo(40 - RAIL.gap, 6);
    expect(bin.h).toBeCloseTo(40 - 10.2, 6);
    expect(bin.d).toBeCloseTo(60 - RAIL_BACK, 6);
    const b = meshBounds(partMesh(bin));
    expect(b.max[2] - b.min[2]).toBeCloseTo(p.H, 2);
    const dr = opts({ kind: 'drawer', size: '3x1' });
    expect(part(dr, 'c0').w).toBeCloseTo(120 - RAIL.gap, 6);
    expect(part(dr, 'd0-2').h).toBeCloseTo(railPlan(dr).bh - 0.4, 6);
  });

  it('a profile that prints standing up: every face that looks down rises at 45° or more', () => {
    // Counter-clockwise, so the solid is on the left: an edge heading out from the board has it above (an underside).
    const pts = railProfile(40);
    let undersides = 0;
    for (let i = 0; i < pts.length; i++) {
      const [z0, y0] = pts[i];
      const [z1, y1] = pts[(i + 1) % pts.length];
      if (z1 <= z0 + 1e-9 || z1 <= RAIL.plate) continue;
      undersides++;
      expect(y1 - y0, `edge ${i}`).toBeGreaterThanOrEqual(z1 - z0 - 1e-9);
    }
    // The stem's and the flare's.
    expect(undersides).toBe(2);
    let a = 0;
    for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    expect(a).toBeGreaterThan(0);
  });

  for (const fit of ['snug', 'normal', 'loose'] as const) {
    it(`a container fits the rail ${fit}: clear all round, and it only slides`, () => {
      const ctx = { ...CTX, fit };
      const c = RAIL_FIT[fit];
      const o = opts();
      const rail = railInFrame(o, ctx);
      const bin = placed(part(o, 'c1', ctx), ctx);
      expect(shared(rail, bin)).toBeLessThan(0.02);
      // Free to move by just under each clearance, caught just past it.
      const free = (v: Vec3) => shared(rail, moved(bin, v));
      // Back toward the board: the wall in front of the lip meets it, or the teeth's tips the back of the valley.
      const back = Math.min(c, RAIL.bump - RAIL.catch);
      for (const [v, room] of [
        [[0, 0, 1], c],
        [[0, 0, -1], back],
        [[0, -1, 0], c],
        [[0, 1, 0], c * Math.SQRT2],
      ] as [Vec3, number][]) {
        expect(free(v.map((k) => k * (room - 0.05)) as Vec3), `${v} by ${room - 0.05}`).toBeLessThan(0.02);
        expect(free(v.map((k) => k * (room + 0.1)) as Vec3), `${v} by ${room + 0.1}`).toBeGreaterThan(0.05);
      }
      // It can't come off forward, or lift off: well past the clearance it's deep in the rail.
      expect(free([0, 0, 3])).toBeGreaterThan(20);
      expect(free([0, 3, 0])).toBeGreaterThan(5);
      // Along the rail it slides to the next unit, where it sits clear again.
      expect(free([+o.unit, 0, 0])).toBeLessThan(0.02);
    });
  }

  it('hooks behind the lip: its back wall overlaps the lip in the front view', () => {
    const o = opts();
    const rail = railInFrame(o);
    const bin = placed(part(o, 'c0'));
    const Q = RAIL.plate;
    // The container's back wall in the valley, and the rail's lip, seen from the front.
    const x0 = RAIL.end + 0.1;
    const wall = keep(bin.intersect(slab(x0, -1, Q, 300, 100, Q + RAIL.valley))).boundingBox();
    const lip = keep(rail.intersect(slab(x0, -1, Q + RAIL.valley + 0.01, 300, 100, Q + RAIL.valley + RAIL.lip))).boundingBox();
    const overlap = Math.min(wall.max[1], lip.max[1]) - Math.max(wall.min[1], lip.min[1]);
    expect(overlap).toBeGreaterThan(7);
  });

  it('clicks into place every unit: ridges a unit apart, teeth that ride over them', () => {
    for (const unit of ['40', '42'] as const) {
      const o = opts({ unit, length: 6 });
      const xs = railRidges(o);
      expect(xs).toHaveLength(6);
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeCloseTo(+unit, 9);
      // In the solid: what stands out of the back of the valley, where the ridges are.
      const rail = railInFrame(o);
      const ridges = keep(rail.intersect(slab(RAIL.end + 0.1, RAIL_SEAT + 1, RAIL.plate + 0.2, 500, RAIL_SEAT + 4, RAIL.plate + 0.5)));
      const found = ridges
        .decompose()
        .map((m) => {
          const b = m.boundingBox();
          m.delete();
          return (b.min[0] + b.max[0]) / 2;
        })
        .sort((a, b) => a - b);
      expect(found.length).toBe(6);
      found.forEach((x, k) => expect(x).toBeCloseTo(xs[k], 2));
      // A container's teeth flank a ridge at rest; pushed along, one rides over it (the strip flexes).
      const bin = placed(part(o, 'c0'));
      expect(shared(rail, bin)).toBeLessThan(0.02);
      expect(shared(rail, moved(bin, [1, 0, 0]))).toBeGreaterThan(0.05);
      expect(shared(rail, moved(bin, [1, 0, 0]))).toBeLessThan(2);
    }
  });

  it('shows every part where it sits: nothing overlaps the rail or each other', () => {
    for (const o of [opts({ rows: 2, links: true }), opts({ kind: 'drawer', size: '2x1', rows: 2, length: 4, links: true })]) {
      const rail = railInFrame(o);
      const ps = parts(o);
      const solids = ps.map((p) => placed(p));
      for (let i = 0; i < ps.length; i++) {
        expect(shared(rail, solids[i]), ps[i].key).toBeLessThan(0.02);
        for (let j = i + 1; j < ps.length; j++) expect(shared(solids[i], solids[j]), `${ps[i].key} ${ps[j].key}`).toBeLessThan(0.02);
        // On the rail's front view, out from the board's front, no further out than planned.
        const b = solids[i].boundingBox();
        const layout = def().layout(o, CTX);
        expect(b.min[0]).toBeGreaterThan(0);
        expect(b.max[0]).toBeLessThan(layout.w);
        expect(b.min[1]).toBeGreaterThan(0);
        expect(b.max[1]).toBeLessThan(layout.h);
        expect(b.min[2]).toBeGreaterThan(0);
        expect(b.max[2]).toBeLessThanOrEqual(layout.depth + 1e-3);
      }
      // Containers sit unit by unit, row by row, their teeth in the valley.
      const p = railPlan(o);
      ps.filter((q) => q.key.startsWith('c')).forEach((q, k) => {
        const b = solids[ps.indexOf(q)].boundingBox();
        expect(b.min[0]).toBeCloseTo(RAIL.end + RAIL.gap / 2 + (k % p.per) * p.cw * p.u, 2);
        expect(b.min[1]).toBeCloseTo(Math.floor(k / p.per) * p.S + RAIL_SEAT, 2);
        expect(b.min[2]).toBeGreaterThan(RAIL.plate);
        expect(b.min[2]).toBeLessThan(RAIL.plate + RAIL.valley);
      });
    }
  });

  it('linked containers key into each other with a little play', () => {
    const o = opts({ links: true });
    const [a, b] = [placed(part(o, 'c0')), placed(part(o, 'c1'))];
    expect(shared(a, b)).toBeLessThan(0.02);
    // The dovetail holds them together along the rail and front to back.
    expect(shared(a, moved(b, [0.6, 0, 0]))).toBeGreaterThan(0.5);
    expect(shared(a, moved(b, [0, 0, 0.6]))).toBeGreaterThan(0.5);
    // They come apart up and down (join them before they go on the rail).
    expect(shared(a, moved(b, [0, 20, 0]))).toBeLessThan(0.02);
  });

  it('drawers slide out of their sleeves and stop before they fall out', () => {
    const o = opts({ kind: 'drawer' });
    const sleeve = placed(part(o, 'c0'));
    const drawer = placed(part(o, 'd0-0'));
    expect(shared(sleeve, drawer)).toBeLessThan(0.02);
    // Its back ridges meet the sleeve's front ones well out: free before, caught there.
    const out = o.depth - 6 - 4 - (RAIL_BAY + 4);
    expect(shared(sleeve, moved(drawer, [0, 0, out - 3]))).toBeLessThan(0.02);
    expect(shared(sleeve, moved(drawer, [0, 0, out]))).toBeGreaterThan(0.02);
    expect(out / (o.depth - RAIL_BAY - 6)).toBeGreaterThan(0.6);
  });

  it('a stop in the pocket at the end keeps them on', () => {
    const o = opts();
    const rail = railInFrame(o);
    const stop = placed(part(o, 's0'));
    const last = placed(part(o, 'c4'));
    expect(shared(rail, stop)).toBeLessThan(0.02);
    // Held in the pocket along the rail; the last container runs into it.
    expect(shared(rail, moved(stop, [-0.3, 0, 0]))).toBeGreaterThan(0.1);
    expect(shared(stop, moved(last, [1, 0, 0]))).toBeGreaterThan(0.5);
    // It lifts out.
    expect(shared(rail, moved(stop, [0, 20, 0]))).toBeLessThan(0.02);
  });
});

describe('storage rail: on a board', () => {
  it('a two-rail wall of bins places on a 560 × 560 board without warnings', () => {
    const job = plan(board([{ id: 'r', type: 'rail', x: 280, y: 300, opts: { rows: 2 } }]));
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed[0].ok).toBe(true);
    expect(wall.placed[0].y1 - wall.placed[0].y0).toBeCloseTo(80, 6);
    // The rail, ten bins and two stops print.
    expect(Object.values(job.parts).filter((p) => p.kind === 'attachment')).toHaveLength(13);
  });

  it('a rail longer than the bed is left out, and says so', () => {
    const job = plan(board([{ id: 'r', type: 'rail', x: 280, y: 300, opts: { length: 13 } }]));
    expect(job.warnings.join()).toMatch(/Rail 13 units, 13 bins 1×1 is larger than the print bed/);
  });

  it('drawers on two rails beside a neighbour: no warnings, and overlap is caught', () => {
    const ok = plan(
      board([
        { id: 'r', type: 'rail', x: 140, y: 300, opts: { rows: 2, kind: 'drawer', length: 3 } },
        { id: 'b', type: 'bin', x: 440, y: 300, opts: {} },
      ]),
    );
    expect(ok.warnings).toEqual([]);
    const clash = plan(
      board([
        { id: 'r', type: 'rail', x: 140, y: 300, opts: { rows: 2 } },
        { id: 'b', type: 'bin', x: 200, y: 300, opts: {} },
      ]),
    );
    expect(clash.warnings.join()).toMatch(/overlap/);
  });
});

describe('storage rail: runs of rails with open ends', () => {
  const ENDS = ['both', 'left', 'right', 'none'] as const;

  it('by default a rail on its own, as before', () => {
    const o = opts();
    expect(o.ends).toBe('both');
    const l = def().layout(o, CTX);
    expect(l.w).toBeCloseTo(210.4, 6);
    expect(l.depth).toBe(60);
    expect(parts(o).map((p) => p.key)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 's0']);
  });

  it('open ends: no end panel or stop there, the back flush, the units 20 mm either side of a slot column', () => {
    for (const ends of ENDS) {
      const o = opts({ ends, length: 3, rows: 2 });
      const l = def().layout(o, CTX);
      const panel = ends === 'both' || ends === 'left';
      const stop = ends === 'both' || ends === 'right';
      const x0 = panel ? RAIL.end : 0;
      expect(l.w, ends).toBeCloseTo(x0 + 120 + (stop ? RAIL.stop : 0), 6);
      // The clips are behind the middles of the units, so every kind of end meets the next on the lattice.
      expect(l.anchor[0] - x0, ends).toBeCloseTo(20, 6);
      expect(l.mounts.filter((m) => m.kind === 'clip').map((m) => m.di)).toEqual([0, 2, 4]);
      // Only a rail with an end panel stands out as far as its containers.
      expect(l.depth).toBe(panel ? o.depth : 10.7);
      expect(parts(o).filter((p) => p.key.startsWith('s'))).toHaveLength(stop ? 2 : 0);
      expect(parts(o).filter((p) => p.key.startsWith('c'))).toHaveLength(6);
      const mesh = bodyMesh(o);
      expect(
        checkPart(w, mesh).issues.filter((i) => i.severity === 'error'),
        ends,
      ).toEqual([]);
      const b = meshBounds(mesh);
      const want = printedSize(l, CTX);
      expect(
        [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(2)),
        ends,
      ).toEqual([want.w, want.d, want.h].map((v) => +v.toFixed(2)));
      // Containers start where the units do, and sit clear of the rail.
      const rail = railInFrame(o);
      expect(part(o, 'c0').place!.at[0]).toBeCloseTo(x0 + RAIL.gap / 2, 6);
      for (const p of parts(o)) expect(shared(rail, placed(p)), `${ends} ${p.key}`).toBeLessThan(0.02);
    }
  });

  it('notes a long piece, and 42 mm units that cannot join', () => {
    const notes = (o: Partial<RailOptions>) => def().notes!(opts(o), CTX).join(' ');
    expect(notes({ length: 7 })).toMatch(/Over 250 mm long: if it doesn't fit your printer, build the run from shorter rails with open ends/);
    expect(notes({ length: 5 })).toBe('');
    expect(notes({ length: 6, ends: 'none' })).toBe('');
    expect(notes({ unit: '42', ends: 'left' })).toMatch(/42 mm units don't line up/);
    expect(notes({ unit: '42' })).toBe('');
    expect(notes({ ends: 'none' })).toBe('');
  });

  it('a left end, a middle and a right end butt into one run on a 560 × 560 board', () => {
    // On a row of slots clear of the board's seams: clips at 40 … 320.
    const run: PlacedAttachment[] = [
      { id: 'a', type: 'rail', x: 40, y: 280, opts: { ends: 'left', length: 3 } },
      { id: 'b', type: 'rail', x: 160, y: 280, opts: { ends: 'none', length: 3 } },
      { id: 'c', type: 'rail', x: 280, y: 280, opts: { ends: 'right', length: 2 } },
    ];
    const job = plan(board(run));
    expect(job.warnings).toEqual([]);
    const pieces = job.drawers[0].enclosure!.wall!.placed;
    pieces.forEach((p, k) => {
      expect(p.ok).toBe(true);
      expect([p.x, p.y]).toEqual([run[k].x, run[k].y]);
    });
    // End to end, no gap and no overlap.
    expect(pieces[0].x1).toBeCloseTo(pieces[1].x0, 6);
    expect(pieces[1].x1).toBeCloseTo(pieces[2].x0, 6);
    // Each piece fills its own units; the right end has the stop.
    expect(Object.values(job.parts).filter((p) => p.kind === 'attachment')).toHaveLength(3 + 3 + 3 + 2 + 1);

    // The ridges, a unit apart all along the run: planned, and in the solids.
    const os = run.map((a) => opts(a.opts as Partial<RailOptions>));
    const offsets = pieces.map((p) => [p.x - p.layout.anchor[0], p.y - p.layout.anchor[1]]);
    const planned = os.flatMap((o, k) => railRidges(o).map((x) => +(x + offsets[k][0]).toFixed(2)));
    expect(planned).toEqual([40, 80, 120, 160, 200, 240, 280, 320]);
    const rails = os.map((o, k) => moved(railInFrame(o), [offsets[k][0], offsets[k][1], 0]));
    const y0 = offsets[0][1];
    const found = rails
      .flatMap((r) =>
        keep(r.intersect(slab(pieces[0].x0 + RAIL.end + 0.1, y0 + RAIL_SEAT + 1, RAIL.plate + 0.2, 560, y0 + RAIL_SEAT + 4, RAIL.plate + 0.5))).decompose(),
      )
      .map((m) => {
        const b = m.boundingBox();
        m.delete();
        return +((b.min[0] + b.max[0]) / 2).toFixed(2);
      })
      .sort((a, b) => a - b);
    expect(found).toEqual(planned);

    // A container part way across a joint touches neither rail, nor does a two-unit one sitting across it.
    const joints = [pieces[0].x1, pieces[1].x1];
    const across = (solid: Manifold, x: number) => {
      const b = solid.boundingBox();
      return moved(solid, [x - b.min[0], y0, 0]);
    };
    const bin = placed(part(os[0], 'c0'));
    for (const j of joints)
      for (const e of [10, 20, 30]) {
        const m = across(bin, j - 40 + RAIL.gap / 2 + e);
        for (const r of rails) expect(shared(r, m), `${j} ${e}`).toBeLessThan(0.02);
      }
    const wide = placed(part(opts({ ends: 'left', length: 3, size: '2x1' }), 'c0'));
    for (const j of joints) {
      const m = across(wide, j - 40 + RAIL.gap / 2);
      for (const r of rails) expect(shared(r, m), `${j}`).toBeLessThan(0.02);
    }
  });

  it('an open end is chamfered so a container crossing a small step does not catch', () => {
    const rail = railInFrame(opts({ ends: 'none', length: 2 }));
    const Q = RAIL.plate;
    const ys = RAIL_SEAT - 0.5;
    // The lip's back face and its top: drawn in at the very ends, whole 1 mm in.
    const lipBack = (x: number) => shared(rail, slab(x, ys + 1, Q + RAIL.valley, x + 0.05, ys + 7, Q + RAIL.valley + 0.4));
    const lipTop = (x: number) => shared(rail, slab(x, ys + RAIL.rise - 0.4, Q + RAIL.valley + 1, x + 0.05, ys + RAIL.rise, Q + RAIL.valley + 2));
    for (const x of [0, 80 - 0.05]) {
      expect(lipBack(x)).toBeLessThan(1e-3);
      expect(lipTop(x)).toBeLessThan(1e-3);
    }
    expect(lipBack(1)).toBeCloseTo(0.05 * 6 * 0.4, 4);
    expect(lipTop(1)).toBeCloseTo(0.05 * 0.4 * 1, 4);
  });
});
