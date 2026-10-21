/**
 * Light preview of a compartment's inside in the top-down compartment editor
 * (BinInteriorEditor): the pocket grid of a pocket compartment, a hatch (and
 * the tools that fall inside) for tool and solid compartments, and shading for
 * a ramp or steps. Drawn in cavity mm, clipped to the compartment.
 */
import { useId, useMemo, type ReactNode } from 'react';
import type { Compartment } from '../lib/dividers';
import { binCompartmentPockets } from '../lib/geometry/bin';
import { compartmentFloorShape, compartmentPocketOpts } from '../lib/geometry/compartments';
import { placedOutline } from '../lib/geometry/cutouts';
import { compartmentOptions, type BinInterior } from './interiorState';

const LINE = 'rgba(205, 213, 224, 0.32)';
const HATCH = 'rgba(205, 213, 224, 0.16)';
const TOOL = 'rgba(245, 165, 36, 0.55)';

/** Pocket grid of a pocket compartment, in cavity mm: each pocket's mouth center and size (graduated sets vary). */
function usePockets(info: BinInterior, c: Compartment, on: boolean) {
  return useMemo(() => {
    if (!on) return { places: [] as { x: number; y: number; w: number; d: number }[], hexFlatX: true };
    const layouts = binCompartmentPockets(info.opts, info.cells, c);
    const dx = info.size.w / 2;
    const dy = info.size.d / 2;
    return {
      places: layouts.flatMap((L) => L.pockets.map((p) => ({ x: p.x + dx, y: p.y + dy, w: p.w, d: p.d }))),
      hexFlatX: layouts[0]?.hexFlatX ?? true,
    };
  }, [info, c, on]);
}

/** Pocket count, or a word for the other insides and floor shapes (for the compartment's badge). */
export function useInsideBadge(info: BinInterior, c: Compartment): string | null {
  const o = compartmentOptions(info, c.key);
  const n = usePockets(info, c, o.inside === 'pockets').places.length;
  if (o.inside === 'pockets') return `${n} pocket${n === 1 ? '' : 's'}`;
  if (o.inside === 'tools') return 'tools';
  if (o.inside === 'solid') return 'solid';
  const f = compartmentFloorShape(info.layout.comps?.[c.key], 1000);
  return f ? (f.kind === 'ramp' ? `ramp ↑ ${f.high}` : `${f.tiers} steps ↑ ${f.high}`) : null;
}

export function CompartmentInsidePreview({ c, info, sy }: { c: Compartment; info: BinInterior; sy: (y: number) => number }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const o = compartmentOptions(info, c.key);
  const co = info.layout.comps?.[c.key];
  const pockets = usePockets(info, c, o.inside === 'pockets');
  const shape = o.inside === 'open' ? compartmentFloorShape(co, 1000) : null;
  if (o.inside === 'open' && !shape) return null;
  const b = c.bounds;
  const clip = `${id}c`;
  const content: ReactNode[] = [];

  if (o.inside === 'pockets') {
    const p = compartmentPocketOpts(info.opts, co);
    const style = { fill: 'rgba(8, 10, 14, 0.3)', stroke: LINE, strokeWidth: 1 };
    pockets.places.forEach(({ x, y, w: pw, d: pd }, k) => {
      if (p.pocketShape === 'square') {
        content.push(<rect key={k} x={x - pw / 2} y={sy(y + pd / 2)} width={pw} height={pd} style={style} vectorEffect="non-scaling-stroke" />);
      } else if (p.pocketShape === 'hex') {
        const R = pw / Math.sqrt(3);
        const a0 = pockets.hexFlatX ? 30 : 0;
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = ((a0 + 60 * i) * Math.PI) / 180;
          return `${x + R * Math.cos(a)},${sy(y + R * Math.sin(a))}`;
        }).join(' ');
        content.push(<polygon key={k} points={pts} style={style} vectorEffect="non-scaling-stroke" />);
      } else content.push(<circle key={k} cx={x} cy={sy(y)} r={pw / 2} style={style} vectorEffect="non-scaling-stroke" />);
    });
  } else if (o.inside === 'tools' || o.inside === 'solid') {
    // Diagonal hatch on a fixed grid, so the strips of an L-shaped compartment line up.
    const gap = o.inside === 'solid' ? 2.5 : 4;
    for (let k = Math.floor((b.x0 - b.y1) / gap) * gap; k <= b.x1 - b.y0; k += gap) {
      content.push(<line key={`h${k}`} x1={b.y0 + k} y1={sy(b.y0)} x2={b.y1 + k} y2={sy(b.y1)} style={{ stroke: HATCH, strokeWidth: 1 }} vectorEffect="non-scaling-stroke" />);
    }
    if (o.inside === 'tools') {
      // The bin's tools, moved from bin-centered to cavity coordinates.
      for (const [k, t] of (info.opts.cutouts ?? []).entries()) {
        const pts = placedOutline(t)
          .map(([x, y]) => `${x + info.size.w / 2},${sy(y + info.size.d / 2)}`)
          .join(' ');
        content.push(<polygon key={`t${k}`} points={pts} style={{ fill: 'rgba(245, 165, 36, 0.08)', stroke: TOOL, strokeWidth: 1 }} vectorEffect="non-scaling-stroke" />);
      }
    }
  } else if (shape) {
    // Darker low, lighter high: a gradient for a ramp, one band per step.
    const [gx0, gy0, gx1, gy1] =
      shape.high === 'back'
        ? [b.x0, b.y0, b.x0, b.y1]
        : shape.high === 'front'
          ? [b.x0, b.y1, b.x0, b.y0]
          : shape.high === 'right'
            ? [b.x0, b.y0, b.x1, b.y0]
            : [b.x1, b.y0, b.x0, b.y0];
    if (shape.kind === 'ramp') {
      content.push(
        <defs key="g">
          <linearGradient id={`${id}g`} gradientUnits="userSpaceOnUse" x1={gx0} y1={sy(gy0)} x2={gx1} y2={sy(gy1)}>
            <stop offset="0" stopColor="rgb(205, 213, 224)" stopOpacity={0} />
            <stop offset="1" stopColor="rgb(205, 213, 224)" stopOpacity={0.16} />
          </linearGradient>
        </defs>,
        <rect key="r" x={b.x0} y={sy(b.y1)} width={b.x1 - b.x0} height={b.y1 - b.y0} style={{ fill: `url(#${id}g)` }} />,
      );
    } else {
      for (let k = 1; k < shape.tiers; k++) {
        const t = k / shape.tiers;
        const band =
          shape.high === 'back'
            ? { x0: b.x0, x1: b.x1, y0: b.y0 + t * (b.y1 - b.y0), y1: b.y1 }
            : shape.high === 'front'
              ? { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 - t * (b.y1 - b.y0) }
              : shape.high === 'right'
                ? { x0: b.x0 + t * (b.x1 - b.x0), x1: b.x1, y0: b.y0, y1: b.y1 }
                : { x0: b.x0, x1: b.x1 - t * (b.x1 - b.x0), y0: b.y0, y1: b.y1 };
        content.push(
          <rect
            key={`s${k}`}
            x={band.x0}
            y={sy(band.y1)}
            width={band.x1 - band.x0}
            height={band.y1 - band.y0}
            style={{ fill: 'rgba(205, 213, 224, 0.06)', stroke: LINE, strokeWidth: 1, strokeDasharray: '3 3' }}
            vectorEffect="non-scaling-stroke"
          />,
        );
      }
    }
  }

  return (
    <g pointerEvents="none" clipPath={`url(#${clip})`}>
      <clipPath id={clip}>
        {c.rects.map((r, k) => (
          <rect key={k} x={r.x0} y={sy(r.y1)} width={r.x1 - r.x0} height={r.y1 - r.y0} />
        ))}
      </clipPath>
      {content}
    </g>
  );
}
