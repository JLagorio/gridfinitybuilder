import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { projectOf, selectedIds, useStore, type Tab } from './state/store';
import { moveBins, removeSelection, resizeBin, selectBins, useSelectedIds } from './state/selection';
import { asDrawer, binOrigin, planJob, type JobPart, type MeshSpec, type PrintJob } from './lib/project';
import { binSeatHeight } from './lib/geometry/baseplate';
import { plateOrigin } from './lib/export/bambu';
import { findPrinter } from './lib/printers';
import { geometry } from './worker/client';
import { Viewer, type SceneBed, type SceneItem } from './components/Viewer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DrawerPanel } from './components/DrawerPanel';
import { BinGridEditor } from './components/BinGridEditor';
import { useBinCheckMarks } from './components/PrintChecks';
import { BinPaneHeader, useInteriorPane } from './components/BinPaneHeader';
import { LazyPart, lazyNamed, once, prefetch } from './components/lazy';
import { DrawerSwitcher } from './components/DrawerSwitcher';
import { HistoryButtons } from './components/HistoryButtons';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { FindBox } from './components/FindBox';
import { useOpenSharedProject } from './components/ShareLink';
import { Segmented } from './components/fields';
import { BASEPLATE_COLOR, BIN_COLOR, KEY_COLOR, LABEL_PLATE_COLOR, LID_COLOR, pieceColor } from './components/colors';
import { binBodyHeight } from './lib/geometry/variants';
import { LID_SEAT_DROP } from './lib/geometry/lid';
import { assembledParts } from './lib/geometry/accessories';
import { usableBeds } from './lib/bedfit';
import { jobPrinters, printerNames, shortName } from './lib/layout/fleet';
import type { PrintSetup } from './lib/layout/plan';
import { binPrintMarks } from './lib/printed';
import { usePrintJob } from './components/usePrintJob';
import { enclosureSceneItems, shiftItems, type LidView } from './components/enclosureScene';
import { stackPlaces } from './lib/stacking';
import { PhoneNav, usePhoneView } from './components/PhoneNav';
import { externalBox, importedSpec } from './lib/external';
import { hasImported, importedVersion, subscribeImported } from './lib/imported/registry';
import { useCoarsePointer } from './components/touch';
import './components/workflow.css';

// The first screen is the drawer panel, the bin grid and the 3D view; the rest loads on first use (components/lazy.tsx).
// index.html preloads the panel of the tab saved with the project (scripts/preload.ts).
const loadBinPanel = once(() => import('./components/BinPanel'));
const loadPrintPanel = once(() => import('./components/PrintPanel'));
const loadInterior = once(() => import('./components/BinInteriorEditor'));
const loadCutouts = once(() => import('./components/CutoutEditor'));
const BinPanel = lazyNamed(loadBinPanel, 'BinPanel');
const PrintPanel = lazyNamed(loadPrintPanel, 'PrintPanel');
const BinInteriorEditor = lazyNamed(loadInterior, 'BinInteriorEditor');
const CutoutEditor = lazyNamed(loadCutouts, 'CutoutEditor');

/** The other tabs and panes, loaded in the background once the first view is up (main.tsx), so switching to one is instant. */
export function prefetchTabs() {
  return prefetch(loadBinPanel, loadPrintPanel, loadInterior, loadCutouts);
}

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

function drawerScene(
  job: PrintJob,
  explode: boolean,
  withBins: boolean,
  state: ReturnType<typeof useStore.getState>,
  lidView: LidView = 'open',
): Scene {
  const gap = explode ? 14 : 0;
  // A carry case, wall grid or spacer strips (enclosures.ts): pieces start where their meshes do, plus the extra parts.
  const enc = job.drawers[0]?.enclosure;
  const items: SceneItem[] = job.plan.pieces.map((p) => {
    const part = job.parts[`piece:${p.id}`];
    const at = enc?.pieceAt[p.id] ?? [p.x0, p.y0, 0];
    return {
      id: part.key,
      meshKey: part.meshKey,
      x: at[0] + p.col * gap,
      y: at[1] + p.row * gap,
      z: at[2],
      w: part.w,
      d: part.d,
      h: part.h,
      color: withBins ? BASEPLATE_COLOR : pieceColor(p.id),
    };
  });
  if (withBins || enc?.showBins) {
    const seat = enc?.seat ?? binSeatHeight(state.baseplate);
    // Container parts that sit in their container (drawers in a drawer unit, …), by bin.
    const placedParts = new Map<string, JobPart[]>();
    for (const p of Object.values(job.parts)) if (p.bin && p.assembled) placedParts.set(p.bin, [...(placedParts.get(p.bin) ?? []), p]);
    // Stacked bins stand in the lip of the bin below; Lift spreads the levels apart (stacking.ts).
    const stacked = stackPlaces(job.layout, state.bins);
    for (const b of state.bins) {
      // Bins from elsewhere (external.ts): the imported mesh once it's in memory, else a see-through box in the bin's colour.
      if (b.external) {
        const box = externalBox(job.layout, b);
        const view = importedSpec(b, true);
        const shown = view && hasImported(view.hash) ? view.key : null;
        items.push({
          id: b.id,
          meshKey: shown ?? `ghost:${b.id}`,
          x: box.x,
          y: box.y,
          z: seat + (stacked.get(b.id)?.z ?? 0),
          w: box.w,
          d: box.d,
          h: box.h,
          color: b.external.color,
          ...(shown ? {} : { ghost: b.external.color }),
          selected: selectedIds(state.ui).includes(b.id),
          pickable: true,
          lift: (stacked.get(b.id)?.level ?? 0) + 1,
        });
        continue;
      }
      const part = job.parts[`bin:${b.id}`];
      if (!part) continue;
      // The mesh's front-left corner: its feet sit on the bin's cells, a stretched body reaches past them.
      const at = binOrigin(job.layout, b);
      const z0 = seat + (stacked.get(b.id)?.z ?? 0);
      const lift = (stacked.get(b.id)?.level ?? 0) + 1;
      items.push({
        id: b.id,
        meshKey: part.meshKey,
        x: at.x,
        y: at.y,
        z: z0,
        w: part.w,
        d: part.d,
        h: part.h,
        color: BIN_COLOR,
        selected: selectedIds(state.ui).includes(b.id),
        pickable: true,
        lift,
      });
      // A lid sits in the bin's lip (hidden while the bin is selected, so its inside stays visible).
      const lid = job.parts[`lid:${b.id}`];
      if (lid && !selectedIds(state.ui).includes(b.id)) {
        items.push({
          id: `${b.id}:lid`,
          meshKey: lid.meshKey,
          x: at.x,
          y: at.y,
          z: z0 + binBodyHeight(b.opts) - LID_SEAT_DROP,
          w: lid.w,
          d: lid.d,
          h: lid.h,
          color: LID_COLOR,
          lift,
        });
      }
      // Lift-out trays and a sliding lid sit in the bin the same way.
      if (!selectedIds(state.ui).includes(b.id)) {
        for (const a of assembledParts(job, b.id)) {
          items.push({
            id: `${b.id}:${a.key}`,
            meshKey: a.meshKey,
            x: at.x + a.assembled.x,
            y: at.y + a.assembled.y,
            z: z0 + a.assembled.z,
            w: a.w,
            d: a.d,
            h: a.h,
            color: LID_COLOR,
            lift,
          });
        }
      }
      for (const p of placedParts.get(b.id) ?? []) {
        items.push({
          id: `${b.id}:${p.key}`,
          meshKey: p.meshKey,
          x: at.x + p.assembled!.x,
          y: at.y + p.assembled!.y,
          z: z0 + p.assembled!.z,
          w: p.w,
          d: p.d,
          h: p.h,
          color: p.kind === 'lid' ? LID_COLOR : BIN_COLOR,
          lift,
        });
      }
      // Swappable label plates, pressed into their tabs.
      for (let i = 0; job.parts[`label:${b.id}:${i}`]; i++) {
        const pl = job.parts[`label:${b.id}:${i}`];
        if (!pl.assembled) continue;
        items.push({
          id: `${b.id}:${pl.key}`,
          meshKey: pl.meshKey,
          x: at.x + pl.assembled.x,
          y: at.y + pl.assembled.y,
          z: z0 + pl.assembled.z,
          w: pl.w,
          d: pl.d,
          h: pl.h,
          color: LABEL_PLATE_COLOR,
          lift,
        });
      }
    }
  }
  if (enc) items.push(...enclosureSceneItems(enc, withBins ? 'off' : lidView, gap));
  return {
    items: shiftItems(items, enc?.shift),
    outline: state.drawer.mode === 'drawer' && enc?.outline !== false ? { w: state.drawer.width, d: state.drawer.depth } : undefined,
    // The camera stays put when the lid opens or closes.
    fitKey: `drawer-${job.layout.plateW}-${job.layout.plateD}-${explode}${enc ? `-${enc.kind}` : ''}`,
  };
}

function platesScene(job: PrintJob, plate: number, setup: PrintSetup): Scene {
  const items: SceneItem[] = [];
  const beds: SceneBed[] = [];
  const show = plate >= 0 && plate < job.plates.length ? [plate] : job.plates.map((_, i) => i);
  // Each plate on its own printer's bed (fleet.ts), laid out for the biggest.
  const printers = jobPrinters(setup);
  const bedW = Math.max(...printers.map((p) => p.bedW));
  const bedD = Math.max(...printers.map((p) => p.bedD));
  show.forEach((pi) => {
    const [ox, oy] = show.length === 1 ? [0, 0] : plateOrigin(pi, job.plates.length, bedW, bedD);
    const pl = job.plates[pi];
    const pr = printers[pl.printer ?? 0] ?? printers[0];
    const on = job.printers ? ` · ${job.printers[pl.printer ?? 0]}` : '';
    beds.push({ x: ox, y: oy, w: pr.bedW, d: pr.bedD, label: `${pi + 1}  ${pl.name}${on}` });
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      items.push({
        id: `${pi}:${p.key}`,
        // A big imported mesh shows decimated (JobPart.preview).
        meshKey: part.preview ?? part.meshKey,
        x: ox + p.x,
        y: oy + p.y,
        z: 0,
        w: part.w,
        d: part.d,
        h: part.h,
        rotated: p.rotated,
        color: part.kind === 'piece' ? pieceColor(part.pieceId ?? 0) : part.kind === 'key' ? KEY_COLOR : part.kind === 'lid' ? LID_COLOR : BIN_COLOR,
      });
    }
  });
  return { items, beds, fitKey: `plates-${show.join(',')}-${job.plates.length}-${bedW}x${bedD}` };
}

export default function App() {
  const state = useStore();
  const { ui } = state;
  const interiorBin = useInteriorPane();
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
  // The print tab can cover several drawers, printers, and only what's changed.
  const printJob = usePrintJob(state, job);
  // Printed (or changed since) bins, for the grid editor.
  const printMarks = useMemo(() => binPrintMarks(asDrawer(viewJob, state.activeDrawerId), state.printed), [viewJob, state.activeDrawerId, state.printed]);

  // Carry case: lid closed, open or off in the drawer view.
  const [lidView, setLidView] = useState<LidView>('open');
  // Imported meshes coming in (from IndexedDB or a project file) replace their boxes.
  const meshesIn = useSyncExternalStore(subscribeImported, importedVersion);
  const scene = useMemo<Scene>(() => {
    if (ui.tab === 'print') return platesScene(printJob, ui.plate, state.setup);
    return drawerScene(viewJob, ui.tab === 'drawer' && ui.explode, ui.tab === 'bins', state, lidView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob, viewJob, ui.tab, ui.plate, ui.explode, ui.selectedBinId, ui.selectedBinIds, state.setup, lidView, meshesIn]);

  // Ask the worker for exactly the meshes on screen (selected bin first).
  useEffect(() => {
    const seen = new Set<string>();
    const specs: MeshSpec[] = [];
    const ordered = [...scene.items].sort((a, b) => Number(!!b.selected) - Number(!!a.selected));
    for (const it of ordered) {
      if (seen.has(it.meshKey)) continue;
      seen.add(it.meshKey);
      const spec = viewJob.meshes[it.meshKey] ?? printJob.meshes[it.meshKey];
      if (spec) specs.push(spec);
    }
    geometry.want(specs);
  }, [scene, printJob, viewJob]);

  useOpenSharedProject();
  const selection = useSelectedIds();
  const checkMarks = useBinCheckMarks(job.layout, state.bins);

  // Delete / Backspace removes the selected bins (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Handled already (e.g. by the compartment editor, which owns Delete/Escape while it's open).
      if (e.defaultPrevented || t.closest('input, textarea, select, [contenteditable]')) return;
      const s = useStore.getState();
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.ui.selectedBinId && s.ui.tab === 'bins') {
        removeSelection();
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
  const coarse = useCoarsePointer();
  const phone3d = usePhoneView((s) => s.view3d);

  // Its own boundary, so a 3D problem never blanks the panels and editors.
  const viewer = (
    <ErrorBoundary scope="The 3D view" compact>
      <Viewer
        items={scene.items}
        beds={scene.beds}
        outline={scene.outline}
        fitKey={focusing ? `focus-${ui.selectedBinId}-${scene.fitKey}` : scene.fitKey}
        fitIds={focusing ? [ui.selectedBinId!] : undefined}
        onPick={ui.tab === 'bins' ? (id) => state.setUI({ selectedBinId: id }) : undefined}
        hint={
          coarse
            ? `Drag to orbit · pinch to zoom · drag with two fingers to pan${ui.tab === 'bins' ? ' · tap a bin to select it' : ''}`
            : `Drag to orbit (all the way under) · right-drag to pan · scroll to zoom${ui.tab === 'bins' ? ' · click a bin to select' : ''} · C section · M measure · X x-ray${ui.tab === 'bins' ? ' · L lift' : ''}`
        }
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
            {viewJob.drawers[0]?.enclosure?.kind === 'case' &&
              (['closed', 'open', 'off'] as const).map((v) => (
                <button key={v} className={lidView === v ? 'active' : ''} onClick={() => setLidView(v)}>
                  {v === 'closed' ? 'Lid closed' : v === 'open' ? 'Lid open' : 'No lid'}
                </button>
              ))}
          </div>
        )}
      </Viewer>
    </ErrorBoundary>
  );

  return (
    <div className={`app${phone3d ? ' phone-3d' : ''}`}>
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
        <DrawerSwitcher />
        <nav className="tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.id} role="tab" aria-selected={ui.tab === t.id} className={ui.tab === t.id ? 'active' : ''} onClick={() => state.setUI({ tab: t.id })}>
              <span className="tab-num">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-status">
          <FindBox />
          <HistoryButtons />
          {queue > 0 && (
            <span className="building">
              <span className="spinner" /> Building {queue}
            </span>
          )}
          <Segmented
            value={ui.units}
            options={[
              { value: 'mm', label: 'mm', title: 'Show and enter lengths in millimetres' },
              { value: 'in', label: 'in', title: 'Show and enter lengths in inches (fractions work: 20 1/8)' },
            ]}
            onChange={(units) => state.setUI({ units })}
          />
          <span className="chip" title={state.setup.printers ? 'Printers' : 'Printer'}>
            {state.setup.printers ? printerNames(state.setup).map(shortName).join(' + ') : `${printer.name} · ${state.setup.bedW}×${state.setup.bedD}`}
          </span>
          <span className="chip">
            {job.layout.halfGrid ? `${job.layout.nx / 2}×${job.layout.ny / 2} u half grid` : `${job.layout.nx}×${job.layout.ny} grid`} · {job.plan.pieces.length} pieces ·{' '}
            {printJob.plates.length} plates
          </span>
          <ShortcutsHelp />
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          {ui.tab === 'drawer' && <DrawerPanel job={job} />}
          {ui.tab === 'bins' && (
            <LazyPart scope="The Bins panel">
              <BinPanel job={viewJob} />
            </LazyPart>
          )}
          {ui.tab === 'print' && (
            <LazyPart scope="The Print panel">
              <PrintPanel job={printJob} />
            </LazyPart>
          )}
        </aside>
        <main className={`main main-${ui.tab}`}>
          {ui.tab === 'bins' ? (
            <div className="split">
              <div className="pane pane-2d">
                <BinPaneHeader />
                {ui.binPane === 'cutouts' ? (
                  <LazyPart scope="The tool cutouts editor">
                    <CutoutEditor job={job} />
                  </LazyPart>
                ) : interiorBin ? (
                  <LazyPart scope="The compartment editor">
                    <BinInteriorEditor binId={interiorBin} grid={job.layout} />
                  </LazyPart>
                ) : (
                  <BinGridEditor
                    layout={job.layout}
                    bins={state.bins}
                    selectedIds={selection}
                    onSelect={selectBins}
                    onCreate={(r) => state.addBin(r.x, r.y, r.w, r.d)}
                    onMoveBins={moveBins}
                    onResize={resizeBin}
                    bed={usableBeds(state.setup)}
                    newBin={state.newBin}
                    marks={checkMarks}
                    printed={printMarks}
                  />
                )}
              </div>
              <div className="pane pane-3d">{viewer}</div>
            </div>
          ) : (
            viewer
          )}
          {viewJob.warnings.length > 0 && ui.tab !== 'print' && (
            <div className="toast">{viewJob.warnings[0]}</div>
          )}
        </main>
      </div>
      <PhoneNav />
    </div>
  );
}
