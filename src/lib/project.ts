import {
  DEFAULT_BASEPLATE,
  baseplateHeight,
  binSeatHeight,
  buildBaseplatePiece,
  type BaseplateOptions,
} from './geometry/baseplate';
import {
  DEFAULT_BIN,
  binKey,
  binLabel,
  binLabelPlatePlaces,
  binLabelPlates,
  binCells,
  binLabelTexts,
  binLayout,
  binFrontLabel,
  binFrontQr,
  binSize,
  binTotalHeight,
  binUsesInlay,
  buildBin,
  buildDividerInsert,
  fullCells,
  insertKey,
  removableInserts,
  sanitizeBin,
  type BinCells,
  type BinOptions,
  type DividerInsert,
} from './geometry/bin';
import { activeContainer, containerDef, type ContainerType } from './geometry/containers';
import { buildLabelPlate, labelPlateHeight, labelPlateKey, type LabelPlate } from './geometry/labels';
import { resolveContentLabels } from './geometry/labelContents';
import { labelPlainText } from './geometry/labelIcons';
import { frontLabelBottom, frontLabelClashes } from './geometry/frontLabel';
import { buildBinLid, hasLid, lidKey, lidSize, lidStackHeight, planLidQr } from './geometry/lid';
import { binQrPlate, resolveQrText } from './geometry/binQr';
import { qrPlateHeight, qrPlateKey, type QrPlatePart } from './geometry/qrCode';
import { buildQrPlate } from './geometry/qrSolid';
import { accessoryParts, planAccessories, type AccessoryPart } from './geometry/accessories';
import { buildAccessoryPart } from './geometry/accessoryGeometry';
import { insertParts, planInserts } from './geometry/cups';
import { buildInsertPart, type InsertPart } from './geometry/insertGeometry';
import { PAD, baseplatePads, padPartKey, padPartName, padStyle, padThickness } from './geometry/pads';
import { isPocketLid } from './geometry/pocketLid';
import { wantsShadow } from './geometry/insertOptions';
import { compartmentInside } from './geometry/compartments';
import {
  buildConnectorKey,
  connectorKeySize,
  connectorSites,
  jointSteps,
  pieceProtrusion,
  sitesOnPiece,
  type ConnectorSite,
} from './geometry/connectors';
import { pieceIsVoid } from './geometry/mask';
import { hasStretch, stretchOf, type BinStretch } from './geometry/placement';
import { BASE_TOP, GRID } from './geometry/spec';
import { translateMesh, type MeshData, type Wasm } from './geometry/kernel';
import { DEFAULT_DRAWER, cellEdge, cellSizes, computeLayout, insideHeight, type DrawerInput, type GridLayout } from './layout/drawer';
import { effectiveStretch } from './layout/stretch';
import { fitsOnBed, movePlate, packIntoPlates, packPlates, plateBed, type PackItem, type PackOptions, type Placement } from './layout/pack';
import {
  DEFAULT_SETUP,
  assemblyMap,
  pieceFootprint,
  planBaseplate,
  type BaseplatePlan,
  type PlateLayout,
  type PrintSetup,
} from './layout/plan';
import type { PieceDef } from './layout/split';
import { DEFAULT_MOTION, findPrinter } from './printers';
import { baseplatePicked, baseplatePrinter, jobPrinters, printerNames, printerSetup, roughSeconds, shareOut, usableArea, type ShareItem } from './layout/fleet';
import { coveredParts, hasPrints, type PrintedRecord } from './printed';
import {
  buildEnclosurePart,
  buildEnclosurePiece,
  planEnclosure,
  type EnclosurePart,
  type EnclosurePartKind,
  type EnclosureScene,
  type EnclosureSceneItem,
  type EnclosureView,
  type PieceEnclosure,
} from './enclosures';
import { stackPlaces, stackWarnings } from './stacking';
import { specRole as specRoleOf, splitByRoles } from './geometry/colourRegions';
import type { ColourOverride, ColourRole, ColourSetupFields } from './colours';
import { cleanSlot, colourSetupOf, strategyOf } from './colours';
import { groupName, plateGroup, plateGroups, soloGroup, tagColours, useSplitMeshes } from './colourPlan';
import { externalBox, externalSize, importedSpec, meshSize, printsMesh, type ExternalBin } from './external';
import { buildImported, type ImportedSpec } from './imported/registry';
import { binSpiral, type SpiralPrint } from './geometry/containers/vase';
import { kindsReady, type AttachmentExtras, type PlacedAttachment, type AttachmentLayout, type MountCtx } from './wall';
import { wallInlaid, type WallBoard, type WallPlacement } from './wall/plan';
import type * as WallBuild from './wall/build';
import { packSpiral, spiralClearance, spiralSettingsText } from './layout/spiral';

/** A bin placed in the drawer grid. (x, y) is the front-left cell it covers. */
export interface PlacedBin {
  id: string;
  x: number;
  y: number;
  opts: BinOptions;
  /**
   * What's in the bin, one item per line (src/lib/inventory.ts). Not geometry:
   * kept out of `opts`, so it never changes a mesh key.
   */
  contents?: string;
  /** What's in each compartment, keyed like `opts.layout.comps` (compartment keys). */
  compContents?: Record<string, string>;
  /**
   * How far the body reaches over the solid margin toward the drawer wall, mm
   * per side. Only sides touching the grid edge stretch, up to the plate edge
   * (layout/stretch.ts); the rest is kept but ignored.
   */
  stretch?: Partial<BinStretch>;
  /**
   * Id of the bin this one stands on, stacked in its lip (stacking.ts). It has
   * that bin's footprint. Unset = on the baseplate.
   */
  on?: string;
  /**
   * A bin Gridfit doesn't build (external.ts): one you already have, or an
   * imported STL/3MF mesh. `opts` then holds only its footprint and height.
   */
  external?: ExternalBin;
}

/** One drawer's design. */
export interface DrawerProject {
  drawer: DrawerInput;
  baseplate: BaseplateOptions;
  bins: PlacedBin[];
}

/** A drawer in a multi-drawer workspace. */
export interface NamedDrawer extends DrawerProject {
  id: string;
  name: string;
}

export interface ProjectState extends DrawerProject {
  setup: PrintSetup;
  include: { baseplate: boolean; bins: boolean };
}

export const DEFAULT_PROJECT: ProjectState = {
  drawer: DEFAULT_DRAWER,
  baseplate: DEFAULT_BASEPLATE,
  setup: DEFAULT_SETUP,
  bins: [],
  include: { baseplate: true, bins: true },
};

export { DEFAULT_BIN };

/** Describes how to build one unique mesh. */
export type MeshSpec =
  | {
      kind: 'piece';
      key: string;
      layout: GridLayout;
      piece: PieceDef;
      opts: BaseplateOptions;
      /** Connector sites on this piece's seams. */
      connectors: ConnectorSite[];
      /** Carry-case walls, wall-mount holes, spacer sockets (enclosures.ts). */
      enclosure?: PieceEnclosure;
    }
  | { kind: 'bin'; key: string; opts: BinOptions; cells?: BinCells }
  | { kind: 'lid'; key: string; opts: BinOptions; cells?: BinCells }
  | { kind: 'key'; key: string; opts: BaseplateOptions }
  /** Slide-in plate for a removable divider. */
  | { kind: 'divider'; key: string; insert: DividerInsert }
  /** Swappable label plate. */
  | { kind: 'label'; key: string; plate: LabelPlate }
  /** Stick-on QR code plate (qrCode.ts). */
  | { kind: 'qrPlate'; key: string; plate: QrPlatePart }
  /** Lift-out tray, sliding lid or rail plate (accessories.ts). */
  | { kind: 'accessory'; key: string; part: AccessoryPart }
  /** Lift-out cup or grid insert (cups.ts), or a baseplate's TPU pad (pads.ts). */
  | { kind: 'insertPart'; key: string; part: InsertPart }
  /** An extra part of a drawer unit, parts box, … (containers/). */
  | { kind: 'container'; key: string; type: ContainerType; spec: unknown }
  /** Case lid, hinge pin, handle, foot, spacer strip, wall cleat (enclosures.ts); `view` poses it for the drawer view. */
  | { kind: 'enclosure'; key: string; part: EnclosurePart; view?: EnclosureView }
  /** `base` cut into a volume per colour role (multi-colour 'feature': geometry/colourRegions.ts); key: colours.ts splitMeshKey. */
  | { kind: 'split'; key: string; base: MeshSpec }
  /** An imported bin's mesh, as it is (external.ts, imported/registry.ts). */
  | ImportedSpec
  /** Something that hangs on a Skådis board (lib/wall), in its print pose; `extras`: what its common options add (bolts, label, barbs). */
  | { kind: 'attachment'; key: string; type: string; opts: object; layout: AttachmentLayout; ctx: MountCtx; extras?: AttachmentExtras }
  /** One of an attachment's extra parts. */
  | { kind: 'attachmentPart'; key: string; type: string; part: unknown; ctx: MountCtx };

export interface JobPart {
  key: string;
  name: string;
  kind: 'piece' | 'bin' | 'lid' | 'key' | 'divider' | 'label' | 'tray' | 'pad' | 'enclosure' | 'attachment';
  /** Enclosure parts: which one (case lid, hinge pin, spacer strip, …). */
  enclosure?: EnclosurePartKind;
  meshKey: string;
  w: number;
  d: number;
  h: number;
  /** Drawer this part belongs to (multi-drawer jobs). */
  drawer?: string;
  /** Baseplate piece number. */
  pieceId?: number;
  /** Trays and sliding lids: where the part sits in its bin (min corner from the bin's min corner and bottom). */
  assembled?: { x: number; y: number; z: number };
  /** Container parts: the placed bin they belong to. */
  bin?: string;
  /** Attachments and their parts: the attachment's id (lib/wall). */
  attachment?: string;
  /** Colour role of the part (multi-colour, colours.ts); set by planning. */
  role?: ColourRole;
  /** Its bin's or its drawer's own colour over the roles' (colourPlan.ts tagColours). */
  colour?: ColourOverride;
  /** Mesh key the 3D view shows instead of `meshKey` (a big imported mesh, decimated). */
  preview?: string;
  /** Vase-mode bins: how the slicer must print them (geometry/containers/vase.ts). */
  spiral?: SpiralPrint;
}

export interface JobPlate {
  name: string;
  group: 'baseplate' | 'bins';
  placements: Placement[];
  /** The printer it's for, with several (fleet.ts jobPrinters); unset: the first. */
  printer?: number;
  /** Vase-mode bins only, printed in spiral vase mode (layout/spiral.ts). */
  spiral?: boolean;
}

/** One drawer's baseplate within a print job. */
export interface DrawerJob {
  id: string;
  name: string;
  layout: GridLayout;
  plan: BaseplatePlan;
  connectors: ConnectorSite[];
  /** Every joint on the seams, whatever the connector style (connectors holds only those that need a key). */
  sites: ConnectorSite[];
  /** Assembly notes for joints without keys (pins, puzzle tabs, screws). */
  steps: string[];
  /** Index of this drawer's first plate in the job. */
  plateOffset: number;
  /** Plates that hold this drawer's baseplate (and keys). */
  plateCount: number;
  /** Carry case, wall grid or spacer strips: what the drawer view draws (enclosures.ts). */
  enclosure?: EnclosureScene;
  /** Room for bins above the baseplate floor, mm (Infinity when the height isn't known). */
  room?: number;
  /** The assembly map's name for each of `plan.plates` when they aren't together from `plateOffset` (several printers). */
  plateNames?: string[];
  /** An assembly map of its own (a Skådis board's), instead of the grid's. */
  map?: string;
  /**
   * The grid is there already ("Just bins", DrawerInput.haveBaseplate): `plan`
   * is it in one piece, for the drawer view only. None of it is on the plates,
   * and it has no assembly map or steps.
   */
  haveBaseplate?: true;
}

export interface PrintJob {
  /** The first (or only) drawer's layout, plan and connectors. */
  layout: GridLayout;
  plan: BaseplatePlan;
  /** One per connector key; empty when connectors are off. */
  connectors: ConnectorSite[];
  /** Every joint on the first drawer's seams, whatever the style. */
  sites: ConnectorSite[];
  drawers: DrawerJob[];
  parts: Record<string, JobPart>;
  meshes: Record<string, MeshSpec>;
  plates: JobPlate[];
  warnings: string[];
  /** Printer names, by `JobPlate.printer`, when the job is for several printers. */
  printers?: string[];
  /** Parts on the plates that are printed already (printed.ts); set when planned with a print record. */
  printed?: string[];
  /** Parts left out because they're printed already ("only what's changed"). */
  leftOut?: string[];
  /** Multi-colour (colours.ts): the setup's colour fields the exports and estimates go by; unset when it's off. */
  colours?: ColourSetupFields;
}

/** What else planPrint can take into account. */
export interface PlanPrintOptions {
  /** What has been printed (printed.ts): the job's `printed` says which parts it covers. */
  printed?: PrintedRecord;
  /** Leave out the parts `printed` covers and pack only the rest. */
  onlyChanged?: boolean;
  /** A part's print seconds on printer `i` (start sequence left out) once it's sliced, for sharing parts out between printers. */
  seconds?: (part: JobPart, printer: number) => number | undefined;
}

/**
 * True when the job prints the drawer's baseplate (and the rest of its grid:
 * keys, pads, spacer strips, a case or wall grid): it isn't there already
 * (DrawerInput.haveBaseplate) and the export takes baseplates (`include`).
 */
export function printsBaseplate(d: { drawer: Pick<DrawerInput, 'haveBaseplate'> }, include: ProjectState['include']): boolean {
  return include.baseplate && !d.drawer.haveBaseplate;
}

/** A bed nothing is too big for: a baseplate that's there already is planned in one piece, just to be drawn. */
const ANY_BED = 100_000;

export function pieceMeshKey(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []) {
  const id = o.pieceNumbers ? piece.id : 0; // numbered pieces are all different
  return `piece|${JSON.stringify([layout, piece.x0, piece.y0, piece.x1, piece.y1, piece.cells, piece.outer, geometryOf(o), connectors, id])}`;
}

/** Baseplate options without what isn't geometry (its colour), so a colour never changes a mesh. */
export function geometryOf(o: BaseplateOptions): BaseplateOptions {
  if (o.colour === undefined) return o;
  const { colour: _, ...rest } = o;
  return rest;
}

/**
 * What the bin's place gives its geometry: the cell sizes under it, the
 * half-grid flag and its stretch over the margin. Undefined for a classic bin
 * on full cells.
 */
export function binCellsAt(layout: GridLayout, b: PlacedBin): BinCells | undefined {
  const cells: BinCells = {
    x: cellSizes(layout.xs, b.x, b.opts.unitsX, layout.pitchX),
    y: cellSizes(layout.ys, b.y, b.opts.unitsY, layout.pitchY),
  };
  if (layout.halfGrid) cells.half = true;
  const stretch = effectiveStretch(layout, b);
  if (stretch) cells.stretch = stretch;
  return fullCells(cells) && !cells.half && !cells.stretch ? undefined : cells;
}

/**
 * The mesh spec for a placed bin. Label text that asks for `{contents}`, and a
 * QR code that lists them, are filled in from what's in the bin here
 * (labelContents.ts, binQr.ts), so only then does the key follow the contents.
 */
export function binSpec(layout: GridLayout, b: PlacedBin): Extract<MeshSpec, { kind: 'bin' }> {
  const cells = binCellsAt(layout, b);
  const opts = resolveQrText(resolveContentLabels(b.opts, b), b, cells);
  return { kind: 'bin', key: `bin|${binKey(opts, cells)}`, opts, cells };
}

/** True when the bin's body reaches over the margin where it is. */
export function binStretched(layout: GridLayout, b: PlacedBin): boolean {
  return hasStretch(binCellsAt(layout, b)?.stretch);
}

/** The mesh spec for a placed bin's stacking lid (lids depend only on the footprint, and a QR code on them; stretched bins get none). */
export function lidSpec(layout: GridLayout, b: PlacedBin): Extract<MeshSpec, { kind: 'lid' }> {
  const at = binCellsAt(layout, b);
  const cells = at && { x: at.x, y: at.y };
  const opts = b.opts.qr === 'lid' ? resolveQrText(b.opts, b, at) : b.opts;
  return { kind: 'lid', key: `lid|${lidKey(opts, cells)}`, opts, cells };
}

/**
 * Front-left corner of the bin's mesh (its body, stretch included) in plate
 * coordinates, for the assembled drawer: the feet sit on the bin's cells.
 */
export function binOrigin(layout: GridLayout, b: PlacedBin): { x: number; y: number } {
  // Bins from elsewhere sit centred on their cells (external.ts).
  if (b.external) return externalBox(layout, b);
  const st = stretchOf(binCellsAt(layout, b)?.stretch);
  const inset = (GRID - BASE_TOP) / 2;
  return {
    x: cellEdge(layout.xs, b.x, layout.pitchX) + inset - st.left,
    y: cellEdge(layout.ys, b.y, layout.pitchY) + inset - st.front,
  };
}

/** A bin's footprint in grid units ("1.5×2" on a half grid). */
export function binUnitsText(layout: Pick<GridLayout, 'halfGrid'>, o: Pick<BinOptions, 'unitsX' | 'unitsY'>): string {
  const u = (n: number) => (layout.halfGrid ? n / 2 : n);
  return `${u(o.unitsX)}×${u(o.unitsY)}`;
}

/** Everything about the print except the geometry itself. Cheap; safe to call on every edit. */
export function planJob(state: ProjectState): PrintJob {
  return planPrint([{ id: '', name: '', drawer: state.drawer, baseplate: state.baseplate, bins: state.bins }], state.setup, state.include);
}

/**
 * Plan several drawers at once. Each drawer's baseplate gets its own plates;
 * bins from every drawer share plates. With one drawer, part keys are plain
 * (`piece:3`, `bin:<id>`); with several they're prefixed with the drawer id.
 *
 * With several printers (fleet.ts) the baseplate is split for one of them and
 * every plate is for one printer. With a print record, the job says which
 * parts it covers; with `onlyChanged` those are left out and the rest packed
 * on their own.
 */
export function planPrint(drawers: NamedDrawer[], setup: PrintSetup, include: ProjectState['include'], opts: PlanPrintOptions = {}): PrintJob {
  if (opts.onlyChanged && hasPrints(opts.printed)) {
    // Plan everything to see what the record covers, then again without it.
    const leftOut = planPrint(drawers, setup, include, { ...opts, onlyChanged: false }).printed ?? [];
    if (leftOut.length) return { ...planParts(drawers, setup, include, opts, new Set(leftOut)), printed: [], leftOut };
  }
  const job = planParts(drawers, setup, include, opts);
  return opts.printed ? withPrinted(job, opts.printed) : job;
}

/** The job with the parts the record covers (printed.ts). */
export function withPrinted(job: PrintJob, rec: PrintedRecord): PrintJob {
  return { ...job, printed: [...coveredParts(job, rec)] };
}

/** A one-drawer plan (planJob) as drawer `id`'s, like planPrint makes it: its parts say which drawer they're for. */
export function asDrawer(job: PrintJob, id: string): PrintJob {
  const parts = Object.fromEntries(Object.entries(job.parts).map(([k, p]) => [k, { ...p, drawer: id }]));
  return { ...job, parts, drawers: job.drawers.map((d) => ({ ...d, id })) };
}

function planParts(drawers: NamedDrawer[], setup: PrintSetup, include: ProjectState['include'], opts: PlanPrintOptions, skip?: Set<string>): PrintJob {
  const multi = drawers.length > 1;
  const parts: Record<string, JobPart> = {};
  const meshes: Record<string, MeshSpec> = {};
  const plates: JobPlate[] = [];
  const warnings = new Set<string>();
  const drawerJobs: DrawerJob[] = [];
  const binItems: PackItem[] = [];
  // Several printers (fleet.ts): the baseplate is split for one of them; the plates are shared out at the end.
  const printers = jobPrinters(setup);
  const baseAt = baseplatePrinter(setup);
  const base = printerSetup(setup, baseAt);
  // Its bed, edge margin and exclusion areas (printers.ts): every plate keeps clear of them.
  const bed = plateBed(base);
  // Parts printed already ("only what's changed").
  const keep = (it: PackItem) => !skip?.has(it.key);

  for (const withColour of drawers) {
    // Its colour is for tagColours below; the geometry never sees it.
    const d = { ...withColour, baseplate: geometryOf(withColour.baseplate) };
    const plateColour = cleanSlot(withColour.baseplate.colour);
    const prefix = multi ? `${d.id}/` : '';
    const label = multi ? `${d.name} · ` : '';
    const warn = (msg: string) => warnings.add(multi ? `${d.name}: ${msg}` : msg);
    const layout = computeLayout(d.drawer);
    // "Just bins": the grid is there already, so it's planned whole (on a bed nothing is too big for) to be drawn, and nothing of it prints.
    const have = !!d.drawer.haveBaseplate;
    const gridSetup = have ? { ...base, bedW: ANY_BED, bedD: ANY_BED, maxH: ANY_BED } : base;
    const printBase = include.baseplate && !have;
    // A carry case, wall grid or spacer strips plan their own floor pieces and extra parts (enclosures.ts).
    const enc = planEnclosure(d, layout, gridSetup);
    const pieceLayout = enc?.pieceLayout ?? layout;
    const bpo = enc?.baseplate ?? d.baseplate;
    const protrude = pieceProtrusion(bpo);
    let plan = enc?.plan ?? planBaseplate(layout, gridSetup, { protrude, skip: (p) => pieceIsVoid(layout, p) });
    if (plan.error && !enc && !have) warn(plan.error);

    const bpH = baseplateHeight(bpo);
    const sites = connectorSites(pieceLayout, plan.pieces, bpo);
    // Only bowtie joints print keys; the others need nothing (pins, puzzle tabs) or hardware (screws).
    const connectors = bpo.connector === 'bowtie' ? sites : [];
    for (const piece of plan.pieces) {
      const key = `${prefix}piece:${piece.id}`;
      const mine = sitesOnPiece(sites, piece);
      const ep = enc?.piece(piece);
      // A piece built from its enclosure alone (Skådis tiles) has a key of its own: identical ones share a mesh.
      const meshKey = ep?.meshKey ?? pieceMeshKey(pieceLayout, piece, bpo, mine) + (ep ? `|enc${JSON.stringify(ep.enclosure)}` : '');
      meshes[meshKey] = { kind: 'piece', key: meshKey, layout: pieceLayout, piece, opts: bpo, connectors: mine, ...(ep ? { enclosure: ep.enclosure } : {}) };
      parts[key] = {
        key,
        name: `${label}${have ? `${ep?.name ?? 'Baseplate'} (not printed: you have it)` : (ep?.name ?? `Baseplate piece ${piece.id}`)}`,
        kind: 'piece',
        meshKey,
        ...(ep ? { w: ep.w, d: ep.d } : pieceFootprint(piece, protrude)),
        h: ep?.h ?? bpH,
        drawer: d.id,
        pieceId: piece.id,
      };
    }
    const plateOffset = plates.length;
    if (printBase) {
      // Keys print in the free space next to the pieces; any that don't fit get their own plate.
      const keys: PackItem[] = [];
      if (connectors.length) {
        const meshKey = `key|${d.baseplate.connector}`;
        const size = connectorKeySize();
        meshes[meshKey] = { kind: 'key', key: meshKey, opts: d.baseplate };
        for (let i = 1; i <= connectors.length; i++) {
          const key = `${prefix}key:${i}`;
          parts[key] = { key, name: `${label}Connector key ${i}`, kind: 'key', meshKey, ...size, drawer: d.id };
          keys.push({ key, w: size.w, d: size.d });
        }
      }
      // Without the pieces printed already, the rest packed again.
      if (skip && plan.pieces.some((p) => skip.has(`${prefix}piece:${p.id}`))) {
        const left = plan.pieces.map((p) => `piece:${p.id}`).filter((k) => !skip.has(prefix + k));
        const items = left.map((k) => ({ key: k, w: parts[prefix + k].w, d: parts[prefix + k].d }));
        plan = { ...plan, plates: packPlates(items, { ...bed, spacing: base.spacing, nest: base.nest }).plates };
      }
      const piecePlates: PlateLayout[] = plan.plates.map((pl) => ({
        placements: pl.placements.map((p) => ({ ...p, key: prefix + p.key })),
      }));
      // Multi-colour (colourPlan.ts): keys in another colour than the pieces get plates of their own.
      const pieceRole = enc?.kind === 'case' ? 'caseShell' : enc?.kind === 'wall' || enc?.kind === 'skadis' ? 'wallGrid' : 'plate';
      const over = plateColour ? { plate: plateColour } : undefined;
      const apart = soloGroup(setup, 'plateAccent', over) !== soloGroup(setup, pieceRole, over);
      const packed = apart
        ? { ...packIntoPlates([], keys.filter(keep), { ...bed, spacing: setup.spacing, nest: true }), plates: piecePlates }
        : packIntoPlates(piecePlates, keys.filter(keep), { ...bed, spacing: setup.spacing, nest: true });
      packed.plates.forEach((pl, i) => {
        const what = enc?.plateName ?? (enc?.kind === 'case' ? 'Case body' : enc?.kind === 'skadis' ? 'Skådis board' : 'Baseplate');
        plates.push({ name: `${label}${what} ${i + 1}`, group: 'baseplate', placements: pl.placements });
      });
      packed.extra.forEach((pl, i) => {
        const name = packed.extra.length > 1 ? `Connector keys ${i + 1}` : 'Connector keys';
        plates.push({ name: label + name, group: 'baseplate', placements: pl.placements });
      });
      if (packed.oversize.length) warn('Connector keys are larger than the print bed and were left out.');
      // TPU non-slip pads (pads.ts) on plates of their own, so they print in another material.
      const pads: PackItem[] = [];
      // Same layout and options the pieces (and their pad recesses) are built from, so a case floor's pads line up too.
      baseplatePads(pieceLayout, plan.pieces, bpo, sites).forEach((p, i) => {
        const meshKey = padPartKey(p.part);
        meshes[meshKey] = { kind: 'insertPart', key: meshKey, part: p.part };
        const key = `${prefix}pad:${i}`;
        parts[key] = { key, name: `${label}${padPartName(p.part)}`, kind: 'pad', meshKey, w: p.part.length, d: p.part.width, h: padThickness(), drawer: d.id };
        pads.push({ key, w: p.part.length, d: p.part.width });
      });
      if (pads.some(keep)) {
        const packedPads = packPlates(pads.filter(keep), { ...bed, spacing: Math.max(setup.spacing, 2), nest: true });
        packedPads.plates.forEach((pl, i) => {
          plates.push({ name: `${label}TPU pads${packedPads.plates.length > 1 ? ` ${i + 1}` : ''}`, group: 'baseplate', placements: pl.placements });
        });
        if (packedPads.oversize.length) warn('Some non-slip strips are longer than the print bed and were left out.');
      }
    }
    // ---- Enclosure parts: case lid, hinge pins, handle, feet, spacer strips, wall cleat (enclosures.ts) ----
    if (enc) {
      // One that's there already only warns about the bins in it.
      for (const msg of have ? enc.binNotes : enc.warnings) warn(msg);
      for (const v of enc.views) meshes[v.meshKey] = { kind: 'enclosure', key: v.meshKey, part: v.part, view: v.view };
      const items: PackItem[] = [];
      for (const p of enc.parts) {
        const k = prefix + p.key;
        if (p.part) meshes[p.meshKey] = { kind: 'enclosure', key: p.meshKey, part: p.part };
        else meshes[p.meshKey] ??= { kind: 'key', key: p.meshKey, opts: bpo };
        parts[k] = { key: k, name: label + p.name, kind: p.kind, meshKey: p.meshKey, w: p.w, d: p.d, h: p.h, drawer: d.id };
        if (p.part) parts[k].enclosure = p.part.kind;
        items.push({ key: k, w: p.w, d: p.d });
      }
      if (printBase && items.some(keep)) {
        // Multi-colour (colourPlan.ts): each colour on plates of its own.
        const encColour = (k: string) => {
          const p = enc.parts.find((x) => prefix + x.key === k);
          const spec = p?.part ? meshes[p.meshKey] : undefined;
          const role = spec ? specRoleOf(spec) : 'plateAccent';
          return soloGroup(setup, role, plateColour ? { plate: plateColour } : undefined);
        };
        const packed = { plates: [] as PlateLayout[], oversize: [] as PackItem[] };
        for (const [, list] of plateGroups(setup, items.filter(keep), (it) => encColour(it.key), () => 0)) {
          const one = packPlates(list, { ...bed, spacing: setup.spacing, nest: true });
          packed.plates.push(...one.plates);
          packed.oversize.push(...one.oversize);
        }
        const count = new Map<string, number>();
        const group = (pl: PlateLayout) => enc.parts.find((p) => prefix + p.key === pl.placements[0].key)?.group ?? 'Parts';
        const totals = new Map<string, number>();
        for (const pl of packed.plates) totals.set(group(pl), (totals.get(group(pl)) ?? 0) + 1);
        for (const pl of packed.plates) {
          const gname = group(pl);
          const n = (count.get(gname) ?? 0) + 1;
          count.set(gname, n);
          plates.push({ name: `${label}${gname}${totals.get(gname)! > 1 ? ` ${n}` : ''}`, group: 'baseplate', placements: pl.placements });
        }
        for (const o of packed.oversize) warn(`${parts[o.key].name} is larger than the print bed and was left out.`);
      }
    }
    const steps = have ? [] : [...jointSteps(bpo, bpo.connector === 'bowtie' ? 0 : sites.length), ...(enc?.steps ?? [])];
    drawerJobs.push({
      id: d.id,
      name: d.name,
      layout,
      plan,
      connectors,
      sites,
      steps,
      plateOffset,
      plateCount: plates.length - plateOffset,
      ...(enc ? { enclosure: enc.scene } : {}),
      ...(enc?.map ? { map: enc.map } : {}),
      ...(have ? { haveBaseplate: true as const } : {}),
    });
    // A Skådis board holds attachments (lib/wall), not bins: they print with the bins, on shared plates.
    if (enc?.kind === 'skadis') {
      if (enc.wall) {
        const scene = drawerJobs[drawerJobs.length - 1].enclosure!;
        const items = [...scene.items];
        // Until the kinds and their planning have loaded (wall/ready.ts, wall/parts.ts) the board plans bare; App plans again once they're in.
        const placed =
          wallParts && kindsReady()
            ? wallParts({ list: d.drawer.attachments ?? [], board: enc.wall, drawer: d.id, prefix, label, bins: include.bins, meshes, parts, binItems, items, warn })
            : [];
        drawerJobs[drawerJobs.length - 1].enclosure = { ...scene, wall: { board: enc.wall, placed }, items };
      }
      continue;
    }
    // An openGrid or Multiboard board (gridBoards.ts) has no bins.
    if (enc?.kind === 'opengrid' || enc?.kind === 'multiboard') continue;

    // TPU pads (pads.ts) lift the whole plate a little.
    const lift = padStyle(bpo) ? PAD.proud : 0;
    const inside = insideHeight(d.drawer);
    const room = enc ? enc.room - lift : inside > 0 ? inside - binSeatHeight(d.baseplate) - lift : Infinity;
    drawerJobs[drawerJobs.length - 1].room = room;
    // Stacked bins (stacking.ts): each stands on a bin that can hold it, and every stack fits the drawer.
    const stacked = stackPlaces(layout, d.bins);
    for (const msg of stackWarnings(layout, d.bins, room, d.drawer.enclosure === 'wall')) warn(msg);
    // Raised front labels and QR codes stand proud of the 0.5 mm gap to the bin in front (a stack in front fills it up to its top).
    const raisedLabel = (x: PlacedBin) => x.opts.frontLabel === 'raised' || x.opts.frontLabel === 'two-tone';
    const raisedQr = (x: PlacedBin) => x.opts.qr === 'front' && x.opts.qrStyle === 'raised';
    const raisedBottom = (x: PlacedBin) => {
      const cells = binCellsAt(layout, x);
      const o = resolveContentLabels(x.opts, x);
      const zs = [
        raisedLabel(x) ? frontLabelBottom(binFrontLabel(o, cells)) : null,
        raisedQr(x) ? (binFrontQr(resolveQrText(o, x, cells), cells)?.box?.z0 ?? null) : null,
      ].filter((z): z is number => z !== null);
      return offset(zs.length ? Math.min(...zs) : null, stacked.get(x.id)?.z);
    };
    const clashes = frontLabelClashes(d.bins, raisedBottom, (x) => (stacked.get(x.id)?.z ?? 0) + binTotalHeight(x.opts));
    for (const b of clashes) {
      const what = raisedLabel(b) && raisedQr(b) ? 'front label and QR code touch' : raisedQr(b) ? 'QR code on the front touches' : 'front label touches';
      warn(`Bin ${binLabel(b.opts)}: its raised ${what} the bin in front of it (make it inlaid or engraved).`);
    }
    for (const b of d.bins) {
      const key = `${prefix}bin:${b.id}`;
      // Bins from elsewhere (external.ts) are never built; an imported mesh that prints goes on the plates as it is.
      if (b.external) {
        const name = b.external.name ? `“${b.external.name}”` : `Bin ${externalSize(b, layout.halfGrid)}`;
        const mesh = b.external.mesh && meshSize(b.external.mesh);
        if ((mesh?.h ?? binTotalHeight(b.opts)) > room + 1e-6) warn(`${name} is taller than the drawer (${round(room)} mm of room above the baseplate floor).`);
        const view = importedSpec(b, true);
        if (view) meshes[view.key] = view;
        const spec = printsMesh(b) ? importedSpec(b) : null;
        if (spec && mesh) {
          meshes[spec.key] = spec;
          parts[key] = { key, name: `${label}${name} (imported)`, kind: 'bin', meshKey: spec.key, ...mesh, drawer: d.id, ...(view && view.key !== spec.key ? { preview: view.key } : {}) };
          if (include.bins) binItems.push({ key, w: mesh.w, d: mesh.d });
        }
        continue;
      }
      const spec = binSpec(layout, b);
      const { w, d: dd } = binSize(b.opts, spec.cells);
      const h = binTotalHeight(b.opts);
      meshes[spec.key] = spec;
      const front = binFrontLabel(spec.opts, spec.cells)?.segments.map((g) => g.text) ?? [];
      const texts = [...new Set([...binLabelTexts(spec.opts, spec.cells), ...front].map(labelPlainText).filter(Boolean))];
      const caption = texts.length ? ` “${texts.slice(0, 3).join(' · ').replace(/\n/g, ' ')}${texts.length > 3 ? ' …' : ''}”` : '';
      const binName = binLabel(b.opts, spec.cells);
      parts[key] = { key, name: `${label}Bin ${binName}${caption}`, kind: 'bin', meshKey: spec.key, w, d: dd, h, drawer: d.id };
      // Vase-mode bins print in spiral vase mode, on plates of their own (layout/spiral.ts); the name says how.
      const spiral = binSpiral(spec.opts, spec.cells);
      if (spiral) Object.assign(parts[key], { spiral, name: `${parts[key].name} [spiral vase: ${spiralSettingsText(spiral)}]` });
      // Drawer units, parts boxes, … (containers/) check their height with their parts in place.
      const container = activeContainer(b.opts);
      const closed = container?.def.closedHeight?.(sanitizeBin(b.opts), container.opts) ?? h;
      if (closed > room + 1e-6) warn(`Bin ${binName} is taller than the drawer (${round(room)} mm of room above the baseplate floor).`);
      if (include.bins) binItems.push({ key, w, d: dd });
      // Containers print their own extra parts instead of the bin's lid, plates and trays.
      if (container) {
        const so = sanitizeBin(b.opts);
        const cells = binCells(so, spec.cells);
        for (const msg of container.def.notes?.(so, container.opts, cells) ?? []) warn(`${binName}: ${msg}`);
        for (const p of container.def.parts?.(so, container.opts, cells) ?? []) {
          meshes[p.meshKey] = { kind: 'container', key: p.meshKey, type: container.def.kind, spec: p.spec };
          const k = `${prefix}${p.slot}:${b.id}:${p.index}`;
          parts[k] = { key: k, name: `${label}${p.name} (${binName})`, kind: p.kind, meshKey: p.meshKey, w: p.w, d: p.d, h: p.h, drawer: d.id, bin: b.id };
          if (p.assembled) parts[k].assembled = p.assembled;
          if (include.bins) binItems.push({ key: k, w: p.w, d: p.d });
        }
        continue;
      }
      // A stretched lip isn't the grid's shape, so a lid (feet per cell) wouldn't seat in it.
      const stretched = hasStretch(spec.cells?.stretch);
      if (hasLid(b.opts) && stretched) warn(`Bin ${binName} is stretched over the margin, so it gets no lid.`);
      if (hasLid(b.opts) && !stretched) {
        const lid = lidSpec(layout, b);
        const lidPart = `${prefix}lid:${b.id}`;
        const size = lidSize(b.opts, lid.cells);
        meshes[lid.key] = lid;
        const lidName = isPocketLid(b.opts) ? 'Pocket-grid lid' : 'Lid';
        parts[lidPart] = { key: lidPart, name: `${label}${lidName} for bin ${binName}`, kind: 'lid', meshKey: lid.key, ...size, drawer: d.id };
        const stack = lidStackHeight(b.opts);
        if (h <= room + 1e-6 && stack > room + 1e-6) warn(`Bin ${binName} with its lid is taller than the drawer (${round(room)} mm of room above the baseplate floor).`);
        if (include.bins) binItems.push({ key: lidPart, w: size.w, d: size.d });
      }
      // Removable divider plates and swappable label plates print with the bins.
      const owner = `bin ${binUnitsText(layout, b.opts)}`;
      removableInserts(b.opts, spec.cells).forEach((ins, i) => {
        const meshKey = insertKey(ins);
        meshes[meshKey] = { kind: 'divider', key: meshKey, insert: ins };
        const k = `${prefix}divider:${b.id}:${i}`;
        const name = `${label}Divider ${round1(ins.length)} × ${round1(ins.height)} mm (${owner})`;
        parts[k] = { key: k, name, kind: 'divider', meshKey, w: ins.length, d: ins.height, h: ins.thickness, drawer: d.id };
        if (include.bins) binItems.push({ key: k, w: ins.length, d: ins.height });
      });
      const platePlaces = binLabelPlatePlaces(spec.opts, spec.cells);
      binLabelPlates(spec.opts, spec.cells).forEach((pl, i) => {
        const meshKey = labelPlateKey(pl);
        meshes[meshKey] = { kind: 'label', key: meshKey, plate: pl };
        const k = `${prefix}label:${b.id}:${i}`;
        const plain = labelPlainText(pl.text.trim());
        const text = plain ? `“${plain.replace(/\s*\n\s*/g, ' ')}”` : `${round1(pl.width)} × ${round1(pl.depth)} mm`;
        const name = `${label}${pl.format === 'cullenect' ? 'Cullenect label' : pl.format === 'pred' ? 'Pred label' : 'Label plate'} ${text} (${owner})`;
        parts[k] = { key: k, name, kind: 'label', meshKey, w: pl.width, d: pl.depth, h: labelPlateHeight(pl), drawer: d.id };
        // Pressed into its tab, for the assembled drawer view.
        if (platePlaces[i]) parts[k].assembled = platePlaces[i];
        if (include.bins) binItems.push({ key: k, w: pl.width, d: pl.depth });
      });
      // A stick-on QR code plate (binQr.ts).
      const qrPlate = binQrPlate(spec.opts, spec.cells)?.part;
      if (qrPlate) {
        const meshKey = qrPlateKey(qrPlate);
        meshes[meshKey] = { kind: 'qrPlate', key: meshKey, plate: qrPlate };
        const k = `${prefix}qr:${b.id}`;
        const side = qrPlate.side;
        parts[k] = { key: k, name: `${label}QR plate ${round1(side)} × ${round1(side)} mm (${owner})`, kind: 'label', meshKey, w: side, d: side, h: qrPlateHeight(qrPlate), drawer: d.id };
        if (include.bins) binItems.push({ key: k, w: side, d: side });
      }
      // Lift-out trays, sliding lids and rail plates (accessories.ts).
      const acc = sanitizeBin(spec.opts);
      for (const msg of planAccessories(acc, w, dd).notes) warn(`Bin ${binLabel(b.opts)}: ${msg}`);
      for (const a of accessoryParts(acc, w, dd)) {
        meshes[a.meshKey] = { kind: 'accessory', key: a.meshKey, part: a.part };
        const k = `${prefix}${a.slot}:${b.id}:${a.index}`;
        parts[k] = { key: k, name: `${label}${a.name} (${owner})`, kind: a.kind, meshKey: a.meshKey, w: a.w, d: a.d, h: a.h, drawer: d.id };
        if (a.assembled) parts[k].assembled = a.assembled;
        if (include.bins) binItems.push({ key: k, w: a.w, d: a.d });
      }
      // Lift-out cups and grid inserts (cups.ts), shown sitting in their compartments.
      for (const msg of planInserts(acc, spec.cells).notes) warn(`Bin ${binLabel(b.opts)}: ${msg}`);
      for (const a of insertParts(acc, spec.cells)) {
        meshes[a.meshKey] = { kind: 'insertPart', key: a.meshKey, part: a.part };
        const k = `${prefix}${a.slot}:${b.id}:${a.index}`;
        parts[k] = { key: k, name: `${label}${a.name} (${owner})`, kind: a.kind, meshKey: a.meshKey, w: a.w, d: a.d, h: a.h, drawer: d.id, assembled: a.assembled };
        if (include.bins) binItems.push({ key: k, w: a.w, d: a.d });
      }
    }
  }

  // Multi-colour (colours.ts): every part's role and own colour, and 'feature' meshes cut by role.
  tagColours(parts, meshes, drawers, multi);
  useSplitMeshes(setup, parts, meshes);
  const groupOf = (it: PackItem) => plateGroup(setup, parts[it.key], meshes[parts[it.key].meshKey]);
  const several = printers.length > 1;
  // Parts taller than the printer prints are left out, like ones bigger than the bed (the editors keep new ones within both: bedfit.ts).
  const printable = binItems.filter(keep).filter((it) => {
    const p = parts[it.key];
    if (several || p.h <= setup.maxH + 1e-6) return true;
    warnings.add(`${p.name} is ${round(p.h)} mm tall, taller than the printer prints (${setup.maxH} mm), and was left out.`);
    return false;
  });
  if (several) plates.splice(0, plates.length, ...sharePlates(setup, parts, plates, printable, drawerJobs, warnings, opts.seconds, groupOf));
  else if (printable.length) {
    plates.push(...binPlates(setup, printable, parts, groupOf, { ...bed, spacing: Math.max(setup.spacing, 2), nest: true }, setup.printerId, warnings, { bins: 0, vases: 0 }));
  }
  const first = drawerJobs[0];
  return {
    layout: first.layout,
    plan: first.plan,
    connectors: first.connectors,
    sites: first.sites,
    drawers: drawerJobs,
    parts,
    meshes,
    plates,
    warnings: [...warnings],
    ...(several ? { printers: printerNames(setup) } : {}),
    ...(colourSetupOf(setup) ? { colours: colourSetupOf(setup)! } : {}),
  };
}

/**
 * Bins and the rest on plates (bed: plateBed's, clear of its exclusion areas):
 * one colour group after another (colourPlan.ts; one group without
 * multi-colour), and in each the vase-mode bins on plates of their own.
 * `count` numbers the plates on, across printers.
 */
function binPlates(
  setup: PrintSetup,
  items: PackItem[],
  parts: Record<string, JobPart>,
  groupOf: (it: PackItem) => string,
  bed: PackOptions,
  printerId: string,
  warnings: Set<string>,
  count: { bins: number; vases: number; attachments?: number },
  printer?: number,
): JobPlate[] {
  const out: JobPlate[] = [];
  const at = printer === undefined ? {} : { printer };
  const groups = plateGroups(setup, items, groupOf, (it) => parts[it.key].h);
  for (const [g, list] of groups) {
    const tag = groups.length > 1 ? ` · ${groupName(setup, g)}` : '';
    const packed = packPlates(
      list.filter((it) => !parts[it.key].spiral),
      bed,
    );
    for (const o of packed.oversize) warnings.add(`${parts[o.key].name} is larger than the print bed and was left out.`);
    packed.plates.forEach((pl) => {
      // A plate of nothing but a board's attachments says so.
      const board = pl.placements.every((p) => parts[p.key].kind === 'attachment');
      const name = board ? `Board attachments ${(count.attachments = (count.attachments ?? 0) + 1)}` : `Bins ${++count.bins}`;
      out.push({ name: `${name}${tag}`, group: 'bins', placements: pl.placements, ...at });
    });
    // By height, a vase bin that changes colour prints alone: several on a plate print by object,
    // and Bambu Studio only makes per-layer changes on plates printed by layer.
    const vase = list.filter((it) => parts[it.key].spiral);
    const alone = strategyOf(setup) === 'height' ? vase.filter((it) => groupOf(it).includes('|')) : [];
    for (const batch of [vase.filter((it) => !alone.includes(it)), ...alone.map((it) => [it])]) {
      const plates = vasePlates(batch, parts, bed, printerId, warnings, count.vases, printer, tag);
      count.vases += plates.length;
      out.push(...plates);
    }
  }
  return out;
}

/**
 * The vase-mode bins among `items` on plates of their own (layout/spiral.ts),
 * numbered on from `first`.
 */
function vasePlates(
  items: PackItem[],
  parts: Record<string, JobPart>,
  bed: Pick<PackOptions, 'bedW' | 'bedD' | 'margin' | 'exclude'>,
  printerId: string,
  warnings: Set<string>,
  first: number,
  printer?: number,
  tag = '',
): JobPlate[] {
  const mine = items.filter((it) => parts[it.key].spiral).map((it) => ({ ...it, h: parts[it.key].h }));
  if (!mine.length) return [];
  const packed = packSpiral(mine, bed, spiralClearance(printerId));
  for (const o of packed.oversize) warnings.add(`${parts[o.key].name} is larger than the print bed and was left out.`);
  return packed.plates.map((pl, i) => ({
    name: `Vase bins ${first + i + 1}${tag}`,
    group: 'bins',
    placements: pl.placements,
    spiral: true,
    ...(printer === undefined ? {} : { printer }),
  }));
}

/**
 * Several printers (fleet.ts). Baseplate plates stay on the printer they're
 * split for, unless that's left to Gridfit and another printer takes the whole
 * plate and gets the job done sooner. Bins and the rest go one by one to the
 * printer that finishes them soonest (shareOut); a part only one printer takes
 * goes to it. Plates come printer by printer, each one's baseplate first.
 */
function sharePlates(
  setup: PrintSetup,
  parts: Record<string, JobPart>,
  plates: JobPlate[],
  binItems: PackItem[],
  drawerJobs: DrawerJob[],
  warnings: Set<string>,
  seconds?: PlanPrintOptions['seconds'],
  groupOf: (it: PackItem) => string = () => '',
): JobPlate[] {
  const EPS = 1e-6;
  const printers = jobPrinters(setup);
  const names = printerNames(setup);
  const baseAt = baseplatePrinter(setup);
  const pinned = baseplatePicked(setup);
  const motions = printers.map((p) => findPrinter(p.printerId).motion ?? DEFAULT_MOTION);
  const beds = printers.map((p) => ({ ...plateBed(p), spacing: Math.max(setup.spacing, 2), nest: true }));
  const time = (key: string, k: number) => seconds?.(parts[key], k) ?? roughSeconds(parts[key], motions[k]);
  const items: ShareItem[] = plates.map((pl, i) => {
    const tall = Math.max(0, ...pl.placements.map((p) => parts[p.key].h));
    // Another printer takes the whole plate when it fits its bed, clear of that printer's exclusion areas.
    const takes = (p: (typeof printers)[number], k: number) => k === baseAt || (tall <= p.maxH + EPS && !!movePlate(pl.placements, beds[k]));
    return {
      key: `#plate:${i}`,
      plate: true,
      area: 0,
      ...(pinned ? { pinned: baseAt } : {}),
      seconds: printers.map((p, k) => (takes(p, k) ? motions[k].prepare + pl.placements.reduce((t, q) => t + time(q.key, k), 0) : Infinity)),
    };
  });
  for (const it of binItems) {
    const h = parts[it.key].h;
    const seconds = printers.map((p, k) => (fitsOnBed(it.w, it.d, beds[k]) && h <= p.maxH + EPS ? time(it.key, k) : Infinity));
    items.push({ key: it.key, area: it.w * it.d, seconds });
  }
  const at = shareOut(items, printers.map((p, k) => ({ area: usableArea(p), prepare: motions[k].prepare })));
  const tallest = Math.max(...printers.map((p) => p.maxH));
  for (const it of binItems) {
    if (at.has(it.key)) continue;
    const p = parts[it.key];
    warnings.add(
      p.h > tallest + EPS
        ? `${p.name} is ${round(p.h)} mm tall, taller than any of the printers prints (${tallest} mm), and was left out.`
        : `${p.name} is too big for every printer and was left out.`,
    );
  }
  const out: JobPlate[] = [];
  const moved = new Map<number, number>();
  const count = { bins: 0, vases: 0 };
  printers.forEach((_, k) => {
    plates.forEach((pl, i) => {
      if (at.get(`#plate:${i}`) !== k) return;
      moved.set(i, out.length);
      if (k === baseAt) out.push({ ...pl, printer: k });
      // Centred on this printer's bed, as far as its exclusion areas let it (it takes the plate, so there is room).
      else out.push({ ...pl, printer: k, placements: movePlate(pl.placements, beds[k]) ?? pl.placements });
    });
    const mine = binItems.filter((it) => at.get(it.key) === k);
    if (!mine.length) return;
    out.push(...binPlates(setup, mine, parts, groupOf, beds[k], printers[k].printerId, warnings, count, k));
  });
  // The assembly map names the plate (and printer) each piece's plate ended up as.
  for (const dj of drawerJobs) {
    if (!dj.plateCount) continue;
    const now = Array.from({ length: dj.plateCount }, (_, i) => moved.get(dj.plateOffset + i)!);
    dj.plateNames = dj.plan.plates.map((_, i) => `Plate ${now[i] + 1} (${names[out[now[i]].printer ?? 0]})`);
    dj.plateOffset = Math.min(...now);
  }
  return out;
}

/** What a board's attachments add to a print job: their parts, meshes and drawer-view items (wall/parts.ts). */
export type WallParts = (a: {
  list: readonly PlacedAttachment[];
  board: WallBoard;
  drawer: string;
  prefix: string;
  label: string;
  bins: boolean;
  meshes: Record<string, MeshSpec>;
  parts: Record<string, JobPart>;
  binItems: PackItem[];
  items: EnclosureSceneItem[];
  warn: (msg: string) => void;
}) => WallPlacement[];

/**
 * A board's attachments' planning (wall/parts.ts hands it in as it loads, with the kinds): importing it here would put
 * the placing, the mount standard and the common options on the first screen.
 */
let wallParts: WallParts | null = null;
export function setWallParts(f: WallParts): void {
  wallParts = f;
}

/**
 * The attachments' builders (wall/build.ts), handed in by whoever builds meshes (the geometry
 * worker, the tests, the scripts): importing them here would pull every attachment kind's
 * planning onto the first screen with them (their planning registers itself; wall/ready.ts).
 */
let wallBuild: typeof WallBuild | null = null;
export function setWallBuilders(b: typeof WallBuild): void {
  wallBuild = b;
}
function wallBuilders(): typeof WallBuild {
  if (!wallBuild) throw new Error('Attachment builders not set (setWallBuilders).');
  return wallBuild;
}

/** Build a mesh with its footprint's min corner at the origin and its bottom at z = 0. */
export function buildMesh(w: Wasm, spec: MeshSpec): MeshData {
  if (spec.kind === 'split') return splitByRoles(w, buildMesh(w, spec.base), spec.base);
  if (spec.kind === 'piece') {
    if (spec.enclosure) return buildEnclosurePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors, spec.enclosure);
    const m = buildBaseplatePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors);
    return translateMesh(m, -spec.piece.x0, -spec.piece.y0, 0);
  }
  if (spec.kind === 'enclosure') return buildEnclosurePart(w, spec.part, spec.view);
  if (spec.kind === 'key') return buildConnectorKey(w);
  if (spec.kind === 'divider') return buildDividerInsert(w, spec.insert);
  if (spec.kind === 'label') return buildLabelPlate(w, spec.plate);
  if (spec.kind === 'qrPlate') return buildQrPlate(w, spec.plate);
  if (spec.kind === 'accessory') return buildAccessoryPart(w, spec.part);
  if (spec.kind === 'insertPart') return buildInsertPart(w, spec.part);
  if (spec.kind === 'imported') return buildImported(spec);
  if (spec.kind === 'attachment') return wallBuilders().buildAttachment(w, spec);
  if (spec.kind === 'attachmentPart') return wallBuilders().buildAttachmentPart(w, spec);
  if (spec.kind === 'container') {
    const def = containerDef(spec.type);
    if (!def?.buildPart) throw new Error(`No part builder for container type “${spec.type}”.`);
    return def.buildPart(w, spec.spec);
  }
  if (spec.kind === 'lid') {
    const { w: W, d: D } = lidSize(spec.opts, spec.cells);
    return translateMesh(buildBinLid(w, spec.opts, spec.cells), W / 2, D / 2, 0);
  }
  const m = buildBin(w, spec.opts, spec.cells);
  const { w: W, d: D } = binSize(spec.opts, spec.cells);
  return translateMesh(m, W / 2, D / 2, 0);
}

export type MeshLookup = (meshKey: string) => MeshData;

/** The mesh a spec describes, before any colour split ('split' specs: their base). */
export function baseSpec<S extends MeshSpec | undefined>(spec: S): Exclude<MeshSpec, { kind: 'split' }> | (S extends undefined ? undefined : never) {
  let s: MeshSpec | undefined = spec;
  while (s?.kind === 'split') s = s.base;
  return s as never;
}

/** A bin with tool pockets whose shadow-board floors print in filament 2 (shadowBoard.ts). */
function binHasShadow(spec: Extract<MeshSpec, { kind: 'bin' }>): boolean {
  const o = sanitizeBin(spec.opts);
  if (!wantsShadow(o) || activeContainer(o)) return false;
  if (o.interior === 'cutouts') return true;
  // Tool compartments that exist in this bin.
  return binLayout(o, spec.cells).compartments.some((c) => compartmentInside(o.layout?.comps?.[c.key]) === 'tools');
}

/**
 * True when a part on the job's plates may print in a second filament (inlaid
 * label text on a bin or a label plate, or shadow-board pocket floors). Planning
 * can't lay out text, so a label too small to print still counts.
 */
export function usesSecondFilament(job: PrintJob): boolean {
  for (const pl of job.plates) {
    for (const p of pl.placements) {
      const spec = baseSpec(job.meshes[job.parts[p.key].meshKey]);
      if (spec?.kind === 'bin' && binHasShadow(spec)) return true;
      if (spec?.kind === 'label' && spec.plate.style === 'inlaid' && spec.plate.text.trim()) return true;
      // Inlaid QR codes: on a plate, a stacking lid, a sliding lid (an inlaid one on the front wall is binUsesInlay's).
      if (spec?.kind === 'qrPlate' && spec.plate.spot.style === 'inlaid') return true;
      if (spec?.kind === 'lid' && planLidQr(spec.opts, spec.cells)?.spot?.style === 'inlaid') return true;
      if (spec?.kind === 'accessory' && spec.part.type === 'slideLid' && spec.part.qr?.style === 'inlaid') return true;
      // Inlaid tab text (with label plates it's on the plates, unless a tab is too small for one), two-tone or inlaid front labels.
      if (spec?.kind === 'bin' && binUsesInlay(spec.opts, spec.cells)) return true;
      // A board's inlaid zone text, an attachment's inlaid label or its kind's own inlays (wall/plan.ts).
      if (wallInlaid(spec)) return true;
    }
  }
  return false;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer';

/** Assembly maps for every drawer in the job, keyed by file name (none for a baseplate that's there already). */
export function assemblyMaps(job: PrintJob): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of job.drawers) {
    if (d.haveBaseplate) continue;
    const name = job.drawers.length > 1 ? `assembly-map-${slug(d.name)}.txt` : 'assembly-map.txt';
    const head = job.drawers.length > 1 ? `${d.name}\n` : '';
    if (d.map) {
      // A Skådis board's map, then the plates its tiles print on.
      const plates = d.plan.plates.map((pl, i) => `${d.plateNames?.[i] ?? `Plate ${d.plateOffset + i + 1}`}: ${pl.placements.map((p) => p.key.replace('piece:', 'tile ')).join(', ')}`);
      out[name] = head + d.map + 'PLATES\n' + '-'.repeat(40) + '\n' + plates.join('\n') + '\n';
      continue;
    }
    out[name] = head + assemblyMap(d.layout, d.plan, d.connectors.length, d.plateOffset, d.steps, d.plateNames);
  }
  return out;
}

/** With several printers, the folder a plate's file goes in, after its printer ("bambu-lab-a1-mini/"); else nothing. */
export function printerFolder(job: PrintJob, pl: JobPlate): string {
  return job.printers ? `${slug(job.printers[pl.printer ?? 0] ?? 'printer')}/` : '';
}

/** Just the plates for printer `k` (fleet.ts), e.g. for its own Bambu Studio project. */
export function jobForPrinter(job: PrintJob, k: number): PrintJob {
  return { ...job, plates: job.plates.filter((pl) => (pl.printer ?? 0) === k) };
}

/** Names of the parts on a plate, with connector keys, dividers and label plates counted rather than listed. */
export function plateContents(job: PrintJob, pl: JobPlate): string[] {
  const names: string[] = [];
  let keys = 0;
  let dividers = 0;
  let labels = 0;
  let pads = 0;
  for (const p of pl.placements) {
    const part = job.parts[p.key];
    if (part.kind === 'key') keys++;
    else if (part.kind === 'divider') dividers++;
    else if (part.kind === 'label') labels++;
    else if (part.kind === 'pad') pads++;
    else names.push(part.name);
  }
  if (keys) names.push(`${keys} connector key${keys === 1 ? '' : 's'}`);
  if (dividers) names.push(`${dividers} divider${dividers === 1 ? '' : 's'}`);
  if (labels) names.push(`${labels} label plate${labels === 1 ? '' : 's'}`);
  if (pads) names.push(`${pads} TPU non-slip pad${pads === 1 ? '' : 's'}`);
  return names;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** A height raised by `dz` (null stays null). */
const offset = (v: number | null, dz = 0) => (v === null ? null : v + dz);
