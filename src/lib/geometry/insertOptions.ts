/**
 * Options for the extra inserts a bin can have, merged into BinOptions like
 * labels.ts and accessories.ts:
 *
 * - lift-out cups: a thin-walled cup in each compartment (cups.ts);
 * - egg-crate grids: a printed lattice that drops into each compartment (eggcrate.ts);
 * - pocket-grid lids: a stacking lid whose top is a pocket grid (pocketLid.ts);
 * - two-colour shadow boards: tool pockets get a floor printed in filament 2 (shadowBoard.ts).
 *
 * Cups, grids and lids are separate parts: they never change the bin itself,
 * so they add nothing to its mesh key. Only the shadow floor changes the bin,
 * and only when it applies. Every default leaves old projects as they were.
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import type { CompartmentOptions, CompartmentPockets, DividerLayout } from '../dividers/types';
import { cleanCompartmentOptions } from '../dividers/sanitize';

/** How a cup is lifted out: a tab rising above its rim, a finger groove down the outside of a wall, or nothing. */
export type CupGrip = 'tab' | 'notch' | 'none';
export const CUP_GRIPS: readonly CupGrip[] = ['tab', 'notch', 'none'];
/** 'stack': receptacles on top so another bin stacks on the lid; 'pockets': a pocket grid on top. */
export type LidStyle = 'stack' | 'pockets';
export const LID_STYLES: readonly LidStyle[] = ['stack', 'pockets'];

export interface BinInsertOptions {
  /** A lift-out cup in every open compartment (compartments can override it with `cup`). */
  cups: boolean;
  cupGrip: CupGrip;
  /** A scoop-shaped front inside each cup, so small parts pour out. */
  cupScoop: boolean;
  /** An egg-crate grid insert in every open compartment (compartments can override it with `crate`). */
  crate: boolean;
  /** Cells of each grid. */
  crateDivX: number;
  crateDivY: number;
  /** Height of the grid, mm; 0 = as deep as the compartment. */
  crateHeight: number;
  /** Wall thickness of the grid, mm. */
  crateWall: number;
  /** Top of the stacking lid (when `lid` is on). */
  lidStyle: LidStyle;
  /** The pocket-grid lid's pockets, over the bin's own pocket fields (like a pocket compartment's). */
  lidPockets?: CompartmentPockets;
  /** Tool cutouts: a thin floor in each pocket printed in filament 2, so a missing tool stands out. */
  shadowFloor: boolean;
}

export const DEFAULT_INSERTS: BinInsertOptions = {
  cups: false,
  cupGrip: 'tab',
  cupScoop: false,
  crate: false,
  crateDivX: 2,
  crateDivY: 2,
  crateHeight: 0,
  crateWall: 1.2,
  lidStyle: 'stack',
  shadowFloor: false,
};

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const CUP = {
  /** Gap per side between a cup and its compartment's walls. */
  clearance: 0.3,
  wall: 1,
  floor: 1,
  /** The cup's rim stays this far under the top of the dividers. */
  headroom: 0.5,
  /** Elephant-foot chamfer on the bottom edge (more where the compartment's bottom is rounded). */
  footChamfer: 0.4,
  /** Smallest cup footprint and height, and inside. */
  minSize: 6,
  minHeight: 5,
  minInner: 3,
  /** Back wall a label tab may leave before the cup stops in front of the tab instead. */
  minBack: 5,
  /** Pull tab: width along the wall, height above the rim (at most this share of the cup's height), thickness. */
  tabWidth: 14,
  tabHeight: 4,
  tabShare: 0.3,
  tabThick: 1.4,
  /** Finger groove: width along the wall and how far in it reaches (at most these shares of the cup). */
  notchWidth: 14,
  notchDepth: 6,
} as const;

export const CRATE = {
  minDiv: 1,
  maxDiv: 12,
  minWall: 0.8,
  maxWall: 3,
  /** Smallest cell. */
  minCell: 3,
  minHeight: 3,
  maxHeight: 200,
} as const;

export const SHADOW = {
  /** Thickness of the filament-2 floor (three 0.2 mm layers). The pocket is cut this much deeper. */
  depth: 0.6,
} as const;

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const r2 = (v: number) => Math.round(v * 100) / 100;
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Clamp every insert field; unknown values fall back to the defaults. `lidPockets` is undefined when empty. */
export function sanitizeInsertOptions(o: Partial<BinInsertOptions>): BinInsertOptions {
  const d = DEFAULT_INSERTS;
  const out: BinInsertOptions = {
    cups: !!o.cups,
    cupGrip: pick(o.cupGrip, CUP_GRIPS, d.cupGrip),
    cupScoop: !!o.cupScoop,
    crate: !!o.crate,
    crateDivX: int(o.crateDivX, CRATE.minDiv, CRATE.maxDiv, d.crateDivX),
    crateDivY: int(o.crateDivY, CRATE.minDiv, CRATE.maxDiv, d.crateDivY),
    crateHeight: (() => {
      const h = r2(num(o.crateHeight, 0, CRATE.maxHeight, d.crateHeight));
      return h > 0 ? Math.max(CRATE.minHeight, h) : 0;
    })(),
    crateWall: r2(num(o.crateWall, CRATE.minWall, CRATE.maxWall, d.crateWall)),
    lidStyle: pick(o.lidStyle, LID_STYLES, d.lidStyle),
    shadowFloor: !!o.shadowFloor,
  };
  // Always set (possibly undefined), so a bad value spread in from the raw options is replaced.
  out.lidPockets = o.lidPockets ? cleanCompartmentOptions({ pockets: o.lidPockets })?.pockets : undefined;
  return out;
}

// ---------------------------------------------------------------------------
// What applies where
// ---------------------------------------------------------------------------

type Opts = Partial<BinInsertOptions> & { layout?: DividerLayout | null };

/** Does this compartment get a cup? Its own setting, else the bin's. */
export function compartmentWantsCup(o: Opts, co: CompartmentOptions | null | undefined): boolean {
  return co?.cup ?? !!o.cups;
}

/** Does this compartment get an egg-crate grid? Its own setting, else the bin's; a cup wins. */
export function compartmentWantsCrate(o: Opts, co: CompartmentOptions | null | undefined): boolean {
  return !compartmentWantsCup(o, co) && (co?.crate ?? !!o.crate);
}

/** True when any compartment may get a cup or a grid (cheap: no layout is resolved). */
export function wantsInserts(o: Opts): boolean {
  if (o.cups || o.crate) return true;
  return Object.values(o.layout?.comps ?? {}).some((c) => c?.cup || c?.crate);
}

type ShadowOpts = { shadowFloor?: boolean; interior?: string; cutouts?: unknown[] | null; layout?: DividerLayout | null };

/** The shadow floor applies: it is on, and the bin has tool pockets (the whole interior or a tools compartment). */
export function wantsShadow(o: ShadowOpts): boolean {
  if (!o.shadowFloor || !o.cutouts?.length) return false;
  if (o.interior === 'cutouts') return true;
  return (!o.interior || o.interior === 'compartments') && Object.values(o.layout?.comps ?? {}).some((c) => c?.inside === 'tools');
}

/** Mesh-key parts: [] unless the shadow floor changes the bin, so other bins keep their keys. */
export function insertKeyParts(o: ShadowOpts): string[] {
  return wantsShadow(o) ? [`Sh${SHADOW.depth}`] : [];
}
