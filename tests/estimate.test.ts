import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { toMeshData, type MeshData, type Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { registerFont } from '../src/lib/geometry/text';
import {
  ESTIMATE_MODEL,
  STANDARD_PROCESS,
  currencySymbol,
  estimateJob,
  estimatePlate,
  featureMotion,
  formatDuration,
  formatMoney,
  moveTime,
  plateCost,
  sliceStats,
  type MeshPrintStats,
} from '../src/lib/estimate';
import { PRINTERS, findPrinter } from '../src/lib/printers';
import { DEFAULT_SETUP, cleanSetup, type PrintSetup } from '../src/lib/layout/plan';
import { billOfMaterials, bomCsv, bomText } from '../src/lib/bom';
import { DEFAULT_PROJECT, buildMesh, planJob, type PlacedBin, type PrintJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { printedVolume } from '../src/lib/geometry/volume';
import { useStore } from '../src/state/store';

let w: Wasm;
const X1C = findPrinter('x1c').motion!;

beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const mesh = (m: ReturnType<Wasm['Manifold']['cube']>): MeshData => {
  const out = toMeshData(m);
  m.delete();
  return out;
};
const binMesh = (o: Partial<BinOptions> = {}) => buildBin(w, { ...DEFAULT_BIN, ...o });
/** Print time of one part alone on the X1C, minutes (start sequence left out). */
const minutes = (m: MeshData, w = 42, d = 42, motion = X1C) => estimatePlate([{ stats: sliceStats(m), w, d }], motion).printSeconds / 60;

describe('slicing a mesh into layers', () => {
  it('a box: one contour per layer, its area, top and bottom skin where they belong', () => {
    const s = sliceStats(mesh(w.Manifold.cube([20, 10, 5])));
    expect(s.area).toHaveLength(25);
    for (let k = 0; k < 25; k++) {
      expect(s.area[k]).toBeCloseTo(200, 3);
      expect(s.perimeter[k]).toBeCloseTo(60, 3);
      expect(s.contours[k]).toBe(1);
      expect(s.islands[k]).toBe(1);
    }
    expect(s.down[0]).toBeCloseTo(200, 3);
    expect(s.up[24]).toBeCloseTo(200, 3);
    expect(s.up.slice(0, 24).every((v) => v === 0)).toBe(true);
    expect(s.down.slice(1).every((v) => v === 0)).toBe(true);
    expect(s.volume).toBeCloseTo(1000, 3);
    expect(s.overlayVolume).toBe(0);
  });

  it('counts holes and separate islands', () => {
    const frame = w.Manifold.cube([30, 30, 4], true).subtract(w.Manifold.cube([10, 10, 10], true));
    const pair = w.Manifold.cube([10, 10, 4]).add(w.Manifold.cube([10, 10, 4]).translate([20, 0, 0]));
    const f = sliceStats(mesh(frame.translate([0, 0, 2])));
    const p = sliceStats(mesh(pair));
    expect([f.contours[5], f.islands[5]]).toEqual([2, 1]);
    expect(f.area[5]).toBeCloseTo(800, 3);
    expect(f.perimeter[5]).toBeCloseTo(160, 3);
    expect([p.contours[5], p.islands[5]]).toEqual([2, 2]);
  });

  it('keeps inlaid text (filament 2) apart', () => {
    const m = binMesh({ unitsX: 2, label: 'full', labelText: 'M3', labelStyle: 'inlaid' });
    expect(m.overlays?.length).toBeGreaterThan(0);
    const s = sliceStats(m);
    expect(s.overlayVolume).toBeGreaterThan(0);
    const layers = [...s.overlay].filter((a) => a > 0).length;
    // 0.6 mm deep inlay: three layers.
    expect(layers).toBeGreaterThanOrEqual(2);
    expect(layers).toBeLessThanOrEqual(4);
  });

  it('its cross-sections add up to the volume', () => {
    const m = binMesh({ unitsX: 2, holes: 'magnets' });
    const s = sliceStats(m);
    const sum = [...s.area].reduce((t, a) => t + a * s.layerHeight, 0);
    expect(sum / s.volume).toBeGreaterThan(0.98);
    expect(sum / s.volume).toBeLessThan(1.02);
  });
});

describe('motion', () => {
  it('trapezoid moves: full speed on long lines, accelerate-and-brake on short ones', () => {
    expect(moveTime(1000, 100, 200, 10000)).toBeCloseTo(10 * (100 / 200 + 200 / 10000), 9);
    expect(moveTime(10, 1, 200, 10000)).toBeCloseTo(10 * 2 * Math.sqrt(1 / 10000), 9);
    expect(moveTime(0, 10, 200, 10000)).toBe(0);
  });

  it('caps feature speeds at the hotend flow and the printer limits', () => {
    const m = featureMotion(X1C);
    // 21 mm³/s through 0.45 × 0.2 mm lines: 233 mm/s, under the 300 mm/s inner-wall speed.
    expect(m.inner.v).toBeCloseTo(21 / (0.45 * 0.2), 6);
    expect(m.outer.v).toBe(200);
    expect(m.top.a).toBe(2000);
    const slow = featureMotion({ ...X1C, speed: 100, accel: 1000 });
    expect(slow.outer.v).toBe(100);
    expect(slow.outer.a).toBe(1000);
  });

  it('every printer has speed data', () => {
    for (const p of PRINTERS) {
      expect(p.motion, p.id).toBeDefined();
      expect(p.motion!.flow).toBeGreaterThan(5);
      expect(p.motion!.watts).toBeGreaterThan(20);
    }
  });
});

describe('print-time estimate', () => {
  // PrusaSlicer 2.7 with the 0.20 mm Standard / PLA Basic settings on an X1C (see estimate.ts):
  // 20 mm cube 8.3 min, 1×1×3u bin 14.1 min, 2×1×3u bin with magnets 24.2 min.
  it('lands near the slicer for known parts (±25 %)', () => {
    const near = (got: number, want: number) => {
      expect(got).toBeGreaterThan(want * 0.75);
      expect(got).toBeLessThan(want * 1.25);
    };
    near(minutes(mesh(w.Manifold.cube([20, 20, 20])), 20, 20), 8.3);
    near(minutes(binMesh()), 14.1);
    near(minutes(binMesh({ unitsX: 2, holes: 'magnets' }), 83.5, 41.5), 24.2);
  });

  it('a plain 1×1×3u bin on an X1C takes about 15 to 25 minutes with the start sequence', () => {
    const est = estimatePlate([{ stats: sliceStats(binMesh()), w: 41.5, d: 41.5 }], X1C);
    expect(est.prepareSeconds).toBe(X1C.prepare);
    expect(est.seconds / 60).toBeGreaterThan(15);
    expect(est.seconds / 60).toBeLessThan(25);
    expect(est.layers).toBeGreaterThan(100);
    const b = est.breakdown;
    expect(b.walls + b.skin + b.infill + b.travel + b.cooling + b.swaps).toBeCloseTo(est.printSeconds, 6);
    // Extruded about what the filament estimate says.
    expect(est.extruded / printedVolume(binMesh())).toBeGreaterThan(0.7);
    expect(est.extruded / printedVolume(binMesh())).toBeLessThan(1.15);
  });

  it('grows with the part', () => {
    const t = [binMesh(), binMesh({ heightUnits: 6 }), binMesh({ unitsX: 2, heightUnits: 6 }), binMesh({ unitsX: 2, unitsY: 2, heightUnits: 6 })].map((m) => minutes(m));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    const cubes = [10, 20, 40].map((a) => minutes(mesh(w.Manifold.cube([a, a, a])), a, a));
    expect(cubes[0]).toBeLessThan(cubes[1]);
    expect(cubes[1]).toBeLessThan(cubes[2]);
  });

  it('more parts on a plate take longer, but less than printing them one by one', () => {
    const s = sliceStats(binMesh());
    const one = estimatePlate([{ stats: s, w: 41.5, d: 41.5 }], X1C);
    const six = estimatePlate(Array.from({ length: 6 }, () => ({ stats: s, w: 41.5, d: 41.5 })), X1C);
    expect(six.printSeconds).toBeGreaterThan(3 * one.printSeconds);
    expect(six.seconds).toBeLessThan(6 * one.seconds);
    // Small parts alone hit the minimum layer time; six together don't.
    expect(one.breakdown.cooling).toBeGreaterThan(0);
    expect(six.breakdown.cooling).toBeLessThan(one.breakdown.cooling);
  });

  it('slower printers take longer', () => {
    const m = binMesh({ unitsX: 2, unitsY: 2 });
    const by = (id: string) => minutes(m, 83.5, 83.5, findPrinter(id).motion!);
    expect(by('prusa-mini')).toBeGreaterThan(by('prusa-mk4s'));
    expect(by('prusa-mk4s')).toBeGreaterThan(by('x1c'));
    expect(by('p2s')).toBeLessThanOrEqual(by('x1c'));
  });

  it('two-colour parts add filament swaps and a prime tower', () => {
    const plain = sliceStats(binMesh({ unitsX: 2, label: 'full', labelText: 'M3' }));
    const inlaid = sliceStats(binMesh({ unitsX: 2, label: 'full', labelText: 'M3', labelStyle: 'inlaid' }));
    const a = estimatePlate([{ stats: plain, w: 83.5, d: 41.5 }], X1C);
    const b = estimatePlate([{ stats: inlaid, w: 83.5, d: 41.5 }], X1C);
    expect(a.swaps).toBe(0);
    expect(a.wasteGrams).toBe(0);
    expect(b.swaps).toBeGreaterThanOrEqual(2);
    expect(b.breakdown.swaps).toBeGreaterThanOrEqual(b.swaps * X1C.swap);
    expect(b.wasteGrams).toBeGreaterThan(b.swaps * ESTIMATE_MODEL.flushGrams);
    expect(b.seconds - a.seconds).toBeGreaterThan(b.swaps * X1C.swap);
  });

  it('estimates every plate of a job once its parts are sliced', () => {
    const bins: PlacedBin[] = [
      { id: 'a', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2 } },
      { id: 'b', x: 2, y: 0, opts: { ...DEFAULT_BIN } },
    ];
    const job = planJob({ ...DEFAULT_PROJECT, bins, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 2 } });
    const stats = new Map<string, MeshPrintStats>();
    expect(estimateJob(job, (k) => stats.get(k), 'x1c').every((e) => e === null)).toBe(true);
    for (const [k, spec] of Object.entries(job.meshes)) stats.set(k, sliceStats(buildMesh(w, spec)));
    const est = estimateJob(job, (k) => stats.get(k), 'x1c');
    expect(est).toHaveLength(job.plates.length);
    for (const e of est) expect(e!.seconds).toBeGreaterThan(X1C.prepare + 60);
  });
});

describe('cost', () => {
  const setup: Pick<PrintSetup, 'filamentPrice' | 'filamentPrice2' | 'kwhPrice' | 'printerWatts' | 'printerId'> = {
    printerId: 'x1c',
    filamentPrice: 20,
    filamentPrice2: 30,
    kwhPrice: 0.3,
    printerWatts: 100,
  };

  it('filament at its price per kg, purge at the mean of the two, electricity for the run', () => {
    const c = plateCost({ main: 100, second: 10, waste: 2 }, 3600, setup);
    expect(c.filament).toBeCloseTo((100 * 20 + 10 * 30 + 2 * 25) / 1000, 9);
    expect(c.energy).toBeCloseTo(0.1 * 0.3, 9);
    expect(c.total).toBeCloseTo(c.filament + c.energy, 9);
  });

  it('defaults: 20 per kg, filament 2 like filament 1, no electricity, the printer’s own draw', () => {
    expect(plateCost({ main: 1000, second: 0, waste: 0 }, 7200, { printerId: 'x1c' })).toEqual({ filament: 20, energy: 0, total: 20 });
    expect(plateCost({ main: 0, second: 500, waste: 0 }, 0, { printerId: 'x1c', filamentPrice: 24 }).filament).toBeCloseTo(12, 9);
    const e = plateCost({ main: 0, second: 0, waste: 0 }, 3600, { printerId: 'a1-mini', kwhPrice: 1 });
    expect(e.energy).toBeCloseTo(findPrinter('a1-mini').motion!.watts / 1000, 9);
  });

  it('formats money and durations', () => {
    expect(formatMoney(1.234, '$')).toBe('$1.23');
    expect(formatMoney(12, 'kr')).toBe('12.00 kr');
    expect(formatMoney(3.5, 'R$')).toBe('R$3.50');
    expect(formatDuration(59)).toBe('1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
  });

  it('guesses the currency from the language unless it is set', () => {
    expect(currencySymbol('', 'de-DE')).toBe('€');
    expect(currencySymbol(undefined, 'en-GB')).toBe('£');
    expect(currencySymbol('', 'en-US')).toBe('$');
    expect(currencySymbol('', 'fr')).toBe('$');
    expect(currencySymbol(' CHF ', 'de-DE')).toBe('CHF');
  });

  describe('in the bill of materials', () => {
    let job: PrintJob;
    const stats = new Map<string, MeshPrintStats>();
    const volumes = new Map<string, number>();
    beforeAll(() => {
      const bins: PlacedBin[] = [
        { id: 'a', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, label: 'full', labelText: 'AB', labelStyle: 'inlaid' } },
        { id: 'b', x: 2, y: 0, opts: { ...DEFAULT_BIN } },
      ];
      job = planJob({ ...DEFAULT_PROJECT, bins, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 1 } });
      for (const [k, spec] of Object.entries(job.meshes)) {
        const m = buildMesh(w, spec);
        stats.set(k, sliceStats(m));
        volumes.set(k, printedVolume(m));
      }
    });

    it('adds time and cost per plate and in total, and to the CSV and text', () => {
      const setupFull = { ...DEFAULT_SETUP, printerId: 'x1c', filamentPrice: 25, filamentPrice2: 40, kwhPrice: 0.25, currency: '€' };
      const plates = estimateJob(job, (k) => stats.get(k), 'x1c');
      const b = billOfMaterials(job, (k) => volumes.get(k), {
        plates,
        overlayVolume: (k) => stats.get(k)?.overlayVolume,
        setup: setupFull,
        printer: 'Bambu Lab X1 Carbon',
      });
      expect(b.estimate).toEqual({ printer: 'Bambu Lab X1 Carbon', currency: '€', electricity: true });
      b.plates.forEach((p, i) => {
        expect(p.seconds).toBeCloseTo(plates[i]!.seconds, 6);
        expect(p.cost!.total).toBeGreaterThan(0);
      });
      expect(b.total.seconds).toBeCloseTo(b.plates.reduce((t, p) => t + p.seconds!, 0), 6);
      expect(b.total.cost!.total).toBeCloseTo(b.plates.reduce((t, p) => t + p.cost!.total, 0), 9);
      // The bins plate has the inlaid bin: swaps, purge, and filament 2 at its price.
      const bins = b.plates.find((p) => p.name.startsWith('Bins'))!;
      expect(bins.swaps).toBeGreaterThan(0);
      const cheaper = billOfMaterials(job, (k) => volumes.get(k), {
        plates,
        overlayVolume: (k) => stats.get(k)?.overlayVolume,
        setup: { ...setupFull, filamentPrice2: 25 },
        printer: 'x',
      });
      expect(cheaper.total.cost!.filament).toBeLessThan(b.total.cost!.filament);

      const csv = bomCsv(b);
      const head = csv.split('\n')[0].split(',');
      expect(head).toEqual(['Section', 'Item', 'Quantity', 'Printed volume (cm³)', 'Filament (g)', 'Filament (m)', 'Print time (min)', 'Cost (€)', 'Notes']);
      const total = csv.split('\n').find((l) => l.startsWith('Total,'))!.split(',');
      expect(Number(total[6])).toBe(Math.round(b.total.seconds! / 60));
      expect(Number(total[7])).toBeCloseTo(b.total.cost!.total, 2);
      expect(csv).toContain('Cost,Electricity');
      const text = bomText(b);
      expect(text).toContain(`Print time total: about ${formatDuration(b.total.seconds!)}`);
      expect(text).toContain(`Cost total: ${formatMoney(b.total.cost!.total, '€')}`);
      expect(text).toContain('filament swaps');
      expect(text).toContain('±25 %');
    });

    it('waits for unsliced plates, and leaves time and cost out without an estimate', () => {
      const partial = billOfMaterials(job, (k) => volumes.get(k), { plates: job.plates.map(() => null), setup: DEFAULT_SETUP, printer: 'x' });
      expect(partial.plates.every((p) => p.seconds === null && p.cost === null)).toBe(true);
      expect(partial.total.seconds).toBeNull();
      expect(bomText(partial)).toContain('not estimated yet');
      const plain = billOfMaterials(job, (k) => volumes.get(k));
      expect(plain.estimate).toBeUndefined();
      expect(plain.plates[0].seconds).toBeUndefined();
      expect(bomText(plain)).not.toContain('Print time');
    });
  });
});

describe('setup migration', () => {
  beforeEach(() => useStore.getState().resetAll());

  it('fills in the cost fields for setups saved before them, keeping the rest', () => {
    const old = { printerId: 'a1', bedW: 256, bedD: 256, maxH: 256, plateMargin: 5, spacing: 4, splitStyle: 'balanced', splitMargins: true, nest: false };
    const s = cleanSetup(old as Partial<PrintSetup>);
    expect(s).toMatchObject({ ...old, filamentPrice: 20, currency: '', kwhPrice: 0 });
    expect('filamentPrice2' in s).toBe(false);
    expect('printerWatts' in s).toBe(false);
  });

  it('cleans bad values', () => {
    const s = cleanSetup({ filamentPrice: -5, filamentPrice2: Number.NaN, kwhPrice: 'x' as unknown as number, currency: '  €  ', printerWatts: 0 });
    expect(s.filamentPrice).toBe(20);
    expect(s.kwhPrice).toBe(0);
    expect(s.currency).toBe('€');
    expect(s.filamentPrice2).toBeUndefined();
    expect(s.printerWatts).toBeUndefined();
    expect(cleanSetup({ filamentPrice2: 35, printerWatts: 140, currency: 'kr', kwhPrice: 0.2 })).toMatchObject({
      filamentPrice2: 35,
      printerWatts: 140,
      currency: 'kr',
      kwhPrice: 0.2,
    });
    expect(cleanSetup(null)).toEqual(DEFAULT_SETUP);
  });

  it('project files saved before get the defaults', () => {
    useStore.getState().loadProject({
      app: 'gridfit',
      setup: { printerId: 'p1s', bedW: 256, bedD: 256, maxH: 256, plateMargin: 10, spacing: 3, splitStyle: 'auto', splitMargins: false, nest: true },
    });
    expect(useStore.getState().setup).toMatchObject({ printerId: 'p1s', filamentPrice: 20, kwhPrice: 0, currency: '' });
  });

  it('a session autosaved before comes back with the defaults', async () => {
    const saved = new Map<string, string>([
      ['gridfit-project', JSON.stringify({ version: 2, state: { setup: { ...DEFAULT_SETUP, printerId: 'a1', filamentPrice: 31, kwhPrice: -1, currency: undefined } } })],
    ]);
    const localStorage = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => saved.set(k, v),
      removeItem: (k: string) => saved.delete(k),
    };
    // Autosave goes to window.localStorage.
    vi.stubGlobal('window', { localStorage });
    try {
      vi.resetModules();
      const { useStore: fresh } = await import('../src/state/store');
      expect(fresh.getState().setup).toMatchObject({ printerId: 'a1', filamentPrice: 31, kwhPrice: 0, currency: '' });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('keeps the setup fields the estimate reads in the process defaults', () => {
    expect(STANDARD_PROCESS.layerHeight).toBe(0.2);
    expect(DEFAULT_SETUP.filamentPrice).toBe(20);
  });
});
