import type { PrintJob } from '../lib/project';
import type { LegendEntry, ScenePaint } from './Viewer';
import { ROLES, paletteOf, partRoleSlot, slotLabel, strategyOf, type ColourRole } from '../lib/colours';
import { partProfile, partSlot } from '../lib/colourPlan';

/**
 * The 3D view in filament colours (multi-colour on, colours.ts): each part's
 * paint, and the legend of slots. Nothing with multi-colour off, so the view
 * keeps its piece and part colours.
 */

const colourOf = (job: PrintJob) => {
  const pal = paletteOf(job.colours ?? {}, 16);
  return (slot: number) => (pal[slot - 1]?.colour ?? '#808080').toUpperCase();
};

/** A part's paint: its colour, its bodies' by role (label text, split volumes), or its bands by height. */
export function partPaint(job: PrintJob, partKey: string): ScenePaint | undefined {
  const cs = job.colours;
  const part = job.parts[partKey];
  const st = strategyOf(cs);
  if (!cs || !part || !st) return undefined;
  const spec = job.meshes[part.meshKey];
  const col = colourOf(job);
  if (st === 'height') {
    const prof = partProfile(cs, part, spec);
    return { main: col(prof[0].slot), bands: prof.map((b) => ({ z: b.z, color: col(b.slot) })) };
  }
  const roles: Partial<Record<ColourRole, string>> = {};
  for (const r of ROLES) {
    // By part, only the label text and shadow floors keep a colour of their own.
    if (st === 'part' && r.id !== 'labelText' && r.id !== 'shadow') continue;
    roles[r.id] = col(partRoleSlot(cs, r.id, part.colour));
  }
  return { main: col(partSlot(cs, part, spec)), roles };
}

/** Every palette slot, for the legend (the view lists those it shows). */
export function colourLegend(job: PrintJob): LegendEntry[] | undefined {
  const cs = job.colours;
  if (!cs) return undefined;
  const col = colourOf(job);
  const seen = new Set<string>();
  const out: LegendEntry[] = [];
  for (let s = 1; s <= 16; s++) {
    const c = col(s);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push({ color: c, label: slotLabel(cs, s) });
  }
  return out;
}
