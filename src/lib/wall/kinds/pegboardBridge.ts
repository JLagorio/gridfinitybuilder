/**
 * 1″ pegboard plate: a box that clips on with a pegboard face in front, so
 * the metal hooks, locking hooks and accessories made for the common 1/4″
 * pegboard hang on this board. Its face is a 5 mm wall (hooks for 3/16″ to
 * 1/4″ boards fit it) with 6.8 mm holes on a 1″ (25.4 mm) grid; behind it a
 * cavity, 8 mm deep by default, takes the hooks' L-shaped tails, which turn
 * up behind the face. Ribs between the hole columns tie the face to the
 * back plate and leave the cavity open up each column; the top row has a
 * hole's pitch of room above it for its tails. The holes are on the 1″ grid
 * of their own; the clips on the back are on the board's lattice, so the
 * two never have to line up.
 *
 * Printed upright, as it hangs: the floor on the bed, the face, ribs and
 * back plate standing on it, a roof over the cavity whose underside leans
 * 45°, and the holes pointed at the top (teardrops), so no support.
 */
import { backMounts } from '../mount';
import { int, num, obj, registerAttachment } from '../registry';

export interface PegboardBridgeOptions {
  /** Holes across and up. */
  columns: number;
  rows: number;
  /** Room behind the face for the hooks' tails, mm. */
  cavity: number;
}

export const PEGBOARD_DEFAULTS: PegboardBridgeOptions = { columns: 4, rows: 3, cavity: 8 };

/** The 1″ grid, the holes, the face, back plate, ribs (and the top and the floor) thickness; mm. */
export const PEG = { pitch: 25.4, hole: 6.8, face: 5, back: 3, rib: 2.4 } as const;

/** Its size: holes half a pitch in from the sides and the bottom, a pitch of room above the top row. */
export const pegboardSize = (o: PegboardBridgeOptions) => ({ w: o.columns * PEG.pitch, h: (o.rows + 0.5) * PEG.pitch, depth: PEG.back + o.cavity + PEG.face });

registerAttachment<PegboardBridgeOptions>({
  type: 'pegboardBridge',
  defaults: PEGBOARD_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = PEGBOARD_DEFAULTS;
    return { columns: int(r.columns, 2, 12, d.columns), rows: int(r.rows, 1, 10, d.rows), cavity: num(r.cavity, 4, 25, d.cavity) };
  },
  layout(o, ctx) {
    const { w, h, depth } = pegboardSize(o);
    const m = backMounts(w, h, ctx, { rows: 3 });
    return { w, h, depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `1″ pegboard ${o.columns} × ${o.rows}`,
  // Its pegboard face covers the whole back.
  backPlate: () => null,
  notes: (o) => (o.cavity < 6 ? ['Most hooks’ tails need about 6 mm behind the face: make the cavity deeper.'] : []),
  // Anything that hangs on it, in front.
  load: (_o, l) => ({ kg: 0, at: l.depth + 30 }),
});
