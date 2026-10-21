import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cellEdge, cellIndexAt, type GridLayout } from '../lib/layout/drawer';
import type { PlacedBin } from '../lib/project';
import { binTotalHeight } from '../lib/geometry/bin';
import { labelCaption } from '../lib/geometry/labelContents';
import { MAX_CELLS, stretchOf } from '../lib/geometry/placement';
import { effectiveStretch } from '../lib/layout/stretch';
import { binRect, canPlace, occupancy, onBlocked, outOfBounds, withBlocked, type CellRect } from '../lib/bins';
import { HANDLES, MAX_BIN_UNITS, canMoveGroup, fitResize, nearestBoundary, resizeTarget, type Handle } from '../lib/binLayout';
import { useLayoutShortcuts } from './useLayoutShortcuts';
import { placedOvershoot, rectFitsBed, type Bed } from '../lib/bedfit';
import type { BinOptions } from '../lib/geometry/bin';
import type { CheckSeverity } from '../lib/printability';
import { dividerLines } from './dividerLines';
import { LevelSwitcher, StackBadge, useStackLevels } from './StackLevels';

interface Props {
  layout: GridLayout;
  bins: PlacedBin[];
  /** Selected bin ids, primary first. */
  selectedIds: string[];
  /** Replace the selection; `primary` is the bin the Bins panel edits. */
  onSelect: (ids: string[], primary?: string | null) => void;
  onCreate: (r: CellRect) => void;
  /** Move bins together by whole cells. */
  onMoveBins: (ids: string[], dx: number, dy: number) => void;
  /** Give a bin a new position and footprint. */
  onResize: (id: string, r: CellRect) => void;
  /** What the printer takes (bedfit.ts): drawing and resizing stop there, and bins past it are marked. */
  bed?: Bed;
  /** Settings new bins are drawn with (their height and type count against the bed too). */
  newBin?: BinOptions;
  /** Bins with print checks (printability.ts), by id: marked with a small dot. */
  marks?: ReadonlyMap<string, CheckSeverity>;
}

type Pt = [number, number];

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt }
  /** `toggle`: a Shift/Cmd-click on an already selected bin, which deselects it unless it turns into a drag. */
  | { kind: 'move'; id: string; ids: string[]; start: Pt; cur: Pt; moved: boolean; additive: boolean; toggle: boolean }
  /** A selection box, in plate mm. `tol` is how far the pointer may wander and still count as a click. */
  | { kind: 'marquee'; start: Pt; cur: Pt; base: string[]; tol: number }
  | { kind: 'resize'; id: string; handle: Handle; from: CellRect; cur: CellRect };

const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const sameRect = (a: CellRect, b: CellRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.d === b.d;

/** "3u", or the height in mm for bins sized in mm. */
function heightCaption(o: PlacedBin['opts']): string {
  return o.heightMode && o.heightMode !== 'units' ? `${Math.round(binTotalHeight(o))}mm` : `${o.heightUnits}u`;
}

/**
 * Top-down drawer grid. Back of the drawer is at the top.
 * Drag over empty cells to draw, click to select (Shift/Cmd-click to add), Shift-drag
 * or drag from outside the grid to box-select, drag a selected bin to move the
 * whole selection, drag a handle to resize. Keyboard: see useLayoutShortcuts.
 */
export function BinGridEditor({ layout, bins: drawerBins, selectedIds: selection, onSelect: select, onCreate, onMoveBins, onResize, bed, newBin, marks }: Props) {
  // Stacked bins (StackLevels.tsx): the grid lays out floor bins and shows one level of their stacks.
  const levels = useStackLevels(drawerBins, selection, select);
  const { bins, selectedIds, onSelect } = levels;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const hoverRef = useRef<Pt | null>(null);
  hoverRef.current = hover;
  useLayoutShortcuts(useCallback(() => hoverRef.current, []));
  // One screen pixel in plate mm, so handles keep their size on screen.
  const [px, setPx] = useState(1);
  const { nx, ny, pitchX, pitchY, xs, ys, plateW, plateD } = layout;
  const occ = useMemo(() => occupancy(bins, nx, ny), [bins, nx, ny]);
  // Placement checks treat blocked cells (layout.mask) as taken.
  const blocked = useMemo(() => withBlocked(bins, layout.mask), [bins, layout.mask]);
  const hatch = `ge-hatch-${useId().replace(/[^\w-]/g, '')}`;
  const pad = 8;
  // Bins are at most 12 u: 24 cells on a half grid.
  const maxUnits = layout.halfGrid ? MAX_CELLS : MAX_BIN_UNITS;

  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const ctm = el.getScreenCTM();
      if (ctm && ctm.a > 0) setPx(1 / ctm.a);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [plateW, plateD, nx, ny]);

  // plate (mm, y up) -> svg (y down)
  const sy = (y: number) => plateD - y;

  const plateAt = (e: React.PointerEvent): Pt | null => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [pt.x, plateD - pt.y];
  };

  const cellOf = (p: Pt | null): Pt | null => {
    if (!p) return null;
    const i = cellIndexAt(xs, p[0]);
    const j = cellIndexAt(ys, p[1]);
    if (i < 0 || j < 0) return null;
    return [i, j];
  };

  /** The cell under a point on a stretched bin's overhang (outside the grid), or null. */
  const stretchedCellAt = (p: Pt): Pt | null => {
    for (const b of bins) {
      const st = stretchOf(effectiveStretch(layout, b));
      if (st.left + st.right + st.front + st.back <= 0) continue;
      const m = mmRect(binRect(b));
      if (p[0] < m.x0 - st.left || p[0] > m.x1 + st.right || p[1] < m.y0 - st.front || p[1] > m.y1 + st.back) continue;
      const i = cellIndexAt(xs, Math.min(Math.max(p[0], m.x0), m.x1 - 1e-6));
      const j = cellIndexAt(ys, Math.min(Math.max(p[1], m.y0), m.y1 - 1e-6));
      if (i >= 0 && j >= 0) return [i, j];
    }
    return null;
  };

  const mmRect = (r: CellRect) => ({
    x0: cellEdge(xs, r.x, pitchX),
    x1: cellEdge(xs, r.x + r.w, pitchX),
    y0: cellEdge(ys, r.y, pitchY),
    y1: cellEdge(ys, r.y + r.d, pitchY),
  });

  const marquee = drag?.kind === 'marquee' ? box(drag.start, drag.cur) : null;
  const marqueeHits = marquee
    ? bins
        .filter((b) => {
          const m = mmRect(binRect(b));
          return m.x0 < marquee.x1 && m.x1 > marquee.x0 && m.y0 < marquee.y1 && m.y1 > marquee.y0;
        })
        .map((b) => b.id)
    : [];
  const selected = new Set(drag?.kind === 'marquee' ? [...drag.base, ...marqueeHits] : selectedIds);

  const ghosts: { r: CellRect; ok: boolean; limit?: boolean }[] = (() => {
    if (!drag) return [];
    if (drag.kind === 'draw') {
      // From the start cell toward the pointer, at most maxUnits cells, and no bigger than the printer takes.
      const span = (a: number, b: number, cap: number) => {
        const n = Math.min(Math.abs(b - a) + 1, maxUnits, cap);
        return [b >= a ? a : a - n + 1, n];
      };
      let capX = Infinity;
      let capY = Infinity;
      let limit = false;
      const rect = () => {
        const [x, w] = span(drag.start[0], drag.cur[0], capX);
        const [y, d] = span(drag.start[1], drag.cur[1], capY);
        return { x, y, w, d };
      };
      let r = rect();
      while (bed && newBin && !rectFitsBed(layout, { opts: newBin }, r, bed) && (r.w > 1 || r.d > 1)) {
        if (r.w >= r.d) capX = r.w - 1;
        else capY = r.d - 1;
        r = rect();
        limit = true;
      }
      return [{ r, ok: canPlace(blocked, r, nx, ny), limit }];
    }
    // Resizing stops before collisions, so its ghost is always placeable.
    if (drag.kind === 'resize') return sameRect(drag.cur, drag.from) ? [] : [{ r: drag.cur, ok: true }];
    if (drag.kind !== 'move' || !drag.moved) return [];
    const dx = drag.cur[0] - drag.start[0];
    const dy = drag.cur[1] - drag.start[1];
    const ok = canMoveGroup(blocked, drag.ids, dx, dy, nx, ny);
    return bins.filter((b) => drag.ids.includes(b.id)).map((b) => ({ r: { ...binRect(b), x: b.x + dx, y: b.y + dy }, ok }));
  })();

  // Handles show on a single selected bin (and follow it while resizing).
  const single = selectedIds.length === 1 ? bins.find((b) => b.id === selectedIds[0]) : undefined;
  const handleRect = drag?.kind === 'resize' ? drag.cur : !drag && single ? binRect(single) : null;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = plateAt(e);
    if (!p) return;
    svg.current?.setPointerCapture?.(e.pointerId);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const handle = (e.target as Element).closest?.('[data-handle]')?.getAttribute('data-handle') as Handle | null;
    if (handle && single) {
      const r = binRect(single);
      setDrag({ kind: 'resize', id: single.id, handle, from: r, cur: r });
      return;
    }
    // Over the margin, a stretched bin's body counts as its edge cell.
    const c = cellOf(p) ?? stretchedCellAt(p);
    const id = c ? occ[c[0]][c[1]] : null;
    if (c && id) {
      // Grabbing a selected bin drags the whole selection.
      const ids = selectedIds.includes(id) ? selectedIds : additive ? [id, ...selectedIds] : [id];
      if (!selectedIds.includes(id)) onSelect(ids, id);
      setDrag({ kind: 'move', id, ids, start: c, cur: c, moved: false, additive, toggle: additive && selectedIds.includes(id) });
    } else if (c && !additive) {
      setDrag({ kind: 'draw', start: c, cur: c });
    } else {
      setDrag({ kind: 'marquee', start: p, cur: p, base: additive ? selectedIds : [], tol: 4 * px });
    }
  };

  const onMoveEvt = (e: React.PointerEvent) => {
    const p = plateAt(e);
    const c = cellOf(p);
    setHover(c);
    if (!drag || !p) return;
    if (drag.kind === 'marquee') {
      setDrag({ ...drag, cur: p });
    } else if (drag.kind === 'resize') {
      const target = resizeTarget(drag.from, drag.handle, nearestBoundary(xs, p[0]), nearestBoundary(ys, p[1]), maxUnits);
      const others = blocked.filter((b) => b.id !== drag.id);
      const bin = bins.find((b) => b.id === drag.id);
      const fits = bed && bin ? (r: CellRect) => rectFitsBed(layout, bin, r, bed) : undefined;
      const cur = fitResize(others, drag.from, target, nx, ny, fits);
      if (!sameRect(cur, drag.cur)) setDrag({ ...drag, cur });
    } else if (c) {
      if (drag.kind === 'draw') setDrag({ ...drag, cur: c });
      else if (c[0] !== drag.cur[0] || c[1] !== drag.cur[1]) setDrag({ ...drag, cur: c, moved: true });
    }
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === 'draw') {
      if (ghosts[0]?.ok) onCreate(ghosts[0].r);
    } else if (drag.kind === 'move') {
      if (drag.moved) {
        if (ghosts[0]?.ok) onMoveBins(drag.ids, drag.cur[0] - drag.start[0], drag.cur[1] - drag.start[1]);
      } else if (drag.toggle) {
        onSelect(selectedIds.filter((x) => x !== drag.id));
      } else if (!drag.additive && selectedIds.length > 1) {
        onSelect([drag.id], drag.id);
      }
    } else if (drag.kind === 'marquee') {
      const click = Math.hypot(drag.cur[0] - drag.start[0], drag.cur[1] - drag.start[1]) <= drag.tol;
      if (!click) {
        const ids = [...new Set([...drag.base, ...marqueeHits])];
        onSelect(ids, selectedIds[0] && ids.includes(selectedIds[0]) ? selectedIds[0] : ids[0]);
      } else if (!drag.base.length) {
        // A plain click outside the grid clears the selection.
        onSelect([]);
      }
    } else if (drag.kind === 'resize' && !sameRect(drag.cur, drag.from)) {
      onResize(drag.id, drag.cur);
    }
    setDrag(null);
  };

  const cellRectSvg = (r: CellRect, inset = 0.25) => {
    const x0 = cellEdge(xs, r.x, pitchX);
    const x1 = cellEdge(xs, r.x + r.w, pitchX);
    const y0 = cellEdge(ys, r.y, pitchY);
    const y1 = cellEdge(ys, r.y + r.d, pitchY);
    return { x: x0 + inset, y: sy(y1) + inset, width: x1 - x0 - 2 * inset, height: y1 - y0 - 2 * inset };
  };

  if (!nx || !ny) return <div className="editor-empty">The drawer is smaller than one grid cell.</div>;

  return (
    <div className="grid-editor">
      <LevelSwitcher levels={levels} />
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${plateW + 2 * pad} ${plateD + 2 * pad}`}
        onPointerDown={onDown}
        onPointerMove={onMoveEvt}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
        role="application"
        aria-label="Drawer grid. Drag to draw a bin, Shift-drag to select bins."
      >
        <rect className="ge-plate" x={0} y={0} width={plateW} height={plateD} rx={4} />
        {Array.from({ length: nx }, (_, i) =>
          Array.from({ length: ny }, (_, j) => {
            const r = cellRectSvg({ x: i, y: j, w: 1, d: 1 }, 1.5);
            const hovered = hover && hover[0] === i && hover[1] === j && !occ[i][j] && !drag;
            return <rect key={`${i}-${j}`} className={`ge-cell ${hovered ? 'hover' : ''}`} {...r} rx={3.5} />;
          }),
        )}
        {!!layout.mask?.length && (
          <defs>
            <pattern id={hatch} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={5} className="ge-hatch" />
            </pattern>
          </defs>
        )}
        {layout.mask?.map((k) => {
          const [i, j] = k.split(',').map(Number);
          return <rect key={`m${k}`} className="ge-blocked" {...cellRectSvg({ x: i, y: j, w: 1, d: 1 }, 1.5)} rx={3.5} fill={`url(#${hatch})`} />;
        })}
        {bins.map((b) => {
          // The bin on the shown level of its stack (faded when the stack isn't that tall).
          const stack = levels.view(b);
          const shown = stack.bin ?? b;
          const feet = cellRectSvg({ x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY }, 0.6);
          // A stretched body reaches over the margin (svg y runs front to back downward).
          const st = stretchOf(effectiveStretch(layout, b));
          const stretched = st.left + st.right + st.front + st.back > 0;
          const r = { x: feet.x - st.left, y: feet.y - st.back, width: feet.width + st.left + st.right, height: feet.height + st.front + st.back };
          const sel = selected.has(b.id);
          const bad = outOfBounds(b, nx, ny) || onBlocked(b, layout.mask);
          // Too big for the printer (e.g. after picking a smaller one): marked until it's shrunk.
          const tooBig = !!bed && placedOvershoot(layout, shown, bed) > 1e-6;
          const fs = Math.min(10, (Math.min(feet.width, feet.height) / 4) | 0) || 6;
          const mark = marks?.get(shown.id);
          return (
            <g key={b.id} className={`ge-bin ${sel ? 'selected' : ''} ${bad ? 'bad' : ''} ${tooBig ? 'too-big' : ''} ${stack.bin ? '' : 'under'}`}>
              <rect {...r} rx={3.75}>
                {tooBig ? <title>Too big for the printer: select it to shrink it</title> : mark && <title>Select it to see its print checks</title>}
              </rect>
              {stretched && <rect {...feet} rx={3.75} fill="none" strokeDasharray="3 2" opacity={0.6} pointerEvents="none" />}
              {dividerLines(layout, shown).map((l, k) => (
                <line key={k} x1={l.x1} x2={l.x2} y1={sy(l.y1)} y2={sy(l.y2)} />
              ))}
              <text x={r.x + r.width / 2} y={r.y + r.height / 2} fontSize={fs} dominantBaseline="middle" textAnchor="middle">
                {heightCaption(shown.opts)}
              </text>
              {(() => {
                // What's in the bin, from its label text (first line as printed, cut to fit).
                const t = labelCaption(shown);
                if (!t || r.height < fs * 2.6) return null;
                const room = Math.max(1, Math.floor((r.width - 4) / (fs * 0.5)));
                return (
                  <text className="ge-bin-label" x={r.x + r.width / 2} y={r.y + r.height / 2 + fs * 1.15} fontSize={fs * 0.8} dominantBaseline="middle" textAnchor="middle">
                    {t.length > room ? `${t.slice(0, Math.max(1, room - 1))}…` : t}
                  </text>
                );
              })()}
              {stack.above > 0 && <StackBadge x={r.x + r.width} y={r.y} n={stack.above} size={Math.max(4, fs * 0.75)} inset={1.5 + 6 * px} />}
              {/* Print checks: a small dot in the corner (too-big bins are marked red already), left of a stack badge. */}
              {mark && !tooBig && (
                <circle
                  className={`ge-check ${mark}`}
                  cx={r.x + r.width - 7 * px - (stack.above > 0 ? 1.5 + Math.max(4, fs * 0.75) * (stack.above > 9 ? 2.6 : 2) : 0)}
                  cy={r.y + 7 * px}
                  r={3.5 * px}
                />
              )}
            </g>
          );
        })}
        {ghosts.map((g, i) => {
          const gr = cellRectSvg(g.r, 0.6);
          return (
            <g key={i}>
              <rect className={`ge-ghost ${g.ok ? 'ok' : 'no'}`} {...gr} rx={3.75} />
              {g.limit && (
                <text className="ge-ghost-note" x={gr.x + gr.width / 2} y={gr.y + gr.height / 2} fontSize={6} dominantBaseline="middle" textAnchor="middle">
                  largest that fits the print bed
                </text>
              )}
            </g>
          );
        })}
        {marquee && (
          <rect
            className="ge-marquee"
            x={marquee.x0}
            y={sy(marquee.y1)}
            width={marquee.x1 - marquee.x0}
            height={marquee.y1 - marquee.y0}
            strokeWidth={px}
          />
        )}
        {handleRect && <ResizeHandles r={cellRectSvg(handleRect, 0.6)} px={px} />}
        <text className="ge-caption" x={plateW / 2} y={-2} textAnchor="middle" fontSize={7}>
          back
        </text>
        <text className="ge-caption" x={plateW / 2} y={plateD + 6.5} textAnchor="middle" fontSize={7}>
          front
        </text>
      </svg>
    </div>
  );
}

function box(a: Pt, b: Pt) {
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
}

/** Edge strips and corner/edge knobs around a bin, in svg coordinates (north = back = up). */
function ResizeHandles({ r, px }: { r: { x: number; y: number; width: number; height: number }; px: number }) {
  const { x, y, width: w, height: h } = r;
  const knob = 9 * px;
  const grip = 10 * px;
  const at: Record<Handle, Pt> = {
    n: [x + w / 2, y],
    s: [x + w / 2, y + h],
    e: [x + w, y + h / 2],
    w: [x, y + h / 2],
    ne: [x + w, y],
    nw: [x, y],
    se: [x + w, y + h],
    sw: [x, y + h],
  };
  const strips: [Handle, { x: number; y: number; width: number; height: number }][] = [
    ['n', { x, y: y - grip / 2, width: w, height: grip }],
    ['s', { x, y: y + h - grip / 2, width: w, height: grip }],
    ['e', { x: x + w - grip / 2, y, width: grip, height: h }],
    ['w', { x: x - grip / 2, y, width: grip, height: h }],
  ];
  return (
    <g className="ge-handles">
      {strips.map(([k, s]) => (
        <rect key={`strip-${k}`} className="ge-handle-strip" data-handle={k} {...s} style={{ cursor: HANDLE_CURSOR[k] }} />
      ))}
      {HANDLES.map((k) => (
        <rect
          key={k}
          className="ge-handle"
          data-handle={k}
          x={at[k][0] - knob / 2}
          y={at[k][1] - knob / 2}
          width={knob}
          height={knob}
          rx={1.5 * px}
          strokeWidth={1.2 * px}
          style={{ cursor: HANDLE_CURSOR[k] }}
        />
      ))}
    </g>
  );
}
