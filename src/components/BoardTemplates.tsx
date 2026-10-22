import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useUnits } from '../state/store';
import { Segmented } from './fields';
import { BOARD_TEMPLATES, boardOf, fitTemplate, templateSkadis, type BoardTemplate } from '../lib/wall/templates';
import { placeAttachments } from '../lib/wall/place';
import { applyTemplate, newBoardFromTemplate, type TemplateResult } from '../state/boardTemplates';
import type { TemplateTarget } from './boardTemplatesLazy';
import './boardTemplates.css';

/** A template's front view: the board and its parts where they go. */
function Preview({ t }: { t: BoardTemplate }) {
  const setup = useStore((s) => s.setup);
  const shape = useMemo(() => {
    const board = boardOf(templateSkadis(t), setup);
    if (!board) return null;
    const { placed } = placeAttachments(fitTemplate(t, board).list, board);
    return { W: board.W, H: board.H, boxes: placed.map((p) => [p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0]) };
  }, [t, setup]);
  if (!shape) return null;
  const { W, H } = shape;
  return (
    <svg className="tpl-preview" viewBox={`-6 -6 ${W + 12} ${H + 12}`} aria-hidden>
      <rect className="tpl-board" x={0} y={0} width={W} height={H} rx={6} />
      {shape.boxes.map(([x, y, w, h], i) => (
        <rect key={i} className="tpl-part" x={x} y={H - y - h} width={w} height={h} rx={3} />
      ))}
    </svg>
  );
}

/**
 * Starter boards (lib/wall/templates.ts): a picker of templates, each with a
 * front view, its size and a line on what's on it. One makes a new board with
 * its parts on, or puts them on the active board: in place of what's there,
 * or around it, after asking.
 */
export function BoardTemplatesDialog({ target: initial, onClose }: { target: TemplateTarget; onClose: () => void }) {
  const titleId = useId();
  const { fmt } = useUnits();
  const board = useStore((s) => s.drawer.enclosure === 'skadis');
  const boardName = useStore((s) => s.drawers.find((d) => d.id === s.activeDrawerId)?.name ?? '');
  const onBoard = useStore((s) => s.drawer.attachments?.length ?? 0);
  const [target, setTarget] = useState<TemplateTarget>(board ? initial : 'new');
  // A template picked for a board with parts on it: replace them, or add around them?
  const [asking, setAsking] = useState<BoardTemplate | null>(null);
  const [done, setDone] = useState<{ t: BoardTemplate; r: TemplateResult } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

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

  const finish = (t: BoardTemplate, r: TemplateResult | null) => {
    if (r && r.left.length) setDone({ t, r });
    else onClose();
  };
  const pick = (t: BoardTemplate) => {
    if (target === 'new') finish(t, newBoardFromTemplate(t));
    else if (onBoard) setAsking(t);
    else finish(t, applyTemplate(t, 'replace'));
  };
  const apply = (mode: 'replace' | 'add') => {
    const t = asking!;
    setAsking(null);
    finish(t, applyTemplate(t, mode));
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tpl-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>Start from a template</h2>
          <span className="muted small">A board with a ready set of parts: change, move or delete any of them after.</span>
          <button className="link modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="tpl-body">
          {board && (
            <Segmented
              ariaLabel="Where it goes"
              value={target}
              options={[
                { value: 'new', label: 'A new board', title: 'A new board the template’s size, named after it' },
                { value: 'this', label: `On “${boardName}”`, title: 'Its parts on this board, as many as fit (the board keeps its size)' },
              ]}
              onChange={(v) => {
                setTarget(v);
                setAsking(null);
              }}
            />
          )}
          {done ? (
            <div className="tpl-note" role="status">
              <p>
                <b>{done.t.name}</b>: {done.r.added} part{done.r.added === 1 ? '' : 's'} on the board. No room for {done.r.left.join(', ')}: make the board
                bigger on its tab, or move parts to make room, and add them from the list.
              </p>
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          ) : asking ? (
            <div className="tpl-note" role="alertdialog" aria-label="Replace or add">
              <p>
                “{boardName}” has {onBoard} part{onBoard === 1 ? '' : 's'} on it. Put the {asking.name.toLowerCase()} parts in their place, or around them where
                they fit?
              </p>
              <div className="button-row">
                <button className="danger" onClick={() => apply('replace')}>
                  Replace them
                </button>
                <button className="primary" onClick={() => apply('add')}>
                  Add where they fit
                </button>
                <button onClick={() => setAsking(null)}>Cancel</button>
              </div>
            </div>
          ) : null}
          <ul className="tpl-list">
            {BOARD_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button className={`tpl-card ${asking === t ? 'active' : ''}`} disabled={!!done} onClick={() => pick(t)}>
                  <Preview t={t} />
                  <span className="tpl-text">
                    <b>{t.name}</b>
                    <small>{t.description}</small>
                    <span className="tpl-meta">
                      {target === 'new' ? `${fmt(t.width)} × ${fmt(t.height)} board · ` : ''}
                      {t.items.length} parts
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
