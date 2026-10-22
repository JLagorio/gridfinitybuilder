/**
 * A photo of the wall behind the plan (components/WallPhoto.tsx, data in
 * ./data.ts WallPhoto). Four handles go on the corners of something
 * rectangular in the photo whose size is known: the wall's own corners (it is
 * as wide and high as the planner measured it), or a sheet of A4 or Letter
 * taped to it, upright or across, with its bottom-left corner where the user
 * says. Those four points give the homography from the photo to the wall's
 * millimetres (lib/trace/homography.ts, the tracer's perspective correction),
 * so the photo's scale comes from the known size, and the photo is resampled
 * onto the wall to show behind the boards; with a sheet, it can reach past the
 * wall. Also: where to start the handles (the tracer's paper finder, and a
 * pickier one for a sheet on a wall), and cleaning a saved photo. Loads with
 * the first photo, not with the planner.
 */
import { applyHomography, homography, PAPER_SIZES, type Mat3 } from '../trace/homography';
import { boxBlur, createRGBA, downscale, luminance, sampleBilinear, type Pt, type RGBAImage } from '../trace/image';
import { detectPaper } from '../trace/pipeline';
import { labelComponents, openMask, otsu, threshold, type Component } from '../trace/segment';
import { isMeshHash } from '../imported/format';
import type { WallPhoto, WallPlan } from './data';
import type { Rect } from './layout';

type Wall = Pick<WallPlan, 'width' | 'height'>;

/** The sheets a photo can be lined up by, upright (w across, h up), mm. */
export const PHOTO_PAPERS: Record<WallPhoto['paper'], { w: number; h: number; label: string }> = {
  a4: { ...size('a4'), label: 'A4' },
  letter: { ...size('letter'), label: 'Letter' },
};

function size(id: string) {
  const p = PAPER_SIZES.find((s) => s.id === id)!;
  return { w: p.w, h: p.h };
}

/** Photos are kept at most this big on their long side, px (as a JPEG). */
export const MAX_PHOTO_SIDE = 2048;

/** The sheet as it is on the wall, mm: upright, or its long side across. */
export function paperSize(p: Pick<WallPhoto, 'paper' | 'across'>): { w: number; h: number } {
  const s = PHOTO_PAPERS[p.paper];
  return p.across ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

/** What the corners mark, on the wall (mm, y up): the wall itself, or the sheet where it is. */
export function refRect(p: Pick<WallPhoto, 'ref' | 'paper' | 'across' | 'at'>, wall: Wall): Rect {
  if (p.ref === 'wall') return { x: 0, y: 0, w: wall.width, h: wall.height };
  return { x: p.at[0], y: p.at[1], ...paperSize(p) };
}

/** A rectangle's corners in the order a photo's are kept: top left, top right, bottom right, bottom left (wall mm, y up). */
export const rectCorners = (r: Rect): Pt[] => [
  [r.x, r.y + r.h],
  [r.x + r.w, r.y + r.h],
  [r.x + r.w, r.y],
  [r.x, r.y],
];

/** Photo px → wall mm. */
export const photoToWall = (p: WallPhoto, wall: Wall): Mat3 => homography(p.corners, rectCorners(refRect(p, wall)));

/** Wall mm → photo px. */
export const wallToPhoto = (p: WallPhoto, wall: Wall): Mat3 => homography(rectCorners(refRect(p, wall)), p.corners);

/** The homography's denominator at a point: its sign says which side of the horizon the point is on. */
const depth = (H: Mat3, [x, y]: Pt) => H[6] * x + H[7] * y + H[8];

/**
 * A point through H, or null when it is on or past the horizon: the side of it the four corners (`ref`, in H's
 * source frame) aren't on, where a photo shows sky rather than wall.
 */
export function mapPoint(H: Mat3, pt: Pt, ref: Pt[]): Pt | null {
  const c = ref.reduce<Pt>((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0]);
  const side = Math.sign(depth(H, c));
  const d = depth(H, pt) * side;
  // Within a hair of the horizon a point is a long way off; there is no sensible place to draw it.
  return d > 1e-6 * Math.abs(depth(H, c)) ? applyHomography(H, pt) : null;
}

/** The photo's own outline on the wall (its four corners, mm), or null when part of it is past the wall's horizon. */
export function photoOutline(p: WallPhoto, wall: Wall): Pt[] | null {
  const H = photoToWall(p, wall);
  const out: Pt[] = [];
  for (const c of rectCorners({ x: 0, y: 0, w: p.w, h: p.h })) {
    const q = mapPoint(H, c, p.corners);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

/**
 * The part of the wall to draw the photo over, mm: where the photo covers, within `clip` (the wall and the margin
 * round it on screen). Null when it covers none of that.
 */
export function photoRegion(p: WallPhoto, wall: Wall, clip: Rect): Rect | null {
  const o = photoOutline(p, wall);
  let x0 = clip.x;
  let y0 = clip.y;
  let x1 = clip.x + clip.w;
  let y1 = clip.y + clip.h;
  if (o) {
    x0 = Math.max(x0, Math.min(...o.map((q) => q[0])));
    x1 = Math.min(x1, Math.max(...o.map((q) => q[0])));
    y0 = Math.max(y0, Math.min(...o.map((q) => q[1])));
    y1 = Math.min(y1, Math.max(...o.map((q) => q[1])));
  }
  return x1 - x0 > 1 && y1 - y0 > 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Twice the signed area of a quad (photo px, y down): positive when it runs top left, top right, bottom right, bottom left. */
const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

/**
 * Whether four corners (photo px, y down) make a convex quad in the order they're kept: top left, top right, bottom
 * right, bottom left. Crossed handles (a mirrored or twisted photo) don't.
 */
export function goodQuad(c: readonly Pt[]): boolean {
  if (c.length !== 4 || !c.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) return false;
  const span = Math.max(...c.map((q) => Math.abs(q[0] - c[0][0]) + Math.abs(q[1] - c[0][1])), 1);
  for (let i = 0; i < 4; i++) if (cross(c[i], c[(i + 1) % 4], c[(i + 2) % 4]) <= 1e-6 * span * span) return false;
  return true;
}

/** Area of a quad, px². */
const quadArea = (c: readonly Pt[]) => Math.abs(c.reduce((t, q, i) => t + q[0] * c[(i + 1) % 4][1] - c[(i + 1) % 4][0] * q[1], 0)) / 2;

/**
 * How much of the wall a photo pixel covers there, as photo px per wall mm: about the corners' rectangle, from its
 * area in the photo and on the wall. What the resampled photo needs at most.
 */
export function photoDetail(p: WallPhoto, wall: Wall): number {
  const r = refRect(p, wall);
  return Math.sqrt(quadArea(p.corners) / Math.max(1, r.w * r.h));
}

/** The photo resampled onto the wall. */
export interface WarpedPhoto {
  /** RGBA, its top row along the top of `rect`; clear where the photo doesn't reach. */
  image: RGBAImage;
  /** Where it goes on the wall, mm (y up). */
  rect: Rect;
  /** Its resolution, px per mm. */
  ppm: number;
}

/**
 * Resample `img` (the photo, any size: corners scale with it) onto the wall over `rect` (mm), at no more than
 * `maxPixels`, nor much finer than the photo has detail (or `maxPpm` px per mm).
 */
export function warpPhoto(img: RGBAImage, p: WallPhoto, wall: Wall, rect: Rect, maxPixels = 2_000_000, maxPpm = 4): WarpedPhoto {
  const k = img.width / p.w;
  const scaled: WallPhoto = { ...p, w: img.width, h: img.height, corners: p.corners.map(([x, y]) => [x * k, y * k]) };
  const ppm = Math.max(0.02, Math.min(maxPpm, 1.5 * photoDetail(scaled, wall), Math.sqrt(maxPixels / Math.max(1, rect.w * rect.h))));
  const W = Math.max(1, Math.round(rect.w * ppm));
  const H = Math.max(1, Math.round(rect.h * ppm));
  const out = createRGBA(W, H);
  const h = wallToPhoto(scaled, wall);
  const ref = rectCorners(refRect(p, wall));
  const c = ref.reduce<Pt>((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0]);
  const side = Math.sign(depth(h, c));
  const sx = rect.w / W;
  const sy = rect.h / H;
  const top = rect.y + rect.h;
  for (let j = 0; j < H; j++) {
    const wy = top - (j + 0.5) * sy;
    for (let i = 0; i < W; i++) {
      const wx = rect.x + (i + 0.5) * sx;
      const d = (h[6] * wx + h[7] * wy + h[8]) * side;
      if (d <= 0) continue;
      const iw = side / d;
      const px = (h[0] * wx + h[1] * wy + h[2]) * iw;
      const py = (h[3] * wx + h[4] * wy + h[5]) * iw;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      sampleBilinear(img, px, py, out.data, (j * W + i) * 4);
    }
  }
  return { image: out, rect, ppm: W / rect.w };
}

/** Where the photo's corners start when none fit: a rectangle 12% in from its edges. */
export function insetCorners(w: number, h: number, share = 0.12): Pt[] {
  const x0 = w * share;
  const y0 = h * share;
  return [
    [x0, y0],
    [w - x0, y0],
    [w - x0, h - y0],
    [x0, h - y0],
  ];
}

/** A component's outermost pixels along the diagonals: its corners, top left first, clockwise on screen (px of `w`-wide labels). */
function extremes(labels: Int32Array, w: number, c: Component): Pt[] {
  let tl: Pt = [0, 0];
  let tr: Pt = [0, 0];
  let br: Pt = [0, 0];
  let bl: Pt = [0, 0];
  let sMin = Infinity;
  let sMax = -Infinity;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      if (labels[y * w + x] !== c.id) continue;
      const s = x + y;
      const d = x - y;
      if (s < sMin) [sMin, tl] = [s, [x, y]];
      if (s > sMax) [sMax, br] = [s, [x + 1, y + 1]];
      if (d > dMax) [dMax, tr] = [d, [x + 1, y]];
      if (d < dMin) [dMin, bl] = [d, [x, y + 1]];
    }
  }
  return [tl, tr, br, bl];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Brightness at (x, y), px, between pixel centres. */
function lumAt(img: RGBAImage, x: number, y: number): number {
  const px = new Uint8ClampedArray(4);
  sampleBilinear(img, x, y, px, 0);
  return px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11;
}

/**
 * Corners found on a smaller copy of the photo, made exact on the photo itself: along each side, where the brightness
 * changes most within `reach` px either side of it, a straight line through those points, and the corners where the
 * lines meet. A sheet is small in a wall's photo, so a pixel off at its corners is centimetres off across the wall.
 * Corners that would move further than twice `reach` stay as they were.
 */
export function refineQuad(img: RGBAImage, q: Pt[], reach: number): Pt[] {
  const lines: { p: Pt; d: Pt }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = dist(a, b);
    if (len < 4) return q;
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Pt = [u[1], -u[0]];
    const pts: Pt[] = [];
    const steps = Math.max(8, Math.min(40, Math.round(len / 3)));
    for (let k = 1; k < steps; k++) {
      const t = 0.12 + (0.76 * k) / steps;
      const m: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let best = 0;
      let at = NaN;
      let prev = lumAt(img, m[0] - n[0] * reach, m[1] - n[1] * reach);
      for (let s = -reach + 0.25; s <= reach; s += 0.25) {
        const v = lumAt(img, m[0] + n[0] * s, m[1] + n[1] * s);
        if (Math.abs(v - prev) > best) [best, at] = [Math.abs(v - prev), s - 0.125];
        prev = v;
      }
      if (best > 8) pts.push([m[0] + n[0] * at, m[1] + n[1] * at]);
    }
    if (pts.length < 4) return q;
    // The line through them: their mean, along their main direction.
    const c = pts.reduce<Pt>((t, p) => [t[0] + p[0] / pts.length, t[1] + p[1] / pts.length], [0, 0]);
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of pts) {
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ p: c, d: [Math.cos(ang), Math.sin(ang)] });
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(den) < 1e-6) return q;
    const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
    const c: Pt = [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t];
    if (dist(c, q[i]) > 2 * reach) return q;
    out.push(c);
  }
  return goodQuad(out) ? out : q;
}

/**
 * A sheet of paper on the wall in the photo: its corners (photo px, top left first), or null when none stands out.
 * The tracer's finder (lib/trace/pipeline.ts detectPaper) takes the biggest bright patch, which on a wall is often the
 * wall, the ceiling or a window; this one looks at each bright patch, at two thresholds (the photo's, and the bright
 * part's own, for a sheet on a pale wall), and takes the one most like a sheet: a filled four-sided shape, about as
 * long for its width as paper (allowing for the angle), and white rather than coloured. Its corners are then made
 * exact on the photo itself (refineQuad).
 */
export function findSheet(photo: RGBAImage): Pt[] | null {
  const { image, scale } = downscale(photo, 480);
  const W = image.width;
  const H = image.height;
  const lum = boxBlur(luminance(image), 1);
  const t1 = otsu(lum);
  const t2 = otsu(lum, threshold(lum, t1));
  let best: { score: number; q: Pt[] } | null = null;
  for (const t of new Set([t1, t2])) {
    const { labels, comps } = labelComponents(openMask(threshold(lum, t), 1));
    for (const c of comps) {
      if (c.area < 0.001 * W * H || c.area > 0.35 * W * H || c.x1 - c.x0 < 6 || c.y1 - c.y0 < 6) continue;
      const q = extremes(labels, W, c);
      if (!goodQuad(q)) continue;
      const fill = c.area / quadArea(q);
      if (fill < 0.8 || fill > 1.15) continue;
      const across = dist(q[0], q[1]) + dist(q[3], q[2]);
      const down = dist(q[0], q[3]) + dist(q[1], q[2]);
      const ratio = Math.max(across, down) / Math.min(across, down);
      // Paper is 1.29 (Letter) to 1.41 (A4) long for its width; the angle squashes it a little either way.
      const shape = Math.exp(-(((ratio - 1.35) / 0.2) ** 2));
      let chroma = 0;
      for (let y = c.y0; y <= c.y1; y++)
        for (let x = c.x0; x <= c.x1; x++) {
          if (labels[y * W + x] !== c.id) continue;
          const o = (y * W + x) * 4;
          const d = image.data;
          chroma += Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]);
        }
      const white = Math.max(0, 1 - chroma / c.area / 60);
      const score = (1 - Math.abs(1 - fill) * 2) * shape * white * (c.touchesBorder ? 0.3 : 1);
      if (score > 0.25 && (!best || score > best.score)) best = { score, q };
    }
  }
  return (
    best &&
    refineQuad(
      photo,
      best.q.map(([x, y]) => [x / scale, y / scale] as Pt),
      1.5 / scale + 1,
    )
  );
}

/**
 * The wall in the photo: its corners (photo px, top left first), or null when it can't be told apart. The wall is
 * taken as the patch round the middle of the photo of much the same colour (windows and sheets on it are holes in
 * it); when that doesn't give a sensible four-sided shape, the tracer's paper finder (the biggest bright patch) has a
 * go. Either must cover between 15% and 90% of the photo (a patch filling it is no help: the corners are past its edges).
 */
export function findWall(photo: RGBAImage): Pt[] | null {
  const { image, scale } = downscale(photo, 320);
  const W = image.width;
  const H = image.height;
  const d = image.data;
  // The wall's colour: the median of the middle fifth.
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = Math.floor(H * 0.4); y < H * 0.6; y++)
    for (let x = Math.floor(W * 0.4); x < W * 0.6; x++) {
      const o = (y * W + x) * 4;
      rs.push(d[o]);
      gs.push(d[o + 1]);
      bs.push(d[o + 2]);
    }
  const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  const col = [med(rs), med(gs), med(bs)];
  const mask = { width: W, height: H, data: new Uint8Array(W * H) };
  for (let i = 0; i < W * H; i++) mask.data[i] = Math.abs(d[i * 4] - col[0]) + Math.abs(d[i * 4 + 1] - col[1]) + Math.abs(d[i * 4 + 2] - col[2]) < 60 ? 1 : 0;
  const { labels, comps } = labelComponents(openMask(mask, 2));
  const mid = labels[(H >> 1) * W + (W >> 1)];
  const c = comps.find((k) => k.id === mid) ?? comps.reduce<Component | null>((a, b) => (!a || b.area > a.area ? b : a), null);
  const fits = (q: Pt[], w: number, h: number) => goodQuad(q) && quadArea(q) > 0.15 * w * h && quadArea(q) < 0.9 * w * h;
  if (c && c.area > 0.12 * W * H) {
    const q = extremes(labels, W, c);
    if (fits(q, W, H)) return q.map(([x, y]) => [x / scale, y / scale] as Pt);
  }
  const t = detectPaper(photo);
  return t && fits(t, photo.width, photo.height) ? t : null;
}

/** Where the handles start for this photo and what they mark: the sheet or the wall when found, else 12% in from its edges. */
export function startCorners(img: RGBAImage, ref: WallPhoto['ref']): { corners: Pt[]; found: boolean } {
  const found = ref === 'paper' ? findSheet(img) : findWall(img);
  if (found) return { corners: found, found: true };
  if (ref === 'wall') return { corners: insetCorners(img.width, img.height), found: false };
  // A small upright sheet in the middle.
  const s = Math.min(img.width, img.height) / 10;
  const cx = img.width / 2;
  const cy = img.height / 2;
  return {
    corners: [
      [cx - s, cy - 1.41 * s],
      [cx + s, cy - 1.41 * s],
      [cx + s, cy + 1.41 * s],
      [cx - s, cy + 1.41 * s],
    ],
    found: false,
  };
}

/** Whether a sheet found in the photo lies across (wider than tall as it is on the wall, allowing for the angle). */
export function sheetAcross(c: readonly Pt[]): boolean {
  return dist(c[0], c[1]) + dist(c[3], c[2]) > dist(c[0], c[3]) + dist(c[1], c[2]);
}

/**
 * Where a sheet's bottom-left corner goes so the photo sits in the middle of the wall: a starting point when the user
 * hasn't said where the sheet is (they say, or drag the photo to line it up).
 */
export function centredAt(p: WallPhoto, wall: Wall): [number, number] {
  const H = photoToWall({ ...p, ref: 'paper', at: [0, 0] }, wall);
  const c = mapPoint(H, [p.w / 2, p.h / 2], p.corners) ?? [0, 0];
  return [Math.round(wall.width / 2 - c[0]), Math.round(wall.height / 2 - c[1])];
}

/** A new photo of the wall, `w` × `h` px, before it's lined up: the handles on the sheet when one is found, else on the wall. */
export function newPhoto(hash: string, name: string, img: RGBAImage, wall: Wall): WallPhoto {
  const sheet = findSheet(img);
  const base = { hash, name: name.slice(0, 80), w: img.width, h: img.height, paper: 'a4' as const, opacity: 0.7, hidden: false };
  if (sheet) {
    const p: WallPhoto = { ...base, corners: sheet, ref: 'paper', across: sheetAcross(sheet), at: [0, 0] };
    return { ...p, at: centredAt(p, wall) };
  }
  return { ...base, corners: startCorners(img, 'wall').corners, ref: 'wall', across: false, at: [0, 0] };
}

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * A saved photo (a project file, a share link, autosave: ./data.ts keeps it as it came) made valid; undefined when
 * there is none. Corners that don't make a quad in order go back to 12% in from the photo's edges; they may lie a
 * photo's size past its edges (a corner out of the picture).
 */
export function cleanPhoto(v: unknown): WallPhoto | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const w = Math.round(num(o.w, 0, 8192, 0));
  const h = Math.round(num(o.h, 0, 8192, 0));
  if (w < 1 || h < 1) return undefined;
  const raw = Array.isArray(o.corners) ? o.corners.slice(0, 5) : [];
  const corners = raw.map((c): Pt => (Array.isArray(c) ? [round2(num(c[0], -w, 2 * w, NaN)), round2(num(c[1], -h, 2 * h, NaN))] : [NaN, NaN]));
  const at = Array.isArray(o.at) ? o.at : [];
  return {
    hash: isMeshHash(o.hash) ? o.hash : '',
    name: typeof o.name === 'string' ? o.name.slice(0, 80) : '',
    w,
    h,
    corners: goodQuad(corners) ? corners : insetCorners(w, h),
    ref: o.ref === 'paper' ? 'paper' : 'wall',
    paper: o.paper === 'letter' ? 'letter' : 'a4',
    across: o.across === true,
    at: [Math.round(num(at[0], -20000, 40000, 0) * 10) / 10, Math.round(num(at[1], -20000, 40000, 0) * 10) / 10],
    opacity: Math.round(num(o.opacity, 0.1, 1, 0.7) * 100) / 100,
    hidden: o.hidden === true,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
