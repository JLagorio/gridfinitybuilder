/**
 * Lift-out cups and egg-crate grids: separately printed parts that drop into a
 * bin's compartments (options in insertOptions.ts, grid geometry in
 * eggcrate.ts). The bin itself is never changed; each part is fitted to what
 * the compartment already has:
 *
 * - its footprint is the compartment's clear rect less CUP.clearance per
 *   side; against an outer wall it also stays inside the stacking lip's
 *   opening (so it lifts straight out), and beside a removable divider it
 *   clears the guide ribs;
 * - its corners are rounded at least as much as the compartment's, less the
 *   clearance;
 * - its bottom edges are chamfered 45° to clear the compartment's rounded
 *   bottom: a quarter round of radius R a gap g away needs a chamfer of
 *   R − g (tangent at the floor, clear above). A front scoop and finger slides
 *   are quarter rounds too, so those sides get a bigger chamfer;
 * - under a label tab it is cut along the tab's underside (clearance
 *   included), or stops in front of the tab when that would leave less than
 *   CUP.minBack of back wall;
 * - its rim stays CUP.headroom under the top of the dividers.
 *
 * Every surface faces up or sideways, or is a 45° chamfer: no supports.
 *
 * Which compartments get one: every open compartment when the bin's `cups`
 * (or `crate`) is on, unless the compartment says otherwise (`cup` / `crate`
 * in CompartmentOptions). L-, T- and U-shaped compartments get one per
 * rectangle they're made of. Filled compartments, ramps and steps, and
 * compartments a diagonal wall runs through get none. Bins with hollow (lite /
 * efficient) floors, trays, a sliding lid or rails get none.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import { LIP_SUPPORT_HEIGHT, TAB_TIP_HEIGHT, WALL } from './spec';
import { boxAt, loftRings, roundedRectRing } from './shapes';
import { binCells, binCutFloor, binLayout, binSize, sanitizeBin, type BinCells, type BinOptions } from './bin';
import { compartmentSpaces, type CompartmentSpace } from './compartments';
import { accessoryInfillTop, lipOpeningInset, wantsRails, wantsSlideLid, wantsTray } from './accessories';
import { binBodyHeight, binFloorZ } from './variants';
import { CRATE, CUP, compartmentWantsCrate, compartmentWantsCup, wantsInserts, type CupGrip } from './insertOptions';
import { RIB_THICKNESS, SLOT_CLEARANCE, T as DIVIDER_T, type ResolvedLayout } from '../dividers';

/** Sides in the order [front (−Y), back (+Y), left (−X), right (+X)]. */
export type SideValues = [number, number, number, number];
export type GripSide = 'front' | 'back';

/** Where a label tab's underside cuts a part: local mm, the cut's front edge and height there; it drops `slope` mm per mm toward the back. */
export interface TabCut {
  x0: number;
  x1: number;
  y: number;
  z: number;
  slope: number;
}

/** The fitted outside shared by cups and grids (local mm, min corner at the origin). */
export interface FitShape {
  w: number;
  d: number;
  /** Height of the body (a cup's pull tab rises above it). */
  h: number;
  radius: number;
  /** 45° chamfer on every bottom edge. */
  chamfer: number;
  /** Bigger 45° chamfers on some sides (0 = just `chamfer`), measured from that side's face. */
  sides: SideValues;
  tab: TabCut | null;
}

export interface CupPart extends FitShape {
  type: 'cup';
  wall: number;
  floor: number;
  grip: CupGrip;
  gripSide: GripSide | null;
  /** Pull tab: how far it rises above the body, and its width. Finger groove: its width and depth. */
  gripW: number;
  gripH: number;
  scoop: boolean;
}

export interface CratePart extends FitShape {
  type: 'crate';
  wall: number;
  divX: number;
  divY: number;
}

/** A fitted spot in one compartment rect, bin-centered mm. */
export interface InsertFit {
  key: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  shape: FitShape;
  /** A label tab is over the back of the part (cut or stopped in front of it). */
  underTab: boolean;
}

export interface InsertPlan {
  cups: InsertFit[];
  crates: InsertFit[];
  /** Compartments that asked for a part and get none, and why ("is too small"). */
  misses: { key: string; kind: 'cup' | 'crate'; why: string }[];
  /** Why parts that are on don't apply (for hints and print warnings). */
  notes: string[];
}

export interface InsertPartPlan {
  /** Part key is `<slot>:<bin id>:<index>`. */
  slot: 'cup' | 'crate';
  index: string;
  /** Key of the compartment it sits in. */
  compartment: string;
  kind: 'tray' | 'divider';
  name: string;
  meshKey: string;
  part: CupPart | CratePart;
  w: number;
  d: number;
  h: number;
  /** Min corner from the bin mesh's min corner and bottom, sitting in its compartment. */
  assembled: { x: number; y: number; z: number };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt1 = (v: number) => String(Math.round(v * 10) / 10);
const EMPTY: InsertPlan = { cups: [], crates: [], misses: [], notes: [] };

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

interface Ctx {
  W: number;
  D: number;
  /** The bin's own floor (finger slides rise from it). */
  zBin: number;
  /** How much further in than the wall's face a part against an outer wall stays (the lip's overhang). */
  lipExtra: number;
  /** Finger-slide radius per outer wall, [f, b, l, r] (0 = none). */
  slides: SideValues;
  resolved: ResolvedLayout | null;
}

/** Sides of a space that lie along a removable divider (its guide ribs reach out into the compartment). */
function removableSides(ctx: Ctx, sp: CompartmentSpace): boolean[] {
  const r = ctx.resolved;
  const out = [false, false, false, false];
  if (!r) return out;
  const ox = ctx.W / 2 - WALL;
  const oy = ctx.D / 2 - WALL;
  const [x0, y0, x1, y1] = [sp.x0 + ox, sp.y0 + oy, sp.x1 + ox, sp.y1 + oy];
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0.5;
  for (const wall of r.walls) {
    if (!wall.removable) continue;
    const lo = wall.pos - DIVIDER_T / 2;
    const hi = wall.pos + DIVIDER_T / 2;
    if (wall.orient === 'h' && overlaps(wall.start, wall.end, x0, x1)) {
      if (Math.abs(hi - y0) < 0.05) out[0] = true;
      if (Math.abs(lo - y1) < 0.05) out[1] = true;
    }
    if (wall.orient === 'v' && overlaps(wall.start, wall.end, y0, y1)) {
      if (Math.abs(hi - x0) < 0.05) out[2] = true;
      if (Math.abs(lo - x1) < 0.05) out[3] = true;
    }
  }
  return out;
}

/** Does a diagonal or curved wall come within `pad` of the space? */
function crossedByFreeWall(ctx: Ctx, sp: CompartmentSpace, pad: number): boolean {
  const r = ctx.resolved;
  if (!r?.free.length) return false;
  const ox = ctx.W / 2 - WALL;
  const oy = ctx.D / 2 - WALL;
  const [x0, y0, x1, y1] = [sp.x0 + ox - pad, sp.y0 + oy - pad, sp.x1 + ox + pad, sp.y1 + oy + pad];
  for (const f of r.free) {
    for (let i = 1; i < f.path.length; i++) {
      const [ax, ay] = f.path[i - 1];
      const [bx, by] = f.path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const y = ay + ((by - ay) * k) / n;
        if (x > x0 && x < x1 && y > y0 && y < y1) return true;
      }
    }
  }
  return false;
}

/**
 * Fit a part into one compartment rect, its top at most `hMax` above the
 * floor; a string says why it doesn't fit.
 */
function fitSpace(sp: CompartmentSpace, ctx: Ctx, hMax: number, minInner: number): InsertFit | string {
  if (sp.blocked) return 'filled';
  const c = CUP.clearance;
  const eps = 0.02;
  if (crossedByFreeWall(ctx, sp, DIVIDER_T / 2 + c)) return 'diagonal';
  const edge = [
    sp.y0 <= -ctx.D / 2 + WALL + eps,
    sp.y1 >= ctx.D / 2 - WALL - eps,
    sp.x0 <= -ctx.W / 2 + WALL + eps,
    sp.x1 >= ctx.W / 2 - WALL - eps,
  ];
  const rem = removableSides(ctx, sp);
  const g = edge.map((e, k) => c + (e ? ctx.lipExtra : rem[k] ? SLOT_CLEARANCE + RIB_THICKNESS : 0));
  const x0 = sp.x0 + g[2];
  const x1 = sp.x1 - g[3];
  const y0 = sp.y0 + g[0];
  let y1 = sp.y1 - g[1];
  const z0 = sp.zFloor;
  const top = Math.min(sp.topInfill - CUP.headroom, z0 + hMax);
  const h = top - z0;
  if (h < CUP.minHeight - 1e-9) return 'shallow';

  // Label tab: cut along its underside, or stop in front of it.
  let tab: TabCut | null = null;
  let underTab = false;
  const t = sp.tab;
  if (t && t.tx1 > x0 && t.tx0 < x1) {
    const slope = (t.th - TAB_TIP_HEIGHT) / Math.max(1e-6, t.yb - t.yf);
    const yc = t.yf - c;
    const zc = t.tabTop - TAB_TIP_HEIGHT - c * Math.sqrt(1 + slope * slope);
    const zAt = (y: number) => zc - (y - yc) * slope;
    if (zAt(y1) < top) {
      underTab = true;
      if (zAt(y1) - z0 >= CUP.minBack) tab = { x0: r3(t.tx0 - c - x0), x1: r3(t.tx1 + c - x0), y: r3(yc - y0), z: r3(zc - z0), slope: r3(slope) };
      else y1 = Math.min(y1, yc);
    }
  }
  const w = x1 - x0;
  const d = y1 - y0;
  if (Math.min(w, d) < CUP.minSize - 1e-9) return 'small';

  // Bottom edges: clear the compartment's rounded bottom (every side is at least `c` from a wall face).
  const chamfer = Math.max(CUP.footChamfer, sp.fillet - c);
  const sides: SideValues = [0, 0, 0, 0];
  const bigger = (k: number, e: number) => {
    if (e > chamfer + 0.01) sides[k] = Math.max(sides[k], r3(e));
  };
  if (sp.scoop > 0) bigger(0, sp.scoop - (y0 - sp.y0));
  // Finger slides along outer walls rise from the bin's floor at the wall's inner face.
  const fromWall = [y0 - (-ctx.D / 2 + WALL), ctx.D / 2 - WALL - y1, x0 - (-ctx.W / 2 + WALL), ctx.W / 2 - WALL - x1];
  for (let k = 0; k < 4; k++) if (edge[k] && ctx.slides[k] > 0) bigger(k, ctx.slides[k] - fromWall[k] - (z0 - ctx.zBin));
  // Keep a flat bottom and room inside.
  const eff = sides.map((e) => Math.max(e, chamfer));
  if (d - eff[0] - eff[1] < 2 || w - eff[2] - eff[3] < 2 || Math.min(w, d) < minInner) return 'small';
  const radius = Math.min(Math.max(sp.radius - c, chamfer + 0.3, 0.5), Math.min(w, d) / 2 - 0.05);
  return {
    key: sp.key,
    x0: r3(x0),
    y0: r3(y0),
    x1: r3(x1),
    y1: r3(y1),
    z0: r3(z0),
    shape: { w: r3(w), d: r3(d), h: r3(h), radius: r3(radius), chamfer: r3(chamfer), sides, tab },
    underTab,
  };
}

/** Why a compartment gets no part: [one, several]. */
const REASONS: Record<string, [string, string]> = {
  filled: ['is filled or has a ramp or steps', 'are filled or have a ramp or steps'],
  diagonal: ['has a diagonal wall through it', 'have a diagonal wall through them'],
  shallow: ['is too shallow', 'are too shallow'],
  small: ['is too small', 'are too small'],
};

/** Where every cup and egg-crate grid of a bin goes. Empty unless one is on. */
export function planInserts(opts: BinOptions, cellsIn?: Partial<BinCells> | null): InsertPlan {
  if (!wantsInserts(opts)) return EMPTY;
  const o = sanitizeBin(opts);
  if (o.container) return EMPTY;
  const comps = Object.values(o.layout?.comps ?? {});
  const cups = o.cups || comps.some((c) => c?.cup);
  const grids = o.crate || comps.some((c) => c?.crate);
  const what = cups && grids ? 'Cups and grids' : cups ? 'Cups' : 'Grids';
  if (o.interior !== 'compartments') return { ...EMPTY, notes: [`${what} need a Compartments interior.`] };
  if (wantsTray(o) || wantsSlideLid(o) || wantsRails(o)) return { ...EMPTY, notes: [`${what} don’t combine with trays, a sliding lid or divider rails.`] };
  const cells = binCells(o, cellsIn);
  const zBin = binFloorZ(o);
  if (binCutFloor(o, cells) < zBin - 1e-6) return { ...EMPTY, notes: [`${what} need a flat floor: the lite and efficient bases dip into the feet.`] };
  const { w: W, d: D } = binSize(o, cells);
  const H = binBodyHeight(o);
  const topInfill = accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H);
  const spaces = compartmentSpaces(o, W, D, zBin, topInfill);
  const slideR = Math.min(o.slideRadius, Math.min(topInfill - zBin - 0.5, 40));
  const ctx: Ctx = {
    W,
    D,
    zBin,
    lipExtra: Math.max(0, lipOpeningInset(o) - WALL),
    slides: (['f', 'b', 'l', 'r'] as const).map((k) => (o.slideWalls.includes(k) && slideR >= 1 ? slideR : 0)) as SideValues,
    resolved: o.layout ? binLayout(o, cells) : null,
  };
  const out: InsertPlan = { cups: [], crates: [], misses: [], notes: [] };
  const misses = { cup: new Map<string, string>(), crate: new Map<string, string>() };
  const crateH = o.crateHeight > 0 ? o.crateHeight : Infinity;
  for (const sp of spaces) {
    const co = o.layout?.comps?.[sp.key];
    const kind = compartmentWantsCup(o, co) ? 'cup' : compartmentWantsCrate(o, co) ? 'crate' : null;
    if (!kind) continue;
    // Bin-wide settings skip filled compartments quietly; a compartment's own setting says why.
    const asked = kind === 'cup' ? co?.cup === true : co?.crate === true;
    if (sp.blocked && !asked) continue;
    const fit = kind === 'cup' ? fitSpace(sp, ctx, Infinity, CUP.minInner + 2 * CUP.wall) : fitSpace(sp, ctx, crateH, 0);
    if (typeof fit === 'string') {
      misses[kind].set(sp.key, fit);
      out.misses.push({ key: sp.key, kind, why: REASONS[fit]?.[0] ?? fit });
    } else (kind === 'cup' ? out.cups : out.crates).push(fit);
  }
  for (const kind of ['cup', 'crate'] as const) {
    const m = misses[kind];
    if (!m.size) continue;
    const n = m.size;
    const why = [...new Set(m.values())].map((k) => REASONS[k]?.[n === 1 ? 0 : 1] ?? k);
    const one = n === 1;
    out.notes.push(`${n} compartment${one ? ' gets' : 's get'} no ${kind === 'cup' ? 'cup' : 'grid'}: ${one ? 'it' : 'they'} ${why.join(' or ')}.`);
  }
  return out;
}

/** Most compartments a grid fits: cells at least CRATE.minCell. */
function crateDivs(n: number, inner: number, wall: number) {
  const max = Math.max(1, Math.floor((inner + wall) / (CRATE.minCell + wall)));
  return Math.max(1, Math.min(max, Math.round(n)));
}

/** Which wall takes the grip, and how big it is (none when no wall can take it). */
function cupGrip(o: BinOptions, f: InsertFit): Pick<CupPart, 'grip' | 'gripSide' | 'gripW' | 'gripH'> {
  const s = f.shape;
  const none = { grip: 'none' as const, gripSide: null, gripW: 0, gripH: 0 };
  if (o.cupGrip === 'none') return none;
  // On the straight part of the wall.
  const width = Math.min(o.cupGrip === 'tab' ? CUP.tabWidth : CUP.notchWidth, 0.6 * s.w, s.w - 2 * s.radius - 1);
  if (width < 6) return none;
  if (o.cupGrip === 'tab') {
    const gripH = r3(Math.min(CUP.tabHeight, CUP.tabShare * s.h));
    const rim = s.h - gripH;
    // A vertical face at the rim, and nothing over it.
    const ok = (k: 0 | 1) => Math.max(s.chamfer, s.sides[k]) < rim - 1.5 && !(k === 1 && f.underTab);
    const side: GripSide | null = ok(1) ? 'back' : ok(0) ? 'front' : null;
    if (!side || gripH < 2) return none;
    return { grip: 'tab', gripSide: side, gripW: r3(width), gripH };
  }
  const depth = Math.min(CUP.notchDepth, 0.3 * s.d);
  if (depth < 2) return none;
  return { grip: 'notch', gripSide: f.underTab ? 'front' : 'back', gripW: r3(width), gripH: r3(depth) };
}

export function insertPartKey(p: CupPart | CratePart): string {
  const shape = [p.w, p.d, p.h, p.radius, p.chamfer, p.sides, p.tab && [p.tab.x0, p.tab.x1, p.tab.y, p.tab.z, p.tab.slope], p.wall];
  if (p.type === 'cup') return `cup|${JSON.stringify([...shape, p.floor, p.grip, p.gripSide, p.gripW, p.gripH, p.scoop])}`;
  return `crate|${JSON.stringify([...shape, p.divX, p.divY])}`;
}

/** The cups and grids a bin needs, with where each sits in it. `cells` as for binSize. */
export function insertParts(opts: BinOptions, cells?: Partial<BinCells> | null): InsertPartPlan[] {
  const plan = planInserts(opts, cells);
  if (!plan.cups.length && !plan.crates.length) return [];
  const o = sanitizeBin(opts);
  const { w: W, d: D } = binSize(o, cells);
  const at = (f: InsertFit) => ({ x: r3(f.x0 + W / 2), y: r3(f.y0 + D / 2), z: f.z0 });
  const out: InsertPartPlan[] = [];
  plan.cups.forEach((f, i) => {
    const grip = cupGrip(o, f);
    const part: CupPart = { type: 'cup', ...f.shape, wall: CUP.wall, floor: CUP.floor, ...grip, scoop: o.cupScoop };
    const h = part.h;
    out.push({
      slot: 'cup',
      index: String(i),
      compartment: f.key,
      kind: 'tray',
      name: `Cup ${fmt1(part.w)} × ${fmt1(part.d)} × ${fmt1(h)} mm`,
      meshKey: insertPartKey(part),
      part,
      w: part.w,
      d: part.d,
      h,
      assembled: at(f),
    });
  });
  plan.crates.forEach((f, i) => {
    const t = o.crateWall;
    const part: CratePart = {
      type: 'crate',
      ...f.shape,
      wall: t,
      divX: crateDivs(o.crateDivX, f.shape.w - 2 * t, t),
      divY: crateDivs(o.crateDivY, f.shape.d - 2 * t, t),
    };
    out.push({
      slot: 'crate',
      index: String(i),
      compartment: f.key,
      kind: 'divider',
      name: `Grid insert ${part.divX}×${part.divY}, ${fmt1(part.w)} × ${fmt1(part.d)} × ${fmt1(part.h)} mm`,
      meshKey: insertPartKey(part),
      part,
      w: part.w,
      d: part.d,
      h: part.h,
      assembled: at(f),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const SQRT2 = Math.SQRT2;

/**
 * The fitted shape offset inward by `t` (0 = the outside), from z0 to z1:
 * a rounded box with its bottom edges chamfered 45°. Inset by `t`, the chamfer
 * is the outside's moved in by `t` across the slope, so the wall stays `t` thick.
 */
export function fittedSolid(w: Wasm, s: Scope, p: FitShape, t: number, z0: number, z1: number): Manifold {
  const e = p.chamfer + t * (SQRT2 - 1);
  const knots: { z: number; inset: number }[] = [];
  const at = (z: number) => t + Math.max(0, e - z);
  knots.push({ z: z0, inset: at(z0) });
  if (e > z0 + 1e-6 && e < z1 - 1e-6) knots.push({ z: e, inset: t });
  knots.push({ z: z1, inset: at(z1) });
  const rings = knots.map((k) => {
    const i = Math.min(k.inset, p.w / 2 - 0.1, p.d / 2 - 0.1);
    return roundedRectRing(i, i, p.w - i, p.d - i, Math.max(0.03, Math.min(p.radius - i, p.w / 2 - i - 0.02, p.d / 2 - i - 0.02)));
  });
  let m = s.t(loftRings(w, rings, knots.map((k) => k.z)));
  // Sides with a bigger chamfer: everything in front of that side's 45° plane (moved in by t across the slope) goes.
  const wedges: Manifold[] = [];
  p.sides.forEach((E, k) => {
    if (!(E > 0)) return;
    const v = E + t * SQRT2;
    // (u, z) triangle below the line u + z = v, u measured in from the side's face.
    const tri: [number, number][] = [
      [-1, z0 - 1],
      [v - z0 + 1, z0 - 1],
      [-1, v + 1],
    ];
    const pts: Vec3[] = [];
    const len = k < 2 ? p.w : p.d;
    for (const a of [-1, len + 1]) {
      for (const [u, z] of tri) {
        if (k === 0) pts.push([a, u, z]);
        else if (k === 1) pts.push([a, p.d - u, z]);
        else if (k === 2) pts.push([u, a, z]);
        else pts.push([p.w - u, a, z]);
      }
    }
    wedges.push(s.t(w.Manifold.hull(pts)));
  });
  if (wedges.length) m = s.t(m.subtract(s.t(w.Manifold.union(wedges))));
  return m;
}

/** What a label tab over the part takes away (local mm), up past `zTop`. */
export function tabCutter(w: Wasm, s: Scope, p: FitShape, zTop: number): Manifold | null {
  const t = p.tab;
  if (!t) return null;
  const yb = p.d + 1;
  const zb = t.z - (yb - t.y) * t.slope;
  const pts: Vec3[] = [];
  for (const x of [Math.max(-1, t.x0), Math.min(p.w + 1, t.x1)]) pts.push([x, t.y, t.z], [x, t.y, zTop], [x, yb, zb], [x, yb, zTop]);
  return s.t(w.Manifold.hull(pts));
}

/**
 * The finger groove (local mm) on the front or back wall, grown by `grow`: a
 * vertical round channel whose far side is `gripH` in from the face, and the
 * band out past the face.
 */
function grooveSolid(w: Wasm, s: Scope, p: CupPart, grow: number, z0: number, z1: number): Manifold {
  const r = p.gripW / 2 + grow;
  const cy = p.gripH + grow - r;
  const back = p.gripSide === 'back';
  const y = (v: number) => (back ? p.d - v : v);
  const cyl = s.t(w.Manifold.cylinder(z1 - z0, r, r, 48).translate([p.w / 2, y(cy), z0]));
  const band = s.t(boxAt(w, p.w / 2 - r, Math.min(y(-2 - grow), y(Math.max(cy, -2 - grow))), z0, p.w / 2 + r, Math.max(y(-2 - grow), y(Math.max(cy, -2 - grow))), z1));
  return s.t(w.Manifold.union(cyl, band));
}

/** Build a lift-out cup, min corner at the origin, bottom at z = 0 (it prints as it sits). */
export function buildCup(w: Wasm, p: CupPart): MeshData {
  const s = new Scope();
  try {
    const tabbed = p.grip === 'tab' && p.gripSide;
    const body = tabbed ? p.h - p.gripH : p.h;
    let outer = fittedSolid(w, s, p, 0, 0, body);
    let cavity = fittedSolid(w, s, p, p.wall, p.floor, body + 1);
    if (p.scoop) {
      // A concave ramp across the inside of the front wall, like a bin's scoop.
      const R = Math.min(0.45 * (p.d - 2 * p.wall), 0.7 * (body - p.floor));
      if (R >= 2) {
        const fill = s.t(boxAt(w, -1, -1, p.floor - 1, p.w + 1, p.wall + R, p.floor + R));
        const cyl = s.t(s.t(w.Manifold.cylinder(p.w + 4, R, R, 48)).rotate([0, 90, 0]).translate([-2, p.wall + R, p.floor + R]));
        cavity = s.t(cavity.subtract(s.t(fill.subtract(cyl))));
      }
    }
    if (p.grip === 'notch' && p.gripSide) {
      outer = s.t(outer.subtract(grooveSolid(w, s, p, 0, -1, body + 1)));
      cavity = s.t(cavity.subtract(grooveSolid(w, s, p, p.wall, -2, body + 2)));
    }
    let cup = s.t(outer.subtract(cavity));
    if (tabbed) {
      // A tab rising from the rim, thicker than the wall with a 45° underside, corners chamfered.
      const th = Math.max(p.wall, CUP.tabThick);
      const x0 = p.w / 2 - p.gripW / 2;
      const x1 = p.w / 2 + p.gripW / 2;
      const k = Math.min(1.5, p.gripH / 2);
      const zb = body - 1 - (th - p.wall);
      const pts: Vec3[] = [];
      const face = (u: number, x: number, z: number): Vec3 => [x, p.gripSide === 'back' ? p.d - u : u, z];
      for (const x of [x0, x1]) pts.push(face(0, x, zb), face(p.wall, x, zb), face(th, x, zb + (th - p.wall)), face(0, x, p.h - k), face(th, x, p.h - k));
      for (const x of [x0 + k, x1 - k]) pts.push(face(0, x, p.h), face(th, x, p.h));
      cup = s.t(w.Manifold.union(cup, s.t(w.Manifold.hull(pts))));
    }
    const cut = tabCutter(w, s, p, p.h + 1);
    if (cut) cup = s.t(cup.subtract(cut));
    assertValid(cup, 'cup');
    return toMeshData(cup);
  } finally {
    s.dispose();
  }
}
