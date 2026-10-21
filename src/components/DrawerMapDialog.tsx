import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUnits } from '../state/store';
import { PAPERS, combinedMapSvg, drawerMaps, mapSvg, tilePlan, type DrawerMap, type Tile } from '../lib/inventory';
import { downloadBytes } from '../worker/client';
import { Segmented, Toggle } from './fields';
import { encodeQr, qrRects } from '../lib/qrEncode';
import type { QrEcc } from '../lib/qr';
import { useAllDrawers, type Scope } from './DrawerMap';

type Scale = 'fit' | 'actual';

/** The map's QR encoder (inventory.ts MapOptions.qr). */
const mapQr = (text: string, ecc: QrEcc) => {
  const code = encodeQr(text, ecc);
  return code && { size: code.size, rects: qrRects(code) };
};

/** Page margin, caption height and overlap of actual-size pages (mm). */
const MARGIN = 10;
const HEAD = 8;
const OVERLAP = 10;

interface Page {
  key: string;
  map: DrawerMap;
  landscape: boolean;
  tile?: Tile;
  index?: number;
  count?: number;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer';

/**
 * Printable drawer map: a top view of the drawer (or every drawer) with each
 * bin's label and contents, fitted to a page or at actual size across pages
 * to tape inside the drawer. Prints with the browser's print dialog; the app
 * behind it is hidden from print while this is open.
 */
export function DrawerMapDialog({ initialScope = 'active', onClose }: { initialScope?: Scope; onClose: () => void }) {
  const { docs, activeDrawerId } = useAllDrawers();
  const { units, precision } = useUnits();
  const [scope, setScope] = useState<Scope>(docs.length > 1 ? initialScope : 'active');
  const [scale, setScale] = useState<Scale>('fit');
  const [paperId, setPaperId] = useState(units === 'in' ? 'letter' : 'a4');
  const paper = PAPERS.find((p) => p.id === paperId) ?? PAPERS[0];
  const shown = useMemo(() => (scope === 'all' ? docs : docs.filter((d) => d.id === activeDrawerId)), [docs, scope, activeDrawerId]);
  // Bins with a QR code get it on the map too (off: just the text).
  const anyQr = shown.some((d) => d.bins.some((b) => b.opts.qr && b.opts.qr !== 'none'));
  const [codes, setCodes] = useState(true);
  // Stacked bins get a map per level.
  const maps = useMemo(
    () => shown.flatMap((d) => drawerMaps(d, { units, precision, ...(codes ? { qr: mapQr } : {}) })),
    [shown, units, precision, codes],
  );
  const pages = useMemo<Page[]>(
    () =>
      scale === 'fit'
        ? maps.map((m) => ({ key: m.id, map: m, landscape: m.w > m.h }))
        : maps.flatMap((m) => {
            const plan = tilePlan(m.w, m.h, paper, MARGIN, HEAD, OVERLAP);
            return plan.tiles.map((tile, index) => ({ key: `${m.id}-${index}`, map: m, landscape: plan.landscape, tile, index, count: plan.tiles.length }));
          }),
    [maps, scale, paper],
  );

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    document.body.classList.add('gfm-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.classList.remove('gfm-open');
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const download = () => {
    const svg = maps.length === 1 ? mapSvg(maps[0]) : combinedMapSvg(maps);
    const name = maps.length === 1 ? `drawer-map-${slug(maps[0].name)}.svg` : 'drawer-maps.svg';
    downloadBytes(new TextEncoder().encode(svg), name, 'image/svg+xml');
  };

  // Page size and orientation for printing; wide maps go on landscape pages.
  const printable = { w: paper.w - 2 * MARGIN, h: paper.h - 2 * MARGIN };
  const pageCss =
    `@page { size: ${paper.name} portrait; margin: ${MARGIN}mm; }` +
    `@page gfm-landscape { size: ${paper.name} landscape; margin: ${MARGIN}mm; }` +
    `@media print { .gfm-page.fit svg { max-width: ${printable.w}mm; max-height: ${printable.h - 2}mm; }` +
    ` .gfm-page.fit.landscape svg { max-width: ${printable.h}mm; max-height: ${printable.w - 2}mm; } }`;
  const nBins = shown.reduce((t, d) => t + d.bins.length, 0);

  return createPortal(
    <div className="gfm-overlay" role="dialog" aria-modal="true" aria-label="Drawer map">
      <style>{pageCss}</style>
      <div className="gfm-toolbar">
        <h2>Drawer map</h2>
        {docs.length > 1 && (
          <Segmented
            value={scope}
            options={[
              { value: 'active', label: 'This drawer' },
              { value: 'all', label: `All ${docs.length} drawers` },
            ]}
            onChange={setScope}
          />
        )}
        <Segmented
          value={scale}
          options={[
            { value: 'fit', label: 'Fit to page', title: 'One page per drawer (small drawers print at actual size)' },
            { value: 'actual', label: 'Actual size', title: '1:1, split across pages to tape together and lay in the drawer' },
          ]}
          onChange={setScale}
        />
        <Segmented value={paperId} options={PAPERS.map((p) => ({ value: p.id, label: p.name }))} onChange={setPaperId} />
        {anyQr && <Toggle label="QR codes" checked={codes} onChange={setCodes} />}
        <span className="gfm-note">
          {pages.length} page{pages.length === 1 ? '' : 's'} · {nBins} bin{nBins === 1 ? '' : 's'}
          {scale === 'actual' ? ' · print at 100% scale, then check the scale bar' : ''}
        </span>
        <div className="gfm-actions">
          <button className="primary" onClick={() => window.print()}>
            Print…
          </button>
          <button onClick={download}>Download SVG</button>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="gfm-sheet">
        {pages.map((p) => (
          <section
            key={p.key}
            className={`gfm-page ${p.tile ? 'actual' : 'fit'} ${p.landscape ? 'landscape' : ''}`}
            style={p.tile ? { width: `${(p.landscape ? printable.h : printable.w) + 2 * MARGIN}mm`, padding: `${MARGIN}mm` } : undefined}
          >
            {p.tile && (
              <header className="gfm-page-head">
                <b>{p.map.name}</b> — page {p.index! + 1} of {p.count} (row {p.tile.row + 1}, column {p.tile.col + 1}). Pages overlap by{' '}
                {OVERLAP} mm: trim one edge along the dashed line and tape.
              </header>
            )}
            <div className="gfm-svg" dangerouslySetInnerHTML={{ __html: p.tile ? mapSvg(p.map, p.tile) : mapSvg(p.map) }} />
          </section>
        ))}
        {!pages.length && <p className="muted">No drawers to show.</p>}
      </div>
    </div>,
    document.body,
  );
}
