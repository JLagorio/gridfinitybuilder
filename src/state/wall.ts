/**
 * Editing a Skådis board's attachments (DrawerInput.attachments, lib/wall):
 * each edit is one undo step, through the drawer like the board's settings.
 */
import { history, useStore } from './store';
import { newId } from '../lib/bins';
import { attachmentDef, type PlacedAttachment } from '../lib/wall';
import '../lib/wall/kinds/all';
import { attachmentLayout, slotKeys, snapAnchor, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import { partBounds } from '../lib/wall/mount';

const list = () => useStore.getState().drawer.attachments ?? [];

function write(next: PlacedAttachment[], select?: string | null) {
  const s = useStore.getState();
  history.checkpoint();
  useStore.setState({
    drawer: { ...s.drawer, attachments: next },
    ...(select !== undefined ? { ui: { ...s.ui, selectedAttachment: select } } : {}),
  });
  history.checkpoint();
}

export function selectAttachment(id: string | null) {
  const s = useStore.getState();
  if ((s.ui.selectedAttachment ?? null) !== id) useStore.setState({ ui: { ...s.ui, selectedAttachment: id } });
}

/**
 * A new attachment of `type`, at `at` (snapped), or else at the first place
 * from the top left where it fits on the board without covering another.
 */
export function addAttachment(type: string, board: WallBoard, placed: readonly WallPlacement[], at?: [number, number]): string | null {
  const def = attachmentDef(type);
  if (!def) return null;
  const opts = { ...def.defaults } as Record<string, unknown>;
  const l = attachmentLayout({ type, opts }, board.ctx);
  if (!l) return null;
  const keys = slotKeys(board.slots);
  const b = partBounds(l.layout, board.ctx);
  const free = (x: number, y: number) => {
    const x0 = x - l.layout.anchor[0] + b.x0;
    const y0 = y - l.layout.anchor[1] + b.y0;
    const x1 = x - l.layout.anchor[0] + b.x1;
    const y1 = y - l.layout.anchor[1] + b.y1;
    if (x0 < -0.5 || y0 < -0.5 || x1 > board.W + 0.5 || y1 > board.H + 0.5) return false;
    return placed.every((p) => !(x0 < p.x1 && p.x0 < x1 && y0 < p.y1 && p.y0 < y1));
  };
  let spot: [number, number] | null = at ? snapAnchor(board.slots, keys, l.layout, board.ctx, at[0], at[1]) : null;
  if (!spot) {
    // Top to bottom, left to right.
    const order = [...board.slots].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    spot = order.find(([x, y]) => snapAnchor([[x, y]], keys, l.layout, board.ctx, x, y) && free(x, y)) ?? null;
  }
  if (!spot) spot = board.slots.length ? snapAnchor(board.slots, keys, l.layout, board.ctx, board.W / 2, board.H / 2) : null;
  const [x, y] = spot ?? [board.W / 2, board.H / 2];
  const id = newId();
  write([...list(), { id, type, x, y, opts }], id);
  return id;
}

export function updateAttachment(id: string, patch: Partial<Omit<PlacedAttachment, 'id'>>) {
  write(list().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

/** Change some of an attachment's options. */
export function setAttachmentOpts(id: string, patch: Record<string, unknown>) {
  write(list().map((a) => (a.id === id ? { ...a, opts: { ...a.opts, ...patch } } : a)));
}

export function moveAttachment(id: string, x: number, y: number) {
  const a = list().find((q) => q.id === id);
  if (a && (a.x !== x || a.y !== y)) updateAttachment(id, { x, y });
}

export function removeAttachment(id: string) {
  const s = useStore.getState();
  write(
    list().filter((a) => a.id !== id),
    s.ui.selectedAttachment === id ? null : undefined,
  );
}

/** A copy beside it: the next place to the right (or anywhere free). */
export function duplicateAttachment(id: string, board: WallBoard, placed: readonly WallPlacement[]): string | null {
  const a = list().find((q) => q.id === id);
  const p = placed.find((q) => q.id === id);
  if (!a) return null;
  const nid = newId();
  const keys = slotKeys(board.slots);
  const l = attachmentLayout(a, board.ctx);
  const w = p ? p.x1 - p.x0 : 40;
  const step = 2 * board.ctx.pitch;
  const right = Math.ceil((w + 2) / step) * step;
  const spot = l ? snapAnchor(board.slots, keys, l.layout, board.ctx, a.x + right, a.y) : null;
  const [x, y] = spot ?? [a.x + right, a.y];
  write([...list(), { ...structuredClone(a), id: nid, x, y }], nid);
  return nid;
}
