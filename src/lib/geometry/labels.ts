/**
 * Label text on label tabs, and swappable label plates.
 *
 * Text sits on the flat top of each compartment's label tab and reads upright
 * from the front of the drawer (letter tops toward the back, +Y). It is fitted
 * to the part of the tab you can see from above (clear of the stacking lip),
 * with ~1 mm margins, a cap height of at most 70 % of the tab's depth, shrunk to
 * the tab's width. Styles:
 * - raised: embossed 0.5 mm, same body. Under a stacking lip the text must stay
 *   below the feet of a stacked bin (or lid), which sit 0.35 mm below the top of
 *   the walls; when there isn't room it is engraved instead.
 * - engraved: debossed 0.6 mm.
 * - inlaid: debossed 0.6 mm and filled flush by an overlay body printed in
 *   filament 2 (two-colour printing with an AMS).
 *
 * Label plates: each tab gets a shallow recess (with a chamfered mouth and a
 * finger notch at the right end) and a separate flat plate carrying the text
 * is planned as its own part, so labels can be swapped.
 *
 * Builders are synchronous and the font is registered per thread: without it
 * (or when text is too small to print) labels are simply left out.
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, LIP_DEPTH, LIP_HEIGHT, WALL } from './spec';
import { boxAt, extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import { hasFont, textOutline, textSolid, type TextOutline } from './text';
import type { Contour } from './font';
import type { LabelTab } from './compartments';
import type { DividerLayout } from '../dividers/types';

export type LabelTextStyle = 'raised' | 'engraved' | 'inlaid';
export const LABEL_STYLES: readonly LabelTextStyle[] = ['raised', 'engraved', 'inlaid'];

export interface BinLabelOptions {
  /** Text for every label tab whose compartment has none of its own ("\n" starts a new line). */
  labelText: string;
  labelStyle: LabelTextStyle;
  /** Recess in each tab plus a separate, swappable label plate per tab. */
  labelPlates: boolean;
}

export const DEFAULT_LABELS: BinLabelOptions = { labelText: '', labelStyle: 'raised', labelPlates: false };

export const LABEL_MAX_CHARS = 60;
export const LABEL_MAX_LINES = 3;

export const LABEL_TEXT = {
  /** Space between the text and the edges of the tab (mm). */
  margin: 1,
  raise: 0.5,
  /** Thinner than this, raised text is engraved instead. */
  minRaise: 0.3,
  /** Engrave / inlay depth. */
  depth: 0.6,
  /** Cap height at most this share of the tab's (visible) depth. */
  capShare: 0.7,
  maxCap: 8,
  /** Smaller text isn't worth printing with a 0.4 mm nozzle. */
  minCap: 2,
  /** Air between raised text and the feet of a stacked bin. */
  clearance: 0.3,
} as const;

export const LABEL_PLATE = {
  maxWidth: 36.4,
  maxDepth: 11,
  thickness: 1,
  /** Recess is this much bigger than the plate, per side. */
  clearance: 0.15,
  /** 45° chamfer at the recess mouth. */
  chamfer: 0.3,
  /** Finger notch radius (a round pocket at the right end, half under the plate). */
  notch: 3,
  /** The notch goes this much deeper than the recess. */
  notchDepth: 0.6,
  /** Engrave / inlay depth in the plate. */
  textDepth: 0.4,
  margin: 0.8,
  radius: 1,
  /** Elephant-foot relief on the plate's bottom edge. */
  footChamfer: 0.3,
  /** Material left at the ends of the tab. */
  endWall: 0.8,
  minWidth: 12,
  minDepth: 6,
} as const;

/** The feet of a bin (or lid) stacked in the lip sit this far below the top of the walls. */
const STACK_DROP = BASE_PROFILE_HEIGHT - LIP_HEIGHT;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Clean label text from user input: no control characters (newlines stay),
 * at most LABEL_MAX_LINES lines and LABEL_MAX_CHARS characters. Spaces are kept
 * so typing isn't disturbed; `labelLines` trims for layout.
 */
export function sanitizeLabelText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let t = v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  const lines = t.split('\n');
  if (lines.length > LABEL_MAX_LINES) t = [...lines.slice(0, LABEL_MAX_LINES - 1), lines.slice(LABEL_MAX_LINES - 1).join(' ')].join('\n');
  return [...t].slice(0, LABEL_MAX_CHARS).join('');
}

/** Text as laid out: lines trimmed, blank lines at the start and end dropped. '' = no label. */
export function labelLines(text: string | undefined | null): string {
  const lines = (text ?? '').split('\n').map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}

export function sanitizeLabelOptions(o: Partial<BinLabelOptions>): BinLabelOptions {
  return {
    labelText: sanitizeLabelText(o.labelText),
    labelStyle: LABEL_STYLES.includes(o.labelStyle as LabelTextStyle) ? (o.labelStyle as LabelTextStyle) : DEFAULT_LABELS.labelStyle,
    labelPlates: !!o.labelPlates,
  };
}

type LabelOpts = BinLabelOptions & { lip: boolean; layout?: DividerLayout | null };

/** Mesh-key parts; empty for bins without label text or plates, so their keys don't change. */
export function labelKeyParts(o: LabelOpts): string[] {
  const text = labelLines(o.labelText);
  const any = !!text || Object.values(o.layout?.comps ?? {}).some((c) => !!labelLines(c.labelText));
  const p: string[] = [];
  if (text) p.push(`T${JSON.stringify(text)}`);
  if (any) p.push(`T${o.labelStyle}`);
  if (o.labelPlates) p.push('Tplates');
  return p;
}

/** A compartment's label text: its own, else the bin's. */
export function compartmentLabelText(o: Pick<BinLabelOptions, 'labelText'> & { layout?: DividerLayout | null }, key: string): string {
  return labelLines(o.layout?.comps?.[key]?.labelText ?? o.labelText);
}

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A printable label plate (lies flat: width along X, depth along Y). */
export interface LabelPlate {
  width: number;
  depth: number;
  thickness: number;
  text: string;
  style: LabelTextStyle;
  /** Raise height or engrave depth of the text. */
  relief: number;
}

export interface TabLabel {
  tab: LabelTab;
  text: string;
  /** Effective style on this tab (raised falls back to engraved without headroom). */
  style: LabelTextStyle;
  relief: number;
  /** Where the text goes (bin coordinates). */
  box: Box;
  /** With label plates: the recess and the plate that goes in it. */
  plate?: { recess: Box; notch: { x: number; y: number; r: number }; plate: LabelPlate };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** How high raised text may rise on a tab at height z (bin body height H). */
function raiseAt(o: { lip: boolean }, H: number, z: number) {
  const headroom = o.lip ? H - STACK_DROP - z : Infinity;
  return Math.min(LABEL_TEXT.raise, headroom - LABEL_TEXT.clearance);
}

/**
 * What goes on each tab: text (with its effective style), or a plate recess.
 * Tabs without text and without plates are left out.
 */
export function planTabLabels(o: LabelOpts, tabs: LabelTab[], H: number): TabLabel[] {
  const out: TabLabel[] = [];
  const P = LABEL_PLATE;
  for (const tab of tabs) {
    const text = compartmentLabelText(o, tab.key);
    const raise = raiseAt(o, H, tab.z);
    const style: LabelTextStyle = o.labelStyle === 'raised' && raise < LABEL_TEXT.minRaise ? 'engraved' : o.labelStyle;
    const tw = tab.x1 - tab.x0;
    const vd = tab.y1 - tab.y0;
    if (o.labelPlates) {
      const depth = r2(Math.min(P.maxDepth, vd - 2));
      const rd = depth + 2 * P.clearance;
      const r = Math.min(P.notch, rd / 2 - 1);
      const width = r2(Math.min(P.maxWidth, tw - 2, tw - 2 * P.endWall - 2 * P.clearance - r));
      if (width >= P.minWidth && depth >= P.minDepth && r >= 1.5) {
        const len = width + 2 * P.clearance + r;
        const rx0 = (tab.x0 + tab.x1) / 2 - len / 2;
        const ry0 = tab.y0 + (vd - rd) / 2;
        const recess = { x0: rx0, y0: ry0, x1: rx0 + width + 2 * P.clearance, y1: ry0 + rd };
        const relief = style === 'raised' ? r2(raise) : P.textDepth;
        out.push({
          tab,
          text,
          style,
          relief,
          box: recess,
          plate: {
            recess,
            notch: { x: recess.x1, y: (recess.y0 + recess.y1) / 2, r },
            plate: { width, depth, thickness: P.thickness, text, style, relief },
          },
        });
        continue;
      }
    }
    if (!text) continue;
    const m = LABEL_TEXT.margin;
    out.push({
      tab,
      text,
      style,
      relief: style === 'raised' ? r2(raise) : LABEL_TEXT.depth,
      box: { x0: tab.x0 + m, y0: tab.y0 + m, x1: tab.x1 - m, y1: tab.y1 - m },
    });
  }
  return out;
}

/** Mesh key for a label plate, so identical plates share one mesh. */
export function labelPlateKey(p: LabelPlate): string {
  return `label|${JSON.stringify([p.width, p.depth, p.thickness, p.style, p.relief, labelLines(p.text)])}`;
}

/** Height of a plate including raised text. */
export function labelPlateHeight(p: LabelPlate): number {
  return p.thickness + (p.style === 'raised' && labelLines(p.text) ? p.relief : 0);
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

function inkBounds(cs: Contour[]): Box | null {
  if (!cs.length) return null;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const c of cs) {
    for (const [x, y] of c) {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return b.x1 > b.x0 && b.y1 > b.y0 ? b : null;
}

export interface FittedText {
  outline: TextOutline;
  /** Translation that puts the outline in the box. */
  cx: number;
  cy: number;
}

/**
 * Lay out text inside a box: cap height at most `maxCap`, shrunk until the
 * actual outline (descenders, accents) fits, centered. Null without a font,
 * for blank text, or when the text would come out smaller than LABEL_TEXT.minCap.
 */
export function fitText(text: string, box: Box, maxCap: number): FittedText | null {
  const t0 = labelLines(text);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (!t0 || !hasFont() || !(bw > 0) || !(bh > 0) || !(maxCap >= LABEL_TEXT.minCap)) return null;
  let t = textOutline(t0, { size: maxCap, maxWidth: bw, maxHeight: bh });
  let ink = inkBounds(t.contours);
  for (let i = 0; i < 3 && ink; i++) {
    const k = Math.min(bw / (ink.x1 - ink.x0), bh / (ink.y1 - ink.y0));
    if (k >= 1) break;
    t = textOutline(t0, { size: t.size * k * 0.985, maxWidth: bw, maxHeight: bh });
    ink = inkBounds(t.contours);
  }
  if (!ink || t.size < LABEL_TEXT.minCap || ink.x1 - ink.x0 > bw + 1e-6 || ink.y1 - ink.y0 > bh + 1e-6) return null;
  const cx = (box.x0 + box.x1) / 2 - (ink.x0 + ink.x1) / 2;
  // The cap-height block is centered; descenders are nudged back inside.
  let cy = (box.y0 + box.y1) / 2;
  if (cy + ink.y1 > box.y1) cy = box.y1 - ink.y1;
  if (cy + ink.y0 < box.y0) cy = box.y0 - ink.y0;
  return { outline: t, cx, cy };
}

/** Largest cap height for a tab or plate of this depth. */
const capFor = (depth: number) => Math.min(LABEL_TEXT.maxCap, LABEL_TEXT.capShare * depth);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Parts {
  cut: Manifold[];
  add: Manifold[];
  inlay: Manifold[];
}

/** Text on a flat top at height z, in the given style. */
function textInto(w: Wasm, s: Scope, fit: FittedText, z: number, style: LabelTextStyle, relief: number, out: Parts) {
  const { outline: t, cx, cy } = fit;
  if (style === 'raised') {
    // A hair into the top so the union is solid, not face-to-face.
    const m = textSolid(w, t, cx, cy, z - 0.02, relief + 0.02);
    if (m) out.add.push(s.t(m));
    return;
  }
  const hole = textSolid(w, t, cx, cy, z - relief, relief + 1);
  if (hole) out.cut.push(s.t(hole));
  if (style === 'inlaid') {
    // Same outline, same bottom: the fill touches the recess and never overlaps the body.
    const fill = textSolid(w, t, cx, cy, z - relief, relief);
    if (fill) out.inlay.push(s.t(fill));
  }
}

/** Recess for a label plate: pocket, chamfered mouth, finger notch. */
function recessCutters(w: Wasm, s: Scope, p: NonNullable<TabLabel['plate']>, z: number): Manifold[] {
  const { x0, y0, x1, y1 } = p.recess;
  const T = LABEL_PLATE.thickness;
  const ch = LABEL_PLATE.chamfer;
  const rect = (g: number, zz: number): [number, number, number][] => [
    [x0 - g, y0 - g, zz],
    [x1 + g, y0 - g, zz],
    [x1 + g, y1 + g, zz],
    [x0 - g, y1 + g, zz],
  ];
  return [
    s.t(boxAt(w, x0, y0, z - T, x1, y1, z + 1)),
    s.t(w.Manifold.hull([...rect(0, z - ch), ...rect(ch, z), ...rect(ch, z + 1)])),
    s.t(w.Manifold.cylinder(T + LABEL_PLATE.notchDepth + 1, p.notch.r, p.notch.r, 32).translate([p.notch.x, p.notch.y, z - T - LABEL_PLATE.notchDepth])),
  ];
}

export interface LabelGeometry {
  /** Cut and add the label features to the bin body. */
  apply(bin: Manifold): Manifold;
  /** Something cut from the bin afterwards (wall cutouts) also trims the inlay. */
  clip(cutter: Manifold): void;
  /** Attach the inlay as an overlay on filament 2. */
  finish(mesh: MeshData): MeshData;
}

/**
 * Label text and plate recesses for a bin's tabs (bin body height H, outer
 * size W × D). Everything is clipped to the opening inside the lip, so text
 * near a back corner never runs into the lip's rounded corner.
 */
export function tabLabelGeometry(w: Wasm, s: Scope, o: LabelOpts, tabs: LabelTab[], H: number, W: number, D: number): LabelGeometry {
  const parts: Parts = { cut: [], add: [], inlay: [] };
  for (const L of planTabLabels(o, tabs, H)) {
    if (L.plate) {
      parts.cut.push(...recessCutters(w, s, L.plate, L.tab.z));
      continue;
    }
    const fit = fitText(L.text, L.box, capFor(L.tab.y1 - L.tab.y0));
    if (fit) textInto(w, s, fit, L.tab.z, L.style, L.relief, parts);
  }
  let overlay: Manifold | null = null;
  const inset = o.lip ? LIP_DEPTH : WALL;
  const opening = () =>
    s.t(extrudePolygon(w, roundedRectRing(-W / 2 + inset, -D / 2 + inset, W / 2 - inset, D / 2 - inset, BASE_TOP_RADIUS - inset), 0, H + 10));
  const clipped = (ms: Manifold[]) => (ms.length ? s.t(s.t(w.Manifold.union(ms)).intersect(opening())) : null);
  return {
    apply(bin) {
      let b = bin;
      const cut = clipped(parts.cut);
      const add = clipped(parts.add);
      if (cut) b = s.t(b.subtract(cut));
      if (add) b = s.t(w.Manifold.union(b, add));
      overlay = clipped(parts.inlay);
      return b;
    },
    clip(cutter) {
      if (overlay) overlay = s.t(overlay.subtract(cutter));
    },
    finish(mesh) {
      return withInlay(mesh, overlay);
    },
  };
}

function withInlay(mesh: MeshData, inlay: Manifold | null): MeshData {
  if (!inlay || inlay.isEmpty()) return mesh;
  assertValid(inlay, 'label inlay');
  const m = toMeshData(inlay);
  mesh.overlays = [...(mesh.overlays ?? []), { name: 'Label text', filament: 2, positions: m.positions, indices: m.indices }];
  return mesh;
}

/**
 * A label plate lying flat for printing, min corner at the origin, bottom at
 * z = 0; text on top, reading along +X with letter tops toward +Y.
 */
export function buildLabelPlate(w: Wasm, p: LabelPlate): MeshData {
  const s = new Scope();
  try {
    const P = LABEL_PLATE;
    const r = Math.max(0.2, Math.min(P.radius, p.width / 2 - 0.1, p.depth / 2 - 0.1));
    const e = Math.min(P.footChamfer, r - 0.1);
    let body = s.t(
      loftRoundedRect(w, p.width / 2, p.depth / 2, p.width, p.depth, r, [
        { z: 0, inset: e },
        { z: e, inset: 0 },
        { z: p.thickness, inset: 0 },
      ]),
    );
    const parts: Parts = { cut: [], add: [], inlay: [] };
    const m = P.margin;
    const fit = fitText(p.text, { x0: m, y0: m, x1: p.width - m, y1: p.depth - m }, capFor(p.depth));
    if (fit) textInto(w, s, fit, p.thickness, p.style, p.relief, parts);
    if (parts.cut.length) body = s.t(body.subtract(s.t(w.Manifold.union(parts.cut))));
    if (parts.add.length) body = s.t(w.Manifold.union([body, ...parts.add]));
    assertValid(body, 'label plate');
    return withInlay(toMeshData(body), parts.inlay.length ? s.t(w.Manifold.union(parts.inlay)) : null);
  } finally {
    s.dispose();
  }
}
