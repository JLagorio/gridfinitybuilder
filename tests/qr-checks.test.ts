import { describe, expect, it } from 'vitest';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { binChecks, placedBinChecks, type PrintCheck } from '../src/lib/printability';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { binQrPlan } from '../src/lib/geometry/binQr';

const URL = 'https://example.com/inventory/bin/42';
const bin = (o: Partial<BinOptions>): BinOptions => ({ ...DEFAULT_BIN, qrContent: 'custom', qrText: URL, ...o });
const qr = (o: Partial<BinOptions>, nozzle?: number) => binChecks(bin(o), null, { nozzle }).filter((c) => c.rule.startsWith('qr'));
const rules = (cs: PrintCheck[]) => cs.map((c) => `${c.severity}:${c.rule}`);
/** The checks again with the fix applied. */
const fixed = (o: Partial<BinOptions>, c: PrintCheck, nozzle?: number) => qr({ ...o, ...c.fix!.bin }, nozzle);

describe('QR code print checks', () => {
  it('warns when the modules are under two lines of the nozzle, with a change that clears it', () => {
    // A short bin's front wall: the code fits, but its modules are tiny.
    const front = { qr: 'front' as const };
    const [c] = qr(front);
    expect(c.rule).toBe('qr-module');
    expect(c.severity).toBe('warn');
    expect(c.message).toMatch(/under two lines of the 0\.4 mm nozzle/);
    expect(c.fix?.label).toBe('Print it on a plate');
    expect(rules(fixed(front, c))).toEqual([]);

    // Lower error correction is the first thing to try.
    const lid = { lid: true, qr: 'lid' as const, qrText: 'x'.repeat(70) };
    const [l] = qr(lid);
    expect(l.fix).toEqual({ label: 'Use error correction L', bin: { qrEcc: 'L' } });
    expect(rules(fixed(lid, l))).toEqual([]);

    // A plate grows to suit a bigger nozzle.
    const plate = { qr: 'plate' as const };
    expect(qr(plate, 0.4)).toEqual([]);
    const [p] = qr(plate, 0.6);
    expect(p.fix?.label).toMatch(/^Make the plate \d+ mm$/);
    expect(rules(fixed(plate, p, 0.6))).toEqual([]);
    // A size asked for that's too small: back to automatic.
    const small = { qr: 'plate' as const, qrSize: 20 };
    expect(qr(small)[0].fix).toEqual({ label: 'Make the plate as large as reads well', bin: { qrSize: 0 } });
  });

  it('errs when the text is too long, and says what to do', () => {
    // Left off: too long for the front wall even at 0.4 mm modules.
    const long = { qr: 'front' as const, qrText: 'x'.repeat(400) };
    const [c] = qr(long);
    expect(c.rule).toBe('qr-fit');
    expect(c.severity).toBe('warn');
    expect(c.message).toMatch(/too long for the front wall, so it’s left off/);
    expect(c.message).toMatch(/Shorten the text, pick a bigger surface/);
    expect(c.message).toMatch(/finer nozzle/);
    expect(c.fix?.bin).toEqual({ qr: 'plate', qrSize: 0 });
    expect(binQrPlan(bin(long))?.spot).toBeNull();

    // It fits, but no change makes it scan with this nozzle: too long, with the most that fits.
    const huge = { qr: 'plate' as const, qrText: 'x'.repeat(600) };
    const [h] = qr(huge, 0.6);
    expect(h.rule).toBe('qr-fit');
    expect(h.fix).toBeUndefined();
    expect(h.message).toMatch(/too long for the plate/);
    expect(h.message).toMatch(/At most \d+ bytes fit the plate at 1\.2 mm modules/);
  });

  it('says when there is nothing to say, or nothing to put it on', () => {
    expect(qr({ qr: 'front', heightUnits: 6, qrContent: 'contents' }).map((c) => [c.severity, c.rule])).toEqual([['info', 'qr-fit']]);
    const [n] = qr({ qr: 'lid' });
    expect(n.message).toMatch(/no lid/);
    expect(n.fix).toEqual({ label: 'Add a stacking lid', bin: { lid: true } });
    expect(rules(fixed({ qr: 'lid' }, n))).toEqual([]);
    expect(qr({ qr: 'lid', lip: false })[0].fix?.bin).toEqual({ qr: 'plate' });
  });

  it('notes that one-colour codes scan poorly, and offers the inlay', () => {
    for (const qrStyle of ['raised', 'engraved'] as const) {
      const o = { qr: 'plate' as const, qrStyle };
      const cs = qr(o);
      expect(rules(cs)).toEqual(['info:qr-contrast']);
      expect(cs[0].message).toMatch(/lit|light it from the side/);
      expect(rules(fixed(o, cs[0]))).toEqual([]);
    }
    // On a stacking lid a raised code is engraved, and says so.
    expect(qr({ qr: 'lid', lid: true, qrStyle: 'raised' })[0].message).toMatch(/engraved on a stacking lid/);
  });

  it('notes the filament changes of a two-colour code on the front wall', () => {
    const o = { qr: 'front' as const, unitsX: 2, heightUnits: 6 };
    const cs = qr(o);
    expect(rules(cs)).toEqual(['info:qr-swaps']);
    expect(cs[0].message).toMatch(/every layer/);
    expect(rules(fixed(o, cs[0]))).toEqual([]);
  });

  it('reads the contents where the bin is placed', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 2, gridY: 1 });
    const b = { id: 'b', x: 0, y: 0, opts: bin({ qr: 'plate', qrContent: 'contents' }) };
    expect(rules(placedBinChecks(layout, b).filter((c) => c.rule.startsWith('qr')))).toEqual(['info:qr-fit']);
    expect(rules(placedBinChecks(layout, { ...b, contents: 'M3 screws' }).filter((c) => c.rule.startsWith('qr')))).toEqual([]);
  });
});
