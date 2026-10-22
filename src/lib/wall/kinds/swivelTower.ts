/**
 * Swivel tower: a stack of trays on a vertical axle between a bottom and a
 * top arm, each tray swinging out on its own. Closed, a tray lies along the
 * board, its back 1 mm off the back plate (it can't swing back into the
 * board); it swings forward up to half a turn. A collar round the axle on
 * each tray stands up past its rim by the spacer, so the trays stack on
 * their collars with that gap between them.
 *
 * The back plate, the arms and the axle's sockets print as one piece, upright
 * as it hangs: the bottom arm lies on the bed, the top arm's underside rises
 * at 45° from the back plate. A tray's body starts clear of the arms, so only
 * its collar passes under them. The axle prints lying down, cut flat under
 * (or it's a dowel or a bolt), and drops in from the top into a blind socket
 * in the bottom arm. Clips across the top of the back, studs below.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type AttachmentPart } from '../registry';
import { leverNotes } from './shelf';
import { KG } from '../load';

export interface SwivelTowerOptions {
  count: number;
  /** Each tray's height, mm. */
  trayH: number;
  /** A tray's length from the axle out, and its width front to back, mm. */
  length: number;
  width: number;
  /** The axle, mm, and what it is. */
  axle: number;
  source: 'printed' | 'dowel' | 'bolt';
  /** Gap between trays, mm. */
  spacer: number;
}

export const SWIVEL_DEFAULTS: SwivelTowerOptions = { count: 4, trayH: 25, length: 100, width: 60, axle: 8, source: 'printed', spacer: 2 };

/**
 * mm: back plate; the bottom arm's thickness (the socket 1 mm short of its bottom), the top arm's at its front; wall
 * round the axle in the arms, its clearance there; a collar's wall and its clearance on the axle; a tray's walls and
 * floor; the gap between a tray's body and the arms.
 */
export const SWIVEL = { back: 3, arm: 6, top: 4, boss: 3, snug: 0.15, collar: 2.5, free: 0.3, wall: 1.6, floor: 1.6, clear: 1.5 } as const;

/**
 * Where things are: the arms' and a collar's radius, a tray's half width, the axle (x, z), where tray k stands, how
 * high the collars stack, the top arm's underside at its front, the whole height and width, where a tray's body
 * starts (from the axle), and the axle's length.
 */
export function swivelPlan(o: SwivelTowerOptions) {
  const S = SWIVEL;
  const ra = o.axle / 2 + S.snug + S.boss;
  const rc = o.axle / 2 + S.free + S.collar;
  const b = o.width / 2;
  const xa = Math.max(ra, rc) + 1;
  const za = S.back + 1 + b;
  const pitch = o.trayH + o.spacer;
  const stack = S.arm + o.count * pitch;
  // Over the top collar's back the top arm's 45° underside clears it by 1 mm.
  const under = stack + 1 + ra + rc;
  const h = under + S.top;
  return {
    ra,
    rc,
    b,
    xa,
    za,
    y: (k: number) => S.arm + 0.1 + k * pitch,
    stack,
    under,
    h,
    w: xa + o.length + 1,
    body: ra + S.clear,
    axleL: Math.round((h - 1.1) * 10) / 10,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** How far up a printed axle is cut flat, as a share of its diameter. */
export const AXLE_FLAT = 0.2;

registerAttachment<SwivelTowerOptions>({
  type: 'swivelTower',
  defaults: SWIVEL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SWIVEL_DEFAULTS;
    return {
      count: int(r.count, 1, 8, d.count),
      trayH: num(r.trayH, 10, 75, d.trayH),
      length: num(r.length, 50, 200, d.length),
      width: num(r.width, 30, 120, d.width),
      axle: num(r.axle, 6, 16, d.axle),
      source: pick(r.source, ['printed', 'dowel', 'bolt'] as const, d.source),
      spacer: num(r.spacer, 1, 10, d.spacer),
    };
  },
  layout(o, ctx) {
    const p = swivelPlan(o);
    const h = Math.max(p.h, minHeight(ctx));
    const m = backMounts(p.w, h, ctx, { rows: 8 });
    // As deep as the arms: the trays stand out past them by half their width less the arms' radius.
    return { w: p.w, h, depth: p.za + p.ra, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Swivel tower, ${o.count} tray${o.count > 1 ? 's' : ''} ${Math.round(o.length)} × ${Math.round(o.width)}`,
  backPlate(o, l) {
    // Beside the arms, over the foot along the bottom: swing the trays out to reach it.
    const p = swivelPlan(o);
    return { x0: p.xa + p.ra, x1: l.w, y0: SWIVEL.arm, y1: l.h, z: SWIVEL.back };
  },
  notes(o) {
    const p = swivelPlan(o);
    const out = leverNotes(p.za + p.b, p.h);
    if (o.source === 'printed' && p.axleL > 250) out.push(`The axle is ${Math.round(p.axleL)} mm long, more than most printers take: use a dowel or a rod.`);
    if (o.length > 3 * o.width) out.push('Long trays: keep heavy things near the axle.');
    return out;
  },
  parts(o) {
    const p = swivelPlan(o);
    const turn: [number, number, number] = [-90, 0, 0];
    const out: AttachmentPart[] = [];
    for (let k = 0; k < o.count; k++)
      out.push({
        key: `t${k}`,
        name: 'Tray',
        spec: { ...o, p: 'tray' },
        w: r2(p.rc + o.length),
        d: r2(2 * p.b),
        h: r2(o.trayH + o.spacer - 0.2),
        place: { at: [r2(p.xa - p.rc), r2(p.y(k)), r2(p.za - p.b)], turn },
      });
    if (o.source === 'printed') {
      // Printed lying along x, cut flat underneath; in use upright, its flat to the board.
      const f = AXLE_FLAT * o.axle;
      out.push({
        key: 'axle',
        name: 'Axle',
        spec: { ...o, p: 'axle' },
        w: r2(p.axleL),
        d: o.axle,
        h: r2(o.axle - f),
        place: { at: [r2(p.xa - o.axle / 2), 1.1, r2(p.za - o.axle / 2 + f)], turn: [0, 0, 90] },
      });
    }
    return out;
  },
  hardware(o) {
    const L = `${Math.round(swivelPlan(o).axleL)} mm`;
    if (o.source === 'dowel') return [{ item: `Dowel ⌀${o.axle} mm`, count: 1, note: `cut to ${L}` }];
    if (o.source === 'bolt') return [{ item: `Threaded rod or bolt M${Math.round(o.axle)}`, count: 1, note: `${L} long` }];
    return [];
  },
  // Its trays full, swung out.
  load: (o) => ({ kg: o.count * o.trayH * o.length * o.width * KG.full, at: swivelPlan(o).za + o.length / 2 }),
});
