/**
 * Tip-out bin: a frame on the board and a bin that pivots on two pins at its
 * bottom front, so its top tips out to a stop (30–60°) and you reach in from
 * above. Several bins can stack in one frame. Pull the finger pull at the top
 * of its front to open it; it falls shut again when its weight is behind the
 * pins.
 *
 * Seen from the side, the bin's top is an arc round the pins and the corner
 * under its front a 45° chamfer inside a circle round them, so tipped open it
 * stays inside the room it has closed: one frame holds bins 1 mm apart. Two
 * more pins, one through each side of the frame, run in arc slots in the bin's
 * sides: the slot's ends are the stops, closed and open. With "Lift off" the
 * bin's pivot holes and the slots' closed ends open downward, so closed it
 * lifts off its pins; open, it can't.
 *
 * Everything prints without support: the frame upright as it hangs (back
 * plate, floor, side walls; teardrop pin holes), the bin upright as it sits,
 * the pins lying down. Clips across the top of the frame, studs below.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, registerAttachment, type AttachmentPart } from '../registry';
import { PIN, pinAlongX, pinPart } from './hinge';
import { leverNotes } from './shelf';

export interface TiltBinOptions {
  width: number;
  /** Each bin's height, mm. */
  height: number;
  /** Out from the board, to the finger pull, mm. */
  depth: number;
  /** How far it tips out, degrees. */
  angle: number;
  dividers: number;
  /** A card slot on each front. */
  label: boolean;
  /** Bins stacked in the frame. */
  stack: number;
  /** Closed, a bin lifts off its pins. */
  liftOff: boolean;
}

export const TILT_DEFAULTS: TiltBinOptions = { width: 100, height: 70, depth: 70, angle: 45, dividers: 0, label: true, stack: 1, liftOff: false };

/**
 * mm: the frame's back plate, side walls (room for a pin head's counterbore) and floor; the gap round a bin; how far
 * its back stays off the back plate; its side walls, front, floor, back; how far the pins are behind its front (and
 * above its bottom); the boss round each pin inside it (thickness, radius); the finger pull; a divider.
 */
export const TILT = {
  back: 3,
  side: 4,
  floor: 2.4,
  gap: 1,
  rear: 1.5,
  wall: 2,
  front: 2.4,
  bottom: 2,
  backW: 1.6,
  a: 11,
  boss: 3,
  bossR: 5,
  pull: 5,
  divider: 1.2,
} as const;

/**
 * Where things are: the arc's radius (the bin's front above its pins) and how deep the bin is behind them; the depth
 * used (capped so the bin's back isn't too low); the pins' z and bin k's pin height; the stop pin (side view, from
 * the pivot, the bin closed) and its distance from the pivot; the 45° chamfer under the bin's back (tipping, that
 * corner swings back: it stays 0.5 mm off the back plate); the stop pin's slot's radius; the frame's height; a bin's
 * width.
 */
export function tiltPlan(o: TiltBinOptions) {
  const T = TILT;
  const R = o.height - T.a;
  const dMax = Math.floor(0.9 * R);
  const depth = Math.min(o.depth, T.pull + T.a + T.back + T.rear + dMax);
  const zP = depth - T.pull - T.a;
  const d = zP - T.back - T.rear;
  const yP = (k: number) => k * (o.height + T.gap) + T.floor + T.gap + T.a;
  const rho = Math.max(T.bossR + 5, Math.min(0.6 * R, d - 7));
  const beta = ((o.angle / 2 + 25) * Math.PI) / 180;
  return {
    R,
    d,
    depth,
    zP,
    yP,
    stop: [-rho * Math.cos(beta), rho * Math.sin(beta)] as [number, number],
    rho,
    heel: Math.max(1, T.a - Math.sqrt((d + T.rear - 0.5) ** 2 - d * d) + 0.3),
    slot: (PIN.d + PIN.free) / 2,
    h: o.stack * (o.height + T.gap) + T.floor,
    binW: o.width - 2 * T.side - 2 * T.gap,
  };
}

/** Pins' lengths past the head: the pivot pin reaches through the bin's wall and boss, the stop pin into its wall. */
export const tiltPins = () => {
  const into = TILT.side - PIN.boreT + TILT.gap + TILT.wall - 0.3;
  return { pivot: into + TILT.boss, stop: into };
};

const r2 = (v: number) => Math.round(v * 100) / 100;

registerAttachment<TiltBinOptions>({
  type: 'tiltBin',
  defaults: TILT_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = TILT_DEFAULTS;
    return {
      width: num(r.width, 50, 300, d.width),
      height: num(r.height, 40, 150, d.height),
      depth: num(r.depth, 45, 160, d.depth),
      angle: num(r.angle, 30, 60, d.angle),
      dividers: int(r.dividers, 0, 8, d.dividers),
      label: bool(r.label, d.label),
      stack: int(r.stack, 1, 4, d.stack),
      liftOff: bool(r.liftOff, d.liftOff),
    };
  },
  layout(o, ctx) {
    const p = tiltPlan(o);
    const h = Math.max(p.h, minHeight(ctx));
    const m = backMounts(o.width, h, ctx, { rows: 2 + 2 * o.stack });
    return { w: o.width, h, depth: p.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Tip-out bin${o.stack > 1 ? ` × ${o.stack}` : ''} ${Math.round(o.width)} × ${Math.round(tiltPlan(o).depth)} × ${Math.round(o.height)}`,
  // The frame's back between its sides, over its floor: the bins come off their pins first.
  backPlate: (_o, l) => ({ x0: TILT.side, x1: l.w - TILT.side, y0: TILT.floor, y1: l.h, z: TILT.back }),
  notes(o) {
    const p = tiltPlan(o);
    const out = leverNotes(p.depth, p.h);
    if (p.depth < o.depth) out.push(`A tip-out bin is at most about as deep as it is tall: ${Math.round(p.depth)} mm deep at this height.`);
    if (p.binW / (o.dividers + 1) < 15) out.push('Sections under 15 mm wide are hard to reach into.');
    return out;
  },
  parts(o) {
    const p = tiltPlan(o);
    const T = TILT;
    const L = tiltPins();
    const out: AttachmentPart[] = [];
    for (let k = 0; k < o.stack; k++) {
      const y = p.yP(k);
      out.push({
        key: `b${k}`,
        name: 'Tip-out bin',
        spec: { ...o, p: 'bin' },
        w: r2(p.binW),
        d: r2(p.d + T.a + T.pull),
        h: r2(p.R + T.a),
        place: { at: [T.side + T.gap, r2(y - T.a), r2(p.zP - p.d)], turn: [-90, 0, 0] },
      });
      // Pins from the outside, their heads sunk in the frame's sides: the pivot, and the stop in the bin's slot.
      const head = PIN.boreT - PIN.headT;
      const sy = r2(y + p.stop[1]);
      const sz = r2(p.zP + p.stop[0]);
      out.push(
        pinPart(`p${k}l`, L.pivot, pinAlongX(head, y, p.zP, L.pivot)),
        pinPart(`p${k}r`, L.pivot, pinAlongX(o.width - head, y, p.zP, L.pivot, true)),
        pinPart(`s${k}l`, L.stop, pinAlongX(head, sy, sz, L.stop)),
        pinPart(`s${k}r`, L.stop, pinAlongX(o.width - head, sy, sz, L.stop, true)),
      );
    }
    return out;
  },
  hardware(o) {
    const lw = Math.min(tiltPlan(o).binW - 8, 60);
    return o.label ? [{ item: 'Label card', count: o.stack, note: `${Math.floor(lw - 2)} × 12.5 mm` }] : [];
  },
});
