import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from './kernel';
import {
  BOWTIE,
  BOWTIE_CLEARANCE,
  BOWTIE_KEY_CHAMFER,
  BOWTIE_KEY_RECESS,
  BP_PROFILE,
  CONNECTOR_MIN_WALL,
  CONNECTOR_SPACING,
} from './spec';
import type { BaseplateOptions } from './baseplate';
import type { GridLayout } from '../layout/drawer';
import type { PieceDef } from '../layout/split';

export type ConnectorStyle = 'none' | 'bowtie';

/**
 * One key across a seam. (x, y) lies on the seam line, in plate coordinates.
 * `axis` is the direction the key spans: 'x' across a seam that runs front to
 * back, 'y' across one that runs left to right.
 */
export interface ConnectorSite {
  x: number;
  y: number;
  axis: 'x' | 'y';
}

const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

const HALF_L = BOWTIE.length / 2;
const HALF_W = BOWTIE.width / 2;
const MOUTH = BOWTIE.mouthChamfer;
/** Receptacle inset in the vertical band of the profile, i.e. half a wall. */
const HALF_WALL = BP_PROFILE.chamfer2;

/** The grid along one axis. */
interface Axis {
  origin: number;
  pitch: number;
  n: number;
  total: number;
}

/** A stretch of seam shared by two pieces. */
interface SeamSpan {
  /** Position of the seam line across the seam. */
  at: number;
  /** Extent along the seam. */
  v0: number;
  v1: number;
  /** Depth of each piece away from the seam, and whether its far side is the outside edge. */
  sides: { room: number; outer: boolean }[];
}

/**
 * Where keys go along one seam: wherever a wall perpendicular to the seam
 * crosses it, plus through the solid margins (one per CONNECTOR_SPACING).
 * Depends only on the seam, so both pieces cut matching pockets.
 */
function seamPositions(span: SeamSpan, across: Axis, along: Axis, chamfer: number): number[] {
  // A pocket reaches this far from the seam, wall included.
  const reach = HALF_L + MOUTH + CONNECTOR_MIN_WALL;
  // Leave room for the pocket, then for the far side: the outside edge's chamfer, or the next seam's pockets.
  for (const s of span.sides) if (s.room < reach + (s.outer ? chamfer : HALF_L + MOUTH)) return [];

  // Along the seam, stay clear of the outside edge, or of the pockets of a crossing seam.
  const endPad = (outer: boolean) => HALF_W + MOUTH + CONNECTOR_MIN_WALL + (outer ? chamfer : HALF_L + MOUTH);
  const lo = span.v0 + endPad(span.v0 < EPS);
  const hi = span.v1 - endPad(span.v1 > along.total - EPS);
  if (hi < lo) return [];

  // A receptacle the pocket would reach blocks its row, leaving a thin band at each wall line.
  const hitsCells = Array.from({ length: across.n }, (_, i) => i).some((i) => {
    const c0 = across.origin + i * across.pitch + HALF_WALL;
    const c1 = across.origin + (i + 1) * across.pitch - HALF_WALL;
    return c0 < span.at + reach && c1 > span.at - reach;
  });
  const pad = HALF_W + CONNECTOR_MIN_WALL;
  const blocked: [number, number][] = hitsCells
    ? Array.from({ length: along.n }, (_, j) => [
        along.origin + j * along.pitch + HALF_WALL - pad,
        along.origin + (j + 1) * along.pitch - HALF_WALL + pad,
      ])
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

/**
 * Every connector on the split baseplate. Each site is one key, and one half
 * pocket in each of the two pieces that meet there.
 */
export function connectorSites(layout: GridLayout, pieces: PieceDef[], o: BaseplateOptions): ConnectorSite[] {
  if (o.connector !== 'bowtie') return [];
  const X: Axis = { origin: layout.originX, pitch: layout.pitchX, n: layout.nx, total: layout.plateW };
  const Y: Axis = { origin: layout.originY, pitch: layout.pitchY, n: layout.ny, total: layout.plateD };
  const chamfer = Math.max(o.bottomChamfer, 0);
  const sites: ConnectorSite[] = [];
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
        for (const y of seamPositions(span, X, Y, chamfer)) sites.push({ x: a.x1, y, axis: 'x' });
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
        for (const x of seamPositions(span, Y, X, chamfer)) sites.push({ x, y: a.y1, axis: 'y' });
      }
    }
  }
  return sites;
}

/** The sites on a piece's edges; the piece gets half a pocket at each. */
export function sitesOnPiece(sites: ConnectorSite[], p: PieceDef): ConnectorSite[] {
  return sites.filter((s) =>
    s.axis === 'x'
      ? (near(s.x, p.x0) || near(s.x, p.x1)) && s.y > p.y0 && s.y < p.y1
      : (near(s.y, p.y0) || near(s.y, p.y1)) && s.x > p.x0 && s.x < p.x1,
  );
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

/** How far each half runs past the neck: enough to still overlap after the deepest inset. */
const pastFor = (layers: Layer[]) => Math.max(0, ...layers.map((l) => -l.offset)) + 0.1;

/** A bowtie lofted through the layers, built as the union of two convex halves. */
function bowtie(w: Wasm, s: Scope, cx: number, cy: number, axis: 'x' | 'y', layers: Layer[]): Manifold {
  const past = pastFor(layers);
  const [a, b] = ([-1, 1] as const).map((side) => {
    const outline = halfOutline(side, past);
    const pts: Vec3[] = [];
    for (const l of layers) {
      for (const [u, v] of offsetConvex(outline, l.offset)) {
        pts.push(axis === 'x' ? [cx + u, cy + v, l.z] : [cx + v, cy + u, l.z]);
      }
    }
    return s.t(w.Manifold.hull(pts));
  });
  return s.t(w.Manifold.union(a, b));
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
