import type { Manifold, Wasm } from './kernel';
import { parseFont, type Contour, type Font, type Glyph } from './font';
import { DIVIDER_GAP, ICON_GAP, labelTokens, type IconShape, type LabelToken } from './labelIcons';

/**
 * Text → outlines in mm for embossed and debossed labels.
 *
 * Label text may carry fragments (labelIcons.ts): `{bolt:12}`, `{nut}`, `{|}`
 * … are drawn inline as icons one cap height tall; `{<}` / `{>}` align a line
 * to the left / right of the label and `{...}` pushes what follows to the
 * right edge (with `maxWidth`, the label's width; else the widest line's).
 * Unknown fragments print as typed. Text without fragments lays out exactly
 * as it always has.
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
  /**
   * Some line is aligned with `{<}` / `{>}` or spread by `{...}`: the block is
   * `width` wide, centered on x = 0, and lines sit at its edges (fitText then
   * centers the block, not the ink).
   */
  spread?: boolean;
}

/** One thing on a line: a glyph or an icon, with the space it takes in font units. */
interface Item {
  advance: number;
  glyph?: Glyph;
  icon?: IconShape;
  /** Space before the icon's ink (cap units). */
  lead?: number;
  /** A `{...}` spring sits before this item (count). */
  springs?: number;
}

interface Line {
  items: Item[];
  /** Springs after the last item. */
  tail: number;
  align?: 'left' | 'right';
  springs: number;
}

function layoutLine(f: Font, line: string): Line {
  const tokens = labelTokens(line);
  const out: Line = { items: [], tail: 0, springs: 0 };
  let pending = 0;
  tokens.forEach((t, i) => {
    if (t.kind === 'text') {
      for (const ch of t.text) {
        const glyph = f.glyph(ch.codePointAt(0)!);
        out.items.push({ advance: glyph.advance, glyph, springs: pending || undefined });
        pending = 0;
      }
    } else if (t.kind === 'icon') {
      const gap = t.divider ? DIVIDER_GAP : ICON_GAP;
      // No gap against the start or end of the line; icons need none next to a space either (dividers keep theirs).
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const open = (x: LabelToken | undefined, ch: string | undefined) =>
        !x || x.kind === 'align' || x.kind === 'spring' || x.kind === 'blank' || (!t.divider && x.kind === 'text' && /\s/.test(ch ?? ''));
      const lead = open(prev, prev?.kind === 'text' ? prev.text.slice(-1) : undefined) ? 0 : gap;
      const trail = open(next, next?.kind === 'text' ? next.text[0] : undefined) ? 0 : gap;
      out.items.push({ advance: (lead + t.icon.width + trail) * f.capHeight, icon: t.icon, lead, springs: pending || undefined });
      pending = 0;
    } else if (t.kind === 'spring') {
      pending++;
      out.springs++;
    } else if (t.kind === 'align') {
      out.align = t.align;
    }
  });
  out.tail = pending;
  return out;
}

/** Lay out (possibly multi-line) text. Returns no contours for blank text. */
export function textOutline(text: string, o: TextOptions): TextOutline {
  const f = requireFont();
  const lines = text.replace(/\r/g, '').split('\n').map((l) => layoutLine(f, l));
  const lineHeight = o.lineHeight ?? 1.45;
  const spacingUnits = ((o.letterSpacing ?? 0) / Math.max(o.size, 1e-6)) * f.capHeight;

  // Measure in font units first.
  const widths = lines.map((line) => {
    let x = 0;
    for (const it of line.items) x += it.advance + spacingUnits;
    return Math.max(0, x - spacingUnits);
  });
  const rawW = Math.max(0, ...widths);
  const rawH = f.capHeight * (1 + lineHeight * (lines.length - 1));

  let size = o.size;
  if (o.maxWidth && rawW > 0) size = Math.min(size, (o.maxWidth / rawW) * f.capHeight);
  if (o.maxHeight && rawH > 0) size = Math.min(size, (o.maxHeight / rawH) * f.capHeight);
  const k = size / f.capHeight;

  const spread = lines.some((l) => l.align || l.springs);
  // Spread lines line up with the edges of the label (or of the widest line).
  const block = spread ? Math.max(rawW * k, o.maxWidth ?? 0) : rawW * k;

  const contours: Contour[] = [];
  const totalH = rawH * k;
  lines.forEach((line, li) => {
    const w = widths[li] * k;
    const springs = line.springs;
    const extra = springs && block > w ? (block - w) / springs : 0;
    let x: number;
    if (springs) x = -block / 2;
    else if (line.align === 'left') x = -block / 2;
    else if (line.align === 'right') x = block / 2 - w;
    else x = o.align === 'left' ? 0 : o.align === 'right' ? -w : -w / 2;
    // Baseline of this line, so the block's cap-height box is centered on y = 0.
    const baseline = totalH / 2 - size - li * lineHeight * size;
    for (const it of line.items) {
      if (it.springs) x += it.springs * extra;
      if (it.glyph) {
        for (const c of it.glyph.contours) {
          contours.push(c.map(([gx, gy]) => [x + gx * k, baseline + gy * k] as [number, number]));
        }
      } else if (it.icon) {
        const x0 = x + (it.lead ?? 0) * size;
        for (const c of it.icon.contours) contours.push(c.map(([u, v]) => [x0 + u * size, baseline + v * size] as [number, number]));
      }
      x += it.advance * k + spacingUnits * k;
    }
  });
  if (o.mirror) for (const c of contours) for (const p of c) p[0] = -p[0];
  const out: TextOutline = { contours, width: spread ? block : rawW * k, height: totalH, size };
  if (spread) out.spread = true;
  return out;
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
