/**
 * Spacer strips (edge fill 'spacers'): the baseplate is just the grid, and the
 * margins between it and the drawer walls print as separate strips that wedge
 * in beside it. Each strip is as wide as its margin (the drawer's fit clearance
 * is already off the margins) and as tall as the baseplate, so the tops are
 * flush.
 *
 * Holding: the strips are trapped between the plate and the drawer walls; small
 * jigsaw tabs on each strip's inner edge (the baseplate's puzzle-tab shape)
 * drop into sockets cut up into the plate's edge where a wall between two
 * cells meets it, so the plate can't shift and the strips can't tip. The
 * sockets are open underneath: lay the strips against the drawer walls and
 * lower the baseplate onto their tabs.
 *
 * Long strips are split into bed-sized segments joined end to end by a
 * dovetail (a plain butt joint on strips too narrow for one). Strips wide
 * enough get a lattice: a frame with 45° ribs, cut through, to save filament.
 * Everything is a vertical extrusion, so it prints flat without supports.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Vec3, type Wasm } from './kernel';
import { boxAt } from './shapes';
import { BOWTIE, PUZZLE } from './spec';
import type { SolidDef } from './solids';

export type SpacerStyle = 'lattice' | 'solid';

export interface SpacerOptions {
  /** 'lattice': a frame with diagonal ribs; 'solid'. */
  style: SpacerStyle;
  /** Jigsaw tabs on the strips that drop into sockets in the baseplate's edge. */
  tabs: boolean;
}

export const DEFAULT_SPACERS: SpacerOptions = { style: 'lattice', tabs: true };

export function sanitizeSpacers(raw: unknown): SpacerOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SpacerOptions>;
  return {
    style: r.style === 'solid' ? 'solid' : 'lattice',
    tabs: r.tabs === undefined ? DEFAULT_SPACERS.tabs : !!r.tabs,
  };
}

export const SPACER = {
  /** Narrower margins are left empty (they're just clearance). */
  minWidth: 3,
  /** Lattice: outer frame and rib thickness, and the narrowest strip that gets one. */
  frame: 2,
  rib: 1.6,
  latticeMin: 12,
  /** Solid material kept around each tab (each side of it) and at each end. */
  tabBlock: 4,
  endBlock: 4,
  /** Dovetail between segments: only on strips at least this wide; clearance per side. */
  jointMin: 6,
  jointGap: 0.15,
} as const;

/** How far a tab reaches past the strip's inner edge. */
export const SPACER_TAB_REACH = PUZZLE.headAt + PUZZLE.head / 2;

export type SpacerSide = 'left' | 'right' | 'front' | 'back';

/** One printed strip segment, in plate coordinates (grid front-left = 0, 0). */
export interface SpacerSegment {
  side: SpacerSide;
  /** Its index along the strip (0 = front / left end). */
  index: number;
  count: number;
  /** Rectangle the segment fills. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Height (flush with the baseplate top). */
  h: number;
  style: SpacerStyle;
  /** Positions along the strip of the tabs into the plate. */
  tabs: number[];
  /** Tab height (the sockets are PUZZLE.topGap taller). */
  tabTop: number;
  /** A dovetail on its far end (into the next segment), a socket at its near end. */
  tongue: boolean;
  socket: boolean;
}

/** Along-strip axis and the plate edge a strip sits against. */
function frameOf(side: SpacerSide) {
  // u: across, positive into the plate; t: along the strip.
  const along: 'x' | 'y' = side === 'front' || side === 'back' ? 'x' : 'y';
  const sign = side === 'left' || side === 'front' ? 1 : -1;
  return { along, sign };
}

export interface StripPlanInput {
  margins: { left: number; right: number; front: number; back: number };
  plateW: number;
  plateD: number;
  /** Cell boundaries of the grid. */
  xs: number[];
  ys: number[];
  /** Positions of the baseplate's piece seams (no tab there: its socket would be split). */
  seamsX: number[];
  seamsY: number[];
  /** Longest segment that fits the bed (tongue included), mm. */
  maxLen: number;
  height: number;
  tabTop: number;
  opts: SpacerOptions;
  /** Tab every this many cell walls. */
  tabStep: number;
}

const near = (a: number, b: number, d: number) => Math.abs(a - b) < d;

/** The strips for a drawer's margins, split into printable segments. */
export function planSpacerStrips(p: StripPlanInput): SpacerSegment[] {
  const m = p.margins;
  const out: SpacerSegment[] = [];
  const has = (v: number) => v + 1e-6 >= SPACER.minWidth;
  // Left and right strips run the full depth; front and back strips fit between them.
  const strips: { side: SpacerSide; x0: number; y0: number; x1: number; y1: number }[] = [];
  if (has(m.left)) strips.push({ side: 'left', x0: -m.left, x1: 0, y0: -m.front, y1: p.plateD + m.back });
  if (has(m.right)) strips.push({ side: 'right', x0: p.plateW, x1: p.plateW + m.right, y0: -m.front, y1: p.plateD + m.back });
  if (has(m.front)) strips.push({ side: 'front', x0: 0, x1: p.plateW, y0: -m.front, y1: 0 });
  if (has(m.back)) strips.push({ side: 'back', x0: 0, x1: p.plateW, y0: p.plateD, y1: p.plateD + m.back });

  for (const st of strips) {
    const { along } = frameOf(st.side);
    const [a, b] = along === 'x' ? [st.x0, st.x1] : [st.y0, st.y1];
    const width = along === 'x' ? st.y1 - st.y0 : st.x1 - st.x0;
    const bounds = along === 'x' ? p.xs : p.ys;
    const seams = along === 'x' ? p.seamsX : p.seamsY;
    const joint = width + 1e-6 >= SPACER.jointMin;
    const tongue = joint ? jointLength(width) : 0;
    // Cell walls along the plate edge, skipping the piece seams.
    const walls = bounds.slice(1, -1).filter((v) => !seams.some((s) => near(s, v, 1)));
    const picked = p.opts.tabs ? walls.filter((_, k) => k % Math.max(1, p.tabStep) === 0) : [];
    // Segments: as few as fit, cut midway between cells walls (clear of every tab).
    const len = b - a;
    const maxLen = Math.max(20, p.maxLen - tongue);
    const n = Math.max(1, Math.ceil(len / maxLen - 1e-9));
    const centers = bounds.slice(1).map((v, i) => (v + bounds[i]) / 2);
    const cuts: number[] = [];
    let prev = a;
    for (let k = 1; k < n; k++) {
      const ideal = a + (len * k) / n;
      // The cell center nearest the ideal cut that keeps both sides short enough.
      const ok = centers.filter((c) => c - prev <= maxLen + 1e-6 && c > prev + 10 && b - c <= maxLen * (n - k) + 1e-6);
      const c = ok.length ? ok.reduce((best, v) => (Math.abs(v - ideal) < Math.abs(best - ideal) ? v : best)) : ideal;
      cuts.push(c);
      prev = c;
    }
    const ends = [a, ...cuts, b];
    for (let i = 0; i + 1 < ends.length; i++) {
      const s0 = ends[i];
      const s1 = ends[i + 1];
      // Tabs on this segment, clear of its ends and joints.
      const pad = SPACER.tabBlock + (joint ? tongue : 0);
      const tabs = picked.filter((t) => t > s0 + pad && t < s1 - pad);
      const rect = along === 'x' ? { x0: s0, x1: s1, y0: st.y0, y1: st.y1 } : { x0: st.x0, x1: st.x1, y0: s0, y1: s1 };
      out.push({
        side: st.side,
        index: i,
        count: ends.length - 1,
        ...rect,
        h: p.height,
        style: p.opts.style,
        tabs,
        tabTop: p.tabTop,
        tongue: joint && i + 1 < ends.length - 1,
        socket: joint && i > 0,
      });
    }
  }
  return out;
}

/** Length of the dovetail on a strip this wide. */
function jointLength(width: number) {
  return Math.min(8, Math.max(3, width * 0.5));
}

/** Dovetail outline in strip coordinates: t from the joint line, n across (0 … width). */
function dovetail(width: number, grow: number): [number, number][] {
  const L = jointLength(width);
  const neck = width * 0.3;
  const head = width * 0.5;
  const c = width / 2;
  return [
    [-1 - grow, c - neck / 2 - grow],
    [L + grow, c - head / 2 - grow],
    [L + grow, c + head / 2 + grow],
    [-1 - grow, c + neck / 2 + grow],
  ];
}

/** Puzzle tab outlines (neck, head) in seam coordinates (u into the plate, v along), grown by `g`. */
function tabOutlines(g: number): Vec2[][] {
  const hn = PUZZLE.neck / 2 + g;
  const neck: Vec2[] = [
    [-PUZZLE.overlap - g, -hn],
    [PUZZLE.headAt, -hn],
    [PUZZLE.headAt, hn],
    [-PUZZLE.overlap - g, hn],
  ];
  const r = PUZZLE.head / 2 + g;
  const head: Vec2[] = Array.from({ length: 28 }, (_, i) => {
    const a = (2 * Math.PI * i) / 28;
    return [PUZZLE.headAt + r * Math.cos(a), r * Math.sin(a)] as Vec2;
  });
  return [neck, head];
}

/** Seam coordinates on a plate edge to plate coordinates. */
function seamToPlate(side: SpacerSide, plateW: number, plateD: number, at: number, u: number, v: number): Vec2 {
  switch (side) {
    case 'left':
      return [u, at + v];
    case 'right':
      return [plateW - u, at + v];
    case 'front':
      return [at + v, u];
    case 'back':
      return [at + v, plateD - u];
  }
}

/**
 * The socket a tab drops into, cut up into the baseplate's edge (as cut solids
 * for the piece): the tab grown by the puzzle clearance, flared at the mouth,
 * up to just above the tab. The baseplate's high-side puzzle socket, mirrored to
 * whichever edge the strip is on.
 */
export function spacerSocketCuts(seg: Pick<SpacerSegment, 'side' | 'tabs' | 'tabTop'>, plateW: number, plateD: number): SolidDef[] {
  const g = PUZZLE.gap;
  const M = BOWTIE.mouthChamfer;
  const layers: [number, number][] = [
    [-1, g + M + 1],
    [M, g],
    [seg.tabTop + PUZZLE.topGap, g],
  ];
  const out: SolidDef[] = [];
  for (const at of seg.tabs) {
    for (let k = 0; k < 2; k++) {
      // One hull per pair of neighbouring layers: a hull of all three would taper the whole socket from the flare.
      for (let i = 1; i < layers.length; i++) {
        const points: Vec3[] = [];
        for (const [z, grow] of [layers[i - 1], layers[i]]) {
          for (const [u, v] of tabOutlines(grow)[k]) {
            const [x, y] = seamToPlate(seg.side, plateW, plateD, at, u, v);
            points.push([x, y, z]);
          }
        }
        out.push({ kind: 'hull', points });
      }
    }
  }
  return out;
}

/** Bounding box of a segment as printed: its rectangle plus tabs and tongue. */
export function spacerBounds(seg: SpacerSegment): { x0: number; y0: number; x1: number; y1: number; h: number } {
  const r = { x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1 };
  const reach = SPACER_TAB_REACH + 0.01;
  if (seg.tabs.length) {
    if (seg.side === 'left') r.x1 += reach;
    if (seg.side === 'right') r.x0 -= reach;
    if (seg.side === 'front') r.y1 += reach;
    if (seg.side === 'back') r.y0 -= reach;
  }
  if (seg.tongue) {
    const L = jointLength(frameOf(seg.side).along === 'x' ? seg.y1 - seg.y0 : seg.x1 - seg.x0);
    if (frameOf(seg.side).along === 'x') r.x1 += L;
    else r.y1 += L;
  }
  return { ...r, h: seg.h };
}

/** Miter offset of a convex CCW polygon (negative = shrink). */
function offsetConvex(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const normals = pts.map(([x, y], i) => {
    const [qx, qy] = pts[(i + 1) % n];
    const len = Math.hypot(qx - x, qy - y);
    return [(qy - y) / len, -(qx - x) / len];
  });
  return pts.map(([x, y], i) => {
    const [ax, ay] = normals[(i + n - 1) % n];
    const [bx, by] = normals[i];
    const k = d / (1 + ax * bx + ay * by);
    return [x + (ax + bx) * k, y + (ay + by) * k];
  });
}

/** CCW (viewed from +Z). */
function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? [...pts].reverse() : pts;
}

/**
 * One strip segment in plate coordinates, translated so its printed bounding
 * box's min corner is at the origin (bottom at z = 0).
 */
export function buildSpacerSegment(w: Wasm, seg: SpacerSegment, plateW: number, plateD: number): MeshData {
  const s = new Scope();
  try {
    const { along } = frameOf(seg.side);
    const width = along === 'x' ? seg.y1 - seg.y0 : seg.x1 - seg.x0;
    const [t0, t1] = along === 'x' ? [seg.x0, seg.x1] : [seg.y0, seg.y1];
    const n0 = along === 'x' ? seg.y0 : seg.x0;
    // Strip coordinates (t along, n across from the low side) to plate coordinates.
    const P = (t: number, n: number): Vec2 => (along === 'x' ? [t, n0 + n] : [n0 + n, t]);
    const prism = (pts: Vec2[], z0: number, z1: number) => s.t(w.Manifold.extrude([ccw(pts.map(([t, n]) => P(t, n)))], z1 - z0).translate([0, 0, z0]));

    const parts: Manifold[] = [s.t(boxAt(w, seg.x0, seg.y0, 0, seg.x1, seg.y1, seg.h))];
    const cuts: Manifold[] = [];
    // Tabs into the plate (jigsaw knobs from the bottom up to tabTop).
    for (const at of seg.tabs) {
      for (const outline of tabOutlines(0)) {
        const ring = ccw(outline.map(([u, v]) => seamToPlate(seg.side, plateW, plateD, at, u, v)));
        parts.push(s.t(w.Manifold.extrude([ring], seg.tabTop).translate([0, 0, 0])));
      }
    }
    // Dovetail into the next segment, socket for the previous one's.
    if (seg.tongue) parts.push(prism(dovetail(width, 0).map(([t, n]) => [t1 + t, n]), 0, seg.h));
    if (seg.socket) cuts.push(prism(dovetail(width, SPACER.jointGap).map(([t, n]) => [t0 + t, n]), -1, seg.h + 1));

    // Lattice: triangles between 45° ribs, cut through, clear of the ends and tabs.
    if (seg.style === 'lattice' && width + 1e-6 >= SPACER.latticeMin) {
      const F = SPACER.frame;
      const wi = width - 2 * F;
      const tongueIn = seg.socket ? jointLength(width) + SPACER.endBlock : SPACER.endBlock;
      const start = t0 + Math.max(F, tongueIn);
      const end = t1 - SPACER.endBlock;
      const count = Math.floor((end - start - wi) / wi + 1e-9);
      if (count >= 1) {
        const used = wi * (count + 1);
        const tStart = start + (end - start - used) / 2;
        const holes: Manifold[] = [];
        for (let k = 0; k < count; k++) {
          const ta = tStart + k * wi;
          const tri: Vec2[] =
            k % 2 === 0
              ? [
                  [ta, F],
                  [ta + 2 * wi, F],
                  [ta + wi, F + wi],
                ]
              : [
                  [ta, F + wi],
                  [ta + wi, F],
                  [ta + 2 * wi, F + wi],
                ];
          holes.push(prism(offsetConvex(ccw(tri), -SPACER.rib / 2), -1, seg.h + 1));
        }
        // Solid around each tab: the holes are trimmed back there.
        const keep = seg.tabs.map((t) =>
          prism(
            [
              [t - SPACER.tabBlock, -1],
              [t + SPACER.tabBlock, -1],
              [t + SPACER.tabBlock, width + 1],
              [t - SPACER.tabBlock, width + 1],
            ],
            -2,
            seg.h + 2,
          ),
        );
        const all = s.t(w.Manifold.union(holes));
        cuts.push(keep.length ? s.t(all.subtract(s.t(w.Manifold.union(keep)))) : all);
      }
    }

    const body = parts.length > 1 ? s.t(w.Manifold.union(parts)) : parts[0];
    const result = cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
    assertValid(result, `spacer strip ${seg.side} ${seg.index + 1}`);
    const b = spacerBounds(seg);
    return toMeshData(s.t(result.translate([-b.x0, -b.y0, 0])));
  } finally {
    s.dispose();
  }
}
