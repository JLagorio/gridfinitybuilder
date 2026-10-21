import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from './kernel';
import {
  BP_BOTTOM_CLEARANCE,
  BP_CELL_RADIUS,
  BP_MIN_FLOOR,
  BP_PROFILE,
  BP_PROFILE_DEPTH,
  BP_PROFILE_HEIGHT,
  CRUSH_RIBS,
  GRID,
  HOLE_OFFSET,
  MAGNET_CHAMFER,
  MAGNET_HOLE_DIAMETER,
  MAGNET_SLOT,
  PIECE_NUMBER,
  SCREW_JOIN,
  SKELETON,
  WEIGHTED,
} from './spec';
import { boxAt, cylinderAt, loftRoundedRect, ringAt, roundedRectRing, type CornerRadii, type LoftKnot } from './shapes';
import { jointSolid, lowSideOf, type ConnectorSite, type ConnectorStyle } from './connectors';
import { textRects, textSize } from './digits';
import { growRect, maskSet, rectsOverlap, voidRects, type Rect } from './mask';
import type { PieceDef } from '../layout/split';
import type { GridLayout } from '../layout/drawer';
import { padRecesses, type PadStyle } from './pads';

/**
 * 'frame': open bottom (a floor only when magnets or screws need one);
 * 'weighted': 6.4 mm floor with a weight pocket under each cell;
 * 'skeletonized': floor cut through between the corner bosses;
 * 'solid': closed floor.
 */
export type BaseplateStyle = 'frame' | 'weighted' | 'skeletonized' | 'solid';

export interface BaseplateOptions {
  /** Corner radius of the outside corners of the whole baseplate (drawer corners). */
  outerRadius: number;
  /** Trim off the knife-edge ridge on top of the walls (mm). */
  topTrim: number;
  /** Vertical clearance under the receptacle profile (spec: 0.35). */
  bottomClearance: number;
  /** Extra solid floor under everything (mm). */
  bottomPad: number;
  /** 45° chamfer on the outside bottom edge (elephant-foot relief). */
  bottomChamfer: number;
  style: BaseplateStyle;

  magnets: boolean;
  magnetDiameter: number;
  magnetHeight: number;
  /** Added to the magnet diameter for the pocket. */
  magnetFit: number;
  magnetSide: 'top' | 'bottom';
  /** Small through-hole under each top-side pocket to push magnets out. */
  magnetRelease: boolean;
  /** Press-fit crush ribs inside the pocket. */
  magnetRibs: boolean;
  /** 45° chamfer at the pocket mouth. */
  magnetChamfer: boolean;
  /** Slot beside each pocket to pry the magnet out. */
  magnetSlot: boolean;
  /** Floor thickness under the receptacles when magnets or screws are on. */
  holeFloor: number;

  screws: boolean;
  screwDiameter: number;
  screwHeadDiameter: number;

  /** How split pieces join along their seams. */
  connector: ConnectorStyle;
  /** Screw joints: hex nut slot or heat-set insert hole. */
  screwFastener: 'nut' | 'insert';
  /** Piece number debossed on the underside (mirrored, so it reads with the piece flipped over). */
  pieceNumbers: boolean;
  /** TPU non-slip pads in recesses underneath (pads.ts). Unset = none, so it isn't in DEFAULT_BASEPLATE or old keys. */
  pads?: PadStyle;
}

export const DEFAULT_BASEPLATE: BaseplateOptions = {
  outerRadius: 4,
  topTrim: 0.4,
  bottomClearance: BP_BOTTOM_CLEARANCE,
  bottomPad: 0,
  bottomChamfer: 0,
  style: 'frame',
  magnets: false,
  magnetDiameter: 6,
  magnetHeight: 2,
  magnetFit: 0.2,
  magnetSide: 'top',
  magnetRelease: false,
  magnetRibs: false,
  magnetChamfer: false,
  magnetSlot: false,
  holeFloor: 2.8,
  screws: false,
  screwDiameter: 3,
  screwHeadDiameter: 6,
  connector: 'none',
  screwFastener: 'nut',
  pieceNumbers: true,
};

const magnetDepth = (o: BaseplateOptions) => o.magnetHeight + 0.2;
const screwHoleR = (o: BaseplateOptions) => (o.screwDiameter + 0.3) / 2;
const screwHeadR = (o: BaseplateOptions) => Math.max(o.screwHeadDiameter / 2, screwHoleR(o) + 0.5);

/**
 * Where the screw holes go: the cell center ('frame', 'solid'), or the four
 * corner bosses ('weighted', 'skeletonized': the center is a weight pocket or
 * cut away), under top-loaded magnets. Corner screws don't combine with
 * bottom-loaded magnets.
 */
export function screwPlacement(o: BaseplateOptions): 'none' | 'center' | 'corner' {
  if (!o.screws) return 'none';
  if (o.style === 'weighted' || o.style === 'skeletonized') return o.magnets && o.magnetSide === 'bottom' ? 'none' : 'corner';
  return 'center';
}

/** Floor the holes need (before any extra pad). */
function holeFloorFor(o: BaseplateOptions): number {
  if (!o.magnets && !o.screws) return 0;
  if (screwPlacement(o) !== 'corner') return o.holeFloor;
  // Countersunk screw under the magnet: magnet, countersink, then some floor.
  const sink = screwHeadR(o) - screwHoleR(o);
  return Math.max(o.holeFloor, (o.magnets ? magnetDepth(o) : 0) + sink + 0.6);
}

const STYLE_FLOOR: Record<BaseplateStyle, number> = {
  frame: 0,
  solid: BP_MIN_FLOOR,
  skeletonized: BP_MIN_FLOOR,
  weighted: WEIGHTED.floor,
};

export function baseplateFloor(o: BaseplateOptions): number {
  const need = Math.max(holeFloorFor(o), STYLE_FLOOR[o.style] ?? 0, o.connector === 'screw' ? SCREW_JOIN.floor : 0);
  return o.bottomPad + need;
}

/** Total height of the baseplate. */
export function baseplateHeight(o: BaseplateOptions): number {
  const trim = Math.max(o.topTrim, 0.02); // never leave a zero-width ridge
  return baseplateFloor(o) + o.bottomClearance + BP_PROFILE_HEIGHT - trim;
}

/** Height a seated bin's bottom rests at (top of the floor). */
export function binSeatHeight(o: BaseplateOptions): number {
  return baseplateFloor(o);
}

/** The receptacle for one cell. `open` cuts it through the floor (open bottom). */
function cellCutout(w: Wasm, cx: number, cy: number, cw: number, cd: number, o: BaseplateOptions, open = false): Manifold {
  const floor = baseplateFloor(o);
  const z0 = floor + o.bottomClearance;
  const bottom = open || floor <= 0 ? -1 : floor;
  const knots: LoftKnot[] = [];
  knots.push({ z: bottom, inset: BP_PROFILE_DEPTH });
  if (z0 > bottom + 0.001) knots.push({ z: z0, inset: BP_PROFILE_DEPTH });
  knots.push({ z: z0 + BP_PROFILE.chamfer1, inset: BP_PROFILE.chamfer2 });
  knots.push({ z: z0 + BP_PROFILE.chamfer1 + BP_PROFILE.vertical, inset: BP_PROFILE.chamfer2 });
  knots.push({ z: z0 + BP_PROFILE_HEIGHT, inset: 0 });
  knots.push({ z: z0 + BP_PROFILE_HEIGHT + 1, inset: -1 });
  return loftRoundedRect(w, cx, cy, cw, cd, BP_CELL_RADIUS, knots);
}

/** Convex prism from a plan outline. */
function prism(w: Wasm, ring: Vec2[], z0: number, z1: number): Manifold {
  return w.Manifold.hull([...ringAt(ring, z0), ...ringAt(ring, z1)]);
}

/** A cylinder with crush ribs: the radius waves between `ri` and `ro` (Rebuilt ribbed_cylinder). */
function ribbedCylinder(w: Wasm, x: number, y: number, z0: number, z1: number, ro: number, ri: number, ribs: number): Manifold {
  const n = ribs * 8;
  const mid = (ro + ri) / 2;
  const amp = (ro - ri) / 2;
  const pts: Vec2[] = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    const r = mid + amp * Math.cos(ribs * a);
    return [x + r * Math.cos(a), y + r * Math.sin(a)];
  });
  return w.Manifold.extrude([pts], z1 - z0).translate([0, 0, z0]);
}

/** Outer radius of a magnet pocket (ribs included). */
function magnetPocketR(o: BaseplateOptions) {
  const r = (o.magnetDiameter + o.magnetFit) / 2;
  return o.magnetRibs ? Math.max(r, o.magnetDiameter / 2 + CRUSH_RIBS.relief) : r;
}

/** Biggest hole a corner boss has to hold. */
function cornerHoleR(o: BaseplateOptions) {
  let r = MAGNET_HOLE_DIAMETER / 2;
  if (o.magnets) r = Math.max(r, magnetPocketR(o) + (o.magnetChamfer ? MAGNET_CHAMFER : 0));
  if (screwPlacement(o) === 'corner') r = Math.max(r, screwHeadR(o));
  return r;
}

/** One magnet pocket at (hx, hy), with its extras. (dx, dy) points from the cell center to the hole. */
function magnetPocket(w: Wasm, s: Scope, o: BaseplateOptions, floor: number, hx: number, hy: number, dx: number, dy: number): Manifold[] {
  const out: Manifold[] = [];
  const top = o.magnetSide === 'top';
  const depth = magnetDepth(o);
  const z0 = top ? floor - depth : -1;
  const z1 = top ? floor + 0.5 : depth;
  const r = magnetPocketR(o);
  const c = o.magnetChamfer ? Math.min(MAGNET_CHAMFER, depth - 0.2) : 0;
  if (o.magnetRibs) {
    const ri = Math.min(o.magnetDiameter / 2 - CRUSH_RIBS.squeeze, r - 0.1);
    out.push(s.t(ribbedCylinder(w, hx, hy, z0, z1, r, ri, CRUSH_RIBS.count)));
    if (c > 0) {
      out.push(
        s.t(top ? cylinderAt(w, hx, hy, floor - c, floor + 0.01, r, r + c + 0.01) : cylinderAt(w, hx, hy, -0.01, c, r + c + 0.01, r)),
      );
    }
  } else if (c > 0) {
    // Pocket and 45° mouth in one convex solid.
    const circle = (rr: number, z: number) => ringAt(roundedRectRing(hx - rr, hy - rr, hx + rr, hy + rr, rr, 10), z);
    const rings = top
      ? [circle(r, z0), circle(r, floor - c), circle(r + c + 0.5, floor + 0.5)]
      : [circle(r + c + 1, -1), circle(r, c), circle(r, z1)];
    out.push(s.t(w.Manifold.hull(rings.flat())));
  } else {
    out.push(s.t(cylinderAt(w, hx, hy, z0, z1, r)));
  }
  if (o.magnetSlot) {
    // Toward the cell center, the full depth of the pocket.
    const len = Math.hypot(dx, dy);
    const [ux, uy] = [-dx / len, -dy / len];
    const [px, py] = [-uy, ux];
    const reach = r + MAGNET_SLOT.reach;
    const hw = MAGNET_SLOT.width / 2;
    const ring: Vec2[] = [
      [hx - px * hw, hy - py * hw],
      [hx + ux * reach - px * hw, hy + uy * reach - py * hw],
      [hx + ux * reach + px * hw, hy + uy * reach + py * hw],
      [hx + px * hw, hy + py * hw],
    ];
    out.push(s.t(prism(w, ring, z0, z1)));
  }
  if (top && o.magnetRelease) out.push(s.t(cylinderAt(w, hx, hy, -1, z0 + 0.01, 1.5, 1.5, 20)));
  return out;
}

/** Countersunk screw hole, head at `zHead` (the countersink opens upward there). */
function countersunkScrew(w: Wasm, s: Scope, o: BaseplateOptions, x: number, y: number, zHead: number, open: boolean): Manifold[] {
  const rh = screwHoleR(o);
  const rk = screwHeadR(o);
  const sink = Math.min(rk - rh, zHead - 0.4);
  const out = [
    s.t(cylinderAt(w, x, y, -1, zHead + (open ? 0.5 : 0.01), rh)),
    // 90° countersink, open toward the receptacle (or the magnet pocket above)
    s.t(cylinderAt(w, x, y, zHead - sink, zHead + 0.01, rk - sink, rk)),
  ];
  if (open) out.push(s.t(cylinderAt(w, x, y, zHead, zHead + 0.5, rk)));
  return out;
}

/** Weight pocket and channels under one cell, skipping what doesn't fit. */
function weightPockets(w: Wasm, s: Scope, cx: number, cy: number, cw: number, cd: number): Manifold[] {
  const out: Manifold[] = [];
  const wall = 2;
  const half = WEIGHTED.pocket / 2;
  if (Math.min(cw, cd) / 2 < half + wall) return out;
  out.push(s.t(boxAt(w, cx - half, cy - half, -1, cx + half, cy + half, WEIGHTED.pocketDepth)));
  const hw = WEIGHTED.channelWidth / 2;
  const a = WEIGHTED.channelAt - WEIGHTED.channelLength / 2;
  const b = WEIGHTED.channelAt + WEIGHTED.channelLength / 2;
  // Straight part plus a round end: convex, so a hull of (along, across) points.
  const outline: Vec2[] = [
    [a, -hw],
    [a, hw],
    ...Array.from({ length: 25 }, (_, k) => {
      const t = Math.PI / 2 - (Math.PI * k) / 24;
      return [b + hw * Math.cos(t), hw * Math.sin(t)] as Vec2;
    }),
  ];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if ((dx ? cw : cd) / 2 < b + hw + wall) continue;
    const ring = outline.map(([u, v]) => [cx + dx * u - dy * v, cy + dy * u + dx * v] as Vec2);
    out.push(s.t(prism(w, ring, -1, WEIGHTED.channelDepth)));
  }
  return out;
}

/** The skeleton cut under one full cell: a plus between the corner bosses, through the floor. */
function skeletonCut(w: Wasm, s: Scope, o: BaseplateOptions, floor: number, cx: number, cy: number, cw: number, cd: number): Manifold[] {
  const hx = cw / 2 - BP_PROFILE_DEPTH;
  const hy = cd / 2 - BP_PROFILE_DEPTH;
  const arm = Math.max(SKELETON.radius + 0.5, HOLE_OFFSET - cornerHoleR(o) - SKELETON.boss);
  const z1 = floor + 0.2;
  return [
    s.t(prism(w, roundedRectRing(cx - hx, cy - arm, cx + hx, cy + arm, SKELETON.radius), -1, z1)),
    s.t(prism(w, roundedRectRing(cx - arm, cy - hy, cx + arm, cy + hy, SKELETON.radius), -1, z1)),
  ];
}

/** A candidate spot for the piece number: center and whether the text runs along Y. */
interface NumberSpot {
  cx: number;
  cy: number;
  rot: boolean;
}

/**
 * Pick a solid spot on the underside for the piece number: a margin, an inner
 * wall, or a closed floor, clear of every hole and pocket. Null if none fits.
 */
function numberSpot(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, keepouts: Rect[], text: string): Rect[] | null {
  const m = PIECE_NUMBER.margin;
  const { xs, ys } = layout;
  const { cells, outer } = piece;
  const pcx = (piece.x0 + piece.x1) / 2;
  const pcy = (piece.y0 + piece.y1) / 2;
  const spots: NumberSpot[] = [];
  // Margins on the outside edges.
  if (outer.front && cells.y1 > cells.y0) spots.push({ cx: pcx, cy: (piece.y0 + ys[cells.y0]) / 2, rot: false });
  if (outer.back && cells.y1 > cells.y0) spots.push({ cx: pcx, cy: (ys[cells.y1] + piece.y1) / 2, rot: false });
  if (outer.left && cells.x1 > cells.x0) spots.push({ cx: (piece.x0 + xs[cells.x0]) / 2, cy: pcy, rot: true });
  if (outer.right && cells.x1 > cells.x0) spots.push({ cx: (xs[cells.x1] + piece.x1) / 2, cy: pcy, rot: true });
  if (cells.x1 <= cells.x0 || cells.y1 <= cells.y0) spots.push({ cx: pcx, cy: pcy, rot: piece.x1 - piece.x0 < piece.y1 - piece.y0 });
  // Inner walls, nearest the middle of the piece first; then cell undersides (closed floors).
  const inner: NumberSpot[] = [];
  for (let j = cells.y0 + 1; j < cells.y1; j++)
    for (let i = cells.x0; i < cells.x1; i++) inner.push({ cx: (xs[i] + xs[i + 1]) / 2, cy: ys[j], rot: false });
  for (let i = cells.x0 + 1; i < cells.x1; i++)
    for (let j = cells.y0; j < cells.y1; j++) inner.push({ cx: xs[i], cy: (ys[j] + ys[j + 1]) / 2, rot: true });
  const floors: NumberSpot[] = [];
  for (let i = cells.x0; i < cells.x1; i++)
    for (let j = cells.y0; j < cells.y1; j++) floors.push({ cx: (xs[i] + xs[i + 1]) / 2, cy: (ys[j] + ys[j + 1]) / 2, rot: false });
  const byCenter = (a: NumberSpot, b: NumberSpot) => Math.hypot(a.cx - pcx, a.cy - pcy) - Math.hypot(b.cx - pcx, b.cy - pcy);
  spots.push(...inner.sort(byCenter), ...floors.sort(byCenter));

  // Stay inside the bottom face: off the chamfer and the rounded corners.
  const c = Math.max(o.bottomChamfer, 0);
  const inset = (isOuter: boolean) => (isOuter ? c : 0) + m;
  const face = {
    x0: piece.x0 + inset(outer.left),
    x1: piece.x1 - inset(outer.right),
    y0: piece.y0 + inset(outer.front),
    y1: piece.y1 - inset(outer.back),
  };
  const R = Math.max(o.outerRadius, 0) + c;
  const corners: Rect[] = [];
  if (outer.left && outer.front) corners.push({ x0: piece.x0, y0: piece.y0, x1: piece.x0 + R, y1: piece.y0 + R });
  if (outer.right && outer.front) corners.push({ x0: piece.x1 - R, y0: piece.y0, x1: piece.x1, y1: piece.y0 + R });
  if (outer.right && outer.back) corners.push({ x0: piece.x1 - R, y0: piece.y1 - R, x1: piece.x1, y1: piece.y1 });
  if (outer.left && outer.back) corners.push({ x0: piece.x0, y0: piece.y1 - R, x1: piece.x0 + R, y1: piece.y1 });

  // The biggest digits that fit anywhere.
  for (const H of PIECE_NUMBER.heights) {
    const stroke = H / 6;
    const size = textSize(text, H, stroke);
    for (const sp of spots) {
      const [bw, bh] = sp.rot ? [size.h, size.w] : [size.w, size.h];
      const box: Rect = { x0: sp.cx - bw / 2, x1: sp.cx + bw / 2, y0: sp.cy - bh / 2, y1: sp.cy + bh / 2 };
      const grown = growRect(box, m);
      if (box.x0 < face.x0 || box.x1 > face.x1 || box.y0 < face.y0 || box.y1 > face.y1) continue;
      if (corners.some((r) => rectsOverlap(r, grown)) || keepouts.some((r) => rectsOverlap(r, grown))) continue;
      // Mirrored, so it reads right with the piece flipped over (about its Y axis).
      return textRects(text, H, stroke).map((g) =>
        sp.rot
          ? { x0: sp.cx + g.y0 - size.h / 2, x1: sp.cx + g.y1 - size.h / 2, y0: sp.cy + g.x0 - size.w / 2, y1: sp.cy + g.x1 - size.w / 2 }
          : { x0: sp.cx - g.x1 + size.w / 2, x1: sp.cx - g.x0 + size.w / 2, y0: sp.cy + g.y0 - size.h / 2, y1: sp.cy + g.y1 - size.h / 2 },
      );
    }
  }
  return null;
}


const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/**
 * Build one baseplate piece in plate coordinates (drawer front-left = origin).
 * `connectors` are the sites on this piece's seams (see connectorSites).
 * Returns a mesh; all WASM memory is released before returning.
 */
export function buildBaseplatePiece(
  w: Wasm,
  layout: GridLayout,
  piece: PieceDef,
  o: BaseplateOptions,
  connectors: ConnectorSite[] = [],
): MeshData {
  const s = new Scope();
  try {
    const top = baseplateHeight(o);
    const floor = baseplateFloor(o);
    const { x0, y0, x1, y1, outer } = piece;
    const m = layout.margins;

    // Outer corners are rounded only where the piece touches two drawer edges.
    // The radius can't exceed the cell radius plus the margin, or it would cut into a receptacle.
    const cap = (a: number, b: number) => Math.min(o.outerRadius, BP_CELL_RADIUS + Math.min(a, b));
    const radii: CornerRadii = [
      outer.left && outer.front ? cap(m.left, m.front) : 0,
      outer.right && outer.front ? cap(m.right, m.front) : 0,
      outer.right && outer.back ? cap(m.right, m.back) : 0,
      outer.left && outer.back ? cap(m.left, m.back) : 0,
    ];
    const ring = roundedRectRing(x0, y0, x1, y1, radii);
    const pts: Vec3[] = [...ringAt(ring, top)];
    const c = Math.min(o.bottomChamfer, top / 2);
    if (c > 0.01) {
      const inner = roundedRectRing(
        x0 + (outer.left ? c : 0),
        y0 + (outer.front ? c : 0),
        x1 - (outer.right ? c : 0),
        y1 - (outer.back ? c : 0),
        radii.map((r) => Math.max(r - c, 0)) as CornerRadii,
      );
      pts.push(...ringAt(inner, 0), ...ringAt(ring, c));
    } else {
      pts.push(...ringAt(ring, 0));
    }
    const slab = s.t(w.Manifold.hull(pts));

    // Receptacles, then everything else that is cut away (holes, pockets, joints).
    const cutouts: Manifold[] = [];
    const features: Manifold[] = [];
    const positives: Manifold[] = [];
    /** Underside regions with no floor (for the piece number). */
    const openings: Rect[] = [];
    const pieceRect: Rect = { x0, y0, x1, y1 };
    const voids = voidRects(layout).filter((r) => rectsOverlap(r, pieceRect));
    for (const r of voids) features.push(s.t(boxAt(w, r.x0, r.y0, -1, r.x1, r.y1, top + 1)));

    const masked = maskSet(layout);
    const sp = screwPlacement(o);
    for (let i = piece.cells.x0; i < piece.cells.x1; i++) {
      for (let j = piece.cells.y0; j < piece.cells.y1; j++) {
        // Blocked cells: flat solid, or cut out with the voids above.
        if (masked.has(`${i},${j}`)) continue;
        const cw = layout.xs[i + 1] - layout.xs[i];
        const cd = layout.ys[j + 1] - layout.ys[j];
        const cx = layout.xs[i] + cw / 2;
        const cy = layout.ys[j] + cd / 2;
        // Partial edge cells are too small for the corner holes.
        const full = Math.min(cw, cd) >= GRID - 1e-6;
        const open = floor <= 0 || (o.style === 'skeletonized' && !full);
        cutouts.push(s.t(cellCutout(w, cx, cy, cw, cd, o, open)));
        if (open) {
          const D = BP_PROFILE_DEPTH;
          openings.push({ x0: cx - cw / 2 + D, x1: cx + cw / 2 - D, y0: cy - cd / 2 + D, y1: cy + cd / 2 - D });
        }
        if (o.style === 'weighted') features.push(...weightPockets(w, s, cx, cy, cw, cd));
        if (o.style === 'skeletonized' && full) features.push(...skeletonCut(w, s, o, floor, cx, cy, cw, cd));

        if (full && floor > 0) {
          for (const [dx, dy] of CORNERS) {
            const hx = cx + dx * HOLE_OFFSET;
            const hy = cy + dy * HOLE_OFFSET;
            if (o.magnets) features.push(...magnetPocket(w, s, o, floor, hx, hy, dx, dy));
            if (sp === 'corner') {
              const under = o.magnets ? floor - magnetDepth(o) : floor;
              features.push(...countersunkScrew(w, s, o, hx, hy, under, !o.magnets));
            }
          }
        }
        if (sp === 'center' && floor > 0 && Math.min(cw, cd) >= o.screwHeadDiameter + 2 * BP_PROFILE_DEPTH) {
          features.push(...countersunkScrew(w, s, o, cx, cy, floor, true));
        }
      }
    }
    for (const site of connectors) {
      const j = jointSolid(w, s, site, o, floor, lowSideOf(site, piece));
      if (j.add) positives.push(j.add);
      if (j.cut) features.push(j.cut);
    }
    // Recesses for TPU non-slip pads (pads.ts); piece numbers keep clear of them.
    features.push(...padRecesses(w, s, layout, piece, o, connectors));

    const negatives = [...cutouts, ...features];
    if (o.pieceNumbers) {
      // Keep clear of the open cells and of anything that comes close to the underside.
      const keepouts = [...openings];
      for (const f of features) {
        const b = f.boundingBox();
        if (b.min[2] < PIECE_NUMBER.depth + 0.6) keepouts.push({ x0: b.min[0], y0: b.min[1], x1: b.max[0], y1: b.max[1] });
      }
      const glyphs = numberSpot(layout, piece, o, keepouts, String(piece.id));
      for (const g of glyphs ?? []) negatives.push(s.t(boxAt(w, g.x0, g.y0, -1, g.x1, g.y1, PIECE_NUMBER.depth)));
    }

    const body = positives.length ? s.t(w.Manifold.union([slab, ...positives])) : slab;
    const result = negatives.length ? s.t(body.subtract(s.t(w.Manifold.union(negatives)))) : body;
    assertValid(result, `baseplate piece ${piece.id}`);
    return toMeshData(result);
  } finally {
    s.dispose();
  }
}
