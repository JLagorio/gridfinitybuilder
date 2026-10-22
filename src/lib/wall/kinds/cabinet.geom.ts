/**
 * Cabinet geometry (planning in cabinet.ts). Everything is drawn with the
 * hinge on the left, where it sits closed (wall frame), and mirrored for a
 * right-hand door, so the fits read plainly here.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismY, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { PIN, pinHole, type PinSpec } from './hinge';
import { circleZY, knuckles, pinMesh, posedBy, postY, teardropZY } from './hinge.geom';
import { LID } from './lidBox';
import { grooveXY, mirrorX, plateXY, railXY } from './lidBox.geom';
import { CAB, cabPlan, cabWindow, type CabinetOptions } from './cabinet';

/** A ledge along z on a side wall, its top at y, from the wall at xw out to xe, its underside rising 45° from the wall. */
function ledge(w: Wasm, s: Scope, xw: number, xe: number, y: number, z0: number, z1: number): Manifold {
  const d = Math.abs(xe - xw);
  return prismZ(
    w,
    s,
    [
      [xw, y - d - 0.01],
      [xe, y],
      [xw, y],
    ],
    z0,
    z1,
  );
}

/** The cabinet, hinge on the left, its mounts left to build.ts. */
function cabinetBody(w: Wasm, s: Scope, o: CabinetOptions, H: number): Manifold {
  const p = cabPlan(o);
  const W = o.width;
  const t = o.wall;
  const { R, xh, zh } = p;
  const add: Manifold[] = [
    s.t(boxAt(w, 0, 0, 0, W, H, LID.back)),
    s.t(boxAt(w, 0, 0, 0, W, LID.floor, p.sides)),
    s.t(boxAt(w, 0, 0, 0, t, H, p.sides)),
    s.t(boxAt(w, W - t, 0, 0, W, H, p.sides)),
  ];
  // Rails for the top plate along the walls' tops, their undersides at 45°, the grooves in them (as lidBox's).
  const rail = railXY(t, p.y0, H);
  const groove = grooveXY(t, p.y0, p.y1);
  add.push(prismZ(w, s, rail, LID.back - 0.01, p.sides), prismZ(w, s, mirrorX(rail, W), LID.back - 0.01, p.sides));
  // Ledges for the shelves (0.1 mm under them): wide on the hinge side (the shelves stay clear of the hinge), stopping behind it there.
  for (const y of p.shelf.map((v) => v - 0.1))
    add.push(ledge(w, s, t - 0.01, p.x0 + CAB.ledge, y, LID.back - 0.01, p.z1), ledge(w, s, W - t + 0.01, W - t - CAB.ledge, y, LID.back - 0.01, p.sides));
  // The hinge: a post round the pin (flush with the door's face) joined to the left wall, standing on the floor, with room cut for each of the
  // door's knuckles. Over each, the post's underside is a plane rising 45° away from the wall (toward the front and
  // the door), so every layer stands on the one under it.
  const k = knuckles(p.hinge);
  add.push(s.t(postY(w, s, xh, zh, 0, p.hinge, R).intersect(s.t(boxAt(w, -1, -1, 0, W, H, o.depth)))), s.t(boxAt(w, 0, 0, zh - R, xh, p.hinge, zh)));
  if (o.magnets) add.push(s.t(boxAt(w, W - t - 10, 0, p.sides - 8, W - t + 0.01, LID.floor + 8, p.sides)));
  const cut: Manifold[] = [prismZ(w, s, groove, LID.back, p.sides + 1), prismZ(w, s, mirrorX(groove, W), LID.back, p.sides + 1)];
  const r = R + 0.5;
  for (const [y0, y1] of k.moving) {
    const yb = y1 + PIN.gap;
    const pts: [number, number, number][] = [];
    for (const [x, z] of circleZY(xh, zh, r)) pts.push([x, y0 - PIN.gap, z], [x, yb + ((x - xh + z - zh) / Math.SQRT2 + r), z]);
    cut.push(s.t(w.Manifold.hull(pts)));
  }
  const hole = pinHole(o.pin, true) / 2;
  // The pin's hole, from the floor up through the rail and the groove.
  cut.push(postY(w, s, xh, zh, LID.floor - 1, H + 1, hole));
  // Room for a printed pin's head on the top plate, in the wall and the rail above it.
  if (o.pin === 'printed') cut.push(postY(w, s, xh, zh, p.y1, H + 1, PIN.bore / 2));
  // The magnet's pocket in a block on the floor in the front corner by the door's free edge.
  if (o.magnets) cut.push(prismZ(w, s, teardropZY(W - t - 5, LID.floor + 4, LID.pocket / 2), p.sides - LID.pocketD, p.sides + 0.1));
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
}

/** The door, hinge on the left, where it sits closed: a plate, knuckles round the pin (cut flat on its face), clear of the cabinet's. */
function cabinetDoor(w: Wasm, s: Scope, o: CabinetOptions): Manifold {
  const p = cabPlan(o);
  const W = o.width;
  const H = o.height;
  const D = o.depth;
  const { R, xh, zh } = p;
  const k = knuckles(p.hinge);
  const xz = (pts: Vec2[]): Vec2[] => pts.map(([x, z]) => [x, -z]);
  let door = s.t(boxAt(w, xh, 0, D - CAB.door, W, H, D));
  // Clear of the cabinet's knuckles everywhere but at its own.
  const ends = [-1, ...k.moving.flat(), H + 1];
  const clear: Manifold[] = [];
  for (let i = 0; i < ends.length; i += 2) clear.push(postY(w, s, xh, zh, ends[i], ends[i + 1], R + 0.5));
  door = s.t(door.subtract(s.t(w.Manifold.union(clear))));
  const add: Manifold[] = [door];
  const face = s.t(boxAt(w, -1, -1, -1, W + 1, H + 1, D));
  for (const [y0, y1] of k.moving) add.push(s.t(prismY(w, s, xz(circleZY(xh, zh, R)), y0, y1 - y0).intersect(face)));
  const cut: Manifold[] = [];
  // Its hole: a teardrop pointing up as it prints, face down.
  cut.push(prismY(w, s, xz(teardropZY(xh, zh, pinHole(o.pin, true) / 2, 270)), -1, H + 2));
  // A finger notch at the free edge; the magnet's pocket behind it, low down.
  cut.push(s.t(cylinderAt(w, W, H / 2, D - CAB.door - 1, D + 1, 8, 8, 40)));
  if (o.magnets)
    cut.push(s.t(cylinderAt(w, W - o.wall - 5, LID.floor + 4, D - CAB.door - 0.1, D - CAB.door + LID.pocketD, LID.pocket / 2, LID.pocket / 2, 32)));
  if (o.window) {
    // The window, and a rebate behind it for a clear sheet.
    const win = cabWindow(o);
    cut.push(
      s.t(boxAt(w, win.x0, win.y0, D - CAB.door - 1, win.x1, win.y1, D + 1)),
      s.t(boxAt(w, win.x0 - 3, win.y0 - 3, D - CAB.door - 1, win.x1 + 3, win.y1 + 3, D - CAB.door + 1.2)),
    );
  }
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
}

/** The top plate or a shelf, hinge on the left, where it sits: a sliding plate (its edges bevelled into the grooves), or a plain one on its ledges. */
function cabinetPlate(w: Wasm, s: Scope, o: CabinetOptions, which: string): Manifold {
  const p = cabPlan(o);
  const W = o.width;
  if (which === 'top') {
    const plate = prismZ(w, s, plateXY(W, p.y0, p.y1), p.z0, p.sides);
    return s.t(plate.subtract(postY(w, s, p.xh, p.zh, p.y0 - 1, p.y1 + 1, pinHole(o.pin, true) / 2)));
  }
  const y = p.shelf[+which.slice(5)];
  return s.t(boxAt(w, p.x0, y, p.z0, p.x1, y + LID.slide, p.z1));
}

/** Mirrored for a right-hand door. */
const sided = (s: Scope, m: Manifold, o: CabinetOptions) => (o.door === 'right' ? s.t(s.t(m.mirror([1, 0, 0])).translate([o.width, 0, 0])) : m);

/** A part where it sits closed (wall frame). */
export function cabinetPart(w: Wasm, s: Scope, o: CabinetOptions, which: string): Manifold {
  return sided(s, which === 'door' ? cabinetDoor(w, s, o) : cabinetPlate(w, s, o, which), o);
}

export const cabinetBuilder: AttachmentBuilder<CabinetOptions> = {
  body(w, s, o, layout) {
    return sided(s, cabinetBody(w, s, o, layout.h), o);
  },
  part(w, spec: (CabinetOptions & { p: 'door' | 'top' | `shelf${number}` }) | PinSpec) {
    if (spec.p === 'pin') return pinMesh(w, spec);
    const s = new Scope();
    try {
      // Plates print as they lie, the door on its face.
      return posedBy(s, cabinetPart(w, s, spec, spec.p), spec.p === 'door' ? [0, 180, 0] : [90, 0, 0], `cabinet ${spec.p}`);
    } finally {
      s.dispose();
    }
  },
};
