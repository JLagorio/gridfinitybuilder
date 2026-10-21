/**
 * Bin accessories: lift-out trays, a sliding lid and adjustable divider rails.
 *
 * - Lift-out trays: a ledge around the inside of the bin holds a thin-walled
 *   open box near the top, sized to pass through the stacking lip's opening.
 *   With several trays each rests on its own ledge, one tray height lower; the
 *   lower ones are smaller so they pass the ledges above them. The bin's
 *   compartments stop just under the lowest tray.
 * - Sliding lid (bins without a stacking lip): the walls are thickened inward
 *   near the top (a band with a 45° underside) and grooved on the left, right
 *   and back; the front wall is cut down so a chamfered plate slides in, and a
 *   bump on the front sill clicks into the lid's underside when it is closed.
 * - Divider rails: pairs of guide ribs on opposite walls at every pitch plus a
 *   floor groove, so loose plates slide in anywhere. Rails both ways make an
 *   egg-crate: plates one way are slotted from the top, the other from below.
 *
 * Options, sanitizing, mesh-key parts and the pure planning (sizes, heights and
 * positions) live here; geometry is in trays.ts, slidingLid.ts and rails.ts.
 * Every default leaves the bin exactly as it was (same mesh, same key).
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, DIVIDER, GRID, LIP_DEPTH, LIP_PROFILE, LIP_SUPPORT_HEIGHT, WALL } from './spec';
import { extrudePolygon, loftRings, roundedRectRing } from './shapes';
import { binBodyHeight, binFloorZ, type BaseStyle, type HeightMode, type InteriorMode, type LipStyle } from './variants';
import { labelLines, sanitizeLabelText } from './labels';
import {
  INSERT_END_CLEARANCE,
  RIB_ENGAGE,
  SLOT_CLEARANCE,
  SLOT_DEPTH,
  T as DIVIDER_T,
  resolveLayout,
  uniformLayout,
  type DividerLayout,
} from '../dividers';
import type { JobPart, PrintJob } from '../project';

/** '' = none; 'x' = plates at positions along X (they run front to back); 'y' = along Y; 'xy' = both. */
export type RailMode = '' | 'x' | 'y' | 'xy';
export const RAIL_MODES: readonly RailMode[] = ['', 'x', 'y', 'xy'];

export interface BinAccessoryOptions {
  /** Lift-out tray(s) resting on a ledge near the top. Compartment interiors only. */
  tray: boolean;
  /** Outer height of each tray, mm. Shortened to fit a bin that is too short. */
  trayHeight: number;
  /** Trays one under another (1–3), each on its own ledge; lower ones are a little smaller. */
  trayCount: number;
  /** Compartments in each tray. */
  trayDivX: number;
  trayDivY: number;
  /** Sliding lid in grooves at the top of the left, right and back walls. Needs the stacking lip off. */
  slideLid: boolean;
  /** Text engraved on the sliding lid ("\n" starts a new line). */
  slideLidText: string;
  /** Guide rails for loose divider plates. Compartment interiors only. */
  rails: RailMode;
  /** Distance between rails, mm (rails are centered on the middle of the bin). */
  railPitch: number;
  /** Loose plates printed per rail direction. */
  railPlates: number;
}

export const DEFAULT_ACCESSORIES: BinAccessoryOptions = {
  tray: false,
  trayHeight: 15,
  trayCount: 1,
  trayDivX: 2,
  trayDivY: 1,
  slideLid: false,
  slideLidText: '',
  rails: '',
  railPitch: GRID / 4,
  railPlates: 2,
};

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const TRAY = {
  /** Wall and floor thickness. */
  wall: 1.2,
  floor: 1.2,
  /** Gap per side between a tray and whatever it passes (lip, sliding-lid band, ledges above). */
  clearance: 0.25,
  /** How far each ledge reaches in under its tray's edge. */
  bearing: 1.6,
  minHeight: 5,
  maxHeight: 100,
  maxCount: 3,
  maxDiv: 8,
  /** Air between the lowest tray and the compartments under it. */
  gap: 0.8,
  /** Depth kept under the lowest tray (the gap plus shallow compartments). */
  below: 4,
  /** Air between a tray and a sliding lid over it. */
  headroom: 0.3,
  /** Smallest outer corner radius (the inner one is this minus the wall). */
  minRadius: 2,
  /** Elephant-foot chamfer on the bottom edge. */
  footChamfer: 0.4,
  /** Smallest tray footprint, and smallest compartment in it. */
  minSize: 15,
  minComp: 4,
  /** Lift tabs at the left and right ends: width along the wall, reach inward, tip thickness. */
  tabWidth: 14,
  tabReach: 5,
  tabTip: 1.2,
} as const;

export const SLIDE = {
  /** Lid plate thickness. */
  thickness: 2.4,
  /** Groove depth into the band. The lid's edge is chamfered 45° to match. */
  groove: 1.5,
  /** Wall thickening inward: the groove plus 0.8 mm behind it. */
  band: 2.3,
  /** Wall left above the groove. */
  keeper: 1,
  /** Vertical play in the groove. */
  play: 0.3,
  /** Gap between the lid's edge and the bottom of the groove. */
  side: 0.25,
  /** Band material under the groove floor at the band's face. */
  under: 0.8,
  /** Compartments stop this far below the lid (pocket grids: below the band). */
  drop: 1,
  /** Detent bump on the front sill: height, half its base (front to back), length along X. */
  bump: 0.5,
  bumpRun: 1,
  bumpLength: 12,
  /** Clearance around the bump in the lid's pocket and channel; the tooth between them. */
  bumpPlay: 0.3,
  tooth: 1.5,
  channel: 0.7,
  /** Grip ridges across the lid near the front edge. */
  ridges: 3,
  ridgeHeight: 0.6,
  ridgePitch: 2.5,
  /** Engraved text depth. */
  textDepth: 0.6,
  /** Shallowest compartments left under the lid. */
  minDepth: 2,
  /** Front corners of the lid follow the bin's outline. */
  frontRadius: BASE_TOP_RADIUS,
  backRadius: 0.5,
} as const;

export const RAIL = {
  /** Rails stay at least this far from the walls they run toward. */
  edge: 5,
  /** A rail this close to a fixed divider parallel to it is left out. */
  keepOff: 2.7,
  minPitch: 5,
  maxPitch: 100,
  maxPlates: 20,
  /** Egg-crate slots: extra width and depth. */
  slotPlay: 0.2,
  /** Ribs either side of each slot (same as removable dividers). */
  rib: 0.8,
} as const;

/**
 * The infill block never stops below this: in a flat bin its outer edge is the
 * wall up to where the bin's outer shell starts (0.75 mm above the base profile).
 */
export const MIN_INTERIOR_TOP = BASE_PROFILE_HEIGHT + 0.75 + 0.5;

/** Slot between a rail's ribs: a plate plus clearance. */
export const RAIL_SLOT = DIVIDER_T + 2 * SLOT_CLEARANCE;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Clamp every accessory field; unknown values fall back to the defaults. */
export function sanitizeAccessoryOptions(o: Partial<BinAccessoryOptions>): BinAccessoryOptions {
  const d = DEFAULT_ACCESSORIES;
  return {
    tray: !!o.tray,
    trayHeight: r2(num(o.trayHeight, TRAY.minHeight, TRAY.maxHeight, d.trayHeight)),
    trayCount: int(o.trayCount, 1, TRAY.maxCount, d.trayCount),
    trayDivX: int(o.trayDivX, 1, TRAY.maxDiv, d.trayDivX),
    trayDivY: int(o.trayDivY, 1, TRAY.maxDiv, d.trayDivY),
    slideLid: !!o.slideLid,
    slideLidText: sanitizeLabelText(o.slideLidText),
    rails: RAIL_MODES.includes(o.rails as RailMode) ? (o.rails as RailMode) : d.rails,
    railPitch: r2(num(o.railPitch, RAIL.minPitch, RAIL.maxPitch, d.railPitch)),
    railPlates: int(o.railPlates, 0, RAIL.maxPlates, d.railPlates),
  };
}

/** What the planning needs from a bin's options. */
export type AccessoryOpts = Partial<BinAccessoryOptions> & {
  unitsX: number;
  unitsY: number;
  heightUnits: number;
  lip: boolean;
  lipStyle?: LipStyle;
  lipNotches?: boolean;
  heightMode?: HeightMode;
  heightMm?: number;
  base?: BaseStyle;
  interior?: InteriorMode;
  divX: number;
  divY: number;
  layout?: DividerLayout | null;
};

const compartments = (o: AccessoryOpts) => (o.interior ?? 'compartments') === 'compartments';

/** The tray applies (it may still not fit: see `planAccessories`). */
export const wantsTray = (o: AccessoryOpts) => !!o.tray && compartments(o);
/** The sliding lid applies: no stacking lip, and compartments or a pocket grid inside. */
export const wantsSlideLid = (o: AccessoryOpts) => !!o.slideLid && !o.lip && (compartments(o) || o.interior === 'pockets');
/** Rails apply. */
export const wantsRails = (o: AccessoryOpts) => !!o.rails && compartments(o);

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

/**
 * Narrowest opening above the cavity, as an inset from the bin's outline: the
 * stacking lip's inner edge (with anti-slide notches, the cusps at the cell
 * lines reach in a corner radius), or the inside of the wall without a lip.
 */
export function lipOpeningInset(o: Pick<AccessoryOpts, 'lip' | 'lipStyle' | 'lipNotches' | 'unitsX' | 'unitsY'>): number {
  if (!o.lip) return WALL;
  let inset = o.lipStyle === 'reduced' ? LIP_PROFILE.chamfer2 : LIP_DEPTH;
  if (o.lipNotches && (o.unitsX > 1 || o.unitsY > 1)) inset = Math.max(inset, BASE_TOP_RADIUS);
  return inset;
}

export interface SlidePlan {
  /** Groove floor = bottom of the lid. */
  zG: number;
  /** Top of the compartments under the lid. */
  interiorTop: number;
  /** Inset of the band's inner face from the bin's outline. */
  bandFace: number;
}

export interface TrayLevel {
  /** Top of this tray's ledge = bottom of the tray. */
  z: number;
  /** Tray outline's inset from the bin's outline. */
  inset: number;
  /** How far the ledge reaches in (inset from the bin's outline). */
  ledge: number;
  /** Tray footprint. */
  w: number;
  d: number;
}

export interface TrayPlan {
  /** Height of each tray. */
  h: number;
  /** Top of the topmost tray. */
  top: number;
  /** Top tray first. */
  levels: TrayLevel[];
  /** The asked height (or count) didn't fit. */
  shortened: boolean;
  /** Top of the compartments under the trays. */
  interiorTop: number;
}

export interface RailPlan {
  /** Rail centerlines, bin-centered mm: `xs` for plates running front to back, `ys` for plates running left to right. */
  xs: number[];
  ys: number[];
  /** Positions left out because a fixed divider is there. */
  skipped: number;
  /** Fixed dividers crossed by the plates' paths (slots are cut through them). */
  crossed: number;
  /** Gap between a plate's end and the wall; ribs reach this far plus RIB_ENGAGE. */
  endGap: number;
  ribDepth: number;
  /** Floor groove depth (none in a flat bin's thin floor). */
  groove: number;
  /** Plates stand from z0 (groove bottom) to z1 (top of the compartments). */
  z0: number;
  z1: number;
}

export interface AccessoryPlan {
  H: number;
  zFloor: number;
  /** Infill top without accessories. */
  infillTop: number;
  /** Top of the compartments with them (≤ infillTop). */
  interiorTop: number;
  slide: SlidePlan | null;
  tray: TrayPlan | null;
  rails: RailPlan | null;
  /** Why something that is on doesn't apply (for hints and print warnings). */
  notes: string[];
}

function slidePlan(o: AccessoryOpts, H: number, zFloor: number): SlidePlan | null {
  if (!wantsSlideLid(o)) return null;
  const S = SLIDE;
  const zG = H - S.keeper - S.play - S.thickness;
  const interiorTop = o.interior === 'pockets' ? zG - S.under - S.band - 0.3 : zG - S.drop;
  if (interiorTop - zFloor < S.minDepth || interiorTop < MIN_INTERIOR_TOP) return null;
  return { zG, interiorTop, bandFace: WALL + S.band };
}

function trayPlan(o: AccessoryOpts, W: number, D: number, infillTop: number, zFloor: number, slide: SlidePlan | null): TrayPlan | null {
  if (!wantsTray(o)) return null;
  const T = TRAY;
  const top = slide ? slide.zG - T.headroom : infillTop;
  const open = Math.max(lipOpeningInset(o), slide ? slide.bandFace : 0);
  const asked = Math.min(T.maxCount, Math.max(1, Math.round(o.trayCount ?? 1)));
  const want = num(o.trayHeight, T.minHeight, T.maxHeight, DEFAULT_ACCESSORIES.trayHeight);
  // Levels whose tray is big enough, top first.
  const levels: TrayLevel[] = [];
  for (let k = 0; k < asked; k++) {
    const inset = open + T.clearance + k * (T.bearing + T.clearance);
    const tw = W - 2 * inset;
    const td = D - 2 * inset;
    if (Math.min(tw, td) < T.minSize) break;
    levels.push({ z: 0, inset, ledge: inset + T.bearing, w: r3(tw), d: r3(td) });
  }
  if (!levels.length) return null;
  const room = top - Math.max(zFloor + T.below, MIN_INTERIOR_TOP + T.gap);
  let n = levels.length;
  // Fewer levels when the bin can't hold them all at the minimum height.
  while (n > 1 && room / n < T.minHeight) n--;
  const h = r3(Math.min(want, room / n));
  if (!(h >= T.minHeight - 1e-9)) return null;
  levels.length = n;
  levels.forEach((l, k) => (l.z = top - (k + 1) * h));
  return { h, top, levels, shortened: h < want - 1e-6 || n < asked, interiorTop: levels[n - 1].z - T.gap };
}

/** Rails centered on the middle of a span, at least `edge` from its ends, away from fixed dividers. */
function railPositions(span: number, pitch: number, walls: number[], edge: number): { at: number[]; skipped: number } {
  const lim = span / 2 - edge;
  const at: number[] = [];
  let skipped = 0;
  if (lim < 0) return { at, skipped };
  const k0 = Math.floor(lim / pitch + 1e-9);
  for (let k = -k0; k <= k0; k++) {
    const p = r3(k * pitch);
    if (walls.some((x) => Math.abs(x - p) < RAIL.keepOff)) skipped++;
    else at.push(p);
  }
  return { at, skipped };
}

function railPlan(o: AccessoryOpts, W: number, D: number, zFloor: number, interiorTop: number, reach: number): RailPlan | null {
  if (!wantsRails(o)) return null;
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  const r = resolveLayout(o.layout ?? uniformLayout(o.divX, o.divY), innerW, innerD);
  const pitch = num(o.railPitch, RAIL.minPitch, RAIL.maxPitch, DEFAULT_ACCESSORIES.railPitch);
  const mode = o.rails ?? '';
  const endGap = r3(reach + INSERT_END_CLEARANCE);
  const ribDepth = r3(endGap + RIB_ENGAGE);
  // Plates pass the ledges and bands along the walls beside them too; both ways, rails stay clear of the other way's ribs.
  const edge = Math.max(RAIL.edge, endGap + RAIL_SLOT / 2, mode === 'xy' ? ribDepth + RAIL_SLOT / 2 + RAIL.rib : 0);
  // Wall centerlines in bin-centered mm.
  const vx = r.walls.filter((w) => w.orient === 'v').map((w) => w.pos - innerW / 2);
  const hy = r.walls.filter((w) => w.orient === 'h').map((w) => w.pos - innerD / 2);
  const X = mode.includes('x') ? railPositions(innerW, pitch, vx, edge) : { at: [], skipped: 0 };
  const Y = mode.includes('y') ? railPositions(innerD, pitch, hy, edge) : { at: [], skipped: 0 };
  if (!X.at.length && !Y.at.length) return null;
  // Walls a plate path runs through.
  const crossed = r.walls.filter((w) => {
    const rails = w.orient === 'h' ? X.at.map((x) => x + innerW / 2) : Y.at.map((y) => y + innerD / 2);
    return rails.some((p) => p > w.start + DIVIDER / 2 && p < w.end - DIVIDER / 2);
  }).length;
  const groove = o.base === 'flat' ? 0 : SLOT_DEPTH;
  return {
    xs: X.at,
    ys: Y.at,
    skipped: X.skipped + Y.skipped,
    crossed,
    endGap,
    ribDepth,
    groove,
    z0: zFloor - groove,
    z1: interiorTop,
  };
}

/** Everything about a bin's accessories that isn't geometry. W × D is the bin's outer size. */
export function planAccessories(o: AccessoryOpts, W: number, D: number): AccessoryPlan {
  const H = binBodyHeight(o);
  const zFloor = binFloorZ(o);
  const infillTop = o.lip ? H - LIP_SUPPORT_HEIGHT : H;
  const notes: string[] = [];
  const slide = slidePlan(o, H, zFloor);
  if (o.slideLid && !slide) {
    if (o.lip) notes.push('The sliding lid needs the stacking lip off.');
    else if (!compartments(o) && o.interior !== 'pockets') notes.push('The sliding lid works with compartments or a pocket grid.');
    else notes.push('The bin is too short for a sliding lid.');
  }
  const tray = trayPlan(o, W, D, infillTop, zFloor, slide);
  if (o.tray && !compartments(o)) notes.push('Trays need a Compartments interior.');
  else if (o.tray && !tray) notes.push('The bin is too short (or too small) for a tray.');
  else if (tray?.shortened) {
    const n = tray.levels.length;
    notes.push(`Only room for ${n === 1 ? 'one tray' : `${n} trays`} ${r2(tray.h)} mm tall.`);
  }
  let interiorTop = infillTop;
  if (slide) interiorTop = Math.min(interiorTop, slide.interiorTop);
  if (tray) interiorTop = Math.min(interiorTop, tray.interiorTop);
  // How far things above the plates reach in from the wall: plates must pass them.
  const reach = Math.max(
    lipOpeningInset(o) - WALL,
    slide ? slide.bandFace - WALL : 0,
    tray ? tray.levels[tray.levels.length - 1].ledge - WALL : 0,
  );
  const rails = railPlan(o, W, D, zFloor, interiorTop, reach);
  if (o.rails && !compartments(o)) notes.push('Rails need a Compartments interior.');
  else if (o.rails && !rails) notes.push('No room for rails at this pitch.');
  return { H, zFloor, infillTop, interiorTop, slide, tray, rails, notes };
}

/** Top of the compartments (the infill block) once trays or a sliding lid take the top of the bin. */
export function accessoryInfillTop(o: AccessoryOpts, W: number, D: number, top: number): number {
  if (!wantsTray(o) && !wantsSlideLid(o)) return top;
  return Math.min(top, planAccessories(o, W, D).interiorTop);
}

/** Rail plates stand in a floor groove, so a hollow (lite / efficient) base keeps its full floor. */
export function accessoryNeedsFloor(o: AccessoryOpts): boolean {
  return wantsRails(o);
}

/** Mesh-key parts; empty unless an accessory changes the bin, so other bins keep their keys. */
export function accessoryKeyParts(o: AccessoryOpts, size: { w: number; d: number }): string[] {
  if (!wantsTray(o) && !wantsSlideLid(o) && !wantsRails(o)) return [];
  const p = planAccessories(o, size.w, size.d);
  const out: string[] = [];
  if (p.tray) out.push(`At${p.tray.h}n${p.tray.levels.length}`);
  if (p.slide) out.push('As');
  if (p.rails) out.push(`Ar${o.rails}${r2(num(o.railPitch, RAIL.minPitch, RAIL.maxPitch, DEFAULT_ACCESSORIES.railPitch))}`);
  return out;
}

// ---------------------------------------------------------------------------
// Printed parts
// ---------------------------------------------------------------------------

export interface TrayPart {
  type: 'tray';
  /** Outer footprint and height. */
  w: number;
  d: number;
  h: number;
  /** Outer corner radius. */
  radius: number;
  divX: number;
  divY: number;
}

export interface SlideLidPart {
  type: 'slideLid';
  /** The bin's outer size (the lid is derived from it). */
  W: number;
  D: number;
  text: string;
}

export interface RailPlatePart {
  type: 'railPlate';
  /** Along the plate × up × thickness, as for removable dividers. */
  length: number;
  height: number;
  thickness: number;
  /** Egg-crate slots: centers along the plate, from the top or from the bottom edge. */
  slots: number[];
  slotsFrom: 'top' | 'bottom' | null;
  slotWidth: number;
  slotDepth: number;
}

export type AccessoryPart = TrayPart | SlideLidPart | RailPlatePart;

/** The lid's outline in bin-centered mm (closed), and the width of its edge chamfer. */
export function slideLidBox(W: number, D: number) {
  const S = SLIDE;
  const face = WALL + S.band;
  const e = S.groove - S.side; // how far the edge reaches into the groove
  return { x0: -(W / 2 - face + e), x1: W / 2 - face + e, y0: -D / 2, y1: D / 2 - face + e, chamfer: e };
}

/** Height of a sliding lid including its grip ridges. */
export const SLIDE_LID_HEIGHT = SLIDE.thickness + SLIDE.ridgeHeight;

export function accessoryPartKey(p: AccessoryPart): string {
  if (p.type === 'tray') return `tray|${JSON.stringify([p.w, p.d, p.h, p.radius, p.divX, p.divY])}`;
  if (p.type === 'slideLid') return `slidelid|${JSON.stringify([r3(p.W), r3(p.D), labelLines(p.text)])}`;
  return `railplate|${JSON.stringify([p.length, p.height, p.thickness, p.slotsFrom, p.slots, p.slotWidth, p.slotDepth])}`;
}

export interface AccessoryPartPlan {
  /** Part key is `<slot>:<bin id>:<index>`. */
  slot: 'tray' | 'slidelid' | 'rail';
  index: string;
  kind: 'tray' | 'lid' | 'divider';
  name: string;
  meshKey: string;
  part: AccessoryPart;
  /** Printed footprint and height. */
  w: number;
  d: number;
  h: number;
  /** Where the part sits in the bin: its min corner from the bin's min corner and bottom (loose plates: none). */
  assembled?: { x: number; y: number; z: number };
}

const fmt1 = (v: number) => String(Math.round(v * 10) / 10);

/** Uniform compartments that fit a tray of this inner size. */
function trayDivs(n: number | undefined, inner: number) {
  const max = Math.max(1, Math.floor((inner + DIVIDER) / (TRAY.minComp + DIVIDER)));
  return Math.max(1, Math.min(max, Math.round(n ?? 1)));
}

/** The printed parts a bin's accessories need (sanitized options; W × D is the bin's outer size). */
export function accessoryParts(o: AccessoryOpts, W: number, D: number): AccessoryPartPlan[] {
  if (!wantsTray(o) && !wantsSlideLid(o) && !wantsRails(o)) return [];
  const p = planAccessories(o, W, D);
  const out: AccessoryPartPlan[] = [];
  if (p.tray) {
    const many = p.tray.levels.length > 1;
    p.tray.levels.forEach((l, k) => {
      const part: TrayPart = {
        type: 'tray',
        w: l.w,
        d: l.d,
        h: p.tray!.h,
        radius: r3(Math.max(TRAY.minRadius, BASE_TOP_RADIUS - l.inset)),
        divX: trayDivs(o.trayDivX, l.w - 2 * TRAY.wall),
        divY: trayDivs(o.trayDivY, l.d - 2 * TRAY.wall),
      };
      const comps = part.divX * part.divY;
      out.push({
        slot: 'tray',
        index: String(k),
        kind: 'tray',
        name: `${many ? `Tray ${k + 1} (${k ? 'lower' : 'top'})` : 'Tray'} ${fmt1(l.w)} × ${fmt1(l.d)} × ${fmt1(part.h)} mm${comps > 1 ? `, ${part.divX}×${part.divY}` : ''}`,
        meshKey: accessoryPartKey(part),
        part,
        w: l.w,
        d: l.d,
        h: part.h,
        assembled: { x: r3(l.inset), y: r3(l.inset), z: r3(l.z) },
      });
    });
  }
  if (p.slide) {
    const b = slideLidBox(W, D);
    const part: SlideLidPart = { type: 'slideLid', W: r3(W), D: r3(D), text: o.slideLidText ?? '' };
    const text = labelLines(part.text);
    out.push({
      slot: 'slidelid',
      index: '0',
      kind: 'lid',
      name: `Sliding lid${text ? ` “${text.replace(/\n/g, ' ')}”` : ''}`,
      meshKey: accessoryPartKey(part),
      part,
      w: r3(b.x1 - b.x0),
      d: r3(b.y1 - b.y0),
      h: SLIDE_LID_HEIGHT,
      assembled: { x: r3(b.x0 + W / 2), y: 0, z: r3(p.slide.zG) },
    });
  }
  const R = p.rails;
  const plates = Math.round(o.railPlates ?? 0);
  if (R && plates > 0) {
    const innerW = W - 2 * WALL;
    const innerD = D - 2 * WALL;
    const height = r3(R.z1 - R.z0);
    const both = R.xs.length > 0 && R.ys.length > 0;
    const slotDepth = r3(height / 2 + RAIL.slotPlay);
    const slotWidth = r3(DIVIDER_T + 2 * RAIL.slotPlay);
    const dirs = [
      // Plates in X rails run front to back: slotted from the top where Y plates cross.
      { dir: 'x', on: R.xs.length > 0, length: innerD - 2 * R.endGap, from: 'top' as const, start: -innerD / 2 + R.endGap, cross: R.ys },
      { dir: 'y', on: R.ys.length > 0, length: innerW - 2 * R.endGap, from: 'bottom' as const, start: -innerW / 2 + R.endGap, cross: R.xs },
    ];
    for (const d of dirs) {
      if (!d.on || d.length < 5) continue;
      const part: RailPlatePart = {
        type: 'railPlate',
        length: r3(d.length),
        height,
        thickness: DIVIDER_T,
        slots: both ? d.cross.map((c) => r3(c - d.start)) : [],
        slotsFrom: both ? d.from : null,
        slotWidth: both ? slotWidth : 0,
        slotDepth: both ? slotDepth : 0,
      };
      const meshKey = accessoryPartKey(part);
      const name = `Rail plate ${fmt1(part.length)} × ${fmt1(height)} mm${both ? ` (slotted ${d.from === 'top' ? 'top' : 'bottom'})` : ''}`;
      for (let i = 0; i < plates; i++) {
        out.push({ slot: 'rail', index: `${d.dir}${i}`, kind: 'divider', name, meshKey, part, w: part.length, d: height, h: part.thickness });
      }
    }
  }
  return out;
}

/** Trays and sliding lid of a bin in a planned job, with where they sit in it (for the 3D view). */
export function assembledParts(job: PrintJob, binId: string, prefix = ''): (JobPart & { assembled: { x: number; y: number; z: number } })[] {
  const out: (JobPart & { assembled: { x: number; y: number; z: number } })[] = [];
  for (const key of [`slidelid:${binId}:0`, ...Array.from({ length: TRAY.maxCount }, (_, k) => `tray:${binId}:${k}`)]) {
    const part = job.parts[prefix + key];
    if (part?.assembled) out.push(part as JobPart & { assembled: { x: number; y: number; z: number } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

/** The bin's outline inset by `inset` (bin-centered), corner radius following it down to `rMin`. */
export function insetRing(W: number, D: number, inset: number, rMin = 0.5) {
  return roundedRectRing(-W / 2 + inset, -D / 2 + inset, W / 2 - inset, D / 2 - inset, Math.max(rMin, BASE_TOP_RADIUS - inset));
}

/**
 * A shelf all around the inside of the outer wall: from the wall's inner face
 * in to `reach` (inset from the bin's outline), top at `zTop`, with a 45°
 * underside that meets the shelf's inner face at `zFace` (≤ zTop). Nothing
 * below `zMin`. Prints without support.
 */
export function wallShelf(w: Wasm, s: Scope, W: number, D: number, zFace: number, zTop: number, reach: number, zMin: number): Manifold {
  const depth = reach - WALL;
  const zb = Math.max(zMin, zFace - depth - 0.2);
  const outer = s.t(extrudePolygon(w, insetRing(W, D, WALL - 0.05), zb, zTop));
  const inner = s.t(
    loftRings(w, [insetRing(W, D, WALL - 1), insetRing(W, D, reach), insetRing(W, D, reach)], [zFace - depth - 1, zFace, zTop + 1]),
  );
  return s.t(outer.subtract(inner));
}
