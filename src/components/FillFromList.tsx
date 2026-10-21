import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GridLayout } from '../lib/layout/drawer';
import { LazyDialog, lazyNamed } from './lazy';

// The dialog and what it plans with (lib/autofill) load when it first opens.
const FillFromListDialog = lazyNamed(() => import('./FillFromListDialog'), 'FillFromListDialog');

/** "Fill from a list…": the button for the Layout section, and its dialog (FillFromListDialog.tsx). */
export function FillFromListButton({ layout }: { layout: GridLayout }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={!layout.nx || !layout.ny} title="Type what you want to store; Gridfit proposes bins for it">
        Fill from a list…
      </button>
      {/* On the page itself, not inside the sidebar's button row. */}
      {open &&
        createPortal(
          <LazyDialog scope="Fill from a list" onClose={() => setOpen(false)}>
            <FillFromListDialog layout={layout} onClose={() => setOpen(false)} />
          </LazyDialog>,
          document.body,
        )}
    </>
  );
}
