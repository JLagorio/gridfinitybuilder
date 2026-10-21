import { beforeEach, describe, expect, it } from 'vitest';
import { history, useStore } from '../src/state/store';
import { applyPresetToBins, applyPresetToNew } from '../src/state/templates';
import { BIN_PRESETS, applyPreset, findPreset } from '../src/lib/templates';
import { DEFAULT_BIN, binLayout, binSize, binTotalHeight, type BinOptions } from '../src/lib/geometry/bin';
import { binBodyHeight, binFloorZ } from '../src/lib/geometry/variants';
import { pocketLayout } from '../src/lib/geometry/pockets';
import { LIP_SUPPORT_HEIGHT } from '../src/lib/geometry/spec';
import { binSeatHeight } from '../src/lib/geometry/baseplate';
import { computeLayout } from '../src/lib/layout/drawer';
import { placedOvershoot, usableBeds } from '../src/lib/bedfit';

const s = () => useStore.getState();
const opts = (id: string) => s().bins.find((b) => b.id === id)!.opts;
const preset = (id: string) => findPreset(id)!;

beforeEach(() => {
  s().resetAll();
  history.clear();
});

describe('bin presets', () => {
  it('has the starting points the panel offers, each with a name and a hint', () => {
    expect(BIN_PRESETS.map((p) => p.id)).toEqual(['small-parts', 'batteries', 'deep', 'tool-tray', 'label-all']);
    for (const p of BIN_PRESETS) {
      expect(p.name.trim()).not.toBe('');
      expect(p.hint).toMatch(/\.$/);
    }
  });

  it('screws & small parts: three compartments with scoops and labels', () => {
    const o = applyPreset(preset('small-parts'), { ...DEFAULT_BIN, unitsX: 2 });
    expect(binLayout(o).compartments).toHaveLength(3);
    expect(o).toMatchObject({ interior: 'compartments', divX: 3, divY: 1, label: 'full', unitsX: 2 });
    expect(o.scoop).toBeGreaterThan(0);
  });

  it('batteries: a pocket grid, tall enough for the pockets', () => {
    const o = applyPreset(preset('batteries'), { ...DEFAULT_BIN, unitsX: 2, unitsY: 2 });
    expect(o.interior).toBe('pockets');
    expect(o.pocketPreset).toBe('aa');
    const { w, d } = binSize(o);
    const body = binBodyHeight(o);
    const L = pocketLayout(o, w, d, binFloorZ(o), o.lip ? body - LIP_SUPPORT_HEIGHT : body);
    expect(L.centers.length).toBeGreaterThan(1);
    expect(L.depth).toBeGreaterThanOrEqual(o.pocketDepth - 0.01);
    // Never lower than the bin was.
    expect(applyPreset(preset('batteries'), { ...DEFAULT_BIN, heightUnits: 8 }).heightUnits).toBe(8);
  });

  it('deep bin: one tall compartment, no taller than the drawer allows', () => {
    const o = applyPreset(preset('deep'), { ...DEFAULT_BIN, divX: 3, heightMode: 'internal', heightMm: 30 });
    expect(o).toMatchObject({ heightMode: 'units', heightUnits: 9, divX: 1, divY: 1, layout: null });
    const capped = applyPreset(preset('deep'), DEFAULT_BIN, { mm: 50 });
    expect(binTotalHeight(capped)).toBeLessThanOrEqual(50);
    expect(capped.heightUnits).toBeLessThan(9);
  });

  it('tool tray: low, with the tool-tray layout', () => {
    const o = applyPreset(preset('tool-tray'), { ...DEFAULT_BIN, unitsX: 3, heightUnits: 6, scoop: 0.5 });
    expect(o.heightUnits).toBe(3);
    expect(o.layout?.walls.length).toBe(2);
    expect(binLayout(o).compartments).toHaveLength(3);
    expect(o).toMatchObject({ scoop: 0, label: 'none' });
  });

  it('label everything: tabs on bins with compartments, the front wall on others, keeping text', () => {
    const plain = applyPreset(preset('label-all'), DEFAULT_BIN);
    expect(plain).toMatchObject({ label: 'full', labelText: '{contents}' });
    const named = applyPreset(preset('label-all'), { ...DEFAULT_BIN, label: 'left', labelText: 'M3' });
    expect(named).toMatchObject({ label: 'left', labelText: 'M3' });
    const pockets = applyPreset(preset('label-all'), { ...DEFAULT_BIN, interior: 'pockets' });
    expect(pockets).toMatchObject({ frontLabel: 'engraved', labelText: '{contents}', label: 'none' });
    // Containers keep their own labels.
    const box = { ...DEFAULT_BIN, container: 'box' } as BinOptions;
    expect(applyPreset(preset('label-all'), box).label).toBe('none');
  });

  it('keeps the size and what the preset is not about (base, holes, lip)', () => {
    const mine = { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, holes: 'magnets', base: 'lite', lip: false, holeCrushRibs: true } as BinOptions;
    for (const p of BIN_PRESETS) expect(applyPreset(p, mine), p.id).toMatchObject({ unitsX: 3, unitsY: 2, holes: 'magnets', base: 'lite', lip: false, holeCrushRibs: true });
    // Turns a container back into a plain bin.
    expect(applyPreset(preset('small-parts'), { ...DEFAULT_BIN, container: 'box' } as BinOptions).container).toBeUndefined();
  });

  it('applies to the selected bins as one undo step, like a template', () => {
    const a = s().addBin(0, 0, 2, 1);
    const b = s().addBin(2, 0, 1, 2);
    const c = s().addBin(4, 0, 1, 1);
    s().updateBin(a, { opts: { holes: 'magnets' } });
    history.checkpoint();
    const r = applyPresetToBins('small-parts', [a, b]);
    expect(r).toEqual({ changed: 2, shrunk: 0 });
    expect(opts(a)).toMatchObject({ unitsX: 2, unitsY: 1, divX: 3, label: 'full', holes: 'magnets' });
    expect(opts(b)).toMatchObject({ unitsX: 1, unitsY: 2, divX: 3 });
    expect(opts(c).divX).toBe(1);
    history.undo();
    expect(opts(a).divX).toBe(1);
    expect(opts(b).divX).toBe(1);
    expect(opts(a).holes).toBe('magnets');
    // Nothing to change: no undo step.
    applyPresetToBins('small-parts', [a]);
    history.clear();
    expect(applyPresetToBins('small-parts', [a])).toEqual({ changed: 0, shrunk: 0 });
    expect(history.canUndo()).toBe(false);
  });

  it('applies to new bins when none is selected, as one undo step', () => {
    applyPresetToNew('batteries');
    expect(s().newBin).toMatchObject({ interior: 'pockets', unitsX: 1, unitsY: 1 });
    const id = s().addBin(0, 0, 2, 2);
    expect(opts(id).interior).toBe('pockets');
    s().removeBin(id);
    history.undo();
    history.undo();
    expect(s().newBin.interior).toBe('compartments');
  });

  it('respects the print bed: a preset too tall for the printer is cut down to fit', () => {
    // A short custom printer: 60 mm of height.
    s().setPrinter('custom');
    s().setSetup({ maxH: 60 });
    const a = s().addBin(0, 0, 2, 2);
    const r = applyPresetToBins('deep', [a]);
    expect(r).toEqual({ changed: 1, shrunk: 1 });
    const bin = s().bins.find((b) => b.id === a)!;
    expect(placedOvershoot(computeLayout(s().drawer), bin, usableBeds(s().setup))).toBe(0);
    expect(bin.opts.heightUnits).toBeGreaterThan(3);
    expect(binTotalHeight(bin.opts)).toBeLessThanOrEqual(60);
    // New bins too.
    expect(applyPresetToNew('deep').shrunk).toBe(1);
    expect(binTotalHeight(s().newBin)).toBeLessThanOrEqual(60);
  });

  it('keeps under the drawer’s inside height when it is set', () => {
    s().setDrawer({ height: 50 });
    const a = s().addBin(0, 0, 1, 1);
    applyPresetToBins('deep', [a]);
    expect(binTotalHeight(opts(a))).toBeLessThanOrEqual(50 - binSeatHeight(s().baseplate));
  });
});
