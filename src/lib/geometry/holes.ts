/**
 * Magnet / screw holes in a bin's feet.
 *
 * Dimensions and the printable-hole technique follow gridfinity-rebuilt-openscad
 * (src/core/gridfinity-rebuilt-holes.scad, standard.scad); the refined hole is
 * Gridfinity Refined's side-loaded magnet slot as rebuilt implements it.
 */
import type { Manifold, Vec2, Wasm } from './kernel';
import type { Scope } from './kernel';
import { HOLE_OFFSET, MAGNET_HOLE_DEPTH, MAGNET_HOLE_DIAMETER, SCREW_HOLE_DEPTH, SCREW_HOLE_DIAMETER, WALL } from './spec';
import { boxAt, cylinderAt, extrudePolygon } from './shapes';
import { cellRects, type BinVariantOptions } from './variants';

/** First-layer height assumed for the printable hole top. */
export const LAYER_HEIGHT = 0.2;
/** Crush ribs: inner radius of the ribs and how many (rebuilt: 5.9 mm, 8 ribs). */
export const CRUSH_RIB_INNER_DIAMETER = 5.9;
export const CRUSH_RIB_COUNT = 8;
/** Extra radius at the mouth of a chamfered hole (45°). */
export const HOLE_CHAMFER = 0.8;
/** Gridfinity Refined magnet slot: 5.86 mm press fit, 1.9 mm tall, 2 layers above the bed. */
export const REFINED = {
  diameter: 5.86,
  height: 1.9,
  floor: 2 * LAYER_HEIGHT,
  /** Slot from the hole out through the side of the foot. */
  slot: 11,
  /** Toothpick hole for pushing the magnet back out. */
  pokeDiameter: 2.5,
  pokeX: -12.53 + 5.6,
  pokeLength: 10 - 5.6,
} as const;

export type HoleKind = 'none' | 'magnets' | 'screws' | 'both' | 'refined';

type HoleOpts = { holes: HoleKind } & Pick<BinVariantOptions, 'holeChamfer' | 'holeCrushRibs' | 'holePrintable' | 'holeCorners'>;

export interface HoleSite {
  x: number;
  y: number;
  /** Rotation in degrees that turns +X outward, toward the nearest bin corner (refined slots point that way). */
  a: number;
}

/** Quadrants: direction from the cell center and the rotation that points +X outward. */
const QUADS: [number, number, number][] = [
  [1, 1, 0],
  [-1, 1, 90],
  [-1, -1, 180],
  [1, -1, 270],
];

/**
 * Hole positions: four per full 42 mm cell, or only the four outer corners of
 * the bin. A corner whose cell is partial gets no hole.
 */
export function holeSites(cells: { x: number[]; y: number[] }, cornersOnly: boolean): HoleSite[] {
  const nx = cells.x.length;
  const ny = cells.y.length;
  const out: HoleSite[] = [];
  for (const c of cellRects(cells)) {
    if (!c.full) continue;
    for (const [dx, dy, a] of QUADS) {
      if (cornersOnly && !((dx < 0 ? c.i === 0 : c.i === nx - 1) && (dy < 0 ? c.j === 0 : c.j === ny - 1))) continue;
      out.push({ x: c.cx + dx * HOLE_OFFSET, y: c.cy + dy * HOLE_OFFSET, a });
    }
  }
  return out;
}

const MAGNET_R = MAGNET_HOLE_DIAMETER / 2;
const SCREW_R = SCREW_HOLE_DIAMETER / 2;

/** Magnet pocket depth, including the sacrificial layers of a printable top. */
function magnetDepth(o: HoleOpts) {
  return MAGNET_HOLE_DEPTH + (o.holePrintable ? printableLayers(o) * LAYER_HEIGHT : 0);
}
const printableLayers = (o: HoleOpts) => (o.holes === 'both' ? 2 : 3);

/** Circle with a wave of crush ribs around it (rebuilt `ribbed_circle`). */
export function ribbedCircle(outerR: number, innerR: number, ribs: number, x = 0, y = 0): Vec2[] {
  const range = (outerR - innerR) / 2;
  const mid = innerR + range;
  const n = ribs * 12;
  const pts: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const r = mid + range * Math.sin(ribs * t);
    pts.push([x + r * Math.cos(t), y + r * Math.sin(t)]);
  }
  return pts;
}

/**
 * Stepped bridge on top of a round hole (rebuilt `make_hole_printable`): the top
 * `layers` layers of the hole shrink in alternating directions from the hole
 * down to a square of `innerR`, so every layer bridges over the one below.
 * The result is what gets cut: the hole's own top layers, already intersected
 * with the hole.
 */
function printableTop(w: Wasm, s: Scope, site: HoleSite, rot: number, z0: number, outerR: number, innerR: number, layers: number): Manifold {
  const T = 0.02;
  const od = 2 * (outerR + T);
  const id = 2 * (innerR + T);
  const step = (od - id) / Math.max(layers - 1, 1);
  const boxes: Manifold[] = [];
  for (let i = 1; i <= layers; i++) {
    const bx = od - step * (i - 1);
    const by = layers > 1 && i === layers ? bx : od - step * i;
    const [ex, ey] = i % 2 === 0 ? [by, bx] : [bx, by];
    const zl = z0 + (i - 1) * LAYER_HEIGHT;
    boxes.push(s.t(boxAt(w, -ex / 2, -ey / 2, zl - T, ex / 2, ey / 2, zl + LAYER_HEIGHT + T)));
  }
  const steps = s.t(s.t(w.Manifold.union(boxes)).rotate([0, 0, site.a + rot]).translate([site.x, site.y, 0]));
  const hole = s.t(cylinderAt(w, site.x, site.y, z0 - T, z0 + layers * LAYER_HEIGHT + T, outerR));
  return s.t(steps.intersect(hole));
}

function magnetHole(w: Wasm, s: Scope, o: HoleOpts, site: HoleSite): Manifold[] {
  const out: Manifold[] = [];
  const { x, y } = site;
  if (o.holeCrushRibs) {
    const ring = ribbedCircle(MAGNET_R, CRUSH_RIB_INNER_DIAMETER / 2, CRUSH_RIB_COUNT, x, y);
    out.push(s.t(extrudePolygon(w, ring, -1, MAGNET_HOLE_DEPTH)));
  } else {
    out.push(s.t(cylinderAt(w, x, y, -1, MAGNET_HOLE_DEPTH, MAGNET_R)));
  }
  if (o.holePrintable) {
    const inner = o.holes === 'both' ? SCREW_R : 1;
    out.push(printableTop(w, s, site, 0, MAGNET_HOLE_DEPTH, MAGNET_R, inner, printableLayers(o)));
  }
  if (o.holeChamfer) out.push(s.t(cylinderAt(w, x, y, -1, HOLE_CHAMFER, MAGNET_R + HOLE_CHAMFER + 1, MAGNET_R)));
  return out;
}

function screwHole(w: Wasm, s: Scope, o: HoleOpts, site: HoleSite): Manifold[] {
  const out: Manifold[] = [];
  const { x, y } = site;
  const layers = 3;
  const top = o.holePrintable ? SCREW_HOLE_DEPTH - layers * LAYER_HEIGHT : SCREW_HOLE_DEPTH;
  out.push(s.t(cylinderAt(w, x, y, -1, top, SCREW_R, SCREW_R, 24)));
  if (o.holePrintable) out.push(printableTop(w, s, site, 90, top, SCREW_R, 0.5, layers));
  // With a magnet pocket below, the screw's mouth is inside the pocket: no chamfer needed.
  if (o.holeChamfer && o.holes === 'screws') out.push(s.t(cylinderAt(w, x, y, -1, HOLE_CHAMFER, SCREW_R + HOLE_CHAMFER + 1, SCREW_R, 24)));
  return out;
}

/** Gridfinity Refined slot, built pointing +X and turned outward. */
function refinedHole(w: Wasm, s: Scope, site: HoleSite): Manifold[] {
  const r = REFINED.diameter / 2;
  const z0 = REFINED.floor;
  const z1 = z0 + REFINED.height;
  const zp = z0 - (REFINED.floor + LAYER_HEIGHT); // poke hole opens through the bottom
  const pr = REFINED.pokeDiameter / 2;
  const local = s.t(
    w.Manifold.union([
      s.t(cylinderAt(w, 0, 0, z0, z1, r)),
      s.t(boxAt(w, 0, -r, z0, REFINED.slot, r, z1)),
      s.t(cylinderAt(w, REFINED.pokeX, 0, zp - 1, z1, pr, pr, 24)),
      s.t(boxAt(w, REFINED.pokeX, -pr, zp - 1, REFINED.pokeX + REFINED.pokeLength, pr, z1)),
    ]),
  );
  return [s.t(local.rotate([0, 0, site.a]).translate([site.x, site.y, 0]))];
}

/** Everything cut out of the bin's bottom for its holes. */
export function holeCutters(w: Wasm, s: Scope, o: HoleOpts, sites: HoleSite[]): Manifold[] {
  if (o.holes === 'none') return [];
  const magnets = o.holes === 'magnets' || o.holes === 'both';
  const screws = o.holes === 'screws' || o.holes === 'both';
  const out: Manifold[] = [];
  for (const site of sites) {
    if (o.holes === 'refined') out.push(...refinedHole(w, s, site));
    if (magnets) out.push(...magnetHole(w, s, o, site));
    if (screws) out.push(...screwHole(w, s, o, site));
  }
  return out;
}

/**
 * Solid bosses around each hole, for hollow (lite / efficient, vase) bases: the
 * holes grown by `t` (one wall), so they stay closed toward the inside of the bin.
 */
export function holeBosses(w: Wasm, s: Scope, o: HoleOpts, sites: HoleSite[], zMax: number, t = WALL): Manifold[] {
  if (o.holes === 'none') return [];
  const magnets = o.holes === 'magnets' || o.holes === 'both';
  const screws = o.holes === 'screws' || o.holes === 'both';
  const out: Manifold[] = [];
  const cap = (z: number) => Math.min(z, zMax);
  for (const site of sites) {
    const { x, y } = site;
    if (magnets) out.push(s.t(cylinderAt(w, x, y, -1, cap(magnetDepth(o) + t), MAGNET_R + t)));
    if (screws) out.push(s.t(cylinderAt(w, x, y, -1, cap(SCREW_HOLE_DEPTH + t), SCREW_R + t, SCREW_R + t, 24)));
    if (o.holes === 'refined') {
      const r = REFINED.diameter / 2 + t;
      const z1 = cap(REFINED.floor + REFINED.height + t);
      const local = s.t(
        w.Manifold.union([
          s.t(cylinderAt(w, 0, 0, -1, z1, r)),
          s.t(boxAt(w, 0, -r, -1, REFINED.slot, r, z1)),
          s.t(boxAt(w, REFINED.pokeX - REFINED.pokeDiameter / 2 - t, -REFINED.pokeDiameter / 2 - t, -1, 0, REFINED.pokeDiameter / 2 + t, z1)),
        ]),
      );
      out.push(s.t(local.rotate([0, 0, site.a]).translate([x, y, 0])));
    }
  }
  return out;
}
