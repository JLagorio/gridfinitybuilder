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
 * Pure (no DOM, no geometry). `qrFit` only counts bits, for planning on every
 * edit; `encodeQr` builds the matrix.
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
const ECC_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const EC_BLOCKS: Record<QrEcc, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_ECC: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };
const MODE_BITS: Record<QrMode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };
const COUNT_BITS: Record<QrMode, [number, number, number]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] };
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Modules per side of a version, without the quiet zone. */
export const qrSize = (version: number) => 4 * version + 17;

/** Data and error-correction modules of a version (everything but the function patterns). */
function rawModules(v: number): number {
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

const utf8 = (text: string) => new TextEncoder().encode(text);

/** How many bytes the text is in UTF-8 (what byte mode stores). */
export const qrByteLength = (text: string) => utf8(text).length;

/** Characters (numeric, alphanumeric) or UTF-8 bytes the text takes in its mode. */
function units(text: string, mode: QrMode): number {
  return mode === 'byte' ? qrByteLength(text) : text.length;
}

const countBits = (mode: QrMode, v: number) => COUNT_BITS[mode][v <= 9 ? 0 : v <= 26 ? 1 : 2];

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

// ---------------------------------------------------------------------------
// Reed–Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1
// ---------------------------------------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Coefficients of the generator polynomial of a degree (highest first, leading 1 left out). */
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    divisor.forEach((coef, i) => (out[i] ^= gfMul(coef, factor)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface QrCode extends QrFit {
  ecc: QrEcc;
  mask: number;
  /** size × size, row-major from the top-left; 1 = dark. */
  modules: Uint8Array;
}

/** The data codewords: segment, terminator, padding. */
function dataCodewords(text: string, fit: QrFit, ecc: QrEcc): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  const { mode, length, version } = fit;
  put(MODE_BITS[mode], 4);
  put(length, countBits(mode, version));
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const g = text.slice(i, i + 3);
      put(Number(g), g.length * 3 + 1);
    }
  } else if (mode === 'alphanumeric') {
    for (let i = 0; i < text.length; i += 2) {
      if (i + 1 < text.length) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
      else put(ALNUM.indexOf(text[i]), 6);
    }
  } else for (const b of utf8(text)) put(b, 8);
  const cap = qrDataCodewords(version, ecc) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Split into blocks, add each block's error correction, interleave. */
function withErrorCorrection(data: number[], version: number, ecc: QrEcc): number[] {
  const numBlocks = EC_BLOCKS[ecc][version];
  const eccLen = ECC_PER_BLOCK[ecc][version];
  const raw = Math.floor(rawModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const block = [...dat, ...rsRemainder(dat, divisor)];
    // Short blocks get a placeholder where long blocks have their extra data byte.
    if (i < numShort) block.splice(shortLen - eccLen, 0, -1);
    blocks.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]);
    });
  }
  return out;
}

/** The final codeword sequence (data and error correction, interleaved) of the text in its smallest version: for tests. */
export function qrCodewords(text: string, ecc: QrEcc): number[] | null {
  const fit = qrFit(text, ecc);
  return fit && withErrorCorrection(dataCodewords(text, fit, ecc), fit.version, ecc);
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = qrSize(version) - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  readonly m: Uint8Array;
  readonly fixed: Uint8Array;
  constructor(readonly size: number) {
    this.m = new Uint8Array(size * size);
    this.fixed = new Uint8Array(size * size);
  }
  get(x: number, y: number) {
    return this.m[y * this.size + x];
  }
  set(x: number, y: number, dark: boolean) {
    this.m[y * this.size + x] = dark ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }
}

function drawFormat(q: Matrix, ecc: QrEcc, mask: number) {
  const data = (FORMAT_ECC[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const n = q.size;
  for (let i = 0; i <= 5; i++) q.set(8, i, bit(i));
  q.set(8, 7, bit(6));
  q.set(8, 8, bit(7));
  q.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) q.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) q.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) q.set(8, n - 15 + i, bit(i));
  q.set(8, n - 8, true);
}

function drawFunctionPatterns(q: Matrix, version: number, ecc: QrEcc) {
  const n = q.size;
  for (let i = 0; i < n; i++) {
    q.set(6, i, i % 2 === 0);
    q.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) q.set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(n - 4, 3);
  finder(3, n - 4);
  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      // Not over the finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) q.set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve the format areas (drawn for real once the mask is known).
  drawFormat(q, ecc, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      q.set(a, b, dark);
      q.set(b, a, dark);
    }
  }
}

function drawCodewords(q: Matrix, data: number[]) {
  const n = q.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!q.fixed[y * n + x] && i < data.length * 8) {
          q.m[y * n + x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
}

function applyMask(q: Matrix, mask: number) {
  const f = MASKS[mask];
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!q.fixed[y * q.size + x] && f(x, y)) q.m[y * q.size + x] ^= 1;
}

const FINDER_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const FINDER_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

/** The spec's mask penalty: long runs, 2 × 2 blocks, finder look-alikes, dark/light balance. */
function penalty(q: Matrix): number {
  const n = q.size;
  let p = 0;
  const line = (get: (i: number) => number) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) p += 3 + run - 5;
        run = 1;
      }
    }
    // Finder look-alikes, with light beyond the edges.
    const at = (i: number) => (i >= 0 && i < n ? get(i) : 0);
    for (let i = -4; i < n; i++) {
      for (const pat of [FINDER_A, FINDER_B]) {
        let k = 0;
        while (k < 11 && at(i + k) === pat[k]) k++;
        if (k === 11) p += 40;
      }
    }
  };
  for (let y = 0; y < n; y++) line((x) => q.get(x, y));
  for (let x = 0; x < n; x++) line((y) => q.get(x, y));
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = q.get(x, y);
      if (c === q.get(x + 1, y) && c === q.get(x, y + 1) && c === q.get(x + 1, y + 1)) p += 3;
    }
  }
  let dark = 0;
  for (const v of q.m) dark += v;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return p + Math.max(0, k) * 10;
}

/**
 * Encode text at an error-correction level in the smallest version (from
 * `minVersion`) that holds it. Null when it's too long for version
 * `maxVersion` (40 at most).
 */
export function encodeQr(text: string, ecc: QrEcc = 'M', opts: { minVersion?: number; maxVersion?: number; mask?: number } = {}): QrCode | null {
  const fit = qrFit(text, ecc, opts.maxVersion ?? QR_MAX_VERSION, opts.minVersion ?? 1);
  if (!fit) return null;
  const codewords = withErrorCorrection(dataCodewords(text, fit, ecc), fit.version, ecc);
  const base = new Matrix(fit.size);
  drawFunctionPatterns(base, fit.version, ecc);
  drawCodewords(base, codewords);
  let best: { mask: number; m: Uint8Array; p: number } | null = null;
  const masks = opts.mask !== undefined && opts.mask >= 0 && opts.mask < 8 ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const q = new Matrix(fit.size);
    q.m.set(base.m);
    q.fixed.set(base.fixed);
    applyMask(q, mask);
    drawFormat(q, ecc, mask);
    const p = masks.length > 1 ? penalty(q) : 0;
    if (!best || p < best.p) best = { mask, m: q.m, p };
  }
  return { ...fit, ecc, mask: best!.mask, modules: best!.m };
}

/** Dark or not, with the quiet zone (and beyond) light. */
export function qrDark(code: Pick<QrCode, 'size' | 'modules'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < code.size && y < code.size && code.modules[y * code.size + x] === 1;
}

/**
 * The dark modules as rectangles (x, y, w, h in modules, from the top-left):
 * runs along each row, merged down the rows while they line up. Far fewer
 * than one per module, so the solid built from them stays small.
 */
export function qrRects(code: Pick<QrCode, 'size' | 'modules'>): [number, number, number, number][] {
  const n = code.size;
  const out: [number, number, number, number][] = [];
  // Open rectangles by their run (x0, x1): index into out.
  let open = new Map<string, number>();
  for (let y = 0; y < n; y++) {
    const next = new Map<string, number>();
    for (let x = 0; x < n; ) {
      if (!code.modules[y * n + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < n && code.modules[y * n + e]) e++;
      const k = `${x},${e}`;
      const i = open.get(k);
      if (i !== undefined) {
        out[i][3]++;
        next.set(k, i);
      } else {
        next.set(k, out.length);
        out.push([x, y, e - x, 1]);
      }
      x = e;
    }
    open = next;
  }
  return out;
}
