import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Vec2 } from '../lib/geometry/kernel';
import { attachmentDef } from '../lib/wall';
import { attachmentUi } from '../lib/wall/ui';
import '../lib/wall/kinds/all';
import { partBounds, siteAt } from '../lib/wall/mount';
import { dragAnchor, nearestSlot, slotKeys, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import { type Box } from '../lib/wall/place';
import { bounds, dragGuides, dragGroup, type Move } from '../lib/wall/arrange';
import { resizeAxes, resized, type ResizeAxis } from '../lib/wall/resize';
import { attachmentSelection, useStore, useUnits } from '../state/store';
import {
  copyAttachments,
  duplicateAttachments,
  hasAttachmentClip,
  moveAttachments,
  moveToFit,
  pasteAttachments,
  removeAttachments,
  selectAllAttachments,
  selectAttachment,
  selectAttachments,
  subscribeClip,
  toggleAttachment,
  updateAttachment,
} from '../state/wall';
import { isMod, isTyping, keyLetter } from './shortcuts';
import { TouchToggle, isTouch, tapSlop, useCoarsePointer, useTouchModes } from './touch';
import { fingerPx, longPress } from './gestures';
import { FINGER_PX, handleHit, heldSelection, nearestPart, useMmPerPx } from './wallTouch';
import { dragMoves } from './wallDrag';
import { asDrawer, type PrintJob } from '../lib/project';
import { markText, markTitle, partMarks } from '../lib/printedBoards';
import { useHeldKeys } from './WallHolds';
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
 * Parts being dragged: the one pressed (`held`) and the rest of the selection with it, where the press was (board
 * mm and screen px), and where they're shown once the pointer has moved past a tap. A press with Shift or Ctrl on a
 * selected part that doesn't move takes it out of the selection (`toggle`); a plain one picks just it.
 */
interface Drag {
  held: string;
  ids: string[];
  start: Vec2;
  screen: Vec2;
  slop: number;
  moves: Move[] | null;
  additive: boolean;
  toggle: boolean;
}

/** A box being dragged out over the board to select what it touches, added to `base` (Shift or Ctrl). */
interface Marquee {
  start: Vec2;
  now: Vec2;
  screen: Vec2;
  slop: number;
  base: string[];
}

const ARROWS: Record<string, Vec2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * A Skådis board seen from the front, on its Attachments tab: the tiles, every slot, and the attachments on it.
 * Click one to select it (Shift or Ctrl-click to add it, or take it out; drag over the empty board to select what
 * the box touches; Ctrl+A for all), drag to move the selection (it snaps to slots, where all its mounts fit if
 * there's such a spot near; where they don't, it follows the pointer and stays where it's dropped, red), with guides
 * where its edges line up with another part's and the gaps to its neighbours. Drag a single selected part's right
 * or bottom edge to resize it. Delete removes the selection, the arrow keys move it one slot over, Ctrl+C / V / D
 * copy, paste (at the pointer) and duplicate (lib/wall/arrange.ts, state/wall.ts). With `job` (the drawer's view),
 * a part printed already has a ✓ in its corner, one changed since it was printed a dot (lib/printed.ts).
 *
 * With a finger: tap a part to select it (a press just beside a thin one takes it), drag it to move it, hold it still
 * to add it to the selection (or take it out), or turn on Select several in the bar above the board, which also
 * has the keyboard's Duplicate, Copy, Paste and Delete. The resize handles take a press a fingertip wide. A second
 * finger calls a drag off, and pinches zoom the page.
 */
export function WallEditor({ board, placed, job }: { board: WallBoard; placed: WallPlacement[]; job?: PrintJob }) {
  const svg = useRef<SVGSVGElement>(null);
  const keys = useMemo(() => slotKeys(board.slots), [board.slots]);
  // Every selected part on this board, primary first.
  const picked = useStore(useShallow((s) => attachmentSelection(s.ui)));
  const sel = useMemo(() => picked.filter((id) => placed.some((p) => p.id === id)), [picked, placed]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  // The pointer over the board (board mm), for pasting there.
  const hover = useRef<Vec2 | null>(null);
  // A part being dragged in the 3D view (App.tsx): shown where it's going here too.
  const wallDrag = useStore((s) => s.ui.wallDrag ?? null);
  // Printed, or changed since (with its extra parts: lib/printedBoards.ts).
  const record = useStore((s) => s.printed);
  const drawerId = useStore((s) => s.activeDrawerId);
  const marks = useMemo(() => (job ? partMarks(asDrawer(job, drawerId), record) : {}), [job, drawerId, record]);
  const { fmt } = useUnits();
  // Touch: the bar of buttons, Select several in place of Shift, a long press, and the finger the gesture is with.
  const coarse = useCoarsePointer();
  const multi = useTouchModes((s) => s.multi);
  const setModes = useTouchModes((s) => s.set);
  const clip = useSyncExternalStore(subscribeClip, hasAttachmentClip);
  const [hold] = useState(longPress);
  const finger = useRef<number | null>(null);
  const M = 12;
  const W = Math.max(board.W, 1);
  const H = Math.max(board.H, 1);
  // Board y is up; the screen's is down.
  const sy = (y: number) => H - y;
  // Board mm in a screen pixel, for finger-sized targets.
  const mmPerPx = useMmPerPx(svg, [W, H]);

  /** A pointer event in board millimetres. */
  const toBoard = (e: { clientX: number; clientY: number }): Vec2 => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return [p.x, H - p.y];
  };

  /** The selected part's size handles (a single selection): which options size it (none for a part no option sizes). */
  const single = sel.length === 1 ? (placed.find((p) => p.id === sel[0]) ?? null) : null;
  // Not by the options the bin it holds sets (WallHolds.tsx).
  const held = useHeldKeys(useStore((s) => (single && s.drawer.attachments?.find((a) => a.id === single.id)) || null));
  const axes = useMemo(() => {
    const def = single && attachmentDef(single.type);
    const a = def && single ? resizeAxes(def, attachmentUi(single.type), single.opts, board.ctx) : { w: null, h: null };
    return held ? { w: a.w && !held.has(a.w.key) ? a.w : null, h: a.h && !held.has(a.h.key) ? a.h : null } : a;
  }, [single, board.ctx, held]);

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

  /** A second finger: whatever the first was doing is called off (and the page may take both, to pinch). */
  const second = (e: ReactPointerEvent) => {
    if (e.isPrimary || finger.current === null) return false;
    onCancel();
    return true;
  };
  const onDown = (e: ReactPointerEvent, p: WallPlacement) => {
    e.stopPropagation();
    if (second(e) || e.button !== 0 || !e.isPrimary) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey || multi;
    const had = sel.includes(p.id);
    // Grabbing a selected part drags the whole selection; Shift or Ctrl adds one to it.
    const ids = had ? sel : additive ? [p.id, ...sel] : [p.id];
    if (!had) selectAttachments(ids, p.id);
    svg.current?.setPointerCapture?.(e.pointerId);
    finger.current = e.pointerId;
    setDrag({ held: p.id, ids, start: toBoard(e), screen: [e.clientX, e.clientY], slop: tapSlop(isTouch(e)), moves: null, additive, toggle: additive && had });
    // A finger held still adds the part to the selection it came down on (or takes it out), and does nothing more.
    if (isTouch(e) && !additive) {
      const before = sel;
      hold.down(e, () => {
        setDrag(null);
        const next = heldSelection(before, p.id);
        selectAttachments(next, next.includes(p.id) ? p.id : undefined);
        navigator.vibrate?.(15);
      });
    }
  };
  const onBoardDown = (e: ReactPointerEvent) => {
    if (second(e) || e.button !== 0 || !e.isPrimary) return;
    const at = toBoard(e);
    // A finger just beside a part (a hook is a few pixels wide on a phone) takes it.
    const near = isTouch(e) && nearestPart(placed, at[0], at[1], fingerPx(6, true) * mmPerPx);
    if (near) return onDown(e, near);
    svg.current?.setPointerCapture?.(e.pointerId);
    finger.current = e.pointerId;
    setMarquee({
      start: at,
      now: at,
      screen: [e.clientX, e.clientY],
      slop: tapSlop(isTouch(e)),
      base: e.shiftKey || e.ctrlKey || e.metaKey || multi ? sel : [],
    });
  };
  const onHandle = (e: ReactPointerEvent, p: WallPlacement, edge: Resize['edge']) => {
    e.stopPropagation();
    if (second(e) || !e.isPrimary) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    finger.current = e.pointerId;
    setResize({ id: p.id, edge, start: toBoard(e), axes, x0: p.x0, y1: p.y1, patch: {} });
  };
  /** Calls the gesture off: nothing moves, nothing is selected that wasn't. */
  const onCancel = () => {
    hold.stop();
    finger.current = null;
    setDrag(null);
    setMarquee(null);
    setResize(null);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (finger.current !== null && e.pointerId !== finger.current) return;
    hold.move(e);
    const now = toBoard(e);
    hover.current = now;
    if (marquee) {
      setMarquee({ ...marquee, now });
      return;
    }
    if (resize) {
      const p = placed.find((q) => q.id === resize.id);
      const def = p && attachmentDef(p.type);
      if (!p || !def) return;
      const dw = resize.edge === 's' ? 0 : now[0] - resize.start[0];
      // Down the screen is a taller part (its top stays).
      const dh = resize.edge === 'e' ? 0 : resize.start[1] - now[1];
      const patch = resized(def, p.opts, resize.axes, dw, dh);
      if (JSON.stringify(patch) !== JSON.stringify(resize.patch)) setResize({ ...resize, patch });
      return;
    }
    if (!drag) return;
    // A press that stays put is a click: nothing moves.
    if (!drag.moves && Math.hypot(e.clientX - drag.screen[0], e.clientY - drag.screen[1]) <= drag.slop) return;
    const h = placed.find((q) => q.id === drag.held);
    if (!h) return;
    const x = h.x + now[0] - drag.start[0];
    const y = h.y + now[1] - drag.start[1];
    const parts = placed.filter((q) => drag.ids.includes(q.id));
    let moves: Move[] | null;
    if (parts.length > 1) moves = dragGroup(board, keys, parts, h.id, x, y);
    else {
      const r = dragAnchor(board.slots, keys, h.layout, board.ctx, x, y);
      moves = r && [{ id: h.id, x: r.at[0], y: r.at[1], fits: r.fits }];
    }
    if (moves && JSON.stringify(moves) !== JSON.stringify(drag.moves)) setDrag({ ...drag, moves });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (finger.current !== null && e.pointerId !== finger.current) return;
    finger.current = null;
    // A long press did all it does.
    if (hold.stop()) return;
    if (marquee) {
      const click = Math.hypot(e.clientX - marquee.screen[0], e.clientY - marquee.screen[1]) <= marquee.slop;
      // A plain click on the empty board clears the selection.
      if (!click) selectAttachments([...marquee.base, ...marqueeHits], sel[0] && marquee.base.includes(sel[0]) ? sel[0] : undefined);
      else if (!marquee.base.length) selectAttachment(null);
      setMarquee(null);
      return;
    }
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
    if (!drag) return;
    if (drag.moves) moveAttachments(drag.moves);
    else if (drag.toggle) toggleAttachment(drag.held);
    // A click on one of several selected picks just it.
    else if (!drag.additive && sel.length > 1) selectAttachment(drag.held);
    setDrag(null);
  };

  // Keys: Delete, arrows (one slot along the row or column: two lattice steps), Escape, and copy, paste, duplicate, select all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || isTyping(e.target)) return;
      const k = keyLetter(e);
      if (isMod(e) && !e.shiftKey) {
        // Leave copying selected page text to the browser.
        const text = !!window.getSelection()?.toString();
        if (k === 'a' && !text) selectAllAttachments();
        else if ((k === 'c' || k === 'x') && !text && sel.length) {
          copyAttachments(sel);
          if (k === 'x') removeAttachments(sel);
        } else if (k === 'v') pasteAttachments(board, hover.current);
        else if (k === 'd' && sel.length) duplicateAttachments(sel, board);
        else return;
        e.preventDefault();
        return;
      }
      if (!sel.length || isMod(e)) return;
      if (e.key === 'Escape') {
        selectAttachment(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeAttachments(sel);
        e.preventDefault();
        return;
      }
      // Sliders, checkboxes and selects keep their own arrow keys.
      const d = ARROWS[e.key];
      if (!d || (e.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
      const step = 2 * board.ctx.pitch;
      // The slots that far over, whether the parts fit there or not (they show red where they don't); none past the edge.
      const moves = placed
        .filter((p) => sel.includes(p.id))
        .map((p) => {
          const want: Vec2 = [p.x + d[0] * step, p.y + d[1] * step];
          const at = nearestSlot(board.slots, ...want);
          return at && Math.hypot(at[0] - want[0], at[1] - want[1]) < board.ctx.pitch ? { id: p.id, x: at[0], y: at[1] } : null;
        });
      if (moves.every((m) => m)) moveAttachments(moves as { id: string; x: number; y: number }[]);
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

  // What the box being dragged out touches.
  const mbox = marquee && {
    x0: Math.min(marquee.start[0], marquee.now[0]),
    x1: Math.max(marquee.start[0], marquee.now[0]),
    y0: Math.min(marquee.start[1], marquee.now[1]),
    y1: Math.max(marquee.start[1], marquee.now[1]),
  };
  const marqueeHits = mbox ? placed.filter((p) => p.x0 < mbox.x1 && p.x1 > mbox.x0 && p.y0 < mbox.y1 && p.y1 > mbox.y0).map((p) => p.id) : [];
  const shownSel = new Set(marquee ? [...marquee.base, ...marqueeHits] : sel);

  // Where parts are being moved to: by a drag here, or one in the 3D view.
  const moving = new Map((drag?.moves ?? dragMoves(wallDrag)).map((m) => [m.id, m]));

  /** A part as drawn: where it's being dragged or resized to. */
  const shown = (p: WallPlacement): { p: WallPlacement; bad: boolean; size?: string } => {
    if (resize?.id === p.id && Object.keys(resize.patch).length) {
      const v = resizedView(p, resize);
      const size = `${fmt(v.box.x1 - v.box.x0)} × ${fmt(v.box.y1 - v.box.y0)}`;
      return { p: { ...p, ...v.box, mounts: v.mounts }, bad: false, size };
    }
    const m = moving.get(p.id);
    if (!m) return { p, bad: !p.ok };
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    return {
      p: {
        ...p,
        x: m.x,
        y: m.y,
        x0: p.x0 + dx,
        x1: p.x1 + dx,
        y0: p.y0 + dy,
        y1: p.y1 + dy,
        mounts: p.mounts.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })),
      },
      bad: !m.fits,
    };
  };
  const views = placed.map((raw) => ({ raw, ...shown(raw) }));

  // Guides while moving: where the moving parts' edges or centres line up with another's, and the gaps to their neighbours.
  const guides = useMemo(() => {
    const boxes = (ids: (id: string) => boolean): Box[] => views.filter((v) => ids(v.raw.id)).map((v) => v.p);
    const mine = boxes((id) => moving.has(id));
    return mine.length && moving.size
      ? dragGuides(
          bounds(mine),
          boxes((id) => !moving.has(id)),
        )
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.moves, wallDrag, placed]);

  /** Handle size on screen: about 8 px, whatever the zoom. */
  const hs = Math.max(4, Math.min(10, Math.max(W, H) / 70));
  /** Guide labels: about 11 px. */
  const gs = Math.max(5, Math.min(14, Math.max(W, H) / 55));

  // Selected parts that don't fit where they are, and could.
  const misfits = placed.filter((p) => sel.includes(p.id) && !p.ok && p.fit);

  return (
    <div className="wall-editor">
      {coarse && (
        <div className="we-touch-bar">
          <TouchToggle
            on={multi}
            label="Select several"
            title="Tap parts to add them to the selection, or drag across the board to select a group"
            onChange={(on) => setModes({ multi: on })}
          />
          <span className="we-touch-actions">
            <button type="button" disabled={!sel.length} onClick={() => duplicateAttachments(sel, board)}>
              Duplicate
            </button>
            <button type="button" disabled={!sel.length} onClick={() => copyAttachments(sel)}>
              Copy
            </button>
            <button type="button" disabled={!clip} onClick={() => pasteAttachments(board)}>
              Paste
            </button>
            <button type="button" className="danger" disabled={!sel.length} onClick={() => removeAttachments(sel)}>
              Delete
            </button>
          </span>
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerDown={onBoardDown}
        onPointerLeave={() => (hover.current = null)}
        role="application"
        aria-label="Board: click an attachment to select it (Shift or Ctrl-click for several, or drag a box round them), drag to move the selection, drag its right or bottom edge to resize it"
      >
        {board.outlines.map((o, i) => (
          <polygon key={i} className="we-tile" points={o.map(([x, y]) => `${x},${sy(y)}`).join(' ')} />
        ))}
        <path className="we-slots" d={slotPath} />
        {views.map(({ raw, p, bad, size }) => {
          const isSel = shownSel.has(p.id);
          const w = p.x1 - p.x0;
          const h = p.y1 - p.y0;
          const handles = single?.id === p.id && !drag && !marquee;
          return (
            <g key={p.id} className={`we-att${isSel ? ' selected' : ''}${bad ? ' bad' : ''}`} onPointerDown={(e) => onDown(e, raw)}>
              <rect className="we-body" x={p.x0} y={sy(p.y1)} width={w} height={h} rx={2} />
              {p.mounts.map((m, i) => (
                <circle key={i} className={`we-mount ${m.kind}`} cx={m.x} cy={sy(m.y)} r={m.kind === 'stud' ? 2 : 2.6} />
              ))}
              <text x={(p.x0 + p.x1) / 2} y={sy((p.y0 + p.y1) / 2)} fontSize={Math.max(5, Math.min(12, w / 8, h * 0.55))}>
                {size ?? p.name}
              </text>
              {marks[`att:${p.id}`] && (
                <text className={`pm-mark ${marks[`att:${p.id}`]}`} x={p.x0 + 2} y={sy(p.y1) + 2} fontSize={Math.max(gs, Math.min(10, w / 6, h / 3))}>
                  {markText(marks[`att:${p.id}`])}
                  <title>{markTitle(marks[`att:${p.id}`])}</title>
                </text>
              )}
              {handles && (
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
                  {/* A fingertip's worth round each handle, drawn as before. */}
                  {coarse &&
                    (['e', 's', 'se'] as const)
                      .filter((edge) => (edge === 's' || axes.w) && (edge === 'e' || axes.h))
                      .map((edge) => {
                        const z = handleHit(edge, p, edge === 'se' ? hs : 2 * hs, FINGER_PX * mmPerPx);
                        return (
                          <rect
                            key={edge}
                            className="we-handle-hit"
                            x={z.x0}
                            y={sy(z.y1)}
                            width={z.x1 - z.x0}
                            height={z.y1 - z.y0}
                            onPointerDown={(e) => onHandle(e, raw, edge)}
                          />
                        );
                      })}
                </>
              )}
            </g>
          );
        })}
        {guides && (
          <g className="we-guides">
            {guides.lines.map((g, i) =>
              g.axis === 'x' ? (
                <line key={`l${i}`} x1={g.at} x2={g.at} y1={sy(g.from) + 4} y2={sy(g.to) - 4} />
              ) : (
                <line key={`l${i}`} x1={g.from - 4} x2={g.to + 4} y1={sy(g.at)} y2={sy(g.at)} />
              ),
            )}
            {guides.gaps.map((g, i) => {
              const [x1, y1, x2, y2] = g.axis === 'x' ? [g.from, sy(g.at), g.to, sy(g.at)] : [g.at, sy(g.from), g.at, sy(g.to)];
              return (
                <g key={`g${i}`} className="we-gap">
                  <line x1={x1} y1={y1} x2={x2} y2={y2} />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={gs} dy={g.axis === 'x' ? -gs * 0.6 : 0} dx={g.axis === 'y' ? gs * 0.4 : 0}>
                    {fmt(g.mm)}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        {mbox && <rect className="we-marquee" x={mbox.x0} y={sy(mbox.y1)} width={mbox.x1 - mbox.x0} height={mbox.y1 - mbox.y0} />}
      </svg>
      {misfits.length > 0 && !drag && (
        <div className="we-fit" role="status">
          <span>{misfits.length === 1 ? `${misfits[0].name} doesn’t fit here.` : `${misfits.length} of these don’t fit where they are.`}</span>
          <button
            onClick={() =>
              moveToFit(
                misfits.map((p) => p.id),
                board,
              )
            }
          >
            {misfits.length === 1 ? 'Move to the nearest spot that fits' : 'Move them to the nearest spots that fit'}
          </button>
        </div>
      )}
    </div>
  );
}
