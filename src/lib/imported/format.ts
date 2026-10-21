import type { MeshData } from '../geometry/kernel';

/**
 * How Gridfit keeps an imported mesh (in IndexedDB, and base64 in project
 * files): "GFM1", the vertex and triangle counts, then float32 positions and
 * uint32 indices, all little-endian. Welded and centred at import
 * (imported/meshOps.ts), so the same model gives the same bytes, and the same
 * hash, whatever file it came from.
 */

const MAGIC = 0x314d4647; // "GFM1"
const HEAD = 12;

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** The mesh as bytes. */
export function encodeMesh(m: Pick<MeshData, 'positions' | 'indices'>): Uint8Array {
  const nv = m.positions.length / 3;
  const nt = m.indices.length / 3;
  const out = new Uint8Array(HEAD + nv * 12 + nt * 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, nv, true);
  dv.setUint32(8, nt, true);
  if (littleEndian) {
    new Float32Array(out.buffer, HEAD, nv * 3).set(m.positions);
    new Uint32Array(out.buffer, HEAD + nv * 12, nt * 3).set(m.indices);
  } else {
    for (let i = 0; i < nv * 3; i++) dv.setFloat32(HEAD + i * 4, m.positions[i], true);
    for (let i = 0; i < nt * 3; i++) dv.setUint32(HEAD + nv * 12 + i * 4, m.indices[i], true);
  }
  return out;
}

/** The mesh back from its bytes. Throws on anything that isn't one. */
export function decodeMesh(bytes: Uint8Array): MeshData {
  if (bytes.byteLength < HEAD) throw new Error('Not a Gridfit mesh.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a Gridfit mesh.');
  const nv = dv.getUint32(4, true);
  const nt = dv.getUint32(8, true);
  if (bytes.byteLength !== HEAD + nv * 12 + nt * 12) throw new Error('This mesh is damaged (its size is wrong).');
  // Typed views need aligned offsets; a copy has them.
  const own = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  let positions: Float32Array;
  let indices: Uint32Array;
  if (littleEndian) {
    positions = new Float32Array(own.buffer, own.byteOffset + HEAD, nv * 3).slice();
    indices = new Uint32Array(own.buffer, own.byteOffset + HEAD + nv * 12, nt * 3).slice();
  } else {
    positions = new Float32Array(nv * 3);
    indices = new Uint32Array(nt * 3);
    for (let i = 0; i < nv * 3; i++) positions[i] = dv.getFloat32(HEAD + i * 4, true);
    for (let i = 0; i < nt * 3; i++) indices[i] = dv.getUint32(HEAD + nv * 12 + i * 4, true);
  }
  for (let i = 0; i < indices.length; i++) if (indices[i] >= nv) throw new Error('This mesh is damaged (a triangle points past its vertices).');
  return { positions, indices };
}

/**
 * Content hash of mesh bytes: two 53-bit cyrb-style hashes over the bytes'
 * 32-bit words, as 28 hex digits. Not cryptographic, just stable everywhere
 * (no crypto.subtle needed) and fast on tens of megabytes.
 */
export function meshHash(bytes: Uint8Array): string {
  let a1 = 0xdeadbeef ^ bytes.length;
  let a2 = 0x41c6ce57 ^ bytes.length;
  let b1 = 0x9e3779b9;
  let b2 = 0x85ebca6b;
  const words = Math.floor(bytes.length / 4);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words; i++) {
    const w = dv.getUint32(i * 4, true);
    a1 = Math.imul(a1 ^ w, 2654435761);
    a2 = Math.imul(a2 ^ w, 1597334677);
    b1 = Math.imul(b1 ^ w, 2246822519);
    b2 = Math.imul(b2 ^ (w + i), 3266489917);
  }
  for (let i = words * 4; i < bytes.length; i++) {
    a1 = Math.imul(a1 ^ bytes[i], 2654435761);
    b2 = Math.imul(b2 ^ bytes[i], 3266489917);
  }
  const fin = (h1: number, h2: number) => {
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return fin(a1, a2) + fin(b1, b2);
}

/** A mesh hash as meshHash writes it. */
export const isMeshHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{28}$/.test(v);
