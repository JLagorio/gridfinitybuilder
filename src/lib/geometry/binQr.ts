/**
 * A bin's QR code, whatever it's on (qrCode.ts has the code itself, qrFront.ts
 * the front wall, lid.ts the stacking lid, accessories.ts the sliding lid):
 *
 * - what it says when it lists the contents: the bin's label, then each item
 *   of What's in it (the bin's own, each compartment's in reading order, tool
 *   names), one per line, repeats left out. Contents live on the placed bin,
 *   not in its options, so planning (project.ts binSpec / lidSpec) fills the
 *   text in a copy of the options (`qrData`), like `{contents}` labels;
 * - where it goes and how big it comes out (`binQrPlan`), for the panel and
 *   the print checks;
 * - the stick-on plate (`binQrPlate`): as large as the bin's front face, and
 *   at least large enough for QR.autoModule modules (unless a size is asked for).
 */
import { binCells, binFrontQr, binLayout, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from './bin';
import { hasLid, planLidQr } from './lid';
import { isPocketLid } from './pocketLid';
import { planSlideLidQr } from './accessories';
import { activeContainer } from './containers/registry';
import { labelCaptionText, type ContentsSource } from './labelContents';
import { labelLines } from './labels';
import { labelPlainText } from './labelIcons';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS } from './spec';
import { QR, qrPayload, qrPlatePart, type QrError, type QrPlatePart, type QrSpot, type QrSurface } from './qrCode';
import { QR_QUIET, qrFit, type QrFit } from '../qr';

/** Items of contents text: trimmed, non-blank lines, list bullets dropped (as inventory.ts reads them). */
function items(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•·–]\s+/, '').trim())
    .filter(Boolean);
}

/** What a code that lists the contents says: the label, then the items, one per line. '' = nothing to say. */
export function qrContentsText(b: { opts: BinOptions } & ContentsSource, cells?: Partial<BinCells> | null): string {
  const o = b.opts;
  const label = labelPlainText(labelLines(labelCaptionText(b)))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' / ');
  const list = items(b.contents);
  const own = b.compContents ?? {};
  const used = new Set<string>();
  if (o.interior === 'compartments' && Object.keys(own).length) {
    // Back to front, left to right: the order the drawer map reads in.
    const comps = [...binLayout(o, cells).compartments].sort((p, q) => q.bounds.y1 - p.bounds.y1 || p.bounds.x0 - q.bounds.x0);
    for (const c of comps) {
      used.add(c.key);
      list.push(...items(own[c.key]));
    }
  }
  for (const [k, t] of Object.entries(own)) if (!used.has(k)) list.push(...items(t));
  if (o.interior === 'cutouts') list.push(...(o.cutouts ?? []).map((c) => c.name.trim()).filter(Boolean));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const l of label ? [label, ...list] : list) {
    const k = l.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(l);
  }
  return lines.join('\n');
}

/** The bin's options with the contents text its QR code holds filled in (the same object when it has no code that lists them). */
export function resolveQrText(opts: BinOptions, src: ContentsSource, cells?: Partial<BinCells> | null): BinOptions {
  if (!opts.qr || opts.qr === 'none' || opts.qrContent === 'custom') return opts;
  return { ...opts, qrData: qrContentsText({ ...src, opts }, cells) };
}

/** Where a bin's code is, in words. */
export type QrWhere = 'front wall' | 'stacking lid' | 'sliding lid' | 'plate' | 'lid';

export interface BinQrPlan {
  surface: Exclude<QrSurface, 'none'>;
  where: QrWhere;
  /** The text it holds. */
  text: string;
  spot: QrSpot | null;
  error?: QrError;
  /** The smallest version that holds the text (null: nothing to say, or too long for any). */
  fit: QrFit | null;
  /** Side of the largest square the surface has for the code, mm (a plate: its side). */
  room: number;
  /** A plate: whether its size is the bin's front face (or larger, so its modules read well). */
  plate?: { auto: boolean; face: number };
}

/** Side of the square a stick-on plate can have on the bin's front face, mm. */
function frontFaceSquare(o: BinOptions, cells?: Partial<BinCells> | null): number {
  const { w: W } = binSize(o, cells);
  const h = binTotalHeight(o) - (o.base === 'flat' ? 0 : BASE_PROFILE_HEIGHT);
  return Math.max(0, Math.min(W - 2 * BASE_TOP_RADIUS, h) - 2 * QR.margin);
}

/**
 * The stick-on plate for a bin's code (`qr: 'plate'`), or why there isn't
 * one. Its side is `qrSize`, or the bin's front face, made larger when the
 * face is too small for QR.autoModule modules (up to QR.maxPlate).
 */
export function binQrPlate(opts: BinOptions, cells?: Partial<BinCells> | null): { part: QrPlatePart | null; error?: QrError; fit: QrFit | null; side: number; face: number } | null {
  const o = sanitizeBin(opts);
  if (o.qr !== 'plate' || activeContainer(o)) return null;
  const face = frontFaceSquare(o, cells);
  const text = qrPayload(o);
  const fit = text ? qrFit(text, o.qrEcc) : null;
  const need = fit ? (fit.size + 2 * QR_QUIET) * QR.autoModule : 0;
  const side = o.qrSize > 0 ? o.qrSize : Math.min(QR.maxPlate, Math.max(QR.minPlate, face, Math.ceil(need)));
  return { ...qrPlatePart(o, side), side, face };
}

/** Where the bin's code goes and how it comes out, or null when it has none (or is a container). */
export function binQrPlan(opts: BinOptions, cellsIn?: Partial<BinCells> | null): BinQrPlan | null {
  const o = sanitizeBin(opts);
  if (o.qr === 'none' || activeContainer(o)) return null;
  const text = qrPayload(o);
  const cells = binCells(o, cellsIn);
  if (o.qr === 'front') {
    const p = binFrontQr(o, cells)!;
    return { surface: 'front', where: 'front wall', text, spot: p.spot, error: p.error, fit: p.fit, room: p.room };
  }
  if (o.qr === 'plate') {
    const p = binQrPlate(o, cells)!;
    return { surface: 'plate', where: 'plate', text, spot: p.part?.spot ?? null, error: p.error, fit: p.fit, room: p.side, plate: { auto: !(o.qrSize > 0), face: p.face } };
  }
  if (hasLid(o) && !isPocketLid(o)) {
    const p = planLidQr(o, cells)!;
    return { surface: 'lid', where: 'stacking lid', text, spot: p.spot, error: p.error, fit: p.fit, room: p.room };
  }
  const { w: W, d: D } = binSize(o, cells);
  const slide = planSlideLidQr(o, W, D);
  if (slide) return { surface: 'lid', where: 'sliding lid', text, spot: slide.spot, error: slide.error, fit: slide.fit, room: slide.room };
  return { surface: 'lid', where: 'lid', text, spot: null, error: 'no-surface', fit: text ? qrFit(text, o.qrEcc) : null, room: 0 };
}

/** True when the bin's code is planned but not printed (nothing to say, too long, no room, no lid). */
export const qrLeftOff = (p: BinQrPlan | null) => !!p && !p.spot;
