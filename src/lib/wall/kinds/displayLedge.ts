/**
 * Display ledge: stepped shelves for small things to show off, each tier a
 * step up and back from the one below (a stadium), with:
 * - studs: a LEGO-compatible stud plate (pitch 8, studs ⌀4.8 by 1.7, the
 *   diameter tunable ±0.1 mm) or Duplo (pitch 16, ⌀9.6); a fit coupon prints
 *   with it: three 2 × 2 patches 0.05 mm apart, told apart by notches;
 * - bases: round sockets for miniatures' bases (25 to 60 mm);
 * - cars: pockets for 1:64 die-cast cars side on (about 30 × 75);
 * - steps: Funko-style steps with a shallow pocket per figure.
 * A low lip along each tier's front if you like.
 *
 * Printed upright as it hangs: the bottom tier lies on the bed, each tier
 * above on its riser and the one behind, hollow underneath, the hollows' tops
 * 45° fillets and short bridges. Studs and pockets face up. Clips across the
 * top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type AttachmentPart, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export const LEDGE_MODES = ['studs', 'bases', 'cars', 'steps'] as const;

export interface DisplayLedgeOptions {
  mode: (typeof LEDGE_MODES)[number];
  /** Studs: LEGO or Duplo. */
  system: 'lego' | 'duplo';
  /** Across: studs, or things on each tier. */
  columns: number;
  /** Studs: rows of them, front to back. */
  rows: number;
  /** Studs: added to their diameter, mm. */
  tol: number;
  /** Bases: their diameter, mm. */
  base: number;
  /** Cars, steps: a thing's footprint across and front to back, mm. */
  itemW: number;
  itemD: number;
  /** Sockets and pockets: how deep, mm (0: flat). */
  recess: number;
  tiers: number;
  /** Each tier above the one below, mm. */
  rise: number;
  /** A lip along each tier's front, above it, mm (0: none). */
  lip: number;
}

export const LEDGE_DEFAULTS: DisplayLedgeOptions = {
  mode: 'studs',
  system: 'lego',
  columns: 12,
  rows: 2,
  tol: 0,
  base: 32,
  itemW: 75,
  itemD: 32,
  recess: 1.5,
  tiers: 2,
  rise: 24,
  lip: 0,
};

/** Studs: pitch, diameter and height, mm. */
export const STUDS = { lego: { pitch: 8, d: 4.8, h: 1.7 }, duplo: { pitch: 16, d: 9.6, h: 4.5 } } as const;

/** Back plate, the lip's thickness, the backstop behind the top tier, the end walls; the widest cell under a tread and the most it bridges; mm. */
export const LEDGE = { back: 3, lip: 2, stop: 10, end: 2, cell: 20, bridge: 8 } as const;

/**
 * Sizes, mm: a column's width `cw`, the tread's content front to back and the
 * margin round it, the tread `t` thick at its nose, each tier's depth `tread`,
 * the width, the top tier's tread height and the depth out from the board.
 */
export function ledgePlan(o: DisplayLedgeOptions) {
  const studs = o.mode === 'studs';
  const P = STUDS[o.system].pitch;
  const cw = studs ? P : (o.mode === 'bases' ? o.base : o.itemW) + 4;
  const content = studs ? o.rows * P : (o.mode === 'bases' ? o.base : o.itemD) + 1;
  const m = studs ? 0 : 2.5;
  const lipT = o.lip > 0 ? LEDGE.lip : 0;
  const t = Math.max(3, (studs ? 0 : o.recess) + 2);
  const tread = content + 2 * m + lipT;
  return {
    cw,
    content,
    m,
    lipT,
    t,
    tread,
    w: Math.max(20, o.columns * cw + (studs ? 0 : 4)),
    top: t + (o.tiers - 1) * o.rise,
    depth: LEDGE.back + o.tiers * tread,
  };
}

const ledgeHeight = (o: DisplayLedgeOptions, ctx: MountCtx) => Math.max(minHeight(ctx), ledgePlan(o).top + Math.max(o.lip, LEDGE.stop));

const NAMES = { bases: 'Base display', cars: 'Car display', steps: 'Display steps' };

registerAttachment<DisplayLedgeOptions>({
  type: 'displayLedge',
  defaults: LEDGE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = LEDGE_DEFAULTS;
    return {
      mode: pick(r.mode, LEDGE_MODES, d.mode),
      system: pick(r.system, ['lego', 'duplo'] as const, d.system),
      columns: int(r.columns, 1, 30, d.columns),
      rows: int(r.rows, 1, 8, d.rows),
      tol: Math.round(num(r.tol, -0.1, 0.1, d.tol) * 100) / 100,
      base: num(r.base, 15, 80, d.base),
      itemW: num(r.itemW, 15, 200, d.itemW),
      itemD: num(r.itemD, 10, 150, d.itemD),
      recess: num(r.recess, 0, 4, d.recess),
      tiers: int(r.tiers, 1, 6, d.tiers),
      rise: num(r.rise, 6, 120, d.rise),
      lip: num(r.lip, 0, 20, d.lip),
    };
  },
  layout(o, ctx) {
    const p = ledgePlan(o);
    const h = ledgeHeight(o, ctx);
    const m = backMounts(p.w, h, ctx, { rows: 3 });
    return { w: p.w, h, depth: p.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary(o) {
    const tiers = o.tiers > 1 ? `, ${o.tiers} tiers` : '';
    if (o.mode === 'studs') return `${o.system === 'lego' ? 'LEGO' : 'Duplo'} stud ledge ${o.columns} × ${o.rows}${tiers}`;
    return `${NAMES[o.mode]} ${o.mode === 'bases' ? `⌀${+o.base.toFixed(1)} × ${o.columns}` : `${o.columns} wide`}${tiers}`;
  },
  labelFace(o, l) {
    // The bottom tier's front, with its lip.
    const p = ledgePlan(o);
    const h = p.t + (p.lipT ? o.lip : 0);
    return h >= 6 ? { x: LEDGE.end, y: 0.6, w: p.w - 2 * LEDGE.end, h: h - 1.2, z: l.depth, normal: 'front' } : null;
  },
  // The tiers stand in front of the back up to the top one, and the clips take the strip over it.
  backPlate: () => null,
  notes: (o, ctx) => leverNotes(ledgePlan(o).depth, ledgeHeight(o, ctx)),
  parts(o): AttachmentPart[] {
    if (o.mode !== 'studs') return [];
    const P = STUDS[o.system].pitch;
    // Three 2 × 2 patches on one strip, 2 mm apart.
    return [{ key: 'coupon', name: 'Stud fit coupon', spec: { system: o.system, tol: o.tol }, w: 6 * P + 4, d: 2 * P, h: 3.2 + STUDS[o.system].h }];
  },
});
