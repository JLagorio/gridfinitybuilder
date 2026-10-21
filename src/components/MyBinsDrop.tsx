import { useEffect, useState } from 'react';
import { canPlace, type CellRect } from '../lib/bins';
import { cellEdge, cellIndexAt } from '../lib/layout/drawer';
import { addGridLayer, type GridLayerProps } from './gridLayers';

/**
 * Dragging a bin from My bins (MyBinsSection.tsx) onto the drawer grid: HTML
 * drag and drop within the page. While it's over the grid, the grid shows
 * where it would land (a layer of the grid's, gridLayers.ts); dropping it
 * places it there, or at the first free spot when it doesn't fit there.
 * Touch screens tap Place instead (browsers don't drag on a finger).
 */

export const BIN_DRAG_MIME = 'application/x-gridfit-my-bin';

export interface BinDrag {
  /** The floor cells it takes, relative to its front-left corner, in the active drawer's cells. */
  footprint: CellRect[];
  /** Put it in with its front-left corner at this cell. */
  drop(at: [number, number]): void;
}

let current: BinDrag | null = null;

export function startBinDrag(e: React.DragEvent, drag: BinDrag, id: string, name: string) {
  current = drag;
  e.dataTransfer.setData(BIN_DRAG_MIME, id);
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'copy';
}

export const endBinDrag = () => {
  current = null;
};

/** Where the dragged bins' corner goes with the pointer over cell (i, j): centred on it, kept inside the grid. */
export function dropCorner(footprint: CellRect[], [i, j]: [number, number], nx: number, ny: number): [number, number] {
  const w = Math.max(1, ...footprint.map((r) => r.x + r.w));
  const d = Math.max(1, ...footprint.map((r) => r.y + r.d));
  const clamp = (v: number, n: number, size: number) => Math.max(0, Math.min(v, n - size));
  return [clamp(i - Math.floor((w - 1) / 2), nx, w), clamp(j - Math.floor((d - 1) / 2), ny, d)];
}

interface Spot {
  x: number;
  y: number;
  rects: CellRect[];
  ok: boolean;
}

/** The grid's layer: where a dragged bin would land (red where it doesn't fit), and the drop. */
function DropPreview({ svg, layout, taken }: GridLayerProps) {
  const [spot, setSpot] = useState<Spot | null>(null);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const target = (e: DragEvent) => {
      const d = current;
      if (!d || !e.dataTransfer?.types.includes(BIN_DRAG_MIME)) return null;
      const ctm = el.getScreenCTM();
      const p = ctm && new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const i = p ? cellIndexAt(layout.xs, p.x) : -1;
      const j = p ? cellIndexAt(layout.ys, layout.plateD - p.y) : -1;
      if (i < 0 || j < 0) return { d, spot: null };
      const [x, y] = dropCorner(d.footprint, [i, j], layout.nx, layout.ny);
      const rects = d.footprint.map((r) => ({ x: x + r.x, y: y + r.y, w: r.w, d: r.d }));
      return { d, spot: { x, y, rects, ok: rects.every((r) => canPlace(taken, r, layout.nx, layout.ny)) } };
    };
    const over = (e: DragEvent) => {
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      const n = t.spot;
      setSpot((cur) => (n && cur && cur.x === n.x && cur.y === n.y && cur.ok === n.ok ? cur : n));
    };
    const leave = (e: DragEvent) => !el.contains(e.relatedTarget as Node | null) && setSpot(null);
    const clear = () => setSpot(null);
    const drop = (e: DragEvent) => {
      const t = target(e);
      setSpot(null);
      if (!t) return;
      e.preventDefault();
      t.d.drop(t.spot ? [t.spot.x, t.spot.y] : [0, 0]);
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    window.addEventListener('dragend', clear);
    return () => {
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
      window.removeEventListener('dragend', clear);
    };
  }, [svg, layout, taken]);
  if (!spot) return null;
  const { xs, ys, pitchX, pitchY, plateD } = layout;
  return (
    <g pointerEvents="none">
      {spot.rects.map((r, k) => {
        const x0 = cellEdge(xs, r.x, pitchX);
        const x1 = cellEdge(xs, r.x + r.w, pitchX);
        const y0 = cellEdge(ys, r.y, pitchY);
        const y1 = cellEdge(ys, r.y + r.d, pitchY);
        return <rect key={k} className={`ge-ghost ${spot.ok ? 'ok' : 'no'}`} x={x0 + 0.6} y={plateD - y1 + 0.6} width={x1 - x0 - 1.2} height={y1 - y0 - 1.2} rx={3.75} />;
      })}
    </g>
  );
}

addGridLayer(DropPreview);
