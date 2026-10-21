/**
 * Tool rack: a ledge at the foot of a back plate, tools hanging down through
 * it in front of the board, their handles or heads resting on top:
 * - drivers: round holes from a list of shaft diameters (screwdrivers, files),
 *   spaced so the handles don't touch and clear the back;
 * - pliers: jaws down through slots sized by jaw thickness, the joint resting on top;
 * - wrenches: a comb open at the front, the handle slides in and the ring end
 *   rests on the teeth (head sizes as the Gridfinity rack's `wrenchHead`);
 * - bits: blind sockets for 1/4″ hex bits, in rows;
 * - hex keys: hex holes for a set, long legs down.
 *
 * Printed upright as it hangs: the ledge lies on the bed, so every hole is a
 * plain vertical hole, and the back rises from its back edge with 45° gussets
 * at the ends. The tools hang below the part, over the board. Clips across
 * the top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, str, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export const TOOL_MODES = ['drivers', 'pliers', 'wrenches', 'bits', 'hexKeys'] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

export interface ToolRackOptions {
  mode: ToolMode;
  /** Size lists, mm (text: "3, 4, 5"): shaft diameters, jaw thicknesses, wrench sizes, hex keys across flats. */
  drivers: string;
  pliers: string;
  wrenches: string;
  hexKeys: string;
  /** Bits: how many, in how many rows. */
  bits: number;
  rows: number;
  /** Drivers: handle diameter. */
  handle: number;
  /** Pliers: slot length front to back (the jaws' width where they should stop). */
  head: number;
  /** Added to every size (not bits). */
  clearance: number;
  /** Back plate height. */
  height: number;
}

export const TOOL_RACK_DEFAULTS: ToolRackOptions = {
  mode: 'drivers',
  drivers: '3, 4, 5, 6, 6, 8',
  pliers: '10, 11, 12, 12',
  wrenches: '8, 10, 12, 13, 14, 17, 19',
  hexKeys: '1.5, 2, 2.5, 3, 4, 5, 6, 8, 10',
  bits: 12,
  rows: 2,
  handle: 30,
  head: 24,
  clearance: 0.6,
  height: 60,
};

/** Back plate and end gusset thickness, plastic round a hole, least gap between holes, ledge thickness (bits: deeper for their sockets), bit across flats, fit and pitch; mm. */
export const TOOL = { back: 3, end: 3, edge: 3, gap: 2.5, ledge: 6, bitLedge: 12, bit: 6.35, bitFit: 0.25, bitPitch: 10 } as const;

/** A hole in the ledge: its centre, its size across (x) and front to back (z). A comb slot runs out through the front. */
export interface ToolHole {
  x: number;
  z: number;
  sx: number;
  sz: number;
  shape: 'round' | 'hex' | 'slot' | 'comb' | 'socket';
}

/** Sizes from text: "3, 4, 5 mm" → [3, 4, 5]. */
export const parseSizes = (t: string) =>
  t
    .split(/[^\d.]+/)
    .map(Number)
    .filter((v) => v > 0)
    .slice(0, 40)
    .map((v) => Math.min(v, 40));

const SQ3 = Math.sqrt(3);

/** Holes, width, depth out from the board and ledge thickness. */
export function toolLayout(o: ToolRackOptions): { holes: ToolHole[]; w: number; d: number; t: number } {
  const { back, end, edge, gap } = TOOL;
  const holes: ToolHole[] = [];
  if (o.mode === 'bits') {
    const f = TOOL.bit + TOOL.bitFit;
    const sx = (2 * f) / SQ3;
    const P = TOOL.bitPitch;
    const rows = Math.min(o.rows, o.bits);
    const per = Math.ceil(o.bits / rows);
    for (let k = 0; k < o.bits; k++)
      holes.push({ x: end + edge + sx / 2 + (k % per) * P, z: back + edge + f / 2 + Math.floor(k / per) * P, sx, sz: f, shape: 'socket' });
    return { holes, w: 2 * (end + edge) + sx + (per - 1) * P, d: back + 2 * edge + f + (Math.ceil(o.bits / per) - 1) * P, t: TOOL.bitLedge };
  }
  const c = o.clearance;
  // Each: hole size, half the width a tool takes across (handle, joint, head), and how far its centre stays from the back.
  const items = parseSizes(o[o.mode]).map((s) => {
    if (o.mode === 'drivers') return { sx: s + c, sz: s + c, keep: o.handle / 2, off: o.handle / 2 + 1, shape: 'round' as const };
    if (o.mode === 'hexKeys') return { sx: (2 * (s + c)) / SQ3, sz: s + c, keep: 0, off: 0, shape: 'hex' as const };
    if (o.mode === 'pliers') return { sx: s + c, sz: o.head + c, keep: s, off: 0, shape: 'slot' as const };
    // Wrenches (as rack.ts wrenchHead): open-end width 2.2s + 3.5, ring end 0.32s + 3.4 thick; the handle is thinner and about half as wide.
    const width = 2.2 * s + 3.5;
    const thick = 0.32 * s + 3.4;
    return { sx: 0.75 * thick + c, sz: width / 2 + c, keep: thick / 2 + 0.5, off: width / 2 + 1, shape: 'comb' as const };
  });
  let x = end;
  let prev: (typeof items)[number] | null = null;
  for (const it of items) {
    x += prev ? Math.max((prev.sx + it.sx) / 2 + gap, prev.keep + it.keep + 1) : Math.max(it.sx / 2 + edge, it.keep);
    holes.push({ x, z: 0, sx: it.sx, sz: it.sz, shape: it.shape });
    prev = it;
  }
  const z = back + Math.max(0, ...items.map((it) => Math.max(it.sz / 2 + edge, it.off)));
  const w = prev ? x + Math.max(prev.sx / 2 + edge, prev.keep) + end : 0;
  // At least 30 mm wide, the holes centred.
  for (const h of holes) Object.assign(h, { x: h.x + Math.max(0, 30 - w) / 2, z });
  return { holes, w: Math.max(30, w), d: z + Math.max(0, ...items.map((it) => it.sz / 2)) + edge, t: TOOL.ledge };
}

export const toolRackHeight = (o: ToolRackOptions, ctx: MountCtx) => Math.max(o.height, minHeight(ctx), toolLayout(o).t + 10);

const NAMES: Record<ToolMode, [string, string]> = {
  drivers: ['Screwdriver rack', 'hole'],
  pliers: ['Plier rack', 'slot'],
  wrenches: ['Wrench rack', 'slot'],
  bits: ['Bit holder', 'bit'],
  hexKeys: ['Hex key rack', 'hole'],
};

registerAttachment<ToolRackOptions>({
  type: 'toolRack',
  defaults: TOOL_RACK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = TOOL_RACK_DEFAULTS;
    const list = (v: unknown, dflt: string) => (typeof v === 'string' ? str(v, 200) : dflt);
    return {
      mode: pick(r.mode, TOOL_MODES, d.mode),
      drivers: list(r.drivers, d.drivers),
      pliers: list(r.pliers, d.pliers),
      wrenches: list(r.wrenches, d.wrenches),
      hexKeys: list(r.hexKeys, d.hexKeys),
      bits: int(r.bits, 1, 60, d.bits),
      rows: int(r.rows, 1, 4, d.rows),
      handle: num(r.handle, 0, 60, d.handle),
      head: num(r.head, 5, 60, d.head),
      clearance: num(r.clearance, 0, 3, d.clearance),
      height: num(r.height, 25, 150, d.height),
    };
  },
  layout(o, ctx) {
    const l = toolLayout(o);
    const h = toolRackHeight(o, ctx);
    const m = backMounts(l.w, h, ctx, { rows: 3 });
    return { w: l.w, h, depth: l.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary(o) {
    const n = toolLayout(o).holes.length;
    const [name, unit] = NAMES[o.mode];
    return `${name}, ${n} ${unit}${n === 1 ? '' : 's'}`;
  },
  notes(o, ctx) {
    const l = toolLayout(o);
    const out = leverNotes(l.d, toolRackHeight(o, ctx));
    if (!l.holes.length) out.push('No sizes yet: list them in mm, like “3, 4, 5”.');
    else if (o.mode !== 'bits' && o.clearance < 0.3) out.push('Under 0.3 mm clearance the holes may be too tight to drop the tools in.');
    return out;
  },
});
