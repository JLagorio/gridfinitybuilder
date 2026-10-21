import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE, type BaseplateOptions } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER, computeLayout, insideHeight, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { assemblyMaps, planJob, planPrint, printsBaseplate, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { billOfMaterials } from '../src/lib/bom';
import { projectChecks } from '../src/lib/printability';
import { planTestFit } from '../src/lib/testfit';
import { coveredParts, markPrinted, NO_PRINTS } from '../src/lib/printed';
import { exportPlatesZip } from '../src/lib/export/threemf';
import { exportPlatesStlZip } from '../src/lib/export/stl';
import { exportBambuProject } from '../src/lib/export/bambu';
import { drawerAssemblies } from '../src/lib/export/step';
import { drawerRoom } from '../src/lib/autofill';
import { decodeProject, encodeProject } from '../src/lib/share';
import { haveWhat, notPrintedNote, nothingToPrint } from '../src/lib/haveBaseplate';
import { allDrawers, history, printDrawers, projectFile, useStore } from '../src/state/store';

const bin = (id: string, x: number, y: number, ux: number, uy: number, o: Partial<BinOptions> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: { ...DEFAULT_BIN, unitsX: ux, unitsY: uy, ...o },
});
const BINS = [bin('a', 0, 0, 2, 1, { lid: true }), bin('b', 2, 0, 1, 1, { holes: 'magnets' }), bin('c', 0, 1, 3, 2, { divX: 3 })];
/** A baseplate with everything that adds parts or hardware: keys, pads, magnets, screws. */
const BUSY: BaseplateOptions = { ...DEFAULT_BASEPLATE, connector: 'bowtie', magnets: true, screws: true, pads: 'dots' };
const drawerOf = (drawer: Partial<DrawerInput>, bins: PlacedBin[] = BINS, baseplate: BaseplateOptions = BUSY, id = 'd1'): NamedDrawer => ({
  id,
  name: `Drawer ${id}`,
  drawer: { ...DEFAULT_DRAWER, ...drawer },
  baseplate,
  bins,
});
const ALL = { baseplate: true, bins: true };
const plan = (d: NamedDrawer | NamedDrawer[], include = ALL, setup: PrintSetup = DEFAULT_SETUP): PrintJob => planPrint(Array.isArray(d) ? d : [d], setup, include);
const have = (d: NamedDrawer): NamedDrawer => ({ ...d, drawer: { ...d.drawer, haveBaseplate: true } });
const onPlates = (job: PrintJob) => job.plates.flatMap((pl) => pl.placements.map((p) => job.parts[p.key]));
const kinds = (job: PrintJob) => new Set(onPlates(job).map((p) => p.kind));
/** The bins' side of a job: their plates, and every part that isn't the baseplate's. */
const binSide = (job: PrintJob) => ({
  plates: job.plates.filter((p) => p.group === 'bins'),
  parts: Object.fromEntries(Object.entries(job.parts).filter(([, p]) => !['piece', 'key', 'pad', 'enclosure'].includes(p.kind))),
});
const tiny = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) } as MeshData;

describe('a drawer that prints just bins (haveBaseplate)', () => {
  // The default drawer (510.5 × 376.5) splits into several pieces on the default 256 mm bed.
  const off = plan(drawerOf({}));
  const on = plan(have(drawerOf({})));

  it('prints no baseplate pieces, connector keys or pads', () => {
    expect(kinds(off)).toEqual(new Set(['piece', 'key', 'pad', 'bin', 'lid']));
    expect(kinds(on)).toEqual(new Set(['bin', 'lid']));
    expect(on.plates.every((p) => p.group === 'bins')).toBe(true);
    expect(on.drawers[0]).toMatchObject({ haveBaseplate: true, plateCount: 0, connectors: [], steps: [] });
  });

  it('plans the bins exactly as with the baseplate', () => {
    expect(binSide(on)).toEqual(binSide(off));
    for (const p of Object.values(binSide(on).parts)) expect(on.meshes[p.meshKey]).toEqual(off.meshes[p.meshKey]);
    expect(on.layout).toEqual(off.layout);
  });

  it('keeps the grid, in one piece, for the view only', () => {
    expect(off.plan.pieces.length).toBeGreaterThan(1);
    expect(on.plan.pieces).toHaveLength(1);
    const piece = on.parts['piece:1'];
    expect(piece.name).toMatch(/not printed/);
    expect(on.meshes[piece.meshKey]).toMatchObject({ kind: 'piece' });
    expect(onPlates(on).some((p) => p.kind === 'piece')).toBe(false);
  });

  it('never warns that the baseplate is too big to split (the bins still have to fit the bed)', () => {
    // 30 mm of usable bed: no 42 mm cell fits, and no 1 × 1 bin either.
    const tinyBed: PrintSetup = { ...DEFAULT_SETUP, bedW: 40, bedD: 40, plateMargin: 5 };
    const d = drawerOf({ mode: 'grid', gridX: 4, gridY: 3 }, [bin('a', 0, 0, 1, 1)], DEFAULT_BASEPLATE);
    const split = (w: string) => /split the baseplate/.test(w);
    expect(plan(d, ALL, tinyBed).warnings.some(split)).toBe(true);
    const mine = plan(have(d), ALL, tinyBed).warnings;
    expect(mine.some(split)).toBe(false);
    expect(mine).toEqual(plan(d, ALL, tinyBed).warnings.filter((w) => !split(w)));
    expect(mine.some((w) => /larger than the print bed/.test(w))).toBe(true);
  });

  it('follows the export switches on top: nothing without bins', () => {
    expect(plan(have(drawerOf({})), { baseplate: false, bins: true }).plates).toEqual(on.plates);
    expect(plan(have(drawerOf({})), { baseplate: true, bins: false }).plates).toEqual([]);
    expect(printsBaseplate(have(drawerOf({})), ALL)).toBe(false);
    expect(printsBaseplate(drawerOf({}), ALL)).toBe(true);
    expect(printsBaseplate(drawerOf({}), { baseplate: false, bins: true })).toBe(false);
  });

  it('checks bins against the height given with grid units', () => {
    const tall = [bin('t', 0, 0, 1, 1, { heightUnits: 6 })];
    const grid = drawerOf({ mode: 'grid', gridX: 4, gridY: 3, height: 30 }, tall);
    const taller = (j: PrintJob) => j.warnings.some((w) => /taller than the drawer/.test(w));
    // A grid-unit drawer never asks for its height (a stale one from drawer mode stays out of it)...
    expect(taller(plan(grid))).toBe(false);
    expect(insideHeight(grid.drawer)).toBe(0);
    // ...a bins-only one does.
    expect(taller(plan(have(grid)))).toBe(true);
    expect(insideHeight(have(grid).drawer)).toBe(30);
    expect(drawerRoom(have(grid).drawer, DEFAULT_BASEPLATE)).toBeCloseTo(30 - 0, 6);
    expect(drawerRoom(grid.drawer, DEFAULT_BASEPLATE)).toBe(Infinity);
  });

  it('counts only the bins in the bill of materials', () => {
    const a = billOfMaterials(off);
    const b = billOfMaterials(on);
    expect(a.parts.pieces).toBeGreaterThan(0);
    expect(b.parts).toEqual({ ...a.parts, pieces: 0, keys: 0, pads: undefined });
    // The baseplate's magnets and screws go; the bins' magnets stay.
    const magnets = (bom: typeof a) => bom.hardware.filter((h) => /magnet/i.test(h.item)).reduce((t, h) => t + h.count, 0);
    expect(magnets(b)).toBe(4);
    expect(magnets(a)).toBeGreaterThan(magnets(b));
    expect(b.hardware.some((h) => /screw/i.test(h.item))).toBe(false);
    expect(b.plates.map((p) => p.name)).toEqual(a.plates.filter((p) => p.name.startsWith('Bins')).map((p) => p.name));
  });

  it('runs no baseplate print checks', () => {
    const fine = drawerOf({}, BINS, { ...DEFAULT_BASEPLATE, topTrim: 0.05 });
    const rules = (d: NamedDrawer) => projectChecks([d], DEFAULT_SETUP, ALL).map((c) => c.rule);
    expect(rules(fine)).toContain('ridge-trim');
    expect(rules(have(fine))).not.toContain('ridge-trim');
    expect(rules(have(fine))).toEqual(rules(fine).filter((r) => r !== 'ridge-trim'));
  });

  it('exports only bins: plates, zips, Bambu project and the assembled drawer', () => {
    const asked = new Set<string>();
    const get = (k: string) => (asked.add(k), tiny);
    const zip = unzipSync(exportPlatesZip(on, DEFAULT_SETUP, get));
    expect(Object.keys(zip).filter((n) => n.endsWith('.3mf'))).toEqual(on.plates.map((p, i) => `${String(i + 1).padStart(2, '0')}-${p.name.toLowerCase().replace(' ', '-')}.3mf`));
    expect(Object.keys(zip).some((n) => n.startsWith('assembly-map'))).toBe(false);
    const readme = strFromU8(zip['README.txt']);
    expect(readme).toMatch(/not printed \(you have it\): just bins/);
    expect(readme).not.toMatch(/Baseplate pieces are numbered/);
    expect(Object.keys(unzipSync(exportPlatesStlZip(on, get))).every((n) => n.startsWith('0') && n.includes('bins'))).toBe(true);
    unzipSync(exportBambuProject(on, DEFAULT_SETUP, get));
    for (const k of asked) expect(on.meshes[k].kind, k).not.toBe('piece');
    expect(assemblyMaps(on)).toEqual({});
    const [asm] = drawerAssemblies(on, [have(drawerOf({}))]);
    expect(asm.items.some((i) => on.meshes[i.meshKey].kind === 'piece')).toBe(false);
    expect(asm.items.map((i) => i.name)).toEqual(drawerAssemblies(off, [drawerOf({})])[0].items.filter((i) => off.meshes[i.meshKey].kind !== 'piece').map((i) => i.name));
  });

  it('reprints only changed bins, and never asks for the baseplate', () => {
    const rec = markPrinted(NO_PRINTS, off, off.plates.map((_, i) => i));
    // Everything printed with the baseplate covers the bins-only job's parts too.
    expect(coveredParts(on, rec).size).toBe(onPlates(on).length);
    const changed = planPrint([have(drawerOf({}, [...BINS.slice(0, 2), bin('c', 0, 1, 3, 2, { divX: 2 })]))], DEFAULT_SETUP, ALL, { printed: rec, onlyChanged: true });
    expect(onPlates(changed).map((p) => p.key)).toEqual(['bin:c']);
  });

  it('makes the test-fit kit just the bin', () => {
    const kit = planTestFit(BUSY, DEFAULT_BIN, DEFAULT_SETUP, { x: 42, y: 42 }, { haveBaseplate: true });
    expect(onPlates(kit).map((p) => p.kind)).toEqual(['bin']);
    expect(kit.drawers[0].haveBaseplate).toBe(true);
    expect(onPlates(planTestFit(BUSY, DEFAULT_BIN, DEFAULT_SETUP)).map((p) => p.kind).sort()).toEqual(['bin', 'key', 'piece', 'piece']);
  });
});

describe('a project with one drawer of each', () => {
  const a = drawerOf({ mode: 'grid', gridX: 4, gridY: 3 }, BINS, BUSY, 'a');
  const b = have(drawerOf({ mode: 'grid', gridX: 5, gridY: 4 }, [bin('x', 0, 0, 2, 2), bin('y', 3, 3, 1, 1)], BUSY, 'b'));
  const job = plan([a, b]);

  it('prints the one baseplate and every bin', () => {
    const pieces = onPlates(job).filter((p) => p.kind === 'piece' || p.kind === 'key' || p.kind === 'pad');
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.drawer === 'a')).toBe(true);
    const bins = onPlates(job).filter((p) => p.kind === 'bin').map((p) => p.key);
    expect(bins.sort()).toEqual(['a/bin:a', 'a/bin:b', 'a/bin:c', 'b/bin:x', 'b/bin:y']);
    expect(job.drawers.map((d) => !!d.haveBaseplate)).toEqual([false, true]);
    expect(job.drawers[1].plateCount).toBe(0);
    expect(Object.keys(assemblyMaps(job))).toEqual(['assembly-map-drawer-a.txt']);
  });

  it('plans each drawer like it does on its own', () => {
    const alone = plan(b);
    expect(binSide(alone).plates.flatMap((p) => p.placements.map((q) => q.key))).toEqual(['bin:x', 'bin:y']);
    const bom = billOfMaterials(job);
    expect(bom.parts.pieces).toBe(billOfMaterials(plan(a)).parts.pieces);
    expect(bom.parts.bins).toBe(5);
  });
});

describe('enclosures that are there already', () => {
  const tall = bin('t', 0, 0, 1, 1, { heightUnits: 8 });

  it('carry case: no body, lid, pins, handle or feet print; the bins still fit it', () => {
    const d = drawerOf({ mode: 'grid', gridX: 2, gridY: 2, enclosure: 'case', carryCase: { height: 30, feet: 'printed' } }, [tall, bin('s', 1, 0, 1, 1)], DEFAULT_BASEPLATE);
    const off = plan(d);
    const on = plan(have(d));
    expect(kinds(off)).toEqual(new Set(['piece', 'enclosure', 'bin']));
    expect(kinds(on)).toEqual(new Set(['bin']));
    // The case's own warnings go; the bins' stay.
    expect(on.warnings.some((w) => /taller than the case/.test(w))).toBe(true);
    expect(on.warnings).toEqual(off.warnings.filter((w) => /^Bin /.test(w)));
    // Still drawn: the case and its parts, for the view.
    expect(on.drawers[0].enclosure?.kind).toBe('case');
    expect(on.drawers[0].enclosure?.items.length).toBeGreaterThan(0);
    for (const it of on.drawers[0].enclosure!.items) expect(on.meshes[it.meshKey], it.id).toBeDefined();
    expect(binSide(on).plates).toEqual(binSide(off).plates);
  });

  it('a case too big to carry or print is no concern when you have it', () => {
    const big = drawerOf({ mode: 'grid', gridX: 12, gridY: 4, enclosure: 'case' }, [bin('a', 0, 0, 1, 1)], DEFAULT_BASEPLATE);
    expect(plan(big).warnings.some((w) => /bigger than is practical/.test(w))).toBe(true);
    expect(plan(have(big)).warnings).toEqual([]);
  });

  it('wall grid: no pieces or cleat print; bins without magnets are still warned about', () => {
    const d = drawerOf({ mode: 'grid', gridX: 4, gridY: 3, enclosure: 'wall', wallMount: { cleat: true } }, [bin('a', 0, 0, 1, 1)], { ...DEFAULT_BASEPLATE, magnets: true });
    const off = plan(d);
    const on = plan(have(d));
    expect(onPlates(off).some((p) => p.enclosure === 'cleat')).toBe(true);
    expect(kinds(on)).toEqual(new Set(['bin']));
    expect(on.warnings.some((w) => /no magnets in its feet/.test(w))).toBe(true);
    const noMagnets = plan(have({ ...d, baseplate: DEFAULT_BASEPLATE }));
    expect(noMagnets.warnings.some((w) => /Wall grid without magnet pockets/.test(w))).toBe(false);
  });

  it('spacer strips: neither the baseplate nor the strips print', () => {
    const d = drawerOf({ width: 330, depth: 250, fill: 'spacers', alignX: 0 }, [bin('a', 0, 0, 1, 1)], DEFAULT_BASEPLATE);
    const off = plan(d);
    const on = plan(have(d));
    expect(onPlates(off).some((p) => p.enclosure === 'spacer')).toBe(true);
    expect(kinds(on)).toEqual(new Set(['bin']));
    expect(on.drawers[0].enclosure?.items.some((i) => i.role === 'strip')).toBe(true);
    expect(haveWhat(d.drawer)).toBe('baseplate and spacer strips');
    expect(notPrintedNote(d.drawer)).toBe('baseplate and spacer strips not printed (you have them)');
  });
});

describe('saving a bins-only drawer', () => {
  const s = () => useStore.getState();
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Just bins on an empty drawer switches to grid units; with bins it keeps the size as it is', () => {
    expect(s().drawer.mode).toBe('drawer');
    s().setHaveBaseplate(true);
    expect(s().drawer).toMatchObject({ mode: 'grid', haveBaseplate: true, width: DEFAULT_DRAWER.width });
    s().setHaveBaseplate(false);
    expect('haveBaseplate' in s().drawer).toBe(false);
    expect(s().drawer.mode).toBe('grid');
    s().setDrawer({ mode: 'drawer' });
    s().addBin(0, 0, 1, 1);
    s().setHaveBaseplate(true);
    expect(s().drawer).toMatchObject({ mode: 'drawer', haveBaseplate: true });
    expect(planJob(s()).plates.every((p) => p.group === 'bins')).toBe(true);
  });

  it('is one undo step', () => {
    s().setDrawer({ width: 400 });
    s().setHaveBaseplate(true);
    expect(history.undo()).toBe(true);
    expect(s().drawer).toMatchObject({ mode: 'drawer', width: 400 });
    expect('haveBaseplate' in s().drawer).toBe(false);
    expect(history.redo()).toBe(true);
    expect(s().drawer).toMatchObject({ mode: 'grid', haveBaseplate: true });
  });

  it('a new drawer for a baseplate you have starts in grid units; plain new drawers print theirs', () => {
    const id = s().addDrawer(undefined, { haveBaseplate: true });
    expect(s().activeDrawerId).toBe(id);
    expect(s().drawer).toMatchObject({ mode: 'grid', haveBaseplate: true });
    s().setDrawer({ gridX: 5, gridY: 4 });
    s().addDrawer('Plain');
    expect('haveBaseplate' in s().drawer).toBe(false);
    // Duplicates, drawer switches and "Fill from a list" overflow drawers keep it.
    s().switchDrawer(id);
    expect(s().drawer).toMatchObject({ gridX: 5, gridY: 4, haveBaseplate: true });
    const copy = s().duplicateDrawer(id);
    expect(allDrawers(s()).find((d) => d.id === copy)!.drawer.haveBaseplate).toBe(true);
    s().addBins([], { newDrawers: [[{ x: 0, y: 0, opts: { ...DEFAULT_BIN } }]] });
    const docs = allDrawers(s());
    expect(docs[docs.findIndex((d) => d.id === copy) + 1].drawer.haveBaseplate).toBe(true);
  });

  it('round-trips through a project file and a share link', () => {
    s().setHaveBaseplate(true);
    s().setDrawer({ gridX: 5, gridY: 4, height: 60 });
    s().addBin(0, 0, 2, 1);
    s().addDrawer('With plate');
    const file = projectFile(s());
    for (const data of [JSON.parse(JSON.stringify(file)), decodeProject(encodeProject(file))]) {
      s().resetAll();
      s().loadProject(data);
      const [first, second] = allDrawers(s());
      expect(first.drawer).toMatchObject({ mode: 'grid', gridX: 5, gridY: 4, height: 60, haveBaseplate: true });
      expect(first.bins).toHaveLength(1);
      expect('haveBaseplate' in second.drawer).toBe(false);
    }
  });

  it('opens old files and drops anything but true', () => {
    s().loadProject({ app: 'gridfit', drawer: { mode: 'grid', gridX: 3, gridY: 2 } });
    expect('haveBaseplate' in s().drawer).toBe(false);
    s().loadProject({ app: 'gridfit', drawers: [{ id: 'x', name: 'X', drawer: { haveBaseplate: 'yes' } }, { id: 'y', name: 'Y', drawer: { haveBaseplate: true } }] });
    expect(allDrawers(s()).map((d) => d.drawer.haveBaseplate)).toEqual([undefined, true]);
  });

  it('comes back with an autosaved session (and old ones come back printing their baseplate)', async () => {
    // Autosave goes to window.localStorage.
    const ls = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, v), removeItem: () => {} } });
    const load = async () => {
      vi.resetModules();
      return (await import('../src/state/store')).useStore;
    };
    const first = await load();
    first.getState().setHaveBaseplate(true);
    first.getState().addBin(0, 0, 1, 1);
    // Printing the selected bins isn't kept: the selection isn't.
    first.getState().setPrintScope('selected');
    const saved = JSON.parse(ls.get('gridfit-project')!);
    expect(saved.state.drawer.haveBaseplate).toBe(true);
    expect(saved.state.printScope).toBe('active');
    const again = await load();
    expect(again.getState().drawer).toMatchObject({ mode: 'grid', haveBaseplate: true });
    expect(again.getState().drawers[0].drawer.haveBaseplate).toBe(true);
    expect(again.getState().bins).toHaveLength(1);
    // Saved before it existed: no field, so the baseplate prints as it did.
    const strip = ({ haveBaseplate: _, ...d }: DrawerInput) => d;
    const old = { ...saved.state, drawer: strip(saved.state.drawer), drawers: saved.state.drawers.map((d: NamedDrawer) => ({ ...d, drawer: strip(d.drawer) })) };
    ls.set('gridfit-project', JSON.stringify({ version: 2, state: old }));
    const older = await load();
    expect('haveBaseplate' in older.getState().drawer).toBe(false);
    expect('haveBaseplate' in older.getState().drawers[0].drawer).toBe(false);
    expect(older.getState().bins).toHaveLength(1);
  });
});

describe('printing just the selected bins', () => {
  const s = () => useStore.getState();
  beforeEach(() => s().resetAll());

  it('plans the selected bins of the active drawer, without its baseplate', () => {
    s().setDrawer({ mode: 'grid', gridX: 4, gridY: 3 });
    const a = s().addBin(0, 0, 1, 1);
    s().addBin(1, 0, 1, 1);
    const c = s().addBin(2, 0, 2, 2);
    s().setUI({ selectedBinId: a, selectedBinIds: [a, c] });
    s().setPrintScope('selected');
    const [doc] = printDrawers(s());
    expect(doc.id).toBe(s().activeDrawerId);
    expect(doc.bins.map((b) => b.id)).toEqual([a, c]);
    const job = planPrint([doc], s().setup, s().include);
    expect(onPlates(job).map((p) => p.key).sort()).toEqual([`bin:${a}`, `bin:${c}`].sort());
    // The drawer itself is untouched, and the scope isn't saved (the selection isn't).
    expect('haveBaseplate' in s().drawer).toBe(false);
    expect(projectFile(s()).printScope).toBe('active');
    // Nothing selected: nothing to print, and the panel says why.
    s().setUI({ selectedBinId: null });
    expect(printDrawers(s())[0].bins).toEqual([]);
  });
});

describe('why a job has nothing to print', () => {
  const plain = { drawer: DEFAULT_DRAWER, bins: [] as unknown[] };
  const own = { drawer: { ...DEFAULT_DRAWER, haveBaseplate: true as const }, bins: [] as unknown[] };
  const base = { plates: 0, leftOut: 0, include: ALL, selected: false };

  it('says what is left out', () => {
    expect(nothingToPrint({ ...base, plates: 2, drawers: [own] })).toBeNull();
    expect(nothingToPrint({ ...base, drawers: [own] })).toBe('Nothing to print: you have the baseplate (Just bins), and there are no bins yet: draw some on the Bins tab.');
    expect(nothingToPrint({ ...base, drawers: [{ ...own, bins: [1] }], include: { baseplate: true, bins: false } })).toBe(
      'Nothing to print: you have the baseplate (Just bins), and Bins is switched off.',
    );
    expect(nothingToPrint({ ...base, drawers: [own, own] })).toMatch(/you have the baseplates of these drawers/);
    expect(nothingToPrint({ ...base, drawers: [{ ...own, drawer: { ...own.drawer, enclosure: 'case' } }] })).toMatch(/you have the carry case/);
    expect(nothingToPrint({ ...base, drawers: [plain], include: { baseplate: false, bins: true } })).toMatch(/Baseplate is switched off, and there are no bins yet/);
    expect(nothingToPrint({ ...base, drawers: [plain], selected: true })).toMatch(/no bins are selected/);
    expect(nothingToPrint({ ...base, drawers: [own], leftOut: 3 })).toMatch(/printed already/);
    // Something should have printed, so it didn't fit.
    expect(nothingToPrint({ ...base, drawers: [{ ...own, bins: [1] }] })).toMatch(/fits the printer/);
  });

  it('a layout is the same with the flag (bins sit on the same cells)', () => {
    expect(computeLayout({ ...DEFAULT_DRAWER, haveBaseplate: true })).toEqual(computeLayout(DEFAULT_DRAWER));
  });
});
