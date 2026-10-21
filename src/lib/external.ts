/**
 * Bins from elsewhere (`PlacedBin.external`): bins Gridfit doesn't build.
 *
 * - A placeholder: a box of whole cells and 7 mm units for a bin you already
 *   have (bought, or printed before). It takes floor space, counts for
 *   stacking and the drawer's height, has a name, a colour and contents for
 *   Find and the drawer map, and is never printed.
 * - An imported mesh (STL, 3MF, OBJ; imported/parse.ts): its footprint in
 *   cells comes from its bounding box (imported/footprint.ts), it sits centred
 *   on those cells and the 3D view shows the mesh itself. "Print it with my
 *   bins" packs it onto the plates and exports it as it is; "I already have
 *   it" treats it like a placeholder.
 *
 * The bin's `opts` hold only its footprint (`unitsX`, `unitsY`, in cells) and
 * height (placeholders: `heightUnits`; meshes: `heightMode: 'external'` with
 * the mesh's height in `heightMm`), so the layout, stacking and height rules
 * work on them unchanged. `opts.lip` says whether its top takes a bin
 * ("stackable"): off by default, a flat top. Everything else stays at the
 * defaults and is never built.
 *
 * The mesh itself is never in the project state (persisted, undo snapshots,
 * share links): the bin holds its content hash, file name, size and triangle
 * count (MeshRef); the bytes are in IndexedDB and in saved project files
 * (imported/meshStore.ts).
 *
 * Pure: no store, no DOM.
 */
import { DEFAULT_BIN, binSize, binTotalHeight, sanitizeBin, type BinOptions } from './geometry/bin';
import { cellEdge, cellSizes, type GridLayout } from './layout/drawer';
import type { ImportedSpec } from './imported/registry';
import type { PlacedBin } from './project';
import { cleanSlot } from './colours';

export interface MeshRef {
  /** Content hash of the mesh bytes (imported/format.ts meshHash). */
  hash: string;
  /** The file it came from. */
  file: string;
  /** Bounding box, mm (x, y, z), as stored: before `rotate`. */
  size: [number, number, number];
  triangles: number;
  /** Turned 90° on the drawer floor (and so on the plate). */
  rotate?: boolean;
  /** A closed solid (imported/meshOps.ts isClosed). Open meshes still export, as triangles. */
  closed: boolean;
}

export interface ExternalBin {
  /** What it is ("Ammo can", "Bin from Printables"): on the grid, the drawer map and in Find. */
  name: string;
  /** Its colour on the grid and in the 3D view, #rrggbb. */
  color: string;
  /** An imported mesh; without one, a plain box. */
  mesh?: MeshRef;
  /** Imported meshes: print it with my bins. Off: I already have it (never printed). */
  print?: boolean;
}

/** Colours to pick from; the first is the default. */
export const EXTERNAL_COLORS = ['#6fa8c7', '#c79a62', '#86b97f', '#b98bb4', '#d1bd5c', '#9aa3b0', '#d27f6f'];

/** Most triangles the 3D view shows of one imported mesh (more are decimated for the view; exports keep them all). */
export const PREVIEW_TRIANGLES = 150_000;

export const NAME_MAX = 80;

type Bin = Pick<PlacedBin, 'external'>;

/** An imported mesh that prints with the bins. */
export const printsMesh = (b: Bin): boolean => !!b.external?.mesh && !!b.external.print;
/** Shown and counted, never printed: a placeholder, or a mesh you already have. */
export const isOwned = (b: Bin): boolean => !!b.external && !printsMesh(b);

/** The mesh's footprint and height as placed (turned or not), mm. */
export function meshSize(m: MeshRef): { w: number; d: number; h: number } {
  const [x, y, z] = m.size;
  return m.rotate ? { w: y, d: x, h: z } : { w: x, d: y, h: z };
}

/** `opts` for a bin from elsewhere: its footprint and height only (see the top of this file). */
export function externalOpts(o: { unitsX: number; unitsY: number; heightUnits?: number; heightMm?: number; stackable?: boolean; colour?: number }): BinOptions {
  const lip = !!o.stackable;
  // Multi-colour: an imported mesh that prints can have a filament slot of its own (colours.ts).
  const colour = cleanSlot(o.colour);
  const base = { ...DEFAULT_BIN, unitsX: o.unitsX, unitsY: o.unitsY, lip, lid: false, heightUnits: Math.max(1, Math.round(o.heightUnits ?? 3)), ...(colour ? { colour } : {}) };
  if (o.heightMm === undefined) return sanitizeBin({ ...base, heightMode: 'units' });
  return sanitizeBin({ ...base, heightMode: 'external', heightMm: Math.round(o.heightMm * 100) / 100 });
}

/**
 * The options of a bin from elsewhere after a change: it takes its footprint
 * and whether it's stackable (`lip`), a placeholder its height in units too;
 * nothing else (nothing Gridfit builds creeps in).
 */
export function patchExternalOpts(b: Pick<PlacedBin, 'external' | 'opts'>, p: Partial<BinOptions>): BinOptions {
  const m = b.external?.mesh;
  return externalOpts({
    unitsX: p.unitsX ?? b.opts.unitsX,
    unitsY: p.unitsY ?? b.opts.unitsY,
    heightUnits: (!m && p.heightUnits) || b.opts.heightUnits,
    heightMm: m && meshSize(m).h,
    stackable: p.lip ?? b.opts.lip,
    colour: 'colour' in p ? p.colour : b.opts.colour,
  });
}

/** The mesh spec for an imported bin: the whole mesh, or for the 3D view (`preview`) at most PREVIEW_TRIANGLES. */
export function importedSpec(b: PlacedBin, preview = false): ImportedSpec | null {
  const m = b.external?.mesh;
  if (!m) return null;
  const cap = preview && m.triangles > PREVIEW_TRIANGLES;
  return {
    kind: 'imported',
    key: `imported|${m.hash}${m.rotate ? '|r90' : ''}${cap ? `|view${PREVIEW_TRIANGLES}` : ''}`,
    hash: m.hash,
    name: b.external!.name,
    ...(m.rotate ? { rotate: true } : {}),
    ...(cap ? { maxTriangles: PREVIEW_TRIANGLES } : {}),
    ...(m.closed ? {} : { open: true as const }),
  };
}

/** The cells' outer edges, mm: x0, x1, y0, y1. */
function cellBox(layout: GridLayout, b: Pick<PlacedBin, 'x' | 'y' | 'opts'>) {
  return {
    x0: cellEdge(layout.xs, b.x, layout.pitchX),
    x1: cellEdge(layout.xs, b.x + b.opts.unitsX, layout.pitchX),
    y0: cellEdge(layout.ys, b.y, layout.pitchY),
    y1: cellEdge(layout.ys, b.y + b.opts.unitsY, layout.pitchY),
  };
}

/**
 * Where a bin from elsewhere is in the drawer: its front-left corner on the
 * plate, mm, and its size. A placeholder is as big as a bin on its cells; a
 * mesh sits centred on its cells.
 */
export function externalBox(layout: GridLayout, b: Pick<PlacedBin, 'x' | 'y' | 'opts' | 'external'>): { x: number; y: number; w: number; d: number; h: number } {
  const c = cellBox(layout, b);
  const m = b.external?.mesh;
  if (m) {
    const s = meshSize(m);
    return { x: (c.x0 + c.x1) / 2 - s.w / 2, y: (c.y0 + c.y1) / 2 - s.d / 2, ...s };
  }
  const cells = { x: cellSizes(layout.xs, b.x, b.opts.unitsX, layout.pitchX), y: cellSizes(layout.ys, b.y, b.opts.unitsY, layout.pitchY) };
  const { w, d } = binSize(b.opts, cells);
  return { x: (c.x0 + c.x1) / 2 - w / 2, y: (c.y0 + c.y1) / 2 - d / 2, w, d, h: binTotalHeight(b.opts) };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** "2×3×4u" or "2×3 · 46.4 mm" (footprint in 42 mm units, as binUnitsText). */
export function externalSize(b: Pick<PlacedBin, 'opts' | 'external'>, half = false): string {
  const u = (n: number) => (half ? n / 2 : n);
  const foot = `${u(b.opts.unitsX)}×${u(b.opts.unitsY)}`;
  return b.external?.mesh ? `${foot} · ${r1(meshSize(b.external.mesh).h)} mm` : `${foot}×${b.opts.heightUnits}u`;
}

/** What kind it is, in a few words: "bin you have", "imported, printed", "imported, you have it". */
export function externalKind(b: Bin): string {
  if (!b.external?.mesh) return 'bin you have';
  return b.external.print ? 'imported, printed' : 'imported, you have it';
}

/** "2×3×4u bin you have", for lists (inventory.ts desc, part names). */
export function externalLabel(b: Pick<PlacedBin, 'opts' | 'external'>, half = false): string {
  return `${externalSize(b, half)} ${externalKind(b)}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A saved `external` made safe (projects from files and share links); undefined when it isn't one. */
export function cleanExternal(v: unknown): ExternalBin | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const e = v as Record<string, unknown>;
  const out: ExternalBin = {
    name: typeof e.name === 'string' ? e.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '',
    color: typeof e.color === 'string' && HEX.test(e.color) ? e.color.toLowerCase() : EXTERNAL_COLORS[0],
  };
  const m = e.mesh as Record<string, unknown> | undefined;
  if (m && typeof m === 'object' && typeof m.hash === 'string' && /^[0-9a-f]{28}$/.test(m.hash)) {
    const size = Array.isArray(m.size) ? m.size.map(Number) : [];
    if (size.length === 3 && size.every((n) => Number.isFinite(n) && n > 0 && n < 5000)) {
      out.mesh = {
        hash: m.hash,
        file: typeof m.file === 'string' ? m.file.slice(0, 200) : '',
        size: size as [number, number, number],
        triangles: Math.max(0, Math.floor(Number(m.triangles) || 0)),
        closed: m.closed === true,
        ...(m.rotate === true ? { rotate: true } : {}),
      };
      if (e.print === true) out.print = true;
    }
  }
  return out;
}

/** A saved bin from elsewhere's options made safe: its footprint and height only (a mesh's height is the mesh's). */
export function cleanExternalOpts(raw: unknown, e: ExternalBin): BinOptions {
  const o = sanitizeBin({ ...DEFAULT_BIN, ...(raw && typeof raw === 'object' ? raw : {}) });
  return externalOpts({ unitsX: o.unitsX, unitsY: o.unitsY, heightUnits: o.heightUnits, heightMm: e.mesh ? meshSize(e.mesh).h : undefined, stackable: o.lip, colour: o.colour });
}
