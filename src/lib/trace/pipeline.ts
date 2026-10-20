import { boxBlur, downscale, foreground, luminance, type ForegroundMode, type GrayImage, type Mask, type Pt, type RGBAImage } from './image';
import {
  closeMask,
  componentMask,
  joinPieces,
  labelComponents,
  marchingSquares,
  openMask,
  otsu,
  pickComponents,
  threshold,
  type Component,
} from './segment';
import { chaikin, dedupe, signedArea, simplifyClosed } from './polygon';

/**
 * Photo → tool outline, in stages so a UI can re-run only what a slider changed:
 *   score(image)  → blur  → mask(threshold, cleanup) → components → pick → outline
 */

export interface TraceParams {
  mode: ForegroundMode;
  invert: boolean;
  /** Blur radius before thresholding, px. */
  blur: number;
  /** 0..255, or null for Otsu's automatic threshold. */
  threshold: number | null;
  /** Morphological close + open radius, px (fills scratches, removes specks). */
  cleanup: number;
  /** Ramer–Douglas–Peucker tolerance, mm. */
  simplify: number;
  /** Chaikin smoothing passes. */
  smooth: number;
}

export const DEFAULT_TRACE: TraceParams = {
  mode: 'auto',
  invert: false,
  blur: 1,
  threshold: null,
  cleanup: 2,
  simplify: 0.3,
  smooth: 1,
};

/** Stage 1: blurred tool-ness score. */
export function traceScore(img: RGBAImage, p: Pick<TraceParams, 'mode' | 'invert' | 'blur'>): GrayImage {
  return boxBlur(foreground(img, p.mode, p.invert), p.blur);
}

export interface MaskStage {
  mask: Mask;
  /** Threshold actually used. */
  threshold: number;
  labels: Int32Array;
  comps: Component[];
}

/** Stage 2: threshold, clean up and label. */
export function traceMask(score: GrayImage, p: Pick<TraceParams, 'threshold' | 'cleanup'>): MaskStage {
  const t = p.threshold ?? otsu(score);
  let mask = threshold(score, t);
  if (p.cleanup > 0) mask = openMask(closeMask(mask, p.cleanup), p.cleanup);
  const { labels, comps } = labelComponents(mask);
  return { mask, threshold: t, labels, comps };
}

/**
 * Stage 3: outline of the picked components, in pixel coordinates (y down).
 * Several picked pieces are bridged first; holes (e.g. a wrench's box end) are ignored.
 */
export function traceContour(stage: MaskStage, width: number, ids: number[], joinRadius = 16): Pt[] | null {
  const cm = componentMask(stage.labels, stage.comps, width, ids, joinRadius + 2);
  if (!cm) return null;
  const m = ids.length > 1 ? joinPieces(cm.mask, joinRadius) : cm.mask;
  // A light blur gives marching squares sub-pixel, diagonal-friendly edges.
  const field = new Float32Array(m.data.length);
  const soft = boxBlur({ width: m.width, height: m.height, data: m.data.map((v) => v * 255) }, 1);
  for (let i = 0; i < field.length; i++) field[i] = soft.data[i] / 255;
  const loops = marchingSquares(field, m.width, m.height, 0.5);
  if (!loops.length) return null;
  const outer = loops.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  return outer.map(([x, y]) => [x + cm.ox, y + cm.oy] as Pt);
}

/**
 * Stage 4: pixels → mm (y up, as seen from above), simplified and smoothed.
 * Counter-clockwise. Not centred: the caller decides the origin.
 */
export function contourToMm(px: Pt[], pxPerMmX: number, pxPerMmY: number, heightPx: number, p: Pick<TraceParams, 'simplify' | 'smooth'>): Pt[] {
  let mm = px.map(([x, y]) => [x / pxPerMmX, (heightPx - y) / pxPerMmY] as Pt);
  mm = dedupe(mm);
  if (p.simplify > 0) mm = simplifyClosed(mm, p.simplify);
  if (p.smooth > 0) mm = chaikin(mm, Math.round(p.smooth));
  // A light extra pass after smoothing keeps the point count sane.
  if (p.simplify > 0 && p.smooth > 0) mm = simplifyClosed(mm, Math.min(0.05, p.simplify / 4));
  if (signedArea(mm) < 0) mm.reverse();
  return mm;
}

export interface TraceResult extends MaskStage {
  selected: number[];
  /** mm, y up, CCW; null when nothing was found. */
  outline: Pt[] | null;
}

/** The whole pipeline in one call (tests, scripts). `points` are click positions in pixels. */
export function traceImage(img: RGBAImage, pxPerMm: number, params: Partial<TraceParams> = {}, points?: Pt[]): TraceResult {
  const p = { ...DEFAULT_TRACE, ...params };
  const stage = traceMask(traceScore(img, p), p);
  const minArea = 25 * pxPerMm * pxPerMm; // 5 × 5 mm
  const selected = pickComponents(stage.labels, stage.comps, img.width, { points, minArea, snapRadius: 6 * pxPerMm });
  const px = selected.length ? traceContour(stage, img.width, selected, Math.round(4 * pxPerMm)) : null;
  return { ...stage, selected, outline: px ? contourToMm(px, pxPerMm, pxPerMm, img.height, p) : null };
}

/**
 * Best guess at the paper's corners in a photo: the largest bright region,
 * with its extreme points along the diagonals. Returns null when nothing
 * paper-like is found. Corners are in the photo's pixel coordinates.
 */
export function detectPaper(photo: RGBAImage): Pt[] | null {
  const { image, scale } = downscale(photo, 400);
  const lum = boxBlur(luminance(image), 1);
  const t = otsu(lum);
  let mask = threshold(lum, t);
  mask = openMask(mask, 2);
  const { labels, comps } = labelComponents(mask);
  if (!comps.length) return null;
  const big = comps.reduce((a, b) => (b.area > a.area ? b : a));
  if (big.area < 0.05 * image.width * image.height) return null;
  const w = image.width;
  let tl: Pt = [0, 0];
  let tr: Pt = [0, 0];
  let br: Pt = [0, 0];
  let bl: Pt = [0, 0];
  let sMin = Infinity;
  let sMax = -Infinity;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (let y = big.y0; y <= big.y1; y++) {
    for (let x = big.x0; x <= big.x1; x++) {
      if (labels[y * w + x] !== big.id) continue;
      const s = x + y;
      const d = x - y;
      if (s < sMin) [sMin, tl] = [s, [x, y]];
      if (s > sMax) [sMax, br] = [s, [x + 1, y + 1]];
      if (d > dMax) [dMax, tr] = [d, [x + 1, y]];
      if (d < dMin) [dMin, bl] = [d, [x, y + 1]];
    }
  }
  return [tl, tr, br, bl].map(([x, y]) => [x / scale, y / scale] as Pt);
}
