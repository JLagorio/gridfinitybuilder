/**
 * Stick rack: holes for long thin things standing up (or leaning toward you):
 * pens, pencils, markers, brushes, drumsticks, knitting needles, crochet
 * hooks, chopsticks. One size in staggered rows, or a list of sizes (a set of
 * needles), left to right and front to back. The bottle rack's build
 * (bottleRack.ts): tubes standing on the bed, rows stepped up toward the back.
 * Bottoms closed, with a drain hole, or open right through (brushes hang
 * bristles down by the swell of the handle, and dry).
 */
import { bool, int, num, obj, pick, registerAttachment, str } from '../registry';
import { gridRows, rackLayout, rackNotes, type RackSpec } from './bottleRack';
import { parseSizes } from './toolRack';

export interface StickRackOptions {
  mode: 'same' | 'list';
  /** One size: the stick's diameter, how many across, rows (staggered: every other one a hole shorter). */
  diameter: number;
  columns: number;
  rows: number;
  stagger: boolean;
  /** A list: diameters (text, "2, 2.5, 3"), filled into `rows` rows. */
  sizes: string;
  /** Each side, mm. */
  clearance: number;
  cup: number;
  step: number;
  tilt: number;
  floor: 'closed' | 'drain' | 'open';
  label: boolean;
  wall: number;
}

export const STICK_RACK_DEFAULTS: StickRackOptions = {
  mode: 'same',
  diameter: 11,
  columns: 8,
  rows: 2,
  stagger: true,
  sizes: '2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10',
  clearance: 0.5,
  cup: 40,
  step: 8,
  tilt: 10,
  floor: 'closed',
  label: true,
  wall: 1.6,
};

/** The sizes in a list, as many to a row as fit them into `rows` rows. */
export function listRows(sizes: number[], rows: number): number[][] {
  const per = Math.ceil(sizes.length / Math.max(1, rows));
  const out: number[][] = [];
  for (let i = 0; i < sizes.length; i += per) out.push(sizes.slice(i, i + per));
  return out;
}

export function stickSpec(o: StickRackOptions): RackSpec {
  const c = 2 * o.clearance;
  const list = o.mode === 'list';
  const rows = list ? listRows(parseSizes(o.sizes), o.rows).map((r) => r.map((v) => v + c)) : gridRows(o.diameter + c, o.columns, o.rows, o.stagger);
  return {
    shape: 'round',
    rows,
    corner: 0,
    wall: o.wall,
    step: o.step,
    tilt: o.tilt,
    cup: o.cup,
    floor: o.floor === 'drain' ? 'hole' : o.floor === 'open' ? 'ring' : 'closed',
    neck: 0,
    label: o.label,
  };
}

registerAttachment<StickRackOptions>({
  type: 'stickRack',
  defaults: STICK_RACK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = STICK_RACK_DEFAULTS;
    return {
      mode: pick(r.mode, ['same', 'list'] as const, d.mode),
      diameter: num(r.diameter, 1, 40, d.diameter),
      columns: int(r.columns, 1, 30, d.columns),
      rows: int(r.rows, 1, 6, d.rows),
      stagger: bool(r.stagger, d.stagger),
      sizes: typeof r.sizes === 'string' ? str(r.sizes, 200) : d.sizes,
      clearance: num(r.clearance, 0, 3, d.clearance),
      cup: num(r.cup, 5, 150, d.cup),
      step: num(r.step, 0, 40, d.step),
      tilt: num(r.tilt, 0, 30, d.tilt),
      floor: pick(r.floor, ['closed', 'drain', 'open'] as const, d.floor),
      label: bool(r.label, d.label),
      wall: num(r.wall, 1.2, 4, d.wall),
    };
  },
  layout: (o, ctx) => rackLayout(stickSpec(o), ctx),
  summary(o) {
    const n = stickSpec(o).rows.reduce((t, r) => t + r.length, 0);
    return o.mode === 'list' ? `Stick rack, ${n} hole${n === 1 ? '' : 's'}` : `Stick rack, ${n} × ⌀${Math.round(o.diameter * 10) / 10}`;
  },
  notes(o, ctx) {
    const out = rackNotes(stickSpec(o), ctx);
    if (o.mode === 'list' && !parseSizes(o.sizes).length) out.push('No sizes yet: list them in mm, like “3, 4, 5”.');
    return out;
  },
});
