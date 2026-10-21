import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LazyDialog, lazyNamed, once } from './lazy';

/**
 * Bins from elsewhere (lib/external.ts): the buttons that add one. The dialog
 * (ExternalBinDialog.tsx) and the file readers (lib/imported/parse.ts) load
 * when it first opens.
 */

const loadDialog = once(() => import('./ExternalBinDialog'));
const ExternalBinDialog = lazyNamed(loadDialog, 'ExternalBinDialog');

export type ExternalMode = 'placeholder' | 'import';

/** The dialog, put on the page itself (not inside a button row). */
export function ExternalBinDialogPortal({ mode, onClose }: { mode: ExternalMode; onClose: () => void }) {
  return createPortal(
    <LazyDialog scope="Bins from elsewhere" onClose={onClose}>
      <ExternalBinDialog mode={mode} onClose={onClose} />
    </LazyDialog>,
    document.body,
  );
}

/** One small button for the drawer layout's header. */
export function ExternalBinHeaderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ext-add small" onClick={() => setOpen(true)} onPointerEnter={() => void loadDialog()} title="Add a bin you already have, or import an STL / 3MF bin">
        + Bin from elsewhere
      </button>
      {open && <ExternalBinDialogPortal mode="placeholder" onClose={() => setOpen(false)} />}
    </>
  );
}
