import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { QR_ECCS, QR_QUIET, encodeQr, qrByteLength, qrCapacity, qrCodewords, qrDark, qrFit, qrMode, qrRects, qrSize, type QrCode, type QrEcc } from '../src/lib/qr';

/** The code as an RGBA image, `px` pixels a module, with its quiet zone. */
function render(code: QrCode, px = 4, quiet = QR_QUIET): { data: Uint8ClampedArray; width: number; height: number } {
  const n = (code.size + 2 * quiet) * px;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qrDark(code, Math.floor(x / px) - quiet, Math.floor(y / px) - quiet)) continue;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width: n, height: n };
}

function decode(code: QrCode, px = 4) {
  const img = render(code, px);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
}

/** Text of exactly `bytes` UTF-8 bytes (lower case, so it's byte mode). */
const bytesOf = (bytes: number) => Array.from({ length: bytes }, (_, i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26]).join('');

describe('QR encoder', () => {
  it('knows the standard capacities', () => {
    expect(qrCapacity(1, 'M')).toBe(14);
    expect(qrCapacity(1, 'L')).toBe(17);
    expect(qrCapacity(1, 'H')).toBe(7);
    expect(qrCapacity(1, 'L', 'numeric')).toBe(41);
    expect(qrCapacity(1, 'H', 'alphanumeric')).toBe(10);
    expect(qrCapacity(5, 'Q')).toBe(60);
    expect(qrCapacity(10, 'M')).toBe(213);
    expect(qrCapacity(40, 'L')).toBe(2953);
    expect(qrCapacity(40, 'L', 'numeric')).toBe(7089);
    expect(qrCapacity(40, 'H', 'alphanumeric')).toBe(1852);
    expect(qrSize(1)).toBe(21);
    expect(qrSize(40)).toBe(177);
  });

  it('makes the reference codewords (ISO/IEC 18004 annex I, and HELLO WORLD at 1-M)', () => {
    const hex = (s: string) => s.split(' ').map((h) => parseInt(h, 16));
    expect(qrCodewords('01234567', 'M')).toEqual(hex('10 20 0C 56 61 80 EC 11 EC 11 EC 11 EC 11 EC 11 A5 24 D4 C1 ED 36 C7 87 2C 55'));
    expect(qrCodewords('HELLO WORLD', 'M')).toEqual(hex('20 5B 0B 78 D1 72 DC 4D 43 40 EC 11 EC 11 EC 11 C4 23 27 77 EB D7 E7 E2 5D 17'));
  });

  it('picks the most compact mode', () => {
    expect(qrMode('0123456789')).toBe('numeric');
    expect(qrMode('HELLO WORLD $%*+-./:')).toBe('alphanumeric');
    expect(qrMode('Hello')).toBe('byte');
    expect(qrMode('M3 × 8')).toBe('byte');
    expect(qrByteLength('×')).toBe(2);
  });

  it('decodes back to the text, in every mode, with UTF-8', () => {
    const texts = [
      '0',
      '31415926535897932384626433832795',
      'HELLO WORLD',
      'HTTPS://EXAMPLE.COM/BIN/42',
      'https://example.com/inventory?bin=42&drawer=3',
      'M3 × 8 screws\nM3 × 12 screws\nM3 nuts',
      'Résistances ¼ W — 1 kΩ … 10 kΩ',
      '日本語のテキスト',
      '🔩 Bolts and 🔧 tools',
    ];
    for (const ecc of QR_ECCS) {
      for (const text of texts) {
        const code = encodeQr(text, ecc)!;
        expect(code, `${ecc} ${text}`).not.toBeNull();
        const res = decode(code);
        expect(res?.data, `${ecc} ${text}`).toBe(text);
      }
    }
  });

  it('reads with every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const code = encodeQr('Mask test 12345', 'Q', { mask })!;
      expect(code.mask).toBe(mask);
      expect(decode(code)?.data).toBe('Mask test 12345');
    }
  });

  // Every version at M; a spread at L, Q and H. Each text fills its version exactly; one byte more needs the next.
  const cases: [QrEcc, number][] = [];
  for (let v = 1; v <= 40; v++) cases.push(['M', v]);
  for (const ecc of ['L', 'Q', 'H'] as const) for (const v of [1, 2, 3, 5, 7, 9, 10, 14, 20, 27, 33, 40]) cases.push([ecc, v]);

  it('fills each version to the last byte and decodes', () => {
    for (const [ecc, v] of cases) {
      const cap = qrCapacity(v, ecc);
      const text = bytesOf(cap);
      const code = encodeQr(text, ecc)!;
      expect(code.version, `${ecc} v${v}`).toBe(v);
      expect(code.size).toBe(qrSize(v));
      expect(decode(code, v > 20 ? 3 : 4)?.data, `${ecc} v${v}`).toBe(text);
      if (v < 40) expect(qrFit(bytesOf(cap + 1), ecc)?.version, `${ecc} v${v} + 1`).toBe(v + 1);
      else expect(encodeQr(bytesOf(cap + 1), ecc)).toBeNull();
    }
  }, 120_000);

  it('stops at the version asked for', () => {
    expect(encodeQr(bytesOf(100), 'M', { maxVersion: 4 })).toBeNull();
    expect(encodeQr('hi', 'M', { minVersion: 3 })?.version).toBe(3);
    expect(decode(encodeQr('hi', 'M', { minVersion: 3 })!)?.data).toBe('hi');
  });

  it('merges the dark modules into rectangles that cover them exactly once', () => {
    for (const text of ['Hello', bytesOf(200)]) {
      const code = encodeQr(text, 'M')!;
      const cover = new Uint8Array(code.size * code.size);
      const rects = qrRects(code);
      for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cover[j * code.size + i]++;
      expect([...cover]).toEqual([...code.modules]);
      // Far fewer than one per dark module.
      const dark = code.modules.reduce((t, v) => t + v, 0);
      expect(rects.length).toBeLessThan(dark * 0.6);
    }
  });
});
