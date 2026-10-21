/**
 * Stacking lid for a bin: a plate that sits in the bin's stacking lip on
 * Gridfinity feet (one per cell, like a bin) and has a lip-style receptacle
 * per cell on top, so another bin stacks on the lid exactly as it would on a
 * bin. After Gridfinity Extended's baseplate lid. Prints feet down, like a bin.
 *
 * A QR code (qrCode.ts, `qr: 'lid'`) goes on the floor of one receptacle: the
 * largest, nearest the middle of the front row. A bin stacked on the lid
 * stands on that floor, so a raised code is engraved instead.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { BASE_PROFILE, BASE_PROFILE_DEPTH, BASE_PROFILE_HEIGHT, BASE_TOP, BASE_TOP_RADIUS, GRID, LIP_HEIGHT, LIP_PROFILE, LIP_TOP_FLAT, LIP_DEPTH } from './spec';
import { extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import { binCells, binSize, type BinCells, type BinOptions } from './bin';
import { binBodyHeight, cellRects } from './variants';
import { buildPocketLid, isPocketLid, pocketLidHeight, pocketLidKeyPart } from './pocketLid';
import { QR, emptyQrParts, qrKeyParts, qrSpotIn, sanitizeQrOptions, type QrError, type QrSpot } from './qrCode';
import { applyQrParts, qrInto, withQrInlay } from './qrSolid';
import type { QrFit } from '../qr';

/** Solid plate between the top of the feet and the bottom of the receptacles. */
export const LID_PLATE = 1.25;
/** Bottom of the receptacles on top of the lid. */
export const LID_FLOOR = BASE_PROFILE_HEIGHT + LID_PLATE;
/** Overall lid height. */
export const LID_HEIGHT = LID_FLOOR + LIP_HEIGHT - LIP_TOP_FLAT;
/**
 * A foot seated in a stacking lip sits this far below where the lip starts:
 * the 45° faces of the foot (2.15 mm) and the lip (1.9 mm) meet 0.35 mm lower.
 */
export const LID_SEAT_DROP = BASE_PROFILE_HEIGHT - LIP_HEIGHT;

/** The footprint, and (for a pocket-grid lid, pocketLid.ts) the lid style and pocket fields. */
type LidOpts = Pick<BinOptions, 'unitsX' | 'unitsY'> & Partial<BinOptions>;

/** Overall height of the bin's lid: the stacking lid's, or a pocket-grid lid's. */
export function lidHeight(o: Partial<BinOptions>): number {
  return isPocketLid(o) ? pocketLidHeight({ unitsX: 1, unitsY: 1, ...o }) : LID_HEIGHT;
}

/** A lid is printed for a bin that asks for one and has a lip to hold it. */
export function hasLid(o: Pick<BinOptions, 'lid' | 'lip'>): boolean {
  return !!o.lid && !!o.lip;
}

/** Height of a bin with its lid on (the lid seats in the lip), from the bin's bottom. */
export function lidStackHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>): number {
  return binBodyHeight(o) - LID_SEAT_DROP + lidHeight(o);
}

export function lidSize(o: LidOpts, cells?: Partial<BinCells> | null) {
  const { w, d } = binSize(o, cells);
  return { w, d, h: lidHeight(o) };
}

/** Stable key: stacking lids only depend on the footprint (and a QR code on them); pocket-grid lids also on their pockets. */
export function lidKey(o: LidOpts, cells?: Partial<BinCells> | null): string {
  const c = binCells(o, cells);
  const qr = isPocketLid(o) ? [] : qrKeyParts(o, 'lid');
  return `${c.x.join('/')}x${c.y.join('/')}${isPocketLid(o) ? `|${pocketLidKeyPart(o)}` : ''}${qr.length ? `|${qr.join('-')}` : ''}`;
}

export interface LidQrPlan {
  spot: QrSpot | null;
  error?: QrError;
  fit: QrFit | null;
  /** Side of the receptacle floor the code may use, mm. */
  room: number;
}

/**
 * Where the bin's QR code goes on its stacking lid (lid-centered, like the
 * lid's mesh before it is moved to its corner), or null when it goes
 * elsewhere or the bin has no stacking lid.
 */
export function planLidQr(o: LidOpts, cellsIn?: Partial<BinCells> | null): LidQrPlan | null {
  if (o.qr !== 'lid' || !hasLid({ lid: o.lid ?? false, lip: o.lip ?? true }) || isPocketLid(o)) return null;
  const q = sanitizeQrOptions(o);
  const cells = binCells(o, cellsIn);
  const gap = GRID - BASE_TOP;
  // The receptacle floor: the cell less the lip's depth all round.
  const floors = cellRects(cells).map((c) => ({ c, room: Math.min(c.cw, c.cd) - gap - 2 * LIP_DEPTH - 2 * QR.margin }));
  const best = floors.reduce((b, f) => (f.room > b.room + 1e-6 || (Math.abs(f.room - b.room) < 1e-6 && (Math.abs(f.c.cx) < Math.abs(b.c.cx) - 1e-6 || (Math.abs(Math.abs(f.c.cx) - Math.abs(b.c.cx)) < 1e-6 && f.c.cy < b.c.cy))) ? f : b));
  return qrSpotIn(q, best.room, best.c.cx, best.c.cy, q.qrStyle === 'raised' ? 'engraved' : q.qrStyle);
}

/** Build a lid centered on the origin in XY with its bottom at z = 0. */
export function buildBinLid(w: Wasm, o: LidOpts, cellsIn?: Partial<BinCells> | null): MeshData {
  if (isPocketLid(o)) return buildPocketLid(w, o, cellsIn);
  const cells = binCells(o, cellsIn);
  const { w: W, d: D } = binSize(o, cells);
  const gap = GRID - BASE_TOP;
  const s = new Scope();
  try {
    const solids: Manifold[] = [];
    const receptacles: Manifold[] = [];
    for (const c of cellRects(cells)) {
      const cw = c.cw - gap;
      const cd = c.cd - gap;
      solids.push(
        s.t(
          loftRoundedRect(w, c.cx, c.cy, cw, cd, BASE_TOP_RADIUS, [
            { z: 0, inset: BASE_PROFILE_DEPTH },
            { z: BASE_PROFILE.chamfer1, inset: BASE_PROFILE.chamfer2 },
            { z: BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical, inset: BASE_PROFILE.chamfer2 },
            { z: BASE_PROFILE_HEIGHT, inset: 0 },
            { z: BASE_PROFILE_HEIGHT + 0.25, inset: 0 },
          ]),
        ),
      );
      receptacles.push(
        s.t(
          loftRoundedRect(w, c.cx, c.cy, cw, cd, BASE_TOP_RADIUS, [
            { z: LID_FLOOR, inset: LIP_DEPTH },
            { z: LID_FLOOR + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
            { z: LID_FLOOR + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
            { z: LID_FLOOR + LIP_HEIGHT, inset: 0 },
            { z: LID_FLOOR + LIP_HEIGHT + 1, inset: -1 },
          ]),
        ),
      );
    }
    const plate = s.t(extrudePolygon(w, roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS), BASE_PROFILE_HEIGHT, LID_HEIGHT));
    solids.push(s.t(plate.subtract(s.t(w.Manifold.union(receptacles)))));
    const lid = s.t(w.Manifold.union(solids));
    // A QR code on a receptacle's floor.
    const spot = planLidQr(o, cells)?.spot;
    if (!spot) {
      assertValid(lid, 'lid');
      return toMeshData(lid);
    }
    const parts = emptyQrParts();
    qrInto(w, s, spot, LID_FLOOR, parts);
    const done = applyQrParts(w, s, lid, parts);
    assertValid(done.body, 'lid');
    return withQrInlay(toMeshData(done.body), done.inlay);
  } finally {
    s.dispose();
  }
}
