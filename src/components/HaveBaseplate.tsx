import { useState, type ReactNode } from 'react';
import { useFindState } from './findContext';
import { spacerMargins, type DrawerInput } from '../lib/layout/drawer';

/**
 * "Just bins" (DrawerInput.haveBaseplate) on the Drawer panel: what such a
 * drawer leaves out, and its folded baseplate settings. (The Print panel's
 * notes are in PrintWhat.tsx, loaded with it.)
 */

/** Under the Drawer panel's "Just bins": what isn't printed, and what still counts. */
export function justBinsHint(d: DrawerInput): string {
  const only = 'Only the bins print, with their lids and inserts';
  if (d.enclosure === 'case') return `The carry case isn’t printed: not its body (the baseplate), lid, hinge pins, handle or feet. You have it. ${only}; the case settings still say how much room they have.`;
  if (d.enclosure === 'wall') return `The wall grid isn’t printed, nor its French cleat: you have it. ${only}.`;
  if (spacerMargins(d)) return `The baseplate and its spacer strips aren’t printed: you have them. ${only}.`;
  return `The baseplate isn’t printed: you have it. ${only}. Give its size below so they fit it.`;
}

/**
 * The Baseplate section's settings for a bins-only drawer: folded away, since
 * none of it prints, but there to open (and open while a search finds one).
 * `on` false: just the settings.
 */
export function HaveBaseplateFold({ on, floor, children }: { on: boolean; floor: string; children: ReactNode }) {
  const f = useFindState();
  const [open, setOpen] = useState(false);
  if (!on) return <>{children}</>;
  return (
    <>
      <p className="field-hint">
        Not printed: you have it. Its settings only set the floor under the bins ({floor}), for the 3D view and the drawer height check.{' '}
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide its settings' : 'Show its settings'}
        </button>
      </p>
      <div className="find-wrap" hidden={!open && !f?.result}>
        {children}
      </div>
    </>
  );
}
