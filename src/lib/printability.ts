/**
 * Print checks: cheap, rule-based warnings about option combinations that
 * won't print, or print badly, worked out from the options and cells alone
 * (no geometry is built). Each check says what's wrong in a sentence and,
 * where one option change fixes it, carries that change.
 *
 * - 'warn': likely to fail or come out broken (text that's left off or breaks
 *   up, a tab printed in mid-air, drawers that stick).
 * - 'info': it prints, but worse (weak single-line walls, sagging bridges,
 *   blobby text, a tall bin that may wobble).
 *
 * The nozzle sets the scale. A slicer lays down lines about as wide as the
 * nozzle (0.42–0.45 mm for a 0.4 mm nozzle, but it fits two in 0.8 mm), so a
 * wall under two nozzle widths prints as a single line and one under one
 * nozzle width may not print at all. Layers are assumed to be 0.2 mm (every
 * engraving and raise here is at least two layers, so none is checked). Fits
 * are compared with the nozzle too: 0.15 mm a side is snug but fine with a
 * 0.4 mm nozzle and too tight with a 0.6 mm one.
 *
 * Text checks lay the text out the way the geometry does (fitText), so they
 * need the label font: without it (on the main thread before it has loaded)
 * they are left out rather than guessed.
 *
 * Rounds (and anything else whose pocket grid carries an item height,
 * itemHeight.ts) that stick out of the bin, or would hold up its lid, a bin
 * stacked on it, or the drawer: placed bins know the room above them, what is
 * stacked on them and the printers they print on (placeChecks), so a fix that
 * raises the bin stays within them.
 *
 * Generators that already warn in their planning notes (drawer-unit bays and
 * hopper lintels that bridge far, racks that may tip over in the drawer,
 * text that doesn't fit a box lid or a hopper lip) aren't repeated here.
 */
import {
  binCells,
  binCutFloor,
  binFrontLabel,
  binLabelTabs,
  binLayout,
  binSize,
  binTotalHeight,
  removableInserts,
  sanitizeBin,
  type BinCells,
  type BinOptions,
} from './geometry/bin';
import { binBodyHeight } from './geometry/variants';
import { MAX_HEIGHT_UNITS, standingBinHeight, standingGrids, tipLimits, unitsToCover, unitsUnderRim, type StandingGrid } from './geometry/itemHeight';
import { BASE_PROFILE_DEPTH, BASE_TOP, BOWTIE_CLEARANCE, GRID, LIP_SUPPORT_HEIGHT, PUZZLE, WALL } from './geometry/spec';
import { LABEL_TEXT, capFor, fitText, labelLines, planTabLabels, plateTextBox, type Box, type LabelTextStyle } from './geometry/labels';
import { labelPlainText } from './geometry/labelIcons';
import { hasFont, textOutline } from './geometry/text';
import { RAIL, SLIDE, TRAY, accessoryInfillTop, planAccessories, planSlideLidQr, slideLidTextBox } from './geometry/accessories';
import { binQrPlan, type BinQrPlan } from './geometry/binQr';
import { QR } from './geometry/qrCode';
import { QR_ECCS, QR_QUIET, qrByteLength, qrCapacity, type QrEcc } from './qr';
import { planInserts } from './geometry/cups';
import { CUP, compartmentWantsCup } from './geometry/insertOptions';
import { compartmentInside, compartmentPocketOpts } from './geometry/compartments';
import { POCKET_LABEL_SIZE, pocketLayout } from './geometry/pockets';
import { cutoutArea, cutoutStyle } from './geometry/cutouts';
import { hasLid } from './geometry/lid';
import { isPocketLid } from './geometry/pocketLid';
import { hasStretch, stretchOf } from './geometry/placement';
import { bedOvershoot, usableBeds, type Beds } from './bedfit';
import { drawerRoom } from './bins';
import { columnOf, stackPlaces, type StackPlace } from './stacking';
import { activeContainer } from './geometry/containers';
import { DRAWER_UNIT, type DrawerUnitOptions } from './geometry/containers/drawers';
import { magazineLayout, type DispenserOptions } from './geometry/containers/dispenser';
import { BOX } from './geometry/containers/box';
import { caseFrame, sanitizeCase } from './geometry/case';
import { SPACER } from './geometry/spacers';
import { DEFAULT_BASEPLATE, type BaseplateOptions } from './geometry/baseplate';
import { RIB_THICKNESS, SLOT_CLEARANCE, T as DIVIDER_T, setWallProps } from './dividers';
import { computeLayout, spacerMargins, type DrawerInput, type GridLayout } from './layout/drawer';
import { DEFAULT_NOZZLE, type PrintSetup } from './layout/plan';
import { findPrinter } from './printers';
import { binSpec, printsBaseplate, type NamedDrawer, type PlacedBin, type ProjectState } from './project';
import { meshSize, printsMesh } from './external';

export type CheckSeverity = 'warn' | 'info';

export type CheckRule =
  | 'label-fit'
  | 'label-thin'
  | 'label-small'
  | 'pocket-walls'
  | 'hex-struts'
  | 'hex-holes'
  | 'crate-walls'
  | 'thin-parts'
  | 'hole-tops'
  | 'tab-floating'
  | 'finger-room'
  | 'tip-over'
  | 'stretch-overhang'
  | 'divider-fit'
  | 'lid-detent'
  | 'drawer-gap'
  | 'drawer-walls'
  | 'coin-bridge'
  | 'hinge-fit'
  | 'ridge-trim'
  | 'joint-fit'
  | 'nozzle-walls'
  | 'bambu-nozzle'
  | 'item-height'
  | 'mesh-open'
  | 'qr-fit'
  | 'qr-module'
  | 'qr-contrast'
  | 'qr-swaps';

/** A one-click change that fixes a check: options of the bin it is about, its drawer's baseplate, or the drawer. */
export interface CheckFix {
  /** Button text: "Make them 1.2 mm". */
  label: string;
  bin?: Partial<BinOptions>;
  baseplate?: Partial<BaseplateOptions>;
  drawer?: Partial<DrawerInput>;
}

export interface PrintCheck {
  rule: CheckRule;
  severity: CheckSeverity;
  /** What it is about, in a word or two: "Label text", "Pockets", "Baseplate". */
  part: string;
  message: string;
  fix?: CheckFix;
}

export interface CheckOptions {
  /** Nozzle diameter, mm (default DEFAULT_NOZZLE). */
  nozzle?: number;
  /** How lengths are written (default: mm, two decimals at most). */
  fmt?: (mm: number) => string;
  /**
   * Where the bin is placed (placeChecks works these out from its drawer).
   * `room`: how tall it may stand, mm from its bottom with its lid on: the
   * room above the baseplate less where it stands in a stack and what is
   * stacked on it (missing: no limit). `stacked`: a bin stands on it. `bed`:
   * the printers' beds, which a fix never makes it too big for.
   */
  room?: number;
  stacked?: boolean;
  bed?: Beds;
}

type Place = Pick<CheckOptions, 'room' | 'stacked' | 'bed'>;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const CHECK = {
  /** Thinnest stroke of the label font (Roboto Condensed Bold's crossbars; stems are 0.2), as a share of the cap height. */
  strokeShare: 0.165,
  /** Raised text with a smaller cap height comes out blobby. */
  raisedCap: 3,
  /** Narrowest compartment a finger reaches into; narrower ones count when deeper than `fingerDepth` × their width. */
  finger: 15,
  fingerDepth: 2,
  /** Height over the narrowest side of what stands on the bed: wobbles above `tip`, likely falls over above `fall`. */
  tip: 3,
  fall: 5,
  /** A flat bridge longer than this sags (the hopper's lintel warns at the same length). */
  bridge: 45,
  /** A stretched bin's overhang: sags past `sag` mm, needs supports past `support`. */
  stretchSag: 3,
  stretchSupport: 8,
  /** Hex wall holes point up: their tops slope 30° from flat, and sag when they reach further than this to the point (half the size). */
  hexReach: 5,
  /** Snug fits (slots, keys, tabs, hinges) want this share of the nozzle a side, sliding drawers `slide`. */
  snug: 0.3,
  slide: 0.6,
  /** QR code modules want this many nozzle widths across, or they blur together and the code won't scan. */
  qrLines: 2,
  /** Layer height the layer count of a vertical two-colour code is worked out with. */
  layer: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Ctx {
  nozzle: number;
  fmt: (mm: number) => string;
  /** "0.6 mm nozzle": nozzles are sold by their size in mm, whatever the units. */
  nz: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const floor1 = (v: number) => Math.floor(v * 10 + 1e-6) / 10;
const ceil1 = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
const ceilStep = (v: number, step: number) => Math.ceil(v / step - 1e-6) * step;
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

function context(o: CheckOptions = {}): Ctx {
  const nozzle = o.nozzle && o.nozzle > 0 ? o.nozzle : DEFAULT_NOZZLE;
  return { nozzle, fmt: o.fmt ?? ((mm) => `${r2(mm)} mm`), nz: `${nozzle} mm nozzle` };
}

/** The nozzle a setup prints with, mm. */
export function nozzleOf(setup: Pick<PrintSetup, 'nozzle'>): number {
  return setup.nozzle && setup.nozzle > 0 ? setup.nozzle : DEFAULT_NOZZLE;
}

/** Label text as quoted in a message: icons named, on one line, cut short. */
function quote(text: string): string {
  const t = labelPlainText(labelLines(text)).replace(/\s+/g, ' ').trim();
  return `“${t.length > 24 ? `${t.slice(0, 23).trimEnd()}…` : t}”`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * A wall `t` thick: weak under two nozzle widths ('info'), may not print under
 * one ('warn'). `fix` gets the thickness that clears it (two nozzle widths).
 */
function wallCheck(rule: CheckRule, part: string, what: string, t: number, x: Ctx, fix?: (v: number) => CheckFix | undefined): PrintCheck | null {
  if (t >= 2 * x.nozzle - 1e-6) return null;
  const broken = t < x.nozzle - 1e-6;
  return {
    rule,
    severity: broken ? 'warn' : 'info',
    part,
    message: broken
      ? `${what} ${x.fmt(t)}, thinner than the ${x.nz}: they may not print at all.`
      : `${what} ${x.fmt(t)}, under two lines of the ${x.nz}, so they print weak.`,
    ...(fix ? { fix: fix(ceil1(2 * x.nozzle)) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const fitCache = new Map<string, number>();

/** Cap height fitText gives text in a box of this size (0: too small, so it's left off). */
function fittedCap(text: string, box: Box, maxCap: number): number {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const key = `${text}\u0001${r2(w)}\u0001${r2(h)}\u0001${r2(maxCap)}`;
  let v = fitCache.get(key);
  if (v === undefined) {
    v = fitText(text, { x0: 0, y0: 0, x1: w, y1: h }, maxCap)?.outline.size ?? 0;
    if (fitCache.size > 4000) fitCache.clear();
    fitCache.set(key, v);
  }
  return v;
}

/** One piece of text as it will print. */
interface TextSpot {
  text: string;
  /** Cap height; 0 = it doesn't fit and is left off. */
  cap: number;
  style: LabelTextStyle | 'two-tone';
  /** Label tab text: the compartment it's on. */
  key?: string;
}

interface TextPlace {
  part: string;
  /** What one piece of text is called ("label"), and where it goes for one and for several ("on its label tab", "on their label tabs"). */
  noun: string;
  on: [string, string];
  /** A change that fixes these spots, if there is one. */
  fix?: (spots: TextSpot[], rule: CheckRule) => CheckFix | undefined;
}

const raised = (s: TextSpot) => s.style === 'raised' || s.style === 'two-tone';

/** Which text rule a spot breaks, if any. */
function textRule(s: TextSpot, x: Ctx): CheckRule | null {
  if (!s.cap) return 'label-fit';
  if (CHECK.strokeShare * s.cap < x.nozzle - 1e-6) return 'label-thin';
  if (raised(s) && s.cap < CHECK.raisedCap - 1e-6) return 'label-small';
  return null;
}

/** One check per broken rule, naming the smallest text. */
function textChecks(spots: TextSpot[], place: TextPlace, x: Ctx): PrintCheck[] {
  const out: PrintCheck[] = [];
  for (const rule of ['label-fit', 'label-thin', 'label-small'] as const) {
    const bad = spots.filter((s) => textRule(s, x) === rule).sort((a, b) => a.cap - b.cap);
    if (!bad.length) continue;
    const s = bad[0];
    const n = bad.length - 1;
    const what = n ? `${quote(s.text)} and ${n} more ${plural(n, place.noun, `${place.noun}s`)}` : quote(s.text);
    const one = !n;
    const cap = x.fmt(floor1(s.cap));
    const message =
      rule === 'label-fit'
        ? one
          ? `${what} doesn’t fit ${place.on[0]}, so it’s left off.`
          : `${what} don’t fit ${place.on[1]}, so they’re left off.`
        : rule === 'label-thin'
          ? `${what} ${one ? `comes out ${cap} tall` : `come out as small as ${cap}`}, with strokes thinner than the ${x.nz}: the letters break up.`
          : `Raised ${what} ${one ? `is only ${cap} tall and prints` : `are as small as ${cap} and print`} blobby; ${x.fmt(CHECK.raisedCap)} or taller reads well.`;
    const fix = place.fix?.(bad, rule);
    out.push({ rule, severity: rule === 'label-small' ? 'info' : 'warn', part: place.part, message, ...(fix ? { fix } : {}) });
  }
  return out;
}

/** Text on the label tabs, and on the label plates that print with the bin. */
function tabSpots(o: BinOptions, cells: BinCells): { tabs: TextSpot[]; plates: TextSpot[] } {
  const tabs: TextSpot[] = [];
  const plates: TextSpot[] = [];
  const printsPlates = o.labelFormat === 'gridfit' || o.labelPrint;
  const { w: W } = binSize(o, cells);
  for (const L of planTabLabels(o, binLabelTabs(o, cells), binBodyHeight(o), W)) {
    if (!labelLines(L.text)) continue;
    if (L.plate) {
      if (!printsPlates) continue;
      const p = L.plate.plate;
      plates.push({ text: L.text, cap: fittedCap(L.text, plateTextBox(p), capFor(p.depth)), style: p.style });
    } else tabs.push({ text: L.text, cap: fittedCap(L.text, L.box, capFor(L.tab.y1 - L.tab.y0)), style: L.style, key: L.tab.key });
  }
  return { tabs, plates };
}

function labelChecks(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck[] {
  if (!hasFont()) return [];
  const out: PrintCheck[] = [];
  const { tabs, plates } = tabSpots(o, cells);
  // Full-width tabs give the text more room, when every tab in question takes the bin's tab setting.
  const fullTabs = (bad: TextSpot[], rule: CheckRule): CheckFix | undefined => {
    if (o.label === 'full' || bad.some((s) => !s.key || o.layout?.comps?.[s.key]?.label)) return undefined;
    const alt = new Map(tabSpots({ ...o, label: 'full' }, cells).tabs.map((s) => [s.key, s]));
    return bad.every((s) => alt.has(s.key) && textRule(alt.get(s.key)!, x) !== rule) ? { label: 'Use full-width tabs', bin: { label: 'full' } } : undefined;
  };
  out.push(...textChecks(tabs, { part: 'Label text', noun: 'label', on: ['on its label tab', 'on their label tabs'], fix: fullTabs }, x));
  out.push(...textChecks(plates, { part: 'Label plates', noun: 'label', on: ['on its label plate', 'on their label plates'] }, x));

  const front = binFrontLabel(o, cells);
  if (front) {
    const spots = (p: NonNullable<typeof front>) => p.segments.map((g): TextSpot => ({ text: g.text, cap: fittedCap(g.text, g.box, p.cap), style: p.style }));
    const auto = (bad: TextSpot[], rule: CheckRule): CheckFix | undefined => {
      if (!(o.frontLabelSize > 0)) return undefined;
      const alt = binFrontLabel({ ...o, frontLabelSize: 0 }, cells);
      return alt && spots(alt).every((s) => textRule(s, x) !== rule) && bad.length
        ? { label: 'Make it as large as fits', bin: { frontLabelSize: 0 } }
        : undefined;
    };
    out.push(...textChecks(spots(front), { part: 'Front label', noun: 'label', on: ['on the front wall', 'on the front wall'], fix: auto }, x));
  }

  const lidText = labelLines(o.slideLidText);
  if (lidText) {
    const { w: W, d: D } = binSize(o, cells);
    if (planAccessories(o, W, D).slide) {
      // As slidingLid.ts lays it out: behind the grip ridges, inside the edge chamfer, left of a QR code.
      const box = slideLidTextBox(W, D, planSlideLidQr(o, W, D)?.spot);
      const cap = fittedCap(lidText, box, Math.min(LABEL_TEXT.maxCap, 0.6 * (box.y1 - box.y0)));
      out.push(...textChecks([{ text: lidText, cap, style: 'engraved' }], { part: 'Sliding lid', noun: 'label', on: ['on the sliding lid', 'on the sliding lid'] }, x));
    }
  }

  // Tool names, engraved beside their pockets.
  const tools = o.interior === 'cutouts' || Object.values(o.layout?.comps ?? {}).some((c) => c?.inside === 'tools');
  const named = tools ? (o.cutouts ?? []).filter((c) => c.label && c.name.trim()) : [];
  if (named.length) {
    const st = cutoutStyle(o);
    const { w: W, d: D } = binSize(o, cells);
    const area = cutoutArea(W, D, o.lip, o.lipStyle);
    const maxWidth = Math.max(5, area.x1 - area.x0 - 2);
    const spots = named.map((c): TextSpot => ({ text: c.name.trim(), cap: textOutline(c.name.trim(), { size: st.labelSize, maxWidth }).size, style: 'engraved' }));
    const bigger = (bad: TextSpot[], rule: CheckRule): CheckFix | undefined => {
      if (rule !== 'label-thin') return undefined;
      const v = Math.min(20, ceilStep(x.nozzle / CHECK.strokeShare, 0.5));
      // Only when the names are as large as asked (long ones are shrunk to the bin's width).
      return bad.every((s) => s.cap >= st.labelSize - 1e-6) && v > st.labelSize
        ? { label: `Make the names ${x.fmt(v)}`, bin: { cutoutStyle: { ...o.cutoutStyle, labelSize: v } } }
        : undefined;
    };
    out.push(...textChecks(spots, { part: 'Tool names', noun: 'name', on: ['beside its pocket', 'beside their pockets'], fix: bigger }, x));
  }

  // Graduated sets: each size engraved in front of its pocket, shrunk to the pocket's width.
  if (o.interior === 'pockets' && o.pocketSizes.length && o.pocketSizeLabels !== 'none') {
    const { w: W, d: D } = binSize(o, cells);
    const H = binBodyHeight(o);
    const L = pocketLayout(o, W, D, binCutFloor(o, cells), accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H));
    const spots = L.pockets.flatMap((p): TextSpot[] =>
      p.label ? [{ text: p.label.text, cap: textOutline(p.label.text, { size: POCKET_LABEL_SIZE, maxWidth: p.label.w + 0.01 }).size, style: 'engraved' }] : [],
    );
    out.push(...textChecks(spots, { part: 'Size labels', noun: 'size', on: ['in front of its pocket', 'in front of their pockets'] }, x));
  }
  return out;
}

// ---------------------------------------------------------------------------
// QR codes
// ---------------------------------------------------------------------------

/** Most bytes (or characters, in the text's mode) a code on a square `room` mm across holds with modules `module` mm. */
function qrMostFits(room: number, module: number, ecc: QrEcc, mode: NonNullable<BinQrPlan['fit']>['mode'] | undefined): number {
  const v = Math.min(40, Math.floor((room / module - 2 * QR_QUIET - 17) / 4 + 1e-9));
  return v >= 1 ? qrCapacity(v, ecc, mode ?? 'byte') : 0;
}

/**
 * QR codes (binQr.ts): left off (nothing to say, too long, no room, no lid),
 * modules under two lines of the nozzle (with the change that clears it, or
 * what to do when none does: the text is too long for the surface), one-colour
 * codes that only shadows make readable, and two-colour codes on the front
 * wall that change filament on every layer.
 */
function qrChecks(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck[] {
  const plan = binQrPlan(o, cells);
  if (!plan) return [];
  const out: PrintCheck[] = [];
  const part = 'QR code';
  const min = CHECK.qrLines * x.nozzle;
  const len = plan.fit ? plan.fit.length : qrByteLength(plan.text);
  const what = plan.fit?.mode === 'byte' || !plan.fit ? `${len} byte${len === 1 ? '' : 's'}` : `${len} characters`;
  const where = `the ${plan.where}`;
  // A change of these options that gets modules of at least `min`.
  const clears = (patch: Partial<BinOptions>) => {
    const p = binQrPlan({ ...o, ...patch }, cells);
    return !!p?.spot && p.spot.module >= min - 1e-6;
  };
  const lowerEcc = () => {
    const i = QR_ECCS.indexOf(o.qrEcc);
    for (let k = i - 1; k >= 0; k--) if (clears({ qrEcc: QR_ECCS[k] })) return QR_ECCS[k];
    return null;
  };
  const elsewhere = (): { label: string; bin: Partial<BinOptions> } | null => {
    if (o.qr !== 'plate' && clears({ qr: 'plate', qrSize: 0 })) return { label: 'Print it on a plate', bin: { qr: 'plate', qrSize: 0 } };
    if (o.qr !== 'lid' && clears({ qr: 'lid', qrSize: 0 })) return { label: 'Put it on the lid', bin: { qr: 'lid', qrSize: 0 } };
    return null;
  };
  const fixFor = (): CheckFix | undefined => {
    const e = lowerEcc();
    if (e) return { label: `Use error correction ${e}`, bin: { qrEcc: e } };
    if (o.qrSize > 0 && clears({ qrSize: 0 })) return { label: o.qr === 'plate' ? 'Make the plate as large as reads well' : 'Make it as large as fits', bin: { qrSize: 0 } };
    if (o.qr === 'plate' && plan.fit) {
      const side = Math.ceil((plan.fit.size + 2 * QR_QUIET) * min);
      if (side <= QR.maxPlate && clears({ qrSize: side })) return { label: `Make the plate ${x.fmt(side)}`, bin: { qrSize: side } };
    }
    return elsewhere() ?? undefined;
  };
  const advice = (room: number) => {
    const most = qrMostFits(room, min, o.qrEcc, plan.fit?.mode);
    return `${most ? `At most ${most} ${plan.fit?.mode === 'byte' || !plan.fit ? 'bytes' : 'characters'} fit ${where} at ${x.fmt(min)} modules (two lines of the ${x.nz}). ` : ''}Shorten the text, pick a bigger surface (a plate) or lower error correction, or print with a finer nozzle.`;
  };

  if (!plan.spot) {
    if (plan.error === 'empty') {
      out.push({
        rule: 'qr-fit',
        severity: 'info',
        part,
        message:
          o.qrContent === 'custom'
            ? 'The QR code has no text yet, so it’s left off.'
            : 'The QR code has nothing to say yet: the bin has no label and nothing in What’s in it, so it’s left off.',
      });
      return out;
    }
    if (plan.error === 'no-surface') {
      const fix: CheckFix = o.lip && !hasStretch(cells.stretch) ? { label: 'Add a stacking lid', bin: { lid: true } } : { label: 'Print it on a plate', bin: { qr: 'plate' } };
      out.push({ rule: 'qr-fit', severity: 'warn', part, message: 'The bin has no lid to put the QR code on, so it’s left off.', fix });
      return out;
    }
    const fix = fixFor();
    out.push({
      rule: 'qr-fit',
      severity: 'warn',
      part,
      message:
        plan.error === 'no-room'
          ? `${where[0].toUpperCase()}${where.slice(1)} has no room for a QR code (${x.fmt(Math.max(0, plan.room))} across; the smallest needs ${x.fmt((21 + 2 * QR_QUIET) * QR.minModule)}), so it’s left off.`
          : `The QR code’s text (${what}) is too long for ${where}, so it’s left off: ${plan.fit ? `it needs ${plan.fit.size} × ${plan.fit.size} modules (version ${plan.fit.version}, error correction ${o.qrEcc})` : 'no QR code holds that much'} and ${where} has ${x.fmt(plan.room)}. ${advice(plan.room)}`,
      ...(fix ? { fix } : {}),
    });
    return out;
  }

  const spot = plan.spot;
  if (spot.module < min - 1e-6) {
    const fix = fixFor();
    const size = `${spot.modules} × ${spot.modules} modules (version ${spot.version}) of ${x.fmt(spot.module)}`;
    out.push(
      fix
        ? { rule: 'qr-module', severity: 'warn', part, message: `The QR code comes out ${size}, under two lines of the ${x.nz}: they blur together and it may not scan.`, fix }
        : { rule: 'qr-fit', severity: 'warn', part, message: `The QR code’s text (${what}) is too long for ${where}: it comes out ${size}, under two lines of the ${x.nz}, and won’t scan reliably. ${advice(plan.room)}` },
    );
  }
  if (spot.style !== 'inlaid') {
    const lidFallback = o.qrStyle === 'raised' && spot.style === 'engraved';
    out.push({
      rule: 'qr-contrast',
      severity: 'info',
      part,
      message: `A one-colour QR code (${spot.style}${lidFallback ? ': raised codes are engraved on a stacking lid' : ''}) scans poorly: only shadows show its modules, so light it from the side. Inlaid in a second filament it reads at a glance.`,
      fix: { label: 'Make it inlaid (2 colours)', bin: { qrStyle: 'inlaid' } },
    });
  }
  if (spot.style === 'inlaid' && plan.surface === 'front') {
    const layers = Math.round((spot.modules * spot.module) / CHECK.layer);
    const move = elsewhere();
    out.push({
      rule: 'qr-swaps',
      severity: 'info',
      part,
      message: `An inlaid QR code on the front wall changes filament on every layer it spans (about ${layers} layers), which is slow and purges a lot. On a plate or a lid only its top ${Math.round(QR.depth / CHECK.layer)} layers do.`,
      ...(move ? { fix: move } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

/** Walls between pockets: the bin's grid, pocket compartments' and a pocket-grid lid's. */
function pocketWallCheck(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck | null {
  const grids: { spacing: number; own: boolean; lid?: boolean }[] = [];
  if (o.interior === 'pockets') grids.push({ spacing: o.pocketSpacing, own: false });
  if (o.interior === 'compartments' && o.layout?.comps) {
    for (const c of binLayout(o, cells).compartments) {
      const co = o.layout.comps[c.key];
      if (compartmentInside(co) !== 'pockets') continue;
      grids.push({ spacing: compartmentPocketOpts(o, co).pocketSpacing, own: co?.pockets?.pocketSpacing !== undefined });
    }
  }
  if (hasLid(o) && isPocketLid(o)) grids.push({ spacing: o.lidPockets?.pocketSpacing ?? o.pocketSpacing, own: false, lid: true });
  if (!grids.length) return null;
  const t = Math.min(...grids.map((g) => g.spacing));
  const bad = grids.filter((g) => g.spacing < 2 * x.nozzle - 1e-6);
  return wallCheck('pocket-walls', 'Pockets', 'The walls between pockets are', t, x, (v) => {
    // One click only when it's the bin's own setting (a compartment's own spacing is set in its compartment).
    if (bad.some((g) => g.own)) return undefined;
    const patch: Partial<BinOptions> = {};
    if (bad.some((g) => !g.lid)) patch.pocketSpacing = v;
    if (bad.some((g) => g.lid)) patch.lidPockets = { ...o.lidPockets, pocketSpacing: v };
    return { label: `Make them ${x.fmt(v)}`, bin: patch };
  });
}

/** Parts that aren't adjustable but are thin for a big nozzle: cup and tray walls, divider guide ribs. */
function fixedPartsCheck(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck | null {
  const { w: W, d: D } = binSize(o, cells);
  const acc = planAccessories(o, W, D);
  const parts: [string, number][] = [];
  if (planInserts(o, cells).cups.length) parts.push(['cup walls', CUP.wall]);
  if (acc.tray) parts.push(['tray walls', TRAY.wall]);
  if (acc.rails || removableInserts(o, cells).length) parts.push(['divider ribs', Math.min(RIB_THICKNESS, RAIL.rib)]);
  const thin = parts.filter(([, t]) => t < 2 * x.nozzle - 1e-6);
  if (!thin.length) return null;
  const list = thin.map(([n, t]) => `${n} (${x.fmt(t)})`).join(', ');
  return { rule: 'thin-parts', severity: 'info', part: 'Thin parts', message: `With a ${x.nz} these print as one line and come out weak: ${list}.` };
}

/**
 * Label tabs whose back is a removable divider: the divider prints separately,
 * so nothing is behind the tab. The geometry runs such a tab side wall to side
 * wall as a bridge, or leaves it off when a side isn't a plain fixed wall
 * (compartments.ts tabShape).
 */
function floatingTabCheck(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck | null {
  if (!o.layout?.walls.some((w) => w.removable) || o.interior !== 'compartments') return null;
  const r = binLayout(o, cells);
  const walls = new Set<string>();
  const keys = new Set<string>();
  for (const c of r.compartments) {
    const rc = c.isRect ? c.rects[0] : c.rects.filter((k) => k.open.back).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
    if (!rc || rc.y1 >= r.innerD - 1e-6) continue;
    const behind = r.walls.filter((w) => w.orient === 'h' && w.removable && Math.abs(w.pos - DIVIDER_T / 2 - rc.y1) < 1e-3 && w.start < rc.x1 && w.end > rc.x0);
    if (!behind.length) continue;
    behind.forEach((w) => walls.add(w.id));
    keys.add(c.key);
  }
  if (!walls.size) return null;
  let layout = o.layout;
  for (const id of walls) layout = setWallProps(layout, id, { removable: false });
  const fix = { label: walls.size > 1 ? 'Make those dividers fixed' : 'Make the divider fixed', bin: { layout } };
  const tabs = binLabelTabs(o, cells).filter((t) => keys.has(t.key));
  const lost = binLabelTabs({ ...o, layout }, cells).filter((t) => keys.has(t.key) && !tabs.some((k) => k.key === t.key)).length;
  if (lost) {
    return {
      rule: 'tab-floating',
      severity: 'warn',
      part: 'Label tab',
      message: `${lost > 1 ? `${lost} label tabs` : 'A label tab'} against a removable divider ${lost > 1 ? 'are' : 'is'} left off: a side wall is removable or lowered too, so nothing would hold ${lost > 1 ? 'them' : 'it'} while printing.`,
      fix,
    };
  }
  const span = Math.max(0, ...tabs.map((t) => t.x1 - t.x0));
  if (span <= CHECK.bridge) return null;
  return {
    rule: 'tab-floating',
    severity: 'info',
    part: 'Label tab',
    message: `A label tab against a removable divider has nothing behind it while it prints: it bridges ${x.fmt(span)} wall to wall and may sag.`,
    fix,
  };
}

/** Open compartments too narrow, for their depth, to reach into. */
function fingerCheck(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck | null {
  if (o.interior !== 'compartments') return null;
  const { w: W, d: D } = binSize(o, cells);
  const H = binBodyHeight(o);
  const top = accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H);
  const floor = binCutFloor(o, cells);
  const r = binLayout(o, cells);
  let worst: { w: number; depth: number } | null = null;
  let narrowX = false;
  let narrowY = false;
  for (const c of r.compartments) {
    const co = o.layout?.comps?.[c.key];
    if (compartmentInside(co) !== 'open' || compartmentWantsCup(o, co)) continue;
    const depth = top - floor - Math.max(0, co?.floor ?? 0);
    // The widest part of it a finger could go into.
    const best = c.rects.reduce((m, rc) => (Math.min(rc.x1 - rc.x0, rc.y1 - rc.y0) > Math.min(m.x1 - m.x0, m.y1 - m.y0) ? rc : m), c.rects[0]);
    const cw = best.x1 - best.x0;
    const cd = best.y1 - best.y0;
    const w = Math.min(cw, cd);
    if (w >= CHECK.finger - 1e-6 || depth < CHECK.fingerDepth * w) continue;
    if (cw < CHECK.finger) narrowX = true;
    if (cd < CHECK.finger) narrowY = true;
    if (!worst || w < worst.w) worst = { w, depth };
  }
  if (!worst) return null;
  let fix: CheckFix | undefined;
  if (!o.layout) {
    // A uniform grid: as many compartments as stay a finger wide.
    const most = (inner: number) => Math.max(1, Math.floor((inner + DIVIDER_T) / (CHECK.finger + DIVIDER_T) + 1e-9));
    const divX = narrowX ? Math.min(o.divX, most(r.innerW)) : o.divX;
    const divY = narrowY ? Math.min(o.divY, most(r.innerD)) : o.divY;
    if (divX !== o.divX || divY !== o.divY) fix = { label: `Use ${divX} × ${divY} compartments`, bin: { divX, divY } };
  }
  return {
    rule: 'finger-room',
    severity: 'info',
    part: 'Compartments',
    message: `Compartments ${x.fmt(Math.round(worst.w))} across and ${x.fmt(Math.round(worst.depth))} deep are too narrow to reach into, even with a scoop: you'll have to tip them out.`,
    ...(fix ? { fix } : {}),
  };
}

/** Tall on a small footprint: it may wobble, or be knocked over by the nozzle. */
function tipCheck(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck | null {
  const gap = GRID - BASE_TOP;
  const inset = o.base === 'flat' ? 0 : 2 * BASE_PROFILE_DEPTH;
  const foot = Math.min(sum(cells.x), sum(cells.y)) - gap - inset;
  const h = binTotalHeight(o);
  const k = h / foot;
  if (!(k > CHECK.tip)) return null;
  const size = `It's ${x.fmt(Math.round(h))} tall on a base ${x.fmt(Math.round(foot))} wide`;
  return k > CHECK.fall
    ? { rule: 'tip-over', severity: 'warn', part: 'Whole bin', message: `${size}, so it will likely tip over while printing. Add a brim in the slicer, or make it shorter.` }
    : { rule: 'tip-over', severity: 'info', part: 'Whole bin', message: `${size}, so it may wobble while printing. Add a brim in the slicer.` };
}

/** A stretched body overhangs the margin with nothing under it. */
function stretchCheck(cells: BinCells, x: Ctx): PrintCheck | null {
  const st = stretchOf(cells.stretch);
  const reach = Math.max(st.left, st.right, st.front, st.back) + (GRID - BASE_TOP) / 2;
  if (!(reach > CHECK.stretchSag)) return null;
  const out = `The stretched part reaches ${x.fmt(Math.round(reach))} out over the margin with nothing under it`;
  return reach > CHECK.stretchSupport
    ? { rule: 'stretch-overhang', severity: 'warn', part: 'Stretch', message: `${out}: it needs supports from the build plate.` }
    : { rule: 'stretch-overhang', severity: 'info', part: 'Stretch', message: `${out}, so its underside will sag. Supports from the build plate help.` };
}

/** Magnet holes with screw holes above them: the ring of ceiling around each screw hole prints over air. */
function holeCheck(o: BinOptions): PrintCheck | null {
  if (o.holes !== 'both' || o.base === 'flat' || o.holePrintable) return null;
  return {
    rule: 'hole-tops',
    severity: 'info',
    part: 'Holes',
    message: 'Each magnet hole has a screw hole above it, so the ring of ceiling between them prints over air and sags.',
    fix: { label: 'Turn on printable hole tops', bin: { holePrintable: true } },
  };
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The grid inside the bin (not on its lid) whose tips reach highest, or null. */
const insideTop = (grids: StandingGrid[]) => grids.filter((g) => g.where !== 'lid').reduce<StandingGrid | null>((a, g) => (!a || g.top > a.top ? g : a), null);

/**
 * The lowest bin height, from each wanted one up, that clears what stands in
 * it (`clears`, asked of the raised bin) and still fits the printers and the
 * room it has; or, when none does, why.
 */
function raiseFix(o: BinOptions, cells: BinCells, at: Place, wants: { u: number; under: string; clears: (next: BinOptions) => boolean }[]): { fix?: CheckFix; why: string } {
  let why = '';
  for (const want of wants) {
    for (let u = want.u; u <= MAX_HEIGHT_UNITS; u++) {
      const next = sanitizeBin({ ...o, heightMode: 'units', heightUnits: u });
      if (binBodyHeight(next) <= binBodyHeight(o) + 1e-6 || !want.clears(next)) continue;
      // Taller won't fit any better.
      if (at.bed && bedOvershoot(next, cells, at.bed) > 1e-6) {
        why ||= ` At ${u}u the bin is too tall for the printer.`;
        break;
      }
      if (standingBinHeight(next, cells) > (at.room ?? Infinity) + 1e-6) {
        why ||= ` At ${u}u the bin is too tall for the drawer.`;
        break;
      }
      return { fix: { label: `Make it ${u}u`, bin: { heightMode: 'units', heightUnits: u } }, why: ` ${u}u keeps them under ${want.under}.` };
    }
  }
  return { why: why || ` Bins go up to ${MAX_HEIGHT_UNITS}u.` };
}

/**
 * Items standing in pockets (rounds) that reach higher than where a lid or a
 * stacked bin sits, than the drawer, or than the rim; and on a pocket-grid
 * lid, higher than the drawer.
 */
function standingChecks(o: BinOptions, cells: BinCells, x: Ctx, at: Place): PrintCheck[] {
  const grids = standingGrids(o, cells);
  if (!grids.length) return [];
  const out: PrintCheck[] = [];
  const room = at.room ?? Infinity;
  const stand = (s: StandingGrid) => `${capital(s.noun)} stand ${x.fmt(s.itemH)} tall`;
  const s = insideTop(grids);
  if (s) {
    const { seat, rim } = tipLimits(o);
    const on = hasLid(o) && !hasStretch(cells.stretch) ? 'the lid' : at.stacked ? 'the bin stacked on it' : null;
    const what = `${stand(s)}, their tips ${x.fmt(s.top)} above the bin’s bottom`;
    const topIn = (b: BinOptions) => insideTop(standingGrids(b, cells))?.top ?? 0;
    const underSeat = {
      u: unitsToCover(s.top, o.lip),
      under: 'a lid or a bin stacked on top',
      clears: (b: BinOptions) => topIn(b) <= (tipLimits(b).seat ?? tipLimits(b).rim) + 1e-6,
    };
    const underRim = { u: unitsUnderRim(s.top, o.lip), under: 'the rim', clears: (b: BinOptions) => topIn(b) <= tipLimits(b).rim + 1e-6 };
    if (on && seat !== null && s.top > seat + 1e-6) {
      const r = raiseFix(o, cells, at, [underSeat]);
      out.push({
        rule: 'item-height',
        severity: 'warn',
        part: 'Pockets',
        message: `${what}: higher than ${on} sits (${x.fmt(seat)}), so it won’t sit down.${r.why}`,
        ...(r.fix ? { fix: r.fix } : {}),
      });
    } else if (!on && s.top > room + 1e-6) {
      out.push({ rule: 'item-height', severity: 'warn', part: 'Pockets', message: `${what}: more than the ${x.fmt(room)} of room above the bin, so the drawer won’t close.` });
    } else if (!on && s.top > rim + 1e-6) {
      const r = raiseFix(o, cells, at, o.lip ? [underSeat, underRim] : [underRim]);
      out.push({
        rule: 'item-height',
        severity: 'info',
        part: 'Pockets',
        message: `${capital(s.noun)} stick out ${x.fmt(s.top - rim)} above the rim: they stand ${x.fmt(s.itemH)} tall, their tips ${x.fmt(s.top)} above the bin’s bottom.${r.why}`,
        ...(r.fix ? { fix: r.fix } : {}),
      });
    }
  }
  const l = grids.find((g) => g.where === 'lid');
  if (l && l.top > room + 1e-6) {
    out.push({
      rule: 'item-height',
      severity: 'warn',
      part: 'Pocket-grid lid',
      message: `${stand(l)}: on the closed bin they reach ${x.fmt(l.top)}, more than the ${x.fmt(room)} of room above it, so the drawer won’t close.`,
    });
  }
  return out;
}

function plainBinChecks(o: BinOptions, cells: BinCells, x: Ctx, at: Place = {}): PrintCheck[] {
  const out: (PrintCheck | null)[] = [...labelChecks(o, cells, x), ...qrChecks(o, cells, x), pocketWallCheck(o, cells, x)];
  if (o.patternWalls) {
    out.push(wallCheck('hex-struts', 'Hex pattern', 'The struts between hex holes are', o.patternWeb, x, (v) => ({ label: `Make them ${x.fmt(v)}`, bin: { patternWeb: v } })));
    if (o.patternSize / 2 > CHECK.hexReach) {
      const v = 2 * CHECK.hexReach;
      out.push({
        rule: 'hex-holes',
        severity: 'info',
        part: 'Hex pattern',
        message: `Hex holes ${x.fmt(o.patternSize)} across have long sloped tops that sag; ${x.fmt(v)} or smaller prints clean.`,
        fix: { label: `Make them ${x.fmt(v)}`, bin: { patternSize: v } },
      });
    }
  }
  if (planInserts(o, cells).crates.length) {
    out.push(wallCheck('crate-walls', 'Grid inserts', 'The grid insert walls are', o.crateWall, x, (v) => ({ label: `Make them ${x.fmt(v)}`, bin: { crateWall: v } })));
  }
  out.push(fixedPartsCheck(o, cells, x), floatingTabCheck(o, cells, x), fingerCheck(o, cells, x), ...standingChecks(o, cells, x, at));
  const { w: W, d: D } = binSize(o, cells);
  const acc = planAccessories(o, W, D);
  if ((acc.rails || removableInserts(o, cells).length) && SLOT_CLEARANCE < CHECK.snug * x.nozzle) {
    out.push({
      rule: 'divider-fit',
      severity: 'info',
      part: 'Dividers',
      message: `Divider slots leave ${x.fmt(SLOT_CLEARANCE)} a side, tight for a ${x.nz}: the plates may need sanding to slide in.`,
    });
  }
  if (acc.slide && SLIDE.bump < x.nozzle) {
    out.push({
      rule: 'lid-detent',
      severity: 'info',
      part: 'Sliding lid',
      message: `The lid's ${x.fmt(SLIDE.bump)} click bump is finer than a ${x.nz} prints, so it may not click shut.`,
    });
  }
  return out.filter((c): c is PrintCheck => !!c);
}

function containerChecks(o: BinOptions, cells: BinCells, x: Ctx): PrintCheck[] {
  const c = activeContainer(o);
  if (!c) return [];
  const out: (PrintCheck | null)[] = [];
  const own = (patch: Record<string, unknown>): Partial<BinOptions> => ({
    containers: { ...o.containers, [c.def.kind]: { ...(c.opts as Record<string, unknown>), ...patch } },
  });
  if (c.def.kind === 'drawers') {
    const d = c.opts as DrawerUnitOptions;
    const need = CHECK.slide * x.nozzle;
    if (d.clearance < need - 1e-6) {
      const v = Math.min(DRAWER_UNIT.clearance.max, ceilStep(1.25 * need, 0.05));
      out.push({
        rule: 'drawer-gap',
        severity: 'warn',
        part: 'Drawers',
        message: `The drawers have ${x.fmt(d.clearance)} of play a side, too little for a ${x.nz}: they will stick.`,
        fix: { label: `Make it ${x.fmt(v)}`, bin: own({ clearance: r2(v) }) },
      });
    }
    out.push(wallCheck('drawer-walls', 'Drawers', 'The drawer walls are', d.drawerWall, x, (v) => ({ label: `Make them ${x.fmt(v)}`, bin: own({ drawerWall: Math.min(DRAWER_UNIT.drawerWall.max, v) }) })));
  }
  if (c.def.kind === 'dispenser') {
    const d = c.opts as DispenserOptions;
    if (d.style === 'magazine' && d.shape === 'coin') {
      const L = magazineLayout(o, d, cells);
      if (L.xs.length && L.colW > CHECK.bridge) {
        out.push({
          rule: 'coin-bridge',
          severity: 'info',
          part: 'Dispenser',
          message: `The flat roof of the slot under the stack bridges ${x.fmt(Math.round(L.colW))} and may sag.`,
        });
      }
    }
  }
  if (c.def.kind === 'box' && BOX.hinge.play < CHECK.snug * x.nozzle) {
    out.push({
      rule: 'hinge-fit',
      severity: 'info',
      part: 'Hinge',
      message: `The lid's hinge and latch have ${x.fmt(BOX.hinge.play)} of play, tight for a ${x.nz}: they may bind.`,
    });
  }
  return out.filter((k): k is PrintCheck => !!k);
}

/**
 * Checks for one bin (or container), with the cells it sits on (as for
 * buildBin). Label text that asks for `{contents}` must already be filled in
 * (binSpec does that; placedBinChecks takes a placed bin).
 */
export function binChecks(opts: BinOptions, cellsIn?: Partial<BinCells> | null, o?: CheckOptions): PrintCheck[] {
  const x = context(o);
  const b = sanitizeBin(opts);
  const cells = binCells(b, cellsIn);
  const out = activeContainer(b) ? containerChecks(b, cells, x) : plainBinChecks(b, cells, x, { room: o?.room, stacked: o?.stacked, bed: o?.bed });
  for (const c of [holeCheck(b), tipCheck(b, cells, x), stretchCheck(cells, x)]) if (c) out.push(c);
  return sortChecks(out);
}

/** Checks for a bin where it is placed (its cells, stretch and `{contents}` labels). Pass placeChecks' answer for its room, stack and beds. */
export function placedBinChecks(layout: GridLayout, b: PlacedBin, o?: CheckOptions): PrintCheck[] {
  if (b.external) return externalChecks(b, o);
  const spec = binSpec(layout, b);
  return binChecks(spec.opts, spec.cells, o);
}

/**
 * Where a drawer's bins stand, for their checks (CheckOptions `room`,
 * `stacked`, `bed`): the room above the baseplate (when the drawer's inside
 * height is set) less where each bin stands in its stack and what is stacked
 * on it, whether a bin stands on it, and the printers' beds.
 */
export function placeChecks(d: Pick<NamedDrawer, 'drawer' | 'baseplate' | 'bins'>, layout: GridLayout, setup: PrintSetup): (b: PlacedBin) => Place {
  const room = drawerRoom(d.drawer, d.baseplate);
  const bed = usableBeds(setup);
  let places: Map<string, StackPlace> | null = null;
  return (b) => {
    const col = columnOf(d.bins, b.id);
    const stacked = col.length > 1 && col.some((c) => c.id === b.id) && col[col.length - 1].id !== b.id;
    if (!Number.isFinite(room)) return { stacked, bed };
    places ??= stackPlaces(layout, d.bins);
    const me = places.get(b.id);
    if (!me) return { room, stacked, bed };
    // Raising this bin raises everything on it: it may stand the room less the rest of its column above it.
    const top = Math.max(...col.map((c) => places!.get(c.id)?.top ?? 0));
    return { room: room - top + (me.top - me.z), stacked, bed };
  };
}

/**
 * Bins from elsewhere (external.ts): only an imported mesh that prints has
 * anything to check. Gridfit didn't make it, so all it can tell is whether
 * it's a closed solid and whether it stands steady.
 */
function externalChecks(b: PlacedBin, o?: CheckOptions): PrintCheck[] {
  if (!printsMesh(b)) return [];
  const x = context(o);
  const m = b.external!.mesh!;
  const out: PrintCheck[] = [];
  if (!m.closed) {
    out.push({
      rule: 'mesh-open',
      severity: 'warn',
      part: 'Imported mesh',
      message: 'It isn’t a closed solid (it has holes or flipped faces). It still exports as it is, but the slicer may fill or drop parts of it: let the slicer repair it.',
    });
  }
  const s = meshSize(m);
  const foot = Math.min(s.w, s.d);
  const k = s.h / Math.max(1, foot);
  if (k > CHECK.tip) {
    const fall = k > CHECK.fall;
    out.push({
      rule: 'tip-over',
      severity: fall ? 'warn' : 'info',
      part: 'Imported mesh',
      message: `It's ${x.fmt(Math.round(s.h))} tall on a base ${x.fmt(Math.round(foot))} wide, so it ${fall ? 'will likely tip over' : 'may wobble'} while printing. Add a brim in the slicer.`,
    });
  }
  return sortChecks(out);
}

// ---------------------------------------------------------------------------
// Baseplates, cases, wall grids, spacer strips
// ---------------------------------------------------------------------------

/** Checks for a drawer's baseplate and what it's part of (carry case, wall grid, spacer strips). */
export function drawerChecks(drawer: DrawerInput, bp: BaseplateOptions, o?: CheckOptions): PrintCheck[] {
  const x = context(o);
  const out: PrintCheck[] = [];
  // Trimming t off the knife edge where two receptacles meet leaves a flat 2t wide.
  if (2 * bp.topTrim < x.nozzle - 1e-6) {
    const v = r2(Math.max(DEFAULT_BASEPLATE.topTrim, ceilStep(x.nozzle / 2, 0.05)));
    out.push({
      rule: 'ridge-trim',
      severity: 'info',
      part: 'Baseplate',
      message: `The ridges between cells are trimmed only ${x.fmt(bp.topTrim)}, so their tops are thinner than a line and print ragged.`,
      fix: { label: `Trim them ${x.fmt(v)}`, baseplate: { topTrim: v } },
    });
  }
  const joints: [string, number][] = [];
  if (bp.connector === 'bowtie') joints.push(['bowtie keys', BOWTIE_CLEARANCE]);
  if (bp.connector === 'puzzle') joints.push(['puzzle tabs', PUZZLE.gap]);
  if (spacerMargins(drawer)) joints.push(['spacer dovetails', SPACER.jointGap]);
  const tight = joints.filter(([, gap]) => gap < CHECK.snug * x.nozzle);
  if (tight.length) {
    const names = tight.map(([n]) => n).join(' and ');
    out.push({
      rule: 'joint-fit',
      severity: 'info',
      part: 'Joints',
      message: `${names[0].toUpperCase()}${names.slice(1)} leave ${x.fmt(Math.min(...tight.map(([, g]) => g)))} a side, tight for a ${x.nz}: sand them if they won't go together.`,
    });
  }
  if (drawer.enclosure === 'case' && hasFont()) {
    const c = sanitizeCase(drawer.carryCase);
    if (c.label.trim()) {
      const g = caseFrame(computeLayout(drawer), c, bp, 0).geom;
      const margin = g.R + 6;
      const cap = textOutline(c.label.trim(), { size: c.labelSize, maxWidth: g.W - 2 * margin, maxHeight: g.D - 2 * margin }).size;
      const bigger = (bad: TextSpot[], rule: CheckRule): CheckFix | undefined => {
        const v = Math.min(40, ceilStep(x.nozzle / CHECK.strokeShare, 1));
        return rule === 'label-thin' && bad[0].cap >= c.labelSize - 1e-6 && v > c.labelSize
          ? { label: `Make it ${x.fmt(v)}`, drawer: { carryCase: { ...drawer.carryCase, labelSize: v } } }
          : undefined;
      };
      out.push(...textChecks([{ text: c.label, cap, style: 'engraved' }], { part: 'Carry case', noun: 'label', on: ['on the lid', 'on the lid'], fix: bigger }, x));
    }
  }
  return sortChecks(out);
}

// ---------------------------------------------------------------------------
// The printer, and everything being printed
// ---------------------------------------------------------------------------

/** Checks about the printer itself: what a big nozzle does to every bin, a Bambu project set up for another nozzle. */
export function setupChecks(setup: PrintSetup, what: { bins: boolean }, o?: CheckOptions): PrintCheck[] {
  const x = context({ ...o, nozzle: o?.nozzle ?? nozzleOf(setup) });
  const out: PrintCheck[] = [];
  if (what.bins && WALL < 2 * x.nozzle - 1e-6) {
    out.push({
      rule: 'nozzle-walls',
      severity: 'info',
      part: 'Bins',
      message: `Gridfinity bin walls are ${x.fmt(WALL)}, so a ${x.nz} prints them as one line: they come out weaker.`,
    });
  }
  if (findPrinter(setup.printerId).bambu && x.nozzle !== DEFAULT_NOZZLE) {
    out.push({
      rule: 'bambu-nozzle',
      severity: 'info',
      part: 'Bambu project',
      message: `The Bambu Studio project is set up for the ${DEFAULT_NOZZLE} mm nozzle: pick your ${x.nz} there before slicing.`,
    });
  }
  return out;
}

/** A check found in a project: which drawer, and which bin (none for the baseplate or the printer). */
export interface FoundCheck extends PrintCheck {
  drawerId?: string;
  binId?: string;
}

/** Every check for what is being printed: the setup, then each drawer's baseplate and bins. */
export function projectChecks(drawers: NamedDrawer[], setup: PrintSetup, include: ProjectState['include'], o?: CheckOptions): FoundCheck[] {
  const opts = { ...o, nozzle: o?.nozzle ?? nozzleOf(setup) };
  // Gridfit's own bins: bins from elsewhere (external.ts) aren't its walls.
  const out: FoundCheck[] = [...setupChecks(setup, { bins: include.bins && drawers.some((d) => d.bins.some((b) => !b.external)) }, opts)];
  for (const d of drawers) {
    // Not for a baseplate that's there already ("Just bins"): it isn't printed.
    if (printsBaseplate(d, include)) out.push(...drawerChecks(d.drawer, d.baseplate, opts).map((c) => ({ ...c, drawerId: d.id })));
    if (!include.bins) continue;
    const layout = computeLayout(d.drawer);
    const at = placeChecks(d, layout, setup);
    for (const b of d.bins) out.push(...placedBinChecks(layout, b, { ...opts, ...at(b) }).map((c) => ({ ...c, drawerId: d.id, binId: b.id })));
  }
  return out;
}

/** The worst severity among checks, or null when there are none. */
export function worstSeverity(checks: readonly PrintCheck[]): CheckSeverity | null {
  return checks.some((c) => c.severity === 'warn') ? 'warn' : checks.length ? 'info' : null;
}

/** Warnings first, keeping the order they were found in. */
function sortChecks<C extends PrintCheck>(checks: C[]): C[] {
  return [...checks.filter((c) => c.severity === 'warn'), ...checks.filter((c) => c.severity !== 'warn')];
}
