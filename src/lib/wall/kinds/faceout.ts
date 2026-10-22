/**
 * Faceout: a long arm sloping up a little, as on shop slatwall, for bagged
 * parts, spools and cards on hang tabs: an upturned tip or a knob at the end
 * keeps them on, notches along the top (a waterfall) keep each in its place,
 * and a label plate at the tip, as on a scanning hook, says what's on it.
 *
 * Printed on its side, the profile flat on the bed, so the arm's layers run
 * its whole length and it bends rather than snaps; a pegboard hook at the top
 * of the back plate holds it on, studs below it. The back plate is at least a
 * third as tall as the arm is long, so it can't lever itself off; a gusset
 * stiffens the root. The label plate stands on the bed beside the arm's tip,
 * to its right.
 */
import { MOUNT, backMounts, mountBox } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';

export interface FaceoutOptions {
  /** Out from the board, mm. */
  length: number;
  /** How far it slopes up, degrees. */
  angle: number;
  /** The arm across (left to right) and top to bottom, mm. */
  width: number;
  arm: number;
  /** Notches along the top. */
  notches: number;
  stopper: 'none' | 'tip' | 'ball';
  /** A label plate at the tip (in place of the stopper), and its width, mm. */
  label: boolean;
  labelW: number;
}

export const FACEOUT_DEFAULTS: FaceoutOptions = { length: 150, angle: 10, width: 8, arm: 6, notches: 0, stopper: 'tip', label: false, labelW: 40 };

/** Back plate thickness, the label plate's height and thickness, mm. */
export const FACEOUT = { back: 4, labelH: 25, labelT: 2.4 } as const;

/**
 * The arm in side view, mm: its top `top(z)` and bottom `bottom(z)` at z out
 * from the board, the upturned tip's height, the knob's radius, and the
 * highest point; the back plate's height and how wide it is.
 */
export function faceoutPlan(o: FaceoutOptions, ctx: MountCtx) {
  const tan = Math.tan((o.angle * Math.PI) / 180);
  const P = FACEOUT.back;
  const L = o.length;
  const bottom = (z: number) => (z - P) * tan;
  const top = (z: number) => bottom(z) + o.arm;
  const tip = Math.max(5, 0.8 * o.arm + 2);
  const knob = 0.75 * o.arm;
  const end = o.label ? bottom(L) + FACEOUT.labelH : o.stopper === 'tip' ? top(L) + tip : o.stopper === 'ball' ? top(L) + 0.8 * knob : top(L);
  // Room for the hook and a stud two slots below it, and a third of the arm's length.
  const two = mountBox('hook', [0, 0], ctx).y1 - mountBox('stud', [0, -2 * ctx.pitch], ctx).y0 + 2 * MOUNT.margin;
  return {
    top,
    bottom,
    tip,
    knob,
    h: Math.ceil(Math.max(two, L / 3 + 1, end)),
    bw: Math.max(o.width, 2 * mountBox('hook', [0, 0], ctx).x1),
  };
}

registerAttachment<FaceoutOptions>({
  type: 'faceout',
  defaults: FACEOUT_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = FACEOUT_DEFAULTS;
    return {
      length: num(r.length, 50, 250, d.length),
      angle: num(r.angle, 0, 30, d.angle),
      width: num(r.width, 4, 16, d.width),
      arm: num(r.arm, 4, 14, d.arm),
      notches: int(r.notches, 0, 12, d.notches),
      stopper: pick(r.stopper, ['none', 'tip', 'ball'] as const, d.stopper),
      label: bool(r.label, d.label),
      labelW: num(r.labelW, 20, 80, d.labelW),
    };
  },
  layout(o, ctx) {
    const p = faceoutPlan(o, ctx);
    const w = Math.max(p.bw, o.label ? o.labelW : 0);
    const m = backMounts(w, p.h, ctx, { kind: 'hook', rows: 3, columns: 1, left: true });
    return { w, h: p.h, depth: o.length, anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) => `Faceout ${Math.round(o.length)} mm${o.notches ? `, ${o.notches} notches` : ''}`,
  notes(o) {
    const out: string[] = [];
    if (o.length > 30 * o.arm) out.push('A long thin arm bends under weight: make it thicker or shorter.');
    if (!o.label && o.stopper === 'none' && o.angle < 5) out.push('Nothing keeps things on the end: add a stopper or slope it up.');
    return out;
  },
  hardware: (o) => (o.label ? [{ item: 'Label', count: 1, note: `${Math.round(o.labelW)} × ${FACEOUT.labelH} mm` }] : []),
});
