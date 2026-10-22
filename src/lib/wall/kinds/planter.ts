/**
 * Planter: a sleeve a nursery pot drops into, its rim resting on the top edge
 * (the sleeve is 5 mm narrower than the rim), with a removable saucer under
 * it to catch the drips:
 * - round pots: the saucer twists in from below, three lugs riding up L slots
 *   in the sleeve's thicker foot and along them a third of a turn; a window
 *   each side lets you grip it to twist it out and empty it;
 * - square pots: the saucer is a tray that slides in from the front over the
 *   sleeve's floor, under a pointed opening.
 * Or a propagation rack: test tubes for cuttings in a row, standing in cups on
 * a foot and through a ledge higher up.
 *
 * Printed upright as it hangs (in PETG: it gets wet and sits in the sun):
 * every wall stands on the bed, the slots' tops are 1.6 mm ledges, the
 * openings rise to a point at 45°, the tube ledge stands on a 45° underside.
 * Clips across the top of the back, studs low on it.
 */
import type { Vec2 } from '../../geometry/kernel';
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type AttachmentPart, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface PlanterOptions {
  mode: 'pot' | 'tubes';
  shape: 'round' | 'square';
  /** The pot: across its rim, and its height, mm. */
  size: number;
  potH: number;
  /** Test tubes: diameter, length and how many. */
  tube: number;
  tubeLen: number;
  count: number;
}

export const PLANTER_DEFAULTS: PlanterOptions = { mode: 'pot', shape: 'round', size: 77, potH: 70, tube: 20, tubeLen: 150, count: 5 };

/**
 * Back plate, sleeve wall, its foot round a round pot, how far in from the rim
 * the sleeve's inside is, the saucer's height, the room between it and the
 * pot, the square sleeve's floor, the test tubes' ledge, mm.
 */
export const POT = { back: 3, wall: 2.4, band: 3.6, grip: 2.5, saucer: 14, room: 3, floor: 2, ledge: 4 } as const;

/** The twist-lock: the lugs' angles seated (degrees round the pot, 0 at the front, 90 to the right), each lug's arc, the turn to lock, its height, its bottom above the saucer's, how far out past the sleeve's inside. */
export const LUG = { at: [10, 150, 230], arc: 14, turn: 30, h: 4, y: 6, out: 1.2 } as const;

/** A lug seated at `a` degrees: its outline round the pot's axis (x, z offsets) between radii r0 and r1. */
export function lugOutline(a: number, r0: number, r1: number, half: number = LUG.arc / 2): Vec2[] {
  const pts: Vec2[] = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = ((a - half + (2 * half * i) / n) * Math.PI) / 180;
    pts.push([r1 * Math.sin(t), r1 * Math.cos(t)]);
  }
  for (let i = n; i >= 0; i--) {
    const t = ((a - half + (2 * half * i) / n) * Math.PI) / 180;
    pts.push([r0 * Math.sin(t), r0 * Math.cos(t)]);
  }
  return pts;
}

/**
 * Sizes, mm: width `w`, depth `d` and height `h` (a pot's rim rests on the
 * sleeve's top; tubes: the ledge's top). A round sleeve's inside radius `r`,
 * its centre `cx`, `cz` and the saucer's radius `rd`; a square sleeve's inside
 * `si` from `z0`; tubes' pitch, cup depth and the foot's height.
 */
export function potPlan(o: PlanterOptions) {
  const { back, wall, band, grip, saucer, room, floor } = POT;
  const r = o.size / 2 - grip;
  const si = o.size - 2 * grip;
  const z0 = back + grip + 0.5;
  const cz = back + o.size / 2 + 0.5;
  const pitch = o.tube + 8;
  const cup = Math.min(8, o.tube / 2);
  const all = { r, rd: r - 0.4, cx: r + band, cz, si, z0, pitch, cup, foot: 3 + cup };
  if (o.mode === 'tubes') return { ...all, w: o.count * pitch + 4, d: back + o.tube + 8, h: 3 + 0.55 * o.tubeLen };
  if (o.shape === 'round') return { ...all, w: 2 * (r + band), d: cz + r + band, h: saucer + room + o.potH };
  return { ...all, w: si + 2 * wall, d: z0 + si + wall, h: floor + saucer + room + o.potH };
}

const potHeight = (o: PlanterOptions, ctx: MountCtx) => Math.max(potPlan(o).h, minHeight(ctx));

registerAttachment<PlanterOptions>({
  type: 'planter',
  defaults: PLANTER_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = PLANTER_DEFAULTS;
    return {
      mode: pick(r.mode, ['pot', 'tubes'] as const, d.mode),
      shape: pick(r.shape, ['round', 'square'] as const, d.shape),
      size: num(r.size, 40, 160, d.size),
      potH: num(r.potH, 30, 200, d.potH),
      tube: num(r.tube, 10, 32, d.tube),
      tubeLen: num(r.tubeLen, 60, 200, d.tubeLen),
      count: int(r.count, 1, 12, d.count),
    };
  },
  layout(o, ctx) {
    const p = potPlan(o);
    const h = potHeight(o, ctx);
    const m = backMounts(p.w, h, ctx, { rows: 3 });
    return { w: p.w, h, depth: p.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary(o) {
    if (o.mode === 'tubes') return `Propagation rack, ${o.count} × ⌀${+o.tube.toFixed(1)}`;
    const s = Math.round(o.size);
    return `Planter ${o.shape === 'round' ? `⌀${s}` : `${s} × ${s}`}`;
  },
  notes(o, ctx) {
    const out = leverNotes(potPlan(o).d, potHeight(o, ctx));
    if (potPlan(o).w > 250) out.push("Over 250 mm wide: if it doesn't fit your printer, make two racks.");
    return out;
  },
  labelFace(o, l) {
    const p = potPlan(o);
    // Tubes: the foot's front. A square sleeve: its front over the tray's opening. A round one has no flat face.
    if (o.mode === 'tubes') return { x: 2, y: 0.6, w: l.w - 4, h: p.foot - 1.2, z: l.depth, normal: 'front' };
    if (o.shape === 'round') return null;
    const apex = POT.floor + POT.saucer + 1 + (l.w - 2 * POT.wall) / 2;
    const h = Math.min(12, l.h - apex - 2);
    return h >= 6 ? { x: POT.wall + 1, y: l.h - 1 - h, w: l.w - 2 * POT.wall - 2, h, z: l.depth, normal: 'front' } : null;
  },
  backPlate(o, l) {
    const p = potPlan(o);
    // Tubes: between the foot and the ledge's underside (lift the tubes out). A square sleeve: through the tray's
    // opening (slide the tray out), its pointed top too. A round sleeve stands in front of the whole back.
    if (o.mode === 'tubes') return { x0: 0, x1: l.w, y0: p.foot, y1: Math.max(0, p.h - POT.ledge - (p.d - POT.back)), z: POT.back };
    if (o.shape === 'round') return null;
    const t = POT.wall;
    const yo = POT.floor + POT.saucer + 1;
    return [
      { x0: t, x1: l.w - t, y0: POT.floor, y1: yo, z: p.z0 },
      { x0: l.w / 2 - 6, x1: l.w / 2 + 6, y0: POT.floor, y1: yo + l.w / 2 - t - 6, z: p.z0 },
    ];
  },
  parts(o): AttachmentPart[] {
    if (o.mode === 'tubes') return [];
    const p = potPlan(o);
    const turn: [number, number, number] = [-90, 0, 0];
    if (o.shape === 'square') {
      // The tray: 0.4 clear of the sleeve's sides and back, its front flush with the sleeve's.
      const w = p.si - 0.8;
      return [
        {
          key: 'saucer',
          name: 'Drip tray',
          spec: { ...o },
          w,
          d: p.si + POT.wall - 0.4,
          h: POT.saucer,
          place: { at: [POT.wall + 0.4, POT.floor, p.z0 + 0.4], turn },
        },
      ];
    }
    // The saucer and its lugs, as far as they reach.
    const pts = LUG.at.flatMap((a) => lugOutline(a, p.rd - 0.5, p.r + LUG.out));
    const lo = (k: 0 | 1) => Math.min(-p.rd, ...pts.map((q) => q[k]));
    const hi = (k: 0 | 1) => Math.max(p.rd, ...pts.map((q) => q[k]));
    return [
      {
        key: 'saucer',
        name: 'Saucer',
        spec: { ...o },
        w: hi(0) - lo(0),
        d: hi(1) - lo(1),
        h: POT.saucer,
        place: { at: [p.cx + lo(0), 0, p.cz + lo(1)], turn },
      },
    ];
  },
  hardware: (o) => (o.mode === 'tubes' ? [{ item: `Test tube ⌀${+o.tube.toFixed(1)} × ${Math.round(o.tubeLen)}`, count: o.count }] : []),
});
