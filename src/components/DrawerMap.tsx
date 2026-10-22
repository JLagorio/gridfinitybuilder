import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { allDrawers, useStore } from '../state/store';
import { isGridBoard } from '../lib/gridBoards';
import { LazyDialog, lazyNamed } from './lazy';

export type Scope = 'active' | 'all';

/** Every drawer with bins in it (not Skådis, openGrid or Multiboard boards), current; re-renders only when the workspace changes. */
export function useAllDrawers() {
  const ws = useStore(
    useShallow((s) => ({ drawers: s.drawers, activeDrawerId: s.activeDrawerId, drawer: s.drawer, baseplate: s.baseplate, bins: s.bins })),
  );
  // Skådis boards hold no bins: no page on the map, no lines in the contents.
  return { docs: useMemo(() => allDrawers(ws).filter((d) => d.drawer.enclosure !== 'skadis' && !isGridBoard(d.drawer.enclosure)), [ws]), activeDrawerId: ws.activeDrawerId };
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
