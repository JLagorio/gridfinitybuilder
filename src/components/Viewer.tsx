import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { geometry } from '../worker/client';
import type { MeshData } from '../lib/geometry/kernel';
import { overlayRole, type ColourRole } from '../lib/colours';
import './colours.css';
import type { BedRect } from '../lib/printers';
import { useUnits } from '../state/store';
import { isMod, isTyping, keyLetter } from './shortcuts';
import { isTouch, tapSlop } from './touch';
import {
  AXES,
  LIFT_DEFAULT,
  LIFT_MAX,
  deltaLegs,
  defaultSectionPos,
  deltaSummary,
  easeToward,
  isKept,
  itemBox,
  itemsBounds,
  liftFactor,
  measure,
  nearestWithin,
  planeFrame,
  sectionPlane,
  sectionPos,
  sectionRange,
  useViewerTools,
  type Axis,
  type Box,
  type PlaneSpec,
  type Vec3,
} from './viewerTools';

export interface SceneItem {
  id: string;
  meshKey: string;
  /** Min corner of the footprint in world space (after rotation). */
  x: number;
  y: number;
  z: number;
  /** Unrotated footprint and height, used for placeholders and rotation. */
  w: number;
  d: number;
  h: number;
  rotated?: boolean;
  color: string;
  /** Multi-colour (colours.ts): the filament colours of its bodies, by role, or by height. Overrides `color`. */
  paint?: ScenePaint;
  selected?: boolean;
  pickable?: boolean;
  /** Floats up with "Lift bins" (bins and their lids above a baseplate); a number lifts it that many times as far (stacked levels). */
  lift?: boolean | number;
  /** Context that isn't printed (a baseplate you have, "Just bins"): see-through and neutral, never picked. `color` is ignored. */
  ghost?: boolean;
  /** Drawn as a see-through box in this colour, never as a mesh: a bin you already have (lib/external.ts). */
  boxColor?: string;
}

/** A part in its filament colours. */
export interface ScenePaint {
  /** The main body's colour, and any body's whose role isn't in `roles`. */
  main: string;
  /** Colour by role: label text, shadow floors, the volumes of a part split by role. */
  roles?: Partial<Record<ColourRole, string>>;
  /** By height: from each z (the part's own frame, bottom at 0) up, this colour. */
  bands?: { z: number; color: string }[];
}

/** One line of the colour legend. */
export interface LegendEntry {
  color: string;
  label: string;
}

export interface SceneBed {
  x: number;
  y: number;
  w: number;
  d: number;
  label: string;
  /** Areas the printer keeps free (printers.ts `exclude`), on the bed: drawn hatched. */
  exclude?: readonly BedRect[];
}

export interface ViewerProps {
  items: SceneItem[];
  beds?: SceneBed[];
  /** Drawer outline drawn on the ground. */
  outline?: { w: number; d: number };
  /** Camera re-frames whenever this changes. */
  fitKey: string;
  /** Frame only these item ids (default: everything). Also what the section slider spans. */
  fitIds?: string[];
  /** Overlay controls (rendered over the canvas). */
  children?: ReactNode;
  /** One line of help, bottom left (shortened to fit). */
  hint?: ReactNode;
  onPick?: (id: string | null) => void;
  /** Multi-colour: the filament slots on screen, top right. */
  legend?: LegendEntry[];
}

const SELECT_COLOR = '#f5a524';
/** Flat, hatched colour of faces cut by the section plane: reads as solid material. */
const CUT_COLOR = '#d9466f';
const CUT_HATCH = '#9e2a4d';
const XRAY_OPACITY = 0.14;
/** Parts shown but not printed (SceneItem.ghost). */
const GHOST_COLOR = '#a7b0be';
const GHOST_OPACITY = 0.3;
/** Measure points snap to a triangle corner this close to the pointer (CSS px). */
const SNAP_PX = 12;

export type ViewName = 'iso' | 'top' | 'front' | 'side' | 'under';
/** Camera direction (from the target) for each preset view; z is up. */
const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  iso: [0.18, -0.78, 0.82],
  // A hair off vertical, so "up" on screen stays the back of the drawer.
  top: [0, -0.02, 1],
  front: [0, -1, 0.14],
  side: [1, -0.05, 0.14],
  under: [0.22, -0.72, -0.78],
};
const VIEWS: { id: ViewName; label: string; title: string }[] = [
  { id: 'iso', label: 'Iso', title: 'Three-quarter view from above' },
  { id: 'top', label: 'Top', title: 'Straight down (back of the drawer at the top)' },
  { id: 'front', label: 'Front', title: 'From the front of the drawer' },
  { id: 'side', label: 'Side', title: 'From the right' },
  { id: 'under', label: 'Under', title: 'From below: bin feet, magnet holes, baseplate underside' },
];
/** Preview colours for bodies printed in filament 2, 3, … (label text etc.). */
const OVERLAY_COLORS = ['#22262d', '#f2f2f2', '#c12e1f'];

/** What the 3D context needs to know about the tools (derived from useViewerTools + the scene). */
interface ToolConfig {
  section: { axis: Axis; pos: number; flip: boolean; outline: boolean; box: Box; focus: Box } | null;
  xray: boolean;
  measure: boolean;
  lift: number;
}
type MeasureInfo = { a: Vec3 | null; b: Vec3 | null };

function useGeometryVersion() {
  return useSyncExternalStore(
    (cb) => geometry.subscribe(cb),
    () => geometry.getVersion(),
  );
}

export function Viewer({ items, beds, outline, fitKey, fitIds, onPick, hint, children, legend }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<ReturnType<typeof createContext> | null>(null);
  const version = useGeometryVersion();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  // 'lost': the GPU dropped the WebGL context; 'failed': WebGL couldn't start at all.
  const [gl, setGl] = useState<{ state: 'ok' | 'lost' | 'failed'; detail?: string }>({ state: 'ok' });
  // Bumped by "Restart 3D view" to build a fresh renderer.
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<ViewName>('iso');
  const viewRef = useRef(view);
  viewRef.current = view;

  const tools = useViewerTools();
  const { units, precision, fmt, fmtBoth } = useUnits();
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  const [measured, setMeasured] = useState<MeasureInfo>({ a: null, b: null });

  const canLift = items.some((it) => it.lift);
  const lift = canLift && tools.liftOn ? tools.lift : 0;
  // The section slider spans what's framed (the selected bin when focused on it); the cap covers everything.
  const bounds = useMemo(() => itemsBounds(items, lift), [items, lift]);
  const focusItems = useMemo(() => {
    const only = fitIds?.length ? items.filter((it) => fitIds.includes(it.id)) : [];
    return only.length ? only : items;
  }, [items, fitIds]);
  const focusBounds = useMemo(() => itemsBounds(focusItems, lift), [focusItems, lift]);
  const sec = tools.section;
  const range: [number, number] = focusBounds ? sectionRange(focusBounds, sec.axis) : [0, 1];
  const pos = sectionPos(
    sec.pos,
    range,
    defaultSectionPos(
      focusItems.map((it) => itemBox(it, lift)),
      sec.axis,
      range,
    ),
  );

  useEffect(() => {
    let c: ReturnType<typeof createContext>;
    try {
      c = createContext(
        host.current!,
        (id) => pickRef.current?.(id),
        (lost) => setGl({ state: lost ? 'lost' : 'ok' }),
        setMeasured,
        (mm) => fmtRef.current(mm),
      );
    } catch (e) {
      console.error('[Gridfit] The 3D view could not start WebGL:', e);
      setGl({ state: 'failed', detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    ctx.current = c;
    setGl({ state: 'ok' });
    c.setView(viewRef.current);
    return () => {
      c.dispose();
      ctx.current = null;
      setMeasured({ a: null, b: null });
    };
  }, [generation]);

  // Before the scene and the framing, so both see the lift and section state.
  useEffect(() => {
    ctx.current?.setTools({
      section: sec.on && bounds && focusBounds ? { axis: sec.axis, pos, flip: sec.flip, outline: sec.outline, box: bounds, focus: focusBounds } : null,
      xray: tools.xray,
      measure: tools.measure,
      lift,
    });
  }, [sec.on, sec.axis, sec.flip, sec.outline, pos, bounds, focusBounds, tools.xray, tools.measure, lift, generation]);

  // The legend lists the filament colours the scene shows.
  const [painted, setPainted] = useState<string[]>([]);
  useEffect(() => {
    const used = ctx.current?.setScene(items, beds ?? [], outline) ?? [];
    setPainted((was) => (was.length === used.length && was.every((c, i) => c === used[i]) ? was : used));
  }, [items, beds, outline, version, generation]);
  const shownLegend = legend?.filter((l) => painted.includes(l.color));

  useEffect(() => {
    const only = fitIds?.length ? items.filter((it) => fitIds.includes(it.id)) : null;
    if (only?.length) ctx.current?.fit(only, []);
    else ctx.current?.fit(items, beds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, generation]);

  // The measure label is drawn by the 3D context; redraw it when the units change.
  useEffect(() => ctx.current?.redrawOverlay(), [units, precision]);

  // C section · M measure · X x-ray · L lift · Esc clears a measurement. Capture phase, so Esc
  // clears the measurement before the app treats it as "clear the selection".
  const canLiftRef = useRef(canLift);
  canLiftRef.current = canLift;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isMod(e) || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('.modal-backdrop, .overlay')) return;
      const t = useViewerTools.getState();
      if (e.key === 'Escape') {
        if (!t.measure) return;
        if (!ctx.current?.clearMeasure()) t.set({ measure: false });
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      const k = keyLetter(e);
      if (k === 'c') t.setSection({ on: !t.section.on });
      else if (k === 'm') t.set({ measure: !t.measure });
      else if (k === 'x') t.set({ xray: !t.xray });
      else if (k === 'l' && canLiftRef.current) toggleLift();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const step = units === 'mm' ? 0.5 : 25.4 / 32;
  const m = measured.a && measured.b ? measure(measured.a, measured.b) : null;
  const unitSuffix = units === 'mm' ? ' mm' : '″';

  return (
    <div className="viewer">
      <div ref={host} className="viewer-canvas" />
      {children}
      {!!shownLegend?.length && (
        <div className="viewer-legend" aria-label="Filament colours">
          {shownLegend.map((l) => (
            <span key={l.label}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div className="viewer-bottom">
        {hint && <div className="viewer-hint">{hint}</div>}
        <div className="viewer-dock">
          {sec.on && (
            <div className="vt-panel vt-section">
              <span className="vt-title">Section</span>
              <div className="vt-seg" role="group" aria-label="Cut across">
                {AXES.map((a) => (
                  <button
                    key={a}
                    className={sec.axis === a ? 'active' : ''}
                    aria-pressed={sec.axis === a}
                    title={a === 'z' ? 'Horizontal cut (plan view of the cut)' : `Vertical cut across ${a.toUpperCase()}`}
                    onClick={() => tools.setSection({ axis: a, pos: null })}
                  >
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
              <input
                type="range"
                aria-label="Section plane position"
                min={range[0]}
                max={range[1]}
                step={step}
                value={pos}
                onChange={(e) => tools.setSection({ pos: parseFloat(e.target.value) })}
              />
              <output className="vt-value" title="Plane position from the origin (front-left corner, floor)">
                {sec.axis.toUpperCase()} {fmt(pos)}
              </output>
              <button
                className={`vt-small${sec.flip ? ' active' : ''}`}
                aria-pressed={sec.flip}
                title="Keep the other side of the cut"
                onClick={() => tools.setSection({ flip: !sec.flip })}
              >
                Flip
              </button>
              <button
                className={`vt-small${sec.outline ? ' active' : ''}`}
                aria-pressed={sec.outline}
                title="Show the outline of the cutting plane"
                onClick={() => tools.setSection({ outline: !sec.outline })}
              >
                Plane
              </button>
            </div>
          )}
          {canLift && tools.liftOn && (
            <div className="vt-panel vt-lift">
              <span className="vt-title">Lift bins</span>
              <input
                type="range"
                aria-label="Lift height"
                min={0}
                max={LIFT_MAX}
                step={1}
                value={tools.lift}
                onChange={(e) => tools.set({ lift: parseFloat(e.target.value) })}
              />
              <output className="vt-value">{fmt(tools.lift, { mmDigits: 0 })}</output>
              <button className="vt-small" title="Put the bins back on the baseplate" onClick={() => tools.set({ liftOn: false })}>
                Seat
              </button>
            </div>
          )}
          {tools.measure && (
            <div className="vt-panel vt-measure" role="status">
              <span className="vt-title">Measure</span>
              {m ? (
                <>
                  <b className="vt-value">{fmtBoth(m.distance)}</b>
                  <span className="vt-muted">{deltaSummary(m, (v) => fmt(v, { unit: false }), unitSuffix)}</span>
                </>
              ) : (
                <span className="vt-muted">
                  {measured.a ? 'Click the second point' : 'Click a point on a model'}
                  <span className="vt-extra"> · snaps to corners · Esc clears</span>
                </span>
              )}
              {measured.a && (
                <button className="vt-small" onClick={() => ctx.current?.clearMeasure()}>
                  Clear
                </button>
              )}
            </div>
          )}
          <div className="viewer-dock-row">
            <div className="viewer-toolbar" role="toolbar" aria-label="3D tools">
              <ToolButton
                active={sec.on}
                label="Section"
                title="Cross-section: cut through the models with a plane (C)"
                onClick={() => tools.setSection({ on: !sec.on })}
                icon={
                  <>
                    <rect x="3" y="2.5" width="10" height="11" rx="1.2" />
                    <path d="M3 8.5h10v3.8c0 .7-.5 1.2-1.2 1.2H4.2c-.7 0-1.2-.5-1.2-1.2z" fill="currentColor" opacity=".4" stroke="none" />
                    <path d="M.8 8.5h14.4" className="vt-icon-accent" />
                  </>
                }
              />
              <ToolButton
                active={tools.measure}
                label="Measure"
                title="Measure: click two points on the models; Esc clears (M)"
                onClick={() => tools.set({ measure: !tools.measure })}
                icon={
                  <>
                    <rect x="1" y="5" width="14" height="6" rx="1" />
                    <path d="M4 5v2.6M6.5 5v1.6M9 5v2.6M11.5 5v1.6" />
                  </>
                }
              />
              <ToolButton
                active={tools.xray}
                label="X-ray"
                title="X-ray: see-through models, to check pockets, magnet holes and screw channels (X)"
                onClick={() => tools.set({ xray: !tools.xray })}
                icon={
                  <>
                    <rect x="2.5" y="4.5" width="8" height="8" />
                    <path d="M2.5 4.5l3-3h8v8l-3 3M10.5 4.5l3-3" />
                    <path d="M5.5 1.5v8h8M5.5 9.5l-3 3" strokeDasharray="1.6 1.4" />
                  </>
                }
              />
              {canLift && (
                <ToolButton
                  active={tools.liftOn}
                  label="Lift"
                  title="Lift the bins off the baseplate, to see feet and sockets (L)"
                  onClick={toggleLift}
                  icon={
                    <>
                      <path d="M2 14h12" />
                      <rect x="4" y="5.5" width="8" height="4.5" rx="0.8" />
                      <path d="M8 4V1.5M6.3 3.1 8 1.5l1.7 1.6" className="vt-icon-accent" />
                    </>
                  }
                />
              )}
            </div>
            <div className="viewer-views" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  title={v.title}
                  className={view === v.id ? 'active' : ''}
                  onClick={() => {
                    setView(v.id);
                    ctx.current?.setView(v.id);
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {gl.state !== 'ok' && (
        <div className="viewer-failure" role="alert">
          {gl.state === 'lost' ? (
            <>
              <b>The 3D view lost its graphics context.</b>
              <p>The graphics driver reset or ran out of memory. Your project is fine.</p>
            </>
          ) : (
            <>
              <b>The 3D view couldn't start WebGL.</b>
              <p>
                If Chrome showed “WebGL hit a snag”, it has turned WebGL off for this site after a graphics crash: quit and
                reopen the browser. Everything else (layout, exports) still works.
              </p>
              {gl.detail && <code>{gl.detail}</code>}
            </>
          )}
          <button className="primary" onClick={() => setGeneration((g) => g + 1)}>
            Restart 3D view
          </button>
        </div>
      )}
    </div>
  );
}

/** Lift the bins (back to the last height, or the default if that was zero), or seat them again. */
function toggleLift() {
  const t = useViewerTools.getState();
  if (t.liftOn) t.set({ liftOn: false });
  else t.set({ liftOn: true, lift: t.lift > 0 ? t.lift : LIFT_DEFAULT });
}

function ToolButton({ active, label, title, icon, onClick }: { active: boolean; label: string; title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} aria-pressed={active} title={title} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
        {icon}
      </svg>
      <span className="vt-label">{label}</span>
    </button>
  );
}

function createContext(
  el: HTMLDivElement,
  pick: (id: string | null) => void,
  onContext: (lost: boolean) => void,
  onMeasure: (m: MeasureInfo) => void,
  fmt: (mm: number) => string,
) {
  // The stencil buffer caps the section cut.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  camera.up.set(0, 0, 1);
  camera.position.set(300, -500, 400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  // Orbit all the way round, so the undersides of bins and baseplates can be seen.
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.zoomToCursor = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-0.6, -1, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(1, 0.8, 0.6);
  scene.add(rim);
  // Fill from below for the underside view.
  const under = new THREE.DirectionalLight(0xffffff, 0.7);
  under.position.set(0.3, 0.5, -1);
  scene.add(under);

  const world = new THREE.Group();
  const bedGroup = new THREE.Group();
  const helpers = new THREE.Group();
  const sectionGroup = new THREE.Group();
  scene.add(world, bedGroup, helpers, sectionGroup);

  const geoms = new Map<
    string,
    { mesh: THREE.BufferGeometry; edges: THREE.BufferGeometry; role?: ColourRole; overlays: { filament: number; role: ColourRole; mesh: THREE.BufferGeometry }[] }
  >();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const xrayMats = new Map<string, THREE.MeshStandardMaterial>();
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
  // See-through models: brighter edges that never hide each other.
  const xrayEdgeMat = new THREE.LineBasicMaterial({ color: 0xe6ebf2, transparent: true, opacity: 0.5, depthWrite: false });
  const placeholderMat = new THREE.MeshBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.12 });
  // Not printed (SceneItem.ghost): see-through, so the bins on it stay in view; its edges say where the cells are.
  const ghostMat = new THREE.MeshStandardMaterial({ color: GHOST_COLOR, roughness: 0.62, metalness: 0.04, transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
  const ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.4, depthWrite: false });
  const placeholderEdge = new THREE.LineBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.5 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
  // Bins from elsewhere without a mesh: a see-through box in their own colour.
  const ghostMats = new Map<string, { face: THREE.MeshBasicMaterial; edge: THREE.LineBasicMaterial }>();
  function ghostMaterial(color: string) {
    let g = ghostMats.get(color);
    if (!g) {
      g = {
        face: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }),
        edge: new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      };
      ghostMats.set(color, g);
    }
    g.face.clippingPlanes = clipping();
    g.edge.clippingPlanes = clipping();
    return g;
  }

  // ---- section: one clipping plane on every model material, capped with the stencil buffer ----
  // Each model is drawn twice more into the stencil (back faces +1, front faces -1, both clipped):
  // where the count isn't zero, the plane is inside a solid, and the cap plane is drawn there.
  const clipPlane = new THREE.Plane();
  const clipList = [clipPlane];
  let planeSpec: PlaneSpec | null = null;
  const stencilBase = {
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
  } as const;
  const stencilBack = new THREE.MeshBasicMaterial({
    ...stencilBase,
    side: THREE.BackSide,
    stencilFail: THREE.IncrementWrapStencilOp,
    stencilZFail: THREE.IncrementWrapStencilOp,
    stencilZPass: THREE.IncrementWrapStencilOp,
  });
  const stencilFront = new THREE.MeshBasicMaterial({
    ...stencilBase,
    side: THREE.FrontSide,
    stencilFail: THREE.DecrementWrapStencilOp,
    stencilZFail: THREE.DecrementWrapStencilOp,
    stencilZPass: THREE.DecrementWrapStencilOp,
  });
  const hatch = hatchTexture();
  hatch.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const capMat = new THREE.MeshBasicMaterial({
    map: hatch,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const cap = new THREE.Mesh(unitPlane, capMat);
  // After the models (0) and their stencil passes (1).
  cap.renderOrder = 2;
  cap.onAfterRender = (r) => r.clearStencil();
  cap.raycast = () => {};
  const planeOutlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ]);
  const planeOutlineMat = new THREE.LineBasicMaterial({ color: 0xe6ebf2, transparent: true, opacity: 0.45, depthWrite: false });
  const planeFillMat = new THREE.MeshBasicMaterial({ color: 0xe6ebf2, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide });
  const planeOutline = new THREE.Group();
  planeOutline.add(new THREE.LineLoop(planeOutlineGeo, planeOutlineMat), new THREE.Mesh(unitPlane, planeFillMat));
  planeOutline.traverse((o) => (o.raycast = () => {}));
  sectionGroup.add(cap, planeOutline);
  sectionGroup.visible = false;

  let tools: ToolConfig = { section: null, xray: false, measure: false, lift: 0 };
  const clipping = () => (tools.section ? clipList : null);

  function material(color: string) {
    const map = tools.xray ? xrayMats : mats;
    let m = map.get(color);
    if (!m) {
      // Additive, so it doesn't matter in which order the see-through faces are drawn
      // (no sorting artefacts); where walls overlap it simply reads denser.
      m = tools.xray
        ? new THREE.MeshStandardMaterial({
            color,
            roughness: 0.62,
            metalness: 0.04,
            transparent: true,
            opacity: XRAY_OPACITY,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            // Undersides lie on the print bed's top: win that tie instead of flickering stripes.
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
          })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 });
      map.set(color, m);
    }
    m.clippingPlanes = clipping();
    return m;
  }

  /**
   * A material that colours by height in the part's own frame (multi-colour by
   * height): the fragment shader takes the colour of the band its local z is in.
   */
  const bandMats = new Map<string, THREE.MeshStandardMaterial>();
  function bandMaterial(bands: { z: number; color: string }[]) {
    const key = `${tools.xray ? 'x' : 's'}|${bands.map((b) => `${b.z}:${b.color}`).join('|')}`;
    let m = bandMats.get(key);
    if (!m) {
      const base = material(bands[0].color);
      m = base.clone();
      const n = Math.min(bands.length, 8);
      const zs = Array.from({ length: 8 }, (_, i) => (i < n ? bands[i].z : 1e9));
      const cs = Array.from({ length: 8 }, (_, i) => new THREE.Color(bands[Math.min(i, n - 1)].color));
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uBandZ = { value: zs };
        shader.uniforms.uBandColor = { value: cs };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vLocalZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalZ = position.z;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vLocalZ;\nuniform float uBandZ[8];\nuniform vec3 uBandColor[8];')
          .replace(
            '#include <color_fragment>',
            '#include <color_fragment>\nvec3 bandC = uBandColor[0];\nfor (int i = 1; i < 8; i++) { if (vLocalZ >= uBandZ[i]) bandC = uBandColor[i]; }\ndiffuseColor.rgb = bandC;',
          );
      };
      m.customProgramCacheKey = () => `bands${n}`;
      bandMats.set(key, m);
    }
    m.clippingPlanes = clipping();
    return m;
  }

  function buildGeometry(positions: Float32Array, indices: Uint32Array) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bg.setIndex(new THREE.BufferAttribute(indices, 1));
    const mesh = toCreasedNormals(bg, Math.PI / 7);
    const edges = new THREE.EdgesGeometry(bg, 28);
    bg.dispose();
    mesh.computeBoundingSphere();
    return { mesh, edges };
  }

  /** Overlay bodies (label text) are drawn without edge lines. */
  function buildSurface(positions: Float32Array, indices: Uint32Array) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    bg.setIndex(new THREE.BufferAttribute(indices, 1));
    const mesh = toCreasedNormals(bg, Math.PI / 7);
    bg.dispose();
    mesh.computeBoundingSphere();
    return mesh;
  }

  function geometryFor(key: string, data: MeshData) {
    let g = geoms.get(key);
    if (!g) {
      g = {
        ...buildGeometry(data.positions, data.indices),
        role: data.role,
        overlays: (data.overlays ?? []).map((o) => ({ filament: o.filament, role: overlayRole(o), mesh: buildSurface(o.positions, o.indices) })),
      };
      geoms.set(key, g);
    }
    return g;
  }

  /** The solid's stencil passes for the section cap (they share its geometry). */
  function addStencil(obj: THREE.Object3D, geom: THREE.BufferGeometry) {
    const back = new THREE.Mesh(geom, stencilBack);
    back.renderOrder = 1;
    // Raycasts see back faces through this one: that's how a click on the cap is found.
    back.userData.stencilBack = true;
    measurables.push(back);
    const front = new THREE.Mesh(geom, stencilFront);
    front.renderOrder = 1;
    front.raycast = () => {};
    obj.add(back, front);
  }

  let lastBedKey = '';
  let needsRender = true;
  let overlayDirty = true;
  const requestRender = () => (needsRender = true);
  controls.addEventListener('change', requestRender);

  // Measure: up to two points; hover is the snapped point under the pointer.
  interface MeasurePoint {
    itemId: string;
    /** In the part's own frame, so the point rides along when bins lift. */
    local: THREE.Vector3;
    snapped: boolean;
  }
  let points: MeasurePoint[] = [];
  let hover: MeasurePoint | null = null;
  let pointer: { x: number; y: number } | null = null;
  let hoverPending = false;
  let reported = '';

  /** Model meshes a measure point can land on (including the back-face stencil pass, for clicks on the cap). */
  let measurables: THREE.Mesh[] = [];

  // Bins lift smoothly toward liftTarget; liftNow is where they are this frame.
  let liftTarget = 0;
  let liftNow = 0;
  const groups = new Map<string, THREE.Object3D>();
  let last: { items: SceneItem[]; beds: SceneBed[]; outline?: { w: number; d: number } } = { items: [], beds: [] };

  /** Paint colours on screen (multi-colour), for the legend. */
  let painted = new Set<string>();
  function setScene(items: SceneItem[], beds: SceneBed[], outline?: { w: number; d: number }): string[] {
    last = { items, beds, outline };
    world.clear();
    groups.clear();
    measurables = [];
    painted = new Set<string>();
    const used = new Set<string>();
    const edges = tools.xray ? xrayEdgeMat : edgeMat;
    for (const it of items) {
      const data = geometry.mesh(it.meshKey);
      const obj = new THREE.Group();
      if (it.rotated) {
        obj.rotation.z = Math.PI / 2;
        obj.position.set(it.x + it.d, it.y, it.z);
      } else {
        obj.position.set(it.x, it.y, it.z);
      }
      obj.userData.itemId = it.id;
      obj.userData.pickId = it.pickable ? it.id : null;
      if (it.lift) {
        obj.userData.baseZ = it.z;
        obj.userData.liftBy = liftFactor(it);
        obj.position.z = it.z + liftNow * obj.userData.liftBy;
      }
      if (data && it.ghost) {
        used.add(it.meshKey);
        const g = geometryFor(it.meshKey, data);
        ghostMat.clippingPlanes = clipping();
        // In x-ray everything is see-through already.
        const mesh = new THREE.Mesh(g.mesh, tools.xray ? material(GHOST_COLOR) : ghostMat);
        mesh.userData.id = null;
        measurables.push(mesh);
        obj.add(mesh, new THREE.LineSegments(g.edges, tools.xray ? edges : ghostEdgeMat));
      } else if (data) {
        used.add(it.meshKey);
        const g = geometryFor(it.meshKey, data);
        // Multi-colour: each body in its filament's colour (by height: banded), else the part's colour.
        const p = it.selected ? null : it.paint;
        const mainColour = p ? ((g.role && p.roles?.[g.role]) ?? p.main) : null;
        if (p?.bands && p.bands.length > 1) for (const b of p.bands) painted.add(b.color);
        else if (mainColour) painted.add(mainColour);
        const mainMat = p?.bands && p.bands.length > 1 ? bandMaterial(p.bands) : material(it.selected ? SELECT_COLOR : (mainColour ?? it.color));
        const mesh = new THREE.Mesh(g.mesh, mainMat);
        mesh.userData.id = it.pickable ? it.id : null;
        measurables.push(mesh);
        obj.add(mesh, new THREE.LineSegments(g.edges, edges));
        if (tools.section) addStencil(obj, g.mesh);
        for (const o of g.overlays) {
          const oc = p ? (p.bands && p.bands.length > 1 ? null : (p.roles?.[o.role] ?? p.main)) : OVERLAY_COLORS[(o.filament - 2) % OVERLAY_COLORS.length];
          if (p && oc) painted.add(oc);
          const om = new THREE.Mesh(o.mesh, oc ? material(oc) : bandMaterial(p!.bands!));
          om.userData.id = mesh.userData.id;
          measurables.push(om);
          obj.add(om);
          if (tools.section) addStencil(obj, o.mesh);
        }
      } else {
        const box = it.boxColor ? ghostMaterial(it.selected ? SELECT_COLOR : it.boxColor) : null;
        const ph = new THREE.Mesh(unitBox, box?.face ?? placeholderMat);
        ph.scale.set(it.w, it.d, Math.max(it.h, 1));
        const phe = new THREE.LineSegments(unitBoxEdges, box?.edge ?? placeholderEdge);
        phe.scale.copy(ph.scale);
        ph.userData.id = it.pickable ? it.id : null;
        obj.add(ph, phe);
      }
      world.add(obj);
      groups.set(it.id, obj);
    }
    // Drop GPU buffers nobody shows anymore.
    for (const [k, g] of geoms) {
      if (!used.has(k)) {
        g.mesh.dispose();
        g.edges.dispose();
        for (const o of g.overlays) o.mesh.dispose();
        geoms.delete(k);
      }
    }

    const bedKey = beds.map((b) => `${b.x},${b.y},${b.w},${b.d},${b.label},${JSON.stringify(b.exclude ?? [])}`).join('|');
    if (bedKey !== lastBedKey) {
      lastBedKey = bedKey;
      disposeTree(bedGroup);
      bedGroup.clear();
      for (const b of beds) bedGroup.add(makeBed(b));
    }

    disposeTree(helpers);
    helpers.clear();
    if (outline) {
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(outline.w, 0, 0),
        new THREE.Vector3(outline.w, outline.d, 0),
        new THREE.Vector3(0, outline.d, 0),
        new THREE.Vector3(0, 0, 0),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: 0x9aa4b5, dashSize: 6, gapSize: 4 }),
      );
      line.computeLineDistances();
      helpers.add(line);
    }
    // A measurement on a part that's gone (deleted bin, other plate) goes with it.
    if (points.some((p) => !groups.has(p.itemId))) clearMeasure();
    if (hover && !groups.has(hover.itemId)) hover = null;
    overlayDirty = true;
    requestRender();
    return [...painted];
  }

  // Re-frame on resize until the user moves the camera themselves.
  let lastFit: { items: SceneItem[]; beds: SceneBed[] } | null = null;
  let userMoved = false;
  let view: ViewName = 'iso';
  controls.addEventListener('start', () => (userMoved = true));

  function fit(items: SceneItem[], beds: SceneBed[]) {
    lastFit = { items, beds };
    userMoved = false;
    const box = new THREE.Box3();
    const b = itemsBounds(items, liftTarget);
    if (b) {
      box.expandByPoint(new THREE.Vector3(...b.min));
      box.expandByPoint(new THREE.Vector3(...b.max));
    }
    for (const bed of beds) {
      box.expandByPoint(new THREE.Vector3(bed.x, bed.y, 0));
      box.expandByPoint(new THREE.Vector3(bed.x + bed.w, bed.y + bed.d, 0));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dir = new THREE.Vector3(...VIEW_DIRS[view]).normalize();
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    // Binary-search the camera distance so every corner projects inside the frame.
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      camera.position.copy(center).addScaledVector(dir, d);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      return corners.every((c) => {
        v.copy(c).project(camera);
        return Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.86 && v.z < 1;
      });
    };
    const span = Math.max(size.x, size.y, size.z, 10);
    let lo = span * 0.2;
    let hi = span * 20;
    camera.near = 0.5;
    camera.far = hi * 4;
    camera.updateProjectionMatrix();
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    camera.near = Math.max(0.5, hi / 300);
    camera.far = hi * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    overlayDirty = true;
    requestRender();
  }

  function setTools(t: ToolConfig) {
    const prev = tools;
    tools = t;
    const s = t.section;
    if (s) {
      planeSpec = sectionPlane(s.axis, s.pos, s.flip);
      clipPlane.normal.set(...planeSpec.normal);
      clipPlane.constant = planeSpec.constant;
      const span = Math.max(...s.box.max.map((v, i) => v - s.box.min[i]), 10);
      const capFrame = planeFrame(s.axis, s.pos, s.box, span * 0.05 + 2);
      cap.position.set(...capFrame.position);
      cap.rotation.set(...capFrame.rotation);
      cap.scale.set(capFrame.size[0], capFrame.size[1], 1);
      // Hatch spacing in mm, coarser for bigger scenes so it never turns to noise.
      const period = THREE.MathUtils.clamp(span / 70, 1.6, 8);
      hatch.repeat.set(capFrame.size[0] / period, capFrame.size[1] / period);
      const fspan = Math.max(...s.focus.max.map((v, i) => v - s.focus.min[i]), 10);
      const outlineFrame = planeFrame(s.axis, s.pos, s.focus, fspan * 0.04 + 1);
      planeOutline.position.set(...outlineFrame.position);
      planeOutline.rotation.set(...outlineFrame.rotation);
      planeOutline.scale.set(outlineFrame.size[0], outlineFrame.size[1], 1);
      planeOutline.visible = s.outline;
    } else planeSpec = null;
    sectionGroup.visible = !!s;
    for (const m of [edgeMat, xrayEdgeMat, placeholderMat, placeholderEdge, stencilBack, stencilFront, ghostMat, ghostEdgeMat]) m.clippingPlanes = clipping();
    // New materials (x-ray) or stencil passes (section on/off) mean rebuilding the scene's objects.
    if (prev.xray !== t.xray || !!prev.section !== !!s) setScene(last.items, last.beds, last.outline);
    if (t.lift !== liftTarget) {
      liftTarget = t.lift;
      if (lastFit && !userMoved) fit(lastFit.items, lastFit.beds);
    }
    if (prev.measure !== t.measure) {
      if (!t.measure) {
        clearMeasure();
        hover = null;
      }
      renderer.domElement.style.cursor = t.measure ? 'crosshair' : '';
    }
    overlayDirty = true;
    requestRender();
  }

  // ---- picking and measuring ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpN = new THREE.Vector3();
  const kept = (p: THREE.Vector3) => !planeSpec || isKept(planeSpec, [p.x, p.y, p.z]);

  function castFrom(clientX: number, clientY: number, targets: THREE.Object3D[] = world.children, recursive = true) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(targets, recursive);
  }

  function screenOf(p: THREE.Vector3): [number, number] | null {
    const v = p.clone().project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }

  function groupOf(o: THREE.Object3D) {
    let g = o;
    while (g.parent && g.parent !== world) g = g.parent;
    return g;
  }

  /** The visible model surface under the pointer, snapped to a nearby triangle corner. */
  function measureHit(clientX: number, clientY: number): MeasurePoint | null {
    const hits = castFrom(clientX, clientY, measurables, false);
    for (const h of hits) {
      const mesh = h.object as THREE.Mesh;
      if (!h.face || !kept(h.point)) continue;
      const group = groupOf(mesh);
      const itemId = group.userData.itemId as string;
      tmpN.copy(h.face.normal).transformDirection(mesh.matrixWorld);
      const backFacing = tmpN.dot(ray.ray.direction) > 0;
      if (backFacing) {
        // The ray was inside a solid where it crossed the cut: what's visible there is the cap.
        if (!planeSpec) continue;
        const p = ray.ray.intersectPlane(clipPlane, new THREE.Vector3());
        if (!p || p.distanceTo(ray.ray.origin) > h.distance + 1e-6) return null;
        return { itemId, local: group.worldToLocal(p), snapped: false };
      }
      const pos = mesh.geometry.getAttribute('position');
      const corners = [h.face.a, h.face.b, h.face.c]
        .map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld))
        .filter(kept);
      const here = screenOf(h.point);
      const scr = corners.map((c) => screenOf(c) ?? ([Infinity, Infinity] as [number, number]));
      const i = here ? nearestWithin(here, scr, SNAP_PX) : -1;
      const p = i >= 0 ? corners[i] : h.point.clone();
      return { itemId, local: group.worldToLocal(p), snapped: i >= 0 };
    }
    return null;
  }

  function worldOf(p: MeasurePoint): THREE.Vector3 | null {
    const g = groups.get(p.itemId);
    if (!g) return null;
    g.updateWorldMatrix(true, false);
    return g.localToWorld(p.local.clone());
  }

  function clearMeasure() {
    const had = points.length > 0;
    points = [];
    overlayDirty = true;
    report();
    return had;
  }

  function report() {
    const [a, b] = points.map(worldOf);
    const info: MeasureInfo = {
      a: a ? [a.x, a.y, a.z] : null,
      b: b ? [b.x, b.y, b.z] : null,
    };
    const k = JSON.stringify([info.a, info.b].map((p) => p?.map((v) => Math.round(v * 1000))));
    if (k !== reported) {
      reported = k;
      onMeasure(info);
    }
  }

  // Measure overlay: SVG on top of the canvas, re-projected after every frame.
  const SVG = 'http://www.w3.org/2000/svg';
  const overlay = document.createElement('div');
  overlay.className = 'viewer-measure';
  const svg = document.createElementNS(SVG, 'svg');
  const node = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string) => {
    const n = document.createElementNS(SVG, tag);
    n.setAttribute('class', cls);
    svg.appendChild(n);
    return n;
  };
  const legs = (['x', 'y', 'z'] as Axis[]).map((a) => node('line', `m-leg m-leg-${a}`));
  const mline = node('line', 'm-line');
  const dots = [node('circle', 'm-pt'), node('circle', 'm-pt')];
  const hoverDot = node('circle', 'm-hover');
  const label = document.createElement('div');
  label.className = 'viewer-measure-label';
  overlay.append(svg, label);
  el.appendChild(overlay);

  const show = (n: Element, on: boolean) => n.setAttribute('visibility', on ? 'visible' : 'hidden');
  const setLine = (n: SVGLineElement, a: [number, number], b: [number, number]) => {
    n.setAttribute('x1', String(a[0]));
    n.setAttribute('y1', String(a[1]));
    n.setAttribute('x2', String(b[0]));
    n.setAttribute('y2', String(b[1]));
  };

  function drawOverlay() {
    overlay.style.display = tools.measure ? '' : 'none';
    if (!tools.measure) return;
    const pa = points[0] ? worldOf(points[0]) : null;
    // Second point, or the pointer while placing it (a live "rubber band").
    const live = !points[1] && !!pa;
    const pb = points[1] ? worldOf(points[1]) : live && hover ? worldOf(hover) : null;
    const sa = pa && screenOf(pa);
    const sb = pb && screenOf(pb);
    dots.forEach((d, i) => {
      const s = i === 0 ? sa : points[1] ? sb : null;
      show(d, !!s);
      if (s) {
        d.setAttribute('cx', String(s[0]));
        d.setAttribute('cy', String(s[1]));
        d.setAttribute('r', points[i]?.snapped ? '4.5' : '3.5');
      }
    });
    // Where the next click lands (and whether it snapped), also once a measurement is done.
    const hw = hover ? worldOf(hover) : null;
    const hs = hw && screenOf(hw);
    show(hoverDot, !!hs);
    if (hs) {
      hoverDot.setAttribute('cx', String(hs[0]));
      hoverDot.setAttribute('cy', String(hs[1]));
      hoverDot.setAttribute('r', hover!.snapped ? '6' : '3');
      hoverDot.classList.toggle('snapped', hover!.snapped);
    }
    const both = !!(pa && pb && sa && sb);
    show(mline, both);
    mline.classList.toggle('live', live);
    const legList = both ? deltaLegs([pa!.x, pa!.y, pa!.z], [pb!.x, pb!.y, pb!.z], 0.05) : [];
    legs.forEach((n, i) => {
      const leg = legList.find((l) => l.axis === 'xyz'[i]);
      const s0 = leg && screenOf(new THREE.Vector3(...leg.from));
      const s1 = leg && screenOf(new THREE.Vector3(...leg.to));
      show(n, !!(s0 && s1));
      if (s0 && s1) setLine(n, s0, s1);
    });
    if (both) {
      setLine(mline, sa!, sb!);
      label.style.display = '';
      label.textContent = fmt(pa!.distanceTo(pb!));
      label.classList.toggle('live', live);
      label.style.transform = `translate(${(sa![0] + sb![0]) / 2}px, ${(sa![1] + sb![1]) / 2}px) translate(-50%, -140%)`;
    } else label.style.display = 'none';
    if (points.length) report();
  }

  // A tap (click) picks or measures; a drag orbits. Two fingers (pinch, pan) never count as a tap.
  let down: { x: number; y: number } | null = null;
  const pressed = new Set<number>();
  const onDown = (e: PointerEvent) => {
    pressed.add(e.pointerId);
    down = pressed.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    hover = null;
    overlayDirty = true;
  };
  const onUp = (e: PointerEvent) => {
    pressed.delete(e.pointerId);
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > tapSlop(isTouch(e))) return;
    down = null;
    if (tools.measure) {
      const p = measureHit(e.clientX, e.clientY);
      if (!p) return;
      // A third click starts a new measurement.
      if (points.length >= 2) points = [];
      points.push(p);
      hoverPending = true;
      overlayDirty = true;
      report();
      return;
    }
    const hits = castFrom(e.clientX, e.clientY);
    // With a section on, a click on the cap (a back face of the stencil pass) picks the part that was cut.
    const hit = hits.find((h) => (h.object.userData.id !== undefined || h.object.userData.stencilBack) && kept(h.point));
    pick(hit ? ((groupOf(hit.object).userData.pickId as string | null) ?? null) : null);
  };
  const onMove = (e: PointerEvent) => {
    if (!tools.measure) return;
    // Not while orbiting.
    pointer = e.buttons ? null : { x: e.clientX, y: e.clientY };
    if (!pointer) hover = null;
    hoverPending = true;
  };
  const onLeave = () => {
    pointer = null;
    hover = null;
    overlayDirty = true;
  };
  const onCancel = (e: PointerEvent) => {
    pressed.delete(e.pointerId);
    down = null;
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  renderer.domElement.addEventListener('pointercancel', onCancel);

  // three.js rebuilds its GPU state when a lost context comes back; say what happened meanwhile.
  const onLost = (e: Event) => {
    e.preventDefault();
    console.warn('[Gridfit] The 3D view lost its WebGL context (graphics driver reset, or too many WebGL pages open).');
    onContext(true);
  };
  const onRestored = () => {
    console.info('[Gridfit] WebGL context restored.');
    onContext(false);
    requestRender();
  };
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);

  const resize = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (lastFit && !userMoved) fit(lastFit.items, lastFit.beds);
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  let raf = 0;
  let lastT = performance.now();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(now - lastT, 100);
    lastT = now;
    if (liftNow !== liftTarget) {
      liftNow = easeToward(liftNow, liftTarget, dt);
      for (const o of world.children) if (o.userData.baseZ !== undefined) o.position.z = o.userData.baseZ + liftNow * (o.userData.liftBy ?? 1);
      requestRender();
    }
    controls.update();
    if (hoverPending && tools.measure) {
      hoverPending = false;
      hover = pointer ? measureHit(pointer.x, pointer.y) : null;
      overlayDirty = true;
    }
    if (needsRender) {
      needsRender = false;
      // Print beds are solid slabs at z ≤ 0: from below they'd hide everything.
      bedGroup.visible = camera.position.z > 0;
      renderer.render(scene, camera);
      overlayDirty = true;
    }
    if (overlayDirty) {
      overlayDirty = false;
      drawOverlay();
    }
  };
  loop();

  return {
    setScene,
    fit,
    setTools,
    /** Forget the measurement; true if there was one. */
    clearMeasure,
    redrawOverlay() {
      overlayDirty = true;
    },
    /** Look from a preset direction and frame the current scene. */
    setView(v: ViewName) {
      view = v;
      if (lastFit) fit(lastFit.items, lastFit.beds);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      for (const g of geoms.values()) {
        g.mesh.dispose();
        g.edges.dispose();
        for (const o of g.overlays) o.mesh.dispose();
      }
      for (const m of [...mats.values(), ...xrayMats.values(), ...bandMats.values()]) m.dispose();
      for (const m of [edgeMat, xrayEdgeMat, placeholderMat, placeholderEdge, stencilBack, stencilFront, capMat, planeOutlineMat, planeFillMat, ghostMat, ghostEdgeMat]) m.dispose();
      for (const g of ghostMats.values()) {
        g.face.dispose();
        g.edge.dispose();
      }
      for (const g of [unitBox, unitBoxEdges, unitPlane, planeOutlineGeo]) g.dispose();
      hatch.dispose();
      disposeTree(bedGroup);
      disposeTree(helpers);
      renderer.dispose();
      // Release the context now rather than at garbage collection: browsers allow only ~16 live
      // WebGL contexts and silently kill the oldest, and the view is rebuilt on every tab switch.
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (x as THREE.MeshStandardMaterial).map?.dispose();
      x.dispose();
    }
  });
}

/** Diagonal hatching for cut faces; tiles seamlessly. */
function hatchTexture() {
  const px = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d')!;
  c.fillStyle = CUT_COLOR;
  c.fillRect(0, 0, px, px);
  c.strokeStyle = CUT_HATCH;
  c.lineWidth = 4;
  for (let o = -px; o <= px; o += px / 2) {
    c.beginPath();
    c.moveTo(o, px);
    c.lineTo(o + px, 0);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeBed(b: SceneBed) {
  const g = new THREE.Group();
  const canvas = document.createElement('canvas');
  const px = 512;
  canvas.width = px;
  canvas.height = Math.round((px * b.d) / b.w);
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#2a2f38';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth = 1;
  const step = (canvas.width / b.w) * 10;
  for (let x = 0; x < canvas.width; x += step) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, canvas.height);
    c.stroke();
  }
  for (let y = 0; y < canvas.height; y += step) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(canvas.width, y);
    c.stroke();
  }
  // The areas the printer keeps free, hatched (canvas top = back of the bed).
  const k = canvas.width / b.w;
  for (const e of b.exclude ?? []) {
    const x0 = e.x * k;
    const y0 = (b.d - e.y - e.d) * k;
    const w = e.w * k;
    const h = e.d * k;
    c.save();
    c.beginPath();
    c.rect(x0, y0, w, h);
    c.clip();
    c.fillStyle = 'rgba(240,97,106,0.12)';
    c.fillRect(x0, y0, w, h);
    c.strokeStyle = 'rgba(240,97,106,0.6)';
    c.lineWidth = Math.max(1, k * 1.2);
    for (let t = -h; t < w; t += k * 4) {
      c.beginPath();
      c.moveTo(x0 + t, y0 + h);
      c.lineTo(x0 + t + h, y0);
      c.stroke();
    }
    c.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.BoxGeometry(b.w, b.d, 1.2).translate(b.w / 2, b.d / 2, -0.61),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
  );
  plane.position.set(b.x, b.y, 0);
  g.add(plane);

  // Label in front of the bed so parts never cover it.
  const lc = document.createElement('canvas');
  lc.width = 1024;
  lc.height = 96;
  const l = lc.getContext('2d')!;
  l.fillStyle = 'rgba(231,233,236,0.75)';
  l.font = '600 64px system-ui, sans-serif';
  l.textBaseline = 'middle';
  l.fillText(b.label, 8, 50);
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  const lh = (b.w * lc.height) / lc.width;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(b.w, lh).translate(b.w / 2, -lh / 2 - 4, 0),
    new THREE.MeshBasicMaterial({ map: ltex, transparent: true, depthWrite: false }),
  );
  label.position.set(b.x, b.y, 0.05);
  g.add(label);
  return g;
}
