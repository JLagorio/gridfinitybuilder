/**
 * The wall planner's data (components/WallPlanner.tsx): one wall measured for
 * the whole project, what's in the way on it (a window, a door, a socket), and
 * where the project's Skådis boards and wall grids hang on it. Millimetres from
 * the wall's bottom-left corner, y up, as a board sees its own front
 * (lib/wall/plan.ts). Kept small: the store cleans it on every load, so it is
 * on the first screen; the planning (lib/wallPlanner/layout.ts) isn't, nor is
 * the photo of the wall (lib/wallPlanner/photo.ts cleans that where it's used).
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

/**
 * A photo of the wall behind the plan (lib/wallPlanner/photo.ts), lined up by four corners of something rectangular
 * on it whose size is known: the wall's own corners, or a sheet of paper taped to it.
 */
export interface WallPhoto {
  /**
   * Content hash of the photo, a JPEG (lib/wallPlanner/photoStore.ts): its bytes are in this browser's storage and in
   * saved project files, never in share links. '' when it stayed behind (a project opened from a share link).
   */
  hash: string;
  /** The file it came from. */
  name: string;
  /** Its size, px. */
  w: number;
  h: number;
  /** Where the four corners are in the photo, px from its top left (y down): top left, top right, bottom right, bottom left as on the wall. */
  corners: [number, number][];
  /** What the corners mark: the wall's own corners, or a sheet of paper on it. */
  ref: 'wall' | 'paper';
  /** The sheet, upright or long side across. */
  paper: 'a4' | 'letter';
  across: boolean;
  /** The sheet's bottom-left corner on the wall, mm. */
  at: [number, number];
  /** How strongly it shows behind the boards, 0.1 … 1. */
  opacity: number;
  hidden: boolean;
}

export interface WallPlan {
  width: number;
  height: number;
  /** Boards snap this far apart, and this far from what's in the way. */
  gap: number;
  obstacles: WallObstacle[];
  items: WallItem[];
  photo?: WallPhoto;
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
    ...(list([w.photo], 1).length ? { photo: w.photo as WallPhoto } : {}),
  };
}
