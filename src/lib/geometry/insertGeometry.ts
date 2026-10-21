/**
 * Builders for the separately printed inserts: lift-out cups and egg-crate
 * grids (cups.ts, eggcrate.ts) and the baseplate's TPU pads (pads.ts).
 */
import type { MeshData, Wasm } from './kernel';
import { buildCup, type CratePart, type CupPart } from './cups';
import { buildCrate } from './eggcrate';
import { buildPad, type PadPart } from './pads';

export type InsertPart = CupPart | CratePart | PadPart;

/** Build an insert part: min corner of its footprint at the origin, bottom at z = 0. */
export function buildInsertPart(w: Wasm, part: InsertPart): MeshData {
  if (part.type === 'cup') return buildCup(w, part);
  if (part.type === 'crate') return buildCrate(w, part);
  return buildPad(w, part);
}
