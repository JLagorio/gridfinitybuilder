/**
 * What the print-time estimate needs to know about a printer (estimate.ts).
 * Bambu models: from their "0.20 mm Standard" and "Bambu PLA Basic" presets;
 * others: their usual limits, applied to the same process.
 */
export interface PrinterMotion {
  /** Fastest print or travel move, mm/s (caps the process speeds). */
  speed: number;
  /** Highest print acceleration, mm/s² (caps the process accelerations). */
  accel: number;
  /** PLA volumetric flow the hotend keeps up with, mm³/s. */
  flow: number;
  /** Start sequence: heating, levelling, purge line, s. */
  prepare: number;
  /** One filament swap for a colour change: cut, unload, load, flush, s. */
  swap: number;
  /** Typical power draw while printing PLA, W. */
  watts: number;
}

/** Bambu X1/P1-class motion: 0.20 mm Standard with PLA Basic (21 mm³/s). */
const BAMBU_MOTION: PrinterMotion = { speed: 500, accel: 10000, flow: 21, prepare: 330, swap: 75, watts: 105 };

/** For printers without data of their own. */
export const DEFAULT_MOTION: PrinterMotion = { speed: 300, accel: 5000, flow: 15, prepare: 240, swap: 90, watts: 120 };

export interface PrinterProfile {
  id: string;
  name: string;
  brand: string;
  /** Printable bed area, mm. */
  bedW: number;
  bedD: number;
  maxH: number;
  /** Bambu Studio printer preset, when the project export can target it directly. */
  bambu?: { printerModel: string; printerPreset: string; processPreset: string; filamentPreset: string };
  /** Speeds and limits for the print-time estimate (DEFAULT_MOTION when missing). */
  motion?: PrinterMotion;
  /**
   * Filament slots it usually feeds by itself: an AMS (4 per unit), a
   * multi-material unit or toolheads. 1 (or unset): one spool, colour changes
   * by hand. The setup's `filamentSlots` overrides it (colours.ts).
   */
  slots?: number;
}

const bambu = (model: string, w = 256, d = 256, h = 256, id?: string, motion: Partial<PrinterMotion> = {}, slots = 4): PrinterProfile => ({
  id: id ?? model.toLowerCase().replace(/\s+/g, '-'),
  name: `Bambu Lab ${model}`,
  brand: 'Bambu Lab',
  bedW: w,
  bedD: d,
  maxH: h,
  bambu: {
    printerModel: `Bambu Lab ${model}`,
    printerPreset: `Bambu Lab ${model} 0.4 nozzle`,
    processPreset: `0.20mm Standard @BBL ${model.replace(' Carbon', '')}`,
    filamentPreset: `Bambu PLA Basic @BBL ${model.replace(' Carbon', '')}`,
  },
  motion: { ...BAMBU_MOTION, ...motion },
  slots,
});

const generic = (id: string, name: string, brand: string, w: number, d: number, h: number, motion: PrinterMotion, slots = 1): PrinterProfile => ({
  id,
  name,
  brand,
  bedW: w,
  bedD: d,
  maxH: h,
  motion,
  slots,
});

/** Bed sizes for Bambu models come from Bambu Studio's own machine profiles. */
export const PRINTERS: PrinterProfile[] = [
  // Newer hotend and motion system; PLA Basic runs a little faster.
  bambu('P2S', 256, 256, 256, undefined, { speed: 600, accel: 20000, flow: 25, prepare: 300, swap: 60, watts: 110 }),
  bambu('P1S', 256, 256, 256, undefined, { prepare: 300, watts: 100 }),
  // Usually sold without an AMS.
  bambu('P1P', 256, 256, 256, undefined, { prepare: 300, watts: 90 }, 1),
  bambu('X1 Carbon', 256, 256, 256, 'x1c', { prepare: 360 }),
  bambu('X1E', 256, 256, 256, undefined, { prepare: 360, watts: 130 }),
  // Bed slingers: same process, lower acceleration limits; AMS lite swaps are a little slower.
  bambu('A1', 256, 256, 256, undefined, { accel: 10000, prepare: 300, swap: 85, watts: 95 }),
  bambu('A1 mini', 180, 180, 180, undefined, { accel: 10000, prepare: 240, swap: 85, watts: 70 }),
  // Two nozzles: a colour change is mostly a nozzle switch.
  bambu('H2D', 350, 320, 325, undefined, { speed: 600, accel: 20000, flow: 25, prepare: 420, swap: 35, watts: 170 }),
  bambu('H2S', 340, 320, 340, undefined, { speed: 600, accel: 20000, flow: 25, prepare: 360, swap: 70, watts: 160 }),
  generic('prusa-mk4s', 'Prusa MK4S', 'Prusa', 250, 210, 220, { speed: 300, accel: 4000, flow: 20, prepare: 240, swap: 120, watts: 85 }),
  generic('prusa-core-one', 'Prusa CORE One', 'Prusa', 250, 220, 270, { speed: 400, accel: 6000, flow: 20, prepare: 240, swap: 120, watts: 95 }),
  generic('prusa-mini', 'Prusa MINI+', 'Prusa', 180, 180, 180, { speed: 180, accel: 2000, flow: 10, prepare: 180, swap: 120, watts: 50 }),
  generic('prusa-xl', 'Prusa XL', 'Prusa', 360, 360, 360, { speed: 300, accel: 5000, flow: 20, prepare: 360, swap: 40, watts: 150 }, 5),
  generic('creality-k1', 'Creality K1 / K1C', 'Creality', 220, 220, 250, { speed: 600, accel: 12000, flow: 24, prepare: 240, swap: 90, watts: 120 }),
  generic('creality-k1-max', 'Creality K1 Max', 'Creality', 300, 300, 300, { speed: 600, accel: 12000, flow: 24, prepare: 300, swap: 90, watts: 200 }),
  // With the CFS (4 slots).
  generic('creality-k2-plus', 'Creality K2 Plus', 'Creality', 350, 350, 350, { speed: 600, accel: 15000, flow: 28, prepare: 360, swap: 80, watts: 250 }, 4),
  generic('ender-3-v3', 'Creality Ender-3 V3', 'Creality', 220, 220, 250, { speed: 500, accel: 8000, flow: 20, prepare: 180, swap: 120, watts: 110 }),
  generic('voron-350', 'Voron 2.4 (350)', 'Voron', 350, 350, 340, { speed: 400, accel: 6000, flow: 20, prepare: 600, swap: 120, watts: 250 }),
  { id: 'custom', name: 'Custom…', brand: 'Custom', bedW: 220, bedD: 220, maxH: 250, motion: DEFAULT_MOTION },
];

export function findPrinter(id: string): PrinterProfile {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[0];
}
