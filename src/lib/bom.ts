import { baseplateFloor, screwPlacement } from './geometry/baseplate';
import { lowSideOf } from './geometry/connectors';
import { maskSet } from './geometry/mask';
import { binHoleSites } from './geometry/bin';
import { BP_PROFILE_DEPTH, GRID, PIN, SCREW_JOIN } from './geometry/spec';
import { PRINT_ESTIMATE } from './geometry/volume';
import type { MeshSpec, PrintJob } from './project';

/**
 * Bill of materials for a print job: hardware to buy, parts and plates, and a
 * filament estimate from the mesh volumes.
 *
 * Hardware is counted from what's on the plates, using the same rules as the
 * geometry: four magnet (or screw) holes per full cell, none in partial edge
 * cells, only the outer four with corner-only holes, none in flat bins; one
 * countersunk screw hole per baseplate cell big enough for the head (four, in
 * the corner bosses, for weighted and skeletonized plates); nothing in blocked
 * cells. Seam joints: one pin, or one screw and nut / insert, per joint.
 */

/** PLA density, g/cm³. */
export const PLA_DENSITY = 1.24;
/** Filament diameter, mm. */
export const FILAMENT_DIAMETER = 1.75;

const FULL = GRID - 1e-6;

export interface HardwareLine {
  item: string;
  count: number;
  note?: string;
}

export interface PlateBom {
  name: string;
  parts: number;
  /** Printed (extruded) volume of the parts, mm³; null until every mesh has been measured. */
  volume: number | null;
  grams: number | null;
  meters: number | null;
}

export interface Bom {
  hardware: HardwareLine[];
  /** `trays` is only set when there are lift-out trays. Sliding lids count as lids, rail plates as dividers. */
  parts: { pieces: number; bins: number; lids: number; keys: number; dividers: number; labels: number; trays?: number };
  plates: PlateBom[];
  total: PlateBom;
}

/**
 * Filament for an extruded volume. The worker measures each mesh as a slicer
 * would print it (`printedVolume`: solid skin, 15 % infill inside), so this
 * is just density and filament cross-section.
 */
export function filamentFor(volumeMm3: number) {
  const printed = volumeMm3;
  const area = Math.PI * (FILAMENT_DIAMETER / 2) ** 2;
  return { grams: (printed / 1000) * PLA_DENSITY, meters: printed / area / 1000 };
}

/** Holes in one mesh, by kind of hardware. */
function holesIn(spec: MeshSpec | undefined): { item: string; count: number; note?: string }[] {
  if (!spec) return [];
  if (spec.kind === 'piece') {
    const o = spec.opts;
    const out = [];
    // Joints are shared by two pieces: count each on one side (pins: left / front; screws: the head side).
    const low = spec.connectors.filter((s) => lowSideOf(s, spec.piece));
    if (o.connector === 'pin' && low.length) {
      out.push({ item: `Filament pins 1.75 × ${PIN.length - 0.5} mm (joints)`, count: low.length, note: 'cut from filament' });
    }
    const heads = spec.connectors.filter((s) => lowSideOf(s, spec.piece) !== !!s.flip).length;
    if (o.connector === 'screw' && heads) {
      out.push({ item: `${SCREW_JOIN.screw} socket head screws (joints)`, count: heads });
      out.push({ item: o.screwFastener === 'insert' ? 'M3 heat-set inserts (joints)' : 'M3 hex nuts (joints)', count: heads });
    }
    const floor = baseplateFloor(o);
    if (floor <= 0) return out;
    let magnets = 0;
    let screws = 0;
    const { xs, ys } = spec.layout;
    const blocked = maskSet(spec.layout);
    const sp = screwPlacement(o);
    for (let i = spec.piece.cells.x0; i < spec.piece.cells.x1; i++) {
      for (let j = spec.piece.cells.y0; j < spec.piece.cells.y1; j++) {
        if (blocked.has(`${i},${j}`)) continue;
        const cw = xs[i + 1] - xs[i];
        const cd = ys[j + 1] - ys[j];
        const full = Math.min(cw, cd) >= FULL;
        if (o.magnets && full) magnets += 4;
        if (sp === 'center' && Math.min(cw, cd) >= o.screwHeadDiameter + 2 * BP_PROFILE_DEPTH) screws++;
        if (sp === 'corner' && full) screws += 4;
      }
    }
    if (magnets) {
      out.push({
        item: `Magnets ${o.magnetDiameter} × ${o.magnetHeight} mm (baseplate)`,
        count: magnets,
        note: o.magnetSide === 'bottom' ? 'pressed in from below' : 'pressed in from above',
      });
    }
    if (screws) {
      const where = sp === 'corner' ? 'four holes per cell' : 'one hole per cell';
      out.push({ item: `M${o.screwDiameter} countersunk screws (baseplate)`, count: screws, note: `${where}; use as many as you need` });
    }
    return out;
  }
  if (spec.kind === 'bin') {
    const o = spec.opts;
    const h = String(o.holes ?? 'none');
    if (h === 'none' || o.base === 'flat') return [];
    const n = binHoleSites(o, spec.cells).length;
    const out = [];
    // Refined slots hold the same 6 × 2 mm magnets, slid in from the side.
    if (n && (h === 'both' || h === 'magnets' || h === 'refined')) out.push({ item: 'Magnets 6 × 2 mm (bins)', count: n });
    if (n && (h === 'both' || h === 'screws')) out.push({ item: 'M3 screws (bins)', count: n });
    return out;
  }
  return [];
}

/**
 * The job's bill of materials. `volumes` maps mesh keys to solid volumes (mm³);
 * plates with unmeasured meshes get null filament figures.
 */
export function billOfMaterials(job: PrintJob, volumes: (meshKey: string) => number | undefined = () => undefined): Bom {
  const hardware = new Map<string, HardwareLine>();
  const parts: Bom['parts'] = { pieces: 0, bins: 0, lids: 0, keys: 0, dividers: 0, labels: 0 };
  const plates: PlateBom[] = job.plates.map((pl) => {
    let volume: number | null = 0;
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      if (part.kind === 'piece') parts.pieces++;
      else if (part.kind === 'bin') parts.bins++;
      else if (part.kind === 'lid') parts.lids++;
      else if (part.kind === 'divider') parts.dividers++;
      else if (part.kind === 'label') parts.labels++;
      else if (part.kind === 'tray') parts.trays = (parts.trays ?? 0) + 1;
      else parts.keys++;
      for (const h of holesIn(job.meshes[part.meshKey])) {
        const line = hardware.get(h.item) ?? { item: h.item, count: 0, note: h.note };
        line.count += h.count;
        hardware.set(h.item, line);
      }
      const v = volumes(part.meshKey);
      volume = volume === null || v === undefined ? null : volume + v;
    }
    return { name: pl.name, parts: pl.placements.length, ...plateFilament(volume) };
  });
  const known = plates.every((p) => p.volume !== null);
  const total = {
    name: 'Total',
    parts: plates.reduce((t, p) => t + p.parts, 0),
    ...plateFilament(known ? plates.reduce((t, p) => t + p.volume!, 0) : null),
  };
  return { hardware: [...hardware.values()], parts, plates, total };
}

function plateFilament(volume: number | null) {
  if (volume === null) return { volume: null, grams: null, meters: null };
  return { volume, ...filamentFor(volume) };
}

const r1 = (v: number | null) => (v === null ? '' : String(Math.round(v * 10) / 10));

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Spreadsheet-friendly BOM: hardware lines, then one row per plate. */
export function bomCsv(b: Bom): string {
  const rows: (string | number)[][] = [['Section', 'Item', 'Quantity', 'Printed volume (cm³)', 'Filament (g)', 'Filament (m)', 'Notes']];
  for (const h of b.hardware) rows.push(['Hardware', h.item, h.count, '', '', '', h.note ?? '']);
  rows.push(['Parts', 'Baseplate pieces', b.parts.pieces, '', '', '', '']);
  rows.push(['Parts', 'Bins', b.parts.bins, '', '', '', '']);
  if (b.parts.lids) rows.push(['Parts', 'Lids', b.parts.lids, '', '', '', '']);
  if (b.parts.trays) rows.push(['Parts', 'Lift-out trays', b.parts.trays, '', '', '', '']);
  if (b.parts.keys) rows.push(['Parts', 'Connector keys', b.parts.keys, '', '', '', '']);
  if (b.parts.dividers) rows.push(['Parts', 'Removable dividers', b.parts.dividers, '', '', '', '']);
  if (b.parts.labels) rows.push(['Parts', 'Label plates', b.parts.labels, '', '', '', '']);
  b.plates.forEach((p, i) => {
    rows.push(['Plate', `${i + 1}. ${p.name}`, p.parts, r1(p.volume === null ? null : p.volume / 1000), r1(p.grams), r1(p.meters), '']);
  });
  const t = b.total;
  rows.push(['Total', `${b.plates.length} plates`, t.parts, r1(t.volume === null ? null : t.volume / 1000), r1(t.grams), r1(t.meters), filamentNote()]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Plain-text BOM, for printing or pasting. */
export function bomText(b: Bom): string {
  const lines = ['BILL OF MATERIALS', '='.repeat(40), '', 'Hardware'];
  if (!b.hardware.length) lines.push('  none');
  for (const h of b.hardware) lines.push(`  ${String(h.count).padStart(4)} × ${h.item}${h.note ? ` (${h.note})` : ''}`);
  lines.push(
    '',
    'Parts',
    `  ${b.parts.pieces} baseplate pieces, ${b.parts.bins} bins${b.parts.lids ? `, ${b.parts.lids} lids` : ''}${b.parts.trays ? `, ${b.parts.trays} trays` : ''}` +
      `${b.parts.keys ? `, ${b.parts.keys} connector keys` : ''}` +
      `${b.parts.dividers ? `, ${b.parts.dividers} removable dividers` : ''}${b.parts.labels ? `, ${b.parts.labels} label plates` : ''}`,
  );
  lines.push('', `Plates (${b.plates.length})`);
  const fil = (p: PlateBom) => (p.grams === null ? 'not measured' : `${Math.round(p.grams)} g, ${r1(p.meters)} m`);
  b.plates.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name}: ${p.parts} parts, ${fil(p)}`));
  lines.push('', `Filament total: ${fil(b.total)}`, `  ${filamentNote()}`, '');
  return lines.join('\n');
}

export function filamentNote() {
  return `${FILAMENT_DIAMETER} mm PLA at ${PLA_DENSITY} g/cm³: walls and top/bottom layers solid (${PRINT_ESTIMATE.shell} mm), ${Math.round(PRINT_ESTIMATE.infill * 100)} % infill inside, like Bambu's 0.20 mm Standard. Expect ±15 %`;
}
