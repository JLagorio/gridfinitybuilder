import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from '../lib/geometry/kernel';
import { slotKeys, snapAnchor, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import { moveAttachment, removeAttachment, selectAttachment } from '../state/wall';
import './wall.css';

/**
 * A Skådis board seen from the front, on its Attachments tab: the tiles, every
 * slot, and the attachments on it. Click one to select it, drag it to move it
 * (it snaps to slots where all its mounts fit), Delete removes it, the arrow
 * keys move it one slot over.
 */
export function WallEditor({ board, placed, selected }: { board: WallBoard; placed: WallPlacement[]; selected: string | null }) {
  const svg = useRef<SVGSVGElement>(null);
  const keys = useMemo(() => slotKeys(board.slots), [board.slots]);
  const [drag, setDrag] = useState<{ id: string; start: Vec2; from: Vec2; at: Vec2 | null } | null>(null);
  const M = 12;
  const W = Math.max(board.W, 1);
  const H = Math.max(board.H, 1);
  // Board y is up; the screen's is down.
  const sy = (y: number) => H - y;

  /** A pointer event in board millimetres. */
  const toBoard = (e: { clientX: number; clientY: number }): Vec2 => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return [p.x, H - p.y];
  };

  const snapFor = (p: WallPlacement, x: number, y: number) => snapAnchor(board.slots, keys, p.layout, board.ctx, x, y);

  const onDown = (e: ReactPointerEvent, p: WallPlacement) => {
    e.stopPropagation();
    selectAttachment(p.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: p.id, start: toBoard(e), from: [p.x, p.y], at: null });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = placed.find((q) => q.id === drag.id);
    if (!p) return;
    const now = toBoard(e);
    const at = snapFor(p, drag.from[0] + now[0] - drag.start[0], drag.from[1] + now[1] - drag.start[1]);
    if (at && (at[0] !== drag.at?.[0] || at[1] !== drag.at?.[1])) setDrag({ ...drag, at });
  };
  const onUp = () => {
    if (drag?.at) moveAttachment(drag.id, drag.at[0], drag.at[1]);
    setDrag(null);
  };

  // Keys: Delete, arrows (one slot along the row or column: two lattice steps).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selected || e.defaultPrevented || t.closest('input, textarea, select, [role="combobox"], [contenteditable]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeAttachment(selected);
        e.preventDefault();
        return;
      }
      const step = 2 * board.ctx.pitch;
      const d: Record<string, Vec2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const v = d[e.key];
      const p = placed.find((q) => q.id === selected);
      if (!v || !p) return;
      const at = snapFor(p, p.x + v[0], p.y + v[1]);
      if (at && keys.has(`${Math.round(at[0] * 100) / 100},${Math.round(at[1] * 100) / 100}`)) moveAttachment(p.id, at[0], at[1]);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Slots as one path (a board can have thousands).
  const slotPath = useMemo(() => {
    const w = board.ctx.slotW;
    const l = board.ctx.slotL;
    const r = w / 2;
    return board.slots.map(([x, y]) => `M${x - r},${sy(y) - l / 2 + r}a${r},${r} 0 0 1 ${w},0v${l - w}a${r},${r} 0 0 1 ${-w},0z`).join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.slots, board.ctx.slotW, board.ctx.slotL, H]);

  const shown = (p: WallPlacement): WallPlacement => {
    if (drag?.id !== p.id || !drag.at) return p;
    const dx = drag.at[0] - p.x;
    const dy = drag.at[1] - p.y;
    return {
      ...p,
      x: drag.at[0],
      y: drag.at[1],
      x0: p.x0 + dx,
      x1: p.x1 + dx,
      y0: p.y0 + dy,
      y1: p.y1 + dy,
      mounts: p.mounts.map((m) => ({ ...m, x: m.x + dx, y: m.y + dy })),
    };
  };

  return (
    <div className="wall-editor">
      <svg
        ref={svg}
        viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerDown={() => selectAttachment(null)}
        role="application"
        aria-label="Board: click an attachment to select it, drag to move it"
      >
        {board.outlines.map((o, i) => (
          <polygon key={i} className="we-tile" points={o.map(([x, y]) => `${x},${sy(y)}`).join(' ')} />
        ))}
        <path className="we-slots" d={slotPath} />
        {placed.map((raw) => {
          const p = shown(raw);
          const sel = p.id === selected;
          return (
            <g key={p.id} className={`we-att${sel ? ' selected' : ''}${p.ok ? '' : ' bad'}`} onPointerDown={(e) => onDown(e, raw)}>
              <rect x={p.x0} y={sy(p.y1)} width={p.x1 - p.x0} height={p.y1 - p.y0} rx={2} />
              {p.mounts.map((m, i) => (
                <circle key={i} className={`we-mount ${m.kind}`} cx={m.x} cy={sy(m.y)} r={m.kind === 'stud' ? 2 : 2.6} />
              ))}
              <text x={(p.x0 + p.x1) / 2} y={sy((p.y0 + p.y1) / 2)} fontSize={Math.max(6, Math.min(12, (p.x1 - p.x0) / 8))}>
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
