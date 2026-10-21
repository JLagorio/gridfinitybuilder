import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compartmentLabelText } from '../lib/geometry/labels';
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
import { CompartmentInsidePreview, insideBadge } from './CompartmentInsidePreview';

const T = DIVIDER;
/** Pointer distances, in screen pixels. */
const HIT_PX = 6;
const HANDLE_PX = 6;
const SNAP_PX = 8;
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
type Drag = WallDrag | EndDrag;

interface Editing {
  wallId: string;
  side: 'lo' | 'hi';
  left: number;
  top: number;
  text: string;
  initial: string;
  bad?: boolean;
}

/** Left-pane header in the Bins tab: switches between the drawer grid and the compartment editor. */
export function BinPaneHeader() {
  const pane = useStore((s) => s.ui.binPane ?? 'drawer');
  const setUI = useStore((s) => s.setUI);
  const exists = useStore((s) => !!s.ui.selectedBinId && s.bins.some((b) => b.id === s.ui.selectedBinId));
  // Leave the compartment view when the bin is deselected, so picking a bin on the grid doesn't jump away from it.
  useEffect(() => {
    if (!exists && pane === 'compartments') setUI({ binPane: 'drawer' });
  }, [exists, pane, setUI]);
  // The tool cutouts pane (CutoutEditor.tsx) stays open without a bin; it lists bins to pick from.
  const showing = pane === 'cutouts' ? 'cutouts' : exists && pane === 'compartments' ? 'compartments' : 'drawer';
  return (
    <div className="pane-head">
      <div className="pane-title">
        {showing === 'drawer'
          ? 'Layout — drag to draw bins'
          : showing === 'cutouts'
            ? 'Tool cutouts — drag tools into the bin'
            : 'Compartments — click inside the bin to add a wall'}
      </div>
      <Segmented
        value={showing}
        options={[
          { value: 'drawer', label: 'Drawer layout' },
          { value: 'compartments', label: 'Compartments', title: exists ? 'Edit the selected bin’s walls' : 'Select a bin first' },
          { value: 'cutouts', label: 'Tool cutouts', title: 'Lay out traced tools as pockets in the selected bin' },
        ]}
        onChange={(v) => (v !== 'compartments' || exists) && setUI({ binPane: v })}
      />
    </div>
  );
}

/** The bin whose compartments the left pane shows, or null for the drawer grid. */
export function useInteriorPane(): string | null {
  return useStore((s) =>
    s.ui.binPane === 'compartments' && s.ui.selectedBinId && s.bins.some((b) => b.id === s.ui.selectedBinId) ? s.ui.selectedBinId : null,
  );
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

  /** Each edit starts its own undo step; `join` doesn't force one (sliding a wall just placed groups with it if quick). */
  const commit = (next: DividerLayout, join = false) => {
    if (!join) history.checkpoint();
    updateBin(binId, { opts: { layout: next } });
  };
  const step = snapStep(units, precision || 16);
  const cellsX = useMemo(() => (info ? cellLines(info.cells.x) : []), [info]);
  const cellsY = useMemo(() => (info ? cellLines(info.cells.y) : []), [info]);
  const snapOpts = (alt: boolean) => ({ tolerance: SNAP_PX / pxPerMm, step, free: alt, cellsX, cellsY });

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
      if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
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
        } else if (s.wallId || s.compKey) {
          clearInteriorSelection();
          stop();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never delete the whole bin from here.
        stop();
        if (s.wallId && !d) {
          history.checkpoint();
          updateBin(binId, { opts: { layout: removeWall(inf.layout, inf.size, s.wallId) } });
          clearInteriorSelection();
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
  const ghostFor = (x: number, y: number, alt: boolean, shift: boolean): Ghost | null => {
    if (wallAt(info.resolved, x, y, px(HIT_PX))) return null;
    return ghostAt(info.resolved, x, y, orientAt(x, y, shift), snapOpts(alt));
  };
  const handleAt = (W: ResolvedWall, which: 'start' | 'end'): [number, number] => {
    const run = which === 'start' ? W.start : W.end;
    return W.orient === 'v' ? [W.pos, run] : [run, W.pos];
  };

  const ghost = !drag && !editing && hover && !hover.onBadge && sel.tool === 'wall' ? ghostFor(hover.x, hover.y, mods.alt, mods.shift) : null;
  const hoverWall = !drag && hover ? wallAt(view, hover.x, hover.y, px(HIT_PX)) : null;
  const hoverComp = !drag && hover && !hoverWall ? compartmentAt(view, hover.x, hover.y) : null;
  const selWall = sel.wallId ? view.byId.get(sel.wallId) ?? null : null;

  // ------------------------------------------------------------------ pointer

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toMm(e);
    if (!p) return;
    setEditing(null);
    svgRef.current?.setPointerCapture(e.pointerId);
    const r = info.resolved;
    if (selWall) {
      for (const which of ['start', 'end'] as const) {
        const [hx, hy] = handleAt(selWall, which);
        if (Math.hypot(hx - p.x, hy - p.y) <= px(HANDLE_PX + 3)) {
          setDrag({ kind: 'end', id: selWall.id, which, layout: info.layout, preview: null });
          return;
        }
      }
    }
    const hit = wallAt(r, p.x, p.y, px(HIT_PX));
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
    const g = comp ? ghostFor(p.x, p.y, e.altKey, e.shiftKey) : null;
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
    const p = toMm(e);
    if (!p) return;
    const onBadge = !!(e.target as Element).closest?.('[data-comp]');
    setHover({ x: p.x, y: p.y, onBadge });
    if (mods.alt !== e.altKey || mods.shift !== e.shiftKey) setMods({ alt: e.altKey, shift: e.shiftKey });
    if (!drag) return;
    if (drag.kind === 'wall') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.startPx[0], e.clientY - drag.startPx[1]) > 3;
      if (!moved) return;
      const across = drag.ctx.orient === 'v' ? p.x : p.y;
      const snap = snapAcross({
        pointer: across,
        lo: drag.ctx.lo,
        hi: drag.ctx.hi,
        inner: acrossSize(drag.ctx.orient, IW, ID),
        align: drag.ctx.align,
        cells: drag.ctx.orient === 'v' ? cellsX : cellsY,
        ...snapOpts(e.altKey),
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

  const onUp = () => {
    if (drag?.kind === 'wall' && drag.moved && drag.preview) {
      const s = drag.preview.snap;
      commit(moveWall(drag.layout, info.size, drag.id, drag.preview.pos, s && s.kind !== 'step' && s.kind !== 'free' ? s : undefined), drag.fresh);
    } else if (drag?.kind === 'end' && drag.preview) {
      const cur = drag.layout.walls.find((w) => w.id === drag.id);
      if (cur && cur[drag.which] !== drag.preview.target.ref) commit(drag.preview.layout);
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
    ? drag.kind === 'end'
      ? 'grabbing'
      : drag.ctx.orient === 'v'
        ? 'ew-resize'
        : 'ns-resize'
    : selWall && hover && (['start', 'end'] as const).some((wh) => {
          const [hx, hy] = handleAt(selWall, wh);
          return Math.hypot(hx - hover.x, hy - hover.y) <= px(HANDLE_PX + 3);
        })
      ? 'grab'
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

  return (
    <div className={`interior-editor ${drag || ghost || selWall ? 'measuring' : ''}`}>
      <InteriorToolbar info={info} />
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
                <title>
                  {[W.removable ? 'Removable divider' : 'Divider', W.lower > 0 ? `lowered ${fmt(W.lower)}` : ''].filter(Boolean).join(', ')}
                </title>
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
                return <circle key={wh} className="ie-handle" cx={hx} cy={sy(hy)} r={px(HANDLE_PX)} />;
              })}
            </g>
          )}
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
        {sel.tool === 'wall' ? (
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

function InteriorToolbar({ info }: { info: BinInterior }) {
  const tool = useInterior((s) => s.tool);
  const orient = useInterior((s) => s.orient);
  const set = useInterior((s) => s.set);
  const n = info.resolved.compartments.length;
  return (
    <div className="ie-toolbar">
      <Segmented
        value={tool}
        options={[
          { value: 'wall', label: 'Add walls', title: 'Click inside the bin to add a wall (W)' },
          { value: 'select', label: 'Select', title: 'Click compartments to edit them (S)' },
        ]}
        onChange={(t) => set({ tool: t })}
      />
      <Segmented
        value={orient}
        options={[
          { value: 'auto', label: 'Auto', title: 'Direction follows the pointer (A)' },
          { value: 'v', label: '┃', title: 'Front-to-back walls (V)' },
          { value: 'h', label: '━', title: 'Side-to-side walls (H)' },
        ]}
        onChange={(o) => set({ orient: o })}
      />
      <span className="ie-status">
        {n} compartment{n === 1 ? '' : 's'}
        {!info.custom && info.opts.divX * info.opts.divY > 1 ? ` · ${info.opts.divX} × ${info.opts.divY} grid` : ''}
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
          const text = compartmentLabelText(info.opts, c.key).split('\n')[0];
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
  const inside = insideBadge(info, c);
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
