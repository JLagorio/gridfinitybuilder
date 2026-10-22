/**
 * Wall bin: an open box on the board, its sides sloping down to a lower front
 * so you can reach in, with dividers if you like. Printed upright as it hangs;
 * clips across the back, studs below on a tall bin.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, registerAttachment } from '../registry';
import { KG } from '../load';

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

/** The front wall's height on a bin `h` tall (the sides slope down to it). */
export const binFront = (o: BinOptions, h: number) => Math.max(o.floor + 4, (h * o.front) / 100);

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
    // The label ledge stands 2 mm out past the front.
    return { w: o.width, h, depth: o.depth + (o.label ? 2 : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Bin ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}${o.dividers ? `, ${o.dividers + 1} sections` : ''}`,
  notes: (o) => (o.width / (o.dividers + 1) < 8 ? ['Sections under 8 mm wide are hard to reach into.'] : []),
  labelFace(o, l) {
    const fh = binFront(o, l.h);
    // The label ledge's front, or the front wall (not too deep for a thin one).
    if (o.label) {
      const y0 = Math.max(0, fh - 12);
      return { x: 2, y: y0 + 2.5, w: l.w - 4, h: fh - y0 - 3, z: o.depth + 2, normal: 'front' };
    }
    return fh >= 7 && o.wall >= 1.2
      ? { x: o.wall + 1, y: 1, w: l.w - 2 * o.wall - 2, h: fh - 2, z: o.depth, normal: 'front', depth: Math.min(0.6, o.wall / 2) }
      : null;
  },
  backPlate(o, l) {
    // Above the front wall (a screwdriver reaches in over it; the sides' slope leaves its inside edge a little higher),
    // between the sides and the dividers.
    const fh = binFront(o, l.h);
    const y0 = fh + 1 + (o.wall * (l.h - fh)) / (o.depth - BIN_BACK);
    const t = o.wall;
    const cuts = Array.from({ length: o.dividers }, (_, k) => t + ((l.w - 2 * t) * (k + 1)) / (o.dividers + 1));
    const xs = [t, ...cuts.flatMap((x) => [x - t / 2, x + t / 2]), l.w - t];
    return Array.from({ length: xs.length / 2 }, (_, k) => ({ x0: xs[2 * k], x1: xs[2 * k + 1], y0, y1: l.h, z: BIN_BACK }));
  },
  // Full of things (its front is lower: about half way between).
  load: (o) => ({ kg: o.width * o.depth * o.height * ((1 + o.front / 100) / 2) * KG.full, at: o.depth / 2 }),
});
