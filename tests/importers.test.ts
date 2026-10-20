import { describe, expect, it } from 'vitest';
import { flattenPath, parseSVG, parseTransform } from '../src/lib/trace/svg';
import { chainLoops, parseDXF } from '../src/lib/trace/dxf';
import { bounds, signedArea } from '../src/lib/trace/polygon';
import type { Pt } from '../src/lib/trace/image';

const area = (p: Pt[]) => Math.abs(signedArea(p));
const size = (p: Pt[]) => {
  const b = bounds(p);
  return [b.x1 - b.x0, b.y1 - b.y0];
};

describe('SVG import', () => {
  it('uses viewBox + physical width for the scale, and flips y up', () => {
    const r = parseSVG(`<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
        <rect x="10" y="10" width="40" height="20"/>
      </svg>`);
    expect(r.unitsAssumed).toBe(false);
    expect(r.mmPerUnit).toBeCloseTo(0.5, 9);
    expect(r.shapes).toHaveLength(1);
    const b = bounds(r.shapes[0].points);
    expect([b.x0, b.x1]).toEqual([5, 25]);
    // SVG y = 10..30 user units = 5..15 mm down from the top → -5..-15 mm with y up.
    expect(b.y1).toBeCloseTo(-5, 9);
    expect(b.y0).toBeCloseTo(-15, 9);
  });

  it('inches and points', () => {
    const inch = parseSVG('<svg width="2in" height="1in" viewBox="0 0 2 1"><rect width="1" height="1"/></svg>');
    expect(size(inch.shapes[0].points)[0]).toBeCloseTo(25.4, 6);
    const pt = parseSVG('<svg width="72pt" height="72pt" viewBox="0 0 72 72"><rect width="72" height="36"/></svg>');
    expect(size(pt.shapes[0].points)[0]).toBeCloseTo(25.4, 6);
  });

  it('assumes mm when the file has no physical size, and takes an override', () => {
    const r = parseSVG('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10"/></svg>');
    expect(r.unitsAssumed).toBe(true);
    expect(area(r.shapes[0].points)).toBeCloseTo(Math.PI * 100, -0.5);
    const px = parseSVG('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10"/></svg>', { mmPerUnit: 25.4 / 96 });
    expect(size(px.shapes[0].points)[0]).toBeCloseTo((20 * 25.4) / 96, 1);
  });

  it('flattens arcs, cubics, quadratics and smooth curves', () => {
    // A circle from two arcs, relative commands.
    const circle = flattenPath('M 0 50 a 50 50 0 1 0 100 0 a 50 50 0 1 0 -100 0 z');
    expect(circle).toHaveLength(1);
    expect(circle[0].closed).toBe(true);
    expect(area(circle[0].points)).toBeCloseTo(Math.PI * 2500, -1.5);
    const b = bounds(circle[0].points);
    expect(b.y0).toBeCloseTo(0, 1);
    expect(b.y1).toBeCloseTo(100, 1);
    // Packed numbers and implicit repeats: "M0,0 10,0" = M then L.
    const tri = flattenPath('M0,0 10,0L10-10z');
    expect(tri[0].points).toEqual([
      [0, 0],
      [10, 0],
      [10, -10],
    ]);
    // Cubic with S, and Q with T, stay within their control hulls.
    const c = flattenPath('M0 0C0 10 10 10 10 0S20-10 20 0Q25 5 30 0T40 0Z')[0].points;
    const cb = bounds(c);
    expect(cb.x1).toBe(40);
    expect(cb.y1).toBeLessThanOrEqual(10);
    expect(cb.y1).toBeGreaterThan(5);
    // Arc flags without separators.
    const packed = flattenPath('M0 0a5 5 0 105 5z');
    expect(packed[0].points.length).toBeGreaterThan(8);
  });

  it('applies group and element transforms, skips defs and open lines', () => {
    const r = parseSVG(`
      <svg width="100mm" height="100mm" viewBox="0 0 100 100">
        <defs><rect id="hidden" width="99" height="99"/></defs>
        <g transform="translate(50 50) scale(2)">
          <rect id="a" x="0" y="0" width="10" height="5" transform="rotate(90)"/>
        </g>
        <polygon points="0,0 10,0 10,10"/>
        <polyline points="0,0 10,0 10,10"/>
        <path d="M0 0 L10 10"/>
        <ellipse cx="80" cy="80" rx="10" ry="5"/>
      </svg>`);
    expect(r.shapes.map((s) => s.source)).toEqual(['rect#a', 'polygon', 'ellipse']);
    // rotate(90) then scale 2: a 10 × 20 box from x = 40..50, y = 50..70 (SVG) → y up −50..−70.
    const b = bounds(r.shapes[0].points);
    expect(b.x0).toBeCloseTo(40, 9);
    expect(b.x1).toBeCloseTo(50, 9);
    expect(b.y0).toBeCloseTo(-70, 9);
    expect(b.y1).toBeCloseTo(-50, 9);
    expect(r.warnings.join(' ')).toMatch(/2 open paths/);
    expect(area(r.shapes[2].points)).toBeCloseTo(Math.PI * 50, -0.5);
  });

  it('parses transform lists', () => {
    const m = parseTransform('translate(10,20) rotate(90 5 5) skewX(0) matrix(1 0 0 1 0 0)');
    // rotate(90) about (5, 5) maps (5, 0) → (10, 5); then translate.
    const x = m[0] * 5 + m[2] * 0 + m[4];
    const y = m[1] * 5 + m[3] * 0 + m[5];
    expect(x).toBeCloseTo(20, 9);
    expect(y).toBeCloseTo(25, 9);
  });

  it('rejects non-SVG text', () => {
    expect(() => parseSVG('hello')).toThrow(/Not an SVG/);
  });
});

/** Minimal DXF writer for tests. */
function dxf(units: number | null, entities: (string | number)[][]): string {
  const out: (string | number)[] = [];
  if (units !== null) out.push(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC');
  out.push(0, 'SECTION', 2, 'ENTITIES');
  for (const e of entities) out.push(...e);
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n');
}

describe('DXF import', () => {
  it('closed LWPOLYLINE in inches', () => {
    const r = parseDXF(
      dxf(1, [[0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1, 10, 0, 20, 0, 10, 1, 20, 0, 10, 1, 20, 2, 10, 0, 20, 2]]),
    );
    expect(r.mmPerUnit).toBe(25.4);
    expect(r.unitsAssumed).toBe(false);
    expect(r.shapes).toHaveLength(1);
    const [w, h] = size(r.shapes[0].points);
    expect(w).toBeCloseTo(25.4, 9);
    expect(h).toBeCloseTo(50.8, 9);
  });

  it('bulges become arcs (a 20 × 10 slot)', () => {
    // Two straight sides and two semicircular ends: bulge 1 = 180°.
    const r = parseDXF(
      dxf(4, [[0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 5, 20, 0, 10, 15, 20, 0, 42, 1, 10, 15, 20, 10, 10, 5, 20, 10, 42, 1]]),
    );
    const p = r.shapes[0].points;
    const [w, h] = size(p);
    expect(w).toBeCloseTo(20, 2);
    expect(h).toBeCloseTo(10, 6);
    expect(area(p)).toBeCloseTo(10 * 10 + Math.PI * 25, -0.5);
  });

  it('chains LINEs and ARCs into a loop; CIRCLE; unitless is assumed mm', () => {
    // A "D": line up the left side, arc around the right.
    const r = parseDXF(
      dxf(null, [
        [0, 'LINE', 10, 0, 20, -10, 11, 0, 21, 10],
        [0, 'ARC', 10, 0, 20, 0, 40, 10, 50, -90, 51, 90],
        [0, 'CIRCLE', 10, 50, 20, 0, 40, 5],
        [0, 'LINE', 10, 100, 20, 0, 11, 120, 21, 0],
      ]),
    );
    expect(r.unitsAssumed).toBe(true);
    expect(r.shapes.map((s) => s.source).sort()).toEqual(['CIRCLE', 'LINE/ARC chain']);
    const d = r.shapes.find((s) => s.source !== 'CIRCLE')!.points;
    expect(area(d)).toBeCloseTo((Math.PI * 100) / 2, -0.5);
    expect(area(r.shapes.find((s) => s.source === 'CIRCLE')!.points)).toBeCloseTo(Math.PI * 25, -0.5);
    expect(r.warnings.join(' ')).toMatch(/1 open outline/);
  });

  it('POLYLINE with VERTEX entities and a closed SPLINE', () => {
    const r = parseDXF(
      dxf(4, [
        [0, 'POLYLINE', 66, 1, 70, 1],
        [0, 'VERTEX', 10, 0, 20, 0],
        [0, 'VERTEX', 10, 10, 20, 0],
        [0, 'VERTEX', 10, 10, 20, 10],
        [0, 'SEQEND'],
        // Degree-1 spline through a square = the square itself.
        [0, 'SPLINE', 70, 1, 71, 1, 40, 0, 40, 0, 40, 1, 40, 2, 40, 3, 40, 4, 40, 4, 10, 20, 20, 0, 10, 30, 20, 0, 10, 30, 20, 10, 10, 20, 20, 10, 10, 20, 20, 0],
      ]),
    );
    expect(r.shapes.map((s) => s.source)).toEqual(['POLYLINE', 'SPLINE']);
    expect(area(r.shapes[0].points)).toBeCloseTo(50, 6);
    expect(area(r.shapes[1].points)).toBeCloseTo(100, 3);
  });

  it('chainLoops reverses pieces as needed', () => {
    const { loops, open } = chainLoops(
      [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0, 1],
          [1, 1],
        ],
        [
          [1, 0],
          [1, 1],
        ],
        [
          [0, 0],
          [0, 1],
        ],
      ],
      1e-6,
    );
    expect(open).toBe(0);
    expect(loops).toHaveLength(1);
    expect(area(loops[0])).toBeCloseTo(1, 9);
  });
});
