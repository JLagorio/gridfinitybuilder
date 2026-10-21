import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Wasm } from '../src/lib/geometry/kernel';
import { registerFont, textOutline, textSolid } from '../src/lib/geometry/text';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

describe('label text', () => {
  it('lays out text at the requested cap height', () => {
    const t = textOutline('M3 SCREWS', { size: 5 });
    expect(t.contours.length).toBeGreaterThan(8);
    expect(t.size).toBe(5);
    // Flat capitals span exactly the cap height, centered on y = 0 (round ones overshoot a little).
    const ys = textOutline('MEH', { size: 5 }).contours.flat().map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(2.5, 2);
    expect(Math.min(...ys)).toBeCloseTo(-2.5, 2);
    expect(t.width).toBeGreaterThan(15);
  });

  it('shrinks to fit a width', () => {
    const t = textOutline('A very long label that will not fit', { size: 6, maxWidth: 30 });
    expect(t.width).toBeCloseTo(30, 3);
    expect(t.size).toBeLessThan(6);
  });

  it('extrudes into a valid solid, with holes in letters like O and B', () => {
    for (const [text, genus] of [
      ['I', 0],
      ['O', 1],
      ['B', 2],
    ] as const) {
      const m = textSolid(w, textOutline(text, { size: 10 }), 0, 0, 0, 1)!;
      expect(m.status()).toBe('NoError');
      expect(m.genus()).toBe(genus);
      m.delete();
    }
    const m = textSolid(w, textOutline('Hex bits ¼" & M4', { size: 4 }), 0, 0, 0, 0.6)!;
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(1);
    m.delete();
  });

  it('mirrors for text read from underneath', () => {
    const a = textOutline('L', { size: 10, align: 'left' });
    const b = textOutline('L', { size: 10, align: 'left', mirror: true });
    expect(Math.max(...a.contours.flat().map((p) => p[0]))).toBeCloseTo(-Math.min(...b.contours.flat().map((p) => p[0])), 6);
  });

  it('blank text is empty', () => {
    expect(textSolid(w, textOutline('   ', { size: 5 }), 0, 0, 0, 1)).toBeNull();
  });
});
