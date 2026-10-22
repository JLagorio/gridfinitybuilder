/**
 * DIN rail: a length of TS35 top-hat rail on a plate that hooks on, for
 * breakers, relays, terminal blocks, power supplies and the like. The rail
 * stands off the plate as the steel one stands off its panel: two walls 27
 * mm apart over their outsides, 7.5 (or 15) mm out to the front of the
 * flanges, and the flanges 35 mm across. The flanges are 1.5 mm thick, as
 * on the 15 mm deep steel rail (the 7.5 mm one is 1 mm), so they're strong
 * printed; a module's hook and latch only reach behind their edges, so they
 * take it. End stops (ramps in front of the flanges at each end) keep the
 * modules from sliding off.
 *
 * Printed on its side, the rail standing up from the bed: the profile lies
 * in the layers, so the flanges are strong across and need no support (the
 * lower flange of a rail printed as it hangs would start in mid-air). A
 * pegboard hook at the left of the top row holds it on, studs in the free
 * slots further along keep it flat on the board.
 */
import { backMounts, minHeight, mountBox } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { addStuds } from './grid';

export interface DinRailOptions {
  length: number;
  /** Out from the plate to the front of the flanges, mm: '7.5' or '15'. */
  depth: '7.5' | '15';
  /** End stops at both ends. */
  stops: boolean;
}

export const DIN_DEFAULTS: DinRailOptions = { length: 100, depth: '7.5', stops: true };

/**
 * The rail, mm: across the flanges, over the walls' outsides, the walls,
 * the flanges, the plate under it; an end stop's flat top, its 45° ramp,
 * and how far it stands in front of the flanges.
 */
export const DIN = { width: 35, hat: 27, wall: 2, flange: 1.5, plate: 4, stop: 6, ramp: 8, stopOut: 8 } as const;

/**
 * The plate's height: room for the rail and a margin, and for the hook and a stud below it; its middle (the rail's)
 * on a row of slots, so a bolt can go through the plate between the rail's walls, as a steel rail is screwed on.
 */
export function dinHeight(ctx: MountCtx): number {
  const least = Math.max(DIN.width + 16, minHeight(ctx, 'hook') + 2 * ctx.pitch);
  // The hook's slot is `over` above the plate's top, a row of slots every lattice step below it: h / 2 = j steps − over.
  const over = -mountBox('hook', [0, 0], ctx).y1;
  return 2 * (Math.ceil((least / 2 + over) / ctx.pitch - 1e-9) * ctx.pitch - over);
}

registerAttachment<DinRailOptions>({
  type: 'dinRail',
  defaults: DIN_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = DIN_DEFAULTS;
    return { length: num(r.length, 40, 250, d.length), depth: pick(String(r.depth), ['7.5', '15'] as const, d.depth), stops: bool(r.stops, d.stops) };
  },
  layout(o, ctx) {
    const h = dinHeight(ctx);
    const m = backMounts(o.length, h, ctx, { kind: 'hook', rows: 1, columns: 1, left: true });
    addStuds(m, o.length, ctx, 2);
    return { w: o.length, h, depth: DIN.plate + +o.depth + (o.stops ? DIN.stopOut : 0), anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) => `DIN rail ${Math.round(o.length)} mm${o.depth === '15' ? ', 15 deep' : ''}`,
  backPlate(_o, l) {
    // Between the rail's walls (a module covers it: screw it on first), and above and below the rail.
    const yc = l.h / 2;
    const [a, b] = [DIN.hat / 2 - DIN.wall, DIN.width / 2];
    return [
      { x0: 0, x1: l.w, y0: yc - a, y1: yc + a, z: DIN.plate },
      { x0: 0, x1: l.w, y0: 0, y1: yc - b, z: DIN.plate },
      { x0: 0, x1: l.w, y0: yc + b, y1: l.h, z: DIN.plate },
    ];
  },
  notes: (o) => (o.length > 200 ? [`It prints standing on its end, ${Math.round(o.length)} mm tall: check your printer takes it.`] : []),
});
