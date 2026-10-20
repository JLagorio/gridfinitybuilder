import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import {
  BASE_HEIGHT,
  BASE_PROFILE,
  BASE_PROFILE_DEPTH,
  BASE_PROFILE_HEIGHT,
  BASE_TOP,
  BASE_TOP_RADIUS,
  DIVIDER,
  GRID,
  HEIGHT_UNIT,
  HOLE_OFFSET,
  INNER_RADIUS,
  LIP_DEPTH,
  LIP_HEIGHT,
  LIP_PROFILE,
  LIP_SUPPORT_HEIGHT,
  LIP_TOP_FLAT,
  MAGNET_HOLE_DEPTH,
  MAGNET_HOLE_DIAMETER,
  SCREW_HOLE_DEPTH,
  SCREW_HOLE_DIAMETER,
  TAB_DEPTH,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_TIP_HEIGHT,
  TAB_WIDTH_NOMINAL,
  WALL,
} from './spec';
import { boxAt, cylinderAt, extrudePolygon, loftRoundedRect, ringAt, roundedRectRing } from './shapes';

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
};

export const MIN_HEIGHT_UNITS = 2;

export function binSize(o: Pick<BinOptions, 'unitsX' | 'unitsY'>) {
  return { w: GRID * o.unitsX - (GRID - BASE_TOP), d: GRID * o.unitsY - (GRID - BASE_TOP) };
}

/** Overall height including the lip. */
export function binTotalHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'>) {
  return HEIGHT_UNIT * o.heightUnits + (o.lip ? LIP_HEIGHT - LIP_TOP_FLAT : 0);
}

/** Stable key so identical bins share one mesh. */
export function binKey(o: BinOptions): string {
  return [
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
  ].join('-');
}

export function binLabel(o: BinOptions): string {
  const parts = [`${o.unitsX}×${o.unitsY}×${o.heightUnits}u`];
  if (o.divX * o.divY > 1) parts.push(`${o.divX}×${o.divY} compartments`);
  return parts.join(' ');
}

/**
 * Build a bin centered on the origin in XY with its bottom at z = 0.
 */
export function buildBin(w: Wasm, input: BinOptions): MeshData {
  const o = sanitizeBin(input);
  const s = new Scope();
  try {
    const { w: W, d: D } = binSize(o);
    const H = HEIGHT_UNIT * o.heightUnits;
    const topInfill = o.lip ? H - LIP_SUPPORT_HEIGHT : H;
    const zFloor = BASE_HEIGHT;
    const outerRing = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);

    const solids: Manifold[] = [];

    // 1. Base profile under every grid cell.
    const cellCenters: [number, number][] = [];
    for (let i = 0; i < o.unitsX; i++) {
      for (let j = 0; j < o.unitsY; j++) {
        const cx = (i + 0.5) * GRID - (GRID * o.unitsX) / 2;
        const cy = (j + 0.5) * GRID - (GRID * o.unitsY) / 2;
        cellCenters.push([cx, cy]);
        solids.push(
          s.t(
            loftRoundedRect(w, cx, cy, BASE_TOP, BASE_TOP, BASE_TOP_RADIUS, [
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
    const cutters = compartmentCutters(w, s, o, W, D, zFloor, topInfill);
    solids.push(cutters.length ? s.t(block.subtract(s.t(w.Manifold.union(cutters)))) : block);

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
