/**
 * Fingers on a board's editors (BoardTiles.tsx, WallEditor.tsx): targets a fingertip can find, and how many board
 * millimetres one screen pixel is, so they can be sized in pixels. With a mouse none of it changes anything: the
 * editors only grow their targets on a touch screen.
 */
import { useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';

/** A fingertip's target: at least this many screen pixels across (phone makers ask for 44 to 48). */
export const FINGER_PX = 40;

/** A length in board mm grown to at least `px` screen pixels, one pixel being `mmPerPx` mm. */
export const atLeastPx = (mm: number, px: number, mmPerPx: number) => Math.max(mm, px * mmPerPx);

/** A rectangle in board mm, y up. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Where a finger takes a part's resize handle: its right edge (`e`), bottom edge (`s`) or bottom right corner
 * (`se`), part `b`. A square `reach` across (never smaller than `size`, the handle as drawn) on the handle, reaching
 * into the part by at most a third of it, so the rest of a small part still drags; the rest of it lies outside.
 */
export function handleHit(edge: 'e' | 's' | 'se', b: Box, size: number, reach: number): Box {
  const r = Math.max(reach, size);
  const inX = Math.min(r / 2, (b.x1 - b.x0) / 3);
  const inY = Math.min(r / 2, (b.y1 - b.y0) / 3);
  const xm = (b.x0 + b.x1) / 2;
  const ym = (b.y0 + b.y1) / 2;
  const [x0, x1] = edge === 's' ? [xm - r / 2, xm + r / 2] : [b.x1 - inX, b.x1 - inX + r];
  const [y0, y1] = edge === 'e' ? [ym - r / 2, ym + r / 2] : [b.y0 + inY - r, b.y0 + inY];
  return { x0, x1, y0, y1 };
}

/** How far (x, y) is from box `b` (0 inside it). */
export const boxDistance = (b: Box, x: number, y: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

/**
 * The part a finger meant: the one nearest (x, y) within `reach` of its box, or null. A press just beside a part
 * thinner than a fingertip (a hook is a few pixels wide on a phone) still takes it.
 */
export function nearestPart<T extends Box & { id: string }>(parts: readonly T[], x: number, y: number, reach: number): T | null {
  let best: T | null = null;
  let bestD = reach;
  for (const p of parts) {
    const d = boxDistance(p, x, y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * A long press on part `id`, with `before` selected when the finger came down: it joins that selection (first, as
 * the one the panel shows), or leaves it if it was in it, as a Shift-click does with a mouse.
 */
export function heldSelection(before: readonly string[], id: string): string[] {
  return before.includes(id) ? before.filter((x) => x !== id) : [id, ...before];
}

/** Board mm in one screen pixel of `svg` (drawn in board mm; 1 till it's measured), kept up as it resizes. */
export function useMmPerPx(svg: RefObject<SVGSVGElement | null>, deps: DependencyList): number {
  const [mm, setMm] = useState(1);
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const m = el.getScreenCTM();
      if (m && m.a > 0) setMm(1 / m.a);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return mm;
}
