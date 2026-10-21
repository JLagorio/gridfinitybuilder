/**
 * QR codes on bins: a code a phone camera reads to say what's in the bin.
 *
 * - What it says (`qrContent`): the bin's label and its "What's in it" list as
 *   plain text (filled in at planning, binQr.ts `resolveQrText`, so it reads
 *   offline on any phone), or custom text / a URL (`qrText`).
 * - Where (`qr`): the outside of the front wall (qrFront.ts), the lid (a
 *   stacking lid's receptacle floor, or a sliding lid's top), or a square
 *   plate that prints flat with the bins and sticks on. Each is sized from the
 *   room the surface has; the code is centered in it with its 4-module quiet
 *   zone.
 * - How (`qrStyle`): inlaid (cut in and filled flush in filament 2, like
 *   inlaid label text: the best contrast), raised or engraved (one filament:
 *   only shadows make the modules, so it reads poorly unless lit from the side).
 * - Error correction L / M / Q / H (`qrEcc`, M by default) and the smallest
 *   version that holds the text; modules as large as the room allows (or the
 *   size asked for, `qrSize`), but never under QR.minModule (two lines of a
 *   0.2 mm nozzle). The print checks hold them to two lines of the setup's
 *   nozzle.
 *
 * The dark modules are merged into rectangles (runs along each row, joined
 * down the rows) and extruded once from a single cross-section, so a code is
 * one small solid and one boolean (qrSolid.ts).
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import type { Manifold } from './kernel';
import { QR_ECCS, QR_QUIET, qrFit, type QrEcc, type QrFit } from '../qr';

export type QrSurface = 'none' | 'front' | 'lid' | 'plate';
export const QR_SURFACES: readonly QrSurface[] = ['none', 'front', 'lid', 'plate'];
export type QrStyle = 'inlaid' | 'raised' | 'engraved';
export const QR_STYLES: readonly QrStyle[] = ['inlaid', 'raised', 'engraved'];
export type QrContent = 'contents' | 'custom';
export type { QrEcc };

export interface BinQrOptions {
  /** Where the code goes ('none': no code). */
  qr: QrSurface;
  /** What it says: the bin's label and contents, or `qrText`. */
  qrContent: QrContent;
  /** Custom text or URL. */
  qrText: string;
  qrStyle: QrStyle;
  qrEcc: QrEcc;
  /** Side of the code with its quiet zone, mm; 0 = as large as the surface allows (a plate: as large as reads well). */
  qrSize: number;
  /**
   * The contents text, filled in at planning from What's in it (binQr.ts
   * resolveQrText), when the code lists the contents. Never saved; in the mesh key.
   */
  qrData?: string;
}

export const DEFAULT_QR: BinQrOptions = {
  qr: 'none',
  qrContent: 'contents',
  qrText: '',
  qrStyle: 'inlaid',
  qrEcc: 'M',
  qrSize: 0,
};

export const QR = {
  /** Smallest module built at all: two lines of a 0.2 mm nozzle. */
  minModule: 0.4,
  /** Engrave / inlay depth and raise height (three layers). */
  depth: 0.6,
  raise: 0.6,
  /** Dark modules grow this much a side, so modules that meet only at a corner join instead of touching at an edge. */
  overlap: 0.01,
  /** Space between the quiet zone and the edge of the surface. */
  margin: 0.5,
  /** Plates: thickness (raised: the base under the modules), corner radius, elephant-foot chamfer. */
  plateThickness: 1.6,
  plateBase: 1.2,
  plateRadius: 1,
  plateChamfer: 0.3,
  /** An automatic plate is at least as large as the bin's front face, with modules at least this big. */
  autoModule: 1,
  minPlate: 12,
  maxPlate: 80,
  /** Largest size asked for, and the longest custom text. */
  maxSize: 150,
  maxText: 1000,
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Custom text from user input: no control characters but new lines, trimmed, at most QR.maxText characters. */
export function sanitizeQrText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  return [...t].slice(0, QR.maxText).join('');
}

export function sanitizeQrOptions(o: Partial<BinQrOptions>): BinQrOptions {
  const size = Number(o.qrSize);
  const out: BinQrOptions = {
    qr: QR_SURFACES.includes(o.qr as QrSurface) ? (o.qr as QrSurface) : DEFAULT_QR.qr,
    qrContent: o.qrContent === 'custom' ? 'custom' : 'contents',
    qrText: sanitizeQrText(o.qrText),
    qrStyle: QR_STYLES.includes(o.qrStyle as QrStyle) ? (o.qrStyle as QrStyle) : DEFAULT_QR.qrStyle,
    qrEcc: QR_ECCS.includes(o.qrEcc as QrEcc) ? (o.qrEcc as QrEcc) : DEFAULT_QR.qrEcc,
    qrSize: Number.isFinite(size) && size > 0 ? Math.round(Math.min(QR.maxSize, Math.max(5, size)) * 10) / 10 : 0,
  };
  // Only planning sets this, on a copy of the options.
  if (typeof o.qrData === 'string') out.qrData = sanitizeQrText(o.qrData.slice(0, 4000));
  return out;
}

/** The text the code holds ('' = nothing to encode). */
export function qrPayload(o: Pick<BinQrOptions, 'qrContent' | 'qrText' | 'qrData'>): string {
  return (o.qrContent === 'custom' ? o.qrText : (o.qrData ?? '')).trim();
}

/** Mesh-key parts of the bin's code, for the part it is on (`on`); empty otherwise, so other bins' keys don't change. */
export function qrKeyParts(o: Partial<BinQrOptions>, on: Exclude<QrSurface, 'none'>): string[] {
  if (o.qr !== on) return [];
  const q = { ...DEFAULT_QR, ...o };
  return [`Q${JSON.stringify([q.qr, qrPayload(q), q.qrStyle, q.qrEcc, q.qrSize])}`];
}

/** True when the style puts the code on filament 2. */
export const qrInlaid = (o: Partial<Pick<BinQrOptions, 'qrStyle'>>) => (o.qrStyle ?? DEFAULT_QR.qrStyle) === 'inlaid';

// ---------------------------------------------------------------------------
// Sizing (pure)
// ---------------------------------------------------------------------------

export type QrError = 'empty' | 'too-long' | 'no-room' | 'no-surface';

/** A code laid out on a surface. */
export interface QrSpot {
  /** The text it holds. */
  text: string;
  ecc: QrEcc;
  version: number;
  /** Modules per side, without the quiet zone. */
  modules: number;
  /** Module size, mm. */
  module: number;
  /** Center of the code, in the surface's own 2D frame (row 0 of the code toward +y). */
  cx: number;
  cy: number;
  /** Effective style, and its raise height or engrave depth. */
  style: QrStyle;
  relief: number;
}

/** Side of the code with its quiet zone, mm. */
export const qrSide = (s: Pick<QrSpot, 'modules' | 'module'>) => (s.modules + 2 * QR_QUIET) * s.module;

export interface QrSizing {
  fit: QrFit;
  module: number;
  /** Side with the quiet zone, mm. */
  side: number;
}

const floor2 = (v: number) => Math.floor(v * 100 + 1e-6) / 100;

/**
 * Size a code for a square `room` mm across: `want` mm (0 = all of it; never
 * more than the room), the smallest version that holds the text, modules
 * rounded down to 0.01 mm. An error when there's nothing to say, the text
 * doesn't fit (version 40, or modules under `minModule`), or the room is too
 * small for even a version 1 code.
 */
export function sizeQr(text: string, ecc: QrEcc, room: number, want = 0, minModule: number = QR.minModule): QrSizing | { error: QrError; fit: QrFit | null } {
  if (!text) return { error: 'empty', fit: null };
  const fit = qrFit(text, ecc);
  if (!fit) return { error: 'too-long', fit: null };
  const side = want > 0 ? Math.min(want, room) : room;
  const module = floor2(side / (fit.size + 2 * QR_QUIET));
  if (!(module >= minModule - 1e-9)) {
    const v1 = (21 + 2 * QR_QUIET) * minModule;
    return { error: room + 1e-9 < v1 ? 'no-room' : 'too-long', fit };
  }
  return { fit, module, side: (fit.size + 2 * QR_QUIET) * module };
}

/** A code for the bin's options in a square room centered at (cx, cy); style `style` (default the bin's). */
export function qrSpotIn(
  o: BinQrOptions,
  room: number,
  cx: number,
  cy: number,
  style: QrStyle = o.qrStyle,
): { spot: QrSpot | null; error?: QrError; fit: QrFit | null; room: number } {
  const text = qrPayload(o);
  const s = sizeQr(text, o.qrEcc, room, o.qrSize);
  if ('error' in s) return { spot: null, error: s.error, fit: s.fit, room };
  return {
    spot: { text, ecc: o.qrEcc, version: s.fit.version, modules: s.fit.size, module: s.module, cx, cy, style, relief: style === 'raised' ? QR.raise : QR.depth },
    fit: s.fit,
    room,
  };
}

/** Mesh-key text of a spot. */
export const qrSpotKey = (s: QrSpot) => JSON.stringify([s.text, s.ecc, s.version, s.module, r3(s.cx), r3(s.cy), s.style, s.relief]);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Geometry (qrSolid.ts)
// ---------------------------------------------------------------------------

/** What a code adds to, cuts from and inlays into a part. */
export interface QrParts {
  cut: Manifold[];
  add: Manifold[];
  inlay: Manifold[];
}

export const emptyQrParts = (): QrParts => ({ cut: [], add: [], inlay: [] });

// ---------------------------------------------------------------------------
// Stick-on plates
// ---------------------------------------------------------------------------

/** A square plate carrying the code, printed flat; it sticks on the bin's front (or a lid, a drawer front). */
export interface QrPlatePart {
  /** Side and overall thickness of the plate body (raised modules stand on top). */
  side: number;
  thickness: number;
  /** The code, centered on the plate (plate coordinates, min corner at the origin). */
  spot: QrSpot;
}

export const qrPlateKey = (p: QrPlatePart) => `qrplate|${JSON.stringify([r3(p.side), p.thickness])}|${qrSpotKey(p.spot)}`;

/** Height of a plate including raised modules. */
export const qrPlateHeight = (p: QrPlatePart) => p.thickness + (p.spot.style === 'raised' ? p.spot.relief : 0);

/** The plate for a code of this sizing: the code and its quiet zone fill it. */
export function qrPlatePart(o: BinQrOptions, side: number): { part: QrPlatePart | null; error?: QrError; fit: QrFit | null } {
  const r = qrSpotIn(o, side, side / 2, side / 2);
  if (!r.spot) return { part: null, error: r.error, fit: r.fit };
  const s = qrSide(r.spot);
  const spot = { ...r.spot, cx: s / 2, cy: s / 2 };
  return { part: { side: r3(s), thickness: spot.style === 'raised' ? QR.plateBase : QR.plateThickness, spot }, fit: r.fit };
}
