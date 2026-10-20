import type { Manifold, Wasm } from './kernel';
import { parseFont, type Contour, type Font } from './font';

/**
 * Text → outlines in mm for embossed and debossed labels.
 *
 * The font is loaded once per thread (`registerFont`) before any geometry that
 * uses text is built, because mesh building is synchronous.
 */

let font: Font | null = null;

export const FONT_URL_PATH = 'fonts/RobotoCondensed-Bold.ttf';

export function registerFont(bytes: ArrayBuffer): Font {
  font = parseFont(bytes);
  return font;
}

export function hasFont() {
  return font !== null;
}

function requireFont(): Font {
  if (!font) throw new Error('Label font not loaded yet.');
  return font;
}

export interface TextOptions {
  /** Capital-letter height in mm. */
  size: number;
  /** Fit inside this box (mm): text shrinks to fit, never grows past `size`. */
  maxWidth?: number;
  maxHeight?: number;
  /** Horizontal alignment about x = 0. */
  align?: 'left' | 'center' | 'right';
  /** Extra space between letters, mm. */
  letterSpacing?: number;
  /** Line spacing as a multiple of the cap height. */
  lineHeight?: number;
  /** Mirror left-to-right (for text read from underneath). */
  mirror?: boolean;
}

export interface TextOutline {
  /** Closed contours in mm, nonzero fill rule. Centered vertically on y = 0 (by cap height). */
  contours: Contour[];
  width: number;
  height: number;
  /** Cap height actually used after fitting. */
  size: number;
}

/** Lay out (possibly multi-line) text. Returns no contours for blank text. */
export function textOutline(text: string, o: TextOptions): TextOutline {
  const f = requireFont();
  const lines = text.replace(/\r/g, '').split('\n');
  const lineHeight = o.lineHeight ?? 1.45;
  const spacingUnits = ((o.letterSpacing ?? 0) / Math.max(o.size, 1e-6)) * f.capHeight;

  // Measure in font units first.
  const widths = lines.map((line) => {
    let x = 0;
    for (const ch of line) x += f.glyph(ch.codePointAt(0)!).advance + spacingUnits;
    return Math.max(0, x - spacingUnits);
  });
  const rawW = Math.max(0, ...widths);
  const rawH = f.capHeight * (1 + lineHeight * (lines.length - 1));

  let size = o.size;
  if (o.maxWidth && rawW > 0) size = Math.min(size, (o.maxWidth / rawW) * f.capHeight);
  if (o.maxHeight && rawH > 0) size = Math.min(size, (o.maxHeight / rawH) * f.capHeight);
  const k = size / f.capHeight;

  const contours: Contour[] = [];
  const totalH = rawH * k;
  lines.forEach((line, li) => {
    const w = widths[li] * k;
    let x = o.align === 'left' ? 0 : o.align === 'right' ? -w : -w / 2;
    // Baseline of this line, so the block's cap-height box is centered on y = 0.
    const baseline = totalH / 2 - size - li * lineHeight * size;
    for (const ch of line) {
      const g = f.glyph(ch.codePointAt(0)!);
      for (const c of g.contours) {
        contours.push(c.map(([gx, gy]) => [x + gx * k, baseline + gy * k] as [number, number]));
      }
      x += g.advance * k + spacingUnits * k;
    }
  });
  if (o.mirror) for (const c of contours) for (const p of c) p[0] = -p[0];
  return { contours, width: rawW * k, height: totalH, size };
}

/** Extrude text outlines between z0 and z0 + height, translated to (cx, cy). Null when empty. */
export function textSolid(w: Wasm, t: TextOutline, cx: number, cy: number, z0: number, height: number): Manifold | null {
  if (!t.contours.length || height <= 0) return null;
  const cs = new w.CrossSection(t.contours, 'NonZero');
  try {
    if (cs.isEmpty()) return null;
    return cs.extrude(height).translate([cx, cy, z0]);
  } finally {
    cs.delete();
  }
}
