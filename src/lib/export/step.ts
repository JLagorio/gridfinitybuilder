import { strToU8, zipSync } from 'fflate';
import type { MeshData } from '../geometry/kernel';
import { binSeatHeight, type BaseplateOptions } from '../geometry/baseplate';
import { binBodyHeight } from '../geometry/variants';
import { LID_SEAT_DROP } from '../geometry/lid';
import { assembledParts } from '../geometry/accessories';
import { assemblyMaps, binOrigin, printerFolder, type MeshLookup, type PlacedBin, type PrintJob } from '../project';
import { placeTransform, type Mat12 } from './threemf';
import { stackPlaces } from '../stacking';

/**
 * STEP (ISO 10303-21, AP214 "automotive_design") export.
 *
 * Every part is a MANIFOLD_SOLID_BREP of planar faces. Triangles that lie in
 * one plane and touch along edges are merged into one polygonal face (with
 * inner loops for holes), and straight runs of mesh edges between the same two
 * faces become one edge, so CAD tools get the flat faces a designer would have
 * drawn instead of a triangle soup. Vertices are shared exactly, so every
 * shell is closed: each edge is used by exactly two faces, once each way.
 *
 * Several parts (a plate, an assembled drawer) are written as an assembly:
 * one product per distinct mesh, placed once per instance.
 */

// ---------------------------------------------------------------------------
// Mesh → planar B-rep
// ---------------------------------------------------------------------------

export interface BrepFace {
  /** Unit outward normal of the face's plane. */
  normal: [number, number, number];
  /** A point on the plane (the mean of the outer loop's corners). */
  origin: [number, number, number];
  /**
   * Boundary loops, outer loop first (counter-clockwise seen from outside),
   * holes after it. Each entry is an edge: `edge + 1` when the loop runs from
   * the edge's first vertex to its second, `-(edge + 1)` the other way.
   */
  loops: number[][];
}

/** One closed shell: corner vertices, straight edges between them and planar faces. */
export interface BrepShell {
  /** Corner coordinates, xyz triples. */
  points: number[];
  /** Edges as pairs of corner indices. */
  edges: number[];
  faces: BrepFace[];
  /** Enclosed volume, mm³ (negative for a cavity shell, whose faces point inward). */
  volume: number;
  /** Euler characteristic of the triangle mesh this shell came from (V − E + F = 2 − 2·genus). */
  meshEuler: number;
  /** Triangles merged into the faces. */
  triangles: number;
}

export interface BrepOptions {
  /** Distance tolerance for "in the plane" and "on the line", mm. */
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 1e-4;

/** Mesh with exactly paired half-edges (welding by position when the indices don't already pair). */
function closedMesh(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const nv0 = positions.length / 3;
  const dropDegenerate = (ix: ArrayLike<number>) => {
    const out: number[] = [];
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i], b = ix[i + 1], c = ix[i + 2];
      if (a !== b && b !== c && c !== a) out.push(a, b, c);
    }
    return Uint32Array.from(out);
  };
  let tri = dropDegenerate(indices);
  let pos: ArrayLike<number> = positions;
  let nv = nv0;
  let twin = pairHalfEdges(tri, nv);
  if (!twin) {
    // Weld vertices that sit at exactly the same place.
    const map = new Map<string, number>();
    const remap = new Uint32Array(nv0);
    const welded: number[] = [];
    for (let i = 0; i < nv0; i++) {
      const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
      let j = map.get(key);
      if (j === undefined) {
        j = welded.length / 3;
        map.set(key, j);
        welded.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      }
      remap[i] = j;
    }
    tri = dropDegenerate(Array.from(indices, (v) => remap[v]));
    pos = welded;
    nv = welded.length / 3;
    twin = pairHalfEdges(tri, nv);
  }
  if (!twin) throw new Error('STEP export needs a closed mesh (an edge is not shared by exactly two triangles).');
  return { pos, tri, twin, nv };
}

/**
 * Collapse mesh edges shorter than the tolerance (booleans leave a few
 * vertices a micron apart). CAD kernels drop such edges on import and the
 * faces around them fall apart, so they must not reach the file. Falls back
 * to the mesh as it was if a collapse would make it non-manifold.
 */
function collapseShortEdges(mesh: ReturnType<typeof closedMesh>, tol: number): ReturnType<typeof closedMesh> {
  const { pos, tri, nv } = mesh;
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  let any = false;
  for (let h = 0; h < tri.length; h++) {
    const a = tri[h], b = tri[next(h)];
    if (a > b) continue;
    const d = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    if (d > tol) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) {
      parent[Math.max(ra, rb)] = Math.min(ra, rb);
      any = true;
    }
  }
  if (!any) return mesh;
  const out: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = find(tri[i]), b = find(tri[i + 1]), c = find(tri[i + 2]);
    if (a !== b && b !== c && c !== a) out.push(a, b, c);
  }
  const collapsed = Uint32Array.from(out);
  const twin = pairHalfEdges(collapsed, nv);
  return twin ? { pos, tri: collapsed, twin, nv } : mesh;
}

/** twin[h] for every half-edge h = 3·triangle + corner, or null when the mesh isn't a closed 2-manifold. */
function pairHalfEdges(tri: Uint32Array, nv: number): Int32Array | null {
  const map = new Map<number, number>();
  for (let h = 0; h < tri.length; h++) {
    const key = tri[h] * nv + tri[next(h)];
    if (map.has(key)) return null;
    map.set(key, h);
  }
  const twin = new Int32Array(tri.length);
  for (let h = 0; h < tri.length; h++) {
    const g = map.get(tri[next(h)] * nv + tri[h]);
    if (g === undefined) return null;
    twin[h] = g;
  }
  return twin;
}

/** Next half-edge in the same triangle. */
const next = (h: number) => (h % 3 === 2 ? h - 2 : h + 1);

/**
 * Convert a closed triangle mesh (outward-facing, counter-clockwise) into
 * planar B-rep shells, one per connected piece.
 */
export function meshToShells(positions: ArrayLike<number>, indices: ArrayLike<number>, opts: BrepOptions = {}): BrepShell[] {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const { pos, tri, twin, nv } = collapseShortEdges(closedMesh(positions, indices), tol);
  const nT = tri.length / 3;
  if (!nT) return [];
  const P = (v: number, k: number) => pos[v * 3 + k];

  // Triangle normals (unnormalized cross products), areas and heights.
  const cross = new Float64Array(nT * 3);
  const area = new Float64Array(nT);
  const thin = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2);
    const vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
    const wx = P(c, 0) - P(b, 0), wy = P(c, 1) - P(b, 1), wz = P(c, 2) - P(b, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    cross[t * 3] = nx;
    cross[t * 3 + 1] = ny;
    cross[t * 3 + 2] = nz;
    const len = Math.hypot(nx, ny, nz);
    area[t] = len / 2;
    const longest = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
    // A sliver thinner than the tolerance has no reliable normal of its own.
    thin[t] = !longest || len / longest < tol ? 1 : 0;
  }

  // Grow planar faces from the largest triangles outward.
  const face = new Int32Array(nT).fill(-1);
  const order = Array.from({ length: nT }, (_, i) => i).sort((a, b) => area[b] - area[a]);
  let nFaces = 0;
  const stack: number[] = [];
  for (const seed of order) {
    if (face[seed] >= 0 || thin[seed]) continue;
    const f = nFaces++;
    const len = 2 * area[seed];
    const nx = cross[seed * 3] / len, ny = cross[seed * 3 + 1] / len, nz = cross[seed * 3 + 2] / len;
    const s0 = tri[seed * 3];
    const d = nx * P(s0, 0) + ny * P(s0, 1) + nz * P(s0, 2);
    const onPlane = (v: number) => Math.abs(nx * P(v, 0) + ny * P(v, 1) + nz * P(v, 2) - d) <= tol;
    face[seed] = f;
    stack.push(seed);
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const u = (twin[t * 3 + k] / 3) | 0;
        if (face[u] >= 0) continue;
        if (!thin[u] && cross[u * 3] * nx + cross[u * 3 + 1] * ny + cross[u * 3 + 2] * nz <= 0) continue;
        if (!onPlane(tri[u * 3]) || !onPlane(tri[u * 3 + 1]) || !onPlane(tri[u * 3 + 2])) continue;
        face[u] = f;
        stack.push(u);
      }
    }
  }
  // Slivers no face took in join the face across their longest edge.
  for (let pending = true; pending; ) {
    pending = false;
    let progress = false;
    for (let t = 0; t < nT; t++) {
      if (face[t] >= 0) continue;
      let best = -1;
      let bestLen = -1;
      for (let k = 0; k < 3; k++) {
        const u = (twin[t * 3 + k] / 3) | 0;
        if (face[u] < 0) continue;
        const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
        const l = Math.hypot(P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2));
        if (l > bestLen) {
          bestLen = l;
          best = face[u];
        }
      }
      if (best >= 0) {
        face[t] = best;
        progress = true;
      } else pending = true;
    }
    if (pending && !progress) throw new Error('STEP export: mesh has a piece with no area.');
  }

  // Half-edges on face boundaries, and how many boundary edges meet at each vertex.
  const isB = new Uint8Array(tri.length);
  const deg = new Int32Array(nv);
  const out1 = new Int32Array(nv).fill(-1);
  const out2 = new Int32Array(nv).fill(-1);
  for (let h = 0; h < tri.length; h++) {
    if (face[(h / 3) | 0] === face[(twin[h] / 3) | 0]) continue;
    isB[h] = 1;
    const u = tri[h];
    deg[u]++;
    if (out1[u] < 0) out1[u] = h;
    else if (out2[u] < 0) out2[u] = h;
  }
  const end = (h: number) => tri[next(h)];
  // Corners: where three or more faces meet, or the boundary bends.
  const corner = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    if (!deg[v]) continue;
    if (deg[v] !== 2) {
      corner[v] = 1;
      continue;
    }
    const a = end(out1[v]);
    const b = end(out2[v]);
    corner[v] = onSegment(pos, a, b, v, tol) ? 0 : 1;
  }
  // Walk a chain of boundary edges from a corner to the next corner.
  const chainFrom = (h0: number, visit: (h: number) => void) => {
    let h = h0;
    for (;;) {
      visit(h);
      const v = end(h);
      if (corner[v]) return v;
      const back = twin[h];
      h = out1[v] === back ? out2[v] : out1[v];
      if (h === h0) return v;
    }
  };
  // Chains that wander off a straight line are split; a closed run with no corner on it gets one first.
  const seen = new Uint8Array(tri.length);
  for (;;) {
    seen.fill(0);
    for (let h = 0; h < tri.length; h++) {
      if (!isB[h] || seen[h] || !corner[tri[h]]) continue;
      const verts = [tri[h]];
      chainFrom(h, (g) => {
        seen[g] = seen[twin[g]] = 1;
        verts.push(end(g));
      });
      splitBent(pos, verts, 0, verts.length - 1, tol, corner);
    }
    let loose = -1;
    for (let h = 0; h < tri.length && loose < 0; h++) if (isB[h] && !seen[h]) loose = h;
    if (loose < 0) break;
    corner[tri[loose]] = 1;
  }

  // Final chains → edges.
  const edgeOf = new Int32Array(tri.length).fill(0); // signed edge id + 1
  const edgeVerts: number[] = [];
  for (let h = 0; h < tri.length; h++) {
    if (!isB[h] || edgeOf[h] || !corner[tri[h]]) continue;
    const id = edgeVerts.length / 2 + 1;
    const b = chainFrom(h, (g) => {
      edgeOf[g] = id;
      edgeOf[twin[g]] = -id;
    });
    edgeVerts.push(tri[h], b);
  }

  // Connected pieces (shells), by triangles.
  const comp = new Int32Array(nT).fill(-1);
  let nComp = 0;
  for (let t0 = 0; t0 < nT; t0++) {
    if (comp[t0] >= 0) continue;
    const c = nComp++;
    comp[t0] = c;
    stack.push(t0);
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const u = (twin[t * 3 + k] / 3) | 0;
        if (comp[u] < 0) {
          comp[u] = c;
          stack.push(u);
        }
      }
    }
  }

  // Face loops: walk boundary half-edges around each face.
  const nextInFace = (h: number) => {
    let g = next(h);
    while (!isB[g]) g = next(twin[g]);
    return g;
  };
  const faceLoops: number[][][] = Array.from({ length: nFaces }, () => []);
  const loopArea: number[][] = Array.from({ length: nFaces }, () => []);
  const faceNormal = new Float64Array(nFaces * 3);
  for (let t = 0; t < nT; t++) {
    const f = face[t];
    faceNormal[f * 3] += cross[t * 3];
    faceNormal[f * 3 + 1] += cross[t * 3 + 1];
    faceNormal[f * 3 + 2] += cross[t * 3 + 2];
  }
  const faceComp = new Int32Array(nFaces);
  for (let t = 0; t < nT; t++) faceComp[face[t]] = comp[t];
  seen.fill(0);
  for (let h0 = 0; h0 < tri.length; h0++) {
    if (!isB[h0] || seen[h0]) continue;
    const f = face[(h0 / 3) | 0];
    const half: number[] = [];
    let h = h0;
    do {
      seen[h] = 1;
      half.push(h);
      h = nextInFace(h);
    } while (h !== h0);
    // Start at a corner so no edge is split across the start.
    const start = half.findIndex((g) => corner[tri[g]]);
    const loop: number[] = [];
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < half.length; i++) {
      const g = half[(start + i) % half.length];
      if (corner[tri[g]]) loop.push(edgeOf[g]);
      // Newell's method over every vertex of the loop.
      const a = tri[g], b = end(g);
      ax += (P(a, 1) - P(b, 1)) * (P(a, 2) + P(b, 2));
      ay += (P(a, 2) - P(b, 2)) * (P(a, 0) + P(b, 0));
      az += (P(a, 0) - P(b, 0)) * (P(a, 1) + P(b, 1));
    }
    faceLoops[f].push(loop);
    loopArea[f].push(ax * faceNormal[f * 3] + ay * faceNormal[f * 3 + 1] + az * faceNormal[f * 3 + 2]);
  }

  // Assemble shells.
  const shells: BrepShell[] = Array.from({ length: nComp }, () => ({
    points: [],
    edges: [],
    faces: [],
    volume: 0,
    meshEuler: 0,
    triangles: 0,
  }));
  // A vertex shared by two pieces (they touch at a point) gets a corner in each.
  const localPoints = shells.map(() => new Map<number, number>());
  const localEdge = new Int32Array(edgeVerts.length / 2).fill(-1);
  const pointOf = (c: number, v: number) => {
    let i = localPoints[c].get(v);
    if (i === undefined) {
      i = shells[c].points.length / 3;
      localPoints[c].set(v, i);
      shells[c].points.push(P(v, 0), P(v, 1), P(v, 2));
    }
    return i;
  };
  for (let f = 0; f < nFaces; f++) {
    const c = faceComp[f];
    const s = shells[c];
    const n = normalize(faceNormal[f * 3], faceNormal[f * 3 + 1], faceNormal[f * 3 + 2]);
    // Outer loop first: the one enclosing the most area.
    const idx = faceLoops[f].map((_, i) => i).sort((a, b) => loopArea[f][b] - loopArea[f][a]);
    const loops = idx.map((i) =>
      faceLoops[f][i].map((se) => {
        const e = Math.abs(se) - 1;
        if (localEdge[e] < 0) {
          localEdge[e] = s.edges.length / 2;
          s.edges.push(pointOf(c, edgeVerts[e * 2]), pointOf(c, edgeVerts[e * 2 + 1]));
        }
        return se > 0 ? localEdge[e] + 1 : -(localEdge[e] + 1);
      }),
    );
    // The plane passes through the mean of the outer loop's corners.
    let ox = 0, oy = 0, oz = 0;
    const outer = faceLoops[f][idx[0]];
    for (const se of outer) {
      const e = Math.abs(se) - 1;
      const v = se > 0 ? edgeVerts[e * 2] : edgeVerts[e * 2 + 1];
      ox += P(v, 0);
      oy += P(v, 1);
      oz += P(v, 2);
    }
    s.faces.push({ normal: n, origin: [ox / outer.length, oy / outer.length, oz / outer.length], loops });
  }
  // Volumes and Euler characteristics of the triangle pieces.
  const vertsOf = Array.from({ length: nComp }, () => new Set<number>());
  for (let t = 0; t < nT; t++) {
    const s = shells[comp[t]];
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    s.volume +=
      (P(a, 0) * (P(b, 1) * P(c, 2) - P(b, 2) * P(c, 1)) -
        P(a, 1) * (P(b, 0) * P(c, 2) - P(b, 2) * P(c, 0)) +
        P(a, 2) * (P(b, 0) * P(c, 1) - P(b, 1) * P(c, 0))) /
      6;
    s.triangles++;
    for (const v of [a, b, c]) vertsOf[comp[t]].add(v);
  }
  shells.forEach((s, c) => {
    s.meshEuler = vertsOf[c].size - (s.triangles * 3) / 2 + s.triangles;
  });
  return shells;
}

/** True when v lies on the segment a–b, within tol. */
function onSegment(pos: ArrayLike<number>, a: number, b: number, v: number, tol: number) {
  const P = (i: number, k: number) => pos[i * 3 + k];
  const dx = P(b, 0) - P(a, 0), dy = P(b, 1) - P(a, 1), dz = P(b, 2) - P(a, 2);
  const px = P(v, 0) - P(a, 0), py = P(v, 1) - P(a, 1), pz = P(v, 2) - P(a, 2);
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? (px * dx + py * dy + pz * dz) / len2 : -1;
  if (t <= 0 || t >= 1) return false;
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz) <= tol;
}

/** Mark the vertex farthest from a chain's chord as a corner until every piece is straight (Douglas–Peucker). */
function splitBent(pos: ArrayLike<number>, verts: number[], i0: number, i1: number, tol: number, corner: Uint8Array) {
  if (i1 - i0 < 2) return;
  const P = (i: number, k: number) => pos[i * 3 + k];
  const a = verts[i0], b = verts[i1];
  const dx = P(b, 0) - P(a, 0), dy = P(b, 1) - P(a, 1), dz = P(b, 2) - P(a, 2);
  const len2 = dx * dx + dy * dy + dz * dz;
  let worst = -1;
  let far = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const v = verts[i];
    const px = P(v, 0) - P(a, 0), py = P(v, 1) - P(a, 1), pz = P(v, 2) - P(a, 2);
    const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / len2)) : 0;
    const dist = Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
    if (dist > far) {
      far = dist;
      worst = i;
    }
  }
  // A closed run (a = b) always needs splitting, even when it's tiny.
  if (worst < 0 || (far <= tol && a !== b)) return;
  corner[verts[worst]] = 1;
  splitBent(pos, verts, i0, worst, tol, corner);
  splitBent(pos, verts, worst, i1, tol, corner);
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  const n: [number, number, number] = [x / l, y / l, z / l];
  // Faces that are axis-aligned up to float noise get an exact axis.
  for (let k = 0; k < 3; k++) {
    const others = Math.hypot(n[(k + 1) % 3], n[(k + 2) % 3]);
    if (others < 1e-6) return k === 0 ? [Math.sign(n[0]), 0, 0] : k === 1 ? [0, Math.sign(n[1]), 0] : [0, 0, Math.sign(n[2])];
  }
  return n;
}

// ---------------------------------------------------------------------------
// ISO 10303-21 writer
// ---------------------------------------------------------------------------

/** A REAL with the decimal point STEP needs ("1.", "-0.25", "1.5E-07"). */
export function stepReal(v: number, digits = 6): string {
  const scale = 10 ** digits;
  let r = Math.round(v * scale) / scale;
  if (Object.is(r, -0)) r = 0;
  let s = String(r);
  if (s.includes('e')) {
    const [m, e] = s.split('e');
    s = `${m.includes('.') ? m : `${m}.`}E${e}`;
  } else if (!s.includes('.')) s += '.';
  return s;
}

/** A STEP string literal: quotes doubled, non-ASCII as \X2\…\X0\. */
export function stepString(s: string): string {
  let out = '';
  let wide = '';
  const flush = () => {
    if (wide) out += `\\X2\\${wide}\\X0\\`;
    wide = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c < 0x7f) {
      flush();
      const ch = s[i];
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else wide += c.toString(16).toUpperCase().padStart(4, '0');
  }
  flush();
  return `'${out}'`;
}

class StepData {
  readonly lines: string[] = [];
  private n = 0;
  private dirs = new Map<string, number>();

  add(entity: string): number {
    this.lines.push(`#${++this.n}=${entity};`);
    return this.n;
  }

  /** DIRECTIONs repeat a lot (axis-aligned faces), so they are shared. */
  dir(x: number, y: number, z: number): number {
    const key = `${stepReal(x, 10)},${stepReal(y, 10)},${stepReal(z, 10)}`;
    let id = this.dirs.get(key);
    if (id === undefined) {
      id = this.add(`DIRECTION('',(${key}))`);
      this.dirs.set(key, id);
    }
    return id;
  }

  point(x: number, y: number, z: number): number {
    return this.add(`CARTESIAN_POINT('',(${stepReal(x)},${stepReal(y)},${stepReal(z)}))`);
  }

  /** AXIS2_PLACEMENT_3D at `o` with Z along `axis` and X along `ref`. */
  placement(o: number[], axis: number[] = [0, 0, 1], ref: number[] = [1, 0, 0]): number {
    return this.add(`AXIS2_PLACEMENT_3D('',#${this.point(o[0], o[1], o[2])},#${this.dir(axis[0], axis[1], axis[2])},#${this.dir(ref[0], ref[1], ref[2])})`);
  }
}

/** Write one shell's topology and geometry; returns the CLOSED_SHELL id. */
function writeShell(d: StepData, shell: BrepShell, flip = false): number {
  const pts: number[] = [];
  const vps: number[] = [];
  for (let i = 0; i < shell.points.length; i += 3) {
    const cp = d.point(shell.points[i], shell.points[i + 1], shell.points[i + 2]);
    pts.push(cp);
    vps.push(d.add(`VERTEX_POINT('',#${cp})`));
  }
  const P = (i: number) => [shell.points[i * 3], shell.points[i * 3 + 1], shell.points[i * 3 + 2]];
  const edges: number[] = [];
  for (let e = 0; e < shell.edges.length; e += 2) {
    const a = shell.edges[e], b = shell.edges[e + 1];
    const [ax, ay, az] = P(a);
    const [bx, by, bz] = P(b);
    const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
    const vec = d.add(`VECTOR('',#${d.dir((bx - ax) / len, (by - ay) / len, (bz - az) / len)},1.)`);
    const line = d.add(`LINE('',#${pts[a]},#${vec})`);
    edges.push(d.add(`EDGE_CURVE('',#${vps[a]},#${vps[b]},#${line},.T.)`));
  }
  const faces: number[] = [];
  for (const f of shell.faces) {
    const n = flip ? f.normal.map((v) => -v) : f.normal;
    const bounds = f.loops.map((loop, i) => {
      const seq = flip ? [...loop].reverse().map((se) => -se) : loop;
      const oes = seq.map((se) => d.add(`ORIENTED_EDGE('',*,*,#${edges[Math.abs(se) - 1]},${se > 0 ? '.T.' : '.F.'})`));
      const el = d.add(`EDGE_LOOP('',(${oes.map((o) => `#${o}`).join(',')}))`);
      return d.add(`${i === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${el},.T.)`);
    });
    const plane = d.add(`PLANE('',#${d.placement(f.origin, n, refFor(n))})`);
    faces.push(d.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(',')}),#${plane},.T.)`));
  }
  return d.add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}))`);
}

/** A unit vector in the plane: the world axis least aligned with the normal, made perpendicular to it. */
function refFor(n: number[]): number[] {
  const a = Math.abs(n[0]) <= Math.abs(n[1]) && Math.abs(n[0]) <= Math.abs(n[2]) ? [1, 0, 0] : Math.abs(n[1]) <= Math.abs(n[2]) ? [0, 1, 0] : [0, 0, 1];
  const dot = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
  const r = [a[0] - dot * n[0], a[1] - dot * n[1], a[2] - dot * n[2]];
  const l = Math.hypot(r[0], r[1], r[2]);
  return r.map((v) => v / l);
}

/**
 * Solids for a set of shells: each outward shell is a MANIFOLD_SOLID_BREP;
 * cavity shells (negative volume) become voids of the smallest solid around them.
 */
function writeSolids(d: StepData, name: string, shells: BrepShell[]): number[] {
  const solids = shells.filter((s) => s.volume > 0);
  const voids = shells.filter((s) => s.volume <= 0);
  const box = (s: BrepShell) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.points.length; i++) {
      min[i % 3] = Math.min(min[i % 3], s.points[i]);
      max[i % 3] = Math.max(max[i % 3], s.points[i]);
    }
    return { min, max };
  };
  const holes = new Map<BrepShell, BrepShell[]>();
  for (const v of voids) {
    const vb = box(v);
    const around = solids
      .filter((s) => {
        const sb = box(s);
        return [0, 1, 2].every((k) => sb.min[k] <= vb.min[k] && sb.max[k] >= vb.max[k]);
      })
      .sort((a, b) => a.volume - b.volume)[0];
    if (around) holes.set(around, [...(holes.get(around) ?? []), v]);
  }
  return solids.map((s, i) => {
    const label = stepString(solids.length > 1 ? `${name} ${i + 1}` : name);
    const shell = writeShell(d, s);
    const inside = holes.get(s);
    if (!inside) return d.add(`MANIFOLD_SOLID_BREP(${label},#${shell})`);
    // A void is an outward shell of the cavity, used reversed.
    const vs = inside.map((v) => d.add(`ORIENTED_CLOSED_SHELL('',*,#${writeShell(d, v, true)},.F.)`));
    return d.add(`BREP_WITH_VOIDS(${label},#${shell},(${vs.map((v) => `#${v}`).join(',')}))`);
  });
}

export interface StepBody {
  name: string;
  /** Planar B-rep shells of the body (meshToShells). */
  shells: BrepShell[];
}

export interface StepPart {
  name: string;
  bodies: StepBody[];
}

export interface StepInstance {
  /** Index into parts. */
  part: number;
  name: string;
  /** Placement (rotation + translation, 3MF row-vector convention). */
  transform: Mat12;
}

export interface StepDocument {
  /** Product name of the file (the assembly, or the single part). */
  name: string;
  parts: StepPart[];
  /** Placed parts. Omitted: a single part at the origin. */
  instances?: StepInstance[];
  fileName?: string;
  /** Timestamp for the header (default now). */
  date?: Date;
}

/** Shells for a mesh and its overlay bodies (other-filament parts). */
export function meshBodies(name: string, mesh: MeshData, opts?: BrepOptions): StepBody[] {
  return [
    { name, shells: meshToShells(mesh.positions, mesh.indices, opts) },
    ...(mesh.overlays ?? []).map((o) => ({ name: `${name} – ${o.name}`, shells: meshToShells(o.positions, o.indices, opts) })),
  ];
}

/** The STEP file as text. */
export function writeStep(doc: StepDocument): string {
  const d = new StepData();
  const ctxApp = d.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  d.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctxApp})`);
  const ctxProduct = d.add(`PRODUCT_CONTEXT('',#${ctxApp},'mechanical')`);
  const ctxDef = d.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ctxApp},'design')`);
  const mm = d.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const rad = d.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const sr = d.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = d.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${stepReal(DEFAULT_TOLERANCE)}),#${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = d.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${rad},#${sr}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  const products: number[] = [];
  const product = (name: string) => {
    const s = stepString(name);
    const p = d.add(`PRODUCT(${s},${s},'',(#${ctxProduct}))`);
    products.push(p);
    const pdf = d.add(`PRODUCT_DEFINITION_FORMATION('','',#${p})`);
    const pd = d.add(`PRODUCT_DEFINITION('design','',#${pdf},#${ctxDef})`);
    const pds = d.add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
    return { pd, pds };
  };
  // A part: its SHAPE_REPRESENTATION (an origin to place it by) tied to the B-rep.
  const writePart = (part: StepPart) => {
    const { pd, pds } = product(part.name);
    const origin = d.placement([0, 0, 0]);
    const rep = d.add(`SHAPE_REPRESENTATION(${stepString(part.name)},(#${origin}),#${ctx})`);
    d.add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
    const solids = part.bodies.flatMap((b) => writeSolids(d, b.name, b.shells));
    const brep = d.add(
      `ADVANCED_BREP_SHAPE_REPRESENTATION(${stepString(part.name)},(${[...solids, d.placement([0, 0, 0])].map((s) => `#${s}`).join(',')}),#${ctx})`,
    );
    d.add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',#${rep},#${brep})`);
    return { pd, rep, origin };
  };

  if (!doc.instances) {
    if (doc.parts.length !== 1) throw new Error('writeStep: several parts need instances.');
    writePart({ ...doc.parts[0], name: doc.name });
  } else {
    const top = product(doc.name);
    const parts = doc.parts.map(writePart);
    const items = [d.placement([0, 0, 0])];
    const links: [number, number][] = [];
    for (const inst of doc.instances) {
      const m = inst.transform;
      const at = d.placement([m[9], m[10], m[11]], unit([m[6], m[7], m[8]]), unit([m[0], m[1], m[2]]));
      items.push(at);
      links.push([inst.part, at]);
    }
    const topRep = d.add(`SHAPE_REPRESENTATION(${stepString(doc.name)},(${items.map((i) => `#${i}`).join(',')}),#${ctx})`);
    d.add(`SHAPE_DEFINITION_REPRESENTATION(#${top.pds},#${topRep})`);
    doc.instances.forEach((inst, i) => {
      const part = parts[links[i][0]];
      const s = stepString(inst.name);
      const nauo = d.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}',${s},'',#${top.pd},#${part.pd},$)`);
      const pds = d.add(`PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item',#${nauo})`);
      const idt = d.add(`ITEM_DEFINED_TRANSFORMATION('','',#${part.origin},#${links[i][1]})`);
      const rel = d.add(
        `(REPRESENTATION_RELATIONSHIP('','',#${part.rep},#${topRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`,
      );
      d.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rel},#${pds})`);
    });
  }
  d.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${products.map((p) => `#${p}`).join(',')}))`);

  const stamp = (doc.date ?? new Date()).toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${stepString(`Gridfit: ${doc.name}`)}),'2;1');`,
    `FILE_NAME(${stepString(doc.fileName ?? `${doc.name}.step`)},'${stamp}',('Gridfit'),(''),'Gridfit','Gridfit','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;',
    'DATA;',
    ...d.lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

function unit(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return v.map((x) => x / l);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';

/** One placed part in a STEP assembly. */
export interface StepItem {
  name: string;
  meshKey: string;
  transform: Mat12;
}

/** A STEP file to write: a named set of placed parts. */
export interface StepAssembly {
  name: string;
  items: StepItem[];
}

/** B-reps are worth keeping between files of one export (the same bin on several plates). */
export type BodyCache = Map<string, StepBody[]>;

/**
 * Imported bins (external.ts) go in like Gridfit's own meshes, as faceted
 * solids, when they're closed; an open mesh can't be a STEP solid, so it's
 * left out (as is one the B-rep conversion can't close after all). The 3MF,
 * Bambu and STL exports have them all.
 */
export const isImportedKey = (meshKey: string) => meshKey.startsWith('imported|');

/** True for an imported mesh STEP leaves out (not a closed solid). */
export function stepSkips(job: Pick<PrintJob, 'meshes'>, meshKey: string): boolean {
  const spec = job.meshes[meshKey];
  return spec?.kind === 'imported' && !!spec.open;
}

/** Placed parts as one assembly; parts with the same mesh share one product. */
export function assemblySTEP(asm: StepAssembly, getMesh: MeshLookup, cache: BodyCache = new Map()): string {
  const parts: StepPart[] = [];
  const index = new Map<string, number>();
  const instances: StepInstance[] = asm.items.flatMap((it) => {
    let i = index.get(it.meshKey);
    if (i === undefined) {
      let bodies = cache.get(it.meshKey);
      if (!bodies) {
        try {
          bodies = meshBodies(it.name, getMesh(it.meshKey));
        } catch (e) {
          if (!isImportedKey(it.meshKey)) throw e;
          bodies = [];
        }
        cache.set(it.meshKey, bodies);
      }
      if (!bodies.length || bodies.every((b) => !b.shells.length)) return [];
      i = parts.length;
      parts.push({ name: it.name, bodies });
      index.set(it.meshKey, i);
    }
    return [{ part: i, name: it.name, transform: it.transform }];
  });
  return writeStep({ name: asm.name, parts, instances, fileName: `${slug(asm.name)}.step` });
}

/** A single part at the origin (the selected bin). */
export function exportSingleSTEP(name: string, mesh: MeshData): Uint8Array {
  return strToU8(writeStep({ name, parts: [{ name, bodies: meshBodies(name, mesh) }], fileName: `${slug(name)}.step` }));
}

/** A print plate's parts, placed as on the bed. */
export function plateAssembly(job: PrintJob, plateIndex: number): StepAssembly {
  const pl = job.plates[plateIndex];
  return {
    name: pl.name,
    items: pl.placements
      .filter((p) => !stepSkips(job, job.parts[p.key].meshKey))
      .map((p) => {
        const part = job.parts[p.key];
        return { name: part.name, meshKey: part.meshKey, transform: placeTransform(p.x, p.y, p.rotated, part.d) };
      }),
  };
}

export function exportPlateSTEP(job: PrintJob, plateIndex: number, getMesh: MeshLookup, cache?: BodyCache): Uint8Array {
  return strToU8(assemblySTEP(plateAssembly(job, plateIndex), getMesh, cache));
}

/** Every plate as its own .step file, plus the assembly map(s). */
export function exportPlatesStepZip(job: PrintJob, getMesh: MeshLookup): Uint8Array {
  const cache: BodyCache = new Map();
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {};
  job.plates.forEach((pl, i) => {
    files[`${printerFolder(job, pl)}${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.step`] = [exportPlateSTEP(job, i, getMesh, cache), { level: 6 }];
  });
  for (const [name, text] of Object.entries(assemblyMaps(job))) files[name] = strToU8(text);
  return zipSync(files);
}

/** Assembled drawers: one file when there's one, else a zip with one .step per drawer. */
export function exportAssembliesSTEP(assemblies: StepAssembly[], getMesh: MeshLookup): Uint8Array {
  const cache: BodyCache = new Map();
  if (assemblies.length === 1) return strToU8(assemblySTEP(assemblies[0], getMesh, cache));
  const files: Record<string, [Uint8Array, { level: 6 }]> = {};
  assemblies.forEach((a, i) => {
    files[`${String(i + 1).padStart(2, '0')}-${slug(a.name)}.step`] = [strToU8(assemblySTEP(a, getMesh, cache)), { level: 6 }];
  });
  return zipSync(files);
}

/** What drawerAssemblies needs of each drawer: its baseplate settings and bins. */
export interface AssemblyDrawer {
  id: string;
  name: string;
  baseplate: BaseplateOptions;
  bins: PlacedBin[];
}

const translate = (x: number, y: number, z: number): Mat12 => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];

/**
 * Each drawer of a job as it goes together: baseplate pieces in place, bins
 * seated on it with their lids, trays, sliding lids, container parts and
 * label plates where the drawer view shows them. Connector keys and loose
 * divider plates are left out (they're on the print plates), and so is a
 * baseplate that's there already ("Just bins"): its bins sit where they would on it.
 */
export function drawerAssemblies(job: PrintJob, drawers: AssemblyDrawer[]): StepAssembly[] {
  const multi = job.drawers.length > 1;
  return job.drawers.map((dj, di) => {
    const doc = multi ? drawers.find((d) => d.id === dj.id) : drawers[0];
    const prefix = multi ? `${dj.id}/` : '';
    const items: StepItem[] = [];
    const add = (key: string, x: number, y: number, z: number) => {
      const part = job.parts[key];
      if (part && !stepSkips(job, part.meshKey)) items.push({ name: part.name, meshKey: part.meshKey, transform: translate(x, y, z) });
    };
    if (!dj.haveBaseplate) for (const p of dj.plan.pieces) add(`${prefix}piece:${p.id}`, p.x0, p.y0, 0);
    if (doc) {
      const seat = binSeatHeight(doc.baseplate);
      // Stacked bins stand on the bin below (stacking.ts).
      const stacked = stackPlaces(dj.layout, doc.bins);
      for (const b of doc.bins) {
        if (!job.parts[`${prefix}bin:${b.id}`]) continue;
        const at = binOrigin(dj.layout, b);
        const z = seat + (stacked.get(b.id)?.z ?? 0);
        add(`${prefix}bin:${b.id}`, at.x, at.y, z);
        add(`${prefix}lid:${b.id}`, at.x, at.y, z + binBodyHeight(b.opts) - LID_SEAT_DROP);
        for (const a of assembledParts(job, b.id, prefix)) add(a.key, at.x + a.assembled.x, at.y + a.assembled.y, z + a.assembled.z);
        for (const p of Object.values(job.parts)) {
          if (p.bin === b.id && p.assembled && p.key.startsWith(prefix) && (!multi || p.drawer === dj.id)) {
            add(p.key, at.x + p.assembled.x, at.y + p.assembled.y, z + p.assembled.z);
          }
        }
        for (let i = 0; job.parts[`${prefix}label:${b.id}:${i}`]; i++) {
          const pl = job.parts[`${prefix}label:${b.id}:${i}`];
          if (pl.assembled) add(pl.key, at.x + pl.assembled.x, at.y + pl.assembled.y, z + pl.assembled.z);
        }
      }
    }
    const name = dj.name || doc?.name || `Drawer ${di + 1}`;
    return { name: `${name} assembled`, items };
  });
}
