/**
 * Where round 3's features meet: each was built and tested alone (boards built from tiles, the board editor, starter
 * boards, two colours, contents, load estimates, the wall planner, openGrid and Multiboard boards). These are the
 * joins between them: the ones that went wrong (the wall planner's one tile and a tile added on the left, the drawer
 * map of a grid board, where a part is on a board built from tiles) and the ones nothing else checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS, NEW_SKADIS, plannedSkadis, planSkadis, sanitizeSkadis } from '../src/lib/geometry/skadis';
import { skadisAreas } from '../src/lib/enclosures';
import { planJob, planPrint, usesSecondFilament } from '../src/lib/project';
import { wallInlaid } from '../src/lib/wall/plan';
import { oneTile } from '../src/lib/wallPlanner/layout';
import { attachmentEntries, inventoryRows, searchInventory } from '../src/lib/inventory';
import { allDrawers, history, projectFile, projectOf, useStore } from '../src/state/store';
import { addBoardHere, addObstacle, boardSettings, placeOnWall } from '../src/state/wallPlanner';
import { decodeProject, encodeProject } from '../src/lib/share';
import { shareableProject } from '../src/lib/externalShare';
import '../src/lib/gridBoardPlan';
import { addTile, removeTile } from '../src/state/skadisTiles';

// The drawer map dialog saves its SVG through the geometry worker's client: no worker here.
vi.mock('../src/worker/client', () => ({ downloadBytes: () => {} }));

const s = () => useStore.getState();
const areas = skadisAreas(DEFAULT_SETUP);

beforeEach(() => s().resetAll());

describe('the wall planner and boards built from tiles', () => {
  it('“One tile” is a board that prints in one piece, when the last board is built from tiles too', () => {
    // A new board is built from tiles: the next one the planner adds takes its settings.
    s().addDrawer('Tiles', { skadis: true });
    expect(boardSettings().layout).toBe('tiles');
    const area = { x: 0, y: 0, w: 1000, h: 800 };
    const t = oneTile(area, DEFAULT_SETUP, boardSettings());
    expect(t).toEqual(oneTile(area, DEFAULT_SETUP, DEFAULT_SKADIS));
    const id = addBoardHere('board', { ...area, w: t.w, h: t.h });
    const board = allDrawers(s()).find((d) => d.id === id)!;
    expect(board.drawer.skadis?.layout).toBeUndefined();
    expect(planSkadis(plannedSkadis(sanitizeSkadis(board.drawer.skadis)), areas).tiles).toHaveLength(1);
    expect(planJob(projectOf(s())).drawers[0].enclosure!.info.skadis!.tiles).toBe(1);
  });

  it('a tile added left of or below a board on the wall grows it that way on the wall (one undo step)', () => {
    const id = s().addDrawer('Tiles', { skadis: true });
    placeOnWall(id, 1000, 400);
    const plan = () => planSkadis(sanitizeSkadis(s().drawer.skadis), areas);
    const item = () => s().wall!.items.find((i) => i.drawerId === id)!;
    // Where tile (0, 0) is on the wall.
    const first = () => [item().x + plan().grid!.origin[0], item().y + plan().grid!.origin[1]];
    const at = first();
    const [cw, ch] = [plan().grid!.q[0], plan().grid!.r[1]];
    addTile([-1, 0]);
    expect(first()).toEqual(at);
    expect(item().x).toBeCloseTo(1000 - cw, 6);
    addTile([0, -1]);
    expect(first()).toEqual(at);
    expect(item().y).toBeCloseTo(400 - ch, 6);
    // Taken away again: back where it was.
    removeTile([-1, 0]);
    removeTile([0, -1]);
    expect([item().x, item().y]).toEqual([1000, 400]);
    history.undo();
    expect(first()).toEqual(at);
    expect(s().drawer.skadis!.tiles).toHaveLength(2);
    // Off the wall, a board's tiles change as before, and the wall is left alone.
    const other = s().addDrawer('Not on the wall', { skadis: true });
    const before = s().wall;
    addTile([-1, 0]);
    expect(s().wall).toBe(before);
    expect(s().activeDrawerId).toBe(other);
  });
});

describe('openGrid and Multiboard boards in the drawer map', () => {
  it('get no drawer page of their own (they hold no bins); drawers and Skådis boards get theirs', async () => {
    const { projectMaps } = await import('../src/components/DrawerMapDialog');
    s().addBin(0, 0, 1, 1);
    for (const kind of ['opengrid', 'multiboard'] as const) {
      s().addDrawer(kind);
      s().setDrawer({ enclosure: kind, [kind]: {} });
    }
    s().addDrawer('Skådis', { skadis: true });
    expect(projectMaps(allDrawers(s()), s().setup, {}).map((m) => m.name)).toEqual(['Drawer 1', 'Skådis']);
  });
});

describe('contents and Find on boards built from tiles', () => {
  it('say where on the board a part is, on the board the tiles make (not the space it had before)', () => {
    const id = s().addDrawer('Tiles', { skadis: true });
    const wall = () => planJob(projectOf(s())).drawers[0].enclosure!.wall!;
    const { W, H } = wall().board;
    // One tile, much smaller than the 560 mm space a board fills.
    expect(Math.max(W, H)).toBeLessThan(400);
    const top = wall().board.slots.reduce((p, q) => (q[1] > p[1] || (q[1] === p[1] && q[0] > p[0]) ? q : p));
    s().setDrawer({ attachments: [{ id: 'a', type: 'hook', x: top[0], y: top[1], opts: {}, name: 'Keys', contents: 'Car keys' }] });
    const [entry] = attachmentEntries(allDrawers(s()));
    expect(entry.pos).toBe('top right');
    const [hit] = searchInventory(allDrawers(s()), 'car keys', { activeDrawerId: id });
    expect([hit.attachmentId, hit.pos]).toEqual(['a', 'top right']);
    expect(inventoryRows(allDrawers(s())).find((r) => r[2] === 'Keys (J hook 50 mm)')?.[1]).toBe('top right');
  });
});

describe('project files and share links', () => {
  /** A project with every field round 3 added: a board built from tiles of a size, attachments with contents, a label from them inlaid, a material, an imported model, a shadow board's outlines; an openGrid board; the wall. */
  const build = () => {
    const board = s().addDrawer('Tiles', { skadis: true });
    s().setDrawer({
      skadis: {
        ...s().drawer.skadis!,
        tiles: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        tileSize: 160,
        tileHeight: 200,
      },
    });
    const [x, y] = planJob(projectOf(s())).drawers[0].enclosure!.wall!.board.slots[0];
    const tool = {
      toolId: 't1',
      name: 'Pliers',
      outline: [
        [0, 0],
        [120, 0],
        [120, 30],
        [0, 30],
      ],
    };
    s().setDrawer({
      attachments: [
        { id: 'b', type: 'bin', x, y, opts: {}, contents: 'M3 screws\nM4 nuts', labelFrom: 'contents', labelStyle: 'inlaid', material: 'petg' },
        { id: 'm', type: 'model', x, y, opts: { mesh: { hash: 'a'.repeat(28), file: 'Thing.stl', size: [40, 30, 20], triangles: 12, closed: true } } },
        { id: 't', type: 'shadowBoard', x, y, opts: { tools: [tool] }, colour: 2 },
      ],
    });
    s().addDrawer('openGrid board');
    s().setDrawer({ enclosure: 'opengrid', opengrid: { cols: 6, rows: 4 } });
    placeOnWall(board, 100, 200);
    addObstacle({ x: 900, y: 0, w: 80, h: 80, label: 'Socket' });
  };
  const file = () => JSON.parse(JSON.stringify(projectFile(s())));
  const parts = () => Object.values(planPrint(allDrawers(s()), s().setup, s().include).parts).map((p) => [p.key, p.name, p.w, p.d, p.h]);

  it('carry every new field, and open as they were saved', () => {
    build();
    // (Opened once, a drawer has every field cleaning gives it: blocked cells and the like.)
    s().loadProject(file());
    const saved = file();
    const planned = parts();
    s().resetAll();
    s().loadProject(saved);
    expect(file()).toEqual(saved);
    expect(parts()).toEqual(planned);
    // A link carries all of it but the model's mesh (a box of its size stands in).
    s().resetAll();
    s().loadProject(decodeProject(encodeProject(shareableProject(saved).file)));
    const back = file();
    const model = (f: typeof saved) =>
      f.drawers
        .flatMap((d: { drawer: { attachments?: { id: string; opts: { mesh: object } }[] } }) => d.drawer.attachments ?? [])
        .find((a: { id: string }) => a.id === 'm');
    expect(model(back).opts.mesh).toEqual({ file: 'Thing.stl', size: [40, 30, 20], triangles: 12, closed: true });
    model(back).opts.mesh = model(saved).opts.mesh;
    expect(back).toEqual(saved);
  });

  it('make anything else in them sane', () => {
    s().loadProject({
      app: 'gridfit',
      version: 4,
      drawers: [
        {
          id: 'x',
          name: 'Board',
          drawer: {
            enclosure: 'skadis',
            skadis: { layout: 'banana', tiles: [[1e9, NaN], 'q', [2, 1], [2, 1]], tileSize: -5, tileHeight: 'tall' },
            attachments: [
              { id: 'a', type: 'hook', x: 20, y: 20, opts: [], contents: 42, labelStyle: 'bold', labelFrom: 'name', material: 'abs', snap: 'yes', colour: -1 },
              { id: 'm', type: 'model', x: 40, y: 40, opts: { mesh: { hash: 'not hex', size: [10, 20, 30], flat: { '+y': 'junk' }, triangles: -4 } } },
              {
                id: 't',
                type: 'shadowBoard',
                x: 60,
                y: 60,
                opts: {
                  tools: [
                    { outline: 'x' },
                    {
                      outline: [
                        [0, 0],
                        [1e9, 0],
                        [0, 5],
                      ],
                    },
                    null,
                  ],
                },
              },
              { id: 'a', type: 'hook', x: 0, y: 0 },
              { type: 'hook', x: 0, y: 0 },
            ],
          },
        },
        { id: 'g', name: 'openGrid', drawer: { enclosure: 'opengrid', opengrid: { cols: 'many', rows: -3, screws: 'glue' } } },
      ],
      wall: {
        width: 'wide',
        height: -1,
        gap: 1e9,
        obstacles: [null, { w: -5, label: '' }],
        items: [{ drawerId: 'nope', x: 0, y: 0 }, { drawerId: 'x', x: 'left', y: 1e12 }, { drawerId: 'x' }],
      },
    });
    const [board] = allDrawers(s());
    expect(board.drawer.skadis).toMatchObject({ tiles: [[2, 1]], tileSize: 0, tileHeight: 0 });
    expect(board.drawer.skadis!.layout).toBeUndefined();
    expect(board.drawer.attachments!.map((a) => a.id)).toEqual(['a', 'm', 't']);
    expect(board.drawer.attachments![0]).toEqual({ id: 'a', type: 'hook', x: 20, y: 20, opts: {} });
    expect(s().wall).toEqual({
      width: 2000,
      height: 100,
      gap: 500,
      obstacles: [{ x: 0, y: 0, w: 1, h: 100, label: 'In the way' }],
      items: [{ drawerId: 'x', x: 0, y: 40000 }],
    });
    // And it all plans: the model a box of its size, the shadow board without the outlines that aren't any.
    const job = planPrint(allDrawers(s()), s().setup, s().include);
    expect(job.drawers[0].enclosure!.wall!.placed.map((p) => [p.id, p.opts])).toEqual([
      ['a', expect.anything()],
      ['m', expect.objectContaining({ mesh: { file: '', size: [10, 20, 30], triangles: 0, closed: false } })],
      ['t', expect.objectContaining({ tools: [] })],
    ]);
    expect(job.drawers[1].enclosure!.info.grid).toMatchObject({ cols: 12, rows: 1 });
    for (const p of Object.values(job.parts)) expect([p.w, p.d, p.h].every((v) => Number.isFinite(v) && v > 0)).toBe(true);
  });
});

describe('two colours and labels from what’s in a part', () => {
  it('a label that says what’s in it can be inlaid, and on a board built from tiles a zone’s text too', () => {
    s().addDrawer('Tiles', { skadis: true });
    s().setDrawer({
      skadis: {
        ...s().drawer.skadis!,
        tiles: [
          [0, 0],
          [1, 0],
        ],
        zones: [{ x: 40, y: 40, w: 120, h: 40, kind: 'text', text: 'BITS', style: 'inlaid' }],
      },
    });
    const [x, y] = planJob(projectOf(s())).drawers[0].enclosure!.wall!.board.slots[0];
    s().setDrawer({ attachments: [{ id: 'b', type: 'bin', x, y, opts: {}, contents: 'M3 screws', labelFrom: 'contents', labelStyle: 'inlaid' }] });
    const job = planJob(projectOf(s()));
    const [p] = job.drawers[0].enclosure!.wall!.placed;
    expect(p.extras?.label).toMatchObject({ text: 'M3 screws', style: 'inlaid' });
    const spec = job.meshes[job.parts[Object.keys(job.parts).find((k) => k.endsWith('att:b'))!].meshKey];
    expect(wallInlaid(spec)).toBe(true);
    expect(Object.values(job.meshes).some((m) => m.kind === 'piece' && wallInlaid(m))).toBe(true);
    expect(usesSecondFilament(job)).toBe(true);
    // What's in it changes the label, so the part.
    s().setDrawer({ attachments: [{ ...s().drawer.attachments![0], contents: 'M4 screws' }] });
    expect(planJob(projectOf(s())).drawers[0].enclosure!.wall!.placed[0].extras?.label?.text).toBe('M4 screws');
  });
});

describe('the board editor on hexagons built from tiles', () => {
  it('lines up, drags, copies and pastes parts on two hexagons, every one on its slots', async () => {
    const W = await import('../src/state/wall');
    const { dragGroup } = await import('../src/lib/wall/arrange');
    const { slotKeys, fitsAt, attachmentLayout } = await import('../src/lib/wall/plan');
    s().addDrawer('Hexagons', { skadis: true });
    s().setDrawer({
      skadis: {
        ...s().drawer.skadis!,
        shape: 'hex',
        tiles: [
          [0, 0],
          [1, 0],
        ],
      },
    });
    const wall = () => planJob(projectOf(s())).drawers[0].enclosure!.wall!;
    const { board } = wall();
    expect(board.hex).toBeUndefined();
    const keys = slotKeys(board.slots);
    const layout = attachmentLayout({ type: 'cup', opts: {} }, board.ctx)!.layout;
    // A cup on each hexagon, at different heights.
    const fits = board.slots.filter(([x, y]) => fitsAt(keys, layout, board.ctx, x, y));
    const left = fits.filter(([x]) => x < board.W / 2).sort((p, q) => q[1] - p[1])[0];
    const right = fits.filter(([x]) => x > board.W / 2).sort((p, q) => p[1] - q[1])[0];
    s().setDrawer({
      attachments: [
        { id: 'l', type: 'cup', x: left[0], y: left[1], opts: {} },
        { id: 'r', type: 'cup', x: right[0], y: right[1], opts: {} },
      ],
    });
    const ok = () => wall().placed.every((p) => p.ok);
    expect(ok()).toBe(true);
    W.alignAttachments(['l', 'r'], 'top', wall().board);
    expect(ok()).toBe(true);
    const [l, r] = wall().placed;
    expect(Math.abs(l.y1 - r.y1)).toBeLessThanOrEqual(board.ctx.pitch);
    // Dragged as one, a lattice step at a time: still on their slots.
    const moves = dragGroup(board, keys, wall().placed, 'l', l.x, l.y - 2 * board.ctx.pitch);
    expect(moves?.every((m) => m.fits)).toBe(true);
    W.moveAttachments(moves!);
    expect(ok()).toBe(true);
    W.copyAttachments(['l', 'r']);
    expect(W.pasteAttachments(wall().board)).toHaveLength(2);
    expect(ok()).toBe(true);
  });
});

describe('undo and redo', () => {
  it('take back every new action in one step, and put it back', async () => {
    const W = await import('../src/state/wall');
    const P = await import('../src/state/wallPlanner');
    const T = await import('../src/state/boardTemplates');
    const { BOARD_TEMPLATES } = await import('../src/lib/wall/templates');
    const doc = () => JSON.stringify({ ...projectFile(s()), ui: undefined });
    const wall = () => planJob(projectOf(s())).drawers[0].enclosure!.wall!;
    const ids = () => (s().drawer.attachments ?? []).map((a) => a.id);
    const step = (what: string, act: () => unknown) => {
      history.clear();
      const before = doc();
      act();
      const after = doc();
      expect(after, what).not.toBe(before);
      history.undo();
      expect(doc(), `${what}: undone`).toBe(before);
      history.redo();
      expect(doc(), `${what}: redone`).toBe(after);
    };
    step('a board from a template', () => T.newBoardFromTemplate(BOARD_TEMPLATES[0]));
    step('a template on a board', () => T.applyTemplate(BOARD_TEMPLATES[1], 'add'));
    const next = Math.max(...sanitizeSkadis(s().drawer.skadis).tiles.map((t) => t[0])) + 1;
    step('a tile added', () => addTile([next, 0]));
    step('a tile taken away', () => removeTile([next, 0]));
    step('a part added', () => W.addAttachment('hook', wall().board, wall().placed));
    const [a, b, c] = ids();
    step('what is in it', () => W.updateAttachment(a, { contents: 'Spare nozzles', labelFrom: 'contents', labelStyle: 'inlaid', material: 'petg' }));
    step('parts moved', () => W.moveAttachments([{ id: a, x: wall().placed[0].x + 40, y: wall().placed[0].y }]));
    step('parts lined up', () => W.alignAttachments([a, b, c], 'left', wall().board));
    step('parts duplicated', () => W.duplicateAttachments([a, b], wall().board));
    W.copyAttachments([c]);
    step('parts pasted', () => W.pasteAttachments(wall().board));
    step('parts removed', () => W.removeAttachments([a, b]));
    step('the wall measured', () => P.setWall({ width: 3000 }));
    step('a board on the wall', () => P.placeOnWall(s().activeDrawerId, 10, 20));
    step('something in the way', () => P.addObstacle({ x: 0, y: 0, w: 100, h: 100, label: 'Door' }));
    step('a board added on the wall', () => P.addBoardHere('board', { x: 500, y: 0, w: 300, h: 300 }));
    step('a wall grid added on the wall', () => P.addBoardHere('grid', { x: 900, y: 0, w: 300, h: 300 }));
  });
});

describe('planning the whole project', () => {
  it('plans a new board built from tiles beside the others', () => {
    s().addDrawer('Tiles', { skadis: true });
    expect(s().drawer.skadis).toMatchObject({ layout: NEW_SKADIS.layout });
    expect(planPrint(allDrawers(s()), s().setup, s().include).warnings).toEqual([]);
  });
});
