import { useEffect, useRef, useState } from 'react';
import { allDrawers, useStore } from '../state/store';
import { BoardTemplatesDialog } from './boardTemplatesLazy';
import { GRID_BOARD_NAMES, isGridBoard, type GridBoardKind } from '../lib/gridBoards';

/** Top-bar drawer picker: switch, add, duplicate, rename, delete. */
export function DrawerSwitcher() {
  const drawers = useStore((s) => s.drawers);
  const activeId = useStore((s) => s.activeDrawerId);
  const switchDrawer = useStore((s) => s.switchDrawer);
  const addDrawer = useStore((s) => s.addDrawer);
  const duplicateDrawer = useStore((s) => s.duplicateDrawer);
  const removeDrawer = useStore((s) => s.removeDrawer);
  const renameDrawer = useStore((s) => s.renameDrawer);
  const setUI = useStore((s) => s.setUI);
  // The active drawer's live settings are at the top level of the store.
  const activeHave = useStore((s) => !!s.drawer.haveBaseplate);
  const activeBoard = useStore((s) => s.drawer.enclosure === 'skadis');
  const activeEnclosure = useStore((s) => s.drawer.enclosure);
  const setDrawer = useStore((s) => s.setDrawer);
  const [open, setOpen] = useState(false);
  // The starter-board picker (BoardTemplates.tsx), open after the menu closes.
  const [templates, setTemplates] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = drawers.find((d) => d.id === activeId) ?? drawers[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const binCount = (id: string) => allDrawers(useStore.getState()).find((d) => d.id === id)?.bins.length ?? 0;

  return (
    <div className="drawer-switcher" ref={ref}>
      <button className="drawer-current" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Switch drawer">
        <span className="drawer-current-label">Drawer</span>
        <b>{active?.name}</b>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="drawer-menu" role="menu">
          <ul>
            {drawers.map((d) => (
              <li key={d.id}>
                <button
                  role="menuitemradio"
                  aria-checked={d.id === activeId}
                  className={d.id === activeId ? 'active' : ''}
                  onClick={() => {
                    switchDrawer(d.id);
                    setOpen(false);
                  }}
                >
                  <span>{d.name}</span>
                  <small>
                    {isGridBoard(d.id === activeId ? activeEnclosure : d.drawer.enclosure) ? (
                      GRID_BOARD_NAMES[(d.id === activeId ? activeEnclosure : d.drawer.enclosure) as GridBoardKind]
                    ) : (d.id === activeId ? activeBoard : d.drawer.enclosure === 'skadis') ? (
                      'Skådis board'
                    ) : (
                      <>
                        {binCount(d.id)} bins
                        {(d.id === activeId ? activeHave : d.drawer.haveBaseplate) ? ' · just bins' : ''}
                      </>
                    )}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className="drawer-menu-actions">
            <button
              onClick={() => {
                const name = prompt('Name for the new drawer', `Drawer ${drawers.length + 1}`);
                if (name !== null) addDrawer(name);
                setOpen(false);
              }}
            >
              New drawer
            </button>
            {/* One click: a drawer for a baseplate you have, sized in grid units on the Drawer tab. */}
            <button
              title="A new drawer for a baseplate you already have: only its bins print"
              onClick={() => {
                addDrawer(undefined, { haveBaseplate: true });
                setUI({ tab: 'drawer' });
                setOpen(false);
              }}
            >
              New: just bins
            </button>
            {/* A pegboard for a space on the wall: Skådis slots, split to the bed (geometry/skadis.ts). */}
            <button
              title="A Skådis pegboard for a space on the wall, split into tiles that fit your printer"
              onClick={() => {
                addDrawer(undefined, { skadis: true });
                setUI({ tab: 'drawer' });
                setOpen(false);
              }}
            >
              New: Skådis board
            </button>
            {/* A board with a ready set of parts on it (lib/wall/templates.ts). */}
            <button
              title="A Skådis board with parts on it for a 3D printer’s corner, an electronics bench, a paint station, the kitchen, …"
              onClick={() => {
                setTemplates(true);
                setOpen(false);
              }}
            >
              New: board from a template…
            </button>
            {/* Boards for openGrid's and Multiboard's own accessories, split to the bed (lib/gridBoards.ts). */}
            {(
              [
                ['opengrid', 'An openGrid board (28 mm squares), split into tiles that fit your printer'],
                ['multiboard', 'A Multiboard-compatible board (25 mm grid), split into tiles that fit your printer'],
              ] as const
            ).map(([kind, title]) => (
              <button
                key={kind}
                title={title}
                onClick={() => {
                  addDrawer(GRID_BOARD_NAMES[kind]);
                  setDrawer({ enclosure: kind, [kind]: {} });
                  setUI({ tab: 'drawer' });
                  setOpen(false);
                }}
              >
                New: {GRID_BOARD_NAMES[kind]}
              </button>
            ))}
            <button
              onClick={() => {
                duplicateDrawer(activeId);
                setOpen(false);
              }}
            >
              Duplicate
            </button>
            <button
              onClick={() => {
                const name = prompt('Rename drawer', active?.name);
                if (name) renameDrawer(activeId, name);
              }}
            >
              Rename
            </button>
            <button
              className="danger"
              disabled={drawers.length < 2}
              onClick={() => {
                if (confirm(`Delete "${active?.name}" and its bins?`)) removeDrawer(activeId);
                setOpen(false);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {templates && <BoardTemplatesDialog target="new" onClose={() => setTemplates(false)} />}
    </div>
  );
}
