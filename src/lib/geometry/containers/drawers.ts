/**
 * Drawer unit (container kind 'drawers'): a small chest of drawers that stands
 * on the grid, after the popular Gridfinity "mini chest of drawers" designs.
 *
 * Chest — the main body, printed upright on its feet: an open-front box on a
 * Gridfinity base (containerBase), split into bays by shelves (one per row)
 * and upright walls (one per extra column). Every bay ceiling is a flat bridge
 * across the bay's width, held by the walls on both sides and at the back, so
 * it prints without supports while bays stay under ~60 mm wide (more columns
 * keep them narrow; the notes warn past that). The outer bays have rounded
 * back corners so the shell keeps its thickness at the rounded outer corners.
 * Top: flat; a bin's stacking lip (bins stack on it as on a bin); or a
 * Gridfinity receptacle per cell, like a stacking lid, so bins lock in place.
 *
 * Drawers — separate parts, printed upright with the open side up: a box with
 * a thicker front, rounded corners, an elephant-foot chamfer, optional uniform
 * compartments, a pull and an optional label. Pulls never leave the footprint:
 * fronts sit back by the pull's reach, framed by the chest's sides and
 * shelves. Pulls: a finger notch cut down from the top of the front; a tab
 * with a 45° underside; a round knob with a teardrop (45°) underside; or a
 * recessed grip whose ceiling rises at 45°. Stops: a low ridge on each bay
 * wall near the front and one on each drawer side near the back; together
 * they reach a little past the side clearance, so a pulled drawer clicks
 * against them about two thirds of the way out instead of falling out, and a
 * firm pull flexes it past.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from '../kernel';
import { BASE_HEIGHT, BASE_PROFILE_HEIGHT, BASE_TOP, BASE_TOP_RADIUS, GRID, HEIGHT_UNIT, LIP_DEPTH, LIP_HEIGHT, LIP_PROFILE, LIP_TOP_FLAT } from '../spec';
import { boxAt, extrudePolygon, hullOf, loftRoundedRect, roundedRectRing, type LoftKnot } from '../shapes';
import { binCells, binHoleSites, binSize, type BinCells, type BinOptions } from '../bin';
import { holeCutters } from '../holes';
import { cellRects } from '../variants';
import { stretchOffset } from '../placement';
import { hasFont, textOutline, textSolid } from '../text';
import { labelLines, sanitizeLabelText } from '../labels';
import { containerBase } from './base';
import { registerContainer, type ContainerPart } from './registry';

export type DrawerPull = 'notch' | 'tab' | 'knob' | 'grip';
export type DrawerTop = 'flat' | 'lip' | 'grid';
export type DrawerLabelStyle = 'raised' | 'engraved';

export const DRAWER_PULLS: readonly DrawerPull[] = ['notch', 'tab', 'knob', 'grip'];
export const DRAWER_TOPS: readonly DrawerTop[] = ['flat', 'lip', 'grid'];
export const DRAWER_LABEL_STYLES: readonly DrawerLabelStyle[] = ['raised', 'engraved'];

export interface DrawerUnitOptions {
  /** Drawers stacked in each column. */
  rows: number;
  /** Columns of drawers side by side. */
  cols: number;
  /** Relative height of each row, top row first (1 = one share). Entries past `rows` are kept, so fewer rows and back loses nothing. */
  rowSizes: number[];
  /** Chest walls, shelves and roof, mm. */
  shell: number;
  /** Drawer walls and floor, mm (the front is thicker). */
  drawerWall: number;
  /** Gap between a drawer and its bay on each side and above, mm. */
  clearance: number;
  pull: DrawerPull;
  /** Detent ridges so drawers don't fall out. */
  stops: boolean;
  /** Uniform compartments inside each drawer. */
  divX: number;
  divY: number;
  /** Text on the drawer fronts. */
  labels: boolean;
  labelStyle: DrawerLabelStyle;
  /** Per drawer, numbered across each row from the top left ("\n" starts a new line). Kept for drawers that are switched off. */
  labelTexts: string[];
  top: DrawerTop;
}

export const DRAWER_UNIT = {
  maxRows: 8,
  maxCols: 4,
  maxRowSize: 4,
  maxDiv: 6,
  maxLabels: 32,
  shell: { min: 1.2, max: 4 },
  drawerWall: { min: 0.8, max: 3 },
  clearance: { min: 0.15, max: 1.5 },
  /** The drawer front is this much thicker than its walls (room to engrave, a firm pull). */
  frontExtra: 0.8,
  /** Elephant-foot chamfer on the drawer's bottom edge. */
  footChamfer: 0.4,
  /** Radius of the chest's front corners (the back ones match a bin's). */
  frontCorner: 1,
  /** Bridges longer than this tend to sag. */
  bridgeMax: 60,
  /** Smallest drawer inside that is still built, mm. */
  minInside: { w: 6, d: 6, h: 4 },
  /** Drawers shallower than this inside get a note. */
  shallow: 12,
  /** Lip top: the roof sits this far under the top of the walls, clear of a stacked bin's feet (0.35 mm down). */
  lipRoofDrop: 1,
  divider: 1.2,
  /** Compartment walls stop this far under the drawer's rim. */
  dividerDrop: 1,
  /** Pulls: how far each reaches out of the front (the fronts sit back this far). */
  reach: { notch: 0, tab: 5, knob: 6, grip: 0 } as Record<DrawerPull, number>,
  tab: { thick: 2, radius: 2, share: 0.5, minW: 14, maxW: 40 },
  knob: { share: 0.18, minR: 3, maxR: 6 },
  notch: { share: 0.35, minW: 12, maxW: 24, depthShare: 0.45, minDepth: 6, maxDepth: 14, behind: 6 },
  grip: { share: 0.5, minW: 14, maxW: 40, depth: 4, heightShare: 0.3, minH: 3, maxH: 9, back: 1.2 },
  label: { raise: 0.6, depth: 0.6, margin: 1.2, side: 3, maxCap: 8, minCap: 2 },
  /** Stop ridges: the two ridges reach this much past the clearance together (half the clearance, within these). */
  stop: { minOverlap: 0.1, maxOverlap: 0.3 },
} as const;

/** How far a stacking lip rises above the walls. */
const LIP_RISE = LIP_HEIGHT - LIP_TOP_FLAT;

export const DEFAULT_DRAWER_UNIT: DrawerUnitOptions = {
  rows: 3,
  cols: 1,
  rowSizes: [1, 1, 1],
  shell: 1.6,
  drawerWall: 1.2,
  clearance: 0.4,
  pull: 'notch',
  stops: true,
  divX: 1,
  divY: 1,
  labels: false,
  labelStyle: 'raised',
  labelTexts: [],
  top: 'lip',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
const int = (v: unknown, fallback: number, lo: number, hi: number) => Math.round(num(v, fallback, lo, hi));
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function sanitizeDrawerUnit(raw: unknown): DrawerUnitOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DrawerUnitOptions, unknown>>;
  const d = DEFAULT_DRAWER_UNIT;
  const L = DRAWER_UNIT;
  const rows = int(r.rows, d.rows, 1, L.maxRows);
  const sizesIn = Array.isArray(r.rowSizes) ? r.rowSizes.slice(0, L.maxRows) : [];
  const rowSizes = Array.from({ length: Math.max(rows, sizesIn.length) }, (_, i) => int(sizesIn[i], 1, 1, L.maxRowSize));
  const textsIn = Array.isArray(r.labelTexts) ? r.labelTexts.slice(0, L.maxLabels) : [];
  const labelTexts = textsIn.map((t) => sanitizeLabelText(t));
  while (labelTexts.length && !labelTexts[labelTexts.length - 1]) labelTexts.pop();
  return {
    rows,
    cols: int(r.cols, d.cols, 1, L.maxCols),
    rowSizes,
    shell: r3(num(r.shell, d.shell, L.shell.min, L.shell.max)),
    drawerWall: r3(num(r.drawerWall, d.drawerWall, L.drawerWall.min, L.drawerWall.max)),
    clearance: r3(num(r.clearance, d.clearance, L.clearance.min, L.clearance.max)),
    pull: pick(r.pull, DRAWER_PULLS, d.pull),
    stops: r.stops === undefined ? d.stops : !!r.stops,
    divX: int(r.divX, 1, 1, L.maxDiv),
    divY: int(r.divY, 1, 1, L.maxDiv),
    labels: !!r.labels,
    labelStyle: pick(r.labelStyle, DRAWER_LABEL_STYLES, d.labelStyle),
    labelTexts,
    top: pick(r.top, DRAWER_TOPS, d.top),
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** A stop ridge, in the drawer's own frame (front face at y = 0, bottom at z = 0). */
export interface DrawerStop {
  /** How far each ridge (drawer and bay) stands out, mm. */
  r: number;
  /** The drawer's ridge, from its front face. */
  y: number;
  z0: number;
  z1: number;
}

/** Everything buildDrawerPart needs (structured-cloneable). */
export interface DrawerSpec {
  /** Drawer box: width, depth (front face to back), height. */
  w: number;
  d: number;
  h: number;
  wall: number;
  front: number;
  /** Corner radius of the box. */
  radius: number;
  pull: DrawerPull;
  /** How far the pull reaches out of the front. */
  reach: number;
  divX: number;
  divY: number;
  stop: DrawerStop | null;
  /** Label text as laid out ('' = none). */
  text: string;
  textStyle: DrawerLabelStyle;
  /** The part is moved by this much so its min corner is at the origin (ridges, pull, raised text stick out). */
  ox: number;
  oy: number;
}

export interface DrawerSlot {
  /** Numbered across each row from the top left. */
  index: number;
  /** 0 = top row. */
  row: number;
  col: number;
  /** The bay, bin-centered mm. */
  bay: { x0: number; x1: number; z0: number; z1: number };
  /** Null when the bay is too small for a drawer. */
  spec: DrawerSpec | null;
  /** Usable inside of the drawer (one compartment's worth before dividers). */
  inside: { w: number; d: number; h: number };
  /** Min corner of the drawer part from the chest mesh's min corner and bottom. */
  assembled: { x: number; y: number; z: number };
}

export interface DrawerUnitPlan {
  W: number;
  D: number;
  /** Top of the walls (7 mm × units); the lip rises above it. */
  H: number;
  /** Overall height. */
  total: number;
  floorTop: number;
  roofBottom: number;
  /** How far the drawer fronts sit back from the chest's front. */
  inset: number;
  /** Drawer front faces and the bays' back, bin-centered Y. */
  yFront: number;
  yBack: number;
  /** Rows and columns that fit (≤ the requested ones). */
  rows: number;
  cols: number;
  bayW: number;
  /** Bay heights, top row first. */
  bayH: number[];
  /** Bay ridge of the stops, from the drawer fronts (null: no stops). */
  stopFront: number | null;
  slots: DrawerSlot[];
}

/** The chest's walls stop at 7 mm × units, whatever the bin's height mode. */
function wallTop(bin: Pick<BinOptions, 'heightUnits'>): number {
  return HEIGHT_UNIT * int(bin.heightUnits, 3, 2, 30);
}

export function drawerUnitHeight(bin: Pick<BinOptions, 'heightUnits'>, o: Pick<DrawerUnitOptions, 'top'>): number {
  return wallTop(bin) + (o.top === 'lip' ? LIP_RISE : 0);
}

/** Label text of drawer `i` as laid out ('' = none). */
export function drawerLabel(o: DrawerUnitOptions, i: number): string {
  return o.labels ? labelLines(o.labelTexts[i]) : '';
}

/** True when raised text sticks out of some drawer front (the fronts then sit back by its height). */
function raisedLabels(o: DrawerUnitOptions): boolean {
  if (!o.labels || o.labelStyle !== 'raised') return false;
  for (let i = 0; i < o.rows * o.cols; i++) if (drawerLabel(o, i)) return true;
  return false;
}

/** Height of the floor the bottom bays stand on: over the feet, and clear of screw holes. */
function floorTopOf(bin: BinOptions, o: DrawerUnitOptions): number {
  if (bin.base === 'flat') return Math.max(1.2, o.shell);
  return bin.holes === 'screws' || bin.holes === 'both' ? BASE_HEIGHT : BASE_PROFILE_HEIGHT + 1.2;
}

export function planDrawerUnit(bin: BinOptions, o: DrawerUnitOptions, cellsIn?: Partial<BinCells> | null): DrawerUnitPlan {
  const L = DRAWER_UNIT;
  const cells = binCells(bin, cellsIn);
  const { w: W, d: D } = binSize(bin, cells);
  const H = wallTop(bin);
  const total = drawerUnitHeight(bin, o);
  const { shell, clearance: c, drawerWall: wall } = o;
  const floorTop = floorTopOf(bin, o);
  const roofBottom = o.top === 'flat' ? H - shell : o.top === 'lip' ? H - L.lipRoofDrop - shell : H - LIP_RISE - shell;

  // Columns and rows that leave each drawer a usable inside.
  const bayWFor = (m: number) => (W - 2 * shell - (m - 1) * shell) / m;
  let cols = o.cols;
  while (cols > 1 && bayWFor(cols) - 2 * c - 2 * wall < L.minInside.w) cols--;
  const sizes = Array.from({ length: o.rows }, (_, i) => o.rowSizes[i] ?? 1);
  const heightsFor = (n: number) => {
    const ws = sizes.slice(0, n);
    const sum = ws.reduce((t, v) => t + v, 0);
    const room = roofBottom - floorTop - (n - 1) * shell;
    return ws.map((v) => (room * v) / sum);
  };
  let rows = o.rows;
  while (rows > 1 && Math.min(...heightsFor(rows)) - c - wall < L.minInside.h) rows--;
  const bayW = bayWFor(cols);
  const bayH = heightsFor(rows);
  // No bays at all when even one doesn't fit (a solid block; the notes say why).
  const hasBays = bayW > 1 && bayH[0] > 1;

  const reach = L.reach[o.pull];
  const raise = L.label.raise;
  const inset = Math.max(reach, raisedLabels(o) ? raise : 0);
  const yFront = -D / 2 + inset;
  const yBack = D / 2 - shell;
  const front = wall + L.frontExtra;
  const dd = yBack - c - yFront;
  const dw = bayW - 2 * c;
  // Drawer corners at least as round as the outer bays' back corners (less the clearance), so they clear them.
  const radius = Math.max(0.8, BASE_TOP_RADIUS - shell - c);

  // Stops: a ridge near the back of each drawer side and one near the front of each bay wall.
  const overlap = clamp(c / 2, L.stop.minOverlap, L.stop.maxOverlap);
  const stopR = (c + overlap) / 2;
  const half = 2 * stopR + 0.5;
  const stopBack = dd - radius - 2.5;
  const stopFront = o.stops && hasBays ? clamp(dd / 3, 3, stopBack - 2 * half - 3) : null;
  const stopsFit = stopFront !== null && stopFront >= 3 && stopBack - 2 * half - 3 >= 3;

  const slots: DrawerSlot[] = [];
  if (hasBays) {
    let z1 = roofBottom;
    for (let row = 0; row < rows; row++) {
      const z0 = z1 - bayH[row];
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const x0 = -W / 2 + shell + col * (bayW + shell);
        const dh = bayH[row] - c;
        const inside = { w: dw - 2 * wall, d: dd - wall - front, h: dh - wall };
        const ok = inside.w >= 1 && inside.d >= 1 && inside.h >= 1;
        const text = drawerLabel(o, index);
        let stop: DrawerStop | null = null;
        const sz0 = Math.max(wall + 1, dh * 0.35);
        const sz1 = dh - 1.5;
        if (stopsFit && sz1 - sz0 >= 2 * stopR + 1) stop = { r: r3(stopR), y: r3(stopBack), z0: r3(sz0), z1: r3(sz1) };
        const ox = stop ? stop.r : 0;
        const oy = Math.max(reach, text && o.labelStyle === 'raised' ? raise : 0);
        const spec: DrawerSpec | null = ok
          ? {
              w: r3(dw),
              d: r3(dd),
              h: r3(dh),
              wall,
              front: r3(front),
              radius: r3(radius),
              pull: o.pull,
              reach,
              divX: o.divX,
              divY: o.divY,
              stop,
              text,
              textStyle: o.labelStyle,
              ox,
              oy,
            }
          : null;
        slots.push({
          index,
          row,
          col,
          bay: { x0, x1: x0 + bayW, z0, z1 },
          spec,
          inside,
          // Resting on the bay floor (rounded up, so never into it).
          assembled: { x: r3(x0 + c - ox + W / 2), y: r3(inset - oy), z: Math.ceil(z0 * 1000 - 1e-6) / 1000 },
        });
      }
      z1 = z0 - shell;
    }
  }
  return {
    W,
    D,
    H,
    total,
    floorTop,
    roofBottom,
    inset,
    yFront,
    yBack,
    rows,
    cols,
    bayW,
    bayH,
    stopFront: stopsFit ? stopFront : null,
    slots,
  };
}

export function drawerUnitKey(o: DrawerUnitOptions): string {
  return [
    `${o.rows}x${o.cols}`,
    o.rowSizes.slice(0, o.rows).join('/'),
    o.shell,
    o.drawerWall,
    o.clearance,
    o.pull,
    o.stops ? 'S' : 'n',
    raisedLabels(o) ? 'R' : 'n',
    o.top,
  ].join(',');
}

export function drawerSpecKey(p: DrawerSpec): string {
  const stop = p.stop ? `${p.stop.r}@${p.stop.y}:${p.stop.z0}-${p.stop.z1}` : '-';
  const text = p.text ? `${p.textStyle}${JSON.stringify(p.text)}` : '-';
  return ['drawer1', `${p.w}x${p.d}x${p.h}`, p.wall, p.front, p.radius, p.pull, p.reach, `${p.divX}x${p.divY}`, stop, text, p.ox, p.oy].join('|');
}

// ---------------------------------------------------------------------------
// Pull and label layout on a drawer front (drawer frame: x across, z up)
// ---------------------------------------------------------------------------

interface FrontLayout {
  notch?: { cx: number; rx: number; ry: number; zb: number };
  tab?: { x0: number; x1: number; zUnder: number };
  knob?: { cx: number; zc: number; r: number };
  grip?: { x0: number; x1: number; z0: number; h: number; depth: number };
  /** Part of the front left for a label. */
  label: { x0: number; x1: number; z0: number; z1: number };
}

/**
 * The pull centered on `cx`; `below` keeps room for a label under it (the knob
 * moves up); `narrow` makes it as narrow as it goes (a label beside it).
 */
function pullLayout(p: DrawerSpec, cx: number, below: boolean, narrow = false): FrontLayout {
  const L = DRAWER_UNIT;
  const { w: dw, h: dh, wall } = p;
  const m = L.label.margin;
  const side = Math.max(L.label.side, p.radius + 1);
  const band = (z1: number) => ({ x0: side, x1: dw - side, z0: m, z1 });
  const flat = dw - 2 * p.radius;
  const notch = (): FrontLayout => {
    const inner = dw - 2 * wall - 2;
    const nw = Math.min(narrow ? L.notch.minW : clamp(dw * L.notch.share, L.notch.minW, L.notch.maxW), inner);
    const nd = Math.min(clamp(dh * L.notch.depthShare, L.notch.minDepth, L.notch.maxDepth), dh - wall - 1.5);
    if (nw < 4 || nd < 1.5) return { label: band(dh - m) };
    const rx = nw / 2;
    return { notch: { cx, rx, ry: Math.min(rx, nd), zb: dh - nd }, label: band(dh - nd - m) };
  };
  if (p.pull === 'notch') return notch();
  if (p.pull === 'tab') {
    const tw = Math.min(narrow ? L.tab.minW : clamp(dw * L.tab.share, L.tab.minW, L.tab.maxW), flat);
    const zUnder = dh - L.tab.thick;
    return { tab: { x0: cx - tw / 2, x1: cx + tw / 2, zUnder }, label: band(zUnder - p.reach - m) };
  }
  if (p.pull === 'knob') {
    const k = Math.SQRT2;
    const r = Math.max(1.5, Math.min(clamp(Math.min(dh, dw) * L.knob.share, L.knob.minR, L.knob.maxR), flat / 2 - 0.5, (dh - 1) / (1 + k)));
    // Centered on the front (by its outline); with a label under it, as high as it goes.
    const mid = (dh + r * (k - 1)) / 2;
    const zc = below ? Math.max(dh - m - r, mid) : mid;
    return { knob: { cx, zc, r }, label: band(zc - k * r - m) };
  }
  // Recessed grip: the pocket's ceiling rises 45° into a block behind the front, up to 1.5 mm under the rim.
  const room = dh - 1.5 - (wall + 0.5);
  const depth = Math.min(L.grip.depth, room * 0.4);
  const h = Math.min(clamp(dh * L.grip.heightShare, L.grip.minH, L.grip.maxH), room - depth);
  if (depth < 1.5 || h < 2) return notch();
  const gw = Math.min(narrow ? L.grip.minW : clamp(dw * L.grip.share, L.grip.minW, L.grip.maxW), dw - 2 * wall - 2 * L.grip.back - 1);
  const z0 = dh - 1.5 - h - depth;
  return { grip: { x0: cx - gw / 2, x1: cx + gw / 2, z0, h, depth }, label: band(z0 - m) };
}

/** Width the pull takes on the face. */
function pullWidth(f: FrontLayout): number {
  if (f.notch) return 2 * f.notch.rx;
  if (f.tab) return f.tab.x1 - f.tab.x0;
  if (f.knob) return 2 * f.knob.r;
  if (f.grip) return f.grip.x1 - f.grip.x0 + 2 * DRAWER_UNIT.grip.back;
  return 0;
}

/** Under this much height under the pull, the label moves beside it. */
const SIDE_BELOW = 5;
/** Narrowest label beside a pull. */
const SIDE_MIN_W = 10;

/**
 * Pull and label on a drawer front. The label goes under a centered pull; when
 * that leaves less than SIDE_BELOW of height and the drawer is wide enough, the
 * pull narrows and moves to the right, and the label takes the full height to
 * its left.
 */
function frontLayout(p: DrawerSpec): FrontLayout {
  const L = DRAWER_UNIT;
  const centered = pullLayout(p, p.w / 2, !!p.text);
  if (!p.text) return centered;
  const below = centered.label;
  if (below.z1 - below.z0 >= SIDE_BELOW) return centered;
  const side = Math.max(L.label.side, p.radius + 1);
  const pw = pullWidth(pullLayout(p, p.w / 2, false, true));
  const cx = p.w - side - pw / 2;
  const moved = pullLayout(p, cx, false, true);
  const band = { x0: side, x1: cx - pw / 2 - 2, z0: L.label.margin, z1: p.h - L.label.margin };
  if (band.x1 - band.x0 < SIDE_MIN_W || band.z1 - band.z0 <= below.z1 - below.z0) return centered;
  return { ...moved, label: band };
}

/** True when a label of at least the smallest printable size fits on the drawer's front. */
export function drawerLabelFits(p: DrawerSpec): boolean {
  const band = frontLayout(p).label;
  return band.z1 - band.z0 >= DRAWER_UNIT.label.minCap && band.x1 - band.x0 >= DRAWER_UNIT.label.minCap;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A stop ridge along Z on a wall face at `x`, standing out `r` toward `dir`
 * (±1), centered on `yc`. Its ends taper at 45° (printable); its root sits
 * 0.2 mm inside the wall so the two fuse.
 */
function stopRidge(w: Wasm, x: number, dir: 1 | -1, yc: number, z0: number, z1: number, r: number): Manifold {
  const half = 2 * r + 0.5;
  const tip = 0.3;
  const xb = x - dir * 0.2;
  const xt = x + dir * r;
  const pts: Vec3[] = [];
  for (const z of [z0 - 0.2, z1 + 0.2]) pts.push([xb, yc - half, z], [xb, yc + half, z]);
  for (const z of [z0 + r, z1 - r]) pts.push([xt, yc - tip, z], [xt, yc + tip, z]);
  return hullOf(w, pts);
}

/** A 2D outline in the XZ plane (x across, z up), extruded along +Y from y0 to y1. */
function extrudeXZ(w: Wasm, s: Scope, pts: Vec2[], y0: number, y1: number): Manifold {
  // rotate([90, 0, 0]) takes (u, v, h) to (u, −h, v).
  const m = s.t(w.Manifold.extrude([pts], y1 - y0));
  return s.t(s.t(m.rotate([90, 0, 0])).translate([0, y1, 0]));
}

/** Chest: base, shell with bays, top, stop ridges. Bin-centered, bottom at z = 0. */
export function buildDrawerUnit(w: Wasm, bin: BinOptions, o: DrawerUnitOptions, cellsIn: BinCells): MeshData {
  const s = new Scope();
  try {
    const cells = binCells(bin, cellsIn);
    const p = planDrawerUnit(bin, o, cells);
    const { W, D, H, total } = p;
    const flat = bin.base === 'flat';
    const R = BASE_TOP_RADIUS;
    const rf = DRAWER_UNIT.frontCorner;
    const base = containerBase(w, s, bin, cells, p.floorTop);
    const ring = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, [rf, rf, R, R]);
    let body = s.t(extrudePolygon(w, ring, flat ? 0 : BASE_PROFILE_HEIGHT, total));

    const cuts: Manifold[] = [];
    // Bays, open at the front. The outer ones round their back corners like the outside.
    const rIn = R - o.shell;
    const last = p.cols - 1;
    for (const sl of p.slots) {
      const { x0, x1, z0, z1 } = sl.bay;
      const rl = sl.col === 0 && rIn > 0.3 ? rIn : 0;
      const rr = sl.col === last && rIn > 0.3 ? rIn : 0;
      cuts.push(s.t(extrudePolygon(w, roundedRectRing(x0, -D / 2 - 1, x1, p.yBack, [0, 0, rr, rl]), z0, z1)));
    }
    if (o.top === 'lip') {
      // A bin's stacking lip around a shallow tray whose floor is the roof.
      const knots: LoftKnot[] = [
        { z: H - DRAWER_UNIT.lipRoofDrop, inset: LIP_DEPTH },
        { z: H, inset: LIP_DEPTH },
        { z: H + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
        { z: H + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
        { z: H + LIP_HEIGHT, inset: 0 },
        { z: H + LIP_HEIGHT + 1, inset: -1 },
      ];
      cuts.push(s.t(loftRoundedRect(w, 0, 0, W, D, R, knots)));
    } else if (o.top === 'grid') {
      // A receptacle per cell, as on a stacking lid (lid.ts), over the feet.
      const F = H - LIP_RISE;
      const gap = GRID - BASE_TOP;
      const { fx, fy } = stretchOffset(cells.stretch);
      for (const cr of cellRects(cells)) {
        cuts.push(
          s.t(
            loftRoundedRect(w, cr.cx + fx, cr.cy + fy, cr.cw - gap, cr.cd - gap, R, [
              { z: F, inset: LIP_DEPTH },
              { z: F + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
              { z: F + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
              { z: F + LIP_HEIGHT, inset: 0 },
              { z: F + LIP_HEIGHT + 1, inset: -1 },
            ]),
          ),
        );
      }
    }
    if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));

    const parts: Manifold[] = [base, body];
    // Stop ridges on both walls of each bay, near the front.
    if (p.stopFront !== null) {
      const yc = p.yFront + p.stopFront;
      for (const sl of p.slots) {
        const st = sl.spec?.stop;
        if (!st) continue;
        const z0 = sl.bay.z0 + st.z0;
        const z1 = sl.bay.z0 + st.z1;
        parts.push(s.t(stopRidge(w, sl.bay.x0, 1, yc, z0, z1, st.r)), s.t(stopRidge(w, sl.bay.x1, -1, yc, z0, z1, st.r)));
      }
    }
    let chest = s.t(w.Manifold.union(parts));
    // The shell reaches down over the floor slab: cut the holes again.
    const holes = holeCutters(w, s, bin, binHoleSites(bin, cells));
    if (holes.length) chest = s.t(chest.subtract(s.t(w.Manifold.union(holes))));
    assertValid(chest, 'drawer unit');
    return toMeshData(chest);
  } finally {
    s.dispose();
  }
}

/** One drawer, upright with the open side up, min corner at the origin. */
export function buildDrawerPart(w: Wasm, specIn: unknown): MeshData {
  const p = specIn as DrawerSpec;
  const L = DRAWER_UNIT;
  const s = new Scope();
  try {
    const { w: dw, d: dd, h: dh, wall, front } = p;
    const ix0 = wall;
    const ix1 = dw - wall;
    const iy0 = front;
    const iy1 = dd - wall;
    const ef = Math.min(L.footChamfer, p.radius - 0.2);
    const outer = s.t(
      loftRoundedRect(w, dw / 2, dd / 2, dw, dd, p.radius, [
        { z: 0, inset: ef },
        { z: ef, inset: 0 },
        { z: dh, inset: 0 },
      ]),
    );
    const cavity = s.t(extrudePolygon(w, roundedRectRing(ix0, iy0, ix1, iy1, Math.max(0.4, p.radius - wall)), wall, dh + 1));
    const add: Manifold[] = [s.t(outer.subtract(cavity))];
    const cut: Manifold[] = [];

    // Compartments.
    const t = L.divider;
    const dz1 = dh - L.dividerDrop;
    for (let i = 1; i < p.divX; i++) {
      const x = ix0 + ((ix1 - ix0) * i) / p.divX;
      add.push(s.t(boxAt(w, x - t / 2, iy0 - 0.1, wall - 0.1, x + t / 2, iy1 + 0.1, dz1)));
    }
    for (let j = 1; j < p.divY; j++) {
      const y = iy0 + ((iy1 - iy0) * j) / p.divY;
      add.push(s.t(boxAt(w, ix0 - 0.1, y - t / 2, wall - 0.1, ix1 + 0.1, y + t / 2, dz1)));
    }

    // Pull.
    const f = frontLayout(p);
    if (f.notch) {
      const { cx, rx, ry, zb } = f.notch;
      const pts: Vec2[] = [[cx - rx, dh + 1]];
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + (Math.PI * i) / n;
        pts.push([cx + rx * Math.cos(a), zb + ry + ry * Math.sin(a)]);
      }
      pts.push([cx + rx, dh + 1]);
      // Through the front and a little way in, so a finger can hook behind it past any compartment wall.
      cut.push(extrudeXZ(w, s, pts, -1, Math.min(front + L.notch.behind, iy1 - 1)));
    }
    if (f.tab) {
      const { x0, x1, zUnder } = f.tab;
      const r = p.reach;
      const pts: Vec3[] = [];
      for (const x of [x0, x1]) pts.push([x, 0.3, dh], [x, -r, dh], [x, -r, zUnder], [x, 0.3, zUnder - r - 0.3]);
      const prism = s.t(hullOf(w, pts));
      const plan = s.t(extrudePolygon(w, roundedRectRing(x0, -r, x1, 1, [L.tab.radius, L.tab.radius, 0, 0]), 0, dh));
      add.push(s.t(prism.intersect(plan)));
    }
    if (f.knob) {
      const { cx, zc, r } = f.knob;
      const reach = p.reach;
      const drop = (y: number, rr: number): Vec3[] => {
        const pts: Vec3[] = [];
        const n = 24;
        for (let i = 0; i <= n; i++) {
          const a = -Math.PI / 4 + ((3 * Math.PI) / 2) * (i / n);
          pts.push([cx + rr * Math.cos(a), y, zc + rr * Math.sin(a)]);
        }
        pts.push([cx, y, zc - Math.SQRT2 * rr]);
        return pts;
      };
      let knob = s.t(hullOf(w, [...drop(0.3, r), ...drop(-(reach - 1), r), ...drop(-reach, r - 1)]));
      if (zc - Math.SQRT2 * r < 0) knob = s.t(knob.intersect(s.t(boxAt(w, cx - r - 1, -reach - 1, 0, cx + r + 1, 1, dh))));
      add.push(knob);
    }
    if (f.grip) {
      const { x0, x1, z0, h, depth } = f.grip;
      const back = depth + L.grip.back;
      if (back > front) {
        // Solid behind the pocket, with a 45° underside (or down to the floor when there's no room for one).
        const bx0 = Math.max(ix0 - 0.1, x0 - L.grip.back);
        const bx1 = Math.min(ix1 + 0.1, x1 + L.grip.back);
        const zf = z0 - L.grip.back;
        const zb = zf - (back - front + 0.1);
        const pts: Vec3[] = [];
        for (const x of [bx0, bx1]) {
          if (zb > wall) pts.push([x, front - 0.1, dh], [x, back, dh], [x, back, zf], [x, front - 0.1, zb]);
          else pts.push([x, front - 0.1, dh], [x, back, dh], [x, back, wall - 0.1], [x, front - 0.1, wall - 0.1]);
        }
        add.push(s.t(hullOf(w, pts)));
      }
      const pts: Vec3[] = [];
      for (const x of [x0, x1]) pts.push([x, -1, z0], [x, depth, z0], [x, depth, z0 + h + depth], [x, 0, z0 + h], [x, -1, z0 + h - 1]);
      cut.push(s.t(hullOf(w, pts)));
    }

    // Label on the front, under (or beside) the pull; text reads upright from the front.
    if (p.text && hasFont() && drawerLabelFits(p)) {
      const band = f.label;
      const bh = band.z1 - band.z0;
      const out = textOutline(p.text, { size: Math.min(L.label.maxCap, bh), maxWidth: band.x1 - band.x0, maxHeight: bh, align: 'center' });
      if (out.size >= L.label.minCap) {
        const raised = p.textStyle === 'raised';
        const z0 = raised ? -0.1 : -L.label.depth;
        const height = raised ? L.label.raise + 0.1 : L.label.depth + 0.5;
        // Drawn in XY, then stood up on the front: rotate([90, 0, 0]) takes (x, y, z) to (x, −z, y).
        const solid = textSolid(w, out, (band.x0 + band.x1) / 2, (band.z0 + band.z1) / 2, z0, height);
        if (solid) (raised ? add : cut).push(s.t(s.t(solid).rotate([90, 0, 0])));
      }
    }

    // Stop ridges near the back of both sides.
    if (p.stop) {
      const { r, y, z0, z1 } = p.stop;
      add.push(s.t(stopRidge(w, 0, -1, y, z0, z1, r)), s.t(stopRidge(w, dw, 1, y, z0, z1, r)));
    }

    let drawer = add.length === 1 ? add[0] : s.t(w.Manifold.union(add));
    if (cut.length) drawer = s.t(drawer.subtract(s.t(w.Manifold.union(cut))));
    drawer = s.t(drawer.translate([p.ox, p.oy, 0]));
    assertValid(drawer, 'drawer');
    return toMeshData(drawer);
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function drawerUnitParts(bin: BinOptions, o: DrawerUnitOptions, cells: BinCells): ContainerPart[] {
  const plan = planDrawerUnit(bin, o, cells);
  return plan.slots.flatMap((sl) => {
    const p = sl.spec;
    if (!p) return [];
    const caption = p.text ? ` “${p.text.replace(/\s*\n\s*/g, ' ')}”` : '';
    return [
      {
        slot: 'drawer',
        index: sl.index,
        name: `Drawer ${sl.index + 1}${caption}`,
        kind: 'bin' as const,
        meshKey: drawerSpecKey(p),
        spec: p,
        w: r3(p.w + 2 * p.ox),
        d: r3(p.d + p.oy),
        h: p.h,
        assembled: sl.assembled,
      },
    ];
  });
}

const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;

export function drawerUnitNotes(bin: BinOptions, o: DrawerUnitOptions, cells?: BinCells | null): string[] {
  const L = DRAWER_UNIT;
  const plan = planDrawerUnit(bin, o, cells);
  const out: string[] = [];
  if (!plan.slots.length) return ['too short for any drawer: make it taller, or use a flat top.'];
  if (plan.rows < o.rows) out.push(`only ${plan.rows} of ${o.rows} drawers fit one above the other at this height.`);
  if (plan.cols < o.cols) out.push(`only ${plan.cols} of ${o.cols} columns fit across.`);
  const built = plan.slots.filter((sl) => sl.spec);
  if (built.length < plan.slots.length) out.push('the drawers are too small to build: make the chest bigger, or the walls thinner.');
  const shallowRows = [...new Set(built.filter((sl) => sl.inside.h < L.shallow).map((sl) => sl.row))];
  if (shallowRows.length) {
    const h = Math.min(...built.map((sl) => sl.inside.h));
    const which = shallowRows.length === plan.rows ? 'the drawers are' : `drawers in row ${shallowRows.map((r) => r + 1).join(', ')} are`;
    out.push(`${which} only ${mm(h)} deep inside: make it taller, or use fewer drawers.`);
  }
  if (plan.bayW > L.bridgeMax) {
    const fix = `use more columns to keep bays under ${L.bridgeMax} mm, or print with supports`;
    out.push(`each bay is ${mm(plan.bayW)} wide, so the shelves and roof bridge that far and may sag; ${fix}.`);
  }
  if (o.stops && plan.stopFront === null && built.length) out.push('the drawers are too short front to back for stops.');
  const first = built[0];
  if (first && (o.divX > 1 || o.divY > 1)) {
    const cw = (first.inside.w - (o.divX - 1) * L.divider) / o.divX;
    const cd = (first.inside.d - (o.divY - 1) * L.divider) / o.divY;
    if (Math.min(cw, cd) < 8) out.push(`drawer compartments are only ${mm(cw)} × ${mm(cd)}.`);
  }
  if (o.labels) {
    const tight = built.filter((sl) => sl.spec!.text && !drawerLabelFits(sl.spec!)).map((sl) => sl.index + 1);
    if (tight.length) out.push(`no room for the label on drawer ${tight.join(', ')}: the front is too small next to its pull.`);
  }
  return out;
}

export function drawerUnitSummary(bin: BinOptions, o: DrawerUnitOptions): string {
  const plan = planDrawerUnit(bin, o);
  const n = plan.slots.filter((sl) => sl.spec).length;
  return `${n} drawer${n === 1 ? '' : 's'}${plan.cols > 1 ? ` (${plan.cols} × ${plan.rows})` : ''}`;
}

registerContainer<DrawerUnitOptions>({
  kind: 'drawers',
  label: 'Drawer unit',
  description: 'A small chest with pull-out drawers that stands on the grid; the drawers print separately.',
  defaults: DEFAULT_DRAWER_UNIT,
  minHeightUnits: 6,
  sanitize: (raw) => sanitizeDrawerUnit(raw),
  key: drawerUnitKey,
  height: drawerUnitHeight,
  build: buildDrawerUnit,
  parts: drawerUnitParts,
  buildPart: buildDrawerPart,
  summary: drawerUnitSummary,
  notes: drawerUnitNotes,
});
