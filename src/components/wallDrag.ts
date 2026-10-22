/**
 * Dragging a board's attachments in the 3D view (Viewer's `drag`, wired up in App). The part keeps where the
 * pointer took hold of it, its anchor goes to the nearest slot where it fits (plan.ts dragAnchor), and the view
 * shows it there, red where it doesn't fit, without planning the board again. Grabbing one of several selected
 * moves them all by the same slots (lib/wall/arrange.ts dragGroup: UIState.wallDrag's `group`). The drop moves
 * them for real (one undo step); meanwhile UIState.wallDrag says where they're shown.
 */
import type { Vec2 } from '../lib/geometry/kernel';
import { dragAnchor } from '../lib/wall/board';
import type { WallBoard, WallPlacement } from '../lib/wall/plan';
import type { UIState } from '../state/store';
import type { SceneItem } from './Viewer';

/** Where a dragged attachment is shown: its anchor slot, and whether all its mounts have slots there. */
export type WallDrag = NonNullable<UIState['wallDrag']>;

/** A dragged attachment that doesn't fit where it is, in the board editor's red. */
export const NO_FIT_COLOR = '#f0616a';

/** The anchor's offset from where the pointer took hold of `p` (on the board's front), so the part doesn't jump to the pointer. */
export const grabOffset = (p: Pick<WallPlacement, 'x' | 'y'>, x: number, y: number): Vec2 => [p.x - x, p.y - y];

/** Where `p` goes with the pointer at (x, y) on the board's front, held at `grab` (grabOffset); null on a board without slots. */
export function wallDragAt(
  board: Pick<WallBoard, 'slots' | 'ctx'>,
  keys: ReadonlySet<string>,
  p: Pick<WallPlacement, 'id' | 'layout'>,
  grab: Vec2,
  x: number,
  y: number,
): WallDrag | null {
  const r = dragAnchor(board.slots, keys, p.layout, board.ctx, x + grab[0], y + grab[1]);
  return r ? { id: p.id, x: r.at[0], y: r.at[1], fits: r.fits } : null;
}

/** Every part a drag moves, the one held first. */
export const dragMoves = (d: WallDrag | null | undefined): Omit<WallDrag, 'group'>[] => (d ? [d, ...(d.group ?? [])] : []);

export const sameDrag = (a: WallDrag | null | undefined, b: WallDrag | null | undefined) => {
  const [p, q] = [dragMoves(a), dragMoves(b)];
  return a === b || (!!a && p.length === q.length && p.every((m, i) => m.id === q[i].id && m.x === q[i].x && m.y === q[i].y && m.fits === q[i].fits));
};

/** Where a drag that ended puts its attachment: its anchor, or null if it's back where it was. */
export function dropAt(drag: WallDrag | null | undefined, placed: readonly Pick<WallPlacement, 'id' | 'x' | 'y'>[]): Vec2 | null {
  const p = drag && placed.find((q) => q.id === drag.id);
  return p && drag && (drag.x !== p.x || drag.y !== p.y) ? [drag.x, drag.y] : null;
}

/**
 * The scene with the dragged attachments where the drag has them: every item picked as one (its body, extra parts
 * and lock keys) moved along, and red where it doesn't fit.
 */
export function draggedItems(items: SceneItem[], drag: WallDrag | null | undefined, placed: readonly Pick<WallPlacement, 'id' | 'x' | 'y'>[]): SceneItem[] {
  const to = new Map(
    dragMoves(drag).flatMap((m) => {
      const p = placed.find((q) => q.id === m.id);
      return p ? [[m.id, { dx: m.x - p.x, dy: m.y - p.y, fits: m.fits }] as const] : [];
    }),
  );
  if (!drag || !to.has(drag.id)) return items;
  return items.map((it) => {
    const m = it.pickable ? to.get(it.id) : undefined;
    if (!m) return it;
    const moved = { ...it, x: it.x + m.dx, y: it.y + m.dy };
    if (m.fits) return moved;
    const { paint: _, ...plain } = moved;
    return { ...plain, color: NO_FIT_COLOR, selected: false };
  });
}
