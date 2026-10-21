/**
 * Pocket-grid interior ("item holder", after Gridfinity Extended's
 * gridfinity_item_holder): the bin is filled solid from the floor up to the
 * pocket depth and a grid of round, square or hex pockets is cut into it.
 * Above the fill the bin stays open. As many pockets as fit are used, on a
 * square grid or staggered rows, whichever holds more.
 *
 * Extras, all cut from the top so the bin prints without supports:
 * - bottoms: flat, rounded, a 118° cone, or a narrower bore below a ledge;
 * - a lean toward the front (−Y), depth measured along the lean;
 * - finger grooves along each row, or a thumb notch in front of each pocket;
 * - a magnet recess under each pocket's floor;
 * - graduated sets (drill index, sockets, hex keys): one pocket per size,
 *   packed in rows smallest first, each size engraved in front of its pocket.
 *
 * Everything works in any clear rectangle (`regionPocketLayout` +
 * `regionPocketCutters`); the whole-bin interior is one such region. With the
 * extras at their defaults the pockets are exactly the classic ones.
 */
import type { Manifold, Scope, Vec2, Vec3, Wasm } from './kernel';
import { BASE_HEIGHT, BASE_PROFILE_HEIGHT, INNER_RADIUS, LIP_DEPTH, WALL } from './spec';
import { cylinderAt, extrudePolygon, ringAt, roundedRectRing } from './shapes';
import { hasFont, textOutline, textSolid } from './text';
import { sanitizePocketFields, type BinVariantOptions, type PocketFields, type PocketShape } from './variants';
import { sizeLabelText } from './pocketPresets';

export {
  CUSTOM_SET,
  FIT_DEFAULTS,
  POCKET_GROUPS,
  POCKET_PRESETS,
  findPocketPreset,
  fitItem,
  formatSizeList,
  parseSizeList,
  presetFields,
  sizeLabelText,
  type PocketItem,
  type PocketPreset,
} from './pocketPresets';

type Classic = 'pocketShape' | 'pocketW' | 'pocketD' | 'pocketDepth' | 'pocketSpacing' | 'pocketChamfer';
/**
 * The options a pocket grid needs: every `pocket…` field of BinVariantOptions
 * (pocketPreset is UI only). Fields added after the classic six are optional
 * and default to DEFAULT_VARIANTS.
 */
export type PocketOpts = Pick<BinVariantOptions, Classic> & Partial<Omit<PocketFields, Classic>>;
/** Every option filled in and clamped. */
type Opts = PocketFields;

const full = (o: PocketOpts): Opts => sanitizePocketFields(o);

/** A clear rectangle (between wall faces) to fill with pockets, bin-centered mm. */
export interface PocketRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PocketPlace {
  /** Where the pocket's axis meets the top of the fill, bin-centered mm (the pocket's center when it doesn't lean). */
  x: number;
  y: number;
  /** Pocket size, clearance included: diameter / width / across flats, and size along Y. */
  w: number;
  d: number;
  /** Depth along the pocket's axis, after clamping to the bin. */
  depth: number;
  /** Lean actually used, degrees: less than asked when the pocket is too shallow for it. */
  tilt: number;
  /** z of the deepest point on the pocket's axis. */
  bottom: number;
  /** A magnet recess under this pocket (small pockets can't hold the magnet). */
  magnet: boolean;
  /** Graduated sets: the item size (mm, before clearance), its index in pocketSizes, and its engraved label. */
  size?: number;
  index?: number;
  label?: { text: string; x: number; y: number; w: number; h: number };
  /** Thumb notch: a round-bottomed hole centered on the pocket's front edge. */
  notch?: { x: number; y: number; r: number; depth: number };
  /** What the pocket (and its notch) takes up on the top of the fill, bin-centered: the layout keeps these apart. */
  footprint: [number, number][];
}

/** A finger groove from one pocket center to another along a row: a rounded channel `width` wide and `depth` deep. */
export interface PocketGroove {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  depth: number;
}

export interface PocketLayout {
  /** Pocket centers (see PocketPlace.x / y), bin-centered mm. */
  centers: [number, number][];
  /** Hex pockets: true = flat sides facing ±X (rows staggered along X); false = the layout turned 90°. */
  hexFlatX: boolean;
  /** Top of the solid fill. */
  fillTop: number;
  /** Pocket depth after clamping to the bin (the shallowest pocket's, along its axis). */
  depth: number;
  pockets: PocketPlace[];
  grooves: PocketGroove[];
  /** Graduated sets: the sizes that did not fit, as indices into pocketSizes. */
  missing: number[];
}

const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;
const ROUND_SEGS = 48;
/** Half the 118° point of a twist drill. */
const TAN_CONE = Math.tan(59 * DEG);
/** Press-fit clearance added to the magnet's size, mm. */
export const POCKET_MAGNET_FIT = { diameter: 0.2, depth: 0.2 } as const;
/** Plastic kept under a magnet recess, mm. */
export const POCKET_MAGNET_FLOOR = 0.6;
/** Engraved size labels: cap height and depth, mm. */
export const POCKET_LABEL_SIZE = 3;
export const POCKET_LABEL_DEPTH = 0.6;
/** Label box height (room for the slash's descender) and its gap to the pockets. */
const LABEL_BOX = POCKET_LABEL_SIZE * 1.2;
const LABEL_GAP = 0.6;
/** Plastic kept between a groove and anything it must not break into. */
const GROOVE_WEB = 0.8;
/** Shortest wall a leaning pocket keeps on its shallow (back) side. */
const MIN_BACK_WALL = 0.3;

/**
 * Lowest a magnet recess under a floor at `zFloor` may reach: 0.6 mm above the
 * bottom of a flat bin; on feet, above the outer wall's foot (6 mm), which
 * buildBin joins to the floor after the pockets are cut (solid from 4.75 mm).
 */
export function magnetLimit(zFloor: number): number {
  return zFloor >= BASE_HEIGHT - 1e-6 ? BASE_PROFILE_HEIGHT + 1.3 : POCKET_MAGNET_FLOOR;
}

// ---------------------------------------------------------------------------
// One pocket: section, body and footprint
// ---------------------------------------------------------------------------

/** One pocket's cross-section: shape, size (clearance included) and, for hex, which way the flats face. */
interface Section {
  shape: PocketShape;
  w: number;
  d: number;
  hexFlatX: boolean;
}

/** Radius of the biggest circle that fits the section. */
const inradius = (k: Section) => (k.shape === 'square' ? Math.min(k.w, k.d) / 2 : k.w / 2);

/** Half the section's extent along Y after shrinking by `inset` and scaling. */
function halfY(k: Section, inset = 0, scale = 1): number {
  const r = (k.shape === 'square' ? k.d / 2 : k.w / 2) * scale - inset;
  return Math.max(0, k.shape === 'hex' && k.hexFlatX ? (r * 2) / SQRT3 : r);
}

/** Half the section's extent along X. */
function halfX(k: Section): number {
  return k.shape === 'hex' && !k.hexFlatX ? k.w / SQRT3 : k.w / 2;
}

/** The section's outline shrunk by `inset` and scaled about its center, CCW. Shrunk to nothing it is a point or a segment. */
function sectionRing(k: Section, inset = 0, scale = 1): Vec2[] {
  if (k.shape === 'round') {
    const r = (k.w / 2) * scale - inset;
    if (r < 1e-6) return [[0, 0]];
    return Array.from({ length: ROUND_SEGS }, (_, i) => {
      const a = (2 * Math.PI * i) / ROUND_SEGS;
      return [r * Math.cos(a), r * Math.sin(a)] as Vec2;
    });
  }
  if (k.shape === 'hex') {
    const ri = (k.w / 2) * scale - inset;
    if (ri < 1e-6) return [[0, 0]];
    const R = (ri * 2) / SQRT3;
    // Corners on ±X unturned; turned 30° the flats face ±X.
    const turn = k.hexFlatX ? 30 : 0;
    return Array.from({ length: 6 }, (_, i) => {
      const a = (turn + 60 * i) * DEG;
      return [R * Math.cos(a), R * Math.sin(a)] as Vec2;
    });
  }
  const hw = (k.w / 2) * scale - inset;
  const hd = (k.d / 2) * scale - inset;
  if (hw < 1e-6 && hd < 1e-6) return [[0, 0]];
  if (hw < 1e-6) return [[0, -hd], [0, hd]];
  if (hd < 1e-6) return [[-hw, 0], [hw, 0]];
  const rr = Math.min(0.5, k.w / 2 - 0.05, k.d / 2 - 0.05) * scale - inset;
  return roundedRectRing(-hw, -hd, hw, hd, Math.max(0, Math.min(rr, hw - 0.01, hd - 0.01)));
}

/** A ring of a pocket body in the pocket's own frame: axis +Z, z = 0 at the deepest point. */
interface Knot {
  z: number;
  inset: number;
  scale?: number;
}

interface Body {
  /** Convex pieces, each a stack of rings; the last one continues straight up to the mouth. */
  pieces: Knot[][];
  /** Magnet recess along the axis (pocket frame), or null when the magnet doesn't fit. */
  magnet: { z0: number; z1: number; r: number } | null;
}

/**
 * A pocket's body for depth `L` (along the axis) and lean `tan t`. Floor
 * shapes shrink as needed so they stay below the mouth on the shallow side.
 */
function pocketBody(k: Section, o: Opts, L: number, tanT: number): Body {
  const inr = inradius(k);
  // How high the floor shape may reach and stay under the mouth everywhere.
  const room = L - halfY(k) * tanT - MIN_BACK_WALL;
  let pieces: Knot[][] = [[{ z: 0, inset: 0 }]];
  let bore = 1;
  if (o.pocketFloor === 'round') {
    const rb = Math.min(inr, room);
    if (rb >= 0.3) {
      const n = rb > 8 ? 12 : 8;
      pieces = [
        Array.from({ length: n + 1 }, (_, i) => {
          const a = (i / n) * (Math.PI / 2);
          return { z: rb * (1 - Math.cos(a)), inset: rb * (1 - Math.sin(a)) };
        }),
      ];
    }
  } else if (o.pocketFloor === 'cone') {
    const hc = Math.min(inr / TAN_CONE, room);
    if (hc >= 0.2) pieces = [[{ z: 0, inset: hc * TAN_CONE }, { z: hc, inset: 0 }]];
  } else if (o.pocketFloor === 'stepped') {
    const sd = Math.min(o.pocketStepDepth, room - 0.2);
    const bw = Math.min(o.pocketStepW, k.w - 0.8);
    if (sd >= 0.3 && bw >= 0.5) {
      bore = bw / k.w;
      pieces = [
        [
          { z: 0, inset: 0, scale: bore },
          { z: sd + 0.02, inset: 0, scale: bore },
        ],
        [{ z: sd, inset: 0 }],
      ];
    }
  }
  return { pieces, magnet: o.pocketMagnet ? magnetRecess(o, pieces, inr, bore) : null };
}

/**
 * The magnet recess: a press-fit cylinder below the lowest spot wide enough
 * for it (the bore, or where a round or pointed bottom has opened up to the
 * magnet's width), so its mouth never overhangs. Null when the pocket is too narrow.
 */
function magnetRecess(o: Opts, pieces: Knot[][], inr: number, bore: number): Body['magnet'] {
  const r = (o.pocketMagnetD + POCKET_MAGNET_FIT.diameter) / 2;
  const h = o.pocketMagnetH + POCKET_MAGNET_FIT.depth;
  const need = r + 0.05;
  if (bore < 1) return inr * bore >= need ? { z0: -h, z1: 0.02, r } : null;
  if (inr < need) return null;
  // Lowest height where the floor's section holds the magnet (insets shrink going up).
  const knots = pieces[0];
  let open = knots[knots.length - 1].z;
  for (let i = 0; i < knots.length; i++) {
    if (inr - knots[i].inset >= need) {
      if (i === 0) open = knots[0].z;
      else {
        const [a, b] = [knots[i - 1], knots[i]];
        open = a.z + ((b.z - a.z) * (a.inset - (inr - need))) / (a.inset - b.inset);
      }
      break;
    }
  }
  return { z0: open - h, z1: open + 0.02, r };
}

/** Lowest point of the body below its deepest axis point, with the pocket leaning `t` (z of the axis point = 0). */
function bodyLowest(k: Section, b: Body, cosT: number, sinT: number): number {
  let low = Infinity;
  for (const piece of b.pieces) for (const kn of piece) low = Math.min(low, kn.z * cosT - halfY(k, kn.inset, kn.scale) * sinT);
  return low;
}

/** Where a pocket ends up: its depth along the axis, its lean, and the deepest axis point. */
interface Fit {
  depth: number;
  tilt: number;
  bottom: number;
}

/** The fill: its top, the floor under it, and how much the pockets may deepen when the fill is rounded up to the top. */
interface Fill {
  fillTop: number;
  zFloor: number;
  /** Lowest a magnet recess may reach. */
  zLimit: number;
  slack: number;
  /** Untilted, no magnets: every pocket simply reaches down to the floor. */
  classic: boolean;
}

/** How high the fill must reach above nothing for a pocket of depth L leaning `tilt`°: the fill top needed. */
function fillNeed(k: Section, o: Opts, L: number, tilt: number, zFloor: number, zLimit: number): number {
  const t = tilt * DEG;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const b = pocketBody(k, o, L, Math.tan(t));
  let need = zFloor + L * c - bodyLowest(k, b, c, s);
  if (b.magnet) need = Math.max(need, zLimit + L * c - (b.magnet.z0 * c - b.magnet.r * s));
  return need;
}

/** Fit a pocket to the fill: as deep as asked (or as the fill allows), leaning less if it's too shallow to lean that far. */
function fitPocket(k: Section, o: Opts, f: Fill): Fit {
  if (f.classic) return { depth: f.fillTop - f.zFloor, tilt: 0, bottom: f.zFloor };
  const solve = (tilt: number) => {
    const cap = o.pocketDepth + Math.max(0, f.slack) / Math.cos(tilt * DEG);
    const ok = (L: number) => fillNeed(k, o, L, tilt, f.zFloor, f.zLimit) <= f.fillTop + 1e-9;
    if (ok(cap)) return cap;
    let [lo, hi] = [0, cap];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  let tilt = o.pocketTilt;
  let L = solve(tilt);
  const hy = halfY(k);
  if (tilt > 0 && L < hy * Math.tan(tilt * DEG) + MIN_BACK_WALL) {
    tilt = Math.atan(Math.max(0, L - MIN_BACK_WALL) / hy) / DEG;
    L = solve(tilt);
  }
  return { depth: L, tilt, bottom: f.fillTop - L * Math.cos(tilt * DEG) };
}

/** Body, magnet and notch points of a fitted pocket, relative to its mouth center (z = 0 at the top of the fill). */
function pocketPoints(k: Section, o: Opts, fit: Fit) {
  const t = fit.tilt * DEG;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const L = fit.depth;
  const body = pocketBody(k, o, L, Math.tan(t));
  // Pocket frame → world, relative to the mouth: lean back about X, deepest axis point at (0, L sin t, −L cos t).
  const toWorld = (ring: Vec2[], z: number) => ring.map(([x, y]) => [x, y * c - z * s + L * s, y * s + z * c - L * c] as Vec3);
  const pieces = body.pieces.map((piece) => piece.flatMap((kn) => toWorld(sectionRing(k, kn.inset, kn.scale), kn.z)));
  const magnet = body.magnet ? [body.magnet.z0, body.magnet.z1].flatMap((z) => toWorld(circle(body.magnet!.r), z)) : null;
  // The pocket's section in the plane of the fill's top.
  const mouth = sectionRing(k).map(([x, y]) => [x, y / c] as Vec2);
  return { body, pieces, magnet, mouth, cos: c, sin: s, tan: Math.tan(t) };
}

const circle = (r: number, n = ROUND_SEGS): Vec2[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Vec2);

/** Thumb notch size for a pocket: radius from its width, depth from its depth, kept above the floor. */
function notchOf(k: Section, o: Opts, fit: Fit, f: Fill): { r: number; depth: number } | null {
  if (o.pocketGrip !== 'notch') return null;
  const r = clamp(0.3 * k.w, 2, 8);
  const depth = Math.min(clamp(0.5 * fit.depth * Math.cos(fit.tilt * DEG), 2, 25), f.fillTop - f.zFloor - 0.6);
  return depth >= 1 ? { r, depth: round3(depth) } : null;
}

/** Outline of a pocket (and its notch) on the fill, relative to its mouth center. */
function footprintOf(k: Section, o: Opts, fit: Fit, notch: { r: number } | null): Vec2[] {
  const P = pocketPoints(k, o, fit);
  const pts: Vec2[] = [...P.mouth];
  for (const piece of P.pieces) for (const p of piece) pts.push([p[0], p[1]]);
  for (const p of P.magnet ?? []) pts.push([p[0], p[1]]);
  if (notch) {
    const ny = -halfY(k) / P.cos;
    for (const [x, y] of circle(notch.r / Math.cos(Math.PI / 32), 32)) pts.push([x, y + ny]);
  }
  return hull2(pts);
}

// ---------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------

/** Every distinct pocket section the options ask for (both hex turns for a uniform grid). */
function sections(o: Opts): Section[] {
  if (o.pocketSizes.length) {
    return o.pocketSizes.map((v) => ({ shape: o.pocketShape, w: v + o.pocketClearance, d: v + o.pocketClearance, hexFlatX: true }));
  }
  const k = { shape: o.pocketShape, w: o.pocketW, d: o.pocketD, hexFlatX: true };
  return o.pocketShape === 'hex' ? [k, { ...k, hexFlatX: false }] : [k];
}

function fillFor(o: Opts, zFloor: number, maxTop: number, zLimit: number): Fill {
  if (!(o.pocketTilt > 0) && !o.pocketMagnet) {
    const depth = Math.max(0, Math.min(o.pocketDepth, maxTop - zFloor));
    let fillTop = zFloor + depth;
    if (fillTop > maxTop - 0.3) fillTop = maxTop;
    return { fillTop, zFloor, zLimit, slack: fillTop - zFloor - o.pocketDepth, classic: true };
  }
  let need = zFloor;
  for (const k of sections(o)) need = Math.max(need, fillNeed(k, o, o.pocketDepth, o.pocketTilt, zFloor, zLimit));
  let fillTop = zFloor + Math.max(0, Math.min(need - zFloor, maxTop - zFloor));
  if (fillTop > maxTop - 0.3) fillTop = maxTop;
  return { fillTop, zFloor, zLimit, slack: fillTop - need, classic: false };
}

/**
 * How deep the pockets can go with the floor at `zFloor` and the fill reaching
 * at most `maxTop`. Leaning pockets and magnets need a thicker fill for the
 * same depth; magnet recesses stay above `zLimit`.
 */
export function pocketFill(o0: PocketOpts, zFloor: number, maxTop: number, zLimit = magnetLimit(zFloor)): { fillTop: number; depth: number } {
  const o = full(o0);
  const f = fillFor(o, zFloor, maxTop, zLimit);
  if (f.classic) return { fillTop: f.fillTop, depth: f.fillTop - zFloor };
  return { fillTop: f.fillTop, depth: Math.min(...sections(o).map((k) => fitPocket(k, o, f).depth)) };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Footprint of one pocket: [x, y] extents in the row-staggered frame. */
function extents(o: PocketOpts): [number, number] {
  if (o.pocketShape === 'square') return [o.pocketW, o.pocketD];
  if (o.pocketShape === 'hex') return [o.pocketW, (o.pocketW * 2) / SQRT3]; // flats facing ±X, points ±Y
  return [o.pocketW, o.pocketW];
}

/** Centers of a square grid inside a centered aw × ad area. */
function gridCenters(aw: number, ad: number, sx: number, sy: number, sp: number): [number, number][] {
  if (aw < sx || ad < sy) return [];
  const nx = Math.floor((aw - sx) / (sx + sp) + 1e-9) + 1;
  const ny = Math.floor((ad - sy) / (sy + sp) + 1e-9) + 1;
  const out: [number, number][] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) out.push([(i - (nx - 1) / 2) * (sx + sp), (j - (ny - 1) / 2) * (sy + sp)]);
  }
  return out;
}

/** Centers of staggered rows (along X) of round or hex pockets of width sx; rows `pitch` apart (default: touching circles). */
function staggerCenters(aw: number, ad: number, sx: number, sy: number, sp: number, pitch?: number): [number, number][] {
  if (aw < sx || ad < sy) return [];
  const px = sx + sp;
  const py = pitch ?? (px * SQRT3) / 2;
  const rows = Math.floor((ad - sy) / py + 1e-9) + 1;
  if (rows < 2) return [];
  const n0 = Math.floor((aw - sx) / px + 1e-9) + 1;
  const n1 = Math.floor((aw - sx - px / 2) / px + 1e-9) + 1;
  if (n1 < 1) return [];
  const pts: [number, number][] = [];
  for (let j = 0; j < rows; j++) {
    const n = j % 2 ? n1 : n0;
    for (let i = 0; i < n; i++) pts.push([i * px + (j % 2 ? px / 2 : 0), j * py]);
  }
  // center the pattern
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}

/** Margin kept between the outer pockets and the region's walls. */
const edgeMargin = (o: PocketOpts) => Math.max(o.pocketSpacing, o.pocketChamfer + 0.4);

/** Chamfer on one pocket's mouth. */
function chamferOf(o: Opts, p: Pick<PocketPlace, 'depth' | 'w' | 'd'>): number {
  return Math.min(o.pocketChamfer, p.depth / 2, o.pocketSizes.length ? Math.min(p.w, p.d) / 4 : Infinity);
}

/**
 * Where the pockets go in a clear region whose floor is at `zFloor` and whose
 * fill may reach `maxTop`. As many as fit: a square grid, or staggered rows or
 * columns for round and hex pockets, whichever holds more; for a graduated
 * set, rows of increasing sizes. Magnet recesses stay above `zLimit`, by
 * default what a bin's floor allows (see magnetLimit).
 */
export function regionPocketLayout(o0: PocketOpts, region: PocketRegion, zFloor: number, maxTop: number, zLimit = magnetLimit(zFloor)): PocketLayout {
  const o = full(o0);
  const f = fillFor(o, zFloor, maxTop, zLimit);
  const { grooveAlong, ...L } = o.pocketSizes.length ? setLayout(o, region, f) : uniformLayout(o, region, f);
  if (o.pocketGrip === 'groove') L.grooves = fitGrooves(o, L, grooveAlong, region, f);
  return L;
}

type Draft = PocketLayout & { grooveAlong: 'x' | 'y' };

function emptyLayout(f: Fill, depth: number): Draft {
  return { centers: [], hexFlatX: true, fillTop: f.fillTop, depth, pockets: [], grooves: [], missing: [], grooveAlong: 'x' };
}

function finish(L: Draft): Draft {
  L.centers = L.pockets.map((p) => [p.x, p.y]);
  if (L.pockets.length) L.depth = Math.min(...L.pockets.map((p) => p.depth));
  return L;
}

/** A pocket placed with its mouth center at (x, y). */
function place(k: Section, fit: Fit, notch: { r: number; depth: number } | null, fp: Vec2[], x: number, y: number, mag: boolean): PocketPlace {
  const p: PocketPlace = {
    x,
    y,
    w: k.w,
    d: k.d,
    depth: fit.depth,
    tilt: fit.tilt,
    bottom: fit.bottom,
    magnet: mag,
    footprint: fp.map(([px, py]) => [px + x, py + y]),
  };
  if (notch) p.notch = { x, y: y - halfY(k) / Math.cos(fit.tilt * DEG), r: notch.r, depth: notch.depth };
  return p;
}

/** The same pocket everywhere. */
function uniformLayout(o: Opts, region: PocketRegion, f: Fill): Draft {
  const margin = edgeMargin(o);
  const aw = region.x1 - region.x0 - 2 * margin;
  const ad = region.y1 - region.y0 - 2 * margin;
  const cx = (region.x0 + region.x1) / 2;
  const cy = (region.y0 + region.y1) / 2;
  const sp = o.pocketSpacing;
  const sec = (hexFlatX: boolean): Section => ({ shape: o.pocketShape, w: o.pocketW, d: o.pocketD, hexFlatX });
  const cache = new Map<boolean, { k: Section; fit: Fit; notch: ReturnType<typeof notchOf>; fp: Vec2[]; mag: boolean }>();
  const pocket = (hexFlatX: boolean) => {
    let c = cache.get(hexFlatX);
    if (!c) {
      const k = sec(hexFlatX);
      const fit = fitPocket(k, o, f);
      const notch = notchOf(k, o, fit, f);
      c = { k, fit, notch, fp: footprintOf(k, o, fit, notch), mag: !!pocketBody(k, o, fit.depth, Math.tan(fit.tilt * DEG)).magnet };
      cache.set(hexFlatX, c);
    }
    return c;
  };
  type Option = { centers: [number, number][]; hexFlatX: boolean; along: 'x' | 'y' };
  let best: Option;
  if (!(o.pocketTilt > 0) && o.pocketGrip !== 'notch') {
    // The classic layout: pockets are just their sections.
    const [sx, sy] = extents(o);
    const options: Option[] = [{ centers: gridCenters(aw, ad, sx, sy, sp), hexFlatX: true, along: sy + 1e-9 < sx ? 'y' : 'x' }];
    if (o.pocketShape !== 'square') {
      options.push({ centers: staggerCenters(aw, ad, sx, sy, sp), hexFlatX: true, along: 'x' });
      // Staggered columns: the same layout turned 90°.
      const turned = staggerCenters(ad, aw, sx, sy, sp).map(([x, y]) => [y, x] as [number, number]);
      options.push({ centers: turned, hexFlatX: false, along: 'y' });
    }
    best = options[0];
    for (const c of options) if (c.centers.length > best.centers.length) best = c;
    best = { ...best, centers: best.centers.map(([x, y]) => [x + cx, y + cy]) };
  } else {
    // Leaning or notched pockets take more room than their section: lay out their footprints.
    const options: Option[] = [];
    const add = (hexFlatX: boolean, along: 'x' | 'y', make: (b: Box, F: Vec2[]) => [number, number][]) => {
      const F = pocket(hexFlatX).fp;
      const b = bbox(F);
      const mx = (b.x0 + b.x1) / 2;
      const my = (b.y0 + b.y1) / 2;
      options.push({ centers: make(b, F).map(([x, y]) => [x + cx - mx, y + cy - my]), hexFlatX, along });
    };
    add(true, 'x', (b) => gridCenters(aw, ad, b.x1 - b.x0, b.y1 - b.y0, sp));
    if (o.pocketShape === 'square') {
      const b = bbox(pocket(true).fp);
      if (b.y1 - b.y0 + 1e-9 < b.x1 - b.x0) options[0].along = 'y';
    } else {
      add(true, 'x', (b, F) => {
        const [bw, bh] = [b.x1 - b.x0, b.y1 - b.y0];
        const pitch = staggerPitch(F, (bw + sp) / 2, sp, bh, false);
        return staggerCenters(aw, ad, bw, bh, sp, pitch);
      });
      add(false, 'y', (b, F) => {
        const [bw, bh] = [b.x1 - b.x0, b.y1 - b.y0];
        const pitch = staggerPitch(F, (bh + sp) / 2, sp, bw, true);
        return staggerCenters(ad, aw, bh, bw, sp, pitch).map(([x, y]) => [y, x] as [number, number]);
      });
    }
    best = options[0];
    for (const c of options) if (c.centers.length > best.centers.length) best = c;
  }
  const P = pocket(best.hexFlatX);
  const L = emptyLayout(f, P.fit.depth);
  L.hexFlatX = best.hexFlatX;
  L.grooveAlong = best.along;
  L.pockets = best.centers.map(([x, y]) => place(P.k, P.fit, P.notch, P.fp, x, y, P.mag));
  return finish(L);
}

/** A graduated set: one pocket per size, in rows smallest first from the front, each size labelled in front of its pocket. */
function setLayout(o: Opts, region: PocketRegion, f: Fill): Draft {
  const margin = edgeMargin(o);
  const sp = o.pocketSpacing;
  const x0 = region.x0 + margin;
  const x1 = region.x1 - margin;
  const y0 = region.y0 + margin;
  const y1 = region.y1 - margin;
  const labels = o.pocketSizeLabels !== 'none';
  const items = o.pocketSizes
    .map((size, i) => ({ size, name: o.pocketSizeNames[i] ?? '', i }))
    .sort((a, b) => a.size - b.size || a.i - b.i)
    .map(({ size, name, i: index }) => {
      const k: Section = { shape: o.pocketShape, w: size + o.pocketClearance, d: size + o.pocketClearance, hexFlatX: true };
      const fit = fitPocket(k, o, f);
      const notch = notchOf(k, o, fit, f);
      const fp = footprintOf(k, o, fit, notch);
      const b = bbox(fp);
      const text = labels ? sizeLabelText(size, o.pocketSizeLabels, name) : '';
      const tw = text ? labelWidth(text) : 0;
      const mag = !!pocketBody(k, o, fit.depth, Math.tan(fit.tilt * DEG)).magnet;
      const front = b.y0 - chamferOf(o, { depth: fit.depth, w: k.w, d: k.d });
      return { size, index, k, fit, notch, fp, b, text, tw, width: Math.max(b.x1 - b.x0, tw), front, mag };
    });
  type Item = (typeof items)[number];
  const L = emptyLayout(f, items.length ? Math.min(...items.map((it) => it.fit.depth)) : o.pocketDepth);
  // Row extent in front of and behind its center line; labels share one line in front.
  const extent = (row: Item[]) => {
    const back = Math.max(...row.map((it) => it.b.y1));
    const labelY = Math.min(...row.map((it) => it.front)) - LABEL_GAP - LABEL_BOX / 2;
    const front = row.some((it) => it.text) ? labelY - LABEL_BOX / 2 : Math.min(...row.map((it) => it.b.y0));
    return { back, front, labelY };
  };
  // Rows from the front, as many sizes in each as fit across `maxW`.
  const greedy = (maxW: number) => {
    const out: Item[][] = [];
    let width = 0;
    for (const it of items) {
      const row = out[out.length - 1];
      if (row && width + sp + it.width <= maxW + 1e-9) {
        row.push(it);
        width += sp + it.width;
      } else {
        out.push([it]);
        width = it.width;
      }
    }
    return out;
  };
  // Stack rows until one is too tall for what's left: it loses its biggest sizes, and nothing after it fits.
  const stack = (wanted: Item[][]) => {
    const out: { items: Item[]; line: number; labelY: number }[] = [];
    let y = y0;
    for (const want of wanted) {
      const row = want.filter((it) => it.width <= x1 - x0 + 1e-9);
      while (row.length && y + extent(row).back - extent(row).front > y1 + 1e-9) row.pop();
      if (!row.length) break;
      const e = extent(row);
      out.push({ items: row, line: y - e.front, labelY: e.labelY });
      y += e.back - e.front + sp;
      if (row.length < want.length) break;
    }
    return { rows: out, used: y - sp - y0 };
  };
  let { rows, used } = stack(greedy(x1 - x0));
  const count = rows.reduce((t, r) => t + r.items.length, 0);
  if (count === items.length && rows.length > 1) {
    // Everything fits: even the rows out (the narrowest rows that still take as many).
    let [lo, hi] = [Math.max(...items.map((it) => it.width)), x1 - x0];
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (greedy(mid).length <= rows.length) hi = mid;
      else lo = mid;
    }
    const even = stack(greedy(hi));
    if (even.rows.reduce((t, r) => t + r.items.length, 0) === items.length) ({ rows, used } = even);
  }
  const placed = new Set(rows.flatMap((r) => r.items));
  L.missing = items.filter((it) => !placed.has(it)).map((it) => it.index);
  // Share out the room left over between the rows and between the pockets of each row (up to a pocket's width), and center.
  const rowGap = rows.length > 1 ? Math.min((y1 - y0 - used) / (rows.length + 1), used / rows.length) : 0;
  const dy = (y1 - y0 - used - rowGap * (rows.length - 1)) / 2;
  rows.forEach((row, r) => {
    const n = row.items.length;
    const width = row.items.reduce((t, it) => t + it.width, 0) + sp * (n - 1);
    const gap = n > 1 ? sp + Math.min((x1 - x0 - width) / (n + 1), width / n) : 0;
    let x = (x0 + x1) / 2 - (width + (gap - sp) * (n - 1)) / 2;
    for (const it of row.items) {
      const px = x + it.width / 2;
      const py = row.line + dy + r * rowGap;
      const p = place(it.k, it.fit, it.notch, it.fp, px, py, it.mag);
      p.size = it.size;
      p.index = it.index;
      if (it.text) p.label = { text: it.text, x: px, y: row.labelY + py, w: it.tw, h: LABEL_BOX };
      L.pockets.push(p);
      x += it.width + gap;
    }
  });
  L.grooveAlong = 'x';
  return finish(L);
}

/** Label width at POCKET_LABEL_SIZE (Roboto Condensed Bold advances: digits are 0.711 cap heights wide). */
function labelWidth(text: string): number {
  const adv: Record<string, number> = { '.': 0.409, '/': 0.467, ' ': 0.324, '-': 0.508, '"': 0.451, '″': 0.451 };
  let w = 0;
  for (const ch of text) w += adv[ch] ?? (ch >= '0' && ch <= '9' ? 0.711 : 0.75);
  return round3(w * POCKET_LABEL_SIZE);
}

/** Finger grooves along each row (or column) of two or more pockets, as wide as they can be without breaking into anything else. */
function fitGrooves(o: Opts, L: PocketLayout, along: 'x' | 'y', region: PocketRegion, f: Fill): PocketGroove[] {
  const across = (p: { x: number; y: number }) => (along === 'x' ? p.y : p.x);
  const rows = new Map<number, PocketPlace[]>();
  for (const p of L.pockets) {
    const key = Math.round(across(p) * 1e4);
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  const labelBoxes: Vec2[][] = L.pockets.flatMap((p) =>
    p.label
      ? [
          [
            [p.label.x - p.label.w / 2, p.label.y - p.label.h / 2],
            [p.label.x + p.label.w / 2, p.label.y - p.label.h / 2],
            [p.label.x + p.label.w / 2, p.label.y + p.label.h / 2],
            [p.label.x - p.label.w / 2, p.label.y + p.label.h / 2],
          ] as Vec2[],
        ]
      : [],
  );
  const out: PocketGroove[] = [];
  for (const row of rows.values()) {
    if (row.length < 2) continue;
    row.sort((a, b) => (along === 'x' ? a.x - b.x : a.y - b.y));
    const [a, b] = [row[0], row[row.length - 1]];
    const at = across(a);
    // Preferred width: 60% of the narrowest mouth across the groove.
    const cross = Math.min(
      ...row.map((p) => {
        const k: Section = { shape: o.pocketShape, w: p.w, d: p.d, hexFlatX: L.hexFlatX };
        return along === 'x' ? (2 * halfY(k)) / Math.cos(p.tilt * DEG) : 2 * halfX(k);
      }),
    );
    const want = clamp(0.6 * cross, 3, 16);
    let half = Math.min(want / 2, along === 'x' ? Math.min(at - region.y0, region.y1 - at) - GROOVE_WEB : Math.min(at - region.x0, region.x1 - at) - GROOVE_WEB);
    const seg: Vec2[] = [
      [a.x, a.y],
      [b.x, b.y],
    ];
    const inRow = new Set(row);
    for (const poly of [...L.pockets.filter((p) => !inRow.has(p)).map((p) => p.footprint), ...labelBoxes]) {
      const bb = bbox(poly);
      const gap = along === 'x' ? Math.max(bb.y0 - at, at - bb.y1) : Math.max(bb.x0 - at, at - bb.x1);
      if (gap >= half + GROOVE_WEB) continue;
      half = Math.min(half, polyDistance(seg, poly) - GROOVE_WEB);
    }
    const width = 2 * half;
    const depth = Math.min(clamp(0.5 * Math.min(...row.map((p) => p.depth * Math.cos(p.tilt * DEG))), 1, 25), f.fillTop - f.zFloor - 0.8);
    if (width < 1.5 || depth < 0.8) continue;
    out.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: round3(width), depth: round3(depth) });
  }
  return out;
}

/** The clear region a whole-bin pocket grid uses (inside the lip's inner edge when the fill reaches up under it). */
function binRegion(o: PocketOpts & { lip: boolean }, W: number, D: number, zFloor: number, topInfill: number): PocketRegion {
  const { fillTop } = pocketFill(o, zFloor, topInfill);
  const wallLine = o.lip && fillTop >= topInfill - 1e-6 ? LIP_DEPTH : WALL;
  return { x0: -W / 2 + wallLine, y0: -D / 2 + wallLine, x1: W / 2 - wallLine, y1: D / 2 - wallLine };
}

/**
 * Where the pockets go in a W × D bin whose floor is at `zFloor` and whose
 * infill may reach `topInfill`.
 */
export function pocketLayout(o: PocketOpts & { lip: boolean }, W: number, D: number, zFloor: number, topInfill: number): PocketLayout {
  return regionPocketLayout(o, binRegion(o, W, D, zFloor, topInfill), zFloor, topInfill);
}

// ---------------------------------------------------------------------------
// Cutters
// ---------------------------------------------------------------------------

/**
 * Cutters for the pockets of a region (not the open space above the fill),
 * reaching up to `zTop`: pockets, magnet recesses, grooves, notches and
 * engraved labels, all inside the region. Subtract them from solid material
 * that fills the region up to the layout's `fillTop`.
 */
export function regionPocketCutters(w: Wasm, s: Scope, o0: PocketOpts, L: PocketLayout, zFloor: number, zTop: number): Manifold[] {
  const o = full(o0);
  const out: Manifold[] = [];
  const z1 = L.fillTop;
  for (const p of L.pockets) {
    if (p.depth < 0.5) continue;
    const { x, y } = p;
    const k: Section = { shape: o.pocketShape, w: p.w, d: p.d, hexFlatX: L.hexFlatX };
    const c = chamferOf(o, p);
    if (o.pocketFloor === 'flat' && p.tilt === 0) {
      // Classic straight pocket, down to the floor (or to where the magnet under it leaves 0.6 mm).
      const z0 = o.pocketMagnet ? p.bottom : zFloor;
      if (o.pocketShape === 'round') {
        const r = p.w / 2;
        out.push(s.t(cylinderAt(w, x, y, z0, zTop, r, r, 48)));
        if (c > 0) out.push(s.t(cylinderAt(w, x, y, z1 - c, z1 + 0.02, r, r + c + 0.02, 48)));
      } else if (o.pocketShape === 'hex') {
        // Manifold's 6-sided cylinder has corners on ±X; turn it so flats face ±X when hexFlatX.
        const R = p.w / SQRT3;
        const turn = L.hexFlatX ? 30 : 0;
        const hex = (zb: number, h: number, r0: number, r1: number) =>
          s.t(s.t(w.Manifold.cylinder(h, r0, r1, 6)).rotate([0, 0, turn]).translate([x, y, zb]));
        out.push(hex(z0, zTop - z0, R, R));
        if (c > 0) out.push(hex(z1 - c, c + 0.02, R, R + ((c + 0.02) * 2) / SQRT3));
      } else {
        const hw = p.w / 2;
        const hd = p.d / 2;
        const rr = Math.min(0.5, hw - 0.05, hd - 0.05);
        const ring = roundedRectRing(x - hw, y - hd, x + hw, y + hd, rr);
        out.push(s.t(extrudePolygon(w, ring, z0, zTop)));
        if (c > 0) {
          const big = roundedRectRing(x - hw - c - 0.02, y - hd - c - 0.02, x + hw + c + 0.02, y + hd + c + 0.02, rr + c);
          out.push(s.t(w.Manifold.hull([...ringAt(ring, z1 - c), ...ringAt(big, z1 + 0.02)])));
        }
      }
      const P = o.pocketMagnet ? pocketPoints(k, o, p) : null;
      if (P?.magnet) out.push(s.t(w.Manifold.hull(P.magnet.map(([mx, my, mz]) => [mx + x, my + y, mz + z1] as Vec3))));
    } else {
      out.push(...shapedPocket(w, s, k, o, p, c, z1, zTop));
    }
    if (p.notch) out.push(s.t(notchCutter(w, p.notch, z1, zTop)));
  }
  for (const g of L.grooves) out.push(s.t(grooveCutter(w, g, z1, zTop)));
  if (hasFont()) {
    for (const p of L.pockets) {
      if (!p.label) continue;
      const t = textOutline(p.label.text, { size: POCKET_LABEL_SIZE, maxWidth: p.label.w + 0.01 });
      const m = textSolid(w, t, p.label.x, p.label.y, z1 - POCKET_LABEL_DEPTH, POCKET_LABEL_DEPTH + 1);
      if (m) out.push(s.t(m));
    }
  }
  return out;
}

/** A pocket with a shaped bottom or a lean: convex hulls of its rings, cut off at the fill's top, plus its mouth and chamfer. */
function shapedPocket(w: Wasm, s: Scope, k: Section, o: Opts, p: PocketPlace, c0: number, z1: number, zTop: number): Manifold[] {
  const P = pocketPoints(k, o, p);
  const at = (q: Vec3, dz = 0): Vec3 => [q[0] + p.x, q[1] + p.y, q[2] + z1 + dz];
  const out: Manifold[] = [];
  // The mouth section just above the fill's top, where the leaning walls have moved forward a little.
  const lift = 0.02;
  const mouth = (dy: number, z: number, grow = 0): Vec3[] => {
    const b = bbox(P.mouth);
    const [hx, hy] = [(b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2];
    return P.mouth.map(([mx, my]) => [p.x + mx * ((hx + grow) / hx), p.y + dy + my * ((hy + grow) / hy), z] as Vec3);
  };
  const last = P.pieces.length - 1;
  P.pieces.forEach((piece, i) => {
    const pts = piece.map((q) => at(q));
    if (i === last) pts.push(...mouth(-lift * P.tan, z1 + lift));
    out.push(s.t(w.Manifold.hull(pts)));
  });
  if (zTop > z1 + lift) {
    const ring = mouth(-lift * P.tan, 0).map(([mx, my]) => [mx, my] as Vec2);
    out.push(s.t(extrudePolygon(w, ring, z1 + lift / 2, zTop)));
  }
  if (P.magnet) out.push(s.t(w.Manifold.hull(P.magnet.map((q) => at(q)))));
  // Chamfer: only where the plane it starts from still cuts the straight walls.
  const top = P.body.pieces[last];
  const straight = top[top.length - 1].z;
  const c = Math.min(c0, Math.max(0, (p.depth - halfY(k) * P.tan - straight) * P.cos - 0.01));
  if (c > 0.01) out.push(s.t(w.Manifold.hull([...mouth(c * P.tan, z1 - c), ...mouth(-lift * P.tan, z1 + lift, c + 0.02)])));
  return out;
}

/** Thumb notch: a vertical hole with a round bottom. */
function notchCutter(w: Wasm, n: NonNullable<PocketPlace['notch']>, z1: number, zTop: number): Manifold {
  const zc = z1 - n.depth + n.r;
  const pts: Vec3[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    const z = zc - n.r * Math.cos(a);
    if (z > zTop) break;
    if (i === 0) pts.push([n.x, n.y, z]);
    else pts.push(...ringAt(circle(n.r * Math.sin(a), 32), z).map(([x, y, zz]) => [x + n.x, y + n.y, zz] as Vec3));
  }
  pts.push(...ringAt(circle(n.r, 32), Math.max(zTop, zc + 0.01)).map(([x, y, zz]) => [x + n.x, y + n.y, zz] as Vec3));
  return w.Manifold.hull(pts);
}

/** Finger groove: a channel with a round bottom from one end pocket's center to the other's. */
function grooveCutter(w: Wasm, g: PocketGroove, z1: number, zTop: number): Manifold {
  const half = g.width / 2;
  const deep = g.depth >= half;
  const R = deep ? half : (g.depth * g.depth + half * half) / (2 * g.depth);
  const zc = z1 - g.depth + R;
  const phi = deep ? Math.PI / 2 : Math.asin(half / R);
  const prof: Vec2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (3 * Math.PI) / 2 - phi + (2 * phi * i) / n;
    prof.push([R * Math.cos(a), zc + R * Math.sin(a)]);
  }
  const zt = Math.max(zTop, z1 + 0.5);
  prof.push([half, zt], [-half, zt]);
  const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
  const [dx, dy] = [(g.x1 - g.x0) / len, (g.y1 - g.y0) / len];
  const pts: Vec3[] = [];
  for (const [ex, ey] of [
    [g.x0, g.y0],
    [g.x1, g.y1],
  ]) {
    for (const [u, z] of prof) pts.push([ex - dy * u, ey + dx * u, z]);
  }
  return w.Manifold.hull(pts);
}

/** Cutters for the whole-bin pocket interior: the open space above the fill, and every pocket. */
export function pocketCutters(
  w: Wasm,
  s: Scope,
  o: PocketOpts & { lip: boolean },
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): Manifold[] {
  const L = pocketLayout(o, W, D, zFloor, topInfill);
  const out: Manifold[] = [];
  const zTop = topInfill + 1;
  if (L.fillTop < topInfill) {
    const ring = roundedRectRing(-W / 2 + WALL, -D / 2 + WALL, W / 2 - WALL, D / 2 - WALL, INNER_RADIUS);
    out.push(s.t(extrudePolygon(w, ring, L.fillTop, zTop)));
  }
  out.push(...regionPocketCutters(w, s, o, L, zFloor, zTop));
  return out;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Sidebar summary of a laid-out pocket grid: "20 pockets, 20 mm deep", then any
 * warnings (too short, nothing fits, sizes that don't fit, magnets, lean).
 */
export function pocketSummary(o0: PocketOpts, L: PocketLayout, fmt: (mm: number) => string): { text: string; warnings: string[] } {
  const o = full(o0);
  const n = L.pockets.length;
  const warnings: string[] = [];
  const set = o.pocketSizes.length > 0;
  let text = set ? `${n} of ${o.pocketSizes.length} sizes` : `${n} pocket${n === 1 ? '' : 's'}`;
  if (n) text += `, ${fmt(L.depth)} deep`;
  if (o.pocketTilt > 0 && n) text += `, leaning ${Math.round(Math.min(...L.pockets.map((p) => p.tilt)))}°`;
  if (o.pocketGrip === 'groove' && n) text += `, ${L.grooves.length} groove${L.grooves.length === 1 ? '' : 's'}`;
  if (!n) warnings.push('Nothing fits: make the bin bigger or the pockets smaller.');
  else if (L.depth < o.pocketDepth - 0.01) warnings.push(`The bin is too short for ${fmt(o.pocketDepth)} deep pockets${o.pocketMagnet ? ' over magnets' : ''}.`);
  if (L.missing.length) {
    const names = L.missing.map((i) => {
      const [v, name] = [o.pocketSizes[i], o.pocketSizeNames[i] ?? ''];
      return o.pocketSizeLabels === 'inch' && !name ? `${sizeLabelText(v, 'inch')}″` : name || fmt(v);
    });
    warnings.push(`No room for ${names.length === 1 ? 'size' : 'sizes'} ${names.join(', ')}.`);
  }
  if (o.pocketMagnet && n) {
    const without = L.pockets.filter((p) => !p.magnet).length;
    if (without) warnings.push(`${without === n ? 'No' : `${without} of ${n}`} pockets are wide enough for a ${fmt(o.pocketMagnetD)} magnet.`);
  }
  if (o.pocketTilt > 0 && n && L.pockets.some((p) => p.tilt < o.pocketTilt - 0.05)) warnings.push(`Too shallow to lean ${o.pocketTilt}°: leaning less.`);
  if (o.pocketGrip === 'groove' && n > 1 && !L.grooves.length) warnings.push('No room for finger grooves between the rows.');
  return { text, warnings };
}

// ---------------------------------------------------------------------------
// 2D helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bbox(pts: readonly Vec2[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  }
  return b;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull, CCW (Andrew's monotone chain). */
export function hull2(pts: readonly Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const half = (seq: Vec2[]) => {
    const h: Vec2[] = [];
    for (const q of seq) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 1e-12) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}

function segmentDistance(q: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2, 0, 1) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/** Distance from a point to a convex CCW polygon (0 inside). */
function pointPolygonDistance(q: Vec2, P: readonly Vec2[]): number {
  if (P.length === 1) return Math.hypot(q[0] - P[0][0], q[1] - P[0][1]);
  let inside = P.length >= 3;
  let best = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [a, b] = [P[i], P[(i + 1) % P.length]];
    if (cross(a, b, q) < 0) inside = false;
    best = Math.min(best, segmentDistance(q, a, b));
  }
  return inside ? 0 : best;
}

/** Minkowski sum of two convex CCW polygons (as hull2 makes them), merging their edges by angle. */
function minkowski(A: readonly Vec2[], B: readonly Vec2[]): Vec2[] {
  if (A.length < 3 || B.length < 3) return hull2(A.flatMap((a) => B.map((b) => [a[0] + b[0], a[1] + b[1]] as Vec2)));
  const lowest = (P: readonly Vec2[]) => {
    let k = 0;
    for (let i = 1; i < P.length; i++) if (P[i][1] < P[k][1] || (P[i][1] === P[k][1] && P[i][0] < P[k][0])) k = i;
    return k;
  };
  const [ia, ib, na, nb] = [lowest(A), lowest(B), A.length, B.length];
  const out: Vec2[] = [];
  let [i, j] = [0, 0];
  while (i < na || j < nb) {
    const [a, b] = [A[(ia + i) % na], B[(ib + j) % nb]];
    out.push([a[0] + b[0], a[1] + b[1]]);
    const [a1, b1] = [A[(ia + i + 1) % na], B[(ib + j + 1) % nb]];
    const c = (a1[0] - a[0]) * (b1[1] - b[1]) - (a1[1] - a[1]) * (b1[0] - b[0]);
    if (j >= nb || (i < na && c > 0)) i++;
    else if (i >= na || c < 0) j++;
    else {
      i++;
      j++;
    }
  }
  return hull2(out);
}

/** Distance between two convex shapes given by their points (0 when they overlap). */
export function polyDistance(A: readonly Vec2[], B: readonly Vec2[]): number {
  const diff: Vec2[] = [];
  for (const a of A) for (const b of B) diff.push([a[0] - b[0], a[1] - b[1]]);
  return pointPolygonDistance([0, 0], hull2(diff));
}

/**
 * Smallest pitch between staggered rows of footprint F (rows shifted `shift`
 * along them) that keeps neighbours `sp` apart; `ext` is F's extent across the
 * rows. `columns`: the rows run along Y.
 */
function staggerPitch(F: readonly Vec2[], shift: number, sp: number, ext: number, columns: boolean): number {
  // The gap to a neighbour offset by v is v's distance from F ⊕ −F.
  const D = minkowski(F, F.map(([x, y]) => [-x, -y] as Vec2));
  const gap = (pitch: number) => pointPolygonDistance(columns ? [pitch, shift] : [shift, pitch], D);
  let lo = (ext + sp) / 2; // pockets two rows apart sit straight behind each other
  let hi = ext + sp;
  if (gap(lo) >= sp - 1e-9) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) >= sp - 1e-9) hi = mid;
    else lo = mid;
  }
  return hi;
}
