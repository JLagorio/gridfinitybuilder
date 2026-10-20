/**
 * Pocket-grid interior ("item holder", after Gridfinity Extended's
 * gridfinity_item_holder): the bin is filled solid from the floor up to the
 * pocket depth and a grid of round, square or hex pockets is cut into it.
 * Above the fill the bin stays open. As many pockets as fit are used, on a
 * square grid or staggered rows, whichever holds more.
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { INNER_RADIUS, LIP_DEPTH, WALL } from './spec';
import { cylinderAt, extrudePolygon, ringAt, roundedRectRing } from './shapes';
import type { BinVariantOptions, PocketShape } from './variants';

export interface PocketPreset {
  id: string;
  label: string;
  shape: PocketShape;
  /** Diameter, width, or across-flats (hex), clearance included. */
  w: number;
  /** Square pockets: size along Y. */
  d?: number;
  depth: number;
  spacing: number;
  chamfer: number;
}

/** Item presets. Sizes include clearance; coin cells and cards stand on edge in slots. */
export const POCKET_PRESETS: PocketPreset[] = [
  { id: 'aa', label: 'AA battery', shape: 'round', w: 15, depth: 20, spacing: 2, chamfer: 1 },
  { id: 'aaa', label: 'AAA battery', shape: 'round', w: 11, depth: 18, spacing: 2, chamfer: 1 },
  { id: '18650', label: '18650 cell', shape: 'round', w: 19, depth: 25, spacing: 2, chamfer: 1 },
  { id: 'cr2032', label: 'CR2032 coin cell', shape: 'square', w: 20.8, d: 3.8, depth: 12, spacing: 2, chamfer: 0.8 },
  { id: 'sd', label: 'SD card', shape: 'square', w: 24.6, d: 2.8, depth: 16, spacing: 2.5, chamfer: 0.8 },
  { id: 'microsd', label: 'microSD card', shape: 'square', w: 11.6, d: 1.6, depth: 9, spacing: 2.5, chamfer: 0.6 },
  { id: 'hexbit', label: '1/4″ hex bit', shape: 'hex', w: 6.65, depth: 12, spacing: 2, chamfer: 0.6 },
  { id: 'm3', label: 'M3 screw', shape: 'round', w: 3.4, depth: 10, spacing: 3.6, chamfer: 0.5 },
  { id: 'm4', label: 'M4 screw', shape: 'round', w: 4.5, depth: 12, spacing: 4, chamfer: 0.6 },
  { id: 'm5', label: 'M5 screw', shape: 'round', w: 5.5, depth: 14, spacing: 4.5, chamfer: 0.7 },
];

export function findPocketPreset(id: string): PocketPreset | undefined {
  return POCKET_PRESETS.find((p) => p.id === id);
}

/** The option fields a preset sets. */
export function presetFields(p: PocketPreset): Partial<BinVariantOptions> {
  return {
    pocketPreset: p.id,
    pocketShape: p.shape,
    pocketW: p.w,
    pocketD: p.d ?? p.w,
    pocketDepth: p.depth,
    pocketSpacing: p.spacing,
    pocketChamfer: p.chamfer,
  };
}

type PocketOpts = Pick<BinVariantOptions, 'pocketShape' | 'pocketW' | 'pocketD' | 'pocketDepth' | 'pocketSpacing' | 'pocketChamfer'> & {
  lip: boolean;
};

export interface PocketLayout {
  /** Pocket centers, relative to the bin's center. */
  centers: [number, number][];
  /** Hex pockets: true = flat sides facing ±X (columns staggered), false = flat sides facing ±Y... see pocketCutters. */
  hexFlatX: boolean;
  /** Top of the solid fill. */
  fillTop: number;
  /** Pocket depth after clamping to the bin. */
  depth: number;
}

const SQRT3 = Math.sqrt(3);

/** Footprint of one pocket: [x, y] extents in the row-staggered frame. */
function extents(o: PocketOpts): [number, number] {
  if (o.pocketShape === 'square') return [o.pocketW, o.pocketD];
  if (o.pocketShape === 'hex') return [o.pocketW, (o.pocketW * 2) / SQRT3]; // flats facing ±X, points ±Y
  return [o.pocketW, o.pocketW];
}

/** Centers of a square grid inside a centered aw × ad area. */
function gridCenters(aw: number, ad: number, sx: number, sy: number, sp: number): [number, number][] {
  if (aw < sx || ad < sy) return [];
  const nx = Math.floor((aw - sx) / (sx + sp) + 1e-9) + 1;
  const ny = Math.floor((ad - sy) / (sy + sp) + 1e-9) + 1;
  const out: [number, number][] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) out.push([(i - (nx - 1) / 2) * (sx + sp), (j - (ny - 1) / 2) * (sy + sp)]);
  }
  return out;
}

/** Centers of staggered rows (along X) of round or hex pockets of width sx. */
function staggerCenters(aw: number, ad: number, sx: number, sy: number, sp: number): [number, number][] {
  if (aw < sx || ad < sy) return [];
  const px = sx + sp;
  const py = (px * SQRT3) / 2;
  const rows = Math.floor((ad - sy) / py + 1e-9) + 1;
  if (rows < 2) return [];
  const n0 = Math.floor((aw - sx) / px + 1e-9) + 1;
  const n1 = Math.floor((aw - sx - px / 2) / px + 1e-9) + 1;
  if (n1 < 1) return [];
  const pts: [number, number][] = [];
  for (let j = 0; j < rows; j++) {
    const n = j % 2 ? n1 : n0;
    for (let i = 0; i < n; i++) pts.push([i * px + (j % 2 ? px / 2 : 0), j * py]);
  }
  // center the pattern
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}

/**
 * Where the pockets go in a W × D bin whose floor is at `zFloor` and whose
 * infill may reach `topInfill`.
 */
export function pocketLayout(o: PocketOpts, W: number, D: number, zFloor: number, topInfill: number): PocketLayout {
  const depth = Math.max(0, Math.min(o.pocketDepth, topInfill - zFloor));
  let fillTop = zFloor + depth;
  if (fillTop > topInfill - 0.3) fillTop = topInfill;
  // With the fill up under the lip, keep the pockets inside the lip's inner edge.
  const wallLine = o.lip && fillTop >= topInfill - 1e-6 ? LIP_DEPTH : WALL;
  const margin = Math.max(o.pocketSpacing, o.pocketChamfer + 0.4);
  const aw = W - 2 * (wallLine + margin);
  const ad = D - 2 * (wallLine + margin);
  const sp = o.pocketSpacing;
  const [sx, sy] = extents(o);
  const options: { centers: [number, number][]; hexFlatX: boolean }[] = [{ centers: gridCenters(aw, ad, sx, sy, sp), hexFlatX: true }];
  if (o.pocketShape !== 'square') {
    options.push({ centers: staggerCenters(aw, ad, sx, sy, sp), hexFlatX: true });
    // Staggered columns: the same layout turned 90°.
    const turned = staggerCenters(ad, aw, sx, sy, sp).map(([x, y]) => [y, x] as [number, number]);
    options.push({ centers: turned, hexFlatX: false });
  }
  let best = options[0];
  for (const c of options) if (c.centers.length > best.centers.length) best = c;
  return { ...best, fillTop, depth: fillTop - zFloor };
}

/** Cutters for the pocket interior: the open space above the fill, and every pocket. */
export function pocketCutters(
  w: Wasm,
  s: Scope,
  o: PocketOpts,
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): Manifold[] {
  const L = pocketLayout(o, W, D, zFloor, topInfill);
  const out: Manifold[] = [];
  const zTop = topInfill + 1;
  if (L.fillTop < topInfill) {
    const ring = roundedRectRing(-W / 2 + WALL, -D / 2 + WALL, W / 2 - WALL, D / 2 - WALL, INNER_RADIUS);
    out.push(s.t(extrudePolygon(w, ring, L.fillTop, zTop)));
  }
  if (L.depth < 0.5) return out;
  const c = Math.min(o.pocketChamfer, L.depth / 2);
  const z0 = zFloor;
  const z1 = L.fillTop;
  for (const [x, y] of L.centers) {
    if (o.pocketShape === 'round') {
      const r = o.pocketW / 2;
      out.push(s.t(cylinderAt(w, x, y, z0, zTop, r, r, 48)));
      if (c > 0) out.push(s.t(cylinderAt(w, x, y, z1 - c, z1 + 0.02, r, r + c + 0.02, 48)));
    } else if (o.pocketShape === 'hex') {
      // Manifold's 6-sided cylinder has corners on ±X; turn it so flats face ±X when hexFlatX.
      const R = o.pocketW / SQRT3;
      const turn = L.hexFlatX ? 30 : 0;
      const hex = (zb: number, h: number, r0: number, r1: number) =>
        s.t(s.t(w.Manifold.cylinder(h, r0, r1, 6)).rotate([0, 0, turn]).translate([x, y, zb]));
      out.push(hex(z0, zTop - z0, R, R));
      if (c > 0) out.push(hex(z1 - c, c + 0.02, R, R + ((c + 0.02) * 2) / SQRT3));
    } else {
      const hw = o.pocketW / 2;
      const hd = o.pocketD / 2;
      const rr = Math.min(0.5, hw - 0.05, hd - 0.05);
      const ring = roundedRectRing(x - hw, y - hd, x + hw, y + hd, rr);
      out.push(s.t(extrudePolygon(w, ring, z0, zTop)));
      if (c > 0) {
        const big = roundedRectRing(x - hw - c - 0.02, y - hd - c - 0.02, x + hw + c + 0.02, y + hd + c + 0.02, rr + c);
        out.push(s.t(w.Manifold.hull([...ringAt(ring, z1 - c), ...ringAt(big, z1 + 0.02)])));
      }
    }
  }
  return out;
}
