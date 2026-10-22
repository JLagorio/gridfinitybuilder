/**
 * Cabinet: a small cupboard on the board with a door on a pin hinge down its
 * left or right front edge, shelves inside, a magnet catch, a window in the
 * door if you like.
 *
 * It prints upright as it hangs, so nothing in it may be a roof over air: the
 * body is the back plate, the side walls and the floor; the top is a plate
 * that slides in from the front in dovetail grooves (lidBox.ts), and the
 * shelves are plates that slide in on ledges whose undersides rise at 45°.
 * The hinge's knuckles alternate up the front edge, the cabinet's standing on
 * the floor and on 45° cones over the door's, so they need no support either;
 * the door prints flat on its face. The pin drops in from the top, through
 * the top plate (its head on it, so it also locks the top in), the knuckles
 * and into the floor. Clips across the top of the back, studs below.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type AttachmentPart } from '../registry';
import { PIN, magnetHardware, pinHardware, pinPart, type PinKind } from './hinge';
import { LID } from './lidBox';
import { leverNotes } from './shelf';

export interface CabinetOptions {
  width: number;
  height: number;
  /** Out from the board, mm. */
  depth: number;
  shelves: number;
  /** The side the hinge is on. */
  door: 'left' | 'right';
  magnets: boolean;
  /** An opening in the door, with a rebate behind it for a clear sheet. */
  window: boolean;
  pin: PinKind;
  wall: number;
}

export const CABINET_DEFAULTS: CabinetOptions = {
  width: 120,
  height: 120,
  depth: 80,
  shelves: 1,
  door: 'left',
  magnets: true,
  window: false,
  pin: 'printed',
  wall: 2,
};

/** mm: the door's thickness and the gap behind it, how far the top plate sits below the walls' top, a shelf's ledge on the side away from the hinge. */
export const CAB = { door: 3.2, behind: 0.5, sink: 2.2, ledge: 4 } as const;

/**
 * Where things are, drawn with the hinge on the left (a right-hand door is the mirror image): the hinge's axis, the
 * side walls' front, the top plate's bottom and top, the top of the hinge (under the top plate's rail), each shelf's
 * bottom, and the shelves' extent (clear of the hinge at the front left).
 */
export function cabPlan(o: CabinetOptions) {
  const R = PIN.knuckle;
  const zh = o.depth - (R - 0.6);
  const y1 = o.height - CAB.sink;
  const y0 = y1 - LID.slide;
  const hinge = y0 - LID.c - 3 - LID.rail;
  const gap = (hinge - LID.floor) / (o.shelves + 1);
  return {
    R,
    xh: R,
    zh,
    sides: o.depth - CAB.door - CAB.behind,
    y0,
    y1,
    hinge,
    shelf: Array.from({ length: o.shelves }, (_, k) => LID.floor + (k + 1) * gap - LID.slide / 2),
    gap,
    x0: 2 * R + 1,
    x1: o.width - o.wall - 0.3,
    z0: LID.back + 0.3,
    z1: zh - R - 1,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

registerAttachment<CabinetOptions>({
  type: 'cabinet',
  defaults: CABINET_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CABINET_DEFAULTS;
    return {
      width: num(r.width, 60, 250, d.width),
      height: num(r.height, 60, 250, d.height),
      depth: num(r.depth, 40, 200, d.depth),
      shelves: int(r.shelves, 0, 4, d.shelves),
      door: pick(r.door, ['left', 'right'] as const, d.door),
      magnets: bool(r.magnets, d.magnets),
      window: bool(r.window, d.window),
      pin: pick(r.pin, ['printed', 'steel'] as const, d.pin),
      wall: num(r.wall, 1.6, 4, d.wall),
    };
  },
  layout(o, ctx) {
    const h = Math.max(o.height, minHeight(ctx));
    const m = backMounts(o.width, h, ctx, { rows: 4 });
    return { w: o.width, h, depth: o.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) =>
    `Cabinet ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}${o.shelves ? `, ${o.shelves} shel${o.shelves > 1 ? 'ves' : 'f'}` : ''}`,
  notes(o) {
    const out = leverNotes(o.depth, o.height);
    if (o.shelves && cabPlan(o).gap < 20) out.push('Shelves under 20 mm apart are hard to reach between.');
    return out;
  },
  parts(o) {
    const p = cabPlan(o);
    const W = o.width;
    const right = o.door === 'right';
    // Drawn with the hinge on the left: a right-hand door's parts land mirrored.
    const x = (x0: number, w: number) => r2(right ? W - x0 - w : x0);
    const out: AttachmentPart[] = [];
    const g = LID.groove + LID.c;
    const plate = (key: string, name: string, x0: number, x1: number, y: number, z1: number) =>
      out.push({
        key,
        name,
        spec: { ...o, p: key },
        w: r2(x1 - x0),
        d: r2(z1 - p.z0),
        h: LID.slide,
        place: { at: [x(x0, x1 - x0), r2(y), p.z0], turn: [-90, 0, 0] },
      });
    plate('top', 'Top', g, W - g, p.y0, p.sides);
    p.shelf.forEach((y, k) => plate(`shelf${k}`, 'Shelf', p.x0, p.x1, y, p.z1));
    // The door prints on its face.
    out.push({
      key: 'door',
      name: 'Door',
      spec: { ...o, p: 'door' },
      w: W,
      d: o.height,
      h: r2(o.depth - p.zh + p.R),
      place: { at: [0, 0, r2(p.zh - p.R)], turn: [0, 180, 0] },
    });
    if (o.pin === 'printed') {
      // Dropped in from the top, its head on the top plate.
      const len = r2(p.y1 - LID.floor - 0.5);
      out.push(pinPart('pin', len, { at: [x(p.xh - PIN.head / 2, PIN.head), r2(p.y1 - len), r2(p.zh - (PIN.d / 2 - PIN.flat))], turn: [0, 0, -90] }));
    }
    return out;
  },
  hardware(o) {
    const p = cabPlan(o);
    const win = cabWindow(o);
    return [
      ...pinHardware(o.pin, 1, p.y1 - 1),
      ...magnetHardware(o.magnets, 2),
      ...(o.window
        ? [{ item: 'Clear sheet (PET or acrylic, up to 1 mm)', count: 1, note: `${Math.floor(win.x1 - win.x0 + 6)} × ${Math.floor(win.y1 - win.y0 + 6)} mm` }]
        : []),
    ];
  },
});

/** The door's window (hinge on the left), and its rebate 3 mm round it. */
export function cabWindow(o: CabinetOptions) {
  const p = cabPlan(o);
  return { x0: 2 * p.R + 8, x1: o.width - 12, y0: 14, y1: o.height - 12 };
}
