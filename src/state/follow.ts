/**
 * Attachments that hold a bin (lib/wall/follow.ts): linking one to a bin and unlinking it, each one undo step, and
 * keeping every holder's options at its bin's size as the project changes, so one whose bin goes (deleted, or its
 * drawer) keeps the size it had last. Loaded with the board editors and the bin panel (state/wall.ts,
 * components/WallHolds.tsx), not on the first screen.
 */
import { allDrawers, history, useStore, type Store } from './store';
import { subscribeKinds, type BinLink } from '../lib/wall';
import { holding, syncHolders, unlinked } from '../lib/wall/follow';

/** Whether any attachment in the project holds a bin (the active drawer's live, the rest as saved). */
const linked = (s: Store) =>
  [s.drawer, ...s.drawers.filter((d) => d.id !== s.activeDrawerId).map((d) => d.drawer)].some((d) => d.attachments?.some((a) => a.follow));

/**
 * Every holder's options at its bin's size, written in quietly with the change that moved the bin: that change's undo
 * step takes both back, as the step was taken before either.
 */
function sync() {
  const s = useStore.getState();
  if (!linked(s)) return;
  const next = syncHolders(allDrawers(s));
  if (!next) return;
  const byId = new Map(next.map((d) => [d.id, d]));
  const active = byId.get(s.activeDrawerId);
  history.silently(() =>
    useStore.setState({
      drawers: s.drawers.map((d) => (d.id === s.activeDrawerId ? d : (byId.get(d.id) ?? d))),
      ...(active && active.drawer !== s.drawer ? { drawer: active.drawer } : {}),
    }),
  );
}

useStore.subscribe((s, p) => {
  if (s.bins !== p.bins || s.drawers !== p.drawers || s.drawer !== p.drawer) sync();
});
// The kinds say what a bin sets (they load with the first board, lib/wall/ready.ts).
subscribeKinds(sync);
sync();

/** Link an attachment on the active board to a bin, sized from it at once; null unlinks it (it keeps its size). One undo step. */
export function holdBin(id: string, link: BinLink | null) {
  const s = useStore.getState();
  const list = s.drawer.attachments ?? [];
  const a = list.find((x) => x.id === id);
  if (!a || (link ? a.follow?.drawer === link.drawer && a.follow.bin === link.bin : !a.follow)) return;
  const next = link ? { ...a, follow: link, opts: holding({ ...a, follow: link }, allDrawers(s))?.opts ?? a.opts } : unlinked(a);
  history.checkpoint();
  useStore.setState({ drawer: { ...s.drawer, attachments: list.map((x) => (x.id === id ? next : x)) } });
  history.checkpoint();
}

/** Show an attachment on its board: that board's Attachments tab, it selected. */
export function showAttachment(drawerId: string, id: string) {
  const s = useStore.getState();
  if (!s.drawers.some((d) => d.id === drawerId)) return;
  s.switchDrawer(drawerId);
  useStore.getState().setUI({ tab: 'bins', selectedAttachment: id, selectedAttachments: [id] });
}
