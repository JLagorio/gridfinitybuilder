import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import type { Pt, RGBAImage } from '../lib/trace/image';
import type { WallPhoto as Photo, WallPlan } from '../lib/wallPlanner/data';
import type { Rect } from '../lib/wallPlanner/layout';
import {
  MAX_PHOTO_SIDE,
  PHOTO_PAPERS,
  centredAt,
  cleanPhoto,
  findSheet,
  findWall,
  goodQuad,
  insetCorners,
  mapPoint,
  newPhoto,
  photoDetail,
  photoRegion,
  rectCorners,
  refRect,
  sheetAcross,
  startCorners,
  wallToPhoto,
  warpPhoto,
} from '../lib/wallPlanner/photo';
import { cleanupPhotos, isPhotoMissing, keepPhoto, loadPhoto, photoBytes, photoHash, photosVersion, subscribePhotos } from '../lib/wallPlanner/photoStore';
import { currentPhoto, setPhotoView, setWallPhoto } from '../state/wallPhoto';
import { useUnits } from '../state/store';
import { LengthInput, Segmented, Slider, Toggle } from './fields';
import { isTouch, useCoarsePointer } from './touch';
import { fingerPx } from './gestures';
import { inOpenList } from './shortcuts';
import './wallPhoto.css';

/**
 * The wall planner's photo of the wall (lib/wallPlanner/photo.ts), loaded
 * with the first one: picking a photo (made small and stored,
 * lib/wallPlanner/photoStore.ts), lining it up in a dialog by four handles on
 * the wall's corners or on a sheet of paper on it, the photo resampled onto
 * the wall behind the boards (PhotoWarp: for the front view and the 3D view's
 * wall), and its section in the planner's side panel (PhotoPanel).
 */

/** A photo being lined up: the wall's (`photo`), or a new one not stored yet (`bytes`). */
export interface PhotoDraft {
  photo: Photo;
  img: RGBAImage;
  url: string;
  bytes?: Uint8Array;
}

/** The photo on the wall, ready to draw (WallPlanner.tsx): resampled over `rect` (mm), and as the 3D view's wall. */
export interface Warp {
  url: string;
  rect: Rect;
  opacity: number;
  hidden: boolean;
  /** The sheet can move (its photo drags into place). */
  movable: boolean;
  /** The wall's picture for the 3D view (SceneBed.image): the photo at its opacity over the wall, or null when hidden. */
  bed: { src: HTMLCanvasElement; key: string } | null;
}

const rgbaOf = (canvas: HTMLCanvasElement): RGBAImage => {
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  return { width: d.width, height: d.height, data: d.data };
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), type, quality));

/** Draw a picture (a file, stored bytes) on a canvas, at most `max` px on its long side. */
async function drawn(src: Blob, max: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  const c = canvas.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

const decoded = new Map<string, Promise<{ img: RGBAImage; url: string }>>();

/** A stored photo, decoded (once per visit). */
function decode(hash: string, bytes: Uint8Array) {
  let p = decoded.get(hash);
  if (!p) {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
    p = drawn(blob, MAX_PHOTO_SIDE).then((c) => ({ img: rgbaOf(c), url: URL.createObjectURL(blob) }));
    p.catch(() => decoded.delete(hash));
    decoded.set(hash, p);
  }
  return p;
}

/**
 * A picked file as a photo to line up: at most 2048 px on its long side, as a JPEG. The same photo again (picked for
 * one a share link left behind, or this browser hasn't got) starts lined up as it was; any other starts afresh.
 */
export async function draftFromFile(file: Blob, name: string, wall: WallPlan): Promise<PhotoDraft> {
  const canvas = await drawn(file, MAX_PHOTO_SIDE);
  const bytes = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer());
  const img = rgbaOf(canvas);
  const hash = photoHash(bytes);
  const was = cleanPhoto(wall.photo);
  const again = was && was.w === img.width && was.h === img.height && (was.hash === hash || !was.hash || !photoBytes(was.hash));
  const photo: Photo = again ? { ...was, hash, name: name || was.name, hidden: false } : newPhoto(hash, name, img, wall);
  return { photo, img, bytes, url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })) };
}

/** The wall's own photo, to line up again. Null when this browser hasn't got it. */
export async function draftOfWall(): Promise<PhotoDraft | null> {
  const photo = currentPhoto();
  const bytes = photo?.hash ? await loadPhoto(photo.hash) : null;
  if (!photo || !bytes) return null;
  const { img, url } = await decode(photo.hash, bytes);
  return { photo, img, url };
}

/** Move the sheet, and the photo with it, by (dx, dy) mm on the wall: one undo step. */
export function movePhotoBy(dx: number, dy: number) {
  const p = currentPhoto();
  if (p) setPhotoView({ at: [Math.round(p.at[0] + dx), Math.round(p.at[1] + dy)] });
}

// ---------------------------------------------------------------------------
// On the wall
// ---------------------------------------------------------------------------

/**
 * The wall's photo resampled onto it (renders nothing): over the wall and the margin the front view shows round it,
 * again when it's lined up differently or the wall's size changes; the 3D view's picture again when its opacity does.
 */
export function PhotoWarp({ photo: raw, wall, onWarp }: { photo: unknown; wall: Pick<WallPlan, 'width' | 'height'>; onWarp: (w: Warp | null) => void }) {
  const photo = useMemo(() => cleanPhoto(raw), [raw]);
  useSyncExternalStore(subscribePhotos, photosVersion);
  const hash = photo?.hash ?? '';
  const have = !!hash && !!photoBytes(hash);
  const geom = photo ? JSON.stringify([hash, photo.corners, photo.ref, photo.paper, photo.across, photo.at, wall.width, wall.height]) : '';
  const [warped, setWarped] = useState<{ canvas: HTMLCanvasElement; url: string; rect: Rect; key: string } | null>(null);

  useEffect(() => {
    if (hash) void loadPhoto(hash);
  }, [hash]);

  useEffect(() => {
    if (!photo || !have) return setWarped(null);
    let live = true;
    void (async () => {
      const { img } = await decode(hash, photoBytes(hash)!);
      // The front view's margin (WallPlanner.tsx WallFront): 5% of the wall's longer side.
      const M = Math.max(wall.width, wall.height) * 0.05;
      const region = live ? photoRegion(photo, wall, { x: -M, y: -M, w: wall.width + 2 * M, h: wall.height + 2 * M }) : null;
      if (!region) return live && setWarped(null);
      const w = warpPhoto(img, photo, wall, region);
      const canvas = document.createElement('canvas');
      canvas.width = w.image.width;
      canvas.height = w.image.height;
      canvas.getContext('2d')!.putImageData(new ImageData(w.image.data as Uint8ClampedArray<ArrayBuffer>, w.image.width, w.image.height), 0, 0);
      const url = URL.createObjectURL(await toBlob(canvas, 'image/png'));
      if (!live) return URL.revokeObjectURL(url);
      setWarped({ canvas, url, rect: w.rect, key: geom });
    })().catch((e) => {
      console.warn('[Gridfit] Wall photo:', e);
      if (live) setWarped(null);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, have]);
  useEffect(() => () => void (warped && URL.revokeObjectURL(warped.url)), [warped]);

  // The 3D view's wall (its bed draws it 512 px across): the photo over it at its opacity.
  const opacity = photo?.opacity ?? 1;
  const hidden = !!photo?.hidden;
  const bed = useMemo(() => {
    if (!warped || hidden) return null;
    const k = 1024 / Math.max(wall.width, wall.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(wall.width * k));
    c.height = Math.max(1, Math.round(wall.height * k));
    const g = c.getContext('2d')!;
    g.globalAlpha = opacity;
    const r = warped.rect;
    g.drawImage(warped.canvas, r.x * k, (wall.height - r.y - r.h) * k, r.w * k, r.h * k);
    return { src: c, key: `${warped.key}|${opacity}` };
  }, [warped, opacity, hidden, wall.width, wall.height]);

  const movable = photo?.ref === 'paper';
  useEffect(
    () => onWarp(warped ? { url: warped.url, rect: warped.rect, opacity, hidden, movable, bed } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warped, opacity, hidden, movable, bed],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onWarp(null), []);
  return null;
}

// ---------------------------------------------------------------------------
// The side panel's section
// ---------------------------------------------------------------------------

/**
 * The wall's photo in the planner's side panel: how it's lined up, its opacity, showing it, and lining it up again,
 * moving it (a sheet's), replacing or removing it. When it stayed behind (a share link) or this browser hasn't got it,
 * says so and offers to pick it again.
 */
export function PhotoPanel({
  wall,
  moving,
  setMoving,
  onDraft,
  onPick,
}: {
  wall: WallPlan;
  moving: boolean;
  setMoving: (on: boolean) => void;
  onDraft: (d: PhotoDraft) => void;
  /** Choose a file for it (the planner's file picker). */
  onPick: () => void;
}) {
  const { fmt } = useUnits();
  const photo = useMemo(() => cleanPhoto(wall.photo), [wall.photo]);
  useSyncExternalStore(subscribePhotos, photosVersion);
  const [busy, setBusy] = useState(false);
  // Photos no wall has used for a while are forgotten (lib/wallPlanner/photoStore.ts).
  const hash = photo?.hash ?? '';
  useEffect(() => {
    if (hash) void cleanupPhotos([hash]);
  }, [hash]);
  if (!photo)
    return (
      <button className="small" onClick={onPick}>
        Add a photo…
      </button>
    );
  const have = !!hash && !!photoBytes(hash);
  const paper = PHOTO_PAPERS[photo.paper];
  const how =
    photo.ref === 'wall'
      ? 'Lined up by the wall’s corners.'
      : `Lined up by ${photo.paper === 'a4' ? 'an' : 'a'} ${paper.label} sheet ${photo.across ? 'across' : 'upright'}, its bottom-left corner ${fmt(photo.at[0])} from the left and ${fmt(photo.at[1])} up.`;

  if (!have) {
    const left = !hash;
    return (
      <div className="wph-panel">
        <div className="field-hint wph-missing" role="status">
          {left
            ? 'The photo of this wall stayed behind: share links don’t carry photos. Pick it again and it lines up as it was.'
            : isPhotoMissing(hash)
              ? 'This browser hasn’t got the photo of this wall. Open the project file it was saved in, or pick it again.'
              : 'Loading the photo…'}
        </div>
        <div className="wph-actions">
          <button className="small" onClick={onPick}>
            {left ? 'Pick the photo' : 'Pick it again'}
          </button>
          <button className="small" onClick={() => setWallPhoto(undefined)} title="Plan without a photo">
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wph-panel">
      <div className="wph-name">
        <span title={photo.name}>{photo.name || 'Photo'}</span>
        <small>
          {photo.w} × {photo.h} px
        </small>
      </div>
      <div className="field-hint">{how}</div>
      <Toggle label="Show it behind the boards" checked={!photo.hidden} onChange={(on) => setPhotoView({ hidden: !on })} />
      {!photo.hidden && (
        <Slider
          label="Opacity"
          value={photo.opacity}
          min={0.1}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => setPhotoView({ opacity })}
        />
      )}
      <div className="wph-actions">
        <button
          className="small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void draftOfWall()
              .then((d) => d && onDraft(d))
              .finally(() => setBusy(false));
          }}
          title="Move the handles, or line it up by the wall or by a sheet of paper"
        >
          Line up again
        </button>
        {photo.ref === 'paper' && !photo.hidden && (
          <button
            className={`small${moving ? ' active' : ''}`}
            aria-pressed={moving}
            onClick={() => setMoving(!moving)}
            title="Drag the photo on the wall until it lines up with what you measured (Esc when done)"
          >
            {moving ? 'Done moving' : 'Move it'}
          </button>
        )}
        <button className="small" onClick={onPick} title="Another photo of the wall">
          Replace
        </button>
        <button className="small danger" onClick={() => setWallPhoto(undefined)}>
          Remove
        </button>
      </div>
      {moving && <div className="field-hint">Drag the photo on the wall to line it up: the boards and what’s in the way stay put.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lining it up
// ---------------------------------------------------------------------------

const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];
const pathD = (pts: readonly Pt[]) => (pts.length ? `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z` : '');

/** Pointer position in the SVG's user units. */
function svgPoint(svg: SVGSVGElement | null, e: { clientX: number; clientY: number }): Pt | null {
  const m = svg?.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}

/**
 * Lining a photo up with the wall: four handles (top left, top right, bottom right, bottom left) on the wall's own
 * corners or on a sheet of paper on it (A4 or Letter, upright or across, and where on the wall), placed where the wall
 * or the sheet was found to start with. The wall as measured, what's in the way on it and a half-metre grid are drawn
 * on the photo through the handles, to check by eye. Done puts it behind the plan as one undo step.
 */
export function PhotoCorners({ draft, wall, onClose }: { draft: PhotoDraft; wall: WallPlan; onClose: () => void }) {
  const { fmt } = useUnits();
  const [p, setP] = useState<Photo>(draft.photo);
  // Where each kind of handle was, to go back to on switching.
  const other = useRef<Partial<Record<Photo['ref'], Pt[]>>>({});
  const [note, setNote] = useState<string | null>(null);
  const { img } = draft;
  const ok = goodQuad(p.corners);
  const set = (patch: Partial<Photo>) => setP((q) => ({ ...q, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inOpenList(e.target)) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const find = (ref: Photo['ref']) => {
    const found = ref === 'paper' ? findSheet(img) : findWall(img);
    setNote(
      found
        ? null
        : ref === 'paper'
          ? 'No sheet of paper stands out: drag the handles onto its corners.'
          : 'The wall doesn’t stand out: drag the handles onto its corners.',
    );
    return found;
  };
  const switchRef = (ref: Photo['ref']) => {
    if (ref === p.ref) return;
    other.current[p.ref] = p.corners;
    const corners = other.current[ref] ?? find(ref) ?? startCorners(img, ref).corners;
    const next: Photo = { ...p, ref, corners, ...(ref === 'paper' && !other.current.paper ? { across: sheetAcross(corners) } : {}) };
    setP(ref === 'paper' && !other.current.paper ? { ...next, at: centredAt(next, wall) } : next);
  };

  const done = () => {
    const hash = draft.bytes ? keepPhoto(draft.bytes, p.name).hash : p.hash;
    setWallPhoto({ ...p, hash, hidden: false });
    onClose();
  };

  const detail = ok ? photoDetail(p, wall) : 0;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal trace-dialog" role="dialog" aria-modal="true" aria-label="Line up the photo of the wall">
        <header className="modal-head">
          <h2>Line up the photo of the wall</h2>
          <button className="link modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body trace-body">
          <CornerStage draft={draft} p={p} wall={wall} ok={ok} onCorners={(corners) => set({ corners })} />
          <aside className="trace-side">
            <h4>The handles go on</h4>
            <Segmented
              ariaLabel="The handles go on"
              value={p.ref}
              options={[
                { value: 'wall', label: 'The wall’s corners', title: `The wall as measured in the planner: ${fmt(wall.width)} × ${fmt(wall.height)}` },
                { value: 'paper', label: 'A sheet of paper', title: 'A sheet of A4 or Letter taped to the wall' },
              ]}
              onChange={switchRef}
            />
            {p.ref === 'wall' ? (
              <p className="muted small">
                Put a handle on each corner of the wall, {fmt(wall.width)} × {fmt(wall.height)} as measured in the planner. A corner out of the picture or
                behind something: drag its handle to where it would be.
              </p>
            ) : (
              <>
                <div className="row2">
                  <Segmented
                    ariaLabel="Paper size"
                    value={p.paper}
                    options={(['a4', 'letter'] as const).map((id) => ({ value: id, label: PHOTO_PAPERS[id].label }))}
                    onChange={(paper) => set({ paper })}
                  />
                  <Segmented
                    ariaLabel="Which way up"
                    value={p.across ? 'across' : 'upright'}
                    options={[
                      { value: 'upright', label: 'Upright', title: 'Its long side up and down' },
                      { value: 'across', label: 'Across', title: 'Its long side across' },
                    ]}
                    onChange={(v) => set({ across: v === 'across' })}
                  />
                </div>
                <p className="muted small">Put a handle on each corner of the sheet. Where is it on the wall? Its bottom-left corner:</p>
                <div className="row2">
                  <LengthInput label="From the left" value={p.at[0]} min={-20000} max={40000} onChange={(x) => set({ at: [x, p.at[1]] })} />
                  <LengthInput label="Up from the bottom" value={p.at[1]} min={-20000} max={40000} onChange={(y) => set({ at: [p.at[0], y] })} />
                </div>
                <p className="muted small">
                  Not measured? Leave it, and drag the photo on the wall to line it up with what’s in the way. A sheet is small: a pixel off at its corners
                  shows far from it, so put the handles exactly on them (the magnifier helps), or use the wall’s corners when they’re in the photo.
                </p>
              </>
            )}
            <div className="button-row">
              <button
                onClick={() => {
                  const found = find(p.ref);
                  if (found) set({ corners: found, ...(p.ref === 'paper' ? { across: sheetAcross(found) } : {}) });
                }}
              >
                {p.ref === 'paper' ? 'Find the sheet' : 'Find the wall'}
              </button>
              <button onClick={() => (set({ corners: insetCorners(img.width, img.height) }), setNote(null))}>Reset</button>
            </div>
            {note && <div className="field-hint">{note}</div>}
            {!ok && (
              <div className="field-error">
                The handles cross: top left, top right, bottom right and bottom left must go round the {p.ref === 'paper' ? 'sheet' : 'wall'} in that order.
              </div>
            )}
            {ok && (
              <div className="field-hint">
                About {fmt(1 / detail, { precision: 0 })} of wall a pixel{p.ref === 'paper' ? ' at the sheet' : ''}: the{' '}
                {p.ref === 'paper' ? 'sheet’s' : 'wall’s'} size gives the scale.
              </div>
            )}
            <div className="trace-spacer" />
            <div className="button-row">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!ok} onClick={done}>
                {draft.bytes ? 'Put it behind the plan' : 'Done'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** The photo with its four handles (they may go past its edges), the wall drawn on it through them, and a magnifier while dragging. */
function CornerStage({ draft, p, wall, ok, onCorners }: { draft: PhotoDraft; p: Photo; wall: WallPlan; ok: boolean; onCorners: (c: Pt[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ i: number; box: string } | null>(null);
  const [loupe, setLoupe] = useState<{ at: Pt; screen: Pt } | null>(null);
  const coarse = useCoarsePointer();
  const { width: W, height: H } = draft.img;
  // The photo with a margin, grown to take in handles past its edges; kept still while one is dragged.
  const m = Math.max(W, H) * 0.06;
  const xs = [0, W, ...p.corners.map((c) => c[0])];
  const ys = [0, H, ...p.corners.map((c) => c[1])];
  const box =
    drag?.box ?? `${Math.min(...xs) - m} ${Math.min(...ys) - m} ${Math.max(...xs) - Math.min(...xs) + 2 * m} ${Math.max(...ys) - Math.min(...ys) + 2 * m}`;
  const scale = svg.current?.getScreenCTM()?.a || 1;
  const r = Math.max(Math.max(W, H) / 90, coarse ? 12 / scale : 0);

  // The wall through the handles: its outline, a 500 mm grid, what's in the way.
  const overlay = useMemo(() => {
    if (!ok) return null;
    const Hm = wallToPhoto(p, wall);
    const ref = rectCorners(refRect(p, wall));
    const line = (a: Pt, b: Pt) => {
      const pa = mapPoint(Hm, a, ref);
      const pb = mapPoint(Hm, b, ref);
      return pa && pb ? `M${pa[0].toFixed(1)},${pa[1].toFixed(1)}L${pb[0].toFixed(1)},${pb[1].toFixed(1)}` : '';
    };
    const grid: string[] = [];
    for (let x = 500; x < wall.width; x += 500) grid.push(line([x, 0], [x, wall.height]));
    for (let y = 500; y < wall.height; y += 500) grid.push(line([0, y], [wall.width, y]));
    const quad = (rc: Rect) => {
      const q = rectCorners(rc).map((c) => mapPoint(Hm, c, ref));
      return q.every(Boolean) ? pathD(q as Pt[]) : '';
    };
    return { wall: quad({ x: 0, y: 0, w: wall.width, h: wall.height }), grid: grid.join(''), obstacles: wall.obstacles.map(quad) };
  }, [ok, p, wall]);

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    const pt = svgPoint(svg.current, e);
    if (!pt) return;
    const reach = Math.max(r * 2.2, isTouch(e) ? fingerPx(12, true) / scale : 0);
    let i = p.corners.findIndex((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]) < reach);
    if (i < 0) {
      // Anywhere else: the nearest handle comes here.
      i = 0;
      p.corners.forEach((c, k) => {
        if (Math.hypot(c[0] - pt[0], c[1] - pt[1]) < Math.hypot(p.corners[i][0] - pt[0], p.corners[i][1] - pt[1])) i = k;
      });
      onCorners(p.corners.map((c, k) => (k === i ? pt : c)));
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ i, box });
    setLoupe({ at: pt, screen: [e.clientX, e.clientY] });
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag || !e.isPrimary) return;
    const pt = svgPoint(svg.current, e);
    if (!pt) return;
    const c: Pt = [Math.min(2 * W, Math.max(-W, pt[0])), Math.min(2 * H, Math.max(-H, pt[1]))];
    onCorners(p.corners.map((q, k) => (k === drag.i ? c : q)));
    setLoupe({ at: c, screen: [e.clientX, e.clientY] });
  };
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    setDrag(null);
    setLoupe(null);
  };

  const LOUPE = 150;
  const zoomSpan = LOUPE / scale / 4;
  const stageBox = svg.current?.parentElement?.getBoundingClientRect();
  const mid = p.corners.reduce<Pt>((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4], [0, 0]);
  return (
    <div className="trace-stage">
      <svg
        ref={svg}
        viewBox={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        className={drag ? 'dragging' : ''}
        aria-label="The photo: drag the four handles onto the corners"
      >
        <image href={draft.url} x={0} y={0} width={W} height={H} />
        {overlay && (
          <g className="wph-overlay">
            <path d={overlay.grid} className="wph-grid" />
            {overlay.obstacles.map((d, i) => (
              <path key={i} d={d} className="wph-obstacle" />
            ))}
            <path d={overlay.wall} className="wph-wall" />
          </g>
        )}
        <path className={`trace-quad${ok ? '' : ' bad'}`} d={pathD(p.corners)} strokeWidth={r / 3} />
        {p.corners.map((c, i) => {
          // Each handle's name, outside the quad.
          const dx = c[0] - mid[0];
          const dy = c[1] - mid[1];
          const k = (r * 2.4) / (Math.hypot(dx, dy) || 1);
          return (
            <g key={i} className={`trace-handle${drag?.i === i ? ' active' : ''}`}>
              <circle cx={c[0]} cy={c[1]} r={r} strokeWidth={r / 4} />
              <circle cx={c[0]} cy={c[1]} r={r / 5} className="dot" />
              <text className="wph-handle-name" x={c[0] + dx * k} y={c[1] + dy * k} fontSize={r * 1.1}>
                {CORNER_NAMES[i]}
              </text>
            </g>
          );
        })}
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
            <image href={draft.url} x={0} y={0} width={W} height={H} />
            <path
              d={`M${loupe.at[0] - zoomSpan / 2},${loupe.at[1]}H${loupe.at[0] + zoomSpan / 2}M${loupe.at[0]},${loupe.at[1] - zoomSpan / 2}V${loupe.at[1] + zoomSpan / 2}`}
              className="trace-cross"
              strokeWidth={zoomSpan / 150}
            />
          </svg>
        </div>
      )}
      <div className="trace-stage-hint">Drag the handles onto the {p.ref === 'paper' ? 'sheet’s' : 'wall’s'} corners</div>
    </div>
  );
}
