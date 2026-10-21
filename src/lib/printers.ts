export interface PrinterProfile {
  id: string;
  name: string;
  brand: string;
  /** Printable bed area, mm. */
  bedW: number;
  bedD: number;
  maxH: number;
  /** Bed areas no part may overlap (bed coordinates, front-left = 0,0), mm. */
  bedExclude?: BedRect[];
  /** Bambu Studio printer preset, when the project export can target it directly. */
  bambu?: { printerModel: string; printerPreset: string; processPreset: string; filamentPreset: string };
}

export interface BedRect {
  x: number;
  y: number;
  w: number;
  d: number;
}

/**
 * Bambu Studio's `bed_exclude_area` for the X1 and P1 series. Slicing fails if any
 * part's footprint overlaps it ("… is too close to exclusion area").
 */
const X1_P1_EXCLUDE: BedRect[] = [{ x: 0, y: 0, w: 18, d: 28 }];

const bambu = (model: string, w = 256, d = 256, h = 256, id?: string): PrinterProfile => ({
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
});

/** Bed sizes and exclusion areas for Bambu models come from Bambu Studio's own machine profiles. */
export const PRINTERS: PrinterProfile[] = [
  bambu('P2S'),
  { ...bambu('P1S'), bedExclude: X1_P1_EXCLUDE },
  { ...bambu('P1P'), bedExclude: X1_P1_EXCLUDE },
  { ...bambu('X1 Carbon', 256, 256, 256, 'x1c'), bedExclude: X1_P1_EXCLUDE },
  { ...bambu('X1E'), bedExclude: X1_P1_EXCLUDE },
  bambu('A1'),
  bambu('A1 mini', 180, 180, 180),
  bambu('H2D', 350, 320, 325),
  bambu('H2S', 340, 320, 340),
  { id: 'prusa-mk4s', name: 'Prusa MK4S', brand: 'Prusa', bedW: 250, bedD: 210, maxH: 220 },
  { id: 'prusa-core-one', name: 'Prusa CORE One', brand: 'Prusa', bedW: 250, bedD: 220, maxH: 270 },
  { id: 'prusa-mini', name: 'Prusa MINI+', brand: 'Prusa', bedW: 180, bedD: 180, maxH: 180 },
  { id: 'prusa-xl', name: 'Prusa XL', brand: 'Prusa', bedW: 360, bedD: 360, maxH: 360 },
  { id: 'creality-k1', name: 'Creality K1 / K1C', brand: 'Creality', bedW: 220, bedD: 220, maxH: 250 },
  { id: 'creality-k1-max', name: 'Creality K1 Max', brand: 'Creality', bedW: 300, bedD: 300, maxH: 300 },
  { id: 'creality-k2-plus', name: 'Creality K2 Plus', brand: 'Creality', bedW: 350, bedD: 350, maxH: 350 },
  { id: 'ender-3-v3', name: 'Creality Ender-3 V3', brand: 'Creality', bedW: 220, bedD: 220, maxH: 250 },
  { id: 'voron-350', name: 'Voron 2.4 (350)', brand: 'Voron', bedW: 350, bedD: 350, maxH: 340 },
  { id: 'custom', name: 'Custom…', brand: 'Custom', bedW: 220, bedD: 220, maxH: 250 },
];

export function findPrinter(id: string): PrinterProfile {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[0];
}
