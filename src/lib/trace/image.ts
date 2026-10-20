/**
 * Plain image buffers for the tracing pipeline. No DOM: everything works on
 * `{ width, height, data }` so it runs in tests, workers and the main thread.
 */

export type Pt = [number, number];

/** RGBA, 4 bytes per pixel, row-major, y down (same layout as ImageData). */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** One byte per pixel, 0..255. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** One byte per pixel, 0 or 1. */
export type Mask = GrayImage;

export function createRGBA(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function createGray(width: number, height: number): GrayImage {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Rec. 601 luma. */
export function luminance(img: RGBAImage): GrayImage {
  const out = createGray(img.width, img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < out.data.length; i++, p += 4) {
    out.data[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  }
  return out;
}

/**
 * How the tool differs from the paper:
 * - 'dark': darker than the paper (most tools on white paper)
 * - 'color': more saturated than the paper (coloured handles, grey shadows ignored)
 * - 'auto': whichever is stronger per pixel
 */
export type ForegroundMode = 'auto' | 'dark' | 'color';

/**
 * Per-pixel "tool-ness", 0..255: high where the pixel is likely tool.
 * `invert` flips the brightness term, for a light tool on a dark background.
 */
export function foreground(img: RGBAImage, mode: ForegroundMode, invert = false): GrayImage {
  const out = createGray(img.width, img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < out.data.length; i++, p += 4) {
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const lum = (r * 77 + g * 150 + b * 29) >> 8;
    const dark = invert ? lum : 255 - lum;
    // Chroma (max - min) rather than HSV saturation: it stays near 0 for grey shadows and noisy blacks.
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    out.data[i] = mode === 'dark' ? dark : mode === 'color' ? (invert ? 255 - chroma : chroma) : Math.max(dark, chroma);
  }
  return out;
}

/** Separable box blur with clamped edges. radius 0 returns a copy. */
export function boxBlur(src: GrayImage, radius: number): GrayImage {
  const r = Math.max(0, Math.round(radius));
  const { width: w, height: h } = src;
  if (r === 0) return { width: w, height: h, data: src.data.slice() };
  const tmp = new Float32Array(w * h);
  const out = createGray(w, h);
  const n = 2 * r + 1;
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src.data[row + clampInt(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src.data[row + clampInt(x + r + 1, 0, w - 1)] - src.data[row + clampInt(x - r, 0, w - 1)];
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clampInt(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out.data[y * w + x] = Math.round(acc / n);
      acc += tmp[clampInt(y + r + 1, 0, h - 1) * w + x] - tmp[clampInt(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** Bilinear sample of one RGBA channel set at (x, y) in pixel-center coordinates; writes into out[o..o+3]. */
export function sampleBilinear(img: RGBAImage, x: number, y: number, out: Uint8ClampedArray, o: number) {
  const { width: w, height: h, data } = img;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = clampInt(x0, 0, w - 1);
  const xb = clampInt(x0 + 1, 0, w - 1);
  const ya = clampInt(y0, 0, h - 1);
  const yb = clampInt(y0 + 1, 0, h - 1);
  const p00 = (ya * w + xa) * 4;
  const p10 = (ya * w + xb) * 4;
  const p01 = (yb * w + xa) * 4;
  const p11 = (yb * w + xb) * 4;
  for (let c = 0; c < 4; c++) {
    const top = data[p00 + c] + (data[p10 + c] - data[p00 + c]) * tx;
    const bot = data[p01 + c] + (data[p11 + c] - data[p01 + c]) * tx;
    out[o + c] = top + (bot - top) * ty;
  }
}

/** Area-average downscale so the long side is at most `maxSide` (no-op when already small). */
export function downscale(img: RGBAImage, maxSide: number): { image: RGBAImage; scale: number } {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return { image: img, scale: 1 };
  const k = Math.ceil(long / maxSide);
  const w = Math.max(1, Math.floor(img.width / k));
  const h = Math.max(1, Math.floor(img.height / k));
  const out = createRGBA(w, h);
  const kk = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < k; j++) {
        let p = ((y * k + j) * img.width + x * k) * 4;
        for (let i = 0; i < k; i++, p += 4) {
          r += img.data[p];
          g += img.data[p + 1];
          b += img.data[p + 2];
          a += img.data[p + 3];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / kk;
      out.data[o + 1] = g / kk;
      out.data[o + 2] = b / kk;
      out.data[o + 3] = a / kk;
    }
  }
  return { image: out, scale: 1 / k };
}

export function clampInt(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
