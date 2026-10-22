import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useStore, useUnits } from '../state/store';
import { LengthInput, Segmented, Select, Slider, TextInput, Toggle } from './fields';
import type { Pt, RGBAImage } from '../lib/trace/image';
import { isConvexQuad, orderCorners, PAPER_SIZES, rectifyPaper, type Rectified } from '../lib/trace/homography';
import { contourToMm, DEFAULT_TRACE, detectPaper, traceContour, traceMask, traceScore, type TraceParams } from '../lib/trace/pipeline';
import { pickComponents } from '../lib/trace/segment';
import type { ImportResult } from '../lib/trace/svg';
import { bounds, pointInPolygon, signedArea } from '../lib/trace/polygon';
import { once } from './lazy';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../pwa/chunks';
import { DEFAULT_CLEARANCE, DEFAULT_TOOL_DEPTH } from '../lib/tools';
import { isTouch, useCoarsePointer } from './touch';
import { fingerPx } from './gestures';
import { inOpenList } from './shortcuts';
import type { TracedOutline } from '../lib/wall/kinds/traced';

export type TraceTab = 'photo' | 'import';

/** Photos are scaled down to this long side on load (plenty for 4 px/mm on Letter paper). */
const MAX_PHOTO_SIDE = 2400;
const PX_PER_MM = 4;

interface Photo {
  image: RGBAImage;
  url: string;
  name: string;
}

async function loadPhoto(file: Blob, name: string): Promise<Photo> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h);
  return { image: { width: w, height: h, data: data.data }, url: canvas.toDataURL('image/jpeg', 0.9), name };
}

function imageUrl(img: RGBAImage, type = 'image/jpeg'): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return c.toDataURL(type, 0.9);
}

const pathD = (pts: Pt[]) => (pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z` : '');

/** Pointer position in the SVG's user units. */
function svgPoint(svg: SVGSVGElement | null, e: { clientX: number; clientY: number }): Pt | null {
  const m = svg?.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}

const baseName = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Tool';

/**
 * Trace a tool from a photo or import its outline, into the tool library; with `onOutlines`, the outlines go to it
 * instead (a shadow board's or a tool holder's form: components/WallOutlines.tsx), where they were in the photo or file.
 */
export function TraceDialog({
  initialTab = 'photo',
  onClose,
  onOutlines,
}: {
  initialTab?: TraceTab;
  onClose: () => void;
  onOutlines?: (tools: TracedOutline[]) => void;
}) {
  const [tab, setTab] = useState<TraceTab>(initialTab);
  const toolCount = useStore((s) => s.tools.length);
  const [name, setName] = useState(`Tool ${toolCount + 1}`);
  const [depth, setDepth] = useState(DEFAULT_TOOL_DEPTH);
  const [clearance, setClearance] = useState(DEFAULT_CLEARANCE);
  const [dropFile, setDropFile] = useState<File | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open pick list closes first.
      if (e.key === 'Escape' && !inOpenList(e.target)) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Dropping a file anywhere picks the right tab.
  const onDrop = (e: React.DragEvent) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    const vector = /\.(svg|dxf)$/i.test(f.name) || f.type === 'image/svg+xml';
    setTab(vector ? 'import' : 'photo');
    setDropFile(f);
  };

  const common = { name, setName, depth, setDepth, clearance, setClearance, onClose, dropFile, clearDrop: () => setDropFile(null), onOutlines };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal trace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a tool"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={onDrop}
      >
        <header className="modal-head">
          <h2>Add a tool</h2>
          <Segmented
            value={tab}
            options={[
              { value: 'photo', label: 'Trace a photo' },
              { value: 'import', label: 'Import SVG / DXF' },
            ]}
            onChange={setTab}
          />
          <button className="link modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {tab === 'photo' ? <PhotoTab {...common} /> : <ImportTab {...common} />}
      </div>
    </div>
  );
}

interface TabProps {
  name: string;
  setName: (v: string) => void;
  depth: number;
  setDepth: (v: number) => void;
  clearance: number;
  setClearance: (v: number) => void;
  onClose: () => void;
  dropFile: File | null;
  clearDrop: () => void;
  /** Hand the outlines back instead of adding them to the library. */
  onOutlines?: (tools: TracedOutline[]) => void;
}

/** Name / thickness / clearance + save, shared by both tabs. */
function ToolFields({ p, children }: { p: TabProps; children?: ReactNode }) {
  return (
    <div className="trace-fields">
      <TextInput label="Name" value={p.name} onChange={p.setName} />
      <div className="row2">
        <LengthInput label="Thickness (pocket depth)" value={p.depth} min={0.2} max={250} onChange={p.setDepth} />
        <LengthInput label="Clearance" value={p.clearance} min={0} max={10} onChange={p.setClearance} hint="Gap around the tool." />
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo tab
// ---------------------------------------------------------------------------

type PaperId = (typeof PAPER_SIZES)[number]['id'] | 'custom';

function PhotoTab(p: TabProps) {
  const { fmt } = useUnits();
  const addTool = useStore((s) => s.addTool);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corners, setCorners] = useState<Pt[]>([]);
  const [step, setStep] = useState<'corners' | 'outline'>('corners');
  const [paperId, setPaperId] = useState<PaperId>('letter');
  const [custom, setCustom] = useState({ w: 200, h: 300 });
  const [params, setParams] = useState<TraceParams>(DEFAULT_TRACE);
  const [pick, setPick] = useState<Pt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = async (f: Blob, name: string) => {
    setError(null);
    try {
      const ph = await loadPhoto(f, name);
      setPhoto(ph);
      setCorners(detectPaper(ph.image) ?? []);
      setStep('corners');
      setPick(null);
      if (name) p.setName(baseName(name));
    } catch {
      setError('Could not read that image.');
    }
  };

  // Drag-dropped files and pasted images.
  useEffect(() => {
    if (p.dropFile) {
      void open(p.dropFile, p.dropFile.name);
      p.clearDrop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dropFile]);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        void open(f, '');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paper = paperId === 'custom' ? { w: Math.min(custom.w, custom.h), h: Math.max(custom.w, custom.h) } : PAPER_SIZES.find((s) => s.id === paperId)!;
  const quadOk = corners.length === 4 && isConvexQuad(corners);

  const rect = useMemo<Rectified | null>(
    () => (photo && step === 'outline' && quadOk ? rectifyPaper(photo.image, corners, paper, { pxPerMm: PX_PER_MM }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photo, step, quadOk, corners, paper.w, paper.h],
  );

  if (!photo) {
    return (
      <div className="modal-body trace-body">
        <div className="trace-stage">
          <button className="trace-drop" onClick={() => fileRef.current?.click()}>
            <b>Choose a photo</b>
            <span>or drop it here, or paste it (Ctrl/⌘ V)</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(f, f.name);
              e.target.value = '';
            }}
          />
        </div>
        <aside className="trace-side">
          <h4>How to take the photo</h4>
          <ol className="trace-steps">
            <li>Lay the tool on a plain sheet of paper (Letter or A4) on a darker surface.</li>
            <li>Shoot from as straight above as you can, with all four paper corners in view.</li>
            <li>Soft, even light: harsh shadows get traced as part of the tool.</li>
          </ol>
          <p className="muted small">The paper gives the scale and corrects the perspective, so the outline comes out in real millimetres.</p>
          {error && <div className="field-error">{error}</div>}
        </aside>
      </div>
    );
  }

  return step === 'corners' || !rect ? (
    <CornerStep
      photo={photo}
      corners={corners}
      setCorners={setCorners}
      paperId={paperId}
      setPaperId={setPaperId}
      custom={custom}
      setCustom={setCustom}
      quadOk={quadOk}
      onNext={() => setStep('outline')}
      onReplace={() => setPhoto(null)}
    />
  ) : (
    <OutlineStep
      p={p}
      rect={rect}
      params={params}
      setParams={setParams}
      pick={pick}
      setPick={setPick}
      onBack={() => setStep('corners')}
      fmt={fmt}
      onSave={(outline) => {
        const tool = { name: p.name.trim() || 'Tool', outline, depth: p.depth, clearance: p.clearance };
        if (p.onOutlines) p.onOutlines([tool]);
        else addTool(tool);
        p.onClose();
      }}
    />
  );
}

function CornerStep({
  photo,
  corners,
  setCorners,
  paperId,
  setPaperId,
  custom,
  setCustom,
  quadOk,
  onNext,
  onReplace,
}: {
  photo: Photo;
  corners: Pt[];
  setCorners: (c: Pt[]) => void;
  paperId: PaperId;
  setPaperId: (v: PaperId) => void;
  custom: { w: number; h: number };
  setCustom: (v: { w: number; h: number }) => void;
  quadOk: boolean;
  onNext: () => void;
  onReplace: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [loupe, setLoupe] = useState<{ at: Pt; screen: Pt } | null>(null);
  const { width: W, height: H } = photo.image;
  const coarse = useCoarsePointer();
  // Screen px per photo px. Handles never get smaller than a fingertip on a touch screen.
  const scale = svg.current?.getScreenCTM()?.a || 1;
  const r = Math.max(Math.max(W, H) / 80, coarse ? 12 / scale : 0);
  const ordered = corners.length === 4 ? orderCorners(corners) : corners;

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    // One handle at a time: a second finger is ignored.
    if (!e.isPrimary) return;
    const pt = svgPoint(svg.current, e);
    if (!pt) return;
    const reach = Math.max(r * 2.2, isTouch(e) ? fingerPx(12, true) / scale : 0);
    const hit = corners.findIndex((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]) < reach);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (hit >= 0) {
      setDrag(hit);
    } else if (corners.length < 4) {
      setCorners([...corners, pt]);
      setDrag(corners.length);
    } else {
      // Move the nearest corner here.
      let best = 0;
      corners.forEach((c, i) => {
        if (Math.hypot(c[0] - pt[0], c[1] - pt[1]) < Math.hypot(corners[best][0] - pt[0], corners[best][1] - pt[1])) best = i;
      });
      setCorners(corners.map((c, i) => (i === best ? pt : c)));
      setDrag(best);
    }
    setLoupe({ at: pt, screen: [e.clientX, e.clientY] });
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag === null || !e.isPrimary) return;
    const pt = svgPoint(svg.current, e);
    if (!pt) return;
    const c: Pt = [Math.min(W, Math.max(0, pt[0])), Math.min(H, Math.max(0, pt[1]))];
    setCorners(corners.map((q, i) => (i === drag ? c : q)));
    setLoupe({ at: c, screen: [e.clientX, e.clientY] });
  };
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    setDrag(null);
    setLoupe(null);
  };

  const LOUPE = 150;
  const zoomSpan = (() => {
    const m = svg.current?.getScreenCTM();
    const screenPerPx = m ? m.a : 1;
    return LOUPE / screenPerPx / 4;
  })();
  const stageBox = svg.current?.parentElement?.getBoundingClientRect();

  return (
    <div className="modal-body trace-body">
      <div className="trace-stage">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}
          className={drag !== null ? 'dragging' : ''}
        >
          <image href={photo.url} x={0} y={0} width={W} height={H} />
          {ordered.length >= 2 && (
            <path className={`trace-quad ${quadOk || ordered.length < 4 ? '' : 'bad'}`} d={pathD(ordered) + (ordered.length < 4 ? '' : '')} strokeWidth={r / 3} />
          )}
          {corners.map((c, i) => (
            <g key={i} className={`trace-handle ${drag === i ? 'active' : ''}`}>
              <circle cx={c[0]} cy={c[1]} r={r} strokeWidth={r / 4} />
              <circle cx={c[0]} cy={c[1]} r={r / 5} className="dot" />
            </g>
          ))}
        </svg>
        {loupe && stageBox && (
          <div
            className="trace-loupe"
            style={{
              width: LOUPE,
              height: LOUPE,
              left: Math.min(stageBox.width - LOUPE - 8, loupe.screen[0] - stageBox.left + 24),
              top: Math.max(8, loupe.screen[1] - stageBox.top - LOUPE - 24),
            }}
          >
            <svg viewBox={`${loupe.at[0] - zoomSpan / 2} ${loupe.at[1] - zoomSpan / 2} ${zoomSpan} ${zoomSpan}`}>
              <image href={photo.url} x={0} y={0} width={W} height={H} />
              <path
                d={`M${loupe.at[0] - zoomSpan / 2},${loupe.at[1]}H${loupe.at[0] + zoomSpan / 2}M${loupe.at[0]},${loupe.at[1] - zoomSpan / 2}V${loupe.at[1] + zoomSpan / 2}`}
                className="trace-cross"
                strokeWidth={zoomSpan / 150}
              />
            </svg>
          </div>
        )}
        <div className="trace-stage-hint">
          {corners.length < 4 ? `${coarse ? 'Tap' : 'Click'} corner ${corners.length + 1} of 4 of the paper` : 'Drag the handles onto the paper’s corners'}
        </div>
      </div>
      <aside className="trace-side">
        <h4>1 · Paper corners</h4>
        <Select
          label="Paper size"
          value={paperId}
          options={[...PAPER_SIZES.map((s) => ({ value: s.id as PaperId, label: s.label })), { value: 'custom' as PaperId, label: 'Custom…' }]}
          onChange={setPaperId}
        />
        {paperId === 'custom' && (
          <div className="row2">
            <LengthInput label="Width" value={custom.w} min={20} max={2000} onChange={(w) => setCustom({ ...custom, w })} />
            <LengthInput label="Height" value={custom.h} min={20} max={2000} onChange={(h) => setCustom({ ...custom, h })} />
          </div>
        )}
        <p className="muted small">
          Put a handle on each corner of the sheet; zoom in with the magnifier while dragging. Any order works, and portrait or landscape is detected.
        </p>
        <div className="button-row">
          <button
            onClick={() => {
              const d = detectPaper(photo.image);
              if (d) setCorners(d);
            }}
          >
            Auto-detect
          </button>
          <button onClick={() => setCorners([])}>Click corners</button>
        </div>
        {corners.length === 4 && !quadOk && <div className="field-error">The corners don’t form a convex four-sided shape.</div>}
        <div className="trace-spacer" />
        <div className="button-row">
          <button onClick={onReplace}>Other photo</button>
          <button className="primary" disabled={!quadOk} onClick={onNext}>
            Next: outline →
          </button>
        </div>
      </aside>
    </div>
  );
}

function OutlineStep({
  p,
  rect,
  params,
  setParams,
  pick,
  setPick,
  onBack,
  onSave,
  fmt,
}: {
  p: TabProps;
  rect: Rectified;
  params: TraceParams;
  setParams: (v: TraceParams) => void;
  pick: Pt | null;
  setPick: (v: Pt | null) => void;
  onBack: () => void;
  onSave: (outline: Pt[]) => void;
  fmt: (mm: number) => string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [showMask, setShowMask] = useState(true);
  const q = useDeferredValue(params);
  const { image } = rect;
  const W = image.width;
  const H = image.height;
  const ppm = (rect.pxPerMmX + rect.pxPerMmY) / 2;
  const minArea = 25 * ppm * ppm;

  const photoUrl = useMemo(() => imageUrl(image), [image]);
  const score = useMemo(() => traceScore(image, q), [image, q.mode, q.invert, q.blur]); // eslint-disable-line react-hooks/exhaustive-deps
  const stage = useMemo(() => traceMask(score, q), [score, q.threshold, q.cleanup]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = useMemo(
    () => pickComponents(stage.labels, stage.comps, W, { points: pick ? [pick] : undefined, minArea, snapRadius: 6 * ppm }),
    [stage, pick, W, minArea, ppm],
  );
  const contour = useMemo(() => (selected.length ? traceContour(stage, W, selected, Math.round(4 * ppm)) : null), [stage, selected, W, ppm]);
  const outline = useMemo(
    () => (contour ? contourToMm(contour, rect.pxPerMmX, rect.pxPerMmY, H, q) : null),
    [contour, rect, H, q.simplify, q.smooth], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const candidates = useMemo(
    () =>
      stage.comps
        .filter((c) => c.area >= minArea && !selected.includes(c.id))
        .sort((a, b) => b.area - a.area)
        .slice(0, 20),
    [stage, selected, minArea],
  );
  // Mask overlay at half resolution (fast to encode).
  const maskUrl = useMemo(() => {
    if (!showMask) return null;
    const w = Math.ceil(W / 2);
    const h = Math.ceil(H / 2);
    const out: RGBAImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    const sel = new Set(selected);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = Math.min(H - 1, y * 2) * W + Math.min(W - 1, x * 2);
        if (!stage.mask.data[i]) continue;
        const o = (y * w + x) * 4;
        const mine = sel.has(stage.labels[i]);
        out.data[o] = mine ? 70 : 245;
        out.data[o + 1] = mine ? 201 : 165;
        out.data[o + 2] = mine ? 139 : 36;
        out.data[o + 3] = mine ? 110 : 90;
      }
    }
    return imageUrl(out, 'image/png');
  }, [stage, selected, showMask, W, H]);

  // Outline in image pixels for display.
  const toPx = (pts: Pt[]) => pts.map(([x, y]) => [x * rect.pxPerMmX, H - y * rect.pxPerMmY] as Pt);
  const b = outline ? bounds(outline) : null;
  const set = (patch: Partial<TraceParams>) => setParams({ ...params, ...patch });

  return (
    <div className="modal-body trace-body">
      <div className="trace-stage">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={(e) => {
            const pt = svgPoint(svg.current, e);
            if (pt) setPick(pt);
          }}
        >
          <image href={photoUrl} x={0} y={0} width={W} height={H} />
          {maskUrl && <image href={maskUrl} x={0} y={0} width={W} height={H} style={{ imageRendering: 'pixelated' }} />}
          {candidates.map((c) => (
            <rect key={c.id} className="trace-candidate" x={c.x0} y={c.y0} width={c.x1 - c.x0 + 1} height={c.y1 - c.y0 + 1} strokeWidth={ppm / 2} />
          ))}
          {outline && (
            <>
              <path className="trace-clearance" d={pathD(toPx(outline))} strokeWidth={2 * p.clearance * ppm} />
              <path className="trace-outline" d={pathD(toPx(outline))} strokeWidth={ppm / 2} />
            </>
          )}
          {pick && <circle className="trace-pick" cx={pick[0]} cy={pick[1]} r={ppm * 2} />}
          {/* 50 mm scale bar */}
          <g className="trace-scale" transform={`translate(${6 * ppm} ${H - 6 * ppm})`}>
            <rect x={0} y={-ppm} width={50 * rect.pxPerMmX} height={ppm * 2} />
            <text x={25 * rect.pxPerMmX} y={-2.5 * ppm} fontSize={4 * ppm} textAnchor="middle">
              {fmt(50)}
            </text>
          </g>
        </svg>
        <div className="trace-stage-hint">
          {outline ? 'Click another shape to trace it instead' : 'Nothing found — click the tool, or adjust the threshold'}
        </div>
      </div>
      <aside className="trace-side">
        <h4>2 · Outline</h4>
        <Segmented
          label="Tool shows up as"
          value={params.mode}
          options={[
            { value: 'auto', label: 'Auto', title: 'Darker or more colourful than the paper' },
            { value: 'dark', label: 'Darker', title: 'Darker than the paper (ignores colour)' },
            { value: 'color', label: 'Colour', title: 'More saturated than the paper (ignores grey shadows)' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        <Toggle label="Tool is lighter than the background" checked={params.invert} onChange={(invert) => set({ invert })} />
        <Slider
          label="Threshold"
          value={params.threshold ?? stage.threshold}
          min={1}
          max={254}
          step={1}
          format={(v) => (params.threshold === null ? `Auto ${v}` : String(v))}
          onChange={(threshold) => set({ threshold })}
          hint={
            params.threshold !== null ? (
              <button className="link" onClick={() => set({ threshold: null })}>
                Back to automatic
              </button>
            ) : (
              'Lower picks up more (shadows too); higher picks up less.'
            )
          }
        />
        <div className="row2">
          <Slider label="Blur" value={params.blur} min={0} max={4} step={1} format={(v) => (v ? `${v}px` : 'Off')} onChange={(blur) => set({ blur })} />
          <Slider label="Clean up" value={params.cleanup} min={0} max={8} step={1} format={(v) => (v ? `${v}px` : 'Off')} onChange={(cleanup) => set({ cleanup })} />
        </div>
        <div className="row2">
          <Slider label="Simplify" value={params.simplify} min={0} max={2} step={0.05} format={(v) => (v ? `${v.toFixed(2)}` : 'Off')} onChange={(simplify) => set({ simplify })} />
          <Slider label="Smooth" value={params.smooth} min={0} max={3} step={1} format={(v) => (v ? `×${v}` : 'Off')} onChange={(smooth) => set({ smooth })} />
        </div>
        <Toggle label="Show detected area" checked={showMask} onChange={setShowMask} />
        {b && (
          <div className="summary small">
            {fmt(b.x1 - b.x0)} × {fmt(b.y1 - b.y0)} · {outline!.length} points · {Math.round(Math.abs(signedArea(outline!)) / 100) / 1} cm²
          </div>
        )}
        <ToolFields p={p} />
        <div className="trace-spacer" />
        <div className="button-row">
          <button onClick={onBack}>← Corners</button>
          <button className="primary" disabled={!outline} onClick={() => outline && onSave(outline)}>
            {p.onOutlines ? 'Add it' : 'Save to library'}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import tab
// ---------------------------------------------------------------------------

type UnitChoice = 'auto' | 'mm' | 'cm' | 'in' | 'px' | 'pt';
const UNIT_MM: Record<Exclude<UnitChoice, 'auto'>, number> = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72 };

// The SVG and DXF readers load with the first file; tracing a photo doesn't need them.
const loadReaders = once(() => Promise.all([import('../lib/trace/svg'), import('../lib/trace/dxf')]));
type ReadFile = (text: string, o: { mmPerUnit?: number }) => ImportResult;

function ImportTab(p: TabProps) {
  const { fmt } = useUnits();
  const addTool = useStore((s) => s.addTool);
  const [file, setFile] = useState<{ name: string; text: string; read: ReadFile } | null>(null);
  const [units, setUnits] = useState<UnitChoice>('auto');
  const [picked, setPicked] = useState<number[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = async (f: File) => {
    const text = await f.text();
    const kind = /\.dxf$/i.test(f.name) || /^\s*0\s*[\r\n]+\s*SECTION/.test(text) ? 'dxf' : 'svg';
    const read = await loadReaders().then(
      ([svg, dxf]): ReadFile => (kind === 'dxf' ? dxf.parseDXF : svg.parseSVG),
      (e): ReadFile => () => {
        throw new Error(isChunkError(e) ? CHUNK_ERROR_MESSAGE : (e as Error).message);
      },
    );
    setFile({ name: f.name, text, read });
    setPicked(null);
    setUnits('auto');
    p.setName(baseName(f.name));
  };
  useEffect(() => {
    if (p.dropFile) {
      void openFile(p.dropFile);
      p.clearDrop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dropFile]);

  const parsed = useMemo<{ r: ImportResult | null; error: string | null }>(() => {
    if (!file) return { r: null, error: null };
    try {
      const mmPerUnit = units === 'auto' ? undefined : UNIT_MM[units];
      return { r: file.read(file.text, { mmPerUnit }), error: null };
    } catch (e) {
      return { r: null, error: (e as Error).message };
    }
  }, [file, units]);
  const shapes = parsed.r?.shapes ?? [];
  // Default: the biggest shape.
  const areas = shapes.map((s) => Math.abs(signedArea(s.points)));
  const sel = picked ?? (shapes.length ? [areas.indexOf(Math.max(...areas))] : []);
  // Shapes inside a selected one are holes: ignored.
  const inside = (i: number) => sel.some((j) => j !== i && areas[j] > areas[i] && pointInPolygon(shapes[i].points[0], shapes[j].points));
  const all = shapes.flatMap((s) => s.points);
  const bb = all.length ? bounds(all) : { x0: 0, y0: 0, x1: 100, y1: 100 };
  const pad = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.05 + 1;
  const stroke = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 400;

  const save = () => {
    const chosen = sel.filter((i) => !inside(i));
    // Several: each named after its element's id in the file ("path#wrench"), else numbered.
    const idOf = (source: string) => source.match(/#(.+)$/)?.[1].replace(/[-_]+/g, ' ').trim();
    const tools = chosen.map((i, k) => ({
      name: (chosen.length > 1 ? idOf(shapes[i].source) || `${p.name.trim() || 'Tool'} ${k + 1}` : p.name.trim()) || 'Tool',
      outline: shapes[i].points,
      depth: p.depth,
      clearance: p.clearance,
    }));
    if (p.onOutlines) p.onOutlines(tools);
    else tools.forEach((t) => addTool(t));
    p.onClose();
  };

  return (
    <div className="modal-body trace-body">
      <div className="trace-stage">
        {!file ? (
          <button className="trace-drop" onClick={() => fileRef.current?.click()}>
            <b>Choose an SVG or DXF file</b>
            <span>or drop it here</span>
          </button>
        ) : shapes.length ? (
          <svg viewBox={`${bb.x0 - pad} ${-bb.y1 - pad} ${bb.x1 - bb.x0 + 2 * pad} ${bb.y1 - bb.y0 + 2 * pad}`}>
            <g transform="scale(1 -1)">
              {shapes.map((s, i) => (
                <path
                  key={i}
                  d={pathD(s.points)}
                  className={`import-shape ${sel.includes(i) ? 'selected' : ''} ${inside(i) ? 'hole' : ''}`}
                  strokeWidth={stroke}
                  onClick={(e) => {
                    const on = sel.includes(i);
                    if (e.shiftKey || e.metaKey || e.ctrlKey) setPicked(on ? sel.filter((j) => j !== i) : [...sel, i]);
                    else setPicked([i]);
                  }}
                />
              ))}
            </g>
          </svg>
        ) : (
          <div className="trace-empty">{parsed.error ?? 'No closed outlines in this file.'}</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".svg,.dxf,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
        {shapes.length > 0 && <div className="trace-stage-hint">Click a shape to use it · Shift-click to add more (each becomes its own tool)</div>}
      </div>
      <aside className="trace-side">
        <h4>Import an outline</h4>
        <p className="muted small">Closed shapes from CAD or a drawing program: paths, polygons, rectangles and circles (SVG); polylines, lines + arcs, circles and splines (DXF).</p>
        {file && (
          <>
            <div className="trace-file">
              <b>{file.name}</b>
              <button className="link" onClick={() => fileRef.current?.click()}>
                Change
              </button>
            </div>
            <Select
              label="Drawing units"
              value={units}
              options={[
                {
                  value: 'auto' as UnitChoice,
                  label: parsed.r && !parsed.r.unitsAssumed && units === 'auto' ? `From the file (1 unit = ${+parsed.r.mmPerUnit.toFixed(4)} mm)` : 'From the file (assumed mm)',
                },
                { value: 'mm' as UnitChoice, label: 'Millimetres' },
                { value: 'cm' as UnitChoice, label: 'Centimetres' },
                { value: 'in' as UnitChoice, label: 'Inches' },
                { value: 'px' as UnitChoice, label: 'Pixels (96 per inch)' },
                { value: 'pt' as UnitChoice, label: 'Points (72 per inch)' },
              ]}
              onChange={setUnits}
              hint={parsed.r?.unitsAssumed && units === 'auto' ? 'The file doesn’t say; check the size below.' : undefined}
            />
            {sel.length > 0 && (
              <div className="summary small">
                {sel
                  .filter((i) => !inside(i))
                  .map((i) => {
                    const b = bounds(shapes[i].points);
                    return (
                      <div key={i}>
                        {fmt(b.x1 - b.x0)} × {fmt(b.y1 - b.y0)} <span className="muted">· {shapes[i].source}</span>
                      </div>
                    );
                  })}
              </div>
            )}
            {shapes.length > 1 && sel.length < shapes.length && (
              <button className="link" onClick={() => setPicked(shapes.map((_, i) => i))}>
                Use all {shapes.length} shapes
              </button>
            )}
            {parsed.r?.warnings.map((w) => (
              <div key={w} className="field-hint">
                {w}
              </div>
            ))}
          </>
        )}
        <ToolFields p={p} />
        <div className="trace-spacer" />
        <div className="button-row">
          <button className="primary" disabled={!sel.length} onClick={save}>
            {sel.filter((i) => !inside(i)).length > 1 ? `Add ${sel.filter((i) => !inside(i)).length} tools` : p.onOutlines ? 'Add it' : 'Save to library'}
          </button>
        </div>
      </aside>
    </div>
  );
}
