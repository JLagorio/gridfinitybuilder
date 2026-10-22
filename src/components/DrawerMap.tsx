import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { allDrawers, useStore } from '../state/store';
import { isGridBoard } from '../lib/gridBoards';
import { LazyDialog, lazyNamed } from './lazy';

export type Scope = 'active' | 'all';

/** Every drawer with bins in it (not Skådis, openGrid or Multiboard boards), and the Skådis boards, current; re-renders only when the workspace changes. */
export function useAllDrawers() {
  const ws = useStore(
    useShallow((s) => ({ drawers: s.drawers, activeDrawerId: s.activeDrawerId, drawer: s.drawer, baseplate: s.baseplate, bins: s.bins })),
  );
  const all = useMemo(() => allDrawers(ws), [ws]);
  // Boards hold no bins: no drawer page on the map; Skådis boards' attachments have lines of their own in the contents.
  const docs = useMemo(() => all.filter((d) => d.drawer.enclosure !== 'skadis' && !isGridBoard(d.drawer.enclosure)), [all]);
  const boards = useMemo(() => all.filter((d) => d.drawer.enclosure === 'skadis'), [all]);
  return { docs, boards, all, activeDrawerId: ws.activeDrawerId };
}

// The map itself (DrawerMapDialog.tsx) loads when it first opens.
const MapDialog = lazyNamed(() => import('./DrawerMapDialog'), 'DrawerMapDialog');

/** The printable drawer map (DrawerMapDialog.tsx), loaded on first use. */
export function DrawerMapDialog(props: { initialScope?: Scope; onClose: () => void }) {
  return (
    <LazyDialog scope="The drawer map" onClose={props.onClose}>
      <MapDialog {...props} />
    </LazyDialog>
  );
}

/** Button that opens the drawer map. */
export function DrawerMapButton({ scope = 'active', label = 'Drawer map…' }: { scope?: Scope; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="A top view with each bin's label and contents, to print or save as SVG">
        {label}
      </button>
      {open && <DrawerMapDialog initialScope={scope} onClose={() => setOpen(false)} />}
    </>
  );
}
