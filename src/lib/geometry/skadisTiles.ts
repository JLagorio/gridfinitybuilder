/**
 * Planning a Skådis board built from tiles (SkadisOptions.layout 'tiles',
 * geometry/skadis.ts says how): the size of its tiles, the largest the bed
 * takes or the one picked, and where its hexagons go. Loaded with the first
 * board (lib/wall/kinds/all.ts imports it), so it isn't on the first screen;
 * it hands skadis.ts its planner (setTilesPlanner).
 */
import type { Vec2 } from './kernel';
import {
  SKADIS,
  emptyPlan,
  fitsArea,
  hexPlan,
  norm,
  planRect,
  platesFit,
  roundedPolygon,
  setTilesPlanner,
  type BedArea,
  type RectTiles,
  type SkadisOptions,
  type SkadisPlan,
  type SkadisTile,
} from './skadis';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 1e-6;
const SQ3 = Math.sqrt(3);

/** A board built from tiles: rectangles of the size the bed or the pick gives, or hexagons. */
function planTiles(o: SkadisOptions, areas: BedArea[]): SkadisPlan {
  if (o.shape === 'hex') return planHexTiles(o, areas);
  const { n, m, fits } = rectCells(o, areas);
  const P = o.pitch;
  const [cw, ch] = [r3(n * P), r3(m * P)];
  if (!fits) return emptyPlan(o, `A ${cw} × ${ch} mm tile is bigger than the bed: pick a smaller tile size.`);
  const [c0, r0] = [0, 1].map((k) => Math.min(...o.tiles.map((t) => t[k])));
  const [nc, nr] = [0, 1].map((k) => Math.max(...o.tiles.map((t) => t[k])) - [c0, r0][k] + 1);
  const on = new Set(o.tiles.map(([c, r]) => `${c - c0},${r - r0}`));
  const t: RectTiles = {
    o: { ...o, width: r3(nc * cw), height: r3(nr * ch) },
    L: { ox: -P, oy: -P, nx: nc * n + 3, ny: nr * m + 3, p: P },
    xs: Array.from({ length: nc + 1 }, (_, k) => r3(k * cw)),
    ys: Array.from({ length: nr + 1 }, (_, k) => r3(k * ch)),
    grid: { origin: [r3(-c0 * cw), r3(-r0 * ch)], q: [cw, 0], r: [0, ch], at: [] },
    has: (c, r) => on.has(`${c},${r}`),
  };
  return planRect(o, areas, t);
}

/** Rectangle tiles n × m steps each (an even number on a square grid, so seams run between its slots), and whether they fit the bed. */
interface RectCells {
  n: number;
  m: number;
  fits: boolean;
}

/** The tile size for a board built from rectangle tiles: the size picked, in whole steps, or the largest the bed takes. */
function rectCells(o: SkadisOptions, areas: BedArea[]): RectCells {
  const P = o.pitch;
  const even = o.pattern === 'square';
  const reach = o.join === 'both' || o.join === 'tabs' ? SKADIS.tab.depth + SKADIS.tab.gap : 0;
  if (o.tileSize > 0) {
    const steps = (v: number) => Math.max(2, even ? 2 * Math.round(v / P / 2) : Math.round(v / P));
    const [n, m] = [steps(o.tileSize), steps(o.tileHeight || o.tileSize)];
    return { n, m, fits: fitsArea(n * P + reach, m * P + reach, areas) };
  }
  const steps = (len: number) => Math.floor((len - reach) / P + EPS) & (even ? ~1 : ~0);
  let best: RectCells = { n: 2, m: 2, fits: false };
  for (const a of areas) {
    for (const [n, m] of [
      [steps(a.w), steps(a.d)],
      [steps(a.d), steps(a.w)],
    ])
      if (n >= 2 && m >= 2 && (!best.fits || n * m > best.n * best.m)) best = { n, m, fits: true };
  }
  return best;
}

/** A convex polygon (CCW) drawn in by `d` all round. */
function insetPolygon(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  // Each edge's inward normal.
  const inward = (p: Vec2, q: Vec2): Vec2 => {
    const [x, y] = norm([q[0] - p[0], q[1] - p[1]]);
    return [-y, x];
  };
  return pts.map((v, k) => {
    const a = inward(pts[(k + n - 1) % n], v);
    const b = inward(v, pts[(k + 1) % n]);
    const s = d / (1 + a[0] * b[0] + a[1] * b[1]);
    return [v[0] + (a[0] + b[0]) * s, v[1] + (a[1] + b[1]) * s];
  });
}

/**
 * A hexagon tile on one lattice (corners up and down): its neighbour up and to the right is `a` steps across and `b`
 * up, the one to its right 2a across; its corners (CCW from the top one, its box's bottom-left at 0, 0), its size
 * (w across the flats, h corner to corner), how far from regular (0.05: 5% taller or flatter) and whether it fits the
 * bed.
 */
export interface HexCell {
  a: number;
  b: number;
  poly: Vec2[];
  w: number;
  h: number;
  off: number;
  fits: boolean;
}

/**
 * The hexagon tiles a board built from tiles can have: the cells that steps
 * of (2a, 0) and (a, b) make, drawn in by half the gap, within 16% of a regular
 * hexagon, every hexagon's slots alike (a + b even on the standard pattern, a
 * and b even on a square grid); smallest first. Their corners are up and down,
 * so neighbours side by side share an upright edge: half the rows of slots run
 * on from one to the next a column apart (two steps), and a part can span them.
 */
export function hexCells(o: SkadisOptions, areas: BedArea[]): HexCell[] {
  const P = o.pitch;
  const out: HexCell[] = [];
  for (let a = 2; a * P < 500; a++) {
    for (const b of new Set([Math.floor(a * SQ3), Math.ceil(a * SQ3)])) {
      const off = Math.abs(b / a / SQ3 - 1);
      if (off > 0.16 || (o.pattern === 'skadis' ? (a + b) & 1 : o.pattern === 'square' ? (a | b) & 1 : 0)) continue;
      const [X, R] = [a * P, (2 * b * P) / 3];
      const cell = insetPolygon(
        [
          [0, R],
          [-X, R / 2],
          [-X, -R / 2],
          [0, -R],
          [X, -R / 2],
          [X, R / 2],
        ],
        o.hexGap / 2,
      );
      const [w, h] = [r3(2 * cell[5][0]), r3(2 * cell[0][1])];
      const poly = cell.map(([x, y]) => [r3(x + w / 2), r3(y + h / 2)] as Vec2);
      const round = roundedPolygon(poly, o.corner);
      const ext = (k: 0 | 1) => Math.max(...round.map((p) => p[k])) - Math.min(...round.map((p) => p[k]));
      out.push({ a, b, poly, w, h, off: r3(off), fits: fitsArea(ext(0), ext(1), areas) });
    }
  }
  return out;
}

/** The hexagon tile for a board: nearest the size picked (corner to corner), or the largest that fits the bed, a less regular one only when it is much larger. */
export function hexCell(o: SkadisOptions, areas: BedArea[]): HexCell {
  const score = (c: HexCell) => (o.tileSize > 0 ? -Math.abs(c.h - o.tileSize) : +c.fits * 1e4 + c.h * (1 - 2 * c.off));
  return hexCells(o, areas).reduce((p, q) => (score(q) > score(p) ? q : p));
}

/**
 * Hexagons built from tiles: tile (q, r)'s centre q steps of (2a, 0) and r of
 * (a, b) from tile (0, 0)'s, on the lattice: a slot (a step off on a square grid).
 */
function planHexTiles(o: SkadisOptions, areas: BedArea[]): SkadisPlan {
  const c = hexCell(o, areas);
  if (!c.fits) return emptyPlan(o, `A ${c.h} mm hexagon is bigger than the bed: pick a smaller tile size.`);
  const P = o.pitch;
  const { w: hw, h: hh } = c;
  const at = o.tiles.map(([q, r]): Vec2 => [(2 * q + r) * c.a * P, r * c.b * P]);
  // The board's bottom-left, on a 0.1 mm grid (so the slots are too).
  const [x0, y0] = ([0, 1] as const).map((k) => Math.floor((Math.min(...at.map((p) => p[k])) - [hw, hh][k] / 2) * 10) / 10);
  const centres = at.map(([x, y]) => [r3(x - x0), r3(y - y0)] as Vec2);
  // Its column in half hexagons, and its row.
  const cs = o.tiles.map((t) => 2 * t[0] + t[1]);
  const rs = o.tiles.map((t) => t[1]);
  const tiles: SkadisTile[] = centres.map(([x, y], i) => ({
    id: i + 1,
    col: cs[i] - Math.min(...cs),
    row: rs[i] - Math.min(...rs),
    x0: r3(x - hw / 2),
    y0: r3(y - hh / 2),
    x1: r3(x + hw / 2),
    y1: r3(y + hh / 2),
    outer: { left: true, right: true, bottom: true, top: true },
  }));
  const grid: SkadisPlan['grid'] = { origin: [r3(-x0), r3(-y0)], q: [r3(2 * c.a * P), 0], r: [r3(c.a * P), r3(c.b * P)], at: o.tiles };
  const W = r3(Math.max(...tiles.map((t) => t.x1)));
  const H = r3(Math.max(...tiles.map((t) => t.y1)));
  const n = (v: number[]) => Math.max(...v) - Math.min(...v) + 1;
  const plan = hexPlan({ ...o, width: W, height: H }, W, H, hw, hh, tiles, centres, Math.ceil(n(cs) / 2), n(rs), c.poly, grid);
  // Joint plates across the gap between two side by side, in pockets at the middle of every hexagon's upright edges
  // (so they're all one part), hold them in line: a part across the two finds its slots. They need room clear of the slots.
  if (o.join === 'none') return plan;
  const need = SKADIS.plate.size / 2 + SKADIS.plate.gap - o.hexGap / 2 + 1.2;
  if (!platesFit(o.thickness) || o.border < need - EPS) {
    plan.warnings.push(
      o.border < need - EPS
        ? `Joint plates need a ${Math.ceil(need * 10) / 10} mm border: the hexagons aren’t joined.`
        : `A ${o.thickness} mm board is too thin for joint plates: the hexagons aren’t joined.`,
    );
    return plan;
  }
  const there = new Set(o.tiles.map(String));
  plan.hex!.pockets = [-1, 1].map((k) => [r3(hw / 2 + (k * (hw + o.hexGap)) / 2), r3(hh / 2)] as Vec2);
  plan.joints = o.tiles.flatMap(([q, r], i) =>
    there.has(`${q + 1},${r}`) ? [{ kind: 'plate' as const, x: r3(centres[i][0] + (hw + o.hexGap) / 2), y: centres[i][1], seam: 'x' as const }] : [],
  );
  return plan;
}

setTilesPlanner(planTiles);
