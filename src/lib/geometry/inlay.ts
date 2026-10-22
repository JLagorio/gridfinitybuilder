import { assertValid, toMeshData, type Manifold, type MeshData, type Scope } from './kernel';
import type { ColourRole } from '../colours';

/**
 * Inlays: a body in another colour that fills a recess in a part flush
 * (inlaid text, a two-colour pocket floor) or stands on it (raised text). It
 * touches the part without overlapping it, and goes on the part's mesh as an
 * overlay (kernel.ts OverlayPart): its colour role with multi-colour on
 * (colours.ts), else its own filament.
 *
 * The flush kind is split off the part with Manifold's split (the part inside
 * a region, and the rest, in one operation), so the two share their faces
 * exactly, whatever shape the face is: flat, leaning or curved.
 */

/** What an inlay is, for its overlay. */
export interface InlayTag {
  /** "Label text", "Tool shadows". */
  name: string;
  role: ColourRole;
  /** Its filament with multi-colour off: 2 for what has always printed in a second filament (inlaid text, shadow floors), 1 to print with the part (raised text). */
  filament: 1 | 2;
}

/** Less than this (mm³) isn't an inlay: a region that only grazes the part. */
const MIN_INLAY = 1e-3;

/** Split the part of `body` inside `region` off it: the rest, and the inlay (null when the region misses it). */
export function splitInlay(s: Scope, body: Manifold, region: Manifold): { body: Manifold; fill: Manifold | null } {
  const [inside, outside] = body.split(region);
  s.t(inside);
  s.t(outside);
  if (inside.isEmpty() || inside.volume() < MIN_INLAY) return { body, fill: null };
  return { body: outside, fill: inside };
}

/** Add an inlay to a built mesh as an overlay (nothing for an empty one). */
export function addInlay(mesh: MeshData, m: Manifold | null, tag: InlayTag): MeshData {
  if (!m || m.isEmpty() || m.volume() < MIN_INLAY) return mesh;
  assertValid(m, tag.name);
  const d = toMeshData(m);
  mesh.overlays = [...(mesh.overlays ?? []), { name: tag.name, filament: tag.filament, role: tag.role, positions: d.positions, indices: d.indices }];
  return mesh;
}
