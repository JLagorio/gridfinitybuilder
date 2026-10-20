import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import {
  BASE_PROFILE,
  BASE_PROFILE_DEPTH,
  BASE_PROFILE_HEIGHT,
  BASE_TOP,
  BASE_TOP_RADIUS,
  DIVIDER,
  GRID,
  INNER_RADIUS,
  LIP_SUPPORT_HEIGHT,
  TAB_DEPTH,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_TIP_HEIGHT,
  TAB_WIDTH_NOMINAL,
  WALL,
} from './spec';
import { boxAt, extrudePolygon, loftRoundedRect, ringAt, roundedRectRing } from './shapes';
import {
  DEFAULT_VARIANTS,
  binBodyHeight,
  binFloorZ,
  heightKey,
  lipRise,
  sanitizeVariants,
  variantKeyParts,
  type BinVariantOptions,
} from './variants';
import { holeBosses, holeCutters, holeSites } from './holes';
import { clipToHollow, hollowFloor, isHollowBase } from './binbase';
import { lipCavityKnots, lipNotches } from './lip';
import { fingerSlides, wallCutouts } from './walls';
import { pocketCutters, pocketLayout } from './pockets';

export type HoleStyle = 'none' | 'magnets' | 'screws' | 'both' | 'refined';
export type LabelStyle = 'none' | 'full' | 'left' | 'center' | 'right';

/** Base, lip, height-mode, hole, wall, pocket and lid options live in variants.ts. */
export interface BinOptions extends BinVariantOptions {
  /** Footprint in grid units. */
  unitsX: number;
  unitsY: number;
  /** Height in 7 mm units, excluding the stacking lip (when heightMode is 'units'). */
  heightUnits: number;
  /** Stacking lip on/off; its shape is `lipStyle`. */
  lip: boolean;
  holes: HoleStyle;
  /** Number of compartments along X and Y. */
  divX: number;
  divY: number;
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
  ...DEFAULT_VARIANTS,
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
export function binTotalHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>) {
  return binBodyHeight(o) + lipRise(o);
}

/** Stable key so identical bins share one mesh. */
export function binKey(o: BinOptions, cells?: Partial<BinCells> | null): string {
  const c = binCells(o, cells);
  const cellPart = fullCells(c) ? [] : [`c${c.x.join('/')}x${c.y.join('/')}`];
  return [
    ...cellPart,
    o.unitsX,
    o.unitsY,
    heightKey(o),
    o.lip ? 'L' : 'n',
    o.holes,
    o.divX,
    o.divY,
    Math.round(o.scoop * 100),
    o.label,
    o.fillet ? 'F' : 'n',
    ...variantKeyParts(o),
  ].join('-');
}

export function binLabel(o: BinOptions): string {
  const h = o.heightMode && o.heightMode !== 'units' ? `${Math.round(binTotalHeight(o) * 10) / 10}mm` : `${o.heightUnits}u`;
  const parts = [`${o.unitsX}×${o.unitsY}×${h}`];
  if (o.interior === 'pockets') parts.push('pockets');
  else if (o.divX * o.divY > 1) parts.push(`${o.divX}×${o.divY} compartments`);
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
    const H = binBodyHeight(o);
    const topInfill = o.lip ? H - LIP_SUPPORT_HEIGHT : H;
    const zFloor = binFloorZ(o);
    const outerRing = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);
    const flat = o.base === 'flat';
    const pockets = o.interior === 'pockets';
    const hollow = isHollowBase(o.base) && !pockets;
    // Holes only fit in full cells (flat bins have no feet to hold them).
    const sites = flat || o.holes === 'none' ? [] : holeSites(cells, o.holeCorners);

    const solids: Manifold[] = [];

    // 1. Base profile under every grid cell (sized to the cell, for partial edge cells); none for flat bins.
    const feet: Manifold[] = [];
    const gap = GRID - BASE_TOP;
    const totalX = sum(cells.x);
    const totalY = sum(cells.y);
    for (let i = 0, x0 = -totalX / 2; i < o.unitsX && !flat; x0 += cells.x[i], i++) {
      for (let j = 0, y0 = -totalY / 2; j < o.unitsY; y0 += cells.y[j], j++) {
        const cw = cells.x[i];
        const cd = cells.y[j];
        const cx = x0 + cw / 2;
        const cy = y0 + cd / 2;
        feet.push(
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

    // 2. Infill block (floor + dividers), with compartments (or item pockets) cut out.
    const block = s.t(extrudePolygon(w, outerRing, flat ? 0 : BASE_PROFILE_HEIGHT, topInfill));
    // Lite / efficient bases: compartments go down into the feet (clipped to the foot pockets below).
    const cutFloor = hollow ? hollowFloor(o.base) : zFloor;
    const cutters = pockets ? pocketCutters(w, s, o, W, D, zFloor, topInfill) : compartmentCutters(w, s, o, W, D, cutFloor, topInfill);
    let cut = cutters.length ? s.t(w.Manifold.union(cutters)) : null;
    // Finger slides: leave a quarter-round along the chosen walls uncut.
    const slides = cut && !pockets ? fingerSlides(w, s, o, W, D, cutFloor, Math.min(topInfill - cutFloor - 0.5, 40)) : [];
    if (cut && slides.length) cut = s.t(cut.subtract(s.t(w.Manifold.union(slides))));
    if (cut && hollow) cut = clipToHollow(w, s, o.base, cells, W, D, zFloor, cut, holeBosses(w, s, o, sites, zFloor - 0.05));
    solids.push(cut ? s.t(block.subtract(cut)) : block);
    if (cut && hollow && feet.length) solids.push(s.t(s.t(w.Manifold.union(feet)).subtract(cut)));
    else solids.push(...feet);

    // 3. Outer wall + stacking lip (unioned after the compartments so they never cut into it).
    const wallBottom = BASE_PROFILE_HEIGHT + 0.75;
    const top = binTotalHeight(o);
    // A floor below the wall's bottom (flat, lite) needs the wall open underneath.
    const cavityKnots = lipCavityKnots(o, H, wallBottom, flat || (hollow && cut) ? wallBottom - 0.5 : wallBottom + 0.5);
    const shell = s.t(extrudePolygon(w, outerRing, wallBottom, top));
    let cavity = s.t(loftRoundedRect(w, 0, 0, W, D, BASE_TOP_RADIUS, cavityKnots));
    const notches = o.lip && o.lipNotches ? lipNotches(w, s, o, cells, W, D, H, top) : null;
    if (notches) cavity = s.t(cavity.subtract(notches));
    solids.push(s.t(shell.subtract(cavity)));

    let bin = s.t(w.Manifold.union(solids));

    // Wall cutouts, down to just above the floor (or the pocket fill).
    const cutLow = pockets ? Math.max(zFloor + 1, pocketLayout(o, W, D, zFloor, topInfill).fillTop + 0.5) : zFloor + 1;
    const cutouts = wallCutouts(w, s, o, W, D, top, cutLow);
    if (cutouts.length) bin = s.t(bin.subtract(s.t(w.Manifold.union(cutouts))));

    // 4. Magnet / screw holes in the bottom.
    const holes = holeCutters(w, s, o, sites);
    if (holes.length) bin = s.t(bin.subtract(s.t(w.Manifold.union(holes))));

    assertValid(bin, 'bin');
    return toMeshData(bin);
  } finally {
    s.dispose();
  }
}

const HOLE_STYLES: readonly HoleStyle[] = ['none', 'magnets', 'screws', 'both', 'refined'];

export function sanitizeBin(o: BinOptions): BinOptions {
  const int = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
  const heightUnits = int(o.heightUnits, MIN_HEIGHT_UNITS, 30);
  const lip = o.lip === undefined ? true : !!o.lip;
  return {
    ...o,
    unitsX: int(o.unitsX, 1, 12),
    unitsY: int(o.unitsY, 1, 12),
    heightUnits,
    lip,
    holes: HOLE_STYLES.includes(o.holes) ? o.holes : 'none',
    divX: int(o.divX, 1, 12),
    divY: int(o.divY, 1, 12),
    scoop: Math.min(1, Math.max(0, Number(o.scoop) || 0)),
    ...sanitizeVariants({ ...o, heightUnits, lip }),
  };
}

function compartmentCutters(
  w: Wasm,
  s: Scope,
  o: BinOptions,
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): Manifold[] {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return [];
  const eps = 0.01;
  const ix0 = -W / 2 + WALL;
  const iy0 = -D / 2 + WALL;
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  const cw = (innerW - (o.divX - 1) * DIVIDER) / o.divX;
  const cd = (innerD - (o.divY - 1) * DIVIDER) / o.divY;
  if (cw < 2 || cd < 2) throw new Error('Too many compartments for this bin size.');

  const zTop = topInfill + 1;
  const rc = Math.min(INNER_RADIUS, cw / 2 - 0.05, cd / 2 - 0.05);
  const cutters: Manifold[] = [];
  for (let i = 0; i < o.divX; i++) {
    for (let j = 0; j < o.divY; j++) {
      const x0 = ix0 + i * (cw + DIVIDER) - eps;
      const x1 = x0 + cw + 2 * eps;
      const y0 = iy0 + j * (cd + DIVIDER) - eps;
      const y1 = y0 + cd + 2 * eps;
      const r = rc + eps;
      let cutter: Manifold;
      const rf = Math.min(r, innerH / 2 - 0.05);
      if (o.fillet && rf > 0.3) {
        // Rounded bottom edges: hull of corner spheres and the top outline.
        const pts: (Manifold | Vec3)[] = [];
        for (const [sx, sy] of [
          [x0 + rf, y0 + rf],
          [x1 - rf, y0 + rf],
          [x1 - rf, y1 - rf],
          [x0 + rf, y1 - rf],
        ]) {
          pts.push(s.t(w.Manifold.sphere(rf, 24).translate([sx, sy, zFloor + rf])));
        }
        pts.push(...ringAt(roundedRectRing(x0, y0, x1, y1, r), zTop));
        cutter = s.t(w.Manifold.hull(pts));
      } else {
        cutter = s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, r), zFloor, zTop));
      }

      // Scoop: a concave ramp on the front (-Y) wall for scooping out small parts.
      if (o.scoop > 0) {
        const R = Math.max(2, o.scoop * Math.min(innerH * 0.85, cd * 0.6));
        const fill = s.t(boxAt(w, x0 - 1, y0 - 1, zFloor - 1, x1 + 1, y0 + R, zFloor + R));
        const cyl = s.t(
          w.Manifold.cylinder(x1 - x0 + 4, R, R, 64)
            .rotate([0, 90, 0])
            .translate([x0 - 2, y0 + R, zFloor + R]),
        );
        cutter = s.t(cutter.subtract(s.t(fill.subtract(cyl))));
      }

      // Label tab: a shelf on the back (+Y) wall, angled underneath so it prints without support.
      if (o.label !== 'none') {
        const tan = Math.tan((TAB_SUPPORT_ANGLE_DEG * Math.PI) / 180);
        let td = Math.min(TAB_DEPTH, cd * 0.45);
        if (tan * td + TAB_TIP_HEIGHT > innerH - 1) td = (innerH - 1 - TAB_TIP_HEIGHT) / tan;
        if (td >= 4) {
          const th = tan * td + TAB_TIP_HEIGHT;
          const tw = o.label === 'full' ? cw + 4 * eps : Math.min(cw, TAB_WIDTH_NOMINAL);
          let tx0: number;
          if (o.label === 'full') tx0 = x0 - eps;
          else if (o.label === 'left') tx0 = x0 - eps;
          else if (o.label === 'right') tx0 = x1 + eps - tw;
          else tx0 = (x0 + x1) / 2 - tw / 2;
          const tx1 = tx0 + tw;
          const yb = y1 + 2 * eps;
          const yf = y1 - td;
          const pts: Vec3[] = [];
          for (const x of [tx0, tx1]) {
            pts.push([x, yb, topInfill - th], [x, yb, zTop + 0.5], [x, yf, zTop + 0.5], [x, yf, topInfill - TAB_TIP_HEIGHT]);
          }
          cutter = s.t(cutter.subtract(s.t(w.Manifold.hull(pts))));
        }
      }
      cutters.push(cutter);
    }
  }
  return cutters;
}
