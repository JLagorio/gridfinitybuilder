/**
 * Shared pieces for container types: the Gridfinity base they stand on, and
 * their outline. Everything is bin-centered with the bottom at z = 0, like buildBin.
 */
import type { Manifold, Scope, Wasm } from '../kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS } from '../spec';
import { extrudePolygon, roundedRectRing } from '../shapes';
import { binHoleSites, binSize, buildFeet, type BinCells, type BinOptions } from '../bin';
import { holeCutters } from '../holes';

/** Outer outline of a container on these cells (the same as a bin's). */
export function containerRing(o: Pick<BinOptions, 'unitsX' | 'unitsY'>, cells: BinCells): [number, number][] {
  const { w: W, d: D } = binSize(o, cells);
  return roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);
}

/**
 * Feet under every cell plus a solid slab over the whole footprint up to
 * `floorTop`, with the bin's magnet / screw holes cut in. Flat bases are a
 * slab from z = 0. Build the container's body on top of this.
 */
export function containerBase(w: Wasm, s: Scope, o: BinOptions, cells: BinCells, floorTop: number): Manifold {
  const flat = o.base === 'flat';
  const z0 = flat ? 0 : BASE_PROFILE_HEIGHT;
  const parts = buildFeet(w, s, o, cells);
  if (floorTop > z0 + 1e-6) parts.push(s.t(extrudePolygon(w, containerRing(o, cells), z0, floorTop)));
  let base = parts.length === 1 ? parts[0] : s.t(w.Manifold.union(parts));
  const holes = holeCutters(w, s, o, binHoleSites(o, cells));
  if (holes.length) base = s.t(base.subtract(s.t(w.Manifold.union(holes))));
  return base;
}
