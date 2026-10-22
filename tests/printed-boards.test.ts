import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type JobPart, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS, NEW_SKADIS, type SkadisCell, type SkadisOptions } from '../src/lib/geometry/skadis';
import { attachmentDefs, type PlacedAttachment } from '../src/lib/wall';
import { NO_PRINTS, cleanPrinted, coveredParts, fingerprint, markPrinted, setPrintKey, unmarkPrinted, type PrintedRecord } from '../src/lib/printed';
import { boardPrintKey, partMarks } from '../src/lib/printedBoards';
import { toPrint } from '../src/state/printed';
import '../src/lib/gridBoardPlan';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const include = { baseplate: true, bins: true };
/** A Skådis board filling a space (the parts round it: frame strips, cleats, door hooks, desk parts, covers, spacers). */
const FILL: Partial<SkadisOptions> = { ...DEFAULT_SKADIS, layout: undefined, width: 600, height: 400 };
const board = (attachments: PlacedAttachment[], skadis: Partial<SkadisOptions> = FILL, id = 'b'): NamedDrawer => ({
  id,
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...NEW_SKADIS, ...skadis }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const tiles = (cells: SkadisCell[], o: Partial<SkadisOptions> = {}, attachments: PlacedAttachment[] = []) =>
  board(attachments, { ...NEW_SKADIS, ...o, tiles: cells });
const att = (id: string, type: string, x: number, y: number, opts: object = {}, more: Partial<PlacedAttachment> = {}): PlacedAttachment => ({
  id,
  type,
  x,
  y,
  opts: { ...opts },
  ...more,
});
const plan = (ds: NamedDrawer | NamedDrawer[], rec?: PrintedRecord, onlyChanged = true): PrintJob =>
  planPrint(Array.isArray(ds) ? ds : [ds], DEFAULT_SETUP, include, rec ? { printed: rec, onlyChanged } : {});
const all = (job: PrintJob) => job.plates.map((_, i) => i);
const onPlates = (job: PrintJob) => job.plates.flatMap((pl) => pl.placements.map((p) => p.key)).sort();
/** Everything the job prints, marked as printed. */
const printed = (ds: NamedDrawer | NamedDrawer[]): PrintedRecord => {
  const job = plan(ds);
  return markPrinted(NO_PRINTS, job, all(job));
};
/** What prints again, "only what's changed", after `next` (part keys). */
const reprint = (rec: PrintedRecord, next: NamedDrawer | NamedDrawer[]) => onPlates(plan(next, rec));
const keysOf = (job: PrintJob, pre: string) =>
  Object.keys(job.parts)
    .filter((k) => k.startsWith(pre))
    .sort();
const fps = (job: PrintJob, pre = '') =>
  Object.values(job.parts)
    .filter((p) => p.key.startsWith(pre))
    .map((p) => fingerprint(p.meshKey))
    .sort();

/** A bin with a label, a hook with its lock key, a box with its lid and hinge pin, a plate bolted on with a T-nut. */
const ATTS = [
  att('bin', 'bin', 100, 200, { width: 80, height: 60, depth: 50 }, { label: 'Screws' }),
  att('hook', 'hook', 300, 220),
  att('box', 'lidBox', 420, 260, { lid: 'hinge' }),
  att('plate', 'plate', 220, 100, {}, { bolt: 'm3' }),
];

describe('a board printed, then changed', () => {
  it('moving, renaming, re-colouring an attachment or filling it reprints nothing', () => {
    const rec = printed(board(ATTS));
    expect(reprint(rec, board(ATTS))).toEqual([]);
    // Two steps over and up: the same slots under each, so the plate's bolt goes through the same place on it.
    const moved = ATTS.map((a, i) => ({ ...a, x: a.x + 40, y: a.y + 40, name: `Mine ${i}`, colour: 2, contents: 'Screws', material: 'petg' as const }));
    expect(reprint(rec, board(moved))).toEqual([]);
    // New ids (copied and pasted, a template applied again): alike parts stand in for each other.
    expect(reprint(rec, board(ATTS.map((a) => ({ ...a, id: `${a.id}-copy` }))))).toEqual([]);
  });

  it('adding an attachment prints just it (and its extra parts)', () => {
    const rec = printed(board(ATTS));
    expect(reprint(rec, board([...ATTS, att('h2', 'hook', 520, 120, { style: 'U' })]))).toEqual(['att:h2', 'att:h2:lock0']);
  });

  it('resizing a bin reprints just it; resizing a lidded box its lid too, not its pin', () => {
    const rec = printed(board(ATTS));
    const resize = (id: string, o: object) => board(ATTS.map((a) => (a.id === id ? { ...a, opts: { ...a.opts, ...o } } : a)));
    expect(reprint(rec, resize('bin', { width: 120 }))).toEqual(['att:bin']);
    const box = plan(board(ATTS));
    expect(keysOf(box, 'att:box:').length).toBeGreaterThan(1);
    // Taller: the box and its lid; the pin runs the width, so it's the one printed.
    expect(reprint(rec, resize('box', { height: 90 }))).toEqual(['att:box', 'att:box:lid']);
  });

  it('changing the slot fit reprints every attachment and its extra parts, not the tiles; the thickness the tiles too', () => {
    const rec = printed(board(ATTS));
    const job = plan(board(ATTS));
    const attParts = keysOf(job, 'att:');
    expect(attParts).toEqual(expect.arrayContaining(['att:box:lid', 'att:box:pin', 'att:hook:lock0', 'att:plate:tnut0']));
    expect(reprint(rec, board(ATTS, { ...FILL, fit: 'snug' }))).toEqual(attParts);
    const thick = reprint(rec, board(ATTS, { ...FILL, thickness: 6 }));
    expect(thick).toEqual(expect.arrayContaining([...attParts, ...keysOf(job, 'piece:')]));
    // Joint plates are the same plates.
    expect(thick.filter((k) => k.startsWith('jointplate:'))).toEqual([]);
  });

  it('a label, or how it is made (cut in, raised, inlaid), reprints that part only', () => {
    const rec = printed(board(ATTS));
    const set = (more: Partial<PlacedAttachment>) => board(ATTS.map((a) => (a.id === 'bin' ? { ...a, ...more } : a)));
    expect(reprint(rec, set({ label: 'Nails' }))).toEqual(['att:bin']);
    expect(reprint(rec, set({ labelStyle: 'inlaid' }))).toEqual(['att:bin']);
    expect(reprint(rec, set({ labelStyle: 'raised' }))).toEqual(['att:bin']);
    // A label from its contents changes with them.
    const fromContents = (contents: string) => set({ labelFrom: 'contents', contents });
    const rec2 = printed(fromContents('Washers'));
    expect(reprint(rec2, fromContents('Washers'))).toEqual([]);
    expect(reprint(rec2, fromContents('Nuts'))).toEqual(['att:bin']);
    // A tile's text, or its being inlaid, reprints the tiles it's on.
    const zone = (text: string, style?: 'inlaid') =>
      board([], { ...FILL, zones: [{ kind: 'text', text, x: 40, y: 300, w: 120, h: 60, ...(style ? { style } : {}) }] });
    const rec3 = printed(zone('TOOLS'));
    const under = reprint(rec3, zone('PARTS'));
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((k) => k.startsWith('piece:'))).toBe(true);
    expect(reprint(rec3, zone('TOOLS', 'inlaid'))).toEqual(under);
  });

  it('identical attachments are prints of one part: a third alike prints one', () => {
    const two = [att('a', 'hook', 100, 200), att('b', 'hook', 200, 200)];
    const job = plan(board(two));
    expect(new Set(fps(job, 'att:')).size).toBe(2); // the hook and its lock key
    const rec = printed(board(two));
    expect(rec.counts[fingerprint(job.parts['att:a'].meshKey)]).toBe(2);
    expect(reprint(rec, board([...two, att('c', 'hook', 300, 200)]))).toEqual(['att:c', 'att:c:lock0']);
    // Taking one off and adding it back somewhere else: still printed.
    expect(reprint(rec, board([two[0], att('z', 'hook', 400, 100)]))).toEqual([]);
  });
});

describe('the tiles', () => {
  it('a hexagon added prints one hexagon: they are all one part', () => {
    const cells: SkadisCell[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const atts = [att('a', 'hook', 120, 120)];
    const rec = printed(tiles(cells, { shape: 'hex' }, atts));
    const job = plan(tiles(cells, { shape: 'hex' }, atts));
    expect(new Set(fps(job, 'piece:')).size).toBe(1);
    expect(rec.counts[fingerprint(job.parts['piece:1'].meshKey)]).toBe(3);
    // Added anywhere round them: one hexagon, and a joint plate if it has a neighbour to its right or left.
    for (const c of [
      [-1, 0],
      [1, 1],
      [-1, 2],
    ] as SkadisCell[]) {
      const again = reprint(rec, tiles([...cells, c], { shape: 'hex' }, atts));
      expect(again.filter((k) => k.startsWith('piece:'))).toHaveLength(1);
      expect(again.filter((k) => !k.startsWith('piece:') && !k.startsWith('jointplate:'))).toEqual([]);
    }
  });

  it('a rectangle added prints it and the tiles it joins: their edge takes its joint', () => {
    const cells: SkadisCell[] = [
      [0, 0],
      [1, 0],
    ];
    const rec = printed(tiles(cells));
    // Its tab or socket goes in the one it's beside; the other doesn't change.
    expect(reprint(rec, tiles([...cells, [2, 0]])).filter((k) => k.startsWith('piece:'))).toEqual(['piece:2', 'piece:3']);
    // Left of the first: tiles are numbered as they were added, so the others keep their numbers.
    expect(reprint(rec, tiles([...cells, [-1, 0]])).filter((k) => k.startsWith('piece:'))).toEqual(['piece:1', 'piece:3']);
    // Apart from them: just it.
    expect(reprint(rec, tiles([...cells, [4, 0]]))).toEqual(['piece:3']);
  });

  it('keep their slots where they are when one is added left or below: the lattice counts from tile (0, 0)', () => {
    const tileSpec = (job: PrintJob, id: number) => {
      const spec = job.meshes[job.parts[`piece:${id}`].meshKey];
      return spec.kind === 'piece' && spec.enclosure?.kind === 'skadis' ? spec.enclosure.tile : null;
    };
    const cells: SkadisCell[] = [
      [0, 0],
      [1, 0],
    ];
    const job0 = plan(tiles(cells));
    const board0 = job0.drawers[0].enclosure!.wall!.board;
    const g0 = job0.drawers[0].enclosure!.info.skadis!.grid!;
    // The standard pattern, 11 steps a tile: an odd count turned the slots over before.
    expect((g0.q[0] / 20) % 2).toBe(1);
    for (const c of [
      [-1, 0],
      [0, -1],
      [-1, -1],
    ] as SkadisCell[]) {
      const job = plan(tiles([...cells, c]));
      // A tile it isn't beside keeps its slots (one it's under gains the halves of those its seam cuts).
      cells.forEach((t, i) => {
        if (Math.abs(t[0] - c[0]) + Math.abs(t[1] - c[1]) > 1) expect(tileSpec(job, i + 1)?.slots, `${c} ${t}`).toEqual(tileSpec(job0, i + 1)?.slots);
      });
      // Every slot of the board before is a slot now, moved with tile (0, 0).
      const g = job.drawers[0].enclosure!.info.skadis!.grid!;
      const [dx, dy] = [g.origin[0] - g0.origin[0], g.origin[1] - g0.origin[1]];
      const now = new Set(job.drawers[0].enclosure!.wall!.board.slots.map(([x, y]) => `${x},${y}`));
      expect(board0.slots.every(([x, y]) => now.has(`${Math.round((x + dx) * 1000) / 1000},${Math.round((y + dy) * 1000) / 1000}`))).toBe(true);
    }
  });

  it('are numbered in the order they were added, so one added below or left renumbers nothing', () => {
    const job = plan(
      tiles([
        [0, 0],
        [1, 0],
        [0, -1],
        [-1, 0],
      ]),
    );
    const plan0 = job.drawers[0];
    const at = plan0.enclosure!.info.skadis!.grid!.at;
    expect(at).toEqual([
      [0, 0],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]);
    expect(plan0.plan.pieces.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    // Each tile's number on its back is its piece's.
    for (const p of plan0.plan.pieces) {
      const spec = job.meshes[job.parts[`piece:${p.id}`].meshKey];
      expect(spec.kind === 'piece' && spec.enclosure?.kind === 'skadis' && spec.enclosure.tile.number?.text).toBe(String(p.id));
    }
    // Laid out row by row (a starter board), as before.
    const rows = plan(
      tiles([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
    ).drawers[0].plan.pieces.map((p) => [p.col, p.row]);
    expect(rows).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('a board filling a space reprints its tiles when it is resized, not its alike parts', () => {
    const o: Partial<SkadisOptions> = { ...FILL, standoff: 'spacers' };
    const rec = printed(board([], o));
    const job = plan(board([], o));
    const spacers = keysOf(job, 'standoff:').length;
    const plates = keysOf(job, 'jointplate:').length;
    const bigger = plan(board([], { ...o, width: 900 }));
    const again = reprint(rec, board([], { ...o, width: 900 }));
    expect(again.filter((k) => k.startsWith('standoff:'))).toHaveLength(Math.max(0, keysOf(bigger, 'standoff:').length - spacers));
    expect(again.filter((k) => k.startsWith('jointplate:'))).toHaveLength(Math.max(0, keysOf(bigger, 'jointplate:').length - plates));
  });
});

describe("a board's parts besides its tiles", () => {
  /** The mesh's volume, area and size: equal for two keys that print as one part. */
  const shape = (mesh: MeshData) => {
    const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
    const b = m.boundingBox();
    const out = [m.volume(), m.surfaceArea(), ...[0, 1, 2].map((k) => b.max[k] - b.min[k])];
    m.delete();
    return out;
  };
  /** Parts of two jobs with the same fingerprint and different mesh keys build alike. */
  const sameBuilt = (a: PrintJob, b: PrintJob, pre: string) => {
    let n = 0;
    for (const p of Object.values(a.parts).filter((x) => x.key.startsWith(pre))) {
      for (const q of Object.values(b.parts).filter((x) => x.key.startsWith(pre))) {
        if (p.meshKey === q.meshKey || fingerprint(p.meshKey) !== fingerprint(q.meshKey)) continue;
        const [s, t] = [shape(buildMesh(w, a.meshes[p.meshKey])), shape(buildMesh(w, b.meshes[q.meshKey]))];
        s.forEach((v, i) => expect(t[i], `${p.key} ${q.key} ${i}`).toBeCloseTo(v, 3));
        n++;
      }
    }
    return n;
  };

  it('door hooks, desk feet and clamps are alike wherever they go, and stay printed on a taller board', () => {
    for (const o of [{ hang: 'door' }, { hang: 'desk', deskMount: 'clamp' }] as Partial<SkadisOptions>[]) {
      const d = board([], { ...FILL, ...o });
      const job = plan(d);
      const hang = keysOf(job, 'hang:');
      expect(hang.length).toBeGreaterThan(1);
      // Two alike: one part, printed twice.
      expect(new Set(hang.map((k) => fingerprint(job.parts[k].meshKey))).size).toBe(1);
      expect(new Set(hang.map((k) => job.parts[k].meshKey)).size).toBe(hang.length);
      const taller = board([], { ...FILL, ...o, height: 440 });
      expect(reprint(printed(d), taller).filter((k) => k.startsWith('hang:'))).toEqual([]);
      expect(sameBuilt(job, plan(taller), 'hang:')).toBeGreaterThan(0);
    }
  });

  it('frame strips keep their prints when the board grows the other way', () => {
    const o: Partial<SkadisOptions> = { ...FILL, frame: 'rim' };
    const job = plan(board([], o));
    const rec = printed(board([], o));
    const taller = plan(board([], { ...o, height: 440 }));
    const again = reprint(rec, board([], { ...o, height: 440 }));
    // The top and bottom strips are the same; the sides are longer.
    const strips = keysOf(taller, 'frame:');
    const reprinted = again.filter((k) => k.startsWith('frame:'));
    expect(reprinted.length).toBeGreaterThan(0);
    expect(reprinted.length).toBeLessThan(strips.length);
    expect(sameBuilt(job, taller, 'frame:')).toBeGreaterThan(0);
  });

  it('screw covers, spacers and joint plates are prints of one part each', () => {
    const o: Partial<SkadisOptions> = { ...FILL, covers: true };
    const job = plan(board([], o));
    for (const pre of ['cover:', 'jointplate:']) {
      expect(keysOf(job, pre).length, pre).toBeGreaterThan(1);
      expect(new Set(fps(job, pre)).size, pre).toBe(1);
    }
    const sp = plan(board([], { ...FILL, standoff: 'spacers' }));
    expect(new Set(fps(sp, 'standoff:')).size).toBe(1);
  });

  it('a mesh key that is no part of a board, or not one of its parts, is its own print key', () => {
    for (const k of ['bin|{}', 'skadishang|not json', 'skadisrim|{"x0":-5,"y0":0,"x1":10,"y1":5,"pins":[],"W":100,"H":100,"R":5}', 'att|hook|{}'])
      expect(boardPrintKey(k)).toBe(k);
  });
});

describe('openGrid and Multiboard boards', () => {
  const grid = (kind: 'opengrid' | 'multiboard', o: object): NamedDrawer => ({
    id: 'g',
    name: 'Grid',
    drawer: { ...DEFAULT_DRAWER, enclosure: kind, [kind]: o } as DrawerInput,
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  });

  it('a column added reprints the tiles that changed size, and alike connectors are one part', () => {
    for (const kind of ['opengrid', 'multiboard'] as const) {
      const d = grid(kind, { cols: 12, rows: 8 });
      const job = plan(d);
      expect(keysOf(job, 'piece:').length).toBeGreaterThan(1);
      if (kind === 'opengrid') expect(new Set(fps(job, 'connector:')).size).toBe(1);
      const rec = printed(d);
      expect(reprint(rec, d)).toEqual([]);
      const again = reprint(rec, grid(kind, { cols: 13, rows: 8 }));
      expect(again.length).toBeGreaterThan(0);
      expect(again.length).toBeLessThan(keysOf(job, 'piece:').length);
      expect(again.every((k) => k.startsWith('piece:'))).toBe(true);
    }
  });
});

describe('every attachment kind', () => {
  // Each kind at its defaults, spread over a big board.
  const defs = attachmentDefs();
  const spread = (dx = 0, dy = 0, tag = '') =>
    defs.map((d, i) =>
      att(`${d.type}${tag}`, d.type, 120 + (i % 8) * 280 + dx, 140 + Math.floor(i / 8) * 260 + dy, {}, { name: tag ? `${d.type} ${tag}` : undefined }),
    );
  const big: Partial<SkadisOptions> = { ...FILL, width: 2400, height: 2200 };

  it('with its extra parts: where it hangs, its id and its name are no part of its print', () => {
    const rec = printed(board(spread(), big));
    expect(reprint(rec, board(spread(40, 40, 'moved'), big))).toEqual([]);
    // The fit: all of them again, extra parts too, and none of the tiles.
    const loose = board(spread(), { ...big, fit: 'loose' });
    expect(reprint(rec, loose)).toEqual(keysOf(plan(loose), 'att:'));
  });
});

describe('marks for the board editors, and what is left to print', () => {
  const atts = [att('a', 'hook', 100, 200), att('b', 'bin', 300, 200)];
  const d = (as: PlacedAttachment[], cells: SkadisCell[] = [[0, 0]]) => tiles(cells, {}, as);

  it('show each attachment, with its extra parts, and each tile: printed, or changed since', () => {
    const rec = printed(d(atts));
    expect(partMarks(plan(d(atts)), rec)).toMatchObject({ 'att:a': 'printed', 'att:b': 'printed', 'piece:1': 'printed' });
    // The bin resized, the hook without its lock key, a tile added: the new tile has no mark yet.
    const next = [{ ...atts[0], lock: false }, { ...atts[1], opts: { width: 120 } }, att('c', 'cup', 150, 80)];
    const marks = partMarks(
      plan(
        d(next, [
          [0, 0],
          [1, 0],
        ]),
      ),
      rec,
    );
    expect(marks['att:a']).toBe('printed');
    expect(marks['att:b']).toBe('changed');
    expect(marks['att:c']).toBeUndefined();
    expect(marks['piece:1']).toBe('changed');
    expect(marks['piece:2']).toBeUndefined();
    // A hook whose lock key is new: printed in part.
    const locked = partMarks(plan(d([{ ...atts[0], id: 'a' }])), printed(d([{ ...atts[0], lock: false }])));
    expect(locked['att:a']).toBe('changed');
    expect(partMarks(plan(d(atts)), NO_PRINTS)).toEqual({});
  });

  it('say what is left to print: changed since printed, or new', () => {
    const rec = printed(d(atts));
    const next = d([atts[0], { ...atts[1], opts: { width: 120 } }, att('c', 'cup', 150, 80)]);
    for (const only of [true, false]) {
      const job = plan(next, rec, only);
      const t = toPrint(job, rec);
      const keys = (l: JobPart[]) => l.map((p) => p.key).sort();
      expect(keys(t.changed)).toEqual(['att:b']);
      expect(keys(t.added)).toEqual(['att:c']);
    }
  });
});

describe('records', () => {
  afterEach(() => setPrintKey(boardPrintKey));

  it('the fingerprint is the one records were made with', () => {
    // The hash itself, and any key but a board's hanging parts' and frame strips' as it was.
    expect(fingerprint('att|hook|{}|{"t":5}')).toBe('1971eec0b62831');
    expect(fingerprint('att|hook|{}|{"t":5}#roles')).toBe('1971eec0b62831');
  });

  it('made before boards had print keys still read: bins, tiles, plates and attachments stay printed', () => {
    const bins: PlacedBin[] = [{ id: 'x', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } }];
    const drawer: NamedDrawer = {
      id: 'd',
      name: 'Drawer',
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 },
      baseplate: DEFAULT_BASEPLATE,
      bins,
    };
    const both = [drawer, board(ATTS, { ...FILL, hang: 'door', covers: true })];
    // As it was: every key its own print key.
    setPrintKey((k) => k);
    const old = JSON.parse(JSON.stringify(printed(both)));
    const job0 = plan(both);
    const oldHooks = keysOf(job0, 'b/hang:').map((k) => fingerprint(job0.parts[k].meshKey));
    setPrintKey(boardPrintKey);
    const rec = cleanPrinted(old);
    expect(rec).toEqual(old);
    const again = onPlates(plan(both, rec));
    // Only the door hooks print again, once: their fingerprints now go without where they hang.
    expect(again.every((k) => k.startsWith('b/hang:'))).toBe(true);
    // Marking them puts the record right.
    const job = plan(both, rec, false);
    const fixed = markPrinted(rec, job, all(job));
    expect(onPlates(plan(both, fixed))).toEqual([]);
    // Taking them all back leaves only the hooks' old prints, which cover nothing now.
    const back = unmarkPrinted(fixed, { ...job, printed: [...coveredParts(job, fixed)] }, all(job));
    expect(back.parts).toEqual({});
    expect(Object.keys(back.counts).sort()).toEqual([...oldHooks].sort());
  });
});
