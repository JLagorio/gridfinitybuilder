import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import {
  BASE_PROFILE,
  BASE_PROFILE_DEPTH,
  BASE_PROFILE_HEIGHT,
  BASE_TOP,
  BASE_TOP_RADIUS,
  GRID,
  LIP_DEPTH,
  LIP_SUPPORT_HEIGHT,
  WALL,
} from './spec';
import { extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import {
  buildDividerInsert,
  compartmentPocketLayouts,
  hasFilledCompartment,
  insertKey,
  insertsFor,
  insideKeyParts,
  insideSummary,
  interiorCuts,
  labelTabs,
  type DividerInsert,
  type LabelTab,
} from './compartments';
import { layoutKey, resolveLayout, sanitizeLayout, uniformLayout, type Compartment, type DividerLayout, type ResolvedLayout } from '../dividers';
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
import { fingerSlides, wallCutouts, wallPattern } from './walls';
import { pocketCutters, pocketLayout, type PocketLayout } from './pockets';
import {
  DEFAULT_LABELS,
  compartmentLabelText,
  labelKeyParts,
  planTabLabels,
  sanitizeLabelOptions,
  tabLabelGeometry,
  type BinLabelOptions,
  type LabelPlate,
} from './labels';
import { cutoutCutters, cutoutKeyPart, sanitizeCutouts, sanitizeCutoutStyle, type BinCutout, type CutoutStyle } from './cutouts';
import {
  MAX_CELLS,
  STRETCH_Z,
  cleanStretch,
  halfHoleSites,
  hasStretch,
  stretchKey,
  stretchOf,
  stretchOffset,
  type BinStretch,
} from './placement';
import {
  DEFAULT_ACCESSORIES,
  accessoryInfillTop,
  accessoryKeyParts,
  accessoryNeedsFloor,
  sanitizeAccessoryOptions,
  type BinAccessoryOptions,
} from './accessories';
import { binAccessoryGeometry } from './accessoryGeometry';

export type HoleStyle = 'none' | 'magnets' | 'screws' | 'both' | 'refined';
export type LabelStyle = 'none' | 'full' | 'left' | 'center' | 'right';

/** Base, lip, height-mode, hole, wall, pocket and lid options live in variants.ts; label text in labels.ts; trays, sliding lid and rails in accessories.ts. */
export interface BinOptions extends BinVariantOptions, BinLabelOptions, BinAccessoryOptions {
  /** Footprint in grid units. */
  unitsX: number;
  unitsY: number;
  /** Height in 7 mm units, excluding the stacking lip (when heightMode is 'units'). */
  heightUnits: number;
  /** Stacking lip on/off; its shape is `lipStyle`. */
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
  /** Tool-outline pockets, used when `interior` is 'cutouts': the bin is filled solid and each tool is cut in (cutouts.ts). */
  cutouts?: BinCutout[];
  /** How those pockets are cut; missing fields use DEFAULT_CUTOUT_STYLE. */
  cutoutStyle?: Partial<CutoutStyle>;
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
  ...DEFAULT_VARIANTS,
  ...DEFAULT_LABELS,
  ...DEFAULT_ACCESSORIES,
};

export const MIN_HEIGHT_UNITS = 2;

/**
 * Pitch of each grid cell a bin covers, when it sits on partial (edge-fill) cells.
 * Missing entries are full cells. Each cell gets a foot of its own size.
 */
export interface BinCells {
  x: number[];
  y: number[];
  /** On a half-grid drawer: 21 mm cells are whole feet, one hole each (placement.ts). */
  half?: boolean;
  /** How far the body reaches past the feet, from the bin's place by the drawer wall (placement.ts). */
  stretch?: BinStretch;
}

export function binCells(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells?: Partial<BinCells> | null): BinCells {
  const fit = (arr: number[] | undefined, n: number) => Array.from({ length: n }, (_, k) => (arr?.[k] && arr[k] > 0 ? arr[k] : GRID));
  const out: BinCells = { x: fit(cells?.x, o.unitsX), y: fit(cells?.y, o.unitsY) };
  if (cells?.half) out.half = true;
  const stretch = cleanStretch(cells?.stretch);
  if (stretch) out.stretch = stretch;
  return out;
}

/** True when every cell is a full grid cell (the common case). */
export function fullCells(c: BinCells | null | undefined): boolean {
  return !c || [...c.x, ...c.y].every((v) => Math.abs(v - GRID) < 1e-6);
}

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

/** Outside size of the body: the feet's footprint, plus any stretch (placement.ts). */
export function binSize(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells?: Partial<BinCells> | null) {
  const c = binCells(o, cells);
  const st = stretchOf(c.stretch);
  return { w: sum(c.x) - (GRID - BASE_TOP) + st.left + st.right, d: sum(c.y) - (GRID - BASE_TOP) + st.front + st.back };
}

/** Magnet / screw hole sites, bin-centered, as buildBin cuts them. */
export function binHoleSites(o: Pick<BinOptions, 'unitsX' | 'unitsY' | 'holes' | 'holeCorners' | 'base'>, cellsIn?: Partial<BinCells> | null) {
  if (o.base === 'flat' || o.holes === 'none') return [];
  const cells = binCells(o, cellsIn);
  const { fx, fy } = stretchOffset(cells.stretch);
  const sites = cells.half ? halfHoleSites(cells, !!o.holeCorners) : holeSites(cells, !!o.holeCorners);
  return fx || fy ? sites.map((p) => ({ ...p, x: p.x + fx, y: p.y + fy })) : sites;
}

/** Overall height including the lip. */
export function binTotalHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>) {
  return binBodyHeight(o) + lipRise(o);
}

/** Stable key so identical bins share one mesh. */
export function binKey(o: BinOptions, cells?: Partial<BinCells> | null): string {
  const c = binCells(o, cells);
  const cellPart = fullCells(c) ? [] : [`c${c.x.join('/')}x${c.y.join('/')}`];
  // Placement (placement.ts): half-grid holes, stretched body.
  const placePart = [...(c.half ? ['h'] : []), ...(c.stretch ? [stretchKey(c.stretch)] : [])];
  const live = o.layout ? new Set(binLayout(o, cells).compartments.map((k) => k.key)) : null;
  return [
    ...cellPart,
    ...placePart,
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
    ...(o.layout && live ? [`D{${layoutKey(o.layout, live)}}`] : []),
    ...variantKeyParts(o),
    ...labelKeyParts(o),
    ...cutoutKeyPart(o),
    ...accessoryKeyParts(o, binSize(o, cells)),
    ...(live ? insideKeyParts(o, live) : []),
  ].join('-');
}

/** "3×2×4u …". On a half grid (`cells.half`) the footprint is given in 42 mm units: 1.5×1. */
export function binLabel(o: BinOptions, cells?: Partial<BinCells> | null): string {
  const h = o.heightMode && o.heightMode !== 'units' ? `${Math.round(binTotalHeight(o) * 10) / 10}mm` : `${o.heightUnits}u`;
  const u = (n: number) => (cells?.half ? n / 2 : n);
  const parts = [`${u(o.unitsX)}×${u(o.unitsY)}×${h}`];
  const tools = o.cutouts?.length ?? 0;
  if (o.interior === 'cutouts') parts.push(`${tools} tool pocket${tools === 1 ? '' : 's'}`);
  else if (o.interior === 'pockets') parts.push('pockets');
  else if (o.layout) {
    const r = binLayout(o);
    const n = r.compartments.length;
    const desc = [n > 1 ? `${n} compartments` : '', ...insideSummary(o, r)].filter(Boolean).join(', ');
    if (desc) parts.push(desc);
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
    const H = binBodyHeight(o);
    // Trays and sliding lids take the top of the bin: the compartments stop under them.
    const topInfill = accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H);
    const zFloor = binFloorZ(o);
    const outerRing = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);
    const flat = o.base === 'flat';
    const pockets = o.interior === 'pockets';
    const toolCuts = o.interior === 'cutouts';
    const hollow = isHollowBase(o.base) && !pockets && !toolCuts;
    // Holes only fit in full cells (flat bins have no feet to hold them); half-grid feet get one each.
    const sites = binHoleSites(o, cells);
    // Stretched bins (placement.ts): W × D is the body; the feet sit off its center by (fx, fy).
    const stretched = hasStretch(cells.stretch);
    const { fx, fy } = stretchOffset(cells.stretch);

    const solids: Manifold[] = [];

    // 1. Base profile under every grid cell (sized to the cell, for partial edge cells); none for flat bins.
    const feet: Manifold[] = [];
    const gap = GRID - BASE_TOP;
    const totalX = sum(cells.x);
    const totalY = sum(cells.y);
    for (let i = 0, x0 = fx - totalX / 2; i < o.unitsX && !flat; x0 += cells.x[i], i++) {
      for (let j = 0, y0 = fy - totalY / 2; j < o.unitsY; y0 += cells.y[j], j++) {
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
    let block = s.t(extrudePolygon(w, outerRing, flat ? 0 : stretched ? STRETCH_Z : BASE_PROFILE_HEIGHT, topInfill));
    if (stretched && !flat) {
      // The overhang starts at STRETCH_Z, clear of the baseplate; over the feet the block starts as usual.
      const feetRing = roundedRectRing(fx - (totalX - gap) / 2, fy - (totalY - gap) / 2, fx + (totalX - gap) / 2, fy + (totalY - gap) / 2, BASE_TOP_RADIUS);
      block = s.t(w.Manifold.union([block, s.t(extrudePolygon(w, feetRing, BASE_PROFILE_HEIGHT, STRETCH_Z + 0.5))]));
    }
    // Lite / efficient bases: compartments go down into the feet (clipped to the foot pockets below).
    // Removable-divider slots, filled compartments and rails need solid floor under them, so those bins keep the full floor.
    const hollowCut = hollow && !keepsFullFloor(o, cells) && !accessoryNeedsFloor(o);
    const cutFloor = hollowCut ? hollowFloor(o.base) : zFloor;
    const interior = toolCuts
      ? { cut: cutoutCutters(w, s, o, W, D, topInfill), add: [] as Manifold[] }
      : pockets
        ? { cut: pocketCutters(w, s, o, W, D, zFloor, topInfill), add: [] as Manifold[] }
        : interiorCuts(w, s, o, W, D, cutFloor, topInfill);
    let cut = interior.cut.length ? s.t(w.Manifold.union(interior.cut)) : null;
    // Finger slides: leave a quarter-round along the chosen walls uncut.
    const slides = cut && !pockets && !toolCuts ? fingerSlides(w, s, o, W, D, cutFloor, Math.min(topInfill - cutFloor - 0.5, 40)) : [];
    if (cut && slides.length) cut = s.t(cut.subtract(s.t(w.Manifold.union(slides))));
    if (cut && hollowCut) {
      const keep = holeBosses(w, s, o, sites, zFloor - 0.05);
      if (fx || fy) {
        // clipToHollow works around the feet's center: shift there and back.
        const toFeet = (m: Manifold) => s.t(m.translate([-fx, -fy, 0]));
        const clipped = clipToHollow(w, s, o.base, cells, W + 2 * Math.abs(fx), D + 2 * Math.abs(fy), zFloor, toFeet(cut), keep.map(toFeet));
        cut = s.t(clipped.translate([fx, fy, 0]));
      } else cut = clipToHollow(w, s, o.base, cells, W, D, zFloor, cut, keep);
    }
    // Pockets and tool cutouts of filled compartments.
    if (interior.after?.length) cut = s.t(w.Manifold.union(cut ? [cut, ...interior.after] : interior.after));
    solids.push(cut ? s.t(block.subtract(cut)) : block, ...interior.add);
    if (cut && hollowCut && feet.length) solids.push(s.t(s.t(w.Manifold.union(feet)).subtract(cut)));
    else solids.push(...feet);

    // 3. Outer wall + stacking lip (unioned after the compartments so they never cut into it).
    const wallBottom = BASE_PROFILE_HEIGHT + 0.75;
    const top = binTotalHeight(o);
    // A floor below the wall's bottom (flat, lite) needs the wall open underneath.
    const cavityKnots = lipCavityKnots(o, H, wallBottom, flat || (hollowCut && cut) ? wallBottom - 0.5 : wallBottom + 0.5);
    const shell = s.t(extrudePolygon(w, outerRing, wallBottom, top));
    let cavity = s.t(loftRoundedRect(w, 0, 0, W, D, BASE_TOP_RADIUS, cavityKnots));
    // A stretched lip no longer lines up with the grid, so it gets no notches at the cell lines.
    const notches = o.lip && o.lipNotches && !stretched ? lipNotches(w, s, o, cells, W, D, H, top) : null;
    if (notches) cavity = s.t(cavity.subtract(notches));
    solids.push(s.t(shell.subtract(cavity)));
    // Tray ledges, sliding-lid band, rail ribs (accessories.ts); their grooves and cuts go with the wall cutouts.
    const acc = binAccessoryGeometry(w, s, o, W, D);
    solids.push(...acc.add);

    let bin = s.t(w.Manifold.union(solids));
    // Label text / label-plate recesses on the tabs (labels.ts).
    const labels = tabLabelGeometry(w, s, o, labelTabs(o, W, D, cutFloor, topInfill), H, W, D);
    bin = labels.apply(bin);

    // Wall cutouts, down to just above the floor (or the pocket fill).
    const cutLow = pockets ? Math.max(zFloor + 1, pocketLayout(o, W, D, zFloor, topInfill).fillTop + 0.5) : toolCuts ? topInfill + 0.5 : zFloor + 1;
    const cutouts = wallCutouts(w, s, o, W, D, top, cutLow);
    // Hex pattern: from above the floor to below the lip's support.
    const patternTop = !o.lip ? H - 1 : o.lipStyle === 'reduced' ? H : H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL) - 0.5;
    cutouts.push(...wallPattern(w, s, o, W, D, top, cutLow + 1, patternTop));
    cutouts.push(...acc.cut);
    if (cutouts.length) {
      const cu = s.t(w.Manifold.union(cutouts));
      bin = s.t(bin.subtract(cu));
      labels.clip(cu);
    }
    bin = acc.finish(bin);

    // 4. Magnet / screw holes in the bottom.
    const holes = holeCutters(w, s, o, sites);
    if (holes.length) bin = s.t(bin.subtract(s.t(w.Manifold.union(holes))));

    assertValid(bin, 'bin');
    return labels.finish(toMeshData(bin));
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
    // Cells: up to 12 u, which is 24 cells on a half-grid drawer (the UI keeps full-grid bins to 12).
    unitsX: int(o.unitsX, 1, MAX_CELLS),
    unitsY: int(o.unitsY, 1, MAX_CELLS),
    heightUnits,
    lip,
    holes: HOLE_STYLES.includes(o.holes) ? o.holes : 'none',
    divX: int(o.divX, 1, 12),
    divY: int(o.divY, 1, 12),
    scoop: Math.min(1, Math.max(0, Number(o.scoop) || 0)),
    layout: sanitizeLayout(o.layout),
    ...sanitizeVariants({ ...o, heightUnits, lip }),
    ...sanitizeLabelOptions(o),
    ...sanitizeAccessoryOptions(o),
    cutouts: sanitizeCutouts(o.cutouts),
    cutoutStyle: sanitizeCutoutStyle(o.cutoutStyle),
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
  if (!o.layout || o.interior !== 'compartments') return [];
  const H = binBodyHeight(o);
  const { w: W, d: D } = binSize(o, cells);
  const topInfill = accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H);
  return insertsFor(binLayout(o, cells), o.lip, binFloorZ(o), topInfill);
}

export { buildDividerInsert, insertKey, type DividerInsert };

// ---------------------------------------------------------------------------
// Label tabs, text and plates (geometry in ./labels.ts)
// ---------------------------------------------------------------------------

/** The flat tops of the bin's label tabs (bin-centered mm), as buildBin makes them. */
export function binLabelTabs(opts: BinOptions, cells?: Partial<BinCells> | null): LabelTab[] {
  const o = sanitizeBin(opts);
  const { w: W, d: D } = binSize(o, cells);
  const H = binBodyHeight(o);
  const topInfill = accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H);
  // Same floor buildBin cuts the compartments from.
  const hollowCut = isHollowBase(o.base) && o.interior !== 'pockets' && !keepsFullFloor(o, cells) && !accessoryNeedsFloor(o);
  return labelTabs(o, W, D, hollowCut ? hollowFloor(o.base) : binFloorZ(o), topInfill);
}

/**
 * Bins whose compartments can't reach down into hollow (lite / efficient) feet:
 * removable-divider slots and filled compartments need the full floor.
 */
function keepsFullFloor(o: BinOptions, cells?: Partial<BinCells> | null): boolean {
  if (o.layout?.walls.some((wall) => wall.removable)) return true;
  return !!o.layout?.comps && o.interior === 'compartments' && hasFilledCompartment(o, binLayout(o, cells));
}

/**
 * The pocket grid of each rect of a 'pockets' compartment of the bin's layout
 * (bin-centered mm), as buildBin cuts it; [] for any other compartment.
 */
export function binCompartmentPockets(opts: BinOptions, cells: Partial<BinCells> | null | undefined, c: Compartment): PocketLayout[] {
  const o = sanitizeBin(opts);
  const { w, d } = binInnerSize(o, cells);
  const H = binBodyHeight(o);
  return compartmentPocketLayouts(o, c, w, d, binFloorZ(o), o.lip ? H - LIP_SUPPORT_HEIGHT : H);
}

/** Swappable label plates the bin needs (one per tab when `labelPlates` is on). */
export function binLabelPlates(opts: BinOptions, cells?: Partial<BinCells> | null): LabelPlate[] {
  const o = sanitizeBin(opts);
  if (!o.labelPlates) return [];
  return planTabLabels(o, binLabelTabs(o, cells), binBodyHeight(o)).flatMap((l) => (l.plate ? [l.plate.plate] : []));
}

/** Label text of each tab, in tab order (blank tabs left out). */
export function binLabelTexts(opts: BinOptions, cells?: Partial<BinCells> | null): string[] {
  const o = sanitizeBin(opts);
  if (!labelKeyParts(o).some((p) => p.startsWith('T"')) && !Object.values(o.layout?.comps ?? {}).some((c) => c.labelText?.trim())) return [];
  return binLabelTabs(o, cells)
    .map((t) => compartmentLabelText(o, t.key))
    .filter(Boolean);
}
