import { baseplateFloor, screwPlacement } from './geometry/baseplate';
import { lowSideOf } from './geometry/connectors';
import { maskSet } from './geometry/mask';
import { binHoleSites } from './geometry/bin';
import { BP_PROFILE_DEPTH, GRID, PIN, SCREW_JOIN } from './geometry/spec';
import { baseSpec, type MeshSpec, type PrintJob } from './project';
import type { PrintSetup } from './layout/plan';
import { STANDARD_PROCESS, currencySymbol, formatDuration, formatMoney, plateCost, slotGrams, type CostBreakdown, type PlateEstimate } from './estimate';
import { coloursOn, slotLabel, slotPrice } from './colours';
import { enclosurePartHardware, type EnclosurePartKind } from './enclosures';
import { attachmentDef } from './wall';
import { printerSetup } from './layout/fleet';

/**
 * Bill of materials for a print job: hardware to buy, parts and plates, and a
 * filament estimate per plate: what the print-time estimate extrudes once the
 * plate's parts are sliced, a quick guess from the mesh volumes until then.
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
  /**
   * Printed (extruded) volume of the parts, mm³: from the sliced layers once the
   * plate is sliced, else the meshes' quick `printedVolume`; null until one of them is known.
   */
  volume: number | null;
  grams: number | null;
  meters: number | null;
  /** True when the filament figures come from the sliced layers (for the total: every plate's do). */
  sliced?: boolean;
  /** Estimated print time with the start sequence, s; null until the plate's parts are sliced (or without an estimate). */
  seconds?: number | null;
  /** Filament swaps for two-colour parts, and the filament they purge, g. */
  swaps?: number;
  wasteGrams?: number;
  /** Filament (and electricity) cost; null until grams and time are known. */
  cost?: CostBreakdown | null;
  /** The printer it's for, with several (JobPlate.printer). */
  printer?: number;
  /** Multi-colour (colours.ts): grams, purge and filament cost by palette slot, once sliced. */
  slots?: SlotBom[];
  /** Colour changes done by hand (pauses): the printer has fewer slots than the plate uses. */
  manual?: boolean;
}

/** One filament slot's share. */
export interface SlotBom {
  slot: number;
  /** "Slot 2 · Black". */
  name: string;
  grams: number;
  /** Purge and prime tower, g. */
  waste: number;
  /** Filament and purge at the slot's price. */
  cost: number;
}

/** One printer's share of a job printed on several. */
export interface PrinterBom {
  name: string;
  /** How many plates it prints. */
  plates: number;
  parts: number;
  grams: number | null;
  /** Its plates one after another, s; null until each one is estimated. */
  seconds: number | null;
  cost: CostBreakdown | null;
}

export interface Bom {
  hardware: HardwareLine[];
  /**
   * `trays` is only set when there are lift-out trays (cups count as trays), `pads` when there are TPU pads, `enclosure` when there
   * are case, wall-grid or spacer parts. Sliding lids count as lids, rail
   * plates and grid inserts as dividers, lid keys as connector keys.
   */
  parts: {
    pieces: number;
    bins: number;
    lids: number;
    keys: number;
    dividers: number;
    labels: number;
    trays?: number;
    pads?: number;
    enclosure?: Partial<Record<EnclosurePartKind, number>>;
    /** Skådis board attachments and their parts (lib/wall); only set when there are some. */
    attachments?: number;
  };
  plates: PlateBom[];
  total: PlateBom;
  /** Set when the BOM has time and cost figures. */
  estimate?: { printer: string; currency: string; electricity: boolean };
  /** With several printers: each one's share. */
  printers?: PrinterBom[];
  /** With several printers: when the last one is done, s (null until every plate is estimated). */
  finish?: number | null;
  /** Multi-colour: each filament slot's grams, purge and cost over the job (once every plate is sliced). */
  filaments?: SlotBom[];
}

/** Time and cost inputs for billOfMaterials. */
export interface BomEstimate {
  /** Per-plate estimates (estimate.ts estimateJob), null where the parts aren't sliced yet. Their extruded volume replaces `volumes`. */
  plates: (PlateEstimate | null)[];
  /** Volume of a mesh's filament-2 bodies (inlaid text), mm³, when known. */
  overlayVolume?: (meshKey: string) => number | undefined;
  setup: Pick<PrintSetup, 'printerId' | 'filamentPrice' | 'filamentPrice2' | 'kwhPrice' | 'printerWatts' | 'currency' | 'printers' | 'filaments' | 'colours'>;
  /** Printer name, for the notes. */
  printer: string;
  /** Every printer's name when the job is for several (PrintJob.printers): the BOM then has each one's share. */
  printers?: string[];
}

/**
 * Filament for an extruded volume. The volumes are already as printed (walls
 * and skin solid, infill at its density), so this is just density and
 * filament cross-section.
 */
export function filamentFor(volumeMm3: number) {
  const printed = volumeMm3;
  const area = Math.PI * (FILAMENT_DIAMETER / 2) ** 2;
  return { grams: (printed / 1000) * PLA_DENSITY, meters: printed / area / 1000 };
}

/** Holes in one mesh, by kind of hardware. */
function holesIn(split: MeshSpec | undefined): { item: string; count: number; note?: string }[] {
  const spec = baseSpec(split);
  if (!spec) return [];
  if (spec.kind === 'enclosure') return enclosurePartHardware(spec.part);
  if (spec.kind === 'attachment') return attachmentDef(spec.type)?.hardware?.(spec.opts) ?? [];
  if (spec.kind === 'piece') {
    const o = spec.opts;
    const out: HardwareLine[] = [...(spec.enclosure?.hardware ?? [])];
    // A Skådis tile is no baseplate: its screws are all in its hardware.
    if (spec.enclosure?.kind === 'skadis') return out;
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
 * The job's bill of materials. A plate's filament is its estimate's extruded
 * volume once its parts are sliced; until then the sum of `volumes` (mesh key
 * to printed volume, mm³), or null while a mesh is unmeasured. Grams, metres,
 * cost, the total and the exports all follow from that one volume.
 */
export function billOfMaterials(
  job: PrintJob,
  volumes: (meshKey: string) => number | undefined = () => undefined,
  estimate?: BomEstimate,
): Bom {
  const hardware = new Map<string, HardwareLine>();
  const parts: Bom['parts'] = { pieces: 0, bins: 0, lids: 0, keys: 0, dividers: 0, labels: 0 };
  const plates: PlateBom[] = job.plates.map((pl, plateIndex) => {
    let volume: number | null = 0;
    let second = 0;
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      if (part.kind === 'piece') parts.pieces++;
      else if (part.kind === 'bin') parts.bins++;
      else if (part.kind === 'attachment') parts.attachments = (parts.attachments ?? 0) + 1;
      else if (part.kind === 'lid') parts.lids++;
      else if (part.kind === 'divider') parts.dividers++;
      else if (part.kind === 'label') parts.labels++;
      else if (part.kind === 'tray') parts.trays = (parts.trays ?? 0) + 1;
      else if (part.kind === 'pad') parts.pads = (parts.pads ?? 0) + 1;
      else if (part.kind === 'enclosure') {
        const e = (parts.enclosure ??= {});
        const k = part.enclosure ?? 'lid';
        e[k] = (e[k] ?? 0) + 1;
      }
      else parts.keys++;
      for (const h of holesIn(job.meshes[part.meshKey])) {
        const line = hardware.get(h.item) ?? { item: h.item, count: 0, note: h.note };
        line.count += h.count;
        hardware.set(h.item, line);
      }
      const v = volumes(part.meshKey);
      volume = volume === null || v === undefined ? null : volume + v;
      second += estimate?.overlayVolume?.(part.meshKey) ?? 0;
    }
    const est = estimate?.plates[plateIndex] ?? null;
    if (est) volume = est.extruded;
    const out: PlateBom = { name: pl.name, parts: pl.placements.length, ...plateFilament(volume), sliced: !!est };
    if (pl.printer !== undefined) out.printer = pl.printer;
    if (estimate) {
      out.seconds = est?.seconds ?? null;
      out.swaps = est?.swaps ?? 0;
      out.wasteGrams = est?.wasteGrams ?? 0;
      // Inlaid text prints solid, so its grams are its volume's.
      const g2 = Math.min(out.grams ?? 0, filamentFor(second).grams);
      const at = printerSetup(estimate.setup, pl.printer ?? 0);
      out.cost =
        est && out.grams !== null
          ? plateCost({ main: out.grams - g2, second: g2, waste: est.wasteGrams }, est.seconds, at)
          : null;
      // Multi-colour: each slot's grams in its material, at its price (colours.ts).
      if (est?.slotVolume && coloursOn(estimate.setup)) {
        const grams = slotGrams(estimate.setup, est.slotVolume);
        const waste = est.slotWaste ?? [];
        out.slots = grams
          .map((g, slot) => ({ slot, g, w: waste[slot] ?? 0 }))
          .filter((x) => x.slot > 0 && (x.g > 0 || x.w > 0))
          .map(({ slot, g, w }) => ({ slot, name: slotLabel(estimate.setup, slot), grams: g, waste: w, cost: ((g + w) * slotPrice(estimate.setup, slot)) / 1000 }));
        out.grams = grams.reduce((t, g) => t + g, 0);
        out.cost = plateCost({ main: 0, second: 0, waste: 0, slots: grams, slotWaste: waste }, est.seconds, at);
        if (est.manual) out.manual = true;
      }
    }
    return out;
  });
  const known = plates.every((p) => p.volume !== null);
  const total: PlateBom = {
    name: 'Total',
    parts: plates.reduce((t, p) => t + p.parts, 0),
    ...plateFilament(known ? plates.reduce((t, p) => t + p.volume!, 0) : null),
    sliced: plates.length > 0 && plates.every((p) => p.sliced),
  };
  const bom: Bom = { hardware: [...hardware.values()], parts, plates, total };
  if (estimate) {
    const sum = (f: (p: PlateBom) => number | null | undefined) =>
      plates.every((p) => f(p) !== null && f(p) !== undefined) ? plates.reduce((t, p) => t + f(p)!, 0) : null;
    total.seconds = sum((p) => p.seconds);
    total.swaps = plates.reduce((t, p) => t + (p.swaps ?? 0), 0);
    total.wasteGrams = plates.reduce((t, p) => t + (p.wasteGrams ?? 0), 0);
    // Multi-colour: grams in each slot's material, and each slot's share over the job.
    if (plates.some((p) => p.slots)) {
      if (plates.every((p) => p.grams !== null)) total.grams = plates.reduce((t, p) => t + p.grams!, 0);
      if (plates.every((p) => p.slots)) {
        const by = new Map<number, SlotBom>();
        for (const p of plates) {
          for (const x of p.slots!) {
            const y = by.get(x.slot) ?? { ...x, grams: 0, waste: 0, cost: 0 };
            y.grams += x.grams;
            y.waste += x.waste;
            y.cost += x.cost;
            by.set(x.slot, y);
          }
        }
        bom.filaments = [...by.values()].sort((a, b) => a.slot - b.slot);
      }
    }
    const filament = sum((p) => p.cost?.filament);
    const energy = sum((p) => p.cost?.energy);
    total.cost = filament === null || energy === null ? null : { filament, energy, total: filament + energy };
    bom.estimate = {
      printer: estimate.printer,
      currency: currencySymbol(estimate.setup.currency),
      electricity: !!estimate.setup.kwhPrice,
    };
    // Several printers print at the same time: the job is done when the slowest one is.
    if (estimate.printers && estimate.printers.length > 1) {
      bom.printers = estimate.printers.map((name, k) => {
        const mine = plates.filter((p) => (p.printer ?? 0) === k);
        const add = (f: (p: PlateBom) => number | null | undefined) =>
          mine.every((p) => f(p) !== null && f(p) !== undefined) ? mine.reduce((t, p) => t + f(p)!, 0) : null;
        const filament = add((p) => p.cost?.filament);
        const energy = add((p) => p.cost?.energy);
        return {
          name,
          plates: mine.length,
          parts: mine.reduce((t, p) => t + p.parts, 0),
          grams: add((p) => p.grams),
          seconds: add((p) => p.seconds),
          cost: filament === null || energy === null ? null : { filament, energy, total: filament + energy },
        };
      });
      const times = bom.printers.map((p) => p.seconds);
      bom.finish = times.every((t) => t !== null) ? Math.max(...(times as number[])) : null;
    }
  }
  return bom;
}

/** The printer that finishes last, with several. */
export function slowestPrinter(b: Bom): PrinterBom | null {
  if (!b.printers || b.finish === null || b.finish === undefined) return null;
  return b.printers.find((p) => p.seconds === b.finish) ?? null;
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

const minutes = (p: Pick<PlateBom, 'seconds'>) => (p.seconds === null || p.seconds === undefined ? '' : String(Math.round(p.seconds / 60)));
const money = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toFixed(2));

/** Spreadsheet-friendly BOM: hardware lines, then one row per plate (with time and cost when estimated). */
export function bomCsv(b: Bom): string {
  const cost = b.estimate ? `Cost (${b.estimate.currency})` : 'Cost';
  const rows: (string | number)[][] = [
    ['Section', 'Item', 'Quantity', 'Printed volume (cm³)', 'Filament (g)', 'Filament (m)', 'Print time (min)', cost, 'Notes'],
  ];
  const blank = ['', '', '', '', ''];
  for (const h of b.hardware) rows.push(['Hardware', h.item, h.count, ...blank, h.note ?? '']);
  rows.push(['Parts', 'Baseplate pieces', b.parts.pieces, ...blank, '']);
  rows.push(['Parts', 'Bins', b.parts.bins, ...blank, '']);
  if (b.parts.attachments) rows.push(['Parts', 'Board attachments', b.parts.attachments, ...blank, '']);
  if (b.parts.lids) rows.push(['Parts', 'Lids', b.parts.lids, ...blank, '']);
  if (b.parts.trays) rows.push(['Parts', 'Lift-out trays', b.parts.trays, ...blank, '']);
  if (b.parts.keys) rows.push(['Parts', 'Connector keys', b.parts.keys, ...blank, '']);
  if (b.parts.dividers) rows.push(['Parts', 'Removable dividers', b.parts.dividers, ...blank, '']);
  if (b.parts.labels) rows.push(['Parts', 'Label plates', b.parts.labels, ...blank, '']);
  if (b.parts.pads) rows.push(['Parts', 'Non-slip pads (TPU)', b.parts.pads, ...blank, 'print in TPU on their own plate; press into the recesses under the baseplate']);
  for (const [k, n] of enclosureCounts(b)) rows.push(['Parts', ENCLOSURE_PARTS[k][1], n, ...blank, '']);
  const on = (p: PlateBom) => (b.printers ? ` (${b.printers[p.printer ?? 0]?.name})` : '');
  b.plates.forEach((p, i) => {
    rows.push([
      'Plate',
      `${i + 1}. ${p.name}${on(p)}`,
      p.parts,
      r1(p.volume === null ? null : p.volume / 1000),
      r1(p.grams),
      r1(p.meters),
      minutes(p),
      money(p.cost?.total),
      p.swaps ? `${p.swaps} filament swaps, ${Math.round(p.wasteGrams ?? 0)} g purged` : '',
    ]);
  });
  const t = b.total;
  rows.push([
    'Total',
    `${b.plates.length} plates`,
    t.parts,
    r1(t.volume === null ? null : t.volume / 1000),
    r1(t.grams),
    r1(t.meters),
    minutes(t),
    money(t.cost?.total),
    filamentNote(),
  ]);
  for (const p of b.printers ?? []) rows.push(['Printer', p.name, p.parts, '', r1(p.grams), '', minutes(p), money(p.cost?.total), `${p.plates} plates`]);
  if (b.printers) {
    const slow = slowestPrinter(b);
    rows.push(['Done', 'All printers done', '', '', '', '', minutes({ seconds: b.finish }), '', slow ? `when the ${slow.name} finishes` : '']);
  }
  for (const x of b.filaments ?? []) rows.push(['Filament', x.name, '', '', r1(x.grams), '', '', money(x.cost), x.waste ? `${r1(x.waste)} g purged` : '']);
  if (b.estimate && t.cost) {
    rows.push(['Cost', 'Filament', '', '', '', '', '', money(t.cost.filament), '']);
    if (b.estimate.electricity) rows.push(['Cost', 'Electricity', '', '', '', '', '', money(t.cost.energy), '']);
  }
  if (b.estimate) rows.push(['Note', '', '', '', '', '', '', '', estimateNote(b.estimate.printer)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** What the time estimate assumes. */
export function estimateNote(printer: string) {
  return `Print time for Bambu's 0.20 mm Standard (PLA Basic) on the ${printer}, start sequence included. Expect ±25 %`;
}

/** Plain-text BOM, for printing or pasting. */
export function bomText(b: Bom): string {
  const lines = ['BILL OF MATERIALS', '='.repeat(40), '', 'Hardware'];
  if (!b.hardware.length) lines.push('  none');
  for (const h of b.hardware) lines.push(`  ${String(h.count).padStart(4)} × ${h.item}${h.note ? ` (${h.note})` : ''}`);
  lines.push(
    '',
    'Parts',
    `  ${b.parts.pieces} baseplate pieces, ${b.parts.bins} bins${b.parts.attachments ? `, ${b.parts.attachments} board attachments` : ''}${b.parts.lids ? `, ${b.parts.lids} lids` : ''}${b.parts.trays ? `, ${b.parts.trays} trays` : ''}` +
      `${b.parts.keys ? `, ${b.parts.keys} connector keys` : ''}` +
      `${b.parts.dividers ? `, ${b.parts.dividers} removable dividers` : ''}${b.parts.labels ? `, ${b.parts.labels} label plates` : ''}` +
      enclosureCounts(b)
        .map(([k, n]) => `, ${enclosurePartsText(k, n)}`)
        .join(''),
  );
  if (b.parts.pads) lines.push(`  ${b.parts.pads} non-slip pads in TPU (their own plate; press into the recesses under the baseplate)`);
  lines.push('', `Plates (${b.plates.length})`);
  const fil = (p: PlateBom) => (p.grams === null ? 'not measured' : `${Math.round(p.grams)} g, ${r1(p.meters)} m`);
  const est = b.estimate;
  const extra = (p: PlateBom) => {
    if (!est) return '';
    const time = p.seconds === null || p.seconds === undefined ? 'time not estimated yet' : `about ${formatDuration(p.seconds)}`;
    const cost = p.cost ? `, ${formatMoney(p.cost.total, est.currency)}` : '';
    return `, ${time}${cost}`;
  };
  const on = (p: PlateBom) => (b.printers ? `, on the ${b.printers[p.printer ?? 0]?.name}` : '');
  b.plates.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name}${on(p)}: ${p.parts} parts, ${fil(p)}${extra(p)}`));
  lines.push('', `Filament total: ${fil(b.total)}`, `  ${filamentNote()}`);
  if (b.filaments?.length) {
    lines.push('', 'Filament by slot');
    for (const x of b.filaments) {
      const cost = b.estimate ? `, ${formatMoney(x.cost, b.estimate.currency)}` : '';
      lines.push(`  ${x.name}: ${Math.round(x.grams)} g${x.waste ? ` + ${Math.round(x.waste * 10) / 10} g purged` : ''}${cost}`);
    }
  }
  if (est) {
    const t = b.total;
    lines.push('', `Print time total: ${t.seconds === null || t.seconds === undefined ? 'not estimated yet' : `about ${formatDuration(t.seconds)}`}`);
    if (t.swaps) lines.push(`  includes ${t.swaps} filament swaps (${Math.round(t.wasteGrams ?? 0)} g purged)`);
    lines.push(`  ${estimateNote(est.printer)}`);
    if (b.printers) {
      const time = (s: number | null) => (s === null ? 'time not estimated yet' : `about ${formatDuration(s)}`);
      lines.push('', 'Printers (printing at the same time)');
      for (const p of b.printers) {
        const g = p.grams === null ? '' : `, ${Math.round(p.grams)} g`;
        lines.push(`  ${p.name}: ${p.plates} plates${g}, ${time(p.seconds)}${p.cost ? `, ${formatMoney(p.cost.total, est.currency)}` : ''}`);
      }
      const slow = slowestPrinter(b);
      lines.push(`  All done in ${b.finish === null || b.finish === undefined ? 'a time not estimated yet' : time(b.finish)}${slow ? `, when the ${slow.name} finishes` : ''}`);
    }
    if (t.cost) {
      lines.push('', `Cost total: ${formatMoney(t.cost.total, est.currency)}`, `  filament ${formatMoney(t.cost.filament, est.currency)}`);
      if (est.electricity) lines.push(`  electricity ${formatMoney(t.cost.energy, est.currency)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Names of the enclosure parts in the parts list: one, several. */
export const ENCLOSURE_PARTS: Record<EnclosurePartKind, [string, string]> = {
  lid: ['Case lid piece', 'Case lid pieces'],
  pin: ['Hinge pin', 'Hinge pins'],
  handle: ['Handle part', 'Handle parts'],
  foot: ['Printed foot', 'Printed feet'],
  spacer: ['Spacer strip', 'Spacer strips'],
  cleat: ['Wall cleat', 'Wall cleats'],
  skadisPlate: ['Joint plate', 'Joint plates'],
  skadisSpacer: ['Standoff spacer', 'Standoff spacers'],
  skadisRim: ['Frame strip', 'Frame strips'],
  skadisHang: ['Part to hang it from', 'Parts to hang it from'],
};

/** "2 hinge pins". */
export const enclosurePartsText = (k: EnclosurePartKind, n: number) => `${n} ${ENCLOSURE_PARTS[k][n === 1 ? 0 : 1].toLowerCase()}`;

/** Enclosure part counts, in a fixed order. */
export function enclosureCounts(b: Bom): [EnclosurePartKind, number][] {
  const e = b.parts.enclosure ?? {};
  return (Object.keys(ENCLOSURE_PARTS) as EnclosurePartKind[]).filter((k) => e[k]).map((k) => [k, e[k]!]);
}

export function filamentNote() {
  const P = STANDARD_PROCESS;
  return (
    `${FILAMENT_DIAMETER} mm PLA at ${PLA_DENSITY} g/cm³, from each plate's sliced layers like the print time ` +
    `(Bambu's 0.20 mm Standard: ${P.wallLoops} walls, ${P.topLayers} top and ${P.bottomLayers} bottom layers, ${Math.round(P.infill * 100)} % infill). ` +
    `Expect ±10 %; before a plate is sliced, a quicker guess from the part surfaces that runs high on tall bins`
  );
}
