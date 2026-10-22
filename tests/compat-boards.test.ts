/**
 * Old projects open the same. Each fixture (tests/fixtures/boards-<commit>.json) was made with that commit's own code
 * (a plain drawer with bins, a Skådis board filling a space as a rectangle and as hexagons, with attachments and their
 * common options where that version had them, a wall grid; later ones an openGrid board, a starter board and the wall
 * planner): its saved project file, its share link, and what that version planned (each board's size and tiles, each
 * attachment's spot and whether it fit, the warnings, every part's name and size). Today's code opens both the file
 * and the link and must plan the same. (Made with tests/fixtures/boards-fixture.test.ts, which says how.)
 *
 * Those versions planned a part on the nearest slot where it fit; today a part stays where it's put. A part whose
 * saved slot no longer fit it (made wider after it was put on) came back red at first: older projects' attachments are
 * now marked to be planned as then (PlacedAttachment.snap) till they're moved.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allDrawers, history, projectFile, useStore } from '../src/state/store';
import { planPrint, type PrintJob } from '../src/lib/project';
import { projectFromHash } from '../src/lib/share';
import type { PlacedAttachment } from '../src/lib/wall';
import '../src/lib/gridBoardPlan';

interface Fixture {
  version: string;
  file: { drawers: { id: string; name: string; drawer: { attachments?: PlacedAttachment[] } }[]; wall?: unknown };
  link: string;
  expect: {
    drawers: {
      id: string;
      name: string;
      enclosure: string | null;
      info?: Record<string, number | string>;
      board?: { W: number; H: number; slots: number };
      placed?: { id: string; type: string; name: string; x: number; y: number; ok: boolean }[];
    }[];
    warnings: string[];
    parts: { key: string; name: string; w: number; d: number; h: number }[];
  };
}

const s = () => useStore.getState();
const r2 = (v: number) => Math.round(v * 100) / 100;
const fixture = (v: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/boards-${v}.json`, import.meta.url), 'utf8'));

/** The project as planned for printing every drawer. */
function planned(): PrintJob {
  return planPrint(allDrawers(s()), s().setup, s().include);
}

beforeEach(() => s().resetAll());

for (const version of ['bd4e0b0', 'feab925', '5be91af']) {
  const fx = fixture(version);
  for (const from of ['file', 'link'] as const) {
    describe(`a project saved by ${version}, opened from its ${from === 'file' ? 'project file' : 'share link'}`, () => {
      const open = () => {
        s().loadProject(from === 'file' ? fx.file : projectFromHash(fx.link));
        return planned();
      };

      it('opens without errors, every drawer as it was', () => {
        const job = open();
        expect(allDrawers(s()).map((d) => [d.id, d.name, d.drawer.enclosure ?? null])).toEqual(fx.expect.drawers.map((d) => [d.id, d.name, d.enclosure]));
        expect(job.drawers).toHaveLength(fx.expect.drawers.length);
      });

      it('keeps every board filling its space, at the same size and in the same tiles', () => {
        const job = open();
        const docs = allDrawers(s());
        fx.expect.drawers.forEach((want, i) => {
          if (want.enclosure !== 'skadis') return;
          expect(docs[i].drawer.skadis?.layout, want.name).toBeUndefined();
          const info = job.drawers[i].enclosure?.info.skadis;
          expect(info, want.name).toBeDefined();
          for (const [k, v] of Object.entries(want.info ?? {}))
            expect([want.name, k, typeof v === 'number' ? r2(info![k as 'tiles']) : info![k as 'shape']]).toEqual([want.name, k, v]);
          if (want.board) {
            const b = job.drawers[i].enclosure!.wall!.board;
            expect([r2(b.W), r2(b.H), b.slots.length]).toEqual([want.board.W, want.board.H, want.board.slots]);
          }
        });
      });

      it('keeps every attachment where it was, none red that was fine', () => {
        const job = open();
        const docs = allDrawers(s());
        fx.expect.drawers.forEach((want, i) => {
          if (!want.placed) return;
          // Saved where they were saved.
          const saved = fx.file.drawers[i].drawer.attachments ?? [];
          expect(docs[i].drawer.attachments?.map((a) => [a.id, a.x, a.y])).toEqual(saved.map((a) => [a.id, a.x, a.y]));
          // And planned where that version planned them, fitting where they fit.
          const placed = job.drawers[i].enclosure!.wall!.placed;
          expect(placed.map((p) => ({ id: p.id, type: p.type, name: p.name, x: r2(p.x), y: r2(p.y), ok: p.ok }))).toEqual(want.placed);
        });
      });

      it('gives no warnings that version didn’t, but what a part holds', () => {
        const job = open();
        const added = job.warnings.filter((w) => !fx.expect.warnings.includes(w));
        // The load estimates (wall/load.ts) are new advice, not a change to any part: the one here is the shelf whose
        // barbs are on its end clips only (the pegs between hold it up, but don't hold it in).
        const load = added.filter((w) => /: meant for about .* kg, but its mounts hold about/.test(w));
        expect(added.filter((w) => !load.includes(w))).toEqual([]);
        expect(load.map((w) => w.split(':').slice(0, 2).join(':'))).toEqual(version === 'bd4e0b0' ? [] : ['Workbench board: Top shelf']);
      });

      it('plans the same parts, with the same names and sizes', () => {
        const job = open();
        const parts = Object.values(job.parts)
          .map((p) => ({ key: p.key, name: p.name, w: r2(p.w), d: r2(p.d), h: r2(p.h) }))
          .sort((a, b) => (a.key < b.key ? -1 : 1));
        expect(parts).toEqual(fx.expect.parts);
      });
    });
  }
}

describe('attachments saved before they stayed where they’re put', () => {
  const fx = fixture('feab925');
  const board = () => allDrawers(s()).find((d) => d.name === 'Workbench board')!;
  const plannedBoard = () => planned().drawers[allDrawers(s()).findIndex((d) => d.name === 'Workbench board')].enclosure!.wall!;
  // A cup made a pair after it was put on the board: its saved spot doesn't fit the pair, so that version planned it on the nearest that did.
  const cup = fx.expect.drawers.find((d) => d.name === 'Workbench board')!.placed!.find((p) => p.type === 'cup')!;
  const saved = fx.file.drawers.find((d) => d.name === 'Workbench board')!.drawer.attachments!.find((a) => a.id === cup.id)!;

  it('come back from a file before version 4 planned as then; files saved now say so, and keep later ones where they are', () => {
    expect([saved.x, saved.y]).not.toEqual([cup.x, cup.y]);
    s().loadProject(fx.file);
    expect(board().drawer.attachments!.every((a) => a.snap)).toBe(true);
    const was = plannedBoard().placed.find((p) => p.id === cup.id)!;
    expect([was.x, was.y, was.ok]).toEqual([cup.x, cup.y, true]);
    // Saved again (version 4): still marked, planned the same.
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    expect(file.version).toBe(4);
    s().resetAll();
    s().loadProject(file);
    expect(board().drawer.attachments!.every((a) => a.snap)).toBe(true);
    expect(plannedBoard().placed.find((p) => p.id === cup.id)!.ok).toBe(true);
    // One put there by today's app (unmarked, in a version 4 file) stays where it is, red.
    s().resetAll();
    for (const d of file.drawers) for (const a of d.drawer.attachments ?? []) delete a.snap;
    s().loadProject(file);
    expect(board().drawer.attachments!.some((a) => a.snap)).toBe(false);
    const now = plannedBoard().placed.find((p) => p.id === cup.id)!;
    expect([now.x, now.y, now.ok]).toEqual([saved.x, saved.y, false]);
  });

  it('stay where they’re put once moved (one undo step), and so do copies; the rest are planned as then', async () => {
    const { duplicateAttachments, moveAttachments } = await import('../src/state/wall');
    s().loadProject(fx.file);
    s().switchDrawer(board().id);
    // A copy goes beside it where it's planned (not where it was saved), and fits there as it does.
    const [twin] = duplicateAttachments([cup.id], plannedBoard().board);
    const t = plannedBoard().placed.find((p) => p.id === twin)!;
    expect([t.y, t.ok, t.x > cup.x]).toEqual([cup.y, true, true]);
    history.undo();
    // Moved where it doesn't fit: there it stays, red, as any part put there now does.
    moveAttachments([{ id: cup.id, x: cup.x + 40, y: cup.y }]);
    const moved = board().drawer.attachments!.find((a) => a.id === cup.id)!;
    expect([moved.x, moved.y, moved.snap]).toEqual([cup.x + 40, cup.y, undefined]);
    expect(
      board()
        .drawer.attachments!.filter((a) => a.id !== cup.id)
        .every((a) => a.snap),
    ).toBe(true);
    history.undo();
    expect(board().drawer.attachments!.find((a) => a.id === cup.id)!.snap).toBe(true);
    // Moved to the very spot it was saved at, it moves too (and stays there, red).
    moveAttachments([{ id: cup.id, x: saved.x, y: saved.y }]);
    expect(board().drawer.attachments!.find((a) => a.id === cup.id)!.snap).toBeUndefined();
    expect(plannedBoard().placed.find((p) => p.id === cup.id)!.ok).toBe(false);
    const hook = fx.expect.drawers[1].placed![0].id;
    const [copy] = duplicateAttachments([hook], plannedBoard().board);
    expect(board().drawer.attachments!.find((a) => a.id === copy)!.snap).toBeUndefined();
    expect(board().drawer.attachments!.find((a) => a.id === hook)!.snap).toBe(true);
  });

  it('go to My attachments as a set arranged as they’re planned', async () => {
    const { saveToMyAttachments } = await import('../src/state/myAttachments');
    s().loadProject(fx.file);
    s().switchDrawer(board().id);
    const hook = fx.expect.drawers[1].placed![0];
    const made = saveToMyAttachments([hook.id, cup.id], plannedBoard().board)!;
    const p = plannedBoard().board.ctx.pitch;
    expect(made.items.map((it) => [it.type, it.di, it.dj, 'snap' in it])).toEqual([
      ['hook', 0, 0, false],
      ['cup', (cup.x - hook.x) / p, (cup.y - hook.y) / p, false],
    ]);
  });

  it('come back from an autosave before version 3 planned as then too', async () => {
    const ls = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, v), removeItem: () => {} },
    });
    try {
      const active = fx.file.drawers.find((d) => d.name === 'Workbench board')!;
      const state = { drawer: active.drawer, drawers: fx.file.drawers, activeDrawerId: active.id };
      const open = async (version: number, st: object) => {
        ls.set('gridfit-project', JSON.stringify({ version, state: st }));
        vi.resetModules();
        return (await import('../src/state/store')).useStore.getState();
      };
      const old = await open(2, state);
      expect(old.drawer.attachments!.every((a) => a.snap)).toBe(true);
      expect(old.drawers.flatMap((d) => d.drawer.attachments ?? []).every((a) => a.snap)).toBe(true);
      // Kept since: as they are.
      const later = await open(3, { ...state, drawer: { ...active.drawer, attachments: [saved] } });
      expect(later.drawer.attachments!.map((a) => [a.id, a.snap])).toEqual([[saved.id, undefined]]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
