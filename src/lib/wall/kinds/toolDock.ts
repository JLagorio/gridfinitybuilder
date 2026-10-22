/**
 * Tool dock: an open fork for a cordless drill, driver or impact driver, the
 * battery on. The handle drops into the slot from the front; with the battery
 * down the tool's head rests on the prongs (chamfered along the slot into a V
 * that cradles it), with the battery up the battery does and the head hangs
 * below. The prongs' tops rise toward their tips (the tilt), so the tool
 * settles back against the end of the slot. One to three side by side.
 *
 * Printed upright as it hangs: the fork is a thick ledge lying on the bed,
 * solid under its sloping top, so its layers run along the prongs; the back
 * rises from its back edge with 45° gussets at the ends and between the tools.
 * A tool weighs 1.5–2.5 kg: the back is wide enough for three clip columns a
 * tool (the forks centred on it), and studs go low on it. Print it in PETG.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface ToolDockOptions {
  count: number;
  /** Width of the slot the handle drops into, mm. */
  gap: number;
  /** How far the prongs reach out from the board, mm. */
  reach: number;
  /** The handle's middle (the slot's round end) out from the board: room for the back of the head behind it, mm. */
  setback: number;
  /** The prongs' tops rise this much toward their tips, degrees. */
  tilt: number;
  battery: 'down' | 'up';
  /** Centre to centre of the tools (each one's bay), mm. */
  pitch: number;
  /** Back plate height, mm. */
  height: number;
}

export const TOOL_DOCK_DEFAULTS: ToolDockOptions = { count: 1, gap: 56, reach: 110, setback: 55, tilt: 8, battery: 'down', pitch: 100, height: 100 };

/** Back plate, ledge thickness (at the back), the V along the slot, the mouth's flare, gussets' thickness; mm. */
export const TOOL_DOCK = { back: 5, ledge: 8, vee: 4, flare: 6, gusset: 3 } as const;

export const toolDockHeight = (o: ToolDockOptions, ctx: MountCtx) => Math.max(o.height, minHeight(ctx), TOOL_DOCK.ledge + 20);

/** The back's width: the forks, or three clip columns a tool (two lattice steps apart, and room for the outer clips' barbs). */
export const toolDockWidth = (o: ToolDockOptions, ctx: MountCtx) => Math.max(o.count * o.pitch, (3 * o.count - 1) * 2 * ctx.pitch + 10.5);

registerAttachment<ToolDockOptions>({
  type: 'toolDock',
  defaults: TOOL_DOCK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = TOOL_DOCK_DEFAULTS;
    const gap = num(r.gap, 30, 90, d.gap);
    const reach = num(r.reach, Math.max(60, TOOL_DOCK.back + gap / 2 + 25), 200, d.reach);
    return {
      count: int(r.count, 1, 3, d.count),
      gap,
      reach,
      // Room behind the slot's round end, and 20 mm of prong in front of it.
      setback: num(r.setback, TOOL_DOCK.back + gap / 2 + 5, reach - 20, d.setback),
      tilt: num(r.tilt, 0, 20, d.tilt),
      battery: pick(r.battery, ['down', 'up'] as const, d.battery),
      pitch: num(r.pitch, Math.max(90, gap + 30), 250, d.pitch),
      height: num(r.height, 40, 200, d.height),
    };
  },
  layout(o, ctx) {
    const w = toolDockWidth(o, ctx);
    const h = toolDockHeight(o, ctx);
    const m = backMounts(w, h, ctx, { rows: 3 });
    return { w, h, depth: o.reach, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Drill dock${o.count > 1 ? `, ${o.count} tools` : ''}, battery ${o.battery}`,
  notes(o, ctx) {
    const out = leverNotes(o.reach, toolDockHeight(o, ctx));
    if (o.gap < 45) out.push('Under 45 mm most drill handles won’t drop in: measure yours just under the head.');
    if (o.battery === 'up' && o.setback < 60) out.push('With the battery up it rests on the fork: move the slot out (60 mm or more) so it clears the board.');
    if (toolDockWidth(o, ctx) > 250) out.push("Over 250 mm wide: if it doesn't fit your printer, make two with fewer tools.");
    return out;
  },
});
