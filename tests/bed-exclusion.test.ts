/**
 * Bambu X1 / P1 printers keep the front-left corner of the bed free
 * (`bed_exclude_area`), and Bambu Studio won't slice a plate with a part there.
 * The packer, the bed-fit rules, the baseplate splitter and several printers
 * all keep parts out of it (printers.ts, layout/pack.ts, bedfit.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { PRINTERS, bedExclusion, findPrinter, type BedRect } from '../src/lib/printers';
import { clearAreas, fitsOnBed, movePlate, packIntoPlates, packPlates, plateBed, type PackItem, type PackOptions, type Placement } from '../src/lib/layout/pack';
import { DEFAULT_SETUP, cleanSetup, planBaseplate, type PrintSetup } from '../src/lib/layout/plan';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { packSpiral, SPIRAL_PLATE } from '../src/lib/layout/spiral';
import { biggestPrinter, usableArea, type PrinterSetup } from '../src/lib/layout/fleet';
import { bedProblem, bedText, fitStretch, fitsBed, partOvershoot, placedOvershoot, shrinkToBed, usableBed, usableBeds } from '../src/lib/bedfit';
import { DEFAULT_BIN, sanitizeBin } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { binCellsAt, planPrint, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { exportBambuProject, plateOrigin } from '../src/lib/export/bambu';
import { placeTransform } from '../src/lib/export/threemf';
import type { MeshData } from '../src/lib/geometry/kernel';

const CORNER: BedRect = { x: 0, y: 0, w: 18, d: 28 };
const X1: PackOptions = { bedW: 256, bedD: 256, margin: 10, spacing: 3, nest: true, exclude: [CORNER] };

/** Footprint after rotation. */
const rectOf = (p: Placement) => ({ x0: p.x, y0: p.y, x1: p.x + (p.rotated ? p.d : p.w), y1: p.y + (p.rotated ? p.w : p.d) });

/** Placements that come closer than `gap` to an exclusion area (they'd be refused by Bambu Studio, or too close). */
function inArea(placements: Placement[], areas: readonly BedRect[], gap: number): string[] {
  const bad: string[] = [];
  for (const p of placements) {
    const r = rectOf(p);
    for (const e of areas) {
      if (r.x0 < e.x + e.w + gap - 1e-6 && r.x1 > e.x - gap + 1e-6 && r.y0 < e.y + e.d + gap - 1e-6 && r.y1 > e.y - gap + 1e-6) bad.push(`${p.key} at ${r.x0.toFixed(2)},${r.y0.toFixed(2)}`);
    }
  }
  return bad;
}

/** Everything else a plate must keep: inside the margin, parts apart by the spacing. */
function problems(placements: Placement[], o: PackOptions): string[] {
  const out: string[] = [];
  const rs = placements.map(rectOf);
  rs.forEach((r, i) => {
    if (r.x0 < o.margin - 1e-6 || r.y0 < o.margin - 1e-6 || r.x1 > o.bedW - o.margin + 1e-6 || r.y1 > o.bedD - o.margin + 1e-6) out.push(`${placements[i].key} outside the margin`);
  });
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      const gap = Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
      if (gap < o.spacing - 1e-6) out.push(`${placements[i].key} and ${placements[j].key} ${gap.toFixed(3)} apart`);
    }
  }
  return [...out, ...inArea(placements, o.exclude ?? [], Math.max(1, o.excludeGap ?? o.spacing))];
}

const all = (plates: { placements: Placement[] }[]) => plates.flatMap((pl) => pl.placements);

describe('the printers’ exclusion areas', () => {
  it('are the ones in Bambu Studio’s machine profiles: the X1 / P1 front-left corner, none on the others', () => {
    for (const id of ['x1c', 'x1e', 'p1p', 'p1s']) expect(bedExclusion(id)).toEqual([CORNER]);
    for (const id of ['p2s', 'a1', 'a1-mini', 'h2d', 'h2s']) expect(bedExclusion(id)).toEqual([]);
    // Other brands and custom printers have none.
    for (const p of PRINTERS.filter((q) => q.brand !== 'Bambu Lab')) expect(bedExclusion(p.id)).toEqual([]);
    expect(bedExclusion('custom')).toEqual([]);
    expect(bedExclusion('no-such-printer')).toEqual([]);
  });

  it('match the bundled project settings of every Bambu printer (public/bambu)', () => {
    for (const p of PRINTERS.filter((q) => q.bambu)) {
      const cfg = JSON.parse(readFileSync(join(__dirname, '../public/bambu', `${p.id}.json`), 'utf8')) as { bed_exclude_area: string[]; printable_area: string[] };
      const pts = cfg.bed_exclude_area.map((v) => v.split('x').map(Number));
      const want = pts.length
        ? [{ x: Math.min(...pts.map((q) => q[0])), y: Math.min(...pts.map((q) => q[1])), w: Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])), d: Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])) }]
        : [];
      expect(bedExclusion(p.id), p.id).toEqual(want);
      // Bed coordinates from the front-left corner, as the plan's are.
      expect(cfg.printable_area[0], p.id).toBe('0x0');
    }
  });

  it('leave the strip right of the corner (full depth) and the strip behind it (full width)', () => {
    const a = clearAreas(X1);
    expect(a).toHaveLength(2);
    expect(a).toContainEqual({ x: 21, y: 10, w: 225, d: 236 });
    expect(a).toContainEqual({ x: 10, y: 31, w: 236, d: 215 });
    expect(clearAreas({ ...X1, exclude: [] })).toEqual([{ x: 10, y: 10, w: 236, d: 236 }]);
    // A margin wider than the corner plus the gap leaves the whole bed.
    expect(clearAreas({ ...X1, margin: 32 })).toEqual([{ x: 32, y: 32, w: 192, d: 192 }]);
    expect(plateBed({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10 })).toEqual({ bedW: 256, bedD: 256, margin: 10, exclude: [CORNER] });
    expect(plateBed({ printerId: 'a1', bedW: 256, bedD: 256, plateMargin: 10 })).toEqual({ bedW: 256, bedD: 256, margin: 10 });
  });
});

describe('packing around the corner', () => {
  it('never puts a part in it, loses none, and keeps the spacing (randomized, X1 / P1 beds)', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 160; trial++) {
      const o: PackOptions = {
        ...X1,
        margin: [0, 2, 5, 10, 15, 30][Math.floor(rnd() * 6)],
        spacing: Math.floor(rnd() * 9),
        nest: rnd() > 0.15,
      };
      const big = rnd() > 0.6;
      const items: PackItem[] = Array.from({ length: 1 + Math.floor(rnd() * 30) }, (_, i) => ({
        key: `k${i}`,
        w: 3 + rnd() * (big ? 250 : 120),
        d: 3 + rnd() * (big ? 250 : 120),
      }));
      const { plates, oversize } = packPlates(items, o);
      const placed = all(plates);
      expect(placed.length + oversize.length).toBe(items.length);
      expect(new Set([...placed.map((p) => p.key), ...oversize.map((p) => p.key)]).size).toBe(items.length);
      for (const it of oversize) expect(fitsOnBed(it.w, it.d, o)).toBe(false);
      for (const pl of plates) expect(problems(pl.placements, o), `trial ${trial}`).toEqual([]);
      // Small parts added later keep out of it too.
      const more: PackItem[] = Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => ({ key: `s${i}`, w: 2 + rnd() * 20, d: 2 + rnd() * 20 }));
      const into = packIntoPlates(plates, more, o);
      for (const pl of [...into.plates, ...into.extra]) expect(problems(pl.placements, o), `trial ${trial} (added)`).toEqual([]);
    }
  });

  it('keeps out of areas anywhere on the bed, with a gap of its own (randomized)', () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 120; trial++) {
      const area = (): BedRect => ({ x: rnd() * 220, y: rnd() * 220, w: 5 + rnd() * 50, d: 5 + rnd() * 50 });
      const o: PackOptions = {
        bedW: 256,
        bedD: 220 + Math.floor(rnd() * 80),
        margin: Math.floor(rnd() * 15),
        spacing: Math.floor(rnd() * 12),
        nest: true,
        exclude: Array.from({ length: 1 + Math.floor(rnd() * 2) }, area),
        ...(rnd() > 0.5 ? { excludeGap: Math.floor(rnd() * 4) } : {}),
      };
      const items: PackItem[] = Array.from({ length: 1 + Math.floor(rnd() * 25) }, (_, i) => ({ key: `k${i}`, w: 3 + rnd() * 140, d: 3 + rnd() * 140 }));
      const { plates, oversize } = packPlates(items, o);
      expect(all(plates).length + oversize.length).toBe(items.length);
      for (const it of oversize) expect(fitsOnBed(it.w, it.d, o)).toBe(false);
      for (const pl of plates) expect(problems(pl.placements, o), `trial ${trial}`).toEqual([]);
      const moved = movePlate(plates[0]?.placements ?? [], o);
      if (moved) expect(problems(moved, o), `trial ${trial} (moved)`).toEqual([]);
    }
  });

  it('centres a plate, moving it only as far as it must to clear the corner', () => {
    // Centred, a 230 × 200 part would stand at 13, 28: in the corner. 3 mm further back clears it.
    const { plates } = packPlates([{ key: 'a', w: 230, d: 200 }], X1);
    const p = plates[0].placements[0];
    expect(rectOf(p)).toEqual({ x0: 13, y0: 31, x1: 243, y1: 231 });
    // Where the centre is clear, nothing changes.
    expect(packPlates([{ key: 'b', w: 200, d: 200 }], X1).plates[0].placements[0]).toMatchObject({ x: 28, y: 28 });
    // A full plate of small parts centred clear of it.
    const many = packPlates(Array.from({ length: 40 }, (_, i) => ({ key: `m${i}`, w: 30, d: 30 })), X1).plates;
    for (const pl of many) expect(problems(pl.placements, X1)).toEqual([]);
  });

  it('places a big part that only fits beside or behind the corner, and reports one that fits neither', () => {
    const beside = packPlates([{ key: 'a', w: 225, d: 236 }], X1);
    expect(beside.oversize).toEqual([]);
    expect(rectOf(beside.plates[0].placements[0]).x0).toBeGreaterThanOrEqual(21 - 1e-6);
    const behind = packPlates([{ key: 'b', w: 236, d: 215 }], X1);
    expect(behind.oversize).toEqual([]);
    expect(rectOf(behind.plates[0].placements[0]).y0).toBeGreaterThanOrEqual(31 - 1e-6);
    // Turned to fit beside it.
    const turned = packPlates([{ key: 'c', w: 236, d: 225 }], X1).plates[0].placements[0];
    expect(turned.rotated).toBe(true);
    // Too big either way: oversize, not a crash; it fits an A1 (no corner).
    for (const it of [{ key: 'd', w: 230, d: 230 }, { key: 'e', w: 226, d: 236 }]) {
      expect(fitsOnBed(it.w, it.d, X1)).toBe(false);
      const r = packPlates([it, { key: 'small', w: 20, d: 20 }], X1);
      expect(r.oversize.map((x) => x.key)).toEqual([it.key]);
      expect(all(r.plates).map((x) => x.key)).toEqual(['small']);
      expect(packPlates([it], { ...X1, exclude: undefined }).oversize).toEqual([]);
      expect(packIntoPlates([], [it], X1).oversize.map((x) => x.key)).toEqual([it.key]);
    }
  });

  it('moves a plate packed for another bed clear of the corner, or says it can’t', () => {
    const a1 = { ...X1, exclude: undefined };
    const plates = packPlates(Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, w: 50, d: 40 })), a1).plates;
    const moved = movePlate(plates[0].placements, X1)!;
    expect(moved).not.toBeNull();
    expect(problems(moved, X1)).toEqual([]);
    // Same layout, shifted together.
    const dx = moved[0].x - plates[0].placements[0].x;
    moved.forEach((p, i) => expect(p.x - plates[0].placements[i].x).toBeCloseTo(dx, 9));
    expect(movePlate([{ key: 'big', x: 13, y: 13, w: 230, d: 230, rotated: false }], X1)).toBeNull();
    // Without an exclusion area it is just centred.
    expect(movePlate([{ key: 'one', x: 10, y: 10, w: 56, d: 56, rotated: false }], a1)).toEqual([{ key: 'one', x: 100, y: 100, w: 56, d: 56, rotated: false }]);
  });

  it('vase plates stay clear of it, by the usual gap, not the gantry clearance', () => {
    const clearance = findPrinter('x1c').sequential!;
    const items = Array.from({ length: 6 }, (_, i) => ({ key: `v${i}`, w: 41.5, d: 41.5, h: 20 }));
    const shared = packSpiral(items, plateBed({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10 }), clearance);
    for (const pl of shared.plates) {
      expect(inArea(pl.placements, [CORNER], SPIRAL_PLATE.spacing)).toEqual([]);
      expect(problems(pl.placements, { ...X1, spacing: clearance.radius + SPIRAL_PLATE.spacing, excludeGap: SPIRAL_PLATE.spacing })).toEqual([]);
    }
    // A big one alone, centred clear of the corner.
    const alone = packSpiral([{ key: 'big', w: 225, d: 230, h: 100 }], plateBed({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10 }), clearance);
    expect(alone.oversize).toEqual([]);
    expect(inArea(alone.plates[0].placements, [CORNER], 1)).toEqual([]);
  });
});

describe('what fits a printer with an exclusion area', () => {
  const X1C = usableBed({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10, maxH: 250, spacing: 3 });
  const A1 = usableBed({ printerId: 'a1', bedW: 256, bedD: 256, plateMargin: 10, maxH: 256, spacing: 3 });

  it('a part fits if it fits beside or behind the corner, either way round', () => {
    expect(A1.clear).toBeUndefined();
    expect(X1C.clear).toEqual([{ w: 225, d: 236 }, { w: 236, d: 215 }]);
    expect(fitsBed(230, 230, 50, A1)).toBe(true);
    expect(fitsBed(230, 230, 50, X1C)).toBe(false);
    expect(partOvershoot(230, 230, 50, X1C)).toBeCloseTo(5, 9);
    expect(fitsBed(225, 236, 50, X1C)).toBe(true);
    expect(fitsBed(236, 225, 50, X1C)).toBe(true);
    expect(fitsBed(236, 215, 50, X1C)).toBe(true);
    expect(fitsBed(226, 236, 50, X1C)).toBe(false);
    // The same rule as the packer, with the gap bins are packed with (the spacing, at least 2 mm).
    for (const [w, d] of [[230, 230], [225, 236], [236, 215], [226, 220], [100, 236]]) expect(fitsBed(w, d, 0, X1C)).toBe(fitsOnBed(w, d, { ...X1, spacing: 3 }));
    expect(usableBed({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10, maxH: 250, spacing: 0 }).clear).toEqual([{ w: 226, d: 236 }, { w: 236, d: 216 }]);
    expect(bedText(X1C)).toBe('236 × 236 (225 × 236 or 236 × 215 clear of the front-left corner)');
    expect(bedText(A1)).toBe('236 × 236');
  });

  it('holds bins to it: the message says why, and a stretched bin is scaled back further', () => {
    // Five cells and 30 mm of solid margin right and behind: a 5 × 5 bin may stretch into both.
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'drawer', width: 240.5, depth: 240.5, alignX: 0, alignY: 0, fill: 'solid' });
    expect([layout.nx, layout.ny]).toEqual([5, 5]);
    const b: PlacedBin = { id: 'a', x: 0, y: 0, opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 5, unitsY: 5 }) };
    const onA1 = fitStretch(layout, b, { right: 40, back: 40 }, A1)!;
    const onX1 = fitStretch(layout, b, { right: 40, back: 40 }, X1C)!;
    expect(onA1.right).toBeCloseTo(26.5, 1);
    expect(onX1.right).toBeCloseTo(15.5, 1);
    const big: PlacedBin = { ...b, stretch: { right: 20, back: 20 } };
    expect(placedOvershoot(layout, big, A1)).toBe(0);
    expect(placedOvershoot(layout, big, X1C)).toBeGreaterThan(0);
    expect(bedProblem(big.opts, binCellsAt(layout, big), A1)).toBeNull();
    // Why: it fits inside the margin, but not clear of the corner.
    expect(bedProblem(big.opts, binCellsAt(layout, big), X1C)).toBe(
      "This bin is 229.5 mm × 229.5 mm: it fits inside the edge margin, but not clear of the front-left corner Bambu Studio keeps free (it won't slice a part there). Clear of it the bed takes 225 mm × 236 mm or 236 mm × 215 mm.",
    );
    const fit = shrinkToBed(layout, big, X1C);
    expect(placedOvershoot(layout, fit, X1C)).toBe(0);
    expect(fit.stretch).not.toEqual(big.stretch);
  });

  it('with several printers, each has its own: a part fits if one of them takes it', () => {
    const setup = (first: string, ...more: string[]): PrintSetup =>
      cleanSetup({
        ...DEFAULT_SETUP,
        printerId: first,
        printers: more.map((id): PrinterSetup => ({ printerId: id, bedW: 256, bedD: 256, maxH: 250, plateMargin: 10 })),
      });
    const both = usableBeds(setup('x1c', 'a1'));
    expect(both[0].clear).toBeDefined();
    expect(both[1].clear).toBeUndefined();
    expect(fitsBed(230, 230, 50, both)).toBe(true);
    const twoX1 = usableBeds(setup('x1c', 'p1s'));
    expect(fitsBed(230, 230, 50, twoX1)).toBe(false);
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'drawer', width: 240.5, depth: 240.5, alignX: 0, alignY: 0, fill: 'solid' });
    const big: PlacedBin = { id: 'a', x: 0, y: 0, opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 5, unitsY: 5 }), stretch: { right: 20, back: 20 } };
    expect(placedOvershoot(layout, big, both)).toBe(0);
    expect(placedOvershoot(layout, big, twoX1)).toBeGreaterThan(0);
    expect(bedProblem(big.opts, binCellsAt(layout, big), twoX1)).toMatch(/too big for every printer\. The Bambu Lab X1 Carbon comes closest: it fits inside the edge margin, but not clear of the front-left corner/);
    // The biggest bed for the baseplate is one without the corner.
    expect(biggestPrinter(setup('x1c', 'a1'))).toBe(1);
    expect(biggestPrinter(setup('a1', 'x1c'))).toBe(0);
    expect(usableArea({ printerId: 'x1c', bedW: 256, bedD: 256, plateMargin: 10 })).toBe(236 * 236 - 8 * 18);
  });
});

describe('the baseplate on a printer with an exclusion area', () => {
  // 230 × 230: one piece on an A1, too big for an X1 once the corner is kept clear.
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 230.5, depth: 230.5, clearance: 0.5 });
  const on = (printerId: string, o: Partial<PrintSetup> = {}): PrintSetup => ({ ...DEFAULT_SETUP, printerId, bedW: 256, bedD: 256, ...o });

  it('is split into pieces that fit beside or behind the corner', () => {
    expect([layout.plateW, layout.plateD]).toEqual([230, 230]);
    expect(planBaseplate(layout, on('a1')).pieces).toHaveLength(1);
    for (const style of ['auto', 'balanced', 'largest'] as const) {
      for (const protrude of [0, 2.5]) {
        const setup = on('x1c', { splitStyle: style });
        const plan = planBaseplate(layout, setup, { protrude });
        expect(plan.error).toBeUndefined();
        expect(plan.pieces.length).toBeGreaterThan(1);
        const o: PackOptions = { ...plateBed(setup), spacing: setup.spacing, nest: setup.nest };
        for (const p of plan.pieces) {
          const w = p.x1 - p.x0 + (p.outer.right ? 0 : protrude);
          const d = p.y1 - p.y0 + (p.outer.back ? 0 : protrude);
          expect(fitsOnBed(w, d, o), `${style} piece ${p.id}`).toBe(true);
        }
        for (const pl of plan.plates) expect(problems(pl.placements, o)).toEqual([]);
      }
    }
  });

  it('plans whole jobs clear of the corner: pieces, keys, pads, case parts and bins', () => {
    const drawers: NamedDrawer[] = [
      {
        id: 'k',
        name: 'Kitchen',
        drawer: { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 },
        baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie', magnets: true, pads: 'strips' },
        bins: [
          { id: 'a', x: 0, y: 0, opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 5, unitsY: 5 }) },
          ...Array.from({ length: 20 }, (_, i): PlacedBin => ({ id: `s${i}`, x: 5 + (i % 7), y: Math.floor(i / 7), opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 1, unitsY: 1 }) })),
        ],
      },
      { id: 'c', name: 'Case', drawer: { ...DEFAULT_DRAWER, width: 300, depth: 260, enclosure: 'case' }, baseplate: { ...DEFAULT_BASEPLATE }, bins: [] },
    ];
    for (const id of ['x1c', 'p1p']) {
      const job = planPrint(drawers, on(id), { baseplate: true, bins: true });
      expect(job.plates.length).toBeGreaterThan(2);
      expect(inArea(all(job.plates), [CORNER], 3)).toEqual([]);
      expect(job.warnings.filter((w) => /larger than the print bed/.test(w))).toEqual([]);
    }
  });
});

describe('several printers, each with its own corner', () => {
  const printer = (id: string): PrinterSetup => {
    const p = findPrinter(id);
    return { printerId: p.id, bedW: p.bedW, bedD: p.bedD, maxH: p.maxH, plateMargin: 10 };
  };
  const farm = (first: string, ...more: string[]): PrintSetup => {
    const p = printer(first);
    return { ...DEFAULT_SETUP, ...p, ...(more.length ? { printers: more.map(printer) } : {}) };
  };
  // A 5 × 5 bin stretched into the margins: 229.5 × 229.5, too big for an X1 clear of its corner.
  const drawer: NamedDrawer = {
    id: 'd',
    name: 'Drawer',
    drawer: { ...DEFAULT_DRAWER, mode: 'drawer', width: 240.5, depth: 240.5, alignX: 0, alignY: 0, fill: 'solid' },
    baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' },
    bins: [{ id: 'big', x: 0, y: 0, opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 5, unitsY: 5 }), stretch: { right: 20, back: 20 } }],
  };
  const extra: NamedDrawer = {
    id: 'e',
    name: 'Other',
    drawer: { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5 },
    baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' },
    bins: Array.from({ length: 30 }, (_, i): PlacedBin => ({ id: `s${i}`, x: i % 12, y: Math.floor(i / 12), opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 1, unitsY: 1 }) })),
  };
  const include = { baseplate: true, bins: true };
  const onPrinter = (job: PrintJob, k: number) => all(job.plates.filter((pl) => (pl.printer ?? 0) === k));

  it('a part too big for the X1 clear of its corner prints on the A1', () => {
    const job = planPrint([drawer, extra], farm('x1c', 'a1'), include);
    const big = Object.values(job.parts).find((p) => p.kind === 'bin' && p.w > 225)!;
    expect(big).toBeDefined();
    const on = job.plates.find((pl) => pl.placements.some((p) => p.key === big.key))!;
    expect(on.printer).toBe(1);
    expect(inArea(onPrinter(job, 0), [CORNER], 3)).toEqual([]);
    expect(job.warnings).toEqual([]);
    // With only the X1 it is left out, and said so.
    const alone = planPrint([drawer, extra], farm('x1c'), include);
    expect(all(alone.plates).some((p) => p.key === big.key)).toBe(false);
    expect(alone.warnings.some((w) => w.includes('larger than the print bed'))).toBe(true);
    expect(inArea(all(alone.plates), [CORNER], 3)).toEqual([]);
  });

  it('baseplate plates split for the A1 move to the X1 only clear of its corner', () => {
    for (const setup of [farm('a1', 'x1c'), farm('x1c', 'a1'), farm('x1c', 'p1s', 'a1-mini')]) {
      const job = planPrint([drawer, extra], setup, include);
      const printers = [setup.printerId, ...(setup.printers ?? []).map((p) => p.printerId)];
      printers.forEach((id, k) => expect(inArea(onPrinter(job, k), bedExclusion(id), 3), `${printers.join('+')} printer ${k}`).toEqual([]));
    }
  });

  it('a baseplate split for the X1 fits it clear of the corner', () => {
    const setup = { ...farm('a1', 'x1c'), baseplatePrinter: 1 };
    const job = planPrint([drawer], setup, include);
    const pieces = job.plates.filter((pl) => pl.group === 'baseplate');
    expect(pieces.length).toBeGreaterThan(0);
    for (const pl of pieces) {
      expect(pl.printer).toBe(1);
      expect(inArea(pl.placements, [CORNER], 3)).toEqual([]);
    }
  });
});

describe('the Bambu project', () => {
  it('writes the plan’s positions, clear of the corner, and nothing re-centres them', () => {
    const setup: PrintSetup = { ...DEFAULT_SETUP, printerId: 'x1c', bedW: 256, bedD: 256, maxH: 250 };
    const d: NamedDrawer = {
      id: 'd',
      name: 'Drawer',
      drawer: { ...DEFAULT_DRAWER, width: 230.5, depth: 230.5, clearance: 0.5 },
      baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' },
      bins: Array.from({ length: 12 }, (_, i): PlacedBin => ({ id: `b${i}`, x: i % 5, y: Math.floor(i / 5), opts: sanitizeBin({ ...DEFAULT_BIN, unitsX: 1, unitsY: 1 }) })),
    };
    const job = planPrint([d], setup, { baseplate: true, bins: true });
    expect(inArea(all(job.plates), [CORNER], 3)).toEqual([]);
    const tiny: MeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) } as MeshData;
    const files = unzipSync(exportBambuProject(job, setup, () => tiny));
    const model = strFromU8(files['3D/3dmodel.model']);
    const items = [...model.matchAll(/<item [^>]*transform="([^"]+)"/g)].map((m) => m[1].split(' ').map(Number));
    const want = job.plates.flatMap((pl, i) => {
      const [ox, oy] = plateOrigin(i, job.plates.length, setup.bedW, setup.bedD);
      return pl.placements.map((p) => {
        const t = placeTransform(p.x, p.y, p.rotated, job.parts[p.key].d);
        return [t[9] + ox, t[10] + oy];
      });
    });
    expect(items.length).toBe(want.length);
    items.forEach((t, i) => {
      expect(t[9]).toBeCloseTo(want[i][0], 4);
      expect(t[10]).toBeCloseTo(want[i][1], 4);
    });
  });
});
