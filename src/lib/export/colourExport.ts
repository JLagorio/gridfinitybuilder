import type { MeshData } from '../geometry/kernel';
import type { MeshSpec, PrintJob } from '../project';
import { findPrinter } from '../printers';
import {
  LAYERS,
  layerTop,
  overlayRole,
  paletteOf,
  printerSlots,
  slotName,
  strategyOf,
  type BandChange,
  type ColourRole,
  type ColourSetupFields,
} from '../colours';
import { bodySlots, partProfile } from '../colourPlan';

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * What the file writers need to know about colours (colours.ts): each body's
 * slot, each plate's filament changes ('height'), the palette, and the
 * slicers' per-layer files:
 *
 * - Bambu Studio: `Metadata/custom_gcode_per_layer.xml`, one `<plate>` per
 *   plate with changes; each `<layer top_z type extruder color extra gcode>`
 *   and a `<mode value>`. As BambuStudio's bbs_3mf.cpp writes and reads it:
 *   type 2 (CustomGCode::ToolChange) to filament `extruder` from the layer
 *   whose print_z is `top_z`, mode MultiAsSingle (every object on the plate in
 *   one filament: ToolOrdering only applies per-layer changes then); type 1
 *   (PausePrint, `machine_pause_gcode`) when the printer has no slot to change
 *   to, mode SingleExtruder.
 * - PrusaSlicer: `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml`, the
 *   same codes as `<code print_z type extruder color extra gcode>` under
 *   `<custom_gcodes_per_print_z>`: type 0 (ColorChange, M600) for extruder 1,
 *   mode SingleExtruder, which any single-extruder profile honours.
 */

/** The slot of each body (main, then the overlays) of a part's mesh. */
export function meshBodySlots(setup: ColourSetupFields, job: PrintJob, partKey: string, mesh: MeshData, base?: number): number[] {
  const part = job.parts[partKey];
  const roles: (ColourRole | null)[] = [mesh.role ?? null, ...(mesh.overlays ?? []).map((o) => overlayRole(o))];
  const legacy = [1, ...(mesh.overlays ?? []).map((o) => o.filament)];
  return bodySlots(setup, part, job.meshes[part.meshKey] as MeshSpec | undefined, roles, legacy, base);
}

/** A plate's filament changes by height ('height'), from its tallest part's bands; null when there are none. */
export interface PlateChanges {
  /** The slot it starts in: every object on the plate is in it. */
  base: number;
  /** Then, from each z (a layer boundary) up, another slot. */
  changes: BandChange[];
  /** The printer has too few slots: each change is a pause for a swap by hand. */
  pause: boolean;
}

export function plateChanges(setup: ColourSetupFields, job: PrintJob, plateIndex: number, printerId = setup.printerId): PlateChanges | null {
  if (strategyOf(setup) !== 'height') return null;
  const pl = job.plates[plateIndex];
  let best: BandChange[] | null = null;
  let top = 0;
  for (const p of pl.placements) {
    const part = job.parts[p.key];
    top = Math.max(top, part.h);
    const prof = partProfile(setup, part, job.meshes[part.meshKey]);
    if (!best || prof.length > best.length) best = prof;
  }
  if (!best?.length) return null;
  const changes = best.slice(1).filter((b) => b.z < top - 1e-6);
  const slots = new Set([best[0].slot, ...changes.map((c) => c.slot)]);
  return { base: best[0].slot, changes, pause: slots.size > printerSlots(setup, findPrinter(printerId).slots) };
}

/** Colour of every slot up to `count` for the project file: the palette (with multi-colour on). */
export function slotColours(setup: ColourSetupFields, count: number): string[] {
  return paletteOf(setup, count)
    .slice(0, count)
    .map((f) => f.colour.toUpperCase());
}

const f4 = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** Bambu Studio's per-plate layer changes (see the module comment); null when no plate has any. */
export function bambuLayerChanges(setup: ColourSetupFields, plates: { plate: number; changes: PlateChanges | null }[]): string | null {
  const lines: string[] = [];
  const colours = slotColours(setup, 16);
  for (const { plate, changes } of plates) {
    if (!changes?.changes.length) continue;
    lines.push('<plate>', `<plate_info id="${plate + 1}"/>`);
    for (const c of changes.changes) {
      const z = f4(layerTop(c.z, LAYERS));
      const colour = colours[c.slot - 1] ?? '#808080';
      if (changes.pause) {
        const msg = escapeXml(`Load ${slotName(setup, c.slot)} (slot ${c.slot})`);
        lines.push(`<layer top_z="${z}" type="1" extruder="1" color="" extra="${msg}" gcode="M400 U1"/>`);
      } else lines.push(`<layer top_z="${z}" type="2" extruder="${c.slot}" color="${colour}" extra="" gcode="tool_change"/>`);
    }
    lines.push(`<mode value="${changes.pause ? 'SingleExtruder' : 'MultiAsSingle'}"/>`, '</plate>');
  }
  if (!lines.length) return null;
  return ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_layer>', ...lines, '</custom_gcodes_per_layer>', ''].join('\n');
}

/** PrusaSlicer's colour changes for one plate's 3MF (see the module comment); null without changes. */
export function prusaLayerChanges(setup: ColourSetupFields, changes: PlateChanges | null): string | null {
  if (!changes?.changes.length) return null;
  const colours = slotColours(setup, 16);
  const lines = changes.changes.map(
    (c) => `<code print_z="${f4(layerTop(c.z, LAYERS))}" type="0" extruder="1" color="${colours[c.slot - 1] ?? '#808080'}" extra="" gcode="M600"/>`,
  );
  return ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_print_z>', ...lines, '<mode value="SingleExtruder"/>', '</custom_gcodes_per_print_z>', ''].join('\n');
}

/** "Plate 3: Black, Red from 4.8 mm, White from 39.2 mm", for the READMEs of files that can't say it themselves (STL). */
export function changesText(setup: ColourSetupFields, changes: PlateChanges | null): string {
  if (!changes) return '';
  const parts = [slotName(setup, changes.base), ...changes.changes.map((c) => `${slotName(setup, c.slot)} from ${f4(c.z)} mm`)];
  return `${parts.join(', ')}${changes.pause ? ' (pause and swap by hand)' : ''}`;
}
