/**
 * Magnetic tool bar: a bar across the board with a row of magnets behind its
 * face, for knives, bits, screwdrivers, tweezers. Disc magnets (6 × 2 to
 * 18 × 1) or 60 × 10 × 5 bar magnets, either:
 * - glued in from the back: pockets open at the back of the bar, 1 mm of
 *   plastic in front of the magnet; they sit below the clips (which need the
 *   back solid), and the board behind keeps them in;
 * - sealed under a 0.4–0.6 mm skin: closed pockets just behind the face. The
 *   print pauses when the pockets are open at the top, the magnets drop in,
 *   and the layers above close them in (a pin-hole from the underside lets air
 *   out). The skin prints as one line, and the magnets hold harder through it.
 * The face can lean back up to 15° so tools rest against it, and a lip along
 * the foot catches what slides. Printed upright as it hangs: the pockets'
 * roofs are 45° (round magnets) or short bridges, so nothing needs support.
 * Clips across the top of the back, studs too on a tall bar.
 */
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { num, obj, pick, registerAttachment, type AttachmentHardware, type MountCtx } from '../registry';

export interface MagnetBarOptions {
  /** Across, and the face's height, mm. */
  length: number;
  height: number;
  /** Disc magnets (diameter × thickness) or bar magnets (length × height × thickness), mm. */
  shape: 'disc' | 'block';
  magD: number;
  magW: number;
  magT: number;
  /** Magnet centre to centre, mm (at least a magnet and 3 mm). */
  pitch: number;
  fix: 'glue' | 'skin';
  /** The sealed magnets' skin, mm. */
  skin: number;
  /** How far the face leans back, degrees. */
  angle: number;
  /** A lip along the foot, out from the face, mm (0 = none). */
  lip: number;
}

export const MAGNET_BAR_DEFAULTS: MagnetBarOptions = {
  length: 200,
  height: 30,
  shape: 'disc',
  magD: 10,
  magW: 10,
  magT: 3,
  pitch: 25,
  fix: 'glue',
  skin: 0.5,
  angle: 0,
  lip: 0,
};

/**
 * Clearance round a glued magnet (each side), round a sealed one, and on its thickness; plastic in front of a glued
 * magnet, behind a sealed one, glue room behind a glued one; the ends' margin; the vent's size; the lip's thickness
 * and how high its front stands; mm.
 */
export const MAG = { fit: 0.15, sealFit: 0.2, depth: 0.2, cover: 1, back: 1.5, room: 1, edge: 4, vent: 1.2, lipT: 3, lipUp: 4 } as const;

/** The row of magnets along the bar: each pocket's half-width, and the magnets' centres across. */
export function magnetRow(o: MagnetBarOptions) {
  const px = o.magD / 2 + (o.fix === 'glue' ? MAG.fit : MAG.sealFit);
  const P = Math.max(o.pitch, o.magD + 3);
  const n = Math.max(1, Math.floor((o.length - 2 * MAG.edge - 2 * px) / P + 1e-9) + 1);
  return { px, n, xs: Array.from({ length: n }, (_, i) => o.length / 2 + (i - (n - 1) / 2) * P) };
}

/** Where the magnets go and the bar's size. */
export function magnetPlan(o: MagnetBarOptions, ctx: MountCtx) {
  const glue = o.fix === 'glue';
  const disc = o.shape === 'disc';
  const { px, n, xs } = magnetRow(o);
  const tall = disc ? o.magD : o.magW;
  const mt = o.magT + MAG.depth;
  // A pocket about its magnet's centre: how far below and above (a glued disc's pocket has a 45° roof).
  const py0 = tall / 2 + (glue ? MAG.fit : MAG.sealFit);
  const py1 = glue && disc ? py0 * Math.SQRT2 : py0;
  const front = glue ? MAG.cover : o.skin;
  // The pocket's front, out from the back: the magnet's face rests on it.
  const zf = glue ? mt + MAG.room : MAG.back + mt;
  // Glued, the pockets open at the back go under the clips; sealed, anywhere.
  const clip = mountBox('clip', [0, 0], ctx);
  const need = glue ? MOUNT.margin + (clip.y1 - clip.y0) + 1 + py0 + py1 + 2 : py0 + py1 + 4;
  const H = Math.ceil(Math.max(o.height, minHeight(ctx), need));
  let m = backMounts(o.length, H, ctx, { rows: 2 });
  const yc = glue ? m.anchor[1] + clip.y0 - 1 - py1 : (H - py0 - py1) / 2 + py0;
  // Studs only where they keep clear of glued pockets.
  const stud = mountBox('stud', [0, 0], ctx);
  if (glue && m.mounts.some((s) => s.kind === 'stud' && m.anchor[1] + s.dj * ctx.pitch + stud.y1 > yc - py0 - 1)) m = backMounts(o.length, H, ctx, { rows: 1 });
  // The face leans back: as thin as `front` over the pockets' tops, at least 3 mm at the top.
  const tan = Math.tan((o.angle * Math.PI) / 180);
  const Tb = Math.max(zf + front + (yc + py1) * tan, 3 + H * tan);
  return { glue, disc, mt, px, py0, py1, front, zf, xs, n, yc, H, Tb, Tt: Tb - H * tan, tan, mounts: m, pause: Math.floor((yc + py1) * 10) / 10 };
}

const magnetName = (o: MagnetBarOptions) => (o.shape === 'disc' ? `${o.magD} × ${o.magT}` : `${o.magD} × ${o.magW} × ${o.magT}`);

registerAttachment<MagnetBarOptions>({
  type: 'magnetBar',
  defaults: MAGNET_BAR_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = MAGNET_BAR_DEFAULTS;
    return {
      length: num(r.length, 40, 400, d.length),
      height: num(r.height, 16, 80, d.height),
      shape: pick(r.shape, ['disc', 'block'] as const, d.shape),
      magD: num(r.magD, 3, 60, d.magD),
      magW: num(r.magW, 3, 20, d.magW),
      magT: num(r.magT, 1, 10, d.magT),
      pitch: num(r.pitch, 8, 100, d.pitch),
      fix: pick(r.fix, ['glue', 'skin'] as const, d.fix),
      skin: num(r.skin, 0.3, 1, d.skin),
      angle: num(r.angle, 0, 15, d.angle),
      lip: num(r.lip, 0, 20, d.lip),
    };
  },
  layout(o, ctx) {
    const p = magnetPlan(o, ctx);
    return { w: o.length, h: p.H, depth: p.Tb + o.lip, anchor: p.mounts.anchor, mounts: p.mounts.mounts, pose: 'upright' };
  },
  summary(o) {
    const n = magnetRow(o).n;
    return `Magnetic bar ${Math.round(o.length)} mm, ${n} magnet${n === 1 ? '' : 's'}`;
  },
  notes: (o, ctx) =>
    o.fix === 'skin' ? [`Pause the print at Z = ${magnetPlan(o, ctx).pause} mm, before the layer that closes the pockets, and drop the magnets in.`] : [],
  hardware(o): AttachmentHardware[] {
    return [
      {
        item: `Magnets ${magnetName(o)} mm (magnetic bar)`,
        count: magnetRow(o).n,
        note: o.fix === 'glue' ? 'glue them in from the back (superglue or epoxy): unglued magnets work loose' : 'dropped in at the print’s pause',
      },
    ];
  },
});
