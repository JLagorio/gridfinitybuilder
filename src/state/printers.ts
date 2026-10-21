import { useStore } from './store';
import { findPrinter } from '../lib/printers';
import { MAX_PRINTERS, jobPrinters, type PrinterSetup } from '../lib/layout/fleet';
import type { PrintSetup } from '../lib/layout/plan';

/**
 * More printers for the job (fleet.ts). Printer 0 is the setup's own fields
 * (the store's setPrinter / setSetup); the others are `setup.printers`.
 */

const setup = () => useStore.getState().setup;

/** The setup with these extra printers; none drops the field, like a setup from before. */
function withPrinters(s: PrintSetup, printers: PrinterSetup[], base = s.baseplatePrinter): PrintSetup {
  const { printers: _p, baseplatePrinter: _b, ...rest } = s;
  if (!printers.length) return rest;
  return { ...rest, printers, ...(base !== undefined ? { baseplatePrinter: base } : {}) };
}

/** Add a printer, the same model as the first to start with. */
export function addPrinter() {
  const s = setup();
  const list = s.printers ?? [];
  if (list.length + 1 >= MAX_PRINTERS) return;
  const first = jobPrinters(s)[0];
  const { printerWatts: _w, ...one } = first;
  useStore.setState({ setup: withPrinters(s, [...list, one]) });
}

/** Remove printer `i` (1 or more; the first one stays). */
export function removePrinter(i: number) {
  const s = setup();
  const list = s.printers ?? [];
  if (i < 1 || i > list.length) return;
  const b = s.baseplatePrinter;
  const base = b === undefined || b === i ? undefined : b > i ? b - 1 : b;
  useStore.setState({ setup: withPrinters(s, list.filter((_, k) => k !== i - 1), base) });
}

/** Change printer `i` itself: its model, or its bed, height, edge margin or power draw. */
export function setPrinterAt(i: number, patch: Partial<PrinterSetup>) {
  if (i === 0) {
    const { printerId, ...rest } = patch;
    if (printerId !== undefined) useStore.getState().setPrinter(printerId);
    if (Object.keys(rest).length) useStore.getState().setSetup(rest);
    return;
  }
  const s = setup();
  const list = s.printers ?? [];
  const cur = list[i - 1];
  if (!cur) return;
  let next: PrinterSetup = { ...cur, ...patch };
  // A model brings its bed and height; a custom printer keeps what it had.
  if (patch.printerId && patch.printerId !== 'custom') {
    const pr = findPrinter(patch.printerId);
    next = { ...next, bedW: pr.bedW, bedD: pr.bedD, maxH: pr.maxH };
  }
  useStore.setState({ setup: withPrinters(s, list.map((p, k) => (k === i - 1 ? next : p))) });
}

/** Which printer the baseplate is split for and printed on; undefined: the biggest. */
export function setBaseplatePrinter(i: number | undefined) {
  const s = setup();
  useStore.setState({ setup: withPrinters(s, s.printers ?? [], i) });
}
