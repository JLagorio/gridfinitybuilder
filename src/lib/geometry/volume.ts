import type { MeshData } from './kernel';

/**
 * Enclosed volume (mm³) of a closed, outward-facing triangle mesh: the sum of
 * signed tetrahedra from the origin (divergence theorem). For the meshes the
 * generators return this is the same number as Manifold's `volume()`, without
 * keeping the Manifold alive or rebuilding it from the mesh.
 */
export function meshVolume(mesh: MeshData): number {
  const p = mesh.positions;
  const t = mesh.indices;
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  // Overlay bodies (e.g. inlaid label text) are filament too.
  return v / 6 + (mesh.overlays ?? []).reduce((t, o) => t + meshVolume(o), 0);
}

/** Surface area (mm²) of a triangle mesh, overlays included. */
export function meshArea(mesh: MeshData): number {
  const p = mesh.positions;
  const t = mesh.indices;
  let a = 0;
  for (let i = 0; i < t.length; i += 3) {
    const i0 = t[i] * 3;
    const i1 = t[i + 1] * 3;
    const i2 = t[i + 2] * 3;
    const ux = p[i1] - p[i0], uy = p[i1 + 1] - p[i0 + 1], uz = p[i1 + 2] - p[i0 + 2];
    const vx = p[i2] - p[i0], vy = p[i2 + 1] - p[i0 + 1], vz = p[i2 + 2] - p[i0 + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a + (mesh.overlays ?? []).reduce((s, o) => s + meshArea(o), 0);
}

/**
 * A quick guess at what a slicer at Bambu's 0.20 mm Standard defaults would
 * extrude: a skin of walls and top/bottom layers that prints solid, and sparse
 * infill inside it. The solid 7 mm bin bases and thick baseplate floors are
 * mostly infill.
 *
 * The BOM shows this only until a plate's parts are sliced (then it uses the
 * print-time estimate's extruded volume, estimate.ts). It runs high on tall,
 * thin-walled parts: both faces of a 1.2 mm wall get the 0.85 mm skin, so the
 * wall counts 1.7 mm thick (a 1×1×10u bin comes out about 40 % over).
 */
export const PRINT_ESTIMATE = {
  /** Average skin thickness: 2 walls of 0.42 mm, 1 mm top, 0.6 mm bottom. */
  shell: 0.85,
  /** Sparse infill density. */
  infill: 0.15,
} as const;

/** Filament volume of a mesh before it's sliced, mm³ (see PRINT_ESTIMATE). */
export function printedVolume(mesh: MeshData): number {
  const v = meshVolume(mesh);
  const skin = Math.min(v, meshArea(mesh) * PRINT_ESTIMATE.shell);
  return skin + (v - skin) * PRINT_ESTIMATE.infill;
}
