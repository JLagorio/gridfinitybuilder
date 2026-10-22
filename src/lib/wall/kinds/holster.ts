/**
 * Holster: a ring standing out from the board that a tool drops into from
 * the top, nose down, its body or handle resting on the ring: a cordless
 * drill, a glue gun, a soldering pen, a hair dryer, a heat gun, a trigger
 * sprayer by its neck. A slot in the front lets a handle (or a neck) pass, and
 * the ring can lean back so the tool rests against the board side of it.
 *
 * Printed upright as it hangs: the ring lies on the bed (its top sloping up
 * toward the front when it leans back), the back plate rises from its back
 * edge with a 45° gusset each side, and the opening's walls lean with the
 * tool, no more than 30°. A drill weighs up to 2 kg, so the back is wide
 * enough for three clip columns on a big ring, with studs low on it.
 * Heat-safe: the opening grows a little and ribs hold the tool (air between),
 * and it stands at least 20 mm off the board, for soldering irons and heat guns
 * (print those in PETG or ASA).
 */
import type { Vec2 } from '../../geometry/kernel';
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { bool, num, obj, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface HolsterOptions {
  /** The opening inside: across and front to back (equal: round), mm. */
  width: number;
  depth: number;
  /** How tall the ring is at the back, mm. */
  ring: number;
  /** The slot in the front (0: a closed ring), mm. */
  slot: number;
  /** Lean back toward the board, degrees. */
  tilt: number;
  /** Gap between the board and the opening, mm. */
  offset: number;
  /** A notch at the back of the opening for a cord to run down behind the tool. */
  cord: boolean;
  heat: boolean;
  /** Back plate height, mm. */
  back: number;
}

export const HOLSTER_DEFAULTS: HolsterOptions = { width: 77, depth: 77, ring: 15, slot: 57, tilt: 10, offset: 10, cord: false, heat: false, back: 80 };

/** Back plate, gusset thickness, heat-safe ribs (how far in, how wide) and standoff, cord notch width; mm. */
export const HOLSTER = { back: 3, gusset: 4, rib: 2, ribW: 2.4, standoff: 20, cord: 10 } as const;

const RAD = Math.PI / 180;

/** An obround `wid` × `dep` centred on the origin, (across, toward the board), CCW; circular when they're equal. */
export function obround(wid: number, dep: number, segs = 64): Vec2[] {
  const r = Math.min(wid, dep) / 2;
  const hx = wid / 2 - r;
  const hy = dep / 2 - r;
  const pts: Vec2[] = [];
  const q = segs / 4;
  // Four quarter arcs; where two meet with no straight between, they share their end.
  const corners: [number, number][] = [
    [hx, hy],
    [-hx, hy],
    [-hx, -hy],
    [hx, -hy],
  ];
  corners.forEach(([cx, cy], k) => {
    for (let i = 0; i <= q; i++) {
      if (i === 0 && pts.length && ((k % 2 === 1 && hx < 1e-9) || (k % 2 === 0 && hy < 1e-9))) continue;
      if (i === q && k === 3 && hy < 1e-9) continue;
      const a = ((k * 90 + (90 * i) / q) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  });
  return pts;
}

/**
 * The ring: its wall, the opening (grown for heat-safe ribs), the outside, the gap to the board, the axis's tilt and
 * where it meets the ring's top (`oy`, `oz`: the top passes through the back plate's front at `ring` high), how far
 * the ring reaches forward in its own plane past the slot, its top's highest point (there), and how far out it reaches.
 */
function holsterRing(o: HolsterOptions) {
  const t = Math.min(10, Math.max(4, 0.12 * Math.max(o.width, o.depth)));
  const grow = o.heat ? HOLSTER.rib : 0;
  const cw = o.width + 2 * grow;
  const cd = o.depth + 2 * grow;
  const ow = cw + 2 * t;
  const od = cd + 2 * t;
  const gap = o.heat ? Math.max(o.offset, HOLSTER.standoff) : o.offset;
  const slot = Math.min(o.slot, cw);
  const th = o.tilt * RAD;
  const [sin, cos, tan] = [Math.sin(th), Math.cos(th), Math.tan(th)];
  const v0 = gap + cd / 2;
  const oy = o.ring + v0 * sin;
  const oz = HOLSTER.back + v0 * cos;
  // The front-most of the outside, beside the slot.
  let front = 0;
  const pts = obround(ow, od);
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    for (const [u, v] of [a, b]) if (Math.abs(u) >= slot / 2 - 1e-9) front = Math.max(front, -v);
    // Where an edge crosses the slot's sides.
    for (const e of [slot / 2, -slot / 2]) if ((a[0] - e) * (b[0] - e) < 0) front = Math.max(front, -(a[1] + ((e - a[0]) / (b[0] - a[0])) * (b[1] - a[1])));
  }
  return { t, grow, cw, cd, ow, od, gap, slot, oy, oz, front, top: oy + front * sin, depth: oz + oy * tan + front / cos };
}

/** The ring (holsterRing) and the part's size. */
export function holsterGeometry(o: HolsterOptions, ctx: MountCtx) {
  const g = holsterRing(o);
  // Three clip columns for a big ring, two for a small one.
  const cols = Math.max(o.width, o.depth) >= 50 ? 3 : 2;
  const minW = (cols - 1) * 2 * ctx.pitch + 2 * (mountBox('clip', [0, 0], ctx).x1 + MOUNT.margin);
  return { ...g, w: Math.max(g.ow, minW), h: Math.max(o.back, g.top, minHeight(ctx) + 2 * ctx.pitch) };
}

registerAttachment<HolsterOptions>({
  type: 'holster',
  defaults: HOLSTER_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = HOLSTER_DEFAULTS;
    return {
      width: num(r.width, 8, 200, d.width),
      depth: num(r.depth, 8, 200, d.depth),
      ring: num(r.ring, 5, 40, d.ring),
      slot: num(r.slot, 0, 200, d.slot),
      tilt: num(r.tilt, 0, 30, d.tilt),
      offset: num(r.offset, 0, 80, d.offset),
      cord: bool(r.cord, d.cord),
      heat: bool(r.heat, d.heat),
      back: num(r.back, 30, 200, d.back),
    };
  },
  layout(o, ctx) {
    const g = holsterGeometry(o, ctx);
    const m = backMounts(g.w, g.h, ctx, { rows: 3 });
    return { w: g.w, h: g.h, depth: g.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) =>
    `Holster ${o.width === o.depth ? `⌀${Math.round(o.width)}` : `${Math.round(o.width)} × ${Math.round(o.depth)}`}${o.heat ? ', heat-safe' : ''}`,
  backPlate(o, l) {
    // Over the ring's top (the tool stands above it: take it out first), and over the gussets by the back plate;
    // beside the ring on a back wider than it.
    const g = holsterRing(o);
    const B = HOLSTER.back;
    const [x0, x1] = [(l.w - g.ow) / 2, (l.w + g.ow) / 2];
    const gs = Math.max(0, Math.min(l.h - o.ring - 2, 0.75 * (g.oz - B), 60));
    const plate = (xa: number, xb: number, y0: number) => ({ x0: xa, x1: xb, y0, y1: l.h, z: B });
    return [
      plate(x0 + HOLSTER.gusset, x1 - HOLSTER.gusset, g.top),
      plate(0, l.w, Math.max(g.top, gs > 2 ? o.ring + gs : 0)),
      plate(0, x0, 0),
      plate(x1, l.w, 0),
    ];
  },
  notes(o, ctx) {
    const g = holsterGeometry(o, ctx);
    const out = leverNotes(g.depth, g.h);
    if (o.cord && g.gap < HOLSTER.cord + 2) out.push(`The cord notch needs a gap from the board of ${HOLSTER.cord + 2} mm or more.`);
    return out;
  },
  // A drill, a glue gun or a heat gun: about 1.5 kg.
  load: (o) => ({ kg: 1.5, at: HOLSTER.back + o.offset + o.depth / 2 }),
});
