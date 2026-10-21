/**
 * Dispenser ('dispenser'): a block on Gridfinity feet that hands out one item
 * at a time. Everything is refilled from the top and prints upright without
 * supports.
 *
 * - magazine: one or more vertical columns as tall as the block.
 *   - Cylinders (AA, 18650, …) lie across (axis along X), one on another. The
 *     floor slopes toward a tray in front, so the bottom one rolls out under
 *     the front wall and stops against the tray's lip; it holds back the next
 *     one until it's taken. The opening's roof is a 45° gable from the side
 *     walls (no bridge) and narrows above the bottom item, so only one fits through.
 *   - Coin cells stack flat in a round tube. The bottom one is pushed out
 *     through a slot one cell tall into the tray: a finger goes down a well
 *     behind the tube and pushes through a notch in its back wall (the cells
 *     above it are held by the front wall). The slot's flat roof is a short
 *     bridge (about the cell's diameter): the one feature here that bridges.
 *   - A slot up the front shows the level and lets you push the stack down.
 * - tape: a roll on edge on an axle (printed separately, lying on its flat
 *   underside, with a teardrop bore) that drops into grooves in two cheeks; the
 *   tape runs forward over a front wall with an optional serrated (45° teeth) top.
 * - channel: long, low channels with a fingertip notch through the front wall
 *   (zip ties, shims, thin items).
 */
import type { Manifold, Vec2, Wasm } from '../kernel';
import { Scope, toMeshData } from '../kernel';
import { HEIGHT_UNIT } from '../spec';
import { boxAt, cylinderAt, extrudePolygon, ringAt, roundedRectRing } from '../shapes';
import { binFloorZ } from '../variants';
import { binCells, binSize, type BinCells, type BinOptions } from '../bin';
import { containerBase, containerRing } from './base';
import { registerContainer, type ContainerDef, type ContainerPart } from './registry';

export type DispenserStyle = 'magazine' | 'tape' | 'channel';
export const DISPENSER_STYLES: readonly DispenserStyle[] = ['magazine', 'tape', 'channel'];
/** Cylinders lie across (axis along X); coins stack flat. */
export type MagazineShape = 'cylinder' | 'coin';
export type ChannelAlong = 'auto' | 'x' | 'y';

export interface DispenserOptions {
  style: DispenserStyle;
  /** Magazine: item preset (MAGAZINE_ITEMS), or 'custom'. */
  item: string;
  shape: MagazineShape;
  /** Item diameter, and length (cylinders) or thickness (coins), mm without clearance. */
  itemD: number;
  itemL: number;
  /** Added to the item's diameter and length (coins: the slot gets at most 60 % of the thickness). */
  clearance: number;
  /** Columns side by side; 0 = as many as fit. */
  columns: number;
  /** Cylinders: floor slope toward the tray, degrees (0 = take them out by hand). */
  ramp: number;
  /** A tray in front that catches one item. */
  tray: boolean;
  /** A slot up the front to see the level and push the stack down. */
  window: boolean;
  /** Tape: roll preset (TAPE_ROLLS), or 'custom'. */
  tapePreset: string;
  /** Tape roll: core (inner) diameter, outer diameter and width. */
  tapeInner: number;
  tapeOuter: number;
  tapeWidth: number;
  /** Serrated cutting edge on the front wall. */
  cutter: boolean;
  /** Channels: width of each, how many (0 = as many as fit), and which way they run. */
  channelWidth: number;
  channels: number;
  along: ChannelAlong;
  /** Fingertip notch through the front wall at each channel's end. */
  notch: boolean;
}

export interface MagazineItem {
  id: string;
  label: string;
  shape: MagazineShape;
  d: number;
  l: number;
  note?: string;
}

/** Nominal sizes (the largest common ones); clearance is added on top. */
export const MAGAZINE_ITEMS: MagazineItem[] = [
  { id: 'aa', label: 'AA', shape: 'cylinder', d: 14.5, l: 50.5 },
  { id: 'aaa', label: 'AAA', shape: 'cylinder', d: 10.5, l: 44.5 },
  { id: 'c', label: 'C', shape: 'cylinder', d: 26.2, l: 50 },
  { id: 'd', label: 'D', shape: 'cylinder', d: 34.2, l: 61.5 },
  { id: '18650', label: '18650', shape: 'cylinder', d: 18.6, l: 65.5, note: 'Protected 18650 cells are up to 69 mm long: use Custom for those.' },
  { id: '21700', label: '21700', shape: 'cylinder', d: 21.4, l: 70.5 },
  { id: 'cr123a', label: 'CR123A', shape: 'cylinder', d: 17, l: 34.5 },
  { id: 'cr2032', label: 'CR2032', shape: 'coin', d: 20, l: 3.2 },
  { id: 'cr2025', label: 'CR2025', shape: 'coin', d: 20, l: 2.5 },
  { id: 'cr2016', label: 'CR2016', shape: 'coin', d: 20, l: 1.6 },
  { id: 'cr2450', label: 'CR2450', shape: 'coin', d: 24.5, l: 5 },
  { id: 'lr44', label: 'LR44 / AG13', shape: 'coin', d: 11.6, l: 5.4 },
];

export interface TapeRoll {
  id: string;
  label: string;
  inner: number;
  outer: number;
  width: number;
}

export const TAPE_ROLLS: TapeRoll[] = [
  { id: 'office', label: 'Office tape 19 mm, 1″ core', inner: 25.4, outer: 48, width: 19 },
  { id: 'office-3', label: 'Office tape 19 mm, 3″ core', inner: 76.2, outer: 95, width: 19 },
  { id: 'electrical', label: 'Electrical tape 19 mm', inner: 38, outer: 56, width: 19 },
  { id: 'masking', label: 'Masking tape 24 mm', inner: 76.2, outer: 105, width: 24 },
  { id: 'packing', label: 'Packing tape 48 mm', inner: 76.2, outer: 115, width: 48 },
  { id: 'washi', label: 'Washi tape 15 mm', inner: 25, outer: 35, width: 15 },
  { id: 'kapton', label: 'Kapton tape 10 mm', inner: 25.4, outer: 40, width: 10 },
];

export function findMagazineItem(id: string): MagazineItem | undefined {
  return MAGAZINE_ITEMS.find((p) => p.id === id);
}
export function findTapeRoll(id: string): TapeRoll | undefined {
  return TAPE_ROLLS.find((p) => p.id === id);
}

/** Fixed dimensions. */
export const DISPENSER = {
  wall: 1.6,
  /** Stop lip at the front of the tray. */
  lip: 1.6,
  /** Chamfer round each column's mouth. */
  funnel: 0.8,
  /** Coins: wall between the tube and the finger well, and the well (across, front to back). */
  backWall: 1.2,
  well: { w: 16, d: 14 },
  /** Tape: room each side of the roll, cheek thickness, groove depth into a cheek, axle play in the core, front wall thickness. */
  side: 1,
  cheek: 4,
  groove: 2,
  core: 1,
  cutterT: 3,
  /** Room under a full roll and in front of it. */
  rollGap: 2,
  /** Cutter teeth: 45° flanks. */
  tooth: { pitch: 2.4 },
  /** Channels: plastic left under the fingertip notch. */
  sill: 1.2,
} as const;

const DEG = Math.PI / 180;
const SIN45 = Math.SQRT1_2;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? clamp(n, lo, hi) : d;
};
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export const DISPENSER_DEFAULTS: DispenserOptions = {
  style: 'magazine',
  item: 'aa',
  shape: 'cylinder',
  itemD: 14.5,
  itemL: 50.5,
  clearance: 1,
  columns: 0,
  ramp: 5,
  tray: true,
  window: true,
  tapePreset: 'office',
  tapeInner: 25.4,
  tapeOuter: 48,
  tapeWidth: 19,
  cutter: true,
  channelWidth: 20,
  channels: 0,
  along: 'auto',
  notch: true,
};

/** Clean saved or edited options. A known item or roll preset fills in sizes that are missing. */
export function sanitizeDispenser(raw: unknown): DispenserOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DispenserOptions, unknown>>;
  const d = DISPENSER_DEFAULTS;
  const item = typeof r.item === 'string' && (r.item === 'custom' || findMagazineItem(r.item)) ? r.item : d.item;
  const pi = findMagazineItem(item);
  const shape: MagazineShape = r.shape === 'coin' || r.shape === 'cylinder' ? r.shape : (pi?.shape ?? d.shape);
  const tapePreset = typeof r.tapePreset === 'string' && (r.tapePreset === 'custom' || findTapeRoll(r.tapePreset)) ? r.tapePreset : d.tapePreset;
  const pt = findTapeRoll(tapePreset);
  const tapeInner = r2(num(r.tapeInner, 6, 100, pt?.inner ?? d.tapeInner));
  return {
    style: DISPENSER_STYLES.includes(r.style as DispenserStyle) ? (r.style as DispenserStyle) : d.style,
    item,
    shape,
    itemD: r2(num(r.itemD, 3, 80, pi?.d ?? d.itemD)),
    itemL: r2(num(r.itemL, 0.5, 120, pi?.l ?? d.itemL)),
    clearance: r2(num(r.clearance, 0.2, 4, d.clearance)),
    columns: int(r.columns, 0, 8, d.columns),
    ramp: r2(num(r.ramp, 0, 15, d.ramp)),
    tray: bool(r.tray, d.tray),
    window: bool(r.window, d.window),
    tapePreset,
    tapeInner,
    tapeOuter: r2(num(r.tapeOuter, tapeInner + 2, 200, Math.max(tapeInner + 2, pt?.outer ?? d.tapeOuter))),
    tapeWidth: r2(num(r.tapeWidth, 3, 100, pt?.width ?? d.tapeWidth)),
    cutter: bool(r.cutter, d.cutter),
    channelWidth: r2(num(r.channelWidth, 3, 150, d.channelWidth)),
    channels: int(r.channels, 0, 20, d.channels),
    along: r.along === 'x' || r.along === 'y' || r.along === 'auto' ? r.along : d.along,
    notch: bool(r.notch, d.notch),
  };
}

/** Mesh-key text: the fields that shape the active style. */
export function dispenserKey(o: DispenserOptions): string {
  if (o.style === 'magazine') return ['m', o.shape, o.itemD, o.itemL, o.clearance, o.columns, o.ramp, o.tray ? 't' : '', o.window ? 'w' : ''].join('|');
  if (o.style === 'tape') return ['t', o.tapeInner, o.tapeOuter, o.tapeWidth, o.cutter ? 'c' : ''].join('|');
  return ['c', o.channelWidth, o.channels, o.along, o.notch ? 'n' : ''].join('|');
}

interface Frame {
  W: number;
  D: number;
  top: number;
  floor: number;
}

function frameOf(bin: BinOptions, cells?: BinCells | null): Frame {
  const { w: W, d: D } = binSize(bin, cells ?? binCells(bin));
  return { W, D, top: HEIGHT_UNIT * bin.heightUnits, floor: binFloorZ(bin) };
}

/** The item's name for summaries ("AA", "20 × 3.2 mm coin"). */
export function magazineItemLabel(o: DispenserOptions): string {
  const p = findMagazineItem(o.item);
  if (p && p.d === o.itemD && p.l === o.itemL && p.shape === o.shape) return p.label;
  return o.shape === 'coin' ? `${o.itemD} × ${o.itemL} mm coin` : `${o.itemD} × ${o.itemL} mm`;
}

// ---------------------------------------------------------------------------
// Magazine
// ---------------------------------------------------------------------------

export interface MagazineLayout extends Frame {
  shape: MagazineShape;
  /** Inside of a column: across (X) and front to back (Y); a coin tube's diameter both ways. */
  colW: number;
  colD: number;
  /** Column centers across; empty when none fit. */
  xs: number[];
  /** Columns that would fit across. */
  fit: number;
  /** Front face of the wall in front of the columns, and the columns' inside front and back. */
  yWall0: number;
  yCol0: number;
  yCol1: number;
  /** The tray: inside face of its stop lip, and the lip's top. */
  tray: { y0: number; lipTop: number; notch: number } | null;
  /** Coins: finger well behind the tube, and the notch from it into the tube. */
  well: { y0: number; y1: number; notch: number; notchTop: number } | null;
  /** Floor slope used, degrees, starting at the tray's lip. */
  ramp: number;
  /** Top of the opening at the bottom front (at the side walls for cylinders, under the gable). */
  spring: number;
  /** Viewing slot: width (0 = none), and where it starts. */
  slot: number;
  slotFrom: number;
  /** Items per column, the one in the tray included. */
  capacity: number;
  /** Depth front to back the tray (and the coin well) would need, when it was left out for lack of room. */
  trayNeeds: number;
  wellNeeds: number;
  /** Least depth front to back for one column (without tray or well). */
  needsD: number;
}

/** Floor height at `y` on the ramp. */
const rampZ = (L: Pick<MagazineLayout, 'floor' | 'ramp' | 'tray' | 'D'>, y: number) => L.floor + Math.max(0, y - (L.tray ? L.tray.y0 : -L.D / 2)) * Math.tan(L.ramp * DEG);

export function magazineLayout(bin: BinOptions, o: DispenserOptions, cells?: BinCells | null): MagazineLayout {
  const f = frameOf(bin, cells);
  const { wall, lip, backWall } = DISPENSER;
  const coin = o.shape === 'coin';
  const colD = r2(o.itemD + o.clearance);
  const colW = coin ? colD : r2(o.itemL + o.clearance + 1);
  const Y0 = -f.D / 2;
  // Coin columns are at least a finger well apart, so the wells behind them stay separate.
  const pitch = (coin ? Math.max(colW, DISPENSER.well.w) : colW) + wall;
  const fit = Math.max(0, Math.floor((f.W - wall + 1e-9) / pitch));
  const trayD = colD + 0.5;
  const back = (well: boolean) => (well ? backWall + DISPENSER.well.d + wall : wall);
  const need = (tray: boolean, well: boolean) => (tray ? lip + trayD : 0) + wall + colD + back(well);
  let tray = o.tray;
  let well = coin;
  if (need(tray, well) > f.D + 1e-9) tray = false;
  if (need(tray, well) > f.D + 1e-9) well = false;
  const fitsDepth = need(tray, well) <= f.D + 1e-9;
  const n = fitsDepth ? (o.columns > 0 ? Math.min(o.columns, fit) : fit) : 0;
  const xs = Array.from({ length: n }, (_, k) => r3((k - (n - 1) / 2) * pitch));
  const yTray0 = Y0 + lip;
  const yWall0 = tray ? yTray0 + trayD : Y0;
  const yCol0 = yWall0 + wall;
  const yCol1 = yCol0 + colD;
  const ramp = tray && !coin ? o.ramp : 0;
  const base = { ...f, floor: f.floor, ramp, tray: tray ? { y0: yTray0, lipTop: 0, notch: 0 } : null };
  const zFront = rampZ(base, coin ? yCol0 : yCol0 + colD / 2);
  // One item (plus clearance) under the roof; never two. Coins get at most 60 % of their thickness extra.
  const spring = Math.min(f.top - 1, coin ? zFront + o.itemL + Math.min(o.clearance, 0.6 * o.itemL) : zFront + o.itemD + o.clearance);
  const slot = o.window ? (coin ? clamp(0.4 * colD, 3, 10) : clamp(0.3 * colW, 4, 10)) : 0;
  const slotFrom = coin ? spring + 2 : spring;
  const lipTop = Math.min(f.top - 1, f.floor + (coin ? Math.max(2.5, o.itemL + 1.2) : Math.max(3, 0.35 * o.itemD)));
  const perColumn = coin ? Math.floor((f.top - f.floor) / o.itemL + 1e-9) : Math.floor((f.top - zFront) / o.itemD + 1e-9);
  return {
    ...f,
    shape: o.shape,
    colW,
    colD,
    xs,
    fit,
    yWall0: r3(yWall0),
    yCol0: r3(yCol0),
    yCol1: r3(yCol1),
    tray: tray ? { y0: r3(yTray0), lipTop: r3(lipTop), notch: r2(coin ? 0.45 * colD : Math.min(0.4 * colW, 18)) } : null,
    well: well
      ? {
          y0: r3(yCol1 + backWall),
          y1: r3(yCol1 + backWall + DISPENSER.well.d),
          notch: r2(Math.min(12, 0.55 * colD)),
          notchTop: r3(Math.min(f.top - 2, f.floor + Math.max(8, 3 * o.itemL + o.clearance))),
        }
      : null,
    ramp,
    spring: r3(spring),
    slot: slot && slotFrom < f.top - 3 ? r2(slot) : 0,
    slotFrom: r3(slotFrom),
    capacity: n ? Math.max(0, perColumn) + (tray ? 1 : 0) : 0,
    trayNeeds: o.tray && !tray ? r2(need(true, well)) : 0,
    wellNeeds: coin && !well ? r2(need(false, true)) : 0,
    needsD: r2(need(false, false)),
  };
}

/** A prism from a CCW polygon in the (y, z) plane, from x0 to x1. */
function prismYZ(w: Wasm, s: Scope, pts: Vec2[], x0: number, x1: number): Manifold {
  return s.t(s.t(s.t(w.Manifold.extrude([pts], x1 - x0)).rotate([90, 0, 90])).translate([x0, 0, 0]));
}

/** A prism from a CCW polygon in the (x, z) plane, from y0 to y1. */
function prismXZ(w: Wasm, s: Scope, pts: Vec2[], y0: number, y1: number): Manifold {
  return s.t(s.t(s.t(w.Manifold.extrude([pts], y1 - y0)).rotate([90, 0, 0])).translate([0, y1, 0]));
}

/** An opening from z0 up to `spring` at its sides, then a 45° gable to a point in the middle. */
const gable = (x: number, width: number, z0: number, spring: number): Vec2[] => [
  [x - width / 2, z0],
  [x + width / 2, z0],
  [x + width / 2, spring],
  [x, spring + width / 2],
  [x - width / 2, spring],
];

function buildMagazine(w: Wasm, s: Scope, bin: BinOptions, o: DispenserOptions, cells: BinCells): Manifold {
  const L = magazineLayout(bin, o, cells);
  const body = containerBase(w, s, bin, cells, L.top);
  if (!L.xs.length) return body;
  const coin = L.shape === 'coin';
  const Y0 = -L.D / 2;
  const zLow = L.floor - 1;
  const zHi = L.top + 1;
  const fn = DISPENSER.funnel;
  const voids: Manifold[] = [];
  for (const x of L.xs) {
    const half = L.colW / 2;
    if (coin) {
      const cy = (L.yCol0 + L.yCol1) / 2;
      voids.push(s.t(cylinderAt(w, x, cy, zLow, zHi, half, half, 64)));
      voids.push(s.t(cylinderAt(w, x, cy, L.top - fn, L.top + 0.02, half, half + fn + 0.02, 64)));
      // The slot the bottom cell leaves by: the tube's full width, one cell tall, flat roof.
      voids.push(s.t(boxAt(w, x - half, L.yWall0 - 0.1, zLow, x + half, cy, L.spring)));
      if (L.well) {
        const W2 = DISPENSER.well.w / 2;
        voids.push(prismXZ(w, s, gable(x, L.well.notch, zLow, L.well.notchTop), cy, L.well.y0 + 0.1));
        // Square at the front, so the notch opens into it full width; round at the back for the fingertip.
        const r = Math.min(W2, L.well.y1 - L.well.y0) - 0.01;
        voids.push(s.t(extrudePolygon(w, roundedRectRing(x - W2, L.well.y0, x + W2, L.well.y1, [0.5, 0.5, r, r]), L.floor, zHi)));
      }
    } else {
      const ring = roundedRectRing(x - half, L.yCol0, x + half, L.yCol1, 0.6);
      voids.push(s.t(extrudePolygon(w, ring, zLow, zHi)));
      const g = fn + 0.02;
      const big = roundedRectRing(x - half - g, L.yCol0 - g, x + half + g, L.yCol1 + g, 0.6 + g);
      voids.push(s.t(w.Manifold.hull([...ringAt(ring, L.top - fn), ...ringAt(big, L.top + 0.02)])));
      voids.push(prismXZ(w, s, gable(x, L.colW, zLow, L.spring), L.yWall0 - 0.1, L.yCol0 + 0.1));
    }
    if (L.slot > 0) voids.push(s.t(boxAt(w, x - L.slot / 2, L.yWall0 - 0.1, L.slotFrom, x + L.slot / 2, L.yCol0 + 0.1, zHi)));
    if (L.tray) {
      voids.push(s.t(boxAt(w, x - half, L.tray.y0, zLow, x + half, L.yWall0 + 0.01, zHi)));
      // A fingertip notch in the lip, narrower than the item, to roll or slide it out of the tray.
      voids.push(s.t(boxAt(w, x - L.tray.notch / 2, Y0 - 1, zLow, x + L.tray.notch / 2, L.tray.y0 + 0.01, zHi)));
    }
  }
  // Everything stops at the (sloped) floor.
  const yA = L.tray ? L.tray.y0 : Y0;
  const yB = L.D / 2 + 2;
  const floorAt = (y: number) => L.floor + Math.max(0, y - yA) * Math.tan(L.ramp * DEG);
  const above = prismYZ(
    w,
    s,
    [
      [Y0 - 2, L.floor],
      [yA, L.floor],
      [yB, floorAt(yB)],
      [yB, zHi + 1],
      [Y0 - 2, zHi + 1],
    ],
    -L.W,
    L.W,
  );
  let cut = s.t(s.t(w.Manifold.union(voids)).intersect(above));
  // In front of the columns the block comes down to the lip.
  if (L.tray) cut = s.t(cut.add(s.t(boxAt(w, -L.W, Y0 - 1, L.tray.lipTop, L.W, L.yWall0, zHi))));
  return s.t(body.subtract(cut));
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

export interface TapeLayout extends Frame {
  /** Gap between the cheeks (the roll's width plus room), and the cheeks' outside faces. */
  gap: number;
  outer: number;
  /** Groove depth into each cheek. */
  groove: number;
  /** Axle: radius, length, teardrop bore radius (0 = solid), center height and position front to back. */
  ra: number;
  la: number;
  bore: number;
  za: number;
  ya: number;
  /** Top of the front wall (its teeth rise above it). */
  zc: number;
  /** Height the roll needs (the cheeks reach above the axle). */
  needs: number;
  /** Width the cheeks need, and how far a full roll reaches past the back (≤ 0 = inside). */
  needsW: number;
  over: number;
}

export function tapeLayout(bin: BinOptions, o: DispenserOptions, cells?: BinCells | null): TapeLayout {
  const f = frameOf(bin, cells);
  const { side, cheek, core, cutterT, rollGap } = DISPENSER;
  const Y0 = -f.D / 2;
  const needsW = o.tapeWidth + 2 * side + 2 * cheek + 1;
  const outer = Math.min(o.tapeWidth / 2 + side + cheek, f.W / 2 - 0.5);
  const gap = Math.max(2, Math.min(o.tapeWidth + 2 * side, 2 * (outer - 2.5)));
  const groove = Math.max(0.6, Math.min(DISPENSER.groove, outer - gap / 2 - 1.5));
  const ra = r2(Math.max(3, (o.tapeInner - core) / 2));
  const ro = o.tapeOuter / 2;
  const ri = o.tapeInner / 2;
  // The roll hangs on the axle by its core; a full roll clears the floor.
  const za = r3(f.floor + rollGap + ro + (ri - ra));
  const front = Y0 + cutterT + rollGap;
  const ya = r3(Math.max(front + ro, (front + f.D / 2) / 2));
  const needs = r2(za + 3);
  const bore = ra >= 8 ? r2(Math.min((ra - 2.4) / Math.SQRT2, SIN45 * ra - 2)) : 0;
  return {
    ...f,
    top: Math.max(f.top, needs),
    gap: r3(gap),
    outer: r3(outer),
    groove: r3(groove),
    ra,
    la: r3(gap + 2 * (groove - 0.3)),
    bore,
    za,
    ya,
    zc: za,
    needs,
    needsW: r2(needsW),
    over: r2(ya + ro - f.D / 2),
  };
}

function buildTape(w: Wasm, s: Scope, bin: BinOptions, o: DispenserOptions, cells: BinCells): Manifold {
  const L = tapeLayout(bin, o, cells);
  const base = containerBase(w, s, bin, cells, L.floor);
  const Y0 = -L.D / 2;
  const z0 = L.floor - 0.5;
  const parts: Manifold[] = [];
  for (const sx of [-1, 1]) {
    const [a, b] = [sx * (L.gap / 2), sx * L.outer];
    parts.push(s.t(boxAt(w, Math.min(a, b), Y0 - 1, z0, Math.max(a, b), L.D / 2 + 1, L.top)));
  }
  // Front wall across both cheeks, its top serrated with 45° teeth.
  const wallTop: Vec2[] = [
    [-L.outer, z0],
    [L.outer, z0],
    [L.outer, L.zc],
  ];
  if (o.cutter) {
    const n = Math.max(1, Math.round((2 * L.outer) / DISPENSER.tooth.pitch));
    const p = (2 * L.outer) / n;
    for (let k = 0; k < n; k++) {
      wallTop.push([L.outer - (k + 0.5) * p, L.zc + p / 2]);
      if (k < n - 1) wallTop.push([L.outer - (k + 1) * p, L.zc]);
    }
  }
  wallTop.push([-L.outer, L.zc]);
  parts.push(prismXZ(w, s, wallTop, Y0 - 1, Y0 + DISPENSER.cutterT));
  // Keep it all inside the outline (rounded corners), then stand it on the base.
  const outline = s.t(extrudePolygon(w, containerRing(bin, cells), z0 - 0.1, L.top + 2));
  const upper = s.t(s.t(w.Manifold.union(parts)).intersect(outline));
  let body = s.t(w.Manifold.union([base, upper]));
  // Grooves on the cheeks' inner faces: the axle's flat underside rests on their bottoms.
  const grooves: Manifold[] = [];
  const zg = L.za - SIN45 * L.ra;
  for (const sx of [-1, 1]) {
    const [a, b] = [sx * (L.gap / 2 - 0.01), sx * (L.gap / 2 + L.groove)];
    grooves.push(s.t(boxAt(w, Math.min(a, b), L.ya - L.ra - 0.3, zg, Math.max(a, b), L.ya + L.ra + 0.3, L.top + 1)));
  }
  body = s.t(body.subtract(s.t(w.Manifold.union(grooves))));
  return body;
}

/** The axle: a round bar with its underside cut flat at 45° (so it prints lying down) and a teardrop bore when it's thick. */
export interface TapeAxleSpec {
  ra: number;
  la: number;
  bore: number;
}

function axleMesh(w: Wasm, spec: unknown) {
  const s = new Scope();
  try {
    const { ra, la, bore } = spec as TapeAxleSpec;
    const segs = 48;
    // Round above the flat at -45°: every overhang is 45° or steeper.
    const outline: Vec2[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (-45 + (270 * i) / segs) * DEG;
      outline.push([ra * Math.cos(a), ra * Math.sin(a)]);
    }
    let axle = prismYZ(w, s, outline, 0, la);
    if (bore > 0) {
      // Teardrop: a circle with a 45° point on top.
      const tear: Vec2[] = [[0, bore * Math.SQRT2]];
      for (let i = 0; i <= 36; i++) {
        const a = (135 + (270 * i) / 36) * DEG;
        tear.push([bore * Math.cos(a), bore * Math.sin(a)]);
      }
      axle = s.t(axle.subtract(prismYZ(w, s, tear, -1, la + 1)));
    }
    return toMeshData(s.t(axle.translate([0, ra, SIN45 * ra])));
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelLayout extends Frame {
  along: 'x' | 'y';
  /** Channel width used, centers across, and how many would fit. */
  width: number;
  centers: number[];
  fit: number;
  /** Each channel from `from` to `to` along its length (bin-centered). */
  from: number;
  to: number;
  /** Fingertip notch width (0 = none). */
  notch: number;
}

export function channelLayout(bin: BinOptions, o: DispenserOptions, cells?: BinCells | null): ChannelLayout {
  const f = frameOf(bin, cells);
  const along = o.along === 'auto' ? (f.D >= f.W ? 'y' : 'x') : o.along;
  const across = along === 'y' ? f.W : f.D;
  const length = along === 'y' ? f.D : f.W;
  const { wall } = DISPENSER;
  let width = o.channelWidth;
  const fit = Math.floor((across - wall + 1e-9) / (width + wall));
  let n = o.channels > 0 ? Math.min(o.channels, fit) : fit;
  if (n < 1) {
    n = 1;
    width = r2(across - 2 * wall);
  }
  const pitch = width + wall;
  return {
    ...f,
    along,
    width,
    centers: Array.from({ length: n }, (_, k) => r3((k - (n - 1) / 2) * pitch)),
    fit: Math.max(0, fit),
    from: r3(-length / 2 + wall),
    to: r3(length / 2 - wall),
    // Up to 24 mm wide the whole end opens; wider channels get an 18 mm notch between their rounded corners.
    notch: o.notch ? r2(width <= 24 ? width : 18) : 0,
  };
}

function buildChannels(w: Wasm, s: Scope, bin: BinOptions, o: DispenserOptions, cells: BinCells): Manifold {
  const L = channelLayout(bin, o, cells);
  const body = containerBase(w, s, bin, cells, L.top);
  const zHi = L.top + 1;
  const r = Math.min(L.width / 2 - 0.01, 3);
  // A notch as wide as the channel opens its front end completely: square front corners, so no slivers are left.
  const open = L.notch > 0 && L.notch >= L.width - 1e-6;
  const cuts: Manifold[] = [];
  for (const c of L.centers) {
    const [a0, a1] = [c - L.width / 2, c + L.width / 2];
    const ring =
      L.along === 'y'
        ? roundedRectRing(a0, L.from, a1, L.to, open ? [0, 0, r, r] : r)
        : roundedRectRing(L.from, a0, L.to, a1, open ? [0, r, r, 0] : r);
    cuts.push(s.t(extrudePolygon(w, ring, L.floor, zHi)));
    if (L.notch > 0) {
      const [n0, n1] = [c - L.notch / 2, c + L.notch / 2];
      const z0 = L.floor + DISPENSER.sill;
      const out = -Math.max(L.W, L.D);
      cuts.push(s.t(L.along === 'y' ? boxAt(w, n0, out, z0, n1, L.from + 0.01, zHi) : boxAt(w, out, n0, z0, L.from + 0.01, n1, zHi)));
    }
  }
  return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
}

// ---------------------------------------------------------------------------
// The type
// ---------------------------------------------------------------------------

export function dispenserHeight(bin: BinOptions, o: DispenserOptions): number {
  return o.style === 'tape' ? tapeLayout(bin, o).top : HEIGHT_UNIT * bin.heightUnits;
}

export function dispenserNotes(bin: BinOptions, o: DispenserOptions, cells?: BinCells | null): string[] {
  const out: string[] = [];
  const mm = (v: number) => `${Math.round(v)} mm`;
  if (o.style === 'magazine') {
    const L = magazineLayout(bin, o, cells);
    const name = magazineItemLabel(o);
    if (!L.xs.length) {
      out.push(
        L.fit
          ? `${name} needs ${mm(L.needsD)} front to back: make it deeper.`
          : `${name} ${o.shape === 'coin' ? 'cells' : 'lying across'} need ${mm(L.colW + 2 * DISPENSER.wall)} across: make it wider.`,
      );
      return out;
    }
    if (o.columns > L.fit) out.push(`Only ${L.fit} column${L.fit === 1 ? '' : 's'} fit across.`);
    if (L.trayNeeds) out.push(`No room for the tray in front (it needs ${mm(L.trayNeeds)} front to back): take items out of the front opening by hand.`);
    if (L.wellNeeds) out.push(`No room for the finger well behind the cells (it needs ${mm(L.wellNeeds)} front to back): push them out with a tool.`);
    if (L.capacity < 3) out.push(`Holds only ${L.capacity}: make it taller.`);
  } else if (o.style === 'tape') {
    const L = tapeLayout(bin, o, cells);
    if (L.needsW > L.W + 1e-6) out.push(`The roll needs ${mm(L.needsW)} across: make it wider.`);
    if (L.over > 0.5) out.push(`A full roll reaches ${mm(L.over)} past the back: make it deeper.`);
    if (L.needs > HEIGHT_UNIT * bin.heightUnits + 1e-6) out.push(`The roll sets the height: ${mm(L.top)} instead of ${mm(HEIGHT_UNIT * bin.heightUnits)}.`);
  } else {
    const L = channelLayout(bin, o, cells);
    if (o.channels > L.fit) out.push(`Only ${Math.max(1, L.fit)} channel${L.fit > 1 ? 's' : ''} fit across.`);
    if (L.fit < 1) out.push(`Channels are ${mm(L.width)} wide, narrower than asked.`);
  }
  return out;
}

export function dispenserSummary(bin: BinOptions, o: DispenserOptions, cells?: BinCells | null): string {
  if (o.style === 'magazine') {
    const n = magazineLayout(bin, o, cells).xs.length;
    const name = magazineItemLabel(o);
    return n > 1 ? `${n} × ${name}` : name;
  }
  if (o.style === 'tape') return `${o.tapeWidth} mm tape`;
  const n = channelLayout(bin, o, cells).centers.length;
  return `${n} channel${n === 1 ? '' : 's'}`;
}

function buildDispenser(w: Wasm, bin: BinOptions, o: DispenserOptions, cells: BinCells) {
  const s = new Scope();
  try {
    const m = o.style === 'magazine' ? buildMagazine(w, s, bin, o, cells) : o.style === 'tape' ? buildTape(w, s, bin, o, cells) : buildChannels(w, s, bin, o, cells);
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}

function dispenserParts(bin: BinOptions, o: DispenserOptions, cells: BinCells): ContainerPart[] {
  if (o.style !== 'tape') return [];
  const L = tapeLayout(bin, o, cells);
  const spec: TapeAxleSpec = { ra: L.ra, la: L.la, bore: L.bore };
  const h = r3(L.ra * (1 + SIN45));
  return [
    {
      slot: 'axle',
      index: 0,
      name: 'Tape axle',
      kind: 'tray',
      meshKey: `dispenser-axle|${L.ra}|${L.la}|${L.bore}`,
      spec,
      w: L.la,
      d: r3(2 * L.ra),
      h,
      // Printed the way it sits: lying along X on its flat, in the grooves.
      assembled: { x: r3(L.W / 2 - L.la / 2), y: r3(L.ya - L.ra + L.D / 2), z: r3(L.za - SIN45 * L.ra) },
    },
  ];
}

export const DISPENSER_DEF: ContainerDef<DispenserOptions> = {
  kind: 'dispenser',
  label: 'Dispenser',
  description: 'Hands out one at a time: a gravity-fed magazine for batteries and coin cells, a tape roll holder, or channels for zip ties.',
  defaults: DISPENSER_DEFAULTS,
  sanitize: (raw) => sanitizeDispenser(raw),
  key: dispenserKey,
  height: dispenserHeight,
  build: buildDispenser,
  parts: dispenserParts,
  buildPart: axleMesh,
  summary: dispenserSummary,
  notes: dispenserNotes,
};

registerContainer(DISPENSER_DEF);
