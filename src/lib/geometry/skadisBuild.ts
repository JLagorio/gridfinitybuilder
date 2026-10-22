/**
 * Skådis boards' mesh builders: handed to the mesh builders (skadisBoards.ts
 * setSkadisBoardBuilders) by the geometry worker and the tests, so neither
 * the boards' geometry nor their planning (skadis.ts, which has both) is on
 * the first screen.
 */
import type { EnclosurePart, PieceEnclosure } from '../enclosures';
import type { MeshData, Wasm } from './kernel';
import { buildSkadisPlate, buildSkadisSpacer, buildSkadisTile } from './skadis';
import { buildSkadisCap, buildSkadisHang, buildSkadisRim } from './skadisParts';

/** A board's tile. */
export function piece(w: Wasm, e: PieceEnclosure): MeshData {
  if (e.kind === 'skadis') return buildSkadisTile(w, e.tile);
  throw new Error(`Not a Skådis tile: ${e.kind}`);
}

/** A board's extra part: a joint plate, a standoff spacer, a frame strip, what it hangs from, a screw cover. */
export function part(w: Wasm, p: EnclosurePart): MeshData {
  switch (p.kind) {
    case 'skadisPlate':
      return buildSkadisPlate(w, p.plate, p.pinsDown);
    case 'skadisSpacer':
      return buildSkadisSpacer(w, p.spacer);
    case 'skadisRim':
      return buildSkadisRim(w, p.rim);
    case 'skadisHang':
      return buildSkadisHang(w, p.hang);
    case 'skadisCap':
      return buildSkadisCap(w, p.cap);
  }
  throw new Error(`Not a Skådis board part: ${p.kind}`);
}
