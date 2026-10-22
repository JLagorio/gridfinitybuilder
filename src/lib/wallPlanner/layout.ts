/**
 * Planning a wall (components/WallPlanner.tsx, data in ./data.ts): which of the
 * project's drawers hang on a wall and how much of it each takes, where a
 * board being dragged snaps (the wall's edges, the other boards' and what's in
 * the way, a chosen gap apart or lined up), what's wrong with where they are
 * (off the wall, over a window, on top of each other), the empty area round a
 * point, and the first free place for a board. Wall millimetres from the
 * bottom-left corner, y up. Loads with the planner, not on the first screen.
 */
import type { DrawerInput } from '../layout/drawer';
import type { PrintSetup } from '../layout/plan';
import { clearAreas, plateBed } from '../layout/pack';
import { DEFAULT_SKADIS, plannedSkadis, planSkadis, sanitizeSkadis, type SkadisOptions } from '../geometry/skadis';
import type { PrintJob } from '../project';
import type { WallObstacle, WallPlan } from './data';

/** A wall to start from: two metres by 1.2, boards 10 mm apart. */
export const DEFAULT_WALL: WallPlan = { width: 2000, height: 1200, gap: 10, obstacles: [], items: [] };

/**
 * What's often in the way, at a usual size and height off the floor, kept inside the wall when added (a window no
 * more than `share` of a short wall's height: the rest of it is above the part measured).
 */
export const OBSTACLES: { label: string; w: number; h: number; y: number; title: string; share?: number }[] = [
  { label: 'Window', w: 1000, h: 1100, y: 900, share: 0.6, title: 'A window: 1 m wide, its sill 90 cm up' },
  { label: 'Door', w: 900, h: 2050, y: 0, title: 'A door and its frame: 90 cm wide' },
  { label: 'Socket', w: 85, h: 85, y: 300, title: 'A power socket (outlet), 30 cm up' },
  { label: 'Light switch', w: 85, h: 85, y: 1050, title: 'A light switch, 1.05 m up' },
  { label: 'Other', w: 200, h: 200, y: 0, title: 'Anything else in the way: a radiator, a pipe, a shelf' },
];

/** A rectangle on the wall: its bottom-left corner and size, mm. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A drawer on the wall, as the warnings name it. */
export interface WallBox extends Rect {
  id: string;
  name: string;
}

/** What a drawer is on a wall: a board attachments hang on, or a wall grid bins sit in. Drawers and cases aren't for a wall. */
export type WallKind = 'board' | 'grid';

/** By the drawer's enclosure (another pegboard system's board goes here as a 'board'). */
const KINDS: Partial<Record<string, WallKind>> = { skadis: 'board', wall: 'grid' };

export const wallKind = (d: Pick<DrawerInput, 'enclosure'>): WallKind | null => (d.enclosure && KINDS[d.enclosure]) || null;

/** How much of the wall a drawer takes, from its plan: a board the space it was made for, a wall grid its plate. */
export function footprint(job: PrintJob): { w: number; h: number } {
  const enc = job.drawers[0]?.enclosure;
  const board = enc?.wall?.board;
  if (board) return { w: board.W, h: board.H };
  if (enc?.box && enc.kind !== 'case') return { w: enc.box.x1 - enc.box.x0, h: enc.box.y1 - enc.box.y0 };
  return { w: job.layout.plateW, h: job.layout.plateD };
}

/** Whether two rectangles overlap by more than `slack` each way. */
export const overlaps = (a: Rect, b: Rect, slack = 0.5) =>
  a.x < b.x + b.w - slack && b.x < a.x + a.w - slack && a.y < b.y + b.h - slack && b.y < a.y + a.h - slack;

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/** Where a dragged board lands, and the edges it snapped to (to draw). */
export interface Snapped {
  x: number;
  y: number;
  guides: { x?: number; y?: number };
}

/**
 * Where a board dragged to `r` lands. Each axis snaps on its own to the nearest place within `tol`: flush with the
 * wall's edges; `gap` beside any of `others` (the other boards, what's in the way) or lined up with its edges.
 * Failing that, it falls on a `step` grid. `guides`: the edge each axis snapped to.
 */
export function snapRect(r: Rect, wall: Pick<WallPlan, 'width' | 'height'>, others: readonly Rect[], gap: number, tol: number, step = 5): Snapped {
  const axis = (pos: number, size: number, span: number, edges: [number, number][]) => {
    // Each place it could go, with the edge that puts it there.
    const at: [number, number][] = [
      [0, 0],
      [span - size, span],
    ];
    for (const [a, b] of edges) at.push([b + gap, b], [a - gap - size, a], [a, a], [b - size, b]);
    let best: [number, number] | null = null;
    for (const c of at) if (Math.abs(c[0] - pos) <= tol && (!best || Math.abs(c[0] - pos) < Math.abs(best[0] - pos))) best = c;
    return best ?? [Math.round(pos / step) * step, undefined];
  };
  const [x, gx] = axis(
    r.x,
    r.w,
    wall.width,
    others.map((o) => [o.x, o.x + o.w]),
  );
  const [y, gy] = axis(
    r.y,
    r.h,
    wall.height,
    others.map((o) => [o.y, o.y + o.h]),
  );
  return { x: r2(x), y: r2(y), guides: { ...(gx !== undefined ? { x: gx } : {}), ...(gy !== undefined ? { y: gy } : {}) } };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** "Window" → "window" (not "TV" → "tV"). */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** A planning warning, and the drawers it is about (drawn red). */
export interface WallWarning {
  ids: string[];
  text: string;
}

/** What's wrong with where the boards are: off the wall, over something in the way, on top of each other. */
export function wallWarnings(wall: Pick<WallPlan, 'width' | 'height' | 'obstacles'>, boxes: readonly WallBox[]): WallWarning[] {
  const out: WallWarning[] = [];
  for (const b of boxes) {
    const off = (
      [
        [-b.x, 'left'],
        [b.x + b.w - wall.width, 'right'],
        [b.y + b.h - wall.height, 'top'],
        [-b.y, 'bottom'],
      ] as [number, string][]
    ).filter(([d]) => d > 0.5);
    if (off.length)
      out.push({ ids: [b.id], text: `${b.name} runs off the wall: ${off.map(([d, side]) => `${Math.round(d)} mm past its ${side} edge`).join(', ')}.` });
    for (const o of wall.obstacles) if (overlaps(b, o)) out.push({ ids: [b.id], text: `${b.name} is over the ${lower(o.label)}.` });
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlaps(boxes[i], boxes[j])) out.push({ ids: [boxes[i].id, boxes[j].id], text: `${boxes[i].name} and ${boxes[j].name} overlap.` });
  return out;
}

/**
 * The biggest empty rectangle round the point (px, py): on the wall, and `gap` clear of each of `blocks` (the boards,
 * what's in the way). Null when the point is off the wall or on a block.
 */
export function freeArea(wall: Pick<WallPlan, 'width' | 'height'>, blocks: readonly Rect[], px: number, py: number, gap: number): Rect | null {
  const W = wall.width;
  const H = wall.height;
  if (px < 0 || py < 0 || px > W || py > H) return null;
  const bs = blocks.map((b) => grow(b, gap));
  if (bs.some((b) => px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h)) return null;
  const clampX = (v: number) => Math.min(W, Math.max(0, v));
  const xs = [...new Set([0, W, ...bs.flatMap((b) => [clampX(b.x), clampX(b.x + b.w)])])].sort((a, b) => a - b);
  let best: Rect | null = null;
  // Each span across (x0 … x1) round the point; the blocks across it bound it below and above.
  for (const x0 of xs.filter((x) => x <= px)) {
    for (const x1 of xs.filter((x) => x >= px && x > x0)) {
      let y0 = 0;
      let y1 = H;
      let blocked = false;
      for (const b of bs) {
        if (b.x >= x1 || b.x + b.w <= x0) continue;
        if (b.y + b.h <= py) y0 = Math.max(y0, b.y + b.h);
        else if (b.y >= py) y1 = Math.min(y1, b.y);
        else blocked = true;
      }
      if (blocked || y1 <= y0) continue;
      const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (!best || r.w * r.h > best.w * best.h + 1e-6) best = r;
    }
  }
  return best && { x: r2(best.x), y: r2(best.y), w: r2(best.w), h: r2(best.h) };
}

/** The first place, from the top left, where a w × h board fits on the wall `gap` clear of each of `blocks`. Null when there is none. */
export function autoPlace(
  wall: Pick<WallPlan, 'width' | 'height'>,
  blocks: readonly Rect[],
  w: number,
  h: number,
  gap: number,
): { x: number; y: number } | null {
  const W = wall.width;
  const H = wall.height;
  const xs = [0, ...blocks.flatMap((b) => [b.x + b.w + gap, b.x - gap - w])].filter((x) => x >= -1e-6 && x + w <= W + 1e-6).sort((a, b) => a - b);
  const ys = [H - h, 0, ...blocks.flatMap((b) => [b.y - gap - h, b.y + b.h + gap])].filter((y) => y >= -1e-6 && y + h <= H + 1e-6).sort((a, b) => b - a);
  const bs = blocks.map((b) => grow(b, gap));
  for (const y of ys) for (const x of xs) if (!bs.some((b) => overlaps({ x, y, w, h }, b, 1e-6))) return { x: r2(x), y: r2(y) };
  return null;
}

/** The drawers on the wall, in the project's order: what "Print everything on this wall" prints. */
export function wallDrawers<D extends { id: string }>(wall: Pick<WallPlan, 'items'> | undefined, drawers: readonly D[]): D[] {
  const on = new Set(wall?.items.map((i) => i.drawerId));
  return drawers.filter((d) => on.has(d.id));
}

/**
 * The biggest Skådis board, up to `area`, that prints in one piece on the printer: its width and height, mm.
 * `o`: the board's other settings (thickness, joints, …; their tabs take room on the bed).
 */
export function oneTile(area: { w: number; h: number }, setup: PrintSetup, o: Partial<SkadisOptions> = DEFAULT_SKADIS): { w: number; h: number } {
  const areas = clearAreas({ ...plateBed(setup), spacing: setup.spacing }).map((a) => ({ w: a.w, d: a.d }));
  const bed = Math.max(60, ...areas.map((a) => Math.max(a.w, a.d)));
  let w = Math.floor(Math.max(60, Math.min(area.w, bed)));
  let h = Math.floor(Math.max(60, Math.min(area.h, bed)));
  for (let i = 0; i < 400; i++) {
    const plan = planSkadis(plannedSkadis(sanitizeSkadis({ ...o, shape: 'rect', width: w, height: h })), areas);
    if (!plan.error && plan.tiles.length <= 1) break;
    if (w <= 60 && h <= 60) break;
    // The longer side gives first, 10 mm at a time.
    if (w >= h) w = Math.max(60, w - 10);
    else h = Math.max(60, h - 10);
  }
  return { w, h };
}

/** A new obstacle of a usual kind on this wall: its size and height kept inside the wall, centred across it. */
export function newObstacle(wall: Pick<WallPlan, 'width' | 'height'>, kind: (typeof OBSTACLES)[number]): WallObstacle {
  const w = Math.min(kind.w, wall.width);
  const h = r2(Math.min(kind.h, wall.height * (kind.share ?? 1)));
  return { label: kind.label, w, h, x: r2((wall.width - w) / 2), y: Math.min(kind.y, wall.height - h) };
}
