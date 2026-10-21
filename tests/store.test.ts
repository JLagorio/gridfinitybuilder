import { beforeEach, describe, expect, it } from 'vitest';
import { allDrawers, history, printDrawers, projectFile, useStore } from '../src/state/store';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';

const s = () => useStore.getState();

beforeEach(() => s().resetAll());

describe('drawers', () => {
  it('keeps each drawer’s bins separate when switching', () => {
    s().addBin(0, 0, 2, 1);
    const first = s().activeDrawerId;
    const second = s().addDrawer('Garage');
    expect(s().bins).toHaveLength(0);
    s().addBin(1, 1, 1, 1);
    s().addBin(2, 2, 1, 1);
    s().switchDrawer(first);
    expect(s().bins).toHaveLength(1);
    expect(s().bins[0].opts.unitsX).toBe(2);
    s().switchDrawer(second);
    expect(s().bins).toHaveLength(2);
    expect(allDrawers(s()).map((d) => [d.name, d.bins.length])).toEqual([
      ['Drawer 1', 1],
      ['Garage', 2],
    ]);
  });

  it('duplicates with fresh bin ids and deletes', () => {
    s().addBin(0, 0, 1, 1);
    const src = s().activeDrawerId;
    const copy = s().duplicateDrawer(src);
    expect(s().activeDrawerId).toBe(copy);
    expect(s().bins[0].id).not.toBe(allDrawers(s()).find((d) => d.id === src)!.bins[0].id);
    expect(allDrawers(s())[1].name).toBe('Drawer 1 copy');
    s().removeDrawer(copy);
    expect(s().drawers).toHaveLength(1);
    expect(s().activeDrawerId).toBe(src);
    s().removeDrawer(src); // never removes the last drawer
    expect(s().drawers).toHaveLength(1);
  });

  it('print scope picks drawers', () => {
    const a = s().activeDrawerId;
    const b = s().addDrawer('B');
    expect(printDrawers(s()).map((d) => d.id)).toEqual([b]);
    s().setPrintScope('all');
    expect(printDrawers(s()).map((d) => d.id)).toEqual([a, b]);
    s().setPrintScope('pick', [a]);
    expect(printDrawers(s()).map((d) => d.id)).toEqual([a]);
  });

  it('opens version 1 project files (one drawer at the top level)', () => {
    s().loadProject({
      app: 'gridfit',
      version: 1,
      drawer: { mode: 'drawer', width: 400, depth: 300 },
      baseplate: { magnets: true },
      bins: [{ id: 'q', x: 1, y: 2, opts: { unitsX: 2 } }],
      setup: { printerId: 'a1' },
    });
    expect(s().drawers).toHaveLength(1);
    expect(s().drawer.width).toBe(400);
    expect(s().drawer.widthSamples).toEqual([]);
    expect(s().drawer.fill).toBe('solid');
    expect(s().baseplate.magnets).toBe(true);
    expect(s().bins[0].opts).toEqual({ ...DEFAULT_BIN, unitsX: 2 });
  });

  it('round-trips a multi-drawer project file', () => {
    s().addBin(0, 0, 1, 1);
    s().addDrawer('Garage');
    s().setDrawer({ width: 333 });
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    s().resetAll();
    s().loadProject(file);
    expect(allDrawers(s()).map((d) => d.name)).toEqual(['Drawer 1', 'Garage']);
    expect(s().drawer.width).toBe(333);
    expect(allDrawers(s())[0].bins).toHaveLength(1);
  });
});

describe('newProject', () => {
  it('starts over with one empty drawer, keeps the printer setup and templates, and undoes in one step', () => {
    s().setSetup({ bedW: 300, bedD: 300 });
    s().addDrawer('Garage');
    s().addBin(0, 0, 2, 1);
    useStore.setState({ templates: [{ id: 't1', name: 'Mine', opts: DEFAULT_BIN } as never] });
    const before = allDrawers(s()).length;
    history.checkpoint();
    s().newProject();
    expect(allDrawers(s())).toHaveLength(1);
    expect(s().bins).toHaveLength(0);
    expect(s().setup.bedW).toBe(300);
    expect(s().templates).toHaveLength(1);
    history.undo();
    expect(allDrawers(s())).toHaveLength(before);
    expect(s().bins).toHaveLength(1);
  });
});
