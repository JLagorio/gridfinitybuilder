import { useMemo, useRef, useState } from 'react';
import type { GridLayout } from '../lib/layout/drawer';
import type { PlacedBin } from '../lib/project';
import { canPlace, occupancy, outOfBounds, type CellRect } from '../lib/bins';

interface Props {
  layout: GridLayout;
  bins: PlacedBin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (r: CellRect) => void;
  onMove: (id: string, x: number, y: number) => void;
}

type Drag =
  | { kind: 'draw'; start: [number, number]; cur: [number, number] }
  | { kind: 'move'; id: string; grab: [number, number]; cur: [number, number]; moved: boolean };

/** Top-down drawer grid. Back of the drawer is at the top. */
export function BinGridEditor({ layout, bins, selectedId, onSelect, onCreate, onMove }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const { nx, ny, pitchX, pitchY, originX, originY, plateW, plateD } = layout;
  const occ = useMemo(() => occupancy(bins, nx, ny), [bins, nx, ny]);
  const pad = 8;

  // plate (mm, y up) -> svg (y down)
  const sy = (y: number) => plateD - y;

  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const el = svg.current;
    if (!el) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(el.getScreenCTM()!.inverse());
    const px = pt.x;
    const py = plateD - pt.y;
    const i = Math.floor((px - originX) / pitchX);
    const j = Math.floor((py - originY) / pitchY);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
    return [i, j];
  };

  const ghost: { r: CellRect; ok: boolean } | null = (() => {
    if (!drag) return null;
    if (drag.kind === 'draw') {
      const x = Math.min(drag.start[0], drag.cur[0]);
      const y = Math.min(drag.start[1], drag.cur[1]);
      const r = { x, y, w: Math.abs(drag.cur[0] - drag.start[0]) + 1, d: Math.abs(drag.cur[1] - drag.start[1]) + 1 };
      return { r, ok: canPlace(bins, r, nx, ny) };
    }
    const b = bins.find((bb) => bb.id === drag.id);
    if (!b || !drag.moved) return null;
    const r = { x: drag.cur[0] - drag.grab[0], y: drag.cur[1] - drag.grab[1], w: b.opts.unitsX, d: b.opts.unitsY };
    return { r, ok: canPlace(bins, r, nx, ny, b.id) };
  })();

  const onDown = (e: React.PointerEvent) => {
    const c = cellAt(e);
    if (!c) {
      onSelect(null);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const id = occ[c[0]][c[1]];
    if (id) {
      const b = bins.find((bb) => bb.id === id)!;
      onSelect(id);
      setDrag({ kind: 'move', id, grab: [c[0] - b.x, c[1] - b.y], cur: c, moved: false });
    } else {
      setDrag({ kind: 'draw', start: c, cur: c });
    }
  };

  const onMoveEvt = (e: React.PointerEvent) => {
    const c = cellAt(e);
    setHover(c);
    if (!drag || !c) return;
    if (drag.kind === 'draw') setDrag({ ...drag, cur: c });
    else if (c[0] !== drag.cur[0] || c[1] !== drag.cur[1]) setDrag({ ...drag, cur: c, moved: true });
  };

  const onUp = () => {
    if (drag && ghost?.ok) {
      if (drag.kind === 'draw') onCreate(ghost.r);
      else onMove(drag.id, ghost.r.x, ghost.r.y);
    }
    setDrag(null);
  };

  const cellRectSvg = (r: CellRect, inset = 0.25) => ({
    x: originX + r.x * pitchX + inset,
    y: sy(originY + (r.y + r.d) * pitchY) + inset,
    width: r.w * pitchX - 2 * inset,
    height: r.d * pitchY - 2 * inset,
  });

  if (!nx || !ny) return <div className="editor-empty">The drawer is smaller than one grid cell.</div>;

  return (
    <div className="grid-editor">
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${plateW + 2 * pad} ${plateD + 2 * pad}`}
        onPointerDown={onDown}
        onPointerMove={onMoveEvt}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        role="application"
        aria-label="Drawer grid. Drag to draw a bin."
      >
        <rect className="ge-plate" x={0} y={0} width={plateW} height={plateD} rx={4} />
        {Array.from({ length: nx }, (_, i) =>
          Array.from({ length: ny }, (_, j) => {
            const r = cellRectSvg({ x: i, y: j, w: 1, d: 1 }, 1.5);
            const hovered = hover && hover[0] === i && hover[1] === j && !occ[i][j] && !drag;
            return <rect key={`${i}-${j}`} className={`ge-cell ${hovered ? 'hover' : ''}`} {...r} rx={3.5} />;
          }),
        )}
        {bins.map((b) => {
          const r = cellRectSvg({ x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY }, 0.6);
          const sel = b.id === selectedId;
          const bad = outOfBounds(b, nx, ny);
          const fs = Math.min(10, (Math.min(r.width, r.height) / 4) | 0) || 6;
          return (
            <g key={b.id} className={`ge-bin ${sel ? 'selected' : ''} ${bad ? 'bad' : ''}`}>
              <rect {...r} rx={3.75} />
              {b.opts.divX > 1 &&
                Array.from({ length: b.opts.divX - 1 }, (_, k) => {
                  const x = r.x + ((k + 1) * r.width) / b.opts.divX;
                  return <line key={`x${k}`} x1={x} x2={x} y1={r.y + 4} y2={r.y + r.height - 4} />;
                })}
              {b.opts.divY > 1 &&
                Array.from({ length: b.opts.divY - 1 }, (_, k) => {
                  const y = r.y + ((k + 1) * r.height) / b.opts.divY;
                  return <line key={`y${k}`} y1={y} y2={y} x1={r.x + 4} x2={r.x + r.width - 4} />;
                })}
              <text x={r.x + r.width / 2} y={r.y + r.height / 2} fontSize={fs} dominantBaseline="middle" textAnchor="middle">
                {b.opts.heightUnits}u
              </text>
            </g>
          );
        })}
        {ghost && <rect className={`ge-ghost ${ghost.ok ? 'ok' : 'no'}`} {...cellRectSvg(ghost.r, 0.6)} rx={3.75} />}
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
