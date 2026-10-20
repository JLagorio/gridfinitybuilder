import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { trackHistory } from '../src/state/history';
import { allDrawers, history, projectFile, useStore } from '../src/state/store';

describe('trackHistory', () => {
  type S = { a: number; b: string; ui: number; setA(v: number): void };
  const setup = (limit = 100) => {
    let t = 0;
    const api = createStore<S>()((set) => ({ a: 0, b: 'x', ui: 0, setA: (a) => set({ a }) }));
    const h = trackHistory(api, { keys: () => ['a', 'b'], limit, now: () => t });
    const at = (ms: number) => (t = ms);
    return { api, h, at };
  };

  it('undoes and redoes tracked keys only', () => {
    const { api, h, at } = setup();
    api.getState().setA(1);
    at(1000);
    api.setState({ b: 'y' });
    at(2000);
    api.setState({ ui: 5 }); // untracked: no step
    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(api.getState()).toMatchObject({ a: 1, b: 'x', ui: 5 });
    h.undo();
    expect(api.getState()).toMatchObject({ a: 0, b: 'x' });
    expect(h.undo()).toBe(false);
    h.redo();
    h.redo();
    expect(api.getState()).toMatchObject({ a: 1, b: 'y' });
    expect(h.canRedo()).toBe(false);
  });

  it('groups rapid changes into one step', () => {
    const { api, h, at } = setup();
    for (let i = 1; i <= 20; i++) {
      at(i * 50); // a slider drag
      api.getState().setA(i);
    }
    at(5000);
    api.getState().setA(99);
    h.undo();
    expect(api.getState().a).toBe(20);
    h.undo();
    expect(api.getState().a).toBe(0);
    expect(h.canUndo()).toBe(false);
  });

  it('checkpoint splits a burst; a new change clears redo', () => {
    const { api, h } = setup();
    api.getState().setA(1);
    h.checkpoint();
    api.getState().setA(2);
    h.undo();
    expect(api.getState().a).toBe(1);
    expect(h.canRedo()).toBe(true);
    api.getState().setA(3);
    expect(h.canRedo()).toBe(false);
  });

  it('keeps a bounded number of steps and can record silently', () => {
    const { api, h } = setup(5);
    for (let i = 1; i <= 10; i++) {
      api.getState().setA(i);
      h.checkpoint();
    }
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(5);
    expect(api.getState().a).toBe(5);
    h.clear();
    h.silently(() => api.getState().setA(42));
    expect(h.canUndo()).toBe(false);
  });
});

describe('store history', () => {
  const s = () => useStore.getState();
  beforeEach(() => {
    s().resetAll();
    useStore.setState({ templates: [] });
    history.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('tracks exactly the persisted project keys (new fields are picked up automatically)', () => {
    s().addBin(0, 0, 1, 1);
    history.checkpoint();
    // Every key of the project file that lives in the store is restored by undo.
    const file = projectFile(s()) as Record<string, unknown>;
    const keys = Object.keys(file).filter((k) => k in s());
    useStore.setState({ templates: [{ id: 't', name: 'T', opts: s().newBin }] });
    history.undo();
    expect(s().templates).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['drawers', 'bins', 'setup', 'newBin', 'include', 'templates']));
  });

  it('undoes bin edits but not UI changes', () => {
    const id = s().addBin(0, 0, 2, 1);
    history.checkpoint();
    s().setUI({ tab: 'print', units: 'in' });
    expect(history.canUndo()).toBe(true);
    s().updateBin(id, { opts: { heightUnits: 6 } });
    history.checkpoint();
    history.undo();
    expect(s().bins[0].opts.heightUnits).toBe(3);
    expect(s().ui.units).toBe('in');
    history.undo();
    expect(s().bins).toHaveLength(0);
    // The selection pointed at the bin that's gone.
    expect(s().ui.selectedBinId).toBeNull();
    history.redo();
    expect(s().bins).toHaveLength(1);
  });

  it('coalesces a slider drag into one step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    for (let i = 1; i <= 10; i++) {
      s().setNewBin({ scoop: i / 10 });
      vi.advanceTimersByTime(30);
    }
    vi.advanceTimersByTime(1000);
    s().setSetup({ spacing: 7 });
    history.undo();
    expect(s().newBin.scoop).toBe(1);
    expect(s().setup.spacing).not.toBe(7);
    history.undo();
    expect(s().newBin.scoop).toBe(0);
  });

  it('switching drawers is not a step; undo goes back to the drawer that changed', () => {
    const first = s().activeDrawerId;
    s().addBin(0, 0, 1, 1);
    history.checkpoint();
    const second = s().addDrawer('B');
    history.checkpoint();
    s().addBin(1, 1, 1, 1);
    history.checkpoint();
    s().switchDrawer(first);
    history.checkpoint();
    s().switchDrawer(second);
    history.checkpoint();
    s().switchDrawer(first);
    // Undo removes the bin in B, showing B.
    history.undo();
    expect(s().activeDrawerId).toBe(second);
    expect(s().bins).toHaveLength(0);
    history.undo(); // adding drawer B
    expect(s().drawers).toHaveLength(1);
    expect(s().activeDrawerId).toBe(first);
    expect(s().bins).toHaveLength(1);
    history.redo();
    history.redo();
    expect(allDrawers(s()).map((d) => d.bins.length)).toEqual([1, 1]);
  });

  it('opening a project can be undone', () => {
    s().addBin(0, 0, 1, 1);
    history.checkpoint();
    s().loadProject({ app: 'gridfit', drawer: { width: 300, depth: 200 } });
    expect(s().bins).toHaveLength(0);
    history.undo();
    expect(s().bins).toHaveLength(1);
    expect(s().drawer.width).toBe(510.5);
  });
});
