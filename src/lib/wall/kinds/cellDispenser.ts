/**
 * Battery dispenser: a chute per column, loaded from the top, that cells drop
 * down one by one. At the foot of each chute the front wall stops one cell
 * (and the clearance) above the floor: the bottom cell goes out under it onto
 * a tray, where a lip holds it, and the cell above, now on the floor, waits
 * behind it. Round cells (AA to D, 18650, 21700) lie across the chute and the
 * floor falls 10° to the front, so they roll out by themselves; coins and 9V
 * blocks stack flat on a level floor and slide out with a fingertip, from a
 * groove under the tray and the stack. A window down the front shows how many
 * are left. 0.5 mm clearance is what keeps cells from jamming.
 *
 * Printed upright as it hangs: the floor on the bed, the chutes' walls standing
 * on it, open at the top. Above a long cell the front wall springs from the
 * gate in a 45° arch (it holds the cells above by their ends); over a coin
 * it is a short bridge. Clips across the top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface CellDispenserOptions {
  /** How the cells lie: round on their side (they roll), coins or blocks (9V) flat. */
  shape: 'round' | 'coin' | 'block';
  /** Round cells and coins: diameter; a block: front to back, mm. */
  diameter: number;
  /** Round cells: length; a block: left to right, mm. */
  length: number;
  /** Coins and blocks: thickness (they stack on it), mm. */
  thick: number;
  columns: number;
  /** Cells each chute holds. */
  capacity: number;
  /** Added to the cell's diameter (front to back) and twice to its length, mm. */
  clearance: number;
  /** The window down each front, mm wide (0: none). */
  window: number;
}

export const CELL_DEFAULTS: CellDispenserOptions = {
  shape: 'round',
  diameter: 14.5,
  length: 50.5,
  thick: 3.2,
  columns: 2,
  capacity: 8,
  clearance: 0.5,
  window: 6,
};

/** Back plate, walls, floor at the lip, room over the top cell, the gate's bar over a coin, the least width (two clip columns); mm. The floor's fall for round cells, degrees. */
export const CELL = { back: 3, wall: 2, floor: 2, spare: 3, bar: 3, minW: 52, slope: 10 } as const;

/**
 * The dispenser, mm: the cell across (a), front to back (b) and up (c); a chute's
 * width and lane; where the chutes start and their walls; the front wall's inside
 * (zf) and the lip's (zl); the floor's height at z, the gate (how high the front
 * wall's foot is), the lip's height over the floor, and the whole size.
 */
export function cellPlan(o: CellDispenserOptions) {
  const { back, wall, floor } = CELL;
  const round = o.shape === 'round';
  const a = o.shape === 'coin' ? o.diameter : o.length;
  const b = o.diameter;
  const c = round ? o.diameter : o.thick;
  const across = a + 2 * o.clearance;
  const lane = b + o.clearance;
  const zf = back + lane;
  const zl = zf + wall + lane;
  const tan = round ? Math.tan((CELL.slope * Math.PI) / 180) : 0;
  const floorAt = (z: number) => floor + Math.max(0, zl - z) * tan;
  const chutes = o.columns * across + (o.columns + 1) * wall;
  const W = Math.max(chutes, CELL.minW);
  return {
    round,
    a,
    b,
    c,
    across,
    lane,
    x0: (W - chutes) / 2,
    chutes,
    zf,
    zl,
    tan,
    floorAt,
    gate: floorAt(zf) + c + o.clearance,
    lip: round ? Math.max(2, 0.2 * b) : Math.min(6, Math.max(1.2, 0.6 * c)),
    W,
    H: floorAt(back) + o.capacity * c + CELL.spare,
    D: zl + wall,
  };
}

const cellHeight = (o: CellDispenserOptions, ctx: MountCtx) => Math.max(cellPlan(o).H, minHeight(ctx));

/** Common cells by diameter × length (or thickness), for the summary. */
const NAMES: [string, number, number][] = [
  ['AA', 14.5, 50.5],
  ['AAA', 10.5, 44.5],
  ['C', 26.2, 50],
  ['D', 34.2, 61.5],
  ['18650', 18.5, 65],
  ['21700', 21, 70],
  ['CR2032', 20, 3.2],
  ['CR2025', 20, 2.5],
  ['CR2016', 20, 1.6],
  ['LR44', 11.6, 5.4],
];

registerAttachment<CellDispenserOptions>({
  type: 'cellDispenser',
  defaults: CELL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CELL_DEFAULTS;
    return {
      shape: pick(r.shape, ['round', 'coin', 'block'] as const, d.shape),
      diameter: num(r.diameter, 5, 60, d.diameter),
      length: num(r.length, 5, 120, d.length),
      thick: num(r.thick, 1, 40, d.thick),
      columns: int(r.columns, 1, 8, d.columns),
      capacity: int(r.capacity, 2, 60, d.capacity),
      clearance: num(r.clearance, 0, 3, d.clearance),
      window: num(r.window, 0, 20, d.window),
    };
  },
  layout(o, ctx) {
    const p = cellPlan(o);
    const h = cellHeight(o, ctx);
    const m = backMounts(p.W, h, ctx, { rows: 3 });
    return { w: p.W, h, depth: p.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary(o) {
    const size = o.shape === 'round' ? o.length : o.thick;
    const block = o.shape === 'block';
    const name = block
      ? o.diameter === 26.5 && o.length === 48.5 && o.thick === 17.5
        ? '9V'
        : 0
      : NAMES.find((n) => n[1] === o.diameter && n[2] === size)?.[0];
    const what = name || (block ? `${o.length} × ${o.diameter} × ${o.thick}` : `⌀${o.diameter} × ${size}`);
    return `${what} dispenser, ${o.columns} × ${o.capacity}`;
  },
  labelFace(o, l) {
    // On the front wall at the top: across the chutes, or with windows down them, beside the first one's.
    const p = cellPlan(o);
    const H = l.h;
    const win = Math.min(o.window, 0.5 * p.a);
    const coin = o.shape === 'coin';
    const y1 = H - 3 - win / 2;
    const low = coin ? p.gate + CELL.bar : p.gate + (p.across - win) / 2;
    const windows = win > 0 && (coin ? y1 >= low + 2 : y1 > low + 1);
    const y0 = windows ? low : coin ? p.gate + CELL.bar : p.gate + p.across / 2;
    const top = windows ? y1 : H;
    const h = Math.min(12, top - y0 - 2);
    const w = windows ? CELL.wall + (p.across - win) / 2 - 2 : p.chutes - 2;
    const zt = p.zf + CELL.wall;
    return h >= 5 && w >= 12 ? { x: p.x0 + 1, y: top - 1 - h, w, h, z: zt, normal: 'front' } : null;
  },
  backPlate(o, l) {
    // Beside the chutes, when it's wider than they are; their front wall is in front of the rest.
    const p = cellPlan(o);
    return p.x0 >= 9
      ? [
          { x0: 0, x1: p.x0, y0: 0, y1: l.h, z: CELL.back },
          { x0: p.x0 + p.chutes, x1: l.w, y0: 0, y1: l.h, z: CELL.back },
        ]
      : null;
  },
  notes(o, ctx) {
    const h = cellHeight(o, ctx);
    const out = leverNotes(cellPlan(o).D, h);
    if (h > 250) out.push(`It's ${Math.round(h)} mm tall: hold fewer cells, or check your printer takes it.`);
    if (o.clearance < 0.3) out.push('Under 0.3 mm clearance the cells may jam.');
    if (o.shape === 'round' && o.length < 1.2 * o.diameter) out.push('Cells this short may turn in the chute: dispense them as coins.');
    return out;
  },
});
