/**
 * Length units. Everything is stored in mm; inches only exist at the edges
 * (what the user types and what we show them).
 */

export type Units = 'mm' | 'in';

export const MM_PER_IN = 25.4;

/** Inch display precision: a fraction denominator, or 0 for decimal inches. */
export type InchPrecision = 0 | 4 | 8 | 16 | 32 | 64;

export const DEFAULT_INCH_PRECISION: InchPrecision = 16;

/**
 * Parse a length into mm. Accepts:
 *   "510.5", "510.5mm", "51cm", "0.51m"
 *   "20.1in", "20.1\"", "20 1/8", "20-1/8in", "3/4\"", "1' 2 1/2\"" (feet + inches)
 * Bare numbers use `defaultUnit`. Returns null for anything else.
 */
export function parseLength(input: string, defaultUnit: Units = 'mm'): number | null {
  let s = input
    .trim()
    .toLowerCase()
    .replace(/″|”|“|''/g, '"')
    .replace(/′|’|‘/g, "'")
    .replace(/,/g, '.');
  if (!s) return null;

  // Feet, optionally followed by inches: 1' or 1' 2" or 1ft 2 1/2in
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(.*)$/);
  if (ft) {
    const feet = parseFloat(ft[1]) * 12 * MM_PER_IN;
    const rest = ft[2].trim();
    if (!rest) return feet;
    const inch = parseLength(rest, 'in');
    return inch === null ? null : feet + inch;
  }

  // A whole number and its fraction need a space or dash between them ("11/64" is not 1 1/64).
  const m = s.match(/^(\d+(?:\.\d+)?)?(?:(?:^|\s+|\s*-\s*)(\d+)\s*\/\s*(\d+))?\s*(mm|cm|m|in|inch|inches|")?$/);
  if (!m || (!m[1] && !m[2])) return null;
  // "3/4" parses as whole = undefined, fraction = 3/4. "20 1/8" as 20 + 1/8.
  let v = m[1] ? parseFloat(m[1]) : 0;
  if (m[2] && m[3]) {
    const den = parseInt(m[3], 10);
    if (!den) return null;
    // A decimal followed by a fraction ("1.5 1/2") is junk.
    if (m[1] && m[1].includes('.')) return null;
    v += parseInt(m[2], 10) / den;
  }
  s = m[4] ?? defaultUnit;
  if (s === 'cm') return v * 10;
  if (s === 'm') return v * 1000;
  if (s === 'in' || s === 'inch' || s === 'inches' || s === '"') return v * MM_PER_IN;
  return v;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Inches as a mixed fraction rounded to 1/denom: 20.125 → "20 1/8". */
export function inchFraction(inches: number, denom: Exclude<InchPrecision, 0>): string {
  const neg = inches < 0;
  let ticks = Math.round(Math.abs(inches) * denom);
  const whole = Math.floor(ticks / denom);
  ticks -= whole * denom;
  let out: string;
  if (!ticks) out = String(whole);
  else {
    const g = gcd(ticks, denom);
    const frac = `${ticks / g}/${denom / g}`;
    out = whole ? `${whole} ${frac}` : frac;
  }
  return neg && out !== '0' ? `-${out}` : out;
}

export interface FormatOptions {
  /** Append the unit symbol (default true). */
  unit?: boolean;
  /** Inch precision (default 1/16). */
  precision?: InchPrecision;
  /** Decimal places for mm (default 1, trailing zeros dropped). */
  mmDigits?: number;
}

const trim = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/** Format a length stored in mm for display. */
export function formatLength(mm: number, units: Units, o: FormatOptions = {}): string {
  const unit = o.unit ?? true;
  if (units === 'mm') return `${trim(mm, o.mmDigits ?? 1)}${unit ? ' mm' : ''}`;
  const precision = o.precision ?? DEFAULT_INCH_PRECISION;
  const inches = mm / MM_PER_IN;
  const text = precision ? inchFraction(inches, precision) : trim(inches, 3);
  return `${text}${unit ? '″' : ''}`;
}

/** True when an inch value is not exactly representable at this precision (so the display is rounded). */
export function isRounded(mm: number, precision: InchPrecision = DEFAULT_INCH_PRECISION): boolean {
  if (!precision) return false;
  const ticks = (mm / MM_PER_IN) * precision;
  return Math.abs(ticks - Math.round(ticks)) * (MM_PER_IN / precision) > 0.05;
}

/** "20 1/8″ (511.2 mm)" in inches; "511.2 mm" in mm. */
export function formatBoth(mm: number, units: Units, o: FormatOptions = {}): string {
  if (units === 'mm') return formatLength(mm, 'mm', o);
  const approx = isRounded(mm, o.precision) ? '≈' : '';
  return `${approx}${formatLength(mm, 'in', o)} (${formatLength(mm, 'mm', o)})`;
}

/** Text to put in an editable field: no unit symbol, inches as a fraction. */
export function lengthFieldText(mm: number, units: Units, precision: InchPrecision = DEFAULT_INCH_PRECISION): string {
  if (units === 'mm') return trim(mm, 2);
  // Exact fractions read better; fall back to decimals when the fraction would be rounded.
  return isRounded(mm, precision) ? trim(mm / MM_PER_IN, 4) : formatLength(mm, 'in', { unit: false, precision });
}

/** Snap step for dragging in the given units: 1 mm, or 1/16″. */
export function snapStep(units: Units, precision: InchPrecision = DEFAULT_INCH_PRECISION): number {
  return units === 'mm' ? 1 : MM_PER_IN / (precision || 16);
}
