import { findPrinter } from '../printers';
import type { GridLayout } from './drawer';
import { fitsOnBed, packPlates, plateLimits, type PackItem, type PackOptions, type PlateLayout } from './pack';
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
}

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
};

export interface BaseplatePlan {
  pieces: PieceDef[];
  plates: PlateLayout[];
  cols: number;
  rows: number;
  error?: string;
}

const pieceKey = (id: number) => `piece:${id}`;

/** Packing options for a print setup, including the printer's bed exclusion areas. */
export function packOptions(setup: PrintSetup, patch: Partial<PackOptions> = {}): PackOptions {
  return {
    bedW: setup.bedW,
    bedD: setup.bedD,
    margin: setup.plateMargin,
    spacing: setup.spacing,
    nest: setup.nest,
    exclude: findPrinter(setup.printerId).bedExclude,
    ...patch,
  };
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
export function planBaseplate(layout: GridLayout, setup: PrintSetup): BaseplatePlan {
  const UW = setup.bedW - 2 * setup.plateMargin;
  const UD = setup.bedD - 2 * setup.plateMargin;
  if (UW <= 0 || UD <= 0) return { pieces: [], plates: [], cols: 0, rows: 0, error: 'Bed margin leaves no room.' };
  if (layout.plateW <= 0 || layout.plateD <= 0)
    return { pieces: [], plates: [], cols: 0, rows: 0, error: 'Drawer is too small for a baseplate.' };

  const opts = packOptions(setup);
  type Cand = { xs: AxisPartition; ys: AxisPartition; score: number[] };
  /** Best split with pieces no larger than one of the limits (either way round) that all fit the plate. */
  const search = (limits: [number, number][]) => {
    const sizes: [number, number][] = [];
    for (const [w, d] of limits) {
      sizes.push([w, d]);
      if (Math.abs(w - d) > 1e-6) sizes.push([d, w]);
    }
    let best: Cand | null = null;
    for (const [maxX, maxY] of sizes) {
      const cutsX = axisCuts(layout.originX, layout.nx, layout.pitchX, layout.plateW, maxX, setup.splitMargins);
      const cutsY = axisCuts(layout.originY, layout.ny, layout.pitchY, layout.plateD, maxY, setup.splitMargins);
      const xsList = candidatesFor(layout.plateW, cutsX, maxX, setup.splitStyle);
      const ysList = candidatesFor(layout.plateD, cutsY, maxY, setup.splitStyle);
      for (const xs of xsList) {
        for (const ys of ysList) {
          const pieces = makePieces(layout, xs, ys);
          // An exclusion area can leave no room for a piece sized to the whole usable area.
          if (!pieces.every((p) => fitsOnBed(p.x1 - p.x0, p.y1 - p.y0, opts))) continue;
          const nPieces = pieces.length;
          let nPlates = nPieces;
          if (setup.splitStyle === 'auto' && setup.nest && nPieces > 1) {
            const items: PackItem[] = pieces.map((p) => ({ key: pieceKey(p.id), w: p.x1 - p.x0, d: p.y1 - p.y0 }));
            nPlates = packPlates(items, opts).plates.length;
          }
          const score = [nPlates, nPieces, balanceScore(xs) + balanceScore(ys)];
          if (!best || lexLess(score, best.score)) best = { xs, ys, score };
        }
      }
    }
    return best;
  };
  // Pieces as big as the usable area allows; failing that, as big as the free areas beside
  // the printer's exclusion areas allow.
  const best = search([[UW, UD]]) ?? search(plateLimits(opts));
  if (!best) {
    return {
      pieces: [],
      plates: [],
      cols: 0,
      rows: 0,
      error: 'Could not split the baseplate to fit this bed. Try allowing margin splits or a larger printer.',
    };
  }
  const pieces = makePieces(layout, best.xs, best.ys);
  const { plates } = packPlates(
    pieces.map((p) => ({ key: pieceKey(p.id), w: p.x1 - p.x0, d: p.y1 - p.y0 })),
    opts,
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
export function assemblyMap(layout: GridLayout, plan: BaseplatePlan, connectorKeys = 0): string {
  const lines: string[] = [];
  lines.push('BASEPLATE ASSEMBLY MAP');
  lines.push('='.repeat(40));
  lines.push(`Baseplate: ${fmt(layout.plateW)} × ${fmt(layout.plateD)} mm`);
  lines.push(`Grid: ${layout.nx} × ${layout.ny} cells (${layout.pitchX} mm)`);
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
      row += String(p?.id ?? '?').padStart(w + 1);
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
    lines.push(`Plate ${i + 1}: ${pl.placements.map((pp) => pp.key.replace('piece:', 'piece ')).join(', ')}`);
  });
  if (connectorKeys) lines.push('', ...connectorSteps(connectorKeys));
  return lines.join('\n') + '\n';
}

function fmt(v: number) {
  return (Math.round(v * 100) / 100).toString();
}
