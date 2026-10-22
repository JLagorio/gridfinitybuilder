/**
 * Headphone & controller hanger, in two shapes:
 * - Saddle: an arm out from the board whose top is a wide curve across (up to
 *   75 mm), so a headband rests along a long stretch of it instead of an edge
 *   and doesn't dent; the cups hang left and right of it. A lip at the front
 *   end; up to three saddles one behind the other along the arm, low ridges
 *   between them; a cable cleat under the arm and a small shelf at the foot of
 *   the back if you like. Printed on its side: the profile lies on the bed, so
 *   the arm's layers run along it, and the curve across rises at 45° at most.
 *   A pegboard hook at the top of the back, studs below it.
 * - Yoke: two prongs with a gap between and upturned tips. A guitar or
 *   ukulele hangs by its headstock, the neck between the prongs; a game
 *   controller stands on them by its grips, leaning back. Two prongs side by
 *   side can't lie in one profile, so it prints upright: the prongs lie on the
 *   bed at the foot of the back, the tips and the 45° gussets stand on them.
 *   Clips across the top of the back, studs low on it; a heavy load (a guitar)
 *   gets a taller back and a third row of mounts.
 */
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface SaddleOptions {
  mode: 'saddle' | 'yoke';
  /** Out from the board: the arm (saddle) or the prongs (yoke), mm. */
  reach: number;
  /** Saddle: across (left to right), the radius of its curve across, and the headband's width it takes (along the arm), mm. */
  width: number;
  radius: number;
  band: number;
  /** Saddle: how many, one behind the other along the arm. */
  count: number;
  /** Saddle: the front lip's height above the saddle, mm. */
  lip: number;
  /** Arm or prong thickness (top to bottom), mm. */
  arm: number;
  /** Saddle: a cable cleat under the arm. */
  cleat: boolean;
  /** Saddle: a small shelf at the foot of the back, out from the board, mm (0 = none). */
  shelf: number;
  /** Yoke: the gap between the prongs and each prong's width, mm; how far they point up, degrees; the tips' height, mm. */
  gap: number;
  prong: number;
  tilt: number;
  tip: number;
  /** Yoke: a groove along each prong's top for a felt strip. */
  pad: boolean;
  /** Yoke: built for a heavy load (a guitar): a taller back and three rows of mounts. */
  heavy: boolean;
  /** Back height (at least), mm. */
  height: number;
}

export const SADDLE_DEFAULTS: SaddleOptions = {
  mode: 'saddle',
  reach: 90,
  width: 50,
  radius: 70,
  band: 60,
  count: 1,
  lip: 10,
  arm: 8,
  cleat: false,
  shelf: 0,
  gap: 46,
  prong: 14,
  tilt: 5,
  tip: 12,
  pad: false,
  heavy: false,
  height: 60,
};

/**
 * Back plate thickness, front lip thickness, room each saddle leaves round its band, the highest ridge between
 * saddles, the cleat's drop under the arm, the shelf's floor and lip, the room above the shelf, a tip's thickness
 * and the felt groove's width and depth; mm.
 */
export const SADDLE = { back: 4, lipT: 4, fit: 4, ridge: 6, cleat: 16, floor: 3, shelfLip: 8, room: 30, tipT: 6, groove: 8.4, grooveD: 1.5 } as const;

/** The least height of a back with a pegboard hook and a stud below it (side-printed parts that carry a load). */
export const hookAndStud = (ctx: MountCtx) => Math.ceil(mountBox('hook', [0, 0], ctx).y1 - mountBox('stud', [0, -2 * ctx.pitch], ctx).y0 + 2 * MOUNT.margin);

/** How far the saddle's top drops `u` from its middle across: an arc of `r`, then 45° (so it prints on its side without support). */
export function saddleSag(u: number, r: number): number {
  const uc = r / Math.SQRT2;
  const a = Math.abs(u);
  return a <= uc ? r - Math.sqrt(r * r - a * a) : r - uc + (a - uc);
}

/** The saddle's shape: the arm's length, each saddle's span along it (from the board out), the ridges' height, the crown's drop at the edges. */
export function saddleRun(o: SaddleOptions) {
  const seat = o.band + SADDLE.fit;
  const rh = Math.min(o.lip, SADDLE.ridge);
  const run = o.count * seat + (o.count - 1) * 2 * rh;
  const D = Math.max(o.reach, SADDLE.back + run + SADDLE.lipT);
  const seats: [number, number][] = [];
  for (let k = o.count - 1; k >= 0; k--) {
    const z1 = D - SADDLE.lipT - k * (seat + 2 * rh);
    seats.push([z1 - seat, z1]);
  }
  return { D, seats, rh, sag: saddleSag(o.width / 2, o.radius) };
}

/** Saddle: the 45° brace under the arm, how far the back drops below the crown to the arm's foot, and the back's height. */
export function saddleStack(o: SaddleOptions, ctx: MountCtx) {
  const r = saddleRun(o);
  const top = Math.max(o.lip, r.rh);
  const brace = Math.min(30, 0.4 * (r.D - SADDLE.back));
  const below = top + o.arm + r.sag + Math.max(brace, o.cleat ? SADDLE.cleat : 0);
  const H = Math.ceil(Math.max(o.height, hookAndStud(ctx), below + (o.shelf > 0 ? SADDLE.floor + SADDLE.room : 2)));
  return { ...r, top, brace, H, crown: H - top };
}

/** Yoke: the prongs' top line (height at `z` out from the board), the gusset, and the back's height. */
export function yokeShape(o: SaddleOptions, ctx: MountCtx) {
  const D = o.reach;
  const t = Math.tan((o.tilt * Math.PI) / 180);
  const top = (z: number) => o.arm + Math.max(0, z - SADDLE.back) * t;
  const tipTop = top(D) + o.tip;
  const H = Math.ceil(Math.max(o.height, minHeight(ctx), o.heavy ? 100 : 0, tipTop, o.arm + 12));
  const gusset = Math.min(35, 0.35 * (D - SADDLE.back - SADDLE.tipT), H - o.arm - 2);
  return { D, t, top, tipTop, H, gusset, w: 2 * o.prong + o.gap };
}

const saddleWidth = (o: SaddleOptions, ctx: MountCtx) => Math.max(o.width, 2 * mountBox('stud', [0, 0], ctx).x1);

registerAttachment<SaddleOptions>({
  type: 'saddle',
  defaults: SADDLE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SADDLE_DEFAULTS;
    return {
      mode: pick(r.mode, ['saddle', 'yoke'] as const, d.mode),
      reach: num(r.reach, 30, 200, d.reach),
      width: num(r.width, 20, 75, d.width),
      radius: num(r.radius, 20, 200, d.radius),
      band: num(r.band, 10, 80, d.band),
      count: int(r.count, 1, 3, d.count),
      lip: num(r.lip, 0, 30, d.lip),
      arm: num(r.arm, 5, 20, d.arm),
      cleat: bool(r.cleat, d.cleat),
      shelf: num(r.shelf, 0, 80, d.shelf),
      gap: num(r.gap, 20, 200, d.gap),
      prong: num(r.prong, 8, 30, d.prong),
      tilt: num(r.tilt, 0, 30, d.tilt),
      tip: num(r.tip, 0, 40, d.tip),
      pad: bool(r.pad, d.pad),
      heavy: bool(r.heavy, d.heavy),
      height: num(r.height, 20, 200, d.height),
    };
  },
  layout(o, ctx) {
    if (o.mode === 'yoke') {
      const y = yokeShape(o, ctx);
      const m = backMounts(y.w, y.H, ctx, { rows: o.heavy ? 3 : 2 });
      return { w: y.w, h: y.H, depth: y.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
    }
    const st = saddleStack(o, ctx);
    const w = saddleWidth(o, ctx);
    const m = backMounts(w, st.H, ctx, { kind: 'hook', rows: 3, columns: 1, left: true });
    return { w, h: st.H, depth: Math.max(st.D, o.shelf), anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) =>
    o.mode === 'yoke'
      ? `${o.heavy ? 'Guitar' : 'Yoke'} hanger, ${Math.round(o.gap)} mm gap`
      : `Headphone hanger${o.count > 1 ? ` × ${o.count}` : ` ${Math.round(o.width)} mm`}`,
  notes(o, ctx) {
    if (o.mode === 'yoke') {
      const y = yokeShape(o, ctx);
      const out = leverNotes(y.D, y.H);
      if (o.heavy) out.push('Carries 3–4 kg: print it in PETG or ASA with 5 walls and 40% infill, and screw the board to the wall.');
      return out;
    }
    const st = saddleStack(o, ctx);
    const out = leverNotes(st.D, st.H);
    const rear = (st.seats[0][0] + st.seats[0][1]) / 2;
    if (rear < 45)
      out.push(`The ${o.count > 1 ? 'back saddle is' : 'saddle is'} only ${Math.round(rear)} mm out: ear cups may touch the board. Reach further out.`);
    return out;
  },
  hardware: (o) =>
    o.mode === 'yoke' && o.pad
      ? [{ item: 'Self-adhesive felt strip, 8 mm wide', count: 2, note: `${Math.round(o.reach - SADDLE.tipT)} mm each, in the prongs’ grooves` }]
      : [],
});
