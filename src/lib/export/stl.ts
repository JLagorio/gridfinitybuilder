import { strToU8, zipSync } from 'fflate';
import type { MeshData } from '../geometry/kernel';
import { assemblyMaps, printerFolder, type MeshLookup, type PrintJob } from '../project';
import { placeTransform, type Mat12 } from './threemf';

export interface StlItem {
  mesh: MeshData;
  /** 3MF-style placement (row-vector affine); identity when omitted. */
  transform?: Mat12;
}

/**
 * Binary STL. STL has no notion of separate objects, so every item's triangles
 * go into one list; slicers can split it back into parts. Facet normals are
 * computed from the placed vertices (counter-clockwise seen from outside).
 */
export function writeSTL(input: StlItem[], header = 'Gridfit'): Uint8Array {
  // Overlay bodies (other-filament parts) are just more triangles in an STL.
  const items = input.flatMap((it) => [it, ...(it.mesh.overlays ?? []).map((o) => ({ mesh: o, transform: it.transform }))]);
  const count = items.reduce((t, it) => t + it.mesh.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + 50 * count);
  const out = new Uint8Array(buf);
  const dv = new DataView(buf);
  // Some readers treat files starting with "solid" as ASCII STL.
  const head = strToU8(`binary STL: ${header}`.slice(0, 80));
  out.set(head, 0);
  dv.setUint32(80, count, true);
  let off = 84;
  const v = new Float64Array(9);
  for (const it of items) {
    const p = it.mesh.positions;
    const ix = it.mesh.indices;
    const m = it.transform;
    for (let t = 0; t < ix.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = ix[t + k] * 3;
        const x = p[i];
        const y = p[i + 1];
        const z = p[i + 2];
        if (m) {
          v[k * 3] = x * m[0] + y * m[3] + z * m[6] + m[9];
          v[k * 3 + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
          v[k * 3 + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
        } else {
          v[k * 3] = x;
          v[k * 3 + 1] = y;
          v[k * 3 + 2] = z;
        }
      }
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
      const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      dv.setFloat32(off, nx, true);
      dv.setFloat32(off + 4, ny, true);
      dv.setFloat32(off + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(off + 12 + k * 4, v[k], true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
  }
  return out;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plate';

/** One plate as a single STL, parts already arranged on the bed. */
export function exportPlateSTL(job: PrintJob, plateIndex: number, getMesh: MeshLookup): Uint8Array {
  const pl = job.plates[plateIndex];
  const items = pl.placements.map((p) => {
    const part = job.parts[p.key];
    return { mesh: getMesh(part.meshKey), transform: placeTransform(p.x, p.y, p.rotated, part.d) };
  });
  return writeSTL(items, pl.name);
}

/** Every plate as its own STL, plus the assembly map(s). */
export function exportPlatesStlZip(job: PrintJob, getMesh: MeshLookup): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {};
  job.plates.forEach((pl, i) => {
    files[`${printerFolder(job, pl)}${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.stl`] = [exportPlateSTL(job, i, getMesh), { level: 6 }];
  });
  for (const [name, text] of Object.entries(assemblyMaps(job))) files[name] = strToU8(text);
  return zipSync(files);
}
