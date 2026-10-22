import { beforeEach, describe, expect, it } from 'vitest';
import { cleanWall, type WallPlan } from '../src/lib/wallPlanner/data';
import {
  DEFAULT_WALL,
  OBSTACLES,
  autoPlace,
  footprint,
  freeArea,
  newObstacle,
  oneTile,
  overlaps,
  snapRect,
  wallDrawers,
  wallKind,
  wallWarnings,
  type WallBox,
} from '../src/lib/wallPlanner/layout';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS, plannedSkadis, planSkadis, sanitizeSkadis } from '../src/lib/geometry/skadis';
import { clearAreas, plateBed } from '../src/lib/layout/pack';
import { planJob, planPrint } from '../src/lib/project';
import { allDrawers, history, printDrawers, projectFile, useStore } from '../src/state/store';
import { decodeProject, encodeProject } from '../src/lib/share';
import { addBoardHere, addObstacle, placeOnWall, printWall, removeFromWall, setWall } from '../src/state/wallPlanner';
import { useWallView } from '../src/state/wallView';

const s = () => useStore.getState();
const WALL: WallPlan = { width: 2000, height: 1200, gap: 10, obstacles: [], items: [] };
const box = (id: string, x: number, y: number, w: number, h: number): WallBox => ({ id, name: id, x, y, w, h });

describe('wall data', () => {
  it('has no wall until one is given', () => {
    for (const v of [undefined, null, 3, 'wall', [], true]) expect(cleanWall(v)).toBeUndefined();
  });

  it('cleans a saved wall: sizes in range, numbers finite, obstacles named', () => {
    const w = cleanWall({
      width: 50,
      height: 'tall',
      gap: -4,
      obstacles: [{ x: 'a', y: 100, w: 0, h: 1e9, label: '  ' }, null, 'door', { x: 10, y: 20, w: 30, h: 40, label: 'Socket'.repeat(10) }],
      items: 'none',
    })!;
    expect(w.width).toBe(100);
    expect(w.height).toBe(1200);
    expect(w.gap).toBe(0);
    expect(w.items).toEqual([]);
    expect(w.obstacles).toHaveLength(2);
    expect(w.obstacles[0]).toEqual({ x: 0, y: 100, w: 1, h: 20000, label: 'In the way' });
    expect(w.obstacles[1].label).toHaveLength(40);
  });

  it('keeps each drawer once, only drawers the project has, and drops what is not a drawer', () => {
    const items = [
      { drawerId: 'a', x: 10.04, y: 20 },
      { drawerId: 'a', x: 99, y: 99 },
      { drawerId: 'gone', x: 0, y: 0 },
      { drawerId: 7, x: 0, y: 0 },
      { drawerId: 'x'.repeat(65), x: 0, y: 0 },
      { drawerId: 'b', x: Infinity, y: '5' },
    ];
    const w = cleanWall({ width: 1000, height: 1000, items }, [{ id: 'a' }, { id: 'b' }, { id: 'x'.repeat(65) }])!;
    expect(w.items).toEqual([
      { drawerId: 'a', x: 10, y: 20 },
      { drawerId: 'b', x: 0, y: 5 },
    ]);
    // Without the drawer list (a wall written by the planner itself), every well-formed item stays.
    expect(cleanWall({ items })!.items.map((i) => i.drawerId)).toEqual(['a', 'gone', 'b']);
  });

  it('caps how much a file can hold', () => {
    const w = cleanWall({
      obstacles: Array.from({ length: 80 }, () => ({ x: 0, y: 0, w: 10, h: 10, label: 'x' })),
      items: Array.from({ length: 300 }, (_, i) => ({ drawerId: `d${i}`, x: 0, y: 0 })),
    })!;
    expect(w.obstacles).toHaveLength(50);
    expect(w.items).toHaveLength(200);
  });
});

describe('the wall in the project', () => {
  beforeEach(() => {
    s().resetAll();
    useWallView.getState().set(false);
  });

  it('is saved with the project, opened from a share link cleaned, and cleared by a new project', () => {
    const board = s().addDrawer(undefined, { skadis: true });
    setWall({ width: 2400 });
    placeOnWall(board, 100, 200);
    addObstacle({ x: 1500, y: 300, w: 600, h: 800, label: 'Window' });
    const file = projectFile(s());
    expect(file.wall).toEqual({
      width: 2400,
      height: 1200,
      gap: 10,
      obstacles: [{ x: 1500, y: 300, w: 600, h: 800, label: 'Window' }],
      items: [{ drawerId: board, x: 100, y: 200 }],
    });

    // A link with a tampered wall: the bad parts go, the rest opens.
    const tampered = {
      ...file,
      wall: { ...file.wall, width: -5, items: [...file.wall!.items, { drawerId: 'nope', x: 1, y: 1 }, { drawerId: board, x: 5, y: 5 }] },
    };
    s().resetAll();
    expect(s().wall).toBeUndefined();
    s().loadProject(decodeProject(encodeProject(tampered)));
    expect(s().wall!.width).toBe(100);
    expect(s().wall!.items).toEqual([{ drawerId: board, x: 100, y: 200 }]);
    expect(s().wall!.obstacles).toHaveLength(1);

    s().newProject();
    expect(s().wall).toBeUndefined();
    expect(projectFile(s())).not.toHaveProperty('wall');
  });

  it('makes each edit one undo step', () => {
    const board = s().addDrawer(undefined, { skadis: true });
    placeOnWall(board, 0, 0);
    placeOnWall(board, 300, 40);
    expect(s().wall!.items[0]).toMatchObject({ x: 300, y: 40 });
    history.undo();
    expect(s().wall!.items[0]).toMatchObject({ x: 0, y: 0 });
    removeFromWall(board);
    expect(s().wall!.items).toEqual([]);
    history.undo();
    expect(s().wall!.items).toHaveLength(1);
  });

  it('adds a board sized to an empty area, on the wall there, and opens it: one undo step', () => {
    const first = s().activeDrawerId;
    useWallView.getState().set(true);
    const id = addBoardHere('board', { x: 40, y: 60, w: 700, h: 420 });
    expect(s().activeDrawerId).toBe(id);
    expect(s().drawer.enclosure).toBe('skadis');
    expect(s().drawer.skadis).toMatchObject({ width: 700, height: 420 });
    expect(s().ui.tab).toBe('drawer');
    expect(useWallView.getState().open).toBe(false);
    expect(s().wall!.items).toEqual([{ drawerId: id, x: 40, y: 60 }]);
    const planned = planJob({ ...s(), include: { baseplate: true, bins: true } });
    expect(footprint(planned)).toEqual({ w: 700, h: 420 });

    const grid = addBoardHere('grid', { x: 800, y: 0, w: 500, h: 300 });
    expect(s().drawer).toMatchObject({ enclosure: 'wall', mode: 'drawer', width: 500, depth: 300 });
    expect(s().baseplate.magnets).toBe(true);
    const plate = footprint(planJob({ ...s(), include: { baseplate: true, bins: true } }));
    expect(plate.w).toBeLessThanOrEqual(500);
    expect(plate.w).toBeGreaterThan(495);
    expect(plate.h).toBeLessThanOrEqual(300);

    history.undo();
    expect(s().drawers.map((d) => d.id)).not.toContain(grid);
    expect(s().wall!.items.map((i) => i.drawerId)).toEqual([id]);
    history.undo();
    expect(s().drawers.map((d) => d.id)).toEqual([first]);
    expect(s().wall?.items ?? []).toEqual([]);
  });
});

describe('snapping', () => {
  const others = [{ x: 0, y: 640, w: 560, h: 560 }];

  it('snaps flush with the wall’s edges', () => {
    expect(snapRect({ x: 6, y: 1200 - 300 - 7, w: 200, h: 300 }, WALL, [], 10, 20)).toEqual({ x: 0, y: 900, guides: { x: 0, y: 1200 } });
    expect(snapRect({ x: 2000 - 200 + 12, y: 3, w: 200, h: 300 }, WALL, [], 10, 20)).toMatchObject({ x: 1800, y: 0 });
  });

  it('snaps the gap beside another board, or lined up with it', () => {
    // To its right, 10 mm apart, tops lined up.
    expect(snapRect({ x: 575, y: 905, w: 226, h: 300 }, WALL, others, 10, 20)).toEqual({ x: 570, y: 900, guides: { x: 560, y: 1200 } });
    // Below it, 10 mm apart, left edges lined up.
    expect(snapRect({ x: 8, y: 640 - 10 - 226 + 6, w: 226, h: 226 }, WALL, others, 10, 20)).toEqual({ x: 0, y: 404, guides: { x: 0, y: 640 } });
    // Right edges lined up.
    expect(snapRect({ x: 560 - 226 + 9, y: 100, w: 226, h: 226 }, WALL, others, 10, 20).x).toBe(334);
    // A gap of 0: flush against it.
    expect(snapRect({ x: 567, y: 100, w: 226, h: 226 }, WALL, others, 0, 20).x).toBe(560);
  });

  it('falls on a 5 mm grid out of reach of every edge', () => {
    expect(snapRect({ x: 1013.2, y: 401.9, w: 100, h: 100 }, WALL, others, 10, 5)).toEqual({ x: 1015, y: 400, guides: {} });
  });
});

describe('warnings', () => {
  const wall = { ...WALL, obstacles: [{ x: 1250, y: 350, w: 650, h: 850, label: 'Window' }] };

  it('flags a board over something in the way', () => {
    expect(wallWarnings(wall, [box('Board A', 1200, 400, 560, 560)])).toEqual([{ ids: ['Board A'], text: 'Board A is over the window.' }]);
    // Beside it is fine.
    expect(wallWarnings(wall, [box('Board A', 680, 400, 560, 560)])).toEqual([]);
    // A name in capitals keeps them.
    expect(wallWarnings({ ...wall, obstacles: [{ x: 0, y: 0, w: 50, h: 50, label: 'TV' }] }, [box('B', 0, 0, 100, 100)])[0].text).toBe('B is over the TV.');
  });

  it('flags a board off the wall, saying how far and where', () => {
    expect(wallWarnings(wall, [box('Board A', 1600, 900, 560, 560)])).toEqual([
      { ids: ['Board A'], text: 'Board A runs off the wall: 160 mm past its right edge, 260 mm past its top edge.' },
      { ids: ['Board A'], text: 'Board A is over the window.' },
    ]);
    expect(wallWarnings(wall, [box('B', -20, -0.2, 100, 100)])[0].text).toBe('B runs off the wall: 20 mm past its left edge.');
  });

  it('flags boards on top of each other, not boards that touch', () => {
    expect(wallWarnings(wall, [box('A', 0, 0, 500, 500), box('B', 400, 100, 300, 300)])).toEqual([{ ids: ['A', 'B'], text: 'A and B overlap.' }]);
    expect(wallWarnings(wall, [box('A', 0, 0, 500, 500), box('B', 500, 0, 300, 300)])).toEqual([]);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9.8, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('empty areas and free places', () => {
  it('finds the empty area round a click', () => {
    expect(freeArea(WALL, [], 500, 500, 10)).toEqual({ x: 0, y: 0, w: 2000, h: 1200 });
    // Below a board in the top left corner (kept the gap away from it) and left of a window.
    const blocks = [
      { x: 0, y: 640, w: 560, h: 560 },
      { x: 1250, y: 350, w: 650, h: 850 },
    ];
    const below = freeArea(WALL, blocks, 300, 200, 10)!;
    expect(below.y).toBe(0);
    expect(below.y + below.h).toBeLessThanOrEqual(630);
    expect(blocks.some((b) => overlaps(below, { x: b.x - 10, y: b.y - 10, w: b.w + 20, h: b.h + 20 }, 1e-6))).toBe(false);
    expect(below.w * below.h).toBeGreaterThanOrEqual(2000 * 340);
    // Between the board and the window, up to the top.
    expect(freeArea(WALL, blocks, 900, 1000, 10)).toEqual({ x: 570, y: 0, w: 670, h: 1200 });
    // On a board, or off the wall: nothing.
    expect(freeArea(WALL, blocks, 100, 900, 10)).toBeNull();
    expect(freeArea(WALL, blocks, 2100, 100, 10)).toBeNull();
  });

  it('places a board at the first free place from the top left', () => {
    expect(autoPlace(WALL, [], 560, 560, 10)).toEqual({ x: 0, y: 640 });
    expect(autoPlace(WALL, [{ x: 0, y: 640, w: 560, h: 560 }], 560, 560, 10)).toEqual({ x: 570, y: 640 });
    expect(autoPlace(WALL, [{ x: 0, y: 0, w: 2000, h: 1200 }], 100, 100, 10)).toBeNull();
    expect(autoPlace(WALL, [], 2500, 100, 10)).toBeNull();
  });

  it('adds what’s in the way at a usual size, inside the wall', () => {
    const win = newObstacle(WALL, OBSTACLES.find((o) => o.label === 'Window')!);
    expect(win.y + win.h).toBeLessThanOrEqual(1200);
    expect(win.x + win.w / 2).toBe(1000);
    const door = newObstacle({ width: 600, height: 1200 }, OBSTACLES.find((o) => o.label === 'Door')!);
    expect(door).toEqual({ label: 'Door', x: 0, y: 0, w: 600, h: 1200 });
  });

  it('sizes one tile to print in one piece', () => {
    const t = oneTile({ w: 1000, h: 600 }, DEFAULT_SETUP);
    const areas = clearAreas({ ...plateBed(DEFAULT_SETUP), spacing: DEFAULT_SETUP.spacing }).map((a) => ({ w: a.w, d: a.d }));
    const plan = planSkadis(plannedSkadis(sanitizeSkadis({ ...DEFAULT_SKADIS, width: t.w, height: t.h })), areas);
    expect(plan.tiles).toHaveLength(1);
    expect(Math.min(t.w, t.h)).toBeGreaterThan(150);
    // Never bigger than the area.
    expect(oneTile({ w: 120, h: 90 }, DEFAULT_SETUP)).toEqual({ w: 120, h: 90 });
  });
});

describe('printing a wall', () => {
  beforeEach(() => s().resetAll());

  it('prints all three boards on a wall at once', () => {
    const drawer = s().activeDrawerId;
    const a = s().addDrawer('Board A', { skadis: true });
    const b = s().addDrawer('Board B', { skadis: true });
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 300, height: 200 } });
    const g = s().addDrawer('Grid');
    s().setDrawer({ enclosure: 'wall', mode: 'grid', gridX: 3, gridY: 2 });
    expect(allDrawers(s()).map((d) => wallKind(d.drawer))).toEqual([null, 'board', 'board', 'grid']);
    placeOnWall(a, 0, 640);
    placeOnWall(b, 570, 1000);
    placeOnWall(g, 900, 0);

    const docs = wallDrawers(s().wall, allDrawers(s()));
    expect(docs.map((d) => d.name)).toEqual(['Board A', 'Board B', 'Grid']);
    const job = planPrint(docs, s().setup, s().include);
    expect(job.drawers.map((d) => d.id)).toEqual([a, b, g]);
    for (const id of [a, b, g]) expect(Object.keys(job.parts).some((k) => k.startsWith(`${id}/piece:`))).toBe(true);
    expect(Object.values(job.parts).some((p) => p.drawer === drawer)).toBe(false);

    // "Print everything on this wall": the Print tab, with exactly these drawers.
    printWall(docs.map((d) => d.id));
    expect(s().ui.tab).toBe('print');
    expect(s().printScope).toBe('pick');
    expect(printDrawers(s()).map((d) => d.id)).toEqual([a, b, g]);
  });

  it('measures each from its plan: a board its space, a wall grid its plate', () => {
    s().addDrawer('Board', { skadis: true });
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 420, height: 380 } });
    expect(footprint(planJob({ ...s(), include: { baseplate: true, bins: true } }))).toEqual({ w: 420, h: 380 });
    s().addDrawer('Grid');
    s().setDrawer({ enclosure: 'wall', mode: 'grid', gridX: 3, gridY: 2 });
    const job = planJob({ ...s(), include: { baseplate: true, bins: true } });
    expect(footprint(job)).toEqual({ w: job.layout.plateW, h: job.layout.plateD });
    expect(job.layout.plateW).toBeCloseTo(3 * 42, 0);
  });

  it('starts from an empty two-metre wall', () => {
    expect(DEFAULT_WALL).toMatchObject({ width: 2000, height: 1200, items: [], obstacles: [] });
  });
});
