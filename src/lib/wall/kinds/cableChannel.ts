/**
 * Cable channel: a raceway along the board, open at the top and at both
 * ends, with a snap-on lid. Printed upright, as it hangs: a U of plain walls
 * on its floor, so it needs no support. The lid prints flat; its two legs
 * reach down inside the walls and their beads click into grooves there.
 * Side exits are notches down the front wall (and the lid's front leg).
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, registerAttachment, type MountCtx } from '../registry';

export interface CableChannelOptions {
  length: number;
  /** Inside, out from the board and up, mm. */
  width: number;
  height: number;
  lid: boolean;
  /** A notch in the front wall every this many mm; 0: none. */
  exits: number;
}

export const CHANNEL_DEFAULTS: CableChannelOptions = { length: 200, width: 20, height: 15, lid: true, exits: 0 };

/** Walls (back, front, floor), lid clearance, plate and leg, the groove (down from the top, its height and depth), exit width. */
export const CH = { back: 2.4, wall: 2, floor: 2, c: 0.2, plate: 1.6, leg: 1.2, gTop: 5, gH: 1.4, gD: 0.5, exit: 12 } as const;

/** Height of the walls (the floor thickens to make room for the clips) and the outside depth. */
export function channelSize(o: CableChannelOptions, ctx: MountCtx) {
  return { H: Math.max(CH.floor + o.height, minHeight(ctx)), Z: CH.back + o.width + CH.wall };
}

/** Where the exits are along the channel (their centres). */
export function channelExits(o: CableChannelOptions): number[] {
  if (!o.exits) return [];
  const n = Math.floor((o.length - CH.exit - 8) / o.exits) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, k) => o.length / 2 + (k - (n - 1) / 2) * o.exits);
}

registerAttachment<CableChannelOptions>({
  type: 'cableChannel',
  defaults: CHANNEL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CHANNEL_DEFAULTS;
    const exits = num(r.exits, 0, 400, d.exits);
    return {
      length: num(r.length, 40, 400, d.length),
      width: num(r.width, 8, 80, d.width),
      height: num(r.height, 10, 60, d.height),
      lid: bool(r.lid, d.lid),
      exits: exits < 20 ? 0 : exits,
    };
  },
  layout(o, ctx) {
    const { H, Z } = channelSize(o, ctx);
    const m = backMounts(o.length, H, ctx, { rows: 2 });
    return { w: o.length, h: H, depth: Z, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Cable channel ${Math.round(o.length)} mm, ${Math.round(o.width)} × ${Math.round(o.height)}`,
  labelFace: (o, l) => (o.exits ? null : { x: 4, y: 1, w: l.w - 8, h: l.h - 2, z: l.depth, normal: 'front' }),
  backPlate: () => null,
  parts(o, ctx) {
    if (!o.lid) return [];
    const { H, Z } = channelSize(o, ctx);
    const spec = { length: o.length, H, Z, width: o.width, exits: channelExits(o) };
    // Printed upside down; it sits with its legs' ends one groove down the walls.
    const place = { at: [0, H - CH.gTop - CH.gH + CH.c, 0] as [number, number, number], turn: [90, 0, 0] as [number, number, number] };
    return [{ key: 'lid', name: 'Lid', spec, w: o.length, d: Z, h: CH.plate + CH.gTop + CH.gH, place }];
  },
});
