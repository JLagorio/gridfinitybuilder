import { useEffect } from 'react';
import {
  copySelection,
  duplicateSelection,
  nudgeSelection,
  pasteClipboard,
  removeSelection,
  selectAll,
  selectedBins,
} from '../state/selection';
import { isMod, isTyping, keyLetter } from './shortcuts';
import { hasLayoutClip, pasteLayoutInto } from './layoutClip';

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  // The back of the drawer is at the top of the layout.
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Copy/paste/duplicate/select-all/nudge for the bin layout editor while it's on screen. */
export function useLayoutShortcuts(hoveredCell: () => [number, number] | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || isTyping(e.target)) return;
      const k = keyLetter(e);
      // Paste a compartment layout copied in the compartment editor into every selected bin.
      if (isMod(e) && e.shiftKey && k === 'v' && hasLayoutClip() && selectedBins().length) {
        pasteLayoutInto(selectedBins().map((b) => b.id));
        e.preventDefault();
        return;
      }
      if (isMod(e) && !e.shiftKey) {
        // Leave copying selected page text to the browser.
        const textSelected = !!window.getSelection()?.toString();
        if ((k === 'c' || k === 'x') && !textSelected && selectedBins().length) {
          copySelection();
          if (k === 'x') removeSelection();
        } else if (k === 'v') pasteClipboard(hoveredCell());
        else if (k === 'd') duplicateSelection();
        else if (k === 'a' && !textSelected) selectAll();
        else return;
        e.preventDefault();
        return;
      }
      const step = ARROWS[e.key];
      // Sliders, checkboxes and selects keep their own arrow keys.
      const native = (e.target as HTMLElement | null)?.closest?.('input, select, textarea');
      if (step && !native && !isMod(e) && selectedBins().length) {
        nudgeSelection(step[0], step[1]);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoveredCell]);
}
