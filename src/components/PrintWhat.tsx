import { notPrintedNote, nothingToPrint, type EmptyJob } from '../lib/haveBaseplate';
import type { DrawerInput } from '../lib/layout/drawer';
import './haveBaseplate.css';

/**
 * The Print panel's notes on what isn't printed: drawers that print just bins
 * (DrawerInput.haveBaseplate), the selected bins, and a job with nothing on it.
 */

/** Over the export switches: which drawers print no baseplate (you have it), or that only the selected bins print. */
export function HaveBaseplateNotes({ drawers, selected }: { drawers: { name: string; drawer: DrawerInput }[]; selected: boolean }) {
  if (selected) return <div className="have-note">Just the selected bins, with their lids and inserts: no baseplate.</div>;
  const have = drawers.filter((d) => d.drawer.haveBaseplate);
  if (!have.length) return null;
  if (drawers.length === 1) return <div className="have-note">{cap(notPrintedNote(have[0].drawer))}: this drawer prints just bins (Drawer tab).</div>;
  return (
    <div className="have-note">
      <ul>
        {have.map((d) => (
          <li key={d.name}>
            {d.name}: {notPrintedNote(d.drawer)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A job with nothing on its plates says why, instead of just greying out the downloads. */
export function NothingToPrint(props: EmptyJob) {
  const why = nothingToPrint(props);
  return why ? (
    <div className="have-note empty" role="status">
      {why}
    </div>
  ) : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
