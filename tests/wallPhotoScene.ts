import { createRGBA, type Pt, type RGBAImage } from '../src/lib/trace/image';
import { applyHomography, homography } from '../src/lib/trace/homography';

/**
 * A made-up photo of a wall, taken from low down on the left: a beige wall
 * 2.4 m × 1.5 m with a window and a sheet of A4 taped to it, a pale ceiling
 * above, a wooden floor below and the side walls beyond. Each photo pixel is
 * mapped back to wall millimetres (2 × 2 samples), so where everything is in
 * the photo is known exactly (tests/wall-photo.test.ts, and the PNG the
 * browser check picks).
 */

export const SCENE_WALL = { width: 2400, height: 1500 };
/** On the wall, mm from its bottom-left corner (y up). */
export const SCENE_WINDOW = { x: 1350, y: 650, w: 850, h: 700 };
export const SCENE_SHEET = { x: 400, y: 1000, w: 210, h: 297 };
export const SCENE_SOCKET = { x: 300, y: 300, w: 85, h: 85 };

/** Where the wall's corners are in a photo `w` px wide (3:2): top left, top right, bottom right, bottom left. */
export function sceneCorners(w = 1200): Pt[] {
  const k = w / 1200;
  return (
    [
      [140, 120],
      [1080, 50],
      [1120, 720],
      [110, 650],
    ] as Pt[]
  ).map(([x, y]) => [x * k, y * k]);
}

const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number, by = 0) =>
  x >= r.x - by && x <= r.x + r.w + by && y >= r.y - by && y <= r.y + r.h + by;

/** The colour at wall mm (x, y): what's on the wall, or beyond its edges. */
function colourAt(x: number, y: number): [number, number, number] {
  const { width: W, height: H } = SCENE_WALL;
  if (y > H) return [214, 212, 205];
  if (y < 0) return x > -400 && x < W + 400 ? [112, 82, 58] : [96, 72, 52];
  if (x < 0 || x > W) return [150, 138, 120];
  if (inside(SCENE_SHEET, x, y)) return [246, 246, 242];
  if (inside(SCENE_WINDOW, x, y)) {
    // A white frame 60 mm wide, two panes.
    const f = 60;
    const inner = { x: SCENE_WINDOW.x + f, y: SCENE_WINDOW.y + f, w: SCENE_WINDOW.w - 2 * f, h: SCENE_WINDOW.h - 2 * f };
    const mid = Math.abs(x - (SCENE_WINDOW.x + SCENE_WINDOW.w / 2)) < f / 2;
    if (!inside(inner, x, y) || mid) return [236, 236, 232];
    const t = (y - inner.y) / inner.h;
    return [150 + 30 * t, 190 + 20 * t, 228];
  }
  if (inside(SCENE_SOCKET, x, y)) return inside(SCENE_SOCKET, x, y, -20) ? [228, 228, 224] : [240, 240, 236];
  // A skirting board.
  if (y < 80) return [232, 230, 224];
  return [181, 163, 136];
}

/** The photo, `w` × `w`·2/3 px. */
export function scenePhoto(w = 1200): RGBAImage {
  const h = Math.round((w * 2) / 3);
  const { width: W, height: H } = SCENE_WALL;
  const toWall = homography(sceneCorners(w), [
    [0, H],
    [W, H],
    [W, 0],
    [0, 0],
  ]);
  const img = createRGBA(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const [u, v] = applyHomography(toWall, [x + sx, y + sy]);
        const c = colourAt(u, v);
        r += c[0] / 4;
        g += c[1] / 4;
        b += c[2] / 4;
      }
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  return img;
}

/** Where wall mm (x, y) is in the photo `w` px wide. */
export function scenePoint(x: number, y: number, w = 1200): Pt {
  const { width: W, height: H } = SCENE_WALL;
  const toPhoto = homography(
    [
      [0, H],
      [W, H],
      [W, 0],
      [0, 0],
    ],
    sceneCorners(w),
  );
  return applyHomography(toPhoto, [x, y]);
}
