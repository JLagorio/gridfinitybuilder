import { spacerMargins, type DrawerInput } from './layout/drawer';

/**
 * Words for "Just bins" drawers (DrawerInput.haveBaseplate) in the Print
 * panel: what such a drawer doesn't print, and why a job has nothing on it.
 * (The Drawer panel's are in components/HaveBaseplate.tsx.)
 */

/** What a bins-only drawer doesn't print: "baseplate", "carry case", "wall grid", "baseplate and spacer strips". */
export function haveWhat(d: DrawerInput): string {
  if (d.enclosure === 'case') return 'carry case';
  if (d.enclosure === 'wall') return 'wall grid';
  return spacerMargins(d) ? 'baseplate and spacer strips' : 'baseplate';
}

/** "baseplate not printed (you have it)", "baseplate and spacer strips not printed (you have them)". */
export function notPrintedNote(d: DrawerInput): string {
  const what = haveWhat(d);
  return `${what} not printed (you have ${what.includes(' and ') ? 'them' : 'it'})`;
}

export interface EmptyJob {
  /** Plates in the job. */
  plates: number;
  /** Parts left out because they're printed already ("only what's changed"). */
  leftOut: number;
  /** The drawers being printed. */
  drawers: { drawer: DrawerInput; bins: readonly unknown[] }[];
  include: { baseplate: boolean; bins: boolean };
  /** Printing just the selected bins (store PrintScope 'selected'). */
  selected: boolean;
}

/** Why a print job has nothing on its plates, in a sentence; null when it has plates. */
export function nothingToPrint(j: EmptyJob): string | null {
  if (j.plates > 0) return null;
  if (j.leftOut > 0) return 'Nothing to print: everything in this job is printed already. Turn off Only what’s changed to print it again.';
  const bins = j.drawers.reduce((t, d) => t + d.bins.length, 0);
  if (j.selected && !bins) return 'Nothing to print: no bins are selected. Select the ones to print on the Bins tab.';
  const have = j.drawers.filter((d) => d.drawer.haveBaseplate);
  const base = j.selected
    ? 'just the selected bins print'
    : j.drawers.length && have.length === j.drawers.length
      ? have.length > 1
        ? 'you have the baseplates of these drawers'
        : `you have the ${haveWhat(have[0].drawer)} (Just bins)`
      : !j.include.baseplate
        ? 'Baseplate is switched off'
        : null;
  const noBins = !j.include.bins ? 'Bins is switched off' : !bins ? 'there are no bins yet: draw some on the Bins tab' : null;
  if (base && noBins) return `Nothing to print: ${base}, and ${noBins}.`;
  // Something should print, so it didn't fit (the job's warnings say what).
  return 'Nothing to print: nothing in this job fits the printer (see the notes above).';
}
