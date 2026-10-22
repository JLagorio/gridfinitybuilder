import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { attachmentEntries, binEntries, hasInventory, inventoryCsv, searchInventory, type AttachmentEntry, type BinEntry } from '../lib/inventory';
import type { NamedDrawer } from '../lib/project';
import { downloadBytes } from '../worker/client';
import { Section } from './fields';
import { DrawerMapDialog, useAllDrawers } from './DrawerMap';
import { goToResult } from './FindBox';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** CSV of every bin's contents (with a byte-order mark, so spreadsheet apps read it as UTF-8). */
export function downloadInventoryCsv(docs: NamedDrawer[]) {
  const name = docs.length === 1 ? `contents-${docs[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer'}.csv` : 'contents.csv';
  downloadBytes(new TextEncoder().encode(`﻿${inventoryCsv(docs)}`), name, 'text/csv');
}

function ContentsCell({ e }: { e: BinEntry }) {
  if (!hasInventory(e)) return <span className="faint">—</span>;
  return (
    <>
      {e.contents.map((l, i) => (
        <div key={`b${i}`}>{l}</div>
      ))}
      {e.comps
        .filter((c) => c.label || c.contents.length)
        .map((c) => (
          <div key={c.key}>
            <span className="muted">{capital(c.label || c.name)}:</span> {c.contents.join(', ') || <span className="faint">—</span>}
          </div>
        ))}
      {e.tools.length > 0 && (
        <div>
          <span className="muted">Tools:</span> {e.tools.join(', ')}
        </div>
      )}
    </>
  );
}

/** Every bin of every drawer, and every board's attachments, with what's in them; filter, click to go there, download as CSV. */
export function InventoryDialog({ onClose }: { onClose: () => void }) {
  const { docs, boards, all, activeDrawerId } = useAllDrawers();
  const [filter, setFilter] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const input = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => binEntries(docs), [docs]);
  const parts = useMemo(() => attachmentEntries(boards), [boards]);
  const match = useMemo(() => {
    if (!filter.trim()) return null;
    const hits = searchInventory(all, filter, { activeDrawerId, limit: 100000 });
    return {
      bins: new Set(hits.map((r) => `${r.drawerId}|${r.binId ?? r.attachmentId ?? ''}`)),
      drawers: new Set(hits.filter((r) => !r.binId && !r.attachmentId).map((r) => r.drawerId)),
    };
  }, [all, filter, activeDrawerId]);
  const shown = entries.filter(
    (e) => (!match || match.bins.has(`${e.drawerId}|${e.bin.id}`) || match.drawers.has(e.drawerId)) && (!hideEmpty || hasInventory(e)),
  );
  const listedPart = (e: AttachmentEntry) => !!e.label || e.contents.length > 0;
  const shownParts = parts.filter(
    (e) => (!match || match.bins.has(`${e.drawerId}|${e.attachment.id}`) || match.drawers.has(e.drawerId)) && (!hideEmpty || listedPart(e)),
  );
  const listed = entries.filter(hasInventory).length;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const go = (e: BinEntry) => {
    goToResult({ drawerId: e.drawerId, binId: e.bin.id });
    onClose();
  };
  const goPart = (e: AttachmentEntry) => {
    goToResult({ drawerId: e.drawerId, attachmentId: e.attachment.id });
    onClose();
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="overlay-card inventory" role="dialog" aria-modal="true" aria-labelledby="inventory-title">
        <header>
          <h2 id="inventory-title">What&apos;s where</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="inventory-tools">
          <div className="input-wrap">
            <input ref={input} type="search" value={filter} placeholder="Filter…" aria-label="Filter bins" onChange={(e) => setFilter(e.target.value)} />
          </div>
          <label className="inventory-check">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Only bins with something listed
          </label>
          <button onClick={() => downloadInventoryCsv(all)}>Download CSV</button>
        </div>
        <p className="muted small">
          {entries.length} bin{entries.length === 1 ? '' : 's'} in {docs.length} drawer{docs.length === 1 ? '' : 's'}, {listed} with a label or contents
          {parts.length ? `; ${parts.length} part${parts.length === 1 ? '' : 's'} on ${boards.length} board${boards.length === 1 ? '' : 's'}` : ''}. Positions
          are column letters from the left and row numbers from the front. Click a bin to show it.
        </p>
        {docs.map((d) => {
          const rows = shown.filter((e) => e.drawerId === d.id);
          if (!rows.length) return null;
          return (
            <section key={d.id} className="inventory-drawer">
              <h3>
                {d.name} <small className="muted">{d.bins.length} bins</small>
              </h3>
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>Bin</th>
                    <th>Label</th>
                    <th>What&apos;s in it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.bin.id} onClick={() => go(e)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && go(e)}>
                      <td className="inventory-pos">{e.pos}</td>
                      <td>{e.desc}</td>
                      <td>{e.label || <span className="faint">—</span>}</td>
                      <td>
                        <ContentsCell e={e} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
        {boards.map((d) => {
          const rows = shownParts.filter((e) => e.drawerId === d.id);
          if (!rows.length) return null;
          return (
            <section key={d.id} className="inventory-drawer">
              <h3>
                {d.name} <small className="muted">{d.drawer.attachments?.length ?? 0} parts on the board</small>
              </h3>
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>Part</th>
                    <th>Label</th>
                    <th>What&apos;s in it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.attachment.id} onClick={() => goPart(e)} tabIndex={0} onKeyDown={(k) => k.key === 'Enter' && goPart(e)}>
                      <td className="inventory-pos">{e.pos}</td>
                      <td>
                        {e.title}
                        {e.title !== e.desc && <div className="muted small">{e.desc}</div>}
                      </td>
                      <td>{e.label || <span className="faint">—</span>}</td>
                      <td>{e.contents.length ? e.contents.map((l, i) => <div key={i}>{l}</div>) : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
        {!shown.length && !shownParts.length && (
          <p className="muted">{entries.length || parts.length ? 'Nothing matches.' : 'No bins yet: draw some in the Bins tab.'}</p>
        )}
      </div>
    </div>
  );
}

/** Print tab: the drawer map, the contents list and its CSV. */
export function ContentsSection() {
  const { docs, all } = useAllDrawers();
  const printScope = useStore((s) => s.printScope);
  const [open, setOpen] = useState<'map' | 'list' | null>(null);
  const entries = useMemo(() => binEntries(docs), [docs]);
  const listed = entries.filter(hasInventory).length;
  return (
    <Section title="Drawer map & contents">
      <p className="muted small">
        A top view of the drawer with each bin&apos;s label and contents, to keep in the drawer or print at actual size and lay in it; and a list of what&apos;s
        where in every drawer.
      </p>
      <div className="button-row">
        <button onClick={() => setOpen('map')}>Drawer map…</button>
        <button onClick={() => setOpen('list')}>Contents list…</button>
        <button onClick={() => downloadInventoryCsv(all)} disabled={!entries.length && all.length === docs.length}>
          Contents (.csv)
        </button>
      </div>
      <div className="field-hint">
        {entries.length
          ? `${listed} of ${entries.length} bins have a label or contents. Add contents in the Bins tab under “What's in it”.`
          : 'No bins yet.'}
      </div>
      {open === 'map' && <DrawerMapDialog initialScope={printScope === 'active' ? 'active' : 'all'} onClose={() => setOpen(null)} />}
      {open === 'list' && <InventoryDialog onClose={() => setOpen(null)} />}
    </Section>
  );
}
