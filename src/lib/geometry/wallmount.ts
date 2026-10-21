/**
 * Wall grid: a baseplate screwed to a wall or pegboard backer. The plate's
 * back of the drawer (+Y) is "up" on the wall.
 *
 * Mounting: countersunk screw holes, or keyhole slots to hang the plate on
 * screw heads, at cell intersections (every N cells, always including the
 * outermost ones of each piece). At an intersection the screw goes through the
 * post where four cell walls meet; a countersunk head sits in the floor there,
 * clear of the bins' rounded corners. Optionally a French-cleat groove across
 * the back near the top, which hooks over a printed wall cleat.
 *
 * Keeping bins in: standard bins have nothing a plate could hook — a bin's
 * outer wall is flush with its foot, and neighbours sit 0.5 mm apart — so a
 * wall grid relies on magnets in both the plate and the bins (the plate's
 * magnet pockets are turned on with it). The optional ledge along the bottom
 * edge stops the bottom row tipping out when a bin is knocked; a column of
 * touching bins above rests on it too.
 */
import { Scope, assertValid, toMeshData, type MeshData, type Vec3, type Wasm } from './kernel';
import { buildSolid, type SolidDef } from './solids';

export type WallMount = 'countersunk' | 'keyhole' | 'none';

export interface WallOptions {
  mount: WallMount;
  /** A screw at every this many cell intersections (the outermost ones of each piece always get one). */
  every: number;
  screwDiameter: number;
  headDiameter: number;
  /** French-cleat groove on the back, and a printed cleat for the wall. */
  cleat: boolean;
  /** Retaining ledge along the bottom edge (the front of the layout). */
  ledge: boolean;
  /** How far the ledge stands above the plate, mm. */
  ledgeHeight: number;
}

export const DEFAULT_WALL: WallOptions = {
  mount: 'countersunk',
  every: 2,
  screwDiameter: 4,
  headDiameter: 8,
  cleat: false,
  ledge: true,
  ledgeHeight: 8,
};

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function sanitizeWall(raw: unknown): WallOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WallOptions>;
  const d = DEFAULT_WALL;
  const screw = num(r.screwDiameter, 2.5, 6, d.screwDiameter);
  return {
    mount: r.mount === 'keyhole' || r.mount === 'none' ? r.mount : 'countersunk',
    every: Math.round(num(r.every, 1, 8, d.every)),
    screwDiameter: screw,
    headDiameter: Math.max(num(r.headDiameter, 5, 12, d.headDiameter), screw + 2),
    cleat: !!r.cleat,
    ledge: r.ledge === undefined ? d.ledge : !!r.ledge,
    ledgeHeight: num(r.ledgeHeight, 3, 30, d.ledgeHeight),
  };
}

export const WALL = {
  /** Screw clearance on the shaft (diameter), and around the head. */
  shaftClear: 0.4,
  headClear: 0.4,
  /** Floor left under a countersink. */
  sinkFloor: 1.2,
  /** Keyhole: back layer (wall to screw head), head pocket height, floor above it, slot length. */
  keyBack: 2.5,
  keyPocket: 3.5,
  keyRoof: 1.2,
  keySlot: 10,
  /** French cleat: how far it stands off the wall, its height, play, and material kept above the groove. */
  cleatDepth: 4.5,
  cleatHeight: 14,
  cleatClear: 0.4,
  cleatTopMargin: 6,
  /** Ledge thickness. */
  ledge: 2.4,
  /** Cleat strip screw spacing. */
  cleatScrewEvery: 80,
} as const;

/** Floor the mount needs under the receptacles (before magnets), mm. */
export function wallFloorNeed(o: WallOptions, magnetDepth: number): number {
  let need = 0;
  if (o.mount === 'countersunk') need = (o.headDiameter - o.screwDiameter) / 2 + WALL.sinkFloor;
  if (o.mount === 'keyhole') need = WALL.keyBack + WALL.keyPocket + WALL.keyRoof;
  if (o.cleat) need = Math.max(need, WALL.cleatDepth + WALL.cleatClear + 1 + (magnetDepth > 0 ? magnetDepth + 0.6 : 0));
  return need;
}

/** Where the groove sits (plate coordinates, Y up the wall). */
export interface CleatBand {
  /** Groove bottom, and the top of its sloped face at the back of the plate. */
  y0: number;
  yTop: number;
  /** Groove depth into the plate's back. */
  depth: number;
}

/**
 * The groove: its sloped top face rests on the cleat's slope (so the plate is
 * pulled toward the wall), and it runs down far enough below the cleat to lift
 * the plate off again (the cleat's front edge has to clear the groove's mouth).
 */
export function cleatBand(plateD: number): CleatBand {
  const depth = WALL.cleatDepth + WALL.cleatClear;
  const yTop = plateD - WALL.cleatTopMargin - depth;
  return { y0: yTop - WALL.cleatHeight - WALL.cleatClear, yTop, depth };
}

/** The groove cut, across the whole width, as a cut solid. */
export function cleatGrooveCut(band: CleatBand, x0: number, x1: number): SolidDef {
  const c = band.depth;
  const profile: [number, number][] = [
    [band.y0, -1],
    [band.yTop - 1, -1],
    [band.yTop + c, c],
    [band.y0, c],
  ];
  const points: Vec3[] = [];
  for (const x of [x0 - 1, x1 + 1]) for (const [y, z] of profile) points.push([x, y, z]);
  return { kind: 'hull', points };
}

/** Where the wall cleat strip sits when the plate hangs on it (plate coordinates). */
export function cleatStripAt(band: CleatBand): { y0: number; y1: number; depth: number } {
  // Its back face (on the wall) reaches up to the groove's slope at the mouth.
  const y0 = band.yTop - WALL.cleatHeight + WALL.cleatDepth;
  return { y0, y1: y0 + WALL.cleatHeight, depth: WALL.cleatDepth };
}

/**
 * Hole positions along one axis of a piece: the cell walls inside it, every
 * `every`, always including the first and last; the middle cell's center when
 * the piece is a single cell wide.
 */
export function holeLines(bounds: number[], c0: number, c1: number, every: number): number[] {
  const inner = bounds.slice(c0 + 1, c1);
  if (!inner.length) {
    if (c1 <= c0) return [];
    const mid = Math.floor((c0 + c1 - 1) / 2);
    return [(bounds[mid] + bounds[mid + 1]) / 2];
  }
  const span = inner.length - 1;
  const count = span === 0 ? 1 : Math.ceil(span / Math.max(1, every) - 1e-9) + 1;
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(inner[count === 1 ? 0 : Math.round((span * k) / (count - 1))]);
  return [...out].sort((a, b) => a - b);
}

/** The cut solids for one mounting hole at (x, y). `floor` is the top of the plate's floor, `top` its top. */
export function mountHoleCuts(o: WallOptions, x: number, y: number, floor: number, top: number): SolidDef[] {
  const rh = (o.screwDiameter + WALL.shaftClear) / 2;
  const rk = (o.headDiameter + WALL.headClear) / 2;
  if (o.mount === 'countersunk') {
    const sink = rk - rh;
    return [
      { kind: 'cyl', x, y, z0: -1, z1: floor + 0.01, r0: rh },
      // 90° countersink in the floor, then room for the screwdriver through the post above.
      { kind: 'cyl', x, y, z0: floor - sink, z1: floor + 0.01, r0: rh, r1: rk },
      { kind: 'cyl', x, y, z0: floor, z1: top + 1, r0: rk },
    ];
  }
  if (o.mount === 'keyhole') {
    // From the back: the head goes in the round hole, then the plate drops so the shaft runs up the slot.
    const a = WALL.keyBack;
    const b = a + WALL.keyPocket;
    const L = WALL.keySlot;
    const stadium = (r: number, z0: number, z1: number): SolidDef => {
      const pts: Vec3[] = [];
      for (let i = 0; i < 24; i++) {
        const t = (2 * Math.PI * i) / 24;
        for (const cy of [y, y + L]) for (const z of [z0, z1]) pts.push([x + r * Math.cos(t), cy + r * Math.sin(t), z]);
      }
      return { kind: 'hull', points: pts };
    };
    return [{ kind: 'cyl', x, y, z0: -1, z1: b, r0: rk }, stadium(rh, -1, a + 0.01), stadium(rk, a, b)];
  }
  return [];
}

/** Plan-view keep-out of a mounting hole (for staying clear of the cleat groove). */
export function mountHoleReach(o: WallOptions): { r: number; up: number } {
  const rk = (o.headDiameter + WALL.headClear) / 2;
  return { r: rk + 1, up: o.mount === 'keyhole' ? WALL.keySlot : 0 };
}

/** A printed wall cleat (or one length of it), in plate coordinates as it hangs in the groove. */
export interface CleatStrip {
  x0: number;
  x1: number;
  /** Bottom of the strip, and its height on its front face. */
  y0: number;
  height: number;
  depth: number;
  /** Screw positions along X. */
  screws: number[];
  screwDiameter: number;
  headDiameter: number;
}

/** Lengths of wall cleat for a plate, each no longer than `maxLen`, with screws every ~80 mm (two at least). */
export function planCleatStrips(plateW: number, band: CleatBand, maxLen: number, o: WallOptions): CleatStrip[] {
  const at = cleatStripAt(band);
  const x0 = 1;
  const x1 = plateW - 1;
  const n = Math.max(1, Math.ceil((x1 - x0) / Math.max(20, maxLen) - 1e-9));
  const len = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) => {
    const a = x0 + i * len;
    const b = a + len;
    const k = Math.max(2, Math.round(len / WALL.cleatScrewEvery) + 1);
    const pad = Math.min(15, len / 4);
    const screws = Array.from({ length: k }, (_, j) => a + pad + ((b - a - 2 * pad) * j) / (k - 1));
    return { x0: a, x1: b, y0: at.y0, height: WALL.cleatHeight, depth: at.depth, screws, screwDiameter: o.screwDiameter, headDiameter: o.headDiameter };
  });
}

/** The wall cleat strip: back on the wall (z = 0), 45° top, countersunk screws from its face. Min corner at the origin. */
export function buildCleatStrip(w: Wasm, c: CleatStrip): MeshData {
  const s = new Scope();
  try {
    const profile: [number, number][] = [
      [c.y0, 0],
      [c.y0 + c.height - c.depth, 0],
      [c.y0 + c.height, c.depth],
      [c.y0, c.depth],
    ];
    const points: Vec3[] = [];
    for (const x of [c.x0, c.x1]) for (const [y, z] of profile) points.push([x, y, z]);
    const body = s.t(w.Manifold.hull(points));
    const rh = (c.screwDiameter + WALL.shaftClear) / 2;
    const rk = (c.headDiameter + WALL.headClear) / 2;
    const yc = c.y0 + (c.height - c.depth) / 2;
    const cuts = c.screws.flatMap((x) => [
      s.t(buildSolid(w, { kind: 'cyl', x, y: yc, z0: -1, z1: c.depth + 1, r0: rh })),
      s.t(buildSolid(w, { kind: 'cyl', x, y: yc, z0: c.depth - Math.min(rk - rh, c.depth - 1), z1: c.depth + 0.01, r0: rh, r1: rk })),
    ]);
    const result = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    assertValid(result, 'wall cleat');
    return toMeshData(s.t(result.translate([-c.x0, -c.y0, 0])));
  } finally {
    s.dispose();
  }
}
