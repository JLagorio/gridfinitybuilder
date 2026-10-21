/**
 * Parts box (container kind 'box'): a small-parts box on the grid with a
 * hinged lid, for screws, nuts and SMD parts.
 *
 * The box: Gridfinity feet and floor, an outer wall, uniform divX × divY
 * compartments (optional scoops on their front walls) whose walls stop
 * `wallGap` under the closed lid so parts can't creep from one compartment to
 * the next. Its rim is flat; the lid lies on it.
 *
 * Hinge, along the back, inside the footprint: everything sits above the rim
 * so the lid's underside stays flat and it prints the way it closes. The hinge
 * axis runs along X, BOX.hinge.r above the rim and as far behind the axis as
 * in front of the lid's knuckles. A band under the hinge thickens the back
 * wall (45° underside) to carry it.
 * - Box clips (several, BOX.hinge.clip wide): a ring around the axis on a 45°
 *   teardrop neck, rising from the band. 'snap': the ring is open at the top
 *   (tips 43° above the axis, so the bore needs no support) and the opening is
 *   BOX.hinge.snap narrower than the lid's rod, which snaps down into it.
 *   'pin': closed rings, and a 1.75 mm filament pin pushed through from the side.
 * - Lid knuckles: between and outside the clips (the lid has both ends), a
 *   round knuckle at the lid's back edge with a 45° chamfer under its back.
 *   'snap': a rod along the axis joins them through the clips (it bridges each
 *   clip gap when printed). 'pin': a hole through the lid from side to side.
 * - Around the clips the lid is cut back BOX.hinge.gap clear of the ring; the
 *   band under the lid knuckles has a groove so they turn freely. Above the
 *   axis the lid's back is cut along a plane 57° up from the axis (the
 *   underside it leaves prints fine) and the rim behind the axis falls away
 *   at 45°, so the lid opens a little past 110° (flat lids about 120°) and stays open.
 * - Print-in-place isn't offered: the hinge sits at the top of the box, so a
 *   lid printed attached would have to print in mid-air (open) or fused to
 *   the rim (closed).
 *
 * Latch at the front, also inside the footprint:
 * - 'snap': a flexing tab in a housing on the front wall (recessed 1 mm so it
 *   never bulges past the outline), rising into a notch in the lid. A 45° bump
 *   on its back clicks into a V-groove in the lid; lifting the lid's front
 *   pops it open.
 * - 'magnets': two 6 × 2 mm magnets in bosses in the front corners of the rim
 *   and two more in recesses under the lid.
 * A small chamfer under the middle of the lid's front edge takes a fingernail.
 *
 * Lid tops: 'flat' (optional engraved / raised text), 'grid' (a Gridfinity
 * receptacle per cell, like a baseplate, so a bin stands on the lid) or 'lip'
 * (one receptacle like a bin's stacking lip, optional engraved text in it).
 *
 * Heights: the closed box (rim + the lid's solid part) is heightUnits × 7 mm;
 * grid and lip tops rise 4 mm more, like a stacking lip. The lid is a separate
 * part with its `assembled` place (closed); it prints flat, the way it sits.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from '../kernel';
import {
  BASE_TOP,
  BASE_TOP_RADIUS,
  GRID,
  HEIGHT_UNIT,
  LIP_DEPTH,
  LIP_HEIGHT,
  LIP_PROFILE,
  LIP_TOP_FLAT,
  MAGNET_HOLE_DEPTH,
  MAGNET_HOLE_DIAMETER,
} from '../spec';
import { HOLE_SEGMENTS, boxAt, extrudePolygon, loftRoundedRect, roundedRectRing, type LoftKnot } from '../shapes';
import { binCells, binSize, type BinCells, type BinOptions } from '../bin';
import { binFloorZ, cellRects } from '../variants';
import { stretchOffset } from '../placement';
import { fitText, labelLines, sanitizeLabelText } from '../labels';
import { hasFont, textSolid } from '../text';
import { containerBase, containerRing } from './base';
import { registerContainer, type ContainerDef, type ContainerPart } from './registry';

const DEG = Math.PI / 180;

export type BoxHinge = 'snap' | 'pin';
export type BoxLatch = 'snap' | 'magnets' | 'none';
export type BoxTop = 'flat' | 'grid' | 'lip';
export type BoxTextStyle = 'engraved' | 'raised';

export interface BoxOptions {
  /** Compartments across the width and along the depth. */
  divX: number;
  divY: number;
  /** A scoop on the front wall of every compartment. */
  scoops: boolean;
  /** Air between the tops of the compartment walls and the closed lid, mm. */
  wallGap: number;
  hinge: BoxHinge;
  latch: BoxLatch;
  top: BoxTop;
  /** Text on the lid ('' = none). Flat and lip tops only. */
  labelText: string;
  /** Flat tops only; text in a lip top is always engraved. */
  labelStyle: BoxTextStyle;
}

export const DEFAULT_BOX: BoxOptions = {
  divX: 2,
  divY: 2,
  scoops: true,
  wallGap: 0.3,
  hinge: 'snap',
  latch: 'snap',
  top: 'flat',
  labelText: '',
  labelStyle: 'engraved',
};

export const BOX = {
  /** Outer wall and compartment walls. */
  wall: 1.2,
  divider: 1.2,
  /** Narrowest compartment, mm. */
  minCell: 6,
  /** Shortest inside (floor to rim); shorter boxes are built taller. */
  minInside: 5,
  maxDiv: 12,
  maxGap: 3,
  minGap: 0.1,
  hinge: {
    /** Knuckle radius: the axis is this far above the rim, and the lid's solid part is twice this. */
    r: 2.8,
    /** Knuckles stop this far inside the back of the outline. */
    back: 0.4,
    /** The hinge stays this far inside the left and right of the outline (clear of the corners). */
    side: 4.2,
    /** Radial clearance around each knuckle. */
    gap: 0.25,
    /** Between a clip and the lid knuckles beside it. */
    axial: 0.3,
    clip: 6,
    minKnuckle: 4,
    /** The band under the hinge reaches this far under the lid in front of the clips. */
    seal: 0.8,
    /** Snap hinge: the lid's rod, its radial play in the clips, and how much narrower the clip opening is. */
    rod: 1.3,
    play: 0.2,
    snap: 0.4,
    /** Lead-in flare at the top of the clip opening, per side. */
    lead: 0.6,
    /** Pin hinge: hole radius for a 1.75 mm filament pin. */
    pinHole: 1.05,
    pin: 1.75,
    /** Slope of the lid's back face above the hinge (57°)… */
    wedge: Math.tan(57 * DEG),
    /** …and the rim behind the axis falls away at 45° from this far behind it: the lid opens past 110°. */
    backChamfer: 1.2,
  },
  latch: {
    /** The flexing tab: width, thickness, how far its face is recessed into the front. */
    width: 8,
    thick: 1.2,
    recess: 1,
    /** Slots beside and behind the tab, and the skin that closes the housing from the compartment. */
    side: 0.6,
    back: 0.5,
    skin: 0.8,
    /** Side walls of the housing. */
    housing: 1.2,
    /** 45° bump on the tab (how far it sticks out) and its play in the lid's groove. */
    bump: 0.8,
    play: 0.2,
    /** Tab top below the top of the lid's solid part. */
    below: 0.3,
    /** Free length of the tab below the rim. */
    minFree: 3,
    maxFree: 8,
  },
  magnet: {
    d: MAGNET_HOLE_DIAMETER,
    depth: MAGNET_HOLE_DEPTH,
    /** Magnet centers this far in from the front and side of the outline. */
    inset: 5.4,
    /** Wall around the magnet in the box's corner bosses. */
    boss: 1.2,
    /** Solid under the magnet in the boss. */
    under: 1,
  },
  text: { depth: 0.6, raise: 0.6, margin: 3, maxCap: 12 },
  /** Fingernail chamfer under the lid's front edge. */
  nail: { size: 1.2, length: 30 },
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const HINGES: readonly BoxHinge[] = ['snap', 'pin'];
const LATCHES: readonly BoxLatch[] = ['snap', 'magnets', 'none'];
const TOPS: readonly BoxTop[] = ['flat', 'grid', 'lip'];
const TEXT_STYLES: readonly BoxTextStyle[] = ['engraved', 'raised'];

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sanitizeBox(raw: unknown): BoxOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BoxOptions>;
  const d = DEFAULT_BOX;
  return {
    divX: int(r.divX, 1, BOX.maxDiv, d.divX),
    divY: int(r.divY, 1, BOX.maxDiv, d.divY),
    scoops: !!(r.scoops ?? d.scoops),
    wallGap: round2(num(r.wallGap, BOX.minGap, BOX.maxGap, d.wallGap)),
    hinge: pick(r.hinge, HINGES, d.hinge),
    latch: pick(r.latch, LATCHES, d.latch),
    top: pick(r.top, TOPS, d.top),
    labelText: sanitizeLabelText(r.labelText),
    labelStyle: pick(r.labelStyle, TEXT_STYLES, d.labelStyle),
  };
}

/** Text the lid actually carries ('' for none, and never on a grid top). */
function lidText(o: BoxOptions): string {
  return o.top === 'grid' ? '' : labelLines(o.labelText);
}

/** Mesh-key text for the lid alone. */
function lidKeyOf(o: BoxOptions): string {
  const t = lidText(o);
  const style = o.top === 'flat' ? o.labelStyle[0] : 'e';
  return `${o.top}/${o.hinge}/${o.latch}${t ? `/${style}${JSON.stringify(t)}` : ''}`;
}

export function boxKey(o: BoxOptions): string {
  return `${o.divX}x${o.divY}/${o.scoops ? 's' : 'n'}/g${o.wallGap}/${lidKeyOf(o)}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** The lid's solid part (rim to the top of a flat lid / the receptacle floor) and its full height. */
export function boxLidHeights(top: BoxTop) {
  const R = BOX.hinge.r;
  // Grid and lip tops: the receptacle floor clears the box clips by the hinge gap.
  const solid = top === 'flat' ? 2 * R : 2 * R + BOX.hinge.gap;
  return { solid, T: top === 'flat' ? solid : solid + LIP_HEIGHT - LIP_TOP_FLAT };
}

export interface BoxHingeLayout {
  R: number;
  /** Axis: Y (bin-centered) and height above the rim. */
  yA: number;
  /** The snap rod runs from −Xh to Xh. */
  Xh: number;
  /** X ranges of the box's clips. */
  clips: [number, number][];
  /** X ranges of the lid's knuckles (the end ones reach past the outline; the outline trims them). */
  knuckles: [number, number][];
}

/** Where the clips and knuckles go along the back of a box W × D. */
export function boxHinge(W: number, D: number): BoxHingeLayout {
  const h = BOX.hinge;
  const R = h.r;
  const yA = D / 2 - h.back - R;
  const Xh = W / 2 - h.side;
  const span = 2 * Xh;
  let n = clamp(Math.round(span / 40) + 1, 1, 8);
  while (n > 1 && n * h.clip + (n + 1) * h.minKnuckle + 2 * n * h.axial > span) n--;
  const pitch = span / n;
  const clips = Array.from({ length: n }, (_, k): [number, number] => {
    const c = -Xh + pitch * (k + 0.5);
    return [c - h.clip / 2, c + h.clip / 2];
  });
  const knuckles: [number, number][] = [];
  let prev = -W / 2 - 1;
  for (const [a, b] of clips) {
    knuckles.push([prev, a - h.axial]);
    prev = b + h.axial;
  }
  knuckles.push([prev, W / 2 + 1]);
  return { R, yA, Xh, clips, knuckles };
}

export interface BoxLayout {
  W: number;
  D: number;
  floorTop: number;
  /** Height of the rim (where the lid sits) from the bottom of the feet. */
  Hb: number;
  /** Rim height the box's height units asked for (Hb is raised when that leaves too little inside). */
  asked: number;
  lid: { solid: number; T: number };
  hinge: BoxHingeLayout;
  /** Front face of the band under the hinge. */
  yBand: number;
  /** Compartment walls stop here. */
  wallTop: number;
  cols: [number, number][];
  rows: [number, number][];
  /** Scoop radius (0 = none). */
  scoop: number;
  /** Snap latch: where the tab's free part starts, its top and the bump's middle (box Z). */
  latch: { zRoot: number; top: number; bump: number } | null;
  /** Magnet centers (bin-centered XY). */
  magnets: [number, number][];
}

export function boxLayout(bin: BinOptions, o: BoxOptions, cells?: Partial<BinCells> | null): BoxLayout {
  const { w: W, d: D } = binSize(bin, cells);
  const floorTop = binFloorZ(bin);
  const lid = boxLidHeights(o.top);
  const asked = HEIGHT_UNIT * bin.heightUnits - lid.solid;
  const Hb = Math.max(asked, floorTop + BOX.minInside);
  const hinge = boxHinge(W, D);
  const yBand = hinge.yA - hinge.R - BOX.hinge.gap - BOX.hinge.seal;

  // Compartments: across the inside, and from the front wall to the band.
  const BW = BOX.wall;
  const DV = BOX.divider;
  const x0 = -W / 2 + BW;
  const x1 = W / 2 - BW;
  const yF = -D / 2 + BW;
  const fit = (len: number, n: number) => clamp(Math.floor((len + DV) / (BOX.minCell + DV)), 1, n);
  const nx = fit(x1 - x0, o.divX);
  const ny = fit(yBand - yF, o.divY);
  const cw = (x1 - x0 - (nx - 1) * DV) / nx;
  const rd = (yBand - yF - (ny - 1) * DV) / ny;
  const cols = Array.from({ length: nx }, (_, i): [number, number] => [x0 + i * (cw + DV), x0 + i * (cw + DV) + cw]);
  // The back row reaches under the band, to the back wall.
  const rows = Array.from({ length: ny }, (_, j): [number, number] => {
    const a = yF + j * (rd + DV);
    return [a, j === ny - 1 ? D / 2 - BW : a + rd];
  });
  const wallTop = Hb - o.wallGap;
  const scoopR = o.scoops ? Math.min(rd * 0.45, (wallTop - floorTop) * 0.6, 12) : 0;

  const L = BOX.latch;
  const free = clamp(Hb - floorTop - 2, L.minFree, L.maxFree);
  const tabTop = Hb + lid.solid - L.below;
  const latch = o.latch === 'snap' ? { zRoot: Hb - free, top: tabTop, bump: tabTop - L.bump - 0.6 } : null;
  const m = BOX.magnet.inset;
  const magnets: [number, number][] =
    o.latch === 'magnets'
      ? [
          [-(W / 2 - m), -D / 2 + m],
          [W / 2 - m, -D / 2 + m],
        ]
      : [];
  return { W, D, floorTop, Hb, asked, lid, hinge, yBand, wallTop, cols, rows, scoop: scoopR >= 2 ? scoopR : 0, latch, magnets };
}

/** Rim height of a box (the lid sits on it), from the bottom of the feet. */
export function boxRimHeight(bin: BinOptions, o: BoxOptions): number {
  const lid = boxLidHeights(o.top);
  return Math.max(HEIGHT_UNIT * bin.heightUnits - lid.solid, binFloorZ(bin) + BOX.minInside);
}

/**
 * Top of a snap clip above the hinge axis: the arms end where the lead-in
 * flare of the opening meets the ring (worked out on the ring's polygon, so it
 * is the mesh's height exactly).
 */
function snapClipTop(): number {
  const H = BOX.hinge;
  const R = H.r;
  const rb = H.rod + H.play;
  const wo = 2 * H.rod - H.snap;
  const zTip = Math.sqrt(rb * rb - (wo / 2) ** 2);
  const ring = circleYZ(0, 0, R);
  // Right edge of the ring polygon at height z (z in [0, R]).
  const edge = (z: number) => {
    let best = 0;
    for (let i = 0; i < ring.length; i++) {
      const [y0, z0] = ring[i];
      const [y1, z1] = ring[(i + 1) % ring.length];
      if ((z0 - z) * (z1 - z) > 0 || z0 === z1) continue;
      best = Math.max(best, y0 + ((z - z0) / (z1 - z0)) * (y1 - y0));
    }
    return best;
  };
  const flank = (z: number) => wo / 2 + (H.lead * (z - zTip)) / (R + 0.2 - zTip);
  let lo = zTip;
  let hi: number = R;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (edge(mid) > flank(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
const SNAP_CLIP_TOP = snapClipTop();

/** Top of the box body (its hinge clips and latch tab), from the bottom of the feet. */
export function boxBodyTop(bin: BinOptions, o: BoxOptions): number {
  const R = BOX.hinge.r;
  const clip = o.hinge === 'snap' ? R + SNAP_CLIP_TOP : 2 * R;
  const tab = o.latch === 'snap' ? boxLidHeights(o.top).solid - BOX.latch.below : 0;
  return boxRimHeight(bin, o) + Math.max(clip, tab);
}

/** Height of the closed box with its lid, mm. */
export function boxClosedHeight(bin: BinOptions, o: BoxOptions): number {
  return boxRimHeight(bin, o) + boxLidHeights(o.top).T;
}

// ---------------------------------------------------------------------------
// Shared solids
// ---------------------------------------------------------------------------

/** Convex prism along X: the hull of a (y, z) polygon at x0 and at x1. */
export function prismX(w: Wasm, pts: [number, number][], x0: number, x1: number): Manifold {
  const v: Vec3[] = [];
  for (const x of [x0, x1]) for (const [y, z] of pts) v.push([x, y, z]);
  return w.Manifold.hull(v);
}

/** Cylinder along X through (y, z), from x0 to x1. */
export function cylinderX(w: Wasm, y: number, z: number, r: number, x0: number, x1: number, segs = HOLE_SEGMENTS): Manifold {
  return w.Manifold.cylinder(x1 - x0, r, r, segs).rotate([0, 90, 0]).translate([x0, y, z]);
}

/** Points of a circle in the YZ plane. */
function circleYZ(y: number, z: number, r: number, segs = HOLE_SEGMENTS): [number, number][] {
  return Array.from({ length: segs }, (_, i) => {
    const a = (2 * Math.PI * i) / segs;
    return [y + r * Math.cos(a), z + r * Math.sin(a)] as [number, number];
  });
}

/** Largest radius of a lid knuckle (the corner of its 45° bottom chamfer). */
const KNUCKLE_REACH = BOX.hinge.r * Math.hypot(Math.SQRT2 - 1, 1);

// ---------------------------------------------------------------------------
// Box body
// ---------------------------------------------------------------------------

export function buildBoxBody(w: Wasm, bin: BinOptions, o: BoxOptions, cells: BinCells): MeshData {
  const L = boxLayout(bin, o, cells);
  const { W, D, Hb, floorTop } = L;
  const { R, yA, clips, knuckles } = L.hinge;
  const zA = Hb + R;
  const H = BOX.hinge;
  const s = new Scope();
  try {
    const ring = containerRing(bin, cells);
    const outline = (z0: number, z1: number) => s.t(extrudePolygon(w, ring, z0, z1));

    // 1. Solid block, compartments cut out, walls stopped under the lid.
    let body = outline(floorTop - 0.5, Hb);
    const cuts: Manifold[] = [];
    const innerR = BASE_TOP_RADIUS - BOX.wall;
    for (const [x0, x1] of L.cols) {
      for (const [y0, y1] of L.rows) {
        const rc = Math.min(innerR, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01);
        let pocket = s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, rc), floorTop, Hb + 1));
        if (L.scoop) {
          const r = L.scoop;
          const corner = s.t(boxAt(w, x0 - 1, y0 - 1, floorTop - 1, x1 + 1, y0 + r, floorTop + r));
          const fill = s.t(corner.subtract(s.t(cylinderX(w, y0 + r, floorTop + r, r, x0 - 2, x1 + 2, 48))));
          pocket = s.t(pocket.subtract(fill));
        }
        cuts.push(pocket);
      }
    }
    const inner = roundedRectRing(-W / 2 + BOX.wall, -D / 2 + BOX.wall, W / 2 - BOX.wall, D / 2 - BOX.wall, innerR);
    cuts.push(s.t(extrudePolygon(w, inner, L.wallTop, Hb + 1)));
    body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));

    // 2. Band under the hinge (45° underside), latch housing, magnet bosses.
    const adds: Manifold[] = [];
    const yb = D / 2 - 0.3;
    const band = s.t(
      prismX(
        w,
        [
          [L.yBand, Hb],
          [L.yBand, Hb - 1],
          [yb, Hb - 1 - (yb - L.yBand)],
          [yb, Hb],
        ],
        -W / 2,
        W / 2,
      ),
    );
    adds.push(s.t(band.intersect(outline(floorTop - 0.5, Hb))));
    const C = BOX.latch;
    const slotX = C.width / 2 + C.side;
    const tabBack = -D / 2 + C.recess + C.thick;
    if (L.latch) {
      const hx = slotX + C.housing;
      adds.push(s.t(boxAt(w, -hx, -D / 2 + 0.3, floorTop - 0.5, hx, tabBack + C.back + C.skin, Hb)));
    }
    const M = BOX.magnet;
    const mr = M.d / 2;
    for (const [mx, my] of L.magnets) {
      const rb = mr + M.boss;
      const zt = Hb - M.depth - M.under;
      const cx = Math.sign(mx) * (W / 2 - 0.6);
      const cy = -D / 2 + 0.6;
      // 45° gusset from the corner up to the boss; a column from the floor when there's no room for it.
      const reach = Math.hypot(mx - cx, my - cy) + rb;
      const column = zt - reach < floorTop + 0.5;
      const z0 = column ? floorTop - 0.5 : zt;
      const pts: Vec3[] = [];
      for (const [y, x] of circleYZ(my, mx, rb, 32)) pts.push([x, y, z0], [x, y, Hb]);
      pts.push([cx, cy, column ? floorTop - 0.5 : zt - reach], [cx, cy, Hb]);
      adds.push(s.t(s.t(w.Manifold.hull(pts)).intersect(outline(floorTop - 0.5, Hb))));
    }
    body = s.t(w.Manifold.union([body, ...adds]));

    // 3. Grooves under the lid knuckles, the latch slots, magnet holes.
    const cuts2: Manifold[] = [];
    const R2 = KNUCKLE_REACH + H.gap;
    for (const [a, b] of knuckles) cuts2.push(s.t(cylinderX(w, yA, zA, R2, a - H.axial / 2, b + H.axial / 2)));
    // 45° off the back edge of the rim behind the hinge, so the lid's back swings past it.
    const yc = yA + H.backChamfer;
    cuts2.push(
      s.t(
        prismX(
          w,
          [
            [yc, Hb + 0.01],
            [D / 2 + 1, Hb + 0.01],
            [D / 2 + 1, Hb - (D / 2 + 1 - yc)],
          ],
          -W / 2 - 1,
          W / 2 + 1,
        ),
      ),
    );
    if (L.latch) cuts2.push(s.t(boxAt(w, -slotX, -D / 2 - 1, L.latch.zRoot, slotX, tabBack + C.back, Hb + 1)));
    for (const [mx, my] of L.magnets) cuts2.push(s.t(w.Manifold.cylinder(M.depth + 1, mr, mr, HOLE_SEGMENTS).translate([mx, my, Hb - M.depth])));
    body = s.t(body.subtract(s.t(w.Manifold.union(cuts2))));

    // 4. Hinge clips, latch tab with its bump.
    const parts: Manifold[] = [body, containerBase(w, s, bin, cells, floorTop)];
    const rb = o.hinge === 'snap' ? H.rod + H.play : H.pinHole;
    const wo = 2 * H.rod - H.snap;
    const zTip = Math.sqrt(Math.max(0, rb * rb - (wo / 2) ** 2));
    for (const [a, b] of clips) {
      let clip = s.t(prismX(w, [...circleYZ(yA, zA, R), [yA, zA - R * Math.SQRT2]], a, b));
      const holes: Manifold[] = [s.t(cylinderX(w, yA, zA, rb, a - 1, b + 1))];
      if (o.hinge === 'snap') {
        holes.push(s.t(boxAt(w, a - 1, yA - wo / 2, zA, b + 1, yA + wo / 2, zA + R + 1)));
        holes.push(
          s.t(
            prismX(
              w,
              [
                [yA - wo / 2, zA + zTip],
                [yA + wo / 2, zA + zTip],
                [yA + wo / 2 + H.lead, zA + R + 0.2],
                [yA - wo / 2 - H.lead, zA + R + 0.2],
              ],
              a - 1,
              b + 1,
            ),
          ),
        );
      }
      clip = s.t(clip.subtract(s.t(w.Manifold.union(holes))));
      parts.push(clip);
    }
    if (L.latch) {
      const { zRoot, top, bump } = L.latch;
      parts.push(s.t(boxAt(w, -C.width / 2, -D / 2 + C.recess, zRoot - 0.5, C.width / 2, tabBack, top)));
      const bx = C.width / 2 - 0.5;
      parts.push(
        s.t(
          prismX(
            w,
            [
              [tabBack - 0.3, bump - C.bump - 0.3],
              [tabBack + C.bump, bump],
              [tabBack - 0.3, bump + C.bump + 0.3],
            ],
            -bx,
            bx,
          ),
        ),
      );
    }
    const box = s.t(w.Manifold.union(parts));
    assertValid(box, 'parts box');
    return toMeshData(box);
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Lid
// ---------------------------------------------------------------------------

/** Data for buildBoxLid (goes to the geometry worker). */
export interface BoxLidSpec {
  W: number;
  D: number;
  cells: BinCells;
  o: BoxOptions;
}

/** The lid's footprint as printed: it reaches the back of the outline only with a grid or lip top. */
export function boxLidSize(W: number, D: number, o: BoxOptions) {
  const { T } = boxLidHeights(o.top);
  const raised = o.top === 'flat' && o.labelStyle === 'raised' && !!lidText(o);
  return { w: W, d: o.top === 'flat' ? D - BOX.hinge.back : D, h: T + (raised ? BOX.text.raise : 0) };
}

/** Where text goes on the lid's top (bin-centered), and the height of that surface. */
function lidTextBox(W: number, D: number, o: BoxOptions) {
  const { yA, R } = boxHinge(W, D);
  const { solid, T } = boxLidHeights(o.top);
  const m = BOX.text.margin + (o.top === 'lip' ? LIP_DEPTH : 0);
  const front = o.latch === 'snap' ? BOX.latch.recess + BOX.latch.thick + BOX.latch.play + 1.5 : 0;
  return {
    box: { x0: -W / 2 + m, x1: W / 2 - m, y0: -D / 2 + Math.max(m, front), y1: yA - R - BOX.hinge.gap - 2 },
    z: o.top === 'flat' ? T : solid,
  };
}

/** Lid text laid out (null without a font, or when it doesn't fit). */
function lidTextFit(W: number, D: number, o: BoxOptions) {
  const text = lidText(o);
  if (!text) return null;
  const { box } = lidTextBox(W, D, o);
  return fitText(text, box, Math.min(BOX.text.maxCap, 0.5 * (box.y1 - box.y0)));
}

/** Build a box lid: min corner at the origin, bottom at z = 0, the way it prints and closes. */
export function buildBoxLid(w: Wasm, spec: BoxLidSpec): MeshData {
  const { W, D, o } = spec;
  const cells = binCells({ unitsX: spec.cells.x.length, unitsY: spec.cells.y.length }, spec.cells);
  const { R, yA, Xh, clips, knuckles } = boxHinge(W, D);
  const { solid, T } = boxLidHeights(o.top);
  const H = BOX.hinge;
  const s = new Scope();
  try {
    const ring = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS);
    const outline = (z0: number, z1: number) => s.t(extrudePolygon(w, ring, z0, z1));
    let lid = outline(0, T);

    // Top: Gridfinity receptacles per cell, or one stacking-lip receptacle.
    const F = solid;
    const knots = (inset0: number): LoftKnot[] => [
      { z: F, inset: inset0 },
      { z: F + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
      { z: F + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
      { z: F + LIP_HEIGHT, inset: 0 },
      { z: F + LIP_HEIGHT + 1, inset: -1 },
    ];
    const tops: Manifold[] = [];
    if (o.top === 'grid') {
      const gap = GRID - BASE_TOP;
      const { fx, fy } = stretchOffset(cells.stretch);
      for (const c of cellRects(cells)) {
        tops.push(s.t(loftRoundedRect(w, c.cx + fx, c.cy + fy, c.cw - gap, c.cd - gap, BASE_TOP_RADIUS, knots(LIP_DEPTH))));
      }
    } else if (o.top === 'lip') tops.push(s.t(loftRoundedRect(w, 0, 0, W, D, BASE_TOP_RADIUS, knots(LIP_DEPTH))));

    // Hinge: behind the axis only what lies above the 57° plane stays; cut back around each clip.
    const cuts: Manifold[] = [...tops];
    const k = H.wedge;
    const big = 40;
    const behind = s.t(boxAt(w, -W / 2 - 1, yA, -1, W / 2 + 1, D / 2 + 1, T + 1));
    const wedge = s.t(
      prismX(
        w,
        [
          [yA - 0.01, R],
          [yA + big, R + big * k],
          [yA - 0.01, R + big * k],
        ],
        -W / 2 - 2,
        W / 2 + 2,
      ),
    );
    cuts.push(s.t(behind.subtract(wedge)));
    for (const [a, b] of clips) cuts.push(s.t(boxAt(w, a - H.axial, yA - R - H.gap, -1, b + H.axial, D / 2 + 1, o.top === 'flat' ? T + 1 : F)));

    // Latch: a notch for the tab with a V-groove for its bump; or magnet recesses underneath.
    const C = BOX.latch;
    if (o.latch === 'snap') {
      const slotX = C.width / 2 + C.side;
      const ym = -D / 2 + C.recess + C.thick + C.play;
      const zb = solid - C.below - C.bump - 0.6;
      cuts.push(s.t(boxAt(w, -slotX, -D / 2 - 1, -1, slotX, ym, T + 1)));
      cuts.push(
        s.t(
          prismX(
            w,
            [
              [ym - 0.5, zb - C.bump - 0.5],
              [ym + C.bump, zb],
              [ym - 0.5, zb + C.bump + 0.5],
            ],
            -C.width / 2,
            C.width / 2,
          ),
        ),
      );
    } else if (o.latch === 'magnets') {
      const M = BOX.magnet;
      for (const sx of [-1, 1]) {
        cuts.push(s.t(w.Manifold.cylinder(M.depth + 1, M.d / 2, M.d / 2, HOLE_SEGMENTS).translate([sx * (W / 2 - M.inset), -D / 2 + M.inset, -1])));
      }
    }
    // Fingernail chamfer under the middle of the front edge.
    const N = BOX.nail;
    const nl = Math.min(N.length, W - 14) / 2;
    if (nl > 2) {
      cuts.push(
        s.t(
          prismX(
            w,
            [
              [-D / 2 - 1, -1],
              [-D / 2 + N.size + 1, -1],
              [-D / 2 - 1, N.size + 1],
            ],
            -nl,
            nl,
          ),
        ),
      );
    }
    lid = s.t(lid.subtract(s.t(w.Manifold.union(cuts))));

    // Knuckles (with a 45° chamfer under their back), trimmed to the outline at the ends.
    const knuck: Manifold[] = [];
    const c45 = R * (Math.SQRT2 - 1);
    const t45 = R * Math.SQRT1_2;
    for (const [a, b] of knuckles) {
      knuck.push(s.t(cylinderX(w, yA, R, R, a, b)));
      knuck.push(
        s.t(
          prismX(
            w,
            [
              [yA, 0],
              [yA + c45, 0],
              [yA + t45, R - t45],
              [yA, R],
            ],
            a,
            b,
          ),
        ),
      );
    }
    lid = s.t(s.t(w.Manifold.union([lid, ...knuck])).intersect(outline(-1, T + 1)));
    if (o.hinge === 'snap') lid = s.t(w.Manifold.union([lid, s.t(cylinderX(w, yA, R, H.rod, -Xh, Xh))]));
    else lid = s.t(lid.subtract(s.t(cylinderX(w, yA, R, H.pinHole, -W / 2 - 1, W / 2 + 1))));

    // Text on top (flat), or engraved in the lip's floor.
    const fit = lidTextFit(W, D, o);
    if (fit) {
      const { z } = lidTextBox(W, D, o);
      if (o.top === 'flat' && o.labelStyle === 'raised') {
        const m = textSolid(w, fit.outline, fit.cx, fit.cy, z - 0.02, BOX.text.raise + 0.02);
        if (m) lid = s.t(w.Manifold.union([lid, s.t(m)]));
      } else {
        const m = textSolid(w, fit.outline, fit.cx, fit.cy, z - BOX.text.depth, BOX.text.depth + 1);
        if (m) lid = s.t(lid.subtract(s.t(m)));
      }
    }

    const out = s.t(lid.translate([W / 2, D / 2, 0]));
    assertValid(out, 'box lid');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const cellsKey = (c: BinCells) => `${c.x.join('/')}x${c.y.join('/')}${c.stretch ? `S${JSON.stringify(c.stretch)}` : ''}`;

export const BOX_CONTAINER: ContainerDef<BoxOptions> = {
  kind: 'box',
  label: 'Parts box',
  description: 'A box with a hinged lid and small compartments, for screws, nuts and SMD parts. The lid prints separately and snaps on.',
  defaults: DEFAULT_BOX,
  sanitize: (raw) => sanitizeBox(raw),
  key: boxKey,
  // The box's body ends at the top of its hinge clips or latch tab, above the rim.
  height: (bin, o) => boxBodyTop(bin, o),
  closedHeight: (bin, o) => boxClosedHeight(bin, o),
  build: (w, bin, o, cells) => buildBoxBody(w, bin, o, cells),
  parts(bin, o, cells): ContainerPart[] {
    const { w: W, d: D } = binSize(bin, cells);
    const size = boxLidSize(W, D, o);
    const spec: BoxLidSpec = { W, D, cells: binCells(bin, cells), o };
    return [
      {
        slot: 'lid',
        index: 0,
        name: 'Lid',
        kind: 'lid',
        meshKey: `boxlid|${cellsKey(spec.cells)}|${lidKeyOf(o)}`,
        spec,
        ...size,
        // Closed: the lid's front-left corner on the box's, its underside on the rim.
        assembled: { x: 0, y: 0, z: boxRimHeight(bin, o) },
      },
    ];
  },
  buildPart: (w, spec) => buildBoxLid(w, spec as BoxLidSpec),
  summary(_bin, o) {
    const parts = [o.divX * o.divY > 1 ? `${o.divX}×${o.divY}` : ''];
    if (o.latch === 'magnets') parts.push('magnets');
    return parts.filter(Boolean).join(', ');
  },
  notes(bin, o, cells) {
    const L = boxLayout(bin, o, cells);
    const out: string[] = [];
    if (L.Hb > L.asked + 1e-6) {
      out.push(
        `${bin.heightUnits}u leaves no room inside under the lid, so it is built ${round1(boxClosedHeight(bin, o))} mm tall closed (at least ${Math.ceil((L.Hb + L.lid.solid) / HEIGHT_UNIT)}u).`,
      );
    }
    if (L.cols.length < o.divX || L.rows.length < o.divY) {
      out.push(`only ${L.cols.length}×${L.rows.length} compartments fit (each needs ${BOX.minCell} mm).`);
    }
    if (o.top === 'grid' && labelLines(o.labelText)) out.push('lid text is left off a lid with Gridfinity receptacles on top.');
    else if (lidText(o) && hasFont() && !lidTextFit(L.W, L.D, o)) out.push('the lid text doesn’t fit on the lid; shorten it.');
    return out;
  },
};

const round1 = (v: number) => Math.round(v * 10) / 10;

registerContainer(BOX_CONTAINER);
