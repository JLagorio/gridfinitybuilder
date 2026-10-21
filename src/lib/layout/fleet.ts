/**
 * Several printers sharing one print job. The first printer's model, bed,
 * edge margin, height and power draw are the PrintSetup's own fields, so a
 * setup saved before there could be more stays exactly as it was;
 * `setup.printers` adds the others.
 *
 * The baseplate is split for one printer: the one picked to print it, or the
 * biggest (`baseplatePrinter`). Then everything is shared out so the whole job
 * is done soonest (`shareOut`): a part that only one printer takes goes to it,
 * the rest go where they finish soonest, by the estimated print time of each
 * printer (estimate.ts; `roughSeconds` until a part is sliced).
 */
import type { PrintSetup } from './plan';
import { DEFAULT_MOTION, findPrinter, type PrinterMotion } from '../printers';
import { estimatePlate, type MeshPrintStats } from '../estimate';
import type { SpiralPrint } from '../geometry/containers/vase';

/** What each printer has of its own. */
export interface PrinterSetup {
  printerId: string;
  /** Printable bed area, mm. */
  bedW: number;
  bedD: number;
  maxH: number;
  /** Keep-out from the bed edge on every side, mm. */
  plateMargin: number;
  /** Power draw while printing, W; unset: the printer's typical draw. */
  printerWatts?: number;
}

/** At most this many printers. */
export const MAX_PRINTERS = 6;

/** Every printer of the job, the first (the setup's own fields) first. */
export function jobPrinters(setup: Pick<PrintSetup, keyof PrinterSetup | 'printers'>): PrinterSetup[] {
  const { printerId, bedW, bedD, maxH, plateMargin, printerWatts } = setup;
  const first: PrinterSetup = { printerId, bedW, bedD, maxH, plateMargin, ...(printerWatts !== undefined ? { printerWatts } : {}) };
  return [first, ...(setup.printers ?? [])];
}

/** The setup as printer `i` sees it: its own fields over the shared ones, and no other printers. */
export function printerSetup<S extends Partial<PrintSetup>>(setup: S, i: number): S {
  const p = i > 0 ? setup.printers?.[i - 1] : undefined;
  if (!p) return setup;
  const { printers: _printers, baseplatePrinter: _base, printerWatts: _watts, ...rest } = setup;
  return { ...rest, ...p } as S;
}

/** The printer's model name ("Custom printer" for a custom one). */
export function modelName(printerId: string): string {
  return printerId === 'custom' ? 'Custom printer' : findPrinter(printerId).name;
}

/** Each printer's name, numbered when two are the same model: "Bambu Lab P1S (2)". */
export function printerNames(setup: Pick<PrintSetup, 'printerId' | 'printers'>): string[] {
  const names = [setup.printerId, ...(setup.printers ?? []).map((p) => p.printerId)].map(modelName);
  return names.map((n, i) => {
    const same = names.filter((m) => m === n).length;
    return same > 1 ? `${n} (${names.slice(0, i + 1).filter((m) => m === n).length})` : n;
  });
}

/** A printer's name without the brand where that's clear enough ("P2S", "A1 mini (2)"). */
export const shortName = (name: string) => name.replace(/^Bambu Lab /, '');

/** Usable bed area, mm². */
export const usableArea = (p: Pick<PrinterSetup, 'bedW' | 'bedD' | 'plateMargin'>) =>
  Math.max(0, p.bedW - 2 * p.plateMargin) * Math.max(0, p.bedD - 2 * p.plateMargin);

/** The printer with the biggest usable bed (the first of equals). */
export function biggestPrinter(setup: PrintSetup): number {
  const list = jobPrinters(setup);
  let best = 0;
  list.forEach((p, i) => {
    if (usableArea(p) > usableArea(list[best]) + 1e-6) best = i;
  });
  return best;
}

/** True when the setup names a printer to print the baseplate. */
export function baseplatePicked(setup: PrintSetup): boolean {
  const i = setup.baseplatePrinter;
  return i !== undefined && Number.isInteger(i) && i >= 0 && i <= (setup.printers?.length ?? 0);
}

/** The printer the baseplate is split for: the one picked, else the biggest. */
export function baseplatePrinter(setup: PrintSetup): number {
  return baseplatePicked(setup) ? setup.baseplatePrinter! : biggestPrinter(setup);
}

/** Saved extra printers, checked (projects edited by hand); undefined when there are none. */
export function cleanPrinters(saved: unknown): PrinterSetup[] | undefined {
  if (!Array.isArray(saved)) return undefined;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const out = saved
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .slice(0, MAX_PRINTERS - 1)
    .map((p) => {
      const id = typeof p.printerId === 'string' && p.printerId ? p.printerId : 'p2s';
      const pr = findPrinter(id);
      const one: PrinterSetup = {
        printerId: id,
        bedW: num(p.bedW, 20, 2000, pr.bedW),
        bedD: num(p.bedD, 20, 2000, pr.bedD),
        maxH: num(p.maxH, 10, 2000, pr.maxH),
        plateMargin: num(p.plateMargin, 0, 100, 10),
      };
      const watts = num(p.printerWatts, 0, 5000, 0);
      if (watts > 0) one.printerWatts = watts;
      return one;
    });
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Print time before a part is sliced
// ---------------------------------------------------------------------------

/** A 40 × 40 × 20 mm open box with 1 mm walls and floor, as sliced: what `speedFactor` times. */
function referenceStats(): MeshPrintStats {
  const n = 100;
  const stats: MeshPrintStats = {
    layerHeight: 0.2,
    area: new Float32Array(n).fill(156),
    perimeter: new Float32Array(n).fill(312),
    contours: new Uint16Array(n).fill(2),
    islands: new Uint16Array(n).fill(1),
    up: new Float32Array(n),
    down: new Float32Array(n),
    overlay: new Float32Array(n),
    volume: 4 * 40 * 20 + 1600,
    overlayVolume: 0,
  };
  for (let k = 0; k < 5; k++) {
    stats.area[k] = 1600;
    stats.perimeter[k] = 160;
    stats.contours[k] = 1;
  }
  stats.down[0] = 1600;
  stats.up[4] = 1444;
  return stats;
}

const factors = new Map<PrinterMotion, number>();
const X1C = findPrinter('x1c').motion ?? DEFAULT_MOTION;

/** How much longer a printer takes than an X1C for the same part. */
function speedFactor(m: PrinterMotion): number {
  let f = factors.get(m);
  if (f === undefined) {
    const ref = referenceStats();
    const t = (mo: PrinterMotion) => estimatePlate([{ stats: ref, w: 40, d: 40 }], mo).printSeconds;
    f = t(m) / t(X1C);
    factors.set(m, f);
  }
  return f;
}

/**
 * Print seconds of a part (start sequence left out) from its size alone, for
 * sharing parts out before they're sliced. Fitted to the estimate of sliced
 * bins (1 × 1 × 3u to 5 × 5 × 6u) and frame baseplate pieces on an X1C,
 * within about 15 %, then scaled to the printer's speeds.
 */
export function roughSeconds(part: { kind: string; w: number; d: number; h: number; spiral?: SpiralPrint }, motion: PrinterMotion = DEFAULT_MOTION): number {
  const area = part.w * part.d;
  const sides = 2 * (part.w + part.d) * part.h;
  let minutes: number;
  if (part.spiral) {
    // Vase-mode bin (estimate.ts): solid bottom layers, then one line a layer, at least 4 s each.
    const layers = Math.max(0, part.h - part.spiral.start) / 0.2;
    return (0.0006 * area * part.spiral.start * 60 + layers * Math.max(4, (2 * (part.w + part.d)) / 150)) * speedFactor(motion);
  }
  if (part.kind === 'piece') minutes = 0.0018 * area + 7.4;
  // Thin walls on a floor: bins, lids, trays, case parts.
  else if (part.kind === 'bin' || part.kind === 'lid' || part.kind === 'tray' || part.kind === 'enclosure') minutes = Math.max(1, 0.0021 * area + 0.0028 * sides - 1);
  // Small solid parts: keys, divider plates, label plates, pads.
  else minutes = 0.0008 * area * part.h + 0.4;
  return minutes * 60 * speedFactor(motion);
}

/** Print seconds of a sliced part on each printer of the setup (estimate.ts), undefined until it's sliced. */
export function slicedSeconds(
  setup: PrintSetup,
  stats: (meshKey: string) => MeshPrintStats | undefined,
): (part: { meshKey: string; w: number; d: number; spiral?: SpiralPrint }, printer: number) => number | undefined {
  const motions = jobPrinters(setup).map((p) => findPrinter(p.printerId).motion ?? DEFAULT_MOTION);
  const cache = new Map<string, number>();
  return (part, k) => {
    const s = stats(part.meshKey);
    if (!s) return undefined;
    const key = `${k}|${part.meshKey}`;
    let t = cache.get(key);
    if (t === undefined) {
      t = estimatePlate([{ stats: s, w: part.w, d: part.d, ...(part.spiral ? { spiral: part.spiral } : {}) }], motions[k] ?? DEFAULT_MOTION).printSeconds;
      cache.set(key, t);
    }
    return t;
  };
}

// ---------------------------------------------------------------------------
// Sharing out
// ---------------------------------------------------------------------------

export interface ShareItem {
  key: string;
  /** Estimated print seconds on each printer; Infinity where it doesn't fit. */
  seconds: number[];
  /** Footprint, mm²: its share of a plate's start sequence. */
  area: number;
  /** A whole plate: its start sequence is in `seconds` already. */
  plate?: boolean;
  /** Prints on this printer, whatever the balance. */
  pinned?: number;
}

export interface SharePrinter {
  /** Usable bed area, mm². */
  area: number;
  /** Start sequence per plate, s. */
  prepare: number;
}

/** About how full plates get, for a part's share of the start sequence. */
const PLATE_FILL = 0.6;

/**
 * Which printer prints each item so that the last one finishes as soon as
 * possible. Items pinned to a printer, or that fit only one, go there; then the
 * longest first, each to the printer that would finish it soonest; then single
 * items move off the busiest printer while that makes it finish sooner. Ties go
 * to the earlier printer. Items that fit no printer are left out of the map.
 */
export function shareOut(items: ShareItem[], printers: SharePrinter[]): Map<string, number> {
  const load = printers.map(() => 0);
  const at = new Map<string, number>();
  const cost = (it: ShareItem, k: number) =>
    it.seconds[k] + (it.plate ? 0 : (printers[k].prepare * it.area) / (PLATE_FILL * Math.max(1, printers[k].area)));
  const fits = (it: ShareItem) => printers.map((_, k) => k).filter((k) => Number.isFinite(it.seconds[k]));
  const put = (it: ShareItem, k: number) => {
    at.set(it.key, k);
    load[k] += Number.isFinite(cost(it, k)) ? cost(it, k) : 0;
  };
  const free: ShareItem[] = [];
  for (const it of items) {
    const ks = fits(it);
    if (it.pinned !== undefined && it.pinned >= 0 && it.pinned < printers.length) put(it, it.pinned);
    else if (ks.length === 1) put(it, ks[0]);
    else if (ks.length > 1) free.push(it);
  }
  const quickest = (it: ShareItem) => Math.min(...fits(it).map((k) => it.seconds[k]));
  free.sort((a, b) => quickest(b) - quickest(a));
  for (const it of free) {
    let best = -1;
    for (const k of fits(it)) if (best < 0 || load[k] + cost(it, k) < load[best] + cost(it, best) - 1e-9) best = k;
    put(it, best);
  }
  // Every move lowers the busiest printer's time without making another one as busy, so this ends.
  for (let pass = 0; pass < free.length * printers.length; pass++) {
    const top = load.indexOf(Math.max(...load));
    const mine = free.filter((it) => at.get(it.key) === top).sort((a, b) => cost(b, top) - cost(a, top));
    let moved = false;
    for (const it of mine) {
      for (const k of fits(it)) {
        if (k === top) continue;
        const after = Math.max(load[top] - cost(it, top), load[k] + cost(it, k));
        if (after < load[top] - 1e-6) {
          load[top] -= cost(it, top);
          put(it, k);
          moved = true;
          break;
        }
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return at;
}
