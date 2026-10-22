import { useMemo, useSyncExternalStore } from 'react';
import { allDrawers, printDrawers, selectedIds, type Store } from '../state/store';
import { asDrawer, planPrint, withPrinted, type PlanPrintOptions, type PrintJob } from '../lib/project';
import { slicedSeconds } from '../lib/layout/fleet';
import { hasPrints } from '../lib/printed';
import { geometry } from '../worker/client';

const subscribe = (cb: () => void) => geometry.subscribe(cb);

/**
 * The print tab's job: the drawers it prints, shared out between the printers
 * (fleet.ts), with what's printed already marked or left out (printed.ts).
 * `job` is the active drawer's own plan, used as it is when that's all it takes.
 */
export function usePrintJob(state: Store, job: PrintJob): PrintJob {
  const several = !!state.setup.printers?.length;
  // Sliced parts share out more exactly than their size says: plan again as their slice data comes in.
  const sliced = useSyncExternalStore(subscribe, () => (several ? geometry.slicedCount : 0));
  // Printing the selected bins: the job follows the selection.
  const selection = state.printScope === 'selected' ? selectedIds(state.ui).join() : '';
  return useMemo(
    () => {
      const docs = printDrawers(state);
      const opts: PlanPrintOptions = hasPrints(state.printed) ? { printed: state.printed, onlyChanged: state.onlyChanged } : {};
      // Attachments that hold a bin in a drawer not printed find it (lib/wall/follow.ts).
      opts.drawers = allDrawers(state);
      if (several) opts.seconds = slicedSeconds(state.setup, (key) => geometry.printStats(key));
      if (docs.length === 1 && docs[0].id === state.activeDrawerId && state.printScope !== 'selected' && !several && !opts.onlyChanged) {
        // Its parts know their drawer, for what's printed (printed.ts).
        const mine = asDrawer(job, state.activeDrawerId);
        return opts.printed ? withPrinted(mine, opts.printed) : mine;
      }
      return planPrint(docs, state.setup, state.include, opts);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job, state.drawers, state.activeDrawerId, state.printScope, state.printPick, state.setup, state.include, state.printed, state.onlyChanged, sliced, selection],
  );
}
