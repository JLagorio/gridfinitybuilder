import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import {
  BP_BOTTOM_CLEARANCE,
  BP_CELL_RADIUS,
  BP_PROFILE,
  BP_PROFILE_DEPTH,
  BP_PROFILE_HEIGHT,
  HOLE_OFFSET,
} from './spec';
import { cylinderAt, loftRoundedRect, ringAt, roundedRectRing, type CornerRadii, type LoftKnot } from './shapes';
import { connectorPocket, type ConnectorSite, type ConnectorStyle } from './connectors';
import type { PieceDef } from '../layout/split';
import type { GridLayout } from '../layout/drawer';

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

  magnets: boolean;
  magnetDiameter: number;
  magnetHeight: number;
  /** Added to the magnet diameter for the pocket. */
  magnetFit: number;
  magnetSide: 'top' | 'bottom';
  /** Small through-hole under each top-side pocket to push magnets out. */
  magnetRelease: boolean;
  /** Floor thickness under the receptacles when magnets or screws are on. */
  holeFloor: number;

  screws: boolean;
  screwDiameter: number;
  screwHeadDiameter: number;

  /** Bowtie pockets in the bottom across every seam, with matching keys to print. */
  connector: ConnectorStyle;
}

export const DEFAULT_BASEPLATE: BaseplateOptions = {
  outerRadius: 4,
  topTrim: 0.4,
  bottomClearance: BP_BOTTOM_CLEARANCE,
  bottomPad: 0,
  bottomChamfer: 0,
  magnets: false,
  magnetDiameter: 6,
  magnetHeight: 2,
  magnetFit: 0.2,
  magnetSide: 'top',
  magnetRelease: false,
  holeFloor: 2.8,
  screws: false,
  screwDiameter: 3,
  screwHeadDiameter: 6,
  connector: 'none',
};

export function baseplateFloor(o: BaseplateOptions): number {
  return o.bottomPad + (o.magnets || o.screws ? o.holeFloor : 0);
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

function cellCutout(w: Wasm, cx: number, cy: number, o: BaseplateOptions): Manifold {
  const floor = baseplateFloor(o);
  const z0 = floor + o.bottomClearance;
  const knots: LoftKnot[] = [];
  knots.push({ z: floor > 0 ? floor : -1, inset: BP_PROFILE_DEPTH });
  if (o.bottomClearance > 0.001 || floor <= 0) knots.push({ z: z0, inset: BP_PROFILE_DEPTH });
  knots.push({ z: z0 + BP_PROFILE.chamfer1, inset: BP_PROFILE.chamfer2 });
  knots.push({ z: z0 + BP_PROFILE.chamfer1 + BP_PROFILE.vertical, inset: BP_PROFILE.chamfer2 });
  knots.push({ z: z0 + BP_PROFILE_HEIGHT, inset: 0 });
  knots.push({ z: z0 + BP_PROFILE_HEIGHT + 1, inset: -1 });
  return loftRoundedRect(w, cx, cy, 42, 42, BP_CELL_RADIUS, knots);
}

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

    const negatives: Manifold[] = [];
    for (let i = piece.cells.x0; i < piece.cells.x1; i++) {
      for (let j = piece.cells.y0; j < piece.cells.y1; j++) {
        const cx = layout.originX + (i + 0.5) * layout.pitchX;
        const cy = layout.originY + (j + 0.5) * layout.pitchY;
        negatives.push(s.t(cellCutout(w, cx, cy, o)));

        if (o.magnets && floor > 0) {
          const r = (o.magnetDiameter + o.magnetFit) / 2;
          const depth = o.magnetHeight + 0.2;
          for (const [dx, dy] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const hx = cx + dx * HOLE_OFFSET;
            const hy = cy + dy * HOLE_OFFSET;
            if (o.magnetSide === 'top') {
              negatives.push(s.t(cylinderAt(w, hx, hy, floor - depth, floor + 0.5, r)));
              if (o.magnetRelease) negatives.push(s.t(cylinderAt(w, hx, hy, -1, floor - depth + 0.01, 1.5, 1.5, 20)));
            } else {
              negatives.push(s.t(cylinderAt(w, hx, hy, -1, depth, r)));
            }
          }
        }
        if (o.screws && floor > 0) {
          const rh = (o.screwDiameter + 0.3) / 2;
          const rk = Math.max(o.screwHeadDiameter / 2, rh + 0.5);
          const sinkDepth = Math.min(rk - rh, floor - 0.4);
          negatives.push(s.t(cylinderAt(w, cx, cy, -1, floor + 0.5, rh)));
          // 90° countersink, open toward the receptacle
          negatives.push(s.t(cylinderAt(w, cx, cy, floor - sinkDepth, floor + 0.01, rk - sinkDepth, rk)));
          negatives.push(s.t(cylinderAt(w, cx, cy, floor, floor + 0.5, rk)));
        }
      }
    }
    if (o.connector === 'bowtie') for (const site of connectors) negatives.push(connectorPocket(w, s, site));
    const result = negatives.length ? s.t(slab.subtract(s.t(w.Manifold.union(negatives)))) : slab;
    assertValid(result, `baseplate piece ${piece.id}`);
    return toMeshData(result);
  } finally {
    s.dispose();
  }
}
