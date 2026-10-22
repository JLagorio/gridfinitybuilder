/**
 * The wall planner's data (components/WallPlanner.tsx): one wall measured for
 * the whole project, what's in the way on it (a window, a door, a socket), and
 * where the project's Skådis boards and wall grids hang on it. Millimetres from
 * the wall's bottom-left corner, y up, as a board sees its own front
 * (lib/wall/plan.ts). Kept small: the store cleans it on every load, so it is
 * on the first screen; the planning (lib/wallPlanner/layout.ts) isn't.
 */

/** Something on the wall a board mustn't cover. */
export interface WallObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** A board or wall grid (a drawer of the project, by id) on the wall, by its bottom-left corner. */
export interface WallItem {
  drawerId: string;
  x: number;
  y: number;
}

export interface WallPlan {
  width: number;
  height: number;
  /** Boards snap this far apart, and this far from what's in the way. */
  gap: number;
  obstacles: WallObstacle[];
  items: WallItem[];
}

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10 : d;
};
const at = (v: unknown) => num(v, -20000, 40000, 0);
const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, n) : []);

/**
 * A saved wall (a project file, a share link, autosave) made valid; undefined when there is none. Each drawer is on
 * it once, and, given the project's `drawers`, only drawers it has.
 */
export function cleanWall(v: unknown, drawers?: readonly { id: string }[]): WallPlan | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const w = v as Record<string, unknown>;
  const seen = new Set<string>();
  return {
    width: num(w.width, 100, 20000, 2000),
    height: num(w.height, 100, 20000, 1200),
    gap: num(w.gap, 0, 500, 10),
    obstacles: list(w.obstacles, 50).map((o) => ({
      x: at(o.x),
      y: at(o.y),
      w: num(o.w, 1, 20000, 100),
      h: num(o.h, 1, 20000, 100),
      label: (typeof o.label === 'string' && o.label.trim().slice(0, 40)) || 'In the way',
    })),
    items: list(w.items, 200)
      .filter((i) => {
        const id = i.drawerId;
        return typeof id === 'string' && !!id && id.length <= 64 && !seen.has(id) && (!drawers || drawers.some((d) => d.id === id)) && !!seen.add(id);
      })
      .map((i) => ({ drawerId: i.drawerId as string, x: at(i.x), y: at(i.y) })),
  };
}
