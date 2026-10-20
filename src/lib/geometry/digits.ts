/**
 * Tiny 7-segment glyph generator for piece numbers. Pure geometry (no kernel):
 * each digit is a handful of overlapping axis-aligned boxes.
 *
 *    aaa
 *   f   b
 *    ggg
 *   e   c
 *    ddd
 */

export interface GlyphRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
};

/** Width of one digit for a given height. */
export const digitWidth = (height: number) => height * 0.55;

/** Gap between digits for a given stroke. */
const gapFor = (stroke: number) => stroke * 1.3;

/** Size of a string of digits. */
export function textSize(text: string, height: number, stroke: number): { w: number; h: number } {
  const n = [...text].filter((c) => SEGMENTS[c]).length;
  return { w: n ? n * digitWidth(height) + (n - 1) * gapFor(stroke) : 0, h: height };
}

function segmentRects(seg: string, x: number, W: number, H: number, t: number): GlyphRect[] {
  const mid = H / 2;
  const box = (x0: number, y0: number, x1: number, y1: number): GlyphRect => ({ x0: x + x0, y0, x1: x + x1, y1 });
  const out: GlyphRect[] = [];
  for (const s of seg) {
    if (s === 'a') out.push(box(0, H - t, W, H));
    if (s === 'd') out.push(box(0, 0, W, t));
    if (s === 'g') out.push(box(0, mid - t / 2, W, mid + t / 2));
    if (s === 'f') out.push(box(0, mid - t / 2, t, H));
    if (s === 'e') out.push(box(0, 0, t, mid + t / 2));
    if (s === 'b') out.push(box(W - t, mid - t / 2, W, H));
    if (s === 'c') out.push(box(W - t, 0, W, mid + t / 2));
  }
  return out;
}

/**
 * Boxes for a string of digits, reading left to right, with the text's
 * bottom-left corner at the origin. Unknown characters are skipped.
 */
export function textRects(text: string, height: number, stroke: number): GlyphRect[] {
  const W = digitWidth(height);
  const gap = gapFor(stroke);
  const out: GlyphRect[] = [];
  let x = 0;
  for (const c of text) {
    const seg = SEGMENTS[c];
    if (!seg) continue;
    out.push(...segmentRects(seg, x, W, height, stroke));
    x += W + gap;
  }
  return out;
}
