import { create } from 'zustand';

/**
 * Basic or All settings in the side panels. A preference of this browser,
 * not of the project: it isn't saved in project files or undone.
 */
export type PanelView = 'basic' | 'all';

const KEY = 'gridfit-panel-view';

function load(): PanelView {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'all' ? 'all' : 'basic';
  } catch {
    return 'basic';
  }
}

interface PanelViewState {
  view: PanelView;
  setView(view: PanelView): void;
}

export const usePanelView = create<PanelViewState>((set) => ({
  view: load(),
  setView: (view) => {
    try {
      globalThis.localStorage?.setItem(KEY, view);
    } catch {
      // Private windows and blocked storage: it just isn't remembered.
    }
    set({ view });
  },
}));
