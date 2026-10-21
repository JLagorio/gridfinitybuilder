/**
 * TPU non-slip pads for the baseplate (BaseplateOptions.pads): shallow
 * recesses in its underside, and matching pads printed separately in TPU that
 * press into them and stand PAD.proud below the plate, so it doesn't slide
 * around in the drawer.
 *
 * - dots: a round pad at every cell corner, where the walls of four cells
 *   meet (the plate is solid there in every style, frames included).
 * - strips: a strip along every line between two rows of cells, under the
 *   wall (along the columns when there's only one row).
 *
 * Recesses stay PAD.edge clear of the outside (and its chamfer and rounded
 * corners), of the seams between pieces, of cut-out cells and of the seam
 * joints, so every pad sits in one piece. A dot or a strip end at a seam is
 * left out or shortened.
 *
 * Planning is pure; the piece builder (baseplate.ts) cuts `padRecesses`.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { BP_CELL_RADIUS, CONNECTOR_MIN_WALL } from './spec';
import { cylinderAt } from './shapes';
import { jointFootprint, sitesOnPiece, type ConnectorSite } from './connectors';
import { growRect, rectsOverlap, voidRects, type Rect } from './mask';
import type { BaseplateOptions } from './baseplate';
import type { GridLayout } from '../layout/drawer';
import type { PieceDef } from '../layout/split';

export type PadStyle = 'dots' | 'strips';
export const PAD_STYLES: readonly PadStyle[] = ['dots', 'strips'];

export const PAD = {
  /** Recess depth into the underside. */
  depth: 1,
  /** How far a pad stands below the plate. */
  proud: 0.8,
  /** Dot recess diameter (a frame's corner post leaves ~0.85 mm around it at the recess top). */
  dot: 6,
  /** Strip recess width (under a frame's 4.4 mm wall foot). */
  strip: 2.6,
  /** Pads are this much smaller than their recess per side (TPU presses in). */
  fit: 0.05,
  /** Plastic kept between a recess and the outside, a seam, a cut-out cell or a joint. */
  edge: 0.8,
  /** Shortest strip. */
  minStrip: 10,
  /** Elephant-foot chamfer on the pad's bottom edge. */
  footChamfer: 0.3,
} as const;

/** A recess: a dot centered at (x, y), or a strip with rounded ends from (x0, y0) to (x1, y1) (plate mm). */
export type PadSite = { kind: 'dot'; x: number; y: number } | { kind: 'strip'; x0: number; y0: number; x1: number; y1: number };

export interface PadPart {
  type: 'pad';
  /** Recess size: diameter (dots), or length and width (strips, ends included). */
  length: number;
  width: number;
}

/** The pad style, or null for none (anything else, like old projects, is none). */
export function padStyle(o: Partial<Pick<BaseplateOptions, 'pads'>>): PadStyle | null {
  return PAD_STYLES.includes(o.pads as PadStyle) ? (o.pads as PadStyle) : null;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What a recess at a site must stay inside of and clear of, for one piece. */
function keepouts(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[]) {
  const e = PAD.edge;
  const c = Math.max(0, o.bottomChamfer);
  const { outer } = piece;
  // Inside the piece's bottom face, off the chamfer on outside edges, clear of seams.
  const face: Rect = {
    x0: piece.x0 + e + (outer.left ? c : 0),
    x1: piece.x1 - e - (outer.right ? c : 0),
    y0: piece.y0 + e + (outer.front ? c : 0),
    y1: piece.y1 - e - (outer.back ? c : 0),
  };
  // Rounded outside corners (the radius is at most outerRadius; see buildBaseplatePiece).
  const m = layout.margins;
  const R = (a: number, b: number) => Math.min(Math.max(0, o.outerRadius), BP_CELL_RADIUS + Math.min(a, b));
  const corners: { cx: number; cy: number; r: number; sx: number; sy: number }[] = [];
  const add = (on: boolean, x: number, y: number, sx: number, sy: number, r: number) => {
    if (on && r > 0) corners.push({ cx: x + sx * r, cy: y + sy * r, r, sx, sy });
  };
  add(outer.left && outer.front, piece.x0, piece.y0, 1, 1, R(m.left, m.front));
  add(outer.right && outer.front, piece.x1, piece.y0, -1, 1, R(m.right, m.front));
  add(outer.right && outer.back, piece.x1, piece.y1, -1, -1, R(m.right, m.back));
  add(outer.left && outer.back, piece.x0, piece.y1, 1, -1, R(m.left, m.back));
  const blocked = [
    ...voidRects(layout).map((r) => growRect(r, e)),
    ...connectors.flatMap((s) => {
      const f = jointFootprint(s, o, CONNECTOR_MIN_WALL);
      return f ? [growRect(f, e)] : [];
    }),
  ];
  /** A point at distance `r` (a disc) clear of the rounded corners. */
  const inCorners = (x: number, y: number, r: number) =>
    corners.every((k) => (x - k.cx) * k.sx >= 0 || (y - k.cy) * k.sy >= 0 || Math.hypot(x - k.cx, y - k.cy) + r + e + c <= k.r);
  return { face, blocked, inCorners };
}

/** Where the piece's pad recesses go (plate mm). `connectors` are the joints on its seams. */
export function padSites(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []): PadSite[] {
  const style = padStyle(o);
  if (!style) return [];
  const { face, blocked, inCorners } = keepouts(layout, piece, o, connectors);
  const { xs, ys } = layout;
  const out: PadSite[] = [];
  if (style === 'dots') {
    const r = PAD.dot / 2;
    for (const x of xs) {
      for (const y of ys) {
        const box: Rect = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
        if (box.x0 < face.x0 || box.x1 > face.x1 || box.y0 < face.y0 || box.y1 > face.y1) continue;
        if (!inCorners(x, y, r) || blocked.some((b) => rectsOverlap(b, box))) continue;
        out.push({ kind: 'dot', x: r3(x), y: r3(y) });
      }
    }
    return out;
  }
  const hw = PAD.strip / 2;
  // Between rows; along the columns when there is only one row.
  const alongX = ys.length > 2;
  const lines = (alongX ? ys : xs).slice(1, -1);
  for (const v of lines) {
    const [lo, hi] = alongX ? [face.y0, face.y1] : [face.x0, face.x1];
    if (v - hw < lo || v + hw > hi) continue;
    // The run along the line, less what's blocked (its ends rounded: keep hw clear past them).
    let a = (alongX ? face.x0 : face.y0) + hw;
    let b = (alongX ? face.x1 : face.y1) - hw;
    // Stay out of the rounded corners at the run's ends.
    while (a < b && !inCorners(alongX ? a : v, alongX ? v : a, hw)) a += 0.5;
    while (b > a && !inCorners(alongX ? b : v, alongX ? v : b, hw)) b -= 0.5;
    let runs: [number, number][] = [[a, b]];
    for (const k of blocked) {
      const [k0, k1, c0, c1] = alongX ? [k.x0, k.x1, k.y0, k.y1] : [k.y0, k.y1, k.x0, k.x1];
      if (c1 <= v - hw || c0 >= v + hw) continue;
      runs = runs.flatMap(([p, q]): [number, number][] => {
        if (k1 + hw <= p || k0 - hw >= q) return [[p, q]];
        const parts: [number, number][] = [];
        if (k0 - hw > p) parts.push([p, k0 - hw]);
        if (k1 + hw < q) parts.push([k1 + hw, q]);
        return parts;
      });
    }
    for (const [p, q] of runs) {
      if (q - p + 2 * hw < PAD.minStrip) continue;
      out.push(alongX ? { kind: 'strip', x0: r3(p), y0: r3(v), x1: r3(q), y1: r3(v) } : { kind: 'strip', x0: r3(v), y0: r3(p), x1: r3(v), y1: r3(q) });
    }
  }
  return out;
}

/** A dot or strip (stadium) solid at a site, `grow` larger per side, from z0 to z1. */
function siteSolid(w: Wasm, s: Scope, p: PadSite, grow: number, z0: number, z1: number): Manifold {
  if (p.kind === 'dot') return s.t(cylinderAt(w, p.x, p.y, z0, z1, PAD.dot / 2 + grow, PAD.dot / 2 + grow, 48));
  const r = PAD.strip / 2 + grow;
  return s.t(w.Manifold.hull([s.t(cylinderAt(w, p.x0, p.y0, z0, z1, r, r, 32)), s.t(cylinderAt(w, p.x1, p.y1, z0, z1, r, r, 32))]));
}

/** The piece's pad recesses (plate mm), for buildBaseplatePiece to cut. None when pads are off. */
export function padRecesses(w: Wasm, s: Scope, layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []): Manifold[] {
  return padSites(layout, piece, o, connectors).map((p) => siteSolid(w, s, p, 0, -1, PAD.depth));
}

export const padThickness = () => PAD.depth + PAD.proud;

/** The pad for a recess. */
export function padPartFor(p: PadSite): PadPart {
  if (p.kind === 'dot') return { type: 'pad', length: PAD.dot, width: PAD.dot };
  return { type: 'pad', length: r3(Math.hypot(p.x1 - p.x0, p.y1 - p.y0) + PAD.strip), width: PAD.strip };
}

export const padPartKey = (p: PadPart) => `pad|${JSON.stringify([p.length, p.width, PAD.fit, padThickness()])}`;

/** "Non-slip pad Ø5.9 mm (TPU)", "Non-slip strip 2.5 × 120 mm (TPU)": the printed size. */
export function padPartName(p: PadPart): string {
  const f = (v: number) => String(Math.round(v * 10) / 10);
  const g = 2 * PAD.fit;
  return p.length === p.width ? `Non-slip pad Ø${f(p.width - g)} mm (TPU)` : `Non-slip strip ${f(p.width - g)} × ${f(p.length - g)} mm (TPU)`;
}

/** Every pad a split baseplate needs, piece by piece (`sites`: every joint on its seams). */
export function baseplatePads(layout: GridLayout, pieces: PieceDef[], o: BaseplateOptions, sites: ConnectorSite[]): { piece: number; site: PadSite; part: PadPart }[] {
  if (!padStyle(o)) return [];
  return pieces.flatMap((piece) => padSites(layout, piece, o, sitesOnPiece(sites, piece)).map((site) => ({ piece: piece.id, site, part: padPartFor(site) })));
}

/** Build a pad lying flat, min corner of its footprint at the origin. */
export function buildPad(w: Wasm, p: PadPart): MeshData {
  const s = new Scope();
  try {
    const H = padThickness();
    const r = p.width / 2 - PAD.fit;
    const e = Math.min(PAD.footChamfer, r / 2);
    const len = p.length - p.width;
    const at = (x: number, z0: number, z1: number, r0: number, r1: number) => s.t(cylinderAt(w, x, 0, z0, z1, r0, r1, 48));
    const parts = (x: number) => [at(x, 0, e, r - e, r), at(x, e, H, r, r)];
    const pad = s.t(w.Manifold.hull([...parts(0), ...(len > 0 ? parts(len) : [])]));
    const out = s.t(pad.translate([p.width / 2, p.width / 2, 0]));
    assertValid(out, 'pad');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}
