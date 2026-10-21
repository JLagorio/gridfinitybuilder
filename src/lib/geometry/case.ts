/**
 * Carry case: a drawer whose "drawer" is a printed box. The baseplate is the
 * box's floor (always closed), walls rise from its edge, and a lid hinges on
 * the back and latches at the front.
 *
 * Case coordinates: the case's outside front-left corner is (0, 0); the grid's
 * plate sits `off` = wall + CASE.clearance in from it. The case body is split
 * like a baseplate (on `caseLayout`, the plate with the walls added as solid
 * margin), so its floor gets the baseplate's receptacles, magnets and seam
 * joints; walls are added on the outside edges of each piece.
 *
 *   - Walls: `wall` thick, up to `wallTop`; a lip on the inside of the wall top
 *     drops into a rabbet in the lid's skirt, so a closed lid can't slide and
 *     holds the wall tops in line.
 *   - Lid: a 2.4 mm top with a skirt, printed upside down. Split like the body;
 *     its seams get a rib underneath with bowtie keys (the baseplate's keys).
 *   - Hinges: knuckles on the back (two body, one lid) on a common axis behind
 *     the back wall at the parting line, far enough back that the lid swings
 *     open past 180° without touching the body. A printed snap pin (flat,
 *     split, barbed tip) goes through each.
 *   - Latches: a flexing arm hangs from the lid's front skirt; its hook snaps
 *     under a ridge on the body. Pull the tab to open.
 *   - Handle: a bail on two pegs on the lid's sides: round pegs fold down, a
 *     diamond peg holds it upright.
 *   - Feet: recesses under the corners for stick-on bumpers or printed (TPU) feet.
 *   - Label: debossed in the lid top.
 *
 * Everything prints without supports: the body upright, the lid upside down
 * (latches, knuckles and pegs are shaped for that), pins and the handle flat.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from './kernel';
import { boxAt, roundedRectRing } from './shapes';
import { connectorPocket, type ConnectorSite } from './connectors';
import { hasFont, textOutline, textSolid } from './text';
import { BP_CELL_RADIUS } from './spec';
import { baseplateFloor, baseplateHeight, buildBaseplatePiece, type BaseplateOptions } from './baseplate';
import type { SolidDef } from './solids';
import type { GridLayout } from '../layout/drawer';
import type { PieceDef } from '../layout/split';

export type CaseHandle = 'none' | 'arch' | 'fold';
export type CaseFeet = 'none' | 'bumpers' | 'printed';

export interface CaseOptions {
  /** Room from the floor (where bins seat) to the top of the walls, mm. 0 = the tallest bin plus `headroom`. */
  height: number;
  headroom: number;
  /** Wall thickness, mm. */
  wall: number;
  /** Lid height, top included, mm. */
  lidHeight: number;
  /** 0 = automatic. */
  hinges: number;
  latches: number;
  handle: CaseHandle;
  feet: CaseFeet;
  /** Debossed in the lid ('' = none). */
  label: string;
  /** Cap height of the label, mm (shrinks to fit). */
  labelSize: number;
}

export const DEFAULT_CASE: CaseOptions = {
  height: 0,
  headroom: 2,
  wall: 3,
  lidHeight: 12,
  hinges: 0,
  latches: 0,
  handle: 'fold',
  feet: 'bumpers',
  label: '',
  labelSize: 12,
};

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function sanitizeCase(raw: unknown): CaseOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CaseOptions>;
  const d = DEFAULT_CASE;
  const height = Number(r.height);
  return {
    height: Number.isFinite(height) && height > 0 ? Math.min(400, Math.max(CASE.minRoom, height)) : 0,
    headroom: num(r.headroom, 0, 30, d.headroom),
    wall: num(r.wall, 2, 8, d.wall),
    lidHeight: num(r.lidHeight, CASE.minLid, 60, d.lidHeight),
    hinges: Math.round(num(r.hinges, 0, 6, 0)),
    latches: Math.round(num(r.latches, 0, 6, 0)),
    handle: r.handle === 'none' || r.handle === 'arch' ? r.handle : 'fold',
    feet: r.feet === 'none' || r.feet === 'printed' ? r.feet : 'bumpers',
    label: typeof r.label === 'string' ? r.label.slice(0, 60) : '',
    labelSize: num(r.labelSize, 4, 40, d.labelSize),
  };
}

export const CASE = {
  /** The cavity is this much bigger than the plate on every side (bins beside the wall, stretched bins). */
  clearance: 0.3,
  /** Thinnest case floor under the receptacles. */
  floor: 2,
  minRoom: 15,
  minLid: 9,
  /** Lip on the inside of the wall top, and the rabbet's play around it. */
  lip: { t: 1.2, h: 2.5, gap: 0.3 },
  /** Lid top thickness. */
  top: 2.4,
  hinge: {
    /** Knuckle radius; the axis sits `back` behind the back wall at the parting line. */
    r: 4.5,
    back: 5.1,
    /** Knuckle lengths along the axis, and the gap between them. */
    body: 7,
    lid: 12,
    gap: 0.5,
    /** Pin: shaft width, thickness (printed flat), edge chamfer, hole diameter; barb height and the slot that lets them spring. */
    pin: 3,
    pinThick: 2.6,
    pinChamfer: 0.7,
    hole: 3.5,
    barb: 0.5,
    slot: 0.9,
    head: 6,
    headLen: 2,
  },
  latch: {
    width: 14,
    /** Arm thickness; its gap from the wall face; ridge protrusion. */
    arm: 1.8,
    gap: 1.3,
    ridge: 1,
    /** How far the arm reaches below the parting line. */
    drop: 12,
    /** Hook: catch face height above the arm's end; tip clearance from the wall. */
    hookAt: 2.2,
    tip: 0.25,
    tab: 3,
  },
  handle: {
    pegR: 3,
    /** Round pegs are flattened here (print overhang) — the bail's hole still turns on them. */
    pegFlat: 2.9,
    diamond: 3.2,
    /** Arm: clearance from the skirt, width (along X), thickness. */
    clear: 0.4,
    armW: 3.4,
    armT: 10,
    hole: 3.35,
    diamondHole: 3.45,
    /** Finger room above the lid, and the grip's size. */
    room: 28,
    grip: 10,
  },
  foot: {
    bumpers: { d: 10.6, depth: 1 },
    printed: { d: 12.3, depth: 1.2 },
    /** Printed foot: diameter and how far it stands proud. */
    footD: 12,
    proud: 2,
  },
  /** Lid seam rib: half width each side of the seam, and depth below the top; one key per `keyEvery`. */
  rib: { w: 6, h: 2.4, keyEvery: 50 },
  label: { depth: 0.8 },
} as const;

/** Least gap between the pin and its knuckle holes, all round (the pin's chamfered corners are its widest). */
export const HINGE_CLEARANCE =
  Math.round((CASE.hinge.hole / 2 - Math.max(...pinSectionRadii())) * 1000) / 1000;

function pinSectionRadii() {
  const H = CASE.hinge;
  const hw = H.pin / 2;
  const ht = H.pinThick / 2;
  const c = H.pinChamfer;
  return [Math.hypot(hw, ht - c), Math.hypot(hw - c, ht)];
}

/** How far each side of a body / lid piece reaches past its outline (knuckles, latches, pegs). */
export const CASE_REACH = {
  bodyFront: CASE.latch.ridge,
  bodyBack: CASE.hinge.back + CASE.hinge.r,
  lidFront: CASE.latch.gap + CASE.latch.arm + CASE.latch.tab,
  lidBack: CASE.hinge.back + CASE.hinge.r,
  lidSide: CASE.handle.clear + CASE.handle.armW,
} as const;

/** Hinge span along the axis: body, gap, lid, gap, body. */
export const HINGE_SPAN = 2 * CASE.hinge.body + CASE.hinge.lid + 2 * CASE.hinge.gap;

/** Baseplate options for a case floor: always closed, at least CASE.floor, plus room for the feet recesses. */
export function caseBaseplate(o: BaseplateOptions, c: CaseOptions): BaseplateOptions {
  const style = o.style === 'frame' || o.style === 'skeletonized' ? 'solid' : o.style;
  const base: BaseplateOptions = { ...o, style, outerRadius: Math.max(0, o.outerRadius) + c.wall };
  const f = baseplateFloor(base);
  const recess = c.feet === 'none' ? 0 : CASE.foot[c.feet].depth;
  const pad = Math.max(0, CASE.floor - f) + recess;
  return pad > 0 ? { ...base, bottomPad: base.bottomPad + pad } : base;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The grid's layout with the walls (and the cavity clearance) added as solid margin: what the body is split on. */
export function caseLayout(layout: GridLayout, c: CaseOptions): GridLayout {
  const off = c.wall + CASE.clearance;
  const m = layout.margins;
  const out: GridLayout = {
    ...layout,
    plateW: r4(layout.plateW + 2 * off),
    plateD: r4(layout.plateD + 2 * off),
    originX: r4(layout.originX + off),
    originY: r4(layout.originY + off),
    xs: layout.xs.map((v) => r4(v + off)),
    ys: layout.ys.map((v) => r4(v + off)),
    margins: { left: r4(m.left + off), right: r4(m.right + off), front: r4(m.front + off), back: r4(m.back + off) },
  };
  // A case floor never has holes in it.
  if (out.mask) out.maskStyle = 'solid';
  return out;
}

/** Everything needed to build any part of a case (plain data, case coordinates). */
export interface CaseGeom {
  W: number;
  D: number;
  T: number;
  /** Outside corner radius. */
  R: number;
  /** Cavity: the walls' inside faces. */
  cav: { x0: number; y0: number; x1: number; y1: number; r: number };
  /** Floor top (where bins seat), wall top (the parting line), lid top. */
  seat: number;
  wallTop: number;
  lidTop: number;
  /** Underside of the baseplate's bottom chamfer (walls start above it). */
  chamfer: number;
  /** Hinge centers (X), latch centers (X). */
  hinges: number[];
  latches: number[];
  /** Hinge axis: behind the back wall at the parting line. */
  axisY: number;
  axisZ: number;
  handle: CaseHandle;
  pegY: number;
  pegZ: number;
  feet: CaseFeet;
  footAt: [number, number][];
  label: string;
  labelSize: number;
  /** Lid key sites, on the lid's seams (case coordinates). */
  lidKeys: ConnectorSite[];
}

export interface CaseFrame {
  layout: GridLayout;
  baseplate: BaseplateOptions;
  geom: Omit<CaseGeom, 'hinges' | 'latches' | 'pegY' | 'lidKeys'>;
  /** Grid plate coordinates = case coordinates − off. */
  off: number;
}

/**
 * The case's size and heights. `binsTop` is the tallest bin above its seat
 * (0 when there are none).
 */
export function caseFrame(layout: GridLayout, c: CaseOptions, bp: BaseplateOptions, binsTop: number): CaseFrame {
  const cl = caseLayout(layout, c);
  const cbp = caseBaseplate(bp, c);
  const T = c.wall;
  const W = cl.plateW;
  const D = cl.plateD;
  // The same corner radius the floor's slab gets (baseplate.ts caps it to clear the receptacles).
  const m = cl.margins;
  const R = Math.min(cbp.outerRadius, BP_CELL_RADIUS + Math.min(m.left, m.front, m.right, m.back));
  const seat = baseplateFloor(cbp);
  const room = c.height > 0 ? c.height : Math.max(CASE.minRoom, (binsTop > 0 ? binsTop : 46.4) + c.headroom);
  const wallTop = r4(seat + Math.max(CASE.minRoom, room));
  const lidH = Math.max(c.lidHeight, CASE.minLid + (c.handle !== 'none' ? 1 : 0));
  const fd = c.feet === 'none' ? 0 : CASE.foot[c.feet].d;
  const fi = fd / 2 + 4;
  return {
    layout: cl,
    baseplate: cbp,
    off: T + CASE.clearance,
    geom: {
      W,
      D,
      T,
      R,
      cav: { x0: T, y0: T, x1: W - T, y1: D - T, r: Math.max(0, R - T) },
      seat,
      wallTop,
      lidTop: r4(wallTop + lidH),
      chamfer: Math.max(0, cbp.bottomChamfer),
      axisY: r4(D + CASE.hinge.back),
      axisZ: wallTop,
      handle: c.handle,
      pegZ: r4(wallTop + lidH / 2 + 0.5),
      feet: c.feet,
      footAt:
        c.feet === 'none'
          ? []
          : [
              [fi, fi],
              [W - fi, fi],
              [W - fi, D - fi],
              [fi, D - fi],
            ],
      label: c.label.trim(),
      labelSize: c.labelSize,
    },
  };
}

/** n positions spread along [lo, hi], each kept `pad` clear of every seam. */
function spread(n: number, lo: number, hi: number, seams: number[], pad: number): number[] {
  if (n <= 0 || hi < lo) return [];
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let x = n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (n - 1);
    for (const s of seams) {
      if (Math.abs(x - s) < pad) {
        const a = s - pad;
        const b = s + pad;
        x = a >= lo && (x < s || b > hi) ? a : b <= hi ? b : a;
      }
    }
    out.push(r4(Math.min(hi, Math.max(lo, x))));
  }
  return out;
}

/** Hinge, latch, peg and lid-key positions once the case is split (seams on the case layout). */
export function caseGeom(frame: CaseFrame, c: CaseOptions, seamsX: number[], seamsY: number[]): CaseGeom {
  const g = frame.geom;
  const edge = g.R + 2;
  const half = HINGE_SPAN / 2;
  const autoHinges = g.W >= 100 ? Math.max(2, Math.round(g.W / 150)) : 1;
  const nh = Math.min(c.hinges || autoHinges, Math.max(1, Math.floor((g.W - 2 * edge) / (HINGE_SPAN + 6))));
  // Hinges near the ends (a fifth in), latches spread across the front.
  const hLo = edge + half;
  const hHi = g.W - edge - half;
  const inset = nh > 1 ? Math.min((g.W - 2 * hLo) / 2, Math.max(0, g.W / 5 - hLo)) : 0;
  const hinges = spread(nh, hLo + inset, hHi - inset, seamsX, half + 3);
  const lw = CASE.latch.width / 2 + 1;
  const autoLatches = g.W >= 130 ? 2 : 1;
  const nl = Math.min(c.latches || autoLatches, Math.max(1, Math.floor((g.W - 2 * edge) / (2 * lw + 10))));
  const lLo = edge + lw;
  const lHi = g.W - edge - lw;
  const lInset = nl > 1 ? Math.min((lHi - lLo) / 2, Math.max(0, g.W / 4 - lLo)) : 0;
  const latches = spread(nl, lLo + lInset, lHi - lInset, seamsX, lw + 3);
  const [pegY] = spread(1, g.R + 8, g.D - g.R - 8, seamsY, CASE.handle.armT / 2 + 3);
  // Lid keys: along each seam rib, one per CASE.rib.keyEvery, clear of the skirt and of crossing seams.
  const lidKeys: ConnectorSite[] = [];
  const along = (a: number, b: number, cross: number[]) => {
    const lo = a + 8;
    const hi = b - 8;
    if (hi < lo) return [];
    const n = Math.max(1, Math.round((hi - lo) / CASE.rib.keyEvery) + 1);
    return spread(n, lo, hi, cross, 10);
  };
  for (const x of seamsX) for (const y of along(g.cav.y0, g.cav.y1, seamsY)) lidKeys.push({ x, y, axis: 'x' });
  for (const y of seamsY) for (const x of along(g.cav.x0, g.cav.x1, seamsX)) lidKeys.push({ x, y, axis: 'y' });
  return { ...g, hinges, latches, pegY: pegY ?? g.D / 2, lidKeys };
}

/** Seams of a split, in case coordinates. */
export function seamsOf(pieces: PieceDef[]): { x: number[]; y: number[] } {
  const x = new Set<number>();
  const y = new Set<number>();
  for (const p of pieces) {
    if (!p.outer.right) x.add(r4(p.x1));
    if (!p.outer.back) y.add(r4(p.y1));
  }
  return { x: [...x].sort((a, b) => a - b), y: [...y].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------
// Bounds (no kernel needed)
// ---------------------------------------------------------------------------

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** A body piece's bounding box in case coordinates. */
export function bodyBounds(g: CaseGeom, p: PieceDef): Box3 {
  return {
    min: [p.x0, p.y0 - (p.outer.front ? CASE_REACH.bodyFront : 0), 0],
    max: [p.x1, p.y1 + (p.outer.back ? CASE_REACH.bodyBack : 0), g.wallTop + Math.max(CASE.lip.h, p.outer.back ? CASE.hinge.r : 0)],
  };
}

/** A lid piece's bounding box in case coordinates (closed). */
export function lidBounds(g: CaseGeom, p: PieceDef): Box3 {
  const side = g.handle !== 'none' ? CASE_REACH.lidSide : 0;
  return {
    min: [p.x0 - (p.outer.left ? side : 0), p.y0 - (p.outer.front ? CASE_REACH.lidFront : 0), g.wallTop - CASE.latch.drop],
    max: [p.x1 + (p.outer.right ? side : 0), p.y1 + (p.outer.back ? CASE_REACH.lidBack : 0), g.lidTop],
  };
}

/** The handle's bounding box in case coordinates (upright). */
export function handleBounds(g: CaseGeom): Box3 {
  const H = CASE.handle;
  const out = H.clear + H.armW;
  return {
    min: [-out, g.pegY - H.armT / 2, g.pegZ - (H.armT / 2 + 1)],
    max: [g.W + out, g.pegY + H.armT / 2, g.lidTop + H.room + H.grip],
  };
}

/** Printed footprint of the handle (lying flat): along X, across, thickness. */
export function handleSize(g: CaseGeom): { w: number; d: number; h: number } {
  const b = handleBounds(g);
  return { w: b.max[0] - b.min[0], d: b.max[2] - b.min[2], h: b.max[1] - b.min[1] };
}

/** Length of a hinge pin (head to tip). */
export const PIN_LENGTH = CASE.hinge.headLen + HINGE_SPAN + 0.2 + 2.2;

/** The pin lying in its hinge (case coordinates): axis along X, flats horizontal. */
export function pinBounds(g: CaseGeom, xh: number): Box3 {
  const H = CASE.hinge;
  const x0 = xh - HINGE_SPAN / 2 - H.headLen;
  return {
    min: [x0, g.axisY - H.head / 2, g.axisZ - H.pinThick / 2],
    max: [x0 + PIN_LENGTH, g.axisY + H.head / 2, g.axisZ + H.pinThick / 2],
  };
}

/** Feet (printed): diameter and height. */
export function footSize(): { d: number; h: number } {
  return { d: CASE.foot.footD, h: CASE.foot.printed.depth + CASE.foot.proud };
}

/** The lid's open pose: rotated about the hinge axis, degrees (negative = front up). */
export const LID_OPEN_DEG = -105;

/** Rotate a point about the hinge axis (X direction) by `deg` (case coordinates). */
export function aboutHinge(g: Pick<CaseGeom, 'axisY' | 'axisZ'>, p: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const dy = p[1] - g.axisY;
  const dz = p[2] - g.axisZ;
  return [p[0], g.axisY + dy * Math.cos(a) - dz * Math.sin(a), g.axisZ + dy * Math.sin(a) + dz * Math.cos(a)];
}

/** Bounding box of a box after rotation about the hinge axis. */
export function rotatedBounds(g: Pick<CaseGeom, 'axisY' | 'axisZ'>, b: Box3, deg: number): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const q = aboutHinge(g, [x, y, z], deg);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], q[k]);
          max[k] = Math.max(max[k], q[k]);
        }
      }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Feet recesses for one body piece (cut solids). */
export function caseFeetCuts(g: CaseGeom, p: PieceDef): SolidDef[] {
  if (g.feet === 'none') return [];
  const f = CASE.foot[g.feet];
  return g.footAt
    .filter(([x, y]) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1)
    .map(([x, y]) => ({ kind: 'cyl', x, y, z0: -1, z1: f.depth, r0: f.d / 2 }));
}

/** Rounded-rectangle prism. */
function rrPrism(w: Wasm, x0: number, y0: number, x1: number, y1: number, r: number, z0: number, z1: number): Manifold {
  return w.Manifold.extrude([roundedRectRing(x0, y0, x1, y1, Math.max(0, r))], z1 - z0).translate([0, 0, z0]);
}

/** A box that clips a piece at its seams only (outer sides are left open). */
function pieceClip(w: Wasm, p: PieceDef): Manifold {
  const big = 1000;
  return boxAt(
    w,
    p.outer.left ? -big : p.x0,
    p.outer.front ? -big : p.y0,
    -big,
    p.outer.right ? big : p.x1,
    p.outer.back ? big : p.y1,
    big,
  );
}

/** Circle in the YZ plane, CCW. */
function circleYZ(cy: number, cz: number, r: number, segs = 32): Vec2[] {
  return Array.from({ length: segs }, (_, i) => {
    const a = (2 * Math.PI * i) / segs;
    return [cy + r * Math.cos(a), cz + r * Math.sin(a)] as Vec2;
  });
}

/** Points of a YZ profile at two X positions (for a hull along X). */
function alongX(profile: Vec2[], x0: number, x1: number): Vec3[] {
  return [x0, x1].flatMap((x) => profile.map(([y, z]) => [x, y, z] as Vec3));
}

/** Teardrop hole along X: round, with a 45° point at +Z (`up`) or −Z, so it prints without support. */
function teardropX(w: Wasm, x0: number, x1: number, cy: number, cz: number, r: number, up: boolean): Manifold {
  const prof = circleYZ(cy, cz, r);
  prof.push([cy, cz + (up ? 1 : -1) * r * Math.SQRT2]);
  return w.Manifold.hull(alongX(prof, x0, x1));
}

/** Keep the part of a convex polygon (YZ) with z ≤ zMax. */
function clipZ(poly: Vec2[], zMax: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = a[1] <= zMax;
    const inb = b[1] <= zMax;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (zMax - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, zMax]);
    }
  }
  return out;
}

/** Peg profile (YZ) for the handle: flattened teardrop (fold) or diamond (arch), grown by `g`. */
function pegProfile(handle: CaseHandle, cy: number, cz: number, g: number): Vec2[] {
  const H = CASE.handle;
  if (handle === 'arch') {
    const r = H.diamond + g;
    return [
      [cy, cz - r],
      [cy + r, cz],
      [cy, cz + r],
      [cy - r, cz],
    ];
  }
  const r = H.pegR + g;
  const drop = circleYZ(cy, cz, r);
  drop.push([cy, cz + r * Math.SQRT2]);
  // Sort by angle so the hull's outline is a proper polygon before clipping.
  drop.sort((a, b) => Math.atan2(a[1] - cz, a[0] - cy) - Math.atan2(b[1] - cz, b[0] - cy));
  return clipZ(drop, cz + H.pegFlat + g);
}

/** The case body for one piece: the floor (a baseplate piece) plus walls, lip, knuckles and latch ridges. Case coordinates. */
export function buildCaseBodySolid(
  w: Wasm,
  s: Scope,
  layout: GridLayout,
  piece: PieceDef,
  bp: BaseplateOptions,
  connectors: ConnectorSite[],
  g: CaseGeom,
): Manifold {
  const floorMesh = buildBaseplatePiece(w, layout, piece, bp, connectors, caseFeetCuts(g, piece));
  const floor = s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: floorMesh.positions, triVerts: floorMesh.indices })));
  const top = baseplateHeight(bp);
  const z0 = Math.min(top - 0.2, g.chamfer + 0.1);
  const c = g.cav;
  const L = CASE.lip;
  const adds: Manifold[] = [];
  const clip = s.t(pieceClip(w, piece));
  const walls = s.t(s.t(rrPrism(w, 0, 0, g.W, g.D, g.R, z0, g.wallTop)).subtract(s.t(rrPrism(w, c.x0, c.y0, c.x1, c.y1, c.r, z0 - 1, g.wallTop + 1))));
  adds.push(s.t(walls.intersect(clip)));
  const lip = s.t(
    s.t(rrPrism(w, c.x0 - L.t, c.y0 - L.t, c.x1 + L.t, c.y1 + L.t, c.r + L.t, g.wallTop - 0.01, g.wallTop + L.h)).subtract(
      s.t(rrPrism(w, c.x0, c.y0, c.x1, c.y1, c.r, g.wallTop - 1, g.wallTop + L.h + 1)),
    ),
  );
  adds.push(s.t(lip.intersect(clip)));

  const cuts: Manifold[] = [];
  const H = CASE.hinge;
  if (piece.outer.back) {
    for (const xh of g.hinges) {
      if (xh - HINGE_SPAN / 2 < piece.x0 || xh + HINGE_SPAN / 2 > piece.x1) continue;
      const zLow = Math.max(z0 + 1, g.axisZ - H.back - Math.SQRT2 * H.r - 0.5);
      const face: Vec2[] = [
        [g.D - 0.01, zLow],
        [g.D - 0.01, g.axisZ - 0.6],
      ];
      for (const [xa, xb] of [
        [xh - HINGE_SPAN / 2, xh - HINGE_SPAN / 2 + H.body],
        [xh + HINGE_SPAN / 2 - H.body, xh + HINGE_SPAN / 2],
      ]) {
        adds.push(s.t(w.Manifold.hull(alongX([...circleYZ(g.axisY, g.axisZ, H.r), ...face], xa, xb))));
      }
      cuts.push(s.t(teardropX(w, xh - HINGE_SPAN / 2 - 1, xh + HINGE_SPAN / 2 + 1, g.axisY, g.axisZ, H.hole / 2, true)));
    }
  }
  const Lt = CASE.latch;
  if (piece.outer.front) {
    for (const xc of g.latches) {
      if (xc - Lt.width / 2 < piece.x0 || xc + Lt.width / 2 > piece.x1) continue;
      // Flat underside (the catch), 45° top so it prints upright.
      const zr = g.wallTop - Lt.drop + Lt.hookAt + 0.1;
      const prof: Vec2[] = [
        [0.01, zr],
        [-Lt.ridge, zr],
        [-Lt.ridge, zr + 0.6],
        [0.01, zr + 0.6 + Lt.ridge + 0.01],
      ];
      adds.push(s.t(w.Manifold.hull(alongX(prof, xc - Lt.width / 2 - 1, xc + Lt.width / 2 + 1))));
    }
  }
  const body = s.t(w.Manifold.union([floor, ...adds]));
  return cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
}

/** One lid piece, closed, in case coordinates. */
export function buildCaseLidSolid(w: Wasm, s: Scope, g: CaseGeom, piece: PieceDef): Manifold {
  const c = g.cav;
  const L = CASE.lip;
  const parts: Manifold[] = [];
  const cuts: Manifold[] = [];
  const under = g.lidTop - CASE.top;
  parts.push(s.t(rrPrism(w, 0, 0, g.W, g.D, g.R, under, g.lidTop)));
  const skirt = s.t(s.t(rrPrism(w, 0, 0, g.W, g.D, g.R, g.wallTop, g.lidTop)).subtract(s.t(rrPrism(w, c.x0, c.y0, c.x1, c.y1, c.r, g.wallTop - 1, g.lidTop + 1))));
  const g2 = L.t + L.gap;
  const rabbet = s.t(rrPrism(w, c.x0 - g2, c.y0 - g2, c.x1 + g2, c.y1 + g2, c.r + g2, g.wallTop - 1, g.wallTop + L.h + L.gap));
  parts.push(s.t(skirt.subtract(rabbet)));

  // Ribs under the seams, with bowtie key pockets from below.
  const rw = CASE.rib.w;
  const ribBottom = under - CASE.rib.h;
  const seams = new Set<string>();
  for (const k of g.lidKeys) seams.add(`${k.axis}:${k.axis === 'x' ? k.x : k.y}`);
  const onPiece = (axis: 'x' | 'y', at: number) =>
    axis === 'x' ? Math.abs(at - piece.x0) < 1e-4 || Math.abs(at - piece.x1) < 1e-4 : Math.abs(at - piece.y0) < 1e-4 || Math.abs(at - piece.y1) < 1e-4;
  for (const key of seams) {
    const [axis, v] = key.split(':') as ['x' | 'y', string];
    const at = Number(v);
    if (!onPiece(axis, at)) continue;
    parts.push(
      s.t(
        axis === 'x'
          ? boxAt(w, at - rw, c.y0 - 0.01, ribBottom, at + rw, c.y1 + 0.01, under + 0.01)
          : boxAt(w, c.x0 - 0.01, at - rw, ribBottom, c.x1 + 0.01, at + rw, under + 0.01),
      ),
    );
  }
  for (const k of g.lidKeys) if (onPiece(k.axis, k.axis === 'x' ? k.x : k.y)) cuts.push(s.t(connectorPocket(w, s, k).translate([0, 0, ribBottom])));

  // Hinge knuckles: a block from the lid top down around the axis.
  const H = CASE.hinge;
  if (piece.outer.back) {
    for (const xh of g.hinges) {
      if (xh - HINGE_SPAN / 2 < piece.x0 || xh + HINGE_SPAN / 2 > piece.x1) continue;
      const xa = xh - H.lid / 2;
      const xb = xh + H.lid / 2;
      const prof: Vec2[] = [
        ...circleYZ(g.axisY, g.axisZ, H.r),
        [g.D - 0.01, g.axisZ + 0.6],
        [g.D - 0.01, g.lidTop],
        [g.axisY + H.r, g.lidTop],
      ];
      parts.push(s.t(w.Manifold.hull(alongX(prof, xa, xb))));
      cuts.push(s.t(teardropX(w, xa - 1, xb + 1, g.axisY, g.axisZ, H.hole / 2, false)));
    }
  }
  // Latches: arm hanging in front of the body, hook pointing back under the ridge, pull tab.
  const Lt = CASE.latch;
  if (piece.outer.front) {
    for (const xc of g.latches) {
      if (xc - Lt.width / 2 < piece.x0 || xc + Lt.width / 2 > piece.x1) continue;
      const xa = xc - Lt.width / 2;
      const xb = xc + Lt.width / 2;
      const yIn = -Lt.gap;
      const yOut = -Lt.gap - Lt.arm;
      const zBot = g.wallTop - Lt.drop;
      parts.push(s.t(boxAt(w, xa, yOut, zBot, xb, yIn, g.lidTop)));
      parts.push(s.t(boxAt(w, xa, yOut, g.lidTop - 3, xb, 0.01, g.lidTop)));
      const zh = zBot + Lt.hookAt;
      const reach = Lt.gap - Lt.tip;
      const hook: Vec2[] = [
        [yIn - 0.01, zh],
        [yIn + reach, zh],
        [yIn + reach, zh - 0.8],
        [yIn - 0.01, zh - 0.8 - reach],
      ];
      parts.push(s.t(w.Manifold.hull(alongX(hook, xa, xb))));
      const tab: Vec2[] = [
        [yOut + 0.01, zBot],
        [yOut - Lt.tab, zBot],
        [yOut + 0.01, zBot + Lt.tab],
      ];
      parts.push(s.t(w.Manifold.hull(alongX(tab, xa, xb))));
    }
  }
  // Handle pegs on the side skirts, tips chamfered so the bail snaps on.
  if (g.handle !== 'none') {
    const Hd = CASE.handle;
    const len = Hd.clear + Hd.armW - 0.3;
    for (const [face, dir] of [
      [0, -1],
      [g.W, 1],
    ] as const) {
      if (dir < 0 ? !piece.outer.left : !piece.outer.right) continue;
      if (g.pegY - Hd.armT < piece.y0 || g.pegY + Hd.armT > piece.y1) continue;
      const pts = [
        ...pegProfile(g.handle, g.pegY, g.pegZ, 0).map(([y, z]) => [face - dir * 0.01, y, z] as Vec3),
        ...pegProfile(g.handle, g.pegY, g.pegZ, 0).map(([y, z]) => [face + dir * (len - 0.6), y, z] as Vec3),
        ...pegProfile(g.handle, g.pegY, g.pegZ, -0.6).map(([y, z]) => [face + dir * len, y, z] as Vec3),
      ];
      parts.push(s.t(w.Manifold.hull(pts)));
    }
  }
  if (g.label && hasFont()) {
    const margin = g.R + 6;
    const t = textOutline(g.label, { size: g.labelSize, maxWidth: g.W - 2 * margin, maxHeight: g.D - 2 * margin, align: 'center' });
    const txt = textSolid(w, t, g.W / 2, g.D / 2, g.lidTop - CASE.label.depth, CASE.label.depth + 1);
    if (txt) cuts.push(s.t(txt));
  }
  const clip = s.t(pieceClip(w, piece));
  const lid = s.t(s.t(w.Manifold.union(parts)).intersect(clip));
  return cuts.length ? s.t(lid.subtract(s.t(w.Manifold.union(cuts)))) : lid;
}

/**
 * The pin's cross-section about its axis (Y across, Z up as printed): a
 * 3 × 2.6 mm flat bar with its four long edges chamfered, so it lies flat on
 * the bed and turns freely in the round knuckle holes.
 */
export function pinSection(cy = 0, cz = 0, shrink = 0): Vec2[] {
  const H = CASE.hinge;
  const hw = H.pin / 2 - shrink;
  const ht = H.pinThick / 2 - shrink;
  const c = H.pinChamfer;
  return [
    [cy + hw, cz - ht + c],
    [cy + hw, cz + ht - c],
    [cy + hw - c, cz + ht],
    [cy - hw + c, cz + ht],
    [cy - hw, cz + ht - c],
    [cy - hw, cz - ht + c],
    [cy - hw + c, cz - ht],
    [cy + hw - c, cz - ht],
  ];
}

/**
 * A snap pin, lying flat as printed: shaft along +X from the head, width
 * along Y, thickness along Z; min corner at the origin. The tip is split, and
 * its two barbs spring in to pass through the knuckles and out again past the
 * far one (their outer corners are trimmed so they squeeze through the holes).
 */
export function buildHingePinSolid(w: Wasm, s: Scope): Manifold {
  const H = CASE.hinge;
  const cy = H.head / 2;
  const cz = H.pinThick / 2;
  const hw = H.pin / 2;
  const x0 = H.headLen;
  const catchAt = x0 + HINGE_SPAN + 0.2;
  const tip = PIN_LENGTH;
  const sec = pinSection(cy, cz);
  const parts: Manifold[] = [
    s.t(boxAt(w, 0, 0, 0, x0, H.head, H.pinThick)),
    s.t(w.Manifold.hull(alongX(sec, x0 - 0.01, tip - 0.6))),
    s.t(w.Manifold.hull([...alongX(sec, tip - 0.6, tip - 0.6), ...alongX(pinSection(cy, cz, 0.5), tip, tip)])),
  ];
  for (const side of [1, -1]) {
    const y = (v: number) => cy + side * v;
    const face: Vec2[] = [
      [y(hw - 0.3), cz - cz],
      [y(hw - 0.3), cz + cz],
      [y(hw + H.barb), cz + 0.6],
      [y(hw + H.barb), cz - 0.6],
    ];
    const end: Vec2[] = [
      [y(hw - 0.3), cz - cz],
      [y(hw - 0.3), cz + cz],
      [y(hw - 0.01), cz + 0.6],
      [y(hw - 0.01), cz - 0.6],
    ];
    parts.push(s.t(w.Manifold.hull([...alongX(face, catchAt, catchAt), ...alongX(end, tip - 0.2, tip - 0.2)])));
  }
  const pin = s.t(w.Manifold.union(parts));
  return s.t(pin.subtract(s.t(boxAt(w, catchAt - 6, cy - H.slot / 2, -1, tip + 1, cy + H.slot / 2, H.pinThick + 1))));
}

/** The bail, upright on its pegs, in case coordinates. `half`: −1 left half, 1 right half, 0 whole. */
export function buildHandleSolid(w: Wasm, s: Scope, g: CaseGeom, half: -1 | 0 | 1 = 0): Manifold {
  const H = CASE.handle;
  const b = handleBounds(g);
  const y0 = g.pegY - H.armT / 2;
  const y1 = g.pegY + H.armT / 2;
  const top = b.max[2];
  const parts: Manifold[] = [];
  const cuts: Manifold[] = [];
  const end = H.armT / 2 + 1;
  for (const [xa, xb] of [
    [b.min[0], -H.clear],
    [g.W + H.clear, b.max[0]],
  ]) {
    // Rounded at the pivot.
    const prof: Vec2[] = [...circleYZ(g.pegY, g.pegZ, end - 0.5).map(([y, z]) => [Math.min(y1, Math.max(y0, y)), z] as Vec2), [y0, top], [y1, top]];
    parts.push(s.t(w.Manifold.hull(alongX(prof, xa, xb))));
    if (g.handle === 'arch') {
      const r = H.diamondHole;
      const d: Vec2[] = [
        [g.pegY, g.pegZ - r],
        [g.pegY + r, g.pegZ],
        [g.pegY, g.pegZ + r],
        [g.pegY - r, g.pegZ],
      ];
      cuts.push(s.t(w.Manifold.hull(alongX(d, xa - 1, xb + 1))));
    } else {
      // Teardrop pointing along +Y: up when printed flat.
      const prof2 = circleYZ(g.pegY, g.pegZ, H.hole);
      prof2.push([g.pegY + H.hole * Math.SQRT2, g.pegZ]);
      cuts.push(s.t(w.Manifold.hull(alongX(prof2, xa - 1, xb + 1))));
    }
  }
  parts.push(s.t(boxAt(w, b.min[0], y0, top - H.grip, b.max[0], y1, top)));
  let bail = s.t(w.Manifold.union(parts));
  bail = s.t(bail.subtract(s.t(w.Manifold.union(cuts))));
  if (half === 0) return bail;
  // Halves join in the middle of the grip with a dovetail (in the bail's plane, glued).
  const mid = g.W / 2;
  const zc = top - H.grip / 2;
  const tail = (grow: number) =>
    w.Manifold.hull(
      [
        [mid - 1 - grow, zc - 2 - grow],
        [mid + 6 + grow, zc - 3.5 - grow],
        [mid + 6 + grow, zc + 3.5 + grow],
        [mid - 1 - grow, zc + 2 + grow],
      ].flatMap(([x, z]) => [
        [x, y0 - 1, z] as Vec3,
        [x, y1 + 1, z] as Vec3,
      ]),
    );
  const big = 2000;
  if (half < 0) {
    const left = s.t(bail.intersect(s.t(boxAt(w, -big, -big, -big, mid, big, big))));
    const tongue = s.t(s.t(tail(0)).intersect(s.t(boxAt(w, mid - 2, y0, -big, big, y1, big))));
    return s.t(left.add(tongue));
  }
  const right = s.t(bail.intersect(s.t(boxAt(w, mid, -big, -big, big, big, big))));
  return s.t(right.subtract(s.t(tail(0.15))));
}

/** A printed foot: a disc that presses into its recess and stands `proud` below the case. */
export function buildFootSolid(w: Wasm): Manifold {
  const f = footSize();
  return w.Manifold.cylinder(f.h, f.d / 2, f.d / 2, 48).translate([f.d / 2, f.d / 2, 0]);
}

/** Mesh of a solid translated so `origin` lands at (0, 0, 0). */
export function meshAt(m: Manifold, origin: Vec3, what: string): MeshData {
  assertValid(m, what);
  const t = m.translate([-origin[0], -origin[1], -origin[2]]);
  try {
    return toMeshData(t);
  } finally {
    t.delete();
  }
}

/** Mesh of a solid with its own bounding box's min corner at the origin. */
export function meshAtMin(m: Manifold, what: string): MeshData {
  const b = m.boundingBox();
  return meshAt(m, [b.min[0], b.min[1], b.min[2]], what);
}
