/**
 * Measuring tool hanger, nothing to thread through:
 * - calipers and combination squares: the beam (or blade) hangs down through
 *   a slot open at the front, the slider (or head) rests on the ledge in a
 *   pocket with low walls; it goes in from the front, then drops into place.
 *   The beam sits where it is on the slider: `beamAt` from its right edge
 *   (hung jaws up, face out, the jaws point left);
 * - speed squares: the plate drops through a slot, the fence rests on top;
 * - rulers: blind slots one in front of the other, the rulers stand in them;
 * - tape measures: a cradle with notches for the hook (or hang one by its
 *   belt clip on a clip tab).
 * Sizes vary from maker to maker, so the presets are typical ones with
 * generous clearance: measure yours. Printed upright as it hangs: the ledge
 * lies on the bed, every slot and wall stands straight up from it. Clips
 * across the top of the back, studs low on a tall one.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export const MEASURE_TOOLS = ['caliper', 'square', 'speed', 'ruler', 'tape'] as const;
export type MeasureTool = (typeof MEASURE_TOOLS)[number];

export interface MeasureHangerOptions {
  tool: MeasureTool;
  /** The beam, blade, plate or ruler: width (across) and thickness, mm. */
  beamW: number;
  beamT: number;
  /** Calipers and squares: from the slider's (head's) right edge to the beam's centre, mm. */
  beamAt: number;
  /** The slider, head, a speed square's fence or a tape measure: across, out from the board, and tall, mm. */
  bodyW: number;
  bodyD: number;
  bodyH: number;
  /** Rulers: how many, one in front of the other. */
  count: number;
  /** Added each side of every size, mm. */
  clearance: number;
  /** Back height (at least), mm. */
  height: number;
}

export const MEASURE_DEFAULTS: MeasureHangerOptions = {
  tool: 'caliper',
  beamW: 16,
  beamT: 3.5,
  beamAt: 10,
  bodyW: 40,
  bodyD: 16,
  bodyH: 75,
  count: 1,
  clearance: 1,
  height: 40,
};

/** Back plate, ledge, wall and rim thickness, a ruler slot's depth, the floor under it, a tape's notch height over the floor; mm. */
export const MEASURE = { back: 3, ledge: 5, wall: 2.4, rim: 4, rulerDepth: 25, floor: 3, lip: 6, notch: 8 } as const;

/** A box in the part's frame: x across, y up, z out from the board. */
export interface MBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Least width: two columns of clips. */
const MIN_W = 50;

/**
 * The holder's shape: its size (w across, d out), the solid floor or block (`floor` thick), a pocket with walls
 * (`top` high, the front `front` high), and the slots cut through or into it. At least 50 mm wide (two columns of
 * clips), what it holds in the middle.
 */
export function measurePlan(o: MeasureHangerOptions) {
  const p = holderShape(o);
  const pad = Math.max(0, MIN_W - p.w) / 2;
  const shift = <B extends MBox | null>(b: B): B => (b ? { ...b, x0: b.x0 + pad, x1: b.x1 + pad } : b);
  return { ...p, w: p.w + 2 * pad, pocket: shift(p.pocket), slots: p.slots.map(shift) };
}

function holderShape(o: MeasureHangerOptions): { w: number; d: number; floor: number; top: number; front: number; pocket: MBox | null; slots: MBox[] } {
  const { back: B, ledge: L, wall: t, rim } = MEASURE;
  const c = o.clearance;
  if (o.tool === 'speed') {
    const sw = o.beamW + 2 * c;
    const st = o.beamT + 2 * c;
    const d = B + Math.max(o.bodyD + 2 * c, st + 2 * rim);
    const zc = (B + d) / 2;
    return {
      w: sw + 2 * rim,
      d,
      floor: L,
      top: L,
      front: L,
      pocket: null,
      slots: [{ x0: rim, x1: rim + sw, y0: -1, y1: L + 1, z0: zc - st / 2, z1: zc + st / 2 }],
    };
  }
  if (o.tool === 'ruler') {
    const sw = o.beamW + 2 * c;
    const st = o.beamT + 2 * c;
    const top = MEASURE.floor + MEASURE.rulerDepth;
    const slots: MBox[] = [];
    for (let k = 0; k < o.count; k++) {
      const z0 = B + rim + k * (st + rim);
      slots.push({ x0: rim, x1: rim + sw, y0: MEASURE.floor, y1: top + 1, z0, z1: z0 + st });
    }
    return { w: sw + 2 * rim, d: B + rim + o.count * (st + rim), floor: top, top, front: top, pocket: null, slots };
  }
  // A pocket with walls round it on the floor.
  const tape = o.tool === 'tape';
  const floor = tape ? MEASURE.floor : L;
  const pw = o.bodyW + 2 * c;
  const pd = o.bodyD + 2 * c;
  const wall = tape ? Math.min(45, Math.max(15, 0.4 * o.bodyH)) : Math.min(20, Math.max(8, 0.2 * o.bodyH));
  const top = floor + wall;
  if (tape) {
    // Notches in the side walls for the tape's hook, whichever way round it sits.
    const nw = Math.min(24, pd - 6);
    const zm = B + pd / 2;
    const y0 = floor + MEASURE.notch;
    const pocket = { x0: t, x1: t + pw, y0: floor, y1: top + 1, z0: B, z1: B + pd };
    const w = pw + 2 * t;
    return {
      w,
      d: B + pd + t,
      floor,
      top,
      front: Math.min(top, floor + 15),
      pocket,
      slots: [
        { x0: -1, x1: t + 0.5, y0, y1: top + 1, z0: zm - nw / 2, z1: zm + nw / 2 },
        { x0: w - t - 0.5, x1: w + 1, y0, y1: top + 1, z0: zm - nw / 2, z1: zm + nw / 2 },
      ],
    };
  }
  // Calipers and squares: the beam's slot runs out through the front, where the beam sits on the slider.
  const half = o.beamW / 2 + c;
  let x0 = t;
  const sx = () => x0 + pw - c - o.beamAt;
  if (sx() - half < rim) x0 += rim - (sx() - half);
  const w = Math.max(x0 + pw + t, sx() + half + rim);
  const d = B + pd + t;
  return {
    w,
    d,
    floor,
    top,
    front: Math.min(top, floor + MEASURE.lip),
    pocket: { x0, x1: x0 + pw, y0: floor, y1: top + 1, z0: B, z1: B + pd },
    slots: [{ x0: sx() - half, x1: sx() + half, y0: -1, y1: top + 1, z0: B, z1: d + 1 }],
  };
}

const measureHeight = (o: MeasureHangerOptions, ctx: MountCtx) => Math.ceil(Math.max(o.height, minHeight(ctx), measurePlan(o).top));

const NAMES: Record<MeasureTool, string> = {
  caliper: 'Caliper hanger',
  square: 'Square hanger',
  speed: 'Speed square hanger',
  ruler: 'Ruler rack',
  tape: 'Tape measure cradle',
};

registerAttachment<MeasureHangerOptions>({
  type: 'measureHanger',
  defaults: MEASURE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = MEASURE_DEFAULTS;
    return {
      tool: pick(r.tool, MEASURE_TOOLS, d.tool),
      beamW: num(r.beamW, 5, 400, d.beamW),
      beamT: num(r.beamT, 0.3, 20, d.beamT),
      beamAt: num(r.beamAt, -20, 200, d.beamAt),
      bodyW: num(r.bodyW, 10, 200, d.bodyW),
      bodyD: num(r.bodyD, 3, 100, d.bodyD),
      bodyH: num(r.bodyH, 10, 200, d.bodyH),
      count: int(r.count, 1, 8, d.count),
      clearance: num(r.clearance, 0.2, 3, d.clearance),
      height: num(r.height, 16, 150, d.height),
    };
  },
  layout(o, ctx) {
    const p = measurePlan(o);
    const h = measureHeight(o, ctx);
    const m = backMounts(p.w, h, ctx, { rows: 2 });
    return { w: p.w, h, depth: p.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => (o.tool === 'ruler' && o.count > 1 ? `${NAMES.ruler}, ${o.count} rulers` : NAMES[o.tool]),
  notes(o, ctx) {
    const out = leverNotes(measurePlan(o).d, measureHeight(o, ctx));
    if ((o.tool === 'caliper' || o.tool === 'square') && o.beamAt > o.bodyW)
      out.push('The beam is off the slider: its distance from the right edge is more than the slider is wide.');
    return out;
  },
});
