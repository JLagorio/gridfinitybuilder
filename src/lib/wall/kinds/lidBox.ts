/**
 * Lidded box: a box on the board with a lid, three ways.
 * - Slide: the lid slides in from the front in dovetail grooves along the
 *   tops of the side walls (the easiest: nothing moves but the lid).
 * - Hinge: a pin hinge along the back top, the lid swings up and leans on the
 *   board; magnets at the front hold it shut if you like.
 * - Flip: the front is a flap on a pin hinge along the bottom; it drops open
 *   onto a ledge, a little past level. The top is a plate in the side walls'
 *   grooves, held in by the closed flap.
 *
 * Everything prints without support. The box prints upright as it hangs:
 * grooves with 45° ceilings in rails whose undersides rise at 45°, knuckles
 * whose undersides rise at 45° to the back plate (or stand on the floor),
 * teardrop pin holes. Lids and flaps print flat, their knuckles cut flat on the
 * face that lies on the bed. Knuckles alternate along the pin, 0.5 mm apart:
 * the box's at both ends, the lid's between. Clips across the top of the back,
 * studs below.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type AttachmentPart } from '../registry';
import { PIN, magnetHardware, pinAlongX, pinHardware, pinPart, type PinKind } from './hinge';
import { leverNotes } from './shelf';

export interface LidBoxOptions {
  width: number;
  height: number;
  /** Out from the board, mm. */
  depth: number;
  wall: number;
  lid: 'slide' | 'hinge' | 'flip';
  /** A magnet catch (hinged lid or flap). */
  magnets: boolean;
  /** A card slot on the front (slide or hinged lid). */
  label: boolean;
  pin: PinKind;
}

export const LID_DEFAULTS: LidBoxOptions = { width: 100, height: 60, depth: 60, wall: 2, lid: 'hinge', magnets: false, label: false, pin: 'printed' };

/**
 * mm: back plate, floor; a sliding lid's and a top plate's thickness, a hinged lid's and a flap's; the grooves'
 * clearance, how far in from the outside their backs are, the rails they're cut in, how far a sliding lid sits below
 * the walls' top; the gap behind a flap, the ledge it drops onto; a magnet's pocket (diameter, depth).
 */
export const LID = { back: 3, floor: 2, slide: 2.4, plate: 3.2, c: 0.25, groove: 1.2, rail: 2.4, sink: 0.6, behind: 0.5, ledge: 8, pocket: 6.3, pocketD: 2.2 };

/** Where the parts are: a sliding lid's (or top plate's) bottom and top, the hinge's axis, the walls' top, a flap's front. */
export function lidPlan(o: LidBoxOptions) {
  const R = PIN.knuckle;
  const y1 = o.height - LID.sink;
  const flip = o.lid === 'flip';
  const front = flip ? o.depth - LID.ledge : o.depth;
  return {
    R,
    y0: y1 - LID.slide,
    y1,
    // Hinge: at the back top, clear of the back plate; flip: at the bottom front, clear of the floor.
    zh: flip ? front - (R - 0.6) : LID.back + R + 0.5,
    yh: flip ? LID.floor + R + 0.5 : o.height - (R - 0.6),
    top: o.lid === 'hinge' ? o.height - LID.plate : o.height,
    front,
    /** The side walls' front: behind a flap. */
    sides: flip ? front - LID.plate - LID.behind : o.depth,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

registerAttachment<LidBoxOptions>({
  type: 'lidBox',
  defaults: LID_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = LID_DEFAULTS;
    return {
      width: num(r.width, 40, 250, d.width),
      height: num(r.height, 30, 200, d.height),
      depth: num(r.depth, 30, 200, d.depth),
      wall: num(r.wall, 1.6, 4, d.wall),
      lid: pick(r.lid, ['slide', 'hinge', 'flip'] as const, d.lid),
      magnets: bool(r.magnets, d.magnets),
      label: bool(r.label, d.label),
      pin: pick(r.pin, ['printed', 'steel'] as const, d.pin),
    };
  },
  layout(o, ctx) {
    const h = Math.max(o.height, minHeight(ctx));
    const m = backMounts(o.width, h, ctx, { rows: 3 });
    // A label slot stands 2 mm proud of the front.
    return { w: o.width, h, depth: o.depth + (o.label && o.lid !== 'flip' ? 2 : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) =>
    `Box with ${o.lid === 'slide' ? 'sliding lid' : o.lid === 'hinge' ? 'hinged lid' : 'flap'} ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}`,
  notes: (o) => leverNotes(o.depth, o.height),
  labelFace(o, l) {
    // The front wall at the top (under a hinged lid's finger notch); a flap has its own front, a card slot takes the place.
    if (o.lid === 'flip' || o.label) return null;
    const p = lidPlan(o);
    const top = o.lid === 'hinge' ? p.top - 8 : p.y0 - LID.c;
    const h = Math.min(12, top - 2);
    return h >= 6 ? { x: o.wall + 1, y: top - 1 - h, w: l.w - 2 * o.wall - 2, h, z: o.depth, normal: 'front', depth: Math.min(0.6, o.wall / 2) } : null;
  },
  backPlate(o, l) {
    // With the flap down, inside over its knuckles and under the top plate's rails, between the rails (and the magnet
    // pillars). A box with a front wall has none: the wall is in front of the whole back.
    if (o.lid !== 'flip') return null;
    const p = lidPlan(o);
    const x = o.wall + (o.magnets ? 6 : LID.rail);
    return { x0: x, x1: l.w - x, y0: p.yh + p.R, y1: p.y0 - LID.c - 3 - LID.rail, z: LID.back };
  },
  parts(o) {
    const p = lidPlan(o);
    const W = o.width;
    const out: AttachmentPart[] = [];
    // A sliding lid or a top plate in the grooves, printed as it lies.
    const plate = (key: string, name: string, z1: number) =>
      out.push({
        key,
        name,
        spec: { ...o, p: key },
        w: r2(W - 2 * (LID.groove + LID.c)),
        d: r2(z1 - LID.back - 0.3),
        h: LID.slide,
        place: { at: [LID.groove + LID.c, p.y0, LID.back + 0.3], turn: [-90, 0, 0] },
      });
    if (o.lid === 'slide') plate('lid', 'Sliding lid', o.depth);
    else if (o.lid === 'hinge')
      // Printed upside down, its top on the bed.
      out.push({
        key: 'lid',
        name: 'Lid',
        spec: { ...o, p: 'lid' },
        w: W,
        d: r2(o.depth - p.zh + p.R),
        h: r2(o.height - p.yh + p.R),
        place: { at: [0, r2(p.yh - p.R), r2(p.zh - p.R)], turn: [90, 0, 0] },
      });
    else {
      plate('top', 'Top', p.sides);
      // Printed on its face.
      out.push({
        key: 'flap',
        name: 'Flap',
        spec: { ...o, p: 'flap' },
        w: W,
        d: r2(o.height - p.yh + p.R),
        h: r2(p.front - p.zh + p.R),
        place: { at: [0, r2(p.yh - p.R), r2(p.zh - p.R)], turn: [0, 180, 0] },
      });
    }
    if (o.lid !== 'slide' && o.pin === 'printed') {
      const len = W - PIN.boreT - 0.5;
      out.push(pinPart('pin', len, pinAlongX(PIN.boreT - PIN.headT, p.yh, p.zh, len)));
    }
    return out;
  },
  hardware(o) {
    const lw = Math.min(o.width - 2 * o.wall - 10, 60);
    return [
      ...(o.lid !== 'slide' ? pinHardware(o.pin, 1, o.width - 1) : []),
      ...magnetHardware(o.magnets && o.lid !== 'slide', 4),
      ...(o.label && o.lid !== 'flip' ? [{ item: 'Label card', count: 1, note: `${Math.floor(lw - 2)} × 12.5 mm` }] : []),
    ];
  },
});
