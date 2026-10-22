/**
 * Lidded box geometry (planning in lidBox.ts). The box, its lid, top plate
 * and flap are drawn where they sit closed (wall frame), then turned into
 * their print poses, so their fits read plainly here.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { PIN, pinHole, type PinSpec } from './hinge';
import { barX, circleZY, holeX, knuckles, pinMesh, posedBy, postY, teardropZY, zy } from './hinge.geom';
import { LID, lidPlan, type LidBoxOptions } from './lidBox';

/**
 * A dovetail groove's section (x, y) in the left wall `wall` thick, for a plate y0..y1 (LID.slide thick): a flat
 * floor, a back, and a 45° ceiling over the plate's bevelled edge, cut in a rail on the wall (railXY).
 */
export function grooveXY(wall: number, y0: number, y1: number): Vec2[] {
  const { c, groove: g, slide: t } = LID;
  const xi = wall + LID.rail;
  return [
    [g, y0 - c],
    [xi + 1, y0 - c],
    [xi + 1, y1 + c],
    [g + t + 2 * c - c * Math.SQRT2, y1 + c],
    [g, y0 + c * (Math.SQRT2 - 1)],
  ];
}

/** The rail (x, y) on the left wall that a groove for a plate from y0 is cut in, up to y1: its underside rises 45° from the wall. */
export function railXY(wall: number, y0: number, y1: number): Vec2[] {
  const yr = y0 - LID.c - 3;
  return [
    [wall - 0.01, yr - LID.rail],
    [wall + LID.rail, yr],
    [wall + LID.rail, y1],
    [wall - 0.01, y1],
  ];
}

/** A plate's section (x, y) between the grooves of walls W apart, y0..y1: its edges bevelled 45° to fit them. */
export function plateXY(W: number, y0: number, y1: number): Vec2[] {
  const { c, groove: g, slide: t } = LID;
  return [
    [g + c, y0],
    [W - g - c, y0],
    [W - g - c - t, y1],
    [g + c + t, y1],
  ];
}

export const mirrorX = (pts: Vec2[], W: number): Vec2[] => pts.map(([x, y]) => [W - x, y]);

/** A sliding lid or top plate, where it sits; a sliding lid has a finger notch at the front. */
function slidePlate(w: Wasm, s: Scope, o: LidBoxOptions, z1: number, notch: boolean): Manifold {
  const p = lidPlan(o);
  const plate = prismZ(w, s, plateXY(o.width, p.y0, p.y1), LID.back + 0.3, z1);
  if (!notch) return plate;
  return s.t(plate.subtract(postY(w, s, o.width / 2, z1, p.y0 - 1, p.y1 + 1, 9)));
}

/** The box (wall frame), its mounts left to build.ts. */
function boxBody(w: Wasm, s: Scope, o: LidBoxOptions, H: number): Manifold {
  const p = lidPlan(o);
  const W = o.width;
  const t = o.wall;
  const D = o.depth;
  const flip = o.lid === 'flip';
  const add: Manifold[] = [
    s.t(boxAt(w, 0, 0, 0, W, H, LID.back)),
    s.t(boxAt(w, 0, 0, 0, W, LID.floor, D)),
    s.t(boxAt(w, 0, 0, 0, t, p.top, p.sides)),
    s.t(boxAt(w, W - t, 0, 0, W, p.top, p.sides)),
  ];
  const cut: Manifold[] = [];
  // The front wall: under a sliding lid, so it slides over; up to a hinged lid; none behind a flap.
  const frontTop = o.lid === 'slide' ? p.y0 - LID.c : p.top;
  if (!flip) add.push(s.t(boxAt(w, 0, 0, D - t, W, frontTop, D)));
  if (o.lid !== 'hinge') {
    // Rails along the side walls' tops, their undersides rising 45° from the walls, and the grooves in them.
    const rail = railXY(t, p.y0, H);
    const groove = grooveXY(t, p.y0, p.y1);
    add.push(prismZ(w, s, rail, LID.back - 0.01, p.sides), prismZ(w, s, mirrorX(rail, W), LID.back - 0.01, p.sides));
    cut.push(prismZ(w, s, groove, LID.back, p.sides + 1), prismZ(w, s, mirrorX(groove, W), LID.back, p.sides + 1));
  }
  const k = knuckles(W);
  const { R, zh, yh } = p;
  if (o.lid === 'hinge') {
    // The box's knuckles: round the pin, their undersides rising 45° from the back plate, cut flat at the top; nothing
    // above the pin behind them, where the open lid swings.
    const z0 = LID.back - 0.5;
    const yb = z0 - (zh - yh + R * Math.SQRT2);
    for (const [x0, x1] of k.fixed) {
      const pts: [number, number, number][] = [];
      for (const x of [x0, x1]) {
        for (const [z, y] of circleZY(zh, yh, R)) pts.push([x, y, z]);
        pts.push([x, yb, z0], [x, yh, z0]);
      }
      add.push(s.t(s.t(w.Manifold.hull(pts)).intersect(s.t(boxAt(w, x0 - 1, 0, 0, x1 + 1, H, D)))));
    }
    // A finger notch in the front's top; the magnets' blocks behind the front, their undersides at 45°.
    cut.push(s.t(boxAt(w, W / 2 - 10, p.top - 8, D - t - 1, W / 2 + 10, H + 1, D + 1)));
    if (o.magnets)
      for (const xm of [W / 4, (3 * W) / 4]) {
        const zb = D - t;
        const block: Vec2[] = [
          [zb + 0.01, p.top - 14],
          [zb + 0.01, p.top],
          [zb - 6.5, p.top],
          [zb - 6.5, p.top - 7.5],
        ];
        add.push(prismX(w, s, zy(block), xm - 5, 10));
        cut.push(postY(w, s, xm, D - (t + 6.5) / 2, p.top - LID.pocketD, p.top + 0.1, LID.pocket / 2));
      }
  }
  if (flip) {
    // The box's knuckles stand on the floor at the front, teardrops pointing down into it (clear of the open flap);
    // the floor runs on as the ledge the flap drops onto.
    for (const [x0, x1] of k.fixed) {
      const pts: [number, number, number][] = [];
      for (const x of [x0, x1]) {
        for (const [z, y] of circleZY(zh, yh, R)) pts.push([x, y, z]);
        pts.push([x, yh - R * Math.SQRT2, zh]);
      }
      add.push(s.t(s.t(w.Manifold.hull(pts)).intersect(s.t(boxAt(w, x0 - 1, 0, 0, x1 + 1, H, p.front + 1)))));
    }
    if (o.magnets) {
      // Pillars in the front corners, a pocket in each facing the flap.
      const ym = p.y0 - LID.c - 8;
      for (const right of [false, true]) {
        const xa = right ? W - t - 6 : t - 0.01;
        add.push(s.t(boxAt(w, xa, 0, p.sides - 8, xa + 6.01, ym + 5, p.sides)));
        const xm = right ? W - (t + 6) / 2 : (t + 6) / 2;
        // A teardrop (x, y), pointing up as it prints.
        cut.push(prismZ(w, s, teardropZY(xm, ym, LID.pocket / 2), p.sides - LID.pocketD, p.sides + 0.1));
      }
    }
  }
  if (o.label && !flip) {
    // A card slot on the front: a frame with a 45° underside, its window and the slot behind it open at the top.
    const lw = Math.min(W - 2 * t - 10, 60);
    const xl = (W - lw) / 2;
    const yl = (o.lid === 'hinge' ? p.top - 10 : frontTop - 2) - 14;
    add.push(
      prismX(
        w,
        s,
        zy([
          [D - 0.1, yl - 2.1],
          [D + 2, yl],
          [D + 2, yl + 14],
          [D - 0.1, yl + 14],
        ]),
        xl,
        lw,
      ),
    );
    cut.push(s.t(boxAt(w, xl + 1, yl + 1.5, D, xl + lw - 1, yl + 15, D + 0.7)), s.t(boxAt(w, xl + 2.5, yl + 3, D + 0.5, xl + lw - 2.5, yl + 15, D + 2.1)));
  }
  if (o.lid !== 'slide') {
    // The pin: a push fit in the box's knuckles, the printed pin's head sunk in the left end.
    const hole = pinHole(o.pin, false) / 2;
    for (const [x0, x1] of k.fixed) cut.push(holeX(w, s, zh, yh, hole, x0 - 1, x1 + 1));
    if (o.pin === 'printed') cut.push(holeX(w, s, zh, yh, PIN.bore / 2, -1, PIN.boreT));
  }
  const body = s.t(w.Manifold.union(add));
  return cut.length ? s.t(body.subtract(s.t(w.Manifold.union(cut)))) : body;
}

/**
 * A hinged lid or a flap, where it sits closed: a plate, its knuckles round the pin between the box's (cut flat on
 * the face it prints on), notched clear of the box's knuckles, free on the pin, magnet pockets facing the box's.
 */
function hingedPanel(w: Wasm, s: Scope, o: LidBoxOptions): Manifold {
  const p = lidPlan(o);
  const W = o.width;
  const H = o.height;
  const { R, zh, yh } = p;
  const k = knuckles(W);
  const lid = o.lid === 'hinge';
  const T = LID.plate;
  const plate = lid ? s.t(boxAt(w, 0, H - T, zh, W, H, o.depth)) : s.t(boxAt(w, 0, yh, p.front - T, W, H, p.front));
  const add: Manifold[] = [plate];
  const flatCut = lid ? s.t(boxAt(w, -1, -1, -1, W + 1, H, o.depth + 1)) : s.t(boxAt(w, -1, -1, -1, W + 1, H + 1, p.front));
  for (const [x0, x1] of k.moving) add.push(s.t(barX(w, s, zh, yh, R, x0, x1).intersect(flatCut)));
  const cut: Manifold[] = [];
  for (const [x0, x1] of k.fixed) cut.push(barX(w, s, zh, yh, R + 0.5, x0 - PIN.gap + 0.01, x1 + PIN.gap - 0.01));
  // Its hole, a teardrop pointing up as it prints (the lid prints top down, the flap face down).
  cut.push(holeX(w, s, zh, yh, pinHole(o.pin, true) / 2, -1, W + 1, lid ? 270 : 180));
  if (o.magnets) {
    if (lid) for (const xm of [W / 4, (3 * W) / 4]) cut.push(postY(w, s, xm, o.depth - (o.wall + 6.5) / 2, H - T - 0.1, H - T + LID.pocketD, LID.pocket / 2));
    else {
      const ym = p.y0 - LID.c - 8;
      for (const xm of [(o.wall + 6) / 2, W - (o.wall + 6) / 2])
        cut.push(s.t(cylinderAt(w, xm, ym, p.front - T - 0.1, p.front - T + LID.pocketD, LID.pocket / 2, LID.pocket / 2, 32)));
    }
  }
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
}

/** A lid, top plate or flap where it sits closed (wall frame). */
export function lidBoxPart(w: Wasm, s: Scope, o: LidBoxOptions, part: 'lid' | 'top' | 'flap'): Manifold {
  if (part === 'flap' || (part === 'lid' && o.lid === 'hinge')) return hingedPanel(w, s, o);
  return slidePlate(w, s, o, part === 'top' ? lidPlan(o).sides : o.depth, part === 'lid');
}

export const lidBoxBuilder: AttachmentBuilder<LidBoxOptions> = {
  body(w, s, o, layout) {
    return boxBody(w, s, o, layout.h);
  },
  part(w, spec: (LidBoxOptions & { p: 'lid' | 'top' | 'flap' }) | PinSpec) {
    if (spec.p === 'pin') return pinMesh(w, spec);
    const s = new Scope();
    try {
      const m = lidBoxPart(w, s, spec, spec.p);
      // A sliding lid and a top plate print as they lie; a hinged lid upside down; a flap on its face.
      const turn: [number, number, number] = spec.p === 'flap' ? [0, 180, 0] : spec.lid === 'hinge' ? [-90, 0, 0] : [90, 0, 0];
      return posedBy(s, m, turn, `box ${spec.p}`);
    } finally {
      s.dispose();
    }
  },
};
