import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useStore, useUnits } from '../state/store';
import { binSpec, type PlacedBin, type PrintJob } from '../lib/project';
import { binLabel, binSize } from '../lib/geometry/bin';
import { BASE_TOP_RADIUS, WALL } from '../lib/geometry/spec';
import {
  autoNotches,
  cutoutArea,
  cutoutFloor,
  cutoutStyle,
  fillTop,
  labelPlacement,
  maxPocketDepth,
  normAngle,
  notchCenters,
  placedOutline,
  pocketBox,
  toBin,
  toTool,
  type BinCutout,
  type Pt,
} from '../lib/geometry/cutouts';
import { FONT_URL_PATH, hasFont, registerFont, textOutline } from '../lib/geometry/text';
import { cutoutFromTool, cutoutIssues, findFreePlacement, heightUnitsFor, pocketGap, snapCutout, toolSize, type Tool } from '../lib/tools';
import { bounds, nearestOnPolygon } from '../lib/trace/polygon';
import { snapStep } from '../lib/units';
import { isMod, isTyping } from './shortcuts';

/** dataTransfer type for dragging a library tool into the editor. */
export const TOOL_DRAG_MIME = 'application/x-gridfit-tool';

const pathD = (pts: Pt[]) => (pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z` : '');
const r2 = (v: number) => Math.round(v * 100) / 100;

// Label glyphs come from the same font the worker engraves with.
let fontLoad: Promise<void> | null = null;
function useLabelFont(): boolean {
  const [ok, setOk] = useState(hasFont());
  useEffect(() => {
    if (ok) return;
    fontLoad ??= fetch(`${import.meta.env.BASE_URL}${FONT_URL_PATH}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => void registerFont(b));
    fontLoad.then(() => setOk(true)).catch(() => {});
  }, [ok]);
  return ok;
}

/** The Bins tab's "Tool cutouts" pane: lay out library tools in the selected bin. */
export function CutoutEditor({ job }: { job: PrintJob }) {
  const bins = useStore((s) => s.bins);
  const selectedId = useStore((s) => s.ui.selectedBinId);
  const setUI = useStore((s) => s.setUI);
  const bin = bins.find((b) => b.id === selectedId);
  if (!bin) {
    return (
      <div className="cutout-empty">
        <p>
          <b>Pick a bin</b> to lay out tool pockets in it, or use <b>Make a bin</b> on a tool in the library (left).
        </p>
        {bins.length > 0 && (
          <div className="cutout-bin-list">
            {bins.map((b) => (
              <button key={b.id} onClick={() => setUI({ selectedBinId: b.id })}>
                {binLabel(b.opts)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <BinCutouts key={bin.id} bin={bin} job={job} />;
}

type Drag =
  | { kind: 'move'; i: number; grab: Pt; moved: boolean }
  | { kind: 'rotate'; i: number; start: number; rot0: number }
  | { kind: 'label'; i: number; grab: Pt }
  | { kind: 'notch'; i: number; k: number };

function BinCutouts({ bin, job }: { bin: PlacedBin; job: PrintJob }) {
  const tools = useStore((s) => s.tools);
  const updateBin = useStore((s) => s.updateBin);
  const { fmt, units, precision } = useUnits();
  const fontOk = useLabelFont();
  const world = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 600, h: 400 });
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 600, h: el.clientHeight || 400 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Screen px per mm for a viewBox of this size (preserveAspectRatio meet). */
  const pxPerMm = (vw: number, vh: number) => Math.max(0.2, Math.min(box.w / vw, box.h / vh));
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<BinCutout[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [snapOn, setSnapOn] = useState(true);
  const [dropHover, setDropHover] = useState(false);

  const cells = binSpec(job.layout, bin).cells;
  const { w: W, d: D } = binSize(bin.opts, cells);
  const area = cutoutArea(W, D, bin.opts.lip, bin.opts.lipStyle);
  const top = fillTop(bin.opts);
  const floor = cutoutFloor(bin.opts);
  const style = cutoutStyle(bin.opts);
  const saved = bin.opts.cutouts ?? [];
  const cutouts = draft ?? saved;
  const issues = useMemo(() => cutoutIssues({ ...bin.opts, cutouts }, W, D, top), [bin.opts, cutouts, W, D, top]);
  const selC = sel !== null ? cutouts[sel] : undefined;

  const commit = (list: BinCutout[]) => {
    setDraft(null);
    updateBin(bin.id, { opts: { interior: 'cutouts', cutouts: list } });
  };
  const patchSel = (patch: Partial<BinCutout>) => {
    if (sel === null) return;
    commit(saved.map((c, k) => (k === sel ? { ...c, ...patch } : c)));
  };
  const remove = (i: number) => {
    commit(saved.filter((_, k) => k !== i));
    setSel(null);
  };
  const addTool = (t: Tool, at?: Pt) => {
    const spot = at ? { x: r2(at[0]), y: r2(at[1]), rotation: 0 } : findFreePlacement(saved, t, area);
    const list = [...saved, cutoutFromTool(t, spot.x, spot.y, spot.rotation)];
    commit(list);
    setSel(list.length - 1);
  };

  /** Pointer → bin mm (y up). */
  const mm = (e: { clientX: number; clientY: number }): Pt | null => {
    const m = world.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  /** Screen px → mm at the current zoom. */
  const pxToMm = (px: number) => {
    const m = world.current?.getScreenCTM();
    return m ? px / Math.hypot(m.a, m.b) : px / 4;
  };

  // Keyboard: Delete, R / Shift+R, arrows, Escape. Capture phase, so the app's
  // own Delete (remove the selected bin) doesn't fire while this pane is open.
  const live = useRef({ sel, saved, units, precision });
  live.current = { sel, saved, units, precision };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || isMod(e) || document.querySelector('.modal-backdrop, .overlay')) return;
      const { sel: i, saved: list } = live.current;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
        e.preventDefault();
        if (i !== null && list[i]) remove(i);
        return;
      }
      if (i === null || !list[i]) return;
      const c = list[i];
      const put = (patch: Partial<BinCutout>) => commit(list.map((q, k) => (k === i ? { ...q, ...patch } : q)));
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSel(null);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        put({ rotation: normAngle(c.rotation + (e.shiftKey ? -15 : 15)) });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = snapStep(live.current.units, live.current.precision) * (e.shiftKey ? 10 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
        put({ x: r2(c.x + dx), y: r2(c.y + dy) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin.id]);

  const startDrag = (e: RPointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag(d);
    setDraft(saved);
  };

  const onPointerMove = (e: RPointerEvent) => {
    if (!drag || !draft) return;
    const p = mm(e);
    if (!p) return;
    const c = draft[drag.i];
    let next: BinCutout = c;
    if (drag.kind === 'move') {
      let x = p[0] - drag.grab[0];
      let y = p[1] - drag.grab[1];
      if (snapOn && !e.altKey) {
        const s = snapCutout({ ...c, x, y }, draft.filter((_, k) => k !== drag.i), area, pxToMm(7));
        x += s.dx;
        y += s.dy;
        setGuides({ x: s.guidesX, y: s.guidesY });
      } else setGuides({ x: [], y: [] });
      next = { ...c, x: r2(x), y: r2(y) };
      if (!drag.moved) setDrag({ ...drag, moved: true });
    } else if (drag.kind === 'rotate') {
      const a = (Math.atan2(p[1] - c.y, p[0] - c.x) * 180) / Math.PI;
      let rot = drag.rot0 + a - drag.start;
      rot = e.shiftKey ? Math.round(rot * 2) / 2 : Math.round(rot / 15) * 15;
      next = { ...c, rotation: normAngle(rot) };
    } else if (drag.kind === 'label') {
      next = { ...c, labelOffset: [r2(p[0] - drag.grab[0] - c.x), r2(p[1] - drag.grab[1] - c.y)] };
    } else if (drag.kind === 'notch') {
      const q = nearestOnPolygon(toTool(c, p), c.outline);
      next = { ...c, notches: (c.notches ?? []).map((n, k) => (k === drag.k ? ([r2(q[0]), r2(q[1])] as Pt) : n)) };
    }
    setDraft(draft.map((q, k) => (k === drag.i ? next : q)));
  };

  const onPointerUp = () => {
    if (drag && draft && (drag.kind !== 'move' || drag.moved)) commit(draft);
    else setDraft(null);
    setDrag(null);
    setGuides({ x: [], y: [] });
  };

  // View: the bin with a margin, y up inside the flipped group. Text and lines are sized in screen pixels.
  const pad = Math.max(W, D) * 0.06 + 4;
  const k = pxPerMm(W + 2 * pad, D + 2 * pad);
  const fs = 11 / k;
  const ink = 1 / k;

  const labelGlyphs = (c: BinCutout) => {
    if (!c.label || !c.name.trim()) return null;
    const at = labelPlacement(c, style, area);
    if (!fontOk) {
      return (
        <text className="co-label-text" transform={`translate(${at.x} ${at.y}) scale(1 -1)`} fontSize={style.labelSize * 1.35} textAnchor="middle" dominantBaseline="central">
          {c.name}
        </text>
      );
    }
    const t = textOutline(c.name.trim(), { size: style.labelSize, maxWidth: at.maxWidth });
    return <path className="co-label" transform={`translate(${at.x} ${at.y})`} d={t.contours.map((k) => pathD(k)).join('')} />;
  };

  const rotHandle = (c: BinCutout): Pt => {
    const b = bounds(c.outline);
    return toBin(c, [0, b.y1 + c.clearance + Math.max(6, fs * 2.2)]);
  };

  // Dimensions for the selected pocket: gaps to the opening and to its nearest neighbour.
  const dims = (() => {
    if (!selC || drag?.kind === 'rotate') return null;
    const b = pocketBox(selC);
    const cy = (b.y0 + b.y1) / 2;
    const cx = (b.x0 + b.x1) / 2;
    const lines: { a: Pt; b: Pt; text: string; bad: boolean }[] = [
      { a: [area.x0, cy], b: [b.x0, cy], text: fmt(b.x0 - area.x0), bad: b.x0 < area.x0 - 1e-3 },
      { a: [b.x1, cy], b: [area.x1, cy], text: fmt(area.x1 - b.x1), bad: b.x1 > area.x1 + 1e-3 },
      { a: [cx, area.y0], b: [cx, b.y0], text: fmt(b.y0 - area.y0), bad: b.y0 < area.y0 - 1e-3 },
      { a: [cx, b.y1], b: [cx, area.y1], text: fmt(area.y1 - b.y1), bad: b.y1 > area.y1 + 1e-3 },
    ];
    let near: ReturnType<typeof pocketGap> | null = null;
    cutouts.forEach((o, k) => {
      if (k === sel) return;
      const g = pocketGap(selC, o);
      if (!near || g.d < near.d) near = g;
    });
    const n = near as ReturnType<typeof pocketGap> | null;
    if (n) lines.push({ a: n.pa, b: n.pb, text: n.d > 0 ? fmt(n.d) : 'overlap', bad: n.d <= 0 });
    return lines;
  })();

  const warnings: string[] = [];
  issues.forEach((is, i) => {
    const n = cutouts[i].name || `Pocket ${i + 1}`;
    if (is.outside) warnings.push(`${n} runs into the wall${bin.opts.lip ? ' or under the stacking lip' : ''}.`);
    if (is.overlaps.some((j) => j > i)) warnings.push(`${n} overlaps ${is.overlaps.filter((j) => j > i).map((j) => cutouts[j].name || `pocket ${j + 1}`).join(', ')}.`);
  });
  const deepest = Math.max(0, ...cutouts.map((c) => c.depth));
  const needUnits = cutouts.length ? heightUnitsFor(deepest, bin.opts.lip, style.extraDepth, floor) : bin.opts.heightUnits;
  const tooShallow = issues.some((i) => i.tooDeep);

  return (
    <div className="cutout-editor">
      <div className="co-bar">
        <span className="co-bin">
          <b>{binLabel(bin.opts)}</b>
          <span className="muted">
            {' '}
            · opening {fmt(area.x1 - area.x0)} × {fmt(area.y1 - area.y0)} · pockets up to {fmt(maxPocketDepth(top, floor))} deep
          </span>
        </span>
        <label className="co-check" title="Snap to the center lines, the walls and other pockets (hold Alt to move freely)">
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Snap
        </label>
      </div>
      <div className="co-palette" aria-label="Tool library">
        {tools.length ? (
          tools.map((t) => (
            <button
              key={t.id}
              className="co-chip"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TOOL_DRAG_MIME, t.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addTool(t)}
              title="Click to add, or drag into the bin"
            >
              <ToolThumb tool={t} size={22} />
              {t.name}
            </button>
          ))
        ) : (
          <span className="muted small">No tools yet: trace or import one from the Tool library in the sidebar.</span>
        )}
      </div>
      <div
        className={`co-canvas ${dropHover ? 'drop' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TOOL_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropHover(true);
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={(e) => {
          setDropHover(false);
          const t = tools.find((x) => x.id === e.dataTransfer.getData(TOOL_DRAG_MIME));
          const p = mm(e);
          if (!t || !p) return;
          e.preventDefault();
          addTool(t, p);
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${-W / 2 - pad} ${-D / 2 - pad} ${W + 2 * pad} ${D + 2 * pad}`}
          onPointerDown={() => setSel(null)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="application"
          aria-label="Bin interior. Drag tools to move them."
        >
          <g ref={world} transform="scale(1 -1)">
            <rect className="co-bin-outer" x={-W / 2} y={-D / 2} width={W} height={D} rx={BASE_TOP_RADIUS} />
            <rect className="co-fill" x={-W / 2 + WALL} y={-D / 2 + WALL} width={W - 2 * WALL} height={D - 2 * WALL} rx={BASE_TOP_RADIUS - WALL} />
            <rect className="co-opening" x={area.x0} y={area.y0} width={area.x1 - area.x0} height={area.y1 - area.y0} rx={1} strokeWidth={ink} />
            <path className="co-center" d={`M${-W / 2},0H${W / 2}M0,${-D / 2}V${D / 2}`} strokeWidth={ink} />

            {cutouts.map((c, i) => {
              const out = placedOutline(c);
              const bad = issues[i]?.outside || issues[i]?.overlaps.length > 0;
              const isSel = i === sel;
              return (
                <g key={i} className={`co-cutout ${isSel ? 'selected' : ''} ${bad ? 'bad' : ''}`}>
                  <g
                    className="co-pocket"
                    onPointerDown={(e) => {
                      const p = mm(e);
                      if (!p) return;
                      setSel(i);
                      startDrag(e, { kind: 'move', i, grab: [p[0] - c.x, p[1] - c.y], moved: false });
                    }}
                    onDoubleClick={(e) => {
                      // Double-click the pocket: add a finger notch at the nearest point of the outline.
                      const p = mm(e);
                      if (!p) return;
                      const q = nearestOnPolygon(toTool(c, p), c.outline);
                      patchSelOr(i, { notches: [...(c.notches ?? []), [r2(q[0]), r2(q[1])]] });
                    }}
                  >
                    {notchCenters(c).map(([x, y], k) => (
                      <circle key={k} className="co-notch-area" cx={x} cy={y} r={style.notchDiameter / 2} />
                    ))}
                    <path className="co-clear" d={pathD(out)} strokeWidth={Math.max(2 * c.clearance, ink)} />
                    <path className="co-tool" d={pathD(out)} strokeWidth={ink * 1.2} />
                  </g>
                  {isSel &&
                    notchCenters(c).map(([x, y], k) => (
                      <circle
                        key={k}
                        className="co-notch-handle"
                        cx={x}
                        cy={y}
                        r={Math.max(1.4, fs * 0.45)}
                        strokeWidth={ink}
                        onPointerDown={(e) => startDrag(e, { kind: 'notch', i, k })}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          patchSelOr(i, { notches: (c.notches ?? []).filter((_, j) => j !== k) });
                        }}
                      >
                        <title>Drag along the outline · double-click to remove</title>
                      </circle>
                    ))}
                  {c.label && (
                    <g
                      className="co-label-hit"
                      onPointerDown={(e) => {
                        const p = mm(e);
                        if (!p) return;
                        setSel(i);
                        const at = labelPlacement(c, style, area);
                        startDrag(e, { kind: 'label', i, grab: [p[0] - at.x, p[1] - at.y] });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        patchSelOr(i, { labelOffset: undefined });
                      }}
                    >
                      {labelGlyphs(c)}
                    </g>
                  )}
                  {isSel && (
                    <>
                      <path className="co-rot-stem" d={`M${c.x},${c.y}L${rotHandle(c)[0]},${rotHandle(c)[1]}`} strokeWidth={ink} />
                      <circle
                        className="co-rot-handle"
                        cx={rotHandle(c)[0]}
                        cy={rotHandle(c)[1]}
                        r={Math.max(1.8, fs * 0.6)}
                        strokeWidth={ink * 1.5}
                        onPointerDown={(e) => {
                          const p = mm(e);
                          if (!p) return;
                          startDrag(e, { kind: 'rotate', i, start: (Math.atan2(p[1] - c.y, p[0] - c.x) * 180) / Math.PI, rot0: c.rotation });
                        }}
                      >
                        <title>Drag to rotate (15° steps, Shift for any angle)</title>
                      </circle>
                    </>
                  )}
                </g>
              );
            })}

            {guides.x.map((x) => (
              <path key={`gx${x}`} className="co-guide" d={`M${x},${-D / 2 - pad / 2}V${D / 2 + pad / 2}`} strokeWidth={ink} />
            ))}
            {guides.y.map((y) => (
              <path key={`gy${y}`} className="co-guide" d={`M${-W / 2 - pad / 2},${y}H${W / 2 + pad / 2}`} strokeWidth={ink} />
            ))}

            {dims?.map((l, k) => {
              const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
              if (len < 0.3 && !l.bad) return null;
              const mx = (l.a[0] + l.b[0]) / 2;
              const my = (l.a[1] + l.b[1]) / 2;
              return (
                <g key={k} className={`co-dim ${l.bad ? 'bad' : ''}`}>
                  <path d={`M${l.a[0]},${l.a[1]}L${l.b[0]},${l.b[1]}`} strokeWidth={ink} />
                  <text transform={`translate(${mx} ${my}) scale(1 -1)`} fontSize={fs} strokeWidth={3 / k} textAnchor="middle" dy={-fs * 0.35}>
                    {l.text}
                  </text>
                </g>
              );
            })}
          </g>
          <text className="co-caption" x={0} y={-D / 2 - pad * 0.35} fontSize={fs * 0.8} textAnchor="middle">
            back
          </text>
          <text className="co-caption" x={0} y={D / 2 + pad * 0.75} fontSize={fs * 0.8} textAnchor="middle">
            front
          </text>
        </svg>
        {!cutouts.length && (
          <div className="co-hint">
            Drag a tool here from the strip above. {bin.opts.interior === 'cutouts' ? 'The bin is filled solid' : 'The bin gets filled solid (no compartments)'} and each tool is cut
            as a pocket.
          </div>
        )}
      </div>
      <div className="co-foot">
        {selC ? (
          <div className="co-sel">
            <b>{selC.name || 'Pocket'}</b>
            <span className="muted">
              {fmt(toolSize(selC).w)} × {fmt(toolSize(selC).d)} · {fmt(selC.depth)} deep · {fmt(selC.clearance)} clearance · {Math.round(selC.rotation)}°
            </span>
            <span className="co-actions">
              <button onClick={() => patchSel({ rotation: normAngle(selC.rotation - 15) })} title="Rotate −15° (Shift+R)">
                ⟲
              </button>
              <button onClick={() => patchSel({ rotation: normAngle(selC.rotation + 15) })} title="Rotate +15° (R)">
                ⟳
              </button>
              <button onClick={() => patchSel({ notches: autoNotches(selC.outline) })} title="Two finger notches at the middle of the long sides">
                Auto notches
              </button>
              <button onClick={() => patchSel({ notches: [] })} disabled={!selC.notches?.length}>
                No notches
              </button>
              <button className={selC.label ? 'on' : ''} onClick={() => patchSel({ label: !selC.label })} title="Engrave the tool's name next to the pocket">
                Label
              </button>
              <button className="danger" onClick={() => sel !== null && remove(sel)} title="Remove (Delete)">
                Remove
              </button>
            </span>
          </div>
        ) : (
          <div className="muted small">
            Click a pocket to select it · drag to move (Alt: no snapping) · R rotates 15° · arrows nudge · double-click the outline to add a finger notch · Delete removes
          </div>
        )}
        {(warnings.length > 0 || tooShallow) && (
          <div className="co-warnings">
            {tooShallow && (
              <div>
                The bin is too shallow for the deepest pocket ({fmt(deepest + style.extraDepth)}).{' '}
                <button className="link" onClick={() => updateBin(bin.id, { opts: { heightMode: 'units', heightUnits: needUnits } })}>
                  Make it {needUnits}u
                </button>
              </div>
            )}
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  function patchSelOr(i: number, patch: Partial<BinCutout>) {
    commit(saved.map((c, k) => (k === i ? { ...c, ...patch } : c)));
    setSel(i);
  }
}

/** Small outline preview for lists and chips. */
export function ToolThumb({ tool, size = 36 }: { tool: Pick<Tool, 'outline'>; size?: number }) {
  const b = bounds(tool.outline);
  const s = Math.max(b.x1 - b.x0, b.y1 - b.y0) || 1;
  const pad = s * 0.08;
  return (
    <svg className="tool-thumb" width={size} height={size} viewBox={`${b.x0 - pad} ${-b.y1 - pad} ${s + 2 * pad} ${s + 2 * pad}`} aria-hidden>
      <path d={pathD(tool.outline.map(([x, y]) => [x, -y] as Pt))} strokeWidth={s / 40} />
    </svg>
  );
}
