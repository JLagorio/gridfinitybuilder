/**
 * Dragging a board's attachments in the 3D view (Viewer's `drag`, wired up in App). The part keeps where the
 * pointer took hold of it, its anchor goes to the nearest slot where it fits (plan.ts dragAnchor), and the view
 * shows it there, red where it doesn't fit, without planning the board again. The drop moves it for real (one
 * undo step); meanwhile UIState.wallDrag says where it's shown.
 */
import type { Vec2 } from '../lib/geometry/kernel';
import { dragAnchor, type WallBoard, type WallPlacement } from '../lib/wall/plan';
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

export const sameDrag = (a: WallDrag | null | undefined, b: WallDrag | null | undefined) =>
  a === b || (!!a && !!b && a.id === b.id && a.x === b.x && a.y === b.y && a.fits === b.fits);

/** Where a drag that ended puts its attachment: its anchor, or null if it's back where it was. */
export function dropAt(drag: WallDrag | null | undefined, placed: readonly Pick<WallPlacement, 'id' | 'x' | 'y'>[]): Vec2 | null {
  const p = drag && placed.find((q) => q.id === drag.id);
  return p && drag && (drag.x !== p.x || drag.y !== p.y) ? [drag.x, drag.y] : null;
}

/**
 * The scene with the dragged attachment where the drag has it: every item picked as it (its body, extra parts and
 * lock keys) moved along, and red where it doesn't fit.
 */
export function draggedItems(items: SceneItem[], drag: WallDrag | null | undefined, placed: readonly Pick<WallPlacement, 'id' | 'x' | 'y'>[]): SceneItem[] {
  const p = drag && placed.find((q) => q.id === drag.id);
  if (!drag || !p) return items;
  const dx = drag.x - p.x;
  const dy = drag.y - p.y;
  return items.map((it) => {
    if (!it.pickable || it.id !== drag.id) return it;
    const moved = { ...it, x: it.x + dx, y: it.y + dy };
    if (drag.fits) return moved;
    const { paint: _, ...plain } = moved;
    return { ...plain, color: NO_FIT_COLOR, selected: false };
  });
}
