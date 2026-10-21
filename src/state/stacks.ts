import { computeLayout, type DrawerInput } from '../lib/layout/drawer';
import { withBlocked } from '../lib/bins';
import { besideGroup, findSpot, groupBounds, toClip } from '../lib/binLayout';
import { usableBed } from '../lib/bedfit';
import { planJob } from '../lib/project';
import { binForStack, binsWithAbove, columnOf } from '../lib/stacking';
import { sanitizeCase } from '../lib/geometry/case';
import { projectOf, useStore } from './store';

/**
 * Stacking actions for the Bins panel (stacking.ts has the rules). Everything
 * goes through the store, so undo/redo covers it.
 */

const state = () => useStore.getState();

/** Room a new stacked bin has above the baseplate floor, given the drawer's (DrawerJob.room): a carry case of automatic height grows to fit. */
export function roomForStack(drawer: DrawerInput, room = Infinity): number {
  return drawer.enclosure === 'case' && !(sanitizeCase(drawer.carryCase).height > 0) ? Infinity : room;
}

function drawerRoom(): number {
  const s = state();
  return roomForStack(s.drawer, planJob(projectOf(s)).drawers[0]?.room);
}

/**
 * "Stack a bin on this": a new bin on top of the bin's stack, with its
 * footprint and the new-bin settings, as tall as the bin below or as fits the
 * drawer and the printer. Selects it. Returns its id, or why it can't.
 */
export function stackBin(id: string): { id: string; error?: undefined } | { id?: undefined; error: string } {
  const s = state();
  const below = s.bins.find((b) => b.id === id);
  if (!below) return { error: 'No such bin.' };
  const r = binForStack(computeLayout(s.drawer), s.bins, below, s.newBin, usableBed(s.setup), drawerRoom(), s.drawer.enclosure === 'wall');
  if (!r.bin) return { error: r.error };
  useStore.setState({ bins: [...s.bins, r.bin], ui: { ...s.ui, selectedBinId: r.bin.id, selectedBinIds: [r.bin.id] } });
  return { id: r.bin.id };
}

/**
 * Take a stacked bin (with the bins on it) off its stack and put it on the
 * floor, in the nearest free spot beside the stack. False when there's none.
 */
export function unstackBin(id: string): boolean {
  const s = state();
  const bin = s.bins.find((b) => b.id === id);
  if (!bin?.on) return false;
  const layout = computeLayout(s.drawer);
  const lifted = binsWithAbove(s.bins, [bin]);
  const ids = new Set(lifted.map((b) => b.id));
  const clip = toClip(lifted.map((b) => (b.id === id ? { ...b, on: undefined } : b)));
  const rest = s.bins.filter((b) => !ids.has(b.id));
  const around = besideGroup(groupBounds(columnOf(s.bins, id).slice(0, 1)));
  const spot = findSpot(withBlocked(rest, layout.mask), clip, layout.nx, layout.ny, around);
  if (!spot) return false;
  const dx = spot[0] - bin.x;
  const dy = spot[1] - bin.y;
  useStore.setState({
    bins: s.bins.map((b) => {
      if (!ids.has(b.id)) return b;
      const moved = { ...b, x: b.x + dx, y: b.y + dy };
      if (b.id !== id) return moved;
      const { on: _, ...floor } = moved;
      return floor;
    }),
  });
  return true;
}
