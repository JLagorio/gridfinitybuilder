import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { slotKeys, snapAnchor } from '../src/lib/wall/plan';
import { enclosureSceneItems } from '../src/components/enclosureScene';
import { rayPlaneZ } from '../src/components/viewerTools';
import { NO_FIT_COLOR, draggedItems, dropAt, grabOffset, sameDrag, wallDragAt } from '../src/components/wallDrag';

// Dragging a board's attachments in the 3D view: the pointer on the board's front, the grab, the snap, the scene.

const board: NamedDrawer = {
  id: 'b',
  name: 'Board',
  drawer: {
    ...DEFAULT_DRAWER,
    enclosure: 'skadis',
    skadis: { ...DEFAULT_SKADIS, width: 400, height: 300 },
    attachments: [
      // A hook (with a lock key: an item of its own) and a bin.
      { id: 'h', type: 'hook', x: 100, y: 100, opts: {} },
      { id: 'n', type: 'bin', x: 300, y: 100, opts: {} },
    ],
  },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
};
const enc = planPrint([board], DEFAULT_SETUP, { baseplate: true, bins: true }).drawers[0].enclosure!;
const wall = enc.wall!;
const keys = slotKeys(wall.board.slots);
const hook = wall.placed.find((p) => p.id === 'h')!;

describe('the pointer on a plane', () => {
  it('meets a horizontal plane along the ray, from above or below', () => {
    expect(rayPlaneZ([10, 20, 100], [0, 0, -1], 25)).toEqual([10, 20]);
    // Not normalised: the same point either way.
    expect(rayPlaneZ([0, 0, 100], [1, 2, -1], 0)).toEqual([100, 200]);
    expect(rayPlaneZ([0, 0, 100], [0.5, 1, -0.5], 0)).toEqual([100, 200]);
    expect(rayPlaneZ([5, 5, -50], [0, 0, 1], 25)).toEqual([5, 5]);
  });

  it('misses it along the plane or looking away', () => {
    expect(rayPlaneZ([0, 0, 100], [1, 0, 0], 25)).toBeNull();
    expect(rayPlaneZ([0, 0, 100], [0, 0.2, 1], 25)).toBeNull();
  });
});

describe('dragging an attachment', () => {
  // Taken hold of on its face, well below its anchor (the top of its back).
  const press: [number, number] = [hook.x + 1.3, hook.y - 29.8];
  const grab = grabOffset(hook, ...press);

  it('stays put until the pointer moves, held where it was taken', () => {
    expect(wallDragAt(wall.board, keys, hook, grab, ...press)).toEqual({ id: 'h', x: hook.x, y: hook.y, fits: true });
    // Without the grab it would jump to a slot by the pointer.
    expect(wallDragAt(wall.board, keys, hook, [0, 0], ...press)).not.toEqual({ id: 'h', x: hook.x, y: hook.y, fits: true });
  });

  it('moves slot by slot with the pointer, to the nearest slot where it fits', () => {
    // One slot along the row is two lattice steps.
    expect(wallDragAt(wall.board, keys, hook, grab, press[0] + 40, press[1])).toEqual({ id: 'h', x: hook.x + 40, y: hook.y, fits: true });
    expect(wallDragAt(wall.board, keys, hook, grab, press[0] + 40, press[1] + 40)).toEqual({ id: 'h', x: hook.x + 40, y: hook.y + 40, fits: true });
    const s = snapAnchor(wall.board.slots, keys, hook.layout, wall.board.ctx, hook.x + 18, hook.y + 7)!;
    expect(wallDragAt(wall.board, keys, hook, grab, press[0] + 18, press[1] + 7)).toEqual({ id: 'h', x: s[0], y: s[1], fits: true });
  });

  it('follows the pointer off the board, where it doesn’t fit', () => {
    const r = wallDragAt(wall.board, keys, hook, grab, -500, -500)!;
    expect(r.fits).toBe(false);
    expect(keys.has(`${r.x},${r.y}`)).toBe(true);
  });

  it('drops where it was shown, or nowhere if it came back', () => {
    expect(dropAt({ id: 'h', x: hook.x + 40, y: hook.y, fits: true }, wall.placed)).toEqual([hook.x + 40, hook.y]);
    expect(dropAt({ id: 'h', x: hook.x + 40, y: hook.y, fits: false }, wall.placed)).toEqual([hook.x + 40, hook.y]);
    expect(dropAt({ id: 'h', x: hook.x, y: hook.y, fits: true }, wall.placed)).toBeNull();
    expect(dropAt({ id: 'gone', x: 0, y: 0, fits: true }, wall.placed)).toBeNull();
    expect(dropAt(null, wall.placed)).toBeNull();
  });

  it('knows the same spot', () => {
    const a = { id: 'h', x: 1, y: 2, fits: true };
    expect(sameDrag(a, { ...a })).toBe(true);
    expect(sameDrag(a, { ...a, fits: false })).toBe(false);
    expect(sameDrag(a, null)).toBe(false);
    expect(sameDrag(null, undefined)).toBe(false);
    expect(sameDrag(null, null)).toBe(true);
  });
});

describe('the scene while dragging', () => {
  // As App shows it: the selected attachment's items highlighted, in their filament colours otherwise.
  const items = enclosureSceneItems(enc, 'open', 0).map((it) => (it.pickable ? { ...it, selected: it.id === 'h', paint: { main: '#123456' } } : it));
  const mine = items.filter((it) => it.pickable && it.id === 'h');

  it('picks the body and its lock key as the attachment, both selected', () => {
    expect(mine).toHaveLength(2);
    expect(mine.every((it) => it.selected)).toBe(true);
  });

  it('moves every item of the dragged attachment, and nothing else', () => {
    const out = draggedItems(items, { id: 'h', x: hook.x + 40, y: hook.y + 20, fits: true }, wall.placed);
    expect(out).toHaveLength(items.length);
    out.forEach((it, i) => {
      if (it.pickable && it.id === 'h') {
        expect([it.x - items[i].x, it.y - items[i].y, it.z]).toEqual([40, 20, items[i].z]);
        expect(it.selected).toBe(true);
        expect(it.paint).toEqual({ main: '#123456' });
      } else expect(it).toBe(items[i]);
    });
  });

  it('shows it red where it doesn’t fit', () => {
    const out = draggedItems(items, { id: 'h', x: hook.x, y: hook.y, fits: false }, wall.placed).filter((it) => it.pickable && it.id === 'h');
    expect(out).toHaveLength(2);
    for (const it of out) {
      expect(it.color).toBe(NO_FIT_COLOR);
      expect(it.selected).toBe(false);
      expect('paint' in it).toBe(false);
    }
  });

  it('is the scene as it was without a drag', () => {
    expect(draggedItems(items, null, wall.placed)).toBe(items);
    expect(draggedItems(items, { id: 'gone', x: 0, y: 0, fits: true }, wall.placed)).toBe(items);
  });
});

describe('the drag in the store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is never an undo step, and never saved', async () => {
    // Autosave goes to window.localStorage.
    const ls = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, v), removeItem: () => {} },
    });
    vi.resetModules();
    const { history, useStore } = await import('../src/state/store');
    const s = useStore.getState();
    s.setUI({ tab: 'bins', selectedAttachment: 'h' });
    history.clear();
    s.setUI({ wallDrag: { id: 'h', x: 140, y: 100, fits: true } });
    s.setUI({ wallDrag: { id: 'h', x: 180, y: 100, fits: false } });
    expect(useStore.getState().ui.wallDrag).toEqual({ id: 'h', x: 180, y: 100, fits: false });
    expect(history.canUndo()).toBe(false);
    const saved = JSON.parse(ls.get('gridfit-project')!);
    expect(saved.state.ui.wallDrag).toBeNull();
    expect(saved.state.ui.selectedAttachment).toBe('h');
  });
});
