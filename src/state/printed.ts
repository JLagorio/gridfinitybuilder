import { history, useStore } from './store';
import { NO_PRINTS, fingerprint, markPrinted, partId, printedOn, unmarkPrinted, type PrintedRecord } from '../lib/printed';
import type { JobPart, PrintJob } from '../lib/project';

/**
 * Marking plates as printed (lib/printed.ts). Each mark is an undo step of
 * its own, so undoing it never takes an edit made just before with it.
 */

function step(fn: () => void) {
  history.checkpoint();
  fn();
  history.checkpoint();
}

/** Record every part on these plates of the job as printed (parts already covered are left as they are). */
export function markPlates(job: PrintJob, plates: number[]) {
  // Printing only what's changed, the plates are packed again without these: show them all.
  step(() => useStore.setState((s) => ({ printed: markPrinted(s.printed, job, plates), ...(s.onlyChanged ? { ui: { ...s.ui, plate: -1 } } : {}) })));
}

/** Take back the prints that cover these plates' parts. */
export function unmarkPlates(job: PrintJob, plates: number[]) {
  step(() => useStore.setState((s) => ({ printed: unmarkPrinted(s.printed, job, plates) })));
}

/** Forget everything printed. */
export function forgetPrinted() {
  step(() => useStore.setState({ printed: NO_PRINTS }));
}

/** Print only what isn't printed yet, or everything. */
export function setOnlyChanged(on: boolean) {
  useStore.setState({ onlyChanged: on, ui: { ...useStore.getState().ui, plate: -1 } });
}

/**
 * The parts on a job's plates that aren't printed yet (the Print panel says which): changed since they were (the
 * record has them as something else), or new.
 */
export function toPrint(job: PrintJob, rec: PrintedRecord): { changed: JobPart[]; added: JobPart[] } {
  const covered = printedOn(job, rec);
  const out = { changed: [] as JobPart[], added: [] as JobPart[] };
  for (const pl of job.plates) {
    for (const { key } of pl.placements) {
      if (covered.has(key)) continue;
      const part = job.parts[key];
      const was = rec.parts[partId(part)];
      (was && was !== fingerprint(part.meshKey) ? out.changed : out.added).push(part);
    }
  }
  return out;
}
