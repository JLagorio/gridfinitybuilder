/**
 * openGrid and Multiboard boards' mesh builders: handed to the mesh builders
 * (gridBoards.ts setGridBoardBuilders) by the geometry worker and the tests,
 * so the boards' planning stays off the first screen.
 */
import type { EnclosurePart, PieceEnclosure } from '../enclosures';
import type { MeshData, Wasm } from './kernel';
import { buildOpenGridConnector, buildOpenGridTile } from './opengrid';
import { buildMultiboardTile } from './multiboard';

/** A board's tile. */
export function piece(w: Wasm, e: PieceEnclosure): MeshData {
  if (e.kind === 'opengrid') return buildOpenGridTile(w, e.tile);
  if (e.kind === 'multiboard') return buildMultiboardTile(w, e.tile);
  throw new Error(`Not a board tile: ${e.kind}`);
}

/** A board's extra part (openGrid's connectors). */
export function part(w: Wasm, p: EnclosurePart): MeshData {
  if (p.kind === 'openGridConnector') return buildOpenGridConnector(w, p.connector);
  throw new Error(`Not a board part: ${p.kind}`);
}
