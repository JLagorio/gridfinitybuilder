/**
 * Cable clips: a row of C-shaped seats, one above the other, that round
 * cables (or flat ones) snap into from the front and run along the board in.
 * Each opening is about 10% narrower than its cable. Printed on its side, so
 * the seats lie flat on the bed and their arms flex along the layers; a
 * pegboard hook holds it on (a stud too on a tall one).
 */
import { backMounts, minHeight, mountBox } from '../mount';
import { int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';

export interface CableClipOptions {
  style: 'round' | 'flat';
  /** Round cables' diameter, mm. */
  diameter: number;
  /** Flat cables' width (into the seat) and thickness, mm. */
  flatW: number;
  flatT: number;
  count: number;
  /** Between seats, mm. */
  gap: number;
  /** Along the cables, mm. */
  width: number;
}

export const CLIP_DEFAULTS: CableClipOptions = { style: 'round', diameter: 6, flatW: 12, flatT: 3, count: 2, gap: 3, width: 10 };

/** Back plate thickness and a flat seat's arm, mm. */
export const CLIP = { back: 3, arm: 1.6 } as const;

/**
 * Each seat's size: the opening's height `o` (y), the seat's outside height `h`, how far its front
 * reaches out (`z`, from the board), and a round seat's inside radius `r`, wall `t` and centre `zc`.
 */
export function clipSeat(o: CableClipOptions) {
  if (o.style === 'flat') {
    const s = o.flatT + 0.2;
    return { o: Math.min(0.9 * o.flatT, s - 0.4), h: s + 2 * CLIP.arm, z: CLIP.back + o.flatW + 0.4 + 1.2, r: 0, t: 0, zc: 0 };
  }
  const r = o.diameter / 2 + 0.1;
  const t = Math.max(1.6, 0.15 * o.diameter);
  const zc = CLIP.back + r;
  // Cut off flat where the opening is 90% of the cable.
  return { o: 0.9 * o.diameter, h: 2 * (r + t), z: zc + Math.sqrt(r * r - (0.45 * o.diameter) ** 2), r, t, zc };
}

/** The seats' stack and the plate's height (room for the hook too). */
export function clipHeight(o: CableClipOptions, ctx: MountCtx) {
  const st = o.count * clipSeat(o).h + (o.count - 1) * o.gap;
  return { st, H: Math.max(st, minHeight(ctx, 'hook')) };
}

registerAttachment<CableClipOptions>({
  type: 'cableClip',
  defaults: CLIP_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CLIP_DEFAULTS;
    return {
      style: pick(r.style, ['round', 'flat'] as const, d.style),
      diameter: num(r.diameter, 2, 30, d.diameter),
      flatW: num(r.flatW, 3, 40, d.flatW),
      flatT: num(r.flatT, 1, 10, d.flatT),
      count: int(r.count, 1, 8, d.count),
      gap: num(r.gap, 1, 20, d.gap),
      width: num(r.width, 5, 40, d.width),
    };
  },
  layout(o, ctx) {
    const { H } = clipHeight(o, ctx);
    const w = Math.max(o.width, mountBox('hook', [0, 0], ctx).x1 * 2);
    const m = backMounts(w, H, ctx, { kind: 'hook', rows: 2, columns: 1, left: true });
    return { w, h: H, depth: clipSeat(o).z, anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) => `Cable clip ${o.count > 1 ? `${o.count} × ` : ''}${o.style === 'flat' ? `${Math.round(o.flatW)} × ${o.flatT} flat` : `⌀${o.diameter}`}`,
});
