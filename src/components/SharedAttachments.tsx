import { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../state/store';
import { addToMyAttachments, putOnBoard } from '../state/myAttachments';
import { attachmentsFromHash, type AttachmentEntry } from '../lib/myAttachments';
import '../lib/wall/ui';
import { AttachmentPreview, useEntrySummary } from './MyAttachments';
import './myAttachments.css';

/**
 * A link to some attachments (lib/myAttachments.ts attachmentsShareUrl): what's
 * in it, with a front view of each, and the two things to do with it: keep it
 * in My attachments, or put it on the board that's open (a new board when the
 * open drawer isn't one). Loaded when such a link is opened (openShareLink.ts).
 */
export function openSharedAttachments(hash: string): void {
  const r = attachmentsFromHash(hash);
  if (!r) return;
  if ('error' in r) return alert(r.error);
  if (!r.entries.length) return alert('This link has no attachments in it that this version can read.');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<SharedAttachmentsDialog entries={r.entries} onClose={close} />);
}

interface Done {
  text: string;
  error?: boolean;
}

export function SharedAttachmentsDialog({ entries, onClose }: { entries: AttachmentEntry[]; onClose: () => void }) {
  const titleId = useId();
  const summary = useEntrySummary();
  // Attachments go on a Skådis board (openGrid and Multiboard boards take their own).
  const board = useStore((s) => (s.drawer.enclosure === 'skadis' ? (s.drawers.find((d) => d.id === s.activeDrawerId)?.name ?? 'this board') : null));
  const [added, setAdded] = useState<Done | null>(null);
  const [put, setPut] = useState<Done | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const one = entries.length === 1;
  const it = one ? 'it' : 'them';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const keep = () => {
    const r = addToMyAttachments(entries);
    if (!r)
      return setAdded({ error: true, text: 'My attachments was saved by a newer version of Gridfit: reload the page to update, then open the link again.' });
    const fresh = r.added + r.updated;
    setAdded({
      text: fresh
        ? `In My attachments: add ${it} to any board from Mine, at the top of the Attachments tab’s parts.`
        : `${one ? 'It’s' : 'They’re'} in My attachments already.`,
    });
  };
  const place = (newBoard: boolean) => {
    const r = putOnBoard(entries, { newBoard });
    if (!r.ok) return setPut({ error: true, text: r.error });
    setPut({
      text: r.clear
        ? `On “${r.board}”, selected: drag ${it} where you want ${it}. Undo takes ${it} off.`
        : `On “${r.board}”, but there wasn’t a free spot for everything: ${one ? 'it’s' : 'some are'} on top of other parts. Drag ${it}, or make room.`,
      error: !r.clear,
    });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shared-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{one ? 'A shared attachment' : `${entries.length} shared attachments`}</h2>
          <button className="link modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="shared-body">
          <p className="muted small">Someone sent you {one ? 'a part' : 'parts'} set up for a Skådis board. Nothing was uploaded: it’s all in the link.</p>
          <ul className="myatt-list">
            {entries.map((e) => (
              <li key={e.id} className="myatt-row">
                <div className="myatt-main">
                  <AttachmentPreview entry={e} size={64} />
                  <div className="myatt-name">
                    <b>{e.name}</b>
                    <small>{summary(e)}</small>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button className="primary" disabled={!!added && !added.error} onClick={keep} title="Keep it in this browser, for every board">
              Add to My attachments
            </button>
            {board ? (
              <button disabled={!!put && !put.error} onClick={() => place(false)} title={`At the first free spot on “${board}” (undo takes it off)`}>
                Put on this board
              </button>
            ) : (
              <button disabled={!!put && !put.error} onClick={() => place(true)} title="A new Skådis board, big enough for it">
                Put on a new board
              </button>
            )}
          </div>
          {added && (
            <p className={added.error ? 'field-error' : 'field-hint'} role="status">
              {added.text}
            </p>
          )}
          {put && (
            <p className={put.error ? 'field-error' : 'field-hint'} role="status">
              {put.text}
            </p>
          )}
          <div className="button-row">
            <button onClick={onClose}>{added || put ? 'Done' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
