import { useEffect, useRef, useState } from 'react';
import { allDrawers, useStore } from '../state/store';

/** Top-bar drawer picker: switch, add, duplicate, rename, delete. */
export function DrawerSwitcher() {
  const drawers = useStore((s) => s.drawers);
  const activeId = useStore((s) => s.activeDrawerId);
  const switchDrawer = useStore((s) => s.switchDrawer);
  const addDrawer = useStore((s) => s.addDrawer);
  const duplicateDrawer = useStore((s) => s.duplicateDrawer);
  const removeDrawer = useStore((s) => s.removeDrawer);
  const renameDrawer = useStore((s) => s.renameDrawer);
  const [open, setOpen] = useState(false);
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
                  <small>{binCount(d.id)} bins</small>
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
    </div>
  );
}
