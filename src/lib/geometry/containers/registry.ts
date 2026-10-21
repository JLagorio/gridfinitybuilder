/**
 * Container types other than the plain bin: drawer units, parts boxes,
 * hoppers, tool racks, dispensers. A container is placed on the grid like a
 * bin (a PlacedBin with the same footprint, cells and height fields) and stands
 * on Gridfinity feet, but builds its own body and may print extra parts.
 *
 * Each type registers a ContainerDef here (see ./index.ts). Its options live in
 * `BinOptions.containers[kind]`, so switching type and back keeps them; only
 * `BinOptions.container` picks which one is active. Plain bins have neither
 * field, so old projects are unchanged.
 */
import type { MeshData, Wasm } from '../kernel';
import type { BinCells, BinOptions } from '../bin';

export type ContainerKind = 'bin' | 'drawers' | 'box' | 'hopper' | 'rack' | 'dispenser';
export type ContainerType = Exclude<ContainerKind, 'bin'>;

export const CONTAINER_KINDS: readonly ContainerKind[] = ['bin', 'drawers', 'box', 'hopper', 'rack', 'dispenser'];

/** An extra printed part of a container (a drawer, a lid, a follower…). */
export interface ContainerPart {
  /** Part key is `${slot}:${binId}:${index}`: unique per bin. */
  slot: string;
  index: number;
  name: string;
  /** Which kind of part it counts as (colour in the viewer, the BOM). */
  kind: 'bin' | 'lid' | 'tray' | 'divider';
  /** Mesh cache key: must change whenever the part's geometry does. */
  meshKey: string;
  /** Data for `buildPart` (structured-cloneable: it goes to the geometry worker). */
  spec: unknown;
  /** Footprint and height as printed. */
  w: number;
  d: number;
  h: number;
  /** Where it sits in the assembled drawer view: min corner from the container mesh's min corner and bottom. */
  assembled?: { x: number; y: number; z: number };
}

export interface ContainerDef<O = unknown> {
  kind: ContainerType;
  /** Name in the type picker ("Drawer unit"). */
  label: string;
  /** One line for the type picker. */
  description: string;
  defaults: O;
  /** Height (7 mm units) to start from when a bin is switched to this type and is shorter. */
  minHeightUnits?: number;
  /** Clean saved or edited options (`raw` may be anything, including undefined). */
  sanitize(raw: unknown, bin: BinOptions): O;
  /** Mesh-key text for the options (every geometry-affecting field). */
  key(o: O): string;
  /** Overall height of the main body, mm, from the bottom of the feet. */
  height(bin: BinOptions, o: O): number;
  /** Height with its parts in place (a closed lid), for the drawer-height check; defaults to `height`. */
  closedHeight?(bin: BinOptions, o: O): number;
  /**
   * The main body: centered on the origin in XY, bottom at z = 0, on
   * Gridfinity feet for `cells` (see ./base.ts). `bin` is already sanitized.
   */
  build(w: Wasm, bin: BinOptions, o: O, cells: BinCells): MeshData;
  /** Extra printed parts (drawers, lids, …). */
  parts?(bin: BinOptions, o: O, cells: BinCells): ContainerPart[];
  /** Build one of those parts: min corner at the origin, bottom at z = 0, in its print orientation. */
  buildPart?(w: Wasm, spec: unknown): MeshData;
  /** Short text for the bin's name ("3 drawers"), for these cells (42 mm units when left out). */
  summary?(bin: BinOptions, o: O, cells?: BinCells): string;
  /** Planning warnings (too short, too small, …). */
  notes?(bin: BinOptions, o: O, cells: BinCells): string[];
}

const DEFS = new Map<ContainerType, ContainerDef<unknown>>();

export function registerContainer<O>(def: ContainerDef<O>): void {
  DEFS.set(def.kind, def as ContainerDef<unknown>);
}

export function containerDef(kind: ContainerKind | undefined | null): ContainerDef<unknown> | null {
  return kind && kind !== 'bin' ? (DEFS.get(kind) ?? null) : null;
}

/** Registered types, in CONTAINER_KINDS order. */
export function containerDefs(): ContainerDef<unknown>[] {
  return CONTAINER_KINDS.flatMap((k) => (k !== 'bin' && DEFS.has(k) ? [DEFS.get(k)!] : []));
}

type ContainerFields = Pick<BinOptions, 'container' | 'containers'>;

/** The active container type and its cleaned options, or null for a plain bin (or a type that isn't registered). */
export function activeContainer(o: ContainerFields & Partial<BinOptions>): { def: ContainerDef<unknown>; opts: unknown } | null {
  const def = containerDef(o.container);
  if (!def) return null;
  return { def, opts: def.sanitize(o.containers?.[def.kind], o as BinOptions) };
}

export function isContainer(o: ContainerFields): boolean {
  return !!containerDef(o.container);
}

/** The container fields of sanitized bin options: both undefined for plain bins (so spreading them clears bad values). */
export function sanitizeContainerFields(o: ContainerFields & Partial<BinOptions>): ContainerFields {
  const out: ContainerFields = { container: undefined, containers: undefined };
  const kind = CONTAINER_KINDS.includes(o.container as ContainerKind) ? o.container : undefined;
  if (kind && kind !== 'bin') out.container = kind;
  if (o.containers && typeof o.containers === 'object') {
    const all: Partial<Record<ContainerType, unknown>> = {};
    for (const [k, v] of Object.entries(o.containers)) {
      const def = containerDef(k as ContainerType);
      // Options of types that aren't registered (yet) are kept as they are.
      if (CONTAINER_KINDS.includes(k as ContainerKind) && k !== 'bin') all[k as ContainerType] = def ? def.sanitize(v, o as BinOptions) : v;
    }
    if (Object.keys(all).length) out.containers = all;
  }
  return out;
}

/** Mesh-key part for the active container ([] for plain bins). */
export function containerKeyPart(o: ContainerFields & Partial<BinOptions>): string[] {
  const c = activeContainer(o);
  return c ? [`K${c.def.kind}{${c.def.key(c.opts)}}`] : [];
}
