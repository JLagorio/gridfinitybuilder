/**
 * French cleat strip: a strip that clips on with a 45° bevel along its top,
 * low at the board and high at the front, so French-cleat tool holders hang
 * on it: their own cleat (the bevel under it) drops into the groove between
 * the bevel and the board, and the weight pulls it in against the board, so
 * it can't come off forward. `size` is the cleat's thickness out from the
 * board (19 mm for cleats cut from 3/4″ board, 12 for small printed ones),
 * `height` its back's height under the bevel. Printed upright, as it hangs:
 * it lies along the bed, and the bevel faces up and back, so it needs no
 * support. Clips across the back, studs below on a tall one.
 *
 * Its extra part, the hanger: a female cleat on the back of a plate, to
 * screw or glue a holder of your own to. It hooks over the strip 0.3 mm
 * clear and rests on the strip's front. It prints face down, its bevel
 * leaning 45°.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, registerAttachment, type AttachmentPart, type MountCtx } from '../registry';

export interface CleatStripOptions {
  length: number;
  /** The cleat's thickness out from the board, mm. */
  size: number;
  /** The back's height under the bevel, mm. */
  height: number;
  /** The bevel's angle from level, degrees (45 for standard cleats; the hanger prints face down up to 45). */
  angle: number;
  hanger: boolean;
}

export const CLEAT_DEFAULTS: CleatStripOptions = { length: 150, size: 19, height: 60, angle: 45, hanger: false };

/** The hanger: its width (at most), height, plate, clearance on the bevel, and how far its cleat reaches above the strip's top; mm. */
export const HANGER = { width: 60, height: 60, plate: 4, gap: 0.3, above: 10 } as const;

/** The flat on top of the bevel at the front (instead of a knife edge), mm. */
export const CLEAT_FLAT = 1;

/** The strip's profile: the back's height `hb`, the bevel's slope `tan` and how much it rises `rise` (up to the flat), and the top `h`. */
export function cleatProfile(o: CleatStripOptions, ctx: MountCtx) {
  const hb = Math.max(o.height, minHeight(ctx));
  const tan = Math.tan((o.angle * Math.PI) / 180);
  const rise = (o.size - CLEAT_FLAT) * tan;
  return { hb, tan, rise, h: hb + rise };
}

/** The hanger's width and where its front view's bottom-left is on the strip. */
export function hangerAt(o: CleatStripOptions, ctx: MountCtx) {
  const { h } = cleatProfile(o, ctx);
  const w = Math.min(HANGER.width, o.length);
  return { w, x: (o.length - w) / 2, y: h + HANGER.above - HANGER.height };
}

registerAttachment<CleatStripOptions>({
  type: 'cleatStrip',
  defaults: CLEAT_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CLEAT_DEFAULTS;
    return {
      length: num(r.length, 40, 300, d.length),
      size: num(r.size, 8, 25, d.size),
      height: num(r.height, 15, 120, d.height),
      angle: num(r.angle, 30, 45, d.angle),
      hanger: bool(r.hanger, d.hanger),
    };
  },
  layout(o, ctx) {
    const { hb, h } = cleatProfile(o, ctx);
    // The mounts stay on the back under the bevel.
    const m = backMounts(o.length, hb, ctx, { rows: 3 });
    return { w: o.length, h, depth: o.size, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `French cleat ${Math.round(o.length)} mm`,
  // Through the strip under the bevel (it is solid all through), the head flush with its front.
  backPlate: (o, l) => ({ x0: 0, x1: l.w, y0: 0, y1: l.h - (o.size - CLEAT_FLAT) * Math.tan((o.angle * Math.PI) / 180), z: o.size }),
  notes: (o) => (o.length > 250 ? ["Over 250 mm long: if it doesn't fit your printer, hang two strips end to end."] : []),
  parts(o, ctx) {
    if (!o.hanger) return [];
    const a = hangerAt(o, ctx);
    const p: AttachmentPart = { key: 'hanger', name: 'Cleat hanger', spec: o, w: a.w, d: HANGER.height, h: o.size + HANGER.gap + HANGER.plate };
    // Printed face down: half a turn about y stands it back up, its back on the board.
    return [{ ...p, place: { at: [a.x, a.y, 0], turn: [0, 180, 0] } }];
  },
  hardware: (o) => (o.hanger ? [{ item: 'Screws M4 (cleat hanger)', count: 2, note: 'to fix your holder to it' }] : []),
});
