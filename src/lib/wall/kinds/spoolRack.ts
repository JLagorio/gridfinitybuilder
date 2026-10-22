/**
 * Spool rack: spools side by side on one axle, for hookup wire, solder,
 * heat-shrink, tape, ribbon or filament; or, for sewing thread, upright pegs
 * the spools stand on. The roll holder's idea (rod.ts) made wider and closed
 * at the front:
 * - Axle: two arms out from a back strip hold the axle in open U pockets,
 *   closed on the outside so it can't slide out (lift it to change a spool).
 *   It is printed alongside, a dowel you cut, or an 8 mm rod turning in two
 *   608 bearings that drop into the pockets. Hubs centre spools with a big
 *   bore (filament) on a thin axle. A guard joins the arms' tips in front of
 *   the spools: a feed hole in it before each spool, teeth along its top to
 *   tear tape on. The spools stand clear of the part's bottom, so what is
 *   planned on the board is what the rack takes.
 * - Pegs: a shelf with a peg for each spool, in rows.
 *
 * Printed upright as it hangs: the arms are fins standing on the bed with the
 * strip rising behind them, the guard a wall standing on it, the feed holes
 * pointed at the top; pegs stand straight up. Clips across the top of the
 * strip, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type AttachmentHardware, type AttachmentPart, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface SpoolRackOptions {
  mode: 'axle' | 'pegs';
  /** A spool: diameter, width (pegs: its height) and bore, mm. */
  diameter: number;
  width: number;
  bore: number;
  count: number;
  /** Pegs: rows front to back. */
  rows: number;
  axle: 'printed' | 'dowel' | 'bearings';
  /** Axle diameter, mm (bearings: an 8 mm rod). */
  rod: number;
  /** A hub each side of each spool, to centre it on the axle. */
  hubs: boolean;
  /** A guard across the front, joining the arms. */
  guard: boolean;
  /** A feed hole in the guard before each spool, mm (0: none). */
  eyelet: number;
  /** Teeth along the guard's top. */
  teeth: boolean;
  /** Back strip height, mm. */
  height: number;
}

export const SPOOL_DEFAULTS: SpoolRackOptions = {
  mode: 'axle',
  diameter: 64,
  width: 24,
  bore: 20,
  count: 4,
  rows: 1,
  axle: 'printed',
  rod: 16,
  hubs: false,
  guard: true,
  eyelet: 4,
  teeth: false,
  height: 60,
};

/**
 * Back strip, arm (with bearings), stop on the outside of a pocket, room each side of a spool, between the
 * spools and the board, under them and in front of them, clearance round the axle, wall round a pocket,
 * guard thickness, a hub's flange; a 608 bearing's diameter and width; mm.
 */
export const SPOOL = {
  back: 3,
  arm: 6,
  armB: 10,
  stop: 2,
  side: 2,
  gap: 4,
  under: 2,
  front: 3,
  fit: 0.4,
  lip: 4,
  guard: 2.4,
  flange: 2,
  bd: 22,
  bw: 7,
} as const;

/** The teeth along the guard's top: pitch and height, mm. */
export const SPOOL_TEETH = { p: 3, h: 1.5 } as const;

/** How far below its axis a printed axle is cut flat to lie on the bed, as a share of its radius. */
export const SPOOL_FLAT = 0.6;

/**
 * The rack on an axle, mm: arm thickness, a spool's room along the axle, the
 * width, the axle's radius and its pocket's, the axle's centre (z out, y up),
 * the arms' height at the pockets, the guard's back face and height, the
 * feed holes' height and centres (x), the reach and the axle's length.
 */
export function spoolPlan(o: SpoolRackOptions) {
  const bear = o.axle === 'bearings';
  const arm = bear ? SPOOL.armB : SPOOL.arm;
  const slot = o.width + (o.hubs ? 2 * SPOOL.flange : 0);
  const w = o.count * slot + (o.count + 1) * SPOOL.side + 2 * arm;
  const r = bear ? 4 : o.rod / 2;
  const pocket = bear ? SPOOL.bd / 2 + 0.15 : r + SPOOL.fit;
  const R = o.diameter / 2;
  const zc = SPOOL.back + SPOOL.gap + R;
  const yc = Math.max(SPOOL.under + R, pocket + 3);
  const zg = zc + R + SPOOL.front;
  const hg = yc + (o.eyelet ? o.eyelet / 2 + 5 : 0);
  const xs = Array.from({ length: o.count }, (_, k) => arm + SPOOL.side + slot / 2 + k * (slot + SPOOL.side));
  return {
    arm,
    slot,
    w,
    r,
    pocket,
    zc,
    yc,
    yp: yc + pocket,
    zg,
    hg,
    xs,
    reach: o.guard ? zg + SPOOL.guard : zc + pocket + SPOOL.lip,
    length: w - 2 * SPOOL.stop - 1,
  };
}

/** Pegs: spacing both ways, the first row's centre out from the board, peg radius and height, the shelf's width and depth; mm. */
export function pegPlan(o: SpoolRackOptions) {
  const p = o.diameter + 4;
  const z0 = SPOOL.back + 3 + p / 2;
  return { p, z0, r: Math.max(1.5, (o.bore - 0.8) / 2), h: Math.max(8, 0.8 * o.width), w: o.count * p + 6, d: z0 + (o.rows - 0.5) * p + 2 };
}

/** The strip: as tall as asked, room for the clips, and over the pockets and the spools' tops (the board sees all of it). */
const spoolHeight = (o: SpoolRackOptions, ctx: MountCtx) => {
  const g = spoolPlan(o);
  return Math.max(o.height, minHeight(ctx), o.mode === 'pegs' ? 13 : Math.max(g.yp + 2, g.yc + o.diameter / 2 + 1));
};

registerAttachment<SpoolRackOptions>({
  type: 'spoolRack',
  defaults: SPOOL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SPOOL_DEFAULTS;
    const diameter = num(r.diameter, 20, 260, d.diameter);
    return {
      mode: pick(r.mode, ['axle', 'pegs'] as const, d.mode),
      diameter,
      width: num(r.width, 5, 150, d.width),
      bore: num(r.bore, 3, Math.min(80, diameter - 6), d.bore),
      count: int(r.count, 1, 12, d.count),
      rows: int(r.rows, 1, 4, d.rows),
      axle: pick(r.axle, ['printed', 'dowel', 'bearings'] as const, d.axle),
      rod: num(r.rod, 5, 40, d.rod),
      hubs: bool(r.hubs, d.hubs),
      guard: bool(r.guard, d.guard),
      eyelet: num(r.eyelet, 0, 12, d.eyelet),
      teeth: bool(r.teeth, d.teeth),
      height: num(r.height, 25, 200, d.height),
    };
  },
  layout(o, ctx) {
    const h = spoolHeight(o, ctx);
    if (o.mode === 'pegs') {
      const g = pegPlan(o);
      const m = backMounts(g.w, h, ctx, { rows: 2 });
      return { w: g.w, h, depth: g.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
    }
    const g = spoolPlan(o);
    const m = backMounts(g.w, h, ctx, { rows: 3 });
    return { w: g.w, h, depth: g.reach, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => (o.mode === 'pegs' ? `Thread rack, ${o.count * o.rows} pegs` : `Spool rack, ${o.count} × ⌀${Math.round(o.diameter)}`),
  labelFace(o, l) {
    // The guard (under its feed holes).
    if (o.mode === 'pegs' || !o.guard) return null;
    const g = spoolPlan(o);
    const h = Math.min(12, (o.eyelet ? g.yc - o.eyelet / 2 : g.hg) - 2);
    return h >= 5 ? { x: 2, y: 1, w: l.w - 4, h, z: g.reach, normal: 'front' } : null;
  },
  backPlate(o, l) {
    // Pegs: over them, between the end gussets. An axle: between the arms, over the guard (and its teeth); the spools
    // lift out with the axle.
    if (o.mode === 'pegs') {
      const g = pegPlan(o);
      return { x0: 3, x1: l.w - 3, y0: 3 + g.h, y1: l.h, z: SPOOL.back };
    }
    const g = spoolPlan(o);
    return { x0: g.arm, x1: l.w - g.arm, y0: o.guard ? g.hg + (o.teeth ? SPOOL_TEETH.h : 0) : 0, y1: l.h, z: SPOOL.back };
  },
  notes(o, ctx) {
    if (o.mode === 'pegs') return pegPlan(o).r < 2 ? ['Pegs under 4 mm thick snap easily: print them in PETG, or with more walls.'] : [];
    const g = spoolPlan(o);
    const out = leverNotes(g.reach, spoolHeight(o, ctx));
    const axle = 2 * g.r;
    if (axle > o.bore - 0.5 && !o.hubs) out.push(`The axle (⌀${axle}) doesn't go through the spools' ${o.bore} mm bore: pick a thinner one.`);
    else if (o.bore > axle + 12 && !o.hubs) out.push('The spools will wobble on the axle: turn hubs on to centre them.');
    if (o.axle === 'printed' && g.length > 250) out.push(`The axle is ${Math.round(g.length)} mm long, more than most printers take: use a dowel.`);
    return out;
  },
  parts(o): AttachmentPart[] {
    if (o.mode === 'pegs') return [];
    const g = spoolPlan(o);
    const out: AttachmentPart[] = [];
    if (o.axle === 'printed') {
      const flat = SPOOL_FLAT * g.r;
      // Printed lying along x, cut flat underneath; in use, flat side down, its ends in the pockets.
      const place = { at: [SPOOL.stop + 0.5, g.yc - flat, g.zc - g.r] as [number, number, number], turn: [-90, 0, 0] as [number, number, number] };
      out.push({ key: 'axle', name: 'Axle', spec: { p: 'axle', r: g.r, length: g.length }, w: g.length, d: 2 * g.r, h: g.r + flat, place });
    }
    if (o.hubs) {
      // Flange down; in use, either side of a spool, the boss in its bore.
      const f = Math.min(o.bore + 8, o.diameter - 2);
      const boss = Math.min(10, o.width / 2 - 1);
      const spec = { p: 'hub', f, bore: o.bore, hole: 2 * g.r + 0.6, boss };
      g.xs.forEach((x, k) => {
        for (const s of [0, 1]) {
          const place = {
            at: [s ? x + o.width / 2 - boss : x - o.width / 2 - SPOOL.flange, g.yc - f / 2, g.zc - f / 2] as [number, number, number],
            turn: [0, s ? -90 : 90, 0] as [number, number, number],
          };
          out.push({ key: `hub${k}${s}`, name: 'Hub', spec, w: f, d: f, h: SPOOL.flange + boss, place });
        }
      });
    }
    return out;
  },
  hardware(o): AttachmentHardware[] {
    if (o.mode === 'pegs') return [];
    const cut = `cut to ${Math.round(spoolPlan(o).length)} mm`;
    if (o.axle === 'dowel') return [{ item: `Dowel ⌀${o.rod} mm`, count: 1, note: cut }];
    if (o.axle === 'bearings')
      return [
        { item: '608 bearing (22 × 8 × 7 mm)', count: 2 },
        { item: 'Rod ⌀8 mm (smooth, or M8 threaded)', count: 1, note: cut },
      ];
    return [];
  },
});
