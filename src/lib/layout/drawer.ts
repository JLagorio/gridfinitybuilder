import { GRID } from '../geometry/spec';

export interface DrawerInput {
  /** 'drawer': fit a grid into a drawer size; 'grid': give the grid size in units. */
  mode: 'drawer' | 'grid';
  /** Inside width of the drawer (X, left→right), mm. */
  width: number;
  /** Inside depth of the drawer (Y, front→back), mm. */
  depth: number;
  /** Total clearance subtracted from each axis so the plate drops in easily, mm. */
  clearance: number;
  gridX: number;
  gridY: number;
  /** Where the grid sits inside the leftover margin: 0 = left/front, 0.5 = centered, 1 = right/back. */
  alignX: number;
  alignY: number;
  pitchX: number;
  pitchY: number;
}

export const DEFAULT_DRAWER: DrawerInput = {
  mode: 'drawer',
  width: 510.5,
  depth: 376.5,
  clearance: 0.5,
  gridX: 4,
  gridY: 3,
  alignX: 0.5,
  alignY: 0.5,
  pitchX: GRID,
  pitchY: GRID,
};

export interface GridLayout {
  /** Final baseplate outer size. */
  plateW: number;
  plateD: number;
  nx: number;
  ny: number;
  pitchX: number;
  pitchY: number;
  /** Front-left corner of cell (0, 0) in plate coordinates. */
  originX: number;
  originY: number;
  margins: { left: number; right: number; front: number; back: number };
}

const EPS = 1e-6;

export function computeLayout(d: DrawerInput): GridLayout {
  const pitchX = d.pitchX > 0 ? d.pitchX : GRID;
  const pitchY = d.pitchY > 0 ? d.pitchY : GRID;
  if (d.mode === 'grid') {
    const nx = Math.max(1, Math.floor(d.gridX));
    const ny = Math.max(1, Math.floor(d.gridY));
    return {
      plateW: nx * pitchX,
      plateD: ny * pitchY,
      nx,
      ny,
      pitchX,
      pitchY,
      originX: 0,
      originY: 0,
      margins: { left: 0, right: 0, front: 0, back: 0 },
    };
  }
  const plateW = Math.max(0, d.width - d.clearance);
  const plateD = Math.max(0, d.depth - d.clearance);
  const nx = Math.max(0, Math.floor(plateW / pitchX + EPS));
  const ny = Math.max(0, Math.floor(plateD / pitchY + EPS));
  const mx = clean(plateW - nx * pitchX);
  const my = clean(plateD - ny * pitchY);
  const ax = clamp01(d.alignX);
  const ay = clamp01(d.alignY);
  const left = clean(mx * ax);
  const front = clean(my * ay);
  return {
    plateW,
    plateD,
    nx,
    ny,
    pitchX,
    pitchY,
    originX: left,
    originY: front,
    margins: { left, right: clean(mx - left), front, back: clean(my - front) },
  };
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
}

function clean(v: number) {
  return Math.abs(v) < 1e-4 ? 0 : Math.round(v * 1e4) / 1e4;
}

export { parseLength } from '../units';
