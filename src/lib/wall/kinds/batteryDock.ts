/**
 * Battery dock: power-tool packs in a row of bays, held three ways:
 * - 'rail': a slide-rail receiver like the foot of a tool. Two inward-facing
 *   rails stand out from the back plate; the pack's own rails go under them
 *   and it slides down until it rests on the stop at the bottom, its latch
 *   clicking into a recess in the deck between the rails. Brands don't publish
 *   their rails, so the sizes are a generic profile to measure and adjust, and
 *   it prints fit coupons (a short length of the rails at three clearances) to
 *   try first.
 * - 'stem': a ledge with a socket the stem of a stem pack (Milwaukee M12, Ryobi
 *   ONE+) drops through, the pack upside down on top.
 * - 'body': a pocket the size of the pack, a low lip at the front: any pack.
 *
 * Printed upright as it hangs, so the rails are prisms standing on the bed
 * (no overhangs at all) and the stop or the ledge lies on the bed. Packs weigh
 * 0.6–1 kg, so every bay is at least 50 mm wide (two clip columns) and studs
 * go low on the back; the back plate is solid 5 mm all over, nothing cut
 * through it near the clips, so it can be bolted through as well.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type AttachmentPart, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface BatteryDockOptions {
  mode: 'rail' | 'stem' | 'body';
  /** Bays side by side. */
  count: number;
  /** The pack, mm: width across, depth out from the board (a slide pack's height, rails included; a stem pack's base front to back), length up the board. */
  packW: number;
  packD: number;
  packL: number;
  /** Rail receiver, mm: between the rails' tips, how far each reaches in, their thickness, room under them for the pack's rails, their length up from the stop. */
  spacing: number;
  railW: number;
  railT: number;
  groove: number;
  length: number;
  /** A recess the pack's latch clicks into, its middle this far up from the stop. */
  latch: 'recess' | 'none';
  latchAt: number;
  /** Stem socket, mm: across and front to back. */
  stemW: number;
  stemD: number;
  /** Added to every fit (each side), mm. */
  clearance: number;
  /** Fit coupons: a short length of the rails at three clearances, to try first. */
  coupons: boolean;
}

/** Milwaukee M18 (a starting point: see batteryDock.ui.ts). */
export const BATTERY_DOCK_DEFAULTS: BatteryDockOptions = {
  mode: 'rail',
  count: 1,
  packW: 79,
  packD: 71,
  packL: 114,
  spacing: 52,
  railW: 3,
  railT: 3.2,
  groove: 6,
  length: 80,
  latch: 'recess',
  latchAt: 68,
  stemW: 32,
  stemD: 24,
  clearance: 0.3,
  coupons: true,
};

/**
 * Back plate, the rails' side walls, the stop (up) and how far it reaches past the rails, gap between packs,
 * the ledge (stem) and floor (pocket), the pocket's walls and front lip, plastic round a socket; the latch
 * recess (across, up, deep); fit coupons' height and their clearance steps; mm.
 */
export const BATTERY = {
  back: 5,
  wall: 4,
  stop: 5,
  ledge: 12,
  gap: 6,
  stemLedge: 8,
  floor: 4,
  side: 2.4,
  lip: 25,
  edge: 4,
  latchW: 16,
  latchL: 14,
  latchD: 2.5,
  coupon: 20,
  step: 0.2,
} as const;

/**
 * The rail receiver's section at a clearance `c`: the channel's inside width and height, the gap between
 * the rails' tips, the rails' thickness, the receiver's width (with its walls) and how far out its front is.
 */
export function railSection(o: BatteryDockOptions, c = o.clearance) {
  const channel = o.spacing + 2 * o.railW + 2 * c;
  const room = o.groove + c;
  const rail = Math.max(1.6, o.railT - c);
  return { channel, room, gap: o.spacing + 2 * c, rail, width: channel + 2 * BATTERY.wall, front: BATTERY.back + room + rail };
}

/**
 * A bay's width, where the first starts, the part's width (the bays, or two clip columns a bay: two lattice
 * steps apart, and room for the outer clips' barbs), height and depth out from the board; a pocket's height.
 */
export function dockSize(o: BatteryDockOptions, ctx: MountCtx) {
  const c = o.clearance;
  const B = BATTERY;
  const body = o.mode === 'body';
  const bay = body ? o.packW + 2 * c : Math.max(o.packW + B.gap, o.mode === 'rail' ? railSection(o).width + B.gap : o.stemW + 2 * c + 2 * B.edge);
  const bays = body ? o.count * bay + (o.count + 1) * B.side : o.count * bay;
  const w = Math.max(bays, (2 * o.count - 1) * 2 * ctx.pitch + 10.5);
  const x0 = (w - bays) / 2;
  const cover = body ? Math.min(o.packL, Math.max(40, 0.6 * o.packL)) : 0;
  const h = body ? B.floor + cover : o.mode === 'stem' ? 60 : B.stop + o.length;
  const depth = body
    ? B.back + o.packD + 2 * c + B.side
    : o.mode === 'stem'
      ? B.back + Math.max(o.packD + 2 * c, o.stemD + 2 * c + 2 * B.edge) + B.edge
      : railSection(o).front + B.ledge;
  return { bay, x0, w, h: Math.max(h, minHeight(ctx)), depth, cover };
}

const NAMES = { rail: 'Battery dock', stem: 'Battery dock (stem)', body: 'Battery pocket' } as const;

registerAttachment<BatteryDockOptions>({
  type: 'batteryDock',
  defaults: BATTERY_DOCK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = BATTERY_DOCK_DEFAULTS;
    return {
      mode: pick(r.mode, ['rail', 'stem', 'body'] as const, d.mode),
      count: int(r.count, 1, 6, d.count),
      packW: num(r.packW, 30, 160, d.packW),
      packD: num(r.packD, 20, 160, d.packD),
      packL: num(r.packL, 40, 200, d.packL),
      spacing: num(r.spacing, 20, 100, d.spacing),
      railW: num(r.railW, 1, 8, d.railW),
      railT: num(r.railT, 1.6, 8, d.railT),
      groove: num(r.groove, 2, 15, d.groove),
      length: num(r.length, 30, 160, d.length),
      latch: pick(r.latch, ['recess', 'none'] as const, d.latch),
      latchAt: num(r.latchAt, 5, 160, d.latchAt),
      stemW: num(r.stemW, 10, 80, d.stemW),
      stemD: num(r.stemD, 10, 80, d.stemD),
      clearance: num(r.clearance, 0, 1.5, d.clearance),
      coupons: bool(r.coupons, d.coupons),
    };
  },
  layout(o, ctx) {
    const z = dockSize(o, ctx);
    const m = backMounts(z.w, z.h, ctx, { rows: 3 });
    return { w: z.w, h: z.h, depth: z.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `${NAMES[o.mode]}${o.count > 1 ? `, ${o.count} bays` : ''}`,
  notes(o, ctx) {
    const z = dockSize(o, ctx);
    const out = leverNotes(z.depth, z.h);
    if (o.mode === 'rail') {
      if (o.railT - o.clearance < 1.6) out.push('The rails are under 1.6 mm thick at this clearance: they may snap.');
      if (o.latch === 'recess' && o.latchAt + BATTERY.latchL / 2 > o.length)
        out.push('The latch recess is past the end of the rails: make them longer or move it down.');
    }
    if (z.w > 250) out.push("Over 250 mm wide: if it doesn't fit your printer, make two with fewer bays.");
    return out;
  },
  parts(o): AttachmentPart[] {
    if (o.mode !== 'rail' || !o.coupons) return [];
    // One, two and three notches: tighter, as set, looser.
    return [-1, 0, 1].map((k) => {
      const c = Math.max(0, o.clearance + k * BATTERY.step);
      const r = railSection(o, c);
      return {
        key: `coupon${k + 2}`,
        name: `Rail fit coupon (${Math.round(c * 100) / 100} mm)`,
        spec: { ...o, clearance: c, marks: k + 2 },
        w: r.width,
        d: r.front,
        h: BATTERY.coupon,
      };
    });
  },
});
