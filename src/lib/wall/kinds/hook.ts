/**
 * Hooks: J, L, U, double and peg hooks, printed on their side so the arm's
 * layers run along it. A pegboard hook at the top of the back plate holds it
 * on; a stud two slots below keeps it from tilting.
 */
import { MOUNT, backMounts, mountBox } from '../mount';
import { num, obj, pick, registerAttachment, type MountCtx } from '../registry';

export const HOOK_STYLES = ['j', 'l', 'u', 'double', 'peg'] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

export interface HookOptions {
  style: HookStyle;
  /** How far it reaches out from the board, mm. */
  reach: number;
  /** Thickness across (left to right), mm. */
  width: number;
  /** Thickness of the arm (top to bottom), mm. */
  arm: number;
  /** Height of the upturned tip (J, double) or the cradle (U), mm. */
  tip: number;
  /** L and peg hooks: how far the arm points up, degrees. */
  angle: number;
  /** Double hooks: distance between the arms, mm. */
  spacing: number;
}

export const HOOK_DEFAULTS: HookOptions = { style: 'j', reach: 50, width: 8, arm: 6, tip: 12, angle: 15, spacing: 30 };

/** Back plate thickness, mm. */
export const HOOK_PLATE = 4;

/** Back plate height: room for the hook and the stud below it, and for a double hook's arms. */
export function hookPlateHeight(o: HookOptions, ctx: MountCtx): number {
  const hook = mountBox('hook', [0, 0], ctx);
  const stud = mountBox('stud', [0, -2 * ctx.pitch], ctx);
  const two = hook.y1 - stud.y0 + 2 * MOUNT.margin;
  return Math.ceil(Math.max(two, o.style === 'double' ? o.spacing + o.arm + 2 * MOUNT.margin : 0));
}

registerAttachment<HookOptions>({
  type: 'hook',
  defaults: HOOK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = HOOK_DEFAULTS;
    return {
      style: pick(r.style, HOOK_STYLES, d.style),
      reach: num(r.reach, 15, 250, d.reach),
      width: num(r.width, 5, 40, d.width),
      arm: num(r.arm, 3, 20, d.arm),
      tip: num(r.tip, 3, 80, d.tip),
      angle: num(r.angle, 0, 60, d.angle),
      spacing: num(r.spacing, 12, 120, d.spacing),
    };
  },
  layout(o, ctx) {
    const h = hookPlateHeight(o, ctx);
    const w = Math.max(o.width, mountBox('hook', [0, 0], ctx).x1 * 2);
    const m = backMounts(w, h, ctx, { kind: 'hook', rows: 2, columns: 1, left: true });
    return { w, h, depth: Math.max(HOOK_PLATE, o.reach), anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) => `${o.style === 'double' ? 'Double' : o.style.toUpperCase()} hook ${Math.round(o.reach)} mm`,
  backPlate(o, l) {
    const P = HOOK_PLATE;
    const R = Math.max(o.reach, P + o.arm);
    const rise = (R - P) * Math.tan((o.angle * Math.PI) / 180);
    const top = o.style === 'l' || o.style === 'peg' ? rise + 1.6 * o.arm : (o.style === 'double' ? o.spacing : 0) + o.arm + o.tip;
    return { x0: 0, x1: l.w, y0: top + 1, y1: l.h, z: P };
  },
});
