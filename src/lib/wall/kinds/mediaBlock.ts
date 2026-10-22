/**
 * Card and media block: a block of slots for memory cards, USB plugs, game
 * cards, business cards, picks or blades, in rows that step down toward the
 * front so the ones behind stand clear of the ones in front. The slots lean
 * back (15° by default), so the cards rest on their backs instead of
 * standing on edge, each row far enough behind the next that a card leaning
 * back clears the row behind.
 *
 * Printed upright as it hangs: the block's foot on the bed, every slot opening
 * upward, so it needs no support (a slot's underside leans at most 30° from
 * upright). Clips across the top of the back, a stud below on a tall block.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface MediaBlockOptions {
  /** The card or plug: left to right and thickness, mm. */
  width: number;
  thick: number;
  /** How deep a slot is, along its lean, mm. */
  depth: number;
  /** Rows front to back, slots in a row. */
  rows: number;
  count: number;
  /** Rows apart, front to back, mm (at least what the slots and walls need). */
  pitch: number;
  /** How far the slots lean back, degrees. */
  tilt: number;
  /** Added to the width and the thickness, mm. */
  clearance: number;
  /** A ledge on the front for a label. */
  label: boolean;
}

export const MEDIA_DEFAULTS: MediaBlockOptions = { width: 24, thick: 2.1, depth: 16, rows: 4, count: 2, pitch: 8, tilt: 15, clearance: 0.4, label: false };

/** Back plate, walls between slots across, end walls, floor under the deepest slot, front wall, least wall between rows; mm. */
export const MEDIA = { back: 3, wall: 1.6, side: 2, floor: 2, front: 2, row: 1.2 } as const;

/**
 * The block, mm: the slot across (sx) and thick (st), the lean (sin, cos, tan), how much
 * lower each row is than the one behind (step), the plastic behind a slot at the top
 * (behind), the rows' pitch, each row's back edge (z0), slot centre on its top (zc)
 * and top (top), and the whole size.
 */
export function mediaPlan(o: MediaBlockOptions, ctx: MountCtx) {
  const a = (o.tilt * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const tan = sin / cos;
  const sx = o.width + o.clearance;
  const st = o.thick + o.clearance;
  const step = Math.min(8, Math.max(2, 0.4 * o.depth));
  // A card leaning back clears the row behind (one step higher).
  const behind = Math.max(MEDIA.row, step * tan + 0.4);
  const hw = st / 2 / cos;
  const least = 2 * hw + step * tan + behind + MEDIA.row / cos;
  const pitch = Math.max(o.pitch, least);
  const z0 = (r: number) => MEDIA.back + r * pitch;
  const zc = (r: number) => z0(r) + behind + hw;
  // The front row's slot ends `floor` above the bed (the block stays tall enough for the clips).
  const low = MEDIA.floor + o.depth * cos + (st / 2) * sin;
  const H = Math.max(low + (o.rows - 1) * step, minHeight(ctx));
  const top = (r: number) => H - r * step;
  // The front row's slot reaches furthest forward at its foot.
  const last = zc(o.rows - 1);
  const D = Math.max(z0(o.rows), last + o.depth * sin + (st / 2) * cos + MEDIA.front, last + hw + MEDIA.front);
  return { sin, cos, tan, sx, st, step, behind, hw, pitch, least, z0, zc, top, H, D, W: o.count * sx + (o.count - 1) * MEDIA.wall + 2 * MEDIA.side };
}

registerAttachment<MediaBlockOptions>({
  type: 'mediaBlock',
  defaults: MEDIA_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = MEDIA_DEFAULTS;
    return {
      width: num(r.width, 3, 120, d.width),
      thick: num(r.thick, 0.5, 30, d.thick),
      depth: num(r.depth, 3, 60, d.depth),
      rows: int(r.rows, 1, 12, d.rows),
      count: int(r.count, 1, 12, d.count),
      pitch: num(r.pitch, 2, 60, d.pitch),
      tilt: num(r.tilt, 0, 30, d.tilt),
      clearance: num(r.clearance, 0, 2, d.clearance),
      label: bool(r.label, d.label),
    };
  },
  layout(o, ctx) {
    const p = mediaPlan(o, ctx);
    const m = backMounts(p.W, p.H, ctx, { rows: 2 });
    return { w: p.W, h: p.H, depth: p.D + (o.label ? 2 : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Card block, ${o.rows * o.count} slots ${o.width} × ${o.thick}`,
  labelFace(o, l) {
    // The front of the block under its front row, or the label ledge on it.
    const front = l.h - (o.rows - 1) * Math.min(8, Math.max(2, 0.4 * o.depth));
    const y0 = Math.max(0, front - 12);
    if (o.label) return front - y0 >= 8 ? { x: 1, y: y0 + 2.5, w: l.w - 2, h: front - y0 - 3, z: l.depth, normal: 'front' } : null;
    return front >= 6 ? { x: 1, y: Math.max(0.6, front - 12.6), w: l.w - 2, h: Math.min(12, front - 1.2), z: l.depth, normal: 'front' } : null;
  },
  // A solid block in front of the whole back.
  backPlate: () => null,
  notes(o, ctx) {
    const p = mediaPlan(o, ctx);
    const out = leverNotes(p.D, p.H);
    if (p.pitch > o.pitch + 0.05) out.push(`Rows ${Math.round(p.pitch * 10) / 10} mm apart: the least these slots and their lean need.`);
    return out;
  },
});
