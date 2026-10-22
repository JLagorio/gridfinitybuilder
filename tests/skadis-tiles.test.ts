import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Vec2, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import {
  DEFAULT_SKADIS,
  NEW_SKADIS,
  boardSlots,
  cellsFull,
  patternSlot,
  planSkadis,
  plannedSkadis,
  sanitizeSkadis,
  skadisTileSpecs,
  type SkadisCell,
  type SkadisOptions,
  type SkadisPlan,
} from '../src/lib/geometry/skadis';
import { skadisAreas } from '../src/lib/enclosures';
import { hexCell, hexCells } from '../src/lib/geometry/skadisTiles';
import { checkPart } from '../src/lib/geometry/printcheck';
import type { PlacedAttachment } from '../src/lib/wall';
import { attachmentLayout, fitsAt, slotKeys } from '../src/lib/wall/plan';
import { decodeProject, encodeProject } from '../src/lib/share';
import { history, projectFile, useStore } from '../src/state/store';
import { addTile, removeTile, setTiles } from '../src/state/skadisTiles';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

/** The default printer's bed, as a board's tiles print on it (236 mm square). */
const AREAS = skadisAreas(DEFAULT_SETUP);
const tiles = (o: Partial<SkadisOptions> = {}) => sanitizeSkadis({ ...NEW_SKADIS, ...o });
const board = (skadis: Partial<SkadisOptions>, attachments: PlacedAttachment[] = []): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...NEW_SKADIS, ...skadis }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer): PrintJob => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
const att = (id: string, type: string, x: number, y: number, opts: object = {}): PlacedAttachment => ({ id, type, x, y, opts: { ...opts } });
const errors = (m: ReturnType<typeof buildMesh>) => checkPart(w, m).issues.filter((i) => i.severity === 'error');

/** Whether a point is inside a convex polygon (CCW). */
function inside(poly: Vec2[], [x, y]: Vec2): boolean {
  return poly.every((p, k) => {
    const q = poly[(k + 1) % poly.length];
    return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) >= -1e-6;
  });
}

/** Lattice index of a point on a board built from tiles (tile (0, 0)'s place is a lattice point). */
const index = (plan: SkadisPlan, o: SkadisOptions, [x, y]: Vec2): Vec2 => [(x - plan.grid!.origin[0]) / o.pitch, (y - plan.grid!.origin[1]) / o.pitch];

/** A slot where a part of `type` fits with its mounts on two tiles or more, and which tiles they're on. */
function across(job: PrintJob, type: string, opts: Record<string, unknown> = {}): { at: Vec2; tiles: number } | null {
  const board = job.drawers[0].enclosure!.wall!.board;
  const l = attachmentLayout({ type, opts }, board.ctx)!;
  const keys = slotKeys(board.slots);
  for (const s of board.slots) {
    if (!fitsAt(keys, l.layout, board.ctx, s[0], s[1])) continue;
    const on = new Set(l.layout.mounts.map((m) => board.outlines.findIndex((o) => inside(o, [s[0] + m.di * board.ctx.pitch, s[1] + m.dj * board.ctx.pitch]))));
    if (on.size > 1) return { at: s, tiles: on.size };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe('options', () => {
  it('a new board is built from one tile; a saved one without a layout fills its space as before', () => {
    expect(NEW_SKADIS.layout).toBe('tiles');
    expect(NEW_SKADIS.tiles).toEqual([[0, 0]]);
    expect(sanitizeSkadis(undefined).layout).toBeUndefined();
    expect(sanitizeSkadis({ layout: 'space' }).layout).toBeUndefined();
    expect(sanitizeSkadis({ layout: 'tiles' }).layout).toBe('tiles');
    const p = planSkadis(sanitizeSkadis({ ...DEFAULT_SKADIS }), AREAS);
    expect(p.grid).toBeUndefined();
    expect([p.W, p.H]).toEqual([560, 560]);
  });

  it('cleans tiles and sizes', () => {
    const o = sanitizeSkadis({
      layout: 'tiles',
      tiles: [[0, 0], [1.4, -2], [0, 0], 'x', [1], [NaN, 2], [99, 3], null],
      tileSize: 30,
      tileHeight: 5000,
    });
    expect(o.tiles).toEqual([
      [0, 0],
      [1, -2],
      [60, 3],
    ]);
    expect([o.tileSize, o.tileHeight]).toEqual([0, 1000]);
    expect(sanitizeSkadis({ tiles: [] }).tiles).toEqual([[0, 0]]);
    expect(sanitizeSkadis({ tiles: 'lots' }).tiles).toEqual([[0, 0]]);
  });

  it('frames and other hanging only for tiles that make a whole rectangle', () => {
    expect(
      cellsFull([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
    ).toBe(true);
    expect(
      cellsFull([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBe(false);
    const l = plannedSkadis(
      tiles({
        tiles: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        frame: 'rim',
        hang: 'cleat',
      }),
    );
    expect([l.frame, l.hang]).toEqual(['none', 'screws']);
    const r = plannedSkadis(
      tiles({
        tiles: [
          [0, 0],
          [1, 0],
        ],
        frame: 'rim',
        hang: 'cleat',
      }),
    );
    expect([r.frame, r.hang]).toEqual(['rim', 'cleat']);
    expect(planSkadis(r, AREAS).rim.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rectangle tiles
// ---------------------------------------------------------------------------

describe('rectangle tiles', () => {
  it('are the largest the bed takes, in whole steps, tabs and all', () => {
    const p = planSkadis(tiles(), AREAS);
    expect(p.error).toBeUndefined();
    // 236 mm of bed, 8.15 mm of it for the tabs: 11 steps.
    expect([p.W, p.H]).toEqual([220, 220]);
    expect(p.tiles).toHaveLength(1);
    expect(p.grid!.at).toEqual([[0, 0]]);
    // Without tabs, a step more fits.
    expect(planSkadis(tiles({ join: 'plates' }), AREAS).W).toBe(220);
    expect(planSkadis(tiles({ join: 'none' }), [{ w: 245, d: 245 }]).W).toBe(240);
    // On a square grid, an even number of steps (its seams run between the slots).
    expect(planSkadis(tiles({ pattern: 'square' }), AREAS).W).toBe(200);
  });

  it('or the size picked, an error when the bed is too small for it', () => {
    const p = planSkadis(
      tiles({
        tileSize: 160,
        tiles: [
          [0, 0],
          [1, 0],
        ],
      }),
      AREAS,
    );
    expect([p.W, p.H]).toEqual([320, 160]);
    const q = planSkadis(tiles({ tileSize: 120, tileHeight: 200 }), AREAS);
    expect([q.W, q.H]).toEqual([120, 200]);
    expect(planSkadis(tiles({ tileSize: 400 }), AREAS).error).toMatch(/bigger than the bed/);
  });

  it('plan the pieces where the tiles are, joined only where two meet', () => {
    const o = tiles({
      tiles: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    const p = planSkadis(o, AREAS);
    expect([p.W, p.H]).toEqual([440, 440]);
    expect(p.tiles.map((t) => [t.x0, t.y0, t.x1, t.y1])).toEqual([
      [0, 0, 220, 220],
      [220, 0, 440, 220],
      [220, 220, 440, 440],
    ]);
    expect(p.tiles.map((t) => t.outer)).toEqual([
      { left: true, right: false, bottom: true, top: true },
      { left: false, right: true, bottom: true, top: false },
      { left: true, right: true, bottom: false, top: true },
    ]);
    // Along the upright seam below 220 and the level one right of 220; no plate where three tiles meet.
    expect(p.joints.length).toBeGreaterThan(2);
    for (const j of p.joints) {
      expect(j.seam).not.toBe('xy');
      if (j.seam === 'x') expect(j.x === 220 && j.y < 220).toBe(true);
      else expect(j.y === 220 && j.x > 220).toBe(true);
    }
    // Every tile screwed up.
    for (const t of p.tiles) expect(p.mounts.filter((m) => m.tile === t.id && m.screw).length).toBeGreaterThanOrEqual(2);
    // In the print job: three numbered tiles.
    const job = plan(
      board({
        tiles: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
    );
    expect(job.plan.pieces).toHaveLength(3);
    expect(job.warnings).toEqual([]);
  });

  it('only have whole slots inside the border, on one lattice; the slots a seam cuts only where two tiles meet', () => {
    const o = tiles({
      tiles: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    const p = planSkadis(o, AREAS);
    const slots = boardSlots(p, o);
    expect(slots.length).toBe(p.slots);
    const box = (t: SkadisPlan['tiles'][number], [x, y]: Vec2, m: number) =>
      x - o.slotW / 2 - m >= t.x0 - 1e-6 && x + o.slotW / 2 + m <= t.x1 + 1e-6 && y - o.slotL / 2 - m >= t.y0 - 1e-6 && y + o.slotL / 2 + m <= t.y1 + 1e-6;
    for (const s of slots) {
      const [i, j] = index(p, o, s);
      expect(Number.isInteger(Math.round(i * 1e6) / 1e6) && Number.isInteger(Math.round(j * 1e6) / 1e6)).toBe(true);
      expect(patternSlot(o.pattern, Math.round(i), Math.round(j))).toBe(true);
      // On one tile, the border clear all round; or through the level seam between two.
      const on = p.tiles.filter((t) => box(t, s, o.border));
      if (!on.length) {
        expect(s[1]).toBe(220);
        expect(s[0]).toBeGreaterThan(220);
      }
    }
    // No slot on the seam column, nor on the edges.
    expect(slots.some(([x]) => x === 220 || x === 0 || x === 440)).toBe(false);
    expect(slots.some(([, y]) => y === 0 || y === 440)).toBe(false);
    // Each tile's cut slots are whole once together: tile 2's top row and tile 3's bottom one meet.
    const specs = skadisTileSpecs(p, o);
    const top2 = specs[1].slots.filter((s) => s[1] === 220).map((s) => s[0]);
    const bottom3 = specs[2].slots.filter((s) => s[1] === 0).map((s) => s[0]);
    expect(top2.length).toBeGreaterThan(0);
    expect(top2).toEqual(bottom3);
  });

  it('build clean, every shape of tile', () => {
    const o = tiles({
      tiles: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      tileSize: 120,
    });
    const job = plan(board(o));
    const keys = new Set(job.plan.pieces.map((p) => job.parts[`piece:${p.id}`].meshKey));
    expect(keys.size).toBe(3);
    for (const k of keys) expect(errors(buildMesh(w, job.meshes[k]))).toEqual([]);
  });

  it('take a wide attachment across a seam', () => {
    const job = plan(
      board({
        tiles: [
          [0, 0],
          [1, 0],
        ],
      }),
    );
    const spot = across(job, 'toolRack');
    expect(spot).not.toBeNull();
    const placed = plan(
      board(
        {
          tiles: [
            [0, 0],
            [1, 0],
          ],
        },
        [att('r', 'toolRack', ...spot!.at)],
      ),
    );
    expect(placed.drawers[0].enclosure!.wall!.placed[0].ok).toBe(true);
    expect(placed.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hexagon tiles
// ---------------------------------------------------------------------------

describe('hexagon tiles', () => {
  const hex = (o: Partial<SkadisOptions> = {}) => tiles({ shape: 'hex', ...o });
  const three: SkadisCell[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];

  it('are on one lattice: a + b even on the standard pattern, a and b even on a square grid, nearly regular', () => {
    for (const [pattern, pitch] of [
      ['skadis', 20],
      ['skadis', 14],
      ['square', 14],
      ['square', 20],
      ['dense', 20],
    ] as const) {
      const o = plannedSkadis(hex({ pattern, pitch }));
      const cells = hexCells(o, AREAS);
      expect(cells.length).toBeGreaterThan(2);
      for (const c of cells) {
        if (pattern === 'skadis') expect((c.a + c.b) % 2).toBe(0);
        if (pattern === 'square') expect([c.a % 2, c.b % 2]).toEqual([0, 0]);
        expect(c.off).toBeLessThanOrEqual(0.16);
        // Across the flats: its neighbour's 2a steps over, less the gap.
        expect(c.w).toBeCloseTo(2 * c.a * o.pitch - o.hexGap, 6);
      }
      const c = hexCell(o, AREAS);
      expect(c.fits).toBe(true);
    }
    // On the default printer: 5 steps across and 9 up to the next row, within 4% of regular, as tall as the bed nearly.
    const c = hexCell(hex(), AREAS);
    expect([c.a, c.b]).toEqual([5, 9]);
    expect(c.off).toBeLessThan(0.04);
    expect(c.h).toBeGreaterThan(230);
    expect(c.w).toBeCloseTo(197, 6);
  });

  it('a size picked: the nearest that keeps the lattice', () => {
    expect(hexCell(hex({ tileSize: 140 }), AREAS)).toMatchObject({ a: 3, b: 5 });
    expect(planSkadis(hex({ tileSize: 400 }), AREAS).error).toMatch(/bigger than the bed/);
  });

  it('plan where the tiles are, a gap between neighbours, slots of every hexagon on one lattice', () => {
    const o = hex({ tiles: three });
    const p = planSkadis(o, AREAS);
    const c = hexCell(o, AREAS);
    expect(p.error).toBeUndefined();
    expect(p.tiles).toHaveLength(3);
    const [a, b, up] = p.hex!.centres;
    // To the right: 2a steps across; up and to the right: a across, b up.
    expect([b[0] - a[0], b[1] - a[1]]).toEqual([2 * c.a * 20, 0]);
    expect([up[0] - a[0], up[1] - a[1]]).toEqual([c.a * 20, c.b * 20]);
    // The gap between the two side by side.
    expect(p.tiles[1].x0 - p.tiles[0].x1).toBeCloseTo(o.hexGap, 3);
    // The board's box round them.
    expect(p.W).toBeCloseTo(Math.max(...p.tiles.map((t) => t.x1)), 3);
    expect(Math.min(...p.tiles.map((t) => t.x0))).toBeLessThan(0.1);
    const slots = boardSlots(p, o);
    expect(slots.length).toBe(p.slots);
    expect(new Set(slots.map(String)).size).toBe(slots.length);
    for (const s of slots) {
      const [i, j] = index(p, o, s);
      expect(Math.abs(i - Math.round(i))).toBeLessThan(1e-9);
      expect(Math.abs(j - Math.round(j))).toBeLessThan(1e-9);
      expect(patternSlot(o.pattern, Math.round(i), Math.round(j))).toBe(true);
    }
    // Each hexagon has the same slots about its centre.
    const per = p.tiles.map((t, k) =>
      slots
        .filter(
          ([x, y]) =>
            x > t.x0 &&
            x < t.x1 &&
            y > t.y0 &&
            y < t.y1 &&
            inside(
              p.hex!.poly!.map(([u, v]) => [u + t.x0, v + t.y0] as Vec2),
              [x, y],
            ),
        )
        .map(([x, y]) => [Math.round((x - p.hex!.centres[k][0]) * 1000), Math.round((y - p.hex!.centres[k][1]) * 1000)].join())
        .sort(),
    );
    expect(per[1]).toEqual(per[0]);
    expect(per[2]).toEqual(per[0]);
  });

  it('on a square grid and a dense one too', () => {
    for (const pattern of ['square', 'dense'] as const) {
      const o = hex({ tiles: three, pattern, pitch: pattern === 'square' ? 14 : 20 });
      const p = planSkadis(o, AREAS);
      expect(p.error).toBeUndefined();
      for (const s of boardSlots(p, plannedSkadis(o))) {
        const [i, j] = index(p, plannedSkadis(o), s);
        // On a square grid the centres are a step off the slots.
        const k = pattern === 'square' ? 1 : 0;
        expect(patternSlot(pattern, Math.round(i) + k, Math.round(j) + k)).toBe(true);
      }
    }
  });

  it('are all one part: one mesh, built clean', () => {
    const job = plan(board({ shape: 'hex', tiles: three }));
    expect(job.plan.pieces).toHaveLength(3);
    const keys = new Set(job.plan.pieces.map((p) => job.parts[`piece:${p.id}`].meshKey));
    expect(keys.size).toBe(1);
    const mesh = buildMesh(w, job.meshes[[...keys][0]]);
    expect(errors(mesh)).toEqual([]);
    expect(job.warnings).toEqual([]);
    // The map tells them to hang in line.
    expect(job.drawers[0].enclosure).toBeDefined();
  });

  it('join side by side with plates across the gap, every hexagon with the pockets', () => {
    const o = hex({ tiles: [...three, [1, 1]] });
    const p = planSkadis(o, AREAS);
    // (0, 0)–(1, 0) and (0, 1)–(1, 1): in the gap's middle, level with the centres.
    expect(p.joints).toHaveLength(2);
    for (const j of p.joints) {
      expect(j.kind).toBe('plate');
      const [l, r] = [0, 1].map((k) =>
        p.hex!.centres.find((c) => Math.abs(c[1] - j.y) < 1e-6 && Math.abs(c[0] - j.x + ((k ? -1 : 1) * (p.hex!.w + o.hexGap)) / 2) < 1e-6),
      );
      expect(l && r).toBeTruthy();
    }
    const specs = skadisTileSpecs(p, o);
    for (const s of specs) expect(s.pockets).toEqual(specs[0].pockets);
    expect(specs[0].pockets).toHaveLength(2);
    // The pockets clear the slots by 1.2 mm.
    const half = 10.2;
    const a = (o.slotL - o.slotW) / 2;
    for (const [x, y] of specs[0].pockets)
      for (const [sx, sy] of specs[0].slots) {
        // From the pocket to the slot's middle line, less its half width.
        const d = Math.hypot(Math.max(0, Math.abs(sx - x) - half), Math.max(0, Math.abs(sy - y) - a - half)) - o.slotW / 2;
        expect(d).toBeGreaterThanOrEqual(1.2 - 1e-6);
      }
    const job = plan(board({ shape: 'hex', tiles: [...three, [1, 1]] }));
    expect(Object.values(job.parts).filter((q) => q.key.startsWith('jointplate:'))).toHaveLength(2);
    expect(job.drawers[0].enclosure!.info.skadis!.plates).toBe(2);
    const keys = new Set(job.plan.pieces.map((q) => job.parts[`piece:${q.id}`].meshKey));
    expect(keys.size).toBe(1);
    expect(errors(buildMesh(w, job.meshes[[...keys][0]]))).toEqual([]);
    // Not joined: no pockets, no plates; too small a border: not joined, and it says so.
    expect(planSkadis(hex({ tiles: three, join: 'none' }), AREAS).joints).toEqual([]);
    const thin = planSkadis(hex({ tiles: three, border: 6 }), AREAS);
    expect(thin.joints).toEqual([]);
    expect(thin.warnings.join()).toMatch(/border/);
  });

  it('take a wide attachment across two hexagons: it fits, no warnings', () => {
    const job = plan(board({ shape: 'hex', tiles: three }));
    const spot = across(job, 'toolRack');
    expect(spot).not.toBeNull();
    const placed = plan(board({ shape: 'hex', tiles: three }, [att('r', 'toolRack', ...spot!.at)]));
    const p = placed.drawers[0].enclosure!.wall!.placed[0];
    expect(p.ok).toBe(true);
    expect(p.x1 - p.x0).toBeGreaterThanOrEqual(150);
    expect(placed.warnings).toEqual([]);
    // A shelf as wide spans the gap between the two side by side, above and below.
    expect(across(job, 'shelf', { width: 200 })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Saved, shared, and undone
// ---------------------------------------------------------------------------

describe('saved and edited', () => {
  const s = () => useStore.getState();
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });

  it('a new board starts as one tile, and comes back from its project file and a share link', () => {
    s().addDrawer(undefined, { skadis: true });
    expect(s().drawer.skadis).toMatchObject({ layout: 'tiles', tiles: [[0, 0]] });
    s().setDrawer({ skadis: { ...sanitizeSkadis(s().drawer.skadis), shape: 'hex', tiles: three(), tileSize: 130 } });
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    const shared = decodeProject(encodeProject(file));
    s().resetAll();
    s().loadProject(shared);
    const board = s().drawers.find((d) => d.drawer.enclosure === 'skadis')!;
    s().switchDrawer(board.id);
    expect(s().drawer.skadis).toMatchObject({ layout: 'tiles', shape: 'hex', tiles: three(), tileSize: 130 });
  });

  it('adding and taking away tiles are undo steps; the attachments stay on their slots', () => {
    s().addDrawer(undefined, { skadis: true });
    s().setDrawer({ skadis: { ...sanitizeSkadis(s().drawer.skadis), shape: 'hex' }, attachments: [att('h', 'hook', 0, 0)] });
    const job0 = planPrint([{ id: 'x', name: 'x', drawer: s().drawer, baseplate: s().baseplate, bins: [] }], s().setup, { baseplate: true, bins: true });
    const slot = job0.drawers[0].enclosure!.wall!.board.slots[5];
    s().setDrawer({ attachments: [att('h', 'hook', ...slot)] });
    history.clear();
    // One to the left and below: the board's corner moves, the hook moves with its tile.
    addTile([-1, 0]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toEqual([
      [0, 0],
      [-1, 0],
    ]);
    const job1 = planPrint([{ id: 'x', name: 'x', drawer: s().drawer, baseplate: s().baseplate, bins: [] }], s().setup, { baseplate: true, bins: true });
    const g0 = job0.drawers[0].enclosure!.info.skadis!.grid!;
    const g1 = job1.drawers[0].enclosure!.info.skadis!.grid!;
    const hook = s().drawer.attachments![0];
    expect(hook.x - slot[0]).toBeCloseTo(g1.origin[0] - g0.origin[0], 6);
    expect(hook.y - slot[1]).toBeCloseTo(g1.origin[1] - g0.origin[1], 6);
    expect(slotKeys(job1.drawers[0].enclosure!.wall!.board.slots).has(`${hook.x},${hook.y}`)).toBe(true);
    addTile([0, 1]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toHaveLength(3);
    // Adding one that's there already does nothing.
    addTile([0, 1]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toHaveLength(3);
    history.undo();
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toHaveLength(2);
    history.undo();
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toEqual([[0, 0]]);
    expect(s().drawer.attachments![0]).toMatchObject({ x: slot[0], y: slot[1] });
    history.redo();
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toHaveLength(2);
    removeTile([0, 0]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toEqual([[-1, 0]]);
    // The last tile stays.
    removeTile([-1, 0]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toEqual([[-1, 0]]);
    history.undo();
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toHaveLength(2);
    setTiles([[5, 5]]);
    expect(sanitizeSkadis(s().drawer.skadis).tiles).toEqual([[5, 5]]);
  });
});

function three(): SkadisCell[] {
  return [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
}
