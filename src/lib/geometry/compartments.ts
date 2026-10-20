/**
 * Compartment cutters for a bin's infill block: the uniform divX × divY grid
 * (unchanged from before) and free-form divider layouts.
 *
 * Layout compartments:
 * - Rectangular ones look exactly like grid compartments: rounded inside corners,
 *   optional rounded bottom (hull of corner spheres), scoop on the front (−Y)
 *   wall, label tab on the back (+Y) wall, each with its own options.
 * - Non-rectangular ones (L/T/U shapes) are cut as a union of strips with only
 *   the outline's convex corners rounded. Simplifications: no rounded bottom;
 *   the scoop goes on strips whose whole front edge is a wall; one label tab, on
 *   the widest strip whose whole back edge is a wall.
 * - Lowered walls: above each distinct lowered height the compartments either
 *   side are re-derived without those walls and cut again from that height up
 *   (with rounded corners), protecting tabs, scoop ramps and raised floors.
 * - Removable walls: a slot through the wall's footprint (+ clearance) down into
 *   the floor, and guide ribs at each end (returned in `add`).
 * - Label tabs are also listed without building anything (`labelTabs`), for the
 *   label text and label-plate recesses in labels.ts.
 */
import type { Manifold, MeshData, Vec3, Wasm } from './kernel';
import { Scope, assertValid, toMeshData } from './kernel';
import {
  DIVIDER,
  INNER_RADIUS,
  TAB_DEPTH,
  TAB_SUPPORT_ANGLE_DEG,
  TAB_TIP_HEIGHT,
  TAB_WIDTH_NOMINAL,
  LIP_DEPTH,
  WALL,
} from './spec';
import { boxAt, extrudePolygon, ringAt, roundedRectRing, type CornerRadii } from './shapes';
import type { BinOptions, LabelStyle } from './bin';
import {
  RIB_ENGAGE,
  RIB_THICKNESS,
  SLOT_CLEARANCE,
  SLOT_DEPTH,
  deriveCompartments,
  removableSegments,
  resolveLayout,
  type CompRect,
  type Compartment,
  type ResolvedLayout,
} from '../dividers';

export interface CutterSpec {
  /** Footprint, already grown by the overlap into the surrounding walls. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Clear size, for sizing the scoop and the tab. */
  cw: number;
  cd: number;
  radius: number | CornerRadii;
  zFloor: number;
  topInfill: number;
  zTop: number;
  fillet: boolean;
  scoop: number;
  label: LabelStyle;
  /** Top of the label tab when the back wall is lowered (default: the infill top). */
  tabTop?: number;
  /** Compartment this cutter belongs to (for its label text). */
  key?: string;
  /** How far the stacking lip overhangs the back of the tab, hiding it from above. */
  backInset?: number;
}

/** A label tab's flat top, in bin coordinates. */
export interface LabelTab {
  /** Compartment key (`g<i>,<j>` in a uniform grid). */
  key: string;
  /** Ends of the tab. */
  x0: number;
  x1: number;
  /** Front edge, and the back edge of the part you can see from above (clear of the lip). */
  y0: number;
  y1: number;
  /** Height of the flat top. */
  z: number;
}

interface TabShape {
  tx0: number;
  tx1: number;
  /** Back (in the wall) and front edge. */
  yb: number;
  yf: number;
  /** Thickness at the back. */
  th: number;
  tabTop: number;
  /** Top of the hull (above the infill unless the tab is lowered). */
  zt: number;
}

/** Where a cutter's label tab goes, or null when it has none (or no room for one). */
function tabShape(c: CutterSpec): TabShape | null {
  if (c.label === 'none') return null;
  const eps = 0.01;
  const { x0, x1, y1, cw, cd, zFloor, topInfill, zTop } = c;
  const tabTop = c.tabTop ?? topInfill;
  const lowered = tabTop < topInfill - 1e-6;
  const room = tabTop - zFloor;
  const tan = Math.tan((TAB_SUPPORT_ANGLE_DEG * Math.PI) / 180);
  let td = Math.min(TAB_DEPTH, cd * 0.45);
  if (tan * td + TAB_TIP_HEIGHT > room - 1) td = (room - 1 - TAB_TIP_HEIGHT) / tan;
  if (!(td >= 4)) return null;
  const th = tan * td + TAB_TIP_HEIGHT;
  const tw = c.label === 'full' ? cw + 4 * eps : Math.min(cw, TAB_WIDTH_NOMINAL);
  let tx0: number;
  if (c.label === 'full') tx0 = x0 - eps;
  else if (c.label === 'left') tx0 = x0 - eps;
  else if (c.label === 'right') tx0 = x1 + eps - tw;
  else tx0 = (x0 + x1) / 2 - tw / 2;
  return { tx0, tx1: tx0 + tw, yb: y1 + 2 * eps, yf: y1 - td, th, tabTop, zt: lowered ? tabTop : zTop + 0.5 };
}

/** The flat top of a cutter's label tab (clipped to the compartment, clear of the lip). */
function tabOf(c: CutterSpec): LabelTab | null {
  const t = tabShape(c);
  if (!t) return null;
  const eps = 0.01;
  const y1 = c.y1 - eps - (c.backInset ?? 0);
  if (y1 - t.yf < 1) return null;
  return { key: c.key ?? '', x0: Math.max(t.tx0, c.x0 + eps), x1: Math.min(t.tx1, c.x1 - eps), y0: t.yf, y1, z: t.tabTop };
}

/**
 * One compartment cutter. With a numeric radius and no tabTop this is exactly
 * the cutter the uniform grid has always used.
 * Solids that later cuts must not remove (tab, scoop ramp) are pushed to `keep`.
 */
export function compartmentCutter(w: Wasm, s: Scope, c: CutterSpec, keep?: Manifold[]): Manifold {
  const { x0, y0, x1, y1, cd, zFloor, topInfill, zTop } = c;
  const innerH = topInfill - zFloor;
  let cutter: Manifold;
  const r = typeof c.radius === 'number' ? c.radius : Math.max(...c.radius);
  const rf = Math.min(r, innerH / 2 - 0.05);
  if (c.fillet && typeof c.radius === 'number' && rf > 0.3) {
    // Rounded bottom edges: hull of corner spheres and the top outline.
    const pts: (Manifold | Vec3)[] = [];
    for (const [sx, sy] of [
      [x0 + rf, y0 + rf],
      [x1 - rf, y0 + rf],
      [x1 - rf, y1 - rf],
      [x0 + rf, y1 - rf],
    ]) {
      pts.push(s.t(w.Manifold.sphere(rf, 24).translate([sx, sy, zFloor + rf])));
    }
    pts.push(...ringAt(roundedRectRing(x0, y0, x1, y1, c.radius), zTop));
    cutter = s.t(w.Manifold.hull(pts));
  } else {
    cutter = s.t(extrudePolygon(w, roundedRectRing(x0, y0, x1, y1, c.radius), zFloor, zTop));
  }

  // Scoop: a concave ramp on the front (-Y) wall for scooping out small parts.
  if (c.scoop > 0) {
    const R = Math.max(2, c.scoop * Math.min(innerH * 0.85, cd * 0.6));
    const fill = s.t(boxAt(w, x0 - 1, y0 - 1, zFloor - 1, x1 + 1, y0 + R, zFloor + R));
    const cyl = s.t(
      w.Manifold.cylinder(x1 - x0 + 4, R, R, 64)
        .rotate([0, 90, 0])
        .translate([x0 - 2, y0 + R, zFloor + R]),
    );
    const ramp = s.t(fill.subtract(cyl));
    cutter = s.t(cutter.subtract(ramp));
    if (keep) keep.push(s.t(ramp.intersect(s.t(boxAt(w, x0, y0 - 1, zFloor - 1, x1, y0 + R, zFloor + R)))));
  }

  // Label tab: a shelf on the back (+Y) wall, angled underneath so it prints without support.
  const t = tabShape(c);
  if (t) {
    const pts: Vec3[] = [];
    for (const x of [t.tx0, t.tx1]) {
      pts.push([x, t.yb, t.tabTop - t.th], [x, t.yb, t.zt], [x, t.yf, t.zt], [x, t.yf, t.tabTop - TAB_TIP_HEIGHT]);
    }
    const tab = s.t(w.Manifold.hull(pts));
    cutter = s.t(cutter.subtract(tab));
    if (keep) keep.push(tab);
  }
  return cutter;
}

export interface InteriorCuts {
  /** Unioned and subtracted from the infill block. */
  cut: Manifold[];
  /** Unioned onto the bin afterwards (guide ribs for removable dividers). */
  add: Manifold[];
}

/** Everything that shapes the interior of a bin's infill block. */
export function interiorCuts(
  w: Wasm,
  s: Scope,
  o: BinOptions,
  W: number,
  D: number,
  zFloor: number,
  topInfill: number,
): InteriorCuts {
  if (!o.layout) return { cut: uniformCutters(w, s, o, W, D, zFloor, topInfill), add: [] };
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  return layoutCuts(w, s, o, resolveLayout(o.layout, innerW, innerD), -W / 2 + WALL, -D / 2 + WALL, zFloor, topInfill);
}

/**
 * The flat tops of a bin's label tabs, with the same sizes `interiorCuts` gives
 * them (same arguments). No geometry is built. Empty for non-compartment interiors.
 */
export function labelTabs(o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): LabelTab[] {
  if (o.interior && o.interior !== 'compartments') return [];
  let specs: CutterSpec[];
  if (!o.layout) {
    try {
      specs = uniformSpecs(o, W, D, zFloor, topInfill);
    } catch {
      return [];
    }
  } else {
    const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
    specs = layoutSpecs(o, r, -W / 2 + WALL, -D / 2 + WALL, zFloor, topInfill).flatMap((x) => x.specs);
  }
  return specs.map(tabOf).filter((t): t is LabelTab => !!t);
}

/** The classic divX × divY grid (geometry identical to before layouts existed). */
function uniformCutters(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): Manifold[] {
  return uniformSpecs(o, W, D, zFloor, topInfill).map((c) => compartmentCutter(w, s, c));
}

/** Cutter specs of the uniform grid, front-left first, column by column. */
function uniformSpecs(o: BinOptions, W: number, D: number, zFloor: number, topInfill: number): CutterSpec[] {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return [];
  const eps = 0.01;
  const ix0 = -W / 2 + WALL;
  const iy0 = -D / 2 + WALL;
  const innerW = W - 2 * WALL;
  const innerD = D - 2 * WALL;
  const cw = (innerW - (o.divX - 1) * DIVIDER) / o.divX;
  const cd = (innerD - (o.divY - 1) * DIVIDER) / o.divY;
  if (cw < 2 || cd < 2) throw new Error('Too many compartments for this bin size.');

  const zTop = topInfill + 1;
  const rc = Math.min(INNER_RADIUS, cw / 2 - 0.05, cd / 2 - 0.05);
  const specs: CutterSpec[] = [];
  for (let i = 0; i < o.divX; i++) {
    for (let j = 0; j < o.divY; j++) {
      const x0 = ix0 + i * (cw + DIVIDER) - eps;
      const x1 = x0 + cw + 2 * eps;
      const y0 = iy0 + j * (cd + DIVIDER) - eps;
      const y1 = y0 + cd + 2 * eps;
      specs.push({
        x0,
        y0,
        x1,
        y1,
        cw,
        cd,
        radius: rc + eps,
        zFloor,
        topInfill,
        zTop,
        fillet: o.fillet,
        scoop: o.scoop,
        label: o.label,
        key: `g${i},${j}`,
        backInset: j === o.divY - 1 ? lipInset(o) : 0,
      });
    }
  }
  return specs;
}

/** How far the stacking lip reaches in over the back of a tab against the outer wall. */
const lipInset = (o: BinOptions) => (o.lip ? LIP_DEPTH - WALL : 0);

const rectRadius = (r: { x0: number; x1: number; y0: number; y1: number }) =>
  Math.max(0, Math.min(INNER_RADIUS, (r.x1 - r.x0) / 2 - 0.05, (r.y1 - r.y0) / 2 - 0.05));

/** Rounded only at the outline's convex corners. */
const strapRadii = (rc: CompRect, r: number, eps: number): CornerRadii =>
  rc.convex.map((cv) => (cv && r > 0 ? r + eps : 0)) as CornerRadii;

/** Cutter specs of a layout's compartments (one per rect), with each compartment's floor. */
function layoutSpecs(
  o: BinOptions,
  r: ResolvedLayout,
  ix0: number,
  iy0: number,
  zFloor: number,
  topInfill: number,
): { c: Compartment; floor: number; specs: CutterSpec[] }[] {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return [];
  const eps = 0.01;
  const zTop = topInfill + 1;
  const maxLower = Math.max(0, innerH - 2);
  const box = (rc: { x0: number; y0: number; x1: number; y1: number }, grow: number) => ({
    x0: ix0 + rc.x0 - grow,
    y0: iy0 + rc.y0 - grow,
    x1: ix0 + rc.x1 + grow,
    y1: iy0 + rc.y1 + grow,
  });
  const backInset = (rc: CompRect) => (rc.y1 >= r.innerD - 1e-6 ? lipInset(o) : 0);

  return r.compartments.map((c) => {
    const co = o.layout?.comps?.[c.key];
    const scoop = co?.scoop ?? o.scoop;
    const label = co?.label ?? o.label;
    const floor = Math.min(Math.max(0, co?.floor ?? 0), Math.max(0, innerH - 2));
    const zf = zFloor + floor;
    const spec = { zFloor: zf, topInfill, zTop, key: c.key };
    if (c.isRect) {
      const rc = c.rects[0];
      const b = box(rc, eps);
      const one: CutterSpec = {
        ...b,
        ...spec,
        cw: rc.x1 - rc.x0,
        cd: rc.y1 - rc.y0,
        radius: rectRadius(rc) + eps,
        fillet: o.fillet,
        scoop,
        label,
        tabTop: topInfill - Math.min(rc.backLower, maxLower),
        backInset: backInset(rc),
      };
      return { c, floor, specs: [one] };
    }
    const tabStrip = c.rects.filter((x) => x.open.back).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
    const specs = c.rects.map(
      (rc): CutterSpec => ({
        ...box(rc, eps),
        ...spec,
        cw: rc.x1 - rc.x0,
        cd: rc.y1 - rc.y0,
        radius: strapRadii(rc, rectRadius(rc), eps),
        fillet: false,
        scoop: rc.open.front ? scoop : 0,
        label: rc === tabStrip ? label : 'none',
        tabTop: topInfill - Math.min(rc.backLower, maxLower),
        backInset: backInset(rc),
      }),
    );
    return { c, floor, specs };
  });
}

function layoutCuts(
  w: Wasm,
  s: Scope,
  o: BinOptions,
  r: ResolvedLayout,
  ix0: number,
  iy0: number,
  zFloor: number,
  topInfill: number,
): InteriorCuts {
  const innerH = topInfill - zFloor;
  if (innerH < 0.5) return { cut: [], add: [] };
  const eps = 0.01;
  const zTop = topInfill + 1;
  const maxLower = Math.max(0, innerH - 2);
  const cut: Manifold[] = [];
  const keep: Manifold[] = [];
  const add: Manifold[] = [];
  const box = (rc: { x0: number; y0: number; x1: number; y1: number }, grow: number) => ({
    x0: ix0 + rc.x0 - grow,
    y0: iy0 + rc.y0 - grow,
    x1: ix0 + rc.x1 + grow,
    y1: iy0 + rc.y1 + grow,
  });

  for (const { c, floor, specs } of layoutSpecs(o, r, ix0, iy0, zFloor, topInfill)) {
    for (const spec of specs) cut.push(compartmentCutter(w, s, spec, keep));
    if (floor > 0) for (const rc of c.rects) keep.push(s.t(prism(w, box(rc, 0), zFloor - 1, zFloor + floor)));
  }

  // Lowered walls: re-cut the merged space above each lowered height.
  const levels = [...new Set(r.walls.filter((x) => x.lower > 0).map((x) => Math.round(Math.min(x.lower, maxLower) * 100) / 100))]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (levels.length) {
    const own = new Set(r.compartments.map((c) => c.key));
    const layers: Manifold[] = [];
    for (const L of levels) {
      const zL = topInfill - L;
      const present = (x: { lower: number }) => Math.min(x.lower, maxLower) < L - 1e-6;
      for (const c of deriveCompartments(r.innerW, r.innerD, r.walls, present)) {
        if (own.has(c.key)) continue;
        for (const rc of c.rects) {
          const b = box(rc, eps);
          const radii = c.isRect ? rectRadius(rc) + eps : strapRadii(rc, rectRadius(rc), eps);
          layers.push(s.t(extrudePolygon(w, roundedRectRing(b.x0, b.y0, b.x1, b.y1, radii), zL, zTop)));
        }
      }
    }
    if (layers.length) {
      let layer = s.t(w.Manifold.union(layers));
      if (keep.length) layer = s.t(layer.subtract(s.t(w.Manifold.union(keep))));
      cut.push(layer);
    }
  }

  // Removable walls: slot + floor groove, guide ribs at each end.
  for (const seg of removableSegments(r, o.lip)) {
    const half = DIVIDER / 2 + SLOT_CLEARANCE;
    const top = topInfill - Math.min(seg.lower, maxLower);
    const a = seg.aEdge ? seg.a - eps : seg.a;
    const b = seg.bEdge ? seg.b + eps : seg.b;
    cut.push(s.t(prism(w, place(seg.orient, seg.pos - half, a, seg.pos + half, b, ix0, iy0), zFloor - SLOT_DEPTH, zTop)));
    for (const [face, dir, gap] of [
      [seg.a, 1, seg.gapA],
      [seg.b, -1, seg.gapB],
    ] as const) {
      const r0 = face - dir * 0.02;
      const r1 = face + dir * (gap + RIB_ENGAGE);
      for (const side of [-1, 1]) {
        const c0 = seg.pos + side * half;
        const c1 = c0 + side * RIB_THICKNESS;
        add.push(
          s.t(prism(w, place(seg.orient, Math.min(c0, c1), Math.min(r0, r1), Math.max(c0, c1), Math.max(r0, r1), ix0, iy0), zFloor - 0.5, top)),
        );
      }
    }
  }
  return { cut, add };
}

interface XY {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An axis-aligned box over a footprint. */
const prism = (w: Wasm, b: XY, z0: number, z1: number) => boxAt(w, b.x0, b.y0, z0, b.x1, b.y1, z1);

/** Footprint for a span across (c) × along (r) a wall, in bin coordinates. */
function place(orient: 'v' | 'h', c0: number, r0: number, c1: number, r1: number, ix0: number, iy0: number): XY {
  return orient === 'v'
    ? { x0: ix0 + c0, y0: iy0 + r0, x1: ix0 + c1, y1: iy0 + r1 }
    : { x0: ix0 + r0, y0: iy0 + c0, x1: ix0 + r1, y1: iy0 + c1 };
}

// ---------------------------------------------------------------------------
// Removable divider plates
// ---------------------------------------------------------------------------

export interface DividerInsert {
  wallId: string;
  /** Segment along the wall (walls crossing a removable wall split it). */
  segment: number;
  /** Plate size (mm): along the wall × up × thickness. */
  length: number;
  height: number;
  thickness: number;
}

/** Plates for the removable walls of a resolved layout. */
export function insertsFor(r: ResolvedLayout, lip: boolean, zFloor: number, topInfill: number): DividerInsert[] {
  const innerH = topInfill - zFloor;
  const maxLower = Math.max(0, innerH - 2);
  return removableSegments(r, lip).map((seg) => ({
    wallId: seg.wallId,
    segment: seg.index,
    length: round(seg.b - seg.a - seg.gapA - seg.gapB),
    height: round(topInfill - Math.min(seg.lower, maxLower) - (zFloor - SLOT_DEPTH)),
    thickness: DIVIDER,
  }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Bevel on the plate's bottom corners so it finds the slot. */
const INSERT_BEVEL = 0.8;

/**
 * A divider plate lying flat for printing: length along X, height along Y,
 * thickness along Z; min corner at the origin, bottom at z = 0. The edge that
 * goes into the floor groove is y = 0 (its corners are beveled).
 */
export function buildDividerInsert(w: Wasm, ins: Pick<DividerInsert, 'length' | 'height' | 'thickness'>): MeshData {
  const s = new Scope();
  try {
    const L = ins.length;
    const H = ins.height;
    const c = Math.min(INSERT_BEVEL, L / 4, H / 4);
    const outline: [number, number][] = [
      [c, 0],
      [L - c, 0],
      [L, c],
      [L, H],
      [0, H],
      [0, c],
    ];
    const m = s.t(extrudePolygon(w, outline, 0, ins.thickness));
    assertValid(m, 'divider insert');
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}

/** Mesh key for a plate, so identical plates share one mesh. */
export function insertKey(ins: Pick<DividerInsert, 'length' | 'height' | 'thickness'>) {
  return `insert|${ins.length}x${ins.height}x${ins.thickness}`;
}

