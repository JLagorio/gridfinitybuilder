/**
 * Wall bin: an open box on the board, its sides sloping down to a lower front
 * so you can reach in, with dividers if you like. Printed upright as it hangs;
 * clips across the back, studs below on a tall bin.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, registerAttachment } from '../registry';

export interface BinOptions {
  width: number;
  height: number;
  depth: number;
  /** Front height as a share of the back, %. */
  front: number;
  wall: number;
  floor: number;
  dividers: number;
  /** A ledge on the front for a label. */
  label: boolean;
}

export const BIN_DEFAULTS: BinOptions = { width: 80, height: 60, depth: 50, front: 60, wall: 1.6, floor: 2, dividers: 0, label: false };

/** Back wall thickness: room for the clips' roots. */
export const BIN_BACK = 2.4;

registerAttachment<BinOptions>({
  type: 'bin',
  defaults: BIN_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = BIN_DEFAULTS;
    return {
      width: num(r.width, 20, 400, d.width),
      height: num(r.height, 25, 250, d.height),
      depth: num(r.depth, 15, 200, d.depth),
      front: num(r.front, 20, 100, d.front),
      wall: num(r.wall, 0.8, 4, d.wall),
      floor: num(r.floor, 0.8, 5, d.floor),
      dividers: int(r.dividers, 0, 12, d.dividers),
      label: bool(r.label, d.label),
    };
  },
  layout(o, ctx) {
    const h = Math.max(o.height, minHeight(ctx));
    const m = backMounts(o.width, h, ctx, { rows: 3 });
    return { w: o.width, h, depth: o.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Bin ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}${o.dividers ? `, ${o.dividers + 1} sections` : ''}`,
  notes: (o) => (o.width / (o.dividers + 1) < 8 ? ['Sections under 8 mm wide are hard to reach into.'] : []),
});
