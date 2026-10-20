import type { Manifold, Wasm } from './kernel';
import type { Scope } from './kernel';
import type { BinOptions } from './bin';
import { BASE_HEIGHT, INNER_RADIUS, LIP_DEPTH, LIP_PROFILE, LIP_SUPPORT_HEIGHT, WALL } from './spec';
import { extrudePolygon, roundedRectRing } from './shapes';
import { binBodyHeight, binFloorZ, type LipStyle } from './variants';
import { hasFont, textOutline, textSolid } from './text';

/**
 * Tool-outline pockets ("shadow board" bins). The bin's interior is filled
 * solid up to the top of its walls and each placed tool is cut into it:
 * its outline grown by a clearance, as deep as the tool is thick, with an
 * optional chamfered or rounded top edge, finger notches to lift it out and
 * its name engraved beside it.
 *
 * Everything except `cutoutCutters` is plain math, shared with the 2D editor.
 */

export type Pt = [number, number];

/** One tool placed in a bin. Carries a copy of the tool so meshes don't need the library. */
export interface BinCutout {
  /** Library tool this came from (the copy below is refreshed when that tool changes). */
  toolId: string;
  name: string;
  /** Pocket center relative to the bin's center (= interior center), mm. */
  x: number;
  y: number;
  /** Degrees, counter-clockwise seen from above. */
  rotation: number;
  /** Tool outline: mm, counter-clockwise, origin at its bounding-box center. Not grown by the clearance. */
  outline: Pt[];
  /** Pocket depth = tool thickness, mm. */
  depth: number;
  /** Gap around the tool, mm. */
  clearance: number;
  /** Finger-notch centers in the tool's own frame (mm), usually on its outline. */
  notches?: Pt[];
  /** Engrave the tool's name next to the pocket. */
  label?: boolean;
  /** Label position relative to the pocket center (bin axes, mm); automatic when missing. */
  labelOffset?: Pt;
}

export type PocketEdge = 'none' | 'chamfer' | 'round';

/** How every pocket in a bin is cut. */
export interface CutoutStyle {
  /** Extra depth below the tool, mm (so it sits a little below the surface). */
  extraDepth: number;
  /** Top edge of the pocket. */
  edge: PocketEdge;
  /** Chamfer / round size, mm. */
  edgeSize: number;
  /** Finger notch diameter, mm. */
  notchDiameter: number;
  /** Label cap height, mm. */
  labelSize: number;
}

export const DEFAULT_CUTOUT_STYLE: CutoutStyle = {
  extraDepth: 0,
  edge: 'chamfer',
  edgeSize: 0.8,
  notchDiameter: 20,
  labelSize: 5,
};

/** Engraving depth for labels, mm. */
export const LABEL_DEPTH = 0.6;
/** Pockets never cut below the bin's floor (7 mm on standard feet; see binFloorZ). */
export const POCKET_MIN_FLOOR_Z = BASE_HEIGHT;
export const MAX_CUTOUTS = 40;
export const MAX_OUTLINE_POINTS = 2500;
const ROUND_SEGS = 32;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
};
const round = (v: number, k = 1000) => Math.round(v * k) / k;

function cleanPts(v: unknown, max: number): Pt[] {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v.slice(0, max)) {
    if (!Array.isArray(p)) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** Angle in (-180, 180]. */
export function normAngle(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return round(a, 1e4);
}

/** Validated cutouts; undefined when there are none (the bin is a normal bin then). */
export function sanitizeCutouts(v: unknown): BinCutout[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BinCutout[] = [];
  for (const c of v.slice(0, MAX_CUTOUTS)) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const outline = cleanPts(r.outline, MAX_OUTLINE_POINTS);
    if (outline.length < 3) continue;
    const cut: BinCutout = {
      toolId: String(r.toolId ?? ''),
      name: String(r.name ?? '').slice(0, 80),
      x: num(r.x, -1000, 1000, 0),
      y: num(r.y, -1000, 1000, 0),
      rotation: normAngle(num(r.rotation, -1e6, 1e6, 0)),
      outline,
      depth: num(r.depth, 0.2, 250, 10),
      clearance: num(r.clearance, 0, 10, 1),
    };
    if (Array.isArray(r.notches)) cut.notches = cleanPts(r.notches, 16);
    if (r.label) cut.label = true;
    const lo = cleanPts([r.labelOffset], 1)[0];
    if (lo) cut.labelOffset = lo;
    out.push(cut);
  }
  return out.length ? out : undefined;
}

export function sanitizeCutoutStyle(v: unknown): Partial<CutoutStyle> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const out: Partial<CutoutStyle> = {};
  if (r.extraDepth !== undefined) out.extraDepth = num(r.extraDepth, 0, 20, 0);
  if (r.edge !== undefined) out.edge = r.edge === 'none' || r.edge === 'round' ? r.edge : 'chamfer';
  if (r.edgeSize !== undefined) out.edgeSize = num(r.edgeSize, 0, 5, DEFAULT_CUTOUT_STYLE.edgeSize);
  if (r.notchDiameter !== undefined) out.notchDiameter = num(r.notchDiameter, 5, 60, DEFAULT_CUTOUT_STYLE.notchDiameter);
  if (r.labelSize !== undefined) out.labelSize = num(r.labelSize, 2, 20, DEFAULT_CUTOUT_STYLE.labelSize);
  return out;
}

/** The style with defaults filled in. */
export function cutoutStyle(o: Pick<BinOptions, 'cutoutStyle'>): CutoutStyle {
  return { ...DEFAULT_CUTOUT_STYLE, ...sanitizeCutoutStyle(o.cutoutStyle) };
}

/** 53-bit FNV-1a-style hash, base 36. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h1 >>> 0) * 2 ** 21 + ((h2 >>> 0) & 0x1fffff)).toString(36);
}

/** Extra binKey parts: [] unless the interior is 'cutouts', so other bins keep their keys. */
export function cutoutKeyPart(o: Pick<BinOptions, 'interior' | 'cutouts' | 'cutoutStyle'>): string[] {
  if (o.interior !== 'cutouts') return [];
  const list = o.cutouts ?? [];
  return [`T${list.length}x${hash(JSON.stringify([list, cutoutStyle(o)]))}`];
}

/** How far in from the outside of the bin the usable top opening starts (the lip's narrowest point). */
export function cutoutInset(lip: boolean, lipStyle: LipStyle = 'normal'): number {
  if (!lip) return WALL;
  return lipStyle === 'reduced' ? LIP_PROFILE.chamfer2 : LIP_DEPTH;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where pockets can go: the opening inside the walls (or the lip), centered on the bin. */
export function cutoutArea(W: number, D: number, lip: boolean, lipStyle: LipStyle = 'normal'): Rect {
  const i = cutoutInset(lip, lipStyle);
  return { x0: -W / 2 + i, y0: -D / 2 + i, x1: W / 2 - i, y1: D / 2 - i };
}

function rotatePt([x, y]: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/** A point in the tool's frame → bin coordinates. */
export function toBin(c: Pick<BinCutout, 'x' | 'y' | 'rotation'>, p: Pt): Pt {
  const [x, y] = rotatePt(p, c.rotation);
  return [x + c.x, y + c.y];
}

/** A point in bin coordinates → the tool's frame. */
export function toTool(c: Pick<BinCutout, 'x' | 'y' | 'rotation'>, p: Pt): Pt {
  return rotatePt([p[0] - c.x, p[1] - c.y], -c.rotation);
}

/** The tool outline where it sits in the bin. */
export function placedOutline(c: Pick<BinCutout, 'x' | 'y' | 'rotation' | 'outline'>): Pt[] {
  return c.outline.map((p) => toBin(c, p));
}

/** Bounding box of the pocket (outline + clearance) in bin coordinates. */
export function pocketBox(c: Pick<BinCutout, 'x' | 'y' | 'rotation' | 'outline' | 'clearance'>): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of placedOutline(c)) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const k = c.clearance;
  return { x0: x0 - k, y0: y0 - k, x1: x1 + k, y1: y1 + k };
}

/** Finger notch centers in bin coordinates. */
export function notchCenters(c: BinCutout): Pt[] {
  return (c.notches ?? []).map((p) => toBin(c, p));
}

/**
 * Two notches at the middle of the tool's long sides (where the outline
 * crosses its short center line), in the tool's frame.
 */
export function autoNotches(outline: Pt[]): Pt[] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of outline) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const alongX = x1 - x0 >= y1 - y0;
  const mid = alongX ? (x0 + x1) / 2 : (y0 + y1) / 2;
  const hits: number[] = [];
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j];
    const b = outline[i];
    const [pa, pb, qa, qb] = alongX ? [a[0], b[0], a[1], b[1]] : [a[1], b[1], a[0], b[0]];
    if ((pa <= mid && pb > mid) || (pb <= mid && pa > mid)) hits.push(qa + ((mid - pa) / (pb - pa)) * (qb - qa));
  }
  if (hits.length < 2) return [];
  const lo = Math.min(...hits);
  const hi = Math.max(...hits);
  return alongX
    ? [
        [round(mid, 100), round(hi, 100)],
        [round(mid, 100), round(lo, 100)],
      ]
    : [
        [round(hi, 100), round(mid, 100)],
        [round(lo, 100), round(mid, 100)],
      ];
}

/** Where a cutout's label goes (bin coordinates, text centered there). */
export function labelPlacement(c: BinCutout, style: CutoutStyle, area: Rect): { x: number; y: number; maxWidth: number } {
  const maxWidth = Math.max(5, area.x1 - area.x0 - 2);
  if (c.labelOffset) return { x: c.x + c.labelOffset[0], y: c.y + c.labelOffset[1], maxWidth };
  const box = pocketBox(c);
  const half = style.labelSize / 2;
  const gap = 1.5;
  let y = box.y0 - gap - half;
  // No room in front: put it behind the pocket.
  if (y - half < area.y0 + 0.5) y = box.y1 + gap + half;
  return { x: (box.x0 + box.x1) / 2, y, maxWidth };
}

/** Z of a pocket's floor, given the top of the fill and the bin's floor. */
export function pocketFloorZ(top: number, c: Pick<BinCutout, 'depth'>, style: CutoutStyle, floor = POCKET_MIN_FLOOR_Z): number {
  return Math.max(floor, top - c.depth - style.extraDepth);
}

/** Top of the solid fill pockets are cut into (what buildBin calls topInfill). */
export function fillTop(o: Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>): number {
  return binBodyHeight(o) - (o.lip ? LIP_SUPPORT_HEIGHT : 0);
}

/** Lowest a pocket may go: the bin's own floor. */
export function cutoutFloor(o: Partial<Pick<BinOptions, 'base'>>): number {
  return binFloorZ(o);
}

/** Deepest pocket that fits under `top` (the top of the fill). */
export function maxPocketDepth(top: number, floor = POCKET_MIN_FLOOR_Z): number {
  return Math.max(0, top - floor);
}

/**
 * What to subtract from the bin's solid fill (top at `top`): every pocket,
 * edge step, notch and label, clipped to the inside of the walls (the walls
 * and lip are added afterwards, so anything straying under them is filled back).
 */
export function cutoutCutters(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, top: number): Manifold[] {
  const st = cutoutStyle(o);
  const area = cutoutArea(W, D, o.lip, o.lipStyle);
  const floor = cutoutFloor(o);
  const out: Manifold[] = [];
  const above = top + 1;
  for (const c of o.cutouts ?? []) {
    if (c.outline.length < 3) continue;
    const tool = s.t(new w.CrossSection([placedOutline(c)], 'NonZero'));
    const pocket = c.clearance > 0 ? s.t(tool.offset(c.clearance, 'Round', 2, ROUND_SEGS)) : tool;
    if (pocket.isEmpty()) continue;
    const zb = pocketFloorZ(top, c, st, floor);
    if (zb >= top - 0.05) continue;
    out.push(s.t(pocket.extrude(above - zb).translate([0, 0, zb])));

    // Top edge: stacked offsets in ~0.2 mm steps (one per print layer).
    const e = Math.min(st.edgeSize, top - zb);
    if (st.edge !== 'none' && e > 0.05) {
      const n = Math.max(2, Math.ceil(e / 0.2));
      for (let k = 1; k <= n; k++) {
        const z = top - e + ((k - 1) * e) / n;
        const t = (k * e) / n;
        const grow = st.edge === 'chamfer' ? t : e - Math.sqrt(Math.max(0, e * e - t * t));
        if (grow < 0.01) continue;
        out.push(s.t(s.t(pocket.offset(grow, 'Round', 2, ROUND_SEGS)).extrude(above - z).translate([0, 0, z])));
      }
    }

    // Finger notches: round-bottomed holes, as deep as the pocket.
    const r = st.notchDiameter / 2;
    for (const [nx, ny] of notchCenters(c)) {
      const zc = zb + r;
      const ball = s.t(w.Manifold.sphere(r, ROUND_SEGS).translate([nx, ny, zc]));
      const shaft = s.t(w.Manifold.cylinder(Math.max(above - zc, 0.5), r, r, ROUND_SEGS).translate([nx, ny, Math.min(zc, above - 0.5)]));
      out.push(s.t(w.Manifold.hull([ball, shaft])));
    }

    // Name, engraved into the top surface.
    if (c.label && c.name.trim() && hasFont()) {
      const at = labelPlacement(c, st, area);
      const text = textOutline(c.name.trim(), { size: st.labelSize, maxWidth: at.maxWidth });
      const solid = textSolid(w, text, at.x, at.y, top - LABEL_DEPTH, LABEL_DEPTH + 1);
      if (solid) out.push(s.t(solid));
    }
  }
  if (!out.length) return out;
  // Keep everything inside the walls: below the wall's bottom edge (flat bases,
  // whose floor is lower) the fill itself is the outside of the bin.
  const inner = roundedRectRing(-W / 2 + WALL, -D / 2 + WALL, W / 2 - WALL, D / 2 - WALL, INNER_RADIUS);
  const keep = s.t(extrudePolygon(w, inner, floor - 1, above + 1));
  return [s.t(s.t(w.Manifold.union(out)).intersect(keep))];
}
