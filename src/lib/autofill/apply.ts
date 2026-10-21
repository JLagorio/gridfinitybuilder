/**
 * "Fill from a list": putting the accepted bins in a drawer (the store's
 * `addBins` batch action), and the list remembered per drawer.
 */
import { canPlace, newId, withBlocked } from '../bins';
import { sanitizeBin } from '../geometry/bin';
import { cleanBinContents } from '../inventory';
import { shrinkToBed, type Beds } from '../bedfit';
import type { GridLayout } from '../layout/drawer';
import type { PlacedBin } from '../project';

/** A bin to add: everything but its id. */
export type NewBin = Omit<PlacedBin, 'id'>;

/**
 * `bins` with `add` put in: each new bin gets an id and is cut down to what
 * the printer takes (bedfit.ts); one that would overlap a bin or a blocked
 * cell, or stick out of the grid, is left out.
 */
export function mergeBins(layout: GridLayout, bins: PlacedBin[], add: NewBin[], bed: Beds): { bins: PlacedBin[]; added: string[] } {
  const out = [...bins];
  const added: string[] = [];
  for (const b of add) {
    const id = newId();
    const bin = shrinkToBed(
      layout,
      { id, x: Math.round(b.x), y: Math.round(b.y), opts: sanitizeBin(b.opts), ...cleanBinContents(b), ...(b.stretch ? { stretch: b.stretch } : {}) },
      bed,
    );
    const r = { x: bin.x, y: bin.y, w: bin.opts.unitsX, d: bin.opts.unitsY };
    if (!canPlace(withBlocked(out, layout.mask), r, layout.nx, layout.ny)) continue;
    out.push(bin);
    added.push(id);
  }
  return { bins: out, added };
}

/** Longest list kept, characters. */
export const FILL_LIST_MAX = 4000;

/** A saved list: text, at most FILL_LIST_MAX characters; '' when there is none. */
export function cleanFillList(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\r\n?/g, '\n');
  return t.trim() ? t.slice(0, FILL_LIST_MAX) : '';
}
