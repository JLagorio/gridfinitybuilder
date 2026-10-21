import { computeLayout } from '../lib/layout/drawer';
import { canPlace, newId, withBlocked } from '../lib/bins';
import { findSpot } from '../lib/binLayout';
import { usableBeds } from '../lib/bedfit';
import { followFootprint } from '../lib/stacking';
import { withContents } from '../lib/inventory';
import { EXTERNAL_COLORS, NAME_MAX, cleanExternal, externalOpts, meshSize, type ExternalBin, type MeshRef } from '../lib/external';
import type { PlacedBin } from '../lib/project';
import { history, useStore } from './store';

/**
 * Store actions for bins from elsewhere (lib/external.ts): add a placeholder
 * or an imported mesh, rename, recolour, print or not, turn a mesh 90°.
 * Everything goes through the store, so undo/redo covers it; the mesh bytes
 * stay out of it (imported/meshStore.ts).
 */

const state = () => useStore.getState();

export interface NewExternal {
  name: string;
  color?: string;
  /** Footprint in cells of the active drawer's grid. */
  unitsX: number;
  unitsY: number;
  /** Placeholders: height in 7 mm units, without the lip. */
  heightUnits?: number;
  /** Its top takes a bin (a stacking lip). */
  stackable?: boolean;
  mesh?: MeshRef;
  /** Imported meshes: print it with my bins. */
  print?: boolean;
  contents?: string;
  /** Preferred front-left cell; else the first free spot. */
  at?: [number, number];
}

/** The placed bin for a bin from elsewhere (not yet in the drawer). */
export function externalBin(n: NewExternal, x = 0, y = 0): PlacedBin {
  const external = cleanExternal({ name: n.name, color: n.color ?? EXTERNAL_COLORS[0], mesh: n.mesh, print: n.print })!;
  const h = external.mesh ? meshSize(external.mesh).h : undefined;
  const bin: PlacedBin = { id: newId(), x, y, opts: externalOpts({ unitsX: n.unitsX, unitsY: n.unitsY, heightUnits: n.heightUnits, heightMm: h, stackable: n.stackable }), external };
  return n.contents?.trim() ? withContents(bin, n.contents) : bin;
}

/**
 * Put a bin from elsewhere in the active drawer, at `at` when it fits there,
 * else at the first free spot; a mesh that only fits turned 90° is turned.
 * Selects it. Returns its id (and whether it was turned), or why it can't go in.
 */
export function addExternal(n: NewExternal): { id: string; turned?: boolean; error?: undefined } | { id?: undefined; error: string } {
  const s = state();
  const layout = computeLayout(s.drawer);
  const taken = withBlocked(s.bins, layout.mask);
  const spot = (w: number, d: number) => findSpot(taken, [{ dx: 0, dy: 0, opts: { ...s.newBin, unitsX: w, unitsY: d } }], layout.nx, layout.ny, n.at ? [n.at] : []);
  let turned = false;
  let at = spot(n.unitsX, n.unitsY);
  let m = n;
  if (!at && n.mesh && n.unitsX !== n.unitsY) {
    at = spot(n.unitsY, n.unitsX);
    if (at) {
      turned = true;
      m = { ...n, unitsX: n.unitsY, unitsY: n.unitsX, mesh: { ...n.mesh, rotate: !n.mesh.rotate } };
    }
  }
  if (!at) return { error: `No free spot for ${n.unitsX} × ${n.unitsY} cells in this drawer: make room first (or pick a smaller footprint).` };
  const bin = externalBin(m, at[0], at[1]);
  history.checkpoint();
  useStore.setState({ bins: [...s.bins, bin], ui: { ...s.ui, tab: 'bins', binPane: 'drawer', selectedBinId: bin.id, selectedBinIds: [bin.id] } });
  history.checkpoint();
  return turned ? { id: bin.id, turned } : { id: bin.id };
}

/** Change a bin from elsewhere's name, colour or printing. */
export function setExternal(id: string, patch: Partial<Pick<ExternalBin, 'name' | 'color' | 'print'>>): void {
  const s = state();
  const b = s.bins.find((x) => x.id === id);
  if (!b?.external) return;
  const next = cleanExternal({ ...b.external, ...patch, ...(patch.name !== undefined ? { name: patch.name.slice(0, NAME_MAX) } : {}) })!;
  if (JSON.stringify(next) === JSON.stringify(b.external)) return;
  useStore.setState({ bins: s.bins.map((x) => (x.id === id ? { ...x, external: next } : x)) });
}

/**
 * Turn an imported mesh 90° on the drawer floor: its footprint turns with it
 * (a stack on it too). False, and nothing changes, when the turned footprint
 * doesn't fit where it is.
 */
export function turnMesh(id: string): boolean {
  const s = state();
  const b = s.bins.find((x) => x.id === id);
  const m = b?.external?.mesh;
  if (!b || !m) return false;
  const layout = computeLayout(s.drawer);
  const r = { x: b.x, y: b.y, w: b.opts.unitsY, d: b.opts.unitsX };
  if (!b.on && !canPlace(withBlocked(s.bins, layout.mask), r, layout.nx, layout.ny, b.id)) return false;
  const turned: PlacedBin = { ...b, opts: { ...b.opts, unitsX: r.w, unitsY: r.d }, external: { ...b.external!, mesh: { ...m, rotate: !m.rotate } } };
  const next = s.bins.map((x) => (x.id === id ? turned : x));
  const out = followFootprint(s.bins, next, id, layout, usableBeds(s.setup));
  if (out === s.bins) return false;
  useStore.setState({ bins: out });
  return true;
}
