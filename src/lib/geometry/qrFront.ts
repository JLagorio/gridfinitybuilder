/**
 * QR codes on the outside of a bin's front wall (the code itself is in
 * qrCode.ts). It reads upright from the front.
 *
 * - Room: the flat part of the front face (clear of the rounded corners),
 *   from just above the feet (or the stretch overhang) to just under the
 *   body's top, so it stays clear of the stacking lip; a sliding lid's front
 *   opening keeps it lower. A cutout in the front wall pushes it below the
 *   cutout or beside it, whichever leaves the larger square. The code with its
 *   quiet zone is the largest square that fits (or the size asked for).
 * - With a front label too, the code takes the right-hand end of the face and
 *   the label's text keeps to the left of it (frontLabel.ts); otherwise the
 *   code is centered.
 * - Engraved and inlaid codes get the 0.95 mm wall thickened behind them to
 *   QR_FRONT.wall on the inside (45° underside, so it prints without support),
 *   except over removable-divider slots, as front labels do. A hex wall
 *   pattern leaves the code's area solid (walls.ts `keepOut`). The geometry
 *   is in qrSolid.ts.
 *
 * Must not import bin.ts or frontLabel.ts at runtime (they import this module).
 */
import { BASE_TOP_RADIUS } from './spec';
import { binBodyHeight, binFloorZ, lipRise } from './variants';
import { cutoutSize } from './walls';
import { planAccessories } from './accessories';
import { QR, qrSide, qrSpotIn, sanitizeQrOptions, type QrError, type QrSpot } from './qrCode';
import type { QrFit } from '../qr';
import type { BinOptions } from './bin';

export const QR_FRONT = {
  /** Engraved / inlaid: the wall is this thick (from the outside) behind the code. */
  wall: 1.75,
  /** From a wall cutout, and between the code and a front label's text. */
  gap: 1.5,
} as const;

/** A rectangle on the front face: x along the bin's X, z heights (bin coordinates). */
export interface FaceBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface FrontQrPlan {
  spot: QrSpot | null;
  error?: QrError;
  fit: QrFit | null;
  /** Side of the largest square the face has room for, mm. */
  room: number;
  /** Where the code and its quiet zone go (when it fits). */
  box: FaceBox | null;
}

/** The flat face rectangles a code may use (one, or the sides of / under a front cutout). */
function faceRects(o: BinOptions, W: number, D: number, zBottom: number): FaceBox[] {
  const m = QR.margin;
  const H = binBodyHeight(o);
  let z1 = H - m;
  const acc = planAccessories(o, W, D);
  if (acc.slide) z1 = Math.min(z1, acc.slide.zG - m);
  const z0 = zBottom + m;
  const xe = W / 2 - BASE_TOP_RADIUS - m;
  if (z1 <= z0 || xe <= 0) return [];
  if (!o.cutoutWalls?.includes('f')) return [{ x0: -xe, x1: xe, z0, z1 }];
  const top = H + lipRise(o);
  const c = cutoutSize(o, W, top, binFloorZ(o) + 1);
  if (!(c.width >= 4 && top - c.bottom >= 1 && c.bottom < z1)) return [{ x0: -xe, x1: xe, z0, z1 }];
  const g = QR_FRONT.gap;
  return [
    { x0: -xe, x1: xe, z0, z1: Math.min(z1, c.bottom - g) },
    { x0: -xe, x1: -c.width / 2 - g, z0, z1 },
    { x0: c.width / 2 + g, x1: xe, z0, z1 },
  ].filter((r) => r.x1 > r.x0 && r.z1 > r.z0);
}

const side = (r: FaceBox) => Math.min(r.x1 - r.x0, r.z1 - r.z0);

/**
 * Where the bin's code goes on its front wall, or null when it goes elsewhere.
 * `zBottom` is where the front face starts (the top of the feet, the stretch
 * overhang's underside, or 0 for flat bins).
 */
export function planFrontQr(opts: BinOptions, W: number, D: number, zBottom: number): FrontQrPlan | null {
  if (opts.qr !== 'front') return null;
  const o = { ...opts, ...sanitizeQrOptions(opts) };
  const rects = faceRects(opts, W, D, zBottom);
  const best = rects.reduce<FaceBox | null>((b, r) => (!b || side(r) > side(b) ? r : b), null);
  if (!best) return { spot: null, error: 'no-room', fit: null, room: 0, box: null };
  const room = side(best);
  // With a front label too, the code keeps to the right-hand end.
  const right = opts.frontLabel && opts.frontLabel !== 'none';
  const r = qrSpotIn(o, room, 0, (best.z0 + best.z1) / 2);
  if (!r.spot) return { spot: null, error: r.error, fit: r.fit, room, box: null };
  const s = qrSide(r.spot);
  const cx = right ? best.x1 - s / 2 : (best.x0 + best.x1) / 2;
  const spot = { ...r.spot, cx };
  return { spot, fit: r.fit, room, box: { x0: cx - s / 2, x1: cx + s / 2, z0: spot.cy - s / 2, z1: spot.cy + s / 2 } };
}

/** The area a front label's text must keep out of (the code and its quiet zone, plus the gap), or null. */
export function frontQrReserve(o: BinOptions, W: number, D: number, zBottom: number): FaceBox | null {
  const b = planFrontQr(o, W, D, zBottom)?.box;
  if (!b) return null;
  const g = QR_FRONT.gap;
  return { x0: b.x0 - g, x1: b.x1 + g, z0: b.z0 - g, z1: b.z1 + g };
}
