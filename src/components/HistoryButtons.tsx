import { useEffect, useSyncExternalStore } from 'react';
import { history } from '../state/store';
import { IS_MAC, MOD, isMod, isTyping, keyLetter } from './shortcuts';

/** Undo / redo buttons for the top bar, plus their keyboard shortcuts. */
export function HistoryButtons() {
  useSyncExternalStore(history.subscribe, history.getVersion);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Text fields keep their own undo.
      if (e.defaultPrevented || e.altKey || !isMod(e) || isTyping(e.target)) return;
      const k = keyLetter(e);
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey && e.ctrlKey);
      if (k === 'z' && !e.shiftKey) history.undo();
      else if (redo) history.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="history-buttons" role="group" aria-label="History">
      <button className="icon-button" title={`Undo (${MOD}+Z)`} aria-label="Undo" disabled={!history.canUndo()} onClick={() => history.undo()}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path d="M7.5 5 3.5 9l4 4M4 9h8a4.5 4.5 0 0 1 0 9H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="icon-button"
        title={`Redo (${MOD}+Shift+Z${IS_MAC ? '' : ' or Ctrl+Y'})`}
        aria-label="Redo"
        disabled={!history.canRedo()}
        onClick={() => history.redo()}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path d="M12.5 5l4 4-4 4M16 9H8a4.5 4.5 0 0 0 0 9h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
