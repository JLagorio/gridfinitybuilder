import { GRID, HEIGHT_UNIT, LIP_HEIGHT } from '../geometry/spec';
import { cellEdge, type GridLayout } from '../layout/drawer';
import { meshSize } from '../external';
import type { PlacedBin } from '../project';

/**
 * What an imported bin's bounding box says about it.
 *
 * Footprint: a Gridfinity bin of n units is n × 42 − 0.5 mm across (0.25 mm
 * clear of each cell edge); on a half grid the cells are 21 mm, so n cells are
 * n × 21 − 0.5. A side within FOOT_TOL of that is on the grid; anything else
 * is rounded to the nearest number of cells (at least one), and the user can
 * pick another. Half-unit sizes (1.5 u, …) only sit on their feet on a half
 * grid; on a full grid they're rounded like any off-grid size.
 *
 * Height: 7 mm units. A bin with a stacking lip is 7u + 4.4 mm overall
 * (gridfinity-rebuilt; Gridfit's own are 7u + 4), one without is 7u. Z is up,
 * as the file has it.
 *
 * Pure: no store, no DOM.
 */

/** How far a side may be from n × pitch − 0.5 and still be on the grid, mm. */
export const FOOT_TOL = 1;
/** The same for the height, mm. */
export const HEIGHT_TOL = 1.2;
/** Gap between a bin and its cell edges, all round (42 − 41.5). */
const GAP = 0.5;

export interface AxisFit {
  /** Size along the axis, mm. */
  mm: number;
  /** Cells it takes on this grid: the nearest, at least 1. */
  cells: number;
  /** Cells it fits inside (rounded up). */
  up: number;
  /** Grid units (42 mm) the size is, to the half when it's a half-grid size, else to 0.01. */
  units: number;
  /** Within FOOT_TOL of `cells` cells. */
  exact: boolean;
  /** Within FOOT_TOL of a whole number of 21 mm half cells (every full-grid size is one too). */
  onHalf: boolean;
  /** Mm over (+) or under (−) the outer size of `cells` cells. */
  off: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** One side against the grid (`half`: 21 mm cells). */
export function fitAxis(mm: number, half = false): AxisFit {
  const pitch = half ? GRID / 2 : GRID;
  const cells = Math.max(1, Math.round((mm + GAP) / pitch));
  const off = mm - (cells * pitch - GAP);
  const halves = Math.max(1, Math.round((mm + GAP) / (GRID / 2)));
  const onHalf = Math.abs(mm - (halves * (GRID / 2) - GAP)) <= FOOT_TOL;
  return {
    mm,
    cells,
    up: Math.max(1, Math.ceil((mm + GAP - FOOT_TOL) / pitch)),
    units: onHalf ? halves / 2 : r2((mm + GAP) / GRID),
    exact: Math.abs(off) <= FOOT_TOL,
    onHalf,
    off,
  };
}

export interface FootprintFit {
  x: AxisFit;
  y: AxisFit;
  /** Both sides on the grid. */
  exact: boolean;
  /** A half-unit size (1.5 u …) on a full grid: it needs a half grid to sit on its feet. */
  needsHalf: boolean;
}

/** The footprint of a w × d mm bin on a grid (`half`: 21 mm cells). */
export function detectFootprint(w: number, d: number, half = false): FootprintFit {
  const x = fitAxis(w, half);
  const y = fitAxis(d, half);
  // Both sides whole half cells, and at least one of them not a whole unit.
  const needsHalf = !half && x.onHalf && y.onHalf && (x.units % 1 !== 0 || y.units % 1 !== 0);
  return { x, y, exact: x.exact && y.exact, needsHalf };
}

export interface HeightFit {
  mm: number;
  /** 7 mm units, without the lip. Rounded up when it isn't a whole number of units. */
  units: number;
  /** Its height says it has a stacking lip (7u + 4.4). */
  lip: boolean;
  /** A whole number of units (with or without the lip). */
  exact: boolean;
}

/** The height of an h mm bin in units. */
export function detectHeight(h: number): HeightFit {
  const withLip = Math.round((h - LIP_HEIGHT) / HEIGHT_UNIT);
  if (withLip >= 1 && Math.abs(h - (withLip * HEIGHT_UNIT + LIP_HEIGHT)) <= HEIGHT_TOL) return { mm: h, units: withLip, lip: true, exact: true };
  const plain = Math.round(h / HEIGHT_UNIT);
  if (plain >= 1 && Math.abs(h - plain * HEIGHT_UNIT) <= HEIGHT_TOL) return { mm: h, units: plain, lip: false, exact: true };
  return { mm: h, units: Math.max(1, Math.ceil(h / HEIGHT_UNIT - 0.05)), lip: false, exact: false };
}

/** "2 × 3", "1.5 × 1". */
const units = (f: FootprintFit) => `${f.x.units} × ${f.y.units}`;

/** What the footprint check found, in a sentence or two for the import dialog; '' when it's on the grid. */
export function footprintNote(f: FootprintFit, half: boolean, fmt: (mm: number) => string = (mm) => `${r2(mm)} mm`): string {
  const size = `${fmt(f.x.mm)} × ${fmt(f.y.mm)}`;
  if (f.exact) return '';
  if (f.needsHalf) return `${size} is a ${units(f)} half-grid bin: on this full grid it takes ${f.x.cells} × ${f.y.cells} cells. Turn on the half grid (Drawer tab) to seat it on its own feet.`;
  const over = [f.x, f.y].filter((a) => a.off > FOOT_TOL);
  const what = `${size} isn’t a Gridfinity size (${units(f)} units)`;
  const pitch = half ? 21 : 42;
  if (over.length) {
    const most = Math.max(...over.map((a) => a.off)) / 2;
    return `${what}. Rounded to the nearest, ${f.x.cells} × ${f.y.cells} cells, it reaches ${fmt(most)} past them on each side, into the next cells. ${f.x.up !== f.x.cells || f.y.up !== f.y.cells ? `${f.x.up} × ${f.y.up} cells hold it.` : ''}`.trim();
  }
  return `${what}: it takes ${f.x.cells} × ${f.y.cells} cells (${fmt(f.x.cells * pitch - GAP)} × ${fmt(f.y.cells * pitch - GAP)}) and sits centred on them.`;
}

/** How far an imported bin's mesh reaches past its cells on its worst side, mm, sitting centred on them (≤ 0: it fits). */
export function meshOverhang(layout: GridLayout, b: Pick<PlacedBin, 'x' | 'y' | 'opts' | 'external'>): number {
  if (!b.external?.mesh) return 0;
  const s = meshSize(b.external.mesh);
  const w = cellEdge(layout.xs, b.x + b.opts.unitsX, layout.pitchX) - cellEdge(layout.xs, b.x, layout.pitchX);
  const d = cellEdge(layout.ys, b.y + b.opts.unitsY, layout.pitchY) - cellEdge(layout.ys, b.y, layout.pitchY);
  return Math.max(s.w - w, s.d - d) / 2;
}
