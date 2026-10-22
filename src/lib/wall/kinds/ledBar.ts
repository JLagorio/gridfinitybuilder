/**
 * LED light bar: a bar that clips into the board and holds an LED strip on a
 * face aimed straight out or 30, 45 or 60° down, under a snap-on diffuser.
 *
 * Printed upright, as it hangs, with the bar along the bed. In its side view
 * the strip lies on a flat face (the floor) with a low wall below it; above
 * the strip nothing hangs out over the light, and the floor leans out from
 * upright by the aim's angle, so up to 45° it needs no support. The
 * diffuser, printed flat in clear or white PETG, closes the channel like a
 * C: its lower edge hooks into a groove behind the low wall's lip, its upper
 * edge snaps over the bar's top into a groove there. End caps close the
 * ends, with a hole for the wire.
 *
 * Side view coordinates: `u` up the floor (from its lower edge), `v` out from
 * it (along the light); `ledFrame` maps them to the wall's (z, y). Units mm.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import type { Vec2 } from '../../geometry/kernel';

export interface LedBarOptions {
  length: number;
  /** Strip width: 8, 10 or 12 mm. */
  strip: number;
  /** How far down the light points, degrees: 0 (straight out), 30, 45 or 60. */
  angle: number;
  diffuser: boolean;
  /** Closed ends, with a hole for the wire. */
  caps: boolean;
  /** Which capped end the wire leaves by. */
  wire: 'left' | 'right' | 'both';
}

export const LED_DEFAULTS: LedBarOptions = { length: 200, strip: 10, angle: 30, diffuser: true, caps: true, wire: 'right' };

export const LED_ANGLES = [0, 30, 45, 60];

/**
 * Sizes: channel depth (floor to the diffuser), clearance, diffuser thickness, bar behind the floor,
 * lip and groove (both edges: lip, groove width and depth), the top face behind the upper groove, end cap.
 */
export const LED = { D: 7, c: 0.2, T: 1.2, back: 4, lip: 1.2, gw: 1.6, gd: 1.2, top: 3.8, cap: 2 } as const;

/** The side view: floor length `s`, height `H` (without caps) and `p(u, v)` → wall (z, y). */
export function ledFrame(o: LedBarOptions, ctx: MountCtx) {
  const a = (o.angle * Math.PI) / 180;
  const sn = Math.sin(a);
  const cs = Math.cos(a);
  // The strip with 0.5 mm each side, and 1 mm of floor above it.
  const s = o.strip + 2;
  // The low wall's lip stays 2 mm above the bed; the bar is tall enough for its clips.
  const y0 = Math.max(LED.D * sn + 2, minHeight(ctx) - s * cs - LED.top * sn);
  const p = (u: number, v: number): Vec2 => [LED.back + u * sn + v * cs, y0 + u * cs - v * sn];
  return { s, p, H: y0 + s * cs + LED.top * sn };
}

/** The diffuser's pieces (lower hook and leg, panel, upper return and hook) in (u, v). */
export function diffuserPieces(s: number): Vec2[][] {
  const { D, c, T, lip, gw, gd } = LED;
  const r = (u0: number, v0: number, u1: number, v1: number): Vec2[] => [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const lo = D - lip - gw + c;
  const hi = -lip - gw + c;
  return [
    r(c, D + c, s + c + T, D + c + T),
    r(c, lo, c + T, D + c + T),
    r(c - gd, lo, c + c, D - lip - c),
    r(s + c, hi, s + c + T, D + c + T),
    // The upper hook's leading face is a ramp, so it rides up over the bar's top edge.
    [
      [s + c, hi],
      [s + c + c, hi],
      [s + c + c, -lip - c],
      [s + c - gd, -lip - c],
      [s + c - gd, -lip - c - 0.2],
    ],
  ];
}

registerAttachment<LedBarOptions>({
  type: 'ledBar',
  backPlate: () => null,
  defaults: LED_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = LED_DEFAULTS;
    const n = (v: unknown, all: number[], dflt: number) => (all.includes(Number(v)) ? Number(v) : dflt);
    return {
      length: num(r.length, 40, 400, d.length),
      strip: n(r.strip, [8, 10, 12], d.strip),
      angle: n(r.angle, LED_ANGLES, d.angle),
      diffuser: bool(r.diffuser, d.diffuser),
      caps: bool(r.caps, d.caps),
      wire: pick(r.wire, ['left', 'right', 'both'] as const, d.wire),
    };
  },
  layout(o, ctx) {
    const f = ledFrame(o, ctx);
    const { D, c, T, top } = LED;
    // Caps reach over the diffuser's ends.
    const h = o.caps ? f.p(f.s + c + T, -top)[1] : f.H;
    const depth = o.caps ? f.p(f.s + c + T, D + c + T)[0] : Math.max(f.p(0, D)[0], f.p(f.s, 0)[0]);
    const m = backMounts(o.length, f.H, ctx, { rows: 1 });
    return { w: o.length, h, depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `LED bar ${Math.round(o.length)} mm${o.angle ? `, ${o.angle}° down` : ''}`,
  notes: (o) => (o.angle > 45 ? [`Aimed ${o.angle}° down, the strip's face overhangs ${o.angle}°: print it with a good fan, or aim it 45°.`] : []),
  parts(o, ctx) {
    if (!o.diffuser) return [];
    const f = ledFrame(o, ctx);
    const pts = diffuserPieces(f.s).map((q) => q.map(([u, v]) => f.p(u, v)));
    const all = pts.flat();
    const x0 = o.caps ? LED.cap + 0.3 : 0;
    const len = o.length - 2 * x0;
    const spec = { pts, len, angle: o.angle };
    const at: [number, number, number] = [x0, Math.min(...all.map((q) => q[1])), Math.min(...all.map((q) => q[0]))];
    return [
      {
        key: 'diffuser',
        name: 'Diffuser (clear or white PETG)',
        spec,
        w: len,
        d: f.s + LED.T + LED.gd,
        h: LED.D + LED.T + LED.lip + LED.gw,
        place: { at, turn: [o.angle - 180, 0, 0] },
      },
    ];
  },
  hardware: (o) => [
    {
      item: `LED strip ${o.strip} mm wide`,
      count: 1,
      note: `${Math.floor(o.length - (o.caps ? 2 * LED.cap : 0))} mm, cut on its marks; a 12 or 24 V supply to suit it`,
    },
  ],
});
