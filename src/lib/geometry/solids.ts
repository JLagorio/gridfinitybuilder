import type { Manifold, Vec2, Vec3, Wasm } from './kernel';
import { boxAt, cylinderAt } from './shapes';

/**
 * Simple solids described as plain data, so they can ride along in a mesh
 * spec to the geometry worker: the extra holes, recesses and sockets a
 * carry case, wall grid or spacer strip puts into a baseplate piece
 * (`buildBaseplatePiece`'s `extraCuts`).
 */
export type SolidDef =
  | { kind: 'box'; min: Vec3; max: Vec3 }
  /** Cylinder or cone along Z. */
  | { kind: 'cyl'; x: number; y: number; z0: number; z1: number; r0: number; r1?: number; segs?: number }
  /** Convex hull of points. */
  | { kind: 'hull'; points: Vec3[] }
  /** A plan outline (any simple polygon, CCW) extruded between two heights. */
  | { kind: 'prism'; ring: Vec2[]; z0: number; z1: number };

export function buildSolid(w: Wasm, d: SolidDef): Manifold {
  switch (d.kind) {
    case 'box':
      return boxAt(w, d.min[0], d.min[1], d.min[2], d.max[0], d.max[1], d.max[2]);
    case 'cyl':
      return cylinderAt(w, d.x, d.y, d.z0, d.z1, d.r0, d.r1 ?? d.r0, d.segs);
    case 'hull':
      return w.Manifold.hull(d.points);
    case 'prism':
      return w.Manifold.extrude([d.ring], d.z1 - d.z0).translate([0, 0, d.z0]);
  }
}

/** Plan-view bounding box of a solid. */
export function solidBounds(d: SolidDef): { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number } {
  switch (d.kind) {
    case 'box':
      return { x0: d.min[0], y0: d.min[1], z0: d.min[2], x1: d.max[0], y1: d.max[1], z1: d.max[2] };
    case 'cyl': {
      const r = Math.max(d.r0, d.r1 ?? d.r0);
      return { x0: d.x - r, x1: d.x + r, y0: d.y - r, y1: d.y + r, z0: d.z0, z1: d.z1 };
    }
    case 'hull': {
      const xs = d.points.map((p) => p[0]);
      const ys = d.points.map((p) => p[1]);
      const zs = d.points.map((p) => p[2]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) };
    }
    case 'prism': {
      const xs = d.ring.map((p) => p[0]);
      const ys = d.ring.map((p) => p[1]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: d.z0, z1: d.z1 };
    }
  }
}
