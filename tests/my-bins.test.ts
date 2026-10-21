import { beforeEach, describe, expect, it } from 'vitest';
import { cleanBins, history, projectFile, useStore } from '../src/state/store';
import {
  MY_BINS_KEY,
  deleteMyBin,
  duplicateMyBin,
  importMyBins,
  loadLibrary,
  myBinAsTemplate,
  myBinsFileText,
  placeMyBin,
  reloadMyBins,
  renameMyBin,
  saveToMyBins,
  setLibraryStorage,
  undoDeleteMyBin,
  useMyBins,
  type KeyValueStore,
} from '../src/state/myBins';
import {
  MY_BINS_VERSION,
  binsInCells,
  cleanEntry,
  cleanLibrary,
  entryFingerprint,
  entryMatches,
  libraryData,
  mergeLibrary,
  planPlacement,
  readLibraryData,
  type LibraryEntry,
} from '../src/lib/myBins';
import { DEFAULT_BIN, binSize, binTotalHeight, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { binSeatHeight } from '../src/lib/geometry/baseplate';
import { binCellsAt, binSpec, lidSpec, planJob, type PlacedBin } from '../src/lib/project';
import { computeLayout } from '../src/lib/layout/drawer';
import { placedOvershoot, usableBeds } from '../src/lib/bedfit';
import { stackPlaces } from '../src/lib/stacking';
import { projectOf } from '../src/state/store';

/** localStorage, in memory. */
class FakeStorage implements KeyValueStore {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, String(v));
  }
}

/** Storage that's full: every write fails the way browsers fail it. */
class FullStorage extends FakeStorage {
  setItem() {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }
}

const s = () => useStore.getState();
const lib = () => useMyBins.getState();
const stored = (st: FakeStorage) => JSON.parse(st.getItem(MY_BINS_KEY)!);
const bin = (id: string) => s().bins.find((b) => b.id === id)!;

/** A bin with a bit of everything: compartments, scoop, label from its contents, magnets, a lid. */
const RICH: Partial<BinOptions> = { heightUnits: 6, divX: 3, divY: 2, scoop: 0.5, label: 'full', labelText: '{contents}', holes: 'magnets', lid: true };

function addRich(x = 0, y = 0, w = 2, d = 3): string {
  const id = s().addBin(x, y, w, d);
  s().updateBin(id, { opts: RICH });
  s().setBinContents(id, 'M3 screws\nM3 nuts');
  return id;
}

let store: FakeStorage;

beforeEach(() => {
  s().resetAll();
  useStore.setState({ templates: [], tools: [] });
  history.clear();
  store = new FakeStorage();
  setLibraryStorage(store);
});

describe('My bins storage', () => {
  it('keeps the library under its own key, through a new project, another project file and a reload', () => {
    const id = addRich();
    const [e] = saveToMyBins([id], { name: 'Screws' });
    expect(e.name).toBe('Screws');
    const data = stored(store);
    expect(data).toMatchObject({ app: 'gridfit', kind: 'my-bins', version: MY_BINS_VERSION });
    expect(data.bins).toHaveLength(1);
    // Not part of the project: not in its file, and a new project or another file leaves it alone.
    expect(JSON.stringify(projectFile(s()))).not.toContain(e.id);
    s().resetAll();
    expect(lib().entries).toHaveLength(1);
    s().loadProject({ app: 'gridfit', version: 2, drawers: [{ id: 'x', name: 'Other', bins: [] }] });
    expect(lib().entries).toHaveLength(1);
    // A reload reads back what was saved.
    setLibraryStorage(store);
    expect(lib().entries.map((x) => x.name)).toEqual(['Screws']);
    expect(entryFingerprint(lib().entries[0])).toBe(entryFingerprint(e));
    expect(lib().status).toBe('saved');
  });

  it('works on in memory when the browser blocks storage, and says so', () => {
    setLibraryStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(lib().status).toBe('memory');
    const id = addRich();
    expect(saveToMyBins([id])).toHaveLength(1);
    expect(saveToMyBins([id])).toHaveLength(1);
    expect(lib().entries).toHaveLength(2);
    expect(lib().status).toBe('memory');
    // Nowhere to keep it at all (no localStorage).
    setLibraryStorage(null);
    expect(lib().status).toBe('memory');
  });

  it('keeps changes in memory when storage is full', () => {
    setLibraryStorage(new FullStorage());
    const id = addRich();
    saveToMyBins([id], { name: 'A' });
    expect(lib().status).toBe('full');
    saveToMyBins([id], { name: 'B' });
    // The second change builds on the first, not on the (stale) stored copy.
    expect(lib().entries.map((e) => e.name)).toEqual(['A', 'B']);
  });

  it('reads damaged storage as empty, and keeps the damaged text aside before saving over it', () => {
    store.setItem(MY_BINS_KEY, '{"kind":"my-bins", oops');
    setLibraryStorage(store);
    expect(lib().entries).toEqual([]);
    saveToMyBins([addRich()]);
    expect(store.getItem(`${MY_BINS_KEY}-unreadable`)).toBe('{"kind":"my-bins", oops');
    expect(stored(store).bins).toHaveLength(1);
  });

  it('follows other tabs: their changes show on reload, and changes here build on them', () => {
    const id = addRich();
    saveToMyBins([id], { name: 'Mine' });
    // Another tab adds one.
    const other = cleanEntry({ id: 'other', name: 'From the other tab', bins: [{ dx: 0, dy: 0, opts: { ...DEFAULT_BIN, unitsX: 3 } }] }, cleanBins)!;
    store.setItem(MY_BINS_KEY, JSON.stringify(libraryData([...stored(store).bins, other])));
    reloadMyBins();
    expect(lib().entries.map((e) => e.name)).toEqual(['Mine', 'From the other tab']);
    // And another change there, before this tab heard of it: a save here keeps it.
    store.setItem(MY_BINS_KEY, JSON.stringify(libraryData([other])));
    saveToMyBins([id], { name: 'Second' });
    expect(lib().entries.map((e) => e.name)).toEqual(['From the other tab', 'Second']);
  });

  it('never writes over a library saved by a newer version', () => {
    const text = JSON.stringify({ app: 'gridfit', kind: 'my-bins', version: MY_BINS_VERSION + 1, bins: [{ id: 'n', name: 'New', bins: [{ dx: 0, dy: 0, opts: { unitsX: 2 }, hologram: true }] }] });
    store.setItem(MY_BINS_KEY, text);
    setLibraryStorage(store);
    expect(lib().status).toBe('newer');
    expect(lib().entries.map((e) => e.name)).toEqual(['New']);
    const writes = store.writes;
    expect(saveToMyBins([addRich()])).toEqual([]);
    renameMyBin('n', 'Renamed');
    expect(deleteMyBin('n')).toBe(false);
    expect(importMyBins(text)).toHaveProperty('error');
    expect(store.writes).toBe(writes);
    expect(store.getItem(MY_BINS_KEY)).toBe(text);
  });
});

describe('My bins versions', () => {
  it('brings old entries up to date with the same cleanup as a loaded project', () => {
    // Version 0: a bare list, each entry one bin's options (like a template), from before newer options existed.
    const v0 = [{ id: 't1', name: 'Old', opts: { unitsX: 2, unitsY: 1, heightUnits: 999, holes: 'bogus', divX: 2 } }, { name: 'No options' }, null];
    const r = readLibraryData(v0);
    expect(r).toEqual({ version: 0, entries: v0 });
    const [e] = cleanLibrary((r as { entries: unknown[] }).entries, cleanBins);
    expect(cleanLibrary(v0, cleanBins)).toHaveLength(1);
    expect(e).toMatchObject({ id: 't1', name: 'Old', saved: 0 });
    expect(e.bins).toHaveLength(1);
    expect(e.bins[0]).toMatchObject({ dx: 0, dy: 0 });
    // Every option there now, with defaults for what it didn't have; bad values made valid.
    expect(e.bins[0].opts).toEqual(sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, unitsY: 1, heightUnits: 999, holes: 'bogus' as never, divX: 2 }));
    expect(e.bins[0].opts.heightUnits).toBe(30);
    expect(e.bins[0].opts.holes).toBe('none');
    // An entry saved before an option existed builds like a bin made now without it.
    const old = cleanEntry({ id: 'o', name: 'O', bins: [{ dx: 0, dy: 0, opts: { unitsX: 2, unitsY: 2, heightUnits: 4 } }] }, cleanBins)!;
    expect(old.bins[0].opts).toEqual(sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 4 }));
  });

  it('keeps options from newer versions, and drops what it can’t use', () => {
    const e = cleanEntry(
      {
        id: 'x',
        name: '   Lots   of   space   ',
        bins: [
          { dx: 5, dy: 5, opts: { ...DEFAULT_BIN, unitsX: 2, futureField: { a: 1 } }, contents: 'bolts\u0007' },
          // Overlaps the first: left out, with what stands on it.
          { dx: 6, dy: 5, opts: { ...DEFAULT_BIN } },
          { dx: 6, dy: 5, opts: { ...DEFAULT_BIN }, on: 1 },
          // Stacked on the first: takes its footprint.
          { dx: 9, dy: 9, opts: { ...DEFAULT_BIN, unitsX: 1 }, on: 0 },
          { dx: 0, dy: 0 },
        ],
      },
      cleanBins,
    )!;
    expect(e.name).toBe('Lots of space');
    expect(e.bins).toHaveLength(2);
    expect((e.bins[0].opts as unknown as { futureField: unknown }).futureField).toEqual({ a: 1 });
    expect(e.bins[0]).toMatchObject({ dx: 0, dy: 0, contents: 'bolts' });
    expect(e.bins[1]).toMatchObject({ dx: 0, dy: 0, on: 0 });
    expect(e.bins[1].opts.unitsX).toBe(2);
    expect(cleanEntry({ bins: [] }, cleanBins)).toBeNull();
    expect(cleanEntry('nope', cleanBins)).toBeNull();
    expect(readLibraryData({ app: 'gridfit', version: 2, drawers: [] })).toHaveProperty('error');
    expect(readLibraryData({ hello: 1 })).toHaveProperty('error');
    expect(importMyBins('not json')).toHaveProperty('error');
  });
});

describe('placing from My bins', () => {
  it('round-trips a bin: the copy in a new project builds the same bin, lid and contents', () => {
    const id = addRich(3, 2);
    const before = bin(id);
    const layout = computeLayout(s().drawer);
    const spec = binSpec(layout, before);
    const lid = lidSpec(layout, before);
    const [e] = saveToMyBins([id]);
    // Named from its label (its contents fill it in).
    expect(e.name).toBe('M3 screws');
    s().resetAll();
    const r = placeMyBin(e.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes).toEqual([]);
    const placed = bin(r.ids[0]);
    expect(placed).toMatchObject({ x: 0, y: 0, contents: 'M3 screws\nM3 nuts' });
    expect(placed.opts).toEqual(before.opts);
    expect(binSpec(computeLayout(s().drawer), placed).key).toBe(spec.key);
    expect(lidSpec(computeLayout(s().drawer), placed).key).toBe(lid.key);
    // Selected, on the drawer grid.
    expect(s().ui).toMatchObject({ selectedBinId: placed.id, binPane: 'drawer' });
  });

  it('can leave out what’s in it', () => {
    const [e] = saveToMyBins([addRich()], { contents: false });
    expect(e.bins[0].contents).toBeUndefined();
    s().resetAll();
    const r = placeMyBin(e.id);
    expect(r.ok && bin(r.ids[0]).contents).toBeUndefined();
  });

  it('goes to the first free spot, around bins and blocked cells, as one undo step', () => {
    const big = s().addBin(0, 0, 2, 2);
    s().setDrawer({ mask: ['2,0'] });
    const [e] = saveToMyBins([s().addBin(5, 5, 2, 1)]);
    history.clear();
    const n = s().bins.length;
    const r = placeMyBin(e.id);
    expect(r.ok && r.at).toEqual([3, 0]);
    expect(s().bins).toHaveLength(n + 1);
    // At a cell of your choice when it fits there (a drop on the grid); else the first free spot.
    expect(placeMyBin(e.id, { at: [7, 6] })).toMatchObject({ ok: true, at: [7, 6] });
    expect(placeMyBin(e.id, { at: [0, 0] })).toMatchObject({ ok: true, at: [5, 0] });
    expect(s().bins).toHaveLength(n + 3);
    history.undo();
    expect(s().bins).toHaveLength(n + 2);
    history.undo();
    history.undo();
    expect(s().bins).toHaveLength(n);
    expect(s().bins.some((b) => b.id === big)).toBe(true);
  });

  it('says so when the drawer is full', () => {
    const [e] = saveToMyBins([s().addBin(0, 0, 3, 3)]);
    s().fillEmpty();
    const r = placeMyBin(e.id);
    expect(r).toEqual({ ok: false, error: 'No free 3 × 3 u spot in this drawer.' });
  });

  it('prefers full cells to narrower edge cells', () => {
    // Partial 15 mm cells fill the margins ('fit'): the first column and row are narrow.
    s().setDrawer({ width: 42 * 6 + 30 + 0.5, depth: 42 * 4 + 30 + 0.5, fill: 'fit', minFill: 10 });
    const layout = computeLayout(s().drawer);
    expect(layout.xs[1] - layout.xs[0]).toBeCloseTo(15);
    expect(layout.ys[1] - layout.ys[0]).toBeCloseTo(15);
    const id = s().addBin(3, 2, 2, 1);
    const spec = binSpec(layout, bin(id)).key;
    const [e] = saveToMyBins([id]);
    s().removeBin(id);
    const r = placeMyBin(e.id);
    expect(r.ok && r.at).toEqual([1, 1]);
    expect(r.ok && binSpec(layout, bin(r.ids[0])).key).toBe(spec);
  });

  it('cuts bins down to the printer, and with several printers to the biggest', () => {
    const id = s().addBin(0, 0, 5, 4);
    s().updateBin(id, { opts: { heightUnits: 8, divX: 2 } });
    const [e] = saveToMyBins([id]);
    s().resetAll();
    // A small printer: 150 × 150 mm bed (140 inside its margin).
    s().setSetup({ printerId: 'custom', bedW: 150, bedD: 150, plateMargin: 5, maxH: 250 });
    const r = placeMyBin(e.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const placed = bin(r.ids[0]);
    expect(r.notes.map((n) => n.kind)).toContain('bed');
    expect(placedOvershoot(computeLayout(s().drawer), placed, usableBeds(s().setup))).toBe(0);
    expect(placed.opts.unitsX * placed.opts.unitsY).toBeLessThan(20);
    // A second, bigger printer takes it whole.
    s().setSetup({ printers: [{ printerId: 'custom', bedW: 400, bedD: 400, plateMargin: 5, maxH: 400 }] });
    const r2 = placeMyBin(e.id);
    expect(r2.ok && bin(r2.ids[0]).opts).toMatchObject({ unitsX: 5, unitsY: 4, heightUnits: 8 });
    expect(r2.ok && r2.notes).toEqual([]);
  });

  it('lowers a bin to fit the drawer’s height', () => {
    const id = s().addBin(0, 0, 1, 1);
    s().updateBin(id, { opts: { heightUnits: 9 } });
    const [e] = saveToMyBins([id]);
    s().resetAll();
    s().setDrawer({ height: 40 });
    const room = 40 - binSeatHeight(s().baseplate);
    const r = placeMyBin(e.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const placed = bin(r.ids[0]);
    expect(binTotalHeight(placed.opts)).toBeLessThanOrEqual(room);
    expect(binTotalHeight({ ...placed.opts, heightUnits: placed.opts.heightUnits + 1 })).toBeGreaterThan(room);
    expect(r.notes.find((n) => n.kind === 'lowered')?.text).toBe(`It was lowered to ${placed.opts.heightUnits}u to fit the drawer.`);
    expect(planJob(projectOf(s())).drawers[0].room).toBeCloseTo(room);
  });

  it('keeps sets and stacks together', () => {
    const a = s().addBin(2, 2, 2, 2);
    const b = s().addBin(4, 2, 1, 2);
    const top = s().addBin(6, 6, 1, 1);
    useStore.setState({ bins: s().bins.map((x) => (x.id === top ? { ...x, x: 2, y: 2, opts: { ...x.opts, unitsX: 2, unitsY: 2 }, on: a } : x)) });
    const [e] = saveToMyBins([a, b]);
    expect(e.bins.map((x) => [x.dx, x.dy, x.on])).toEqual([
      [0, 0, undefined],
      [2, 0, undefined],
      [0, 0, 0],
    ]);
    s().resetAll();
    s().addBin(0, 0, 1, 1);
    const r = placeMyBin(e.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [na, nb, nt] = r.ids.map(bin);
    expect([na.x, na.y, nb.x, nb.y]).toEqual([1, 0, 3, 0]);
    expect(nt).toMatchObject({ x: na.x, y: na.y, on: na.id, opts: { unitsX: 2, unitsY: 2 } });
    const places = stackPlaces(computeLayout(s().drawer), s().bins);
    expect(places.get(nt.id)!.level).toBe(1);
    // Each on its own: one entry per bin, the stack with its floor bin.
    useStore.setState({ bins: [] });
    const a2 = s().addBin(0, 0, 2, 2);
    const b2 = s().addBin(2, 0, 1, 1);
    const t2 = s().addBin(4, 0, 1, 1);
    useStore.setState({ bins: s().bins.map((x) => (x.id === t2 ? { ...x, x: 0, y: 0, opts: { ...x.opts, unitsX: 2, unitsY: 2 }, on: a2 } : x)) });
    const made = saveToMyBins([a2, b2, t2], { separately: true });
    expect(made.map((m) => m.bins.length)).toEqual([2, 1]);
  });

  it('takes its tools along into another project’s tool library', () => {
    const tool = s().addTool({ name: 'Pliers', outline: [[-30, -10], [30, -10], [30, 10], [-30, 10]], depth: 8 });
    const id = s().addBin(0, 0, 2, 1);
    const cutout = { toolId: tool, name: 'Pliers', x: 0, y: 0, rotation: 0, outline: s().tools[0].outline, depth: 8, clearance: 1 };
    s().updateBin(id, { opts: { interior: 'cutouts', cutouts: [cutout] } });
    const [e] = saveToMyBins([id]);
    expect(e.tools?.map((t) => t.name)).toEqual(['Pliers']);
    s().resetAll();
    useStore.setState({ tools: [] });
    const r = placeMyBin(e.id);
    expect(r.ok && r.tools).toBe(1);
    expect(s().tools.map((t) => t.id)).toEqual([tool]);
    expect(r.ok && bin(r.ids[0]).opts.cutouts).toHaveLength(1);
    // Already there: not added twice.
    expect(placeMyBin(e.id)).toMatchObject({ ok: true, tools: 0 });
  });
});

describe('My bins on a half grid', () => {
  it('converts cells both ways, keeping the size in mm when it can', () => {
    s().setHalfGrid(true);
    const half = s().addBin(0, 0, 3, 2);
    const [e] = saveToMyBins([half]);
    expect(e.half).toBe(true);
    expect(e.bins[0].opts).toMatchObject({ unitsX: 3, unitsY: 2 });
    const full = s().addBin(4, 0, 4, 2);
    const [whole] = saveToMyBins([full]);
    const mm = binSize(bin(full).opts, binCellsAt(computeLayout(s().drawer), bin(full)));
    // Onto a full grid: 1.5 × 1 u rounds down to 1 × 1; 2 × 1 u stays 2 × 1.
    s().resetAll();
    const r = placeMyBin(e.id);
    expect(r.ok && bin(r.ids[0]).opts).toMatchObject({ unitsX: 1, unitsY: 1 });
    expect(r.ok && r.notes.map((n) => n.kind)).toEqual(['units']);
    const r2 = placeMyBin(whole.id);
    expect(r2.ok && bin(r2.ids[0]).opts).toMatchObject({ unitsX: 2, unitsY: 1 });
    expect(r2.ok && r2.notes).toEqual([]);
    const layout = computeLayout(s().drawer);
    expect(r2.ok && binSize(bin(r2.ids[0]).opts, binCellsAt(layout, bin(r2.ids[0])))).toEqual(mm);
    // And a full-grid bin onto a half grid: twice the cells, the same size.
    const [fromFull] = saveToMyBins([r2.ok ? r2.ids[0] : '']);
    expect(fromFull.half).toBeUndefined();
    s().setHalfGrid(true);
    const r3 = placeMyBin(fromFull.id);
    expect(r3.ok && bin(r3.ids[0]).opts).toMatchObject({ unitsX: 4, unitsY: 2 });
    expect(r3.ok && binSize(bin(r3.ids[0]).opts, binCellsAt(computeLayout(s().drawer), bin(r3.ids[0])))).toEqual(mm);
  });

  it('converts a set’s offsets with its sizes', () => {
    const e: LibraryEntry = {
      id: 'h',
      name: 'Half set',
      half: true,
      saved: 1,
      bins: [
        { dx: 0, dy: 0, opts: { ...DEFAULT_BIN, unitsX: 3, unitsY: 2 } },
        { dx: 3, dy: 0, opts: { ...DEFAULT_BIN, unitsX: 3, unitsY: 2 } },
      ],
    };
    const { bins, rounded } = binsInCells(e, false);
    expect(bins.map((b) => [b.dx, b.dy, b.opts.unitsX, b.opts.unitsY])).toEqual([
      [0, 0, 1, 1],
      [1, 0, 1, 1],
    ]);
    expect(rounded).toEqual([true, true]);
    const p = planPlacement(e, { layout: computeLayout(s().drawer), bins: [], bed: usableBeds(s().setup) });
    expect('bins' in p && p.bins.map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe('My bins: editing, files', () => {
  it('renames, duplicates, deletes with undo, finds, and saves as a template', () => {
    const [e] = saveToMyBins([addRich()], { name: 'Screws' });
    renameMyBin(e.id, '  Small screws ');
    renameMyBin(e.id, '   ');
    expect(lib().entries[0].name).toBe('Small screws');
    const copy = duplicateMyBin(e.id)!;
    expect(lib().entries.map((x) => x.name)).toEqual(['Small screws', 'Small screws copy']);
    expect(entryFingerprint(lib().entries[1])).toBe(entryFingerprint(lib().entries[0]));
    expect(deleteMyBin(e.id)).toBe(true);
    expect(lib().entries.map((x) => x.id)).toEqual([copy]);
    expect(undoDeleteMyBin()).toBe(true);
    expect(lib().entries.map((x) => x.id)).toEqual([e.id, copy]);
    expect(stored(store).bins).toHaveLength(2);
    expect(entryMatches(lib().entries[0], 'm3 NUTS')).toBe(true);
    expect(entryMatches(lib().entries[0], 'compartments small')).toBe(true);
    expect(entryMatches(lib().entries[0], 'washers')).toBe(false);
    const t = myBinAsTemplate(e.id)!;
    expect(s().templates.find((x) => x.id === t)?.opts.heightUnits).toBe(6);
  });

  it('exports a file and imports it elsewhere, adding only what isn’t there', () => {
    saveToMyBins([addRich()], { name: 'Screws' });
    saveToMyBins([s().addBin(5, 0, 1, 1)], { name: 'Plain' });
    const text = myBinsFileText();
    expect(JSON.parse(text)).toMatchObject({ kind: 'my-bins', version: MY_BINS_VERSION });
    // Another browser: an empty library.
    const there = new FakeStorage();
    setLibraryStorage(there);
    expect(importMyBins(text)).toEqual({ added: 2, updated: 0, same: 0, older: 0, invalid: 0 });
    expect(lib().entries.map((e) => e.name)).toEqual(['Screws', 'Plain']);
    expect(stored(there).bins).toHaveLength(2);
    // Again: nothing new, nothing written.
    const writes = there.writes;
    expect(importMyBins(text)).toEqual({ added: 0, updated: 0, same: 2, older: 0, invalid: 0 });
    expect(there.writes).toBe(writes);
    expect(loadLibrary(there).entries).toHaveLength(2);
  });

  it('merges by id (the newer copy wins) and by content', () => {
    const mk = (id: string, name: string, saved: number, unitsX = 1): LibraryEntry => ({ id, name, saved, bins: [{ dx: 0, dy: 0, opts: { ...DEFAULT_BIN, unitsX } }] });
    const here = [mk('a', 'A', 10), mk('b', 'B', 10, 2), mk('c', 'Shared name', 10, 3)];
    const { entries, report } = mergeLibrary(here, [
      mk('a', 'A', 10), // the same
      mk('b', 'B renamed', 20, 2), // newer: replaces
      mk('c', 'C old', 5, 3), // older: kept here
      mk('z', 'Other id', 1, 2), // the same bins as b
      mk('n', 'Shared name', 1, 4), // new, with a name that's taken
    ]);
    expect(report).toEqual({ added: 1, updated: 1, same: 2, older: 1 });
    expect(entries.map((e) => e.name)).toEqual(['A', 'B renamed', 'Shared name', 'Shared name 2']);
  });

  it('turns away project files and files from newer versions', () => {
    expect(importMyBins(JSON.stringify(projectFile(s())))).toEqual({ error: expect.stringMatching(/project file/) });
    expect(importMyBins(JSON.stringify({ kind: 'my-bins', version: MY_BINS_VERSION + 1, bins: [] }))).toEqual({ error: expect.stringMatching(/newer version/) });
    // Version 0 (a bare list) is fine.
    expect(importMyBins(JSON.stringify([{ name: 'Old', opts: { unitsX: 2 } }, { junk: true }]))).toEqual({ added: 1, updated: 0, same: 0, older: 0, invalid: 1 });
  });
});

// Placement helpers are pure: the same plan for the same drawer.
describe('planPlacement', () => {
  it('never overlaps what is there', () => {
    const layout = computeLayout({ ...s().drawer, mode: 'grid', gridX: 3, gridY: 2 });
    const there: PlacedBin[] = [{ id: 'x', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } }];
    const e: LibraryEntry = { id: 'e', name: 'E', saved: 1, bins: [{ dx: 0, dy: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } }] };
    const p = planPlacement(e, { layout, bins: there, bed: usableBeds(s().setup) });
    expect('bins' in p && p.at).toEqual([0, 1]);
    const full = planPlacement(e, { layout, bins: [...there, { id: 'y', x: 0, y: 1, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } }], bed: usableBeds(s().setup) });
    expect(full).toHaveProperty('error');
  });
});
