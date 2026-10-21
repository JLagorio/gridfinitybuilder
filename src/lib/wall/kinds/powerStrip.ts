/**
 * Power strip holder: a cradle for a power strip or a power brick, its back
 * on the board, a floor under it and a lip in front. As a tray the floor and
 * lip run its whole length; as brackets only its two ends have them (the
 * back plate joins them). End walls hold a strip of a set length, with a
 * notch for the cable at one end; slots in the floor take a strap around it.
 * Printed upright, as it hangs: a U on its floor, no support; clips and
 * studs all over the back plate.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';

export interface PowerStripOptions {
  /** The strip's size: out from the board, up, along the board (open ends: the holder's length), mm. */
  width: number;
  height: number;
  length: number;
  style: 'brackets' | 'tray';
  /** Open ends, or end walls with the cable's notch at the left or the right. */
  cable: 'open' | 'left' | 'right';
  /** Front lip height, mm. */
  lip: number;
  strap: boolean;
}

export const STRIP_DEFAULTS: PowerStripOptions = { width: 50, height: 40, length: 200, style: 'brackets', cable: 'open', lip: 12, strap: false };

/** Back, floor, front lip and end wall thickness, clearance round the strip, each bracket's length, the strap's slots. */
export const PS = { back: 4, floor: 3, front: 3, end: 3, c: 1, bracket: 32, strap: 22, slot: 3 } as const;

export function stripSize(o: PowerStripOptions, ctx: MountCtx) {
  return {
    L: o.cable === 'open' ? o.length : o.length + PS.c + 2 * PS.end,
    H: Math.max(PS.floor + o.height, minHeight(ctx)),
    Z: PS.back + o.width + PS.c + PS.front,
  };
}

registerAttachment<PowerStripOptions>({
  type: 'powerStrip',
  defaults: STRIP_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = STRIP_DEFAULTS;
    const height = num(r.height, 10, 150, d.height);
    return {
      width: num(r.width, 15, 150, d.width),
      height,
      length: num(r.length, 40, 400, d.length),
      style: pick(r.style, ['brackets', 'tray'] as const, d.style),
      cable: pick(r.cable, ['open', 'left', 'right'] as const, d.cable),
      lip: Math.min(height, num(r.lip, 4, 150, d.lip)),
      strap: bool(r.strap, d.strap),
    };
  },
  layout(o, ctx) {
    const { L, H, Z } = stripSize(o, ctx);
    const m = backMounts(L, H, ctx, { rows: 3 });
    return { w: L, h: H, depth: Z, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Power strip holder ${Math.round(o.width)} × ${Math.round(o.height)}`,
  hardware: (o) =>
    o.strap ? [{ item: 'Hook-and-loop strap, 20 mm wide', count: 2, note: `at least ${Math.ceil((2 * (o.width + o.height) + 40) / 10) * 10} mm long` }] : [],
});
