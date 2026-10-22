import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import {
  DEFAULT_SKADIS,
  SKADIS,
  boardSlots,
  buildSkadisTile,
  headDiameter,
  ledChannel,
  patternSlot,
  planSkadis,
  plannedSkadis,
  rimWidth,
  sanitizeSkadis,
  skadisTileSpecs,
  tileBounds,
  type SkadisOptions,
  type SkadisPlan,
} from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { registerFont } from '../src/lib/geometry/text';
import { billOfMaterials } from '../src/lib/bom';
import type { PlacedAttachment } from '../src/lib/wall';
import { slotKeys, snapAnchor } from '../src/lib/wall/plan';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const BED = [{ w: 236, d: 236 }];
const BIG = [{ w: 2000, d: 2000 }];
const opts = (o: Partial<SkadisOptions> = {}) => sanitizeSkadis({ ...DEFAULT_SKADIS, ...o });
const toManifold = (mesh: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

/** Volume of the mesh inside a box (its own coordinates). */
function filled(mesh: MeshData, min: Vec3, max: Vec3): number {
  const m = toManifold(mesh);
  const box = w.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min);
  const both = m.intersect(box);
  const v = both.volume();
  for (const x of [m, box, both]) x.delete();
  return v;
}

const errors = (m: MeshData) => checkPart(w, m).issues.filter((i) => i.severity === 'error');

/** Distance from a point to a slot's edge (negative inside). */
function toSlot(x: number, y: number, s: [number, number], o: SkadisOptions): number {
  const a = (o.slotL - o.slotW) / 2;
  return Math.hypot(x - s[0], Math.max(0, Math.abs(y - s[1]) - a)) - o.slotW / 2;
}

/** The board's slots by lattice index (i, j). */
function indices(plan: SkadisPlan, slots: [number, number][]) {
  const L = plan.lattice!;
  return slots.map(([x, y]) => [(x - L.ox) / L.p, (y - L.oy) / L.p]);
}

const board = (skadis: Partial<SkadisOptions>, attachments: PlacedAttachment[] = []): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, ...skadis }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
const att = (id: string, type: string, x: number, y: number, o: object = {}): PlacedAttachment => ({ id, type, x, y, opts: { ...o } });

/** Every mesh of the job built once. */
function meshesOf(job: PrintJob) {
  const cache = new Map<string, MeshData>();
  return (k: string) => {
    if (!cache.has(k)) cache.set(k, buildMesh(w, job.meshes[k]));
    return cache.get(k)!;
  };
}

/** The drawer view's solids, each where it is shown (tiles turned face up, parts as they go on the board): as the 3D view does, by its planned box. */
function sceneSolids(job: PrintJob, mesh: (k: string) => MeshData, roles?: string[]) {
  const enc = job.drawers[0].enclosure!;
  const place = (m: MeshData, at: number[], size: Vec3, turn?: number[]) => {
    const a = toManifold(m);
    const r = turn ? a.rotate(turn as Vec3) : a.translate([0, 0, 0]);
    const box = w.Manifold.cube(size);
    const rb = turn ? box.rotate(turn as Vec3) : box.translate([0, 0, 0]);
    const b = rb.boundingBox();
    const out = r.translate([at[0] - b.min[0], at[1] - b.min[1], at[2] - b.min[2]]);
    for (const x of [a, r, box, rb]) x.delete();
    return out;
  };
  const tiles = job.plan.pieces.map((p) => {
    const part = job.parts[`piece:${p.id}`];
    return place(mesh(part.meshKey), enc.pieceAt[p.id], [part.w, part.d, part.h], enc.pieceTurn);
  });
  const items = enc.items
    .filter((i) => !roles || roles.includes(i.role))
    .map((i) => ({ item: i, m: place(mesh(i.meshKey), [i.x, i.y, i.z], [i.w, i.d, i.h], i.turn) }));
  return { tiles, items };
}

// ---------------------------------------------------------------------------
// Slot patterns
// ---------------------------------------------------------------------------

describe('slot patterns', () => {
  it('square: a slot where i and j are both even, a square grid two steps apart with slots at every edge', () => {
    for (const pitch of [20, 14]) {
      const o = opts({ pattern: 'square', pitch, width: 400, height: 300 });
      const p = planSkadis(o, BIG);
      const L = p.lattice!;
      expect(p.tiles).toHaveLength(1);
      // Odd counts: slot columns and rows at both ends.
      expect(L.nx % 2).toBe(1);
      expect(L.ny % 2).toBe(1);
      const slots = boardSlots(p, o);
      expect(slots.length).toBe(((L.nx + 1) / 2) * ((L.ny + 1) / 2));
      expect(p.slots).toBe(slots.length);
      for (const [i, j] of indices(p, slots)) {
        expect(i % 2).toBeCloseTo(0, 6);
        expect(j % 2).toBeCloseTo(0, 6);
      }
      // openGrid-like 28 mm squares on a 14 mm step.
      const xs = [...new Set(slots.map((s) => s[0]))].sort((a, b) => a - b);
      for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeCloseTo(2 * pitch, 6);
      expect(xs[0] - o.slotW / 2).toBeGreaterThanOrEqual(o.border - 1e-6);
      expect(o.width - xs[xs.length - 1] - o.slotW / 2).toBeGreaterThanOrEqual(o.border - 1e-6);
    }
  });

  it('dense: a slot at every step, the step 4 mm longer than a slot at least', () => {
    const o = opts({ pattern: 'dense', width: 400, height: 300 });
    const p = planSkadis(o, BIG);
    const L = p.lattice!;
    expect(boardSlots(p, o)).toHaveLength(L.nx * L.ny);
    const short = planSkadis(opts({ pattern: 'dense', pitch: 15 }), BIG);
    expect(short.lattice!.p).toBeCloseTo(DEFAULT_SKADIS.slotL + 4, 6);
    expect(short.warnings.join()).toMatch(/Dense slots need a step of 19.3 mm/);
    expect(plannedSkadis(opts({ pattern: 'skadis', pitch: 15 })).pitch).toBe(15);
  });

  it('the standard pattern at another step: columns a step apart, two steps in a column', () => {
    const o = opts({ pitch: 25, width: 400, height: 300 });
    const p = planSkadis(o, BIG);
    for (const [i, j] of indices(p, boardSlots(p, o))) expect(Math.abs((i + j) % 2)).toBeCloseTo(0, 6);
    expect(patternSlot('skadis', -1, 1)).toBe(true);
    expect(patternSlot('square', -2, 4)).toBe(true);
    expect(patternSlot('square', 2, 1)).toBe(false);
  });

  for (const [pattern, pitch] of [
    ['skadis', 20],
    ['skadis', 25],
    ['square', 20],
    ['square', 14],
    ['dense', 20],
    ['dense', 24],
  ] as const) {
    it(`${pattern} at ${pitch} mm: tiles fit the bed, seams cut no slot (the standard pattern's level ones only through a row), joints and mounts clear the slots`, () => {
      const o = opts({ pattern, pitch, width: 900, height: 700 });
      const p = planSkadis(o, BED);
      expect(p.error).toBeUndefined();
      expect(p.warnings).toEqual([]);
      expect(p.tiles.length).toBeGreaterThan(4);
      for (const sp of skadisTileSpecs(p, o)) {
        const b = tileBounds(sp);
        expect(Math.max(b.w, b.d)).toBeLessThanOrEqual(236 + 1e-6);
      }
      const slots = boardSlots(p, o);
      for (const x of p.seamsX) for (const s of slots) expect(Math.abs(s[0] - x) - o.slotW / 2, `upright seam ${x}`).toBeGreaterThan(pitch / 2);
      for (const y of p.seamsY) {
        for (const s of slots) {
          const d = Math.abs(s[1] - y);
          if (pattern === 'skadis') expect(d < 1e-6 || d - o.slotL / 2 > 2).toBe(true);
          else expect(d - o.slotL / 2, `level seam ${y}`).toBeGreaterThan(2);
        }
      }
      // Every stretch of seam is joined.
      expect(p.joints.filter((j) => j.seam === 'x').length).toBeGreaterThanOrEqual(p.rows * p.seamsX.length);
      expect(p.joints.filter((j) => j.seam === 'y').length).toBeGreaterThanOrEqual(p.cols * p.seamsY.length);
      for (const j of p.joints) {
        const half = j.kind === 'plate' ? SKADIS.plate.size / 2 + SKADIS.plate.gap : SKADIS.tab.head / 2;
        for (const s of slots) {
          const dx = Math.max(0, Math.abs(s[0] - j.x) - half - o.slotW / 2);
          const dy = Math.max(0, Math.abs(s[1] - j.y) - half - o.slotL / 2);
          expect(Math.hypot(dx, dy), `${j.kind} at ${j.x}, ${j.y}`).toBeGreaterThan(1);
        }
      }
      for (const m of p.mounts) expect(Math.min(...slots.map((s) => toSlot(m.x, m.y, s, o))), `mount at ${m.x}, ${m.y}`).toBeGreaterThan(SKADIS.post.r0 + 0.9);
      // Every tile is still screwed in its four quarters.
      for (const t of p.tiles) expect(p.mounts.filter((m) => m.tile === t.id).length).toBeGreaterThanOrEqual(4);
    });
  }

  it('a square tile builds clean, its slots through and its empty points solid', () => {
    const o = opts({ pattern: 'square', pitch: 14, width: 200, height: 150 });
    const p = planSkadis(o, BED);
    const [sp] = skadisTileSpecs(p, o);
    const m = buildSkadisTile(w, sp);
    expect(errors(m)).toEqual([]);
    const b = tileBounds(sp);
    const L = p.lattice!;
    // Face down: x mirrored.
    const at = (x: number, y: number): [number, number] => [b.w - x, y];
    const [sx, sy] = at(L.ox + 2 * L.p, L.oy + 2 * L.p);
    expect(filled(m, [sx - 1.5, sy - 5, -1], [sx + 1.5, sy + 5, o.thickness + 1])).toBe(0);
    const [ex, ey] = at(L.ox + 3 * L.p, L.oy + 2 * L.p);
    expect(filled(m, [ex - 1.5, ey - 1.5, 0.5], [ex + 1.5, ey + 1.5, o.thickness - 0.5])).toBeGreaterThan(0);
  });

  it('hexagons take the pattern and the step too', () => {
    const o = opts({ shape: 'hex', pattern: 'square', pitch: 14, width: 700, height: 500 });
    const p = planSkadis(o, BED);
    const [sp] = skadisTileSpecs(p, o);
    const cx = p.hex!.w / 2;
    const cy = p.hex!.h / 2;
    expect(sp.slots.length).toBeGreaterThan(10);
    for (const [x, y] of sp.slots) {
      expect(Math.abs(((x - cx) / 14) % 2)).toBeCloseTo(0, 6);
      expect(Math.abs(((y - cy) / 14) % 2)).toBeCloseTo(0, 6);
    }
    // Frames, zones and other hanging are for rectangles.
    const q = plannedSkadis(opts({ shape: 'hex', frame: 'led', hang: 'door', zones: [{ x: 0, y: 0, w: 99, h: 99, kind: 'blank', text: '' }] }));
    expect([q.frame, q.hang, q.zones]).toEqual(['none', 'screws', []]);
  });
});

// ---------------------------------------------------------------------------
// Attachments on the other patterns
// ---------------------------------------------------------------------------

describe('attachments on other patterns', () => {
  for (const [pattern, pitch] of [
    ['square', 20],
    ['dense', 20],
    ['skadis', 25],
    ['square', 14],
  ] as const) {
    it(`${pattern} at ${pitch} mm: a hook and a bin snap onto slots for every mount`, () => {
      const job = plan(board({ pattern, pitch, width: 400, height: 300 }, [att('a', 'bin', 100, 150), att('h', 'hook', 300, 200)]));
      expect(job.warnings).toEqual([]);
      const wall = job.drawers[0].enclosure!.wall!;
      expect(wall.board.ctx.pitch).toBe(pitch);
      const keys = slotKeys(wall.board.slots);
      expect(wall.placed).toHaveLength(2);
      for (const p of wall.placed) {
        expect(p.ok).toBe(true);
        for (const m of p.mounts) expect(keys.has(`${m.x},${m.y}`), `${p.type} mount ${m.x}, ${m.y}`).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

describe('zones', () => {
  it('a zone takes its slots, snapped to whole columns and rows, from the board and from attachments', () => {
    const base = opts({ width: 400, height: 300 });
    const o = opts({ width: 400, height: 300, zones: [{ x: 100, y: 100, w: 100, h: 80, kind: 'blank', text: '' }] });
    const p0 = planSkadis(base, BIG);
    const p = planSkadis(o, BIG);
    const [z] = p.zones;
    const L = p.lattice!;
    // Edges halfway between columns (rows).
    for (const [v, o0] of [
      [z.x0, L.ox],
      [z.x1, L.ox],
      [z.y0, L.oy],
      [z.y1, L.oy],
    ])
      expect((((v - o0) / L.p) % 1) - 0.5).toBeCloseTo(0, 6);
    expect(z.x1 - z.x0).toBeCloseTo(100, 6);
    const inside = (s: number[]) => s[0] > z.x0 && s[0] < z.x1 && s[1] > z.y0 && s[1] < z.y1;
    const all = boardSlots(p0, base);
    const left = boardSlots(p, o);
    expect(all.filter(inside).length).toBeGreaterThan(5);
    expect(left.filter(inside)).toEqual([]);
    expect(left.length).toBe(all.length - all.filter(inside).length);
    expect(p.slots).toBe(left.length);
    expect(skadisTileSpecs(p, o)[0].slots.length).toBe(left.length);
    // An attachment dropped in the zone snaps out of it.
    const keys = slotKeys(left);
    const layout = { mounts: [{ di: 0, dj: 0, kind: 'clip' as const }] };
    const at = snapAnchor(left, keys, layout, { pitch: L.p }, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2)!;
    expect(inside(at)).toBe(false);
  });

  it('text is engraved in the front, split between the tiles of a zone across a seam; magnets go in from the back', () => {
    const o = opts({
      width: 400,
      height: 300,
      zones: [
        { x: 120, y: 30, w: 160, h: 60, kind: 'text', text: 'PLIERS' },
        { x: 40, y: 200, w: 100, h: 40, kind: 'magnets', text: '' },
      ],
    });
    const p = planSkadis(o, BED);
    expect(p.seamsX.some((x) => x > p.zones[0].x0 && x < p.zones[0].x1)).toBe(true);
    const specs = skadisTileSpecs(p, o);
    const withText = specs.filter((s) => s.text?.length);
    expect(withText).toHaveLength(2);
    expect(withText.every((s) => s.text![0].text === 'PLIERS')).toBe(true);
    // Text and magnets keep the mounts off them.
    const r = (SKADIS.magnet.d + SKADIS.magnet.fit) / 2;
    for (const m of p.mounts) for (const z of p.zones) expect(m.x > z.x0 - 5 && m.x < z.x1 + 5 && m.y > z.y0 - 5 && m.y < z.y1 + 5).toBe(false);
    expect(p.magnets.length).toBeGreaterThan(10);
    for (const [x, y] of p.magnets) {
      for (const s of p.seamsX) expect(Math.abs(s - x)).toBeGreaterThan(r);
      for (const s of p.seamsY) expect(Math.abs(s - y)).toBeGreaterThan(r);
      for (const j of p.joints) expect(Math.max(Math.abs(j.x - x), Math.abs(j.y - y))).toBeGreaterThan(SKADIS.plate.size / 2 + r);
    }
    // Build the tile with the magnets and one with text: clean, the pockets open at the back and closed at the front.
    const mi = specs.findIndex((s) => s.magnets?.length);
    const ti = specs.findIndex((s) => s.text?.length);
    const mm = buildSkadisTile(w, specs[mi]);
    expect(errors(mm)).toEqual([]);
    const b = tileBounds(specs[mi]);
    const [mx, my] = specs[mi].magnets![0];
    const x = b.w - mx;
    expect(filled(mm, [x - 2, my - 2, SKADIS.magnet.skin + 0.1], [x + 2, my + 2, o.thickness + o.depth])).toBe(0);
    expect(filled(mm, [x - 2, my - 2, 0], [x + 2, my + 2, SKADIS.magnet.skin - 0.1])).toBeGreaterThan(0);
    const tm = buildSkadisTile(w, specs[ti]);
    expect(errors(tm)).toEqual([]);
    const plain = buildSkadisTile(w, { ...specs[ti], text: undefined });
    const vol = (m: MeshData) => {
      const s = toManifold(m);
      const v = s.volume();
      s.delete();
      return v;
    };
    expect(vol(plain) - vol(tm)).toBeGreaterThan(20);
    // The engraving is in the front (on the bed), no deeper than planned.
    const box = (m: MeshData, z0: number, z1: number) => filled(m, [0, 0, z0], [b.w + 50, b.d + 50, z1]);
    expect(box(plain, 0, SKADIS.text.depth) - box(tm, 0, SKADIS.text.depth)).toBeGreaterThan(20);
    expect(box(plain, SKADIS.text.depth + 0.05, o.thickness) - box(tm, SKADIS.text.depth + 0.05, o.thickness)).toBeLessThan(0.01);
  });

  it('magnets are in the bill of materials and the board’s numbers', () => {
    const job = plan(board({ width: 300, height: 200, zones: [{ x: 60, y: 60, w: 120, h: 40, kind: 'magnets', text: '' }] }));
    const info = job.drawers[0].enclosure!.info.skadis!;
    expect(info.magnets).toBeGreaterThan(5);
    const line = billOfMaterials(job).hardware.find((h) => /Magnets 6 × 2 mm/.test(h.item));
    expect(line?.count).toBe(info.magnets);
    expect(job.drawers[0].steps.join()).toMatch(/Glue \d+ magnets/);
  });

  it('cleans saved zones', () => {
    const o = sanitizeSkadis({ zones: [{ x: -5, y: 'a', w: 2, h: 1e9, kind: 'lava', text: 7 }, null, 'x'] });
    expect(o.zones).toEqual([{ x: 0, y: 0, w: 5, h: 5000, kind: 'blank', text: '' }]);
    expect(sanitizeSkadis({ zones: 'no' }).zones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

describe('frame', () => {
  it('rim strips go round the front border, cut to the bed away from the seams, their pins in holes in the tiles', () => {
    const o = opts({ width: 600, height: 400, frame: 'rim' });
    const p = planSkadis(o, BED);
    const rw = rimWidth(o);
    expect(rw).toBeCloseTo(o.border - o.chamfer - 0.4, 6);
    const along = (pred: (s: (typeof p.rim)[number]) => boolean, len: (s: (typeof p.rim)[number]) => number) =>
      p.rim.filter(pred).reduce((a, s) => a + len(s), 0);
    expect(
      along(
        (s) => s.y0 === 0,
        (s) => s.x1 - s.x0,
      ),
    ).toBeCloseTo(o.width, 3);
    expect(
      along(
        (s) => s.y1 === o.height,
        (s) => s.x1 - s.x0,
      ),
    ).toBeCloseTo(o.width, 3);
    expect(
      along(
        (s) => s.x0 === 0 && s.x1 === rw,
        (s) => s.y1 - s.y0,
      ),
    ).toBeCloseTo(o.height - 2 * rw, 3);
    for (const s of p.rim) {
      expect(Math.max(s.x1 - s.x0, s.y1 - s.y0)).toBeLessThanOrEqual(236);
      expect(s.pins.length).toBeGreaterThanOrEqual(2);
      // Cut clear of the seams, so the strips bridge them.
      for (const x of p.seamsX) if (s.y0 === 0) expect(Math.abs(s.x0 - x) > 20 && Math.abs(s.x1 - x) > 20).toBe(true);
    }
    const specs = skadisTileSpecs(p, o);
    const holes = specs.flatMap((sp, i) => (sp.pins?.at ?? []).map(([x, y]) => `${(p.tiles[i].x0 + x).toFixed(2)},${(p.tiles[i].y0 + y).toFixed(2)}`));
    const pins = p.rim.flatMap((s) => s.pins.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`));
    expect(holes.sort()).toEqual(pins.sort());
    // The screw heads keep off the rim.
    const head = headDiameter(o.screw) / 2;
    for (const m of p.mounts) expect(Math.min(m.x, m.y, o.width - m.x, o.height - m.y)).toBeGreaterThan(rw + head);
  });

  it('frame strips print clean, and sit on the board with their pins in the holes', () => {
    const job = plan(board({ width: 220, height: 160, frame: 'rim', corner: 12 }));
    expect(job.warnings).toEqual([]);
    const mesh = meshesOf(job);
    const strips = Object.values(job.parts).filter((q) => q.enclosure === 'skadisRim');
    expect(strips).toHaveLength(4);
    expect(job.plates.map((pl) => pl.name)).toContain('Board parts');
    for (const s of strips) {
      const m = mesh(s.meshKey);
      expect(errors(m), s.name).toEqual([]);
      // Its box as planned (a corner strip's end follows the board's rounded corner inside it).
      const b = meshBounds(m);
      expect(b.min.every((v) => v > -1e-3)).toBe(true);
      expect(b.max[0]).toBeLessThan(s.w + 0.01);
      expect(b.max[1]).toBeLessThan(s.d + 0.01);
      expect(b.max[0] + b.max[1]).toBeGreaterThan(s.w + s.d - 1);
      expect(b.max[2]).toBeCloseTo(s.h, 2);
    }
    const { tiles, items } = sceneSolids(job, mesh, ['strip']);
    expect(items).toHaveLength(4);
    const front = job.drawers[0].enclosure!.wall!.board.front;
    for (const { item, m } of items) {
      for (const t of tiles) {
        const both = m.intersect(t);
        expect(both.volume(), item.id).toBeLessThan(0.02);
        both.delete();
      }
      // On the front, its pins in the board.
      const bb = m.boundingBox();
      expect(bb.max[2]).toBeCloseTo(front + DEFAULT_SKADIS.rimHeight, 3);
      expect(bb.min[2]).toBeLessThan(front - 1);
      m.delete();
    }
    for (const t of tiles) t.delete();
    // Attachments keep off it.
    const near = plan(board({ width: 220, height: 160, frame: 'rim' }, [att('h', 'bin', 20, 20)]));
    expect(near.warnings.join()).toMatch(/stands on the frame/);
  });

  it('LED: a channel round the back of the outer edges, the border wide enough for it, a strip in the BOM', () => {
    const o = opts({ width: 600, height: 400, frame: 'led', ledWidth: 12 });
    const q = plannedSkadis(o);
    expect(q.border).toBeGreaterThanOrEqual(ledChannel(o) + o.chamfer + 1 - 1e-9);
    const p = planSkadis(o, BED);
    const specs = skadisTileSpecs(p, o);
    specs.forEach((sp, i) => {
      const t = p.tiles[i];
      expect(sp.led?.sides).toEqual([t.outer.left, t.outer.right, t.outer.bottom, t.outer.top]);
      expect(sp.led?.w).toBeCloseTo(12.4, 6);
    });
    // Joints and posts keep off it.
    const c = ledChannel(o);
    for (const j of p.joints) expect(Math.min(j.x, j.y, o.width - j.x, o.height - j.y)).toBeGreaterThan(c + SKADIS.plate.size / 2);
    for (const m of p.mounts) expect(Math.min(m.x, m.y, o.width - m.x, o.height - m.y)).toBeGreaterThan(c + SKADIS.post.r0);
    // The bottom-left tile: the channel is open at the back, plastic in front of it.
    const i = p.tiles.findIndex((t) => t.outer.left && t.outer.bottom);
    const m = buildSkadisTile(w, specs[i]);
    expect(errors(m)).toEqual([]);
    const b = tileBounds(specs[i]);
    const T = o.thickness;
    const d = SKADIS.rim.led;
    // Along the bottom edge, mid-way along (x mirrored as printed).
    const x = b.w - 100;
    expect(filled(m, [x - 3, 1, T - d + 0.1], [x + 3, c - 1, T + 0.1])).toBe(0);
    expect(filled(m, [x - 3, 1, 0.1], [x + 3, c - 1, T - d - 0.1])).toBeGreaterThan(0);
    // Deeper in the corner, for the wire joints.
    expect(filled(m, [b.w - c + 1, 1, T - d - 1.4], [b.w - 1, c - 1, T])).toBe(0);
    const job = plan(board({ width: 600, height: 400, frame: 'led', ledWidth: 12 }));
    const led = billOfMaterials(job).hardware.find((h) => /LED strip 12 mm/.test(h.item));
    expect(led?.count).toBe(1);
    expect(led?.note).toMatch(/2 m round the back edge/);
  });
});

// ---------------------------------------------------------------------------
// Hanging
// ---------------------------------------------------------------------------

describe('hanging', () => {
  const kinds = {
    cleat: { hang: 'cleat', names: ['Board cleat 1', 'Wall cleat 1'], item: /Countersunk screws ⌀4 \(French cleat\)/ },
    door: { hang: 'door', names: ['Door hook 1', 'Door hook 2'], item: /to its door hooks/ },
    stand: { hang: 'desk', names: ['Desk foot 1', 'Desk foot 2'], item: /to its desk feet/ },
    clamp: { hang: 'desk', deskMount: 'clamp', names: ['Desk clamp 1', 'Desk clamp 2'], item: /M6 × 30 mm bolts/ },
  } as const;
  for (const [name, k] of Object.entries(kinds)) {
    it(`${name}: printed parts that build clean and as big as planned, holes in the board for their screws, what it takes in the BOM`, () => {
      const sk = { width: 220, height: 160, hang: k.hang, ...('deskMount' in k ? { deskMount: k.deskMount } : {}) } as Partial<SkadisOptions>;
      const job = plan(board(sk));
      expect(job.warnings).toEqual([]);
      const mesh = meshesOf(job);
      const parts = Object.values(job.parts).filter((q) => q.enclosure === 'skadisHang');
      for (const n of k.names) expect(parts.map((q) => q.name)).toContain(n);
      // With the joint plates, on plates of their own.
      expect(job.plates.map((pl) => pl.name)).toContain('Board parts');
      for (const q of parts) {
        const m = mesh(q.meshKey);
        expect(errors(m), q.name).toEqual([]);
        const b = meshBounds(m);
        expect(b.max[0] - b.min[0], q.name).toBeCloseTo(q.w, 2);
        expect(b.max[1] - b.min[1], q.name).toBeCloseTo(q.d, 2);
        expect(b.max[2] - b.min[2], q.name).toBeCloseTo(q.h, 2);
      }
      const bom = billOfMaterials(job).hardware;
      expect(
        bom.some((h) => k.item.test(h.item)),
        JSON.stringify(bom),
      ).toBe(true);
      // No screws into the wall through the board.
      expect(bom.filter((h) => /or longer \(Skådis board\)/.test(h.item))).toEqual([]);
      expect(job.drawers[0].map).toMatch(/Hangs from:/);
      // The tile: countersunk holes without posts for the screws into the parts.
      const o = plannedSkadis(opts(sk));
      const p = planSkadis(o, BED);
      const hang = p.mounts.filter((m) => m.hang);
      expect(hang.length).toBeGreaterThanOrEqual(2);
      expect(p.mounts.filter((m) => !m.hang).every((m) => !m.screw)).toBe(true);
      const tile = mesh(job.parts['piece:1'].meshKey);
      expect(errors(tile)).toEqual([]);
      const sp = skadisTileSpecs(p, o)[0];
      const tb = tileBounds(sp);
      for (const m of sp.mounts.filter((q) => q.hang)) {
        const x = tb.w - m.x;
        expect(filled(tile, [x - 1.5, m.y - 1.5, -1], [x + 1.5, m.y + 1.5, o.thickness + 1]), 'hole').toBe(0);
        expect(filled(tile, [x - 6, m.y - 6, o.thickness + 0.5], [x + 6, m.y + 6, tb.h + 1]), 'no post').toBe(0);
      }
      // Each part's pilot holes line up with the board's.
      const at = new Set(hang.map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)}`));
      for (const h of p.hang) for (const hole of h.holes.filter((q) => !q.sink)) expect(at.has(`${(h.x + hole.x).toFixed(2)},${hole.y.toFixed(2)}`)).toBe(true);
    });
  }

  it('the parts sit behind (or under) the board in the drawer view without running into it', () => {
    for (const sk of [{ hang: 'cleat' }, { hang: 'door' }, { hang: 'desk', deskMount: 'clamp', frame: 'rim' }] as Partial<SkadisOptions>[]) {
      const job = plan(board({ width: 220, height: 160, ...sk }));
      const { tiles, items } = sceneSolids(job, meshesOf(job), ['cleat', 'foot', 'strip']);
      expect(items.length).toBeGreaterThan(1);
      for (const { item, m } of items) {
        for (const t of tiles) {
          const both = m.intersect(t);
          expect(both.volume(), `${sk.hang} ${item.id}`).toBeLessThan(0.05);
          both.delete();
        }
      }
      for (let a = 0; a < items.length; a++)
        for (let b = a + 1; b < items.length; b++) {
          const both = items[a].m.intersect(items[b].m);
          expect(both.volume(), `${items[a].item.id} ${items[b].item.id}`).toBeLessThan(0.05);
          both.delete();
        }
      for (const x of [...tiles, ...items.map((i) => i.m)]) x.delete();
    }
  });

  it('a French cleat: the board’s strip on the wall’s, their 45° edges together, as thick as the gap', () => {
    const o = plannedSkadis(opts({ width: 500, height: 300, hang: 'cleat', depth: 8 }));
    expect(o.depth).toBe(12);
    const p = planSkadis(o, BED);
    const boardCleats = p.hang.filter((h) => h.kind === 'boardCleat');
    const wallCleats = p.hang.filter((h) => h.kind === 'wallCleat');
    expect(boardCleats.length).toBe(wallCleats.length);
    expect(boardCleats.length).toBeGreaterThan(1);
    expect(boardCleats.reduce((a, h) => a + h.len, 0)).toBeCloseTo(o.width - 20, 3);
    const [bc, wc] = [boardCleats[0], wallCleats[0]];
    // Same strip, one profile over the other: together a rectangle as thick as the gap.
    const area = (pts: [number, number][]) =>
      Math.abs(pts.reduce((a, q, i) => a + q[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * q[1], 0)) / 2;
    const ys = [...bc.profile, ...wc.profile].map((q) => q[1]);
    expect(area(bc.profile as [number, number][]) + area(wc.profile as [number, number][])).toBeCloseTo(o.depth * (Math.max(...ys) - Math.min(...ys)), 3);
    expect(Math.max(...[...bc.profile, ...wc.profile].map((q) => q[0]))).toBe(o.depth);
    // The board's on top, its edge down and toward the wall; it stays under the board's top.
    const bottom = (h: typeof bc) => h.profile.filter((q) => q[0] === 0).map((q) => q[1]);
    expect(Math.min(...bottom(bc))).toBeLessThan(Math.max(...bottom(wc)) + 1e-6);
    expect(Math.max(...bc.profile.map((q) => q[1]))).toBeLessThanOrEqual(o.height - 2);
    // Rests below it, none in its way.
    const top = Math.min(...wc.profile.map((q) => q[1]));
    expect(p.mounts.filter((m) => !m.hang).every((m) => m.y + SKADIS.post.r0 < top)).toBe(true);
  });

  it('door hooks go over the door, the board just under its top; desk feet hold its bottom edge', () => {
    const o = plannedSkadis(opts({ width: 800, height: 400, hang: 'door', doorThickness: 44 }));
    const p = planSkadis(o, BED);
    const hooks = p.hang.filter((h) => h.kind === 'hook');
    expect(hooks).toHaveLength(3);
    for (const h of hooks) {
      const zs = h.profile.map((q) => q[0]);
      // Round a 44 mm door, with 1 mm to spare, 3 mm behind it.
      expect(Math.min(...zs)).toBeCloseTo(-48, 6);
      expect(Math.max(...zs)).toBe(o.depth);
      expect(Math.max(...h.profile.map((q) => q[1])) - o.height).toBeCloseTo(4.5, 6);
    }
    const desk = planSkadis(plannedSkadis(opts({ width: 400, height: 300, hang: 'desk' })), BED);
    for (const f of desk.hang) {
      // The board's bottom edge (y = 0) sits in its groove, behind the front lip.
      expect(f.profile.some((q) => q[1] === 0)).toBe(true);
      expect(Math.min(...f.profile.map((q) => q[1]))).toBeLessThan(0);
      for (const hole of f.holes) expect(hole.y).toBeLessThan(120);
    }
    expect(desk.mounts.every((m) => m.hang)).toBe(true);
  });

  it('cleans the new options', () => {
    const o = sanitizeSkadis({
      pattern: 'hex',
      pitch: 99,
      frame: 'neon',
      rimHeight: 0,
      ledWidth: 9,
      hang: 'nail',
      doorThickness: 1,
      deskMount: 'glue',
      deskThickness: 500,
    });
    expect([o.pattern, o.pitch, o.frame, o.rimHeight, o.ledWidth, o.hang, o.doorThickness, o.deskMount, o.deskThickness]).toEqual([
      'skadis',
      40,
      'none',
      2,
      10,
      'screws',
      20,
      'stand',
      80,
    ]);
    expect(sanitizeSkadis({ pitch: 14.26 }).pitch).toBe(14.3);
  });
});
