import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadis';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { attachmentDef, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { placeAttachments } from '../src/lib/wall/place';
import { BOARD_TEMPLATES, boardOf, boardTemplate, fitTemplate, templateAttachment, templateSkadis, type BoardTemplate } from '../src/lib/wall/templates';
import { applyTemplate, newBoardFromTemplate } from '../src/state/boardTemplates';
import { history, useStore } from '../src/state/store';

const boardDrawer = (skadis: SkadisOptions, attachments: PlacedAttachment[], name = 'Board'): NamedDrawer => ({
  id: 'b',
  name,
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (d: NamedDrawer) => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });
let n = 0;
const ids = () => `t${n++}`;

/** A template on its own board, planned. */
function onItsBoard(t: BoardTemplate) {
  const skadis = templateSkadis(t);
  const board = boardOf(skadis, DEFAULT_SETUP)!;
  const fit = fitTemplate(t, board, [], ids);
  return { board, fit, job: plan(boardDrawer(skadis, fit.list, t.name)) };
}

describe('board templates', () => {
  it('has the seven starter boards, each named and described', () => {
    expect(BOARD_TEMPLATES.map((t) => t.name)).toEqual([
      '3D printing corner',
      'Electronics bench',
      'Paint station',
      'Kitchen wall',
      'Garage tools',
      'Desk & gaming',
      'Craft & sewing',
    ]);
    expect(new Set(BOARD_TEMPLATES.map((t) => t.id)).size).toBe(BOARD_TEMPLATES.length);
    for (const t of BOARD_TEMPLATES) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.description.length, t.name).toBeLessThan(120);
      expect(t.items.length, t.name).toBeGreaterThanOrEqual(8);
      expect(boardTemplate(t.id)).toBe(t);
    }
  });

  it('uses kinds that exist, with presets their forms have', () => {
    for (const t of BOARD_TEMPLATES) {
      for (const item of t.items) {
        expect(attachmentDef(item.type), `${t.name}: ${item.type}`).not.toBeNull();
        if (item.preset) {
          const presets = attachmentUi(item.type)!.fields.flatMap((f) => (f.kind === 'preset' ? f.presets.map((p) => p.value) : []));
          expect(presets, `${t.name}: ${item.type} ${item.preset}`).toContain(item.preset);
        }
        // Options of its own are options of its kind.
        for (const k of Object.keys(item.opts ?? {})) expect(attachmentDef(item.type)!.defaults, `${item.type}.${k}`).toHaveProperty(k);
        const a = templateAttachment(item, 'x')!;
        expect(a.opts).toEqual(attachmentDef(item.type)!.sanitize(a.opts));
      }
    }
  });

  it('takes a preset, then its own options over it', () => {
    const a = templateAttachment({ type: 'bottleRack', preset: 'spice46', opts: { columns: 4 }, at: [0, 0] }, 'x')!;
    expect(a.opts).toMatchObject({ diameter: 45, columns: 4 });
    expect(templateAttachment({ type: 'bottleRack', preset: 'nope', at: [0, 0] })).toBeNull();
    expect(templateAttachment({ type: 'nope', at: [0, 0] })).toBeNull();
  });

  for (const t of BOARD_TEMPLATES) {
    it(`${t.name}: every part on its board, on slots, no warnings`, () => {
      const { board, fit, job } = onItsBoard(t);
      expect(fit.left).toEqual([]);
      expect(fit.list).toHaveLength(t.items.length);
      expect(job.warnings).toEqual([]);
      const wall = job.drawers[0].enclosure!.wall!;
      expect(wall.placed.map((p) => p.ok)).toEqual(fit.list.map(() => true));
      // Where planning put each is where the template did (an anchor on a slot), and every mount is on one.
      const slots = new Set(board.slots.map(([x, y]) => `${x},${y}`));
      for (const a of fit.list) {
        const p = wall.placed.find((q) => q.id === a.id)!;
        expect([p.x, p.y], p.name).toEqual([a.x, a.y]);
        expect(slots.has(`${a.x},${a.y}`), p.name).toBe(true);
        for (const m of p.mounts) expect(slots.has(`${m.x},${m.y}`), p.name).toBe(true);
        // On the board, clear of its edges.
        expect(p.x0).toBeGreaterThanOrEqual(0);
        expect(p.y0).toBeGreaterThanOrEqual(0);
        expect(p.x1).toBeLessThanOrEqual(board.W);
        expect(p.y1).toBeLessThanOrEqual(board.H);
      }
      // Every part prints (on the default printer's plates).
      const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
      const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
      for (const p of parts) expect(onPlates.has(p.key), p.name).toBe(true);
      // Names and contents come along.
      expect(fit.list.filter((a) => a.name).length).toBeGreaterThan(t.items.length / 2);
      expect(new Set(fit.list.map((a) => a.id)).size).toBe(fit.list.length);
    });
  }

  it('puts a template around what is on a board already, and leaves out what has no room', () => {
    const t = boardTemplate('print3d')!;
    const { board, fit } = onItsBoard(t);
    const { placed } = placeAttachments(fit.list, board);
    // The same set again on the same board: what goes on keeps clear of the first.
    const again = fitTemplate(t, board, placed, ids);
    expect(again.left.length).toBeGreaterThan(0);
    expect(again.list.length + again.left.length).toBe(t.items.length);
    const job = plan(boardDrawer(templateSkadis(t), [...fit.list, ...again.list]));
    expect(job.warnings).toEqual([]);
  });

  it('fits what it can on a smaller board, and on a twice as big one spreads out', () => {
    const t = boardTemplate('garage')!;
    const small = { ...DEFAULT_SKADIS, width: 360, height: 360 };
    const fit = fitTemplate(t, boardOf(small, DEFAULT_SETUP)!, [], ids);
    expect(fit.left.length).toBeGreaterThan(0);
    expect(fit.list.length).toBeGreaterThan(0);
    expect(plan(boardDrawer(small, fit.list)).warnings).toEqual([]);
    const big = { ...DEFAULT_SKADIS, width: 1520, height: 1120 };
    const bigFit = fitTemplate(t, boardOf(big, DEFAULT_SETUP)!, [], ids);
    expect(bigFit.left).toEqual([]);
    expect(plan(boardDrawer(big, bigFit.list)).warnings).toEqual([]);
    // Scaled to the board: the drill dock is still at the top left.
    const drill = bigFit.list[0];
    expect(drill.x).toBeLessThan(big.width / 4);
    expect(drill.y).toBeGreaterThan(big.height * 0.75);
  });

  it('keeps off a frame’s rim, and fits hexagon boards', () => {
    const t = boardTemplate('craft')!;
    const framed = templateSkadis(t, { ...DEFAULT_SKADIS, frame: 'rim' });
    const fit = fitTemplate(t, boardOf(framed, DEFAULT_SETUP)!, [], ids);
    expect(fit.list.length).toBeGreaterThan(5);
    expect(plan(boardDrawer(framed, fit.list)).warnings).toEqual([]);
    const hex = templateSkadis(t, { ...DEFAULT_SKADIS, shape: 'hex' });
    const hexFit = fitTemplate(t, boardOf(hex, DEFAULT_SETUP)!, [], ids);
    expect(hexFit.list.length).toBeGreaterThan(0);
    expect(plan(boardDrawer(hex, hexFit.list)).warnings).toEqual([]);
  });
});

describe('starter boards in the project', () => {
  const s = () => useStore.getState();
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });

  it('a new board from a template is one undo step', () => {
    const before = s().drawers.length;
    const t = boardTemplate('print3d')!;
    const r = newBoardFromTemplate(t);
    expect(r).toEqual({ added: t.items.length, left: [] });
    expect(s().drawers).toHaveLength(before + 1);
    const doc = s().drawers.find((d) => d.id === s().activeDrawerId)!;
    expect(doc.name).toBe('3D printing corner');
    expect(s().drawer.enclosure).toBe('skadis');
    expect(s().drawer.skadis).toMatchObject({ width: 560, height: 560 });
    expect(s().drawer.attachments).toHaveLength(t.items.length);
    expect(s().ui.tab).toBe('bins');
    history.undo();
    expect(s().drawers).toHaveLength(before);
    expect(s().drawer.enclosure).toBeUndefined();
  });

  it('on a board with parts: replaces them, or adds around them', () => {
    newBoardFromTemplate(boardTemplate('desk')!);
    const first = s().drawer.attachments!.map((a) => a.id);
    const t = boardTemplate('electronics')!;
    const added = applyTemplate(t, 'add')!;
    const now = s().drawer.attachments!;
    expect(now.slice(0, first.length).map((a) => a.id)).toEqual(first);
    expect(now.length).toBe(first.length + added.added);
    expect(
      planPrint(
        s().drawers.map((d) => (d.id === s().activeDrawerId ? { ...d, drawer: s().drawer } : d)),
        DEFAULT_SETUP,
        s().include,
      ).warnings,
    ).toEqual([]);
    // The desk board is 760 × 400 and keeps its size: the electronics bench doesn't all fit.
    expect(s().drawer.skadis).toMatchObject({ width: 760, height: 400 });
    const replaced = applyTemplate(t, 'replace')!;
    expect(s().drawer.attachments).toHaveLength(replaced.added);
    expect(s().drawer.attachments!.some((a) => first.includes(a.id))).toBe(false);
    history.undo();
    expect(s().drawer.attachments).toHaveLength(now.length);
  });

  it('applies only to a board', () => {
    expect(applyTemplate(boardTemplate('paint')!, 'replace')).toBeNull();
  });
});
