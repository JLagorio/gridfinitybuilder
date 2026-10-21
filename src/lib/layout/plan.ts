import type { GridLayout } from './drawer';
import { packPlates, type PackItem, type PlateLayout } from './pack';
import { cleanPrinters, type PrinterSetup } from './fleet';

export type { PlateLayout };
import {
  axisCuts,
  balanceScore,
  enumeratePartitions,
  greedyPartition,
  makePieces,
  type AxisPartition,
  type PieceDef,
} from './split';

export type SplitStyle = 'auto' | 'balanced' | 'largest';

export interface PrintSetup {
  printerId: string;
  bedW: number;
  bedD: number;
  maxH: number;
  /** Keep-out from the bed edge on every side, mm. */
  plateMargin: number;
  /** Gap between parts sharing a plate, mm. */
  spacing: number;
  splitStyle: SplitStyle;
  /** Allow cuts inside the solid margin (otherwise only when unavoidable). */
  splitMargins: boolean;
  /** Put several baseplate pieces on one plate when they fit. */
  nest: boolean;
  /** Colour of filament 2 (inlaid label text) in Bambu projects, #RRGGBB. */
  labelColour?: string;
  /** Filament price per kg, in `currency`. */
  filamentPrice?: number;
  /** Price per kg of filament 2 (inlaid label text); unset: the same as filament 1. */
  filamentPrice2?: number;
  /** Currency symbol for costs; empty: guessed from the browser's language. */
  currency?: string;
  /** Electricity price per kWh; 0 leaves electricity out of the cost. */
  kwhPrice?: number;
  /** Printer power draw while printing, W; unset: the printer's typical draw. */
  printerWatts?: number;
  /** Nozzle diameter, mm (one of NOZZLES); unset: DEFAULT_NOZZLE. The print checks size lines and fits by it. */
  nozzle?: number;
  /**
   * More printers that share the job (fleet.ts); the fields above are the
   * first one's. Unset: just the one printer.
   */
  printers?: PrinterSetup[];
  /** The printer the baseplate is split for and printed on (0 = the first); unset: the biggest, and its plates may go to any printer that takes them. */
  baseplatePrinter?: number;
}

/** Nozzle sizes the printer section offers, mm. */
export const NOZZLES = [0.2, 0.4, 0.6, 0.8] as const;
/** What every Bambu profile here is set up for. */
export const DEFAULT_NOZZLE = 0.4;

export const DEFAULT_SETUP: PrintSetup = {
  printerId: 'p2s',
  bedW: 256,
  bedD: 256,
  maxH: 256,
  plateMargin: 10,
  spacing: 3,
  splitStyle: 'auto',
  splitMargins: false,
  nest: true,
  filamentPrice: 20,
  currency: '',
  kwhPrice: 0,
};

/**
 * A saved setup with the cost fields filled in and checked (projects saved
 * before they existed, or edited by hand). Other fields pass through.
 */
export function cleanSetup(saved: Partial<PrintSetup> | null | undefined, base: PrintSetup = DEFAULT_SETUP): PrintSetup {
  const s = { ...base, ...(saved ?? {}) } as PrintSetup;
  const price = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : undefined);
  s.filamentPrice = price(s.filamentPrice, 100000) ?? DEFAULT_SETUP.filamentPrice;
  s.kwhPrice = price(s.kwhPrice, 1000) ?? 0;
  s.currency = typeof s.currency === 'string' ? s.currency.trim().slice(0, 4) : '';
  const p2 = price(s.filamentPrice2, 100000);
  if (p2 === undefined) delete s.filamentPrice2;
  else s.filamentPrice2 = p2;
  const watts = price(s.printerWatts, 5000);
  if (watts === undefined || watts === 0) delete s.printerWatts;
  else s.printerWatts = watts;
  // Only a size the field offers is kept; the default stays unset, like projects saved before it existed.
  if (!NOZZLES.some((n) => n === s.nozzle) || s.nozzle === DEFAULT_NOZZLE) delete s.nozzle;
  // More printers (fleet.ts): only kept when there are some, so older setups stay as they were.
  const printers = cleanPrinters(s.printers);
  if (printers) s.printers = printers;
  else delete s.printers;
  const bp = s.baseplatePrinter;
  if (!printers || !(typeof bp === 'number' && Number.isInteger(bp) && bp >= 0 && bp <= printers.length)) delete s.baseplatePrinter;
  return s;
}

export interface BaseplatePlan {
  pieces: PieceDef[];
  plates: PlateLayout[];
  cols: number;
  rows: number;
  error?: string;
}

const pieceKey = (id: number) => `piece:${id}`;

export interface PlanOptions {
  /** How far a piece can stick out past its right / back edge (puzzle tabs), mm. */
  protrude?: number;
  /** Pieces to leave out (nothing to print, e.g. fully cut-out blocked cells). */
  skip?: (p: PieceDef) => boolean;
}

/** Printed footprint of a piece, including anything that sticks out past its right / back edge. */
export function pieceFootprint(p: PieceDef, protrude = 0): { w: number; d: number } {
  return { w: p.x1 - p.x0 + (p.outer.right ? 0 : protrude), d: p.y1 - p.y0 + (p.outer.back ? 0 : protrude) };
}

function greedyFromEnd(total: number, cuts: number[], maxLen: number): AxisPartition | null {
  const mirrored = cuts.map((c) => total - c).reverse();
  const p = greedyPartition(total, mirrored, maxLen);
  return p ? p.map((v) => total - v).reverse() : null;
}

function candidatesFor(total: number, cuts: number[], maxLen: number, style: SplitStyle): AxisPartition[] {
  if (total <= maxLen + 1e-6) return [[0, total]];
  if (style === 'largest') {
    const g = greedyPartition(total, cuts, maxLen);
    return g ? [g] : [];
  }
  const all = enumeratePartitions(total, cuts, maxLen).sort((a, b) => balanceScore(a) - balanceScore(b));
  if (style === 'balanced') return all.slice(0, 1);
  const picks = all.slice(0, 24);
  for (const g of [greedyPartition(total, cuts, maxLen), greedyFromEnd(total, cuts, maxLen)]) {
    if (g && !picks.some((p) => p.join() === g.join())) picks.push(g);
  }
  return picks;
}

/**
 * Split the baseplate into pieces that fit the printer and lay them out on plates.
 * 'auto' tries every minimum-piece split and keeps the one needing the fewest plates.
 */
export function planBaseplate(layout: GridLayout, setup: PrintSetup, opts: PlanOptions = {}): BaseplatePlan {
  const protrude = opts.protrude ?? 0;
  const keep = (p: PieceDef) => !opts.skip?.(p);
  const UW = setup.bedW - 2 * setup.plateMargin - protrude;
  const UD = setup.bedD - 2 * setup.plateMargin - protrude;
  if (UW <= 0 || UD <= 0) return { pieces: [], plates: [], cols: 0, rows: 0, error: 'Bed margin leaves no room.' };
  if (layout.plateW <= 0 || layout.plateD <= 0)
    return { pieces: [], plates: [], cols: 0, rows: 0, error: 'Drawer is too small for a baseplate.' };

  const orientations: [number, number][] = [[UW, UD]];
  if (Math.abs(UW - UD) > 1e-6) orientations.push([UD, UW]);

  type Cand = { xs: AxisPartition; ys: AxisPartition; score: number[] };
  let best: Cand | null = null;
  for (const [maxX, maxY] of orientations) {
    const cutsX = axisCuts(layout.xs, layout.plateW, maxX, setup.splitMargins);
    const cutsY = axisCuts(layout.ys, layout.plateD, maxY, setup.splitMargins);
    const xsList = candidatesFor(layout.plateW, cutsX, maxX, setup.splitStyle);
    const ysList = candidatesFor(layout.plateD, cutsY, maxY, setup.splitStyle);
    for (const xs of xsList) {
      for (const ys of ysList) {
        const nPieces = (xs.length - 1) * (ys.length - 1);
        let nPlates = nPieces;
        if (setup.splitStyle === 'auto' && setup.nest && nPieces > 1) {
          const items: PackItem[] = makePieces(layout, xs, ys)
            .filter(keep)
            .map((p) => ({ key: pieceKey(p.id), ...pieceFootprint(p, protrude) }));
          nPlates = packPlates(items, { ...setup, bedW: setup.bedW, bedD: setup.bedD, margin: setup.plateMargin }).plates
            .length;
        }
        const score = [nPlates, nPieces, balanceScore(xs) + balanceScore(ys)];
        if (!best || lexLess(score, best.score)) best = { xs, ys, score };
      }
    }
  }
  if (!best) {
    return {
      pieces: [],
      plates: [],
      cols: 0,
      rows: 0,
      error: 'Could not split the baseplate to fit this bed. Try allowing margin splits or a larger printer.',
    };
  }
  const pieces = makePieces(layout, best.xs, best.ys).filter(keep);
  const { plates } = packPlates(
    pieces.map((p) => ({ key: pieceKey(p.id), ...pieceFootprint(p, protrude) })),
    { bedW: setup.bedW, bedD: setup.bedD, margin: setup.plateMargin, spacing: setup.spacing, nest: setup.nest },
  );
  return { pieces, plates, cols: best.xs.length - 1, rows: best.ys.length - 1 };
}

function lexLess(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
}

/** Assembly steps for connector keys. */
export function connectorSteps(keys: number): string[] {
  return [
    `Connector keys: ${keys}, one for each bowtie pocket that spans a seam.`,
    'Lay the pieces upside down in their final arrangement, press a key into every',
    'pocket across a seam, then turn the baseplate over into the drawer.',
  ];
}

/** Text map of which piece covers which cell — handy taped inside the drawer. */
export function assemblyMap(
  layout: GridLayout,
  plan: BaseplatePlan,
  connectorKeys = 0,
  plateOffset = 0,
  /** Extra assembly notes (joints without keys). */
  steps: string[] = [],
  /** What to call each of `plan.plates` ("Plate 3 (Bambu Lab A1 mini)"), when they aren't numbered from `plateOffset` in turn. */
  plateNames?: string[],
): string {
  const lines: string[] = [];
  lines.push('BASEPLATE ASSEMBLY MAP');
  lines.push('='.repeat(40));
  lines.push(`Baseplate: ${fmt(layout.plateW)} × ${fmt(layout.plateD)} mm`);
  const partial = [...layout.xs.slice(1).map((v, i) => v - layout.xs[i]), ...layout.ys.slice(1).map((v, i) => v - layout.ys[i])].some(
    (v) => Math.abs(v - layout.pitchX) > 1e-6 && Math.abs(v - layout.pitchY) > 1e-6,
  );
  const half = layout.halfGrid ? ' half grid' : '';
  lines.push(`Grid: ${layout.nx} × ${layout.ny} cells (${layout.pitchX} mm${half}${partial ? ', with partial edge cells' : ''})`);
  lines.push(
    `Margins: left ${fmt(layout.margins.left)}, right ${fmt(layout.margins.right)}, front ${fmt(layout.margins.front)}, back ${fmt(layout.margins.back)} mm`,
  );
  lines.push(`Pieces: ${plan.pieces.length}`);
  lines.push('');
  lines.push('Top of the map = back of the drawer.');
  const w = String(plan.pieces.length).length + 1;
  const header = '    ' + Array.from({ length: layout.nx }, (_, i) => String(i + 1).padStart(w + 1)).join('');
  lines.push(header);
  for (let j = layout.ny - 1; j >= 0; j--) {
    let row = String(layout.ny - j).padStart(3) + ' ';
    for (let i = 0; i < layout.nx; i++) {
      const p = plan.pieces.find((pc) => i >= pc.cells.x0 && i < pc.cells.x1 && j >= pc.cells.y0 && j < pc.cells.y1);
      const blocked = layout.mask?.includes(`${i},${j}`);
      row += String(blocked ? (layout.maskStyle === 'void' ? '.' : '#') : (p?.id ?? '?')).padStart(w + 1);
    }
    lines.push(row);
  }
  lines.push('');
  lines.push('PIECES');
  lines.push('-'.repeat(40));
  for (const p of plan.pieces) {
    const cw = p.cells.x1 - p.cells.x0;
    const cd = p.cells.y1 - p.cells.y0;
    lines.push(`Piece ${p.id}: ${cw} × ${cd} cells, ${fmt(p.x1 - p.x0)} × ${fmt(p.y1 - p.y0)} mm`);
  }
  plan.plates.forEach((pl, i) => {
    lines.push(`${plateNames?.[i] ?? `Plate ${plateOffset + i + 1}`}: ${pl.placements.map((pp) => pp.key.replace('piece:', 'piece ')).join(', ')}`);
  });
  if (connectorKeys) lines.push('', ...connectorSteps(connectorKeys));
  if (steps.length) lines.push('', ...steps);
  if (layout.mask?.length) lines.push('', `Blocked cells: ${layout.mask.length} (${layout.maskStyle === 'void' ? '. = cut out' : '# = solid'}).`);
  return lines.join('\n') + '\n';
}

function fmt(v: number) {
  return (Math.round(v * 100) / 100).toString();
}
