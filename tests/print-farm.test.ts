import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { DEFAULT_BIN, binSize, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, cleanSetup, type PrintSetup } from '../src/lib/layout/plan';
import { assemblyMaps, jobForPrinter, planPrint, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { exportPlatesZip } from '../src/lib/export/threemf';
import { exportPlatesStlZip } from '../src/lib/export/stl';
import { baseplatePrinter, biggestPrinter, jobPrinters, printerNames, printerSetup, roughSeconds, shareOut, type PrinterSetup } from '../src/lib/layout/fleet';
import { bedOvershoot, bedProblem, fitsBed, maxUnitsAlong, partOvershoot, placedOvershoot, shrinkToBed, usableBed, usableBeds } from '../src/lib/bedfit';
import { billOfMaterials, bomCsv, bomText } from '../src/lib/bom';
import { estimateJob, type MeshPrintStats, type PlateEstimate } from '../src/lib/estimate';
import { findPrinter } from '../src/lib/printers';
import { history, projectFile, useStore } from '../src/state/store';
import { addPrinter, removePrinter, setBaseplatePrinter, setPrinterAt } from '../src/state/printers';
import type { MeshData } from '../src/lib/geometry/kernel';

const bin = (id: string, x: number, y: number, ux: number, uy: number, o: Partial<BinOptions> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: { ...DEFAULT_BIN, unitsX: ux, unitsY: uy, ...o },
});
const include = { baseplate: true, bins: true };

/** A few drawers that use most of what planning does: splits, keys, pads, a carry case, lids, dividers. */
function sampleDrawers(): NamedDrawer[] {
  const kitchen: NamedDrawer = {
    id: 'k',
    name: 'Kitchen',
    drawer: { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 },
    baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie', magnets: true, pads: 'strips' },
    bins: [
      bin('a', 0, 0, 2, 2, { lid: true }),
      bin('b', 2, 0, 1, 1),
      bin('c', 3, 0, 1, 1),
      bin('d', 4, 0, 3, 2, { heightUnits: 6, divX: 3 }),
      bin('e', 0, 2, 5, 1, { labelPlates: true, label: 'full' } as Partial<BinOptions>),
      bin('f', 7, 0, 4, 4, { heightUnits: 12 }),
    ],
  };
  const desk: NamedDrawer = {
    id: 'w',
    name: 'Desk',
    drawer: { ...DEFAULT_DRAWER, width: 300, depth: 260, enclosure: 'case' } as DrawerInput,
    baseplate: { ...DEFAULT_BASEPLATE },
    bins: [bin('g', 0, 0, 2, 1), bin('h', 2, 0, 1, 1), bin('i', 3, 0, 2, 2)],
  };
  return [kitchen, desk];
}

/** Everything a plan decides, as text: plates, what's on them and where, and the warnings. */
const planText = (job: PrintJob) =>
  JSON.stringify({
    plates: job.plates.map((pl) => [pl.name, pl.group, pl.placements.map((p) => [p.key, p.x.toFixed(3), p.y.toFixed(3), p.rotated])]),
    parts: Object.keys(job.parts).length,
    warnings: job.warnings,
  });

/** Short hash of a string (FNV-1a, 32 bit). */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

const printer = (id: string, o: Partial<PrinterSetup> = {}): PrinterSetup => {
  const p = findPrinter(id);
  return { printerId: p.id, bedW: p.bedW, bedD: p.bedD, maxH: p.maxH, plateMargin: 10, ...o };
};
/** A setup whose first printer is `first`, with more after it. */
const farm = (first: string, ...more: string[]): PrintSetup => {
  const p = printer(first);
  return { ...DEFAULT_SETUP, ...p, ...(more.length ? { printers: more.map((id) => printer(id)) } : {}) };
};
const platesOn = (job: PrintJob, k: number) => job.plates.filter((pl) => (pl.printer ?? 0) === k);
/** Every part on a printer's plates, by key. */
const keysOn = (job: PrintJob, k: number) => platesOn(job, k).flatMap((pl) => pl.placements.map((p) => p.key));

describe('one printer, as before', () => {
  it('plans old projects exactly as before', () => {
    // A setup saved before several printers existed. The hashes are of plans made before they did
    // (on a P1S then; the A1 has the same bed and, unlike the P1S since, no exclusion area: printers.ts).
    const old = cleanSetup({ ...DEFAULT_SETUP, printerId: 'a1' });
    expect('printers' in old).toBe(false);
    expect(hash(planText(planPrint(sampleDrawers(), old, include)))).toBe('d75f1bc8');
    expect(hash(planText(planPrint(sampleDrawers().slice(0, 1), old, include)))).toBe('55da3c3');
    const job = planPrint(sampleDrawers(), old, include);
    expect(job.plates.every((pl) => pl.printer === undefined)).toBe(true);
    expect(job.printers).toBeUndefined();
    // On a P1S the same parts print, all clear of its front-left corner.
    const p1s = planPrint(sampleDrawers(), cleanSetup({ ...DEFAULT_SETUP, printerId: 'p1s' }), include);
    expect(p1s.plates.flatMap((pl) => pl.placements).map((p) => p.key).sort()).toEqual(job.plates.flatMap((pl) => pl.placements).map((p) => p.key).sort());
    for (const p of p1s.plates.flatMap((pl) => pl.placements)) expect(p.x >= 18 + 3 - 1e-6 || p.y >= 28 + 3 - 1e-6).toBe(true);
  });

  it('opens an old project file with one printer as it was', () => {
    const s = useStore.getState;
    s().resetAll();
    s().loadProject({ app: 'gridfit', version: 2, setup: { printerId: 'a1-mini', bedW: 180, bedD: 180, maxH: 180, plateMargin: 10 } });
    expect(s().setup.printers).toBeUndefined();
    expect(s().setup.baseplatePrinter).toBeUndefined();
    expect(jobPrinters(s().setup)).toHaveLength(1);
    expect(usableBeds(s().setup)).toEqual([{ ...usableBed(s().setup), name: 'Bambu Lab A1 mini' }]);
    // Empty or broken printer lists are dropped.
    expect(cleanSetup({ ...DEFAULT_SETUP, printers: [], baseplatePrinter: 0 })).toEqual(cleanSetup(DEFAULT_SETUP));
    expect(cleanSetup({ ...DEFAULT_SETUP, printers: [null, 'x'] as never }).printers).toBeUndefined();
  });
});

describe('sharing parts out between printers', () => {
  const two = [
    { area: 50000, prepare: 300 },
    { area: 50000, prepare: 300 },
  ];

  it('balances identical printers', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: `b${i}`, area: 2000, seconds: [1800, 1800] }));
    const at = shareOut(items, two);
    const on = (k: number) => [...at.values()].filter((v) => v === k).length;
    expect([on(0), on(1)]).toEqual([5, 5]);
  });

  it('gives a slower printer less, and the longest parts first', () => {
    // Printer 2 takes twice as long for everything.
    const items = [3600, 3000, 2400, 1800, 1800, 1200, 1200, 600, 600, 600].map((t, i) => ({ key: `b${i}`, area: 1000, seconds: [t, 2 * t] }));
    const at = shareOut(items, two);
    const load = [0, 1].map((k) => items.filter((it) => at.get(it.key) === k).reduce((t, it) => t + it.seconds[k], 0));
    const total = items.reduce((t, it) => t + it.seconds[0], 0);
    // About two thirds on the faster one, and neither printer much longer than the best split.
    expect(load[0]).toBeGreaterThan(load[1] / 2);
    expect(Math.max(...load)).toBeLessThan((2 / 3) * total + 1300);
  });

  it('puts a part that only one printer takes on that printer, and leaves out what fits none', () => {
    const items = [
      { key: 'big', area: 40000, seconds: [9000, Infinity] },
      { key: 'small', area: 1000, seconds: [600, 600] },
      { key: 'huge', area: 90000, seconds: [Infinity, Infinity] },
      { key: 'pinned', area: 1000, seconds: [600, 600], pinned: 0 },
    ];
    const at = shareOut(items, two);
    expect(at.get('big')).toBe(0);
    expect(at.get('pinned')).toBe(0);
    // The big one keeps printer 1 busy, so the small one goes to printer 2.
    expect(at.get('small')).toBe(1);
    expect(at.has('huge')).toBe(false);
  });

  it('times parts by size before they are sliced, slower on a slower printer', () => {
    const b = { kind: 'bin', w: 83.5, d: 83.5, h: 46 };
    const x1c = roughSeconds(b, findPrinter('x1c').motion);
    // The sliced estimate of a 2 × 2 × 6u bin on an X1C is about 56 min.
    expect(x1c / 60).toBeGreaterThan(45);
    expect(x1c / 60).toBeLessThan(65);
    expect(roughSeconds(b, findPrinter('prusa-mini').motion)).toBeGreaterThan(x1c * 1.3);
    expect(roughSeconds({ kind: 'piece', w: 210, d: 210, h: 5 }, findPrinter('x1c').motion)).toBeGreaterThan(x1c);
  });
});

describe('planning for two printers', () => {
  const drawer = (bins: PlacedBin[]): NamedDrawer => ({
    id: 'd',
    name: 'D',
    drawer: { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 },
    baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' },
    bins,
  });
  // Twenty 1 × 1 bins and two 5 × 4 bins that only the P2S takes.
  const bins = [
    ...Array.from({ length: 20 }, (_, i) => bin(`s${i}`, i % 10, Math.floor(i / 10), 1, 1)),
    bin('big1', 0, 2, 5, 4),
    bin('big2', 5, 2, 5, 4),
  ];

  it('labels every plate with its printer, the baseplate on the biggest', () => {
    const setup = farm('a1-mini', 'p2s');
    expect(biggestPrinter(setup)).toBe(1);
    expect(baseplatePrinter(setup)).toBe(1);
    const job = planPrint([drawer(bins)], setup, include);
    expect(job.printers).toEqual(['Bambu Lab A1 mini', 'Bambu Lab P2S']);
    expect(job.plates.every((pl) => pl.printer === 0 || pl.printer === 1)).toBe(true);
    // Printer by printer.
    expect(job.plates.map((pl) => pl.printer)).toEqual([...job.plates.map((pl) => pl.printer)].sort());
    // Pieces are split for the P2S: too big for the mini, so they print on the P2S.
    expect(job.plan.pieces.some((p) => p.x1 - p.x0 > 160)).toBe(true);
    for (const k of Object.keys(job.parts).filter((k) => k.startsWith('piece:'))) expect(keysOn(job, 1)).toContain(k);
    // Bins that only the P2S takes go to it; the small ones are shared.
    expect(keysOn(job, 1)).toEqual(expect.arrayContaining(['bin:big1', 'bin:big2']));
    expect(keysOn(job, 0).filter((k) => k.startsWith('bin:s')).length).toBeGreaterThan(0);
    // Everything is printed once, and stays on its own printer's bed.
    const all = job.plates.flatMap((pl) => pl.placements.map((p) => p.key));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(Object.keys(job.parts).length);
    for (const pl of job.plates) {
      const pr = jobPrinters(setup)[pl.printer!];
      for (const p of pl.placements) {
        const w = p.rotated ? p.d : p.w;
        const d = p.rotated ? p.w : p.d;
        expect(p.x).toBeGreaterThanOrEqual(pr.plateMargin - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(pr.plateMargin - 1e-6);
        expect(p.x + w).toBeLessThanOrEqual(pr.bedW - pr.plateMargin + 1e-6);
        expect(p.y + d).toBeLessThanOrEqual(pr.bedD - pr.plateMargin + 1e-6);
      }
    }
    // The assembly map names each plate with its printer.
    expect(Object.values(assemblyMaps(job))[0]).toMatch(/Plate \d+ \(Bambu Lab P2S\): piece/);
  });

  it('shares the bins so both printers finish about together', () => {
    const setup = farm('p2s', 'p2s');
    const only = planPrint([{ ...drawer(bins), baseplate: DEFAULT_BASEPLATE }], { ...setup, printers: undefined }, { baseplate: false, bins: true });
    const job = planPrint([{ ...drawer(bins), baseplate: DEFAULT_BASEPLATE }], setup, { baseplate: false, bins: true });
    expect(job.printers).toEqual(['Bambu Lab P2S (1)', 'Bambu Lab P2S (2)']);
    // Time each printer's plates with the same rough figure the planner used.
    const motion = findPrinter('p2s').motion!;
    const time = (keys: string[]) => keys.reduce((t, k) => t + roughSeconds(job.parts[k], motion), 0);
    const a = time(keysOn(job, 0)) + platesOn(job, 0).length * motion.prepare;
    const b = time(keysOn(job, 1)) + platesOn(job, 1).length * motion.prepare;
    const longest = Math.max(...Object.values(job.parts).map((p) => roughSeconds(p, motion)));
    expect(Math.abs(a - b)).toBeLessThan(longest + motion.prepare);
    expect(Math.max(a, b)).toBeLessThan(time(Object.keys(only.parts)) * 0.75);
  });

  it('uses the slice estimates when it has them', () => {
    const setup = farm('p2s', 'p2s');
    // Pretend the 1 × 1 bins take an hour each and the rest no time at all: they split 10 and 10.
    const seconds = (part: { key: string }) => (part.key.startsWith('bin:s') ? 3600 : 1);
    const job = planPrint([drawer(bins)], setup, { baseplate: false, bins: true }, { seconds });
    const small = (k: number) => keysOn(job, k).filter((key) => key.startsWith('bin:s')).length;
    expect([small(0), small(1)]).toEqual([10, 10]);
  });

  it('prints the baseplate on the printer picked for it, split for that printer', () => {
    const setup = { ...farm('p2s', 'a1-mini'), baseplatePrinter: 1 };
    expect(baseplatePrinter(setup)).toBe(1);
    const job = planPrint([drawer(bins)], setup, include);
    const mini = jobPrinters(setup)[1];
    for (const p of job.plan.pieces) {
      expect(Math.min(p.x1 - p.x0, p.y1 - p.y0)).toBeLessThanOrEqual(mini.bedW - 2 * mini.plateMargin + 1e-6);
    }
    for (const pl of job.plates.filter((pl) => pl.group === 'baseplate')) expect(pl.printer).toBe(1);
    // The same pieces as planning for the mini alone.
    const alone = planPrint([drawer(bins)], printerSetup(setup, 1), include);
    expect(job.plan.pieces).toEqual(alone.plan.pieces);
  });

  it('warns about parts no printer takes', () => {
    const job = planPrint([drawer([bin('t', 0, 0, 1, 1, { heightUnits: 40 })])], farm('a1-mini', 'a1-mini'), include);
    expect(job.warnings.join('\n')).toMatch(/taller than any of the printers prints \(180 mm\)/);
    expect(Object.keys(job.parts).filter((k) => k.startsWith('bin:')).every((k) => !keysOn(job, 0).includes(k) && !keysOn(job, 1).includes(k))).toBe(true);
  });
});

describe('bed fit with two printers', () => {
  const P2S = usableBed({ bedW: 256, bedD: 256, plateMargin: 10, maxH: 256 });
  const MINI = usableBed({ bedW: 180, bedD: 180, plateMargin: 10, maxH: 180 });
  const H2D = { ...usableBed({ bedW: 350, bedD: 320, plateMargin: 10, maxH: 325 }), name: 'Bambu Lab H2D' };
  const o = (x: Partial<BinOptions>) => sanitizeBin({ ...DEFAULT_BIN, ...x });
  const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 12, gridY: 10 });

  it('fits when one of the printers takes it; the overshoot is the least', () => {
    expect(fitsBed(300, 100, 100, [MINI, H2D])).toBe(true);
    expect(fitsBed(300, 100, 100, MINI)).toBe(false);
    expect(partOvershoot(340, 100, 10, [MINI, H2D])).toBeCloseTo(10, 6);
    expect(partOvershoot(340, 100, 10, [H2D, MINI])).toBeCloseTo(10, 6);
    // Taller than the H2D, wider than the mini: fits neither.
    expect(fitsBed(200, 100, 330, [MINI, H2D])).toBe(false);
    expect(bedOvershoot(o({ unitsX: 7, unitsY: 2 }), null, [MINI, H2D])).toBe(0);
    expect(bedOvershoot(o({ unitsX: 7, unitsY: 2 }), null, [MINI, P2S])).toBeGreaterThan(0);
  });

  it('lets bins grow to what the biggest printer takes, and names it when they don’t fit', () => {
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: o({ unitsX: 2, unitsY: 2 }) };
    expect(maxUnitsAlong(layout, b, 'x', [MINI, H2D], 12)).toBe(7);
    expect(maxUnitsAlong(layout, b, 'x', [MINI, P2S], 12)).toBe(5);
    const wide = o({ unitsX: 9, unitsY: 1 });
    expect(binSize(wide).w).toBeGreaterThan(H2D.w);
    expect(bedProblem(wide, null, [{ ...MINI, name: 'Bambu Lab A1 mini' }, H2D])).toMatch(/too big for every printer\. The Bambu Lab H2D comes closest/);
    // Bins go up to 30u, about 214 mm.
    expect(bedProblem(o({ heightUnits: 30 }), null, [{ ...MINI, name: 'Bambu Lab A1 mini' }, { ...P2S, h: 200, name: 'Short P2S' }])).toMatch(
      /too tall for every printer\. The Short P2S comes closest, printing up to 200 mm/,
    );
    expect(bedProblem(o({ unitsX: 7 }), null, [MINI, H2D])).toBeNull();
  });

  it('shrinks to the printer that leaves the bin biggest', () => {
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: o({ unitsX: 10, unitsY: 3 }) };
    const fit = shrinkToBed(layout, b, [MINI, H2D]);
    expect(placedOvershoot(layout, fit, [MINI, H2D])).toBe(0);
    expect([fit.opts.unitsX, fit.opts.unitsY]).toEqual([7, 3]);
  });

  describe('in the store', () => {
    const s = () => useStore.getState();
    beforeEach(() => {
      s().resetAll();
      s().setPrinter('a1-mini');
      s().setDrawer({ mode: 'grid', gridX: 12, gridY: 10 });
      history.clear();
    });

    it('takes bins as big as the second printer allows, and flags them when it goes', () => {
      const id = s().addBin(0, 0, 7, 2);
      expect(s().bins[0].opts.unitsX).toBe(3); // the mini alone takes 3 cells
      addPrinter();
      setPrinterAt(1, { printerId: 'h2d' });
      expect(s().setup.printers).toEqual([{ printerId: 'h2d', bedW: 350, bedD: 320, maxH: 325, plateMargin: 10 }]);
      s().updateBin(id, { opts: { unitsX: 7 } });
      expect(s().bins[0].opts.unitsX).toBe(7);
      s().updateBin(id, { opts: { unitsX: 8 } });
      expect(s().bins[0].opts.unitsX).toBe(7); // refused: no printer takes 8
      history.checkpoint();
      removePrinter(1);
      expect(s().setup.printers).toBeUndefined();
      expect(placedOvershoot(computeLayout(s().drawer), s().bins[0], usableBeds(s().setup))).toBeGreaterThan(0);
      // Undo brings the printer back.
      history.undo();
      expect(s().setup.printers).toHaveLength(1);
    });

    it('keeps the baseplate printer pointing at the same one when another is removed', () => {
      addPrinter();
      addPrinter();
      setPrinterAt(2, { printerId: 'h2d' });
      setBaseplatePrinter(2);
      removePrinter(1);
      expect(s().setup.printers?.map((p) => p.printerId)).toEqual(['h2d']);
      expect(s().setup.baseplatePrinter).toBe(1);
      removePrinter(1);
      expect(s().setup.baseplatePrinter).toBeUndefined();
      expect(printerNames(s().setup)).toEqual(['Bambu Lab A1 mini']);
    });

    it('saves the printers with the project', () => {
      addPrinter();
      setPrinterAt(1, { printerId: 'custom', bedW: 400, plateMargin: 5 });
      setBaseplatePrinter(0);
      const file = JSON.parse(JSON.stringify(projectFile(s())));
      s().resetAll();
      s().loadProject(file);
      expect(s().setup.printers).toEqual([{ printerId: 'custom', bedW: 400, bedD: 180, maxH: 180, plateMargin: 5 }]);
      expect(s().setup.baseplatePrinter).toBe(0);
    });
  });
});

describe('exports and the bill of materials with two printers', () => {
  const setup = farm('p2s', 'a1-mini');
  const job = planPrint(
    [
      {
        id: 'd',
        name: 'D',
        drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 },
        baseplate: DEFAULT_BASEPLATE,
        bins: [bin('a', 0, 0, 1, 1), bin('b', 1, 0, 1, 1), bin('c', 2, 0, 2, 2), bin('d', 0, 1, 1, 1)],
      },
    ],
    setup,
    include,
  );
  const tiny: MeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) } as MeshData;

  it('groups plates by printer in the zips, and gives each printer its own project', () => {
    expect(platesOn(job, 0).length).toBeGreaterThan(0);
    expect(platesOn(job, 1).length).toBeGreaterThan(0);
    const names = Object.keys(unzipSync(exportPlatesZip(job, setup, () => tiny)));
    expect(names.filter((n) => n.endsWith('.3mf')).every((n) => /^bambu-lab-(p2s|a1-mini)\/\d\d-/.test(n))).toBe(true);
    const readme = strFromU8(unzipSync(exportPlatesZip(job, setup, () => tiny))['README.txt']);
    expect(readme).toMatch(/Bambu Lab A1 mini \(180 × 180 mm bed, 10 mm edge margin\): plates/);
    expect(Object.keys(unzipSync(exportPlatesStlZip(job, () => tiny))).filter((n) => n.endsWith('.stl')).every((n) => n.includes('/'))).toBe(true);
    const mine = jobForPrinter(job, 1);
    expect(mine.plates).toEqual(platesOn(job, 1));
    expect(printerSetup(setup, 1)).toMatchObject({ printerId: 'a1-mini', bedW: 180, bedD: 180 });
    expect('printers' in printerSetup(setup, 1)).toBe(false);
  });

  it('times each plate on its own printer, and shows when the slowest is done', () => {
    // The same slice data for every mesh: a plate's time differs only by printer and parts.
    const stats: MeshPrintStats = {
      layerHeight: 0.2,
      area: new Float32Array(50).fill(400),
      perimeter: new Float32Array(50).fill(160),
      contours: new Uint16Array(50).fill(1),
      islands: new Uint16Array(50).fill(1),
      up: new Float32Array(50),
      down: new Float32Array(50),
      overlay: new Float32Array(50),
      volume: 20000,
      overlayVolume: 0,
    };
    const ids = jobPrinters(setup).map((p) => p.printerId);
    const plates = estimateJob(job, () => stats, ids);
    const byP2S = estimateJob(job, () => stats, 'p2s');
    const k = job.plates.findIndex((pl) => pl.printer === 1);
    // The mini prints slower than the P2S.
    expect(plates[k]!.printSeconds).toBeGreaterThan(byP2S[k]!.printSeconds);
    const bom = billOfMaterials(job, () => 1000, { plates: plates as PlateEstimate[], setup, printer: 'x', printers: job.printers });
    expect(bom.printers?.map((p) => p.name)).toEqual(['Bambu Lab P2S', 'Bambu Lab A1 mini']);
    expect(bom.printers!.reduce((t, p) => t + p.plates, 0)).toBe(job.plates.length);
    expect(bom.finish).toBe(Math.max(...bom.printers!.map((p) => p.seconds!)));
    expect(bom.total.seconds).toBeCloseTo(bom.printers!.reduce((t, p) => t + p.seconds!, 0), 6);
    expect(bom.total.cost!.total).toBeCloseTo(bom.printers!.reduce((t, p) => t + p.cost!.total, 0), 9);
    expect(bomCsv(bom)).toMatch(/\nPrinter,Bambu Lab A1 mini,/);
    expect(bomCsv(bom)).toMatch(/\nDone,All printers done,/);
    expect(bomText(bom)).toMatch(/All done in about .*, when the Bambu Lab (P2S|A1 mini) finishes/);
  });
});

describe('an autosaved session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('comes back with its printers, and an older one with just its own', async () => {
    const printers = [printer('a1-mini')];
    for (const [saved, want] of [
      [{ setup: { ...DEFAULT_SETUP, printers, baseplatePrinter: 1 } }, printers],
      [{ setup: { ...DEFAULT_SETUP, printerId: 'a1' } }, undefined],
    ] as const) {
      const store = new Map([['gridfit-project', JSON.stringify({ version: 2, state: saved })]]);
      vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: () => {} } });
      vi.resetModules();
      const { useStore: fresh } = await import('../src/state/store');
      expect(fresh.getState().setup.printers).toEqual(want);
    }
  });
});
