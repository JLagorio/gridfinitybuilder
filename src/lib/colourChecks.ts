import type { FoundCheck } from './printability';
import type { PlateEstimate } from './estimate';
import type { PrintSetup } from './layout/plan';
import { baseSpec, type MeshSpec, type PrintJob } from './project';
import { findPrinter } from './printers';
import { LAYERS, luminance, paletteOf, partRoleSlot, printerSlots, slotName, strategyOf, type ColourSetup } from './colours';
import { partProfile, partSlot } from './colourPlan';
import { featureSplitBlocked } from './geometry/colourRegions';
import { binFrontQr, binUsesInlay } from './geometry/bin';
import { planLidQr } from './geometry/lid';
import { qrInlaid } from './geometry/qrCode';
import { filamentFor } from './bom';
import { wallInlaid } from './wall/board';

/**
 * Print checks for multi-colour (colours.ts), printability.ts style: one
 * sentence each, with a one-click fix where one setting change does it.
 * About the whole job, so they list under "Colours".
 *
 * - colour-slots: more slots on a plate than the printer feeds (by feature,
 *   or mixed plates, need an AMS; by height pauses to swap by hand).
 * - colour-purge: a plate that purges a lot (by feature, mixed plates).
 * - colour-mixed: plates by part with parts of several colours.
 * - colour-band: a colour band thinner than two layers.
 * - colour-inlay: inlaid text by height prints in the band's colour.
 * - colour-material: slots in another material than the project's PLA.
 * - colour-qr: inlaid QR codes no darker than what they're on (cameras read
 *   dark modules on a light ground).
 */

/** A plate purging more than this, g, or more than `share` of what it prints, is worth a warning. */
export const PURGE = { warn: 25, info: 8, share: 0.5 } as const;

const GROUP = 'Colours';

const colours = (setup: PrintSetup, patch: Partial<ColourSetup>): Partial<PrintSetup> => ({ colours: { ...setup.colours, ...patch } });

/** An inlaid QR code in this part (qrCode.ts): on a QR plate, a stacking or sliding lid, or the bin's front wall. */
export function inlaidQrIn(spec: MeshSpec | undefined): boolean {
  if (!spec) return false;
  if (spec.kind === 'qrPlate') return spec.plate.spot.style === 'inlaid';
  if (spec.kind === 'lid') return planLidQr(spec.opts, spec.cells)?.spot?.style === 'inlaid';
  if (spec.kind === 'accessory') return spec.part.type === 'slideLid' && spec.part.qr?.style === 'inlaid';
  if (spec.kind === 'bin') return qrInlaid(spec.opts) && !!binFrontQr(spec.opts, spec.cells)?.spot;
  return false;
}

/** How much darker the QR code's filament must be than what it's on (relative luminance). */
const QR_CONTRAST = 0.15;

export function colourChecks(job: PrintJob, setup: PrintSetup, estimates: readonly (PlateEstimate | null)[] = []): FoundCheck[] {
  const st = strategyOf(setup);
  if (!st) return [];
  const out: FoundCheck[] = [];
  const add = (c: Omit<FoundCheck, 'group'>) => out.push({ ...c, group: GROUP });
  const printer = findPrinter(setup.printerId);
  const feeds = printerSlots(setup, printer.slots);
  const mixed = st === 'feature' || (st === 'part' && !!setup.colours?.mix);

  // Slots each plate prints in.
  const plateSlots = job.plates.map((pl, i) => {
    const est = estimates[i];
    if (est?.slotVolume) return est.slotVolume.map((v, s) => (v > 0 ? s : 0)).filter(Boolean);
    const set = new Set<number>();
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      const spec = job.meshes[part.meshKey];
      // By height and by feature (before it's sliced): the slots of the part's bands.
      if (st !== 'part') for (const b of partProfile(setup, part, spec)) set.add(b.slot);
      set.add(partSlot(setup, part, spec));
    }
    return [...set];
  });
  const most = Math.max(0, ...plateSlots.map((s) => s.length));

  if (most > feeds) {
    const many = plateSlots.findIndex((s) => s.length === most);
    const where = `plate ${many + 1} uses ${most}`;
    if (mixed) {
      add({
        rule: 'colour-slots',
        severity: 'warn',
        part: 'Filament slots',
        message: `The ${printer.name} feeds ${feeds} filament slot${feeds === 1 ? '' : 's'} and ${where}: ${st === 'feature' ? 'by feature' : 'mixed plates'} need${feeds === 1 ? ' an AMS or toolheads' : ' more slots'}.`,
        fix: { label: 'Print by part', setup: colours(setup, { strategy: undefined, mix: undefined }) },
      });
    } else if (st === 'height') {
      add({
        rule: 'colour-slots',
        severity: 'info',
        part: 'Filament slots',
        message: `The ${printer.name} feeds ${feeds} filament slot${feeds === 1 ? '' : 's'} and ${where}: each colour change pauses the print for you to swap the spool.`,
      });
    }
  }

  // Purge per plate (once it's sliced).
  estimates.forEach((est, i) => {
    if (!est || !est.swaps) return;
    const grams = filamentFor(est.extruded).grams;
    const level = est.wasteGrams > PURGE.warn || est.wasteGrams > PURGE.share * grams ? 'warn' : est.wasteGrams > PURGE.info ? 'info' : null;
    if (!level || st === 'height') return;
    add({
      rule: 'colour-purge',
      severity: level,
      part: `Plate ${i + 1}`,
      message: `${job.plates[i].name} swaps filament ${est.swaps} times and purges about ${Math.round(est.wasteGrams)} g, for ${Math.round(grams)} g of parts.`,
      fix:
        st === 'feature'
          ? { label: 'Print by part', setup: colours(setup, { strategy: undefined }) }
          : { label: 'Keep colours on separate plates', setup: colours(setup, { mix: undefined }) },
    });
  });

  // Mixed plates by part.
  if (st === 'part' && setup.colours?.mix) {
    const n = plateSlots.filter((s) => s.length > 1).length;
    if (n) {
      add({
        rule: 'colour-mixed',
        severity: 'info',
        part: 'Plates',
        message: `${n} plate${n === 1 ? ' has' : 's have'} parts in several colours: every layer they share swaps filament.`,
        fix: { label: 'Keep colours on separate plates', setup: colours(setup, { mix: undefined }) },
      });
    }
  }

  // Bands thinner than two layers.
  if (st === 'height' || st === 'feature') {
    const thin = new Set<string>();
    for (const part of Object.values(job.parts)) {
      const prof = partProfile(setup, part, job.meshes[part.meshKey]);
      prof.forEach((b, i) => {
        const top = prof[i + 1]?.z ?? part.h;
        if (top - b.z < 2 * LAYERS.height - 1e-6 && top - b.z > 1e-6) thin.add(`${slotName(setup, b.slot)} from ${b.z} mm`);
      });
    }
    if (thin.size) {
      add({
        rule: 'colour-band',
        severity: 'info',
        part: 'Colour bands',
        message: `${[...thin].slice(0, 2).join(', ')}${thin.size > 2 ? ` and ${thin.size - 2} more` : ''}: thinner than two layers, so it hardly shows.`,
      });
    }
  }

  // Inlaid text by height prints in the band's colour.
  if (st === 'height') {
    const inlaid = job.plates.some((pl) =>
      pl.placements.some((p) => {
        const spec = baseSpec(job.meshes[job.parts[p.key].meshKey]);
        return (
          (spec?.kind === 'bin' && binUsesInlay(spec.opts, spec.cells)) ||
          (spec?.kind === 'label' && spec.plate.style === 'inlaid') ||
          inlaidQrIn(spec) ||
          wallInlaid(spec)
        );
      }),
    );
    if (inlaid) {
      add({
        rule: 'colour-inlay',
        severity: 'info',
        part: 'Label text',
        message: 'By height, inlaid label text prints in the colour of its band: slicers only change filament by layer when every part on a plate is in one filament.',
        fix: { label: 'Print by part', setup: colours(setup, { strategy: undefined }) },
      });
    }
  }

  // Inlaid QR codes: dark modules on a light ground (by height they print in the band's colour: colour-inlay).
  if (st !== 'height') {
    const pal = paletteOf(setup, 16);
    const lum = (slot: number) => luminance(pal[slot - 1]?.colour ?? '#808080');
    let light = 0;
    let worst: { qr: number; on: number } | null = null;
    for (const pl of job.plates) {
      for (const p of pl.placements) {
        const part = job.parts[p.key];
        const spec = job.meshes[part.meshKey];
        if (!inlaidQrIn(baseSpec(spec))) continue;
        const qr = partRoleSlot(setup, 'qrCode', part.colour);
        const on = partSlot(setup, part, spec);
        if (lum(qr) > lum(on) - QR_CONTRAST) {
          light++;
          worst ??= { qr, on };
        }
      }
    }
    if (worst) {
      const darkest = pal.slice(0, Math.max(2, paletteOf(setup).length)).reduce((b, f, i) => (luminance(f.colour) < lum(b) ? i + 1 : b), 1);
      add({
        rule: 'colour-qr',
        severity: 'info',
        part: 'QR codes',
        message: `${light} QR code${light === 1 ? ' prints' : 's print'} in ${slotName(setup, worst.qr)} on ${slotName(setup, worst.on)}${light > 1 ? ' (or the like)' : ''}: no darker than what ${light === 1 ? 'it sits' : 'they sit'} on, and some phone cameras only read dark codes on a light ground. Give QR codes a dark filament, and what they're on a light one.`,
        ...(lum(darkest) < lum(worst.on) - QR_CONTRAST && darkest !== worst.qr
          ? { fix: { label: `QR codes in ${slotName(setup, darkest)}`, setup: colours(setup, { roles: { ...setup.colours?.roles, qrCode: darkest } }) } }
          : {}),
      });
    }
  }

  // Parts that print as one body by feature (vase-mode bins, imported meshes: colourRegions.ts).
  if (st === 'feature') {
    const whole = Object.values(job.parts).filter((p) => featureSplitBlocked(baseSpec(job.meshes[p.meshKey]))).length;
    if (whole) add({ rule: 'colour-slots', severity: 'info', part: 'Parts', message: `${whole} part${whole === 1 ? ' prints' : 's print'} as one body in its own colour (it can't be split by surface).` });
  }

  // Materials other than PLA in a Bambu project.
  if (printer.bambu) {
    const used = new Set(plateSlots.flat());
    const other = paletteOf(setup, Math.max(1, ...used)).flatMap((f, i) => (used.has(i + 1) && f.material && f.material !== 'PLA' ? [`slot ${i + 1} (${f.material})`] : []));
    if (other.length) {
      add({
        rule: 'colour-material',
        severity: 'info',
        part: 'Bambu project',
        message: `The project starts every filament as PLA Basic: pick the right preset for ${other.join(', ')} in Bambu Studio before slicing.`,
      });
    }
  }
  return out;
}
