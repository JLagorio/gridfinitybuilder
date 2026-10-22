import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from '../lib/geometry/kernel';
import { attachmentDef } from '../lib/wall';
import { attachmentUi } from '../lib/wall/ui';
import '../lib/wall/kinds/all';
import { partBounds, siteAt } from '../lib/wall/mount';
import { dragAnchor, nearestSlot, slotKeys, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import { resizeAxes, resized, type ResizeAxis } from '../lib/wall/resize';
import { useUnits } from '../state/store';
import { moveAttachment, removeAttachment, selectAttachment, updateAttachment } from '../state/wall';
import './wall.css';

/** A resize in progress: which edge, where it started, the options that size the part, and its left and top edges (they stay put). */
interface Resize {
  id: string;
  edge: 'e' | 's' | 'se';
  start: Vec2;
  axes: { w: ResizeAxis | null; h: ResizeAxis | null };
  x0: number;
  y1: number;
  patch: Record<string, unknown>;
}

/**
 * A Skådis board seen from the front, on its Attachments tab: the tiles, every
 * slot, and the attachments on it. Click one to select it, drag it to move it
 * (it snaps to slots where all its mounts fit; where they don't, it follows
 * the pointer in red), drag the selected one's right or bottom edge to resize
 * it, Delete removes it, the arrow keys move it one slot over.
 */
export function WallEditor({ board, placed, selected }: { board: WallBoard; placed: WallPlacement[]; selected: string | null }) {
  const svg = useRef<SVGSVGElement>(null);
  const keys = useMemo(() => slotKeys(board.slots), [board.slots]);
  const [drag, setDrag] = useState<{ id: string; start: Vec2; from: Vec2; at: Vec2 | null; fits: boolean } | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const { fmt } = useUnits();
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

  /** The selected part's size handles: which options size it (none for a part no option sizes). */
  const sel = placed.find((p) => p.id === selected) ?? null;
  const axes = useMemo(() => {
    const def = sel && attachmentDef(sel.type);
    return def && sel ? resizeAxes(def, attachmentUi(sel.type), sel.opts, board.ctx) : { w: null, h: null };
  }, [sel, board.ctx]);

  /** What a resize would make of a part: its options, front view and mounts, its left and top edges where they were. */
  const resizedView = (p: WallPlacement, r: Resize) => {
    const def = attachmentDef(p.type)!;
    const opts = def.sanitize({ ...p.opts, ...r.patch });
    const layout = def.layout(opts, board.ctx);
    const b = partBounds(layout, board.ctx);
    const ox = r.x0 - b.x0;
    const oy = r.y1 - b.y1;
    return {
      opts,
      layout,
      anchor: [ox + layout.anchor[0], oy + layout.anchor[1]] as Vec2,
      box: { x0: r.x0, x1: r.x0 + b.x1 - b.x0, y0: r.y1 - (b.y1 - b.y0), y1: r.y1 },
      mounts: layout.mounts.map((m) => {
        const [mx, my] = siteAt(layout, m, board.ctx);
        return { x: ox + mx, y: oy + my, kind: m.kind };
      }),
    };
  };

  const onDown = (e: ReactPointerEvent, p: WallPlacement) => {
    e.stopPropagation();
    selectAttachment(p.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: p.id, start: toBoard(e), from: [p.x, p.y], at: null, fits: p.ok });
  };
  const onHandle = (e: ReactPointerEvent, p: WallPlacement, edge: Resize['edge']) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setResize({ id: p.id, edge, start: toBoard(e), axes, x0: p.x0, y1: p.y1, patch: {} });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (resize) {
      const p = placed.find((q) => q.id === resize.id);
      const def = p && attachmentDef(p.type);
      if (!p || !def) return;
      const now = toBoard(e);
      const dw = resize.edge === 's' ? 0 : now[0] - resize.start[0];
      // Down the screen is a taller part (its top stays).
      const dh = resize.edge === 'e' ? 0 : resize.start[1] - now[1];
      const patch = resized(def, p.opts, resize.axes, dw, dh);
      if (JSON.stringify(patch) !== JSON.stringify(resize.patch)) setResize({ ...resize, patch });
      return;
    }
    if (!drag) return;
    const p = placed.find((q) => q.id === drag.id);
    if (!p) return;
    const now = toBoard(e);
    const r = dragAnchor(board.slots, keys, p.layout, board.ctx, drag.from[0] + now[0] - drag.start[0], drag.from[1] + now[1] - drag.start[1]);
    if (r && (r.at[0] !== drag.at?.[0] || r.at[1] !== drag.at?.[1])) setDrag({ ...drag, at: r.at, fits: r.fits });
  };
  const onUp = () => {
    if (resize) {
      const p = placed.find((q) => q.id === resize.id);
      if (p && Object.keys(resize.patch).length) {
        const v = resizedView(p, resize);
        // Where it lands: its anchor where the left and top edges stay, snapped.
        const at = dragAnchor(board.slots, keys, v.layout, board.ctx, v.anchor[0], v.anchor[1])?.at ?? v.anchor;
        const raw = { ...p.opts, ...resize.patch };
        updateAttachment(p.id, { opts: raw, x: at[0], y: at[1] });
      }
      setResize(null);
      return;
    }
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
      // The slot that far over, whether the part fits there or not (planning moves it to the nearest place it does).
      const at = nearestSlot(board.slots, p.x + v[0], p.y + v[1]);
      if (at && Math.hypot(at[0] - p.x - v[0], at[1] - p.y - v[1]) < board.ctx.pitch) moveAttachment(p.id, at[0], at[1]);
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

  /** A part as drawn: where it's being dragged or resized to. */
  const shown = (p: WallPlacement): { p: WallPlacement; bad: boolean; size?: string } => {
    if (resize?.id === p.id && Object.keys(resize.patch).length) {
      const v = resizedView(p, resize);
      const size = `${fmt(v.box.x1 - v.box.x0)} × ${fmt(v.box.y1 - v.box.y0)}`;
      return { p: { ...p, ...v.box, mounts: v.mounts }, bad: false, size };
    }
    if (drag?.id !== p.id || !drag.at) return { p, bad: !p.ok };
    const dx = drag.at[0] - p.x;
    const dy = drag.at[1] - p.y;
    return {
      p: {
        ...p,
        x: drag.at[0],
        y: drag.at[1],
        x0: p.x0 + dx,
        x1: p.x1 + dx,
        y0: p.y0 + dy,
        y1: p.y1 + dy,
        mounts: p.mounts.map((m) => ({ ...m, x: m.x + dx, y: m.y + dy })),
      },
      bad: !drag.fits,
    };
  };

  /** Handle size on screen: about 8 px, whatever the zoom. */
  const hs = Math.max(4, Math.min(10, Math.max(W, H) / 70));

  return (
    <div className="wall-editor">
      <svg
        ref={svg}
        viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerDown={() => selectAttachment(null)}
        role="application"
        aria-label="Board: click an attachment to select it, drag to move it, drag its right or bottom edge to resize it"
      >
        {board.outlines.map((o, i) => (
          <polygon key={i} className="we-tile" points={o.map(([x, y]) => `${x},${sy(y)}`).join(' ')} />
        ))}
        <path className="we-slots" d={slotPath} />
        {placed.map((raw) => {
          const { p, bad, size } = shown(raw);
          const isSel = p.id === selected;
          const w = p.x1 - p.x0;
          const h = p.y1 - p.y0;
          return (
            <g key={p.id} className={`we-att${isSel ? ' selected' : ''}${bad ? ' bad' : ''}`} onPointerDown={(e) => onDown(e, raw)}>
              <rect className="we-body" x={p.x0} y={sy(p.y1)} width={w} height={h} rx={2} />
              {p.mounts.map((m, i) => (
                <circle key={i} className={`we-mount ${m.kind}`} cx={m.x} cy={sy(m.y)} r={m.kind === 'stud' ? 2 : 2.6} />
              ))}
              <text x={(p.x0 + p.x1) / 2} y={sy((p.y0 + p.y1) / 2)} fontSize={Math.max(5, Math.min(12, w / 8, h * 0.55))}>
                {size ?? p.name}
              </text>
              {isSel && !drag && (
                <>
                  {axes.w && (
                    <rect
                      className="we-handle ew"
                      x={p.x1 - hs / 2}
                      y={sy((p.y0 + p.y1) / 2) - hs}
                      width={hs}
                      height={2 * hs}
                      onPointerDown={(e) => onHandle(e, raw, 'e')}
                    />
                  )}
                  {axes.h && (
                    <rect
                      className="we-handle ns"
                      x={(p.x0 + p.x1) / 2 - hs}
                      y={sy(p.y0) - hs / 2}
                      width={2 * hs}
                      height={hs}
                      onPointerDown={(e) => onHandle(e, raw, 's')}
                    />
                  )}
                  {axes.w && axes.h && (
                    <rect
                      className="we-handle nwse"
                      x={p.x1 - hs / 2}
                      y={sy(p.y0) - hs / 2}
                      width={hs}
                      height={hs}
                      onPointerDown={(e) => onHandle(e, raw, 'se')}
                    />
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
