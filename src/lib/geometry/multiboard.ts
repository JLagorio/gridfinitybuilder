/**
 * Multiboard-compatible boards: a 25 mm grid of large octagonal holes (for
 * Multiboard's snaps and big-thread parts) with a small peg hole at every
 * grid crossing between them, as tiles that fit the bed. Multiboard doesn't
 * publish its tiles' dimensions, so these are measured ones, each an option
 * to check against one printed tile: the community's measured model
 * (shaggyone/multiboard-parametric on GitHub, multiboard_base.scad) and
 * Multiboard's own listings (a 25 mm grid; big holes take snaps and big
 * threads, small ones pegboard hooks and small threads). The geometry is
 * built here from those numbers.
 *
 * - Each square is a regular octagon 25 mm across its flats; where four meet,
 *   a square turned 45° (7.32 mm from its middle to each corner) fills the
 *   gap, with the peg hole (⌀6.1) in it. The board's edge is the octagons'
 *   edges, a V notch at every grid line.
 * - The large hole: an octagon 23.4 mm across its flats at each face,
 *   narrowing over 2 mm (27° off upright) to 21.4 for the middle 2.4 mm of
 *   the 6.4 mm board: snaps click behind that ring.
 * - Threads (optional, measured: try one tile first), right-hand: the big
 *   one, 2.5 mm pitch, a trapezoid groove 0.55 deep (22.5 mm across at its
 *   bottom), 1.58 wide at the bore and 0.5 at the bottom; it cuts into the
 *   octagon's flats. The small one in the peg holes: 3 mm pitch, ⌀7.03 at
 *   the bottom, 2.5 wide at the bore, 0.77 at the bottom. Off, the holes are
 *   plain bores.
 * - Tiles split between squares. Each tile has the crossings on its right and
 *   top seams (their peg holes in them): a tooth sticks out into the next
 *   tile's notch, a clearance smaller all round, so the tiles lock edge to
 *   edge. Screws go through countersunk peg holes, one in from each tile's
 *   corners (or spread across it).
 * Tiles print as they hang, back on the bed.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from './kernel';
import { cylinderAt, loftRings } from './shapes';
import { bool, int, num, pick, r3, splitGrid, tileScrews, type BedArea, type GridFit, type GridScrews, type GridTile } from './gridTiles';
import { octagon } from './opengrid';

export interface MultiboardOptions {
  /** Squares across and up. */
  cols: number;
  rows: number;
  /** The measured dimensions, mm: the board's thickness; the large hole across its flats in its middle and at the faces, and the middle's length; the peg hole. */
  thickness: number;
  hole: number;
  holeFace: number;
  ring: number;
  peg: number;
  /** The big thread in the large holes, the small one in the peg holes (measured profiles). */
  threads: boolean;
  pegThreads: boolean;
  screws: GridScrews;
  screwEvery: number;
  /** Screw size (countersunk), mm. */
  screw: number;
  /** How the teeth fit the next tile's notches. */
  fit: GridFit;
  /** Most squares a tile has each way (0: as many as the bed takes). */
  maxTile: number;
  /** Print one 2 × 2 tile to check the holes first. */
  test: boolean;
}

export const DEFAULT_MULTIBOARD: MultiboardOptions = {
  cols: 12,
  rows: 8,
  thickness: 6.4,
  hole: 21.4,
  holeFace: 23.4,
  ring: 2.4,
  peg: 6.1,
  threads: false,
  pegThreads: false,
  screws: 'corners',
  screwEvery: 3,
  screw: 4,
  fit: 'normal',
  maxTile: 0,
  test: false,
};

/** The grid, the squares between octagons (middle to corner), and the threads' measured grooves: pitch, depth, width at the bore and at the bottom. */
export const MULTIBOARD = {
  pitch: 25,
  node: (25 - 25 / (1 + Math.SQRT2)) / 2,
  thread: { pitch: 2.5, depth: 0.55, bore: 1.583, bottom: 0.5 },
  pegThread: { pitch: 3, depth: (7.025 - 6.069) / 2, bore: 2.5, bottom: 0.768 },
} as const;

/** Clearance on each face of a tooth, by fit. */
export const MULTIBOARD_FIT: Record<GridFit, number> = { snug: 0.05, normal: 0.1, loose: 0.2 };

export function sanitizeMultiboard(raw: unknown): MultiboardOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_MULTIBOARD;
  const thickness = num(r.thickness, 4, 12, d.thickness);
  const hole = num(r.hole, 18, 23, d.hole);
  return {
    cols: int(r.cols, 1, 80, d.cols),
    rows: int(r.rows, 1, 80, d.rows),
    thickness,
    hole,
    holeFace: num(r.holeFace, hole, 24, Math.max(hole, d.holeFace)),
    ring: num(r.ring, 0.4, thickness, Math.min(d.ring, thickness)),
    peg: num(r.peg, 3, 8, d.peg),
    threads: bool(r.threads, d.threads),
    pegThreads: bool(r.pegThreads, d.pegThreads),
    screws: pick(r.screws, ['corners', 'grid', 'none'] as const, d.screws),
    screwEvery: int(r.screwEvery, 1, 20, d.screwEvery),
    screw: num(r.screw, 3, 5, d.screw),
    fit: pick(r.fit, ['snug', 'normal', 'loose'] as const, d.fit),
    maxTile: int(r.maxTile, 0, 40, d.maxTile),
    test: bool(r.test, d.test),
  };
}

/** A countersunk screw's head, mm. */
export const multiboardHead = (screw: number) => 2 * screw + 0.5;

export interface MultiboardPlan {
  cols: number;
  rows: number;
  T: number;
  tiles: GridTile[];
  tileCols: number;
  tileRows: number;
  /** Large holes and peg holes in all. */
  holes: number;
  pegs: number;
  screws: { x: number; y: number; tile: number }[];
  warnings: string[];
  error?: string;
}

export function planMultiboard(o: MultiboardOptions, areas: BedArea[]): MultiboardPlan {
  const P = MULTIBOARD.pitch;
  const cols = o.test ? 2 : o.cols;
  const rows = o.test ? 2 : o.rows;
  const split = splitGrid(cols, rows, P, areas, { reach: MULTIBOARD.node, max: o.maxTile });
  const warnings: string[] = [];
  const screws: MultiboardPlan['screws'] = [];
  let bare = 0;
  for (const t of split.tiles) {
    const mine = tileScrews(t.c1 - t.c0, t.r1 - t.r0, o.screws, o.screwEvery);
    if (o.screws !== 'none' && !mine.length) bare++;
    for (const [i, j] of mine) screws.push({ x: (t.c0 + i) * P, y: (t.r0 + j) * P, tile: t.id });
  }
  if (bare) warnings.push(`${bare} tile${bare === 1 ? ' is' : 's are'} one square wide or high: no room for a screw in ${bare === 1 ? 'it' : 'them'}.`);
  return {
    cols,
    rows,
    T: o.thickness,
    tiles: split.tiles,
    tileCols: split.cols,
    tileRows: split.rows,
    holes: cols * rows,
    pegs: Math.max(0, cols - 1) * Math.max(0, rows - 1),
    screws,
    warnings,
    ...(split.error ? { error: split.error } : {}),
  };
}

/** One tile, as the geometry worker builds it (tile mm, from its bottom left). */
export interface MultiboardTileSpec {
  /** Squares across and up. */
  w: number;
  h: number;
  T: number;
  hole: number;
  holeFace: number;
  ring: number;
  peg: number;
  threads: boolean;
  pegThreads: boolean;
  /** Grid crossings on the tile's edge: cut out (the next tile's tooth, or the board's edge), or sticking out (its own tooth). */
  notches: Vec2[];
  teeth: Vec2[];
  /** Peg holes, and the ones countersunk for a screw. */
  pegs: Vec2[];
  screws: Vec2[];
  head: number;
  /** Clearance on each face of a tooth. */
  fit: number;
}

export function multiboardTileSpecs(plan: MultiboardPlan, o: MultiboardOptions): MultiboardTileSpec[] {
  const P = MULTIBOARD.pitch;
  const { cols, rows } = plan;
  return plan.tiles.map((t) => {
    const notches: Vec2[] = [];
    const teeth: Vec2[] = [];
    const pegs: Vec2[] = [];
    for (let i = t.c0; i <= t.c1; i++) {
      for (let j = t.r0; j <= t.r1; j++) {
        const at: Vec2 = [(i - t.c0) * P, (j - t.r0) * P];
        const inside = i > t.c0 && i < t.c1 && j > t.r0 && j < t.r1;
        // A crossing inside the board has its square; it's the tile's whose square is below and left of it.
        const square = i >= 1 && i <= cols - 1 && j >= 1 && j <= rows - 1;
        const mine = square && i > t.c0 && j > t.r0;
        if (mine) pegs.push(at);
        if (inside) continue;
        if (mine) teeth.push(at);
        else notches.push(at);
      }
    }
    return {
      w: t.c1 - t.c0,
      h: t.r1 - t.r0,
      T: o.thickness,
      hole: o.hole,
      holeFace: o.holeFace,
      ring: o.ring,
      peg: o.peg,
      threads: o.threads,
      pegThreads: o.pegThreads,
      notches,
      teeth,
      pegs,
      screws: plan.screws.filter((s) => s.tile === t.id).map((s) => [r3(s.x - t.c0 * P), r3(s.y - t.r0 * P)] as Vec2),
      head: multiboardHead(o.screw),
      fit: MULTIBOARD_FIT[o.fit],
    };
  });
}

/** How far a tooth sticks out past the tile's edge. */
export const toothReach = (fit: number) => r3(MULTIBOARD.node - fit * Math.SQRT2);

/** A tile's printed size (its teeth included); its min corner is its squares' bottom left. */
export function multiboardTileSize(t: MultiboardTileSpec): { w: number; d: number; h: number } {
  const P = MULTIBOARD.pitch;
  const reach = toothReach(t.fit);
  const W = t.w * P;
  const H = t.h * P;
  return {
    w: r3(Math.max(W, ...t.teeth.map(([x]) => x + reach))),
    d: r3(Math.max(H, ...t.teeth.map(([, y]) => y + reach))),
    h: t.T,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The square turned 45° round a crossing, `half` from its middle to each corner (CCW). */
const diamond = (x: number, y: number, half: number): Vec2[] => [
  [x + half, y],
  [x, y + half],
  [x - half, y],
  [x, y - half],
];

/** A large hole round the origin, reaching 1 mm past both faces. */
function largeHole(w: Wasm, t: MultiboardTileSpec): Manifold {
  const z1 = (t.T - t.ring) / 2;
  const z2 = (t.T + t.ring) / 2;
  const ring = (across: number) => octagon(0, 0, across / 2, (across / 2) * Math.SQRT2);
  const face = ring(t.holeFace);
  const mid = ring(t.hole);
  // A board with no taper (the faces as narrow as the middle) is one straight bore.
  if (z1 < 1e-3) return loftRings(w, [mid, mid], [-1, t.T + 1]);
  return loftRings(w, [face, face, mid, mid, face, face], [-1, 0, z1, z2, t.T, t.T + 1]);
}

/**
 * A thread's groove, a trapezoid swept up a right-hand helix from z0 to z1
 * round the origin: `r` the bore, the groove `depth` deep, `bore` wide at the
 * bore and `bottom` wide at its bottom. It reaches 0.5 mm into the bore so it
 * joins it cleanly.
 */
function threadGroove(w: Wasm, r: number, p: { pitch: number; depth: number; bore: number; bottom: number }, z0: number, z1: number, segs = 48): Manifold {
  const prof: Vec2[] = [
    [r - 0.5, -p.bore / 2],
    [r, -p.bore / 2],
    [r + p.depth, -p.bottom / 2],
    [r + p.depth, p.bottom / 2],
    [r, p.bore / 2],
    [r - 0.5, p.bore / 2],
  ];
  const n = prof.length;
  const K = Math.ceil(((z1 - z0) / p.pitch) * segs);
  const verts = new Float32Array((K + 1) * n * 3);
  for (let k = 0; k <= K; k++) {
    const a = (2 * Math.PI * k) / segs;
    const zc = z0 + (p.pitch * k) / segs;
    for (let m = 0; m < n; m++) {
      const o = (k * n + m) * 3;
      verts[o] = prof[m][0] * Math.cos(a);
      verts[o + 1] = prof[m][0] * Math.sin(a);
      verts[o + 2] = zc + prof[m][1];
    }
  }
  const tris: number[] = [];
  for (let k = 0; k < K; k++) {
    for (let m = 0; m < n; m++) {
      const m1 = (m + 1) % n;
      const a0 = k * n + m;
      const a1 = k * n + m1;
      const b0 = (k + 1) * n + m;
      const b1 = (k + 1) * n + m1;
      tris.push(a0, b1, a1, a0, b0, b1);
    }
  }
  // The ends: the profile faces back along the helix at the start, forward at the end.
  const e = K * n;
  for (let m = 1; m < n - 1; m++) tris.push(0, m, m + 1, e, e + m + 1, e + m);
  return w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) }));
}

/** A tile, printed as it hangs (back on the bed), its min corner at its squares' bottom left. */
export function buildMultiboardTile(w: Wasm, t: MultiboardTileSpec): MeshData {
  const s = new Scope();
  try {
    const P = MULTIBOARD.pitch;
    const T = t.T;
    const W = t.w * P;
    const H = t.h * P;
    const adds: Manifold[] = [s.t(w.Manifold.cube([W, H, T]))];
    const reach = toothReach(t.fit);
    for (const [x, y] of t.teeth) adds.push(s.t(w.Manifold.extrude([diamond(x, y, reach)], T)));
    const body = s.t(w.Manifold.union(adds));

    const cuts: Manifold[] = [];
    for (const [x, y] of t.notches) cuts.push(s.t(w.Manifold.extrude([diamond(x, y, MULTIBOARD.node)], T + 2).translate([0, 0, -1])));
    // One hole (and its thread) and one peg hole, joined once and copied: copies never touch, so they compose.
    const plain = s.t(largeHole(w, t));
    const hole = t.threads ? s.t(plain.add(s.t(threadGroove(w, t.hole / 2, MULTIBOARD.thread, -MULTIBOARD.thread.pitch, T + MULTIBOARD.thread.pitch)))) : plain;
    const holes: Manifold[] = [];
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) holes.push(s.t(hole.translate([i * P + P / 2, j * P + P / 2, 0])));
    cuts.push(s.t(w.Manifold.compose(holes)));
    const pr = t.peg / 2;
    const bore = s.t(cylinderAt(w, 0, 0, -1, T + 1, pr, pr, 32));
    const peg = t.pegThreads
      ? s.t(bore.add(s.t(threadGroove(w, pr, MULTIBOARD.pegThread, -MULTIBOARD.pegThread.pitch, T + MULTIBOARD.pegThread.pitch, 32))))
      : bore;
    if (t.pegs.length) cuts.push(s.t(w.Manifold.compose(t.pegs.map(([x, y]) => s.t(peg.translate([x, y, 0]))))));
    // Countersunk for a screw from the front: 90°, down to the peg hole.
    const hr = t.head / 2;
    for (const [x, y] of t.screws) {
      cuts.push(s.t(cylinderAt(w, x, y, T - (hr - pr), T + 0.001, pr, hr, 48)));
      cuts.push(s.t(cylinderAt(w, x, y, T, T + 1, hr, hr, 48)));
    }
    const out = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    assertValid(out, 'Multiboard tile');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

/** For tests: the thread groove alone. */
export const multiboardThread = (w: Wasm, r: number, which: 'big' | 'small', z0: number, z1: number) =>
  threadGroove(w, r, which === 'big' ? MULTIBOARD.thread : MULTIBOARD.pegThread, z0, z1);
