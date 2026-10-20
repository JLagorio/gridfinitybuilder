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
  return v / 6;
}
