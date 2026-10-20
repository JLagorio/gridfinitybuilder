import { createRGBA, sampleBilinear, type Pt, type RGBAImage } from './image';

/**
 * Perspective correction: map the four corners of a sheet of paper in a photo
 * to a top-down image with a known scale (px per mm).
 */

/** Row-major 3 × 3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface PaperSize {
  id: string;
  label: string;
  /** Short side, mm. */
  w: number;
  /** Long side, mm. */
  h: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', w: 215.9, h: 279.4 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', w: 215.9, h: 355.6 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 279.4, h: 431.8 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
];

/** Homography H with H · src[i] ~ dst[i] (4 point pairs, no three collinear). */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('homography needs 4 point pairs');
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve(A);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting on an n × (n+1) augmented matrix. */
function solve(A: number[][]): number[] {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error('Degenerate corners: three of them are in a line.');
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

export function applyHomography(H: Mat3, [x, y]: Pt): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/**
 * Sort four corners into top-left, top-right, bottom-right, bottom-left
 * (image coordinates, y down), whatever order they were clicked in.
 */
export function orderCorners(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  if (pts.length !== 4) throw new Error('need 4 corners');
  const cx = pts.reduce((t, p) => t + p[0], 0) / 4;
  const cy = pts.reduce((t, p) => t + p[1], 0) / 4;
  // Ascending angle with y down = clockwise on screen: TL, TR, BR, BL for an upright quad.
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) if (sorted[i][0] + sorted[i][1] < sorted[first][0] + sorted[first][1]) first = i;
  return [0, 1, 2, 3].map((k) => sorted[(first + k) % 4]) as [Pt, Pt, Pt, Pt];
}

/** True when the four points form a convex quad (in any winding). */
export function isConvexQuad(pts: Pt[]): boolean {
  if (pts.length !== 4) return false;
  const q = orderCorners(pts);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export interface RectifyOptions {
  /** Output resolution (default 4 px/mm). */
  pxPerMm?: number;
  /** Cap on output pixels; the resolution drops to stay under it (default 2.5 MP). */
  maxPixels?: number;
}

export interface Rectified {
  image: RGBAImage;
  /** Paper size as laid out in the output (landscape if the paper was landscape in the photo). */
  widthMm: number;
  heightMm: number;
  /** Actual scale per axis after rounding to whole pixels. */
  pxPerMmX: number;
  pxPerMmY: number;
  /** Output pixel → photo pixel. */
  toPhoto: Mat3;
}

/**
 * Resample the photo so the paper fills the output exactly, top-down.
 * `paper` is given portrait (w ≤ h); the output follows the paper's
 * orientation in the photo (its longer pair of edges becomes the long side).
 */
export function rectifyPaper(photo: RGBAImage, corners: Pt[], paper: { w: number; h: number }, o: RectifyOptions = {}): Rectified {
  const [tl, tr, br, bl] = orderCorners(corners);
  const across = dist(tl, tr) + dist(bl, br);
  const down = dist(tl, bl) + dist(tr, br);
  const short = Math.min(paper.w, paper.h);
  const long = Math.max(paper.w, paper.h);
  const landscape = across > down;
  const widthMm = landscape ? long : short;
  const heightMm = landscape ? short : long;
  const maxPixels = o.maxPixels ?? 2_500_000;
  const ppm = Math.min(o.pxPerMm ?? 4, Math.sqrt(maxPixels / (widthMm * heightMm)));
  const W = Math.max(1, Math.round(widthMm * ppm));
  const H = Math.max(1, Math.round(heightMm * ppm));
  const toPhoto = homography(
    [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ],
    [tl, tr, br, bl],
  );
  const out = createRGBA(W, H);
  const h = toPhoto;
  for (let y = 0; y < H; y++) {
    const py = y + 0.5;
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const iw = 1 / (h[6] * px + h[7] * py + h[8]);
      const sx = (h[0] * px + h[1] * py + h[2]) * iw;
      const sy = (h[3] * px + h[4] * py + h[5]) * iw;
      sampleBilinear(photo, sx, sy, out.data, (y * W + x) * 4);
    }
  }
  return { image: out, widthMm, heightMm, pxPerMmX: W / widthMm, pxPerMmY: H / heightMm, toPhoto };
}
