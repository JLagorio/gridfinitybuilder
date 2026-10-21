/**
 * Front labels: text (with icons) on the outside of a bin's front wall, for
 * bins without label tabs or as well as them. It reads upright from the front.
 *
 * - Where: the flat part of the front face (clear of the rounded corners), in
 *   a band at most FRONT_LABEL.band tall at the top of the face, clear of the
 *   stacking lip (it stays below the body's top) and of the feet (above the
 *   base profile, or the stretch overhang). A cutout in the front wall pushes
 *   the band below it, or the text beside it when there's no room below; a
 *   sliding lid's front opening keeps it lower; a hex pattern on the front
 *   wall leaves the label's area solid (walls.ts `keepOut`).
 * - What: the bin's label text; with compartments along the front that have
 *   text of their own, each one's under it (neighbours with the same text
 *   share one label).
 * - Styles: raised 0.6 mm (one filament), 'two-tone' (raised, printed in
 *   filament 2), engraved 0.6 mm, inlaid (engraved and filled flush in
 *   filament 2). The wall is only 0.95 mm, so for engraved and inlaid text it
 *   is thickened on the inside behind the label to FRONT_LABEL.wall (with a 45°
 *   underside, so it prints without support), except over removable-divider
 *   slots.
 * - Raised text stands 0.6 mm proud, more than the 0.5 mm between neighbouring
 *   bins: fine on the front row of a drawer or a shelf; planning warns when a
 *   bin sits right in front of it (`frontLabelClashes`).
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { BASE_TOP_RADIUS, DIVIDER, WALL } from './spec';
import { boxAt, hullOf } from './shapes';
import { textSolid } from './text';
import { binBodyHeight, binFloorZ, lipRise } from './variants';
import { cutoutSize } from './walls';
import { planAccessories } from './accessories';
import { compartmentLabelText, fitText, inlayStyle, type Box, type ExtraLabelParts, type FrontLabelStyle } from './labels';
import { resolveLayout } from '../dividers';
import type { BinOptions } from './bin';

export const FRONT_LABEL = {
  /** Raised text height; engrave / inlay depth. */
  raise: 0.6,
  depth: 0.6,
  /** Engraved / inlaid: the wall is this thick (from the outside) behind the label. */
  wall: 1.75,
  /** Space to the face's edges (the start of the rounded corners, the top, the feet). */
  margin: 1,
  /** Between neighbouring compartments' labels, and from a wall cutout. */
  gap: 1.5,
  /** Tallest band of the face the label uses (at the top of the face). */
  band: 14,
  /** Largest automatic cap height, and its share of the band. */
  maxCap: 10,
  capShare: 0.7,
  /** Smallest band and segment worth labelling. */
  minBand: 4,
  minWidth: 8,
} as const;

export interface FrontSegment {
  text: string;
  /** Where the text goes on the front face: x along the bin's X, y0 / y1 = heights (bin coordinates). */
  box: Box;
}

export interface FrontLabelPlan {
  style: Exclude<FrontLabelStyle, 'none'>;
  segments: FrontSegment[];
  /** Largest cap height. */
  cap: number;
  /** Raise height, or engrave depth. */
  relief: number;
  /** Area (x, z) a hex wall pattern leaves solid. */
  keepOut: Box;
}

type FrontOpts = BinOptions;

/** X ranges (bin coordinates) and label text of the compartments along the front wall, left to right. */
function frontCompartments(o: FrontOpts, W: number, D: number): { x0: number; x1: number; text: string }[] {
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  const ox = -W / 2 + WALL;
  if (o.interior && o.interior !== 'compartments') return [{ x0: -W / 2, x1: W / 2, text: compartmentLabelText({ labelText: o.labelText }, '') }];
  if (!o.layout) {
    // The uniform grid: its front row is j = 0 (tab keys g<i>,<j>).
    const n = Math.max(1, o.divX);
    const cw = (innerW - (n - 1) * DIVIDER) / n;
    return Array.from({ length: n }, (_, i) => ({ x0: ox + i * (cw + DIVIDER), x1: ox + i * (cw + DIVIDER) + cw, text: compartmentLabelText(o, `g${i},0`) }));
  }
  const r = resolveLayout(o.layout, innerW, innerD);
  const out: { x0: number; x1: number; text: string }[] = [];
  for (const c of r.compartments) {
    const front = c.rects.filter((rc) => rc.y0 < 0.01);
    if (!front.length) continue;
    out.push({ x0: ox + Math.min(...front.map((f) => f.x0)), x1: ox + Math.max(...front.map((f) => f.x1)), text: compartmentLabelText(o, c.key) });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

/** Removable divider walls that meet the front wall: their x (bin coordinates). */
function removableAtFront(o: FrontOpts, W: number, D: number): number[] {
  if (!o.layout?.walls.some((wl) => wl.removable)) return [];
  const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
  return r.walls.filter((wl) => wl.removable && wl.orient === 'v' && wl.start < 0.5).map((wl) => -W / 2 + WALL + wl.pos);
}

/**
 * Where the front label's text goes, or null when it's off, blank, or there's
 * no room. `zBottom` is where the front face starts (the top of the feet, the
 * stretch overhang's underside, or 0 for flat bins).
 */
export function planFrontLabel(o: FrontOpts, W: number, D: number, zBottom: number): FrontLabelPlan | null {
  if (!o.frontLabel || o.frontLabel === 'none') return null;
  const F = FRONT_LABEL;
  const H = binBodyHeight(o);
  const zLo = zBottom + F.margin;
  let zHi = H - F.margin;
  const acc = planAccessories(o, W, D);
  if (acc.slide) zHi = Math.min(zHi, acc.slide.zG - F.margin);
  const xEdge = W / 2 - BASE_TOP_RADIUS - F.margin;

  // A cutout in the front wall: go below it, or beside it.
  let notch: { x0: number; x1: number } | null = null;
  if (o.cutoutWalls?.includes('f')) {
    const top = H + lipRise(o);
    const c = cutoutSize(o, W, top, binFloorZ(o) + 1);
    if (c.width >= 4 && top - c.bottom >= 1 && c.bottom < zHi) {
      if (c.bottom - F.gap - zLo >= Math.min(F.band, 8)) zHi = c.bottom - F.gap;
      else notch = { x0: -c.width / 2 - F.gap, x1: c.width / 2 + F.gap };
    }
  }
  const z1 = zHi;
  const z0 = Math.max(zLo, z1 - F.band);
  if (z1 - z0 < F.minBand || xEdge * 2 < F.minWidth) return null;

  // One segment per run of front compartments with the same text.
  const comps = frontCompartments(o, W, D);
  const runs: { x0: number; x1: number; text: string }[] = [];
  for (const c of comps) {
    const last = runs[runs.length - 1];
    if (last && last.text === c.text) last.x1 = c.x1;
    else runs.push({ ...c });
  }
  const segments: FrontSegment[] = [];
  runs.forEach((run, i) => {
    if (!run.text) return;
    let x0 = i === 0 ? -xEdge : Math.max(-xEdge, (runs[i - 1].x1 + run.x0) / 2 + F.gap / 2);
    let x1 = i === runs.length - 1 ? xEdge : Math.min(xEdge, (run.x1 + runs[i + 1].x0) / 2 - F.gap / 2);
    if (notch && x0 < notch.x1 && x1 > notch.x0) {
      // Keep the wider side of the cutout.
      const left = notch.x0 - x0;
      const right = x1 - notch.x1;
      if (left >= right) x1 = notch.x0;
      else x0 = notch.x1;
    }
    if (x1 - x0 < F.minWidth) return;
    segments.push({ text: run.text, box: { x0, y0: z0, x1, y1: z1 } });
  });
  if (!segments.length) return null;
  const autoCap = Math.min(F.maxCap, F.capShare * (z1 - z0));
  const cap = o.frontLabelSize > 0 ? Math.min(o.frontLabelSize, z1 - z0) : autoCap;
  const style = o.frontLabel;
  const raisedStyle = style === 'raised' || style === 'two-tone';
  return {
    style,
    segments,
    cap,
    relief: raisedStyle ? F.raise : F.depth,
    keepOut: {
      x0: Math.min(...segments.map((g) => g.box.x0)) - F.margin,
      x1: Math.max(...segments.map((g) => g.box.x1)) + F.margin,
      y0: z0 - F.margin,
      y1: z1 + F.margin,
    },
  };
}

export interface FrontLabelGeometry extends ExtraLabelParts {
  /** For walls.ts: the front-wall area a hex pattern leaves solid. */
  keepOut: { wall: 'f'; u0: number; u1: number; z0: number; z1: number } | null;
}

/** Text solids and the wall pad for a bin's front label (bin-centered, outer size W × D). */
export function frontLabelGeometry(w: Wasm, s: Scope, o: FrontOpts, W: number, D: number, zBottom: number): FrontLabelGeometry {
  const out: FrontLabelGeometry = { cut: [], add: [], inlay: [], keepOut: null };
  const plan = planFrontLabel(o, W, D, zBottom);
  if (!plan) return out;
  const F = FRONT_LABEL;
  // Text drawn in the XY plane, extruded along +Z, is stood up on the front face: (x, y, z) → (x, −z, y) at y = −D/2.
  const toFront = (m: Manifold | null) => (m ? s.t(s.t(s.t(m).rotate([90, 0, 0])).translate([0, -D / 2, 0])) : null);
  const R = plan.relief;
  let any = false;
  for (const seg of plan.segments) {
    const fit = fitText(seg.text, seg.box, plan.cap);
    if (!fit) continue;
    any = true;
    const { outline: t, cx, cy } = fit;
    if (plan.style === 'raised') {
      // A hair into the wall so the union is solid.
      const m = toFront(textSolid(w, t, cx, cy, -0.02, R + 0.02));
      if (m) out.add.push(m);
    } else if (plan.style === 'two-tone') {
      // Touching the face, not overlapping it.
      const m = toFront(textSolid(w, t, cx, cy, 0, R));
      if (m) out.inlay.push(m);
    } else {
      const hole = toFront(textSolid(w, t, cx, cy, -R, R + 1));
      if (hole) out.cut.push(hole);
      if (plan.style === 'inlaid') {
        const fill = toFront(textSolid(w, t, cx, cy, -R, R));
        if (fill) out.inlay.push(fill);
      }
    }
  }
  if (!any) return out;
  if (plan.style === 'engraved' || plan.style === 'inlaid') {
    // Thicken the wall behind the text, 45° underneath; leave removable-divider slots clear.
    const yw = -D / 2 + WALL - 0.05;
    const yp = -D / 2 + F.wall;
    const drop = yp - yw;
    const gaps = removableAtFront(o, W, D).map((x) => s.t(boxAt(w, x - DIVIDER / 2 - 0.8, yw - 0.5, -1, x + DIVIDER / 2 + 0.8, yp + 1, 500)));
    for (const seg of plan.segments) {
      const x0 = seg.box.x0 - 0.5;
      const x1 = seg.box.x1 + 0.5;
      const z0 = seg.box.y0 - 0.5;
      const z1 = seg.box.y1 + 0.5;
      let pad = s.t(
        hullOf(w, [
          [x0, yw, z0 - drop],
          [x1, yw, z0 - drop],
          [x0, yw, z1],
          [x1, yw, z1],
          [x0, yp, z0],
          [x1, yp, z0],
          [x0, yp, z1],
          [x1, yp, z1],
        ]),
      );
      if (gaps.length) pad = s.t(pad.subtract(s.t(w.Manifold.union(gaps))));
      out.add.push(pad);
    }
  }
  const k = plan.keepOut;
  out.keepOut = { wall: 'f', u0: k.x0, u1: k.x1, z0: k.y0, z1: k.y1 };
  return out;
}

/** True when the bin's front label puts anything on filament 2 (planning: the font may be missing, so this is an upper bound). */
export function frontLabelInlay(o: FrontOpts, W: number, D: number, zBottom: number): boolean {
  return inlayStyle(o.frontLabel) && !!planFrontLabel(o, W, D, zBottom);
}

/** True when the style stands proud of the front face. */
export const frontLabelRaised = (o: Pick<FrontOpts, 'frontLabel'>) => o.frontLabel === 'raised' || o.frontLabel === 'two-tone';

/**
 * Bins whose raised front label would touch a bin right in front of them
 * (bins sit 0.5 mm apart; raised text stands FRONT_LABEL.raise proud), unless
 * that bin is lower than the label. `labelBottom` gives the lowest the bin's
 * label text goes (null: no front label); `height` a bin's overall height.
 */
export function frontLabelClashes<B extends { id: string; x: number; y: number; opts: Pick<FrontOpts, 'unitsX' | 'unitsY' | 'frontLabel'> }>(
  bins: B[],
  labelBottom: (b: B) => number | null,
  height: (b: B) => number,
): B[] {
  return bins.filter((b) => {
    if (!frontLabelRaised(b.opts)) return false;
    const inFront = bins.filter((n) => n !== b && n.y + n.opts.unitsY === b.y && n.x < b.x + b.opts.unitsX && n.x + n.opts.unitsX > b.x);
    if (!inFront.length) return false;
    const z = labelBottom(b);
    return z !== null && inFront.some((n) => height(n) > z);
  });
}

/** The lowest the plan's text boxes go (planning: the text itself may sit higher). */
export const frontLabelBottom = (plan: FrontLabelPlan | null) => (plan ? Math.min(...plan.segments.map((s) => s.box.y0)) : null);

