import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { computeLayout, DEFAULT_DRAWER, parseLength } from '../src/lib/layout/drawer';
import { fitsOnBed, packIntoPlates, packPlates, type PackItem, type Placement } from '../src/lib/layout/pack';
import { DEFAULT_SETUP, packOptions, planBaseplate, type PrintSetup } from '../src/lib/layout/plan';
import { axisCuts, enumeratePartitions, minPieces } from '../src/lib/layout/split';
import { PRINTERS, findPrinter, type BedRect } from '../src/lib/printers';
import { DEFAULT_BIN, DEFAULT_PROJECT, planJob, type ProjectState } from '../src/lib/project';

describe('computeLayout', () => {
  it('fits the reference drawer (510.5 × 376.5) to a 12 × 8 grid with centered margins', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });
    expect([l.nx, l.ny]).toEqual([12, 8]);
    expect([l.plateW, l.plateD]).toEqual([510, 376]);
    expect(l.margins).toEqual({ left: 3, right: 3, front: 20, back: 20 });
    expect(l.originX).toBe(3);
  });

  it('respects alignment', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, width: 100, depth: 100, clearance: 0, alignX: 0, alignY: 1 });
    expect(l.nx).toBe(2);
    expect(l.margins.left).toBe(0);
    expect(l.margins.right).toBe(16);
    expect(l.margins.front).toBe(16);
    expect(l.margins.back).toBe(0);
  });

  it('grid mode has no margins', () => {
    const l = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 5, gridY: 4 });
    expect([l.plateW, l.plateD, l.nx, l.ny]).toEqual([210, 168, 5, 4]);
  });
});

describe('parseLength', () => {
  it.each([
    ['510.5', 'mm', 510.5],
    ['51cm', 'mm', 510],
    ['20in', 'mm', 508],
    ['20 1/8 in', 'mm', 511.175],
    ['1/2"', 'mm', 12.7],
    ['20', 'in', 508],
  ] as const)('%s (%s) → %f mm', (input, unit, mm) => {
    expect(parseLength(input, unit)).toBeCloseTo(mm, 6);
  });

  it('rejects junk', () => {
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('1/0')).toBeNull();
  });
});

describe('axis splitting', () => {
  it('only cuts on cell boundaries by default', () => {
    const cuts = axisCuts(3, 12, 42, 510, 236, false);
    expect(cuts).toEqual(Array.from({ length: 11 }, (_, k) => 3 + 42 * (k + 1)));
  });

  it('finds the minimum piece count', () => {
    const cuts = axisCuts(3, 12, 42, 510, 236, false);
    expect(minPieces(510, cuts, 236)).toBe(3);
    const parts = enumeratePartitions(510, cuts, 236);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length - 1).toBe(3);
      for (let i = 1; i < p.length; i++) expect(p[i] - p[i - 1]).toBeLessThanOrEqual(236 + 1e-9);
    }
  });

  it('forces a margin cut when a margin cannot share a piece with a cell', () => {
    // 200 mm margin + one 42 mm cell > 236
    const cuts = axisCuts(200, 2, 42, 284, 236, false);
    expect(cuts).toContain(200);
  });
});

const usable = (s: PrintSetup) => ({ W: s.bedW - 2 * s.plateMargin, D: s.bedD - 2 * s.plateMargin });

function assertPlacementsValid(
  placements: Placement[],
  s: { bedW: number; bedD: number; margin: number; spacing: number; exclude?: BedRect[] },
) {
  const rects = placements.map((p) => ({
    x0: p.x,
    y0: p.y,
    x1: p.x + (p.rotated ? p.d : p.w),
    y1: p.y + (p.rotated ? p.w : p.d),
  }));
  for (const r of rects) {
    expect(r.x0).toBeGreaterThanOrEqual(s.margin - 1e-6);
    expect(r.y0).toBeGreaterThanOrEqual(s.margin - 1e-6);
    expect(r.x1).toBeLessThanOrEqual(s.bedW - s.margin + 1e-6);
    expect(r.y1).toBeLessThanOrEqual(s.bedD - s.margin + 1e-6);
    // Clear of every exclusion area by at least the spacing.
    for (const e of s.exclude ?? []) {
      expect(Math.max(e.x - r.x1, r.x0 - (e.x + e.w), e.y - r.y1, r.y0 - (e.y + e.d))).toBeGreaterThanOrEqual(s.spacing - 1e-6);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const gapX = Math.max(b.x0 - a.x1, a.x0 - b.x1);
      const gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
      // Separated along at least one axis by the spacing.
      expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(s.spacing - 1e-6);
    }
  }
}

describe('planBaseplate', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });

  for (const style of ['auto', 'balanced', 'largest'] as const) {
    it(`"${style}" tiles the whole plate with pieces that fit the bed`, () => {
      const setup = { ...DEFAULT_SETUP, splitStyle: style };
      const plan = planBaseplate(layout, setup);
      expect(plan.error).toBeUndefined();
      expect(plan.pieces.length).toBe(6);
      const { W, D } = usable(setup);
      let area = 0;
      for (const p of plan.pieces) {
        const w = p.x1 - p.x0;
        const d = p.y1 - p.y0;
        area += w * d;
        expect((w <= W && d <= D) || (d <= W && w <= D)).toBe(true);
      }
      expect(area).toBeCloseTo(layout.plateW * layout.plateD, 6);
      // Every cell belongs to exactly one piece.
      for (let i = 0; i < layout.nx; i++) {
        for (let j = 0; j < layout.ny; j++) {
          const owners = plan.pieces.filter((p) => i >= p.cells.x0 && i < p.cells.x1 && j >= p.cells.y0 && j < p.cells.y1);
          expect(owners.length).toBe(1);
        }
      }
      for (const pl of plan.plates) assertPlacementsValid(pl.placements, { ...setup, margin: setup.plateMargin });
    });
  }

  it('"auto" needs no more plates than the other strategies', () => {
    const plates = (splitStyle: PrintSetup['splitStyle']) =>
      planBaseplate(layout, { ...DEFAULT_SETUP, splitStyle }).plates.length;
    expect(plates('auto')).toBeLessThanOrEqual(plates('balanced'));
    expect(plates('auto')).toBeLessThanOrEqual(plates('largest'));
    expect(plates('auto')).toBe(4);
  });

  it('without nesting every piece gets its own plate', () => {
    const plan = planBaseplate(layout, { ...DEFAULT_SETUP, nest: false });
    expect(plan.plates.length).toBe(plan.pieces.length);
  });

  it('handles a small bed by cutting into more pieces', () => {
    const plan = planBaseplate(layout, { ...DEFAULT_SETUP, bedW: 180, bedD: 180 });
    expect(plan.error).toBeUndefined();
    for (const p of plan.pieces) {
      expect(p.x1 - p.x0).toBeLessThanOrEqual(160);
      expect(p.y1 - p.y0).toBeLessThanOrEqual(160);
    }
  });
});

describe('packPlates', () => {
  it('never overlaps parts and keeps the spacing (randomized)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 40; trial++) {
      const items: PackItem[] = Array.from({ length: 3 + Math.floor(rnd() * 25) }, (_, i) => ({
        key: `k${i}`,
        w: 20 + Math.floor(rnd() * 200),
        d: 20 + Math.floor(rnd() * 200),
      }));
      const opts = { bedW: 256, bedD: 256, margin: 10, spacing: 2 + Math.floor(rnd() * 6), nest: true };
      const { plates, oversize } = packPlates(items, opts);
      expect(oversize.length).toBe(0);
      expect(plates.flatMap((p) => p.placements).length).toBe(items.length);
      for (const pl of plates) assertPlacementsValid(pl.placements, opts);
    }
  });

  it('reports parts that cannot fit any plate', () => {
    const { oversize } = packPlates([{ key: 'big', w: 300, d: 20 }], { bedW: 256, bedD: 256, margin: 10, spacing: 3, nest: true });
    expect(oversize.map((o) => o.key)).toEqual(['big']);
  });
});

describe('packIntoPlates', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });
  const plan = planBaseplate(layout, DEFAULT_SETUP);
  const opts = { bedW: 256, bedD: 256, margin: 10, spacing: 3, nest: true };
  const keys = (n: number): PackItem[] => Array.from({ length: n }, (_, i) => ({ key: `key:${i + 1}`, w: 9.7, d: 2.7 }));

  it('fills the free space around the pieces without moving them', () => {
    const { plates, extra, oversize } = packIntoPlates(plan.plates, keys(27), opts);
    expect(extra).toEqual([]);
    expect(oversize).toEqual([]);
    expect(plates.flatMap((p) => p.placements).filter((p) => p.key.startsWith('key:')).length).toBe(27);
    plates.forEach((pl, i) => {
      expect(pl.placements.slice(0, plan.plates[i].placements.length)).toEqual(plan.plates[i].placements);
      assertPlacementsValid(pl.placements, opts);
    });
  });

  it('puts what does not fit on new plates', () => {
    const full = [{ placements: [{ key: 'big', x: 10, y: 10, w: 236, d: 236, rotated: false }] }];
    const { plates, extra } = packIntoPlates(full, keys(30), opts);
    expect(plates[0].placements.length).toBe(1);
    expect(extra.length).toBe(1);
    expect(extra[0].placements.length).toBe(30);
    assertPlacementsValid(extra[0].placements, opts);
  });
});

describe('bed exclusion areas', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });
  const setupFor = (printerId: string, patch: Partial<PrintSetup> = {}): PrintSetup => {
    const p = findPrinter(printerId);
    return { ...DEFAULT_SETUP, printerId, bedW: p.bedW, bedD: p.bedD, maxH: p.maxH, ...patch };
  };
  // The reference drawer, filled with 1×1 bins.
  const fullDrawer = (setup: PrintSetup, connector: 'none' | 'bowtie'): ProjectState => ({
    ...DEFAULT_PROJECT,
    setup,
    baseplate: { ...DEFAULT_BASEPLATE, connector },
    bins: Array.from({ length: 96 }, (_, i) => ({ id: `b${i}`, x: i % 12, y: Math.floor(i / 12), opts: DEFAULT_BIN })),
  });
  const x1c = packOptions(setupFor('x1c'));

  it('match the machine profiles baked into public/bambu', () => {
    for (const p of PRINTERS.filter((pr) => pr.bambu)) {
      const cfg = JSON.parse(readFileSync(new URL(`../public/bambu/${p.id}.json`, import.meta.url), 'utf8'));
      const pts = (cfg.bed_exclude_area as string[]).map((v) => v.split('x').map(Number));
      const areas: BedRect[] = [];
      for (let i = 0; i < pts.length; i += 4) {
        const xs = pts.slice(i, i + 4).map(([x]) => x);
        const ys = pts.slice(i, i + 4).map(([, y]) => y);
        const [x, y] = [Math.min(...xs), Math.min(...ys)];
        areas.push({ x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y });
      }
      expect(p.bedExclude ?? [], p.id).toEqual(areas);
    }
    expect(PRINTERS.filter((p) => p.bedExclude?.length).map((p) => p.id)).toEqual(['p1s', 'p1p', 'x1c', 'x1e']);
  });

  it('keep every part on an X1C plate one spacing clear', () => {
    for (const spacing of [3, 5]) {
      const setup = setupFor('x1c', { spacing });
      const job = planJob(fullDrawer(setup, 'bowtie'));
      expect(job.warnings).toEqual([]);
      expect(job.plates.filter((p) => p.group === 'baseplate').length).toBe(4);
      // 25 bins fit a plate at 3 mm spacing; at 5 mm only 24 fit around the area.
      expect(job.plates.filter((p) => p.group === 'bins').map((p) => p.placements.length)).toEqual(
        spacing === 3 ? [25, 25, 25, 21] : [24, 24, 24, 24],
      );
      for (const pl of job.plates) assertPlacementsValid(pl.placements, packOptions(setup));
    }
  });

  it('leave the reference drawer split as on a P2S', () => {
    const x = planBaseplate(layout, setupFor('x1c'));
    const p = planBaseplate(layout, setupFor('p2s'));
    expect(x.pieces).toEqual(p.pieces);
    expect(x.plates.length).toBe(p.plates.length);
  });

  it('are packed around on an X1C, randomized', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 40; trial++) {
      const items: PackItem[] = Array.from({ length: 1 + Math.floor(rnd() * 25) }, (_, i) => ({
        key: `k${i}`,
        w: 20 + Math.floor(rnd() * 200),
        d: 20 + Math.floor(rnd() * 200),
      }));
      const opts = { ...x1c, spacing: 2 + Math.floor(rnd() * 6) };
      const { plates, oversize } = packPlates(items, opts);
      expect(oversize.length).toBe(0);
      expect(plates.flatMap((p) => p.placements).length).toBe(items.length);
      for (const pl of plates) assertPlacementsValid(pl.placements, opts);
      const keys = Array.from({ length: 20 }, (_, i) => ({ key: `key:${i}`, w: 9.7, d: 2.7 }));
      const packed = packIntoPlates(plates, keys, opts);
      for (const pl of [...packed.plates, ...packed.extra]) assertPlacementsValid(pl.placements, opts);
    }
  });

  it('push a part as wide as the usable area back', () => {
    // Centered, it would start at y = 23.
    const { plates } = packPlates([{ key: 'wide', w: 236, d: 210 }], x1c);
    expect(plates[0].placements[0].y).toBeCloseTo(28 + x1c.spacing, 9);
  });

  it('leave out parts that cannot clear them, and split baseplate pieces to fit', () => {
    expect(fitsOnBed(236, 236, x1c)).toBe(false);
    expect(packPlates([{ key: 'full', w: 236, d: 236 }], x1c).oversize.map((o) => o.key)).toEqual(['full']);
    // A baseplate that fills the usable area is one piece on a P2S but has to be split on an X1C.
    const square = computeLayout({ ...DEFAULT_DRAWER, width: 236.5, depth: 236.5 });
    expect(planBaseplate(square, setupFor('p2s')).pieces.length).toBe(1);
    const plan = planBaseplate(square, setupFor('x1c'));
    expect(plan.error).toBeUndefined();
    expect(plan.pieces.length).toBe(2);
    expect(plan.plates.flatMap((p) => p.placements).length).toBe(2);
    for (const pl of plan.plates) assertPlacementsValid(pl.placements, x1c);
  });

  it.each(['a1', 'a1-mini', 'p2s', 'h2d', 'h2s'])('are absent on the %s, so every plate stays centered', (id) => {
    expect(findPrinter(id).bedExclude).toBeUndefined();
    const setup = setupFor(id);
    const job = planJob(fullDrawer(setup, 'none'));
    expect(job.plates.length).toBeGreaterThan(1);
    for (const pl of job.plates) {
      const xs = pl.placements.flatMap((p) => [p.x, p.x + (p.rotated ? p.d : p.w)]);
      const ys = pl.placements.flatMap((p) => [p.y, p.y + (p.rotated ? p.w : p.d)]);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(setup.bedW / 2, 9);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(setup.bedD / 2, 9);
    }
  });
});
