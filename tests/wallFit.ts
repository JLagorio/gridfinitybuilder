// Planning leaves each attachment where it's put (src/lib/wall/plan.ts placeAttachments), red where its mounts don't
// all find slots. Tests that put parts at round numbers move them first to where they fit, as the board editor's
// "Move to the nearest spot that fits" does.
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import type { PlacedAttachment } from '../src/lib/wall';
import { fitMoves } from '../src/lib/wall/arrange';

/** The board with each attachment that doesn't fit where it is moved to the nearest spot where it does. */
export function fitted(d: NamedDrawer): NamedDrawer {
  const wall = planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true }).drawers[0].enclosure?.wall;
  const to = new Map((wall ? fitMoves(wall.board, wall.placed) : []).map((m) => [m.id, m]));
  const move = (a: PlacedAttachment) => (to.has(a.id) ? { ...a, x: to.get(a.id)!.x, y: to.get(a.id)!.y } : a);
  return { ...d, drawer: { ...d.drawer, attachments: (d.drawer.attachments ?? []).map(move) } };
}
