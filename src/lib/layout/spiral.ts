/**
 * Plates for vase-mode bins (geometry/containers/vase.ts).
 *
 * Spiral vase mode belongs to the whole print, not to a part:
 * - PrusaSlicer: a global print setting, and only one object per print
 *   ("Only a single object may be printed at a time in Spiral Vase mode")
 *   unless "Complete individual objects" prints them one after another.
 * - Bambu Studio (and Orca): a setting of the plate (`spiral_mode` in the
 *   plate's metadata, over the process's); several objects on such a plate
 *   need the plate's print sequence "by object", and then every object but the
 *   last must clear the gantry: parts at least `extruder_clearance_max_radius`
 *   apart, and no taller than `extruder_clearance_height_to_rod` where a later
 *   part shares their row.
 *
 * So vase bins never share a plate with other parts. On a printer whose
 * "by object" clearance is known (the Bambu models, printers.ts) the ones
 * shorter than its rod clearance share plates, spaced by the clearance radius,
 * printed one after another; taller ones, and every vase bin on other
 * printers, get a plate each. Either way they stay clear of the printer's
 * exclusion areas (pack.ts), by the usual gap rather than the gantry clearance.
 */
import { packPlates, type PackItem, type PackOptions, type PlateLayout } from './pack';
import { findPrinter, type SequentialClearance } from '../printers';
import { vaseBottomLayers, type SpiralPrint } from '../geometry/containers/vase';

export const SPIRAL_PLATE = {
  /** Added to the printer's clearance radius between vase bins on one plate, mm. */
  spacing: 2,
  /** Vase bins at least this much under the rod clearance may print before others, mm. */
  heightMargin: 1,
  /** Layer heights the notes and exports assume (Bambu's 0.20 mm Standard), mm. */
  layer: 0.2,
} as const;

export interface SpiralItem extends PackItem {
  /** Height, mm. */
  h: number;
}

/** The printer's "by object" clearance, if vase bins may share its plates. */
export function spiralClearance(printerId: string): SequentialClearance | undefined {
  return findPrinter(printerId).sequential;
}

/** Vase bins on plates of their own: several per plate where the clearance allows, else one each. */
export function packSpiral(
  items: SpiralItem[],
  bed: Pick<PackOptions, 'bedW' | 'bedD' | 'margin' | 'exclude'>,
  clearance?: SequentialClearance,
): { plates: PlateLayout[]; oversize: PackItem[] } {
  const fits = (it: SpiralItem) => !!clearance && it.h <= clearance.rod - SPIRAL_PLATE.heightMargin + 1e-6;
  const short = items.filter(fits);
  const tall = items.filter((it) => !fits(it));
  // The gantry clearance is between bins; an exclusion area (printers.ts) only needs the usual gap.
  const shared = clearance
    ? packPlates(short, { ...bed, spacing: clearance.radius + SPIRAL_PLATE.spacing, excludeGap: SPIRAL_PLATE.spacing, nest: true })
    : { plates: [], oversize: [] };
  const alone = packPlates(tall, { ...bed, spacing: 0, nest: false });
  return { plates: [...shared.plates, ...alone.plates], oversize: [...shared.oversize, ...alone.oversize] };
}

/** "bottom layers to 6 mm (30 at 0.2 mm), 0.6 mm wall line": what the slicer needs for one vase bin. */
export function spiralSettingsText(s: SpiralPrint, layer: number = SPIRAL_PLATE.layer): string {
  return `bottom layers to ${round2(s.start)} mm (${vaseBottomLayers(s.start, layer)} at ${layer} mm), ${round2(s.line)} mm wall line`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
