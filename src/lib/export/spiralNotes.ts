/**
 * What the plate exports' README says about vase-mode plates (layout/spiral.ts):
 * the slicer settings they need. Only the exporters load this.
 */
import { spiralSettingsText } from '../layout/spiral';
import type { SpiralPrint } from '../geometry/containers/vase';

interface SpiralJob {
  plates: { name: string; spiral?: boolean; placements: { key: string }[] }[];
  parts: Record<string, { spiral?: SpiralPrint }>;
}

/**
 * What to tell a slicer about the job's vase plates, for the README of the
 * plate exports (empty when there are none).
 */
export function spiralNotes(job: SpiralJob): string[] {
  const plates = job.plates.map((pl, i) => ({ pl, i })).filter(({ pl }) => pl.spiral);
  if (!plates.length) return [];
  const lines = [
    'VASE-MODE BINS',
    `Plate${plates.length === 1 ? '' : 's'} ${plates.map(({ i }) => i + 1).join(', ')} print in spiral vase mode: turn on "Spiral vase" (PrusaSlicer, Bambu`,
    'Studio, Orca; "Spiralize outer contour" in Cura) with 1 wall, no top layers, 0 % infill and no supports, and set the',
    'bottom layers to the height below. Everything under it (the hollow feet, magnet bosses, the walls between',
    'the feet) is drawn as it prints and comes out as ordinary bottom layers; above it the slicer prints one line',
    'around the outside. Set the wall (external perimeter) line width to the one below: the parts are drawn for it.',
    'PrusaSlicer prints only one object at a time in spiral vase mode, so each of these plates holds one bin unless',
    'the printer is a Bambu Lab one (several bins, printed "by object", spaced for its gantry). The Bambu Studio',
    'project export sets all of this up per plate.',
  ];
  for (const { pl, i } of plates) {
    const seen = new Set<string>();
    for (const p of pl.placements) {
      const s = job.parts[p.key]?.spiral;
      if (s) seen.add(spiralSettingsText(s));
    }
    lines.push(`  Plate ${i + 1} (${pl.name}): ${[...seen].join('; ')}`);
  }
  return lines;
}
