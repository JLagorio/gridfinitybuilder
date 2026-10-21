/**
 * Roll holder: two arms out from a back strip carry a rod for paper towels,
 * tape, a filament spool or thread. The rod's ends rest in open U pockets in
 * the arms' tips, closed on the outside so it can't slide out: lift it out to
 * change the roll. The rod is printed with it, or a dowel you cut to length.
 *
 * It prints upright, in one piece: the arms are fins standing on the bed with
 * the strip rising behind them, so their layers run along them, the way they
 * bend under the roll. (Arms printed on their side would be stronger still,
 * but two of them on one strip can't both lie on the bed.) Clips across the
 * top of the strip, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { num, obj, pick, registerAttachment, type AttachmentPart, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface RodOptions {
  /** Roll width: room between the arms, mm. */
  width: number;
  /** Roll diameter: sets how far out the rod is, mm. */
  diameter: number;
  rod: number;
  source: 'printed' | 'dowel';
  /** Back strip height, mm. */
  height: number;
}

export const ROD_DEFAULTS: RodOptions = { width: 120, diameter: 110, rod: 12, source: 'printed', height: 60 };

/**
 * Back strip thickness, arm thickness and the stop on the outside of each pocket, room each side of the roll,
 * room between the roll and the board, clearance round the rod in its pocket, wall round the pocket and under it, mm.
 */
export const ROD = { back: 3, arm: 6, stop: 2, side: 2, gap: 4, fit: 0.4, lip: 4, under: 4 } as const;

/** Where the rod is (its centre in the part's frame) and how long it is. */
export function rodGeometry(o: RodOptions) {
  const w = o.width + 2 * ROD.side + 2 * ROD.arm;
  const r = o.rod / 2;
  const pocket = r + ROD.fit;
  const z = ROD.back + Math.max(ROD.gap + o.diameter / 2, pocket + 2);
  return { w, r, pocket, y: ROD.under + pocket, z, reach: z + pocket + ROD.lip, length: w - 2 * ROD.stop - 1 };
}

/** The strip: as tall as asked, room for the clips, and above the pockets. */
function rodHeight(o: RodOptions, ctx: MountCtx): number {
  const g = rodGeometry(o);
  return Math.max(o.height, minHeight(ctx), g.y + g.pocket + 2);
}

/** How far below its axis the printed rod is cut flat to lie on the bed, as a share of its radius. */
export const ROD_FLAT = 0.6;

registerAttachment<RodOptions>({
  type: 'rod',
  defaults: ROD_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = ROD_DEFAULTS;
    return {
      width: num(r.width, 10, 300, d.width),
      diameter: num(r.diameter, 20, 250, d.diameter),
      rod: num(r.rod, 5, 40, d.rod),
      source: pick(r.source, ['printed', 'dowel'] as const, d.source),
      height: num(r.height, 25, 150, d.height),
    };
  },
  layout(o, ctx) {
    const g = rodGeometry(o);
    const h = rodHeight(o, ctx);
    const m = backMounts(g.w, h, ctx, { rows: 3 });
    return { w: g.w, h, depth: g.reach, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Roll holder ${Math.round(o.width)} × ⌀${Math.round(o.diameter)}`,
  notes(o, ctx) {
    const g = rodGeometry(o);
    const out = leverNotes(g.reach, rodHeight(o, ctx));
    if (o.source === 'printed' && g.length > 250) out.push(`The rod is ${Math.round(g.length)} mm long, more than most printers take: use a dowel.`);
    return out;
  },
  parts(o): AttachmentPart[] {
    if (o.source !== 'printed') return [];
    const g = rodGeometry(o);
    const flat = ROD_FLAT * g.r;
    // Printed lying along x, cut flat underneath; in use, flat side down, centred in its pockets.
    const place = { at: [ROD.stop + 0.5, g.y - flat, g.z - g.r] as [number, number, number], turn: [-90, 0, 0] as [number, number, number] };
    return [{ key: 'rod', name: 'Rod', spec: { r: g.r, length: g.length }, w: g.length, d: 2 * g.r, h: g.r + flat, place }];
  },
  hardware: (o) => (o.source === 'dowel' ? [{ item: `Dowel ⌀${o.rod} mm`, count: 1, note: `cut to ${Math.round(rodGeometry(o).length)} mm` }] : []),
});
