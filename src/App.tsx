import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { projectOf, useStore, type Tab } from './state/store';
import { planJob, type MeshSpec, type PrintJob } from './lib/project';
import { binSeatHeight } from './lib/geometry/baseplate';
import { BASE_TOP, GRID } from './lib/geometry/spec';
import { plateOrigin } from './lib/export/bambu';
import { findPrinter } from './lib/printers';
import { geometry } from './worker/client';
import { Viewer, type SceneBed, type SceneItem } from './components/Viewer';
import { DrawerPanel } from './components/DrawerPanel';
import { BinPanel } from './components/BinPanel';
import { PrintPanel } from './components/PrintPanel';
import { BinGridEditor } from './components/BinGridEditor';
import { BASEPLATE_COLOR, BIN_COLOR, KEY_COLOR, pieceColor } from './components/colors';

const TABS: { id: Tab; label: string }[] = [
  { id: 'drawer', label: 'Drawer & baseplate' },
  { id: 'bins', label: 'Bins' },
  { id: 'print', label: 'Print plates' },
];

interface Scene {
  items: SceneItem[];
  beds?: SceneBed[];
  outline?: { w: number; d: number };
  fitKey: string;
}

function drawerScene(job: PrintJob, explode: boolean, withBins: boolean, state: ReturnType<typeof useStore.getState>): Scene {
  const gap = explode ? 14 : 0;
  const items: SceneItem[] = job.plan.pieces.map((p) => {
    const part = job.parts[`piece:${p.id}`];
    return {
      id: part.key,
      meshKey: part.meshKey,
      x: p.x0 + p.col * gap,
      y: p.y0 + p.row * gap,
      z: 0,
      w: part.w,
      d: part.d,
      h: part.h,
      color: withBins ? BASEPLATE_COLOR : pieceColor(p.id),
    };
  });
  if (withBins) {
    const seat = binSeatHeight(state.baseplate);
    const inset = (GRID - BASE_TOP) / 2;
    for (const b of state.bins) {
      const part = job.parts[`bin:${b.id}`];
      if (!part) continue;
      items.push({
        id: b.id,
        meshKey: part.meshKey,
        x: job.layout.originX + b.x * job.layout.pitchX + inset,
        y: job.layout.originY + b.y * job.layout.pitchY + inset,
        z: seat,
        w: part.w,
        d: part.d,
        h: part.h,
        color: BIN_COLOR,
        selected: b.id === state.ui.selectedBinId,
        pickable: true,
      });
    }
  }
  return {
    items,
    outline: state.drawer.mode === 'drawer' ? { w: state.drawer.width, d: state.drawer.depth } : undefined,
    fitKey: `drawer-${job.layout.plateW}-${job.layout.plateD}-${explode}`,
  };
}

function platesScene(job: PrintJob, plate: number, bedW: number, bedD: number): Scene {
  const items: SceneItem[] = [];
  const beds: SceneBed[] = [];
  const show = plate >= 0 && plate < job.plates.length ? [plate] : job.plates.map((_, i) => i);
  show.forEach((pi) => {
    const [ox, oy] = show.length === 1 ? [0, 0] : plateOrigin(pi, job.plates.length, bedW, bedD);
    const pl = job.plates[pi];
    beds.push({ x: ox, y: oy, w: bedW, d: bedD, label: `${pi + 1}  ${pl.name}` });
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      items.push({
        id: `${pi}:${p.key}`,
        meshKey: part.meshKey,
        x: ox + p.x,
        y: oy + p.y,
        z: 0,
        w: part.w,
        d: part.d,
        h: part.h,
        rotated: p.rotated,
        color: part.kind === 'piece' ? pieceColor(Number(p.key.split(':')[1])) : part.kind === 'key' ? KEY_COLOR : BIN_COLOR,
      });
    }
  });
  return { items, beds, fitKey: `plates-${show.join(',')}-${job.plates.length}-${bedW}x${bedD}` };
}

export default function App() {
  const state = useStore();
  const { ui } = state;
  // Plan with bins always included so the drawer view can show them.
  const project = projectOf(state);
  const job = useMemo(
    () => planJob(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.drawer, state.baseplate, state.setup, state.bins, state.include],
  );
  const viewJob = useMemo(
    () => (state.include.bins ? job : planJob({ ...project, include: { ...project.include, bins: true } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job, state.include.bins],
  );

  const scene = useMemo<Scene>(() => {
    if (ui.tab === 'print') return platesScene(job, ui.plate, state.setup.bedW, state.setup.bedD);
    return drawerScene(viewJob, ui.tab === 'drawer' && ui.explode, ui.tab === 'bins', state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, viewJob, ui.tab, ui.plate, ui.explode, ui.selectedBinId, state.setup.bedW, state.setup.bedD]);

  // Ask the worker for exactly the meshes on screen (selected bin first).
  useEffect(() => {
    const seen = new Set<string>();
    const specs: MeshSpec[] = [];
    const ordered = [...scene.items].sort((a, b) => Number(!!b.selected) - Number(!!a.selected));
    for (const it of ordered) {
      if (seen.has(it.meshKey)) continue;
      seen.add(it.meshKey);
      const spec = viewJob.meshes[it.meshKey] ?? job.meshes[it.meshKey];
      if (spec) specs.push(spec);
    }
    geometry.want(specs);
  }, [scene, job, viewJob]);

  // Delete / Backspace removes the selected bin (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const s = useStore.getState();
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.ui.selectedBinId && s.ui.tab === 'bins') {
        s.removeBin(s.ui.selectedBinId);
        e.preventDefault();
      }
      if (e.key === 'Escape') s.setUI({ selectedBinId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const queue = useSyncExternalStore(
    (cb) => geometry.subscribe(cb),
    () => geometry.queueLength,
  );
  const printer = findPrinter(state.setup.printerId);
  const [focusSel, setFocusSel] = useState(false);
  const focusing = ui.tab === 'bins' && focusSel && !!ui.selectedBinId;

  const viewer = (
    <Viewer
      items={scene.items}
      beds={scene.beds}
      outline={scene.outline}
      fitKey={focusing ? `focus-${ui.selectedBinId}-${scene.fitKey}` : scene.fitKey}
      fitIds={focusing ? [ui.selectedBinId!] : undefined}
      onPick={ui.tab === 'bins' ? (id) => state.setUI({ selectedBinId: id }) : undefined}
    >
      {ui.tab === 'bins' && (
        <div className="viewer-tools">
          <button className={!focusing ? 'active' : ''} onClick={() => setFocusSel(false)}>
            Whole drawer
          </button>
          <button className={focusing ? 'active' : ''} disabled={!ui.selectedBinId} onClick={() => setFocusSel(true)}>
            Selected bin
          </button>
        </div>
      )}
      {ui.tab === 'drawer' && (
        <div className="viewer-tools">
          <button className={ui.explode ? 'active' : ''} onClick={() => state.setUI({ explode: !ui.explode })}>
            Spread pieces
          </button>
        </div>
      )}
      <div className="viewer-hint">Drag to orbit · right-drag to pan · scroll to zoom{ui.tab === 'bins' ? ' · click a bin to select' : ''}</div>
    </Viewer>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <g fill="none" stroke="currentColor" strokeWidth="2.6">
              <rect x="5" y="5" width="9.5" height="9.5" rx="2" />
              <rect x="17.5" y="5" width="9.5" height="9.5" rx="2" />
              <rect x="5" y="17.5" width="9.5" height="9.5" rx="2" />
              <rect x="17.5" y="17.5" width="9.5" height="9.5" rx="2" />
            </g>
          </svg>
          <span>Gridfit</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.id} role="tab" aria-selected={ui.tab === t.id} className={ui.tab === t.id ? 'active' : ''} onClick={() => state.setUI({ tab: t.id })}>
              <span className="tab-num">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-status">
          {queue > 0 && (
            <span className="building">
              <span className="spinner" /> Building {queue}
            </span>
          )}
          <span className="chip" title="Printer">
            {printer.name} · {state.setup.bedW}×{state.setup.bedD}
          </span>
          <span className="chip">
            {job.layout.nx}×{job.layout.ny} grid · {job.plan.pieces.length} pieces · {job.plates.length} plates
          </span>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          {ui.tab === 'drawer' && <DrawerPanel job={job} />}
          {ui.tab === 'bins' && <BinPanel job={viewJob} />}
          {ui.tab === 'print' && <PrintPanel job={job} />}
        </aside>
        <main className={`main main-${ui.tab}`}>
          {ui.tab === 'bins' ? (
            <div className="split">
              <div className="pane pane-2d">
                <div className="pane-title">Layout — drag to draw bins</div>
                <BinGridEditor
                  layout={job.layout}
                  bins={state.bins}
                  selectedId={ui.selectedBinId}
                  onSelect={(id) => state.setUI({ selectedBinId: id })}
                  onCreate={(r) => state.addBin(r.x, r.y, r.w, r.d)}
                  onMove={(id, x, y) => state.updateBin(id, { x, y })}
                />
              </div>
              <div className="pane pane-3d">{viewer}</div>
            </div>
          ) : (
            viewer
          )}
          {job.warnings.length > 0 && ui.tab !== 'print' && (
            <div className="toast">{job.warnings[0]}</div>
          )}
        </main>
      </div>
    </div>
  );
}
