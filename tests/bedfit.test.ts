import { beforeEach, describe, expect, it } from 'vitest';
import { useStore, history } from '../src/state/store';
import { applyTemplateToBins, saveTemplate } from '../src/state/templates';
import { DEFAULT_BIN, binSize, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { bedOvershoot, bedProblem, fitStretch, fitsBed, maxUnitsAlong, partOvershoot, placedOvershoot, rectFitsBed, shrinkToBed, usableBed } from '../src/lib/bedfit';
import { fitResize } from '../src/lib/binLayout';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_PROJECT, planJob, type PlacedBin } from '../src/lib/project';

const s = () => useStore.getState();
const P2S = usableBed({ bedW: 256, bedD: 256, plateMargin: 10, maxH: 256 });
const MINI = usableBed({ bedW: 180, bedD: 180, plateMargin: 10, maxH: 180 });
const bin = (o: Partial<BinOptions> = {}): BinOptions => sanitizeBin({ ...DEFAULT_BIN, ...o });

beforeEach(() => {
  s().resetAll();
  s().setSetup({ bedW: 256, bedD: 256, plateMargin: 10, maxH: 256 });
  s().setDrawer({ mode: 'grid', gridX: 10, gridY: 8 });
  history.clear();
});

describe('what fits the printer', () => {
  it('uses the bed inside the edge margin, either way round, and the printer height', () => {
    expect(P2S).toEqual({ w: 236, d: 236, h: 256 });
    const rect = usableBed({ bedW: 250, bedD: 210, plateMargin: 10, maxH: 220 });
    expect(fitsBed(229, 189, 100, rect)).toBe(true);
    expect(fitsBed(189, 229, 100, rect)).toBe(true); // turned
    expect(fitsBed(231, 100, 100, rect)).toBe(false);
    expect(fitsBed(100, 100, 221, rect)).toBe(false);
    expect(partOvershoot(240, 100, 0, P2S)).toBeCloseTo(4, 6);
  });

  it('a 5 × 5 bin fits a P2S, a 6-wide one doesn’t; a mini takes 3 × 3', () => {
    expect(binSize(bin({ unitsX: 5, unitsY: 5 })).w).toBeCloseTo(209.5, 6);
    expect(bedOvershoot(bin({ unitsX: 5, unitsY: 5 }), null, P2S)).toBe(0);
    expect(bedOvershoot(bin({ unitsX: 6, unitsY: 1 }), null, P2S)).toBeCloseTo(251.5 - 236, 6);
    expect(bedOvershoot(bin({ unitsX: 3, unitsY: 3 }), null, MINI)).toBe(0);
    expect(bedOvershoot(bin({ unitsX: 4, unitsY: 1 }), null, MINI)).toBeGreaterThan(0);
    expect(bedProblem(bin({ unitsX: 6, unitsY: 1 }), null, P2S)).toMatch(/too big for the print bed/);
    expect(bedProblem(bin({ unitsX: 5, unitsY: 5 }), null, P2S)).toBeNull();
  });

  it('counts the height, and a container’s own parts', () => {
    const tall = usableBed({ bedW: 256, bedD: 256, plateMargin: 10, maxH: 100 });
    expect(bedProblem(bin({ heightUnits: 15 }), null, tall)).toMatch(/tall: the printer prints up to/);
    expect(bedOvershoot(bin({ heightUnits: 13 }), null, tall)).toBe(0);
    // A drawer unit's body sets its height; a parts box's closed lid shares its footprint.
    expect(bedOvershoot(bin({ unitsX: 5, unitsY: 5, heightUnits: 8, container: 'drawers' }), null, P2S)).toBe(0);
    expect(bedOvershoot(bin({ unitsX: 6, unitsY: 2, container: 'box' }), null, P2S)).toBeGreaterThan(0);
  });

  it('gives the most cells that fit along an axis', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 10, gridY: 8 });
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 2 }) };
    expect(maxUnitsAlong(layout, b, 'x', P2S, 12)).toBe(5);
    expect(maxUnitsAlong(layout, b, 'y', MINI, 12)).toBe(3);
    expect(rectFitsBed(layout, b, { x: 0, y: 0, w: 5, d: 5 }, P2S)).toBe(true);
    expect(rectFitsBed(layout, b, { x: 0, y: 0, w: 6, d: 1 }, P2S)).toBe(false);
  });

  it('shrinks a bin to fit: height first when that’s the problem, else the longer side', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 10, gridY: 8 });
    const wide: PlacedBin = { id: 'a', x: 1, y: 2, opts: bin({ unitsX: 7, unitsY: 4 }) };
    const fit = shrinkToBed(layout, wide, MINI);
    expect(placedOvershoot(layout, fit, MINI)).toBe(0);
    expect([fit.x, fit.y, fit.opts.unitsX, fit.opts.unitsY]).toEqual([1, 2, 3, 3]);
    const tall: PlacedBin = { id: 'b', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 2, heightUnits: 30 }) };
    const low = shrinkToBed(layout, tall, MINI);
    expect(low.opts.unitsX).toBe(2);
    expect(low.opts.heightUnits).toBeLessThan(30);
    expect(placedOvershoot(layout, low, MINI)).toBe(0);
    expect(shrinkToBed(layout, low, MINI)).toBe(low);
  });

  it('resizing stops at the bed', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 10, gridY: 8 });
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 2 }) };
    const r = fitResize([], { x: 0, y: 0, w: 2, d: 2 }, { x: 0, y: 0, w: 9, d: 2 }, 10, 8, (rr) => rectFitsBed(layout, b, rr, P2S));
    expect(r).toEqual({ x: 0, y: 0, w: 5, d: 2 });
  });

  it('scales a stretch back to what fits', () => {
    // Five cells with the 30 mm left over on the right: a 5-wide bin can stretch 30 mm, but the bed takes only 26.5 more.
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'drawer', width: 240.5, depth: 100, alignX: 0, fill: 'solid' });
    expect(layout.nx).toBe(5);
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: bin({ unitsX: 5, unitsY: 1 }) };
    const got = fitStretch(layout, b, { right: 40 }, P2S)!;
    expect(placedOvershoot(layout, { ...b, stretch: got }, P2S)).toBe(0);
    expect(got.right).toBeGreaterThan(25);
    expect(got.right).toBeLessThan(27);
    expect(fitStretch(layout, b, { right: 10 }, P2S)).toEqual({ right: 10 });
  });
});

describe('the store keeps bins on the bed', () => {
  it('a new bin is cut down to fit', () => {
    const id = s().addBin(0, 0, 8, 3);
    const b = s().bins.find((x) => x.id === id)!;
    expect([b.opts.unitsX, b.opts.unitsY]).toEqual([5, 3]);
  });

  it('refuses edits that push a bin past the bed, keeps everything else', () => {
    const id = s().addBin(0, 0, 5, 2);
    s().updateBin(id, { opts: { unitsX: 6 } });
    expect(s().bins[0].opts.unitsX).toBe(5);
    s().updateBin(id, { opts: { labelText: 'BOLTS' } });
    expect(s().bins[0].opts.labelText).toBe('BOLTS');
    s().setSetup({ maxH: 60 });
    s().updateBin(id, { opts: { heightUnits: 9 } });
    expect(s().bins[0].opts.heightUnits).toBe(3);
  });

  it('a bin that no longer fits (smaller printer) can still be edited and shrunk, but not grown', () => {
    const id = s().addBin(0, 0, 5, 5);
    s().setSetup({ bedW: 180, bedD: 180 });
    const layout = computeLayout(s().drawer);
    const bed = usableBed(s().setup);
    expect(placedOvershoot(layout, s().bins[0], bed)).toBeGreaterThan(0);
    s().updateBin(id, { opts: { labelText: 'still editable' } });
    expect(s().bins[0].opts.labelText).toBe('still editable');
    s().updateBin(id, { opts: { unitsY: 6 } });
    expect(s().bins[0].opts.unitsY).toBe(5);
    s().updateBin(id, { opts: { unitsX: 4 } });
    expect(s().bins[0].opts.unitsX).toBe(4);
  });

  it('new-bin settings the printer can’t take are refused; templates are cut down to fit', () => {
    s().setSetup({ maxH: 80 });
    s().setNewBin({ heightUnits: 20 });
    expect(s().newBin.heightUnits).toBe(DEFAULT_BIN.heightUnits);
    s().setSetup({ maxH: 256 });
    const id = s().addBin(0, 0, 2, 2);
    const t = saveTemplate('tall', bin({ heightUnits: 30 }));
    s().setSetup({ maxH: 120 });
    applyTemplateToBins(t, [id]);
    const b = s().bins[0];
    expect(placedOvershoot(computeLayout(s().drawer), b, usableBed(s().setup))).toBe(0);
    expect(b.opts.heightUnits).toBeLessThan(30);
  });
});

describe('planning', () => {
  it('leaves out parts taller than the printer, with a warning', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      setup: { ...DEFAULT_PROJECT.setup, maxH: 60 },
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 2 },
      bins: [
        { id: 'tall', x: 0, y: 0, opts: bin({ heightUnits: 12 }) },
        { id: 'ok', x: 1, y: 0, opts: bin({ heightUnits: 3 }) },
      ],
    });
    const placed = job.plates.flatMap((p) => p.placements.map((x) => x.key));
    expect(placed).toContain('bin:ok');
    expect(placed).not.toContain('bin:tall');
    expect(job.warnings.some((w) => /taller than the printer prints/.test(w))).toBe(true);
  });
});
