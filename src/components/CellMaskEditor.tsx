import { useRef, useState } from 'react';
import { cellIndexAt, type GridLayout } from '../lib/layout/drawer';

/**
 * Compact map of the drawer grid for marking blocked cells (slide hardware, a
 * bump). Click a cell to toggle it; drag to paint several. Back of the drawer
 * is at the top. The mask is committed once, when the pointer is released.
 */
export function CellMaskEditor({
  layout,
  mask,
  onChange,
}: {
  layout: GridLayout;
  mask: string[];
  onChange: (mask: string[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ set: Set<string>; on: boolean } | null>(null);
  const { nx, ny, xs, ys, plateW, plateD } = layout;
  const shown = draft?.set ?? new Set(mask);
  const pad = 2;

  const cellAt = (e: React.PointerEvent): string | null => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const i = cellIndexAt(xs, p.x);
    const j = cellIndexAt(ys, plateD - p.y);
    return i < 0 || j < 0 ? null : `${i},${j}`;
  };

  const paint = (d: { set: Set<string>; on: boolean }, k: string) => {
    if (d.set.has(k) === d.on) return d;
    const set = new Set(d.set);
    if (d.on) set.add(k);
    else set.delete(k);
    return { ...d, set };
  };

  const onDown = (e: React.PointerEvent) => {
    // One finger paints; a second one is ignored.
    if (e.button !== 0 || !e.isPrimary) return;
    const k = cellAt(e);
    if (!k) return;
    svg.current?.setPointerCapture?.(e.pointerId);
    const start = new Set(mask);
    setDraft(paint({ set: start, on: !start.has(k) }, k));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draft || !e.isPrimary) return;
    const k = cellAt(e);
    if (k) setDraft(paint(draft, k));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!draft || !e.isPrimary) return;
    const next = [...draft.set].sort();
    setDraft(null);
    if (next.join('|') !== [...mask].sort().join('|')) onChange(next);
  };

  if (!nx || !ny) return null;
  // Keep the map small: about 260 px wide, whatever the drawer's size.
  const strokeW = Math.max(plateW, plateD) / 260;
  return (
    <svg
      ref={svg}
      className="cell-mask"
      viewBox={`${-pad} ${-pad} ${plateW + 2 * pad} ${plateD + 2 * pad}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDraft(null)}
      role="application"
      aria-label="Blocked cells. Click or drag to mark cells that can't hold a bin."
    >
      <rect className="cm-plate" x={0} y={0} width={plateW} height={plateD} rx={3} strokeWidth={strokeW} />
      {Array.from({ length: nx }, (_, i) =>
        Array.from({ length: ny }, (_, j) => {
          const k = `${i},${j}`;
          const g = Math.min(1.5, (xs[i + 1] - xs[i]) / 8, (ys[j + 1] - ys[j]) / 8);
          return (
            <rect
              key={k}
              className={`cm-cell ${shown.has(k) ? 'on' : ''}`}
              x={xs[i] + g}
              y={plateD - ys[j + 1] + g}
              width={xs[i + 1] - xs[i] - 2 * g}
              height={ys[j + 1] - ys[j] - 2 * g}
              rx={2.5}
              strokeWidth={strokeW}
            >
              <title>{`Column ${i + 1}, row ${j + 1} from the front${shown.has(k) ? ', blocked' : ''}`}</title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}
