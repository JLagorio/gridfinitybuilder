import { useEffect, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '../lib/geometry/kernel';
import type { SkadisPlan } from '../lib/geometry/skadis';
import type { WallBoard, WallPlacement } from '../lib/wall/plan';
import { useStore, useUnits } from '../state/store';
import { addTile, removeTile } from '../state/skadisTiles';
import { isTouch, useCoarsePointer } from './touch';
import { FINGER_PX, atLeastPx, useMmPerPx } from './wallTouch';
import { asDrawer, type PrintJob } from '../lib/project';
// Loaded with the board's kinds and planning, as the board editor is (lib/printedBoards.ts goes with them).
import '../lib/wall/kinds/all';
import { markText, markTitle, partMarks } from '../lib/printedBoards';
import './boardTiles.css';

type Grid = NonNullable<SkadisPlan['grid']>;

/** A tile's neighbours: six round a hexagon (axial), four round a rectangle. */
const AROUND: Record<'hex' | 'rect', Vec2[]> = {
  hex: [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ],
  rect: [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ],
};

/**
 * A board built from tiles (SkadisPlan.grid) seen from the front, on its board
 * tab: its tiles, a "+" wherever one more can go round its edge (click it to
 * add the tile), and a ✕ on each tile to take it away (or click the tile and
 * press Delete). Its slots and attachments show faintly behind, so it's clear
 * what is on which tile; an attachment a tile taken away leaves without its
 * slots shows red. With `job` (the drawer's view), a tile printed already has a
 * ✓ in its corner, one changed since it was printed a dot (lib/printed.ts). On a
 * touch screen the ✕ grows to a fingertip's size, a tile is picked by a tap (a press
 * that pans or pinches the page picks nothing), and the page still pans and zooms over it.
 */
export function BoardTiles({ grid, board, placed, hex, job }: { grid: Grid; board: WallBoard; placed: WallPlacement[]; hex: boolean; job?: PrintJob }) {
  const [sel, setSel] = useState<string | null>(null);
  // Printed, or changed since (lib/printedBoards.ts): the tiles are the board's pieces, in the same order.
  const record = useStore((s) => s.printed);
  const drawerId = useStore((s) => s.activeDrawerId);
  const marks = useMemo(() => (job ? partMarks(asDrawer(job, drawerId), record) : {}), [job, drawerId, record]);
  const markOf = (i: number) => marks[`piece:${job?.drawers[0]?.plan.pieces[i]?.id}`];
  const { fmt } = useUnits();
  const place = ([q, r]: Vec2): Vec2 => [grid.origin[0] + q * grid.q[0] + r * grid.r[0], grid.origin[1] + q * grid.q[1] + r * grid.r[1]];
  // Every tile is alike: the first one's outline about its place, and that outline's box (its middle and size).
  const at0 = place(grid.at[0]);
  const outline = board.outlines[0].map(([x, y]): Vec2 => [x - at0[0], y - at0[1]]);
  const box = useMemo(() => {
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { mid: [(x0 + x1) / 2, (y0 + y1) / 2] as Vec2, w: x1 - x0, h: y1 - y0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.outlines, grid]);
  const ghosts = useMemo(() => {
    const seen = new Set(grid.at.map(String));
    const out: Vec2[] = [];
    for (const c of grid.at) {
      for (const d of AROUND[hex ? 'hex' : 'rect']) {
        const n: Vec2 = [c[0] + d[0], c[1] + d[1]];
        if (seen.has(String(n))) continue;
        seen.add(String(n));
        out.push(n);
      }
    }
    return out;
  }, [grid.at, hex]);
  const several = grid.at.length > 1;
  const svg = useRef<SVGSVGElement>(null);
  const coarse = useCoarsePointer();
  // The press under way is a finger's: tiles are picked, and the selection let go, by its tap.
  const finger = useRef(false);

  // Delete takes the selected tile away; Escape lets it go.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!sel || e.defaultPrevented || t.closest('input, textarea, select, [role="combobox"], [contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && several) {
        removeTile(sel.split(',').map(Number) as Vec2);
        setSel(null);
        e.preventDefault();
      } else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, several]);

  // The view: the board and every "+", a margin round.
  const M = Math.max(box.w, box.h) * 0.08;
  const pts = ghosts.flatMap((c) => outline.map(([x, y]) => [place(c)[0] + x, place(c)[1] + y]));
  const X0 = Math.min(0, ...pts.map((p) => p[0])) - M;
  const X1 = Math.max(board.W, ...pts.map((p) => p[0])) + M;
  const Y0 = Math.min(0, ...pts.map((p) => p[1])) - M;
  const Y1 = Math.max(board.H, ...pts.map((p) => p[1])) + M;
  // Board y is up; the screen's is down.
  const sy = (y: number) => Y1 + Y0 - y;
  const poly = (o: Vec2[], at: Vec2 = [0, 0]) => o.map(([x, y]) => `${at[0] + x},${sy(at[1] + y)}`).join(' ');
  const unit = Math.min(box.w, box.h);
  const slotPath = useMemo(() => {
    const w = board.ctx.slotW;
    const l = board.ctx.slotL;
    const r = w / 2;
    return board.slots.map(([x, y]) => `M${x - r},${sy(y) - l / 2 + r}a${r},${r} 0 0 1 ${w},0v${l - w}a${r},${r} 0 0 1 ${-w},0z`).join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.slots, board.ctx.slotW, board.ctx.slotL, Y0, Y1]);
  // A finger's ✕: drawn at least 22 px across, taking a press 40 px across.
  const mmPerPx = useMmPerPx(svg, [X0, X1, Y0, Y1]);
  const rx = coarse ? atLeastPx(unit * 0.06, 11, mmPerPx) : unit * 0.06;
  const rHit = coarse ? atLeastPx(rx, FINGER_PX / 2, mmPerPx) : 0;
  const what = hex ? 'hexagon' : 'tile';
  const n = grid.at.length;

  return (
    <>
      <div className="pane-head">
        <div className="pane-title">
          {n} {what}
          {n === 1 ? '' : 's'} · {fmt(board.W)} × {fmt(board.H)} · {coarse ? 'tap' : 'click'} + to add a {what}, ✕ to take one away
        </div>
      </div>
      <div className="board-tiles">
        <svg
          ref={svg}
          viewBox={`${X0} ${Y0} ${X1 - X0} ${Y1 - Y0}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDownCapture={(e) => (finger.current = isTouch(e))}
          onPointerDown={() => finger.current || setSel(null)}
          onClick={() => finger.current && setSel(null)}
          role="application"
          aria-label={`The board's ${what}s: + adds one, ✕ takes one away`}
        >
          {ghosts.map((c) => (
            <g
              key={String(c)}
              className="bt-ghost"
              role="button"
              aria-label={`Add a ${what} here`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => addTile(c)}
            >
              <title>Add a {what} here</title>
              <polygon points={poly(outline, place(c))} />
              <text x={place(c)[0] + box.mid[0]} y={sy(place(c)[1] + box.mid[1])} fontSize={unit * 0.28}>
                +
              </text>
            </g>
          ))}
          {board.outlines.map((o, i) => {
            const c = grid.at[i];
            const key = String(c);
            const m = markOf(i);
            return (
              <polygon
                key={key}
                className={`bt-tile${sel === key ? ' selected' : ''}`}
                points={poly(o)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (!finger.current) setSel(key);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(key);
                }}
              >
                {m && <title>{markTitle(m)}</title>}
              </polygon>
            );
          })}
          <path className="bt-slots" d={slotPath} />
          {placed.map((p) => (
            <rect key={p.id} className={`bt-att${p.ok ? '' : ' bad'}`} x={p.x0} y={sy(p.y1)} width={p.x1 - p.x0} height={p.y1 - p.y0} rx={2}>
              <title>{p.name}</title>
            </rect>
          ))}
          {grid.at.map((c, i) => {
            const m = markOf(i);
            if (!m) return null;
            const [x, y] = place(c);
            return (
              <text
                key={`m${String(c)}`}
                className={`pm-mark ${m}`}
                style={{ pointerEvents: 'none' }}
                x={x + box.mid[0] - box.w * (hex ? 0.3 : 0.42)}
                y={sy(y + box.mid[1] + box.h * (hex ? 0.28 : 0.42))}
                fontSize={unit * 0.1}
              >
                {markText(m)}
              </text>
            );
          })}
          {several &&
            grid.at.map((c) => {
              const [x, y] = place(c);
              const cx = x + box.mid[0];
              const cy = sy(y + box.mid[1] + box.h * 0.3);
              const r = rx;
              return (
                <g
                  key={String(c)}
                  className="bt-remove"
                  role="button"
                  aria-label={`Take this ${what} away`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    removeTile(c);
                    setSel(null);
                  }}
                >
                  <title>Take this {what} away</title>
                  {rHit > r && <circle className="bt-hit" cx={cx} cy={cy} r={rHit} />}
                  <circle cx={cx} cy={cy} r={r} />
                  <path d={`M${cx - r * 0.45},${cy - r * 0.45}l${r * 0.9},${r * 0.9}M${cx + r * 0.45},${cy - r * 0.45}l${-r * 0.9},${r * 0.9}`} />
                </g>
              );
            })}
        </svg>
      </div>
    </>
  );
}
