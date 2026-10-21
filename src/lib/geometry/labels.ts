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
 * Label text may carry icons and alignment fragments (`{bolt:12}`, `{nut}`,
 * `{|}`, `{<}` …, labelIcons.ts), and `{contents}`, which planning replaces
 * with the first line(s) of the bin's "What's in it" (labelContents.ts).
 *
 * Label plates: each tab gets a shallow recess (with a chamfered mouth and a
 * finger notch at the right end) and a separate flat plate carrying the text
 * is planned as its own part, so labels can be swapped. The tabs can take two
 * community standards instead (`labelFormat`):
 * - Cullenect (Cullen J Webb's swappable labels, v2, as gflabel and Gridfinity
 *   Extended make them): 42u − 6 wide (36 mm for one unit), 11 mm tall,
 *   1.2 mm thick, 0.5 mm corners, a 0.2 mm groove around the edge 0.2–0.8 mm
 *   up from its back. The socket is a 1.5 mm deep pocket 0.3 mm bigger
 *   (42u − 5.7) with a 0.2 mm rib along each long side, 0.2–0.6 mm up from its
 *   floor, that snaps into the groove.
 * - Pred (Pred's parametric Gridfinity bins and labels): 42u − 4.2 wide over its
 *   end nubs, 11.5 mm tall, 0.8 mm thick, 0.9 mm corners, a 1 × 5.7 mm nub at
 *   each end with a 1.5 mm hole behind it so it flexes. The socket is a 1 mm
 *   deep pocket (0.2 mm clearance) with 6.7 mm slots for the nubs; where the
 *   tab meets the bin's side walls the slots reach under the stacking lip,
 *   which holds the label down.
 * Their labels print with the bins too, with our text and icons (`labelPrint`),
 * or come from elsewhere (gflabel, the authors' generators).
 *
 * Text on the outside of the front wall is in frontLabel.ts.
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
import { truncateLabel } from './labelIcons';
import type { Contour } from './font';
import type { LabelTab } from './compartments';
import type { DividerLayout } from '../dividers/types';

export type LabelTextStyle = 'raised' | 'engraved' | 'inlaid';
export const LABEL_STYLES: readonly LabelTextStyle[] = ['raised', 'engraved', 'inlaid'];

/** Which swappable labels the tabs take: our own plates, or a community standard's. */
export type LabelFormat = 'gridfit' | 'cullenect' | 'pred';
export const LABEL_FORMATS: readonly LabelFormat[] = ['gridfit', 'cullenect', 'pred'];

/**
 * Text on the outside of the front wall (frontLabel.ts): raised, raised in
 * filament 2 ('two-tone'), or engraved / inlaid flush.
 */
export type FrontLabelStyle = 'none' | 'raised' | 'two-tone' | 'engraved' | 'inlaid';
export const FRONT_LABEL_STYLES: readonly FrontLabelStyle[] = ['none', 'raised', 'two-tone', 'engraved', 'inlaid'];

export interface BinLabelOptions {
  /** Text for every label tab whose compartment has none of its own ("\n" starts a new line). */
  labelText: string;
  labelStyle: LabelTextStyle;
  /** Recess in each tab plus a separate, swappable label plate per tab. */
  labelPlates: boolean;
  /** With label plates: the socket the tabs get, and the label that fits it. */
  labelFormat: LabelFormat;
  /** With Cullenect or Pred sockets: print the labels too (else they come from elsewhere). Gridfit plates always print. */
  labelPrint: boolean;
  /** Text on the outside of the front wall: the bin's text (compartments along the front can have their own). */
  frontLabel: FrontLabelStyle;
  /** Front label cap height (mm); 0 = as large as fits. */
  frontLabelSize: number;
  /**
   * Per-tab text resolved from "What's in it" at planning time
   * (labelContents.ts), keyed like the tabs. Never saved; in the mesh key.
   */
  labelTabTexts?: Record<string, string>;
}

export const DEFAULT_LABELS: BinLabelOptions = {
  labelText: '',
  labelStyle: 'raised',
  labelPlates: false,
  labelFormat: 'gridfit',
  labelPrint: true,
  frontLabel: 'none',
  frontLabelSize: 0,
};

/** Characters per label; an icon (or any other fragment) counts as one. */
export const LABEL_MAX_CHARS = 60;
/** Raw length limit, fragments spelled out. */
export const LABEL_MAX_RAW = 240;
export const LABEL_MAX_LINES = 3;
export const FRONT_LABEL_MAX_SIZE = 20;

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

/** Cullenect labels (v2) and their socket. Per 42 mm unit: label 42u − 6 wide, socket 42u − 5.7. */
export const CULLENECT = {
  depth: 11,
  thickness: 1.2,
  radius: 0.5,
  /** Groove around the label's edge: this deep, from grooveZ0 to grooveZ1 above its back. */
  groove: 0.2,
  grooveZ0: 0.2,
  grooveZ1: 0.8,
  /** The socket is this much bigger than the label per side, and this deep. */
  clearance: 0.15,
  socketDepth: 1.5,
  /** Ribs along the socket's long sides: this far into the pocket, from ribZ0 to ribZ1 above its floor. */
  rib: 0.2,
  ribZ0: 0.2,
  ribZ1: 0.6,
  /**
   * Tab left in front of the socket (the tab is thin at its front edge), and
   * behind it: the socket sits at the back of the visible tab, just far enough
   * forward that a label's back corners clear the lip's rounded inside corners.
   */
  frontMargin: 1.5,
  backMargin: 0.12,
  /** Text margin on the label. */
  margin: 0.6,
  minWidth: 12,
  /** Label width = 42 × units − this. */
  unitLess: 6,
} as const;

/** Pred labels and their socket. Label 42u − 4.2 wide over its nubs. */
export const PRED = {
  depth: 11.5,
  thickness: 0.8,
  radius: 0.9,
  /** End nubs: this long, this tall (centered). */
  nub: 1,
  nubHeight: 5.7,
  /** Flex hole near each end: radius, and its center this far in from the body's end. */
  hole: 0.75,
  holeInset: 0.5,
  /** Socket: clearance per side, depth, size across, nub slots across. */
  clearance: 0.2,
  socketDepth: 1,
  socketY: 12,
  slotY: 6.7,
  frontMargin: 0.8,
  backMargin: 0,
  /** Text area: the label less this at each end, less `margin` top and bottom. */
  textInsetX: 2.75,
  margin: 0.5,
  minWidth: 16,
  /** Label width = 42 × units − this. */
  unitLess: 4.2,
} as const;

/** The feet of a bin (or lid) stacked in the lip sit this far below the top of the walls. */
const STACK_DROP = BASE_PROFILE_HEIGHT - LIP_HEIGHT;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Clean label text from user input: no control characters (newlines stay),
 * at most LABEL_MAX_LINES lines and LABEL_MAX_CHARS characters (a fragment
 * such as `{bolt:12}` counts as one). Spaces are kept so typing isn't
 * disturbed; `labelLines` trims for layout.
 */
export function sanitizeLabelText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let t = v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  const lines = t.split('\n');
  if (lines.length > LABEL_MAX_LINES) t = [...lines.slice(0, LABEL_MAX_LINES - 1), lines.slice(LABEL_MAX_LINES - 1).join(' ')].join('\n');
  return truncateLabel(t, LABEL_MAX_CHARS, LABEL_MAX_RAW);
}

/** Text as laid out: lines trimmed, blank lines at the start and end dropped. '' = no label. */
export function labelLines(text: string | undefined | null): string {
  const lines = (text ?? '').split('\n').map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}

/** Resolved per-tab texts (planning output); anything else is dropped. */
function cleanTabTexts(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 256 || !k || k.length > 500 || typeof t !== 'string') continue;
    out[k] = sanitizeLabelText(t);
    n++;
  }
  return n ? out : undefined;
}

export function sanitizeLabelOptions(o: Partial<BinLabelOptions>): BinLabelOptions {
  const size = Number(o.frontLabelSize);
  const out: BinLabelOptions = {
    labelText: sanitizeLabelText(o.labelText),
    labelStyle: LABEL_STYLES.includes(o.labelStyle as LabelTextStyle) ? (o.labelStyle as LabelTextStyle) : DEFAULT_LABELS.labelStyle,
    labelPlates: !!o.labelPlates,
    labelFormat: LABEL_FORMATS.includes(o.labelFormat as LabelFormat) ? (o.labelFormat as LabelFormat) : DEFAULT_LABELS.labelFormat,
    labelPrint: o.labelPrint === undefined ? DEFAULT_LABELS.labelPrint : !!o.labelPrint,
    frontLabel: FRONT_LABEL_STYLES.includes(o.frontLabel as FrontLabelStyle) ? (o.frontLabel as FrontLabelStyle) : DEFAULT_LABELS.frontLabel,
    frontLabelSize:
      Number.isFinite(size) && size > 0 ? Math.round(Math.min(FRONT_LABEL_MAX_SIZE, Math.max(LABEL_TEXT.minCap, size)) * 10) / 10 : 0,
  };
  // Only planning sets this, on a copy of the options: clean it when it's there (and override whatever was).
  if (o.labelTabTexts !== undefined) out.labelTabTexts = cleanTabTexts(o.labelTabTexts);
  return out;
}

type LabelOpts = BinLabelOptions & { lip: boolean; layout?: DividerLayout | null };

/** Mesh-key parts; empty for bins without label text, plates or a front label, so their keys don't change. */
export function labelKeyParts(o: LabelOpts): string[] {
  const text = labelLines(o.labelText);
  const tab = o.labelTabTexts && Object.keys(o.labelTabTexts).length ? o.labelTabTexts : null;
  const any = !!text || !!tab || Object.values(o.layout?.comps ?? {}).some((c) => !!labelLines(c.labelText));
  const p: string[] = [];
  if (text) p.push(`T${JSON.stringify(text)}`);
  if (any) p.push(`T${o.labelStyle}`);
  if (o.labelPlates) p.push('Tplates');
  if (o.labelPlates && o.labelFormat && o.labelFormat !== 'gridfit') p.push(`T${o.labelFormat}`);
  if (tab) p.push(`TT${JSON.stringify(Object.keys(tab).sort().map((k) => [k, labelLines(tab[k])]))}`);
  if (any && o.frontLabel && o.frontLabel !== 'none') p.push(`F${o.frontLabel}${o.frontLabelSize ? `@${o.frontLabelSize}` : ''}`);
  return p;
}

/** A compartment's label text: from its contents (resolved at planning), its own, else the bin's. */
export function compartmentLabelText(
  o: Pick<BinLabelOptions, 'labelText' | 'labelTabTexts'> & { layout?: DividerLayout | null },
  key: string,
): string {
  return labelLines(o.labelTabTexts?.[key] ?? o.layout?.comps?.[key]?.labelText ?? o.labelText);
}

/** True when a style puts something on filament 2. */
export const inlayStyle = (s: string) => s === 'inlaid' || s === 'two-tone';

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
  /** A community standard's shape (unset: our own plate). */
  format?: Exclude<LabelFormat, 'gridfit'>;
}

/** A tab's socket and the plate that goes in it. */
export interface TabPlate {
  format: LabelFormat;
  /** The main pocket. */
  recess: Box;
  /** Finger notch at the right end (r = 0: none). */
  notch: { x: number; y: number; r: number };
  /** Pred: slots for the end nubs (they may reach under the stacking lip). */
  slots?: Box[];
  /** Bottom of the pocket. */
  floor: number;
  /** The plate's min corner (bin coordinates) and bottom when pressed in. */
  at: { x: number; y: number; z: number };
  plate: LabelPlate;
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
  plate?: TabPlate;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const floor1 = (v: number) => Math.floor(v * 10 + 1e-6) / 10;

/** How high raised text may rise on a tab at height z (bin body height H). */
function raiseAt(o: { lip: boolean }, H: number, z: number) {
  const headroom = o.lip ? H - STACK_DROP - z : Infinity;
  return Math.min(LABEL_TEXT.raise, headroom - LABEL_TEXT.clearance);
}

/** Our own plate in a recess with a finger notch (unchanged sizes). */
function gridfitPlate(tab: LabelTab, text: string, style: LabelTextStyle, raise: number): TabPlate | null {
  const P = LABEL_PLATE;
  const tw = tab.x1 - tab.x0;
  const vd = tab.y1 - tab.y0;
  const depth = r2(Math.min(P.maxDepth, vd - 2));
  const rd = depth + 2 * P.clearance;
  const r = Math.min(P.notch, rd / 2 - 1);
  const width = r2(Math.min(P.maxWidth, tw - 2, tw - 2 * P.endWall - 2 * P.clearance - r));
  if (!(width >= P.minWidth && depth >= P.minDepth && r >= 1.5)) return null;
  const len = width + 2 * P.clearance + r;
  const rx0 = (tab.x0 + tab.x1) / 2 - len / 2;
  const ry0 = tab.y0 + (vd - rd) / 2;
  const recess = { x0: rx0, y0: ry0, x1: rx0 + width + 2 * P.clearance, y1: ry0 + rd };
  const relief = style === 'raised' ? r2(raise) : P.textDepth;
  return {
    format: 'gridfit',
    recess,
    notch: { x: recess.x1, y: (recess.y0 + recess.y1) / 2, r },
    floor: tab.z - P.thickness,
    at: { x: recess.x0 + P.clearance, y: recess.y0 + P.clearance, z: tab.z - P.thickness },
    plate: { width, depth, thickness: P.thickness, text, style, relief },
  };
}

/** Where a socket may go along a tab: [lo, hi], and whether each end meets the side wall under the lip. */
function tabSpan(tab: LabelTab, lim: number) {
  const atL = tab.x0 <= -lim + 0.05;
  const atR = tab.x1 >= lim - 0.05;
  return { atL, atR };
}

/** Largest standard width (42 × units − less) that fits `avail`, else a custom one (≥ min), else null. */
function standardWidth(avail: number, less: number, clearance: number, min: number): number | null {
  const k = Math.floor((avail + less - clearance + 1e-4) / 42);
  if (k >= 1) return 42 * k - less;
  const w = floor1(avail - clearance);
  return w >= min ? w : null;
}

function cullenectPlate(tab: LabelTab, lim: number, text: string, style: LabelTextStyle, raise: (z: number) => number): TabPlate | null {
  const C = CULLENECT;
  const { atL, atR } = tabSpan(tab, lim);
  const lo = tab.x0 + (atL ? 0 : LABEL_PLATE.endWall);
  const hi = tab.x1 - (atR ? 0 : LABEL_PLATE.endWall);
  const width = standardWidth(hi - lo, C.unitLess, 2 * C.clearance, C.minWidth);
  const sy = C.depth + 2 * C.clearance;
  // Against the back of the visible tab, where the tab is thickest.
  const y0 = tab.y1 - C.backMargin - sy;
  if (width === null || y0 < tab.y0 + C.frontMargin - 1e-6) return null;
  const sx = width + 2 * C.clearance;
  const x0 = (lo + hi) / 2 - sx / 2;
  const recess = { x0, y0, x1: x0 + sx, y1: y0 + sy };
  const floor = tab.z - C.socketDepth;
  const top = floor + C.thickness;
  return {
    format: 'cullenect',
    recess,
    notch: { x: recess.x1, y: (y0 + recess.y1) / 2, r: 0 },
    floor,
    at: { x: x0 + C.clearance, y: y0 + C.clearance, z: floor },
    plate: { width, depth: C.depth, thickness: C.thickness, text, style, relief: style === 'raised' ? r2(raise(top)) : LABEL_PLATE.textDepth, format: 'cullenect' },
  };
}

function predPlate(tab: LabelTab, lim: number, text: string, style: LabelTextStyle, raise: (z: number) => number): TabPlate | null {
  const P = PRED;
  const { atL, atR } = tabSpan(tab, lim);
  // Nub slots may run under the lip at the bin's side walls; elsewhere the whole socket stays on the tab.
  const lo = atL ? tab.x0 - P.nub : tab.x0 + LABEL_PLATE.endWall;
  const hi = atR ? tab.x1 + P.nub : tab.x1 - LABEL_PLATE.endWall;
  const width = standardWidth(hi - lo, P.unitLess, 2 * P.clearance, P.minWidth);
  const y0 = tab.y1 - P.backMargin - P.socketY;
  if (width === null || y0 < tab.y0 + P.frontMargin - 1e-6) return null;
  const total = width + 2 * P.clearance;
  const s0 = (lo + hi) / 2 - total / 2;
  const s1 = s0 + total;
  const recess = { x0: s0 + P.nub, y0, x1: s1 - P.nub, y1: y0 + P.socketY };
  const ym = y0 + P.socketY / 2;
  const slots = [
    { x0: s0, y0: ym - P.slotY / 2, x1: recess.x0 + 0.5, y1: ym + P.slotY / 2 },
    { x0: recess.x1 - 0.5, y0: ym - P.slotY / 2, x1: s1, y1: ym + P.slotY / 2 },
  ];
  const floor = tab.z - P.socketDepth;
  const top = floor + P.thickness;
  return {
    format: 'pred',
    recess,
    notch: { x: recess.x1, y: ym, r: 0 },
    slots,
    floor,
    at: { x: s0 + P.clearance, y: ym - P.depth / 2, z: floor },
    plate: { width, depth: P.depth, thickness: P.thickness, text, style, relief: style === 'raised' ? r2(raise(top)) : LABEL_PLATE.textDepth, format: 'pred' },
  };
}

/**
 * What goes on each tab: text (with its effective style), or a plate socket.
 * Tabs without text and without plates are left out. `W` (the bin's outer
 * width) tells which tab ends meet the side walls, for Pred's nub slots.
 */
export function planTabLabels(o: LabelOpts, tabs: LabelTab[], H: number, W?: number): TabLabel[] {
  const out: TabLabel[] = [];
  const lim = W !== undefined && o.lip ? W / 2 - LIP_DEPTH : Infinity;
  for (const tab of tabs) {
    const text = compartmentLabelText(o, tab.key);
    const raise = raiseAt(o, H, tab.z);
    const style: LabelTextStyle = o.labelStyle === 'raised' && raise < LABEL_TEXT.minRaise ? 'engraved' : o.labelStyle;
    if (o.labelPlates) {
      const at = (z: number) => raiseAt(o, H, z);
      const plate =
        o.labelFormat === 'cullenect'
          ? cullenectPlate(tab, lim, text, style, at)
          : o.labelFormat === 'pred'
            ? predPlate(tab, lim, text, style, at)
            : gridfitPlate(tab, text, style, raise);
      if (plate) {
        out.push({ tab, text, style, relief: plate.plate.relief, box: plate.recess, plate });
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
  const parts: unknown[] = [p.width, p.depth, p.thickness, p.style, p.relief, labelLines(p.text)];
  if (p.format) parts.push(p.format);
  return `label|${JSON.stringify(parts)}`;
}

/** Height of a plate including raised text. */
export function labelPlateHeight(p: LabelPlate): number {
  return p.thickness + (p.style === 'raised' && labelLines(p.text) ? p.relief : 0);
}

/** Where the text goes on a plate (plate coordinates). */
export function plateTextBox(p: LabelPlate): Box {
  if (p.format === 'pred') return { x0: PRED.textInsetX, y0: PRED.margin, x1: p.width - PRED.textInsetX, y1: p.depth - PRED.margin };
  const m = p.format === 'cullenect' ? CULLENECT.margin : LABEL_PLATE.margin;
  return { x0: m, y0: m, x1: p.width - m, y1: p.depth - m };
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
 * actual outline (descenders, accents) fits, centered. Lines aligned with
 * `{<}` / `{>}` or spread with `{...}` go to the box's edges. Null without a
 * font, for blank text, or when the text would come out smaller than
 * LABEL_TEXT.minCap.
 */
export function fitText(text: string, box: Box, maxCap: number): FittedText | null {
  const t0 = labelLines(text);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (!t0 || !hasFont() || !(bw > 0) || !(bh > 0) || !(maxCap >= LABEL_TEXT.minCap)) return null;
  let maxWidth = bw;
  let t = textOutline(t0, { size: maxCap, maxWidth, maxHeight: bh });
  let ink = inkBounds(t.contours);
  for (let i = 0; i < 3 && ink; i++) {
    const k = Math.min(bw / (ink.x1 - ink.x0), bh / (ink.y1 - ink.y0));
    if (k >= 1) break;
    if (t.spread) {
      // The block is as wide as the box: make room for ink that pokes past its edges.
      const kh = bh / (ink.y1 - ink.y0);
      const over = Math.max(0, ink.x1 - ink.x0 - bw);
      maxWidth = Math.max(bw * 0.5, maxWidth - over * 1.05 - 1e-4);
      t = textOutline(t0, { size: kh < 1 ? t.size * kh * 0.985 : t.size, maxWidth, maxHeight: bh });
    } else t = textOutline(t0, { size: t.size * k * 0.985, maxWidth: bw, maxHeight: bh });
    ink = inkBounds(t.contours);
  }
  if (!ink || t.size < LABEL_TEXT.minCap || ink.x1 - ink.x0 > bw + 1e-6 || ink.y1 - ink.y0 > bh + 1e-6) return null;
  let cx = (box.x0 + box.x1) / 2 - (ink.x0 + ink.x1) / 2;
  if (t.spread) {
    // The block (not the ink) is centered, so aligned lines meet the box's edges.
    cx = (box.x0 + box.x1) / 2;
    if (cx + ink.x1 > box.x1) cx = box.x1 - ink.x1;
    if (cx + ink.x0 < box.x0) cx = box.x0 - ink.x0;
  }
  // The cap-height block is centered; descenders are nudged back inside.
  let cy = (box.y0 + box.y1) / 2;
  if (cy + ink.y1 > box.y1) cy = box.y1 - ink.y1;
  if (cy + ink.y0 < box.y0) cy = box.y0 - ink.y0;
  return { outline: t, cx, cy };
}

/** Largest cap height for a tab or plate of this depth. */
export const capFor = (depth: number) => Math.min(LABEL_TEXT.maxCap, LABEL_TEXT.capShare * depth);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Parts {
  cut: Manifold[];
  add: Manifold[];
  inlay: Manifold[];
  /** Cut without clipping to the lip opening (Pred's nub slots under the lip). */
  under?: Manifold[];
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

/** Socket for a label plate: our recess (pocket, chamfered mouth, finger notch), or a Cullenect / Pred socket. */
function recessCutters(w: Wasm, s: Scope, p: TabPlate, z: number, out: Parts) {
  const { x0, y0, x1, y1 } = p.recess;
  if (p.format === 'cullenect') {
    const C = CULLENECT;
    const pocket = s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, C.radius), p.floor, z + 1));
    const ribs = [
      s.t(boxAt(w, x0 - 1, y0 - 1, p.floor + C.ribZ0, x1 + 1, y0 + C.rib, p.floor + C.ribZ1)),
      s.t(boxAt(w, x0 - 1, y1 - C.rib, p.floor + C.ribZ0, x1 + 1, y1 + 1, p.floor + C.ribZ1)),
    ];
    out.cut.push(s.t(pocket.subtract(s.t(w.Manifold.union(ribs)))));
    return;
  }
  if (p.format === 'pred') {
    out.cut.push(s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, PRED.radius), p.floor, z + 1)));
    for (const b of p.slots ?? []) {
      // Inside the opening the slot is open to the top; beyond it (under the lip) it stops just under the tab's top.
      out.cut.push(s.t(boxAt(w, b.x0, b.y0, p.floor, b.x1, b.y1, z + 1)));
      (out.under ??= []).push(s.t(boxAt(w, b.x0, b.y0, p.floor, b.x1, b.y1, z - 0.05)));
    }
    return;
  }
  const T = LABEL_PLATE.thickness;
  const ch = LABEL_PLATE.chamfer;
  const rect = (g: number, zz: number): [number, number, number][] => [
    [x0 - g, y0 - g, zz],
    [x1 + g, y0 - g, zz],
    [x1 + g, y1 + g, zz],
    [x0 - g, y1 + g, zz],
  ];
  out.cut.push(
    s.t(boxAt(w, x0, y0, z - T, x1, y1, z + 1)),
    s.t(w.Manifold.hull([...rect(0, z - ch), ...rect(ch, z), ...rect(ch, z + 1)])),
    s.t(w.Manifold.cylinder(T + LABEL_PLATE.notchDepth + 1, p.notch.r, p.notch.r, 32).translate([p.notch.x, p.notch.y, z - T - LABEL_PLATE.notchDepth])),
  );
}

export interface LabelGeometry {
  /** Cut and add the label features to the bin body. */
  apply(bin: Manifold): Manifold;
  /** Something cut from the bin afterwards (wall cutouts) also trims the inlay. */
  clip(cutter: Manifold): void;
  /** Attach the inlay as an overlay on filament 2. */
  finish(mesh: MeshData): MeshData;
}

/** Extra label features (front labels) that join the tabs' in one LabelGeometry. */
export interface ExtraLabelParts {
  cut: Manifold[];
  add: Manifold[];
  inlay: Manifold[];
}

/**
 * Label text and plate recesses for a bin's tabs (bin body height H, outer
 * size W × D). Everything on the tabs is clipped to the opening inside the
 * lip, so text near a back corner never runs into the lip's rounded corner.
 * `extra` (front labels) is applied with it, unclipped.
 */
export function tabLabelGeometry(
  w: Wasm,
  s: Scope,
  o: LabelOpts,
  tabs: LabelTab[],
  H: number,
  W: number,
  D: number,
  extra?: ExtraLabelParts | null,
): LabelGeometry {
  const parts: Parts = { cut: [], add: [], inlay: [] };
  for (const L of planTabLabels(o, tabs, H, W)) {
    if (L.plate) {
      recessCutters(w, s, L.plate, L.tab.z, parts);
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
  const joined = (a: Manifold | null, more: Manifold[] | undefined) =>
    more?.length ? s.t(w.Manifold.union(a ? [a, ...more] : more)) : a;
  return {
    apply(bin) {
      let b = bin;
      const cut = joined(clipped(parts.cut), [...(parts.under ?? []), ...(extra?.cut ?? [])]);
      const add = joined(clipped(parts.add), extra?.add);
      if (cut) b = s.t(b.subtract(cut));
      if (add) b = s.t(w.Manifold.union(b, add));
      overlay = joined(clipped(parts.inlay), extra?.inlay);
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

/** Outline of a Pred label (min corner at the origin): body, end nubs, flex holes as separate contours. */
export function predOutline(width: number, depth: number = PRED.depth): { outer: Contour; holes: Contour[] } {
  const P = PRED;
  const n = P.nub;
  const r = Math.min(P.radius, depth / 2 - 0.1);
  const ym = depth / 2;
  const nh = Math.min(P.nubHeight, depth - 2 * r - 0.2) / 2;
  const arc = (cx: number, cy: number, a0: number): Contour => {
    const pts: Contour = [];
    for (let i = 0; i <= 6; i++) {
      const a = ((a0 + 15 * i) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  };
  const bx0 = n;
  const bx1 = width - n;
  const outer: Contour = [
    // Bottom edge, then the right nub, top edge, left nub (CCW).
    ...arc(bx0 + r, r, 180),
    ...arc(bx1 - r, r, 270),
    [bx1, ym - nh],
    [width, ym - nh],
    [width, ym + nh],
    [bx1, ym + nh],
    ...arc(bx1 - r, depth - r, 0),
    ...arc(bx0 + r, depth - r, 90),
    [bx0, ym + nh],
    [0, ym + nh],
    [0, ym - nh],
    [bx0, ym - nh],
  ];
  const circle = (cx: number): Contour => {
    const pts: Contour = [];
    for (let i = 0; i < 24; i++) {
      const a = (-2 * Math.PI * i) / 24;
      pts.push([cx + P.hole * Math.cos(a), ym + P.hole * Math.sin(a)]);
    }
    return pts;
  };
  return { outer, holes: [circle(bx0 + P.holeInset), circle(bx1 - P.holeInset)] };
}

/** The plate's body (no text), min corner at the origin, bottom at z = 0. */
function plateBody(w: Wasm, s: Scope, p: LabelPlate): Manifold {
  if (p.format === 'cullenect') {
    const C = CULLENECT;
    const r = Math.min(C.radius, p.width / 2 - 0.1, p.depth / 2 - 0.1);
    const body = s.t(extrudePolygon(w, roundedRectRing(0, 0, p.width, p.depth, r), 0, p.thickness));
    // The groove around the edge the socket's ribs snap into.
    const g = C.groove;
    const ring = s.t(
      s.t(extrudePolygon(w, roundedRectRing(-1, -1, p.width + 1, p.depth + 1, r + 1), C.grooveZ0, C.grooveZ1)).subtract(
        s.t(extrudePolygon(w, roundedRectRing(g, g, p.width - g, p.depth - g, Math.max(0.1, r - g)), C.grooveZ0 - 0.1, C.grooveZ1 + 0.1)),
      ),
    );
    return s.t(body.subtract(ring));
  }
  if (p.format === 'pred') {
    const { outer, holes } = predOutline(p.width, p.depth);
    const cs = new w.CrossSection([outer, ...holes], 'NonZero');
    try {
      return s.t(cs.extrude(p.thickness));
    } finally {
      cs.delete();
    }
  }
  const P = LABEL_PLATE;
  const r = Math.max(0.2, Math.min(P.radius, p.width / 2 - 0.1, p.depth / 2 - 0.1));
  const e = Math.min(P.footChamfer, r - 0.1);
  return s.t(
    loftRoundedRect(w, p.width / 2, p.depth / 2, p.width, p.depth, r, [
      { z: 0, inset: e },
      { z: e, inset: 0 },
      { z: p.thickness, inset: 0 },
    ]),
  );
}

/**
 * A label plate lying flat for printing, min corner at the origin, bottom at
 * z = 0; text on top, reading along +X with letter tops toward +Y.
 */
export function buildLabelPlate(w: Wasm, p: LabelPlate): MeshData {
  const s = new Scope();
  try {
    let body = plateBody(w, s, p);
    const parts: Parts = { cut: [], add: [], inlay: [] };
    const fit = fitText(p.text, plateTextBox(p), capFor(p.depth));
    if (fit) textInto(w, s, fit, p.thickness, p.style, p.relief, parts);
    if (parts.cut.length) body = s.t(body.subtract(s.t(w.Manifold.union(parts.cut))));
    if (parts.add.length) body = s.t(w.Manifold.union([body, ...parts.add]));
    assertValid(body, 'label plate');
    return withInlay(toMeshData(body), parts.inlay.length ? s.t(w.Manifold.union(parts.inlay)) : null);
  } finally {
    s.dispose();
  }
}
