import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN, sanitizeBin, binTotalHeight, type BinOptions } from '../src/lib/geometry/bin';
import { GRID, HEIGHT_UNIT, LIP_HEIGHT, LIP_TOP_FLAT } from '../src/lib/geometry/spec';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planJob, planPrint, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { attachmentDef, type PlacedAttachment } from '../src/lib/wall';
import { dropLostLinks, heldBin, holdersOf, holding, syncHolders } from '../src/lib/wall/follow';
import { cleanAttachments } from '../src/lib/enclosureOptions';
import { boxPlan, BOX } from '../src/lib/wall/kinds/boxSleeve';
import { SHELF } from '../src/lib/wall/kinds/gridShelf';
import { history, projectFile, useStore } from '../src/state/store';
import { addAttachment } from '../src/state/wall';
import { holdBin } from '../src/state/follow';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const bin = (id: string, x: number, y: number, o: Partial<BinOptions> = {}): PlacedBin => ({ id, x, y, opts: sanitizeBin({ ...DEFAULT_BIN, ...o }) });
const drawer = (bins: PlacedBin[], id = 'd'): NamedDrawer => ({ id, name: 'Shelf drawer', drawer: DEFAULT_DRAWER, baseplate: DEFAULT_BASEPLATE, bins });
const board = (attachments: PlacedAttachment[], id = 'b'): NamedDrawer => ({
  id,
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const att = (id: string, type: string, x: number, y: number, opts: object = {}, follow?: PlacedAttachment['follow']): PlacedAttachment => ({
  id,
  type,
  x,
  y,
  opts: { ...opts },
  ...(follow ? { follow } : {}),
});
const plan = (drawers: NamedDrawer[]): PrintJob => planPrint(drawers, DEFAULT_SETUP, { baseplate: true, bins: true });
/** The board's planned attachments (the last drawer is the board). */
const wallOf = (job: PrintJob) => job.drawers[job.drawers.length - 1].enclosure!.wall!;
const LIP = LIP_HEIGHT - LIP_TOP_FLAT;

describe('what a bin gives the attachment that holds it', () => {
  it('its cells, units and outside, on its drawer’s grid', () => {
    const h = heldBin(drawer([]), bin('a', 0, 0, { unitsX: 2, unitsY: 1, heightUnits: 6 }));
    expect(h).toEqual({ cellsX: 2, cellsY: 1, units: 6, w: 2 * GRID - 0.5, d: GRID - 0.5, h: Math.round((6 * HEIGHT_UNIT + LIP) * 100) / 100, lip: true });
    // A half-grid bin three half cells wide is a cell and a half.
    const half = heldBin({ drawer: { ...DEFAULT_DRAWER, halfGrid: true } }, bin('a', 0, 0, { unitsX: 3, unitsY: 2, heightUnits: 4, lip: false }));
    expect(half.cellsX).toBeCloseTo(1.5, 6);
    expect(half.cellsY).toBeCloseTo(1, 6);
    expect(half.lip).toBe(false);
    expect(half.h).toBeCloseTo(4 * HEIGHT_UNIT, 6);
  });

  it('sizes the lip clip from it: inside its corners, its height; a cradle when the catch would miss', () => {
    const clip = (o: Partial<BinOptions>) =>
      holding(att('c', 'gridClip', 100, 200, { cells: 1, units: 3, style: 'lip' }, { drawer: 'd', bin: 'a' }), [drawer([bin('a', 0, 0, o)])])!;
    expect(clip({ unitsX: 2, heightUnits: 6 }).set).toEqual({ cells: 2, units: 6 });
    // No lip to clip under: it hangs in the cradle.
    expect(clip({ unitsX: 2, heightUnits: 6, lip: false }).set).toEqual({ cells: 2, units: 6, style: 'cradle' });
    // Given in mm, between units: the next unit up, in the cradle.
    const mm = clip({ unitsX: 1, heightMode: 'external', heightMm: 50 });
    expect(mm.set).toMatchObject({ units: Math.ceil((50 - LIP) / HEIGHT_UNIT), style: 'cradle' });
    // Wider than the clip comes: as wide as it goes, with a note.
    const wide = clip({ unitsX: 7 });
    expect(wide.note).toMatch(/size of its bin/);
    expect(attachmentDef('gridClip')!.sanitize(wide.opts)).toMatchObject({ cells: 6 });
  });

  it('holds nothing without a link, or on a kind that can’t hold a bin', () => {
    const d = [drawer([bin('a', 0, 0)])];
    expect(holding(att('c', 'gridClip', 100, 200), d)).toBeNull();
    expect(holding(att('h', 'hook', 100, 200, {}, { drawer: 'd', bin: 'a' }), d)).toBeNull();
    for (const type of ['gridClip', 'gridShelf', 'gridPlate', 'boxSleeve']) expect(attachmentDef(type)!.follow, type).toBeTypeOf('function');
  });
});

describe('planning follows the bin', () => {
  const link = { drawer: 'd', bin: 'a' };
  const project = (o: Partial<BinOptions>, list: PlacedAttachment[] = [att('c', 'gridClip', 100, 200, { cells: 1, units: 3 }, link)]) => [
    drawer([bin('a', 0, 0, o)]),
    board(list),
  ];

  it('sizes the clip from the bin, and a change to the bin goes through planPrint', () => {
    const two = wallOf(plan(project({ unitsX: 2, heightUnits: 6 })));
    expect(two.placed[0].opts).toMatchObject({ cells: 2, units: 6 });
    expect(two.placed[0].layout.w).toBe(2 * GRID - 8);
    const job3 = plan(project({ unitsX: 3, heightUnits: 6 }));
    const three = wallOf(job3).placed[0];
    expect(three.opts).toMatchObject({ cells: 3, units: 6 });
    expect(three.layout.w).toBe(3 * GRID - 8);
    expect(three.ok).toBe(true);
    // Its part on the plates is the new size too.
    const part = Object.values(job3.parts).find((p) => p.attachment === 'c')!;
    expect(job3.meshes[part.meshKey]).toMatchObject({ opts: { cells: 3 } });
    expect(job3.warnings).toEqual([]);
  });

  it('finds the bin in a drawer it isn’t planning, given the project’s drawers', () => {
    const [d, b] = project({ unitsX: 3, heightUnits: 8 });
    const alone = planJob({ ...b, setup: DEFAULT_SETUP, include: { baseplate: true, bins: true } }, { drawers: [d, b] });
    expect(alone.drawers[0].enclosure!.wall!.placed[0].opts).toMatchObject({ cells: 3, units: 8 });
    // Without them, the drawers it plans are all there is: it plans as it was saved.
    const saved = planJob({ ...b, setup: DEFAULT_SETUP, include: { baseplate: true, bins: true } });
    expect(saved.drawers[0].enclosure!.wall!.placed[0].opts).toMatchObject({ cells: 1, units: 3 });
  });

  it('keeps its last size, with a note, when the bin or its drawer is gone', () => {
    const gone = (job: PrintJob) => {
      expect(wallOf(job).placed[0].opts).toMatchObject({ cells: 1, units: 3 });
      expect(job.warnings.some((m) => /Its bin is gone/.test(m))).toBe(true);
    };
    gone(plan([drawer([]), board([att('c', 'gridClip', 100, 200, { cells: 1, units: 3 }, link)])]));
    gone(plan([board([att('c', 'gridClip', 100, 200, { cells: 1, units: 3 }, link)])]));
  });

  it('plans each kind the size of its bin', () => {
    const b = bin('a', 0, 0, { unitsX: 3, unitsY: 2, heightUnits: 5 });
    const list = [
      att('s', 'gridShelf', 60, 260, { cellsX: 1, cellsY: 1, back: 60 }, link),
      att('p', 'gridPlate', 220, 140, { cellsX: 1, cellsY: 1 }, link),
      att('x', 'boxSleeve', 60, 120, { width: 50, depth: 50, height: 50 }, link),
    ];
    const job = plan([drawer([b]), { ...board(list), drawer: { ...board(list).drawer, skadis: { ...DEFAULT_SKADIS, width: 600, height: 500 } } }]);
    const placed = new Map(wallOf(job).placed.map((p) => [p.id, p]));
    const shelf = placed.get('s')!;
    expect(shelf.opts).toMatchObject({ cellsX: 3, cellsY: 2 });
    expect(shelf.layout.w).toBe(3 * GRID + 2 * SHELF.cheek);
    expect(placed.get('p')!.layout.w).toBe(3 * GRID);
    // The sleeve's inside is the bin's outside, 1 mm clear all round.
    const sleeve = placed.get('x')!;
    const box = boxPlan(sleeve.opts as never);
    const out = heldBin(drawer([]), b);
    expect(box.x1 - box.x0).toBeCloseTo(out.w + 2 * BOX.fit, 6);
    expect(box.z1 - box.z0).toBeCloseTo(out.d + 2 * BOX.fit, 6);
    expect((sleeve.opts as { height: number }).height).toBeCloseTo(binTotalHeight(b.opts), 2);
    for (const p of placed.values()) expect(p.ok, p.name).toBe(true);
  });

  it('builds the followed clip clean', () => {
    const job = plan(project({ unitsX: 3, heightUnits: 6 }));
    const part = Object.values(job.parts).find((p) => p.attachment === 'c')!;
    const mesh = buildMesh(w, job.meshes[part.meshKey]);
    expect(checkPart(w, mesh).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('the project keeps holders at their bins’ size', () => {
  const link = { drawer: 'd', bin: 'a' };
  it('writes the bin’s size in, and leaves the rest alone', () => {
    const docs = [
      drawer([bin('a', 0, 0, { unitsX: 2, heightUnits: 4 })]),
      board([att('c', 'gridClip', 100, 200, { cells: 1, units: 3 }, link), att('h', 'hook', 300, 200)]),
    ];
    const next = syncHolders(docs)!;
    expect(next[0]).toBe(docs[0]);
    expect(next[1].drawer.attachments![0].opts).toEqual({ cells: 2, units: 4 });
    expect(next[1].drawer.attachments![1]).toBe(docs[1].drawer.attachments![1]);
    // In step already: nothing to do.
    expect(syncHolders(next)).toBeNull();
    // Its bin gone: nothing changes.
    expect(syncHolders([drawer([]), next[1]])).toBeNull();
    expect(holdersOf(next, link).map((h) => h.a.id)).toEqual(['c']);
  });
});

describe('saved and shared', () => {
  it('cleans the link as it loads', () => {
    const raw = [
      { id: 'a', type: 'gridClip', x: 1, y: 2, opts: {}, follow: { drawer: 'd', bin: 'x' } },
      { id: 'b', type: 'gridClip', x: 1, y: 2, opts: {}, follow: 'd/x' },
      { id: 'c', type: 'gridClip', x: 1, y: 2, opts: {}, follow: { drawer: 'd', bin: 3 } },
      { id: 'e', type: 'gridClip', x: 1, y: 2, opts: {}, follow: { drawer: 'd', bin: 'x', extra: true } },
    ];
    const out = cleanAttachments(raw);
    expect(out.map((a) => a.follow)).toEqual([{ drawer: 'd', bin: 'x' }, undefined, undefined, { drawer: 'd', bin: 'x' }]);
  });

  it('drops a link to a bin that isn’t in the project it shares or saves', () => {
    const keep = att('k', 'gridClip', 100, 200, {}, { drawer: 'd', bin: 'a' });
    const lost = att('l', 'gridClip', 200, 200, { cells: 2 }, { drawer: 'd', bin: 'gone' });
    const file = { drawer: board([keep, lost]).drawer, drawers: [drawer([bin('a', 0, 0)]), board([keep, lost])] };
    const out = dropLostLinks(file);
    for (const d of [out.drawer, out.drawers[1].drawer]) {
      expect(d.attachments![0]).toBe(keep);
      expect(d.attachments![1]).toEqual({ id: 'l', type: 'gridClip', x: 200, y: 200, opts: { cells: 2 } });
    }
    expect(out.drawers[0]).toBe(file.drawers[0]);
    // Nothing lost: the same file.
    expect(dropLostLinks({ drawers: [drawer([bin('a', 0, 0)]), board([keep])] }).drawers[1].drawer.attachments![0]).toBe(keep);
  });
});

describe('in the app (state/follow.ts)', () => {
  const s = () => useStore.getState();
  const clip = () => s().drawer.attachments![0];
  const boardDoc = (id: string) => s().drawers.find((d) => d.id === id)!;
  let shelfDrawer = '';
  let binId = '';
  let boardId = '';

  beforeEach(() => {
    s().resetAll();
    shelfDrawer = s().activeDrawerId;
    binId = s().addBin(0, 0, 2, 1);
    s().updateBin(binId, { opts: { heightUnits: 6 } });
    boardId = s().addDrawer('Board', { skadis: true });
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 } });
    const d = { id: boardId, name: 'Board', drawer: s().drawer, baseplate: s().baseplate, bins: s().bins };
    const wall = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true }).drawers[0].enclosure!.wall!;
    addAttachment('gridClip', wall.board, wall.placed);
    history.clear();
  });

  it('links and unlinks as undo steps, sized from the bin at once', () => {
    holdBin(clip().id, { drawer: shelfDrawer, bin: binId });
    expect(clip().follow).toEqual({ drawer: shelfDrawer, bin: binId });
    expect(clip().opts).toMatchObject({ cells: 2, units: 6 });
    history.undo();
    expect(clip().follow).toBeUndefined();
    expect(clip().opts).toMatchObject({ cells: 1, units: 6 });
    history.redo();
    expect(clip().opts).toMatchObject({ cells: 2 });
    holdBin(clip().id, null);
    // Unlinked, it keeps its size.
    expect(clip().follow).toBeUndefined();
    expect(clip().opts).toMatchObject({ cells: 2, units: 6 });
    history.undo();
    expect(clip().follow).toEqual({ drawer: shelfDrawer, bin: binId });
  });

  it('follows the bin as it changes in its own drawer, and keeps its last size when it goes', () => {
    holdBin(clip().id, { drawer: shelfDrawer, bin: binId });
    s().switchDrawer(shelfDrawer);
    s().updateBin(binId, { opts: { unitsX: 3 } });
    expect(boardDoc(boardId).drawer.attachments![0].opts).toMatchObject({ cells: 3, units: 6 });
    // One undo takes the bin and its holder back together.
    history.undo();
    expect(s().bins.find((b) => b.id === binId)!.opts.unitsX).toBe(2);
    expect(boardDoc(boardId).drawer.attachments![0].opts).toMatchObject({ cells: 2 });
    history.redo();
    expect(boardDoc(boardId).drawer.attachments![0].opts).toMatchObject({ cells: 3 });
    s().removeBin(binId);
    s().switchDrawer(boardId);
    expect(clip().opts).toMatchObject({ cells: 3, units: 6 });
    expect(clip().follow).toBeDefined();
    // Saved or shared, the link to a bin that's gone is dropped; the size stays.
    const file = dropLostLinks(projectFile(s()));
    const saved = file.drawers.find((d) => d.id === boardId)!.drawer.attachments![0];
    expect(saved.follow).toBeUndefined();
    expect(saved.opts).toMatchObject({ cells: 3 });
  });

  it('opens a saved project with its links', () => {
    holdBin(clip().id, { drawer: shelfDrawer, bin: binId });
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    s().resetAll();
    s().loadProject(file);
    s().switchDrawer(boardId);
    expect(clip().follow).toEqual({ drawer: shelfDrawer, bin: binId });
  });
});

describe('first screen', () => {
  /** Every module the entry imports statically, type-only imports aside (lazy ones load with `import()`). */
  function firstScreen(): Set<string> {
    const root = resolve(__dirname, '..');
    const seen = new Set<string>();
    const find = (from: string, spec: string) => {
      const base = resolve(dirname(from), spec);
      return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((p) => existsSync(p) && /\.tsx?$/.test(p));
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm)) {
        const next = find(file, m[1]);
        if (next) walk(next);
      }
    };
    walk(join(root, 'src/main.tsx'));
    return new Set([...seen].map((f) => f.slice(root.length + 1).replace(/\\/g, '/')));
  }

  it('leaves following a bin to load later', () => {
    const first = firstScreen();
    // The walk sees the first screen: the store and planning are on it.
    expect(first.has('src/state/store.ts')).toBe(true);
    expect(first.has('src/lib/project.ts')).toBe(true);
    for (const f of ['src/lib/wall/follow.ts', 'src/lib/wall/place.ts', 'src/lib/wall/parts.ts', 'src/state/follow.ts', 'src/components/WallHolds.tsx'])
      expect(first.has(f), f).toBe(false);
  });
});
