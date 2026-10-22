/**
 * Other systems' accessories: a plate that clips on with a row (or a few
 * rows) of another system's heads on its face, so that system's accessories
 * hang on the board. Those accessories carry the slots; the board side
 * carries the heads, so the heads are what the plate has:
 * - 'multiconnect': the community Multiconnect connector, a round dovetail
 *   head ⌀20 on a ⌀15 neck, 4 mm out (a 0.5 neck, a 45° flare, a 1 mm rim),
 *   with a 2 mm dimple in its face for the slot's detent. The accessory's
 *   slot is open at the bottom: it slides down over the head. 25 mm apart
 *   on Multiboard, 28 on openGrid.
 * - 'openconnect': openGrid's openConnect head, 17 × 10.6 mm with its top
 *   corners cut at 45°, 2.6 mm out (0.6 straight at the plate, a 1.4 mm
 *   45° dovetail on the sides and the top, 0.6 straight), notches in its
 *   sides for the slot's nubs; 28 mm apart. The accessory goes on 10.6 mm
 *   higher and drops onto it.
 * - 'multipoint': Multiboard's Multipoint, a smaller round head; its profile
 *   isn't published, so this is the community generator's beta one (⌀15.8,
 *   3 mm out): try one head before printing many. 25 mm apart.
 * The heads' sizes are the published connectors' (the slots have the
 * clearance), 0.05 mm smaller a side at the normal fit, 0.15 at the loose
 * one. Printed upright, as it hangs: the dovetails lean 45° and each head's
 * underside is trimmed at 45° from the plate (the slots are open under a
 * head, so nothing bears there).
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type BackPlate, type MountCtx } from '../registry';
import type { Vec2 } from '../../geometry/kernel';

export const RECEIVER_SYSTEMS = ['multiconnect', 'openconnect', 'multipoint'] as const;

export interface ReceiverOptions {
  system: (typeof RECEIVER_SYSTEMS)[number];
  /** Between heads across and up, mm: the system's grid (25 on Multiboard, 28 on openGrid). */
  pitch: number;
  columns: number;
  rows: number;
  /** The plate's height, mm (at least what the heads and the mounts need). */
  height: number;
}

export const RECEIVER_DEFAULTS: ReceiverOptions = { system: 'multiconnect', pitch: 25, columns: 2, rows: 1, height: 60 };

/** The plate's thickness, and how far its heads stay in from its edges, mm. */
export const RECEIVER_PLATE = 5;
const EDGE = 4;

/** Each head: how far it stands out of the plate, and how far it reaches above, below and to each side of its centre, mm. */
export const RECEIVER_HEADS = {
  multiconnect: { out: 4, up: 10, down: 10, side: 10 },
  openconnect: { out: 2.6, up: 8.9, down: 1.7, side: 8.5 },
  multipoint: { out: 3, up: 7.9, down: 7.9, side: 7.9 },
} as const;

/** The plate's size and its heads' centres (front view), top row first. */
export function receiverPlan(o: ReceiverOptions, ctx: MountCtx): { w: number; h: number; heads: Vec2[] } {
  const k = RECEIVER_HEADS[o.system];
  // Heads never closer than 2 mm apart.
  const P = Math.max(o.pitch, 2 * k.side + 2);
  const w = Math.max(o.columns * P, (o.columns - 1) * P + 2 * (k.side + EDGE), 50);
  const need = k.up + k.down + (o.rows - 1) * P + 2 * EDGE;
  const h = Math.max(o.height, need, minHeight(ctx));
  const heads: Vec2[] = [];
  for (let j = 0; j < o.rows; j++) for (let i = 0; i < o.columns; i++) heads.push([w / 2 + (i - (o.columns - 1) / 2) * P, h - EDGE - k.up - j * P]);
  return { w, h, heads };
}

const NAMES = { multiconnect: 'Multiconnect', openconnect: 'openConnect', multipoint: 'Multipoint' };

registerAttachment<ReceiverOptions>({
  type: 'receiver',
  defaults: RECEIVER_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = RECEIVER_DEFAULTS;
    return {
      system: pick(r.system, RECEIVER_SYSTEMS, d.system),
      pitch: num(r.pitch, 20, 50, d.pitch),
      columns: int(r.columns, 1, 8, d.columns),
      rows: int(r.rows, 1, 4, d.rows),
      height: num(r.height, 20, 200, d.height),
    };
  },
  layout(o, ctx) {
    const p = receiverPlan(o, ctx);
    const m = backMounts(p.w, p.h, ctx, { rows: 3 });
    return { w: p.w, h: p.h, depth: RECEIVER_PLATE + RECEIVER_HEADS[o.system].out, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `${NAMES[o.system]} plate ${o.columns} × ${o.rows}`,
  backPlate(o, l) {
    // Between the heads' columns and rows (and round them), the plate's full height or width: screw it on before an
    // accessory goes over them.
    const k = RECEIVER_HEADS[o.system];
    const P = Math.max(o.pitch, 2 * k.side + 2);
    const xs = Array.from({ length: o.columns }, (_, i) => l.w / 2 + (i - (o.columns - 1) / 2) * P);
    const ys = Array.from({ length: o.rows }, (_, j) => l.h - EDGE - k.up - j * P).reverse();
    const out: BackPlate[] = [];
    for (let i = 0; i <= o.columns; i++)
      out.push({ x0: i ? xs[i - 1] + k.side : 0, x1: i < o.columns ? xs[i] - k.side : l.w, y0: 0, y1: l.h, z: RECEIVER_PLATE });
    for (let j = 0; j <= o.rows; j++) out.push({ x0: 0, x1: l.w, y0: j ? ys[j - 1] + k.up : 0, y1: j < o.rows ? ys[j] - k.down : l.h, z: RECEIVER_PLATE });
    return out;
  },
  // Anything that hangs on it, in front.
  load: (_o, l) => ({ kg: 0, at: l.depth + 30 }),
});
