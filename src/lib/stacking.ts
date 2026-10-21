/**
 * Bins stacked on bins (`PlacedBin.on`): a second layer in a deep drawer.
 *
 * - Gridfinity stacking only locates a bin by the perimeter lip of the bin
 *   under it, so a stacked bin always has its base's footprint (same cells,
 *   same stretch). A stack is a column standing on one floor bin, any number
 *   of levels high, one bin per level.
 * - The bin below must take a bin: a stacking lip, a stacking lid (its top has
 *   a receptacle per cell), or a container whose top has a lip or
 *   receptacles. No pocket-grid lid, no sliding lid (it needs the lip off),
 *   not stretched over the margin (its lip no longer matches the grid, as for
 *   lids), not on a wall grid.
 * - A stack moves and resizes as one, whichever of its bins is dragged or
 *   sized; copying, cutting and deleting a bin takes the bins on it along
 *   (store.ts, state/selection.ts).
 * - Stacked bins take no floor space of their own (bins.ts: canPlace and
 *   occupancy skip them), since their base already covers their cells.
 *
 * Heights: every top that takes bins ends LIP_HEIGHT − LIP_TOP_FLAT (4 mm)
 * above where its receptacle starts. A stacking lip is open underneath, so a
 * foot drops LID_SEAT_DROP (0.35 mm) further, to where the 45° faces meet
 * (lid.ts): it sinks BASE_PROFILE_HEIGHT − LIP_TOP_FLAT = 4.35 mm into the bin
 * below (a bin's lip, a drawer unit's or hopper's). Sockets with a floor (a
 * stacking lid's, a drawer unit's bin sockets, a parts box lid's) stop the
 * foot at their floor, 4 mm down. A flat-based bin has no feet and rests on
 * top.
 *
 * Pure: no store, no DOM.
 */
import { MIN_HEIGHT_UNITS, binLabel, binTotalHeight, sanitizeBin, type BinOptions } from './geometry/bin';
import { activeContainer } from './geometry/containers';
import type { BoxOptions } from './geometry/containers/box';
import type { DrawerUnitOptions } from './geometry/containers/drawers';
import type { HopperOptions } from './geometry/containers/hopper';
import { LID_SEAT_DROP, hasLid, lidStackHeight } from './geometry/lid';
import { isPocketLid } from './geometry/pocketLid';
import { lipRise } from './geometry/variants';
import type { GridLayout } from './layout/drawer';
import { binCellsAt, binStretched, type PlacedBin } from './project';
import { bedOvershoot, placedOvershoot, type Bed } from './bedfit';
import { carryContents } from './inventory';
import { newId } from './bins';

const EPS = 1e-6;

/** How far a bin's feet sink into the stacking lip of the bin under it, mm: 4.35. */
export const STACK_SINK = lipRise({ lip: true }) + LID_SEAT_DROP;
/** How far they sink into sockets with a floor (a stacking lid's, a drawer unit's or a parts box lid's): they stand on it, 4 mm down. */
export const SOCKET_SINK = lipRise({ lip: true });

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export interface Stacks {
  /** Each floor bin's column, floor bin first (just the bin when nothing's on it). */
  columns: Map<string, PlacedBin[]>;
  /** Each bin's level: 0 = on the floor. */
  level: Map<string, number>;
  /** The floor bin each bin stands on (itself for a floor bin). */
  root: Map<string, string>;
  /** Most bins in one column (1 = nothing stacked). */
  depth: number;
}

/** The drawer's stacks. Links to missing bins count as the floor; a second bin on the same base and loops are ignored. */
export function stacksOf(bins: readonly PlacedBin[]): Stacks {
  const byId = new Map(bins.map((b) => [b.id, b]));
  const child = new Map<string, PlacedBin>();
  for (const b of bins) if (b.on && b.on !== b.id && byId.has(b.on) && !child.has(b.on)) child.set(b.on, b);
  const columns = new Map<string, PlacedBin[]>();
  const level = new Map<string, number>();
  const root = new Map<string, string>();
  const walk = (r: PlacedBin) => {
    const col: PlacedBin[] = [];
    for (let b: PlacedBin | undefined = r; b && !level.has(b.id); b = child.get(b.id)) {
      level.set(b.id, col.length);
      root.set(b.id, r.id);
      col.push(b);
    }
    columns.set(r.id, col);
  };
  for (const b of bins) if (!b.on || !byId.has(b.on) || child.get(b.on) !== b) walk(b);
  // Whatever only a loop reaches stands on the floor.
  for (const b of bins) if (!level.has(b.id)) walk(b);
  let depth = 1;
  for (const c of columns.values()) depth = Math.max(depth, c.length);
  return { columns, level, root, depth };
}

/** The column a bin is in, floor bin first. */
export function columnOf(bins: readonly PlacedBin[], id: string, st: Stacks = stacksOf(bins)): PlacedBin[] {
  return st.columns.get(st.root.get(id) ?? id) ?? [];
}

/** The ids, plus every bin stacked above any of them (in `bins` order). */
export function withBinsAbove(bins: readonly PlacedBin[], ids: readonly string[]): string[] {
  const st = stacksOf(bins);
  const want = new Set<string>();
  for (const id of ids) {
    const col = columnOf(bins, id, st);
    const at = st.level.get(id);
    if (at === undefined) want.add(id);
    else for (const b of col.slice(at)) want.add(b.id);
  }
  return bins.filter((b) => want.has(b.id)).map((b) => b.id);
}

/** The bins, plus the bins stacked above them. */
export function binsWithAbove(bins: readonly PlacedBin[], sel: readonly PlacedBin[]): PlacedBin[] {
  const ids = new Set(withBinsAbove(bins, sel.map((b) => b.id)));
  return bins.filter((b) => ids.has(b.id));
}

/** Every bin in the columns of these bins: what moves when they move. */
export function columnIds(bins: readonly PlacedBin[], ids: readonly string[]): string[] {
  const st = stacksOf(bins);
  const roots = new Set(ids.map((id) => st.root.get(id) ?? id));
  return bins.filter((b) => roots.has(st.root.get(b.id) ?? b.id)).map((b) => b.id);
}

const sameStretch = (a: PlacedBin['stretch'], b: PlacedBin['stretch']) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function sameFootprint(a: PlacedBin, b: PlacedBin): boolean {
  return a.x === b.x && a.y === b.y && a.opts.unitsX === b.opts.unitsX && a.opts.unitsY === b.opts.unitsY && sameStretch(a.stretch, b.stretch);
}

/** `b` with `from`'s footprint: place, cells and stretch (contents follow the compartments). */
function withFootprint(b: PlacedBin, from: PlacedBin): PlacedBin {
  if (sameFootprint(b, from)) return b;
  const { stretch: _, ...rest } = b;
  const opts = b.opts.unitsX === from.opts.unitsX && b.opts.unitsY === from.opts.unitsY ? b.opts : sanitizeBin({ ...b.opts, unitsX: from.opts.unitsX, unitsY: from.opts.unitsY });
  const out: PlacedBin = { ...rest, x: from.x, y: from.y, opts, ...(from.stretch ? { stretch: { ...from.stretch } } : {}) };
  return opts !== b.opts && b.compContents ? carryContents({ ...out, opts: b.opts }, opts) : out;
}

/** Every stacked bin given its floor bin's footprint. Unchanged bins (and the array, when nothing changes) stay as they are. */
export function alignStacks(bins: PlacedBin[]): PlacedBin[] {
  const st = stacksOf(bins);
  const byId = new Map(bins.map((b) => [b.id, b]));
  let changed = false;
  const out = bins.map((b) => {
    const r = byId.get(st.root.get(b.id) ?? b.id)!;
    const next = r === b ? b : withFootprint(b, r);
    if (next !== b) changed = true;
    return next;
  });
  return changed ? out : bins;
}

/**
 * Stack links from a saved file, made consistent: links to missing bins (or
 * to itself) are dropped, loops broken, a second bin on the same base goes on
 * top of that stack, and every stacked bin gets its floor bin's footprint.
 */
export function cleanStacks(bins: PlacedBin[]): PlacedBin[] {
  const ids = new Set(bins.map((b) => b.id));
  const linked = bins.map((b): PlacedBin => {
    if (b.on === undefined) return b;
    const { on, ...rest } = b;
    return typeof on === 'string' && on !== b.id && ids.has(on) ? { ...rest, on } : rest;
  });
  // Each floor bin's tree, flattened into one column: depth first, in file order.
  const kids = new Map<string, PlacedBin[]>();
  for (const b of linked) if (b.on) kids.set(b.on, [...(kids.get(b.on) ?? []), b]);
  const below = new Map<string, string | undefined>();
  const seen = new Set<string>();
  const flatten = (r: PlacedBin) => {
    let prev: string | undefined;
    const visit = (b: PlacedBin) => {
      if (seen.has(b.id)) return;
      seen.add(b.id);
      below.set(b.id, prev);
      prev = b.id;
      for (const k of kids.get(b.id) ?? []) visit(k);
    };
    visit(r);
  };
  for (const b of linked) if (!b.on) flatten(b);
  // A loop has no floor bin: it stands on the first of its bins.
  for (const b of linked) if (!seen.has(b.id)) flatten({ ...b, on: undefined });
  const out = linked.map((b) => {
    const on = below.get(b.id);
    if (on === b.on) return b;
    const { on: _, ...rest } = b;
    return on ? { ...rest, on } : rest;
  });
  return alignStacks(out);
}

/** Copies with fresh ids; links between them follow. */
export function withNewIds(bins: PlacedBin[]): PlacedBin[] {
  const ids = new Map(bins.map((b) => [b.id, newId()]));
  return bins.map((b) => {
    const c: PlacedBin = { ...structuredClone(b), id: ids.get(b.id)! };
    if (b.on) c.on = ids.get(b.on) ?? b.on;
    return c;
  });
}

// ---------------------------------------------------------------------------
// Heights
// ---------------------------------------------------------------------------

/** Height of a bin as it stands in the drawer: with its stacking lid, or a container's lid, in place. */
export function standingHeight(o: BinOptions, stretched = false): number {
  const c = activeContainer(o);
  if (c) return c.def.closedHeight?.(sanitizeBin(o), c.opts) ?? binTotalHeight(o);
  // Stretched bins get no lid (project.ts).
  return hasLid(o) && !stretched ? lidStackHeight(o) : binTotalHeight(o);
}

/** How far the feet of a bin stacked on this one sink below its top: into a lip, or onto the floor of its sockets. */
export function topSink(o: BinOptions, stretched = false): number {
  const c = activeContainer(o);
  if (c?.def.kind === 'drawers') return (c.opts as DrawerUnitOptions).top === 'lip' ? STACK_SINK : SOCKET_SINK;
  if (c?.def.kind === 'box') return SOCKET_SINK;
  if (c) return STACK_SINK;
  return hasLid(o) && !stretched ? SOCKET_SINK : STACK_SINK;
}

/** Where the bottom of `above` sits, measured from the bottom of `below`. */
export function seatHeight(below: BinOptions, above: Pick<BinOptions, 'base'>, belowStretched = false): number {
  return standingHeight(below, belowStretched) - (above.base === 'flat' ? 0 : topSink(below, belowStretched));
}

export interface StackPlace {
  /** Bottom of the bin above the baseplate floor its column stands on, mm. */
  z: number;
  /** Its top (lid or container parts in place). */
  top: number;
  /** 0 = on the floor. */
  level: number;
}

/** Where every bin stands: bottom and top above the baseplate floor, and its level. */
export function stackPlaces(layout: GridLayout, bins: readonly PlacedBin[]): Map<string, StackPlace> {
  const out = new Map<string, StackPlace>();
  for (const col of stacksOf(bins).columns.values()) {
    let z = 0;
    col.forEach((b, i) => {
      const stretched = binStretched(layout, b);
      if (i > 0) z += seatHeight(col[i - 1].opts, b.opts, binStretched(layout, col[i - 1]));
      out.set(b.id, { z, top: z + standingHeight(b.opts, stretched), level: i });
    });
  }
  return out;
}

/** Height of a column from the baseplate floor to its top bin's top. */
export function columnHeight(layout: GridLayout, col: readonly PlacedBin[]): number {
  return stackPlaces(layout, col).get(col[col.length - 1]?.id)?.top ?? 0;
}

/** The tallest bin or stack above its seat, for sizing a carry case (no layout: nothing counts as stretched). */
export function tallestStack(bins: readonly { opts: BinOptions; id?: string; on?: string }[]): number {
  const placed = bins.map((b, i) => ({ id: b.id ?? `#${i}`, x: 0, y: 0, opts: b.opts, ...(b.on ? { on: b.on } : {}) }));
  let top = 0;
  for (const col of stacksOf(placed).columns.values()) {
    let z = 0;
    col.forEach((b, i) => {
      if (i > 0) z += seatHeight(col[i - 1].opts, b.opts);
      top = Math.max(top, z + standingHeight(b.opts));
    });
  }
  return top;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Why a bin can't take a bin on top, in a short sentence about "it" (null when it can). */
export function stackProblem(layout: GridLayout, b: PlacedBin, wall = false): string | null {
  if (wall) return 'Bins on a wall grid don’t stack.';
  const c = activeContainer(b.opts);
  if (c) {
    if (c.def.kind === 'drawers') return (c.opts as DrawerUnitOptions).top === 'flat' ? 'Its flat top can’t hold a bin: give it a stacking lip or bin sockets on top.' : null;
    if (c.def.kind === 'box') return (c.opts as BoxOptions).top === 'flat' ? 'Its flat lid can’t hold a bin: give the lid a grid or lip top.' : null;
    if (c.def.kind === 'hopper') return (c.opts as HopperOptions).lip ? null : 'It has no stacking lip.';
    return `A ${c.def.label.toLowerCase()} has no stacking lip.`;
  }
  if (!b.opts.lip) return 'It has no stacking lip.';
  if (binStretched(layout, b)) return 'It reaches over the margin, so its lip no longer matches the grid.';
  if (hasLid(b.opts) && isPocketLid(b.opts)) return 'Its pocket-grid lid can’t hold a bin.';
  return null;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Planning warnings: stacks on bins that can't hold them, and stacks taller than the room above the baseplate floor. */
export function stackWarnings(layout: GridLayout, bins: readonly PlacedBin[], room: number, wall = false): string[] {
  const out: string[] = [];
  const places = stackPlaces(layout, bins);
  for (const col of stacksOf(bins).columns.values()) {
    if (col.length < 2) continue;
    for (const b of col.slice(0, -1)) {
      const why = stackProblem(layout, b, wall);
      if (why) out.push(`Bin ${binLabel(b.opts, binCellsAt(layout, b))} can’t hold the bin stacked on it. ${why}`);
    }
    const top = places.get(col[col.length - 1].id)!.top;
    // Bins too tall on their own already have a warning (project.ts).
    const alone = col.every((b) => places.get(b.id)!.top - places.get(b.id)!.z <= room + EPS);
    if (top > room + EPS && alone) {
      out.push(`The stack on bin ${binLabel(col[0].opts, binCellsAt(layout, col[0]))} is ${round(top)} mm tall, taller than the drawer (${round(room)} mm of room above the baseplate floor).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * A stack has one footprint. After `id` was edited (`prev` → `next`), the
 * other bins in its column take its new place, cells and stretch. If any of
 * them would then fit the print bed worse than before, nothing changes.
 */
export function followFootprint(prev: PlacedBin[], next: PlacedBin[], id: string, layout: GridLayout, bed: Bed): PlacedBin[] {
  const was = prev.find((b) => b.id === id);
  const now = next.find((b) => b.id === id);
  if (!was || !now || sameFootprint(was, now)) return next;
  const col = new Set(columnOf(prev, id).map((b) => b.id));
  if (col.size < 2) return next;
  const out = next.map((b) => (b.id !== id && col.has(b.id) ? withFootprint(b, now) : b));
  const worse = out.some((b, i) => b !== next[i] && placedOvershoot(layout, b, bed) > placedOvershoot(layout, next[i], bed) + EPS);
  return worse ? prev : out;
}

/**
 * The bin "Stack a bin on this" adds on top of `below`'s column: the new-bin
 * settings with the column's footprint, as tall as the bin below, lowered (in
 * 7 mm units) until the stack fits under `room` and the bin fits the printer.
 */
export function binForStack(
  layout: GridLayout,
  bins: readonly PlacedBin[],
  below: PlacedBin,
  newBin: BinOptions,
  bed: Bed,
  room = Infinity,
  wall = false,
): { bin: PlacedBin; error?: undefined } | { bin?: undefined; error: string } {
  const col = columnOf(bins, below.id);
  const top = col[col.length - 1] ?? below;
  const why = stackProblem(layout, top, wall);
  if (why) return { error: why };
  const base = sanitizeBin(top.opts);
  const opts = sanitizeBin({
    ...newBin,
    cutouts: undefined,
    unitsX: base.unitsX,
    unitsY: base.unitsY,
    heightMode: base.heightMode,
    heightUnits: base.heightUnits,
    heightMm: base.heightMm,
  });
  if (opts.interior === 'cutouts') opts.interior = 'compartments';
  const bin: PlacedBin = { id: newId(), x: col[0].x, y: col[0].y, opts, on: top.id, ...(col[0].stretch ? { stretch: { ...col[0].stretch } } : {}) };
  const cells = binCellsAt(layout, bin);
  if (bedOvershoot({ ...opts, heightUnits: MIN_HEIGHT_UNITS, heightMode: 'units' }, cells, bed) > EPS) {
    return { error: 'A bin this size is too big for the printer: shrink the bin below first.' };
  }
  const z = (stackPlaces(layout, col).get(top.id)?.z ?? 0) + seatHeight(top.opts, opts, binStretched(layout, top));
  const fits = (o: BinOptions) => z + standingHeight(o) <= room + EPS && bedOvershoot(o, cells, bed) <= EPS;
  let o = opts;
  if (!fits(o) && o.heightMode !== 'units') o = sanitizeBin({ ...o, heightMode: 'units' });
  while (!fits(o) && o.heightUnits > MIN_HEIGHT_UNITS) o = sanitizeBin({ ...o, heightUnits: o.heightUnits - 1 });
  if (!fits(o)) return { error: `No room on top: the stack would be ${round(z + standingHeight(o))} mm tall, and the drawer has ${round(room)} mm above the baseplate floor.` };
  return { bin: { ...bin, opts: o } };
}
