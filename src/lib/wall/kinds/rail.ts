/**
 * Storage rail ("infinite storage"): a rail across the board, N units long,
 * that bins or small drawers slide onto from the right and click into place
 * at every unit; a full-depth end panel stops them on the left, a drop-in
 * stop on the right. Up to three rails stack, one container height apart, so
 * one attachment can be a whole wall of storage. Printed upright as it hangs;
 * a clip behind the middle of every unit, studs below. A run longer than the
 * printer's bed is rails with open ends butted together: at 40 mm units the
 * units fall 20 mm either side of a slot column whatever the ends, so the
 * grid (and the click every 40 mm) carries on across the joints.
 *
 * The rail's profile (out from the board, up), made to print standing up:
 * a stem with a 45° underside, a lip rising from its front with a 45° flare
 * at the top, and a valley between the lip and the back. A container hooks
 * over the lip: its back wall drops into the valley behind it (it can't come
 * off forward), and its back wall in front of the lip tucks under the flare
 * (it can't lift off); over the lip it bridges 5 mm. So it only slides along.
 * A ridge on the back of the valley at the middle of every unit, and two
 * teeth on a springy strip cut in the container's back wall, are the detent.
 *
 * The containers are the rail's extra parts, printed upright, open side up:
 * bins (a low front, a scoop inside), or drawer sleeves with a drawer in each
 * unit (a drawer stops most of the way out). A container is a unit wide less
 * a 0.6 mm gap, and a row high less 10.2 mm (the rail under it). A label slot
 * on the fronts takes a card; a dovetail on the sides joins neighbours.
 */
import { backMounts } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type AttachmentPart } from '../registry';

export const RAIL_SIZES = ['1x1', '2x1', '1x2', '2x2', '3x1'] as const;

export interface RailOptions {
  /** Units along the rail. */
  length: number;
  /** One unit, mm: two board slots, or a Gridfinity cell. */
  unit: '40' | '42';
  /** Rails, one above the other. */
  rows: number;
  /** How far apart the rails are for each unit the containers are high, mm (they are 10.2 lower). */
  unitH: number;
  /** Containers' size in units, wide × high. */
  size: (typeof RAIL_SIZES)[number];
  kind: 'bin' | 'drawer';
  /** How many containers; 0: as many as fill the rails. */
  count: number;
  /** How far the containers stand out from the board, mm. */
  depth: number;
  /** A slot for a label card on each front. */
  label: boolean;
  /** Dovetails that join containers side by side. */
  links: boolean;
  /** Its ends: an end panel on the left and a stop on the right, or open for joining to the next rail of a run. */
  ends: 'both' | 'left' | 'right' | 'none';
}

export const RAIL_DEFAULTS: RailOptions = {
  length: 5,
  unit: '40',
  rows: 1,
  unitH: 40,
  size: '1x1',
  kind: 'bin',
  count: 0,
  depth: 60,
  label: true,
  links: false,
  ends: 'both',
};

/** Containers stand this far above a rail's foot; their backs (the teeth's tips) and drawers' backs this far out from the board (rail.geom.ts). */
export const RAIL_SEAT = 9.7;
export const RAIL_BACK = 3.3;
export const RAIL_BAY = 13.2;

/**
 * Sizes and counts: the unit, a container's size in units, a row's height,
 * a container's height, containers on a rail, room on them all, how many
 * there are, a drawer bay's width and height, the rail's length (a 2.4 mm end
 * panel, the units, 8 mm for the stop), where the units start, and whether it
 * has the end panel and the stop.
 */
export function railPlan(o: RailOptions) {
  const u = +o.unit;
  const [cw, ch] = o.size.split('x').map(Number);
  const S = ch * o.unitH;
  const per = Math.floor(o.length / cw);
  const cap = per * o.rows;
  const panel = /both|left/.test(o.ends);
  const stop = /both|right/.test(o.ends);
  const x0 = panel ? 2.4 : 0;
  return {
    u,
    cw,
    ch,
    S,
    H: S - 10.2,
    per,
    cap,
    n: o.count ? Math.min(o.count, cap) : cap,
    bw: u - 1.6 - 3.8 / cw,
    bh: (S - 11.8) / ch - 1.6,
    w: x0 + o.length * u + (stop ? 8 : 0),
    x0,
    panel,
    stop,
  };
}

registerAttachment<RailOptions>({
  type: 'rail',
  defaults: RAIL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = RAIL_DEFAULTS;
    return {
      length: int(r.length, 2, 14, d.length),
      unit: pick(r.unit, ['40', '42'] as const, d.unit),
      rows: int(r.rows, 1, 3, d.rows),
      unitH: num(r.unitH, 30, 100, d.unitH),
      size: pick(r.size, RAIL_SIZES, d.size),
      kind: pick(r.kind, ['bin', 'drawer'] as const, d.kind),
      count: int(r.count, 0, 42, d.count),
      depth: num(r.depth, 30, 150, d.depth),
      label: bool(r.label, d.label),
      links: bool(r.links, d.links),
      ends: pick(r.ends, ['both', 'left', 'right', 'none'] as const, d.ends),
    };
  },
  layout(o, ctx) {
    const p = railPlan(o);
    const h = o.rows * p.S;
    // Clips under the units (behind their middles at 40 mm), so butted rails line up; the end panel is as deep as the containers, the rail alone 10.7.
    const m = backMounts(o.length * p.u, h, ctx, { rows: 4 });
    return { w: p.w, h, depth: p.panel ? o.depth : 10.7, anchor: [p.x0 + m.anchor[0], m.anchor[1]], mounts: m.mounts, pose: 'upright' };
  },
  summary(o) {
    const n = railPlan(o).n;
    return `Rail ${o.length} units, ${n} ${o.kind}${n === 1 ? '' : 's'} ${o.size.replace('x', '×')}`;
  },
  notes(o) {
    const p = railPlan(o);
    const left = o.length - p.per * p.cw;
    const out = [];
    if (!p.per) out.push("Containers this wide don't fit the rail.");
    else if (left && p.n === p.cap) out.push(`${left} unit${left > 1 ? 's' : ''} left empty on each rail.`);
    if (o.depth > 120) out.push('Keep heavy things at the back of deep containers.');
    if (p.w > 250) out.push("Over 250 mm long: if it doesn't fit your printer, build the run from shorter rails with open ends.");
    if (o.ends !== 'both' && p.u > 40) out.push("42 mm units don't line up with the board's slots: rails won't meet end to end.");
    return out;
  },
  parts(o) {
    const p = railPlan(o);
    const drawer = o.kind === 'drawer';
    const out: AttachmentPart[] = [];
    const turn: [number, number, number] = [-90, 0, 0];
    // Left to right from where the units start (half the gap between neighbours in), the bottom rail first.
    for (let k = 0; k < p.n; k++) {
      const x = p.x0 + 0.3 + (k % p.per) * p.cw * p.u;
      const y = Math.floor(k / p.per) * p.S + RAIL_SEAT;
      out.push({
        key: `c${k}`,
        name: drawer ? 'Drawer sleeve' : 'Bin',
        spec: { ...o, p: drawer ? 'sleeve' : 'bin' },
        w: p.cw * p.u - 0.6 + (o.links ? 1.8 : 0),
        d: o.depth - RAIL_BACK - (drawer ? 6 : 0),
        h: p.H,
        place: { at: [x, y, RAIL_BACK], turn },
      });
      // A drawer in each unit of a sleeve.
      for (let j = 0; drawer && j < p.cw * p.ch; j++)
        out.push({
          key: `d${k}-${j}`,
          name: 'Drawer',
          spec: { ...o, p: 'drawer' },
          w: p.bw - 0.2,
          d: o.depth - RAIL_BAY,
          h: p.bh - 0.4,
          place: { at: [x + 2.5 + (j % p.cw) * (p.bw + 1.6), y + 1.6 + Math.floor(j / p.cw) * (p.bh + 1.6), RAIL_BAY], turn },
        });
    }
    // A stop in the pocket at the right end of each rail, printed on its side.
    for (let r = 0; p.stop && r < o.rows; r++)
      out.push({
        key: `s${r}`,
        name: 'Rail stop',
        spec: { p: 'stop' },
        w: 7.6,
        d: 15.9,
        h: 6,
        place: { at: [p.w - 7.7, r * p.S + 5.3, 3.1], turn: [0, 90, 0] },
      });
    return out;
  },
  hardware(o) {
    const p = railPlan(o);
    const drawer = o.kind === 'drawer';
    // The geometry's card slots (rail.geom.ts labelWidth): drawers too short for one under the pull have none.
    const card = drawer ? (p.bh < 22.9 ? 0 : Math.min(p.bw - 8.8, 48)) : Math.min(p.cw * p.u - 8.6, 58);
    const n = p.n * (drawer ? p.cw * p.ch : 1);
    return o.label && card && n ? [{ item: 'Label card', count: n, note: `${Math.floor(card)} × 12.5 mm` }] : [];
  },
});
