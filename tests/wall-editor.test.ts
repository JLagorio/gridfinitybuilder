import { beforeEach, describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/lib/geometry/kernel';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planPrint } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import type { MountCtx, PlacedAttachment } from '../src/lib/wall';
import { fitsAt, slotKeys, type WallBoard, type WallPlacement } from '../src/lib/wall/plan';
import { nearestFit, overlaps, placeAttachments, type Box } from '../src/lib/wall/place';
import { align, distribute, dragGroup, dragGuides, fitMoves, groupMove, pasteSpot } from '../src/lib/wall/arrange';
import { attachmentSelection, history, useStore } from '../src/state/store';
import {
  addAttachment,
  alignAttachments,
  copyAttachments,
  distributeAttachments,
  duplicateAttachments,
  moveAttachment,
  moveAttachments,
  moveToFit,
  pasteAttachments,
  removeAttachments,
  selectAllAttachments,
  selectAttachment,
  selectAttachments,
  selectedAttachmentIds,
  toggleAttachment,
} from '../src/state/wall';
import { enclosureSceneItems } from '../src/components/enclosureScene';
import { NO_FIT_COLOR, dragMoves, draggedItems, sameDrag } from '../src/components/wallDrag';

// The board editor's everyday tools: parts stay where they're put (red where they don't fit, with the nearest spot that
// does on offer), several move, line up and space out together, guides while dragging, copy, paste and duplicate.

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

/** A board with slots every 20 mm from 20 in, staggered ((i + j) even) as a Skådis board's are. */
function lattice(W = 400, H = 300): WallBoard {
  const slots: Vec2[] = [];
  for (let i = 1; i * 20 < W; i++) for (let j = 1; j * 20 < H; j++) if ((i + j) % 2 === 0) slots.push([i * 20, j * 20]);
  return { W, H, slots, ctx: CTX, outlines: [], front: 25 };
}
const att = (id: string, type: string, x: number, y: number, opts: object = {}): PlacedAttachment => ({ id, type, x, y, opts: { ...opts } });
const place = (list: PlacedAttachment[], board = lattice()) => placeAttachments(list, board);
const at = (p: Pick<WallPlacement, 'x' | 'y'>) => [p.x, p.y];

describe('parts stay where they are put', () => {
  it('on a slot where every mount finds one: there, and nothing to say', () => {
    const { placed, warnings } = place([att('a', 'bin', 100, 100)]);
    expect(at(placed[0])).toEqual([100, 100]);
    expect(placed[0].ok).toBe(true);
    expect('fit' in placed[0]).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('where its mounts don’t all find slots: it stays, red, and the nearest spot that fits is on offer', () => {
    // Its studs hang two rows below its clips: under the bottom row, off the slots.
    const { placed, warnings } = place([att('a', 'bin', 100, 20)]);
    const p = placed[0];
    expect(at(p)).toEqual([100, 20]);
    expect(p.ok).toBe(false);
    // Two rows up, the studs land on the bottom row.
    expect(p.fit).toEqual([100, 60]);
    expect(warnings[0]).toMatch(/doesn't fit where it is.*nearest spot that fits/);
  });

  it('saved off the slots (an older board): to the nearest slot, whether it fits there or not', () => {
    const { placed } = place([att('a', 'bin', 101.3, 99.2), att('b', 'bin', 98.7, 22.4)]);
    expect(at(placed[0])).toEqual([100, 100]);
    expect(placed[0].ok).toBe(true);
    // The old planner would have taken it up to where it fits; now it stays (red) by where it was.
    expect(at(placed[1])).toEqual([100, 20]);
    expect(placed[1].ok).toBe(false);
  });

  it('the spot on offer keeps clear of the others when there is one', () => {
    const board = lattice();
    const { placed } = place([att('a', 'bin', 100, 20), att('b', 'bin', 100, 60)], board);
    const [a, b] = placed;
    const keys = slotKeys(board.slots);
    // Nearest, ignoring the other: right where the other one is.
    expect(nearestFit(board, keys, a, a, [])).toEqual([100, 60]);
    expect(a.fit).not.toEqual([100, 60]);
    const [dx, dy] = [a.fit![0] - a.x, a.fit![1] - a.y];
    const moved: Box = { x0: a.x0 + dx, y0: a.y0 + dy, x1: a.x1 + dx, y1: a.y1 + dy };
    expect(fitsAt(keys, a.layout, CTX, ...a.fit!)).toBe(true);
    expect(overlaps(moved, b)).toBe(false);
  });

  it('nowhere to fit: nothing on offer, and it says so', () => {
    // Its clips span more than the board's slots do.
    const { placed, warnings } = place([att('a', 'bin', 100, 100, { width: 395 })], lattice(200, 300));
    expect(placed[0].ok).toBe(false);
    expect(placed[0].fit).toBeNull();
    expect(warnings[0]).toMatch(/doesn't fit anywhere on this board/);
  });

  it('moving the ones that don’t fit sends two to different spots', () => {
    const board = lattice();
    const { placed } = place([att('a', 'bin', 100, 20), att('b', 'bin', 100, 20)], board);
    const moves = fitMoves(board, placed);
    expect(moves.map((m) => m.id)).toEqual(['a', 'b']);
    const after = place(
      placed.map((p) => ({ id: p.id, type: p.type, x: moves.find((m) => m.id === p.id)!.x, y: moves.find((m) => m.id === p.id)!.y, opts: {} })),
      board,
    );
    expect(after.placed.every((p) => p.ok)).toBe(true);
    expect(after.warnings).toEqual([]);
  });
});

describe('moving several together', () => {
  const board = lattice();
  const keys = slotKeys(board.slots);

  it('by the same lattice steps: they keep their places to each other', () => {
    const { placed } = place([att('a', 'bin', 100, 100), att('b', 'bin', 220, 140)], board);
    const moves = groupMove(board, keys, placed, 40, 0);
    expect(moves).toEqual([
      { id: 'a', x: 140, y: 100, fits: true },
      { id: 'b', x: 260, y: 140, fits: true },
    ]);
  });

  it('red where one doesn’t fit (off the board)', () => {
    const { placed } = place([att('a', 'bin', 100, 100), att('b', 'bin', 220, 140)], board);
    const moves = groupMove(board, keys, placed, -120, 0);
    expect(moves.find((m) => m.id === 'a')!.fits).toBe(false);
    expect(moves.find((m) => m.id === 'b')).toEqual({ id: 'b', x: 100, y: 140, fits: true });
  });

  it('a drag snaps to the nearest spot where all of them fit, if there is one near', () => {
    const { placed } = place([att('a', 'bin', 180, 140), att('b', 'bin', 180, 60)], board);
    expect(placed.every((p) => p.ok)).toBe(true);
    // Across and down: the held one fits there, but the other's studs would drop off the bottom.
    expect(groupMove(board, keys, placed, 40, -40).map((m) => m.fits)).toEqual([true, false]);
    // So they go across only: the same steps for both.
    expect(dragGroup(board, keys, placed, 'a', 220, 100)).toEqual([
      { id: 'a', x: 220, y: 140, fits: true },
      { id: 'b', x: 220, y: 60, fits: true },
    ]);
  });

  it('a drag that would take one off the board keeps the group whole', () => {
    const { placed } = place([att('a', 'bin', 200, 120), att('b', 'bin', 20, 100)], board);
    // Two slots left would put b off the board's left edge: the group stays where they all fit.
    expect(groupMove(board, keys, placed, -40, 0)[1].fits).toBe(false);
    expect(dragGroup(board, keys, placed, 'a', 160, 120)).toEqual([
      { id: 'a', x: 200, y: 120, fits: true },
      { id: 'b', x: 20, y: 100, fits: true },
    ]);
  });

  it('a drag where nothing fits near follows the pointer, red, as far as the board goes', () => {
    const { placed } = place([att('a', 'bin', 180, 140), att('b', 'bin', 180, 60)], board);
    // Down by the bottom edge: b on the bottom row, its studs off the board.
    expect(dragGroup(board, keys, placed, 'a', 180, 60)).toEqual([
      { id: 'a', x: 180, y: 100, fits: true },
      { id: 'b', x: 180, y: 20, fits: false },
    ]);
    // Off the board: nowhere it goes whole (it stays where it was).
    expect(dragGroup(board, keys, placed, 'a', 1000, 140)).toBeNull();
    expect(dragGroup(board, keys, placed, 'nope', 0, 0)).toBeNull();
  });
});

describe('lining up and spacing out, in whole lattice steps', () => {
  const board = lattice(400, 600);
  const keys = slotKeys(board.slots);
  const apply = (placed: WallPlacement[], moves: { id: string; x: number; y: number }[]) =>
    place(
      placed.map((p) => {
        const m = moves.find((q) => q.id === p.id);
        return { id: p.id, type: p.type, x: m?.x ?? p.x, y: m?.y ?? p.y, opts: p.opts as Record<string, unknown> };
      }),
      board,
    ).placed;

  it('left edges: each to the slot that puts its edge on the line, a row up or down if that one has it', () => {
    const { placed } = place([att('a', 'bin', 60, 500), att('b', 'bin', 120, 360), att('c', 'bin', 200, 160)], board);
    const moves = align(board, keys, placed, 'left');
    expect(moves.map((m) => m.id)).toEqual(['b', 'c']);
    const after = apply(placed, moves);
    expect(new Set(after.map((p) => p.x0)).size).toBe(1);
    expect(after.every((p) => p.ok)).toBe(true);
    // (60, 360) isn't a slot on the staggered lattice: the row above or below has one.
    for (const m of moves) expect(Math.abs(m.y - placed.find((p) => p.id === m.id)!.y)).toBe(20);
  });

  it('tops, bottoms, centres and middles', () => {
    const { placed } = place([att('a', 'bin', 60, 500), att('b', 'bin', 240, 360, { height: 60 }), att('c', 'bin', 200, 160, { width: 160 })], board);
    for (const how of ['top', 'bottom', 'middle', 'right', 'centre'] as const) {
      const after = apply(placed, align(board, keys, placed, how));
      const edge = (p: Box) =>
        how === 'top' ? p.y1 : how === 'bottom' ? p.y0 : how === 'middle' ? (p.y0 + p.y1) / 2 : how === 'right' ? p.x1 : (p.x0 + p.x1) / 2;
      const all = after.map(edge);
      // As near the line as the slots allow: within a lattice step.
      expect(Math.max(...all) - Math.min(...all), how).toBeLessThanOrEqual(CTX.pitch);
    }
  });

  it('keeps clear of other parts where it can', () => {
    // b would line up with a's left edge on the row above or below; the one below has c on it.
    const { placed } = place([att('a', 'bin', 60, 500), att('b', 'bin', 120, 360)], board);
    const { placed: other } = place([att('c', 'bin', 60, 260)], board);
    const m = align(board, keys, placed, 'left', [other[0]]);
    expect(m).toEqual([{ id: 'b', x: 60, y: 380, fits: true }]);
    const free = align(board, keys, placed, 'left');
    expect(free[0].x).toBe(60);
  });

  it('spacing out: the outer two stay, the gaps come out the same', () => {
    const { placed } = place([att('a', 'bin', 40, 120), att('b', 'bin', 100, 140), att('c', 'bin', 280, 120)], board);
    const moves = distribute(board, keys, placed, 'x');
    expect(moves.map((m) => m.id)).toEqual(['b']);
    const [a, b, c] = apply(placed, moves);
    expect([a.x, c.x]).toEqual([40, 280]);
    expect(b.x0 - a.x1).toBeCloseTo(c.x0 - b.x1, 6);
    expect(distribute(board, keys, placed.slice(0, 2), 'x')).toEqual([]);
    expect(align(board, keys, placed.slice(0, 1), 'left')).toEqual([]);
  });

  it('spacing out up the board', () => {
    const { placed } = place([att('a', 'bin', 60, 100), att('b', 'bin', 200, 160), att('c', 'bin', 60, 500)], board);
    const [a, b, c] = apply(placed, distribute(board, keys, placed, 'y'));
    expect([a.y, c.y]).toEqual([100, 500]);
    expect(Math.abs(b.y0 - a.y1 - (c.y0 - b.y1))).toBeLessThanOrEqual(2 * CTX.pitch);
  });
});

describe('guides while dragging', () => {
  const moving: Box = { x0: 100, y0: 50, x1: 140, y1: 90 };

  it('a line where an edge or centre lines up, and the gaps to the nearest neighbours', () => {
    const above: Box = { x0: 100, y0: 150, x1: 160, y1: 200 };
    const right: Box = { x0: 200, y0: 60, x1: 260, y1: 90 };
    const farRight: Box = { x0: 300, y0: 60, x1: 320, y1: 90 };
    const { lines, gaps } = dragGuides(moving, [above, right, farRight]);
    expect(lines).toContainEqual({ axis: 'x', at: 100, from: 50, to: 200 });
    expect(lines).toContainEqual({ axis: 'y', at: 90, from: 100, to: 320 });
    expect(gaps).toContainEqual({ axis: 'x', from: 140, to: 200, at: 75, mm: 60 });
    expect(gaps).toContainEqual({ axis: 'y', from: 90, to: 150, at: 120, mm: 60 });
    // Only the nearest on each side.
    expect(gaps.filter((g) => g.axis === 'x')).toHaveLength(1);
  });

  it('centres count too; nothing near, no guides', () => {
    expect(dragGuides(moving, [{ x0: 110, y0: 200, x1: 130, y1: 220 }]).lines).toContainEqual({ axis: 'x', at: 120, from: 50, to: 220 });
    expect(dragGuides(moving, [{ x0: 301, y0: 301, x1: 333, y1: 333 }])).toEqual({ lines: [], gaps: [] });
  });
});

describe('where copies go', () => {
  const board = lattice();
  const keys = slotKeys(board.slots);
  const item = (p: WallPlacement) => ({ x: p.x, y: p.y, layout: p.layout, box: { x0: p.x0 - p.x, y0: p.y0 - p.y, x1: p.x1 - p.x, y1: p.y1 - p.y } });

  it('as far apart as the originals, on the nearest free spot that fits', () => {
    const { placed } = place([att('a', 'bin', 100, 100), att('b', 'bin', 100, 180)], board);
    const spots = pasteSpot(board, keys, placed.map(item), placed, [100, 100])!;
    expect(spots[1][0] - spots[0][0]).toBe(0);
    expect(spots[1][1] - spots[0][1]).toBe(80);
    // Not on the originals.
    expect(spots[0]).not.toEqual([100, 100]);
    const after = place([...placed.map((p) => att(p.id, p.type, p.x, p.y)), att('a2', 'bin', ...spots[0]), att('b2', 'bin', ...spots[1])], board);
    expect(after.warnings).toEqual([]);
  });

  it('nowhere free: where they fit; on a board without slots, nowhere', () => {
    // A board two bins high with one as wide as it on the bottom: the only other spot it fits overlaps it.
    const low = lattice(400, 140);
    const { placed } = place([att('a', 'bin', 20, 60, { width: 380 })], low);
    expect(placed[0].ok).toBe(true);
    expect(pasteSpot(low, slotKeys(low.slots), placed.map(item), placed, [20, 60])).toEqual([[20, 60]]);
    expect(pasteSpot(low, slotKeys(low.slots), placed.map(item), [], [20, 60])).toEqual([[20, 60]]);
    expect(pasteSpot({ ...board, slots: [] }, keys, placed.map(item), [], [0, 0])).toBeNull();
  });
});

describe('editing the selection (state/wall.ts)', () => {
  const s = () => useStore.getState();
  const wall = () => {
    const d = { id: s().activeDrawerId, name: 'Board', drawer: s().drawer, baseplate: s().baseplate, bins: s().bins };
    return planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true }).drawers[0].enclosure!.wall!;
  };
  const list = () => s().drawer.attachments ?? [];
  const add = (type = 'bin') => {
    const w = wall();
    return addAttachment(type, w.board, w.placed)!;
  };

  beforeEach(() => {
    s().resetAll();
    s().addDrawer('Board', { skadis: true });
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 } });
    history.clear();
  });

  it('selects several: the primary first, Shift-click toggles, select all', () => {
    const a = add();
    const b = add();
    const c = add();
    selectAttachment(a);
    toggleAttachment(b);
    expect(selectedAttachmentIds()).toEqual([b, a]);
    toggleAttachment(b);
    expect(selectedAttachmentIds()).toEqual([a]);
    selectAllAttachments();
    expect(selectedAttachmentIds().sort()).toEqual([a, b, c].sort());
    // Setting only the primary still means a single selection.
    s().setUI({ selectedAttachment: c, selectedAttachments: [a, b] });
    expect(attachmentSelection(s().ui)).toEqual([c]);
  });

  it('moves several as one undo step, and deletes them, keeping the rest selected', () => {
    const a = add();
    const b = add();
    const c = add();
    history.clear();
    const before = list().map((q) => [q.x, q.y]);
    moveAttachments(list().map((q) => ({ id: q.id, x: q.x, y: q.y + 40 })));
    expect(list().map((q) => [q.x, q.y])).toEqual(before.map(([x, y]) => [x, y + 40]));
    history.undo();
    expect(list().map((q) => [q.x, q.y])).toEqual(before);
    selectAttachments([a, b, c]);
    removeAttachments([a, b]);
    expect(list().map((q) => q.id)).toEqual([c]);
    expect(selectedAttachmentIds()).toEqual([c]);
    history.undo();
    expect(list()).toHaveLength(3);
  });

  it('copy and paste: new ids, as far apart as the originals, beside them, selected, one undo step', () => {
    const a = add();
    const b = add();
    const [pa, pb] = [a, b].map((id) => list().find((q) => q.id === id)!);
    expect(copyAttachments([a, b])).toBe(2);
    history.clear();
    const ids = pasteAttachments(wall().board);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(selectedAttachmentIds()).toEqual(ids);
    const [ca, cb] = ids.map((id) => list().find((q) => q.id === id)!);
    expect([cb.x - ca.x, cb.y - ca.y]).toEqual([pb.x - pa.x, pb.y - pa.y]);
    expect(ca.type).toBe(pa.type);
    const w = wall();
    expect(w.placed.every((p) => p.ok)).toBe(true);
    expect(placeAttachments(list(), w.board).warnings).toEqual([]);
    history.undo();
    expect(list().map((q) => q.id)).toEqual([a, b]);
  });

  it('pastes at the pointer, and duplicates without touching what was copied', () => {
    const a = add();
    copyAttachments([a]);
    const [p] = pasteAttachments(wall().board, [300, 200]);
    const pp = wall().placed.find((q) => q.id === p)!;
    expect(Math.hypot((pp.x0 + pp.x1) / 2 - 300, (pp.y0 + pp.y1) / 2 - 200)).toBeLessThanOrEqual(2 * 20);
    const [d] = duplicateAttachments([p], wall().board);
    expect(list().find((q) => q.id === d)!.type).toBe('bin');
    expect(list()).toHaveLength(3);
    // What was copied is still the first one.
    const [again] = pasteAttachments(wall().board);
    expect(list().find((q) => q.id === again)!.opts).toEqual(list().find((q) => q.id === a)!.opts);
  });

  it('pastes on another board of the project, where they were on the first', () => {
    const a = add();
    moveAttachment(a, list()[0].x, list()[0].y);
    const pa = list()[0];
    copyAttachments([a]);
    s().addDrawer('Other', { skadis: true });
    s().setDrawer({ skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 } });
    const [p] = pasteAttachments(wall().board);
    const q = list().find((x) => x.id === p)!;
    expect([q.x, q.y]).toEqual([pa.x, pa.y]);
    expect(q.id).not.toBe(a);
  });

  it('moves one that doesn’t fit to the nearest spot that does, one undo step; lines several up', () => {
    const a = add();
    const w = wall();
    // The bottom row of slots: its studs drop off the board.
    const low = [...w.board.slots].sort((p, q) => p[1] - q[1] || p[0] - q[0])[4];
    moveAttachment(a, low[0], low[1]);
    let p = wall().placed[0];
    expect(p.ok).toBe(false);
    expect(at(p)).toEqual(low);
    history.clear();
    moveToFit([a], wall().board);
    p = wall().placed[0];
    expect(p.ok).toBe(true);
    history.undo();
    expect(at(wall().placed[0])).toEqual(low);
    history.redo();
    const b = add();
    const before = list().map((q) => [q.x, q.y]);
    history.clear();
    alignAttachments([a, b], 'top', wall().board);
    const [qa, qb] = wall().placed;
    expect(Math.abs(qa.y1 - qb.y1)).toBeLessThanOrEqual(20);
    expect(list().map((q) => [q.x, q.y])).not.toEqual(before);
    history.undo();
    expect(list().map((q) => [q.x, q.y])).toEqual(before);
    expect(history.canUndo()).toBe(false);
    // Spacing out takes three.
    distributeAttachments([a, b], 'x', wall().board);
    expect(list().map((q) => [q.x, q.y])).toEqual(before);
  });
});

describe('dragging several in the 3D view', () => {
  const board = {
    id: 'b',
    name: 'Board',
    drawer: {
      ...useStore.getState().drawer,
      enclosure: 'skadis' as const,
      skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 },
      attachments: [att('h', 'hook', 100, 100), att('n', 'bin', 300, 100)],
    },
    baseplate: useStore.getState().baseplate,
    bins: [],
  };
  const enc = planPrint([board], DEFAULT_SETUP, { baseplate: true, bins: true }).drawers[0].enclosure!;
  const placed = enc.wall!.placed;
  const items = enclosureSceneItems(enc, 'open', 0).map((it) => (it.pickable ? { ...it, selected: true } : it));
  const [h, n] = placed;

  it('moves every item of every part in it, red where one doesn’t fit', () => {
    const drag = { id: 'h', x: h.x + 40, y: h.y, fits: true, group: [{ id: 'n', x: n.x + 40, y: n.y, fits: false }] };
    expect(dragMoves(drag).map((m) => m.id)).toEqual(['h', 'n']);
    const out = draggedItems(items, drag, placed);
    out.forEach((it, i) => {
      if (!it.pickable) return expect(it).toBe(items[i]);
      expect(it.x - items[i].x).toBe(40);
      if (it.id === 'n') expect(it.color).toBe(NO_FIT_COLOR);
      else expect(it.selected).toBe(true);
    });
  });

  it('knows the same drag, group and all', () => {
    const a = { id: 'h', x: 1, y: 2, fits: true, group: [{ id: 'n', x: 3, y: 4, fits: true }] };
    expect(sameDrag(a, structuredClone(a))).toBe(true);
    expect(sameDrag(a, { ...a, group: [{ id: 'n', x: 3, y: 4, fits: false }] })).toBe(false);
    expect(sameDrag(a, { id: 'h', x: 1, y: 2, fits: true })).toBe(false);
  });
});
