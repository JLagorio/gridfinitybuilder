import { history, useStore } from './store';
import { NO_PRINTS, markPrinted, unmarkPrinted } from '../lib/printed';
import type { PrintJob } from '../lib/project';

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
  step(() => useStore.setState((s) => ({ printed: markPrinted(s.printed, job, plates) })));
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
