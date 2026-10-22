import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from '../lib/geometry/kernel';
import { planJob, planPrint, type MeshSpec, type PrintJob } from '../lib/project';
import { kindsVersion, loadKinds, subscribeKinds } from '../lib/wall';
import { importedVersion, subscribeImported } from '../lib/imported/registry';
import { lengthFieldText, parseLength } from '../lib/units';
import {
  DEFAULT_WALL,
  OBSTACLES,
  autoPlace,
  footprint,
  freeArea,
  newObstacle,
  oneTile,
  snapRect,
  wallDrawers,
  wallKind,
  wallWarnings,
  type Rect,
  type Snapped,
  type WallBox,
  type WallKind,
} from '../lib/wallPlanner/layout';
import type { WallObstacle } from '../lib/wallPlanner/data';
import { allDrawers, useStore, useUnits, type DrawerDoc, type Store } from '../state/store';
import {
  addBoardHere,
  addObstacle,
  boardSettings,
  closeWallView,
  openDrawer,
  placeAllOnWall,
  placeOnWall,
  printWall,
  removeFromWall,
  removeObstacle,
  setWall,
  updateObstacle,
} from '../state/wallPlanner';
import { GRID_BOARD_NAMES, isGridBoard } from '../lib/gridBoards';
import { geometry } from '../worker/client';
import { Viewer, type SceneBed, type SceneItem } from './Viewer';
import { LengthInput, Section } from './fields';
import { isMod, isTyping, keyLetter } from './shortcuts';
import { isTouch, useCoarsePointer } from './touch';
import { doubleTapper } from './gestures';
import './wall.css';
import './wallPlanner.css';

/** A board or wall grid of the project, planned: what the wall planner draws and places. */
interface Planned {
  doc: DrawerDoc;
  kind: WallKind;
  job: PrintJob;
  w: number;
  h: number;
}

type Sel = { item: string } | { obstacle: number } | null;

/** A drag on the wall: a board, something in the way, or an area being drawn on an empty part. */
type Drag =
  | { kind: 'item' | 'obstacle'; key: string; i: number; start: Vec2; from: Vec2; size: Vec2; at: Vec2; guides: Snapped['guides']; moved: boolean }
  | { kind: 'area'; start: Vec2; at: Vec2; moved: boolean };

/** App.tsx's drawer view of a planned drawer: each board on the wall is drawn with it. */
export type DrawerScene = (job: PrintJob, explode: boolean, withBins: boolean, state: Store, lidView: 'off') => { items: SceneItem[] };

/** Drag and drop from the list of boards not on the wall yet. */
const DND = 'application/x-gridfit-drawer';
const KIND_NAME: Record<WallKind, string> = { board: 'Skådis board', grid: 'Wall grid' };
/** What a board on the list is: its kind's name (another system's board by its own). */
const kindName = (p: { kind: WallKind; doc: DrawerDoc }) =>
  isGridBoard(p.doc.drawer.enclosure) ? GRID_BOARD_NAMES[p.doc.drawer.enclosure] : KIND_NAME[p.kind];
const OBSTACLE_COLOUR = '#f0616a';

/**
 * The wall planner, in place of the drawer's tabs (drawer menu → Wall planner):
 * one wall measured for the whole project (Store.wall, lib/wallPlanner), with
 * what's in the way on it, and the project's Skådis boards and wall grids
 * arranged on it at their real sizes. The front view draws each board with its
 * tiles, slots and attachments (a wall grid with its cells and bins); boards
 * drag into place, snapping to the wall's edges and to each other's (a chosen
 * gap apart); the ones not on it yet drag in from the list. Click an empty spot
 * to add a board there. The 3D view shows them all face up, as the drawer view
 * does, and everything on the wall prints from the Print tab at once.
 */
export function WallPlanner({ drawerScene }: { drawerScene: DrawerScene }) {
  const state = useStore();
  const wall = state.wall ?? DEFAULT_WALL;
  const { fmt, units, precision } = useUnits();
  const kinds = useSyncExternalStore(subscribeKinds, kindsVersion);
  const meshesIn = useSyncExternalStore(subscribeImported, importedVersion);
  const docs = useMemo(() => allDrawers(state), [state.drawers, state.activeDrawerId, state.drawer, state.baseplate, state.bins]);
  const planned = useMemo<Planned[]>(
    () =>
      docs.flatMap((doc) => {
        const kind = wallKind(doc.drawer);
        if (!kind) return [];
        const job = planJob({ drawer: doc.drawer, baseplate: doc.baseplate, bins: doc.bins, setup: state.setup, include: { baseplate: true, bins: true } });
        return [{ doc, kind, job, ...footprint(job) }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs, state.setup, kinds],
  );
  // A board's attachments plan once their kinds are in (lib/wall/ready.ts).
  const anyBoard = planned.some((p) => p.kind === 'board');
  useEffect(() => {
    if (anyBoard) void loadKinds();
  }, [anyBoard]);
  const byId = useMemo(() => new Map(planned.map((p) => [p.doc.id, p])), [planned]);
  const onWall = useMemo(() => wall.items.flatMap((i) => (byId.has(i.drawerId) ? [{ ...byId.get(i.drawerId)!, x: i.x, y: i.y }] : [])), [wall.items, byId]);
  const offWall = planned.filter((p) => !wall.items.some((i) => i.drawerId === p.doc.id));
  const boxes = useMemo<WallBox[]>(() => onWall.map((p) => ({ id: p.doc.id, name: p.doc.name, x: p.x, y: p.y, w: p.w, h: p.h })), [onWall]);
  const warnings = useMemo(() => wallWarnings(wall, boxes), [wall, boxes]);
  const bad = new Set(warnings.flatMap((w) => w.ids));

  const [sel, setSel] = useState<Sel>(null);
  const [area, setArea] = useState<Rect | null>(null);
  const selItem = sel && 'item' in sel ? (onWall.find((p) => p.doc.id === sel.item) ?? null) : null;

  // Going to a drawer (the drawer menu, Find, undoing past a switch) or a tab leaves the planner.
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (s.activeDrawerId !== p.activeDrawerId || s.ui.tab !== p.ui.tab) closeWallView();
      }),
    [],
  );

  // Keys: Delete takes the selected board off the wall (or removes what's in the way), the arrows move it 10 mm
  // (Shift: 100 mm), Escape lets go. The drawer's editors behind the planner never see these.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.modal-backdrop')) return;
      const arrows: Record<string, Vec2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const del = e.key === 'Delete' || e.key === 'Backspace';
      if (del || arrows[e.key] || (isMod(e) && 'acvxd'.includes(keyLetter(e)))) e.stopPropagation();
      if (e.key === 'Escape') {
        setSel(null);
        setArea(null);
        return;
      }
      if (!sel || e.altKey || isMod(e)) return;
      if (del) {
        if ('item' in sel) removeFromWall(sel.item);
        else removeObstacle(sel.obstacle);
        setSel(null);
        e.preventDefault();
        return;
      }
      const d = arrows[e.key];
      if (!d) return;
      const step = e.shiftKey ? 100 : 10;
      e.preventDefault();
      if ('item' in sel) {
        const it = wall.items.find((i) => i.drawerId === sel.item);
        if (it) placeOnWall(it.drawerId, it.x + d[0] * step, it.y + d[1] * step);
      } else {
        const o = wall.obstacles[sel.obstacle];
        if (o) updateObstacle(sel.obstacle, { x: o.x + d[0] * step, y: o.y + d[1] * step });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /** Put a board on the wall at the first free place from the top left (the top left when there's none). */
  const placeFree = (list: Planned[]) => {
    const blocks: Rect[] = [...boxes, ...wall.obstacles];
    const out: { drawerId: string; x: number; y: number }[] = [];
    for (const p of list) {
      const at = autoPlace(wall, blocks, p.w, p.h, wall.gap) ?? { x: 0, y: Math.max(0, wall.height - p.h) };
      out.push({ drawerId: p.doc.id, ...at });
      blocks.push({ ...at, w: p.w, h: p.h });
    }
    placeAllOnWall(out);
    if (out.length === 1) setSel({ item: out[0].drawerId });
  };

  // Everything on the wall, for the Print tab (planned again only when what's on it changes, not where).
  const onIds = wall.items.map((i) => i.drawerId).join();
  const printDocs = useMemo(
    () => wallDrawers(wall, docs).filter((d) => byId.has(d.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onIds, docs, byId],
  );
  const printPlates = useMemo(
    () => (printDocs.length ? planPrint(printDocs, state.setup, state.include).plates.length : 0),
    [printDocs, state.setup, state.include],
  );

  // The 3D view: each board's drawer view where it hangs, face up; what's in the way as see-through boxes.
  const scene = useMemo(() => {
    const items: SceneItem[] = [];
    const specs = new Map<string, MeshSpec>();
    const st = useStore.getState();
    const ui = { ...st.ui, selectedBinId: null, selectedBinIds: [], selectedAttachment: null, wallDrag: null };
    for (const p of onWall) {
      const s = drawerScene(p.job, false, true, { ...st, drawer: p.doc.drawer, baseplate: p.doc.baseplate, bins: p.doc.bins, ui }, 'off');
      const picked = selItem?.doc.id === p.doc.id;
      for (const it of s.items) {
        items.push({ ...it, id: `${p.doc.id}/${it.id}`, x: it.x + p.x, y: it.y + p.y, pickable: true, selected: picked && it.id.startsWith('piece:') });
        const spec = p.job.meshes[it.meshKey];
        if (spec) specs.set(it.meshKey, spec);
      }
    }
    wall.obstacles.forEach((o, i) =>
      items.push({
        id: `obstacle/${i}`,
        meshKey: 'ghost:obstacle',
        x: o.x,
        y: o.y,
        z: 0,
        w: o.w,
        d: o.h,
        h: 3,
        color: OBSTACLE_COLOUR,
        boxColor: OBSTACLE_COLOUR,
      }),
    );
    return { items, specs: [...specs.values()] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWall, wall.obstacles, selItem?.doc.id, meshesIn]);
  useEffect(() => geometry.want(scene.specs), [scene]);
  const beds = useMemo<SceneBed[]>(
    () => [
      {
        x: 0,
        y: 0,
        w: wall.width,
        d: wall.height,
        label: `Wall ${fmt(wall.width)} × ${fmt(wall.height)}`,
        exclude: wall.obstacles.map((o) => ({ x: o.x, y: o.y, w: o.w, d: o.h })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wall.width, wall.height, wall.obstacles, units],
  );

  const tile = useMemo(() => (area ? oneTile(area, state.setup, boardSettings()) : null), [area, state.setup]);
  const click = useCoarsePointer() ? 'Tap' : 'Click';

  return (
    <div className="wall-planner">
      <aside className="sidebar wp-side">
        <Section
          title="Wall planner"
          aside={
            <button className="small" onClick={closeWallView} title="Back to the drawer">
              Close
            </button>
          }
        >
          <p className="field-hint wp-intro">
            Measure the wall, mark what’s in the way, then drag the project’s boards and wall grids onto it. {click} an empty spot to add a board there.
          </p>
          <div className="row3">
            <LengthInput label="Width" value={wall.width} min={100} max={20000} onChange={(width) => setWall({ width })} />
            <LengthInput label="Height" value={wall.height} min={100} max={20000} onChange={(height) => setWall({ height })} />
            <LengthInput label="Gap" value={wall.gap} max={500} onChange={(gap) => setWall({ gap })} />
          </div>
          <div className="field-hint">Boards snap to the wall’s edges, to each other’s and to what’s in the way, the gap apart.</div>
        </Section>

        {warnings.length > 0 && (
          <Section title="Check">
            {warnings.map((w, i) => (
              <div key={i} className="field-error" role="status">
                {w.text}
              </div>
            ))}
          </Section>
        )}

        <Section title="In the way">
          <div className="wp-add-obstacle">
            {OBSTACLES.map((k) => (
              <button
                key={k.label}
                className="small"
                title={k.title}
                onClick={() => (addObstacle(newObstacle(wall, k)), setSel({ obstacle: wall.obstacles.length }))}
              >
                + {k.label}
              </button>
            ))}
          </div>
          {wall.obstacles.map((o, i) => (
            <ObstacleRow
              key={i}
              o={o}
              selected={!!sel && 'obstacle' in sel && sel.obstacle === i}
              onSelect={() => setSel({ obstacle: i })}
              onChange={(patch) => updateObstacle(i, patch)}
              onRemove={() => (removeObstacle(i), setSel(null))}
              units={units}
              precision={precision}
            />
          ))}
          {!wall.obstacles.length && <div className="field-hint">A window, a door, a socket or a light switch: boards over them are flagged.</div>}
        </Section>

        <Section title="On the wall">
          {!onWall.length && <div className="field-hint">Nothing yet: drag a board from the list below onto the wall, or click an empty spot to add one.</div>}
          <ul className="wp-list">
            {onWall.map((p) => (
              <li key={p.doc.id}>
                <button
                  className={`wp-row${selItem?.doc.id === p.doc.id ? ' active' : ''}${bad.has(p.doc.id) ? ' bad' : ''}`}
                  onClick={() => setSel({ item: p.doc.id })}
                  onDoubleClick={() => openDrawer(p.doc.id)}
                >
                  <span>{p.doc.name}</span>
                  <small>
                    {kindName(p)} · {fmt(p.w)} × {fmt(p.h)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {selItem && (
            <div className="wp-selected">
              <div className="row2">
                <LengthInput label="From the left" value={selItem.x} min={-20000} max={40000} onChange={(x) => placeOnWall(selItem.doc.id, x, selItem.y)} />
                <LengthInput
                  label="Up from the bottom"
                  value={selItem.y}
                  min={-20000}
                  max={40000}
                  onChange={(y) => placeOnWall(selItem.doc.id, selItem.x, y)}
                />
              </div>
              <div className="wp-actions">
                <button onClick={() => openDrawer(selItem.doc.id)} title={`Edit ${selItem.doc.name} (or double-click it on the wall)`}>
                  Open
                </button>
                <button onClick={() => (removeFromWall(selItem.doc.id), setSel(null))} title="Take it off this wall: the board stays in the project">
                  Take off the wall
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Not on the wall yet"
          aside={
            offWall.length > 1 ? (
              <button className="small" onClick={() => placeFree(offWall)} title="Put each where it fits, from the top left">
                Place all
              </button>
            ) : undefined
          }
        >
          {!planned.length && (
            <div className="field-hint">
              The project has no boards or wall grids yet. Click an empty spot on the wall to add one, or start one from the drawer menu.
            </div>
          )}
          {planned.length > 0 && !offWall.length && <div className="field-hint">Every board and wall grid is on the wall.</div>}
          <ul className="wp-list">
            {offWall.map((p) => (
              <li
                key={p.doc.id}
                className="wp-off"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND, p.doc.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                title="Drag it onto the wall"
              >
                <span className="wp-grip" aria-hidden>
                  ⋮⋮
                </span>
                <span className="wp-off-name">
                  {p.doc.name}
                  <small>
                    {kindName(p)} · {fmt(p.w)} × {fmt(p.h)}
                  </small>
                </span>
                <button className="small" onClick={() => placeFree([p])}>
                  Place
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Print">
          <button className="primary wide" disabled={!printDocs.length} onClick={() => printWall(printDocs.map((d) => d.id))}>
            Print everything on this wall
          </button>
          <div className="field-hint">
            {printDocs.length
              ? `${onWallText(onWall)}, ${count(printPlates, 'plate', 'plates')}: the Print tab opens with them chosen.`
              : 'Put boards on the wall to print them together.'}
          </div>
        </Section>
      </aside>

      <main className="main wp-main">
        <div className="split">
          <div className="pane pane-2d">
            <div className="pane-head">
              <div className="pane-title">The wall from the front: drag boards into place, {click.toLowerCase()} an empty spot to add one</div>
              <button className="wp-close-phone" onClick={closeWallView}>
                Close
              </button>
            </div>
            {area && (
              <div className="wp-area-bar" role="group" aria-label="Add a board here">
                <span>
                  Add here ({fmt(area.w)} × {fmt(area.h)}):
                </span>
                <button
                  className="primary small"
                  onClick={() => addBoardHere('board', area)}
                  title="A Skådis board filling this area, split into tiles for your printer"
                >
                  Skådis board
                </button>
                {tile && (
                  <button
                    className="small"
                    onClick={() => addBoardHere('board', { x: area.x, y: area.y + area.h - tile.h, w: tile.w, h: tile.h })}
                    title="The biggest Skådis board that prints in one piece, in this area's top left corner"
                  >
                    One tile {fmt(tile.w)} × {fmt(tile.h)}
                  </button>
                )}
                <button className="small" onClick={() => addBoardHere('grid', area)} title="A Gridfinity baseplate for the wall, filling this area">
                  Wall grid
                </button>
                <button className="small" onClick={() => setArea(null)}>
                  Cancel
                </button>
              </div>
            )}
            <WallFront
              planned={onWall}
              obstacles={wall.obstacles}
              width={wall.width}
              height={wall.height}
              gap={wall.gap}
              sel={sel}
              bad={bad}
              area={area}
              onSelect={(s) => {
                setSel(s);
                if (s) setArea(null);
              }}
              onArea={(a) => {
                setArea(a);
                if (a) setSel(null);
              }}
              onDropDrawer={(id, at) => {
                const p = byId.get(id);
                if (!p) return;
                const others = [...boxes.filter((b) => b.id !== id), ...wall.obstacles];
                const s = snapRect({ x: at[0] - p.w / 2, y: at[1] - p.h / 2, w: p.w, h: p.h }, wall, others, wall.gap, Math.max(wall.width, wall.height) / 80);
                placeOnWall(id, s.x, s.y);
                setSel({ item: id });
              }}
              fmt={fmt}
            />
          </div>
          <div className="pane pane-3d">
            <Viewer
              items={scene.items}
              beds={beds}
              fitKey={`wall-${wall.width}x${wall.height}`}
              onPick={(id) => setSel(id && !id.startsWith('obstacle/') ? { item: id.split('/')[0] } : null)}
              hint={
                click === 'Tap'
                  ? 'Drag to orbit · pinch to zoom · drag with two fingers to pan · tap a board to select it · Top: the wall from the front'
                  : 'Drag to orbit · right-drag to pan · scroll to zoom · click a board to select it · Top: the wall from the front'
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 boards and a wall grid". */
function onWallText(list: { kind: WallKind }[]): string {
  const boards = list.filter((p) => p.kind === 'board').length;
  const grids = list.length - boards;
  return [boards && count(boards, 'board', 'boards'), grids && (grids === 1 ? 'a wall grid' : `${grids} wall grids`)].filter(Boolean).join(' and ');
}

/** One thing in the way: its name, place and size (in the app's units), and a remove button. */
function ObstacleRow({
  o,
  selected,
  onSelect,
  onChange,
  onRemove,
  units,
  precision,
}: {
  o: WallObstacle;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<WallObstacle>) => void;
  onRemove: () => void;
  units: ReturnType<typeof useUnits>['units'];
  precision: ReturnType<typeof useUnits>['precision'];
}) {
  return (
    <div className={`wp-obstacle${selected ? ' active' : ''}`} onFocusCapture={onSelect} onPointerDown={onSelect}>
      <div className="wp-obstacle-head">
        <Mini label="Name" text={o.label} onCommit={(t) => onChange({ label: t.trim() || o.label })} wide />
        <button className="small danger" onClick={onRemove} aria-label={`Remove ${o.label}`} title="Remove">
          ×
        </button>
      </div>
      <div className="wp-obstacle-grid">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <Mini
            key={k}
            label={{ x: 'From the left', y: 'Up', w: 'Width', h: 'Height' }[k]}
            text={lengthFieldText(o[k], units, precision)}
            onCommit={(t) => {
              const v = parseLength(t, units);
              if (v !== null && (k === 'x' || k === 'y' || v > 0)) onChange({ [k]: Math.round(v * 10) / 10 });
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** A small text field that commits on blur or Enter (an obstacle's name and numbers). */
function Mini({ label, text, onCommit, wide }: { label: string; text: string; onCommit: (t: string) => void; wide?: boolean }) {
  const id = useId();
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return (
    <label className={`wp-mini${wide ? ' wide' : ''}`} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== text && onCommit(v)}
        onKeyDown={(e) => e.key === 'Enter' && onCommit(v)}
      />
    </label>
  );
}

/**
 * The wall from the front (y up, drawn flipped): its 100 mm grid, what's in the way hatched, each board with its
 * tiles, slots and attachments (a wall grid with its cells and bins). Boards and obstacles drag (snapping); a click
 * on an empty spot picks the empty area round it, a drag there draws one; boards from the list drop on it.
 */
function WallFront({
  planned,
  obstacles,
  width: W,
  height: H,
  gap,
  sel,
  bad,
  area,
  onSelect,
  onArea,
  onDropDrawer,
  fmt,
}: {
  planned: (Planned & { x: number; y: number })[];
  obstacles: WallObstacle[];
  width: number;
  height: number;
  gap: number;
  sel: Sel;
  bad: ReadonlySet<string>;
  area: Rect | null;
  onSelect: (s: Sel) => void;
  onArea: (r: Rect | null) => void;
  onDropDrawer: (id: string, at: Vec2) => void;
  fmt: (mm: number) => string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The finger (or mouse) a drag is with: a second finger calls it off. Double taps open a board, as double-clicks do.
  const finger = useRef<number | null>(null);
  const [taps] = useState(doubleTapper);
  const uid = useId().replace(/:/g, '');
  const big = Math.max(W, H);
  const M = big * 0.05;
  // Board y is up; the screen's is down.
  const sy = (y: number) => H - y;

  /** A pointer event in wall millimetres, and how many of them a screen pixel is. */
  const toWall = (e: { clientX: number; clientY: number }): { at: Vec2; px: number } => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = el.getScreenCTM()!;
    const p = pt.matrixTransform(ctm.inverse());
    return { at: [p.x, H - p.y], px: 1 / (ctm.a || 1) };
  };

  const blocks = (skip?: string): Rect[] => [
    ...planned.filter((p) => p.doc.id !== skip).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ...obstacles.filter((_, i) => `o${i}` !== skip),
  ];

  /** A second finger: the drag under way is called off. */
  const second = (e: ReactPointerEvent) => {
    if (finger.current === null || e.pointerId === finger.current) return false;
    finger.current = null;
    setDrag(null);
    return true;
  };
  const startMove = (e: ReactPointerEvent, kind: 'item' | 'obstacle', key: string, i: number, r: Rect) => {
    e.stopPropagation();
    if (second(e) || e.button !== 0) return;
    onSelect(kind === 'item' ? { item: key } : { obstacle: i });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    finger.current = e.pointerId;
    taps.down(e);
    const { at } = toWall(e);
    setDrag({ kind, key, i, start: at, from: [r.x, r.y], size: [r.w, r.h], at: [r.x, r.y], guides: {}, moved: false });
  };
  const onDown = (e: ReactPointerEvent) => {
    if (second(e) || e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    finger.current = e.pointerId;
    const { at } = toWall(e);
    setDrag({ kind: 'area', start: at, at, moved: false });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag || (finger.current !== null && e.pointerId !== finger.current)) return;
    const { at, px } = toWall(e);
    const moved = drag.moved || Math.hypot(at[0] - drag.start[0], at[1] - drag.start[1]) > 4 * px;
    if (drag.kind === 'area') {
      setDrag({ ...drag, at, moved });
      return;
    }
    const r = { x: drag.from[0] + at[0] - drag.start[0], y: drag.from[1] + at[1] - drag.start[1], w: drag.size[0], h: drag.size[1] };
    const s = snapRect(r, { width: W, height: H }, blocks(drag.kind === 'item' ? drag.key : `o${drag.i}`), gap, 10 * px);
    if (moved !== drag.moved || s.x !== drag.at[0] || s.y !== drag.at[1]) setDrag({ ...drag, at: [s.x, s.y], guides: s.guides, moved });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (finger.current !== null && e.pointerId !== finger.current) return;
    finger.current = null;
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'item') {
      const twice = isTouch(e) && taps.up(e, d.key);
      if (d.moved) placeOnWall(d.key, d.at[0], d.at[1]);
      else if (twice) openDrawer(d.key);
      return;
    }
    if (d.kind === 'obstacle') {
      if (d.moved) updateObstacle(d.i, { x: d.at[0], y: d.at[1] });
      return;
    }
    // A click: the empty area round it; a drag: the rectangle drawn, on the wall, to 5 mm.
    if (!d.moved) {
      onArea(freeArea({ width: W, height: H }, blocks(), d.start[0], d.start[1], gap));
      return;
    }
    const c = (v: number, hi: number) => Math.round(Math.min(hi, Math.max(0, v)) / 5) * 5;
    const x0 = c(Math.min(d.start[0], d.at[0]), W);
    const x1 = c(Math.max(d.start[0], d.at[0]), W);
    const y0 = c(Math.min(d.start[1], d.at[1]), H);
    const y1 = c(Math.max(d.start[1], d.at[1]), H);
    onArea(x1 - x0 >= 60 && y1 - y0 >= 60 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DND)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DND);
    if (!id) return;
    e.preventDefault();
    onDropDrawer(id, toWall(e).at);
  };

  /** Where a board or obstacle is drawn: where it's being dragged to. */
  const at = <R extends Rect>(kind: 'item' | 'obstacle', key: string, r: R): R =>
    drag && drag.kind === kind && drag.key === key ? { ...r, x: drag.at[0], y: drag.at[1] } : r;
  const drawn =
    drag?.kind === 'area' && drag.moved
      ? {
          x: Math.min(drag.start[0], drag.at[0]),
          y: Math.min(drag.start[1], drag.at[1]),
          w: Math.abs(drag.at[0] - drag.start[0]),
          h: Math.abs(drag.at[1] - drag.start[1]),
        }
      : null;
  const hatch = big / 110;
  const font = big / 55;

  return (
    <div className="wp-front">
      <svg
        ref={svg}
        viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => ((finger.current = null), setDrag(null))}
        onPointerDown={() => (onSelect(null), onArea(null))}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="application"
        aria-label="The wall: drag boards to move them, click an empty spot to add a board there"
      >
        <defs>
          <pattern id={`${uid}-grid`} patternUnits="userSpaceOnUse" width={100} height={100} patternTransform={`translate(0 ${H % 100})`}>
            <path className="wp-grid-line" d="M100 0H0V100" />
          </pattern>
          <pattern id={`${uid}-hatch`} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
            <rect className="wp-hatch-bg" width={hatch} height={hatch} />
            <rect className="wp-hatch-line" width={hatch / 3} height={hatch} />
          </pattern>
        </defs>
        <rect className="wp-wall" x={0} y={0} width={W} height={H} onPointerDown={(e) => (e.stopPropagation(), onSelect(null), onDown(e))} />
        <rect className="wp-grid" x={0} y={0} width={W} height={H} fill={`url(#${uid}-grid)`} pointerEvents="none" />
        <text className="wp-dim" x={W / 2} y={H + M * 0.55} fontSize={font}>
          {fmt(W)}
        </text>
        <text className="wp-dim" x={-M * 0.55} y={H / 2} fontSize={font} transform={`rotate(-90 ${-M * 0.55} ${H / 2})`}>
          {fmt(H)}
        </text>
        {obstacles.map((raw, i) => {
          const o = at('obstacle', String(i), raw);
          const isSel = !!sel && 'obstacle' in sel && sel.obstacle === i;
          return (
            <g key={i} className={`wp-obstacle-shape${isSel ? ' selected' : ''}`} onPointerDown={(e) => startMove(e, 'obstacle', String(i), i, raw)}>
              <rect x={o.x} y={sy(o.y + o.h)} width={o.w} height={o.h} fill={`url(#${uid}-hatch)`} />
              <text x={o.x + o.w / 2} y={sy(o.y + o.h / 2)} fontSize={Math.min(font, o.w / 5, o.h / 2)}>
                {o.label}
              </text>
            </g>
          );
        })}
        {planned.map((p) => {
          const r = at('item', p.doc.id, p);
          const isSel = !!sel && 'item' in sel && sel.item === p.doc.id;
          return (
            <g
              key={p.doc.id}
              className={`wp-board${isSel ? ' selected' : ''}${bad.has(p.doc.id) ? ' bad' : ''}`}
              onPointerDown={(e) => startMove(e, 'item', p.doc.id, 0, p)}
              onDoubleClick={() => openDrawer(p.doc.id)}
            >
              <g transform={`translate(${r.x} ${sy(r.y)}) scale(1 -1)`}>
                <BoardShape p={p} />
              </g>
              <rect className="wp-outline" x={r.x} y={sy(r.y + r.h)} width={r.w} height={r.h} />
              <text x={r.x + r.w / 2} y={sy(r.y + r.h / 2)} fontSize={Math.max(font * 0.6, Math.min(font, r.w / 9, r.h / 3))}>
                {p.doc.name}
              </text>
            </g>
          );
        })}
        {drag && drag.kind !== 'area' && (
          <>
            {drag.guides.x !== undefined && <line className="wp-guide" x1={drag.guides.x} x2={drag.guides.x} y1={-M} y2={H + M} />}
            {drag.guides.y !== undefined && <line className="wp-guide" x1={-M} x2={W + M} y1={sy(drag.guides.y)} y2={sy(drag.guides.y)} />}
          </>
        )}
        {(drawn ?? area) && (
          <rect
            className="wp-area"
            x={(drawn ?? area)!.x}
            y={sy((drawn ?? area)!.y + (drawn ?? area)!.h)}
            width={(drawn ?? area)!.w}
            height={(drawn ?? area)!.h}
          />
        )}
      </svg>
    </div>
  );
}

/** A board in its own frame (y up): a Skådis board's tiles, slots and attachments; a wall grid's plate, pieces, cells and bins. */
const BoardShape = memo(function BoardShape({ p }: { p: Planned }) {
  const wb = p.job.drawers[0]?.enclosure?.wall;
  const slots = useMemo(() => {
    if (!wb) return '';
    const r = wb.board.ctx.slotW / 2;
    const l = wb.board.ctx.slotL - 2 * r;
    return wb.board.slots.map(([x, y]) => `M${x - r},${y - l / 2}v${l}a${r},${r} 0 0 0 ${2 * r},0v${-l}a${r},${r} 0 0 0 ${-2 * r},0z`).join('');
  }, [wb]);
  if (wb) {
    return (
      <>
        {wb.board.outlines.map((o, i) => (
          <polygon key={i} className="we-tile" points={o.map(([x, y]) => `${x},${y}`).join(' ')} />
        ))}
        <path className="we-slots wp-slots" d={slots} />
        {wb.placed.map((a) => (
          <rect key={a.id} className="wp-att" x={a.x0} y={a.y0} width={a.x1 - a.x0} height={a.y1 - a.y0} rx={2} />
        ))}
      </>
    );
  }
  const enc = p.job.drawers[0]?.enclosure;
  if (p.kind === 'board' && enc?.box) {
    // An openGrid or Multiboard board: its outline and its tiles' seams.
    const b = enc.box;
    return (
      <>
        <rect className="we-tile" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />
        {p.job.plan.pieces.length > 1 &&
          p.job.plan.pieces.map((pc) => <rect key={pc.id} className="wp-piece" x={pc.x0} y={pc.y0} width={pc.x1 - pc.x0} height={pc.y1 - pc.y0} />)}
      </>
    );
  }
  const L = p.job.layout;
  const xs = L.xs;
  const ys = L.ys;
  const cells = [...xs.map((x) => `M${x},${ys[0]}V${ys[ys.length - 1]}`), ...ys.map((y) => `M${xs[0]},${y}H${xs[xs.length - 1]}`)].join('');
  const edge = (v: number[], i: number) => v[Math.max(0, Math.min(v.length - 1, i))];
  return (
    <>
      <rect className="we-tile" x={0} y={0} width={L.plateW} height={L.plateD} />
      <path className="wp-cells" d={cells} />
      {p.job.plan.pieces.length > 1 &&
        p.job.plan.pieces.map((pc) => <rect key={pc.id} className="wp-piece" x={pc.x0} y={pc.y0} width={pc.x1 - pc.x0} height={pc.y1 - pc.y0} />)}
      {p.doc.bins.map((b) => {
        const x0 = edge(xs, b.x);
        const y0 = edge(ys, b.y);
        return (
          <rect
            key={b.id}
            className="wp-att"
            x={x0 + 0.5}
            y={y0 + 0.5}
            width={edge(xs, b.x + b.opts.unitsX) - x0 - 1}
            height={edge(ys, b.y + b.opts.unitsY) - y0 - 1}
            rx={3}
          />
        );
      })}
    </>
  );
});
