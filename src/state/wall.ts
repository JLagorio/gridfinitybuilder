/**
 * Editing a Skådis board's attachments (DrawerInput.attachments, lib/wall):
 * each edit is one undo step, through the drawer like the board's settings.
 * Several can be selected (UIState.selectedAttachments, the primary first):
 * they move, line up, copy and go together (lib/wall/arrange.ts does the math).
 */
import { attachmentSelection, history, useStore } from './store';
import { newId } from '../lib/bins';
import type { Vec2 } from '../lib/geometry/kernel';
import { attachmentDef, type PlacedAttachment } from '../lib/wall';
import '../lib/wall/kinds/all';
import { attachmentLayout, nearestSlot, slotKeys, snapAnchor, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import { placeAttachments, type Box } from '../lib/wall/place';
import { partBounds } from '../lib/wall/mount';
import { align, bounds, distribute, fitMoves, pasteSpot, type AlignHow } from '../lib/wall/arrange';
// Attachments that hold a bin follow it (sizes kept in step as the project changes).
import './follow';

const list = () => useStore.getState().drawer.attachments ?? [];

/** A placed part's front view, its lock keys included. */
const boxOf = (p: WallPlacement): Box => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.top ?? p.y1 });

/** The board's attachments as planned now. */
const planned = (board: WallBoard) => placeAttachments(list(), board).placed;

/** The selection as UI state: these ids, `primary` (default: the first) first. */
function selection(ids: readonly string[], primary?: string | null) {
  const known = [...new Set(ids)];
  const p = primary && known.includes(primary) ? primary : (known[0] ?? null);
  return { selectedAttachment: p, selectedAttachments: p ? [p, ...known.filter((id) => id !== p)] : [] };
}

/** One undo step; `select`: the selection after it (undefined: as it was). */
function write(next: PlacedAttachment[], select?: readonly string[]) {
  const s = useStore.getState();
  history.checkpoint();
  useStore.setState({
    drawer: { ...s.drawer, attachments: next },
    ...(select !== undefined ? { ui: { ...s.ui, ...selection(select) } } : {}),
  });
  history.checkpoint();
}

/** Select just this one (null: nothing). */
export function selectAttachment(id: string | null) {
  selectAttachments(id ? [id] : []);
}

/** Select these; `primary` (default: the first) is the one the panel edits. */
export function selectAttachments(ids: readonly string[], primary?: string | null) {
  const s = useStore.getState();
  const next = selection(ids, primary);
  const now = attachmentSelection(s.ui);
  if (now.length === next.selectedAttachments.length && now.every((id, i) => id === next.selectedAttachments[i])) return;
  useStore.setState({ ui: { ...s.ui, ...next } });
}

/** Shift- or Ctrl-click: add one to the selection (as the primary), or take it out. */
export function toggleAttachment(id: string) {
  const sel = selectedAttachmentIds();
  if (sel.includes(id)) selectAttachments(sel.filter((x) => x !== id));
  else selectAttachments([id, ...sel], id);
}

export function selectAllAttachments() {
  selectAttachments(
    list().map((a) => a.id),
    useStore.getState().ui.selectedAttachment,
  );
}

/** The selected attachments on this board, primary first. */
export function selectedAttachmentIds(): string[] {
  const here = new Set(list().map((a) => a.id));
  return attachmentSelection(useStore.getState().ui).filter((id) => here.has(id));
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
  // Nowhere free: the nearest spot to the middle where it fits, else the slot there (it shows red).
  spot ??= snapAnchor(board.slots, keys, l.layout, board.ctx, board.W / 2, board.H / 2) ?? nearestSlot(board.slots, board.W / 2, board.H / 2);
  const [x, y] = spot ?? [board.W / 2, board.H / 2];
  const id = newId();
  write([...list(), { id, type, x, y, opts }], [id]);
  return id;
}

/** A part put somewhere: from now on it stays there (an older project's is planned on the nearest slot where it fits till then). */
const put = ({ snap: _, ...a }: PlacedAttachment): PlacedAttachment => a;

export function updateAttachment(id: string, patch: Partial<Omit<PlacedAttachment, 'id'>>) {
  write(list().map((a) => (a.id === id ? { ...('x' in patch || 'y' in patch ? put(a) : a), ...patch } : a)));
}

/** Change some of an attachment's options. */
export function setAttachmentOpts(id: string, patch: Record<string, unknown>) {
  write(list().map((a) => (a.id === id ? { ...a, opts: { ...a.opts, ...patch } } : a)));
}

export function moveAttachment(id: string, x: number, y: number) {
  moveAttachments([{ id, x, y }]);
}

/** Move several at once (one undo step); nothing happens if none of them moves. */
export function moveAttachments(moves: readonly { id: string; x: number; y: number }[]) {
  const to = new Map(moves.map((m) => [m.id, m]));
  if (!list().some((a) => to.has(a.id) && (a.x !== to.get(a.id)!.x || a.y !== to.get(a.id)!.y || a.snap))) return;
  write(list().map((a) => (to.has(a.id) ? { ...put(a), x: to.get(a.id)!.x, y: to.get(a.id)!.y } : a)));
}

export function removeAttachment(id: string) {
  removeAttachments([id]);
}

/** Remove several (one undo step); the rest of the selection stays selected. */
export function removeAttachments(ids: readonly string[]) {
  const gone = new Set(ids);
  if (!list().some((a) => gone.has(a.id))) return;
  write(
    list().filter((a) => !gone.has(a.id)),
    attachmentSelection(useStore.getState().ui).filter((id) => !gone.has(id)),
  );
}

/** Each of these that doesn't fit where it is to the nearest spot where it does (lib/wall/arrange.ts fitMoves). One undo step. */
export function moveToFit(ids: readonly string[], board: WallBoard) {
  moveAttachments(fitMoves(board, planned(board), ids));
}

/** These parts, and the front views of the rest of the board's. */
function split(ids: readonly string[], board: WallBoard) {
  const all = planned(board);
  return { parts: all.filter((p) => ids.includes(p.id)), others: all.filter((p) => !ids.includes(p.id)).map(boxOf) };
}

/** Line the selected parts up (lib/wall/arrange.ts align); one undo step. */
export function alignAttachments(ids: readonly string[], how: AlignHow, board: WallBoard) {
  const { parts, others } = split(ids, board);
  moveAttachments(align(board, slotKeys(board.slots), parts, how, others));
}

/** Space the selected parts out evenly across or up (lib/wall/arrange.ts distribute); one undo step. */
export function distributeAttachments(ids: readonly string[], axis: 'x' | 'y', board: WallBoard) {
  const { parts, others } = split(ids, board);
  moveAttachments(distribute(board, slotKeys(board.slots), parts, axis, others));
}

// Copy and paste: a plain in-memory clipboard, shared by every board in the project (not saved, not undone).
let clipboard: { from: string; items: PlacedAttachment[] } | null = null;
let clips = 0;
const clipListeners = new Set<() => void>();

/** Copy these attachments (in the board's order). Returns how many. */
export function copyAttachments(ids: readonly string[]): number {
  const items = list().filter((a) => ids.includes(a.id));
  if (items.length) {
    clipboard = { from: useStore.getState().activeDrawerId, items: structuredClone(items) };
    clips++;
    clipListeners.forEach((l) => l());
  }
  return items.length;
}

export const hasAttachmentClip = () => !!clipboard?.items.length;

/** Copying, for useSyncExternalStore (the panel's Paste). */
export const subscribeClip = (fn: () => void) => {
  clipListeners.add(fn);
  return () => void clipListeners.delete(fn);
};
export const clipVersion = () => clips;

/**
 * Copies of `src` on this board, selected: as far apart as the originals, on the first free spot where they fit,
 * looking out from `near` (lib/wall/arrange.ts pasteSpot). One undo step. Returns the new ids.
 */
function placeCopies(src: readonly PlacedAttachment[], board: WallBoard, near: (b: Box, first: Vec2) => Vec2): string[] {
  // Each one's front view on this board, from its anchor.
  const tmp = placeAttachments(src, board).placed;
  const items = src.flatMap((a) => {
    const p = tmp.find((q) => q.id === a.id);
    const b = p && boxOf(p);
    // One from an older project is where it's planned (PlacedAttachment.snap).
    const [x, y] = p && a.snap ? [p.x, p.y] : [a.x, a.y];
    return p && b ? [{ a, x, y, layout: p.layout, box: { x0: b.x0 - p.x, y0: b.y0 - p.y, x1: b.x1 - p.x, y1: b.y1 - p.y } }] : [];
  });
  if (!items.length) return [];
  const around = bounds(items.map((it) => ({ x0: it.x + it.box.x0, y0: it.y + it.box.y0, x1: it.x + it.box.x1, y1: it.y + it.box.y1 })));
  const at = pasteSpot(board, slotKeys(board.slots), items, planned(board).map(boxOf), near(around, [items[0].x, items[0].y]));
  if (!at) return [];
  const copies = items.map(({ a }, i) => ({ ...put(structuredClone(a)), id: newId(), x: at[i][0], y: at[i][1] }));
  write(
    [...list(), ...copies],
    copies.map((c) => c.id),
  );
  return copies.map((c) => c.id);
}

/** Where copies go beside the originals (`b` round them, `first` the first one's anchor): to their right, by their width in whole slots. */
function beside(board: WallBoard, b: Box, [x, y]: Vec2): Vec2 {
  const step = 2 * board.ctx.pitch;
  return [x + Math.ceil((b.x1 - b.x0 + 1) / step) * step, y];
}

/**
 * Paste what was copied, selected: with its middle at `at` (the pointer, on this board), else beside the originals
 * (on the board they came from) or where they were (another board), on the nearest free spot that fits. Returns the new ids.
 */
export function pasteAttachments(board: WallBoard, at?: Vec2 | null): string[] {
  if (!clipboard?.items.length) return [];
  const here = clipboard.from === useStore.getState().activeDrawerId;
  return placeCopies(clipboard.items, board, (b, first) =>
    at ? [first[0] + at[0] - (b.x0 + b.x1) / 2, first[1] + at[1] - (b.y0 + b.y1) / 2] : here ? beside(board, b, first) : first,
  );
}

/** Copies of these beside them (the clipboard is left alone), selected. Returns the new ids. */
export function duplicateAttachments(ids: readonly string[], board: WallBoard): string[] {
  const src = list().filter((a) => ids.includes(a.id));
  return placeCopies(src, board, (b, first) => beside(board, b, first));
}
