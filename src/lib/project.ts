import { zipSync, strToU8 } from 'fflate';
import { DEFAULT_BASEPLATE, baseplateHeight, buildBaseplatePiece, type BaseplateOptions } from './geometry/baseplate';
import { DEFAULT_BIN, binKey, binLabel, binSize, binTotalHeight, buildBin, type BinOptions } from './geometry/bin';
import {
  buildConnectorKey,
  connectorKeySize,
  connectorSites,
  sitesOnPiece,
  type ConnectorSite,
} from './geometry/connectors';
import { translateMesh, type MeshData, type Wasm } from './geometry/kernel';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput, type GridLayout } from './layout/drawer';
import { packIntoPlates, packPlates, type PackItem, type Placement } from './layout/pack';
import {
  DEFAULT_SETUP,
  assemblyMap,
  connectorSteps,
  packOptions,
  planBaseplate,
  type BaseplatePlan,
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

export interface ProjectState {
  drawer: DrawerInput;
  baseplate: BaseplateOptions;
  setup: PrintSetup;
  bins: PlacedBin[];
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
  | { kind: 'bin'; key: string; opts: BinOptions }
  | { kind: 'key'; key: string; opts: BaseplateOptions };

export interface JobPart {
  key: string;
  name: string;
  kind: 'piece' | 'bin' | 'key';
  meshKey: string;
  w: number;
  d: number;
  h: number;
}

export interface JobPlate {
  name: string;
  group: 'baseplate' | 'bins';
  placements: Placement[];
}

export interface PrintJob {
  layout: GridLayout;
  plan: BaseplatePlan;
  /** One per connector key; empty when connectors are off. */
  connectors: ConnectorSite[];
  parts: Record<string, JobPart>;
  meshes: Record<string, MeshSpec>;
  plates: JobPlate[];
  warnings: string[];
}

export function pieceMeshKey(layout: GridLayout, piece: PieceDef, o: BaseplateOptions, connectors: ConnectorSite[] = []) {
  return `piece|${JSON.stringify([layout, piece.x0, piece.y0, piece.x1, piece.y1, piece.cells, piece.outer, o, connectors])}`;
}

/** Everything about the print except the geometry itself. Cheap; safe to call on every edit. */
export function planJob(state: ProjectState): PrintJob {
  const layout = computeLayout(state.drawer);
  const plan = planBaseplate(layout, state.setup);
  const parts: Record<string, JobPart> = {};
  const meshes: Record<string, MeshSpec> = {};
  const plates: JobPlate[] = [];
  const warnings: string[] = [];
  if (plan.error) warnings.push(plan.error);

  const bpH = baseplateHeight(state.baseplate);
  const connectors = connectorSites(layout, plan.pieces, state.baseplate);
  for (const piece of plan.pieces) {
    const key = `piece:${piece.id}`;
    const mine = sitesOnPiece(connectors, piece);
    const meshKey = pieceMeshKey(layout, piece, state.baseplate, mine);
    meshes[meshKey] = { kind: 'piece', key: meshKey, layout, piece, opts: state.baseplate, connectors: mine };
    parts[key] = {
      key,
      name: `Baseplate piece ${piece.id}`,
      kind: 'piece',
      meshKey,
      w: piece.x1 - piece.x0,
      d: piece.y1 - piece.y0,
      h: bpH,
    };
  }
  if (state.include.baseplate) {
    // Keys print in the free space next to the pieces; any that don't fit get their own plate.
    const keys: PackItem[] = [];
    if (connectors.length) {
      const meshKey = `key|${state.baseplate.connector}`;
      const size = connectorKeySize();
      meshes[meshKey] = { kind: 'key', key: meshKey, opts: state.baseplate };
      for (let i = 1; i <= connectors.length; i++) {
        const key = `key:${i}`;
        parts[key] = { key, name: `Connector key ${i}`, kind: 'key', meshKey, ...size };
        keys.push({ key, w: size.w, d: size.d });
      }
    }
    const packed = packIntoPlates(plan.plates, keys, packOptions(state.setup, { nest: true }));
    packed.plates.forEach((pl, i) => {
      plates.push({ name: `Baseplate ${i + 1}`, group: 'baseplate', placements: pl.placements });
    });
    packed.extra.forEach((pl, i) => {
      const name = packed.extra.length > 1 ? `Connector keys ${i + 1}` : 'Connector keys';
      plates.push({ name, group: 'baseplate', placements: pl.placements });
    });
    if (packed.oversize.length) warnings.push('Connector keys are larger than the print bed and were left out.');
  }

  if (state.include.bins && state.bins.length) {
    const items = [];
    for (const b of state.bins) {
      const key = `bin:${b.id}`;
      const meshKey = `bin|${binKey(b.opts)}`;
      const { w, d } = binSize(b.opts);
      const h = binTotalHeight(b.opts);
      meshes[meshKey] = { kind: 'bin', key: meshKey, opts: b.opts };
      parts[key] = { key, name: `Bin ${binLabel(b.opts)}`, kind: 'bin', meshKey, w, d, h };
      if (h > state.setup.maxH) warnings.push(`Bin ${binLabel(b.opts)} is taller than the printer allows.`);
      items.push({ key, w, d });
    }
    const packed = packPlates(items, packOptions(state.setup, { spacing: Math.max(state.setup.spacing, 2), nest: true }));
    for (const o of packed.oversize) warnings.push(`${parts[o.key].name} is larger than the print bed and was left out.`);
    packed.plates.forEach((pl, i) => plates.push({ name: `Bins ${i + 1}`, group: 'bins', placements: pl.placements }));
  }
  return { layout, plan, connectors, parts, meshes, plates, warnings };
}

/** Build a mesh with its footprint's min corner at the origin and its bottom at z = 0. */
export function buildMesh(w: Wasm, spec: MeshSpec): MeshData {
  if (spec.kind === 'piece') {
    const m = buildBaseplatePiece(w, spec.layout, spec.piece, spec.opts, spec.connectors);
    return translateMesh(m, -spec.piece.x0, -spec.piece.y0, 0);
  }
  if (spec.kind === 'key') return buildConnectorKey(w);
  const m = buildBin(w, spec.opts);
  const { w: W, d: D } = binSize(spec.opts);
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

export function exportPlatesZip(job: PrintJob, state: ProjectState, getMesh: MeshLookup): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  job.plates.forEach((pl, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${pl.name.toLowerCase().replace(/\s+/g, '-')}.3mf`;
    files[name] = [exportPlate3MF(job, i, getMesh), { level: 0 }];
  });
  files['assembly-map.txt'] = strToU8(assemblyMap(job.layout, job.plan, job.connectors.length));
  files['README.txt'] = strToU8(readme(job, state));
  return zipSync(files);
}

function readme(job: PrintJob, state: ProjectState) {
  const printer = findPrinter(state.setup.printerId);
  const lines = [
    'Gridfinity drawer kit generated by Gridfit',
    '',
    `Printer: ${printer.name} (${state.setup.bedW} × ${state.setup.bedD} mm bed, ${state.setup.plateMargin} mm edge margin)`,
    `Drawer: ${state.drawer.width} × ${state.drawer.depth} mm → baseplate ${round(job.layout.plateW)} × ${round(job.layout.plateD)} mm`,
    `Grid: ${job.layout.nx} × ${job.layout.ny} cells`,
    '',
    'Each .3mf file is one print plate with parts already arranged.',
    'Baseplate pieces are numbered; see assembly-map.txt for where each one goes.',
    ...(job.connectors.length ? ['', ...connectorSteps(job.connectors.length)] : []),
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
