/**
 * Makes the fixtures tests/compat-boards.test.ts opens (boards-<commit>.json) with an older commit's own code. In a
 * checkout of that commit (`git worktree add <dir> <commit>`, node_modules linked in), copy this file to the same
 * place (tests/fixtures/) and run, there:
 *
 *   FIXTURE_VERSION=<commit> FIXTURE_OUT=<file> npx vitest run tests/fixtures/boards-fixture.test.ts
 *
 * It builds the same project with whatever that version has (a plain drawer with bins; a Skådis board filling a
 * space, a rectangle and hexagons, with attachments and their common options; a wall grid; an openGrid board, a
 * starter board and the wall planner where it has them) and writes the saved project file, its share link, and what
 * that version planned. Here it does nothing.
 */
import { it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { allDrawers, projectFile, projectOf, useStore } from '../../src/state/store';
import { planJob, planPrint } from '../../src/lib/project';
import { shareUrl } from '../../src/lib/share';
import { shareableProject } from '../../src/lib/externalShare';

const s = () => useStore.getState();
const r2 = (v: number) => Math.round(v * 100) / 100;
const has = (p: string) => existsSync(new URL(p, import.meta.url));
// Modules a version may not have, typed loosely (they differ from one to the next): a path the bundler doesn't look at.
const load = (p: string): Promise<any> => import(/* @vite-ignore */ p);

it.skipIf(!process.env.FIXTURE_OUT)('writes the fixture', async () => {
  const version = process.env.FIXTURE_VERSION!;
  const out = process.env.FIXTURE_OUT!;
  const W = has('../../src/state/wall.ts') ? await load('../../src/state/wall.ts') : null;
  if (has('../../src/lib/gridBoardPlan.ts')) await load('../../src/lib/gridBoardPlan.ts');

  s().resetAll();
  useStore.setState({ templates: [], tools: [] });
  // 1. A plain drawer with a few bins.
  s().renameDrawer(s().activeDrawerId, 'Desk drawer');
  s().setDrawer({ width: 400, depth: 300 });
  s().addBin(0, 0, 2, 1);
  s().addBin(2, 0, 1, 2);
  s().addBin(0, 1, 1, 1);
  s().setBinContents(s().bins[0].id, 'Pens\nPencils');

  const wall = () => planJob(projectOf(s())).drawers[0]!.enclosure!.wall!;
  const add = (type: string, at?: [number, number]): string => {
    const w = wall();
    const id = W!.addAttachment(type, w.board, w.placed, at);
    if (!id) throw new Error(`no ${type}`);
    return id;
  };
  const opts = (id: string, o: Record<string, unknown>) => W!.setAttachmentOpts(id, o);
  const upd = (id: string, p: Record<string, unknown>) => W!.updateAttachment(id, p);

  // 2. A rectangle board filling a space, with attachments.
  s().addDrawer('Workbench board', { skadis: true });
  s().setDrawer({ skadis: { ...s().drawer.skadis!, width: 560, height: 560, shape: 'rect' } });
  if (W) {
    const hook = add('hook');
    upd(hook, { name: 'Tape hook' });
    const bin = add('bin', [120, 400]);
    upd(bin, { bolt: 'm3', label: 'Screws' });
    // Made a pair after it was put on: its saved spot no longer fits it.
    const cup = add('cup', [300, 400]);
    opts(cup, { count: 2 });
    const shelf = add('shelf', [280, 160]);
    opts(shelf, { width: 200 });
    upd(shelf, { name: 'Top shelf', barbs: 'ends', lock: false });
    const tag = add('labelTag', [440, 300]);
    opts(tag, { text: 'Pliers' });
    add('toolRack', [100, 240]);
    add('gridShelf', [420, 120]);
    // Added near the right edge, then made wider: it no longer fits there either.
    const wide = add('bin', [520, 500]);
    opts(wide, { width: 120 });
    upd(wide, { name: 'Wide bin' });
    if (has('../../src/lib/wall/kinds/model.ts')) {
      // Two-colour labels, contents and a label from them, an imported model's stand-in.
      upd(bin, { labelStyle: 'inlaid' });
      upd(cup, { contents: 'Pens\nPencils' });
      const named = add('bin', [440, 40]);
      upd(named, { contents: 'Nozzles', labelFrom: 'contents', labelStyle: 'raised' });
      add('model', [60, 60]);
    }
  }

  // 3. A hexagon board filling a space.
  s().addDrawer('Hexagon board', { skadis: true });
  s().setDrawer({ skadis: { ...s().drawer.skadis!, width: 600, height: 520, shape: 'hex' } });
  if (W) {
    const hook = add('hook');
    upd(hook, { label: 'Keys' });
    add('cup');
    const tag = add('labelTag');
    opts(tag, { text: 'Hall' });
  }

  // 4. A wall grid.
  s().addDrawer('Wall grid');
  s().setDrawer({ enclosure: 'wall', width: 336, depth: 252 });
  s().setBaseplate({ magnets: true });
  s().addBin(0, 0, 1, 1);

  // 5. Where it has them: an openGrid board, a starter board, the wall planner.
  if (has('../../src/lib/gridBoardPlan.ts')) {
    s().addDrawer('openGrid board');
    s().setDrawer({ enclosure: 'opengrid', opengrid: {} } as never);
  }
  if (has('../../src/state/boardTemplates.ts')) {
    const T = await load('../../src/lib/wall/templates.ts');
    const B = await load('../../src/state/boardTemplates.ts');
    B.newBoardFromTemplate(T.BOARD_TEMPLATES.find((t: { id: string }) => t.id === 'desk'));
  }
  if (has('../../src/state/wallPlanner.ts')) {
    const P = await load('../../src/state/wallPlanner.ts');
    P.setWall({ width: 3000, height: 1500 });
    P.addObstacle({ x: 2000, y: 0, w: 900, h: 1400, label: 'Door' });
    allDrawers(s())
      .filter((d) => d.name !== 'Desk drawer')
      .forEach((d, i) => P.placeOnWall(d.id, i * 700, 600));
  }

  s().setPrintScope('all');
  const file = projectFile(s());
  const link = new URL(shareUrl(shareableProject(file).file, 'https://gridfit.example/')).hash;
  const job = planPrint(allDrawers(s()), s().setup, s().include);
  const expect = {
    drawers: allDrawers(s()).map((d, i) => {
      const enc = job.drawers[i]?.enclosure;
      const w = enc?.wall;
      const info = enc?.info?.skadis;
      return {
        id: d.id,
        name: d.name,
        enclosure: d.drawer.enclosure ?? null,
        ...(info
          ? {
              info: {
                shape: info.shape,
                tiles: info.tiles,
                slots: info.slots,
                tabs: info.tabs,
                plates: info.plates,
                mounts: info.mounts,
                screws: info.screws,
                boardW: r2(info.boardW),
                boardH: r2(info.boardH),
              },
            }
          : {}),
        ...(w
          ? {
              board: { W: r2(w.board.W), H: r2(w.board.H), slots: w.board.slots.length },
              placed: w.placed.map((p) => ({ id: p.id, type: p.type, name: p.name, x: r2(p.x), y: r2(p.y), ok: p.ok })),
            }
          : {}),
      };
    }),
    warnings: job.warnings,
    parts: Object.values(job.parts)
      .map((p) => ({ key: p.key, name: p.name, w: r2(p.w), d: r2(p.d), h: r2(p.h) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
  writeFileSync(out, JSON.stringify({ version, file, link, expect }));
});
