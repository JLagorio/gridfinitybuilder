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
  binSize,
  binTotalHeight,
  buildBin,
  fullCells,
  type BinCells,
  type BinOptions,
} from './geometry/bin';
import {
  buildConnectorKey,
  connectorKeySize,
  connectorSites,
  sitesOnPiece,
  type ConnectorSite,
} from './geometry/connectors';
import { translateMesh, type MeshData, type Wasm } from './geometry/kernel';
import { DEFAULT_DRAWER, cellSizes, computeLayout, type DrawerInput, type GridLayout } from './layout/drawer';
import { packIntoPlates, packPlates, type PackItem, type Placement } from './layout/pack';
import {
  DEFAULT_SETUP,
  assemblyMap,
  connectorSteps,
  planBaseplate,
  type BaseplatePlan,
  type PlateLayout,
  type PrintSetup,
} from './layout/plan';
import type { PieceDef } from './layout/split';
import { writeBambuProject, type BambuPlate } from './export/bambu';
import { placeTransform, write3MF, type ExportObject } from './export/threemf';
import { findPrinter } from './printers';

/** A bin placed in the drawer grid. (x, y) is the front-left cell it covers. */
export interface PlacedBin {
  id: string;
  x: number;
  y: number;
  opts: BinOptions;
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
    }
  | { kind: 'bin'; key: string; opts: BinOptions; cells?: BinCells }
  | { kind: 'key'; key: string; opts: BaseplateOptions };

export interface JobPart {
  key: string;
  name: string;
  kind: 'piece' | 'bin' | 'key';
  meshKey: string;
  w: number;
  d: number;
  h: number;
  /** Drawer this part belongs to (multi-drawer jobs). */
  drawer?: string;
  /** Baseplate piece number. */
  pieceId?: number;
}

export interface JobPlate {
  name: string;
  group: 'baseplate' | 'bins';
  placements: Placement[];
}

/** One drawer's baseplate within a print job. */
export interface DrawerJob {
  id: string;
  name: string;
  layout: GridLayout;
  plan: BaseplatePlan;
  connectors: ConnectorSite[];
  /** Index of this drawer's first plate in the job. */
  plateOffset: number;
  /** Plates that hold this drawer's baseplate (and keys). */
  plateCount: number;
}

export interface PrintJob {
  /** The first (or only) drawer's layout, plan and connectors. */
  layout: GridLayout;
  plan: BaseplatePlan;
  /** One per connector key; empty when connectors are off. */
  connectors: ConnectorSite[];
  drawers: DrawerJob[];
  parts: Record<string, JobPart>;
  meshes: Record<string, MeshSpec>;
  plates: JobPlate[];
  warnings: string[];
}

export function pieceMeshKey(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []) {
  return `piece|${JSON.stringify([layout, piece.x0, piece.y0, piece.x1, piece.y1, piece.cells, piece.outer, o, connectors])}`;
}

/** Cell sizes under a bin, or undefined when it only covers full cells. */
export function binCellsAt(layout: GridLayout, b: PlacedBin): BinCells | undefined {
  const cells = {
    x: cellSizes(layout.xs, b.x, b.opts.unitsX, layout.pitchX),
    y: cellSizes(layout.ys, b.y, b.opts.unitsY, layout.pitchY),
  };
  return fullCells(cells) ? undefined : cells;
}

/** The mesh spec for a placed bin. */
export function binSpec(layout: GridLayout, b: PlacedBin): Extract<MeshSpec, { kind: 'bin' }> {
  const cells = binCellsAt(layout, b);
  return { kind: 'bin', key: `bin|${binKey(b.opts, cells)}`, opts: b.opts, cells };
}

/** Everything about the print except the geometry itself. Cheap; safe to call on every edit. */
export function planJob(state: ProjectState): PrintJob {
  return planPrint([{ id: '', name: '', drawer: state.drawer, baseplate: state.baseplate, bins: state.bins }], state.setup, state.include);
}

/**
 * Plan several drawers at once. Each drawer's baseplate gets its own plates;
 * bins from every drawer share plates. With one drawer, part keys are plain
 * (`piece:3`, `bin:<id>`); with several they're prefixed with the drawer id.
 */
export function planPrint(drawers: NamedDrawer[], setup: PrintSetup, include: ProjectState['include']): PrintJob {
  const multi = drawers.length > 1;
  const parts: Record<string, JobPart> = {};
  const meshes: Record<string, MeshSpec> = {};
  const plates: JobPlate[] = [];
  const warnings = new Set<string>();
  const drawerJobs: DrawerJob[] = [];
  const binItems: PackItem[] = [];
  const bed = { bedW: setup.bedW, bedD: setup.bedD, margin: setup.plateMargin };

  for (const d of drawers) {
    const prefix = multi ? `${d.id}/` : '';
    const label = multi ? `${d.name} · ` : '';
    const warn = (msg: string) => warnings.add(multi ? `${d.name}: ${msg}` : msg);
    const layout = computeLayout(d.drawer);
    const plan = planBaseplate(layout, setup);
    if (plan.error) warn(plan.error);

    const bpH = baseplateHeight(d.baseplate);
    const connectors = connectorSites(layout, plan.pieces, d.baseplate);
    for (const piece of plan.pieces) {
      const key = `${prefix}piece:${piece.id}`;
      const mine = sitesOnPiece(connectors, piece);
      const meshKey = pieceMeshKey(layout, piece, d.baseplate, mine);
      meshes[meshKey] = { kind: 'piece', key: meshKey, layout, piece, opts: d.baseplate, connectors: mine };
      parts[key] = {
        key,
        name: `${label}Baseplate piece ${piece.id}`,
        kind: 'piece',
        meshKey,
        w: piece.x1 - piece.x0,
        d: piece.y1 - piece.y0,
        h: bpH,
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
      const piecePlates: PlateLayout[] = plan.plates.map((pl) => ({
        placements: pl.placements.map((p) => ({ ...p, key: prefix + p.key })),
      }));
      const packed = packIntoPlates(piecePlates, keys, { ...bed, spacing: setup.spacing, nest: true });
      packed.plates.forEach((pl, i) => {
        plates.push({ name: `${label}Baseplate ${i + 1}`, group: 'baseplate', placements: pl.placements });
      });
      packed.extra.forEach((pl, i) => {
        const name = packed.extra.length > 1 ? `Connector keys ${i + 1}` : 'Connector keys';
        plates.push({ name: label + name, group: 'baseplate', placements: pl.placements });
      });
      if (packed.oversize.length) warn('Connector keys are larger than the print bed and were left out.');
    }
    drawerJobs.push({ id: d.id, name: d.name, layout, plan, connectors, plateOffset, plateCount: plates.length - plateOffset });

    const room = d.drawer.mode === 'drawer' && d.drawer.height > 0 ? d.drawer.height - binSeatHeight(d.baseplate) : Infinity;
    for (const b of d.bins) {
      const key = `${prefix}bin:${b.id}`;
      const spec = binSpec(layout, b);
      const { w, d: dd } = binSize(b.opts, spec.cells);
      const h = binTotalHeight(b.opts);
      meshes[spec.key] = spec;
      parts[key] = { key, name: `${label}Bin ${binLabel(b.opts)}`, kind: 'bin', meshKey: spec.key, w, d: dd, h, drawer: d.id };
      if (h > setup.maxH) warn(`Bin ${binLabel(b.opts)} is taller than the printer allows.`);
      if (h > room + 1e-6) warn(`Bin ${binLabel(b.opts)} is taller than the drawer (${round(room)} mm of room above the baseplate floor).`);
      if (include.bins) binItems.push({ key, w, d: dd });
    }
  }

  if (binItems.length) {
    const packed = packPlates(binItems, { ...bed, spacing: Math.max(setup.spacing, 2), nest: true });
    for (const o of packed.oversize) warnings.add(`${parts[o.key].name} is larger than the print bed and was left out.`);
    packed.plates.forEach((pl, i) => plates.push({ name: `Bins ${i + 1}`, group: 'bins', placements: pl.placements }));
  }
  const first = drawerJobs[0];
  return {
    layout: first.layout,
    plan: first.plan,
    connectors: first.connectors,
    drawers: drawerJobs,
    parts,
    meshes,
    plates,
    warnings: [...warnings],
  };
}

/** Build a mesh with its footprint's min corner at the origin and its bottom at z = 0. */
export function buildMesh(w: Wasm, spec: MeshSpec): MeshData {
  if (spec.kind === 'piece') {
    const m = buildBaseplatePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors);
    return translateMesh(m, -spec.piece.x0, -spec.piece.y0, 0);
  }
  if (spec.kind === 'key') return buildConnectorKey(w);
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
  });
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
    out[name] = head + assemblyMap(d.layout, d.plan, d.connectors.length, d.plateOffset);
  }
  return out;
}

export function exportPlatesZip(job: PrintJob, setup: PrintSetup, getMesh: MeshLookup): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  job.plates.forEach((pl, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.3mf`;
    files[name] = [exportPlate3MF(job, i, getMesh), { level: 0 }];
  });
  for (const [name, text] of Object.entries(assemblyMaps(job))) files[name] = strToU8(text);
  files['README.txt'] = strToU8(readme(job, setup));
  return zipSync(files);
}

function readme(job: PrintJob, setup: PrintSetup) {
  const printer = findPrinter(setup.printerId);
  const keys = job.drawers.reduce((t, d) => t + d.connectors.length, 0);
  const lines = [
    'Gridfinity drawer kit generated by Gridfit',
    '',
    `Printer: ${printer.name} (${setup.bedW} × ${setup.bedD} mm bed, ${setup.plateMargin} mm edge margin)`,
    ...job.drawers.map(
      (d) =>
        `${d.name ? `${d.name}: ` : ''}baseplate ${round(d.layout.plateW)} × ${round(d.layout.plateD)} mm, ` +
        `${d.layout.nx} × ${d.layout.ny} cells, ${d.plan.pieces.length} pieces`,
    ),
    '',
    'Each .3mf file is one print plate with parts already arranged.',
    'Baseplate pieces are numbered; see the assembly map for where each one goes.',
    ...(keys ? ['', ...connectorSteps(keys)] : []),
    '',
    ...job.plates.map((pl, i) => `Plate ${i + 1} (${pl.name}): ${plateContents(job, pl).join(', ')}`),
    '',
  ];
  return lines.join('\n');
}

/** Names of the parts on a plate, with connector keys counted rather than listed. */
export function plateContents(job: PrintJob, pl: JobPlate): string[] {
  const names: string[] = [];
  let keys = 0;
  for (const p of pl.placements) {
    const part = job.parts[p.key];
    if (part.kind === 'key') keys++;
    else names.push(part.name);
  }
  if (keys) names.push(`${keys} connector key${keys === 1 ? '' : 's'}`);
  return names;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
