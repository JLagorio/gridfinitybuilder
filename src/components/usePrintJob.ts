import { useMemo, useSyncExternalStore } from 'react';
import { printDrawers, type Store } from '../state/store';
import { planPrint, type PlanPrintOptions, type PrintJob } from '../lib/project';
import { slicedSeconds } from '../lib/layout/fleet';
import { geometry } from '../worker/client';

const subscribe = (cb: () => void) => geometry.subscribe(cb);

/**
 * The print tab's job: the drawers it prints, shared out between the printers
 * (fleet.ts). `job` is the active drawer's own plan, used as it is when that's all it takes.
 */
export function usePrintJob(state: Store, job: PrintJob): PrintJob {
  const several = !!state.setup.printers?.length;
  // Sliced parts share out more exactly than their size says: plan again as their slice data comes in.
  const sliced = useSyncExternalStore(subscribe, () => (several ? geometry.slicedCount : 0));
  return useMemo(
    () => {
      const docs = printDrawers(state);
      const opts: PlanPrintOptions = {};
      if (several) opts.seconds = slicedSeconds(state.setup, (key) => geometry.printStats(key));
      if (docs.length === 1 && docs[0].id === state.activeDrawerId && !several) return job;
      return planPrint(docs, state.setup, state.include, opts);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job, state.drawers, state.activeDrawerId, state.printScope, state.printPick, state.setup, state.include, sliced],
  );
}
