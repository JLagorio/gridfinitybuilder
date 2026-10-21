import { describe, expect, it } from 'vitest';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { binChecks, placedBinChecks, type PrintCheck } from '../src/lib/printability';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { binQrPlan } from '../src/lib/geometry/binQr';
import jsQR from 'jsqr';
import { drawerMap } from '../src/lib/inventory';
import { encodeQr, qrRects } from '../src/lib/qrEncode';
import type { QrEcc } from '../src/lib/qr';
import type { NamedDrawer, PlacedBin } from '../src/lib/project';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { BIN_INDEX } from '../src/components/panelIndex';
import { searchIndex } from '../src/lib/panelSearch';

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

describe('QR code settings', () => {
  it('are found by what people call them', () => {
    for (const q of ['qr', 'QR code', 'barcode', 'scan', 'code', 'phone camera']) expect([...(searchIndex(BIN_INDEX, q)?.hits ?? [])], q).toContain('qr');
    expect([...(searchIndex(BIN_INDEX, 'error correction')?.hits ?? [])]).toContain('qr-ecc');
    expect([...(searchIndex(BIN_INDEX, 'qr url')?.hits ?? [])]).toContain('qr-content');
  });
});

describe('QR codes on the drawer map', () => {
  const drawer = (bins: PlacedBin[]): NamedDrawer => ({ id: 'd', name: 'Drawer', drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 2 }, baseplate: DEFAULT_BASEPLATE, bins });
  const mapQr = (text: string, ecc: QrEcc) => {
    const code = encodeQr(text, ecc);
    return code && { size: code.size, rects: qrRects(code) };
  };

  /** Each QR drawn in a map (its white square and black module path), rasterised and decoded with jsQR. */
  function readMap(body: string): string[] {
    const out: string[] = [];
    const re = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#ffffff"\/><path d="([^"]+)" fill="#000000"/g;
    for (const m of body.matchAll(re)) {
      const [x0, y0, side] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const ppmm = 12;
      const pad = 40;
      const n = Math.round(side * ppmm) + 2 * pad;
      const img = new Uint8ClampedArray(n * n * 4).fill(255);
      for (const r of m[5].matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+z/g)) {
        const [rx, ry, rw, rh] = [Number(r[1]) - x0, Number(r[2]) - y0, Number(r[3]), Number(r[4])];
        for (let j = Math.round(ry * ppmm); j < Math.round((ry + rh) * ppmm); j++) {
          for (let i = Math.round(rx * ppmm); i < Math.round((rx + rw) * ppmm); i++) {
            const k = ((j + pad) * n + i + pad) * 4;
            img[k] = img[k + 1] = img[k + 2] = 0;
          }
        }
      }
      out.push(jsQR(img, n, n)?.data ?? '');
    }
    return out;
  }

  it('draws each bin’s code in its corner when asked, and it reads back as what the bin says', () => {
    const d = drawer([
      { id: 'a', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 2, qr: 'plate', qrContent: 'contents', labelText: 'M3' }), contents: 'M3 screws\nM3 nuts' },
      { id: 'b', x: 2, y: 0, opts: bin({ unitsX: 1, unitsY: 1, qr: 'front', qrText: 'https://example.com/b' }) },
      { id: 'c', x: 2, y: 1, opts: bin({ unitsX: 1, unitsY: 1 }) },
    ]);
    expect(readMap(drawerMap(d).body)).toEqual([]);
    expect(readMap(drawerMap(d, { qr: mapQr }).body).sort()).toEqual(['M3\nM3 screws\nM3 nuts', 'https://example.com/b'].sort());
  });
});
