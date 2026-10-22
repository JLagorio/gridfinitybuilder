import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compartmentLabelText } from '../lib/geometry/labels';
import { labelPlainText } from '../lib/geometry/labelIcons';
import { history, useStore, useUnits } from '../state/store';
import type { GridLayout } from '../lib/layout/drawer';
import { BASE_TOP_RADIUS, DIVIDER, INNER_RADIUS, TAB_DEPTH, TAB_WIDTH_NOMINAL, WALL } from '../lib/geometry/spec';
import { lengthFieldText, parseLength, snapStep } from '../lib/units';
import {
  MIN_GAP,
  acrossSize,
  addWall,
  autoOrient,
  cellLines,
  clampDrag,
  compartmentAt,
  dragContext,
  endTargets,
  ghostAt,
  makeWall,
  moveWall,
  nearestTarget,
  removeWall,
  resolveIn,
  setWallEnd,
  setWallGap,
  snapAcross,
  wallAt,
  wallGaps,
  wallRect,
  type Compartment,
  type DividerLayout,
  type DragContext,
  type Ghost,
  type Orient,
  type ResolvedLayout,
  type ResolvedWall,
  type Side,
  type SnapMatch,
  type SnapResult,
} from '../lib/dividers';
import { Segmented } from './fields';
import {
  clearInteriorSelection,
  compartmentOptions,
  selectCompartment,
  selectWall,
  useBinInterior,
  useInterior,
  useInteriorSelection,
  type BinInterior,
} from './interiorState';
import {
  MIN_FREE_WALL,
  addFreeWall,
  freeWallAt,
  freeWallMeasure,
  freeWallMid,
  freeWallOutline,
  freeWallShape,
  removableSegments,
  removeFreeWall,
  snapPoint,
  updateFreeWall,
  wallSpans,
  type PointSnap,
  type ResolvedFreeWall,
} from '../lib/dividers';
import { fitNotch } from '../lib/geometry/wallExtras';
import { selectFreeWall } from './interiorState';
import { LayoutActions, copyLayoutOf, dividerHeight, pasteLayoutInto } from './WallTools';
import { isMod } from './shortcuts';
import { CompartmentInsidePreview, useInsideBadge } from './CompartmentInsidePreview';
import { stretchOf } from '../lib/geometry/placement';
import { TouchToggle, isTouch, tapSlop, useCoarsePointer, useTouchModes } from './touch';
import { fingerPx } from './gestures';

const T = DIVIDER;
/** Pointer distances, in screen pixels. */
const HIT_PX = 6;
const HANDLE_PX = 6;
const SNAP_PX = 8;
/** Snapping reaches further for a finger. */
const TOUCH_SNAP_PX = 14;
/** Handles on a touch screen. */
const COARSE_HANDLE_PX = 10;
const FONT_PX = 11;

type WallDrag = {
  kind: 'wall';
  id: string;
  layout: DividerLayout;
  ctx: DragContext;
  startPx: [number, number];
  moved: boolean;
  /** Just placed by this press: the drag belongs to the same undo step. */
  fresh?: boolean;
  preview: { pos: number; layout: DividerLayout; resolved: ResolvedLayout; snap: SnapResult | null } | null;
};
type EndDrag = {
  kind: 'end';
  id: string;
  which: 'start' | 'end';
  layout: DividerLayout;
  preview: { target: Side; layout: DividerLayout; resolved: ResolvedLayout } | null;
};
type FreePreview = { layout: DividerLayout; resolved: ResolvedLayout } | null;
/** Drawing a diagonal / curved wall from `a`. */
type DrawDrag = { kind: 'draw'; a: PointSnap; b: PointSnap | null; press: [number, number]; startPx: [number, number]; moved: boolean; preview: null };
type FreeEndDrag = { kind: 'free-end'; id: string; which: 'a' | 'b'; layout: DividerLayout; at: PointSnap | null; preview: FreePreview };
type FreeBendDrag = { kind: 'free-bend'; id: string; layout: DividerLayout; preview: FreePreview };
type FreeMoveDrag = { kind: 'free-move'; id: string; layout: DividerLayout; origin: [number, number]; startPx: [number, number]; moved: boolean; preview: FreePreview };
type Drag = WallDrag | EndDrag | DrawDrag | FreeEndDrag | FreeBendDrag | FreeMoveDrag;

interface Editing {
  wallId: string;
  side: 'lo' | 'hi';
  left: number;
  top: number;
  text: string;
  initial: string;
  bad?: boolean;
}

/**
 * Top-down editor for one bin's interior walls, in cavity mm (back of the bin
 * at the top). Hover shows the wall a click would add; walls drag along their
 * axis with snapping; dimension labels can be clicked to type a gap.
 */
export function BinInteriorEditor({ binId, grid }: { binId: string; grid: GridLayout }) {
  const info = useBinInterior(binId, grid);
  const updateBin = useStore((s) => s.updateBin);
  const { units, precision, fmt } = useUnits();
  const sel = useInteriorSelection(binId, info?.resolved ?? null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pxPerMm, setPxPerMm] = useState(4);
  const [hover, setHover] = useState<{ x: number; y: number; onBadge: boolean } | null>(null);
  const [mods, setMods] = useState({ alt: false, shift: false });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editDone = useRef(false);
  // Touch: bigger handles, and the Flip / No snap toggles in place of Shift / Alt.
  const coarse = useCoarsePointer();
  const touchModes = useTouchModes();
  const handlePx = coarse ? COARSE_HANDLE_PX : HANDLE_PX;
  /** The press that started the drag was a finger. */
  const touchPress = useRef(false);

  /** Each edit starts its own undo step; `join` doesn't force one (sliding a wall just placed groups with it if quick). */
  const commit = (next: DividerLayout, join = false) => {
    if (!join) history.checkpoint();
    updateBin(binId, { opts: { layout: next } });
  };
  const step = snapStep(units, precision || 16);
  // A stretched body reaches past the feet on the left / front, so the seams sit that much further in.
  const cellsX = useMemo(() => (info ? cellLines(info.cells.x, stretchOf(info.cells.stretch).left) : []), [info]);
  const cellsY = useMemo(() => (info ? cellLines(info.cells.y, stretchOf(info.cells.stretch).front) : []), [info]);
  const snapOpts = (alt: boolean, touch = false) => ({ tolerance: (touch ? TOUCH_SNAP_PX : SNAP_PX) / pxPerMm, step, free: alt, cellsX, cellsY });
  const pointOpts = (alt: boolean, touch = false) => ({ tolerance: (touch ? TOUCH_SNAP_PX : SNAP_PX) / pxPerMm, step, free: alt });

  // Track the drawing scale (font sizes and hit tolerances are in screen pixels).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => {
      const m = el.getScreenCTM();
      if (m && m.a > 0) setPxPerMm(m.a);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [info?.size.w, info?.size.d]);

  // Keyboard: capture phase, so Delete/Escape act here before the app's bin shortcuts.
  const latest = useRef({ info, sel, drag, editing, step });
  latest.current = { info, sel, drag, editing, step };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Alt') {
        setMods({ alt: e.altKey, shift: e.shiftKey });
        if (e.key === 'Alt') e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [role="combobox"], [contenteditable]')) return;
      const { info: inf, sel: s, drag: d } = latest.current;
      if (!inf) return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        if (d) {
          setDrag(null);
          stop();
        } else if (s.wallId || s.compKey || s.freeId) {
          clearInteriorSelection();
          stop();
        }
        return;
      }
      // Layout clipboard: copy this bin's layout, paste one into it.
      if (isMod(e) && !e.shiftKey && !e.altKey && !d) {
        const k = e.key.toLowerCase();
        if (k === 'c' && !window.getSelection()?.toString()) {
          copyLayoutOf(inf.opts);
          stop();
        } else if (k === 'v' && pasteLayoutInto([binId])) {
          clearInteriorSelection();
          stop();
        }
        if (k === 'c' || k === 'v') return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never delete the whole bin from here.
        stop();
        if (s.wallId && !d) {
          history.checkpoint();
          updateBin(binId, { opts: { layout: removeWall(inf.layout, inf.size, s.wallId) } });
          clearInteriorSelection();
        } else if (s.freeId && !d) {
          history.checkpoint();
          updateBin(binId, { opts: { layout: removeFreeWall(inf.layout, s.freeId) } });
          clearInteriorSelection();
        }
        return;
      }
      if (e.key.startsWith('Arrow') && s.freeId && !d) {
        const F = inf.resolved.free.find((f) => f.id === s.freeId);
        const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] } as Record<string, [number, number]>)[e.key];
        if (!F || !dir) return;
        stop();
        const st = latest.current.step * (e.shiftKey ? 10 : 1);
        const xs = [F.a[0], F.b[0]];
        const ys = [F.a[1], F.b[1]];
        const dx = Math.min(inf.size.w - Math.max(...xs), Math.max(-Math.min(...xs), dir[0] * st));
        const dy = Math.min(inf.size.d - Math.max(...ys), Math.max(-Math.min(...ys), dir[1] * st));
        if (Math.abs(dx) + Math.abs(dy) > 1e-9) {
          updateBin(binId, { opts: { layout: updateFreeWall(inf.layout, inf.size, F.id, { a: [F.a[0] + dx, F.a[1] + dy], b: [F.b[0] + dx, F.b[1] + dy] }) } });
        }
        return;
      }
      if (e.key.startsWith('Arrow') && s.wallId && !d) {
        const W = inf.resolved.byId.get(s.wallId);
        if (!W) return;
        const dir =
          W.orient === 'v'
            ? { ArrowLeft: -1, ArrowRight: 1 }[e.key as 'ArrowLeft' | 'ArrowRight']
            : { ArrowDown: -1, ArrowUp: 1 }[e.key as 'ArrowDown' | 'ArrowUp'];
        if (!dir) return;
        stop();
        const c = clampDrag(inf.layout, inf.size, W.id, W.pos + dir * latest.current.step * (e.shiftKey ? 10 : 1));
        if (Math.abs(c.pos - W.pos) > 1e-6) updateBin(binId, { opts: { layout: moveWall(inf.layout, inf.size, W.id, c.pos) } });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const st = useInterior.getState();
      if (k === 'r') st.set({ orient: st.orient === 'auto' ? 'v' : st.orient === 'v' ? 'h' : 'auto' });
      else if (k === 'v' || k === 'h') st.set({ orient: k });
      else if (k === 'a') st.set({ orient: 'auto' });
      else if (k === 'w') st.set({ tool: 'wall' });
      else if (k === 's') st.set({ tool: 'select' });
      else if (k === 'd') st.set({ tool: 'free' });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Alt') setMods({ alt: e.altKey, shift: e.shiftKey });
    };
    const onBlur = () => setMods({ alt: false, shift: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [binId, updateBin]);

  // Another bin, or the store changed under a drag: drop transient state.
  useEffect(() => {
    setDrag(null);
    setEditing(null);
  }, [binId]);

  if (!info) return <div className="editor-empty">Select a bin to edit its compartments.</div>;
  const { w: IW, d: ID } = info.size;
  const view = drag?.preview?.resolved ?? info.resolved;
  const sy = (y: number) => ID - y;
  const fs = FONT_PX / pxPerMm;
  const px = (n: number) => n / pxPerMm;
  /** How close a press must be to a wall, or to a handle, in mm. */
  const hitMm = (touch: boolean) => px(fingerPx(HIT_PX, touch));
  const grabMm = (touch: boolean) => px(fingerPx(handlePx + 3, touch));
  /** Shift and Alt, or their on-screen toggles. */
  const shiftOf = (e: { shiftKey: boolean }) => e.shiftKey || touchModes.flip;
  const altOf = (e: { altKey: boolean }) => e.altKey || touchModes.free;

  const toMm = (e: { clientX: number; clientY: number }) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: ID - pt.y };
  };
  const toScreen = (x: number, y: number) => {
    const m = svgRef.current?.getScreenCTM();
    const box = wrapRef.current?.getBoundingClientRect();
    if (!m || !box) return { left: 0, top: 0 };
    const pt = new DOMPoint(x, ID - y).matrixTransform(m);
    return { left: pt.x - box.left, top: pt.y - box.top };
  };

  const orientAt = (x: number, y: number, shift: boolean): Orient => {
    let o: Orient = sel.orient === 'auto' ? autoOrient(info.resolved, x, y) : sel.orient;
    if (shift) o = o === 'v' ? 'h' : 'v';
    return o;
  };
  const ghostFor = (x: number, y: number, alt: boolean, shift: boolean, touch = false): Ghost | null => {
    if (wallAt(info.resolved, x, y, hitMm(touch)) || freeWallAt(info.resolved, x, y, hitMm(touch))) return null;
    return ghostAt(info.resolved, x, y, orientAt(x, y, shift), snapOpts(alt, touch));
  };
  const handleAt = (W: ResolvedWall, which: 'start' | 'end'): [number, number] => {
    const run = which === 'start' ? W.start : W.end;
    return W.orient === 'v' ? [W.pos, run] : [run, W.pos];
  };

  const ghost = !drag && !editing && hover && !hover.onBadge && sel.tool === 'wall' ? ghostFor(hover.x, hover.y, mods.alt || touchModes.free, mods.shift || touchModes.flip) : null;
  const hoverFree = !drag && hover && sel.tool !== 'free' ? freeWallAt(view, hover.x, hover.y, px(HIT_PX)) : null;
  const hoverWall = !drag && hover && !hoverFree ? wallAt(view, hover.x, hover.y, px(HIT_PX)) : null;
  const hoverComp = !drag && hover && !hoverWall && !hoverFree ? compartmentAt(view, hover.x, hover.y) : null;
  const selWall = sel.wallId ? view.byId.get(sel.wallId) ?? null : null;
  const selFree = sel.freeId ? view.free.find((f) => f.id === sel.freeId) ?? null : null;
  /** Which handle of a free wall is under a point: an end, or the middle (bend). */
  const freeHandleAt = (F: ResolvedFreeWall, x: number, y: number, touch = false): 'a' | 'b' | 'mid' | null => {
    const near = (q: [number, number]) => Math.hypot(q[0] - x, q[1] - y) <= grabMm(touch);
    return near(F.a) ? 'a' : near(F.b) ? 'b' : near(freeWallMid(F)) ? 'mid' : null;
  };
  /** Sagitta for a bend handle dragged to (x, y): snaps to straight, then to the fine step. */
  const bendAt = (F: ResolvedFreeWall, x: number, y: number, alt: boolean) => {
    const dx = F.b[0] - F.a[0];
    const dy = F.b[1] - F.a[1];
    const c = Math.hypot(dx, dy);
    let s = ((x - (F.a[0] + F.b[0]) / 2) * -dy + (y - (F.a[1] + F.b[1]) / 2) * dx) / c;
    s = Math.max(-c / 2, Math.min(c / 2, s));
    if (!alt) s = Math.abs(s) < SNAP_PX / pxPerMm ? 0 : Math.round(s / step) * step;
    return s;
  };
  const hoverSnap = !drag && hover && sel.tool === 'free' ? snapPoint(info.resolved, hover.x, hover.y, pointOpts(mods.alt || touchModes.free)) : null;

  // ------------------------------------------------------------------ pointer

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // A second finger never starts a second drag.
    if (e.button !== 0 || !e.isPrimary) return;
    const p = toMm(e);
    if (!p) return;
    setEditing(null);
    svgRef.current?.setPointerCapture(e.pointerId);
    const r = info.resolved;
    const touch = isTouch(e);
    touchPress.current = touch;
    if (selFree) {
      const h = freeHandleAt(selFree, p.x, p.y, touch);
      if (h === 'mid') {
        setDrag({ kind: 'free-bend', id: selFree.id, layout: info.layout, preview: null });
        return;
      }
      if (h) {
        setDrag({ kind: 'free-end', id: selFree.id, which: h, layout: info.layout, at: null, preview: null });
        return;
      }
    }
    if (selWall) {
      for (const which of ['start', 'end'] as const) {
        const [hx, hy] = handleAt(selWall, which);
        if (Math.hypot(hx - p.x, hy - p.y) <= grabMm(touch)) {
          setDrag({ kind: 'end', id: selWall.id, which, layout: info.layout, preview: null });
          return;
        }
      }
    }
    if (sel.tool === 'free') {
      // Press, drag, release: a diagonal wall between the two (snapped) points.
      const a = snapPoint(r, p.x, p.y, pointOpts(altOf(e), touch));
      setDrag({ kind: 'draw', a, b: null, press: [p.x, p.y], startPx: [e.clientX, e.clientY], moved: false, preview: null });
      return;
    }
    const fhit = freeWallAt(r, p.x, p.y, hitMm(touch));
    if (fhit) {
      selectFreeWall(binId, fhit.id);
      setDrag({ kind: 'free-move', id: fhit.id, layout: info.layout, origin: [p.x, p.y], startPx: [e.clientX, e.clientY], moved: false, preview: null });
      return;
    }
    const hit = wallAt(r, p.x, p.y, hitMm(touch));
    if (hit) {
      selectWall(binId, hit.id);
      const ctx = dragContext(info.layout, r, hit.id);
      if (ctx) setDrag({ kind: 'wall', id: hit.id, layout: info.layout, ctx, startPx: [e.clientX, e.clientY], moved: false, preview: null });
      return;
    }
    const comp = compartmentAt(r, p.x, p.y);
    const badge = (e.target as Element).closest?.('[data-comp]')?.getAttribute('data-comp');
    if (badge || sel.tool === 'select') {
      selectCompartment(binId, badge ?? comp?.key ?? null);
      return;
    }
    const g = comp ? ghostFor(p.x, p.y, altOf(e), shiftOf(e), touch) : null;
    if (g) {
      const wall = makeWall(info.layout, g.orient, g.pos, g, { start: g.startRef, end: g.endRef }, g.snap);
      const next = addWall(info.layout, info.size, wall);
      commit(next);
      selectWall(binId, wall.id);
      // Keep the button down to slide the new wall into place.
      const ctx = dragContext(next, resolveIn(next, info.size), wall.id);
      if (ctx) setDrag({ kind: 'wall', id: wall.id, layout: next, ctx, startPx: [e.clientX, e.clientY], moved: false, preview: null, fresh: true });
      return;
    }
    if (comp) selectCompartment(binId, comp.key);
    else clearInteriorSelection();
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    const p = toMm(e);
    if (!p) return;
    const touch = isTouch(e);
    const alt = altOf(e);
    const slop = tapSlop(touch) - 1;
    const onBadge = !!(e.target as Element).closest?.('[data-comp]');
    setHover({ x: p.x, y: p.y, onBadge });
    if (mods.alt !== e.altKey || mods.shift !== e.shiftKey) setMods({ alt: e.altKey, shift: e.shiftKey });
    if (!drag) return;
    if (drag.kind === 'draw') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.startPx[0], e.clientY - drag.startPx[1]) > slop;
      if (!moved) return;
      const b = snapPoint(info.resolved, p.x, p.y, { ...pointOpts(alt, touch), from: [drag.a.x, drag.a.y], constrain: shiftOf(e) });
      setDrag({ ...drag, moved, b });
      return;
    }
    if (drag.kind === 'free-end' || drag.kind === 'free-bend' || drag.kind === 'free-move') {
      const r0 = resolveIn(drag.layout, info.size);
      const F = r0.free.find((f) => f.id === drag.id);
      if (!F) return;
      const show = (lay: DividerLayout) => ({ layout: lay, resolved: resolveIn(lay, info.size) });
      if (drag.kind === 'free-end') {
        const fixed = drag.which === 'a' ? F.b : F.a;
        const at = snapPoint(r0, p.x, p.y, { ...pointOpts(alt, touch), from: fixed, constrain: shiftOf(e), exclude: F.id });
        if (Math.hypot(at.x - fixed[0], at.y - fixed[1]) < MIN_FREE_WALL) return;
        const end: [number, number] = [at.x, at.y];
        setDrag({ ...drag, at, preview: show(updateFreeWall(drag.layout, info.size, F.id, drag.which === 'a' ? { a: end } : { b: end })) });
      } else if (drag.kind === 'free-bend') {
        setDrag({ ...drag, preview: show(updateFreeWall(drag.layout, info.size, F.id, { bend: bendAt(F, p.x, p.y, alt) })) });
      } else {
        const moved = drag.moved || Math.hypot(e.clientX - drag.startPx[0], e.clientY - drag.startPx[1]) > slop;
        if (!moved) return;
        let dx = p.x - drag.origin[0];
        let dy = p.y - drag.origin[1];
        if (!alt) {
          dx = Math.round(dx / step) * step;
          dy = Math.round(dy / step) * step;
        }
        // Both ends stay in the cavity.
        dx = Math.min(IW - Math.max(F.a[0], F.b[0]), Math.max(-Math.min(F.a[0], F.b[0]), dx));
        dy = Math.min(ID - Math.max(F.a[1], F.b[1]), Math.max(-Math.min(F.a[1], F.b[1]), dy));
        const lay = updateFreeWall(drag.layout, info.size, F.id, { a: [F.a[0] + dx, F.a[1] + dy], b: [F.b[0] + dx, F.b[1] + dy] });
        setDrag({ ...drag, moved: true, preview: show(lay) });
      }
      return;
    }
    if (drag.kind === 'wall') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.startPx[0], e.clientY - drag.startPx[1]) > slop;
      if (!moved) return;
      const across = drag.ctx.orient === 'v' ? p.x : p.y;
      const snap = snapAcross({
        pointer: across,
        lo: drag.ctx.lo,
        hi: drag.ctx.hi,
        inner: acrossSize(drag.ctx.orient, IW, ID),
        align: drag.ctx.align,
        cells: drag.ctx.orient === 'v' ? cellsX : cellsY,
        ...snapOpts(alt, touch),
      });
      const c = clampDrag(drag.layout, info.size, drag.id, snap.pos);
      setDrag({ ...drag, moved: true, preview: { ...c, snap: Math.abs(c.pos - snap.pos) < 1e-6 ? snap : null } });
    } else {
      const r0 = resolveIn(drag.layout, info.size);
      const W = r0.byId.get(drag.id);
      if (!W) return;
      const t = nearestTarget(endTargets(r0, drag.id, drag.which), W.orient === 'v' ? p.y : p.x);
      if (!t) return;
      const lay = setWallEnd(drag.layout, info.size, drag.id, drag.which, t.ref);
      if (lay) setDrag({ ...drag, preview: { target: t, layout: lay, resolved: resolveIn(lay, info.size) } });
    }
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    // A finger leaves no hover behind (no ghost wall where it lifted).
    if (isTouch(e)) setHover(null);
    if (drag?.kind === 'wall' && drag.moved && drag.preview) {
      const s = drag.preview.snap;
      commit(moveWall(drag.layout, info.size, drag.id, drag.preview.pos, s && s.kind !== 'step' && s.kind !== 'free' ? s : undefined), drag.fresh);
    } else if (drag?.kind === 'end' && drag.preview) {
      const cur = drag.layout.walls.find((w) => w.id === drag.id);
      if (cur && cur[drag.which] !== drag.preview.target.ref) commit(drag.preview.layout);
    } else if (drag?.kind === 'draw') {
      if (drag.moved && drag.b) {
        const res = addFreeWall(info.layout, info.size, [drag.a.x, drag.a.y], [drag.b.x, drag.b.y]);
        if (res) {
          commit(res.layout);
          selectFreeWall(binId, res.id);
        }
      } else {
        // A click: pick what's under it.
        const [x, y] = drag.press;
        const f = freeWallAt(info.resolved, x, y, hitMm(touchPress.current));
        const wl = f ? null : wallAt(info.resolved, x, y, hitMm(touchPress.current));
        if (f) selectFreeWall(binId, f.id);
        else if (wl) selectWall(binId, wl.id);
        else clearInteriorSelection();
      }
    } else if ((drag?.kind === 'free-end' || drag?.kind === 'free-bend' || drag?.kind === 'free-move') && drag.preview) {
      commit(drag.preview.layout);
    }
    setDrag(null);
  };

  // ------------------------------------------------------------------ dimension labels

  const beginEdit = (wallId: string, side: 'lo' | 'hi', x: number, y: number, value: number) => {
    const at = toScreen(x, y);
    const text = lengthFieldText(value, units, precision);
    editDone.current = false;
    setEditing({ wallId, side, ...at, text, initial: text });
  };
  /** Apply a typed gap. On blur, invalid text just closes the field. */
  const finishEdit = (ed: Editing, blur = false) => {
    if (editDone.current) return;
    const v = parseLength(ed.text, units);
    if (v === null || v < MIN_GAP - 1e-9) {
      if (blur) setEditing(null);
      else setEditing({ ...ed, bad: true });
      return;
    }
    editDone.current = true;
    if (ed.text !== ed.initial) commit(setWallGap(info.layout, info.size, ed.wallId, ed.side, Math.round(v * 1000) / 1000));
    setEditing(null);
  };

  /** Dimension line between two faces across a wall's axis, at run coordinate `run`. */
  const dim = (key: string, orient: Orient, a: number, b: number, run: number, opts: { onClick?: () => void; live?: boolean } = {}) => {
    if (b - a < 0.05) return null;
    const text = fmt(b - a);
    const mid = (a + b) / 2;
    const [x1, y1, x2, y2] = orient === 'v' ? [a, run, b, run] : [run, a, run, b];
    const [cx, cy] = orient === 'v' ? [mid, run] : [run, mid];
    const wch = text.length * fs * 0.58 + fs;
    const room = (b - a) * pxPerMm > wch * pxPerMm + 6;
    // Labels that don't fit between the faces sit beside the line.
    const [lx, ly] = room ? [cx, cy] : orient === 'v' ? [cx, cy + fs * 1.4] : [cx + wch / 2 + fs * 0.6, cy];
    return (
      <g key={key} className={`ie-dim ${opts.live ? 'live' : ''} ${opts.onClick ? 'editable' : ''}`}>
        <line x1={x1} y1={sy(y1)} x2={x2} y2={sy(y2)} />
        <line className="tick" x1={orient === 'v' ? a : run - px(4)} y1={sy(orient === 'v' ? run - px(4) : a)} x2={orient === 'v' ? a : run + px(4)} y2={sy(orient === 'v' ? run + px(4) : a)} />
        <line className="tick" x1={orient === 'v' ? b : run - px(4)} y1={sy(orient === 'v' ? run - px(4) : b)} x2={orient === 'v' ? b : run + px(4)} y2={sy(orient === 'v' ? run + px(4) : b)} />
        <g
          className="ie-chip"
          // Open on click, not pointerdown: the mousedown that follows would take focus from the new field.
          onPointerDown={opts.onClick ? (e) => e.stopPropagation() : undefined}
          onClick={opts.onClick}
        >
          <rect x={lx - wch / 2} y={sy(ly) - fs * 0.8} width={wch} height={fs * 1.6} rx={fs * 0.4} />
          <text x={lx} y={sy(ly)} fontSize={fs} textAnchor="middle" dominantBaseline="central">
            {text}
          </text>
          {opts.onClick && <title>Click to type an exact size</title>}
        </g>
      </g>
    );
  };

  const wallDims = (r: ResolvedLayout, id: string, live: boolean) => {
    const W = r.byId.get(id);
    const g = wallGaps(r, id);
    if (!W || !g) return null;
    const loFace = g.lo.pos + T / 2;
    const hiFace = g.hi.pos - T / 2;
    // A third of the way along, clear of the compartment badges in the middle.
    const run = Math.min(Math.max(W.start + (W.end - W.start) / 3, W.start + fs), W.end - fs);
    const at = (a: number, b: number): [number, number] => (W.orient === 'v' ? [(a + b) / 2, run] : [run, (a + b) / 2]);
    return (
      <>
        {dim('lo', W.orient, loFace, W.pos - T / 2, run, {
          live,
          onClick: live ? undefined : () => beginEdit(id, 'lo', ...at(loFace, W.pos - T / 2), g.loGap),
        })}
        {dim('hi', W.orient, W.pos + T / 2, hiFace, run, {
          live,
          onClick: live ? undefined : () => beginEdit(id, 'hi', ...at(W.pos + T / 2, hiFace), g.hiGap),
        })}
      </>
    );
  };

  // ------------------------------------------------------------------ guides

  const guides = (orient: Orient, s: SnapResult | null, pointerRun: number) => {
    if (!s || !s.matches.length) return null;
    const runSize = orient === 'v' ? ID : IW;
    const lines = s.matches.filter((m) => m.kind !== 'fraction');
    const label = [...new Set(s.matches.map((m) => m.label))].join(' · ');
    const chipRun = Math.min(Math.max(pointerRun + px(22), fs * 2), runSize - fs * 2);
    const [cx, cy] = orient === 'v' ? [s.pos + px(10), chipRun] : [chipRun, s.pos + px(10)];
    const wch = label.length * fs * 0.56 + fs;
    return (
      <g className="ie-guides">
        {lines.map((m: SnapMatch, k) => (
          <line
            key={`${m.kind}${k}`}
            className={`ie-guide ${m.kind}`}
            x1={orient === 'v' ? m.pos : 0}
            x2={orient === 'v' ? m.pos : IW}
            y1={sy(orient === 'v' ? 0 : m.pos)}
            y2={sy(orient === 'v' ? ID : m.pos)}
          />
        ))}
        <g className="ie-snap-chip">
          <rect x={cx} y={sy(cy) - fs * 0.8} width={wch} height={fs * 1.6} rx={fs * 0.8} />
          <text x={cx + wch / 2} y={sy(cy)} fontSize={fs} textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
        </g>
      </g>
    );
  };

  // ------------------------------------------------------------------ render

  const pad = Math.max(WALL + px(28), Math.max(IW, ID) * 0.05);
  const cursor = drag
    ? drag.kind === 'wall'
      ? drag.ctx.orient === 'v'
        ? 'ew-resize'
        : 'ns-resize'
      : drag.kind === 'draw'
        ? 'crosshair'
        : drag.kind === 'free-move'
          ? 'move'
          : 'grabbing'
    : (selWall &&
          hover &&
          (['start', 'end'] as const).some((wh) => {
            const [hx, hy] = handleAt(selWall, wh);
            return Math.hypot(hx - hover.x, hy - hover.y) <= grabMm(false);
          })) ||
        (selFree && hover && freeHandleAt(selFree, hover.x, hover.y))
      ? 'grab'
      : sel.tool === 'free'
        ? 'crosshair'
        : hoverFree
          ? 'move'
          : hoverWall
        ? hoverWall.orient === 'v'
          ? 'ew-resize'
          : 'ns-resize'
        : sel.tool === 'select' || hover?.onBadge
          ? 'pointer'
          : ghost
            ? 'crosshair'
            : 'default';

  const dragSnap = drag?.kind === 'wall' ? drag.preview?.snap ?? null : null;
  const dragged = drag?.kind === 'wall' && drag.preview ? view.byId.get(drag.id) : null;

  // ------------------------------------------------------------------ wall extras (notches, diagonal / curved walls)

  const wallH = dividerHeight(info.opts);
  const notchMarks = (W: ResolvedWall) => {
    if (!W.wall.notch) return null;
    // A removable wall's notch is on its plates: one per plate.
    const spans = W.removable ? removableSegments(view, info.opts.lip).filter((sg) => sg.wallId === W.id) : wallSpans(view, W.id);
    return spans.map((sp, k) => {
      const n = fitNotch(W.wall.notch, sp.b - sp.a, Math.max(1, wallH - W.lower));
      if (!n) return null;
      const c = (sp.a + sp.b) / 2;
      const [x0, x1, y0, y1] =
        W.orient === 'v' ? [W.pos - T / 2, W.pos + T / 2, c - n.width / 2, c + n.width / 2] : [c - n.width / 2, c + n.width / 2, W.pos - T / 2, W.pos + T / 2];
      return <rect key={`n${k}`} className="ie-notch" x={x0} y={sy(y1)} width={x1 - x0} height={y1 - y0} />;
    });
  };
  const ringPath = (ring: [number, number][]) => `M${ring.map(([x, y]) => `${x},${sy(y)}`).join('L')}Z`;
  const polyPoints = (path: [number, number][]) => path.map(([x, y]) => `${x},${sy(y)}`).join(' ');
  /** A text chip with its left edge at (x, y), flipped to the left of x near the right edge. */
  const chipAt = (key: string, x: number, y: number, text: string, cls: string) => {
    const wch = text.length * fs * 0.56 + fs;
    const left = x + wch > IW + WALL ? x - wch - px(20) : x;
    return (
      <g key={key} className={cls}>
        <rect x={left} y={sy(y) - fs * 0.8} width={wch} height={fs * 1.6} rx={fs * 0.8} />
        <text x={left + wch / 2} y={sy(y)} fontSize={fs} textAnchor="middle" dominantBaseline="central">
          {text}
        </text>
      </g>
    );
  };
  const measureText = (a: [number, number], b: [number, number], bend = 0) => {
    const m = freeWallMeasure(a, b, bend);
    return `${fmt(m.length)} · ${Math.round(m.angle * 10) / 10}°${m.radius ? ` · R ${fmt(m.radius)}` : ''}`;
  };
  const snapMark = (key: string, pt: PointSnap, labelBelow = false) => (
    <g key={key} className="ie-pt-snap">
      <circle cx={pt.x} cy={sy(pt.y)} r={px(pt.label ? 4 : 2.5)} />
      {pt.label && chipAt(`${key}l`, pt.x + px(10), pt.y + px(labelBelow ? -16 : 16), pt.label, 'ie-snap-chip')}
    </g>
  );
  const freeOverlay = () => {
    if (drag?.kind === 'draw') {
      if (!drag.b) return snapMark('a', drag.a);
      const a: [number, number] = [drag.a.x, drag.a.y];
      const b: [number, number] = [drag.b.x, drag.b.y];
      const shape = freeWallShape(a, b);
      return (
        <g className="ie-ghost-group">
          <g className="ie-ghost ie-free-ghost">
            <path d={ringPath(freeWallOutline(shape))} />
            <polyline points={polyPoints(shape.path)} />
          </g>
          {snapMark('a', drag.a)}
          {snapMark('b', drag.b)}
          {chipAt('len', drag.b.x + px(12), drag.b.y - px(16), measureText(a, b), 'ie-measure')}
        </g>
      );
    }
    if ((drag?.kind === 'free-end' || drag?.kind === 'free-bend') && selFree) {
      const m = freeWallMid(selFree);
      const at = drag.kind === 'free-end' ? drag.at : null;
      const [lx, ly] = at ? [at.x, at.y] : m;
      return (
        <g className="ie-ghost-group">
          {at && snapMark('at', at)}
          {chipAt('len', lx + px(12), ly - px(16), measureText(selFree.a, selFree.b, selFree.bend), 'ie-measure')}
        </g>
      );
    }
    if (!drag && selFree) {
      const m = freeWallMid(selFree);
      return chipAt('len', m[0] + px(12), m[1] - px(16), measureText(selFree.a, selFree.b, selFree.bend), 'ie-measure quiet');
    }
    if (!drag && hoverSnap) return snapMark('hover', hoverSnap);
    return null;
  };

  return (
    <div className={`interior-editor ${drag || ghost || selWall || selFree ? 'measuring' : ''}`}>
      <InteriorToolbar info={info} onLayout={(l) => commit(l)} />
      <div className="ie-canvas" ref={wrapRef}>
        <svg
          ref={svgRef}
          viewBox={`${-pad} ${-pad} ${IW + 2 * pad} ${ID + 2 * pad}`}
          style={{ cursor }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => !drag && setHover(null)}
          role="application"
          aria-label="Bin compartments. Click to add a wall, drag walls to move them."
        >
          <rect className="ie-bin" x={-WALL} y={-WALL} width={IW + 2 * WALL} height={ID + 2 * WALL} rx={BASE_TOP_RADIUS} />
          <rect className="ie-cavity" x={0} y={0} width={IW} height={ID} rx={INNER_RADIUS} />
          {view.compartments.map((c) => (
            <CompartmentShape
              key={c.key}
              c={c}
              info={info}
              sy={sy}
              selected={c.key === sel.compKey}
              hovered={c.key === hoverComp?.key && (sel.tool === 'select' || !!hover?.onBadge)}
            />
          ))}
          {cellsX.map((x) => (
            <line key={`cx${x}`} className="ie-seam" x1={x} x2={x} y1={0} y2={ID} />
          ))}
          {cellsY.map((y) => (
            <line key={`cy${y}`} className="ie-seam" x1={0} x2={IW} y1={sy(y)} y2={sy(y)} />
          ))}
          {view.walls.map((W) => {
            const r = wallRect(W);
            const cls = ['ie-wall', W.lower > 0 && 'lowered', W.removable && 'removable', W.id === sel.wallId && 'selected', W.id === hoverWall?.id && 'hover']
              .filter(Boolean)
              .join(' ');
            return (
              <g key={W.id} className={cls}>
                <rect x={r.x0} y={sy(r.y1)} width={r.x1 - r.x0} height={r.y1 - r.y0} />
                <line
                  x1={W.orient === 'v' ? W.pos : W.start}
                  x2={W.orient === 'v' ? W.pos : W.end}
                  y1={sy(W.orient === 'v' ? W.start : W.pos)}
                  y2={sy(W.orient === 'v' ? W.end : W.pos)}
                />
                {notchMarks(W)}
                <title>
                  {[
                    W.removable ? 'Removable divider' : 'Divider',
                    W.lower > 0 ? `lowered ${fmt(W.lower)}` : '',
                    W.wall.notch ? 'finger notch' : '',
                    W.wall.top && W.wall.top !== 'flat' ? `${W.wall.top === 'chamfer' ? 'chamfered' : 'rounded'} top` : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </title>
              </g>
            );
          })}
          {view.free.map((F) => {
            const cls = ['ie-wall', 'ie-free', F.lower > 0 && 'lowered', F.id === sel.freeId && 'selected', F.id === hoverFree?.id && 'hover'].filter(Boolean).join(' ');
            return (
              <g key={F.id} className={cls}>
                <path d={ringPath(freeWallOutline(F))} />
                <polyline points={polyPoints(F.path)} />
                <title>{[F.bend ? 'Curved wall' : 'Diagonal wall', fmt(F.length), F.lower > 0 ? `lowered ${fmt(F.lower)}` : ''].filter(Boolean).join(', ')}</title>
              </g>
            );
          })}
          {view.compartments.map((c) => (
            <Badge key={c.key} c={c} info={info} sy={sy} fs={fs} pxPerMm={pxPerMm} fmt={fmt} selected={c.key === sel.compKey} />
          ))}

          {ghost && (
            <g className="ie-ghost-group">
              <GhostWall g={ghost} sy={sy} />
              {dim('glo', ghost.orient, ghost.lo.pos + T / 2, ghost.pos - T / 2, ghost.orient === 'v' ? hover!.y : hover!.x, { live: true })}
              {dim('ghi', ghost.orient, ghost.pos + T / 2, ghost.hi.pos - T / 2, ghost.orient === 'v' ? hover!.y : hover!.x, { live: true })}
              {guides(ghost.orient, ghost.snap, ghost.orient === 'v' ? hover!.y : hover!.x)}
            </g>
          )}
          {dragged && (
            <>
              {wallDims(view, dragged.id, true)}
              {guides(dragged.orient, dragSnap, hover ? (dragged.orient === 'v' ? hover.y : hover.x) : (dragged.start + dragged.end) / 2)}
            </>
          )}
          {!drag && selWall && wallDims(view, selWall.id, false)}
          {selWall && (!drag || drag.kind === 'end') && (
            <g className="ie-handles">
              {(['start', 'end'] as const).map((wh) => {
                const [hx, hy] = handleAt(selWall, wh);
                return <circle key={wh} className="ie-handle" cx={hx} cy={sy(hy)} r={px(handlePx)} />;
              })}
            </g>
          )}
          {selFree && drag?.kind !== 'free-move' && (
            <g className="ie-handles">
              {[selFree.a, selFree.b].map((q, k) => (
                <circle key={k} className="ie-handle" cx={q[0]} cy={sy(q[1])} r={px(handlePx)} />
              ))}
              {(() => {
                const [mx, my] = freeWallMid(selFree);
                const h = px(handlePx * 0.85);
                return (
                  <rect className="ie-handle ie-bend-handle" x={mx - h} y={sy(my) - h} width={2 * h} height={2 * h} transform={`rotate(45 ${mx} ${sy(my)})`}>
                    <title>Drag to curve the wall</title>
                  </rect>
                );
              })()}
            </g>
          )}
          {freeOverlay()}
          <text className="ie-caption" x={IW / 2} y={-WALL - px(8)} textAnchor="middle" fontSize={fs * 0.9}>
            back
          </text>
          <text className="ie-caption" x={IW / 2} y={ID + WALL + px(8)} textAnchor="middle" dominantBaseline="hanging" fontSize={fs * 0.9}>
            front
          </text>
        </svg>
        {editing && (
          <input
            className={`ie-edit ${editing.bad ? 'bad' : ''}`}
            style={{ left: editing.left, top: editing.top }}
            autoFocus
            value={editing.text}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEditing({ ...editing, text: e.target.value, bad: false })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEdit(editing);
              if (e.key === 'Escape') {
                editDone.current = true;
                setEditing(null);
              }
              e.stopPropagation();
            }}
            onBlur={() => finishEdit(editing, true)}
            aria-label="Gap"
          />
        )}
      </div>
      <div className="ie-hint">
        {coarse ? (
          sel.tool === 'free' ? (
            <>Drag from point to point to draw a wall · it snaps to corners, wall ends, midpoints and quarter points · drag the middle handle to curve it</>
          ) : sel.tool === 'wall' ? (
            <>Tap to add a wall · drag a wall to move it · Flip turns the next wall the other way · tap a size to type it</>
          ) : (
            <>Tap a compartment to set its scoop, label and floor · drag walls to move them</>
          )
        ) : sel.tool === 'free' ? (
          <>
            Drag from point to point to draw a wall · snaps to corners, wall ends, midpoints and quarter points · <kbd>Shift</kbd> 15° steps ·{' '}
            <kbd>Alt</kbd> no snapping · drag the middle handle to curve it · <kbd>Del</kbd> removes
          </>
        ) : sel.tool === 'wall' ? (
          <>
            Click to add a wall · drag a wall to move it · <kbd>Shift</kbd> flips direction · <kbd>R</kbd> locks it · <kbd>Alt</kbd>{' '}
            turns off snapping · click a size to type it · <kbd>Del</kbd> removes
          </>
        ) : (
          <>Click a compartment to set its scoop, label and floor · drag walls to move them</>
        )}
      </div>
    </div>
  );
}

function GhostWall({ g, sy }: { g: Ghost; sy: (y: number) => number }) {
  const [x0, x1, y0, y1] = g.orient === 'v' ? [g.pos - T / 2, g.pos + T / 2, g.start, g.end] : [g.start, g.end, g.pos - T / 2, g.pos + T / 2];
  return (
    <g className="ie-ghost">
      <rect x={x0} y={sy(y1)} width={x1 - x0} height={y1 - y0} />
      <line
        x1={g.orient === 'v' ? g.pos : g.start}
        x2={g.orient === 'v' ? g.pos : g.end}
        y1={sy(g.orient === 'v' ? g.start : g.pos)}
        y2={sy(g.orient === 'v' ? g.end : g.pos)}
      />
    </g>
  );
}

function InteriorToolbar({ info, onLayout }: { info: BinInterior & { binId: string }; onLayout: (l: DividerLayout) => void }) {
  const tool = useInterior((s) => s.tool);
  const orient = useInterior((s) => s.orient);
  const set = useInterior((s) => s.set);
  const coarse = useCoarsePointer();
  const modes = useTouchModes();
  const n = info.resolved.compartments.length;
  return (
    <div className="ie-toolbar">
      <Segmented
        value={tool}
        options={[
          { value: 'wall', label: 'Add walls', title: 'Click inside the bin to add a wall (W)' },
          { value: 'free', label: 'Diagonal / curved', title: 'Drag from point to point to draw a diagonal wall; drag its middle handle to curve it (D)' },
          { value: 'select', label: 'Select', title: 'Click compartments to edit them (S)' },
        ]}
        onChange={(t) => set({ tool: t })}
      />
      {tool !== 'free' && <Segmented
        value={orient}
        options={[
          { value: 'auto', label: 'Auto', title: 'Direction follows the pointer (A)' },
          { value: 'v', label: '┃', title: 'Front-to-back walls (V)' },
          { value: 'h', label: '━', title: 'Side-to-side walls (H)' },
        ]}
        onChange={(o) => set({ orient: o })}
      />}
      {coarse && tool !== 'select' && (
        <span className="touch-toggles">
          <TouchToggle
            on={modes.flip}
            label={tool === 'free' ? '15° steps' : 'Flip'}
            title={tool === 'free' ? 'Keep diagonal walls to 15° steps (Shift)' : 'Turn the next wall the other way (Shift)'}
            onChange={(flip) => modes.set({ flip })}
          />
          <TouchToggle on={modes.free} label="No snap" title="Place walls freely, without snapping (Alt)" onChange={(free) => modes.set({ free })} />
        </span>
      )}
      <LayoutActions info={info} onLayout={onLayout} />
      <span className="ie-status">
        {n} compartment{n === 1 ? '' : 's'}
        {!info.custom && info.opts.divX * info.opts.divY > 1 ? ` · ${info.opts.divX} × ${info.opts.divY} grid` : ''}
        {info.resolved.free.length ? ` · ${info.resolved.free.length} diagonal` : ''}
      </span>
    </div>
  );
}

/** Effective options of a compartment (its own, else the bin's); see interiorState.ts. */
export { compartmentOptions };

function CompartmentShape({
  c,
  info,
  sy,
  selected,
  hovered,
}: {
  c: Compartment;
  info: BinInterior;
  sy: (y: number) => number;
  selected: boolean;
  hovered: boolean;
}) {
  const o = compartmentOptions(info, c.key);
  const tabStrip = c.isRect ? c.rects[0] : c.rects.filter((r) => r.open.back).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
  return (
    <g className={`ie-comp ${selected ? 'selected' : ''} ${hovered ? 'hover' : ''} ${o.floor > 0 ? 'raised' : ''}`}>
      {c.rects.map((r, k) => (
        <rect key={k} x={r.x0} y={sy(r.y1)} width={r.x1 - r.x0} height={r.y1 - r.y0} />
      ))}
      <CompartmentInsidePreview c={c} info={info} sy={sy} />
      {o.scoop > 0 &&
        c.rects
          .filter((r) => c.isRect || r.open.front)
          .map((r, k) => {
            const depth = Math.min((r.y1 - r.y0) * 0.35, 12) * o.scoop;
            return <rect key={`s${k}`} className="ie-scoop" x={r.x0} y={sy(r.y0 + depth)} width={r.x1 - r.x0} height={depth} />;
          })}
      {o.label !== 'none' &&
        tabStrip &&
        (() => {
          const r = tabStrip;
          const cw = r.x1 - r.x0;
          const td = Math.min(TAB_DEPTH, (r.y1 - r.y0) * 0.45);
          const tw = o.label === 'full' ? cw : Math.min(cw, TAB_WIDTH_NOMINAL);
          const x0 = o.label === 'full' || o.label === 'left' ? r.x0 : o.label === 'right' ? r.x1 - tw : (r.x0 + r.x1) / 2 - tw / 2;
          const text = labelPlainText(compartmentLabelText(info.opts, c.key)).split('\n')[0];
          // Rough fit: condensed capitals are about 0.5 em wide.
          const fsz = Math.min(td * 0.55, ((tw - 2) / Math.max(text.length, 1)) * 1.9);
          return (
            <g>
              <rect className="ie-tab" x={x0} y={sy(r.y1)} width={tw} height={td} />
              {text && fsz > 1 && (
                <text className="ie-tab-text" x={x0 + tw / 2} y={sy(r.y1 - td / 2)} fontSize={fsz} textAnchor="middle" dominantBaseline="central">
                  {text}
                </text>
              )}
            </g>
          );
        })()}
    </g>
  );
}

function Badge({
  c,
  info,
  sy,
  fs,
  pxPerMm,
  fmt,
  selected,
}: {
  c: Compartment;
  info: BinInterior;
  sy: (y: number) => number;
  fs: number;
  pxPerMm: number;
  fmt: (mm: number, o?: { unit?: boolean }) => string;
  selected: boolean;
}) {
  const b = c.bounds;
  const big = c.rects.reduce((a, r) => ((r.x1 - r.x0) * (r.y1 - r.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? r : a));
  const o = compartmentOptions(info, c.key);
  const text = `${fmt(b.x1 - b.x0, { unit: false })} × ${fmt(b.y1 - b.y0)}${c.isRect ? '' : ' ⌐'}`;
  const extras: ReactNode[] = [];
  if (o.floor > 0) extras.push(`+${fmt(o.floor, { unit: false })} floor`);
  const inside = useInsideBadge(info, c);
  if (inside) extras.push(inside);
  const wch = text.length * fs * 0.56 + fs;
  if (wch * pxPerMm > (big.x1 - big.x0) * pxPerMm - 6 || fs * 1.7 * pxPerMm > (big.y1 - big.y0) * pxPerMm - 4) {
    // Too small for a label: a dot still lets it be picked.
    return <circle className={`ie-badge-dot ${selected ? 'selected' : ''}`} data-comp={c.key} cx={c.point[0]} cy={sy(c.point[1])} r={fs * 0.45} />;
  }
  return (
    <g className={`ie-badge ${selected ? 'selected' : ''} ${o.own ? 'own' : ''}`} data-comp={c.key}>
      <rect x={c.point[0] - wch / 2} y={sy(c.point[1]) - fs * 0.85} width={wch} height={fs * 1.7} rx={fs * 0.5} />
      <text x={c.point[0]} y={sy(c.point[1])} fontSize={fs} textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
      {extras.length > 0 && (
        <text className="ie-badge-sub" x={c.point[0]} y={sy(c.point[1]) + fs * 1.6} fontSize={fs * 0.85} textAnchor="middle" dominantBaseline="central">
          {extras.join(' · ')}
        </text>
      )}
      <title>Click to edit this compartment</title>
    </g>
  );
}
