import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { binSpec, lidSpec, planJob, planPrint, DEFAULT_PROJECT, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import {
  NO_PRINTS,
  binPrintMarks,
  cleanPrinted,
  coveredParts,
  fingerprint,
  markPrinted,
  printCount,
  unmarkPrinted,
  type PrintedRecord,
} from '../src/lib/printed';
import { history, projectFile, useStore } from '../src/state/store';
import { forgetPrinted, markPlates, setOnlyChanged, unmarkPlates } from '../src/state/printed';
import { decodeProject, encodeProject } from '../src/lib/share';

const bin = (id: string, x: number, y: number, ux: number, uy: number, o: Partial<BinOptions> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: { ...DEFAULT_BIN, unitsX: ux, unitsY: uy, ...o },
});
const grid = (gridX: number, gridY: number): DrawerInput => ({ ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY });
const layout = computeLayout(grid(8, 6));
const fp = (b: PlacedBin) => fingerprint(binSpec(layout, b).key);
const include = { baseplate: true, bins: true };
const drawerOf = (bins: PlacedBin[], drawer: DrawerInput = grid(8, 6)): NamedDrawer => ({ id: 'd1', name: 'Drawer 1', drawer, baseplate: DEFAULT_BASEPLATE, bins });
const plan = (bins: PlacedBin[], rec?: PrintedRecord, onlyChanged = false, drawer?: DrawerInput) =>
  planPrint([drawerOf(bins, drawer)], DEFAULT_SETUP, include, rec ? { printed: rec, onlyChanged } : {});
const all = (job: PrintJob) => job.plates.map((_, i) => i);
const onPlates = (job: PrintJob) => job.plates.flatMap((pl) => pl.placements.map((p) => p.key));

describe('part fingerprints', () => {
  it('stay the same when a bin moves, and change when it is resized or its options change', () => {
    const a = bin('a', 0, 0, 2, 1);
    expect(fp({ ...a, x: 4, y: 3 })).toBe(fp(a));
    expect(fp({ ...a, id: 'other' })).toBe(fp(a));
    // What's in it isn't geometry.
    expect(fp({ ...a, contents: 'M3 screws' })).toBe(fp(a));
    expect(fp({ ...a, opts: { ...a.opts, unitsX: 3 } })).not.toBe(fp(a));
    expect(fp({ ...a, opts: { ...a.opts, heightUnits: 6 } })).not.toBe(fp(a));
    expect(fp({ ...a, opts: { ...a.opts, holes: 'magnets' } })).not.toBe(fp(a));
    expect(fingerprint(lidSpec(layout, { ...a, x: 5 }).key)).toBe(fingerprint(lidSpec(layout, a).key));
    expect(fp(a)).toMatch(/^[0-9a-f]{14}$/);
  });

  it('change when a move puts the bin on cells of another size', () => {
    // 40 mm of leftover depth becomes a row of partial cells at the back.
    const drawer: DrawerInput = { ...DEFAULT_DRAWER, width: 126.5, depth: 124.5, clearance: 0.5, fill: 'fit', alignY: 0 };
    const l = computeLayout(drawer);
    const a = bin('a', 0, 0, 1, 1);
    expect(fingerprint(binSpec(l, { ...a, x: 1 }).key)).toBe(fingerprint(binSpec(l, a).key));
    expect(fingerprint(binSpec(l, { ...a, y: 2 }).key)).not.toBe(fingerprint(binSpec(l, a).key));
  });
});

describe('marking plates as printed', () => {
  // Three identical bins and one other.
  const bins = [bin('a', 0, 0, 1, 1), bin('b', 1, 0, 1, 1), bin('c', 2, 0, 1, 1), bin('d', 3, 0, 2, 2)];

  it('counts prints per fingerprint: three identical bins are three prints of one', () => {
    const job = plan(bins);
    const rec = markPrinted(NO_PRINTS, job, all(job));
    expect(rec.counts[fp(bins[0])]).toBe(3);
    expect(rec.counts[fp(bins[3])]).toBe(1);
    expect(rec.parts['bin:a']).toBe(fp(bins[0]));
    expect(printCount(rec)).toBe(onPlates(job).length);
    // Marking again changes nothing.
    expect(markPrinted(rec, { ...job, printed: [...coveredParts(job, rec)] }, all(job))).toEqual(rec);
    expect(coveredParts(job, rec).size).toBe(onPlates(job).length);
  });

  it('covers the very parts that were marked, when identical ones are on other plates', () => {
    // Two plates of identical bins: mark the second.
    const many = Array.from({ length: 30 }, (_, i) => bin(`s${i}`, i % 8, Math.floor(i / 8), 1, 1));
    const job = planPrint([drawerOf(many)], DEFAULT_SETUP, { baseplate: false, bins: true });
    expect(job.plates.length).toBe(2);
    const rec = markPrinted(NO_PRINTS, job, [1]);
    const covered = coveredParts(job, rec);
    expect(job.plates[1].placements.every((p) => covered.has(p.key))).toBe(true);
    expect(job.plates[0].placements.some((p) => covered.has(p.key))).toBe(false);
    // And unmarking takes them back.
    expect(unmarkPrinted(rec, job, [1])).toEqual(NO_PRINTS);
  });

  it('shows printed and changed bins', () => {
    const job = plan(bins);
    const rec = markPrinted(NO_PRINTS, job, all(job));
    const moved = bins.map((b) => (b.id === 'a' ? { ...b, x: 6, y: 4 } : b.id === 'd' ? { ...b, opts: { ...b.opts, heightUnits: 5 } } : b));
    const marks = binPrintMarks(planJob({ ...DEFAULT_PROJECT, drawer: grid(8, 6), bins: [...moved, bin('n', 0, 5, 1, 1)] }), rec);
    expect(marks).toEqual({ a: 'printed', b: 'printed', c: 'printed', d: 'changed' });
  });
});

describe('only what’s changed', () => {
  const bins = [bin('a', 0, 0, 1, 1), bin('b', 1, 0, 1, 1), bin('c', 2, 0, 1, 1), bin('d', 3, 0, 2, 2, { lid: true })];
  const printed = () => {
    const job = plan(bins);
    return markPrinted(NO_PRINTS, job, all(job));
  };

  it('leaves out what is printed, by fingerprint and count, and packs the rest', () => {
    const rec = printed();
    // Everything printed: nothing left.
    const none = plan(bins, rec, true);
    expect(none.plates).toEqual([]);
    expect(none.leftOut?.length).toBe(Object.keys(none.parts).length);
    // Move a bin, resize one, add one identical to a printed bin and one new: the moved one stays printed.
    const next = [{ ...bins[0], x: 6 }, bins[1], { ...bins[2], opts: { ...bins[2].opts, unitsY: 2 } }, bins[3], bin('e', 0, 4, 1, 1), bin('f', 1, 4, 3, 1)];
    const job = plan(next, rec, true);
    expect(onPlates(job).sort()).toEqual(['bin:c', 'bin:f']);
    // The resized bin's old print stands in for the new identical one.
    const pieces = Object.keys(job.parts).filter((k) => k.startsWith('piece:'));
    expect(pieces.length).toBe(4);
    expect(job.leftOut?.sort()).toEqual(['bin:a', 'bin:b', 'bin:d', 'bin:e', 'lid:d', ...pieces].sort());
    expect(job.printed).toEqual([]);
    // Re-packed: one plate of bins, no baseplate plate.
    expect(job.plates.map((pl) => pl.name)).toEqual(['Bins 1']);
    // Without the switch, the same record just marks what's printed.
    const full = plan(next, rec, false);
    expect(full.leftOut).toBeUndefined();
    expect(full.printed?.sort()).toEqual(job.leftOut?.sort());
    expect(onPlates(full).length).toBe(Object.keys(full.parts).length);
  });

  it('reprints the baseplate when the drawer changes', () => {
    const rec = printed();
    const job = plan(bins, rec, true, grid(9, 6));
    expect(job.plates.some((pl) => pl.group === 'baseplate')).toBe(true);
    expect(job.leftOut).toEqual(expect.arrayContaining(['bin:a', 'bin:d']));
    // Repacking the pieces that are left keeps the assembly map right.
    const big = { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 };
    const whole = plan([], undefined, false, big);
    const firstPlate = markPrinted(NO_PRINTS, whole, [0]);
    const rest = plan([], firstPlate, true, big);
    expect(rest.plates.length).toBe(whole.plates.length - 1);
    expect(rest.drawers[0].plan.plates.flatMap((pl) => pl.placements.map((p) => p.key)).sort()).toEqual(
      whole.plates.slice(1).flatMap((pl) => pl.placements.map((p) => p.key)).sort(),
    );
  });
});

describe('the print record in the project', () => {
  const s = () => useStore.getState();
  const job = () => planJob({ ...DEFAULT_PROJECT, drawer: s().drawer, bins: s().bins, include: s().include, setup: s().setup });
  beforeEach(() => {
    s().resetAll();
    s().setDrawer({ mode: 'grid', gridX: 6, gridY: 4 });
    s().addBin(0, 0, 1, 1);
    s().addBin(1, 0, 2, 1);
    history.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is undoable', () => {
    const j = job();
    markPlates(j, all(j));
    expect(printCount(s().printed)).toBe(onPlates(j).length);
    unmarkPlates({ ...j, printed: [...coveredParts(j, s().printed)] }, [0]);
    expect(printCount(s().printed)).toBe(onPlates(j).length - j.plates[0].placements.length);
    history.undo();
    expect(printCount(s().printed)).toBe(onPlates(j).length);
    history.undo();
    expect(s().printed).toEqual(NO_PRINTS);
    history.redo();
    forgetPrinted();
    expect(s().printed).toEqual(NO_PRINTS);
    history.undo();
    expect(printCount(s().printed)).toBe(onPlates(j).length);
  });

  it('round-trips through a project file and a share link, and old files load without one', () => {
    const j = job();
    markPlates(j, all(j));
    setOnlyChanged(true);
    const rec = s().printed;
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    expect(file.printed).toEqual(rec);
    s().resetAll();
    expect(s().printed).toEqual(NO_PRINTS);
    s().loadProject(file);
    expect(s().printed).toEqual(rec);
    expect(s().onlyChanged).toBe(true);
    s().resetAll();
    s().loadProject(decodeProject(encodeProject(file)));
    expect(s().printed).toEqual(rec);
    // A file from before.
    const { printed: _p, onlyChanged: _o, ...old } = file;
    s().loadProject(old);
    expect(s().printed).toEqual(NO_PRINTS);
    expect(s().onlyChanged).toBe(false);
    // Hand-edited nonsense is dropped.
    expect(cleanPrinted({ counts: { x: -1, y: 2.7, z: 'q' }, parts: { 'bin:a': 3 } })).toEqual({ counts: { y: 2 }, parts: {} });
  });

  it('comes back with an autosaved session', async () => {
    const j = job();
    markPlates(j, all(j));
    const state = JSON.parse(JSON.stringify({ printed: s().printed, onlyChanged: true, setup: s().setup }));
    for (const [saved, want] of [
      [state, state.printed],
      [{ setup: state.setup }, NO_PRINTS],
    ]) {
      const store = new Map([['gridfit-project', JSON.stringify({ version: 2, state: saved })]]);
      vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: () => {} } });
      vi.resetModules();
      const { useStore: fresh } = await import('../src/state/store');
      expect(fresh.getState().printed).toEqual(want);
    }
  });
});
