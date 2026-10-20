import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from './kernel';
import {
  BOWTIE,
  BOWTIE_CLEARANCE,
  BOWTIE_KEY_CHAMFER,
  BOWTIE_KEY_RECESS,
  BP_PROFILE,
  CONNECTOR_MIN_WALL,
  CONNECTOR_SPACING,
  PIN,
  PUZZLE,
  PUZZLE_PROTRUSION,
  SCREW_JOIN,
} from './spec';
import { boxAt } from './shapes';
import { rectsOverlap, voidRects, type Rect } from './mask';
import type { BaseplateOptions } from './baseplate';
import type { GridLayout } from '../layout/drawer';
import type { PieceDef } from '../layout/split';

/**
 * How split pieces join: 'bowtie' pockets with separate keys, 'pin' holes for
 * cut filament pins, 'puzzle' tabs on the pieces themselves, or 'screw'
 * (M3 screws across the seam with nut or insert slots).
 */
export type ConnectorStyle = 'none' | 'bowtie' | 'pin' | 'puzzle' | 'screw';

/**
 * One joint across a seam. (x, y) lies on the seam line, in plate coordinates.
 * `axis` is the direction the joint spans: 'x' across a seam that runs front to
 * back, 'y' across one that runs left to right.
 */
export interface ConnectorSite {
  x: number;
  y: number;
  axis: 'x' | 'y';
  /** Screw joints: the head slot is in the right / back piece (default: left / front). */
  flip?: boolean;
}

const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

const HALF_L = BOWTIE.length / 2;
const HALF_W = BOWTIE.width / 2;
const MOUTH = BOWTIE.mouthChamfer;
/** Receptacle inset in the vertical band of the profile, i.e. half a wall. */
const HALF_WALL = BP_PROFILE.chamfer2;

/**
 * How far a joint reaches from the seam into the low (left / front) and high
 * (right / back) piece, and how wide it is along the seam.
 */
export interface JointExtent {
  lo: number;
  hi: number;
  /** Half width along the seam, any mouth flare included. */
  hw: number;
  /** Half width that has to fit inside a wall; decides where along the seam joints can sit. */
  band: number;
}

const screwHeadReach = SCREW_JOIN.seat + SCREW_JOIN.headLength;
const screwNutReach = (o: BaseplateOptions) =>
  o.screwFastener === 'insert' ? SCREW_JOIN.insertLength : SCREW_JOIN.seat + SCREW_JOIN.nutThick + SCREW_JOIN.tip;

/** Extent of one joint for these options, or null when connectors are off. */
export function jointExtent(o: BaseplateOptions, flip = false): JointExtent | null {
  switch (o.connector) {
    case 'bowtie':
      return { lo: HALF_L + MOUTH, hi: HALF_L + MOUTH, hw: HALF_W + MOUTH, band: HALF_W };
    case 'pin':
      return { lo: PIN.length / 2, hi: PIN.length / 2, hw: PIN.hole / 2, band: PIN.hole / 2 };
    case 'puzzle': {
      const band = PUZZLE.head / 2 + PUZZLE.gap;
      return { lo: PUZZLE.overlap, hi: PUZZLE_PROTRUSION + PUZZLE.gap + MOUTH, hw: band + MOUTH, band };
    }
    case 'screw': {
      const [head, nut] = [screwHeadReach, screwNutReach(o)];
      // The slots sit under the floor, so only their position (on a wall line) matters, not the wall's width.
      const hw = SCREW_JOIN.headWidth / 2;
      return flip ? { lo: nut, hi: head, hw, band: HALF_W } : { lo: head, hi: nut, hw, band: HALF_W };
    }
    default:
      return null;
  }
}

/** How far a piece can stick out past its right / back edge (puzzle tabs). */
export function pieceProtrusion(o: BaseplateOptions): number {
  return o.connector === 'puzzle' ? PUZZLE_PROTRUSION : 0;
}

/** The grid along one axis. */
interface Axis {
  /** Cell boundaries (n + 1 values). */
  bounds: number[];
  total: number;
}

/** A stretch of seam shared by two pieces. */
interface SeamSpan {
  /** Position of the seam line across the seam. */
  at: number;
  /** Extent along the seam. */
  v0: number;
  v1: number;
  /** Depth of the low and the high piece away from the seam, and whether its far side is the outside edge. */
  sides: { room: number; outer: boolean }[];
}

/**
 * Where joints go along one seam: wherever a wall perpendicular to the seam
 * crosses it, plus through the solid margins (one per CONNECTOR_SPACING).
 * Depends only on the seam, so both pieces cut matching halves.
 */
function seamPositions(span: SeamSpan, across: Axis, along: Axis, chamfer: number, ext: JointExtent): number[] {
  // Room for the joint, then for the far side: the outside edge's chamfer, or the next seam's joints.
  const far = Math.max(ext.lo, ext.hi);
  const reach = [ext.lo, ext.hi];
  for (let k = 0; k < 2; k++) {
    const s = span.sides[k];
    if (s.room < reach[k] + CONNECTOR_MIN_WALL + (s.outer ? chamfer : far)) return [];
  }

  // Along the seam, stay clear of the outside edge, or of the joints of a crossing seam.
  const endPad = (outer: boolean) => ext.hw + CONNECTOR_MIN_WALL + (outer ? chamfer : far);
  const lo = span.v0 + endPad(span.v0 < EPS);
  const hi = span.v1 - endPad(span.v1 > along.total - EPS);
  if (hi < lo) return [];

  // A receptacle the joint would reach blocks its row, leaving a thin band at each wall line.
  const cells = (a: Axis) => a.bounds.slice(1).map((b, i) => [a.bounds[i], b] as const);
  const hitsCells = cells(across).some(([b0, b1]) => {
    const c0 = b0 + HALF_WALL;
    const c1 = b1 - HALF_WALL;
    return c0 < span.at + ext.hi + CONNECTOR_MIN_WALL && c1 > span.at - ext.lo - CONNECTOR_MIN_WALL;
  });
  const pad = Math.min(ext.band + CONNECTOR_MIN_WALL, HALF_WALL - 0.05);
  const blocked: [number, number][] = hitsCells
    ? cells(along).map(([b0, b1]) => [b0 + HALF_WALL - pad, b1 - HALF_WALL + pad])
    : [];

  const free: [number, number][] = [];
  let cur = lo;
  for (const [b0, b1] of blocked) {
    if (b1 < cur) continue;
    if (b0 > hi) break;
    if (b0 > cur) free.push([cur, b0]);
    cur = Math.max(cur, b1);
  }
  if (cur <= hi) free.push([cur, hi]);

  const out: number[] = [];
  for (const [s0, s1] of free) {
    const n = 1 + Math.floor((s1 - s0) / CONNECTOR_SPACING + EPS);
    for (let i = 0; i < n; i++) out.push(round(s0 + ((s1 - s0) * (i + 0.5)) / n));
  }
  return out;
}

/** Positions on one seam, and (screws) which side gets the head: the deeper piece, if it fits. */
function seamJoints(span: SeamSpan, across: Axis, along: Axis, chamfer: number, o: BaseplateOptions) {
  if (o.connector !== 'screw') return { flip: false, at: seamPositions(span, across, along, chamfer, jointExtent(o)!) };
  const prefer = span.sides[1].room > span.sides[0].room + EPS;
  for (const flip of [prefer, !prefer]) {
    const at = seamPositions(span, across, along, chamfer, jointExtent(o, flip)!);
    if (at.length) return { flip, at };
  }
  return { flip: false, at: [] };
}

/** Plan-view box around a joint, grown by `pad`. */
export function jointFootprint(site: ConnectorSite, o: BaseplateOptions, pad = 0): Rect | null {
  const e = jointExtent(o, site.flip);
  if (!e) return null;
  const u0 = -e.lo - pad;
  const u1 = e.hi + pad;
  const v = e.hw + pad;
  return site.axis === 'x'
    ? { x0: site.x + u0, x1: site.x + u1, y0: site.y - v, y1: site.y + v }
    : { x0: site.x - v, x1: site.x + v, y0: site.y + u0, y1: site.y + u1 };
}

/**
 * Every joint on the split baseplate. Each site is one joint shared by the two
 * pieces that meet there (for bowties: one key, and half a pocket in each).
 */
export function connectorSites(layout: GridLayout, pieces: PieceDef[], o: BaseplateOptions): ConnectorSite[] {
  if (!jointExtent(o)) return [];
  const X: Axis = { bounds: layout.xs, total: layout.plateW };
  const Y: Axis = { bounds: layout.ys, total: layout.plateD };
  const chamfer = Math.max(o.bottomChamfer, 0);
  const sites: ConnectorSite[] = [];
  const add = (site: ConnectorSite, flip: boolean) => sites.push(flip ? { ...site, flip } : site);
  for (const a of pieces) {
    for (const b of pieces) {
      if (near(a.x1, b.x0)) {
        const span: SeamSpan = {
          at: a.x1,
          v0: Math.max(a.y0, b.y0),
          v1: Math.min(a.y1, b.y1),
          sides: [
            { room: a.x1 - a.x0, outer: a.outer.left },
            { room: b.x1 - b.x0, outer: b.outer.right },
          ],
        };
        const { flip, at } = seamJoints(span, X, Y, chamfer, o);
        for (const y of at) add({ x: a.x1, y, axis: 'x' }, flip);
      }
      if (near(a.y1, b.y0)) {
        const span: SeamSpan = {
          at: a.y1,
          v0: Math.max(a.x0, b.x0),
          v1: Math.min(a.x1, b.x1),
          sides: [
            { room: a.y1 - a.y0, outer: a.outer.front },
            { room: b.y1 - b.y0, outer: b.outer.back },
          ],
        };
        const { flip, at } = seamJoints(span, Y, X, chamfer, o);
        for (const x of at) add({ x, y: a.y1, axis: 'y' }, flip);
      }
    }
  }
  // Cut-out (void) cells: drop joints that would break into them.
  const voids = voidRects(layout);
  if (!voids.length) return sites;
  return sites.filter((s) => {
    const f = jointFootprint(s, o, CONNECTOR_MIN_WALL)!;
    return !voids.some((r) => rectsOverlap(r, f));
  });
}

/** The sites on a piece's edges; the piece gets its part of the joint at each. */
export function sitesOnPiece(sites: ConnectorSite[], p: PieceDef): ConnectorSite[] {
  return sites.filter((s) =>
    s.axis === 'x'
      ? (near(s.x, p.x0) || near(s.x, p.x1)) && s.y > p.y0 && s.y < p.y1
      : (near(s.y, p.y0) || near(s.y, p.y1)) && s.x > p.x0 && s.x < p.x1,
  );
}

/** True when the piece is on the low (left / front) side of the site's seam. */
export function lowSideOf(site: ConnectorSite, p: PieceDef): boolean {
  return site.axis === 'x' ? near(site.x, p.x1) : near(site.y, p.y1);
}

/** Assembly notes for the joints that need no printed keys. */
export function jointSteps(o: BaseplateOptions, count: number): string[] {
  if (!count) return [];
  switch (o.connector) {
    case 'pin':
      return [
        `Filament pins: ${count}. Cut 1.75 mm filament into ${PIN.length - 0.5} mm pins.`,
        'Push a pin all the way into each hole on one side of a seam, then slide the',
        'neighbor on. Join the pieces of each row first, then push the rows together.',
      ];
    case 'puzzle':
      return [
        `Puzzle tabs: ${count}. Start with the front-left piece; lower each piece onto the`,
        'tabs of the pieces to its left and in front of it.',
      ];
    case 'screw':
      return [
        `Screws: ${count} × ${SCREW_JOIN.screw} socket head, plus ${count} ${o.screwFastener === 'insert' ? 'M3 heat-set inserts' : 'M3 hex nuts'}.`,
        o.screwFastener === 'insert'
          ? 'Press an insert into each hole in a seam face first.'
          : 'With the baseplate upside down, drop a nut into each nut slot.',
        'Slide a screw into each head slot and tighten (a ball-end hex key reaches at an angle).',
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** An outline offset (negative = shrink) at a height. */
interface Layer {
  z: number;
  offset: number;
}

/**
 * One half of the bowtie in seam coordinates (u across the seam, v along it),
 * CCW. It runs `past` beyond the neck so the two halves overlap.
 */
function halfOutline(side: -1 | 1, past: number): Vec2[] {
  const taper = (BOWTIE.width - BOWTIE.neck) / BOWTIE.length;
  const hn = BOWTIE.neck / 2 - taper * past;
  return side < 0
    ? [
        [-HALF_L, -HALF_W],
        [past, -hn],
        [past, hn],
        [-HALF_L, HALF_W],
      ]
    : [
        [-past, -hn],
        [HALF_L, -HALF_W],
        [HALF_L, HALF_W],
        [-past, hn],
      ];
}

/** Miter offset of a convex CCW polygon (positive = grow). */
function offsetConvex(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const normals = pts.map(([x, y], i) => {
    const [qx, qy] = pts[(i + 1) % n];
    const len = Math.hypot(qx - x, qy - y);
    return [(qy - y) / len, -(qx - x) / len];
  });
  return pts.map(([x, y], i) => {
    const [ax, ay] = normals[(i + n - 1) % n];
    const [bx, by] = normals[i];
    const k = d / (1 + ax * bx + ay * by);
    return [x + (ax + bx) * k, y + (ay + by) * k];
  });
}

/** Seam coordinates (u across, v along) to plate coordinates. */
const toPlate = (site: Pick<ConnectorSite, 'x' | 'y' | 'axis'>, u: number, v: number, z: number): Vec3 =>
  site.axis === 'x' ? [site.x + u, site.y + v, z] : [site.x + v, site.y + u, z];

/** Hull of convex outlines (seam coordinates) lofted through the layers, one hull per outline. */
function loftConvex(w: Wasm, s: Scope, site: Pick<ConnectorSite, 'x' | 'y' | 'axis'>, outlines: Vec2[][], layers: Layer[]): Manifold {
  const parts = outlines.map((outline) => {
    const pts: Vec3[] = [];
    for (const l of layers) for (const [u, v] of offsetConvex(outline, l.offset)) pts.push(toPlate(site, u, v, l.z));
    return s.t(w.Manifold.hull(pts));
  });
  return parts.length === 1 ? parts[0] : s.t(w.Manifold.union(parts));
}

/** How far each half runs past the neck: enough to still overlap after the deepest inset. */
const pastFor = (layers: Layer[]) => Math.max(0, ...layers.map((l) => -l.offset)) + 0.1;

/** A bowtie lofted through the layers, built as the union of two convex halves. */
function bowtie(w: Wasm, s: Scope, cx: number, cy: number, axis: 'x' | 'y', layers: Layer[]): Manifold {
  const past = pastFor(layers);
  return loftConvex(w, s, { x: cx, y: cy, axis }, [halfOutline(-1, past), halfOutline(1, past)], layers);
}

/** The pocket for one site, as a solid to subtract. It pokes 1 mm below z = 0. */
export function connectorPocket(w: Wasm, s: Scope, site: ConnectorSite): Manifold {
  const layers: Layer[] =
    MOUTH > 0.01
      ? [
          { z: -1, offset: MOUTH + 1 },
          { z: MOUTH, offset: 0 },
          { z: BOWTIE.depth, offset: 0 },
        ]
      : [
          { z: -1, offset: 0 },
          { z: BOWTIE.depth, offset: 0 },
        ];
  return bowtie(w, s, site.x, site.y, site.axis, layers);
}

/** Circle outline (CCW) in seam coordinates. */
function circle(cu: number, cv: number, r: number, segs = 32): Vec2[] {
  return Array.from({ length: segs }, (_, i) => {
    const a = (2 * Math.PI * i) / segs;
    return [cu + r * Math.cos(a), cv + r * Math.sin(a)] as Vec2;
  });
}

/**
 * A horizontal hole along the joint axis from u0 to u1, with a teardrop
 * profile (45° roof) so it prints without support.
 */
function teardropHole(w: Wasm, s: Scope, site: ConnectorSite, u0: number, u1: number, zc: number, r: number): Manifold {
  const ring: [number, number][] = circle(0, zc, r, 32).map(([v, z]) => [v, z]);
  ring.push([0, zc + r * Math.SQRT2]);
  const pts: Vec3[] = [];
  for (const u of [u0, u1]) for (const [v, z] of ring) pts.push(toPlate(site, u, v, z));
  return s.t(w.Manifold.hull(pts));
}

/** Box in seam coordinates. */
function seamBox(w: Wasm, s: Scope, site: ConnectorSite, ua: number, ub: number, hv: number, z0: number, z1: number): Manifold {
  const [u0, u1] = [Math.min(ua, ub), Math.max(ua, ub)];
  const [x0, y0] = toPlate(site, u0, -hv, 0);
  const [x1, y1] = toPlate(site, u1, hv, 0);
  return s.t(boxAt(w, Math.min(x0, x1), Math.min(y0, y1), z0, Math.max(x0, x1), Math.max(y0, y1), z1));
}

/** Top of the wall's vertical band, where it is still a full wall wide. */
const bandTop = (floor: number, o: BaseplateOptions) => floor + o.bottomClearance + BP_PROFILE.chamfer1 + BP_PROFILE.vertical;

/** Height of a puzzle tab (from the bottom); the socket is PUZZLE.topGap taller. */
export const puzzleTabTop = (floor: number, o: BaseplateOptions) => bandTop(floor, o) - 2 * PUZZLE.topGap;

/** Puzzle tab outline: neck and round head, as two convex parts (seam coordinates). */
function puzzleOutlines(): Vec2[][] {
  const hn = PUZZLE.neck / 2;
  const neck: Vec2[] = [
    [-PUZZLE.overlap, -hn],
    [PUZZLE.headAt, -hn],
    [PUZZLE.headAt, hn],
    [-PUZZLE.overlap, hn],
  ];
  return [neck, circle(PUZZLE.headAt, 0, PUZZLE.head / 2)];
}

/**
 * The solid one piece adds (`add`) or removes (`cut`) for a joint. `low` says
 * whether the piece is on the left / front side of the seam.
 */
export function jointSolid(
  w: Wasm,
  s: Scope,
  site: ConnectorSite,
  o: BaseplateOptions,
  floor: number,
  low: boolean,
): { add?: Manifold; cut?: Manifold } {
  switch (o.connector) {
    case 'bowtie':
      return { cut: connectorPocket(w, s, site) };
    case 'pin': {
      const half = PIN.length / 2;
      return { cut: teardropHole(w, s, site, -half, half, floor + o.bottomClearance + PIN.z, PIN.hole / 2) };
    }
    case 'puzzle': {
      const tabTop = puzzleTabTop(floor, o);
      if (low) return { add: loftConvex(w, s, site, puzzleOutlines(), [{ z: 0, offset: 0 }, { z: tabTop, offset: 0 }]) };
      const g = PUZZLE.gap;
      const layers: Layer[] = [
        { z: -1, offset: g + MOUTH + 1 },
        { z: MOUTH, offset: g },
        { z: tabTop + PUZZLE.topGap, offset: g },
      ];
      return { cut: loftConvex(w, s, site, puzzleOutlines(), layers) };
    }
    case 'screw': {
      const J = SCREW_JOIN;
      const head = site.flip ? 1 : -1; // direction of the head slot along u
      const nutEnd = screwNutReach(o);
      const parts = [
        teardropHole(w, s, site, head * (J.seat + 0.5), -head * nutEnd, J.z, J.hole / 2),
        seamBox(w, s, site, head * J.seat, head * (J.seat + J.headLength), J.headWidth / 2, -1, J.z + J.headTop),
        o.screwFastener === 'insert'
          ? teardropHole(w, s, site, head * 0.3, -head * J.insertLength, J.z, J.insertHole / 2)
          : seamBox(w, s, site, -head * J.seat, -head * (J.seat + J.nutThick), J.nutWidth / 2, -1, J.z + J.nutTop),
      ];
      return { cut: s.t(w.Manifold.union(parts)) };
    }
    default:
      return {};
  }
}

const KEY_LAYERS: Layer[] = [
  { z: 0, offset: -BOWTIE_CLEARANCE - BOWTIE_KEY_CHAMFER },
  { z: BOWTIE_KEY_CHAMFER, offset: -BOWTIE_CLEARANCE },
  { z: BOWTIE.depth - BOWTIE_KEY_RECESS, offset: -BOWTIE_CLEARANCE },
];

/** Half extents of a key lying along X. */
function keyHalfExtents() {
  const past = pastFor(KEY_LAYERS);
  let hu = 0;
  let hv = 0;
  for (const side of [-1, 1] as const) {
    for (const [u, v] of offsetConvex(halfOutline(side, past), -BOWTIE_CLEARANCE)) {
      hu = Math.max(hu, Math.abs(u));
      hv = Math.max(hv, Math.abs(v));
    }
  }
  return { hu, hv };
}

/** Footprint and height of a printed key (lying flat, long side along X). No geometry kernel needed. */
export function connectorKeySize(): { w: number; d: number; h: number } {
  const { hu, hv } = keyHalfExtents();
  return { w: 2 * hu, d: 2 * hv, h: BOWTIE.depth - BOWTIE_KEY_RECESS };
}

/** One printable key: undersized by the clearance, footprint min corner at the origin, bottom at z = 0. */
export function buildConnectorKey(w: Wasm): MeshData {
  const s = new Scope();
  try {
    const { hu, hv } = keyHalfExtents();
    const key = bowtie(w, s, hu, hv, 'x', KEY_LAYERS);
    assertValid(key, 'connector key');
    return toMeshData(key);
  } finally {
    s.dispose();
  }
}
