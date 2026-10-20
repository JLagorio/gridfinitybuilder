import { binSize, MIN_HEIGHT_UNITS, type BinOptions } from './geometry/bin';
import {
  autoNotches,
  cutoutArea,
  cutoutFloor,
  DEFAULT_CUTOUT_STYLE,
  MAX_OUTLINE_POINTS,
  maxPocketDepth,
  placedOutline,
  pocketBox,
  type BinCutout,
  type Pt,
  type Rect,
} from './geometry/cutouts';
import { BASE_HEIGHT, GRID, HEIGHT_UNIT, LIP_SUPPORT_HEIGHT } from './geometry/spec';
import { cellSizes, type GridLayout } from './layout/drawer';
import { binFloorZ, type BaseStyle, type LipStyle } from './geometry/variants';
import { boundariesWithin, boundaryDistance, bounds, dedupe, polygonsIntersect, signedArea, simplifyClosed } from './trace/polygon';
import { canPlace, newId } from './bins';
import type { PlacedBin } from './project';

/** A traced or imported tool in the library. */
export interface Tool {
  id: string;
  name: string;
  /** mm, counter-clockwise, origin at the outline's bounding-box center. */
  outline: Pt[];
  /** How deep the pocket is = the tool's thickness, mm. */
  depth: number;
  /** Gap around the tool in its pocket, mm. */
  clearance: number;
}

export const DEFAULT_TOOL_DEPTH = 10;
export const DEFAULT_CLEARANCE = 1;
/**
 * Extra solid kept between pockets and the opening's edge by "Make a bin"
 * (on top of the 1.65 mm the lip already leaves between the opening and the wall).
 */
export const FIT_MARGIN = 1.5;
/** Gap between neighbouring pockets laid out by "Make a bin". */
export const FIT_GAP = 4;

/** Counter-clockwise, centered on its bounding box, rounded to 0.01 mm, at most MAX_OUTLINE_POINTS. */
export function normalizeOutline(pts: Pt[]): Pt[] {
  let p = dedupe(pts.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])));
  if (p.length < 3) return [];
  for (let eps = 0.02; p.length > MAX_OUTLINE_POINTS; eps *= 2) p = simplifyClosed(p, eps);
  if (signedArea(p) < 0) p = p.slice().reverse();
  const b = bounds(p);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return dedupe(p.map(([x, y]) => [Math.round((x - cx) * 100) / 100, Math.round((y - cy) * 100) / 100] as Pt));
}

const num = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export function cleanTool(v: unknown): Tool | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const raw = Array.isArray(r.outline) ? (r.outline as unknown[]).filter(Array.isArray).map((p) => [Number((p as unknown[])[0]), Number((p as unknown[])[1])] as Pt) : [];
  const outline = normalizeOutline(raw);
  if (outline.length < 3) return null;
  return {
    id: String(r.id ?? newId()),
    name: String(r.name ?? 'Tool').slice(0, 80) || 'Tool',
    outline,
    depth: num(r.depth, 0.2, 250, DEFAULT_TOOL_DEPTH),
    clearance: num(r.clearance, 0, 10, DEFAULT_CLEARANCE),
  };
}

export function cleanTools(v: unknown): Tool[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of v) {
    const c = cleanTool(t);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Library + incoming tools: same id takes the incoming version, new ones are appended. */
export function mergeTools(current: Tool[], incoming: Tool[]): Tool[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const out = current.map((t) => byId.get(t.id) ?? t);
  for (const t of incoming) if (!current.some((c) => c.id === t.id)) out.push(t);
  return out;
}

/** Outline bounding-box size, mm. */
export function toolSize(t: Pick<Tool, 'outline'>): { w: number; d: number } {
  const b = bounds(t.outline);
  return { w: b.x1 - b.x0, d: b.y1 - b.y0 };
}

/** A new pocket for a tool, at (x, y) in the bin with the given rotation. */
export function cutoutFromTool(t: Tool, x = 0, y = 0, rotation = 0): BinCutout {
  return {
    toolId: t.id,
    name: t.name,
    x,
    y,
    rotation,
    outline: t.outline,
    depth: t.depth,
    clearance: t.clearance,
    notches: autoNotches(t.outline),
  };
}

/** Refresh the copies of a tool inside placed bins. Returns the same array when nothing changed. */
export function syncToolInBins(bins: PlacedBin[], t: Tool): PlacedBin[] {
  let changed = false;
  const out = bins.map((b) => {
    if (!b.opts.cutouts?.some((c) => c.toolId === t.id)) return b;
    changed = true;
    const outlineChanged = (c: BinCutout) => c.outline !== t.outline && JSON.stringify(c.outline) !== JSON.stringify(t.outline);
    const cutouts = b.opts.cutouts.map((c) =>
      c.toolId === t.id
        ? {
            ...c,
            name: t.name,
            outline: t.outline,
            depth: t.depth,
            clearance: t.clearance,
            // Notches were placed on the old outline.
            ...(outlineChanged(c) ? { notches: autoNotches(t.outline) } : {}),
          }
        : c,
    );
    return { ...b, opts: { ...b.opts, cutouts } };
  });
  return changed ? out : bins;
}

/** Drop a tool's pockets from placed bins. Returns the same array when nothing changed. */
export function removeToolFromBins(bins: PlacedBin[], toolId: string): PlacedBin[] {
  if (!bins.some((b) => b.opts.cutouts?.some((c) => c.toolId === toolId))) return bins;
  return bins.map((b) => {
    if (!b.opts.cutouts?.some((c) => c.toolId === toolId)) return b;
    const cutouts = b.opts.cutouts.filter((c) => c.toolId !== toolId);
    return { ...b, opts: { ...b.opts, cutouts: cutouts.length ? cutouts : undefined } };
  });
}

/** How many bins (in any drawer) use a tool. */
export function toolUsage(bins: PlacedBin[], toolId: string): number {
  return bins.filter((b) => b.opts.cutouts?.some((c) => c.toolId === toolId)).length;
}

/** Height units needed for a pocket this deep (plus the bin's floor and lip support). */
export function heightUnitsFor(depth: number, lip: boolean, extraDepth = 0, floor = BASE_HEIGHT): number {
  const need = floor + depth + extraDepth + (lip ? LIP_SUPPORT_HEIGHT : 0);
  return Math.max(MIN_HEIGHT_UNITS, Math.ceil(need / HEIGHT_UNIT - 1e-9));
}

/** Grid units needed along one axis for `extent` mm of pockets. */
function unitsFor(extent: number, lip: boolean, margin: number, lipStyle: LipStyle = 'normal'): number {
  for (let n = 1; n < 100; n++) {
    const a = cutoutArea(binSize({ unitsX: n, unitsY: 1 }).w, 10, lip, lipStyle);
    if (a.x1 - a.x0 - 2 * margin >= extent - 1e-6) return n;
  }
  return 100;
}

/** Pocket size (outline + clearance) at a rotation. */
function pocketSize(t: Tool, rotation: number) {
  const b = pocketBox({ x: 0, y: 0, rotation, outline: t.outline, clearance: t.clearance });
  return { w: b.x1 - b.x0, d: b.y1 - b.y0, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

/** Rotation (0..175°, 5° steps) giving the smallest bounding box. */
function bestRotation(t: Tool, prefer: 'tall' | 'wide' | 'any'): number {
  let best = 0;
  let bestScore = Infinity;
  for (let r = 0; r < 180; r += 5) {
    const s = pocketSize(t, r);
    const area = s.w * s.d;
    // Prefer axis-aligned orientations when they cost little.
    const score = area * (r % 90 === 0 ? 0.97 : 1) + (prefer === 'tall' && s.w > s.d ? area : 0) + (prefer === 'wide' && s.d > s.w ? area : 0);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export interface BinFit {
  unitsX: number;
  unitsY: number;
  heightUnits: number;
  cutouts: BinCutout[];
  /** False when the result is bigger than a bin can be (12 × 12 units). */
  fits: boolean;
}

/**
 * The smallest bin holding these tools with `margin` mm of material around
 * the pockets: one tool at its best rotation, or several side by side in a
 * row or a column, whichever needs fewer grid cells.
 */
export function fitBinForTools(
  tools: Tool[],
  o: { lip: boolean; lipStyle?: LipStyle; base?: BaseStyle; extraDepth?: number; margin?: number; gap?: number } = { lip: true },
): BinFit {
  const margin = o.margin ?? FIT_MARGIN;
  const gap = o.gap ?? FIT_GAP;
  const extraDepth = o.extraDepth ?? DEFAULT_CUTOUT_STYLE.extraDepth;
  const heightUnits = heightUnitsFor(Math.max(0, ...tools.map((t) => t.depth)), o.lip, extraDepth, binFloorZ(o));
  const layouts: { ux: number; uy: number; cutouts: BinCutout[] }[] = [];
  const arrange = (dir: 'row' | 'col' | 'single') => {
    const rots = tools.map((t) => bestRotation(t, dir === 'row' ? 'tall' : dir === 'col' ? 'wide' : 'any'));
    const sizes = tools.map((t, i) => pocketSize(t, rots[i]));
    const along = sizes.reduce((s, z) => s + (dir === 'col' ? z.d : z.w), 0) + gap * (tools.length - 1);
    const across = Math.max(...sizes.map((z) => (dir === 'col' ? z.w : z.d)));
    const ux = unitsFor(dir === 'col' ? across : along, o.lip, margin, o.lipStyle);
    const uy = unitsFor(dir === 'col' ? along : across, o.lip, margin, o.lipStyle);
    // Lay the pockets out centered in the bin.
    let pos = -along / 2;
    const cutouts = tools.map((t, i) => {
      const z = sizes[i];
      const len = dir === 'col' ? z.d : z.w;
      const mid = pos + len / 2;
      pos += len + gap;
      // Offset so the pocket's box (not the outline's) is centered at `mid`.
      const x = dir === 'col' ? -z.cx : mid - z.cx;
      const y = dir === 'col' ? -mid - z.cy : -z.cy;
      return cutoutFromTool(t, round2(x), round2(y), rots[i]);
    });
    layouts.push({ ux, uy, cutouts });
  };
  if (tools.length === 1) arrange('single');
  else {
    arrange('row');
    arrange('col');
  }
  const best = layouts.reduce((a, b) => (b.ux * b.uy < a.ux * a.uy || (b.ux * b.uy === a.ux * a.uy && Math.max(b.ux, b.uy) < Math.max(a.ux, a.uy)) ? b : a));
  return { unitsX: best.ux, unitsY: best.uy, heightUnits, cutouts: best.cutouts, fits: best.ux <= 12 && best.uy <= 12 };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** First free spot for a w × d bin, preferring spots on full grid cells. */
export function firstFreeSpot(layout: GridLayout, bins: PlacedBin[], w: number, d: number): { x: number; y: number } | null {
  const { nx, ny } = layout;
  let fallback: { x: number; y: number } | null = null;
  for (let j = 0; j + d <= ny; j++) {
    for (let i = 0; i + w <= nx; i++) {
      if (!canPlace(bins, { x: i, y: j, w, d }, nx, ny)) continue;
      const full = [...cellSizes(layout.xs, i, w, layout.pitchX), ...cellSizes(layout.ys, j, d, layout.pitchY)].every((v) => Math.abs(v - GRID) < 1e-6);
      if (full) return { x: i, y: j };
      fallback ??= { x: i, y: j };
    }
  }
  return fallback;
}

/** Bin options for "make a bin for these tools" (merged over the new-bin defaults). */
export function binOptsForTools(fit: BinFit): Partial<BinOptions> {
  return { unitsX: fit.unitsX, unitsY: fit.unitsY, heightUnits: fit.heightUnits, heightMode: 'units', divX: 1, divY: 1, interior: 'cutouts', cutouts: fit.cutouts };
}

/** Two pockets closer than `gap` mm (edge to edge, clearances included), or overlapping. */
export function pocketsClash(a: BinCutout, b: BinCutout, gap = 0): boolean {
  const ba = pocketBox(a);
  const bb = pocketBox(b);
  if (ba.x1 + gap <= bb.x0 || bb.x1 + gap <= ba.x0 || ba.y1 + gap <= bb.y0 || bb.y1 + gap <= ba.y0) return false;
  const pa = placedOutline(a);
  const pb = placedOutline(b);
  return polygonsIntersect(pa, pb) || boundaryDistance(pa, pb).d < a.clearance + b.clearance + gap;
}

/** Edge-to-edge distance between two pockets (0 when they overlap), with the closest points on the tool outlines. */
export function pocketGap(a: BinCutout, b: BinCutout): { d: number; pa: Pt; pb: Pt } {
  const pa = placedOutline(a);
  const pb = placedOutline(b);
  const r = boundaryDistance(pa, pb);
  const d = polygonsIntersect(pa, pb) ? 0 : Math.max(0, r.d - a.clearance - b.clearance);
  return { ...r, d };
}

export interface CutoutIssues {
  /** The pocket pokes outside the opening (into a wall or the lip). */
  outside: boolean;
  /** Indexes of pockets this one overlaps. */
  overlaps: number[];
  /** The bin isn't tall enough for the full depth. */
  tooDeep: boolean;
}

/** Problems with each pocket in a bin (for warnings in the editor). `top` is the top of the fill (mm). */
export function cutoutIssues(o: BinOptions, W: number, D: number, top: number): CutoutIssues[] {
  const cs = o.cutouts ?? [];
  const area = cutoutArea(W, D, o.lip, o.lipStyle);
  const extra = { ...DEFAULT_CUTOUT_STYLE, ...o.cutoutStyle }.extraDepth;
  const room = maxPocketDepth(top, cutoutFloor(o));
  return cs.map((c, i) => {
    const b = pocketBox(c);
    const eps = 1e-3;
    return {
      outside: b.x0 < area.x0 - eps || b.y0 < area.y0 - eps || b.x1 > area.x1 + eps || b.y1 > area.y1 + eps,
      overlaps: cs.map((d, j) => (j !== i && pocketsClash(c, d) ? j : -1)).filter((j) => j >= 0),
      tooDeep: c.depth + extra > room + 1e-6,
    };
  });
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** Lines to draw: x = const and y = const (bin coordinates). */
  guidesX: number[];
  guidesY: number[];
}

/**
 * Snap a pocket being dragged: its box's edges or center to the bin's center
 * lines, the opening's edges, other pockets' edges and centers, or `gap` mm
 * from another pocket. Each axis snaps on its own, within `tol` mm.
 */
export function snapCutout(c: BinCutout, others: BinCutout[], area: Rect, tol: number, gap = FIT_GAP): SnapResult {
  const b = pocketBox(c);
  type Cand = { from: number; to: number };
  const mid = (lo: number, hi: number) => (lo + hi) / 2;
  const xs: Cand[] = [
    { from: mid(b.x0, b.x1), to: 0 },
    { from: b.x0, to: area.x0 },
    { from: b.x1, to: area.x1 },
  ];
  const ys: Cand[] = [
    { from: mid(b.y0, b.y1), to: 0 },
    { from: b.y0, to: area.y0 },
    { from: b.y1, to: area.y1 },
  ];
  for (const o of others) {
    const ob = pocketBox(o);
    xs.push(
      { from: b.x0, to: ob.x0 },
      { from: b.x1, to: ob.x1 },
      { from: mid(b.x0, b.x1), to: mid(ob.x0, ob.x1) },
      { from: b.x0, to: ob.x1 + gap },
      { from: b.x1, to: ob.x0 - gap },
    );
    ys.push(
      { from: b.y0, to: ob.y0 },
      { from: b.y1, to: ob.y1 },
      { from: mid(b.y0, b.y1), to: mid(ob.y0, ob.y1) },
      { from: b.y0, to: ob.y1 + gap },
      { from: b.y1, to: ob.y0 - gap },
    );
  }
  const best = (cands: Cand[]) => {
    let d: number | null = null;
    for (const k of cands) {
      const v = k.to - k.from;
      if (Math.abs(v) <= tol && (d === null || Math.abs(v) < Math.abs(d))) d = v;
    }
    return d;
  };
  const dx = best(xs);
  const dy = best(ys);
  const guides = (cands: Cand[], d: number | null) => (d === null ? [] : [...new Set(cands.filter((k) => Math.abs(k.to - k.from - d) < 1e-6).map((k) => k.to))]);
  return { dx: dx ?? 0, dy: dy ?? 0, guidesX: guides(xs, dx), guidesY: guides(ys, dy) };
}

/**
 * Somewhere free for a new pocket: the spot nearest the bin's center (0° or
 * 90°) whose pocket stays inside the opening and `gap` mm clear of the others.
 * Falls back to the center.
 */
export function findFreePlacement(cutouts: BinCutout[], t: Tool, area: Rect, gap = FIT_GAP): { x: number; y: number; rotation: number } {
  const step = 2;
  const others = cutouts.map((d) => ({ d, box: pocketBox(d), pts: placedOutline(d) }));
  const options = [0, 90].flatMap((rotation) => {
    const probe = cutoutFromTool(t, 0, 0, rotation);
    const b = pocketBox(probe);
    // Allowed range for the cutout origin so the pocket box stays inside.
    const xlo = area.x0 - b.x0;
    const xhi = area.x1 - b.x1;
    const ylo = area.y0 - b.y0;
    const yhi = area.y1 - b.y1;
    if (xlo > xhi + 1e-6 || ylo > yhi + 1e-6) return [];
    const cands: Pt[] = [];
    for (let x = Math.ceil(xlo / step) * step; x <= xhi + 1e-6; x += step) {
      for (let y = Math.ceil(ylo / step) * step; y <= yhi + 1e-6; y += step) cands.push([x, y]);
    }
    if (!cands.length) cands.push([(xlo + xhi) / 2, (ylo + yhi) / 2]);
    cands.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    return [{ rotation, b, pts: placedOutline(probe), cands }];
  });
  const nearby = (b: Rect, x: number, y: number) =>
    others.filter(({ box }) => !(b.x1 + x + gap <= box.x0 || box.x1 + gap <= b.x0 + x || b.y1 + y + gap <= box.y0 || box.y1 + gap <= b.y0 + y));
  // First choice: clear of every other pocket's bounding box.
  for (const o of options) for (const [x, y] of o.cands) if (!nearby(o.b, x, y).length) return { x, y, rotation: o.rotation };
  // Then: clear of their actual outlines (tucked beside a shaft, say).
  let budget = 5000;
  for (const o of options) {
    for (const [x, y] of o.cands) {
      const pts = o.pts.map(([px, py]) => [px + x, py + y] as Pt);
      const clash = nearby(o.b, x, y).some((n) => polygonsIntersect(pts, n.pts) || boundariesWithin(pts, n.pts, t.clearance + n.d.clearance + gap));
      if (!clash) return { x, y, rotation: o.rotation };
      if (--budget <= 0) return { x: 0, y: 0, rotation: 0 };
    }
  }
  return { x: 0, y: 0, rotation: 0 };
}
