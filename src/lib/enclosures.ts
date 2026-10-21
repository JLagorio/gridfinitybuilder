/**
 * Things around the baseplate: a printed carry case (geometry/case.ts), a wall
 * grid (geometry/wallmount.ts) and spacer strips (geometry/spacers.ts).
 *
 * `planEnclosure` is what `planPrint` asks for each drawer. It returns null
 * for a plain drawer, so those plan exactly as before. Otherwise it says what
 * the floor pieces are split on and built with (a case floor is the case
 * body), what each piece adds (walls, holes, sockets), the extra printed parts
 * (lid, pins, handle, feet, strips, wall cleat), and what the drawer view
 * draws. Everything in the specs is plain data, built by the geometry worker.
 */
import { Scope, assertValid, toMeshData, type MeshData, type Vec3, type Wasm } from './geometry/kernel';
import {
  baseplateFloor,
  baseplateHeight,
  binSeatHeight,
  buildBaseplatePiece,
  type BaseplateOptions,
} from './geometry/baseplate';
import { connectorKeySize, pieceProtrusion, puzzleTabTop, type ConnectorSite } from './geometry/connectors';
import { pieceIsVoid } from './geometry/mask';
import { binLabel, binTotalHeight } from './geometry/bin';
import { hasLid, lidStackHeight } from './geometry/lid';
import { boxAt } from './geometry/shapes';
import { buildSolid, type SolidDef } from './geometry/solids';
import {
  CASE,
  CASE_REACH,
  LID_OPEN_DEG,
  PIN_LENGTH,
  bodyBounds,
  buildCaseBodySolid,
  buildCaseLidSolid,
  buildFootSolid,
  buildHandleSolid,
  buildHingePinSolid,
  caseFrame,
  caseGeom,
  footSize,
  handleBounds,
  handleSize,
  lidBounds,
  meshAt,
  meshAtMin,
  pinBounds,
  rotatedBounds,
  sanitizeCase,
  seamsOf,
  type Box3,
  type CaseGeom,
} from './geometry/case';
import {
  WALL,
  buildCleatStrip,
  cleatBand,
  cleatGrooveCut,
  holeLines,
  mountHoleCuts,
  mountHoleReach,
  planCleatStrips,
  sanitizeWall,
  wallFloorNeed,
  type CleatStrip,
  type WallOptions,
} from './geometry/wallmount';
import { SPACER, buildSpacerSegment, planSpacerStrips, sanitizeSpacers, spacerBounds, spacerSocketCuts, type SpacerSegment } from './geometry/spacers';
import { spacerMargins, type DrawerInput, type GridLayout } from './layout/drawer';
import { packPlates, type PlateLayout } from './layout/pack';
import { pieceFootprint, planBaseplate, type BaseplatePlan, type PrintSetup } from './layout/plan';
import type { PieceDef } from './layout/split';
import type { BinOptions } from './geometry/bin';

export type EnclosureKind = 'case' | 'wall' | 'spacers';

/** A line of the bill of materials. */
export interface EnclosureHardware {
  item: string;
  count: number;
  note?: string;
}

/**
 * What an enclosure adds to one floor piece (MeshSpec 'piece' `enclosure`):
 * extra cuts, the mesh's min corner (it can reach past the piece's outline),
 * and the hardware it takes.
 */
export type PieceEnclosure = { origin: Vec3; cuts: SolidDef[]; hardware?: EnclosureHardware[] } & (
  | { kind: 'case'; geom: CaseGeom }
  | { kind: 'wall'; ledge: { x0: number; x1: number; y0: number; y1: number; z1: number } | null }
  | { kind: 'spacers' }
);

/** Extra printed parts (MeshSpec 'enclosure'). */
export type EnclosurePart =
  | { kind: 'lid'; geom: CaseGeom; piece: PieceDef }
  | { kind: 'pin' }
  | { kind: 'handle'; geom: CaseGeom; half: -1 | 0 | 1 }
  | { kind: 'foot' }
  | { kind: 'spacer'; seg: SpacerSegment; plateW: number; plateD: number }
  | { kind: 'cleat'; strip: CleatStrip };

export type EnclosurePartKind = EnclosurePart['kind'];

/** A view-only pose (drawer view): assembled, optionally opened about the case's hinge, `origin` moved to 0. */
export interface EnclosureView {
  open?: number;
  origin: Vec3;
}

/** One extra part of the job. Keys and mesh keys are without the drawer prefix. */
export interface EnclosurePartPlan {
  key: string;
  name: string;
  /** Lid keys count as connector keys; everything else is an enclosure part. */
  kind: 'enclosure' | 'key';
  part?: EnclosurePart;
  meshKey: string;
  w: number;
  d: number;
  h: number;
  /** Plate name for the plates it prints on. */
  group: string;
}

/** What the drawer view draws, in the grid's plate coordinates. */
export interface EnclosureSceneItem {
  id: string;
  meshKey: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  role: 'lid' | 'hardware' | 'handle' | 'foot' | 'strip' | 'cleat';
  /** Shown with the lid closed, open, or always. */
  when: 'closed' | 'open' | 'always';
  /** Which piece's column / row it spreads with. */
  col?: number;
  row?: number;
}

export interface EnclosureScene {
  kind: EnclosureKind;
  /** Floor pieces: where each piece's mesh min corner sits (plate coordinates), by piece id. */
  pieceAt: Record<number, Vec3>;
  items: EnclosureSceneItem[];
  /** The grid's place in the drawer outline (spacer strips push it in from the walls). */
  shift: { x: number; y: number };
  /** Draw the bins in the drawer tab too (a case shows them inside it). */
  showBins: boolean;
  /** Draw the drawer's outline (not for a case: it is its own box). */
  outline: boolean;
  /** Top of the floor: where bin feet sit. */
  seat: number;
  /** Case outline in plate coordinates. */
  box?: { x0: number; y0: number; x1: number; y1: number; h: number };
  /** For the sidebar. */
  info: {
    /** Case: wall top, room above the floor, pieces, hinges, latches, lid keys. */
    wallTop?: number;
    room?: number;
    pieces?: number;
    hinges?: number;
    latches?: number;
    lidKeys?: number;
    /** How a split case's floor joins. */
    joints?: BaseplateOptions['connector'];
    /** Wall grid: mounting holes, and whether the cleat groove made it. */
    holes?: number;
    cleat?: boolean;
    floor?: number;
    /** Spacer strips: one line per strip. */
    strips?: { side: 'left' | 'right' | 'front' | 'back'; width: number; pieces: number }[];
  };
}

export interface EnclosurePlan {
  kind: EnclosureKind;
  /** What the floor pieces are split on (a case's has its walls as margin) and built with. */
  pieceLayout: GridLayout;
  baseplate: BaseplateOptions;
  plan: BaseplatePlan;
  /** Per piece: what it adds, its printed size and name (null: a plain baseplate piece). */
  piece(p: PieceDef): { enclosure: PieceEnclosure; w: number; d: number; h: number; name: string } | null;
  parts: EnclosurePartPlan[];
  /** View-only meshes (closed and open lid, upright handle). */
  views: { meshKey: string; part: EnclosurePart; view: EnclosureView }[];
  steps: string[];
  warnings: string[];
  /** Room above the bin seat (for "taller than" warnings); Infinity when the planner warns itself. */
  room: number;
  scene: EnclosureScene;
}

/** Bed size left for a piece that reaches `reach` past its outline (as planBaseplate sees it). */
const shrunkBed = (setup: PrintSetup, reach: number): PrintSetup => ({ ...setup, bedW: setup.bedW - reach, bedD: setup.bedD - reach });

const r1 = (v: number) => Math.round(v * 10) / 10;
const sizeOf = (b: Box3) => ({ w: b.max[0] - b.min[0], d: b.max[1] - b.min[1], h: b.max[2] - b.min[2] });

/** Plates for the floor pieces, packed with their true printed footprints. */
function packPieces(pieces: PieceDef[], size: (p: PieceDef) => { w: number; d: number }, setup: PrintSetup): PlateLayout[] {
  return packPlates(
    pieces.map((p) => ({ key: `piece:${p.id}`, ...size(p) })),
    { bedW: setup.bedW, bedD: setup.bedD, margin: setup.plateMargin, spacing: setup.spacing, nest: setup.nest },
  ).plates;
}

/** The enclosure plan for a drawer, or null for a plain drawer. */
export function planEnclosure(
  d: { drawer: DrawerInput; baseplate: BaseplateOptions; bins: { opts: BinOptions }[] },
  layout: GridLayout,
  setup: PrintSetup,
): EnclosurePlan | null {
  if (d.drawer.enclosure === 'case') return planCase(d, layout, setup);
  if (d.drawer.enclosure === 'wall') return planWall(d, layout, setup);
  if (spacerMargins(d.drawer)) return planSpacers(d, layout, setup);
  return null;
}

/** Tallest bin above its seat (a stacking lid included). */
function tallestBin(bins: { opts: BinOptions }[]): number {
  let top = 0;
  for (const b of bins) top = Math.max(top, binTotalHeight(b.opts), hasLid(b.opts) ? lidStackHeight(b.opts) : 0);
  return top;
}

// ---------------------------------------------------------------------------
// Carry case
// ---------------------------------------------------------------------------

function planCase(d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  const c = sanitizeCase(d.drawer.carryCase);
  const frame = caseFrame(layout, c, d.baseplate, tallestBin(d.bins));
  const cl = frame.layout;
  const protrude = pieceProtrusion(frame.baseplate);
  const reach = Math.max(2 * CASE_REACH.lidSide, CASE_REACH.lidFront + CASE_REACH.lidBack, CASE_REACH.bodyFront + CASE_REACH.bodyBack);
  const split = planBaseplate(cl, shrunkBed(setup, reach), { protrude });
  const seams = seamsOf(split.pieces);
  const g = caseGeom(frame, c, seams.x, seams.y);
  const off = frame.off;
  const warnings: string[] = [];
  if (split.error) warnings.push(split.error.replace('baseplate', 'case'));

  const bodyBox = (p: PieceDef): Box3 => {
    const b = bodyBounds(g, p);
    // Puzzle tabs stick out past the right / back seams.
    return { min: b.min, max: [b.max[0] + (p.outer.right ? 0 : protrude), b.max[1] + (p.outer.back ? 0 : protrude), b.max[2]] };
  };
  const plan: BaseplatePlan = { ...split, plates: packPieces(split.pieces, (p) => sizeOf(bodyBox(p)), setup) };
  const many = split.pieces.length > 1;
  // A split case needs its floor joined: bowtie keys unless another connector is picked.
  const bp = many && frame.baseplate.connector === 'none' ? { ...frame.baseplate, connector: 'bowtie' as const } : frame.baseplate;

  const parts: EnclosurePartPlan[] = [];
  const views: EnclosurePlan['views'] = [];
  const items: EnclosureSceneItem[] = [];
  const pieceAt: Record<number, Vec3> = {};
  const toPlate = (v: Vec3): Vec3 => [v[0] - off, v[1] - off, v[2]];
  for (const p of split.pieces) pieceAt[p.id] = toPlate(bodyBox(p).min);

  // Nothing fits the bed: no body, so nothing else either.
  if (!split.pieces.length) {
    return {
      kind: 'case',
      pieceLayout: cl,
      baseplate: bp,
      plan,
      piece: () => null,
      parts: [],
      views: [],
      steps: [],
      warnings: warnings.length ? warnings : ['The case could not be split to fit this bed.'],
      room: Infinity,
      scene: { kind: 'case', pieceAt, items: [], shift: { x: 0, y: 0 }, showBins: true, outline: false, seat: g.seat, info: {} },
    };
  }
  // Lid pieces: printed upside down; drawn closed or open.
  for (const p of split.pieces) {
    const part: EnclosurePart = { kind: 'lid', geom: forLid(g), piece: p };
    const meshKey = `caselid|${JSON.stringify(part)}`;
    const box = lidBounds(g, p);
    const size = sizeOf(box);
    parts.push({ key: `lid:${p.id}`, name: many ? `Case lid piece ${p.id}` : 'Case lid', kind: 'enclosure', part, meshKey, w: size.w, d: size.d, h: size.h, group: 'Case lid' });
    for (const open of [undefined, LID_OPEN_DEG]) {
      const b = open === undefined ? box : rotatedBounds(g, box, open);
      const view: EnclosureView = open === undefined ? { origin: b.min } : { open, origin: b.min };
      const vk = `${meshKey}|view${JSON.stringify(view)}`;
      views.push({ meshKey: vk, part, view });
      const at = toPlate(b.min);
      const s = sizeOf(b);
      items.push({ id: `case-lid-${p.id}-${open ? 'open' : 'closed'}`, meshKey: vk, x: at[0], y: at[1], z: at[2], ...s, role: 'lid', when: open ? 'open' : 'closed', col: p.col, row: p.row });
    }
  }
  // Lid keys across the lid seams (the baseplate's bowtie keys).
  const keySize = connectorKeySize();
  g.lidKeys.forEach((_, i) => {
    parts.push({ key: `lidkey:${i + 1}`, name: `Lid key ${i + 1}`, kind: 'key', meshKey: 'key|bowtie', ...keySize, group: 'Case lid' });
  });
  // Hinge pins (printed flat; drawn in their knuckles).
  const pinMesh = `casepin|${JSON.stringify({ L: PIN_LENGTH, ...CASE.hinge })}`;
  g.hinges.forEach((xh, i) => {
    const b = pinBounds(g, xh);
    const s = sizeOf(b);
    parts.push({ key: `pin:${i + 1}`, name: `Hinge pin ${i + 1}`, kind: 'enclosure', part: { kind: 'pin' }, meshKey: pinMesh, w: s.w, d: s.d, h: s.h, group: 'Case lid' });
    const at = toPlate(b.min);
    items.push({ id: `case-pin-${i}`, meshKey: pinMesh, x: at[0], y: at[1], z: at[2], ...s, role: 'hardware', when: 'always' });
  });
  // Handle.
  let handleNote = '';
  if (g.handle !== 'none') {
    const usable = Math.max(setup.bedW, setup.bedD) - 2 * setup.plateMargin;
    const hs = handleSize(g);
    const halves = hs.w > usable + 1e-6;
    const hb = handleBounds(g);
    const label = g.handle === 'arch' ? 'Handle' : 'Fold-down handle';
    for (const half of halves ? ([-1, 1] as const) : ([0] as const)) {
      const part: EnclosurePart = { kind: 'handle', geom: forHandle(g), half };
      const meshKey = `casehandle|${JSON.stringify(part)}`;
      const w = halves ? hs.w / 2 + 7 : hs.w;
      parts.push({
        key: `handle:${half === 0 ? 1 : half < 0 ? 1 : 2}`,
        name: half === 0 ? label : `${label}, ${half < 0 ? 'left' : 'right'} half`,
        kind: 'enclosure',
        part,
        meshKey,
        w,
        d: hs.d,
        h: hs.h,
        group: 'Handle',
      });
      for (const open of [undefined, LID_OPEN_DEG]) {
        const box: Box3 = half === 0 ? hb : half < 0 ? { min: hb.min, max: [g.W / 2 + 7, hb.max[1], hb.max[2]] } : { min: [g.W / 2, hb.min[1], hb.min[2]], max: hb.max };
        const b = open === undefined ? box : rotatedBounds(g, box, open);
        const view: EnclosureView = open === undefined ? { origin: b.min } : { open, origin: b.min };
        const vk = `${meshKey}|view${JSON.stringify(view)}`;
        views.push({ meshKey: vk, part, view });
        const at = toPlate(b.min);
        items.push({ id: `case-handle-${half}-${open ? 'open' : 'closed'}`, meshKey: vk, x: at[0], y: at[1], z: at[2], ...sizeOf(b), role: 'handle', when: open ? 'open' : 'closed' });
      }
    }
    if (halves) handleNote = 'The handle is wider than the bed: glue its two halves together at the dovetail in the grip.';
  }
  // Printed feet.
  if (g.feet === 'printed') {
    const f = footSize();
    g.footAt.forEach(([x, y], i) => {
      parts.push({ key: `foot:${i + 1}`, name: `Foot ${i + 1} (TPU)`, kind: 'enclosure', part: { kind: 'foot' }, meshKey: `casefoot|${f.d}|${f.h}`, w: f.d, d: f.d, h: f.h, group: 'Feet' });
      items.push({
        id: `case-foot-${i}`,
        meshKey: `casefoot|${f.d}|${f.h}`,
        x: x - f.d / 2 - off,
        y: y - f.d / 2 - off,
        z: -CASE.foot.proud,
        w: f.d,
        d: f.d,
        h: f.h,
        role: 'foot',
        when: 'always',
      });
    });
  }

  // Warnings: bins that don't fit, a case that's too big, a body that's too tall to print.
  const room = g.wallTop - g.seat;
  for (const b of d.bins) {
    const top = Math.max(binTotalHeight(b.opts), hasLid(b.opts) ? lidStackHeight(b.opts) : 0);
    if (top > room + 1e-6) warnings.push(`Bin ${binLabel(b.opts)} is taller than the case (${r1(room)} mm of room above the floor).`);
  }
  if (g.W > 450 || g.D > 450 || g.lidTop > 250)
    warnings.push(`The case is ${r1(g.W)} × ${r1(g.D)} × ${r1(g.lidTop)} mm: bigger than is practical to carry. A smaller grid or several cases will be lighter and stiffer.`);
  if (g.wallTop + CASE.hinge.r > setup.maxH) warnings.push('The case body is taller than the printer allows.');

  const steps: string[] = [];
  if (many) {
    steps.push(
      `Case: ${split.pieces.length} body pieces and ${split.pieces.length} lid pieces, numbered alike.${
        frame.baseplate.connector === 'none' ? ' The floor joins with bowtie keys (pick another connector under Baseplate).' : ''
      }`,
      'Join the body pieces with the floor joints, and glue the wall seams for a stiff case.',
      g.lidKeys.length ? `Press the ${g.lidKeys.length} lid keys into the pockets in the ribs under the lid's seams.` : 'Glue the lid pieces along their seams.',
    );
  }
  steps.push(
    `Hinges: close the lid, line up the knuckles and push a pin through each of the ${g.hinges.length} hinges until its barbs click past the far knuckle.`,
    `Latches: ${g.latches.length}. Press the lid down and the hooks click under the ridges; pull the tab out to open.`,
  );
  if (handleNote) steps.push(handleNote);
  if (g.handle !== 'none') steps.push(`Handle: spread the bail and snap it over the ${g.handle === 'arch' ? 'diamond pegs (it stays upright)' : 'round pegs (it folds down)'} on the lid's sides.`);
  if (g.feet === 'bumpers') steps.push('Feet: stick four 10 mm rubber bumpers into the recesses under the corners.');
  if (g.feet === 'printed') steps.push('Feet: press (or glue) the four printed feet into the recesses under the corners. TPU grips best.');

  return {
    kind: 'case',
    pieceLayout: cl,
    baseplate: bp,
    plan,
    piece: (p) => {
      const b = bodyBox(p);
      const size = sizeOf(b);
      const feet = g.footAt.filter(([x, y]) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1).length;
      const hardware = g.feet === 'bumpers' && feet ? [{ item: 'Rubber bumpers 10 mm, self-adhesive (case feet)', count: feet }] : undefined;
      const enclosure: PieceEnclosure = { kind: 'case', geom: forBody(g), origin: b.min, cuts: [], ...(hardware ? { hardware } : {}) };
      return { enclosure, ...size, name: many ? `Case body piece ${p.id}` : 'Case body' };
    },
    parts,
    views,
    steps,
    warnings,
    room: Infinity,
    scene: {
      kind: 'case',
      pieceAt,
      items,
      shift: { x: 0, y: 0 },
      showBins: true,
      outline: false,
      seat: g.seat,
      box: { x0: -off, y0: -off, x1: g.W - off, y1: g.D - off, h: g.lidTop },
      info: {
        wallTop: g.wallTop,
        room,
        pieces: split.pieces.length,
        hinges: g.hinges.length,
        latches: g.latches.length,
        lidKeys: g.lidKeys.length,
        joints: many ? bp.connector : undefined,
      },
    },
  };
}

/** Only what each part's geometry uses, so its mesh key changes only when its geometry does. */
function forBody(g: CaseGeom): CaseGeom {
  return { ...g, handle: 'none', pegY: 0, pegZ: 0, label: '', labelSize: 0, lidKeys: [] };
}
function forLid(g: CaseGeom): CaseGeom {
  return { ...g, seat: 0, chamfer: 0, feet: 'none', footAt: [] };
}
function forHandle(g: CaseGeom): CaseGeom {
  return { ...forLid(g), hinges: [], latches: [], label: '', labelSize: 0, lidKeys: [], cav: { x0: 0, y0: 0, x1: 0, y1: 0, r: 0 } };
}

// ---------------------------------------------------------------------------
// Wall grid
// ---------------------------------------------------------------------------

function wallBaseplate(o: BaseplateOptions, wo: WallOptions): BaseplateOptions {
  const need = wallFloorNeed(wo, o.magnets ? o.magnetHeight + 0.2 : 0);
  const f = baseplateFloor(o);
  return need > f + 1e-6 ? { ...o, bottomPad: o.bottomPad + (need - f) } : o;
}

/** Mounting hole positions on a piece (plate coordinates), clear of the cleat groove. */
export function wallHoles(layout: GridLayout, p: PieceDef, wo: WallOptions, band: ReturnType<typeof cleatBand> | null): [number, number][] {
  if (wo.mount === 'none') return [];
  const xs = holeLines(layout.xs, p.cells.x0, p.cells.x1, wo.every);
  let ys = holeLines(layout.ys, p.cells.y0, p.cells.y1, wo.every);
  if (band) {
    const k = mountHoleReach(wo);
    const clear = (y: number) => y + k.up + k.r < band.y0 - 1 || y - k.r > band.yTop + band.depth + 1;
    ys = ys.filter(clear);
  }
  const out: [number, number][] = [];
  for (const x of xs) for (const y of ys) out.push([x, y]);
  return out;
}

function planWall(d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  const wo = sanitizeWall(d.drawer.wallMount);
  const bp = wallBaseplate(d.baseplate, wo);
  const protrude = pieceProtrusion(bp);
  const pf = wo.ledge ? Math.max(0, WALL.ledge - layout.margins.front) : 0;
  const split = planBaseplate(layout, shrunkBed(setup, pf), { protrude, skip: (p) => pieceIsVoid(layout, p) });
  const warnings: string[] = [];
  if (split.error) warnings.push(split.error);
  const floor = baseplateFloor(bp);
  const top = baseplateHeight(bp);
  let band = wo.cleat ? cleatBand(layout.plateD) : null;
  if (band && band.y0 < 10) {
    warnings.push('The wall grid is too short for a French cleat, so it has none.');
    band = null;
  }
  if (band && split.pieces.some((p) => p.y0 > band!.y0 - 1 && p.y0 < band!.yTop + band!.depth + 1))
    warnings.push('A seam crosses the French-cleat groove: each piece in the top row hangs on its own length of groove, the rest needs screws.');
  if (!d.baseplate.magnets) warnings.push('Wall grid without magnet pockets: bins can fall out. Turn on Magnet pockets, and give the bins magnets too.');
  if (band && bp.magnets && bp.magnetSide === 'bottom') warnings.push('Load the magnets from the top: bottom pockets in the French-cleat groove would be cut open.');
  const loose = d.bins.filter((b) => b.opts.base === 'flat' || !['magnets', 'both', 'refined'].includes(String(b.opts.holes ?? 'none'))).length;
  if (loose && d.baseplate.magnets && !layout.halfGrid)
    warnings.push(`${loose} bin${loose === 1 ? ' has' : 's have'} no magnets in ${loose === 1 ? 'its' : 'their'} feet and will fall off the wall (Bins tab → Base & holes → magnets).`);
  if (layout.halfGrid && d.baseplate.magnets) warnings.push('21 mm half cells have no room for magnets: on a half-grid wall grid, rely on the ledge and keep bins light.');

  const ledgeFor = (p: PieceDef) =>
    wo.ledge && p.outer.front ? { x0: p.x0, x1: p.x1, y0: layout.originY - WALL.ledge, y1: layout.originY + 0.01, z1: top + wo.ledgeHeight } : null;
  const footprint = (p: PieceDef) => {
    const f = pieceFootprint(p, protrude);
    return { w: f.w, d: f.d + (p.outer.front ? pf : 0) };
  };
  const plan: BaseplatePlan = pf ? { ...split, plates: packPieces(split.pieces, footprint, setup) } : split;
  let holes = 0;
  const pieceAt: Record<number, Vec3> = {};
  for (const p of split.pieces) pieceAt[p.id] = [p.x0, p.y0 - (p.outer.front ? pf : 0), 0];

  const parts: EnclosurePartPlan[] = [];
  const items: EnclosureSceneItem[] = [];
  if (band) {
    const maxLen = Math.max(setup.bedW, setup.bedD) - 2 * setup.plateMargin;
    planCleatStrips(layout.plateW, band, maxLen, wo).forEach((strip, i, all) => {
      const part: EnclosurePart = { kind: 'cleat', strip };
      const meshKey = `wallcleat|${JSON.stringify(strip)}`;
      const s = { w: strip.x1 - strip.x0, d: strip.height, h: strip.depth };
      parts.push({ key: `cleat:${i + 1}`, name: all.length > 1 ? `Wall cleat ${i + 1}` : 'Wall cleat', kind: 'enclosure', part, meshKey, ...s, group: 'Wall cleat' });
      items.push({ id: `wall-cleat-${i}`, meshKey, x: strip.x0, y: strip.y0, z: 0, ...s, role: 'cleat', when: 'always' });
    });
  }
  for (const p of split.pieces) holes += wallHoles(layout, p, wo, band).length;

  const steps: string[] = ['Wall grid: the back of the layout is the top on the wall.'];
  if (wo.mount === 'countersunk' && holes) steps.push(`Screw it up with ${holes} × ⌀${wo.screwDiameter} countersunk screws through the holes at the cell corners.`);
  if (wo.mount === 'keyhole' && holes)
    steps.push(`Set ${holes} × ⌀${wo.screwDiameter} pan-head screws in the wall where the keyholes go, standing ${WALL.keyBack} mm proud; hang the plate on them and let it drop.`);
  if (band) steps.push('French cleat: screw the cleat to the wall, slope up and toward the wall, then hook the plate over it.');
  steps.push('Bins need magnets in their feet (Bins tab: holes → magnets) to stay on a wall.');
  if (wo.ledge) steps.push('The ledge along the bottom edge keeps the bottom row from tipping out; bins above rest on the row below.');

  return {
    kind: 'wall',
    pieceLayout: layout,
    baseplate: bp,
    plan,
    piece: (p) => {
      const at = wallHoles(layout, p, wo, band);
      const cuts: SolidDef[] = at.flatMap(([x, y]) => mountHoleCuts(wo, x, y, floor, top));
      if (band && p.y1 > band.y0 && p.y0 < band.yTop + band.depth) cuts.push(cleatGrooveCut(band, p.x0, p.x1));
      const ledge = ledgeFor(p);
      if (!cuts.length && !ledge) return null;
      const f = footprint(p);
      const screw = wo.mount === 'keyhole' ? `Pan-head screws ⌀${wo.screwDiameter} (wall grid keyholes)` : `Countersunk screws ⌀${wo.screwDiameter} (wall grid)`;
      const hardware = at.length ? [{ item: screw, count: at.length, note: 'into the wall: pick the length for it' }] : undefined;
      return {
        enclosure: { kind: 'wall', origin: pieceAt[p.id], cuts, ledge, ...(hardware ? { hardware } : {}) },
        w: f.w,
        d: f.d,
        h: ledge ? ledge.z1 : top,
        name: `Wall grid piece ${p.id}`,
      };
    },
    parts,
    views: [],
    steps,
    warnings,
    room: Infinity,
    scene: {
      kind: 'wall',
      pieceAt,
      items,
      shift: { x: 0, y: 0 },
      showBins: false,
      outline: true,
      seat: binSeatHeight(bp),
      info: { holes, cleat: !!band, floor },
    },
  };
}

// ---------------------------------------------------------------------------
// Spacer strips
// ---------------------------------------------------------------------------

function planSpacers(d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  const sm = spacerMargins(d.drawer)!;
  const so = sanitizeSpacers(d.drawer.spacers);
  const bp = d.baseplate;
  const protrude = pieceProtrusion(bp);
  const plan = planBaseplate(layout, setup, { protrude, skip: (p) => pieceIsVoid(layout, p) });
  const warnings: string[] = [];
  if (plan.error) warnings.push(plan.error);
  const seams = seamsOf(plan.pieces);
  const usable = Math.max(setup.bedW, setup.bedD) - 2 * setup.plateMargin;
  const segs = !plan.pieces.length ? [] : planSpacerStrips({
    margins: sm,
    plateW: layout.plateW,
    plateD: layout.plateD,
    xs: layout.xs,
    ys: layout.ys,
    seamsX: seams.x,
    seamsY: seams.y,
    maxLen: usable,
    height: baseplateHeight(bp),
    tabTop: puzzleTabTop(baseplateFloor(bp), bp),
    opts: so,
    tabStep: layout.halfGrid ? 4 : 2,
  });
  const thin = (['left', 'right', 'front', 'back'] as const).filter((k) => sm[k] > 0.05 && sm[k] < SPACER.minWidth);
  if (thin.length) warnings.push(`Gaps under ${SPACER.minWidth} mm get no spacer strip (${thin.join(', ')}): they're just clearance.`);

  const parts: EnclosurePartPlan[] = [];
  const items: EnclosureSceneItem[] = [];
  const SIDE = { left: 'Left', right: 'Right', front: 'Front', back: 'Back' } as const;
  for (const seg of segs) {
    const part: EnclosurePart = { kind: 'spacer', seg, plateW: layout.plateW, plateD: layout.plateD };
    const meshKey = `spacer|${JSON.stringify(part)}`;
    const b = spacerBounds(seg);
    const s = { w: b.x1 - b.x0, d: b.y1 - b.y0, h: b.h };
    const n = seg.count > 1 ? ` ${seg.index + 1}/${seg.count}` : '';
    parts.push({
      key: `spacer:${seg.side}:${seg.index + 1}`,
      name: `${SIDE[seg.side]} spacer strip${n} (${r1(seg.side === 'left' || seg.side === 'right' ? seg.x1 - seg.x0 : seg.y1 - seg.y0)} mm)`,
      kind: 'enclosure',
      part,
      meshKey,
      ...s,
      group: 'Spacer strips',
    });
    items.push({ id: `spacer-${seg.side}-${seg.index}`, meshKey, x: b.x0, y: b.y0, z: 0, ...s, role: 'strip', when: 'always' });
  }
  const steps: string[] = [];
  if (segs.length) {
    steps.push(
      `Spacer strips: ${segs.length}. Left and right ones run front to back; front and back ones fit between them.`,
      segs.some((s) => s.tongue) ? 'Slide the lengths of each strip together at their dovetails, and lay the strips against the drawer walls.' : 'Lay the strips against the drawer walls.',
    );
    if (segs.some((s) => s.tabs.length)) steps.push("Lower the baseplate in between, so the sockets under its edge drop over the strips' tabs.");
  }
  const pieceAt: Record<number, Vec3> = {};
  for (const p of plan.pieces) pieceAt[p.id] = [p.x0, p.y0, 0];
  const onEdge = (p: PieceDef, seg: SpacerSegment) => {
    if (seg.side === 'left' && p.outer.left) return seg.tabs.filter((t) => t > p.y0 && t < p.y1);
    if (seg.side === 'right' && p.outer.right) return seg.tabs.filter((t) => t > p.y0 && t < p.y1);
    if (seg.side === 'front' && p.outer.front) return seg.tabs.filter((t) => t > p.x0 && t < p.x1);
    if (seg.side === 'back' && p.outer.back) return seg.tabs.filter((t) => t > p.x0 && t < p.x1);
    return [];
  };
  return {
    kind: 'spacers',
    pieceLayout: layout,
    baseplate: bp,
    plan,
    piece: (p) => {
      const cuts = segs.flatMap((seg) => spacerSocketCuts({ ...seg, tabs: onEdge(p, seg) }, layout.plateW, layout.plateD));
      if (!cuts.length) return null;
      const f = pieceFootprint(p, protrude);
      return { enclosure: { kind: 'spacers', origin: [p.x0, p.y0, 0], cuts }, ...f, h: baseplateHeight(bp), name: `Baseplate piece ${p.id}` };
    },
    parts,
    views: [],
    steps,
    warnings,
    room: d.drawer.height > 0 ? d.drawer.height - binSeatHeight(bp) : Infinity,
    scene: {
      kind: 'spacers',
      pieceAt,
      items,
      shift: { x: sm.left, y: sm.front },
      showBins: false,
      outline: true,
      seat: binSeatHeight(bp),
      info: {
        strips: (['left', 'right', 'front', 'back'] as const).flatMap((side) => {
          const n = segs.filter((g) => g.side === side).length;
          return n ? [{ side, width: sm[side], pieces: n }] : [];
        }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Building (geometry worker)
// ---------------------------------------------------------------------------

/** A floor piece with its enclosure additions, its mesh min corner at the origin. */
export function buildEnclosurePiece(
  w: Wasm,
  layout: GridLayout,
  piece: PieceDef,
  o: BaseplateOptions,
  connectors: ConnectorSite[],
  e: PieceEnclosure,
): MeshData {
  const s = new Scope();
  try {
    if (e.kind === 'case') return meshAt(buildCaseBodySolid(w, s, layout, piece, o, connectors, e.geom), e.origin, `case body ${piece.id}`);
    const mesh = buildBaseplatePiece(w, layout, piece, o, connectors, e.cuts);
    if (e.kind === 'wall' && e.ledge) {
      const m = s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
      const L = e.ledge;
      const all = s.t(m.add(s.t(boxAt(w, L.x0, L.y0, 0, L.x1, L.y1, L.z1))));
      return meshAt(all, e.origin, `wall grid piece ${piece.id}`);
    }
    const m = s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
    return meshAt(m, e.origin, `baseplate piece ${piece.id}`);
  } finally {
    s.dispose();
  }
}

/** An extra part: as printed (min corner at the origin), or posed for the drawer view. */
export function buildEnclosurePart(w: Wasm, part: EnclosurePart, view?: EnclosureView): MeshData {
  const s = new Scope();
  try {
    switch (part.kind) {
      case 'lid':
      case 'handle': {
        const solid = part.kind === 'lid' ? buildCaseLidSolid(w, s, part.geom, part.piece) : buildHandleSolid(w, s, part.geom, part.half);
        const what = part.kind === 'lid' ? `case lid ${part.piece.id}` : 'handle';
        if (!view) return meshAtMin(s.t(solid.rotate([part.kind === 'lid' ? 180 : 90, 0, 0])), what);
        const g = part.geom;
        let posed = solid;
        if (view.open) {
          const a = s.t(solid.translate([0, -g.axisY, -g.axisZ]));
          const b = s.t(a.rotate([view.open, 0, 0]));
          posed = s.t(b.translate([0, g.axisY, g.axisZ]));
        }
        return meshAt(posed, view.origin, what);
      }
      case 'pin':
        return meshAt(buildHingePinSolid(w, s), [0, 0, 0], 'hinge pin');
      case 'foot':
        return meshAt(s.t(buildFootSolid(w)), [0, 0, 0], 'foot');
      case 'spacer':
        return buildSpacerSegment(w, part.seg, part.plateW, part.plateD);
      case 'cleat':
        return buildCleatStrip(w, part.strip);
    }
  } finally {
    s.dispose();
  }
}

/** Hardware an extra part needs (bill of materials); floor pieces carry theirs in `PieceEnclosure.hardware`. */
export function enclosurePartHardware(part: EnclosurePart): EnclosureHardware[] {
  if (part.kind === 'cleat') return [{ item: `Countersunk screws ⌀${part.strip.screwDiameter} (French cleat)`, count: part.strip.screws.length, note: 'into the wall' }];
  return [];
}

/** Validate a solid built from data (tests). */
export function solidOf(w: Wasm, d: SolidDef) {
  const m = buildSolid(w, d);
  assertValid(m, 'solid');
  return toMeshData(m);
}
