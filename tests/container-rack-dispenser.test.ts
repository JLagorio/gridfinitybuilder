import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binKey, binLabel, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { BASE_PROFILE_HEIGHT } from '../src/lib/geometry/spec';
import { boxAt, cylinderAt } from '../src/lib/geometry/shapes';
import { registerFont } from '../src/lib/geometry/text';
import { containerDefs } from '../src/lib/geometry/containers';
import {
  RACK,
  RACK_DEFAULTS,
  RACK_PRESETS,
  rackKey,
  rackLayout,
  rackNotes,
  rackPresetFields,
  sanitizeRack,
  wrenchHead,
  type RackOptions,
} from '../src/lib/geometry/containers/rack';
import {
  DISPENSER_DEFAULTS,
  MAGAZINE_ITEMS,
  channelLayout,
  dispenserKey,
  dispenserNotes,
  magazineLayout,
  sanitizeDispenser,
  tapeLayout,
  type DispenserOptions,
} from '../src/lib/geometry/containers/dispenser';
import { DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const solid = (m: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
/** Volume of plastic inside a probe. */
const inside = (body: Manifold, probe: Manifold) => body.intersect(probe).volume();

const rack = (o: Partial<RackOptions> = {}, more: Partial<BinOptions> = {}): BinOptions =>
  sanitizeBin({ ...DEFAULT_BIN, unitsX: 3, unitsY: 2, heightUnits: 7, container: 'rack', containers: { rack: o }, ...more });
const disp = (o: Partial<DispenserOptions> = {}, more: Partial<BinOptions> = {}): BinOptions =>
  sanitizeBin({ ...DEFAULT_BIN, unitsX: 3, unitsY: 2, heightUnits: 8, container: 'dispenser', containers: { dispenser: o }, ...more });
const rackOf = (b: BinOptions) => sanitizeRack(b.containers?.rack);
const dispOf = (b: BinOptions) => sanitizeDispenser(b.containers?.dispenser);

/** A valid single solid, with its bottom on z = 0 and the footprint of the bin. */
function expectBody(b: BinOptions): Manifold {
  const m = buildBin(w, b);
  const s = solid(m);
  expect(s.status()).toBe('NoError');
  expect(s.decompose().length).toBe(1);
  const box = meshBounds(m);
  expect(box.min[2]).toBeCloseTo(0, 4);
  expect(box.max[2]).toBeCloseTo(binTotalHeight(b), 3);
  return s;
}

/**
 * Down-facing triangles steeper than 45° (plus float noise) above `above`:
 * what an FDM printer would have to bridge or support. Returns their heights.
 */
function overhangs(m: MeshData, above = BASE_PROFILE_HEIGHT + 0.3): { z: number; area: number }[] {
  const p = m.positions;
  const out: { z: number; area: number }[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) continue;
    const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (n[2] / len < -0.72 && z > above && len / 2 > 1e-4) out.push({ z, area: len / 2 });
  }
  return out;
}

describe('tool rack', { timeout: 30_000 }, () => {
  it('is registered, with its height, name and key', () => {
    expect(containerDefs().map((d) => d.kind)).toEqual(expect.arrayContaining(['rack', 'dispenser']));
    const b = rack({ style: 'wrenches', sizes: [8, 10, 13] });
    expect(binTotalHeight(b)).toBe(49);
    expect(binLabel(b)).toBe('3×2×7u tool rack 3 wrenches 8–13');
    expect(binKey(b)).toContain('Krack{wrenches|8,10,13|');
    expect(binLabel(rack({ style: 'drivers', sizes: [2, 3], hole: 'hex', handle: 0 }))).toBe('3×2×7u tool rack 2 hex holes');
  });

  it('builds valid solids for every preset, and with leaning, staggered and stepped rows', () => {
    for (const p of RACK_PRESETS) expectBody(rack(rackPresetFields(p)));
    expectBody(rack({ style: 'drivers', tilt: 30, stagger: true, rows: 2, labels: 'mm' }, { unitsX: 2, unitsY: 2, heightUnits: 10 }));
    expectBody(rack({ style: 'drivers', sizes: [6], handle: 0 }, { unitsX: 1, unitsY: 1, heightUnits: 3, holes: 'magnets' }));
    expectBody(rack({ style: 'pliers', tilt: 45, rows: 2, step: 10 }, { heightUnits: 12 }));
    expectBody(rack({ style: 'wrenches', step: 8, tilt: 45 }, { unitsX: 4, unitsY: 3, heightUnits: 12, base: 'flat' }));
    // An empty list is just the block.
    expectBody(rack({ sizes: [] }, { unitsX: 1, unitsY: 1 }));
  });

  it('prints without overhangs past 45°', () => {
    for (const b of [
      rack({ style: 'drivers', tilt: 30, stagger: true, rows: 2, labels: 'mm' }),
      rack({ style: 'pliers', tilt: 45 }, { heightUnits: 9 }),
      rack({ style: 'wrenches', tilt: 45, step: 8 }, { heightUnits: 10 }),
      rack(rackPresetFields(RACK_PRESETS.find((p) => p.id === 'hexkeys')!)),
    ]) {
      expect(overhangs(buildBin(w, b))).toEqual([]);
    }
  });

  it('cuts round and hex holes to the size plus clearance, as deep as asked', () => {
    const s = new Scope();
    try {
      const b = rack({ style: 'drivers', sizes: [6], clearance: 0.8, handle: 0, depth: 30 }, { unitsX: 1, unitsY: 1, heightUnits: 7 });
      const p = rackLayout(b, rackOf(b)).places[0];
      expect(p.dz).toBeCloseTo(30, 6);
      const body = expectBody(b);
      const probe = (d: number, z0: number, z1: number) => inside(body, s.t(cylinderAt(w, p.x, p.y, z0, z1, d / 2, d / 2, 64)));
      expect(probe(6.7, p.z - p.dz + 0.2, p.z - 2)).toBeLessThan(1e-4);
      expect(probe(7.0, p.z - p.dz + 0.2, p.z - 2)).toBeGreaterThan(0.5);
      // Solid just under the bottom.
      expect(probe(5, p.z - p.dz - 1, p.z - p.dz - 0.2)).toBeGreaterThan(10);

      const h = rack({ style: 'drivers', sizes: [5], hole: 'hex', clearance: 0.4, handle: 0 }, { unitsX: 1, unitsY: 1 });
      const q = rackLayout(h, rackOf(h)).places[0];
      const hb = expectBody(h);
      // Flats face front and back, 5.4 apart; corners reach 5.4 × 2/√3 across.
      const slab = (hx: number, hy: number) => inside(hb, s.t(boxAt(w, q.x - hx, q.y - hy, q.z - 10, q.x + hx, q.y + hy, q.z - 2)));
      expect(slab(0.3, 2.65)).toBeLessThan(1e-4);
      expect(slab(0.3, 2.85)).toBeGreaterThan(0.05);
      expect(slab(3.0, 0.05)).toBeLessThan(1e-4);
      expect(slab(3.3, 0.05)).toBeGreaterThan(0.005);
    } finally {
      s.dispose();
    }
  });

  it('leans holes back by the tilt', () => {
    const s = new Scope();
    try {
      const b = rack({ style: 'drivers', sizes: [6], clearance: 0.8, handle: 0, tilt: 20, depth: 30 }, { unitsX: 1, unitsY: 2, heightUnits: 7 });
      const p = rackLayout(b, rackOf(b)).places[0];
      const body = expectBody(b);
      const T = Math.tan((20 * Math.PI) / 180);
      const at = (y: number, z: number) => inside(body, s.t(cylinderAt(w, p.x, y, z - 0.5, z + 0.5, 1, 1, 24)));
      const depth = 20;
      // Along the axis it's open; straight down from the mouth it's solid.
      expect(at(p.y - depth * T, p.z - depth)).toBeLessThan(1e-4);
      expect(at(p.y, p.z - depth)).toBeGreaterThan(1);
      // Square to the lean it is still 6.8 across: on a horizontal plane it is 6.8 / cos 20° front to back.
      const half = 6.8 / 2 / Math.cos((20 * Math.PI) / 180);
      const slab = (hy: number) => inside(body, s.t(boxAt(w, p.x - 0.2, p.y - depth * T - hy, p.z - depth - 0.2, p.x + 0.2, p.y - depth * T + hy, p.z - depth + 0.2)));
      expect(slab(half - 0.15)).toBeLessThan(1e-4);
      expect(slab(half + 0.25)).toBeGreaterThan(1e-3);
    } finally {
      s.dispose();
    }
  });

  it('sizes plier and wrench slots, and steps rows up', () => {
    const s = new Scope();
    try {
      const pl = rack({ style: 'pliers', sizes: [12], head: 28, clearance: 1, tilt: 0 }, { unitsX: 1, unitsY: 1 });
      const p = rackLayout(pl, rackOf(pl)).places[0];
      const pb = expectBody(pl);
      const box = (body: Manifold, x: number, y: number, hx: number, hy: number, z: number) =>
        inside(body, s.t(boxAt(w, x - hx, y - hy, z - 5, x + hx, y + hy, z - 1)));
      expect(box(pb, p.x, p.y, 6.2, 14.2, p.z)).toBeLessThan(1e-4);
      expect(box(pb, p.x, p.y, 6.7, 1, p.z)).toBeGreaterThan(0.05);
      expect(box(pb, p.x, p.y, 1, 14.7, p.z)).toBeGreaterThan(0.05);

      const wr = rack({ style: 'wrenches', sizes: [10, 13, 17], clearance: 1, tilt: 0, step: 7, rows: 3 }, { heightUnits: 9 });
      const L = rackLayout(wr, rackOf(wr));
      expect(L.rows.map((r) => r.z)).toEqual([49, 56, 63]);
      const wb = expectBody(wr);
      for (const q of L.places) {
        const head = wrenchHead(q.size);
        const [hx, hy] = [(head.width + 1) / 2, (head.thick + 1) / 2];
        expect(box(wb, q.x, q.y, hx - 0.2, hy - 0.2, q.z)).toBeLessThan(1e-4);
        expect(box(wb, q.x, q.y, 1, hy + 0.3, q.z)).toBeGreaterThan(0.01);
        // The step's top is at z: plastic just below it, in front of the slot; none just above.
        const fy = q.y - hy - 1;
        expect(inside(wb, s.t(boxAt(w, q.x - 1, fy - 0.3, q.z - 0.4, q.x + 1, fy + 0.3, q.z - 0.1)))).toBeGreaterThan(0.1);
        expect(inside(wb, s.t(boxAt(w, q.x - 1, fy - 0.3, q.z + 0.1, q.x + 1, fy + 0.3, q.z + 3)))).toBeLessThan(1e-4);
      }
    } finally {
      s.dispose();
    }
  });

  it('keeps every hole clear of its neighbours, the outside and the steps', () => {
    for (const o of [
      { style: 'drivers', tilt: 25, stagger: true, rows: 3, labels: 'mm', sizes: [3, 4, 5, 6, 6, 8, 3, 4] },
      { style: 'drivers', hole: 'hex', handle: 0, labels: 'inch', stagger: true, sizes: [1.6, 2, 2.4, 3.2, 4, 4.8, 5.6, 6.4, 8, 9.5] },
      { style: 'wrenches', step: 5, tilt: 30 },
      { style: 'pliers', rows: 2, tilt: 20, step: 4 },
    ] as Partial<RackOptions>[]) {
      const b = rack(o, { heightUnits: 10 });
      const ro = rackOf(b);
      const L = rackLayout(b, ro);
      const T = Math.tan((ro.tilt * Math.PI) / 180);
      expect(L.places.length).toBeGreaterThan(2);
      for (const p of L.places) {
        // Inside the footprint at the top and at the (forward-leaning) bottom.
        expect(p.x - p.sx / 2).toBeGreaterThanOrEqual(-L.W / 2 + RACK.edge - 1e-6);
        expect(p.x + p.sx / 2).toBeLessThanOrEqual(L.W / 2 - RACK.edge + 1e-6);
        expect(p.y - p.wy / 2 - p.dz * T).toBeGreaterThanOrEqual(-L.D / 2 + RACK.edge - 1e-6);
        expect(p.y + p.wy / 2).toBeLessThanOrEqual(L.D / 2 - RACK.edge + 1e-6);
        for (const q of L.places) {
          if (q === p || q.y < p.y || (q.y === p.y && q.x <= p.x)) continue;
          const dx = Math.abs(p.x - q.x) - (p.sx + q.sx) / 2;
          if (dx >= ro.spacing - 0.01) continue;
          // Leaning in parallel, their horizontal distance is the same at every height both reach.
          const gap = q.y - p.y - (q.z - p.z) * T - (p.wy + q.wy) / 2;
          if (q.z - q.dz < p.z) expect(gap).toBeGreaterThanOrEqual(ro.spacing - 0.01);
        }
      }
      // Each hole stays behind the riser in front of it.
      L.rows.forEach((row, r) => {
        if (!r) return;
        const riser = L.rows[r - 1].back;
        if (riser >= L.D / 2) return;
        for (const p of row.places) expect(p.y - p.wy / 2 - Math.min(L.step, p.dz) * T).toBeGreaterThan(riser);
      });
      expect(solid(buildBin(w, b)).decompose().length).toBe(1);
    }
  });

  it('engraves the sizes in front of the holes', () => {
    const o: Partial<RackOptions> = { style: 'wrenches', sizes: [8, 10, 13], rows: 1 };
    const plain = solid(buildBin(w, rack({ ...o, labels: 'none' }))).volume();
    const b = rack({ ...o, labels: 'mm' });
    const L = rackLayout(b, rackOf(b));
    expect(L.places.map((p) => p.dz)).toEqual(rackLayout(b, { ...rackOf(b), labels: 'none' }).places.map((p) => p.dz));
    expect(L.places.every((p) => p.labelAt && p.labelAt.y < p.y - p.wy / 2)).toBe(true);
    expect(plain - solid(buildBin(w, b)).volume()).toBeGreaterThan(L.places.length * 2);
    expect(rackLayout(b, { ...rackOf(b), sizes: [12.7], labels: 'inch' }).places[0].label).toBe('1/2');
    expect(rackLayout(b, { ...rackOf(b), sizes: [13], names: ['M8 nut'] }).places[0].label).toBe('M8 nut');
  });

  it('warns about tools that don’t fit, short steps and shallow holes, and tipping', () => {
    const small = rack({ style: 'wrenches' }, { unitsX: 1, unitsY: 1, heightUnits: 3 });
    const notes = rackNotes(small, rackOf(small));
    expect(notes.some((n) => /of 12 wrenches don’t fit/.test(n))).toBe(true);
    const short = rack({ style: 'wrenches', sizes: [8, 9, 10, 11, 12] }, { unitsX: 2, unitsY: 2, heightUnits: 3 });
    const sn = rackNotes(short, rackOf(short));
    expect(sn.some((n) => /step up only/.test(n))).toBe(true);
    expect(sn.some((n) => /only \d+(\.\d)? mm deep/.test(n))).toBe(true);
    // Screwdrivers on a 1-deep base stand tall for it; leaning far on a shallow one tips back.
    const tall = rack({ style: 'drivers' }, { unitsX: 3, unitsY: 1 });
    expect(rackNotes(tall, rackOf(tall)).some((n) => /may tip when the drawer moves/.test(n))).toBe(true);
    const lean = rack({ style: 'drivers', tilt: 30, sizes: [6, 6], handle: 0, reach: 200 }, { unitsX: 2, unitsY: 1 });
    expect(rackLayout(lean, rackOf(lean)).places.length).toBe(2);
    expect(rackNotes(lean, rackOf(lean)).some((n) => /tip backwards/.test(n))).toBe(true);
    const fine = rack({ style: 'drivers' }, { unitsX: 3, unitsY: 3, heightUnits: 8 });
    expect(rackNotes(fine, rackOf(fine))).toEqual([]);
  });

  it('cleans its options', () => {
    expect(sanitizeRack(undefined)).toEqual(RACK_DEFAULTS);
    const o = sanitizeRack({
      style: 'pliers',
      sizes: [12, -3, 'x', 500, 8.123],
      names: ['  Knipex cobra pliers ', 7],
      tilt: 90,
      rows: 11,
      depth: 0,
      spacing: 'wide',
      clearance: -1,
      labels: 'roman',
      step: 99,
      stagger: 'yes',
    });
    expect(o.style).toBe('pliers');
    expect(o.sizes).toEqual([12, 80, 8.12]);
    expect(o.names).toEqual(['Knipex cobra', '', '']);
    expect(o.tilt).toBe(RACK.maxTilt.pliers);
    expect(o.rows).toBe(RACK.maxRows);
    expect(o.depth).toBe(3);
    expect(o.spacing).toBe(2);
    expect(o.clearance).toBe(0);
    expect(o.labels).toBe('none');
    expect(o.step).toBe(RACK.maxStep);
    expect(o.stagger).toBe(false);
    expect(sanitizeRack({ style: 'drivers', tilt: 40 }).tilt).toBe(RACK.maxTilt.drivers);
    expect(sanitizeRack({ style: 'nope' }).style).toBe('drivers');
    // A style's missing sizes come from its first preset.
    expect(sanitizeRack({ style: 'wrenches' }).sizes).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(sanitizeRack(rackPresetFields(RACK_PRESETS[2]))).toEqual(rackPresetFields(RACK_PRESETS[2]));
  });

  it('changes its key with every option that changes the geometry', () => {
    const base = sanitizeRack({ style: 'drivers', labels: 'mm' });
    const k = rackKey(base);
    const changes: Partial<RackOptions>[] = [
      { sizes: [3, 4] },
      { names: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { hole: 'hex' },
      { clearance: 0.5 },
      { handle: 20 },
      { depth: 30 },
      { spacing: 3 },
      { rows: 2 },
      { stagger: true },
      { step: 4 },
      { tilt: 10 },
      { labels: 'inch' },
      { style: 'wrenches' },
    ];
    for (const c of changes) expect(rackKey(sanitizeRack({ ...base, ...c }))).not.toBe(k);
    // The tipping estimate and the preset name don't change the mesh.
    expect(rackKey(sanitizeRack({ ...base, reach: 150, preset: 'custom' }))).toBe(k);
    expect(rackKey(sanitizeRack({ ...base, style: 'pliers', head: 20 }))).not.toBe(rackKey(sanitizeRack({ ...base, style: 'pliers', head: 30 })));
  });

  it('has no extra printed parts', () => {
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 }, bins: [{ id: 'r', x: 0, y: 0, opts: rack() }] });
    expect(Object.keys(job.parts).filter((k) => !k.startsWith('piece:'))).toEqual(['bin:r']);
  });
});

describe('dispenser', { timeout: 30_000 }, () => {
  it('builds valid solids for every item, roll and channel layout', () => {
    for (const p of MAGAZINE_ITEMS) expectBody(disp({ item: p.id, shape: p.shape, itemD: p.d, itemL: p.l }));
    expectBody(disp({ item: 'aa', columns: 1, tray: false, window: false }, { unitsX: 2, unitsY: 1, heightUnits: 6 }));
    expectBody(disp({ item: 'cr2032', columns: 1 }, { unitsX: 1, unitsY: 1, heightUnits: 4, holes: 'magnets' }));
    expectBody(disp({ item: 'custom', shape: 'cylinder', itemD: 8, itemL: 30, ramp: 15 }, { unitsX: 2, unitsY: 2, base: 'flat' }));
    expectBody(disp({ style: 'tape' }, { unitsX: 1, unitsY: 2, heightUnits: 3 }));
    expectBody(disp({ style: 'tape', tapePreset: 'packing', tapeInner: 76.2, tapeOuter: 115, tapeWidth: 48, cutter: false }, { unitsX: 2, unitsY: 3, heightUnits: 6 }));
    expectBody(disp({ style: 'channel' }, { unitsX: 2, unitsY: 5, heightUnits: 2 }));
    expectBody(disp({ style: 'channel', channelWidth: 30, channels: 2, along: 'x', notch: true }, { unitsX: 4, unitsY: 2, heightUnits: 3 }));
    // Too narrow for an AA lying across: a plain block, and a note saying so.
    const tiny = disp({ item: 'aa' }, { unitsX: 1, unitsY: 1 });
    expectBody(tiny);
    expect(dispenserNotes(tiny, dispOf(tiny))[0]).toMatch(/lying across need \d+ mm across/);
  });

  it('prints without overhangs past 45° (the coin slot’s short roof is the one bridge)', () => {
    for (const b of [disp({ item: 'aa' }), disp({ item: 'd' }, { unitsX: 3, unitsY: 3 }), disp({ style: 'tape' }, { unitsX: 1, unitsY: 2 }), disp({ style: 'channel' }, { unitsY: 4 })]) {
      expect(overhangs(buildBin(w, b))).toEqual([]);
    }
    const coin = disp({ item: 'cr2032' });
    const L = magazineLayout(coin, dispOf(coin));
    const bridges = overhangs(buildBin(w, coin));
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges.every((t) => Math.abs(t.z - L.spring) < 0.01)).toBe(true);
  });

  it('holds cylinders across a column with clearance, lets the bottom one roll into the tray and holds back the next', () => {
    const s = new Scope();
    try {
      const b = disp({ item: 'aa', clearance: 1, ramp: 5 });
      const o = dispOf(b);
      const L = magazineLayout(b, o);
      expect(L.xs.length).toBe(2);
      expect(L.colD).toBeCloseTo(15.5, 6);
      expect(L.colW).toBeCloseTo(52.5, 6);
      const body = expectBody(b);
      const [r, len] = [o.itemD / 2, o.itemL];
      const tan = Math.tan((5 * Math.PI) / 180);
      const floor = (y: number) => L.floor + (y - L.tray!.y0) * tan;
      // A cell lying across (axis along X), resting on the sloped floor.
      const cell = (x: number, y: number, lift = 0) =>
        s.t(s.t(s.t(w.Manifold.cylinder(len, r, r, 48)).rotate([0, 90, 0])).translate([x - len / 2, y, floor(y) + r / Math.cos((5 * Math.PI) / 180) + 0.05 + lift]));
      const x = L.xs[0];
      const cy = (L.yCol0 + L.yCol1) / 2;
      const ty = (L.tray!.y0 + L.yWall0) / 2;
      expect(inside(body, cell(x, cy))).toBeLessThan(1e-3);
      // The column is the cell plus clearance: a fatter cell doesn't fit.
      expect(inside(body, s.t(boxAt(w, x - L.colW / 2 - 0.3, cy - 1, 30, x + L.colW / 2 + 0.3, cy + 1, 40)))).toBeGreaterThan(0.1);
      expect(inside(body, s.t(boxAt(w, x - 1, cy - L.colD / 2 - 0.3, 30, x + 1, cy + L.colD / 2 + 0.3, 40)))).toBeGreaterThan(0.1);
      // Rolling out: the whole path from the column to the tray is clear…
      expect(inside(body, s.t(w.Manifold.hull([cell(x, cy), cell(x, ty)])))).toBeLessThan(1e-3);
      // …but not for the one above it.
      expect(inside(body, s.t(w.Manifold.hull([cell(x, cy, o.itemD), cell(x, ty, o.itemD)])))).toBeGreaterThan(5);
      // The tray's lip stops it.
      expect(inside(body, cell(x, ty - 3))).toBeGreaterThan(1);
      expect(L.capacity).toBe(4);
    } finally {
      s.dispose();
    }
  });

  it('stacks coin cells in a tube, with a slot for the bottom one and a finger notch behind', () => {
    const s = new Scope();
    try {
      const b = disp({ item: 'cr2032', clearance: 0.8 });
      const o = dispOf(b);
      const L = magazineLayout(b, o);
      expect(L.colD).toBeCloseTo(20.8, 6);
      expect(L.well).not.toBeNull();
      const body = expectBody(b);
      const x = L.xs[0];
      const cy = (L.yCol0 + L.yCol1) / 2;
      const ty = (L.tray!.y0 + L.yWall0) / 2;
      const coin = (y: number, level: number) => s.t(cylinderAt(w, x, y, L.floor + 0.05 + level * o.itemL, L.floor + (level + 1) * o.itemL, o.itemD / 2, o.itemD / 2, 64));
      expect(inside(body, coin(cy, 0))).toBeLessThan(1e-3);
      expect(inside(body, coin(cy, 5))).toBeLessThan(1e-3);
      expect(inside(body, s.t(cylinderAt(w, x, cy, 20, 25, o.itemD / 2 + 0.6, o.itemD / 2 + 0.6, 64)))).toBeGreaterThan(0.1);
      // The bottom one slides out into the tray; the next one up can't.
      expect(inside(body, s.t(w.Manifold.hull([coin(cy, 0), coin(ty, 0)])))).toBeLessThan(1e-3);
      expect(inside(body, s.t(w.Manifold.hull([coin(cy, 1), coin(ty, 1)])))).toBeGreaterThan(1);
      // A finger in the well behind pushes through the notch in the tube's back wall.
      const n = L.well!;
      expect(inside(body, s.t(boxAt(w, x - n.notch / 2 + 0.2, L.yCol1 - 0.5, L.floor + 0.2, x + n.notch / 2 - 0.2, n.y0 + 1, L.floor + 3 * o.itemL)))).toBeLessThan(1e-3);
      expect(inside(body, s.t(boxAt(w, x - 7, n.y0 + 0.6, L.floor + 0.2, x + 7, n.y1 - 8, L.top + 1)))).toBeLessThan(1e-3);
      // A narrow footprint loses the tray first, with a note.
      const shallow = disp({ item: 'cr2032' }, { unitsY: 1 });
      const sl = magazineLayout(shallow, dispOf(shallow));
      expect(sl.tray).toBeNull();
      expect(sl.well).not.toBeNull();
      expect(dispenserNotes(shallow, dispOf(shallow)).some((m) => /No room for the tray/.test(m))).toBe(true);
    } finally {
      s.dispose();
    }
  });

  it('holds a tape roll on an axle printed separately, seated in the cheeks’ grooves', () => {
    const s = new Scope();
    try {
      const b = disp({ style: 'tape', tapeInner: 25.4, tapeOuter: 48, tapeWidth: 19, cutter: true }, { unitsX: 1, unitsY: 2, heightUnits: 3 });
      const o = dispOf(b);
      const L = tapeLayout(b, o);
      const body = expectBody(b);
      // The roll sets the height here, with a note.
      expect(binTotalHeight(b)).toBeCloseTo(L.needs, 6);
      expect(dispenserNotes(b, o).some((m) => /roll sets the height/.test(m))).toBe(true);

      const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 3 }, bins: [{ id: 't', x: 0, y: 0, opts: b }] });
      const part = job.parts['axle:t:0'];
      expect(part).toMatchObject({ kind: 'tray', bin: 't', w: L.la, d: 2 * L.ra });
      // It goes on the bin plates next to its body.
      const onPlates = job.plates.filter((pl) => pl.group === 'bins').flatMap((pl) => pl.placements.map((q) => q.key));
      expect(onPlates).toEqual(expect.arrayContaining(['bin:t', 'axle:t:0']));
      const mesh = buildMesh(w, job.meshes[part.meshKey]);
      const axle = solid(mesh);
      expect(axle.status()).toBe('NoError');
      expect(axle.decompose().length).toBe(1);
      expect(meshBounds(mesh).min).toEqual([0, 0, 0].map((v) => expect.closeTo(v, 4)));
      // Lying on its flat it prints without overhangs; the bore is a teardrop.
      expect(overhangs(mesh, 0.01)).toEqual([]);
      expect(L.bore).toBeGreaterThan(0);
      // In place: clear of the body, resting on the grooves' bottoms, its ends in the grooves.
      const placed = (dz: number) => s.t(axle.translate([part.assembled!.x - L.W / 2, part.assembled!.y - L.D / 2, part.assembled!.z + dz]));
      expect(inside(body, placed(0.02))).toBeLessThan(1e-3);
      expect(inside(body, placed(-0.3))).toBeGreaterThan(0.5);
      expect(L.la).toBeGreaterThan(L.gap + 2);
      // A full roll hanging on it clears the floor, the cutter and the cheeks.
      const ro = o.tapeOuter / 2;
      const rollZ = L.za - (o.tapeInner / 2 - L.ra);
      const roll = s.t(s.t(s.t(w.Manifold.cylinder(o.tapeWidth, ro, ro, 64)).rotate([0, 90, 0])).translate([-o.tapeWidth / 2, L.ya, rollZ]));
      expect(inside(body, roll)).toBeLessThan(1e-3);
      expect(rollZ - ro).toBeGreaterThan(L.floor + 1);
      // The serrated edge: teeth on the front wall's top, across the cheeks.
      const teeth = () => s.t(boxAt(w, -L.gap / 2 + 0.1, -L.D / 2, L.zc + 0.1, L.gap / 2 - 0.1, -L.D / 2 + 3, L.zc + 1.3));
      expect(inside(body, teeth())).toBeGreaterThan(1);
      const plain = solid(buildBin(w, disp({ ...o, cutter: false }, { unitsX: 1, unitsY: 2, heightUnits: 3 })));
      expect(inside(plain, teeth())).toBeLessThan(1e-3);
      // A different roll is a different axle.
      const other = disp({ ...o, tapeInner: 38 }, { unitsX: 1, unitsY: 2, heightUnits: 3 });
      const job2 = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 3 }, bins: [{ id: 't', x: 0, y: 0, opts: other }] });
      expect(job2.parts['axle:t:0'].meshKey).not.toBe(part.meshKey);
    } finally {
      s.dispose();
    }
  });

  it('cuts channels with a fingertip notch over a sill', () => {
    const s = new Scope();
    try {
      const b = disp({ style: 'channel', channelWidth: 12, notch: true }, { unitsX: 2, unitsY: 3, heightUnits: 3 });
      const o = dispOf(b);
      const L = channelLayout(b, o);
      expect(L.along).toBe('y');
      expect(L.centers.length).toBe(6);
      const body = expectBody(b);
      const c = L.centers[2];
      expect(inside(body, s.t(boxAt(w, c - 5.9, L.from + 4, L.floor + 0.2, c + 5.9, L.to - 4, L.top + 1)))).toBeLessThan(1e-3);
      expect(inside(body, s.t(boxAt(w, c - 6.3, 0, L.floor + 2, c + 6.3, 1, L.top - 1)))).toBeGreaterThan(0.1);
      // Through the front wall above the sill; solid below it.
      expect(inside(body, s.t(boxAt(w, c - 3, -L.D / 2 - 1, L.floor + 1.5, c + 3, L.from + 1, L.top + 1)))).toBeLessThan(1e-3);
      expect(inside(body, s.t(boxAt(w, c - 3, -L.D / 2 + 0.3, L.floor + 0.2, c + 3, L.from - 0.2, L.floor + 1)))).toBeGreaterThan(0.1);
      const across = channelLayout(disp({ style: 'channel', channels: 2, along: 'x' }, { unitsX: 4, unitsY: 2 }), dispOf(disp({ style: 'channel', channels: 2, along: 'x' })));
      expect(across.along).toBe('x');
      expect(across.centers.length).toBe(2);
    } finally {
      s.dispose();
    }
  });

  it('cleans its options', () => {
    expect(sanitizeDispenser(undefined)).toEqual(DISPENSER_DEFAULTS);
    const o = sanitizeDispenser({
      style: 'tape',
      item: 'cr2032',
      itemD: 999,
      clearance: 0,
      columns: 99,
      ramp: 60,
      tray: 'no',
      tapeInner: 50,
      tapeOuter: 20,
      tapeWidth: -4,
      channelWidth: 1,
      channels: -2,
      along: 'up',
    });
    expect(o.style).toBe('tape');
    expect(o.shape).toBe('coin');
    expect(o.itemD).toBe(80);
    expect(o.itemL).toBe(3.2);
    expect(o.clearance).toBe(0.2);
    expect(o.columns).toBe(8);
    expect(o.ramp).toBe(15);
    expect(o.tray).toBe(true);
    expect(o.tapeOuter).toBe(52);
    expect(o.tapeWidth).toBe(3);
    expect(o.channelWidth).toBe(3);
    expect(o.channels).toBe(0);
    expect(o.along).toBe('auto');
    expect(sanitizeDispenser({ style: 'x', item: 'nope' })).toMatchObject({ style: 'magazine', item: 'aa', shape: 'cylinder', itemD: 14.5 });
    expect(sanitizeDispenser({ tapePreset: 'packing' })).toMatchObject({ tapeInner: 76.2, tapeOuter: 115, tapeWidth: 48 });
  });

  it('changes its key with every option of the active style, and only those', () => {
    const keyOf = (o: Partial<DispenserOptions>) => dispenserKey(sanitizeDispenser(o));
    const mag: Partial<DispenserOptions> = { style: 'magazine' };
    for (const c of [{ shape: 'coin' }, { itemD: 10 }, { itemL: 30 }, { clearance: 2 }, { columns: 1 }, { ramp: 8 }, { tray: false }, { window: false }] as Partial<DispenserOptions>[]) {
      expect(keyOf({ ...mag, ...c })).not.toBe(keyOf(mag));
    }
    expect(keyOf({ ...mag, tapeWidth: 30, channels: 3 })).toBe(keyOf(mag));
    const tape: Partial<DispenserOptions> = { style: 'tape' };
    for (const c of [{ tapeInner: 30 }, { tapeOuter: 60 }, { tapeWidth: 25 }, { cutter: false }] as Partial<DispenserOptions>[]) {
      expect(keyOf({ ...tape, ...c })).not.toBe(keyOf(tape));
    }
    expect(keyOf({ ...tape, tapePreset: 'custom', itemD: 20 })).toBe(keyOf(tape));
    const ch: Partial<DispenserOptions> = { style: 'channel' };
    for (const c of [{ channelWidth: 8 }, { channels: 2 }, { along: 'x' }, { notch: false }] as Partial<DispenserOptions>[]) {
      expect(keyOf({ ...ch, ...c })).not.toBe(keyOf(ch));
    }
    expect(binKey(disp({ item: 'aa' }))).not.toBe(binKey(disp({ item: 'aaa', itemD: 10.5, itemL: 44.5 })));
  });

  it('names itself and plans an axle only for tape', () => {
    expect(binLabel(disp({ item: 'aa' }))).toBe('3×2×8u dispenser 2 × AA');
    expect(binLabel(disp({ item: 'cr2032', shape: 'coin', itemD: 20, itemL: 3.2, columns: 1 }))).toBe('3×2×8u dispenser CR2032');
    expect(binLabel(disp({ style: 'channel' }, { unitsX: 1, unitsY: 4 }))).toBe('1×4×8u dispenser 1 channel');
    // On a half grid the summary counts the columns of the real (21 mm) cells: 4 × 2 half cells take 3 AA in 42 mm cells, 1 in 21 mm ones.
    const half = { half: true, x: [21, 21, 21, 21], y: [21, 21] };
    expect(binLabel(disp({ item: 'aa' }, { unitsX: 4 }))).toBe('4×2×8u dispenser 3 × AA');
    expect(binLabel(disp({ item: 'aa' }, { unitsX: 4 }), half)).toBe('2×1×8u dispenser AA');
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 6, gridY: 3 },
      bins: [
        { id: 'm', x: 0, y: 0, opts: disp({ item: 'aa' }) },
        { id: 'c', x: 3, y: 0, opts: disp({ style: 'channel' }) },
      ],
    });
    expect(Object.keys(job.parts).filter((k) => !k.startsWith('piece:')).sort()).toEqual(['bin:c', 'bin:m']);
  });
});
