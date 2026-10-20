import { describe, expect, it } from 'vitest';
import { createGray, createRGBA, foreground, type Pt, type RGBAImage } from '../src/lib/trace/image';
import { applyHomography, homography, isConvexQuad, orderCorners, PAPER_SIZES, rectifyPaper } from '../src/lib/trace/homography';
import { closeMask, labelComponents, marchingSquares, openMask, otsu, pickComponents } from '../src/lib/trace/segment';
import { bounds, chaikin, pointInPolygon, polygonsIntersect, signedArea, simplifyClosed, boundaryDistance } from '../src/lib/trace/polygon';
import { detectPaper, traceImage } from '../src/lib/trace/pipeline';

const LETTER = PAPER_SIZES.find((p) => p.id === 'letter')!;

/** A disk + bar "tool" in paper mm (y down, like the image). */
function inTool(x: number, y: number) {
  // 120 × 24 mm bar from (40, 100), with a 40 mm disk at its right end.
  const bar = x >= 40 && x <= 160 && y >= 100 && y <= 124;
  const disk = Math.hypot(x - 170, y - 112) <= 20;
  return bar || disk;
}
const TOOL_BOUNDS = { x0: 40, x1: 190, y0: 92, y1: 132 };

/**
 * A photo of a Letter sheet on a grey table, seen at an angle, with the tool on it.
 * Rendered by mapping each photo pixel back to paper mm (2 × 2 supersampled).
 */
function syntheticPhoto(corners: Pt[], w = 900, h = 700, toolColor: [number, number, number] = [35, 35, 40]): RGBAImage {
  const toPaper = homography(corners, [
    [0, 0],
    [LETTER.w, 0],
    [LETTER.w, LETTER.h],
    [0, LETTER.h],
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
        const [u, v] = applyHomography(toPaper, [x + sx, y + sy]);
        let c: [number, number, number] = [95, 92, 88];
        if (u >= 0 && v >= 0 && u <= LETTER.w && v <= LETTER.h) c = inTool(u, v) ? toolColor : [238, 236, 230];
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

// Portrait sheet, photographed from below-left: top edge shorter than the bottom.
const CORNERS: Pt[] = [
  [260, 80],
  [600, 95],
  [690, 640],
  [170, 610],
];

describe('homography', () => {
  it('maps the four points exactly and keeps lines straight', () => {
    const dst: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 200],
      [0, 200],
    ];
    const H = homography(CORNERS, dst);
    CORNERS.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q[0]).toBeCloseTo(dst[i][0], 6);
      expect(q[1]).toBeCloseTo(dst[i][1], 6);
    });
    // The midpoint of an edge in the target lands on the photo's edge line.
    const back = homography(dst, CORNERS);
    const m = applyHomography(back, [50, 0]);
    const [a, b] = [CORNERS[0], CORNERS[1]];
    const cross = (b[0] - a[0]) * (m[1] - a[1]) - (b[1] - a[1]) * (m[0] - a[0]);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });

  it('orders corners clicked in any order', () => {
    const shuffled = [CORNERS[2], CORNERS[0], CORNERS[3], CORNERS[1]];
    expect(orderCorners(shuffled)).toEqual(CORNERS);
    expect(isConvexQuad(shuffled)).toBe(true);
    expect(
      isConvexQuad([
        [0, 0],
        [10, 0],
        [5, 1],
        [5, 10],
      ]),
    ).toBe(false);
  });

  it('rectifies to the paper size at the requested resolution, following the photo orientation', () => {
    const photo = syntheticPhoto(CORNERS);
    const r = rectifyPaper(photo, CORNERS, LETTER, { pxPerMm: 3 });
    expect(r.widthMm).toBeCloseTo(215.9, 6);
    expect(r.heightMm).toBeCloseTo(279.4, 6);
    expect(r.image.width).toBe(Math.round(215.9 * 3));
    expect(r.image.height).toBe(Math.round(279.4 * 3));
    // A pixel at paper (100, 112) mm is inside the tool: dark. One at (100, 50) is paper: light.
    const px = (u: number, v: number) => r.image.data[(Math.round(v * r.pxPerMmY) * r.image.width + Math.round(u * r.pxPerMmX)) * 4];
    expect(px(100, 112)).toBeLessThan(60);
    expect(px(100, 50)).toBeGreaterThan(200);

    // Rotated a quarter turn in the photo → landscape output.
    const turned = rectifyPaper(photo, [CORNERS[1], CORNERS[2], CORNERS[3], CORNERS[0]].map(([x, y]) => [y, x] as Pt), LETTER, { pxPerMm: 1 });
    expect(turned.widthMm).toBeCloseTo(279.4, 6);
  });

  it('caps the output size', () => {
    const photo = createRGBA(10, 10);
    const r = rectifyPaper(photo, [[0, 0], [10, 0], [10, 10], [0, 10]], LETTER, { pxPerMm: 10, maxPixels: 100_000 });
    expect(r.image.width * r.image.height).toBeLessThanOrEqual(100_000 * 1.01);
  });
});

describe('segmentation', () => {
  it('Otsu splits a bimodal image between the modes', () => {
    const g = createGray(100, 1);
    for (let i = 0; i < 100; i++) g.data[i] = i < 70 ? 30 + (i % 7) : 200 + (i % 5);
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(36);
    expect(t).toBeLessThan(200);
  });

  it('colour mode ignores grey shadows that dark mode picks up', () => {
    const img = createRGBA(2, 1);
    img.data.set([110, 110, 110, 255, 220, 40, 30, 255]);
    expect(foreground(img, 'dark').data[0]).toBeGreaterThan(100);
    expect(foreground(img, 'color').data[0]).toBe(0);
    expect(foreground(img, 'color').data[1]).toBe(190);
  });

  it('close fills gaps, open removes specks; components and picking', () => {
    const m = createGray(40, 20);
    const set = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.data[y * 40 + x] = 1;
    };
    set(5, 5, 14, 12); // blob A with a 1 px gap...
    for (let y = 5; y <= 12; y++) m.data[y * 40 + 10] = 0;
    set(25, 3, 34, 14); // blob B (bigger)
    m.data[1 * 40 + 20] = 1; // speck
    set(0, 18, 39, 19); // border strip
    expect(labelComponents(m).comps.length).toBe(5);
    const cleaned = openMask(closeMask(m, 1), 1);
    const { labels, comps } = labelComponents(cleaned);
    expect(comps.length).toBe(3); // A (joined), B, border strip
    // Largest non-border blob by default; the border strip is bigger but excluded.
    const auto = pickComponents(labels, comps, 40);
    expect(comps.find((c) => c.id === auto[0])!.x0).toBe(25);
    // A click picks the blob under it.
    const click = pickComponents(labels, comps, 40, { points: [[7.5, 8.5]] });
    expect(comps.find((c) => c.id === click[0])!.x0).toBe(5);
    // A click just beside a blob snaps to it; far away picks nothing.
    expect(pickComponents(labels, comps, 40, { points: [[36, 9]], snapRadius: 3 })).toEqual([auto[0]]);
    expect(pickComponents(labels, comps, 40, { points: [[20, 16]], snapRadius: 0.5 })).toEqual([]);
  });

  it('marching squares traces a disk with the right area', () => {
    const w = 60;
    const field = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) field[y * w + x] = Math.hypot(x + 0.5 - 30, y + 0.5 - 30) <= 20 ? 1 : 0;
    const loops = marchingSquares(field, w, w, 0.5);
    expect(loops.length).toBe(1);
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(Math.PI * 400, -1.5);
    // Shapes touching the image edge still close.
    const edge = new Float32Array(25).fill(1);
    const e = marchingSquares(edge, 5, 5, 0.5);
    expect(e.length).toBe(1);
    expect(Math.abs(signedArea(e[0]))).toBeCloseTo(25 - 0.5, 6);
  });
});

describe('polygons', () => {
  const circle = (r: number, n: number, cx = 0, cy = 0): Pt[] =>
    Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt);

  it('RDP simplifies within tolerance, Chaikin smooths', () => {
    const c = circle(10, 400);
    const s = simplifyClosed(c, 0.1);
    expect(s.length).toBeLessThan(40);
    expect(s.length).toBeGreaterThan(10);
    expect(Math.abs(signedArea(s) - signedArea(c))).toBeLessThan(0.02 * signedArea(c));
    const sq: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const sm = chaikin(sq, 2);
    expect(sm.length).toBe(16);
    // Corners are cut off.
    expect(sm.some(([x, y]) => x > 9.5 && y > 9.5)).toBe(false);
    expect(bounds(sm).x1).toBeCloseTo(10, 6);
  });

  it('intersection and distance tests', () => {
    const a = circle(10, 64);
    const b = circle(10, 64, 25, 0);
    expect(polygonsIntersect(a, b)).toBe(false);
    expect(boundaryDistance(a, b).d).toBeCloseTo(5, 1);
    expect(polygonsIntersect(a, circle(10, 64, 15, 0))).toBe(true);
    expect(polygonsIntersect(a, circle(2, 16))).toBe(true); // contained
    expect(pointInPolygon([0, 0], a)).toBe(true);
    expect(pointInPolygon([11, 0], a)).toBe(false);
  });
});

describe('photo → outline', () => {
  it('traces a tool on paper photographed at an angle, to within a millimetre', () => {
    const photo = syntheticPhoto(CORNERS);
    const r = rectifyPaper(photo, CORNERS, LETTER, { pxPerMm: 4 });
    expect(r.pxPerMmX).toBeCloseTo(4, 2);
    const t = traceImage(r.image, 4, { simplify: 0.2, smooth: 1 });
    expect(t.outline).not.toBeNull();
    // Output is mm with y up: flip the expected box.
    const b = bounds(t.outline!);
    expect(b.x0).toBeCloseTo(TOOL_BOUNDS.x0, -0.3);
    expect(b.x1).toBeCloseTo(TOOL_BOUNDS.x1, -0.3);
    expect(b.y0).toBeCloseTo(LETTER.h - TOOL_BOUNDS.y1, -0.3);
    expect(b.y1).toBeCloseTo(LETTER.h - TOOL_BOUNDS.y0, -0.3);
    // Area: bar + disk minus their overlap ≈ 120·24 + π·20² − overlap.
    let area = 0;
    for (let y = 80; y < 140; y += 0.1) for (let x = 30; x < 200; x += 0.1) if (inTool(x, y)) area += 0.01;
    expect(signedArea(t.outline!)).toBeGreaterThan(0); // counter-clockwise
    expect(Math.abs(signedArea(t.outline!) - area) / area).toBeLessThan(0.03);
    expect(t.outline!.length).toBeLessThan(400);
  });

  it('colour mode finds a red tool; a click picks a specific blob', () => {
    const photo = syntheticPhoto(CORNERS, 900, 700, [200, 40, 30]);
    const r = rectifyPaper(photo, CORNERS, LETTER, { pxPerMm: 3 });
    const t = traceImage(r.image, 3, { mode: 'color' });
    expect(t.outline).not.toBeNull();
    const b = bounds(t.outline!);
    expect(b.x1 - b.x0).toBeCloseTo(150, -0.5);
    // Clicking on empty paper far from the tool finds nothing.
    expect(traceImage(r.image, 3, { mode: 'color' }, [[30, 30]]).outline).toBeNull();
    // Clicking the tool finds it.
    expect(traceImage(r.image, 3, { mode: 'color' }, [[100 * 3, 112 * 3]]).outline).not.toBeNull();
  });

  it('finds the paper corners in the photo', () => {
    const photo = syntheticPhoto(CORNERS);
    const found = detectPaper(photo)!;
    expect(found).not.toBeNull();
    const ordered = orderCorners(found);
    ordered.forEach((p, i) => {
      expect(Math.hypot(p[0] - CORNERS[i][0], p[1] - CORNERS[i][1])).toBeLessThan(8);
    });
  });
});
