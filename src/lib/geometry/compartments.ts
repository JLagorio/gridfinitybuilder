/**
 * Compartment cutters for a bin's infill block: the uniform divX × divY grid
 * (unchanged from before) and free-form divider layouts.
 *
 * Layout compartments:
 * - Rectangular ones look exactly like grid compartments: rounded inside corners,
 *   optional rounded bottom (hull of corner spheres), scoop on the front (−Y)
 *   wall, label tab on the back (+Y) wall, each with its own options.
 * - Non-rectangular ones (L/T/U shapes) are cut as a union of strips with only
 *   the outline's convex corners rounded. Their rounded bottom is a fillet swept
 *   along the outline's walls (`outlineFillet`). Simplifications: the scoop goes
 *   on strips whose whole front edge is a wall; one label tab, on the widest
 *   strip whose whole back edge is a wall.
 * - Insides (CompartmentOptions.inside): 'pockets' fills the compartment up to
 *   the pocket depth and cuts its own pocket grid into each strip (pockets.ts);
 *   'tools' fills it to the top and cuts the bin's tool cutouts (cutouts.ts)
 *   only inside it; 'solid' fills it flat. Filled compartments get no scoop or
 *   label tab, and their cuts are returned in `after` (past finger slides).
 * - Floor shapes (open compartments): a ramp or steps rising toward one side,
 *   left as solid material like a raised floor. A tab over the high side shrinks
 *   to stay clear of it.
 * - Lowered walls: above each distinct lowered height the compartments either
 *   side are re-derived without those walls and cut again from that height up
 *   (with rounded corners), protecting tabs, scoop ramps, raised and shaped
 *   floors and filled compartments.
 * - Removable walls: a slot through the wall's footprint (+ clearance) down into
 *   the floor, and guide ribs at each end (returned in `add`).
 * - Back-wall cutouts (walls.ts) can cut a label tab off the back wall. Across
 *   the cutout's span a tab is kept only where it still bridges between two
 *   holds (the tab going on past the cutout, or a plain side wall); otherwise
 *   it is trimmed back to the cutout's edge, or left out.
 * - Label tabs are also listed without building anything (`labelTabs`), for the
 *   label text and label-plate recesses in labels.ts.
 */
import type { Manifold, MeshData, Vec2, Vec3, Wasm } from './kernel';
import { Scope, assertValid, toMeshData } from './kernel';
import {
  DIVIDER,
  INNER_RADIUS,
  TAB_DEPTH,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_TIP_HEIGHT,
  TAB_WIDTH_NOMINAL,
  LIP_DEPTH,
  WALL,
} from './spec';
import { CORNER_SEGMENTS, boxAt, extrudePolygon, ringAt, roundedRectRing, type CornerRadii } from './shapes';
import type { BinOptions, LabelStyle } from './bin';
import { binBodyHeight, binFloorZ, lipRise } from './variants';
import { pocketFill, regionPocketCutters, regionPocketLayout, type PocketLayout, type PocketRegion } from './pockets';
import { cutoutCutters, cutoutKeyPart } from './cutouts';
import {
  MAX_TIERS,
  MIN_TIERS,
  RIB_ENGAGE,
  RIB_THICKNESS,
  SLOT_CLEARANCE,
  SLOT_DEPTH,
  deriveCompartments,
  removableSegments,
  resolveLayout,
  type CompRect,
  type Compartment,
  type CompartmentInside,
  type CompartmentOptions,
  type CompartmentPockets,
  type FloorHigh,
  type ResolvedLayout,
} from '../dividers';
import { applyWallExtras, insertExtras, insertExtrasKey, shapeInsert, type InsertExtras } from './wallExtras';
import { CUTOUT_REACH, backCutout } from './walls';

export interface CutterSpec {
  /** Footprint, already grown by the overlap into the surrounding walls. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Clear size, for sizing the scoop and the tab. */
  cw: number;
  cd: number;
  radius: number | CornerRadii;
  zFloor: number;
  topInfill: number;
  zTop: number;
  fillet: boolean;
  scoop: number;
  label: LabelStyle;
  /** Top of the label tab when the back wall is lowered (default: the infill top). */
  tabTop?: number;
  /** Compartment this cutter belongs to (for its label text). */
  key?: string;
  /** How far the stacking lip overhangs the back of the tab, hiding it from above. */
  backInset?: number;
  /** Top of a shaped floor under the tab (default: zFloor); the tab shrinks to stay clear of it. */
  tabZ?: number;
  /** The bin's back-wall cutout, when this compartment's back is the back wall: its span along X and its bottom. */
  backCut?: { x0: number; x1: number; z: number } | null;
  /** Sides that are plain, full-height walls a tab reaching into them hangs from (default: neither). */
  sideWalls?: { left: boolean; right: boolean };
  /** The back is a removable wall's slot: a tab there can only hang between the side walls. */
  backFree?: boolean;
}

/** A label tab's flat top, in bin coordinates. */
export interface LabelTab {
  /** Compartment key (`g<i>,<j>` in a uniform grid). */
  key: string;
  /** Ends of the tab. */
  x0: number;
  x1: number;
  /** Front edge, and the back edge of the part you can see from above (clear of the lip). */
  y0: number;
  y1: number;
  /** Height of the flat top. */
  z: number;
}

export interface TabShape {
  tx0: number;
  tx1: number;
  /** Back (in the wall) and front edge. */
  yb: number;
  yf: number;
  /** Thickness at the back. */
  th: number;
  tabTop: number;
  /** Top of the hull (above the infill unless the tab is lowered). */
  zt: number;
}

/** Where a cutter's label tab goes, or null when it has none (or no room for one). */
export function tabShape(c: CutterSpec): TabShape | null {
  if (c.label === 'none') return null;
  const eps = 0.01;
  const { x0, x1, y1, cw, cd, zFloor, topInfill, zTop } = c;
  const tabTop = c.tabTop ?? topInfill;
  const lowered = tabTop < topInfill - 1e-6;
  const room = tabTop - (c.tabZ ?? zFloor);
  const tan = Math.tan((TAB_SUPPORT_ANGLE_DEG * Math.PI) / 180);
  let td = Math.min(TAB_DEPTH, cd * 0.45);
  if (tan * td + TAB_TIP_HEIGHT > room - 1) td = (room - 1 - TAB_TIP_HEIGHT) / tan;
  if (!(td >= 4)) return null;
  const th = tan * td + TAB_TIP_HEIGHT;
  const tw = c.label === 'full' ? cw + 4 * eps : Math.min(cw, TAB_WIDTH_NOMINAL);
  let tx0: number;
  if (c.label === 'full') tx0 = x0 - eps;
  else if (c.label === 'left') tx0 = x0 - eps;
  else if (c.label === 'right') tx0 = x1 + eps - tw;
  else tx0 = (x0 + x1) / 2 - tw / 2;
  let tx1 = tx0 + tw;
  if (c.backFree) {
    // Nothing to hang from at the back (the plate slides in behind): the tab spans side wall to side wall, or there is none.
    if (!c.sideWalls?.left || !c.sideWalls?.right) return null;
    [tx0, tx1] = [x0 - eps, x0 - eps + cw + 4 * eps];
  }
  const cut = c.backCut;
  if (cut && tx0 < cut.x1 && tx1 > cut.x0 && cutsTabLoose(cut.z, tabTop, th, td, tan)) {
    // Across the cutout the tab no longer hangs from the back wall: keep it there only as a bridge.
    const outL = cut.x0 - tx0;
    const outR = tx1 - cut.x1;
    const heldL = outL >= TAB_HOLD || (tx0 < x0 && !!c.sideWalls?.left);
    const heldR = outR >= TAB_HOLD || (tx1 > x1 && !!c.sideWalls?.right);
    if (!heldL || !heldR) {
      // Else what is left of it beside the cutout (the longer side), if anything.
      [tx0, tx1] = outL >= outR ? [tx0, cut.x0] : [cut.x1, tx1];
      if (tx1 - tx0 < MIN_CUT_TAB) return null;
    }
  }
  return { tx0, tx1, yb: y1 + 2 * eps, yf: y1 - td, th, tabTop, zt: lowered ? tabTop : zTop + 0.5 };
}

/** Least material that still holds a tab to the wall across a back-wall cutout: left under the cutout, or tab running on past its edge (mm). */
const TAB_HOLD = 1;
/** A tab trimmed back to a cutout's edge narrower than this is left out (mm). */
const MIN_CUT_TAB = 4;

/**
 * Does a back-wall cutout with its bottom at `z` cut a tab (top `tabTop`, `th`
 * thick at the wall, `td` deep) off the wall? The cutout takes everything above
 * `z` within CUTOUT_REACH of the outside; the tab stays held only by what is
 * left under it there, where its underside has risen toward the front.
 */
function cutsTabLoose(z: number, tabTop: number, th: number, td: number, tan: number): boolean {
  if (z >= tabTop) return false;
  const reach = CUTOUT_REACH - WALL;
  return reach >= td || z < tabTop - th + tan * reach + TAB_HOLD;
}

/** The flat top of a cutter's label tab (clipped to the compartment, clear of the lip). */
function tabOf(c: CutterSpec): LabelTab | null {
  const t = tabShape(c);
  if (!t) return null;
  const eps = 0.01;
  const y1 = c.y1 - eps - (c.backInset ?? 0);
  if (y1 - t.yf < 1) return null;
  return { key: c.key ?? '', x0: Math.max(t.tx0, c.x0 + eps), x1: Math.min(t.tx1, c.x1 - eps), y0: t.yf, y1, z: t.tabTop };
}

/** Radius of a cutter's front scoop (0 = none). */
export function scoopRadius(c: Pick<CutterSpec, 'scoop' | 'cd' | 'zFloor' | 'topInfill'>): number {
  if (!(c.scoop > 0)) return 0;
  return Math.max(2, c.scoop * Math.min((c.topInfill - c.zFloor) * 0.85, c.cd * 0.6));
}

/**
 * One compartment cutter. With a numeric radius and no tabTop this is exactly
 * the cutter the uniform grid has always used.
 * Solids that later cuts must not remove (tab, scoop ramp) are pushed to `keep`.
 */
export function compartmentCutter(w: Wasm, s: Scope, c: CutterSpec, keep?: Manifold[]): Manifold {
  const { x0, y0, x1, y1, zFloor, topInfill, zTop } = c;
  const innerH = topInfill - zFloor;
  let cutter: Manifold;
  const r = typeof c.radius === 'number' ? c.radius : Math.max(...c.radius);
  const rf = Math.min(r, innerH / 2 - 0.05);
  if (c.fillet && typeof c.radius === 'number' && rf > 0.3) {
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
    pts.push(...ringAt(roundedRectRing(x0, y0, x1, y1, c.radius), zTop));
    cutter = s.t(w.Manifold.hull(pts));
  } else {
    cutter = s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, c.radius), zFloor, zTop));
  }

  // Scoop: a concave ramp on the front (-Y) wall for scooping out small parts.
  if (c.scoop > 0) {
    const R = scoopRadius(c);
    const fill = s.t(boxAt(w, x0 - 1, y0 - 1, zFloor - 1, x1 + 1, y0 + R, zFloor + R));
    const cyl = s.t(
      w.Manifold.cylinder(x1 - x0 + 4, R, R, 64)
        .rotate([0, 90, 0])
        .translate([x0 - 2, y0 + R, zFloor + R]),
    );
    const ramp = s.t(fill.subtract(cyl));
    cutter = s.t(cutter.subtract(ramp));
    if (keep) keep.push(s.t(ramp.intersect(s.t(boxAt(w, x0, y0 - 1, zFloor - 1, x1, y0 + R, zFloor + R)))));
  }

  // Label tab: a shelf on the back (+Y) wall, angled underneath so it prints without support.
  const t = tabShape(c);
  if (t) {
    const pts: Vec3[] = [];
    for (const x of [t.tx0, t.tx1]) {
      pts.push([x, t.yb, t.tabTop - t.th], [x, t.yb, t.zt], [x, t.yf, t.zt], [x, t.yf, t.tabTop - TAB_TIP_HEIGHT]);
    }
    const tab = s.t(w.Manifold.hull(pts));
    cutter = s.t(cutter.subtract(tab));
    if (keep) keep.push(tab);
  }
  return cutter;
}

export interface InteriorCuts {
  /** Unioned and subtracted from the infill block. */
  cut: Manifold[];
  /** Unioned onto the bin afterwards (guide ribs for removable dividers). */
  add: Manifold[];
  /**
   * Also subtracted, but after finger slides are left uncut: what filled
   * compartments cut (pockets, tool cutouts, the open space above a pocket fill).
   */
  after?: Manifold[];
}

/** Everything that shapes the interior of a bin's infill block. */
export function interiorCuts(
  w: Wasm,
  s: Scope,
  o: BinOptions,
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): InteriorCuts {
  if (!o.layout) return { cut: uniformCutters(w, s, o, W, D, zFloor, topInfill), add: [] };
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  return layoutCuts(w, s, o, resolveLayout(o.layout, innerW, innerD), W, D, zFloor, topInfill);
}

/**
 * The flat tops of a bin's label tabs, with the same sizes `interiorCuts` gives
 * them (same arguments). No geometry is built. Empty for non-compartment interiors.
 */
export function labelTabs(o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): LabelTab[] {
  if (o.interior && o.interior !== 'compartments') return [];
  let specs: CutterSpec[];
  if (!o.layout) {
    try {
      specs = uniformSpecs(o, W, D, zFloor, topInfill);
    } catch {
      return [];
    }
  } else {
    const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
    specs = planLayout(o, r, -W / 2 + WALL, -D / 2 + WALL, zFloor, topInfill).flatMap((x) => x.specs);
  }
  // Only the part of a tab clear of the stacking lip can take text or a plate (the lip overhangs the side walls too).
  const lim = o.lip ? W / 2 - LIP_DEPTH : Infinity;
  return specs
    .map(tabOf)
    .filter((t): t is LabelTab => !!t)
    .map((t) => ({ ...t, x0: Math.max(t.x0, -lim), x1: Math.min(t.x1, lim) }))
    .filter((t) => t.x1 - t.x0 >= 1);
}

// ---------------------------------------------------------------------------
// Compartment insides and floor shapes
// ---------------------------------------------------------------------------

/** A compartment's inside ('open' when unset or unknown). */
export function compartmentInside(co: CompartmentOptions | null | undefined): CompartmentInside {
  const v = co?.inside;
  return v === 'pockets' || v === 'tools' || v === 'solid' ? v : 'open';
}

/** Every pocket field. */
export type PocketSettings = Required<CompartmentPockets>;

/** A 'pockets' compartment's pocket settings: every pocket field of the bin, then its own. */
export function compartmentPocketOpts(o: BinOptions, co?: CompartmentOptions | null): PocketSettings {
  const own = Object.entries(co?.pockets ?? {}).filter(([, v]) => v !== undefined && v !== null);
  return { ...Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('pocket'))), ...Object.fromEntries(own) } as PocketSettings;
}

export interface FloorShapeSpec {
  kind: 'ramp' | 'tiers';
  /** How far the high side (the top step) is above the floor, mm. */
  rise: number;
  high: FloorHigh;
  /** Number of steps; 1 for a ramp. */
  tiers: number;
}

/** Rise of a new ramp or steps: half the depth, at most 10 mm. */
export function defaultFloorRise(depth: number): number {
  return Math.max(0, Math.round(Math.min(10, depth / 2)));
}

/**
 * An open compartment's floor shape, its rise clamped like a raised floor
 * (`depth` is the depth above the floor it rises from), or null for a flat floor.
 */
export function compartmentFloorShape(co: CompartmentOptions | null | undefined, depth: number): FloorShapeSpec | null {
  if (!co || compartmentInside(co) !== 'open' || (co.floorShape !== 'ramp' && co.floorShape !== 'tiers')) return null;
  const rise = Math.min(Math.max(0, depth - 2), Math.max(0, co.floorRise ?? defaultFloorRise(depth)));
  if (!(rise >= 0.5)) return null;
  const tiers = co.floorShape === 'tiers' ? Math.min(MAX_TIERS, Math.max(MIN_TIERS, Math.round(co.tiers ?? 3))) : 1;
  return { kind: co.floorShape, rise, high: co.floorHigh ?? 'back', tiers };
}

/** 0 at the low edge of `b`, 1 at the high edge (not clamped). */
function toward(f: Pick<FloorShapeSpec, 'high'>, b: XY, x: number, y: number): number {
  if (f.high === 'front') return (b.y1 - y) / (b.y1 - b.y0);
  if (f.high === 'left') return (b.x1 - x) / (b.x1 - b.x0);
  if (f.high === 'right') return (x - b.x0) / (b.x1 - b.x0);
  return (y - b.y0) / (b.y1 - b.y0);
}

/** Height of a shaped floor above its base at (x, y); `b` is the compartment's bounds, in the same coordinates. */
export function floorShapeHeight(f: FloorShapeSpec, b: XY, x: number, y: number): number {
  const t = toward(f, b, x, y);
  if (f.kind === 'ramp') return f.rise * t;
  const k = Math.min(f.tiers - 1, Math.max(0, Math.floor(t * f.tiers + 1e-9)));
  return (f.rise * k) / (f.tiers - 1);
}

/** Does any compartment that exists in `r` have a filled inside? */
export function hasFilledCompartment(o: BinOptions, r: ResolvedLayout): boolean {
  const comps = o.layout?.comps;
  return !!comps && r.compartments.some((c) => compartmentInside(comps[c.key]) !== 'open');
}

/** True when the bin's tool cutouts go into compartments (laying out tools then keeps its compartments). */
export function usesToolCompartments(o: Pick<BinOptions, 'interior' | 'layout'>): boolean {
  return (!o.interior || o.interior === 'compartments') && Object.values(o.layout?.comps ?? {}).some((c) => c?.inside === 'tools');
}

/** "1 pocket grid", "2 solid", … for the filled compartments of a layout. */
export function insideSummary(o: BinOptions, r: ResolvedLayout): string[] {
  const n = { pockets: 0, tools: 0, solid: 0 };
  for (const c of r.compartments) {
    const i = compartmentInside(o.layout?.comps?.[c.key]);
    if (i !== 'open') n[i]++;
  }
  const out: string[] = [];
  if (n.pockets) out.push(`${n.pockets} pocket grid${n.pockets === 1 ? '' : 's'}`);
  if (n.tools) out.push(`${n.tools} for tools`);
  if (n.solid) out.push(`${n.solid} solid`);
  return out;
}

/**
 * Mesh-key parts for what filled compartments take from the bin: its pocket
 * fields and its tool cutouts. [] unless a compartment in `live` uses them,
 * so other bins keep their keys.
 */
export function insideKeyParts(o: BinOptions, live: Set<string>): string[] {
  if (o.interior && o.interior !== 'compartments') return [];
  const used = new Set(
    Object.entries(o.layout?.comps ?? {})
      .filter(([k]) => live.has(k))
      .map(([, co]) => compartmentInside(co)),
  );
  const p: string[] = [];
  if (used.has('pockets')) {
    const fields = Object.entries(o)
      .filter(([k]) => k.startsWith('pocket') && k !== 'pocketPreset')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k.slice(6)}${typeof v === 'object' ? JSON.stringify(v) : v}`);
    p.push(`Ip{${fields.join(',')}}`);
  }
  if (used.has('tools')) p.push(...cutoutKeyPart({ ...o, interior: 'cutouts' }).map((k) => `I${k}`));
  return p;
}

/**
 * The pocket grid of each rect of a 'pockets' compartment of an innerW × innerD
 * cavity (bin-centered mm), as `interiorCuts` cuts it; [] for other compartments.
 */
export function compartmentPocketLayouts(
  o: BinOptions,
  c: Compartment,
  innerW: number,
  innerD: number,
  zFloor: number,
  topInfill: number,
): PocketLayout[] {
  if ((o.interior && o.interior !== 'compartments') || compartmentInside(o.layout?.comps?.[c.key]) !== 'pockets') return [];
  return planLayout(o, { innerW, innerD, compartments: [c] }, -innerW / 2, -innerD / 2, zFloor, topInfill)[0]?.pockets ?? [];
}

/** One rect of a compartment as `interiorCuts` cuts it: what drops into it must clear these (cups.ts). */
export interface CompartmentSpace {
  key: string;
  /** False: this is one strip of an L/T/U-shaped compartment. */
  isRect: boolean;
  /** Clear rect between the wall faces, bin-centered mm. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Floor of the compartment (raised floors included). */
  zFloor: number;
  topInfill: number;
  /** Plan radius of the cutter's corners (the largest). */
  radius: number;
  /** Radius of the rounded bottom edges, 0 for none. */
  fillet: number;
  /** Radius of the front scoop, 0 for none. */
  scoop: number;
  tab: TabShape | null;
  /** Filled, or a ramp / steps floor: nothing can drop in. */
  blocked: boolean;
}

/** Every compartment rect of a bin (same arguments as `interiorCuts`). No geometry is built. */
export function compartmentSpaces(o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): CompartmentSpace[] {
  if (o.interior && o.interior !== 'compartments') return [];
  const eps = 0.01;
  const of = (c: CutterSpec, key: string, isRect: boolean, fillet: number, blocked: boolean): CompartmentSpace => ({
    key,
    isRect,
    x0: c.x0 + eps,
    y0: c.y0 + eps,
    x1: c.x1 - eps,
    y1: c.y1 - eps,
    zFloor: c.zFloor,
    topInfill: c.topInfill,
    radius: typeof c.radius === 'number' ? c.radius : Math.max(...c.radius),
    fillet,
    scoop: scoopRadius(c),
    tab: tabShape(c),
    blocked,
  });
  // As compartmentCutter rounds a rectangular compartment's bottom.
  const rectFillet = (c: CutterSpec) => {
    const r = typeof c.radius === 'number' ? c.radius : Math.max(...c.radius);
    const rf = Math.min(r, (c.topInfill - c.zFloor) / 2 - 0.05);
    return c.fillet && typeof c.radius === 'number' && rf > 0.3 ? rf : 0;
  };
  if (!o.layout) {
    try {
      return uniformSpecs(o, W, D, zFloor, topInfill).map((c) => of(c, c.key ?? '', true, rectFillet(c), false));
    } catch {
      return [];
    }
  }
  const ix0 = -W / 2 + WALL;
  const iy0 = -D / 2 + WALL;
  const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
  return planLayout(o, r, ix0, iy0, zFloor, topInfill).flatMap((p): CompartmentSpace[] => {
    const blocked = p.inside !== 'open' || !!p.shape;
    if (blocked || !p.specs.length) {
      return p.c.rects.map((rc) => ({
        key: p.c.key,
        isRect: p.c.isRect,
        x0: ix0 + rc.x0,
        y0: iy0 + rc.y0,
        x1: ix0 + rc.x1,
        y1: iy0 + rc.y1,
        zFloor: p.fillTop,
        topInfill,
        radius: rectRadius(rc),
        fillet: 0,
        scoop: 0,
        tab: null,
        blocked: true,
      }));
    }
    // L/T/U shapes: the outline fillet (layoutCuts), as round as the corners allow.
    let lFillet = 0;
    if (!p.c.isRect && o.fillet) {
      const radii = p.c.rects.flatMap((rc) => (rc.convex.some(Boolean) ? [rectRadius(rc) + eps] : []));
      const rf = Math.min(INNER_RADIUS + eps, (topInfill - p.zf) / 2 - 0.05, ...radii);
      lFillet = rf > 0.3 ? rf : 0;
    }
    return p.specs.map((c) => of(c, p.c.key, p.c.isRect, p.c.isRect ? rectFillet(c) : lFillet, false));
  });
}

/** The classic divX × divY grid (geometry identical to before layouts existed). */
function uniformCutters(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): Manifold[] {
  return uniformSpecs(o, W, D, zFloor, topInfill).map((c) => compartmentCutter(w, s, c));
}

/** Cutter specs of the uniform grid, front-left first, column by column. */
function uniformSpecs(o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): CutterSpec[] {
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
  const back = backCut(o, W);
  const specs: CutterSpec[] = [];
  for (let i = 0; i < o.divX; i++) {
    for (let j = 0; j < o.divY; j++) {
      const x0 = ix0 + i * (cw + DIVIDER) - eps;
      const x1 = x0 + cw + 2 * eps;
      const y0 = iy0 + j * (cd + DIVIDER) - eps;
      const y1 = y0 + cd + 2 * eps;
      specs.push({
        x0,
        y0,
        x1,
        y1,
        cw,
        cd,
        radius: rc + eps,
        zFloor,
        topInfill,
        zTop,
        fillet: o.fillet,
        scoop: o.scoop,
        label: o.label,
        key: `g${i},${j}`,
        backInset: j === o.divY - 1 ? lipInset(o) : 0,
        backCut: j === o.divY - 1 ? back : null,
        sideWalls: { left: true, right: true },
      });
    }
  }
  return specs;
}

/** How far the stacking lip reaches in over the back of a tab against the outer wall. */
const lipInset = (o: BinOptions) => (o.lip ? LIP_DEPTH - WALL : 0);

/** The back-wall cutout as buildBin cuts it from a compartment bin (down to just above the floor), seen from the tabs. */
const backCut = (o: BinOptions, W: number) => backCutout(o, W, binBodyHeight(o) + lipRise(o), binFloorZ(o) + 1);

/**
 * Sides of a layout rect a label tab can hang from: the cavity edge, or plain
 * walls (fixed, full height, no notch or shaped top) along the whole side.
 */
function plainSides(r: Pick<ResolvedLayout, 'innerW' | 'walls'>, rc: CompRect): { left: boolean; right: boolean } {
  const tol = 1e-4;
  const side = (open: boolean, edge: boolean, pos: number) => {
    if (!open) return false;
    if (edge) return true;
    const ws = r.walls.filter((x) => x.orient === 'v' && Math.abs(x.pos - pos) < tol && x.start < rc.y1 && x.end > rc.y0);
    return ws.length > 0 && ws.every((x) => !x.removable && !(x.lower > 0) && !x.wall.notch && (x.wall.top ?? 'flat') === 'flat');
  };
  return {
    left: side(rc.open.left, rc.x0 <= tol, rc.x0 - DIVIDER / 2),
    right: side(rc.open.right, rc.x1 >= r.innerW - tol, rc.x1 + DIVIDER / 2),
  };
}

/** Is the rect's back side a removable wall (its slot)? */
function removableBehind(walls: ResolvedLayout['walls'], rc: CompRect): boolean {
  const pos = rc.y1 + DIVIDER / 2;
  return walls.some((x) => x.orient === 'h' && x.removable && Math.abs(x.pos - pos) < 1e-4 && x.start < rc.x1 && x.end > rc.x0);
}

const rectRadius = (r: { x0: number; x1: number; y0: number; y1: number }) =>
  Math.max(0, Math.min(INNER_RADIUS, (r.x1 - r.x0) / 2 - 0.05, (r.y1 - r.y0) / 2 - 0.05));

/** Rounded only at the outline's convex corners. */
const strapRadii = (rc: CompRect, r: number, eps: number): CornerRadii =>
  rc.convex.map((cv) => (cv && r > 0 ? r + eps : 0)) as CornerRadii;

/** One layout compartment, planned without building anything. */
interface CompPlan {
  c: Compartment;
  inside: CompartmentInside;
  /** Raised floor (mm) and the floor it gives. */
  floor: number;
  zf: number;
  /** Top of the solid fill of a filled compartment (zf for open ones). */
  fillTop: number;
  pocketOpts?: PocketSettings;
  /** 'pockets': the grid of each rect. */
  pockets?: PocketLayout[];
  shape: FloorShapeSpec | null;
  /** Floor the shape rises from (never inside a hollow base's feet). */
  shapeBase: number;
  /** Cutters for the open space, one per rect ('pockets': above the fill; none for 'tools' / 'solid'). */
  specs: CutterSpec[];
}

/** Each layout compartment's cutter specs (one per rect), floor, inside and floor shape. */
function planLayout(
  o: BinOptions,
  r: Pick<ResolvedLayout, 'innerW' | 'innerD' | 'compartments'> & Partial<Pick<ResolvedLayout, 'walls'>>,
  ix0: number,
  iy0: number,
  zFloor: number,
  topInfill: number,
): CompPlan[] {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return [];
  const eps = 0.01;
  const zTop = topInfill + 1;
  const maxLower = Math.max(0, innerH - 2);
  const box = (rc: { x0: number; y0: number; x1: number; y1: number }, grow: number) => ({
    x0: ix0 + rc.x0 - grow,
    y0: iy0 + rc.y0 - grow,
    x1: ix0 + rc.x1 + grow,
    y1: iy0 + rc.y1 + grow,
  });
  const backInset = (rc: CompRect) => (rc.y1 >= r.innerD - 1e-6 ? lipInset(o) : 0);
  // Back-wall cutout over tabs against the back wall, and the sides those tabs can hang from.
  const back = backCut(o, r.innerW + 2 * WALL);
  const backWall = (rc: CompRect) => ({
    backCut: rc.y1 >= r.innerD - 1e-6 ? back : null,
    sideWalls: r.walls ? plainSides({ innerW: r.innerW, walls: r.walls }, rc) : undefined,
    ...(r.walls && removableBehind(r.walls, rc) ? { backFree: true } : {}),
  });
  // Pocket regions on the cavity edge stay clear of the lip when the fill reaches up under it.
  const region = (rc: CompRect, lip: number): PocketRegion => ({
    x0: ix0 + rc.x0 + (rc.x0 <= 1e-6 ? lip : 0),
    y0: iy0 + rc.y0 + (rc.y0 <= 1e-6 ? lip : 0),
    x1: ix0 + rc.x1 - (rc.x1 >= r.innerW - 1e-6 ? lip : 0),
    y1: iy0 + rc.y1 - (rc.y1 >= r.innerD - 1e-6 ? lip : 0),
  });
  const realFloor = binFloorZ(o);

  return r.compartments.map((c): CompPlan => {
    const co = o.layout?.comps?.[c.key];
    const inside = compartmentInside(co);
    const filled = inside !== 'open';
    const scoop = filled ? 0 : (co?.scoop ?? o.scoop);
    const label = filled ? 'none' : (co?.label ?? o.label);
    const floor = inside === 'tools' || inside === 'solid' ? 0 : Math.min(Math.max(0, co?.floor ?? 0), Math.max(0, innerH - 2));
    const zf = zFloor + floor;
    const plan: CompPlan = { c, inside, floor, zf, fillTop: zf, shape: null, shapeBase: zf, specs: [] };
    if (inside === 'pockets') {
      const po = compartmentPocketOpts(o, co);
      plan.pocketOpts = po;
      plan.fillTop = pocketFill(po, zf, topInfill).fillTop;
      const lip = plan.fillTop >= topInfill - 1e-6 ? lipInset(o) : 0;
      plan.pockets = c.rects.map((rc) => regionPocketLayout(po, region(rc, lip), zf, topInfill));
    } else if (filled) plan.fillTop = topInfill;
    else {
      plan.shapeBase = Math.max(zf, realFloor);
      plan.shape = compartmentFloorShape(co, topInfill - plan.shapeBase);
    }
    if (plan.fillTop >= topInfill - 1e-6) return plan;

    const spec = { zFloor: plan.fillTop, topInfill, zTop, key: c.key };
    const b = box(c.bounds, 0);
    const shape = plan.shape;
    // The highest point of a shaped floor along a strip's back edge, for the tab over it.
    const tabZ = (rc: CompRect) =>
      shape
        ? { tabZ: plan.shapeBase + Math.max(floorShapeHeight(shape, b, ix0 + rc.x0, iy0 + rc.y1), floorShapeHeight(shape, b, ix0 + rc.x1, iy0 + rc.y1)) }
        : {};
    if (c.isRect) {
      const rc = c.rects[0];
      const one: CutterSpec = {
        ...box(rc, eps),
        ...spec,
        cw: rc.x1 - rc.x0,
        cd: rc.y1 - rc.y0,
        radius: rectRadius(rc) + eps,
        fillet: o.fillet && !filled,
        scoop,
        label,
        tabTop: topInfill - Math.min(rc.backLower, maxLower),
        backInset: backInset(rc),
        ...backWall(rc),
        ...tabZ(rc),
      };
      plan.specs = [one];
      return plan;
    }
    const tabStrip = c.rects.filter((x) => x.open.back).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
    plan.specs = c.rects.map(
      (rc): CutterSpec => ({
        ...box(rc, eps),
        ...spec,
        cw: rc.x1 - rc.x0,
        cd: rc.y1 - rc.y0,
        radius: strapRadii(rc, rectRadius(rc), eps),
        fillet: false,
        scoop: rc.open.front ? scoop : 0,
        label: rc === tabStrip ? label : 'none',
        tabTop: topInfill - Math.min(rc.backLower, maxLower),
        backInset: backInset(rc),
        ...backWall(rc),
        ...tabZ(rc),
      }),
    );
    return plan;
  });
}

function layoutCuts(
  w: Wasm,
  s: Scope,
  o: BinOptions,
  r: ResolvedLayout,
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): InteriorCuts {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return { cut: [], add: [] };
  const ix0 = -W / 2 + WALL;
  const iy0 = -D / 2 + WALL;
  const eps = 0.01;
  const zTop = topInfill + 1;
  const maxLower = Math.max(0, innerH - 2);
  const cut: Manifold[] = [];
  const keep: Manifold[] = [];
  const add: Manifold[] = [];
  const after: Manifold[] = [];
  const box = (rc: { x0: number; y0: number; x1: number; y1: number }, grow: number) => ({
    x0: ix0 + rc.x0 - grow,
    y0: iy0 + rc.y0 - grow,
    x1: ix0 + rc.x1 + grow,
    y1: iy0 + rc.y1 + grow,
  });
  const footprint = (c: Compartment, grow: number, z0: number, z1: number) =>
    s.t(w.Manifold.union(c.rects.map((rc) => s.t(prism(w, box(rc, grow), z0, z1)))));
  // The bin's tool cutouts, built once for every 'tools' compartment.
  let tools: Manifold | null | undefined;
  const openRects: CutterSpec[] = [];

  for (const p of planLayout(o, r, ix0, iy0, zFloor, topInfill)) {
    const { c } = p;
    const own = p.specs.map((spec) => compartmentCutter(w, s, spec, keep));
    if (p.inside !== 'open') {
      // Filled: lowered-wall cuts leave the fill alone (grown past the cutters' overlap so no slit opens along the walls).
      keep.push(footprint(c, 2 * eps, zFloor - 1, p.fillTop));
      after.push(...own);
      if (p.pocketOpts) for (const L of p.pockets ?? []) after.push(...regionPocketCutters(w, s, p.pocketOpts, L, p.zf, zTop));
      if (p.inside === 'tools') {
        if (tools === undefined) {
          const t = cutoutCutters(w, s, o, W, D, topInfill);
          tools = t.length ? s.t(w.Manifold.union(t)) : null;
        }
        if (tools) after.push(s.t(tools.intersect(footprint(c, 0, zFloor - 2, zTop + 1))));
      }
      continue;
    }
    // Open rectangular compartments: their rounded bottoms are trimmed where they meet a removable wall's slot.
    if (c.isRect && !p.shape) openRects.push(...p.specs);
    // Material left inside the compartment: rounded bottom of L-shaped ones, ramps and steps.
    const minus: Manifold[] = [];
    if (!c.isRect && o.fillet && own.length) {
      // Like the rectangular cutters' corner spheres: as round as the (grown) corners allow.
      const radii = c.rects.flatMap((rc) => (rc.convex.some(Boolean) ? [rectRadius(rc) + eps] : []));
      const rf = Math.min(INNER_RADIUS + eps, (topInfill - p.zf) / 2 - 0.05, ...radii);
      if (rf > 0.3) minus.push(...outlineFillet(w, s, c, ix0, iy0, p.zf, rf, eps));
    }
    if (p.shape) {
      const solid = floorShapeSolid(w, s, p.shape, c, box, p.shapeBase, p.zf - 1 - p.shape.rise, 2 * eps);
      minus.push(solid);
      keep.push(solid);
    }
    if (minus.length && own.length) cut.push(s.t(s.t(w.Manifold.union(own)).subtract(s.t(w.Manifold.union(minus)))));
    else cut.push(...own);
    if (p.floor > 0) for (const rc of c.rects) keep.push(s.t(prism(w, box(rc, 0), zFloor - 1, zFloor + p.floor)));
  }

  // Lowered walls: re-cut the merged space above each lowered height.
  const levels = [...new Set(r.walls.filter((x) => x.lower > 0).map((x) => Math.round(Math.min(x.lower, maxLower) * 100) / 100))]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (levels.length) {
    const own = new Set(r.compartments.map((c) => c.key));
    const layers: Manifold[] = [];
    for (const L of levels) {
      const zL = topInfill - L;
      const present = (x: { lower: number }) => Math.min(x.lower, maxLower) < L - 1e-6;
      for (const c of deriveCompartments(r.innerW, r.innerD, r.walls, present)) {
        if (own.has(c.key)) continue;
        for (const rc of c.rects) {
          const b = box(rc, eps);
          const radii = c.isRect ? rectRadius(rc) + eps : strapRadii(rc, rectRadius(rc), eps);
          layers.push(s.t(extrudePolygon(w, roundedRectRing(b.x0, b.y0, b.x1, b.y1, radii), zL, zTop)));
        }
      }
    }
    if (layers.length) {
      let layer = s.t(w.Manifold.union(layers));
      if (keep.length) layer = s.t(layer.subtract(s.t(w.Manifold.union(keep))));
      cut.push(layer);
    }
  }

  // Finger notches, shaped tops, diagonal / curved walls (wallExtras.ts).
  applyWallExtras(w, s, r, ix0, iy0, zFloor, topInfill, { cut, keep });

  // Removable walls: slot + floor groove, guide ribs at each end.
  for (const seg of removableSegments(r, o.lip)) {
    const half = DIVIDER / 2 + SLOT_CLEARANCE;
    const top = topInfill - Math.min(seg.lower, maxLower);
    const a = seg.aEdge ? seg.a - eps : seg.a;
    const b = seg.bEdge ? seg.b + eps : seg.b;
    cut.push(s.t(prism(w, place(seg.orient, seg.pos - half, a, seg.pos + half, b, ix0, iy0), zFloor - SLOT_DEPTH, zTop)));
    for (const c of openRects) cut.push(...slotHornTrims(w, s, c, seg, ix0, iy0));
    for (const [face, dir, gap] of [
      [seg.a, 1, seg.gapA],
      [seg.b, -1, seg.gapB],
    ] as const) {
      const r0 = face - dir * 0.02;
      const r1 = face + dir * (gap + RIB_ENGAGE);
      for (const side of [-1, 1]) {
        const c0 = seg.pos + side * half;
        const c1 = c0 + side * RIB_THICKNESS;
        add.push(
          s.t(prism(w, place(seg.orient, Math.min(c0, c1), Math.min(r0, r1), Math.max(c0, c1), Math.max(r0, r1), ix0, iy0), zFloor - 0.5, top)),
        );
      }
    }
  }
  return after.length ? { cut, add, after } : { cut, add };
}

/**
 * The material a ramp or steps add over a compartment, from `z0` (below its
 * cutters) up to the shaped floor rising from `base`. One plane (or one set of
 * steps) spans the compartment's bounds and is clipped to its rects grown by
 * `grow`, so the strips of an L-shaped compartment share one continuous floor.
 */
function floorShapeSolid(
  w: Wasm,
  s: Scope,
  f: FloorShapeSpec,
  c: Compartment,
  box: (rc: XY, grow: number) => XY,
  base: number,
  z0: number,
  grow: number,
): Manifold {
  const b = box(c.bounds, 0);
  const B = box(c.bounds, 1);
  let core: Manifold;
  if (f.kind === 'ramp') {
    const pts: Vec3[] = [];
    for (const [x, y] of [
      [B.x0, B.y0],
      [B.x1, B.y0],
      [B.x1, B.y1],
      [B.x0, B.y1],
    ]) {
      pts.push([x, y, z0], [x, y, base + floorShapeHeight(f, b, x, y)]);
    }
    core = s.t(w.Manifold.hull(pts));
  } else {
    // Nested boxes, each reaching from its step to the high side.
    const steps: Manifold[] = [];
    for (let k = 1; k < f.tiers; k++) {
      const t = k / f.tiers;
      const r = { ...B };
      if (f.high === 'back') r.y0 = b.y0 + t * (b.y1 - b.y0);
      else if (f.high === 'front') r.y1 = b.y1 - t * (b.y1 - b.y0);
      else if (f.high === 'right') r.x0 = b.x0 + t * (b.x1 - b.x0);
      else r.x1 = b.x1 - t * (b.x1 - b.x0);
      steps.push(s.t(prism(w, r, z0, base + (f.rise * k) / (f.tiers - 1))));
    }
    core = s.t(w.Manifold.union(steps));
  }
  const clip = s.t(w.Manifold.union(c.rects.map((rc) => s.t(prism(w, box(rc, grow), z0 - 1, base + f.rise + 1)))));
  return s.t(core.intersect(clip));
}

/** A straight run of a compartment's outline that is a wall face (cavity mm). */
interface OutlineEdge {
  /** 'h': along x at y = `at`; 'v': along y at x = `at`. */
  orient: 'h' | 'v';
  at: number;
  a: number;
  b: number;
  /** +1 when the compartment is on the + side of `at`. */
  side: 1 | -1;
}

/** Parts of [a, b] not covered by `cuts`. */
function intervalMinus(a: number, b: number, cuts: [number, number][], tol = 1e-6): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [p, q] of parts) {
      if (c1 <= p + tol || c0 >= q - tol) next.push([p, q]);
      else {
        if (c0 > p + tol) next.push([p, c0]);
        if (c1 < q - tol) next.push([c1, q]);
      }
    }
    parts = next;
  }
  return parts.filter(([p, q]) => q - p > tol);
}

/** Every wall face of a compartment's outline: rect sides less the parts shared with its other rects, collinear runs merged. */
export function outlineEdges(c: Pick<Compartment, 'rects'>): OutlineEdge[] {
  const tol = 1e-6;
  const raw: OutlineEdge[] = [];
  for (const R of c.rects) {
    const others = c.rects.filter((q) => q !== R);
    const span = (pick: (q: CompRect) => boolean, along: 'x' | 'y') =>
      others.filter(pick).map((q): [number, number] => (along === 'x' ? [q.x0, q.x1] : [q.y0, q.y1]));
    const sides: [OutlineEdge['orient'], number, number, number, 1 | -1, [number, number][]][] = [
      ['h', R.y0, R.x0, R.x1, 1, span((q) => Math.abs(q.y1 - R.y0) < tol, 'x')],
      ['h', R.y1, R.x0, R.x1, -1, span((q) => Math.abs(q.y0 - R.y1) < tol, 'x')],
      ['v', R.x0, R.y0, R.y1, 1, span((q) => Math.abs(q.x1 - R.x0) < tol, 'y')],
      ['v', R.x1, R.y0, R.y1, -1, span((q) => Math.abs(q.x0 - R.x1) < tol, 'y')],
    ];
    for (const [orient, at, a, b, side, cuts] of sides) for (const [p, q] of intervalMinus(a, b, cuts)) raw.push({ orient, at, a: p, b: q, side });
  }
  raw.sort((p, q) => (p.orient === q.orient ? 0 : p.orient < q.orient ? -1 : 1) || p.side - q.side || p.at - q.at || p.a - q.a);
  const out: OutlineEdge[] = [];
  for (const e of raw) {
    const last = out[out.length - 1];
    if (last && last.orient === e.orient && last.side === e.side && Math.abs(last.at - e.at) < tol && e.a <= last.b + tol) last.b = Math.max(last.b, e.b);
    else out.push({ ...e });
  }
  return out;
}

/** Points of an arc (degrees, inclusive) around (cx, cy). */
function arcPts(cx: number, cy: number, r: number, from: number, to: number, n = CORNER_SEGMENTS): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * Rounded bottom for an L/T/U-shaped compartment, as material to subtract from
 * its flat-bottomed strips: a concave fillet of radius `rf` along every wall of
 * the outline (none at the seams between strips), swept around the rounded
 * convex corners and blended around the reflex ones, which is what a ball
 * rolled along the walls leaves (the rectangular compartments' hull of corner
 * spheres). Built on the strips' grown faces (`eps` out), so it meets them flush.
 * It only ever leaves material inside this compartment.
 */
function outlineFillet(w: Wasm, s: Scope, c: Compartment, ix0: number, iy0: number, zf: number, rf: number, eps: number): Manifold[] {
  const G = 3 * eps; // reach into the wall, past the cutters' overlap
  const OVERLAP = 0.05; // mm a straight run reaches into a corner's arc
  const SPREAD = 3; // degrees a reflex blend reaches into the runs beside it
  const tol = 1e-6;
  const n = CORNER_SEGMENTS;
  // Profiles: x = distance in from the wall face (or radius), y = height above the floor.
  const straight: Vec2[] = [[-G, -0.5], [rf, -0.5], ...arcPts(rf, rf, rf, 270, 180, n), [-G, rf]];
  const reflex: Vec2[] = [[0, -0.5], [rf, -0.5], ...arcPts(rf, rf, rf, 270, 180, n)];
  const out: Manifold[] = [];

  // Convex corners (rounded in plan), with the angle their arc starts at (as roundedRectRing).
  const corners: { x: number; y: number; r: number; a0: number }[] = [];
  for (const R of c.rects) {
    const r = rectRadius(R);
    const at: [number, number, number][] = [
      [R.x0, R.y0, 180],
      [R.x1, R.y0, 270],
      [R.x1, R.y1, 0],
      [R.x0, R.y1, 90],
    ];
    R.convex.forEach((cv, k) => cv && corners.push({ x: at[k][0], y: at[k][1], r, a0: at[k][2] }));
  }
  for (const k of corners) {
    const R0 = k.r + eps;
    const prof: Vec2[] = [[R0 - rf, -0.5], [k.r + G, -0.5], [k.r + G, rf], ...arcPts(R0 - rf, rf, rf, 0, -90, n)];
    const cx = k.x + (k.a0 === 90 || k.a0 === 180 ? k.r : -k.r);
    const cy = k.y + (k.a0 === 180 || k.a0 === 270 ? k.r : -k.r);
    out.push(s.t(s.t(s.t(w.Manifold.revolve([prof], n, 90)).rotate([0, 0, k.a0])).translate([ix0 + cx, iy0 + cy, zf])));
  }
  // Which corner arc an edge end belongs to: [low end, high end] per orientation and side.
  const cornerOf: Record<string, [number, number]> = { 'h1': [180, 270], 'h-1': [90, 0], 'v1': [180, 90], 'v-1': [270, 0] };

  for (const e of outlineEdges(c)) {
    const ends = cornerOf[`${e.orient}${e.side}`];
    let s0 = e.a;
    let s1 = e.b;
    // Grown wall face (the strips overlap the wall by eps).
    const line = e.at - e.side * eps;
    for (const hi of [false, true]) {
      const v = hi ? e.b : e.a;
      const [px, py] = e.orient === 'h' ? [v, e.at] : [e.at, v];
      const k = corners.find((q) => q.a0 === ends[hi ? 1 : 0] && Math.abs(q.x - px) < tol && Math.abs(q.y - py) < tol);
      // Run a little into the corner's arc piece (all of it inside that piece's material) rather than
      // butting against it, so the two don't meet face to face.
      const trim = k ? Math.max(0, k.r - OVERLAP) : eps;
      if (hi) s1 -= trim;
      else s0 += trim;
      // A reflex corner: blend the two fillets meeting there (once, from the 'h' edge).
      if (!k && e.orient === 'h') {
        const dx = hi ? 1 : -1;
        const dy = e.side;
        const a0 = dx > 0 ? (dy > 0 ? 0 : 270) : dy > 0 ? 90 : 180;
        const vx = v - dx * eps;
        // A few degrees wider than the corner: the extra lies inside the two strips' material.
        const blend = s.t(w.Manifold.revolve([reflex], n, 90 + 2 * SPREAD));
        out.push(s.t(s.t(blend.rotate([0, 0, a0 - SPREAD])).translate([ix0 + vx, iy0 + line, zf])));
      }
    }
    if (s1 - s0 < 1e-4) continue;
    // Extrude the profile along the edge: local x → into the compartment, y → up, z → along the edge (a proper rotation).
    const [nx, ny] = e.orient === 'h' ? [0, e.side] : [e.side, 0];
    const [ex, ey] = [ny, -nx];
    const t0 = ex + ey > 0 ? s0 : s1;
    const [ox, oy] = e.orient === 'h' ? [t0, line] : [line, t0];
    const m = s.t(w.Manifold.extrude([straight], s1 - s0));
    out.push(s.t(m.transform([nx, ny, 0, 0, 0, 0, 1, 0, ex, ey, 0, 0, ix0 + ox, iy0 + oy, zf, 1])));
  }
  return out;
}

interface XY {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An axis-aligned box over a footprint. */
const prism = (w: Wasm, b: XY, z0: number, z1: number) => boxAt(w, b.x0, b.y0, z0, b.x1, b.y1, z1);

/** Footprint for a span across (c) × along (r) a wall, in bin coordinates. */
function place(orient: 'v' | 'h', c0: number, r0: number, c1: number, r1: number, ix0: number, iy0: number): XY {
  return orient === 'v'
    ? { x0: ix0 + c0, y0: iy0 + r0, x1: ix0 + c1, y1: iy0 + r1 }
    : { x0: ix0 + r0, y0: iy0 + c0, x1: ix0 + r1, y1: iy0 + c1 };
}

/** Two extrusion lines: the thinnest edge a rounded compartment bottom may end in against a slot. */
const SLOT_LEDGE = 0.8;

/**
 * A compartment's rounded bottom edge runs into a removable wall's slot and
 * would end there in a knife-edge horn up the slot's side. Where it is
 * thinner than SLOT_LEDGE it is cut back, leaving a flat ledge that wide:
 * boxes beside the slot along the cutter's straight side (its rounded
 * corners are left alone), from where the horn gets that thin to the top of
 * the rounding. None for cutters with square bottoms or not beside the slot.
 */
function slotHornTrims(w: Wasm, s: Scope, c: CutterSpec, seg: { orient: 'v' | 'h'; pos: number; a: number; b: number }, ix0: number, iy0: number): Manifold[] {
  if (!c.fillet || typeof c.radius !== 'number') return [];
  const rf = Math.min(c.radius, (c.topInfill - c.zFloor) / 2 - 0.05);
  if (rf <= 0.3) return [];
  // Distance of the rounded surface from the wall face at height h is rf − √(rf² − (rf − h)²); the ledge's edge is `d` out.
  const d = SLOT_CLEARANCE + SLOT_LEDGE;
  const h0 = rf > d ? rf - Math.sqrt(rf * rf - (rf - d) ** 2) : 0;
  const v = seg.orient === 'v';
  // The cutter in (across, along) cavity mm.
  const [c0, c1] = v ? [c.x0 - ix0, c.x1 - ix0] : [c.y0 - iy0, c.y1 - iy0];
  const [r0, r1] = v ? [c.y0 - iy0, c.y1 - iy0] : [c.x0 - ix0, c.x1 - ix0];
  const lo = Math.max(r0 + c.radius, seg.a);
  const hi = Math.min(r1 - c.radius, seg.b);
  if (hi - lo < 0.1) return [];
  const out: Manifold[] = [];
  for (const side of [-1, 1]) {
    const face = seg.pos + (side * DIVIDER) / 2;
    // The cutter starts at this face (grown a hair into the wall) on the slot's side.
    if (Math.abs((side > 0 ? c0 : c1) - face) > 0.05) continue;
    const [a, b] = side > 0 ? [face + SLOT_CLEARANCE - 0.01, face + d] : [face - d, face - SLOT_CLEARANCE + 0.01];
    out.push(s.t(prism(w, place(seg.orient, a, lo, b, hi, ix0, iy0), c.zFloor + h0, c.zFloor + rf + 0.01)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Removable divider plates
// ---------------------------------------------------------------------------

export interface DividerInsert extends InsertExtras {
  wallId: string;
  /** Segment along the wall (walls crossing a removable wall split it). */
  segment: number;
  /** Plate size (mm): along the wall × up × thickness. */
  length: number;
  height: number;
  thickness: number;
}

/** Plates for the removable walls of a resolved layout. */
export function insertsFor(r: ResolvedLayout, lip: boolean, zFloor: number, topInfill: number): DividerInsert[] {
  const innerH = topInfill - zFloor;
  const maxLower = Math.max(0, innerH - 2);
  return removableSegments(r, lip).map((seg) => ({
    wallId: seg.wallId,
    segment: seg.index,
    length: round(seg.b - seg.a - seg.gapA - seg.gapB),
    height: round(topInfill - Math.min(seg.lower, maxLower) - (zFloor - SLOT_DEPTH)),
    thickness: DIVIDER,
    ...insertExtras(r.byId.get(seg.wallId)),
  }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Bevel on the plate's bottom corners so it finds the slot. */
const INSERT_BEVEL = 0.8;

/**
 * A divider plate lying flat for printing: length along X, height along Y,
 * thickness along Z; min corner at the origin, bottom at z = 0. The edge that
 * goes into the floor groove is y = 0 (its corners are beveled).
 */
export function buildDividerInsert(w: Wasm, ins: Pick<DividerInsert, 'length' | 'height' | 'thickness' | 'notch' | 'top'>): MeshData {
  const s = new Scope();
  try {
    const L = ins.length;
    const H = ins.height;
    const c = Math.min(INSERT_BEVEL, L / 4, H / 4);
    const outline: [number, number][] = [
      [c, 0],
      [L - c, 0],
      [L, c],
      [L, H],
      [0, H],
      [0, c],
    ];
    const m = shapeInsert(w, s, ins, outline);
    assertValid(m, 'divider insert');
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}

/** Mesh key for a plate, so identical plates share one mesh. */
export function insertKey(ins: Pick<DividerInsert, 'length' | 'height' | 'thickness' | 'notch' | 'top'>) {
  return `insert|${ins.length}x${ins.height}x${ins.thickness}${insertExtrasKey(ins)}`;
}

