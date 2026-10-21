import { describe, expect, it } from 'vitest';
import { formatBoth, formatLength, inchFraction, isRounded, lengthFieldText, parseLength } from '../src/lib/units';

describe('parseLength (extended)', () => {
  it.each([
    ['20-1/8in', 'mm', 511.175],
    ['3/4', 'in', 19.05],
    ['1 3/4', 'in', 44.45],
    ["1'", 'mm', 304.8],
    ["1' 2 1/2\"", 'mm', 368.3],
    ['1ft 2in', 'mm', 355.6],
    ['0.5m', 'in', 500],
    ['44.5 mm', 'in', 44.5],
    ['20,5', 'mm', 20.5],
    ['12″', 'mm', 304.8],
  ] as const)('%s (%s) → %f mm', (input, unit, mm) => {
    expect(parseLength(input, unit)).toBeCloseTo(mm, 6);
  });

  it('rejects junk', () => {
    expect(parseLength('1.5 1/2')).toBeNull();
    expect(parseLength('in')).toBeNull();
    expect(parseLength("1' junk")).toBeNull();
  });
});

describe('formatting', () => {
  it('reduces fractions', () => {
    expect(inchFraction(20.125, 16)).toBe('20 1/8');
    expect(inchFraction(0.5, 16)).toBe('1/2');
    expect(inchFraction(3, 16)).toBe('3');
    expect(inchFraction(2.99, 16)).toBe('3');
  });
  it('formats mm and inches', () => {
    expect(formatLength(511.175, 'in')).toBe('20 1/8″');
    expect(formatLength(511.175, 'mm')).toBe('511.2 mm');
    expect(formatLength(25.4, 'in', { precision: 0 })).toBe('1″');
    expect(formatBoth(25.4, 'in')).toBe('1″ (25.4 mm)');
    expect(formatBoth(42, 'in')).toBe('≈1 5/8″ (42 mm)');
  });
  it('field text round-trips', () => {
    for (const mm of [511.175, 42, 12.7, 376.5]) {
      for (const u of ['mm', 'in'] as const) expect(parseLength(lengthFieldText(mm, u), u)).toBeCloseTo(mm, 2);
    }
    expect(isRounded(12.7)).toBe(false);
    expect(isRounded(42)).toBe(true);
  });
});
