/**
 * Editing the wall planner's wall (Store.wall, lib/wallPlanner): its size and
 * gap, what's in the way, and where each board or wall grid hangs. Each edit is
 * one undo step. Also the planner's ways out: opening a board, adding one in
 * an empty area, and printing everything on the wall.
 */
import { allDrawers, history, useStore } from './store';
import { useWallView } from './wallView';
import { cleanWall, type WallObstacle, type WallPlan } from '../lib/wallPlanner/data';
import { DEFAULT_WALL, type Rect } from '../lib/wallPlanner/layout';
import { DEFAULT_SKADIS, type SkadisOptions } from '../lib/geometry/skadis';

/** The wall as it is (the default one before it's first changed). */
export const currentWall = (): WallPlan => useStore.getState().wall ?? DEFAULT_WALL;

function write(next: WallPlan) {
  history.checkpoint();
  useStore.setState({ wall: cleanWall(next) });
  history.checkpoint();
}

/** Change the wall's width, height or gap. */
export function setWall(patch: Partial<Pick<WallPlan, 'width' | 'height' | 'gap'>>) {
  write({ ...currentWall(), ...patch });
}

export function addObstacle(o: WallObstacle) {
  const w = currentWall();
  write({ ...w, obstacles: [...w.obstacles, o] });
}

export function updateObstacle(i: number, patch: Partial<WallObstacle>) {
  const w = currentWall();
  write({ ...w, obstacles: w.obstacles.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
}

export function removeObstacle(i: number) {
  const w = currentWall();
  write({ ...w, obstacles: w.obstacles.filter((_, k) => k !== i) });
}

/** Put a drawer on the wall with its bottom-left corner at (x, y), or move it there. */
export function placeOnWall(drawerId: string, x: number, y: number) {
  const w = currentWall();
  const was = w.items.find((i) => i.drawerId === drawerId);
  if (was && was.x === x && was.y === y) return;
  write({ ...w, items: was ? w.items.map((i) => (i === was ? { ...i, x, y } : i)) : [...w.items, { drawerId, x, y }] });
}

/** Put several on the wall at once (one undo step). */
export function placeAllOnWall(at: { drawerId: string; x: number; y: number }[]) {
  const w = currentWall();
  if (at.length) write({ ...w, items: [...w.items.filter((i) => !at.some((a) => a.drawerId === i.drawerId)), ...at] });
}

/** Take a drawer off the wall (the drawer itself stays in the project). */
export function removeFromWall(drawerId: string) {
  const w = currentWall();
  write({ ...w, items: w.items.filter((i) => i.drawerId !== drawerId) });
}

export const closeWallView = () => useWallView.getState().set(false);

/** Leave the planner for a drawer's first tab. */
export function openDrawer(id: string) {
  const s = useStore.getState();
  s.switchDrawer(id);
  s.setUI({ tab: 'drawer' });
  closeWallView();
}

/** The print tab, set to print these drawers ("Print everything on this wall"). */
export function printWall(ids: string[]) {
  const s = useStore.getState();
  s.setPrintScope('pick', ids);
  s.setUI({ tab: 'print' });
  closeWallView();
}

/** What a new board on the wall starts with: the settings of the project's last board (its slots, joints, standoffs), without its zones. */
export function boardSettings(): SkadisOptions {
  const last = allDrawers(useStore.getState())
    .filter((d) => d.drawer.enclosure === 'skadis')
    .pop()?.drawer.skadis;
  return { ...DEFAULT_SKADIS, ...last, zones: [] };
}

/**
 * A new Skådis board (`board`, with boardSettings) or wall grid (`grid`) the size of `r`, on the wall there, as one
 * undo step, then opened. A wall grid is given by its drawer size, so its plate fills the area less the clearance.
 */
export function addBoardHere(kind: 'board' | 'grid', r: Rect): string {
  const wall = currentWall();
  const like = boardSettings();
  history.checkpoint();
  const s = useStore.getState();
  const id = s.addDrawer(kind === 'grid' ? 'Wall grid' : undefined, { skadis: kind === 'board' });
  const t = useStore.getState();
  if (kind === 'board') {
    // It fills the area exactly (Board: Fill a space; its tab can switch it to tiles), even when new boards are built from tiles.
    t.setDrawer({ skadis: { ...like, layout: undefined, width: Math.round(r.w), height: Math.round(r.h) } });
  } else {
    t.setDrawer({ enclosure: 'wall', mode: 'drawer', width: Math.round(r.w), depth: Math.round(r.h) });
    // As the Drawer tab does when a wall grid is picked: bins stay on the wall by magnets.
    if (!t.drawer.halfGrid) t.setBaseplate({ magnets: true });
  }
  useStore.setState({ wall: cleanWall({ ...wall, items: [...wall.items, { drawerId: id, x: r.x, y: r.y }] }) });
  history.checkpoint();
  openDrawer(id);
  return id;
}
