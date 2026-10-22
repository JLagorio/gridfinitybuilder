/**
 * Holder for a traced tool: a tray tilted 45° toward you with the tool's own
 * outline as its pocket, as deep as the tool is thick, the tool lying in it
 * long side across. Gravity seats the tool in its silhouette, so a knock
 * doesn't shift it, it comes out in one movement, and an empty pocket shows
 * what's missing. It suits any outline: a pair of pegs or a slot needs a
 * handle or a neck to hold by, and a tool resting on pegs can tip off them.
 *
 * Printed upright as it hangs: the tray is a slab rising from the bed at 45°
 * back to the back plate, so its face and its underside are at 45°, and the
 * pocket's walls are square to the face, so its top wall leans at 45° and its
 * floor faces up: nothing needs support. Finger notches at the middle of its
 * long sides. The back reaches above the tray for the clips, a second row of
 * studs, a bolt and a label.
 *
 * The tray's own frame (toolCradle.geom.ts): x across, v up the face from its
 * foot on the bed, w out of the face; the face at w = 0 meets the bed at
 * z = depth and the back plate's front at y = `meet`.
 */
import type { Vec2 } from '../../geometry/kernel';
import { bounds } from '../../trace/polygon';
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, registerAttachment, type AttachmentLayout, type MountCtx } from '../registry';
import { PLACEHOLDER, cleanTraced, centred, longTurn, notchSpots, turned, type TracedTool } from './traced';

export interface ToolCradleOptions {
  /** The tool (one). */
  tools: TracedTool[];
  /** The pocket's depth; 0: the tool's thickness. */
  depth: number;
  notches: boolean;
}

export const TOOL_CRADLE_DEFAULTS: ToolCradleOptions = { tools: [], depth: 0, notches: true };

/**
 * Sizes, mm: the back plate's thickness, the tray's floor under the pocket, plastic beside the pocket and above the
 * bed below it, how far in front of the back plate the pocket's top stays, how far the back reaches above the tray,
 * a finger notch's radius, the deepest pocket, the chamfer round its edge, the widest gap between parts of a tool
 * that's closed up (the wall between would be too thin to print).
 */
export const TOOL_CRADLE = { back: 4, floor: 2, side: 5, foot: 1.5, clear: 1, above: 34, notch: 9, deepest: 30, chamfer: 1, close: 2 } as const;

/** The holder planned: its tool's outline and notches in the tray's frame (x, v), the pocket's depth, the slab's thickness and the part's size. */
export interface CradlePlan {
  tool: TracedTool;
  pts: Vec2[];
  notches: Vec2[];
  /** Pocket depth and slab thickness. */
  p: number;
  s: number;
  w: number;
  h: number;
  /** How far the tray's foot stands out from the board. */
  d: number;
  /** Where the face meets the back plate's front (y). */
  meet: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function cradlePlan(o: ToolCradleOptions, ctx: MountCtx): CradlePlan {
  const T = TOOL_CRADLE;
  const tool = o.tools[0] ?? PLACEHOLDER;
  const flat = centred(turned(tool.outline, longTurn(tool.outline, false) + tool.rotation));
  const c = tool.clearance;
  const p = r2(Math.min(T.deepest, Math.max(1, o.depth || tool.depth)));
  const s = r2(p + T.floor);
  const notches = o.notches ? notchSpots(flat) : [];
  const b = bounds(flat);
  const R = T.notch;
  const x0 = Math.min(b.x0 - c, ...notches.map(([x]) => x - R));
  const x1 = Math.max(b.x1 + c, ...notches.map(([x]) => x + R));
  const v0 = Math.min(b.y0 - c, ...notches.map(([, v]) => v - R));
  const v1 = Math.max(b.y1 + c, ...notches.map(([, v]) => v + R));
  // Across: plastic beside it; up the face: its foot a slab's thickness above the bed, so the floor under it is whole.
  const dx = T.side - x0;
  const dv = s + T.foot - v0;
  const at = ([x, v]: Vec2): Vec2 => [r2(x + dx), r2(v + dv)];
  // Out far enough that the pocket's deepest top corner stays in front of the back plate.
  const d = r2(T.back + T.clear + (v1 + dv + p) / Math.SQRT2);
  const meet = r2(d - T.back);
  return {
    tool,
    pts: flat.map(at),
    notches: notches.map(at),
    p,
    s,
    w: r2(Math.max(30, x1 - x0 + 2 * T.side)),
    h: r2(Math.max(meet + T.above, minHeight(ctx))),
    d,
    meet,
  };
}

const cradleLayout = (o: ToolCradleOptions, ctx: MountCtx): AttachmentLayout => {
  const k = cradlePlan(o, ctx);
  const m = backMounts(k.w, k.h, ctx, { rows: 3 });
  return { w: k.w, h: k.h, depth: k.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
};

registerAttachment<ToolCradleOptions>({
  type: 'toolCradle',
  defaults: TOOL_CRADLE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = TOOL_CRADLE_DEFAULTS;
    return { tools: cleanTraced(r.tools, 1), depth: num(r.depth, 0, TOOL_CRADLE.deepest, d.depth), notches: bool(r.notches, d.notches) };
  },
  layout: cradleLayout,
  summary: (o) => (o.tools.length ? `Holder for ${o.tools[0].name}` : 'Tool holder'),
  labelFace(_o, l) {
    // The back plate above the tray.
    const meet = l.h - TOOL_CRADLE.above;
    return l.w < 20 ? null : { x: 3, y: r2(meet + 3), w: r2(l.w - 6), h: 8, z: TOOL_CRADLE.back, normal: 'front' };
  },
  backPlate: (_o, l) => ({ x0: 0, x1: l.w, y0: r2(l.h - TOOL_CRADLE.above + 0.5), y1: l.h, z: TOOL_CRADLE.back }),
});
