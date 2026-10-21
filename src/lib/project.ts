import { zipSync, strToU8 } from 'fflate';
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
import { buildBinLid, hasLid, lidKey, lidSize, lidStackHeight } from './geometry/lid';
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
import { DEFAULT_DRAWER, cellEdge, cellSizes, computeLayout, type DrawerInput, type GridLayout } from './layout/drawer';
import { effectiveStretch } from './layout/stretch';
import { fitsOnBed, packIntoPlates, packPlates, type PackItem, type Placement } from './layout/pack';
import {
  DEFAULT_SETUP,
  assemblyMap,
  connectorSteps,
  pieceFootprint,
  planBaseplate,
  type BaseplatePlan,
  type PlateLayout,
  type PrintSetup,
} from './layout/plan';
import type { PieceDef } from './layout/split';
import { writeBambuProject, type BambuPlate } from './export/bambu';
import { placeTransform, write3MF, type ExportObject } from './export/threemf';
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
  type EnclosureView,
  type PieceEnclosure,
} from './enclosures';

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
  /** Lift-out tray, sliding lid or rail plate (accessories.ts). */
  | { kind: 'accessory'; key: string; part: AccessoryPart }
  /** Lift-out cup or grid insert (cups.ts), or a baseplate's TPU pad (pads.ts). */
  | { kind: 'insertPart'; key: string; part: InsertPart }
  /** An extra part of a drawer unit, parts box, … (containers/). */
  | { kind: 'container'; key: string; type: ContainerType; spec: unknown }
  /** Case lid, hinge pin, handle, foot, spacer strip, wall cleat (enclosures.ts); `view` poses it for the drawer view. */
  | { kind: 'enclosure'; key: string; part: EnclosurePart; view?: EnclosureView };

export interface JobPart {
  key: string;
  name: string;
  kind: 'piece' | 'bin' | 'lid' | 'key' | 'divider' | 'label' | 'tray' | 'pad' | 'enclosure';
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
}

export interface JobPlate {
  name: string;
  group: 'baseplate' | 'bins';
  placements: Placement[];
  /** The printer it's for, with several (fleet.ts jobPrinters); unset: the first. */
  printer?: number;
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
  /** The assembly map's name for each of `plan.plates` when they aren't together from `plateOffset` (several printers). */
  plateNames?: string[];
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

export function pieceMeshKey(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []) {
  const id = o.pieceNumbers ? piece.id : 0; // numbered pieces are all different
  return `piece|${JSON.stringify([layout, piece.x0, piece.y0, piece.x1, piece.y1, piece.cells, piece.outer, o, connectors, id])}`;
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
 * The mesh spec for a placed bin. Label text that asks for `{contents}` is
 * filled in from what's in the bin here (labelContents.ts), so only then does
 * the key follow the contents.
 */
export function binSpec(layout: GridLayout, b: PlacedBin): Extract<MeshSpec, { kind: 'bin' }> {
  const cells = binCellsAt(layout, b);
  const opts = resolveContentLabels(b.opts, b);
  return { kind: 'bin', key: `bin|${binKey(opts, cells)}`, opts, cells };
}

/** True when the bin's body reaches over the margin where it is. */
export function binStretched(layout: GridLayout, b: PlacedBin): boolean {
  return hasStretch(binCellsAt(layout, b)?.stretch);
}

/** The mesh spec for a placed bin's stacking lid (lids depend only on the footprint; stretched bins get none). */
export function lidSpec(layout: GridLayout, b: PlacedBin): Extract<MeshSpec, { kind: 'lid' }> {
  const at = binCellsAt(layout, b);
  const cells = at && { x: at.x, y: at.y };
  return { kind: 'lid', key: `lid|${lidKey(b.opts, cells)}`, opts: b.opts, cells };
}

/**
 * Front-left corner of the bin's mesh (its body, stretch included) in plate
 * coordinates, for the assembled drawer: the feet sit on the bin's cells.
 */
export function binOrigin(layout: GridLayout, b: PlacedBin): { x: number; y: number } {
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
  const bed = { bedW: base.bedW, bedD: base.bedD, margin: base.plateMargin };
  // Parts printed already ("only what's changed").
  const keep = (it: PackItem) => !skip?.has(it.key);

  for (const d of drawers) {
    const prefix = multi ? `${d.id}/` : '';
    const label = multi ? `${d.name} · ` : '';
    const warn = (msg: string) => warnings.add(multi ? `${d.name}: ${msg}` : msg);
    const layout = computeLayout(d.drawer);
    // A carry case, wall grid or spacer strips plan their own floor pieces and extra parts (enclosures.ts).
    const enc = planEnclosure(d, layout, base);
    const pieceLayout = enc?.pieceLayout ?? layout;
    const bpo = enc?.baseplate ?? d.baseplate;
    const protrude = pieceProtrusion(bpo);
    let plan = enc?.plan ?? planBaseplate(layout, base, { protrude, skip: (p) => pieceIsVoid(layout, p) });
    if (plan.error && !enc) warn(plan.error);

    const bpH = baseplateHeight(bpo);
    const sites = connectorSites(pieceLayout, plan.pieces, bpo);
    // Only bowtie joints print keys; the others need nothing (pins, puzzle tabs) or hardware (screws).
    const connectors = bpo.connector === 'bowtie' ? sites : [];
    for (const piece of plan.pieces) {
      const key = `${prefix}piece:${piece.id}`;
      const mine = sitesOnPiece(sites, piece);
      const ep = enc?.piece(piece);
      const meshKey = pieceMeshKey(pieceLayout, piece, bpo, mine) + (ep ? `|enc${JSON.stringify(ep.enclosure)}` : '');
      meshes[meshKey] = { kind: 'piece', key: meshKey, layout: pieceLayout, piece, opts: bpo, connectors: mine, ...(ep ? { enclosure: ep.enclosure } : {}) };
      parts[key] = {
        key,
        name: `${label}${ep?.name ?? `Baseplate piece ${piece.id}`}`,
        kind: 'piece',
        meshKey,
        ...(ep ? { w: ep.w, d: ep.d } : pieceFootprint(piece, protrude)),
        h: ep?.h ?? bpH,
        drawer: d.id,
        pieceId: piece.id,
      };
    }
    const plateOffset = plates.length;
    if (include.baseplate) {
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
      const packed = packIntoPlates(piecePlates, keys.filter(keep), { ...bed, spacing: setup.spacing, nest: true });
      packed.plates.forEach((pl, i) => {
        plates.push({ name: `${label}${enc?.kind === 'case' ? 'Case body' : 'Baseplate'} ${i + 1}`, group: 'baseplate', placements: pl.placements });
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
      for (const msg of enc.warnings) warn(msg);
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
      if (include.baseplate && items.some(keep)) {
        const packed = packPlates(items.filter(keep), { ...bed, spacing: setup.spacing, nest: true });
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
    const steps = [...jointSteps(bpo, bpo.connector === 'bowtie' ? 0 : sites.length), ...(enc?.steps ?? [])];
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
    });

    // TPU pads (pads.ts) lift the whole plate a little.
    const lift = padStyle(bpo) ? PAD.proud : 0;
    const room = enc ? enc.room - lift : d.drawer.mode === 'drawer' && d.drawer.height > 0 ? d.drawer.height - binSeatHeight(d.baseplate) - lift : Infinity;
    // Raised front labels stand proud of the 0.5 mm gap to the bin in front.
    const clashes = frontLabelClashes(
      d.bins,
      (x) => frontLabelBottom(binFrontLabel(resolveContentLabels(x.opts, x), binCellsAt(layout, x))),
      (x) => binTotalHeight(x.opts),
    );
    for (const b of clashes) {
      warn(`Bin ${binLabel(b.opts)}: its raised front label touches the bin in front of it (make it inlaid or engraved).`);
    }
    for (const b of d.bins) {
      const key = `${prefix}bin:${b.id}`;
      const spec = binSpec(layout, b);
      const { w, d: dd } = binSize(b.opts, spec.cells);
      const h = binTotalHeight(b.opts);
      meshes[spec.key] = spec;
      const front = binFrontLabel(spec.opts, spec.cells)?.segments.map((g) => g.text) ?? [];
      const texts = [...new Set([...binLabelTexts(spec.opts, spec.cells), ...front].map(labelPlainText).filter(Boolean))];
      const caption = texts.length ? ` “${texts.slice(0, 3).join(' · ').replace(/\n/g, ' ')}${texts.length > 3 ? ' …' : ''}”` : '';
      const binName = binLabel(b.opts, spec.cells);
      parts[key] = { key, name: `${label}Bin ${binName}${caption}`, kind: 'bin', meshKey: spec.key, w, d: dd, h, drawer: d.id };
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

  const several = printers.length > 1;
  // Parts taller than the printer prints are left out, like ones bigger than the bed (the editors keep new ones within both: bedfit.ts).
  const printable = binItems.filter(keep).filter((it) => {
    const p = parts[it.key];
    if (several || p.h <= setup.maxH + 1e-6) return true;
    warnings.add(`${p.name} is ${round(p.h)} mm tall, taller than the printer prints (${setup.maxH} mm), and was left out.`);
    return false;
  });
  if (several) plates.splice(0, plates.length, ...sharePlates(setup, parts, plates, printable, drawerJobs, warnings, opts.seconds));
  else if (printable.length) {
    const packed = packPlates(printable, { ...bed, spacing: Math.max(setup.spacing, 2), nest: true });
    for (const o of packed.oversize) warnings.add(`${parts[o.key].name} is larger than the print bed and was left out.`);
    packed.plates.forEach((pl, i) => plates.push({ name: `Bins ${i + 1}`, group: 'bins', placements: pl.placements }));
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
  };
}

/** Where a plate's parts are: their bounding box on the bed, mm. */
function plateBox(placements: Placement[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of placements) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + (p.rotated ? p.d : p.w));
    y1 = Math.max(y1, p.y + (p.rotated ? p.w : p.d));
  }
  return placements.length ? { x: x0, y: y0, w: x1 - x0, d: y1 - y0 } : { x: 0, y: 0, w: 0, d: 0 };
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
): JobPlate[] {
  const EPS = 1e-6;
  const printers = jobPrinters(setup);
  const names = printerNames(setup);
  const baseAt = baseplatePrinter(setup);
  const pinned = baseplatePicked(setup);
  const motions = printers.map((p) => findPrinter(p.printerId).motion ?? DEFAULT_MOTION);
  const beds = printers.map((p) => ({ bedW: p.bedW, bedD: p.bedD, margin: p.plateMargin, spacing: Math.max(setup.spacing, 2), nest: true }));
  const time = (key: string, k: number) => seconds?.(parts[key], k) ?? roughSeconds(parts[key], motions[k]);
  const items: ShareItem[] = plates.map((pl, i) => {
    const box = plateBox(pl.placements);
    const tall = Math.max(0, ...pl.placements.map((p) => parts[p.key].h));
    const takes = (p: (typeof printers)[number], k: number) =>
      k === baseAt || (box.w <= p.bedW - 2 * p.plateMargin + EPS && box.d <= p.bedD - 2 * p.plateMargin + EPS && tall <= p.maxH + EPS);
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
  let bins = 0;
  printers.forEach((_, k) => {
    plates.forEach((pl, i) => {
      if (at.get(`#plate:${i}`) !== k) return;
      moved.set(i, out.length);
      if (k === baseAt) out.push({ ...pl, printer: k });
      else {
        // Centred on this printer's bed.
        const box = plateBox(pl.placements);
        const dx = (beds[k].bedW - box.w) / 2 - box.x;
        const dy = (beds[k].bedD - box.d) / 2 - box.y;
        out.push({ ...pl, printer: k, placements: pl.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) });
      }
    });
    const mine = binItems.filter((it) => at.get(it.key) === k);
    if (!mine.length) return;
    const packed = packPlates(mine, beds[k]);
    packed.plates.forEach((pl) => out.push({ name: `Bins ${++bins}`, group: 'bins', placements: pl.placements, printer: k }));
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

/** Build a mesh with its footprint's min corner at the origin and its bottom at z = 0. */
export function buildMesh(w: Wasm, spec: MeshSpec): MeshData {
  if (spec.kind === 'piece') {
    if (spec.enclosure) return buildEnclosurePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors, spec.enclosure);
    const m = buildBaseplatePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors);
    return translateMesh(m, -spec.piece.x0, -spec.piece.y0, 0);
  }
  if (spec.kind === 'enclosure') return buildEnclosurePart(w, spec.part, spec.view);
  if (spec.kind === 'key') return buildConnectorKey(w);
  if (spec.kind === 'divider') return buildDividerInsert(w, spec.insert);
  if (spec.kind === 'label') return buildLabelPlate(w, spec.plate);
  if (spec.kind === 'accessory') return buildAccessoryPart(w, spec.part);
  if (spec.kind === 'insertPart') return buildInsertPart(w, spec.part);
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

function collectObjects(getMesh: MeshLookup) {
  const objects: ExportObject[] = [];
  const index = new Map<string, number>();
  const objectFor = (meshKey: string, name: string) => {
    let i = index.get(meshKey);
    if (i === undefined) {
      i = objects.length;
      objects.push({ name, mesh: getMesh(meshKey) });
      index.set(meshKey, i);
    }
    return i;
  };
  return { objects, objectFor };
}

export function exportBambuProject(
  job: PrintJob,
  setup: PrintSetup,
  getMesh: MeshLookup,
  projectSettings?: string,
): Uint8Array {
  const { objects, objectFor } = collectObjects(getMesh);
  const plates: BambuPlate[] = job.plates.map((pl) => ({
    name: pl.name,
    parts: pl.placements.map((p) => {
      const part = job.parts[p.key];
      return {
        object: objectFor(part.meshKey, part.name),
        name: part.name,
        transform: placeTransform(p.x, p.y, p.rotated, part.d),
      };
    }),
  }));
  return writeBambuProject({
    objects,
    plates,
    bedW: setup.bedW,
    bedD: setup.bedD,
    projectSettings,
    title: 'Gridfinity drawer',
    // Filament 2 prints inlaid label text.
    filamentColours: setup.labelColour ? [setup.labelColour.toUpperCase()] : undefined,
  });
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
      const spec = job.meshes[job.parts[p.key].meshKey];
      if (spec?.kind === 'bin' && binHasShadow(spec)) return true;
      if (spec?.kind === 'label' && spec.plate.style === 'inlaid' && spec.plate.text.trim()) return true;
      // Inlaid tab text (with label plates it's on the plates, unless a tab is too small for one), two-tone or inlaid front labels.
      if (spec?.kind === 'bin' && binUsesInlay(spec.opts, spec.cells)) return true;
    }
  }
  return false;
}

export function exportPlate3MF(job: PrintJob, plateIndex: number, getMesh: MeshLookup): Uint8Array {
  const pl = job.plates[plateIndex];
  const { objects, objectFor } = collectObjects(getMesh);
  const items = pl.placements.map((p) => {
    const part = job.parts[p.key];
    return { object: objectFor(part.meshKey, part.name), transform: placeTransform(p.x, p.y, p.rotated, part.d) };
  });
  return write3MF(objects, items, pl.name);
}

/** Single part, at the origin — for "download this bin". */
export function exportSingle3MF(name: string, mesh: MeshData): Uint8Array {
  return write3MF([{ name, mesh }], [{ object: 0, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }], name);
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer';

/** Assembly maps for every drawer in the job, keyed by file name. */
export function assemblyMaps(job: PrintJob): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of job.drawers) {
    const name = job.drawers.length > 1 ? `assembly-map-${slug(d.name)}.txt` : 'assembly-map.txt';
    const head = job.drawers.length > 1 ? `${d.name}\n` : '';
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

export function exportPlatesZip(job: PrintJob, setup: PrintSetup, getMesh: MeshLookup): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  job.plates.forEach((pl, i) => {
    const name = `${printerFolder(job, pl)}${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.3mf`;
    files[name] = [exportPlate3MF(job, i, getMesh), { level: 0 }];
  });
  for (const [name, text] of Object.entries(assemblyMaps(job))) files[name] = strToU8(text);
  files['README.txt'] = strToU8(readme(job, setup));
  return zipSync(files);
}

function readme(job: PrintJob, setup: PrintSetup) {
  const printer = findPrinter(setup.printerId);
  const keys = job.drawers.reduce((t, d) => t + d.connectors.length, 0);
  // Several printers: each with its plates, which are in a folder named after it.
  const on = (pl: JobPlate) => (job.printers ? `, on the ${job.printers[pl.printer ?? 0]}` : '');
  const printers = jobPrinters(setup).map((p, k) => {
    const mine = job.plates.map((pl, i) => ((pl.printer ?? 0) === k ? i + 1 : 0)).filter(Boolean);
    return `  ${job.printers?.[k]} (${p.bedW} × ${p.bedD} mm bed, ${p.plateMargin} mm edge margin): ${mine.length ? `plates ${mine.join(', ')}` : 'no plates'}`;
  });
  const lines = [
    'Gridfinity drawer kit generated by Gridfit',
    '',
    ...(job.printers ? ['Printers (each one\'s plates are in a folder named after it):', ...printers] : [`Printer: ${printer.name} (${setup.bedW} × ${setup.bedD} mm bed, ${setup.plateMargin} mm edge margin)`]),
    ...job.drawers.map(
      (d) =>
        `${d.name ? `${d.name}: ` : ''}baseplate ${round(d.layout.plateW)} × ${round(d.layout.plateD)} mm, ` +
        `${d.layout.nx} × ${d.layout.ny} cells, ${d.plan.pieces.length} pieces`,
    ),
    '',
    'Each .3mf file is one print plate with parts already arranged.',
    'Baseplate pieces are numbered; see the assembly map for where each one goes.',
    ...(keys ? ['', ...connectorSteps(keys)] : []),
    ...job.drawers.flatMap((d) => (d.steps.length ? ['', ...(job.drawers.length > 1 ? [`${d.name}:`] : []), ...d.steps] : [])),
    '',
    ...job.plates.map((pl, i) => `Plate ${i + 1} (${pl.name}${on(pl)}): ${plateContents(job, pl).join(', ')}`),
    '',
  ];
  return lines.join('\n');
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
