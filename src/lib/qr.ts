/**
 * QR Code encoder (ISO/IEC 18004, model 2), written for Gridfit after the
 * structure of Project Nayuki's "QR Code generator library" (MIT,
 * https://www.nayuki.io/page/qr-code-generator-library): the same capacity
 * tables, block layout, codeword placement and mask penalty rules.
 *
 * - One segment per code, in the most compact mode the whole text allows:
 *   numeric (digits), alphanumeric (0–9, A–Z, space and $%*+-./:) or bytes
 *   (UTF-8, which every phone camera reads).
 * - Versions 1–40, error correction L / M / Q / H (7, 15, 25, 30 % of the code
 *   can be damaged and it still reads); the smallest version that holds the
 *   text at the chosen level.
 * - Reed–Solomon over GF(256), all 8 masks tried and the one with the lowest
 *   penalty kept, format and version information drawn.
 *
 * Pure (no DOM, no geometry). This module only counts bits and holds the
 * tables, for planning on every edit (it is on the first screen); the matrix
 * itself is built by qrEncode.ts, which loads in the geometry worker and with
 * the panels that draw codes.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';
export const QR_ECCS: readonly QrEcc[] = ['L', 'M', 'Q', 'H'];
export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

/** Blank modules the standard wants around the code, on every side. */
export const QR_QUIET = 4;
export const QR_MAX_VERSION = 40;

/** Share of the code each level can lose and still read. */
export const QR_RECOVERY: Record<QrEcc, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

// Index 0 is unused; [ecc][version].
export const ECC_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
export const EC_BLOCKS: Record<QrEcc, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
export const FORMAT_ECC: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };
export const MODE_BITS: Record<QrMode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };
const COUNT_BITS: Record<QrMode, [number, number, number]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] };
export const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Modules per side of a version, without the quiet zone. */
export const qrSize = (version: number) => 4 * version + 17;

/** Data and error-correction modules of a version (everything but the function patterns). */
export function rawModules(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

/** Data codewords (bytes) a version holds at a level. */
export function qrDataCodewords(version: number, ecc: QrEcc): number {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[ecc][version] * EC_BLOCKS[ecc][version];
}

/** The most compact mode for the whole text. */
export function qrMode(text: string): QrMode {
  if (/^[0-9]*$/.test(text)) return 'numeric';
  if ([...text].every((c) => ALNUM.includes(c))) return 'alphanumeric';
  return 'byte';
}

export const utf8 = (text: string) => new TextEncoder().encode(text);

/** How many bytes the text is in UTF-8 (what byte mode stores). */
export const qrByteLength = (text: string) => utf8(text).length;

/** Characters (numeric, alphanumeric) or UTF-8 bytes the text takes in its mode. */
function units(text: string, mode: QrMode): number {
  return mode === 'byte' ? qrByteLength(text) : text.length;
}

export const countBits = (mode: QrMode, v: number) => COUNT_BITS[mode][v <= 9 ? 0 : v <= 26 ? 1 : 2];

/** Bits of the segment (mode, count, data) at a version; Infinity when the count doesn't fit its field. */
function segmentBits(mode: QrMode, n: number, v: number): number {
  const cb = countBits(mode, v);
  if (n >= 1 << cb) return Infinity;
  const data = mode === 'numeric' ? Math.floor(n / 3) * 10 + [0, 4, 7][n % 3] : mode === 'alphanumeric' ? Math.floor(n / 2) * 11 + (n % 2) * 6 : n * 8;
  return 4 + cb + data;
}

export interface QrFit {
  version: number;
  /** Modules per side, without the quiet zone. */
  size: number;
  mode: QrMode;
  /** Characters (numeric, alphanumeric) or UTF-8 bytes. */
  length: number;
  /** Bits the text takes, and what the version holds. */
  bits: number;
  capacity: number;
}

/** The smallest version (from `min` to `max`) that holds the text at a level, or null when none does. */
export function qrFit(text: string, ecc: QrEcc, max = QR_MAX_VERSION, min = 1): QrFit | null {
  const mode = qrMode(text);
  const n = units(text, mode);
  for (let v = Math.max(1, min); v <= Math.min(QR_MAX_VERSION, max); v++) {
    const bits = segmentBits(mode, n, v);
    const capacity = qrDataCodewords(v, ecc) * 8;
    if (bits <= capacity) return { version: v, size: qrSize(v), mode, length: n, bits, capacity };
  }
  return null;
}

/** The most characters (bytes, for byte mode) of `mode` that fit a version at a level. */
export function qrCapacity(version: number, ecc: QrEcc, mode: QrMode = 'byte'): number {
  const cap = qrDataCodewords(version, ecc) * 8;
  let lo = 0;
  let hi = 8000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (segmentBits(mode, mid, version) <= cap) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
