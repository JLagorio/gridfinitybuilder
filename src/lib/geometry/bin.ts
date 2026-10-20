import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import {
  BASE_HEIGHT,
  BASE_PROFILE,
  BASE_PROFILE_DEPTH,
  BASE_PROFILE_HEIGHT,
  BASE_TOP,
  BASE_TOP_RADIUS,
  GRID,
  HEIGHT_UNIT,
  HOLE_OFFSET,
  LIP_DEPTH,
  LIP_HEIGHT,
  LIP_PROFILE,
  LIP_SUPPORT_HEIGHT,
  LIP_TOP_FLAT,
  MAGNET_HOLE_DEPTH,
  MAGNET_HOLE_DIAMETER,
  SCREW_HOLE_DEPTH,
  SCREW_HOLE_DIAMETER,
  WALL,
} from './spec';
import { cylinderAt, extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import { buildDividerInsert, insertKey, insertsFor, interiorCuts, type DividerInsert } from './compartments';
import { layoutKey, resolveLayout, sanitizeLayout, uniformLayout, type DividerLayout, type ResolvedLayout } from '../dividers';

export type HoleStyle = 'none' | 'magnets' | 'screws' | 'both';
export type LabelStyle = 'none' | 'full' | 'left' | 'center' | 'right';

export interface BinOptions {
  /** Footprint in grid units. */
  unitsX: number;
  unitsY: number;
  /** Height in 7 mm units, excluding the stacking lip. */
  heightUnits: number;
  lip: boolean;
  holes: HoleStyle;
  /** Number of compartments along X and Y (used when there is no `layout`). */
  divX: number;
  divY: number;
  /** Free-form dividers (src/lib/dividers). When set it replaces divX × divY. */
  layout?: DividerLayout | null;
  /** 0 = none, 1 = largest scoop on the front wall of each compartment. */
  scoop: number;
  label: LabelStyle;
  /** Round the bottom edges of compartments. */
  fillet: boolean;
}

export const DEFAULT_BIN: BinOptions = {
  unitsX: 1,
  unitsY: 1,
  heightUnits: 3,
  lip: true,
  holes: 'none',
  divX: 1,
  divY: 1,
  scoop: 0,
  label: 'none',
  fillet: true,
  layout: null,
};

export const MIN_HEIGHT_UNITS = 2;

/**
 * Pitch of each grid cell a bin covers, when it sits on partial (edge-fill) cells.
 * Missing entries are full cells. Each cell gets a foot of its own size.
 */
export interface BinCells {
  x: number[];
  y: number[];
}

export function binCells(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells?: Partial<BinCells> | null): BinCells {
  const fit = (arr: number[] | undefined, n: number) => Array.from({ length: n }, (_, k) => (arr?.[k] && arr[k] > 0 ? arr[k] : GRID));
  return { x: fit(cells?.x, o.unitsX), y: fit(cells?.y, o.unitsY) };
}

/** True when every cell is a full grid cell (the common case). */
export function fullCells(c: BinCells | null | undefined): boolean {
  return !c || [...c.x, ...c.y].every((v) => Math.abs(v - GRID) < 1e-6);
}

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

export function binSize(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells?: Partial<BinCells> | null) {
  const c = binCells(o, cells);
  return { w: sum(c.x) - (GRID - BASE_TOP), d: sum(c.y) - (GRID - BASE_TOP) };
}

/** Overall height including the lip. */
export function binTotalHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'>) {
  return HEIGHT_UNIT * o.heightUnits + (o.lip ? LIP_HEIGHT - LIP_TOP_FLAT : 0);
}

/** Stable key so identical bins share one mesh. */
export function binKey(o: BinOptions, cells?: Partial<BinCells> | null): string {
  const c = binCells(o, cells);
  const cellPart = fullCells(c) ? [] : [`c${c.x.join('/')}x${c.y.join('/')}`];
  return [
    ...cellPart,
    o.unitsX,
    o.unitsY,
    o.heightUnits,
    o.lip ? 'L' : 'n',
    o.holes,
    o.divX,
    o.divY,
    Math.round(o.scoop * 100),
    o.label,
    o.fillet ? 'F' : 'n',
    ...(o.layout ? [`D{${layoutKey(o.layout, new Set(binLayout(o, cells).compartments.map((c) => c.key)))}}`] : []),
  ].join('-');
}

export function binLabel(o: BinOptions): string {
  const parts = [`${o.unitsX}×${o.unitsY}×${o.heightUnits}u`];
  if (o.layout) {
    const n = binLayout(o).compartments.length;
    if (n > 1) parts.push(`${n} compartments`);
  } else if (o.divX * o.divY > 1) parts.push(`${o.divX}×${o.divY} compartments`);
  return parts.join(' ');
}

/**
 * Build a bin centered on the origin in XY with its bottom at z = 0.
 */
export function buildBin(w: Wasm, input: BinOptions, cellsIn?: Partial<BinCells> | null): MeshData {
  const o = sanitizeBin(input);
  const cells = binCells(o, cellsIn);
  const s = new Scope();
  try {
    const { w: W, d: D } = binSize(o, cells);
    const H = HEIGHT_UNIT * o.heightUnits;
    const topInfill = o.lip ? H - LIP_SUPPORT_HEIGHT : H;
    const zFloor = BASE_HEIGHT;
    const outerRing = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);

    const solids: Manifold[] = [];

    // 1. Base profile under every grid cell (sized to the cell, for partial edge cells).
    const cellCenters: [number, number][] = [];
    const gap = GRID - BASE_TOP;
    const totalX = sum(cells.x);
    const totalY = sum(cells.y);
    for (let i = 0, x0 = -totalX / 2; i < o.unitsX; x0 += cells.x[i], i++) {
      for (let j = 0, y0 = -totalY / 2; j < o.unitsY; y0 += cells.y[j], j++) {
        const cw = cells.x[i];
        const cd = cells.y[j];
        const cx = x0 + cw / 2;
        const cy = y0 + cd / 2;
        // Corner holes only fit in full cells.
        if (Math.min(cw, cd) >= GRID - 1e-6) cellCenters.push([cx, cy]);
        solids.push(
          s.t(
            loftRoundedRect(w, cx, cy, cw - gap, cd - gap, BASE_TOP_RADIUS, [
              { z: 0, inset: BASE_PROFILE_DEPTH },
              { z: BASE_PROFILE.chamfer1, inset: BASE_PROFILE.chamfer2 },
              { z: BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical, inset: BASE_PROFILE.chamfer2 },
              { z: BASE_PROFILE_HEIGHT, inset: 0 },
              { z: BASE_PROFILE_HEIGHT + 0.25, inset: 0 },
            ]),
          ),
        );
      }
    }

    // 2. Infill block (floor + dividers), with compartments cut out.
    const block = s.t(extrudePolygon(w, outerRing, BASE_PROFILE_HEIGHT, topInfill));
    const { cut: cutters, add: interiorExtras } = interiorCuts(w, s, o, W, D, zFloor, topInfill);
    solids.push(cutters.length ? s.t(block.subtract(s.t(w.Manifold.union(cutters)))) : block, ...interiorExtras);

    // 3. Outer wall + stacking lip (unioned after the compartments so they never cut into it).
    const wallBottom = BASE_PROFILE_HEIGHT + 0.75;
    const top = binTotalHeight(o);
    const cavityKnots = o.lip
      ? [
          { z: wallBottom + 0.5, inset: WALL },
          { z: H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL), inset: WALL },
          { z: H - LIP_SUPPORT_HEIGHT, inset: LIP_DEPTH },
          { z: H, inset: LIP_DEPTH },
          { z: H + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
          { z: H + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
          { z: H + LIP_HEIGHT, inset: 0 },
          { z: H + LIP_HEIGHT + 1, inset: -1 },
        ]
      : [
          { z: wallBottom + 0.5, inset: WALL },
          { z: H + 1, inset: WALL },
        ];
    const shell = s.t(extrudePolygon(w, outerRing, wallBottom, top));
    const cavity = s.t(loftRoundedRect(w, 0, 0, W, D, BASE_TOP_RADIUS, cavityKnots));
    solids.push(s.t(shell.subtract(cavity)));

    let bin = s.t(w.Manifold.union(solids));

    // 4. Magnet / screw holes in the bottom.
    const holes: Manifold[] = [];
    if (o.holes !== 'none') {
      for (const [cx, cy] of cellCenters) {
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const hx = cx + dx * HOLE_OFFSET;
          const hy = cy + dy * HOLE_OFFSET;
          if (o.holes === 'magnets' || o.holes === 'both')
            holes.push(s.t(cylinderAt(w, hx, hy, -1, MAGNET_HOLE_DEPTH, MAGNET_HOLE_DIAMETER / 2)));
          if (o.holes === 'screws' || o.holes === 'both')
            holes.push(s.t(cylinderAt(w, hx, hy, -1, SCREW_HOLE_DEPTH, SCREW_HOLE_DIAMETER / 2, SCREW_HOLE_DIAMETER / 2, 24)));
        }
      }
    }
    if (holes.length) bin = s.t(bin.subtract(s.t(w.Manifold.union(holes))));

    assertValid(bin, 'bin');
    return toMeshData(bin);
  } finally {
    s.dispose();
  }
}

export function sanitizeBin(o: BinOptions): BinOptions {
  const int = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
  return {
    ...o,
    unitsX: int(o.unitsX, 1, 12),
    unitsY: int(o.unitsY, 1, 12),
    heightUnits: int(o.heightUnits, MIN_HEIGHT_UNITS, 30),
    divX: int(o.divX, 1, 12),
    divY: int(o.divY, 1, 12),
    scoop: Math.min(1, Math.max(0, Number(o.scoop) || 0)),
    layout: sanitizeLayout(o.layout),
  };
}

// ---------------------------------------------------------------------------
// Divider layouts (src/lib/dividers, geometry in ./compartments.ts)
// ---------------------------------------------------------------------------

/** Inner cavity size (bin size − 2 × WALL). */
export function binInnerSize(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells?: Partial<BinCells> | null) {
  const { w, d } = binSize(o, cells);
  return { w: w - 2 * WALL, d: d - 2 * WALL };
}

/**
 * The bin's dividers resolved to cavity mm (origin at the cavity's front-left
 * corner). Without a layout this is the uniform divX × divY split.
 */
export function binLayout(o: BinOptions, cells?: Partial<BinCells> | null): ResolvedLayout {
  const { w, d } = binInnerSize(o, cells);
  return resolveLayout(o.layout ?? uniformLayout(o.divX, o.divY), w, d);
}

/**
 * Slide-in plates needed for the bin's removable dividers (one per wall
 * segment; walls crossing a removable wall split it). `cells` are the bin's
 * cell pitches, as for binSize / buildBin.
 */
export function removableInserts(opts: BinOptions, cells?: Partial<BinCells> | null): DividerInsert[] {
  const o = sanitizeBin(opts);
  if (!o.layout) return [];
  const H = HEIGHT_UNIT * o.heightUnits;
  const topInfill = o.lip ? H - LIP_SUPPORT_HEIGHT : H;
  return insertsFor(binLayout(o, cells), o.lip, BASE_HEIGHT, topInfill);
}

export { buildDividerInsert, insertKey, type DividerInsert };
