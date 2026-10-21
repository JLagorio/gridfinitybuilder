/**
 * QR code geometry (planning is in qrCode.ts, qrFront.ts, lid.ts and
 * accessories.ts). Only mesh builders use it, so it and the encoder stay out
 * of the first screen's bundle.
 *
 * - The dark modules: rectangles from qrRects (runs along each row, joined
 *   down the rows), each grown by QR.overlap so modules that meet only at a
 *   corner join instead of touching along an edge, filled as one
 *   cross-section and extruded once: one small solid per code.
 * - Raised: a hair into the face, so the union is solid. Engraved: cut in.
 *   Inlaid: cut in and filled flush by the same outline (the fill touches the
 *   recess, never overlapping the body), printed in filament 2.
 * - Front wall: drawn flat, stood up on the face; engraved and inlaid codes get
 *   the wall thickened behind them (qrFront.ts). Plates: a square with an
 *   elephant-foot chamfer, the code on top.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { DIVIDER, WALL } from './spec';
import { boxAt, hullOf, loftRoundedRect } from './shapes';
import { resolveLayout } from '../dividers';
import { encodeQr, qrRects } from '../qrEncode';
import { QR, emptyQrParts, type QrParts, type QrPlatePart, type QrSpot } from './qrCode';
import { QR_FRONT, planFrontQr } from './qrFront';
import type { BinOptions } from './bin';

/** The code's dark modules as one solid in the XY plane (centered on the spot, row 0 toward +Y), from z0, `height` thick. */
export function qrModules(w: Wasm, spot: QrSpot, z0: number, height: number): Manifold | null {
  const code = encodeQr(spot.text, spot.ecc, { minVersion: spot.version, maxVersion: spot.version });
  if (!code || code.size !== spot.modules || height <= 0) return null;
  const m = spot.module;
  const half = (code.size * m) / 2;
  const e = QR.overlap;
  const contours = qrRects(code).map(([x, y, cw, ch]): [number, number][] => {
    const x0 = spot.cx - half + x * m - e;
    const x1 = spot.cx - half + (x + cw) * m + e;
    const y1 = spot.cy + half - y * m + e;
    const y0 = spot.cy + half - (y + ch) * m - e;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  });
  const cs = new w.CrossSection(contours, 'NonZero');
  try {
    if (cs.isEmpty()) return null;
    return cs.extrude(height).translate([0, 0, z0]);
  } finally {
    cs.delete();
  }
}

/** The code on a flat face at height z facing +Z (`turn` stands it elsewhere): what it cuts, adds and inlays. */
export function qrInto(w: Wasm, s: Scope, spot: QrSpot, z: number, out: QrParts, turn: (m: Manifold) => Manifold = (m) => m) {
  const R = spot.relief;
  const put = (list: Manifold[], z0: number, h: number) => {
    const m = qrModules(w, spot, z0, h);
    if (m) list.push(s.t(turn(s.t(m))));
  };
  if (spot.style === 'raised') return put(out.add, z - 0.02, R + 0.02);
  put(out.cut, z - R, R + 1);
  if (spot.style === 'inlaid') put(out.inlay, z - R, R);
}

/** Cut, then add; the inlay comes back for `withQrInlay`. */
export function applyQrParts(w: Wasm, s: Scope, body: Manifold, p: QrParts): { body: Manifold; inlay: Manifold | null } {
  let b = body;
  if (p.cut.length) b = s.t(b.subtract(s.t(w.Manifold.union(p.cut))));
  if (p.add.length) b = s.t(w.Manifold.union([b, ...p.add]));
  return { body: b, inlay: p.inlay.length ? s.t(w.Manifold.union(p.inlay)) : null };
}

/** Attach a code's inlay to a built mesh as a filament-2 overlay. */
export function withQrInlay(mesh: MeshData, inlay: Manifold | null): MeshData {
  if (!inlay || inlay.isEmpty()) return mesh;
  assertValid(inlay, 'QR inlay');
  const m = toMeshData(inlay);
  // Filament 2 as before; with multi-colour on, the QR code role's slot (colours.ts).
  mesh.overlays = [...(mesh.overlays ?? []), { name: 'QR code', filament: 2, role: 'qrCode', positions: m.positions, indices: m.indices }];
  return mesh;
}

/** Removable divider walls that meet the front wall: their x (bin coordinates). */
function removableAtFront(o: BinOptions, W: number, D: number): number[] {
  if (!o.layout?.walls.some((wl) => wl.removable)) return [];
  const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
  return r.walls.filter((wl) => wl.removable && wl.orient === 'v' && wl.start < 0.5).map((wl) => -W / 2 + WALL + wl.pos);
}

export interface FrontQrGeometry extends QrParts {
  /** For walls.ts: the front-wall area a hex pattern leaves solid. */
  keepOut: { wall: 'f'; u0: number; u1: number; z0: number; z1: number } | null;
}

/** A bin's code on its front wall (qrFront.ts plans it), with the wall pad behind it; bin-centered, outer size W × D. */
export function frontQrGeometry(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, zBottom: number): FrontQrGeometry {
  const out: FrontQrGeometry = { ...emptyQrParts(), keepOut: null };
  const plan = planFrontQr(o, W, D, zBottom);
  const spot = plan?.spot;
  if (!spot || !plan.box) return out;
  // Drawn in the XY plane (y = height), extruded along +Z, then stood up on the front face: (x, y, z) → (x, −z, y) at y = −D/2.
  const toFront = (m: Manifold) => s.t(s.t(m.rotate([90, 0, 0])).translate([0, -D / 2, 0]));
  qrInto(w, s, spot, 0, out, toFront);
  if (spot.style !== 'raised') {
    // Thicken the wall behind the modules, 45° underneath; leave removable-divider slots clear.
    const half = (spot.modules * spot.module) / 2 + 0.5;
    const yw = -D / 2 + WALL - 0.05;
    const yp = -D / 2 + QR_FRONT.wall;
    const drop = yp - yw;
    const x0 = spot.cx - half;
    const x1 = spot.cx + half;
    const z0 = spot.cy - half;
    const z1 = spot.cy + half;
    let pad = s.t(
      hullOf(w, [
        [x0, yw, z0 - drop],
        [x1, yw, z0 - drop],
        [x0, yw, z1],
        [x1, yw, z1],
        [x0, yp, z0],
        [x1, yp, z0],
        [x0, yp, z1],
        [x1, yp, z1],
      ]),
    );
    const gaps = removableAtFront(o, W, D).map((x) => s.t(boxAt(w, x - DIVIDER / 2 - 0.8, yw - 0.5, -1, x + DIVIDER / 2 + 0.8, yp + 1, 500)));
    if (gaps.length) pad = s.t(pad.subtract(s.t(w.Manifold.union(gaps))));
    out.add.push(pad);
  }
  const b = plan.box;
  out.keepOut = { wall: 'f', u0: b.x0 - QR.margin, u1: b.x1 + QR.margin, z0: b.z0 - QR.margin, z1: b.z1 + QR.margin };
  return out;
}

/** A QR plate lying flat, min corner at the origin, bottom at z = 0. */
export function buildQrPlate(w: Wasm, p: QrPlatePart): MeshData {
  const s = new Scope();
  try {
    const r = Math.min(QR.plateRadius, p.side / 4);
    const e = Math.min(QR.plateChamfer, r - 0.1);
    const body = s.t(
      loftRoundedRect(w, p.side / 2, p.side / 2, p.side, p.side, r, [
        { z: 0, inset: e },
        { z: e, inset: 0 },
        { z: p.thickness, inset: 0 },
      ]),
    );
    const parts = emptyQrParts();
    qrInto(w, s, p.spot, p.thickness, parts);
    const done = applyQrParts(w, s, body, parts);
    assertValid(done.body, 'QR plate');
    return withQrInlay(toMeshData(done.body), done.inlay);
  } finally {
    s.dispose();
  }
}

