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
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { CELL, CELL_DEFAULTS, cellPlan, type CellDispenserOptions } from '../src/lib/wall/kinds/cellDispenser';
import { MEDIA_DEFAULTS, mediaPlan, type MediaBlockOptions } from '../src/lib/wall/kinds/mediaBlock';
import { SPOOL, SPOOL_DEFAULTS, pegPlan, spoolPlan, type SpoolRackOptions } from '../src/lib/wall/kinds/spoolRack';
import { BOX, BOX_DEFAULTS, boxPlan, type BoxSleeveOptions } from '../src/lib/wall/kinds/boxSleeve';
import { LEAD_DEFAULTS, leadPlan, type LeadHangerOptions } from '../src/lib/wall/kinds/leadHanger';
import { fitted } from './wallFit';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const KINDS = ['cellDispenser', 'mediaBlock', 'spoolRack', 'boxSleeve', 'leadHanger'];

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
/** A round bar along x (axis at y, z) or along y (axis at x, z); a tube when `ri` is given. */
const barX = (x0: number, x1: number, r: number, y: number, z: number) =>
  keep(keep(keep(w.Manifold.cylinder(x1 - x0, r, r, 64)).rotate([0, 90, 0])).translate([x0, y, z]));
const barY = (y0: number, y1: number, r: number, x: number, z: number, ri = 0): Manifold => {
  const c = keep(keep(keep(w.Manifold.cylinder(y1 - y0, r, r, 64)).rotate([-90, 0, 0])).translate([x, y0, z]));
  return ri ? keep(c.subtract(barY(y0 - 1, y1 + 1, ri, x, z))) : c;
};
const tubeX = (x0: number, x1: number, r: number, ri: number, y: number, z: number) => keep(barX(x0, x1, r, y, z).subtract(barX(x0 - 1, x1 + 1, ri, y, z)));
const moved = (m: Manifold, d: [number, number, number]) => keep(m.translate(d));
const hull = (a: Manifold, b: Manifold) => keep(w.Manifold.hull([a, b]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** The part as it hangs, in its own frame (front view's bottom-left at the origin, out from the board +z). */
  hung: Manifold;
}

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

/** An extra part where it sits (its `place`). */
function placed(type: string, opts: object, key: string): Manifold {
  const def = attachmentDef(type)!;
  const p = def.parts!(def.sanitize(opts), CTX).find((q) => q.key === key)!;
  const m = keep(toManifold(buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX })).rotate(p.place!.turn));
  const b = m.boundingBox();
  return keep(m.translate([p.place!.at[0] - b.min[0], p.place!.at[1] - b.min[1], p.place!.at[2] - b.min[2]]));
}

/** No print issues at all (no overhangs, islands, thin walls or loose pieces), and as big as planned; its extra parts too. */
function expectClean(type: string, opts: object) {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  const what = `${type} ${JSON.stringify(opts)}`;
  expect(checkPart(w, mesh).issues, what).toEqual([]);
  const b = meshBounds(mesh);
  const want = printedSize(layout, CTX);
  expect(b.max[0] - b.min[0], what).toBeCloseTo(want.w, 1);
  expect(b.max[1] - b.min[1], what).toBeCloseTo(want.d, 1);
  expect(b.max[2] - b.min[2], what).toBeCloseTo(want.h, 1);
  // Mounts stay on the part.
  const pb = partBounds(layout, CTX);
  expect(pb.x0, what).toBeGreaterThanOrEqual(-1e-9);
  expect(pb.x1, what).toBeLessThanOrEqual(layout.w + 1e-9);
  for (const p of def.parts?.(o, CTX) ?? []) {
    const pm = buildMesh(w, { kind: 'attachmentPart', key: p.key, type, part: p.spec, ctx: CTX });
    expect(checkPart(w, pm).issues, `${what} ${p.key}`).toEqual([]);
    const q = meshBounds(pm);
    expect(q.max[0] - q.min[0]).toBeCloseTo(p.w, 1);
    expect(q.max[1] - q.min[1]).toBeCloseTo(p.d, 1);
    expect(q.max[2] - q.min[2]).toBeCloseTo(p.h, 1);
  }
}

/** A kind's presets (its 'preset' field). */
function presets(type: string): AttachmentPreset[] {
  const f = attachmentUi(type)!.fields.find((x) => x.kind === 'preset');
  return f && f.kind === 'preset' ? f.presets : [];
}

describe('dispensers and media: every kind, other options, every preset', () => {
  const cases: [string, object][] = [
    ['cellDispenser', { shape: 'coin', diameter: 20, thick: 3.2, columns: 3, capacity: 20 }],
    ['cellDispenser', { shape: 'block', diameter: 26.5, length: 48.5, thick: 17.5, columns: 1, capacity: 5, window: 10 }],
    ['cellDispenser', { diameter: 10.5, length: 44.5, columns: 4, capacity: 2, window: 0, clearance: 1 }],
    ['mediaBlock', { width: 11, thick: 1, depth: 8, pitch: 6, rows: 3, count: 4 }],
    ['mediaBlock', { width: 85, thick: 12, depth: 30, pitch: 22, rows: 2, count: 1, label: true }],
    ['mediaBlock', { tilt: 0, rows: 1, count: 5 }],
    ['mediaBlock', { tilt: 30, rows: 5, count: 1 }],
    ['spoolRack', { diameter: 40, width: 15, bore: 25.4, rod: 22, eyelet: 0, teeth: true, count: 5 }],
    ['spoolRack', { diameter: 200, width: 70, bore: 53, axle: 'bearings', hubs: true, eyelet: 4, count: 2 }],
    ['spoolRack', { axle: 'dowel', count: 2, guard: false }],
    ['spoolRack', { mode: 'pegs', diameter: 30, width: 30, bore: 5, count: 3, rows: 3 }],
    ['boxSleeve', { open: 'top', width: 100, depth: 60, height: 80, front: 30 }],
    ['boxSleeve', { open: 'bottom', width: 120, depth: 50, height: 40, slot: 20, cutter: true, rim: 4 }],
    ['boxSleeve', { width: 50, depth: 10, height: 30, rim: 3, wall: 1.2 }],
    ['leadHanger', { slot: 13, pocket: 32, depth: 12, pitch: 40, count: 3, height: 30 }],
    ['leadHanger', { slot: 2, pocket: 6, depth: 3, pitch: 6, count: 10 }],
  ];
  for (const type of KINDS) {
    it(`${type}: its defaults and presets print clean, as big as planned`, () => {
      expectClean(type, {});
      const def = attachmentDef(type)!;
      for (const p of presets(type)) expectClean(type, { ...def.defaults, ...p.set });
    });
  }
  for (const [type, opts] of cases) it(`${type} ${JSON.stringify(opts)}: clean, as big as planned`, () => expectClean(type, opts));

  it('every preset shows as picked once applied, and they differ', () => {
    for (const type of KINDS) {
      const def = attachmentDef(type)!;
      const list = presets(type);
      expect(list.length, type).toBeGreaterThanOrEqual(5);
      const seen = new Set<string>();
      for (const p of list) {
        const o = def.sanitize({ ...def.defaults, ...p.set }) as Record<string, unknown>;
        // The panel matches a preset when its options clean up to the same values.
        for (const [k, v] of Object.entries(p.set)) expect(o[k], `${type} ${p.value}.${k}`).toEqual(v);
        const key = JSON.stringify(o);
        expect(seen.has(key), `${type} ${p.value}`).toBe(false);
        seen.add(key);
        // No preset needs a warning.
        expect(def.notes?.(o, CTX) ?? [], `${type} ${p.value}`).toEqual([]);
      }
    }
  });

  it('are in their picker groups, with a form that cleans up', () => {
    const groups: Record<string, string> = { cellDispenser: 'storage', mediaBlock: 'devices', spoolRack: 'hobby', boxSleeve: 'kitchen', leadHanger: 'devices' };
    for (const type of KINDS) {
      expect(attachmentUi(type)!.group, type).toBe(groups[type]);
      const def = attachmentDef(type)!;
      expect(def.sanitize({ count: 'x', width: -5, height: 1e9 })).toEqual(def.sanitize({ ...def.defaults, width: -5, height: 1e9 }));
    }
    expect(attachmentDef('cellDispenser')!.sanitize({ shape: 'square', capacity: 1.4, columns: 20 })).toMatchObject({
      shape: 'round',
      capacity: 2,
      columns: 8,
    });
    expect(attachmentDef('spoolRack')!.sanitize({ diameter: 30, bore: 50 })).toMatchObject({ diameter: 30, bore: 24 });
    expect(attachmentDef('leadHanger')!.sanitize({ pocket: 10, slot: 12 })).toMatchObject({ pocket: 10, slot: 8 });
  });
});

describe('battery dispenser', () => {
  /** A cell in column 0, in its own frame: across the chute's middle, front to back centred at z, its bottom at y. */
  function cell(o: CellDispenserOptions, z: number, y: number): Manifold {
    const p = cellPlan(o);
    const x0 = p.x0 + CELL.wall + o.clearance;
    const r = p.b / 2;
    if (o.shape === 'round') return barX(x0, x0 + p.a, r, y + r, z);
    if (o.shape === 'coin') return barY(y, y + p.c, r, x0 + r, z);
    return box(x0, y, z - r, x0 + p.a, y + p.c, z + r);
  }

  /** Where a round cell resting on the floor's slope has its bottom-most point (the floor under its centre is lower). */
  const restY = (o: CellDispenserOptions, z: number) => {
    const p = cellPlan(o);
    const r = p.b / 2;
    return p.floorAt(z) + r / Math.cos((CELL.slope * Math.PI) / 180) - r;
  };

  /** On the tray against the lip: a round cell rests on the lip's top corner, a flat one against its face. */
  function atLip(o: CellDispenserOptions): number {
    const p = cellPlan(o);
    const r = p.b / 2;
    if (o.shape !== 'round') return p.zl - r - 0.02;
    // u back from the lip: the centre (zl - u, floorAt + r / cos) is r from the corner (zl, floor + lip).
    let lo = 0;
    let hi = r;
    for (let i = 0; i < 50; i++) {
      const u = (lo + hi) / 2;
      const dy = restY(o, p.zl - u) + r - (CELL.floor + p.lip);
      if (u * u + dy * dy < r * r) lo = u;
      else hi = u;
    }
    return p.zl - hi - 0.02;
  }

  const cases: [string, Partial<CellDispenserOptions>][] = [
    ['AA', {}],
    ['D', { diameter: 34.2, length: 61.5, columns: 1, capacity: 4 }],
    ['AAA, no window', { diameter: 10.5, length: 44.5, window: 0 }],
    ['21700', { diameter: 21, length: 70, columns: 1 }],
    ['9V', { shape: 'block', diameter: 26.5, length: 48.5, thick: 17.5, columns: 1, capacity: 5 }],
    ['CR2032', { shape: 'coin', diameter: 20, thick: 3.2, capacity: 20 }],
    ['CR2016', { shape: 'coin', diameter: 20, thick: 1.6, capacity: 30 }],
    ['LR44', { shape: 'coin', diameter: 11.6, thick: 5.4, columns: 3, capacity: 10 }],
  ];
  for (const [name, opts] of cases) {
    it(`${name}: a cell fits its chute with the clearance, one at a time goes out under the gate, and the lip holds it`, () => {
      const b = build('cellDispenser', opts);
      const o = b.o as CellDispenserOptions;
      const p = cellPlan(o);
      const body = b.hung;
      const lift = 0.02;
      // In the chute, half way up: clear of the walls, but only by the clearance; the window is too narrow to fall out of.
      const zc = CELL.back + p.lane / 2;
      const mid = cell(o, zc, b.layout.h / 2 - p.c);
      expect(overlap(body, mid)).toBeLessThan(0.01);
      expect(overlap(body, moved(mid, [0, 0, -o.clearance / 2 - 0.3]))).toBeGreaterThan(0.5);
      expect(overlap(body, moved(mid, [o.clearance + 0.3, 0, 0]))).toBeGreaterThan(0.5);
      expect(overlap(body, moved(mid, [0, 0, 5]))).toBeGreaterThan(1);
      // At the foot of the chute, on the floor; and out on the tray against the lip.
      const round = o.shape === 'round';
      const y = (z: number) => (round ? restY(o, z) : CELL.floor) + lift;
      const z0 = CELL.back + o.clearance / 2 + p.b / 2;
      const z1 = atLip(o);
      const first = cell(o, z0, y(z0));
      const out = cell(o, z1, y(z1));
      expect(overlap(body, first)).toBeLessThan(0.01);
      expect(overlap(body, out)).toBeLessThan(0.01);
      // The gate lets it pass (it slides or rolls along the floor: the hull is every place on the way)...
      expect(p.gate - p.floorAt(p.zf)).toBeGreaterThanOrEqual(p.c);
      expect(overlap(body, hull(first, out))).toBeLessThan(0.01);
      // ...but not the one above it,
      const second = moved(first, [0, p.c + 0.05, 0]);
      expect(overlap(body, hull(second, moved(second, [0, round ? y(z1) - y(z0) : 0, z1 - z0])))).toBeGreaterThan(1);
      // and the lip holds it on the tray (a flat cell's front is over the groove until it meets the lip either side).
      expect(overlap(body, moved(out, [0, 0, round ? 1 : 3]))).toBeGreaterThan(0.5);
    });
  }

  it('a groove under each tray for a fingertip, and the floor falls to the front only for round cells', () => {
    const round = cellPlan(CELL_DEFAULTS);
    expect(round.floorAt(CELL.back) - round.floorAt(round.zl)).toBeCloseTo((round.zl - CELL.back) * Math.tan((10 * Math.PI) / 180), 6);
    const coin = cellPlan({ ...CELL_DEFAULTS, shape: 'coin', diameter: 20, thick: 3.2 });
    expect(coin.floorAt(CELL.back)).toBe(coin.floorAt(coin.zl));
    const b = build('cellDispenser', {});
    const p = cellPlan(b.o as CellDispenserOptions);
    // A finger in the middle of the tray reaches under the cell: nothing there down to the bed.
    const xm = p.x0 + CELL.wall + p.across / 2;
    expect(overlap(b.hung, box(xm - 2, -1, p.zf + CELL.wall + 1, xm + 2, CELL.floor, p.D + 1))).toBeLessThan(0.01);
  });

  it('notes, summaries, and nothing to buy', () => {
    const def = attachmentDef('cellDispenser')!;
    const o = (x: object) => def.sanitize(x);
    expect(def.summary(o({}))).toBe('AA dispenser, 2 × 8');
    expect(def.summary(o({ shape: 'coin', diameter: 20, thick: 3.2, columns: 1, capacity: 20 }))).toBe('CR2032 dispenser, 1 × 20');
    expect(def.summary(o({ shape: 'block', diameter: 26.5, length: 48.5, thick: 17.5 }))).toMatch(/^9V dispenser/);
    expect(def.summary(o({ diameter: 18.5, length: 69 }))).toMatch(/^⌀18.5 × 69 dispenser/);
    expect(def.notes!(o({}), CTX)).toEqual([]);
    expect(def.notes!(o({ clearance: 0.1 }), CTX).join()).toMatch(/jam/);
    expect(def.notes!(o({ diameter: 34.2, length: 61.5, capacity: 8 }), CTX).join()).toMatch(/tall/);
    expect(def.notes!(o({ diameter: 30, length: 30 }), CTX).join()).toMatch(/turn/);
    expect(def.hardware).toBeUndefined();
    expect(def.parts).toBeUndefined();
  });
});

describe('card and media block', () => {
  /** A card in row r, slot k, its foot `down` past the slot's foot, `side` to the right; `above` mm stand out of the slot. */
  function card(o: MediaBlockOptions, r: number, k: number, down = -0.02, side = 0, above = 25): Manifold {
    const p = mediaPlan(o, CTX);
    const len = o.depth + above;
    // Lying along y from its foot, centred across and through its thickness, then leaned back.
    const c = keep(w.Manifold.cube([o.width, len, o.thick]).translate([-o.width / 2, 0, -o.thick / 2]));
    const leaned = keep(c.rotate([-o.tilt, 0, 0]));
    const d = o.depth + down;
    const x = 2 + p.sx / 2 + k * (p.sx + 1.6) + side;
    return keep(leaned.translate([x, p.top(r) - d * p.cos, p.zc(r) + d * p.sin]));
  }

  const cases: [string, Partial<MediaBlockOptions>][] = [
    ['SD', {}],
    ['microSD', { width: 11, thick: 1, depth: 8, pitch: 6, rows: 3, count: 4 }],
    ['business cards', { width: 85, thick: 12, depth: 30, pitch: 22, rows: 2, count: 1, label: true }],
    ['USB-A, upright', { width: 12, thick: 4.5, depth: 12, pitch: 10, tilt: 0, rows: 2, count: 3 }],
    ['CF at 30°', { width: 36, thick: 3.3, depth: 21, pitch: 11, tilt: 30, rows: 3, count: 1 }],
  ];
  for (const [name, opts] of cases) {
    it(`${name}: each card sits in its slot, leaning back clear of the row behind, and comes straight out`, () => {
      const b = build('mediaBlock', opts);
      const o = b.o as MediaBlockOptions;
      for (let r = 0; r < o.rows; r++)
        for (let k = 0; k < o.count; k++) {
          const at = card(o, r, k);
          expect(overlap(b.hung, at), `${r}, ${k}`).toBeLessThan(0.01);
          // On the slot's foot: no further in; the slot is the card and the clearance wide.
          expect(overlap(b.hung, card(o, r, k, 0.5))).toBeGreaterThan(0.1);
          expect(overlap(b.hung, card(o, r, k, -0.02, o.clearance / 2 + 0.3))).toBeGreaterThan(0.1);
          // Pulled out along its lean, nothing in the way.
          const a = (o.tilt * Math.PI) / 180;
          const up = o.depth + 5;
          expect(overlap(b.hung, hull(at, moved(at, [0, up * Math.cos(a), -up * Math.sin(a)])))).toBeLessThan(0.01);
        }
      // Each row is a step lower than the one behind it.
      const p = mediaPlan(o, CTX);
      if (o.rows > 1) expect(p.top(0) - p.top(1)).toBeGreaterThanOrEqual(2);
    });
  }

  it('rows close enough for the lean are pushed apart, and say so', () => {
    const def = attachmentDef('mediaBlock')!;
    const o = def.sanitize({ tilt: 30, pitch: 5 }) as MediaBlockOptions;
    const p = mediaPlan(o, CTX);
    expect(p.pitch).toBeCloseTo(p.least, 6);
    expect(p.pitch).toBeGreaterThan(5);
    expect(def.notes!(o, CTX).join()).toMatch(/apart/);
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    // A long, low block pries at its clips.
    expect(def.notes!(def.sanitize({ rows: 12, pitch: 16, width: 11, thick: 1, depth: 8 }), CTX).join()).toMatch(/three times/);
    expect(def.summary(def.sanitize({}))).toBe('Card block, 8 slots 24 × 2.1');
    expect(def.parts).toBeUndefined();
    expect(MEDIA_DEFAULTS.tilt).toBe(15);
  });
});

describe('spool rack', () => {
  /** The spools where they turn on the axle: tubes from the bore out. */
  function spools(o: SpoolRackOptions): Manifold[] {
    const g = spoolPlan(o);
    return g.xs.map((x) => tubeX(x - o.width / 2, x + o.width / 2, o.diameter / 2, o.bore / 2, g.yc, g.zc));
  }

  for (const [name, opts] of [
    ['hookup wire', {}],
    ['washi tape', { diameter: 40, width: 15, bore: 25.4, rod: 22, eyelet: 0, teeth: true, count: 5 }],
    ['filament with hubs', { diameter: 200, width: 70, bore: 53, rod: 20, hubs: true, guard: false, eyelet: 0, count: 1 }],
  ] as [string, Partial<SpoolRackOptions>][]) {
    it(`${name}: the axle rests in its pockets, the spools turn clear, and it lifts out`, () => {
      const b = build('spoolRack', opts);
      const o = b.o as SpoolRackOptions;
      const g = spoolPlan(o);
      const axle = placed('spoolRack', o, 'axle');
      expect(overlap(b.hung, axle)).toBeLessThan(0.02);
      // The stops keep it from sliding out sideways, the pocket from going forward; it lifts straight out.
      expect(overlap(b.hung, moved(axle, [1, 0, 0]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(axle, [-1, 0, 0]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(axle, [0, 0, 1]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(axle, [0, g.yp - g.yc + 2 * g.r, 0]))).toBeLessThan(0.02);
      // The spools turn clear of the arms, the strip and the guard, above the part's foot and inside its depth.
      for (const sp of spools(o)) {
        expect(overlap(b.hung, sp)).toBeLessThan(0.01);
        expect(overlap(axle, sp)).toBeLessThan(0.01);
        // Inside the part's front view (the board planner sees them); behind the guard, if there is one.
        const sb = sp.boundingBox();
        expect(sb.min[1]).toBeGreaterThanOrEqual(0);
        expect(sb.max[1]).toBeLessThanOrEqual(b.layout.h);
        if (o.guard) expect(sb.max[2]).toBeLessThan(g.zg);
      }
      if (o.hubs)
        for (const p of attachmentDef('spoolRack')!.parts!(o, CTX).filter((q) => q.key.startsWith('hub'))) {
          // Each hub sits on the axle, its boss in the spool's bore, clear of the frame.
          const hub = placed('spoolRack', o, p.key);
          expect(overlap(b.hung, hub), p.key).toBeLessThan(0.01);
          expect(overlap(axle, hub), p.key).toBeLessThan(0.01);
          for (const sp of spools(o)) expect(overlap(sp, hub), p.key).toBeLessThan(0.01);
        }
    });
  }

  it('wire feeds out through a hole before each spool', () => {
    const b = build('spoolRack', {});
    const o = b.o as SpoolRackOptions;
    const g = spoolPlan(o);
    for (const x of g.xs) {
      const wire = keep(keep(w.Manifold.cylinder(40, (o.eyelet - 0.5) / 2, (o.eyelet - 0.5) / 2, 32)).translate([x, g.yc, g.zc + o.diameter / 2 - 5]));
      expect(overlap(b.hung, wire)).toBeLessThan(0.01);
      expect(overlap(b.hung, moved(wire, [o.eyelet, 0, 0]))).toBeGreaterThan(1);
    }
  });

  it('608 bearings drop into the pockets, against the stops', () => {
    const b = build('spoolRack', { axle: 'bearings', hubs: true, diameter: 200, width: 70, bore: 53, count: 2 });
    const o = b.o as SpoolRackOptions;
    const g = spoolPlan(o);
    expect(g.arm - SPOOL.stop).toBeGreaterThanOrEqual(SPOOL.bw);
    for (const x0 of [SPOOL.stop + 0.02, g.w - SPOOL.stop - SPOOL.bw - 0.02]) {
      const bearing = tubeX(x0, x0 + SPOOL.bw, SPOOL.bd / 2, 4, g.yc, g.zc);
      expect(overlap(b.hung, bearing)).toBeLessThan(0.01);
      expect(overlap(b.hung, moved(bearing, [0, 0, 0.5]))).toBeGreaterThan(0.1);
    }
    expect(attachmentDef('spoolRack')!.parts!(o, CTX).map((p) => p.key)).toEqual(['hub00', 'hub01', 'hub10', 'hub11']);
  });

  it('pegs: a thread spool slides onto each, standing on the shelf', () => {
    const b = build('spoolRack', { mode: 'pegs', diameter: 35, width: 42, bore: 6.5, count: 4, rows: 2 });
    const o = b.o as SpoolRackOptions;
    const g = pegPlan(o);
    for (let j = 0; j < o.rows; j++)
      for (let k = 0; k < o.count; k++) {
        const sp = barY(3.02, 3 + o.width, o.diameter / 2, 3 + g.p / 2 + k * g.p, g.z0 + j * g.p, o.bore / 2);
        expect(overlap(b.hung, sp), `${j}, ${k}`).toBeLessThan(0.01);
        expect(overlap(b.hung, moved(sp, [1, 0, 0]))).toBeGreaterThan(0.1);
      }
    expect(g.h).toBeCloseTo(0.8 * o.width, 6);
  });

  it('notes, hardware, summaries', () => {
    const def = attachmentDef('spoolRack')!;
    const o = (x: object) => def.sanitize(x);
    expect(def.summary(o({}))).toBe('Spool rack, 4 × ⌀64');
    expect(def.summary(o({ mode: 'pegs', count: 5, rows: 2 }))).toBe('Thread rack, 10 pegs');
    expect(def.notes!(o({}), CTX)).toEqual([]);
    expect(def.notes!(o({ rod: 20, bore: 18 }), CTX).join()).toMatch(/doesn't go through/);
    expect(def.notes!(o({ rod: 8, bore: 40, diameter: 100 }), CTX).join()).toMatch(/hubs/);
    expect(def.notes!(o({ count: 10, width: 30 }), CTX).join()).toMatch(/dowel/);
    expect(def.notes!(o({ mode: 'pegs', bore: 4 }), CTX).join()).toMatch(/PETG/);
    expect(def.hardware!(o({}))).toEqual([]);
    expect(def.hardware!(o({ axle: 'dowel', count: 2 }))).toEqual([{ item: 'Dowel ⌀16 mm', count: 1, note: 'cut to 61 mm' }]);
    expect(def.hardware!(o({ axle: 'bearings', hubs: true }))).toEqual([
      { item: '608 bearing (22 × 8 × 7 mm)', count: 2 },
      { item: 'Rod ⌀8 mm (smooth, or M8 threaded)', count: 1, note: expect.stringMatching(/^cut to \d+ mm$/) },
    ]);
    expect(def.parts!(o({ axle: 'dowel' }), CTX)).toEqual([]);
    expect(def.parts!(o({ mode: 'pegs', hubs: true }), CTX)).toEqual([]);
    expect(SPOOL_DEFAULTS.axle).toBe('printed');
  });
});

describe('box sleeve', () => {
  /** The box in the sleeve: 1 mm clear all round, on the floor. */
  function boxIn(o: BoxSleeveOptions): Manifold {
    const p = boxPlan(o);
    return box(p.x0 + BOX.fit, BOX.floor + 0.02, p.z0 + BOX.fit, p.x1 - BOX.fit, BOX.floor + o.height + 20, p.z1 - BOX.fit);
  }

  for (const open of ['front', 'top', 'bottom'] as const) {
    it(`${open}: the box drops in from the top, 1 mm clear, and the front, sides and back keep it`, () => {
      const b = build('boxSleeve', { open, cutter: true });
      const o = b.o as BoxSleeveOptions;
      const it = boxIn(o);
      expect(overlap(b.hung, it)).toBeLessThan(0.01);
      expect(overlap(b.hung, moved(it, [0, 0, BOX.fit + 0.5]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(it, [0, 0, -BOX.fit - 0.5]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(it, [BOX.fit + 0.5, 0, 0]))).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(it, [0, b.layout.h, 0]))).toBeLessThan(0.01);
      expect(overlap(b.hung, moved(it, [0, -0.5, 0]))).toBeGreaterThan(1);
    });
  }

  it('front: the frame leaves the box face open; bottom: a sheet comes out through the floor past the teeth', () => {
    const f = build('boxSleeve', {});
    const o = f.o as BoxSleeveOptions;
    const p = boxPlan(o);
    // A hand reaching in through the frame.
    expect(overlap(f.hung, box(p.x0 + o.rim + 0.5, BOX.floor + o.rim + 0.5, p.z1 - 2, p.x1 - o.rim - 0.5, f.layout.h - 1, p.D + 10))).toBeLessThan(0.01);
    const b = build('boxSleeve', { open: 'bottom', width: 305, depth: 52, height: 52, rim: 6, slot: 16, cutter: true });
    const q = b.o as BoxSleeveOptions;
    const bp = boxPlan(q);
    const zm = (bp.z0 + bp.z1) / 2;
    // A sheet down the middle of the slot, clear of the teeth (they reach 1.5 mm in from the front edge).
    expect(overlap(b.hung, box(bp.x0 + q.rim + 1, -10, zm - q.slot / 2 + 0.5, bp.x1 - q.rim - 1, BOX.floor + 5, zm + q.slot / 2 - 2))).toBeLessThan(0.01);
    expect(overlap(b.hung, box(bp.x0 + q.rim + 1, -10, zm + q.slot / 2 - 1.4, bp.x1 - q.rim - 1, BOX.floor + 5, zm + q.slot / 2 - 0.2))).toBeGreaterThan(1);
  });

  it('a frame rim taller than the sleeve, or wider than half the box, is held to what it can take and builds', () => {
    // A random audit: these threw InvalidConstruction (the frame's opening, the floor slot and its teeth had no room).
    for (const raw of [
      { height: 15.8, rim: 22.3, cutter: true, wall: 3.4 },
      { height: 26.4, rim: 35.2, front: 68.5, cutter: false, wall: 4.8 },
      { open: 'bottom', width: 30, rim: 22.3, cutter: true },
      { open: 'bottom', width: 30, rim: 15.5, cutter: true },
    ]) {
      const what = JSON.stringify(raw);
      const b = build('boxSleeve', { ...BOX_DEFAULTS, ...raw });
      expect(checkPart(w, b.mesh).issues.filter((i) => i.severity === 'error'), what).toEqual([]);
      // The frame still leaves an opening.
      const o = b.o as BoxSleeveOptions;
      const p = boxPlan(o);
      expect(BOX.floor + o.rim, what).toBeLessThan(b.layout.h - 1);
      expect(p.x1 - p.x0 - 2 * o.rim, what).toBeGreaterThanOrEqual(6);
      expect(overlap(b.hung, box(p.x0 + o.rim + 0.5, BOX.floor + o.rim + 0.5, p.z1 - 2, p.x1 - o.rim - 0.5, b.layout.h - 0.5, p.D + 10)), what).toBeLessThan(0.01);
    }
  });

  it('notes and summaries', () => {
    const def = attachmentDef('boxSleeve')!;
    const o = (x: object) => def.sanitize(x);
    expect(def.summary(o({}))).toBe('Box sleeve 190 × 60 × 100');
    expect(def.notes!(o({}), CTX)).toEqual([]);
    expect(def.notes!(o({ rim: 40, width: 60 }), CTX).join()).toMatch(/rim narrower/);
    expect(def.notes!(o({ open: 'bottom', slot: 70 }), CTX).join()).toMatch(/slot narrower/);
    expect(def.notes!(o({ depth: 200, height: 20 }), CTX).join()).toMatch(/three times/);
    expect(def.hardware).toBeUndefined();
    expect(BOX_DEFAULTS.open).toBe('front');
  });
});

describe('lead hanger', () => {
  for (const [name, opts] of [
    ['banana leads', {}],
    ['XLR', { slot: 7.5, pocket: 21.5, depth: 12, pitch: 28, count: 4 }],
    ['dog leads', { slot: 13, pocket: 32, depth: 12, pitch: 40, count: 3, height: 30 }],
  ] as [string, Partial<LeadHangerOptions>][]) {
    it(`${name}: the cable slides in from the front, the plug sits in its pocket and can't slide out`, () => {
      const b = build('leadHanger', opts);
      const o = b.o as LeadHangerOptions;
      const p = leadPlan(o);
      const floor = p.t - o.depth;
      for (const x of p.xs) {
        const plug = barY(floor + 0.02, p.t + 30, (o.pocket - 1) / 2, x, p.zc);
        const cable = barY(-40, floor + 0.03, (o.slot - 0.5) / 2, x, p.zc);
        expect(overlap(b.hung, plug)).toBeLessThan(0.01);
        expect(overlap(b.hung, cable)).toBeLessThan(0.01);
        // In along the slot from the front.
        expect(overlap(b.hung, hull(cable, moved(cable, [0, 0, p.D + 5 - p.zc])))).toBeLessThan(0.01);
        // The plug stays put: not forward out of the slot (it's wider than the slot), not down through it.
        expect(o.pocket - 1).toBeGreaterThan(o.slot + 2);
        expect(overlap(b.hung, moved(plug, [0, 0, 2]))).toBeGreaterThan(0.5);
        expect(overlap(b.hung, moved(plug, [0, -1, 0]))).toBeGreaterThan(0.5);
      }
    });
  }

  it('pitch, notes and summary', () => {
    const def = attachmentDef('leadHanger')!;
    const o = (x: object) => def.sanitize(x) as LeadHangerOptions;
    expect(leadPlan(o({ pocket: 20, pitch: 10 })).pitch).toBeCloseTo(22.4, 6);
    expect(def.summary(o({}))).toBe('Lead hanger, 6 × ⌀13');
    expect(def.notes!(o({}), CTX)).toEqual([]);
    expect(def.notes!(o({ slot: 11, pocket: 13 }), CTX).join()).toMatch(/slip through/);
    expect(def.hardware).toBeUndefined();
    expect(LEAD_DEFAULTS.count).toBe(6);
  });
});

describe('on a 560 × 560 board', () => {
  it('every kind places without a warning, and its extra parts print with it', () => {
    const atts: PlacedAttachment[] = [
      { id: 'box', type: 'boxSleeve', x: 140, y: 520, opts: {} },
      { id: 'cell', type: 'cellDispenser', x: 420, y: 520, opts: {} },
      { id: 'spool', type: 'spoolRack', x: 60, y: 360, opts: {} },
      { id: 'lead', type: 'leadHanger', x: 240, y: 360, opts: {} },
      { id: 'media', type: 'mediaBlock', x: 400, y: 360, opts: {} },
      { id: 'coins', type: 'cellDispenser', x: 480, y: 360, opts: { shape: 'coin', diameter: 20, thick: 3.2, columns: 1, capacity: 20 } },
      { id: 'thread', type: 'spoolRack', x: 60, y: 200, opts: { mode: 'pegs', diameter: 35, width: 42, bore: 6.5, count: 4 } },
      { id: 'cards', type: 'boxSleeve', x: 300, y: 200, opts: { width: 128, depth: 40, height: 55, open: 'top' } },
    ];
    const d: NamedDrawer = {
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 }, attachments: atts },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    };
    // Each where it fits nearest where it is put (planning leaves it where it is put: tests/wallFit.ts).
    const job = planPrint([fitted(d)], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.map((p) => p.ok)).toEqual(atts.map(() => true));
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // Eight attachments and the spool rack's axle.
    expect(parts).toHaveLength(9);
    expect(parts.map((p) => p.name).join()).toMatch(/Axle/);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key)).toBe(true);
  });
});
