import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS, NEW_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadisOptions';
import { planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import type { PlacedAttachment } from '../src/lib/wall';

/**
 * Skådis boards' planning isn't on the first screen (lib/skadisBoards.ts): it loads with the first board. Until it
 * has, a board plans bare (no tiles, parts, plates or warnings, no attachments) and the drawers beside it as ever;
 * once it has, the app plans again and gets what it would have had with everything loaded (as the tests have:
 * tests/setup.ts). Each test plans in a fresh copy of the modules, with nothing of the boards loaded yet.
 */

const INCLUDE = { baseplate: true, bins: true };

const drawer: NamedDrawer = {
  id: 'd',
  name: 'Drawer',
  drawer: { ...DEFAULT_DRAWER, width: 200, depth: 150 },
  baseplate: DEFAULT_BASEPLATE,
  bins: [{ id: 'x', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } }],
};
const board = (id: string, skadis: Partial<SkadisOptions>, attachments: PlacedAttachment[] = []): NamedDrawer => ({
  id,
  name: `Board ${id}`,
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
// Built from tiles, a hook on it; filling a space with a frame, screw covers it can't have (posts off: a warning).
const tiles = board(
  't',
  {
    ...NEW_SKADIS,
    tiles: [
      [0, 0],
      [1, 0],
    ],
  },
  [{ id: 'h', type: 'hook', x: 100, y: 100, opts: {} }],
);
const space = board('s', { ...DEFAULT_SKADIS, width: 400, height: 300, frame: 'rim', standoff: 'none', covers: true });
const DRAWERS = [drawer, tiles, space];

/** The modules as the first screen has them: nothing of the boards (or the attachments' kinds) loaded. */
async function fresh() {
  vi.resetModules();
  const project = await import('../src/lib/project');
  const boards = await import('../src/lib/skadisBoards');
  return { project, boards };
}

const ofDrawer = (job: PrintJob, id: string) => job.drawers.find((d) => d.id === id)!;
const partsOf = (job: PrintJob, id: string) => Object.values(job.parts).filter((p) => p.drawer === id);

describe('a Skådis board before its planning has loaded', () => {
  it('plans bare, with nothing misleading, and the drawers beside it as ever', async () => {
    const full = planPrint(DRAWERS, DEFAULT_SETUP, INCLUDE);
    // With everything loaded the boards have tiles, parts, plates, a warning and the hook.
    expect(full.warnings.some((w) => w.includes('Screw covers'))).toBe(true);
    expect(ofDrawer(full, 't').enclosure?.wall?.placed.map((p) => p.id)).toEqual(['h']);

    const { project, boards } = await fresh();
    expect(boards.skadisBoardsReady()).toBe(false);
    const bare = project.planPrint(DRAWERS, DEFAULT_SETUP, INCLUDE);
    expect(bare.warnings).toEqual([]);
    for (const id of ['t', 's']) {
      const d = ofDrawer(bare, id);
      expect(d.enclosure?.kind).toBe('skadis');
      expect(d.enclosure?.items).toEqual([]);
      expect(d.enclosure?.wall).toBeUndefined();
      expect(d.enclosure?.info.skadis).toBeUndefined();
      expect(d.plan.pieces).toEqual([]);
      expect(d.steps).toEqual([]);
      expect(d.plateCount).toBe(0);
      expect(partsOf(bare, id)).toEqual([]);
    }
    // The plain drawer is planned as it is with everything loaded.
    expect(partsOf(bare, 'd')).toEqual(partsOf(full, 'd'));
    expect(ofDrawer(bare, 'd').plan).toEqual(ofDrawer(full, 'd').plan);
    // (The load planning started finishes here, not in the next test's modules.)
    await boards.loadSkadisBoards();
  });

  it('starts the load itself, says when it is in, and then plans in full', async () => {
    const full = planPrint(DRAWERS, DEFAULT_SETUP, INCLUDE);
    const { project, boards } = await fresh();
    expect(boards.skadisBoardsReady()).toBe(false);
    const told = vi.fn();
    boards.subscribeSkadisBoards(told);
    const v = boards.skadisBoardsVersion();
    project.planPrint([tiles], DEFAULT_SETUP, INCLUDE);
    // Planning a board asked for its planning: no one else has to.
    await vi.waitFor(() => expect(boards.skadisBoardsReady()).toBe(true));
    expect(told).toHaveBeenCalledTimes(1);
    expect(boards.skadisBoardsVersion()).toBe(v + 1);
    // Loading it again is the same load.
    await boards.loadSkadisBoards();
    expect(told).toHaveBeenCalledTimes(1);
    // The board in full; its hook once the attachments' kinds are in too (they load with the first board as well).
    await import('../src/lib/wall/kinds/all');
    expect(JSON.stringify(project.planPrint(DRAWERS, DEFAULT_SETUP, INCLUDE))).toBe(JSON.stringify(full));
  });

  it('builds its meshes only with the builders handed in', async () => {
    const { boards } = await fresh();
    expect(() => boards.skadisBoardBuilders()).toThrow(/setSkadisBoardBuilders/);
  });
});
