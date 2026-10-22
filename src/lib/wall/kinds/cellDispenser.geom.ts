/**
 * Battery dispenser geometry (planning in cellDispenser.ts), in the part's
 * frame: x across, y up, z out from the board. Every chute shares its walls
 * with the next; the floor runs under the chutes and the trays to the lip.
 *
 * The front wall is a plate with an opening per chute: the gate across the
 * chute's foot, then over long cells a 45° arch up to the window (or a
 * pointed arch without one), over coins a bar the width of the chute and the
 * window above it, its top pointed at 45°. So nothing overhangs more than
 * 45°, and the only bridge is a coin chute's bar, as wide as the coin.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { CELL, cellPlan, type CellDispenserOptions } from './cellDispenser';

/** (z, y) points to prismX's (d, y). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

type Plan = ReturnType<typeof cellPlan>;

/** The opening in the front wall over a chute from x0 (front view): the gate, and over a long cell the arch and the window. */
function opening(p: Plan, x0: number, win: number, top: number, coin: boolean): Vec2[] {
  const a = p.across;
  const g = p.gate;
  const xm = x0 + a / 2;
  // The window's top: its pointed tip 3 mm under the top.
  const y1 = top - 3 - win / 2;
  if (coin)
    return [
      [x0, -1],
      [x0 + a, -1],
      [x0 + a, g],
      [x0, g],
    ];
  const spring = g + (a - win) / 2;
  if (win > 0 && y1 > spring + 1) {
    return [
      [x0, -1],
      [x0 + a, -1],
      [x0 + a, g],
      [xm + win / 2, spring],
      [xm + win / 2, y1],
      [xm, y1 + win / 2],
      [xm - win / 2, y1],
      [xm - win / 2, spring],
      [x0, g],
    ];
  }
  return [
    [x0, -1],
    [x0 + a, -1],
    [x0 + a, g],
    [xm, g + a / 2],
    [x0, g],
  ];
}

/** The window over a coin's bar: from the bar up to a pointed top, or nothing when there's no room. */
function coinWindow(p: Plan, x0: number, win: number, top: number): Vec2[] | null {
  const xm = x0 + p.across / 2;
  const y0 = p.gate + CELL.bar;
  const y1 = top - 3 - win / 2;
  if (win <= 0 || y1 < y0 + 2) return null;
  return [
    [xm - win / 2, y0],
    [xm + win / 2, y0],
    [xm + win / 2, y1],
    [xm, y1 + win / 2],
    [xm - win / 2, y1],
  ];
}

export const cellDispenserBuilder: AttachmentBuilder<CellDispenserOptions> = {
  body(w, s, o, layout) {
    const p = cellPlan(o);
    const { back, wall, floor } = CELL;
    const H = layout.h;
    const { x0, zf, zl, D } = p;
    const x1 = x0 + p.chutes;
    // A coin is round seen from above: only a bar across the whole chute holds the ones above it.
    const coin = o.shape === 'coin';
    // The window: narrower than half the cell, so it can't fall through.
    const win = Math.min(o.window, 0.5 * p.a);
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, p.W, H, back))];
    // The floor: level at the lip, rising to the back.
    parts.push(
      prismX(
        w,
        s,
        zy([
          [0, 0],
          [D, 0],
          [D, floor],
          [zl, floor],
          [back, p.floorAt(back)],
          [0, p.floorAt(back)],
        ]),
        x0,
        p.chutes,
      ),
    );
    // The walls between the chutes: full height to the front wall, then as low as the lip over the tray.
    const zt = zf + wall;
    const side = zy([
      [0, 0],
      [D, 0],
      [D, floor + p.lip],
      [zl, floor + p.lip],
      [zt, p.floorAt(zt) + p.lip],
      [zt, H],
      [0, H],
    ]);
    for (let k = 0; k <= o.columns; k++) parts.push(prismX(w, s, side, x0 + k * (p.across + wall), wall));
    // The front wall, its openings cut.
    const cuts: Manifold[] = [];
    for (let k = 0; k < o.columns; k++) {
      const xa = x0 + wall + k * (p.across + wall);
      cuts.push(prismZ(w, s, opening(p, xa, win, H, coin), zf - 1, zt + 1));
      const cw = coin ? coinWindow(p, xa, win, H) : null;
      if (cw) cuts.push(prismZ(w, s, cw, zf - 1, zt + 1));
    }
    parts.push(s.t(s.t(boxAt(w, x0, 0, zf, x1, H, zt)).subtract(s.t(w.Manifold.union(cuts)))));
    // The lip.
    parts.push(s.t(boxAt(w, x0, 0, zl, x1, floor + p.lip, D)));
    const body = s.t(w.Manifold.union(parts));
    // A fingertip groove down the middle of each tray, through the lip, and under the stack for flat cells.
    const g = Math.min(12, 0.4 * p.a);
    const z0 = p.round ? zt : back + p.lane / 2;
    const groove = zy([
      [z0, -1],
      [D + 1, -1],
      [D + 1, floor + p.lip + 1],
      [zl - 0.01, floor + p.lip + 1],
      [zl - 0.01, floor + 0.01],
      [z0, p.floorAt(z0) + 0.01],
    ]);
    const grooves: Manifold[] = [];
    for (let k = 0; k < o.columns; k++) grooves.push(prismX(w, s, groove, x0 + wall + k * (p.across + wall) + (p.across - g) / 2, g));
    return s.t(body.subtract(s.t(w.Manifold.union(grooves))));
  },
};
