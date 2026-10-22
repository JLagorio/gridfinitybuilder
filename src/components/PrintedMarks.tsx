import { useMemo } from 'react';
import { useStore } from '../state/store';
import { Toggle } from './fields';
import { hasPrints, printCount } from '../lib/printed';
import type { JobPart, PrintJob } from '../lib/project';
import { forgetPrinted, markPlates, setOnlyChanged, toPrint, unmarkPlates } from '../state/printed';
import './printers.css';

const parts = (n: number) => `${n} part${n === 1 ? '' : 's'}`;
/** A few parts by name, and how many more. */
const names = (list: JobPart[]) => {
  const n = list.map((p) => p.name);
  return n.length > 4 ? `${n.slice(0, 3).join(', ')} and ${n.length - 3} more` : n.join(', ');
};

/**
 * Reprinting only what changed (lib/printed.ts): the switch, how many parts
 * it leaves out, what's left to print (changed since it was printed, or new),
 * and marking the whole job as printed. `printed` holds the job's parts on
 * plates that are printed already.
 */
export function OnlyChangedField({ job, printed }: { job: PrintJob; printed: Set<string> }) {
  const record = useStore((s) => s.printed);
  const only = useStore((s) => s.onlyChanged);
  const left = job.leftOut?.length ?? 0;
  const total = job.plates.reduce((t, pl) => t + pl.placements.length, 0);
  // What there is to print, and why: a board's tile added, a bin resized, every attachment after the board's fit changed.
  const todo = useMemo(() => (hasPrints(record) ? toPrint(job, record) : null), [job, record]);
  const hint = !hasPrints(record)
    ? 'Mark plates as printed when they come off the printer. Later, this prints only new and changed parts.'
    : only && left && !job.plates.length
      ? `All ${parts(left)} are printed already: nothing is left to print.`
      : only && left
        ? `${parts(left)} already printed ${left === 1 ? 'is' : 'are'} left out.`
        : only
          ? 'Nothing in this job is printed yet.'
          : `${parts(printCount(record))} marked as printed.`;
  return (
    <div className="only-changed">
      <Toggle label="Only what's changed" checked={only} onChange={setOnlyChanged} hint={hint} />
      {todo && (todo.changed.length > 0 || todo.added.length > 0) && (
        <div className="field-hint to-print">
          {todo.changed.length > 0 && <div>Changed since printed: {names(todo.changed)}.</div>}
          {todo.added.length > 0 && <div>New: {names(todo.added)}.</div>}
        </div>
      )}
      <div className="button-row">
        <button disabled={!total || printed.size >= total} onClick={() => markPlates(job, job.plates.map((_, i) => i))} title="Record every part on these plates as printed">
          Mark all as printed
        </button>
        {hasPrints(record) && (
          <button onClick={forgetPrinted} title="Forget what has been printed">
            Forget printed
          </button>
        )}
      </div>
    </div>
  );
}

/** On a plate card: printed, or a button to mark it. */
export function PlatePrintedMark({ job, plate, printed }: { job: PrintJob; plate: number; printed: Set<string> }) {
  const pl = job.plates[plate];
  const done = pl.placements.filter((p) => printed.has(p.key)).length;
  if (done && done === pl.placements.length) {
    return (
      <span className="plate-printed done">
        ✓ Printed ·{' '}
        <button className="link" onClick={() => unmarkPlates(job, [plate])}>
          Mark as not printed
        </button>
      </span>
    );
  }
  return (
    <span className="plate-printed">
      {done > 0 && `${done} of ${pl.placements.length} printed · `}
      <button className="link" onClick={() => markPlates(job, [plate])}>
        Mark as printed
      </button>
    </span>
  );
}
