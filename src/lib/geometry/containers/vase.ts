/**
 * Vase-mode bin (container kind 'vase'): a bin for the slicer's spiral vase
 * mode. The slicer prints the bottom layers as usual, then one continuous
 * spiral line around the outside: a bin in minutes, from a few grams.
 *
 * How it prints (PrusaSlicer, Bambu Studio and Orca work the same way here):
 * below the "bottom layers" the part is sliced normally, every island and
 * hole included; above them only the largest outline of each layer is kept,
 * its holes closed, and printed as one line whose height rises along the loop.
 * So everything that must be inside the bin has to be part of that one
 * outline, or below the spiral's start.
 *
 * The part is drawn as it prints, which the slicer then reads as a vase: above
 * the start the wall is one line thick, and the slicer, closing each layer's
 * holes, gets the same outline a solid block would give it. Drawn this way it
 * is one closed shell (a solid block over hollow feet would seal voids inside
 * it), the 3D view shows the bin it makes, its volume is the filament it
 * takes, and without vase mode it still prints, as a thin-walled bin.
 *
 * - Feet: a bin on several cells stands on one foot per cell, separate islands
 *   below the baseplate's ridge line, which a single outline can't print. So
 *   the spiral starts above the feet (`VASE.start`, 6 mm, the usual 30 bottom
 *   layers at 0.2 mm) and everything below it is modelled as it prints: each
 *   foot a shell two lines thick with a floor (`floor`), open to the bin above
 *   like a "lite" foot, joined by a band of walls along the cell lines up to
 *   the start. Magnet and screw holes sit in solid bosses in the feet. The
 *   slicer prints all of it as ordinary bottom layers (one wall per edge, both
 *   sides of each shell), so it takes the exact bottom-layer count; Bambu
 *   projects get it set per object, and other slicers are told in the part's
 *   name, the README and the panel.
 * - A flat bin (base 'flat') has no feet: the bottom layers are just its
 *   floor, and the spiral starts on top of it.
 * - Dividers: a thin slit cut in from the back wall (the right wall for
 *   dividers across the depth), through the top, ending `gap` short of the
 *   opposite wall. The outline follows the slit in and back out, so the single
 *   wall folds into a divider: two lines a slit apart, joined at the tip, which
 *   touches the opposite wall's line (drawn as a wall that thick with the slit
 *   down its middle; solid below the spiral). The slit must be wider than
 *   twice the slicers' 0.049 mm gap-closing radius or they close it, and the
 *   solid at its end must stay over a line wide once the slicer insets the
 *   outline by half a line from each side, or the outline splits into two
 *   loops and the spiral stops. Dividers run one way only: slits that cross
 *   would cut the bin apart.
 *
 * Everything that would sit inside the wall (scoops, label tabs, stacking lip,
 * compartments, pockets, inserts) can't be printed by one line, so a vase bin
 * has none of them; see `VASE_LEAVES_OUT`.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from '../kernel';
import { BASE_PROFILE, BASE_PROFILE_DEPTH, BASE_PROFILE_HEIGHT, BASE_TOP, BASE_TOP_RADIUS, GRID, HEIGHT_UNIT } from '../spec';
import { boxAt, extrudePolygon, loftRings, roundedRectRing } from '../shapes';
import { binHoleSites, binSize, buildFeet, type BinCells, type BinOptions } from '../bin';
import { holeBosses, holeCutters } from '../holes';
import { cellRects } from '../variants';
import { activeContainer, registerContainer, type ContainerDef } from './registry';

/** Which way the dividers run: 'x' = sections side by side (walls front to back), 'y' = sections front to back (walls side to side). */
export type VaseAxis = 'x' | 'y';

export interface VaseOptions {
  /** Divider walls, evenly spaced (sections = dividers + 1). */
  dividers: number;
  axis: VaseAxis;
  /**
   * Width of the slicer's wall line, mm. The model is drawn for it (feet
   * shells two lines thick, the slits' ends) and Bambu projects print with it.
   */
  line: number;
  /** Bottom thickness, mm: each foot's floor, or a flat bin's whole bottom. */
  floor: number;
}

export const DEFAULT_VASE: VaseOptions = { dividers: 0, axis: 'x', line: 0.6, floor: 1 };

export const VASE = {
  /** The spiral starts this high on a bin with feet: above the feet and the band that joins them. */
  start: 6,
  /** Slit width, mm: over twice the slicers' 0.049 mm gap closing, so it stays open, and under a line's overlap. */
  slit: 0.15,
  /**
   * Solid left between a slit's end and the front wall, in lines. The slicer
   * insets the outline half a line from each side, leaving one line of solid
   * there: the outline stays one loop and the fold's tip touches the front
   * wall's line. (PrusaSlicer 2.7 still printed one loop at 1.75 lines and
   * split it in two at 1.5.)
   */
  gapLines: 2,
  maxDividers: 11,
  /** Narrowest section between dividers, mm. */
  minSection: 10,
  line: { min: 0.25, max: 1.6 },
  floor: { min: 0.4, max: 2 },
  /** Line width as a share of the nozzle: the default for a nozzle, and the sensible range. */
  lineShare: { best: 1.5, min: 1, max: 2 },
} as const;

/** Bin options a vase bin doesn't use, and why (the panel and the README say so). */
export const VASE_LEAVES_OUT =
  'One line of wall has nothing inside it: no scoop, label tab or label text, stacking lip or lid, pockets, cups, trays or wall cutouts, and compartments only as folds of the wall. Nothing stacks on it, and it doesn’t stretch over the margin.';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

export function sanitizeVase(raw: unknown): VaseOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<VaseOptions>;
  const d = DEFAULT_VASE;
  return {
    dividers: Math.round(num(r.dividers, 0, VASE.maxDividers, d.dividers)),
    axis: r.axis === 'y' ? 'y' : 'x',
    line: round2(num(r.line, VASE.line.min, VASE.line.max, d.line)),
    floor: round2(num(r.floor, VASE.floor.min, VASE.floor.max, d.floor)),
  };
}

export function vaseKey(o: VaseOptions): string {
  return `d${o.dividers}${o.axis}/l${o.line}/f${o.floor}`;
}

/** The line width that suits a nozzle (1.5 ×, to 0.05 mm). */
export function vaseLineFor(nozzle: number): number {
  return round2(Math.min(VASE.line.max, Math.max(VASE.line.min, Math.round((nozzle * VASE.lineShare.best) / 0.05) * 0.05)));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface VaseLayout {
  W: number;
  D: number;
  /** Overall height. */
  H: number;
  feet: boolean;
  /** Where the spiral starts: the top of the bottom layers, mm. */
  start: number;
  /** Feet shell and band wall thickness (two lines), mm. */
  shell: number;
  /** A divider as drawn above the spiral's start: two lines and the slit between them, mm. */
  divider: number;
  /** Divider positions (x for axis 'x', y for 'y'), bin-centered. */
  dividers: number[];
  /** Section widths along the divider axis. */
  sections: number[];
  /** Slit width, its length and the solid left at its end, mm. */
  slit: number;
  slitLength: number;
  gap: number;
  /** Length of the spiral's path around one layer (outline plus both sides of every slit), mm. */
  path: number;
}

/** Perimeter of a rounded rectangle. */
const roundedPerimeter = (w: number, d: number, r: number) => 2 * (w + d) - 8 * r + 2 * Math.PI * r;

export function vaseLayout(bin: BinOptions, o: VaseOptions, cellsIn?: BinCells): VaseLayout {
  const cells = cellsIn ? { x: cellsIn.x, y: cellsIn.y } : undefined;
  const { w: W, d: D } = binSize(bin, cells);
  const H = HEIGHT_UNIT * bin.heightUnits;
  const feet = bin.base !== 'flat';
  const start = feet ? VASE.start : o.floor;
  // Along the divider axis: the walls run across the other one.
  const along = o.axis === 'x' ? W : D;
  const across = o.axis === 'x' ? D : W;
  const most = Math.max(0, Math.floor(along / VASE.minSection) - 1);
  const n = Math.min(o.dividers, most);
  const dividers = Array.from({ length: n }, (_, i) => round2(-along / 2 + ((i + 1) * along) / (n + 1)));
  const edges = [-along / 2, ...dividers, along / 2];
  const sections = edges.slice(1).map((e, i) => e - edges[i]);
  const gap = round2(VASE.gapLines * o.line);
  const slitLength = across - gap;
  return {
    W,
    D,
    H,
    feet,
    start,
    shell: round2(2 * o.line),
    divider: round2(2 * o.line + VASE.slit),
    dividers,
    sections,
    slit: VASE.slit,
    slitLength,
    gap,
    path: roundedPerimeter(W, D, BASE_TOP_RADIUS) + n * 2 * slitLength,
  };
}

/** How a vase bin prints: where the spiral starts, the wall line it is drawn for and the spiral's path. */
export interface SpiralPrint {
  /** Top of the bottom layers, mm. */
  start: number;
  /** Wall line width, mm. */
  line: number;
  /** Length of one turn of the spiral, mm. */
  path: number;
}

/** The vase bin's spiral, or null for any other bin. */
export function binSpiral(bin: BinOptions, cells?: BinCells | null): SpiralPrint | null {
  const c = activeContainer(bin);
  if (c?.def.kind !== 'vase') return null;
  const o = c.opts as VaseOptions;
  const L = vaseLayout(bin, o, cells ?? undefined);
  return { start: L.start, line: o.line, path: Math.round(L.path * 10) / 10 };
}

/** True for a vase-mode bin. */
export const isVaseBin = (o: Pick<BinOptions, 'container'>) => o.container === 'vase';

/**
 * Bottom layers that end the normal slicing at the spiral's start, for these
 * layer heights: the last one is sliced below it, the first spiral layer above.
 */
export function vaseBottomLayers(start: number, layerHeight = 0.2, firstLayer = layerHeight): number {
  // Layer k (0-based) is sliced at firstLayer + (k - 0.5) · layerHeight (the first at half its height).
  return Math.max(1, Math.floor((start - firstLayer) / layerHeight + 1.5 - 1e-6));
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Inset of the foot's outside from its top outline at height z (the Gridfinity base profile). */
function footInset(z: number): number {
  const { chamfer1, vertical } = BASE_PROFILE;
  if (z <= chamfer1) return BASE_PROFILE_DEPTH - z;
  if (z <= chamfer1 + vertical) return BASE_PROFILE_DEPTH - chamfer1;
  return Math.max(0, BASE_PROFILE_HEIGHT - z);
}

/**
 * The hollow of one foot: the foot's outside inset by the shell, from its
 * floor up to the spiral's start (straight above the foot). Null when the cell
 * is too small for one (it stays solid).
 */
function footHollow(w: Wasm, cx: number, cy: number, hx: number, hy: number, floor: number, shell: number, top: number): Manifold | null {
  const { chamfer1, vertical } = BASE_PROFILE;
  const zs = [floor, chamfer1, chamfer1 + vertical, BASE_PROFILE_HEIGHT, top].filter((z, i, a) => z >= floor - 1e-9 && (i === 0 || z > a[0] + 1e-6));
  const levels = zs.map((z) => {
    const inset = footInset(z) + shell;
    return { z, inset, r: Math.max(0.25, BASE_TOP_RADIUS - inset) };
  });
  if (levels.some((l) => Math.min(hx, hy) - l.inset < l.r + 0.5)) return null;
  const rings: Vec2[][] = levels.map((l) => roundedRectRing(cx - hx + l.inset, cy - hy + l.inset, cx + hx - l.inset, cy + hy - l.inset, l.r));
  return loftRings(
    w,
    rings,
    levels.map((l) => l.z),
  );
}

export function buildVase(w: Wasm, bin: BinOptions, o: VaseOptions, cellsIn: BinCells): MeshData {
  // Vase bins don't stretch over the margin (layout/stretch.ts gives them no room).
  const cells: BinCells = { x: cellsIn.x, y: cellsIn.y, ...(cellsIn.half ? { half: true } : {}) };
  const L = vaseLayout(bin, o, cells);
  const { W, D, H, start } = L;
  const s = new Scope();
  try {
    const R = BASE_TOP_RADIUS;
    const outline = roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, R);
    // The dividers' walls (two lines and the slit), full length, kept out of everything hollow.
    const half = L.divider / 2;
    const walls = L.dividers.map((p) =>
      s.t(o.axis === 'x' ? boxAt(w, p - half, -D / 2 - 1, -1, p + half, D / 2 + 1, H + 2) : boxAt(w, -W / 2 - 1, p - half, -1, W / 2 + 1, p + half, H + 2)),
    );
    // Above the start, one line of wall all round.
    const ln = o.line;
    const inside = roundedRectRing(-W / 2 + ln, -D / 2 + ln, W / 2 - ln, D / 2 - ln, Math.max(0.25, R - ln));
    const hollows: Manifold[] = [s.t(extrudePolygon(w, inside, start, H + 1))];
    let body: Manifold;
    let keep = walls;
    if (L.feet) {
      body = s.t(w.Manifold.union([...buildFeet(w, s, bin, cells), s.t(extrudePolygon(w, outline, BASE_PROFILE_HEIGHT, H))]));
      // Below it, hollow feet with solid floors, joined by walls along the cell lines; bosses keep the holes closed.
      const gap = GRID - BASE_TOP;
      for (const c of cellRects(cells)) {
        const m = footHollow(w, c.cx, c.cy, (c.cw - gap) / 2, (c.cd - gap) / 2, o.floor, L.shell, start + 0.5);
        if (m) hollows.push(s.t(m));
      }
      keep = [...walls, ...holeBosses(w, s, bin, binHoleSites(bin, cells), start, L.shell)];
    } else {
      body = s.t(extrudePolygon(w, outline, 0, H));
    }
    let hollow = s.t(w.Manifold.union(hollows));
    if (keep.length) hollow = s.t(hollow.subtract(s.t(w.Manifold.union(keep))));
    body = s.t(body.subtract(hollow));

    // Divider slits down the middle of their walls, in from the back (or right) wall, from the spiral's start up through the top.
    const hs = L.slit / 2;
    const slits = L.dividers.map((p) =>
      s.t(o.axis === 'x' ? boxAt(w, p - hs, -D / 2 + L.gap, start, p + hs, D / 2 + 1, H + 1) : boxAt(w, -W / 2 + L.gap, p - hs, start, W / 2 + 1, p + hs, H + 1)),
    );
    if (slits.length) body = s.t(body.subtract(s.t(w.Manifold.union(slits))));

    const holes = holeCutters(w, s, bin, binHoleSites(bin, cells));
    if (holes.length) body = s.t(body.subtract(s.t(w.Manifold.union(holes))));
    assertValid(body, 'vase bin');
    return toMeshData(body);
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const VASE_CONTAINER: ContainerDef<VaseOptions> = {
  kind: 'vase',
  label: 'Vase-mode bin',
  description: 'Prints in spiral vase mode: solid bottom layers, then one continuous wall. Minutes per bin and very little filament; dividers are folds of the wall.',
  defaults: DEFAULT_VASE,
  sanitize: (raw) => sanitizeVase(raw),
  key: vaseKey,
  height: (bin) => HEIGHT_UNIT * bin.heightUnits,
  build: (w, bin, o, cells) => buildVase(w, bin, o, cells),
  summary(bin, o, cells) {
    const L = vaseLayout(bin, o, cells);
    return L.dividers.length ? `${L.dividers.length + 1} sections` : '';
  },
  notes(bin, o, cells) {
    const L = vaseLayout(bin, o, cells);
    const out: string[] = [];
    if (L.dividers.length < o.dividers) out.push(`only ${L.dividers.length} dividers fit (sections at least ${VASE.minSection} mm).`);
    return out;
  },
};

registerContainer(VASE_CONTAINER);
