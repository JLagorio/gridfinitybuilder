import { beforeEach, describe, expect, it } from 'vitest';
import { parseLine, parseList } from '../src/lib/autofill/parse';
import { matchItem, matchTools, type Holder } from '../src/lib/autofill/match';
import { cellsFor, fillBin, type Proposal, type SizeContext } from '../src/lib/autofill/size';
import { packBins } from '../src/lib/autofill/pack';
import { drawerRoom, planFill, plannedBins, propose, sizeContext, type FillContext, type FillPlan } from '../src/lib/autofill';
import { DEFAULT_BIN, binTotalHeight } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { computeLayout, DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { rectsOverlap, withBlocked, type CellRect } from '../src/lib/bins';
import { bedOvershoot, usableBed } from '../src/lib/bedfit';
import { binCellsAt, type PlacedBin } from '../src/lib/project';
import { fitBinForTools, type Tool } from '../src/lib/tools';
import { resolveContentLabels } from '../src/lib/geometry/labelContents';
import { allDrawers, history, projectFile, useStore } from '../src/state/store';
import { standingGrids, tipLimits } from '../src/lib/geometry/itemHeight';
import { binChecks } from '../src/lib/printability';

const item = (line: string) => parseLine(line)!;
const square = (name: string, w: number, d: number): Tool => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  outline: [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ],
  depth: 10,
  clearance: 1,
});

function context(drawer: Partial<DrawerInput> = {}, more: Partial<FillContext> = {}): FillContext {
  const d = { ...DEFAULT_DRAWER, ...drawer };
  return { layout: computeLayout(d), drawer: d, baseplate: DEFAULT_BASEPLATE, setup: DEFAULT_SETUP, bins: [], tools: [], newBin: DEFAULT_BIN, ...more };
}

const EXAMPLE = `200 M3 screws
50 M3 nuts
12 AA batteries
4 9V batteries
calipers
hex keys 1.5–10 mm
SD cards x8
drill bits 1-10mm
zip ties
sharpies x6
misc small parts`;

const rectOf = (b: { x: number; y: number; size: { ux: number; uy: number } }): CellRect => ({ x: b.x, y: b.y, w: b.size.ux, d: b.size.uy });

/** Every planned bin is on the grid, off blocked cells and existing bins, and clear of the others. */
function expectValid(plan: FillPlan, c: FillContext) {
  const taken = withBlocked(c.bins, c.layout.mask);
  plan.placed.forEach((b, i) => {
    const r = rectOf(b);
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= c.layout.nx && r.y + r.d <= c.layout.ny).toBe(true);
    for (const t of taken) expect(rectsOverlap(r, { x: t.x, y: t.y, w: t.opts.unitsX, d: t.opts.unitsY })).toBe(false);
    plan.placed.slice(i + 1).forEach((o) => expect(rectsOverlap(r, rectOf(o))).toBe(false));
    expect(b.fill.opts.unitsX).toBe(b.size.ux);
    expect(b.fill.opts.heightUnits).toBe(b.size.h);
  });
}

describe('reading the list', () => {
  it('finds how many, however it is written', () => {
    expect(item('200 M3 screws').qty).toBe(200);
    expect(item('SD cards x8').qty).toBe(8);
    expect(item('SD cards ×8').qty).toBe(8);
    expect(item('8x SD cards').qty).toBe(8);
    expect(item('8 pcs M4 nuts').qty).toBe(8);
    expect(item('M4 nuts 8 pcs').qty).toBe(8);
    expect(item('a dozen AA batteries').qty).toBe(12);
    expect(item('2 dozen AAA').qty).toBe(24);
    expect(item('half a dozen pens').qty).toBe(6);
    expect(item('a pair of pliers').qty).toBe(2);
    expect(item('CR2032 (10)').qty).toBe(10);
    expect(item('bolts qty 30').qty).toBe(30);
    expect(item('two screwdrivers').qty).toBe(2);
    expect(item('a soldering iron').qty).toBe(1);
    expect(item('a box of screws').qty).toBeNull();
    expect(item('screws 50').qty).toBe(50);
    // After a battery size or a length, "x4" is still a count; between two numbers it's a size.
    expect(item('18650 x4')).toMatchObject({ qty: 4, cell: '18650' });
    expect(item('LEDs 5mm x100')).toMatchObject({ qty: 100, length: 5 });
    expect(item('M3 x 12 bolts')).toMatchObject({ qty: null, threadLength: 12 });
    expect(item('calipers').qty).toBeNull();
    // The quantity isn't part of the name.
    expect(item('200 M3 screws').name).toBe('M3 screws');
    expect(item('SD cards x8').name).toBe('SD cards');
    expect(item('- 6 pcs M4 nuts').text).toBe('6 pcs M4 nuts');
  });

  it('reads ranges in mm and inches', () => {
    expect(item('hex keys 1.5-10 mm').range).toEqual({ from: 1.5, to: 10, inch: false });
    expect(item('hex keys 1.5–10mm').range).toEqual({ from: 1.5, to: 10, inch: false });
    expect(item('drill bits 1 to 13 mm').range).toEqual({ from: 1, to: 13, inch: false });
    const inch = item('drill bits 1/16-1/2in').range!;
    expect(inch.inch).toBe(true);
    expect(inch.from).toBeCloseTo(1.5875, 1);
    expect(inch.to).toBeCloseTo(12.7, 1);
    // Fractions without a unit are inches.
    expect(item('hex keys 1/16–3/8').range?.inch).toBe(true);
  });

  it('reads sizes: threads, batteries, lengths and dimensions', () => {
    expect(item('M3 screws')).toMatchObject({ thread: 3 });
    expect(item('M3x12 screws')).toMatchObject({ thread: 3, threadLength: 12 });
    expect(item('M2.5 x 8 bolts')).toMatchObject({ thread: 2.5, threadLength: 8 });
    expect(item('12 AA batteries').cell).toBe('aa');
    expect(item('AAA cells').cell).toBe('aaa');
    expect(item('4 9V batteries')).toMatchObject({ qty: 4, cell: '9v' });
    // 18650 is a battery, not a count.
    expect(item('18650 cells')).toMatchObject({ qty: null, cell: '18650' });
    expect(item('10 18650 cells')).toMatchObject({ qty: 10, cell: '18650' });
    expect(item('D batteries').cell).toBe('d');
    expect(item('zip ties 200mm').length).toBe(200);
    expect(item('router bits 1/2"').length).toBeCloseTo(12.7, 2);
    expect(item('power bank 100x60x20mm').dims).toEqual([100, 60, 20]);
    expect(item('100 x 60 mm box')).toMatchObject({ qty: null, dims: [100, 60] });
  });

  it('reads plurals and keeps lines it does not understand', () => {
    expect(item('12 AA batteries').words).toEqual(['aa', 'battery']);
    expect(item('zip ties').words).toEqual(['zip', 'tie']);
    expect(item('boxes of matches').words).toEqual(['box', 'of', 'match']);
    expect(item('sharpies').words).toEqual(['sharpie']);
    expect(item('misc small parts')).toMatchObject({ name: 'misc small parts', qty: null });
    expect(parseList(EXAMPLE)).toHaveLength(11);
    expect(parseList('\n  \n- one\n\n2. two\n')).toHaveLength(2);
  });
});

describe('what each item needs', () => {
  const kind = (line: string, tools: Tool[] = []) => matchItem(item(line), tools);
  const preset = (h: Holder) => ('preset' in h ? h.preset.id : null);

  it('uses pocket-grid presets', () => {
    expect(preset(kind('12 AA batteries'))).toBe('aa');
    expect(preset(kind('4 9V batteries'))).toBe('9v');
    expect(preset(kind('SD cards x8'))).toBe('sd');
    expect(preset(kind('8x microSD cards'))).toBe('microsd');
    expect(preset(kind('sharpies x6'))).toBe('marker');
    expect(preset(kind('20 hex bits'))).toBe('hexbit');
    expect(preset(kind('router bits 1/2"'))).toBe('router-12');
    expect(preset(kind('Citadel paints x12'))).toBe('citadel');
    expect(preset(kind('20 quarters'))).toBe('quarter');
    const aa = kind('12 AA batteries');
    expect(aa).toMatchObject({ kind: 'pockets', count: 12, given: true });
    // A few screws stand in pockets; many go loose.
    expect(preset(kind('6 M4x20 screws'))).toBe('m4');
    expect(kind('200 M3 screws').kind).toBe('loose');
  });

  it('uses graduated sets, cut to a typed range', () => {
    const drills = kind('drill bits 1-10mm');
    expect(drills).toMatchObject({ kind: 'set' });
    expect(preset(drills)).toBe('drills-10');
    expect(drills.kind === 'set' && drills.sizes).toHaveLength(19);
    expect(preset(kind('drill bits 1-13mm'))).toBe('drills-13');
    expect(preset(kind('drill bits 1/16-1/2in'))).toBe('drills-inch');
    const keys = kind('hex keys 2-6 mm');
    expect(preset(keys)).toBe('hexkeys');
    expect(keys.kind === 'set' && keys.sizes).toEqual([2, 2.5, 3, 4, 5, 6]);
    expect(preset(kind('allen keys 1/16-3/8"'))).toBe('hexkeys-inch');
    const sockets = kind('sockets 10-19 mm');
    expect(preset(sockets)).toBe('sockets-38');
    expect(sockets.kind === 'set' && sockets.names).toEqual(['10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
    // Socket-head screws are screws.
    expect(kind('50 M3 socket head screws').kind).toBe('loose');
  });

  it('matches tools in the library by name', () => {
    const calipers = square('Calipers', 150, 40);
    const knipex = square('Knipex pliers', 120, 40);
    const nose = square('Needle-nose pliers', 130, 30);
    const tools = [calipers, knipex, nose];
    expect(matchTools(item('calipers'), tools)).toEqual([calipers]);
    expect(matchTools(item('pliers'), tools)).toEqual([knipex, nose]);
    expect(matchTools(item('Knipex pliers'), tools)).toEqual([knipex]);
    expect(matchTools(item('screws'), tools)).toEqual([]);
    expect(kind('calipers', tools)).toEqual({ kind: 'tools', tools: [calipers] });
    // Two of a tool: two pockets.
    expect(kind('2 calipers', tools)).toEqual({ kind: 'tools', tools: [calipers, calipers] });
  });

  it('uses a dispenser for coin cells, zip ties and a roll of tape', () => {
    expect(kind('10 CR2032')).toMatchObject({ kind: 'dispenser', style: 'coin', item: 'cr2032', count: 10 });
    expect(kind('zip ties')).toMatchObject({ kind: 'dispenser', style: 'channel', length: 150 });
    expect(kind('zip ties 200mm')).toMatchObject({ kind: 'dispenser', style: 'channel', length: 200 });
    expect(kind('electrical tape')).toMatchObject({ kind: 'dispenser', style: 'tape', item: 'electrical' });
    // Not a tape measure, and not several rolls.
    expect(kind('tape measure').kind).toBe('objects');
    expect(kind('5 rolls of washi tape')).toMatchObject({ kind: 'objects', count: 5, l: 35, h: 15 });
  });

  it('estimates loose parts by volume', () => {
    const screws = kind('200 M3 screws');
    const fewer = kind('50 M3 screws');
    const bigger = kind('200 M6 screws');
    if (screws.kind !== 'loose' || fewer.kind !== 'loose' || bigger.kind !== 'loose') throw new Error('loose');
    expect(screws.family).toBe('M3');
    expect(screws.volume / fewer.volume).toBeCloseTo(4, 6);
    expect(bigger.volume).toBeGreaterThan(screws.volume * 4);
    // 200 M3×10 screws make a pile of about 60 cm³.
    expect(screws.volume / 1000).toBeGreaterThan(40);
    expect(screws.volume / 1000).toBeLessThan(90);
    const nuts = kind('50 M3 nuts');
    expect(nuts).toMatchObject({ kind: 'loose', family: 'M3', given: true });
    expect(kind('M3 washers')).toMatchObject({ kind: 'loose', given: false, count: 50 });
    expect(kind('50 resistors')).toMatchObject({ kind: 'loose', family: 'electronics' });
  });

  it('sizes known things that lie flat, and makes a general bin for the rest', () => {
    expect(kind('calipers')).toMatchObject({ kind: 'objects', typical: true, l: 235 });
    expect(kind('power bank 100x60x20mm')).toMatchObject({ kind: 'objects', typical: false, l: 100, w: 60, h: 20 });
    expect(kind('misc small parts')).toEqual({ kind: 'general', small: true });
    expect(kind('gadgets')).toEqual({ kind: 'general', small: false });
  });
});

describe('sizing a bin', () => {
  const ctx = sizeContext(context({ height: 0 }));

  it('picks the smallest bin that holds every pocket', () => {
    const [p] = propose('12 AA batteries', ctx, []).proposals;
    expect(p.spec.kind).toBe('pockets');
    const f = fillBin(p, p.size, cellsFor(ctx, p.size.ux, p.size.uy), ctx);
    expect(f.ok).toBe(true);
    expect(f.opts.interior).toBe('pockets');
    expect(f.opts.pocketPreset).toBe('aa');
    expect(f.contents).toBe('12 AA batteries');
    expect(f.opts.labelText).toBe('AA batteries');
    // Deep enough for the preset's pockets.
    expect(p.size.h).toBeGreaterThanOrEqual(4);
    // Every smaller footprint holds fewer.
    for (let ux = 1; ux <= 4; ux++) {
      for (let uy = 1; uy <= 4; uy++) {
        if (ux * uy >= p.size.ux * p.size.uy) continue;
        expect(fillBin(p, { ux, uy, h: p.size.h }, cellsFor(ctx, ux, uy), ctx).ok).toBe(false);
      }
    }
    expect(p.reason).toBe('Pocket grid for 12 AA batteries.');
  });

  it('sizes a graduated set so every size fits, and a tool bin like Make a bin does', () => {
    const [drills] = propose('drill bits 1-10mm', ctx, []).proposals;
    const f = fillBin(drills, drills.size, cellsFor(ctx, drills.size.ux, drills.size.uy), ctx);
    expect(f.ok).toBe(true);
    expect(f.opts.pocketSizes).toHaveLength(19);
    expect(f.holds).toBe('19 of 19 sizes');
    const t = square('Calipers', 150, 40);
    const [tool] = propose('calipers', ctx, [t]).proposals;
    const fit = fitBinForTools([t], { lip: true });
    expect(tool.size).toEqual({ ux: fit.unitsX, uy: fit.unitsY, h: fit.heightUnits });
    const tf = fillBin(tool, tool.size, cellsFor(ctx, tool.size.ux, tool.size.uy), ctx);
    expect(tf.opts.interior).toBe('cutouts');
    expect(tf.opts.cutouts?.[0]).toMatchObject({ toolId: t.id, name: 'Calipers' });
    expect(tool.reason).toMatch(/from your tool library/);
  });

  it('makes dispensers that hold the count', () => {
    const [coins] = propose('30 CR2032', ctx, []).proposals;
    const f = fillBin(coins, coins.size, cellsFor(ctx, coins.size.ux, coins.size.uy), ctx);
    expect(f.opts.container).toBe('dispenser');
    expect(f.ok).toBe(true);
    expect(f.cap).toBeGreaterThanOrEqual(30);
    const [ties] = propose('zip ties 200mm', ctx, []).proposals;
    // 200 mm channels need a 5-unit bin.
    expect(Math.max(ties.size.ux, ties.size.uy)).toBe(5);
  });

  it('gives loose parts a compartment with room for their volume', () => {
    const [few] = propose('20 M3 nuts', ctx, []).proposals;
    expect(few.size).toEqual({ ux: 1, uy: 1, h: 3 });
    const [many] = propose('2000 M3 screws', ctx, []).proposals;
    expect(many.size.ux * many.size.uy).toBeGreaterThan(1);
    const f = fillBin(many, many.size, cellsFor(ctx, many.size.ux, many.size.uy), ctx);
    expect(f.ok).toBe(true);
    expect(f.opts.scoop).toBe(1);
    expect(f.holds).toMatch(/% full/);
  });

  it('splits what no single bin holds into several bins', () => {
    const parts = propose('500 AA batteries', ctx, []).proposals;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.part?.of === parts.length)).toBe(true);
    const held = parts.reduce((t, p) => t + fillBin(p, p.size, cellsFor(ctx, p.size.ux, p.size.uy), ctx).cap, 0);
    expect(held).toBeGreaterThanOrEqual(500);
    for (const p of parts) expect(bedOvershoot(fillBin(p, p.size, cellsFor(ctx, p.size.ux, p.size.uy), ctx).opts, null, ctx.bed)).toBe(0);
  });

  it('flags things too long for the printer, and fits them on a bigger one', () => {
    const [p] = propose('calipers', ctx, []).proposals;
    expect(p.oversize).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/Longer than a bin your printer takes/);
    expect(bedOvershoot(fillBin(p, p.size, cellsFor(ctx, p.size.ux, p.size.uy), ctx).opts, null, ctx.bed)).toBe(0);
    const big = sizeContext(context({}, { setup: { ...DEFAULT_SETUP, bedW: 350, bedD: 320 } }));
    const [q] = propose('calipers', big, []).proposals;
    expect(q.oversize).toBeUndefined();
    expect(fillBin(q, q.size, cellsFor(big, q.size.ux, q.size.uy), big).ok).toBe(true);
  });

  it('keeps bins low enough for the drawer, laying long things flat', () => {
    const c = context({ height: 60 });
    const room = drawerRoom(c.drawer, c.baseplate);
    expect(room).toBeLessThanOrEqual(60);
    // Magnets add a floor to the baseplate: less room above it.
    expect(drawerRoom(c.drawer, { ...c.baseplate, magnets: true })).toBeLessThan(room);
    const low = sizeContext(c);
    const { proposals } = propose(EXAMPLE, low, []);
    for (const p of proposals) expect(binTotalHeight(fillBin(p, p.size, cellsFor(low, p.size.ux, p.size.uy), low).opts)).toBeLessThanOrEqual(room + 1e-6);
    const markers = proposals.find((p) => p.title === 'sharpies')!;
    expect(markers.spec.kind).toBe('objects');
    expect(markers.reason).toMatch(/lie flat/);
    // Without a drawer height they stand in pockets.
    expect(propose('sharpies x6', ctx, []).proposals[0].spec.kind).toBe('pockets');
  });

  it('gives a line it does not know a general bin', () => {
    const [p] = propose('misc small parts', ctx, []).proposals;
    expect(p.size).toEqual({ ux: 2, uy: 1, h: 3 });
    const f = fillBin(p, p.size, cellsFor(ctx, 2, 1), ctx);
    expect(f.opts.layout?.walls).toHaveLength(1);
    expect(f.opts.scoop).toBe(1);
    expect(f.contents).toBe('misc small parts');
    // Its label once, on the first compartment.
    expect(Object.values(f.opts.layout?.comps ?? {})).toEqual([{ label: 'none' }]);
    expect(p.alts.length).toBeGreaterThan(0);
  });

  it('labels with a short name, or {contents} when the name is the whole line', () => {
    const { proposals } = propose('calipers\n200 M3 screws\nhex keys 1.5–10 mm', ctx, [], false);
    expect(proposals.map((p) => p.label)).toEqual(['{contents}', 'M3 screws', '{contents}']);
  });
});

describe('ammunition', () => {
  const ctx = sizeContext(context({ height: 0 }));
  const kind = (line: string) => matchItem(item(line), []);
  const cartridge = (line: string) => {
    const h = kind(line);
    return h.kind === 'pockets' ? { preset: h.preset.id, count: h.count, label: h.label, counted: h.counted } : { kind: h.kind };
  };
  const filled = (p: Proposal, c: SizeContext = ctx) => fillBin(p, p.size, cellsFor(c, p.size.ux, p.size.uy), c);

  it('reads cartridges and how many, however they are written', () => {
    expect(cartridge('100 rounds 9mm')).toEqual({ preset: 'ammo-9mm', count: 100, label: '9mm', counted: 'given' });
    expect(cartridge('9mm x 50')).toMatchObject({ preset: 'ammo-9mm', count: 50 });
    expect(cartridge('200 .22LR')).toEqual({ preset: 'ammo-22lr', count: 200, label: '.22LR', counted: 'given' });
    expect(cartridge('20 rounds .308')).toMatchObject({ preset: 'ammo-308', count: 20, label: '.308' });
    expect(cartridge('box of 5.56')).toEqual({ preset: 'ammo-223', count: 20, label: '5.56', counted: 'box' });
    expect(cartridge('2 boxes of 9mm')).toMatchObject({ preset: 'ammo-9mm', count: 100, counted: 'box' });
    expect(cartridge('box of 50 9mm')).toMatchObject({ preset: 'ammo-9mm', count: 50, counted: 'given' });
    expect(cartridge('brick of 22lr')).toMatchObject({ preset: 'ammo-22lr', count: 500 });
    expect(cartridge('Federal 9mm 115gr FMJ x 50')).toMatchObject({ preset: 'ammo-9mm', count: 50 });
    expect(cartridge('9mm 50rds')).toMatchObject({ preset: 'ammo-9mm', count: 50 });
    expect(cartridge('9x19 x 50')).toMatchObject({ preset: 'ammo-9mm', count: 50 });
    expect(cartridge('50 .45 ACP')).toMatchObject({ preset: 'ammo-45acp', count: 50 });
    expect(cartridge('300 blackout x 40')).toMatchObject({ preset: 'ammo-300blk', count: 40 });
    expect(cartridge('7.62x51 x 20')).toMatchObject({ preset: 'ammo-308' });
    expect(cartridge('7.62x39 x 100')).toMatchObject({ preset: 'ammo-762x39', count: 100 });
    expect(cartridge('30-06 x 20')).toMatchObject({ preset: 'ammo-3006', count: 20 });
    expect(cartridge('22-250 x 20')).toMatchObject({ preset: 'ammo-22-250' });
    expect(cartridge('357 sig x 50')).toMatchObject({ preset: 'ammo-357sig' });
    expect(cartridge('.357 magnum x 50')).toMatchObject({ preset: 'ammo-357mag' });
    // A number up front that's the cartridge isn't how many.
    expect(item('308 Win x 40').qty).toBe(40);
    expect(item('223 ammo').qty).toBeNull();
    expect(cartridge('223 ammo')).toEqual({ preset: 'ammo-223', count: 20, label: '223', counted: 'default' });
    // No count: a box.
    expect(cartridge('9mm')).toMatchObject({ preset: 'ammo-9mm', count: 50, counted: 'default' });
  });

  it('reads shotshells by gauge and length', () => {
    expect(item('12 gauge shells x 25').qty).toBe(25);
    expect(cartridge('12 gauge shells x 25')).toEqual({ preset: 'ammo-12ga', count: 25, label: '12 ga 2¾″', counted: 'given' });
    expect(cartridge('25 12ga 3" shells')).toMatchObject({ preset: 'ammo-12ga-3', count: 25 });
    expect(cartridge('12ga 3.5 inch x 10')).toMatchObject({ preset: 'ammo-12ga-35', count: 10 });
    expect(cartridge('2 boxes of 12ga')).toMatchObject({ preset: 'ammo-12ga', count: 50 });
    expect(cartridge('20 ga x 25')).toMatchObject({ preset: 'ammo-20ga' });
    expect(cartridge('.410 3 inch x 10')).toMatchObject({ preset: 'ammo-410-3', count: 10 });
    expect(cartridge('box of .410')).toMatchObject({ preset: 'ammo-410', count: 25 });
  });

  it('leaves alone what only looks like a caliber', () => {
    expect(cartridge('9mm socket')).toEqual({ kind: 'set' });
    expect(cartridge('10mm wrench')).toEqual({ kind: 'objects' });
    expect(cartridge('12 gauge wire')).toEqual({ kind: 'general' });
    expect(cartridge('200 M3 screws')).toEqual({ kind: 'loose' });
    expect(cartridge('12 AA batteries')).toMatchObject({ preset: 'aa' });
    expect(item('12 AA batteries').qty).toBe(12);
    // Unless the line says it is ammunition.
    expect(cartridge('9mm hollow point rounds x 50')).toMatchObject({ preset: 'ammo-9mm', count: 50 });
  });

  it('sizes a cartridge block for the count, tall enough for a lid over the rounds', () => {
    const [p] = propose('100 rounds 9mm', ctx, []).proposals;
    const f = filled(p);
    expect(f.ok).toBe(true);
    expect(f.cap).toBeGreaterThanOrEqual(100);
    expect(f.holds).toBe('100 of 100');
    expect(f.opts).toMatchObject({ interior: 'pockets', pocketPreset: 'ammo-9mm', heightUnits: 6, labelText: '9mm' });
    expect(f.contents).toBe('100 rounds 9mm');
    expect(p.cluster).toBe('Ammunition');
    expect(p.reason).toBe('Cartridge block for 100 rounds of 9mm Luger (9×19), tall enough for a lid over them.');
    // The rounds clear a lid, so the print checks have nothing to say.
    const [g] = standingGrids(f.opts);
    expect(g.top).toBeLessThanOrEqual(tipLimits(f.opts).seat!);
    expect(binChecks(f.opts).map((c) => c.rule)).not.toContain('item-height');
    // Every smaller footprint holds fewer.
    for (let ux = 1; ux <= 4; ux++)
      for (let uy = 1; uy <= 4; uy++) if (ux * uy < p.size.ux * p.size.uy) expect(fillBin(p, { ux, uy, h: p.size.h }, cellsFor(ctx, ux, uy), ctx).ok).toBe(false);
    // Rifle rounds need a taller bin; no count gives a box.
    const [rifle] = propose('20 rounds .308', ctx, []).proposals;
    expect(rifle.size.h).toBe(12);
    const [box] = propose('9mm', ctx, []).proposals;
    expect(filled(box).cap).toBeGreaterThanOrEqual(50);
    expect(box.reason).toMatch(/No count given: a box\.$/);
  });

  it('splits a count no printable bin holds into several bins', () => {
    const parts = propose('1000 rounds 5.56', ctx, []).proposals;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.part?.of === parts.length && p.label === '5.56')).toBe(true);
    expect(parts.reduce((t, p) => t + filled(p).cap, 0)).toBeGreaterThanOrEqual(1000);
    for (const p of parts) expect(bedOvershoot(filled(p).opts, null, ctx.bed)).toBe(0);
  });

  it('stays within the drawer and the printer: under the rim if a lid won’t fit, else as tall as allowed, and says so', () => {
    const fits = (h: number) => sizeContext(context({ height: h }));
    // 9mm under a lid needs 6u (46 mm): a 45 mm drawer takes 5u, under the rim.
    const rim = fits(45);
    const [p] = propose('100 rounds 9mm', rim, []).proposals;
    expect(p.size.h).toBe(5);
    expect(p.reason).toMatch(/under the rim: the drawer is too low for a lid over them\.$/);
    expect(binTotalHeight(filled(p, rim).opts)).toBeLessThanOrEqual(rim.room);
    // .308 stands taller than a 60 mm drawer.
    const low = fits(60);
    const [q] = propose('20 rounds .308', low, []).proposals;
    expect(binTotalHeight(filled(q, low).opts)).toBeLessThanOrEqual(low.room + 1e-6);
    expect(q.warnings.join(' ')).toMatch(/more than the drawer has room for/);
    // A short printer.
    const short = sizeContext(context({ height: 0 }, { setup: { ...DEFAULT_SETUP, maxH: 70 } }));
    const [r] = propose('20 rounds .30-06', short, []).proposals;
    expect(binTotalHeight(filled(r, short).opts)).toBeLessThanOrEqual(70);
    expect(r.warnings.join(' ')).toMatch(/the printer can’t print a bin tall enough/);
  });
});

describe('grouping small items', () => {
  const ctx = sizeContext(context());

  it('puts M3 screws, nuts and washers in one bin, a compartment each', () => {
    const { proposals } = propose('200 M3 screws\n50 M3 nuts\n100 M3 washers\n12 AA batteries', ctx, []);
    expect(proposals).toHaveLength(2);
    const g = proposals[0];
    expect(g.items.map((i) => i.name)).toEqual(['M3 screws', 'M3 nuts', 'M3 washers']);
    expect(g.label).toBe('M3');
    expect(g.size.ux * g.size.uy).toBeLessThanOrEqual(3);
    const f = fillBin(g, g.size, cellsFor(ctx, g.size.ux, g.size.uy), ctx);
    expect(f.ok).toBe(true);
    expect(f.opts.layout?.walls).toHaveLength(2);
    // Each compartment gets its own contents and label, left to right in list order.
    expect(Object.values(f.compContents ?? {})).toEqual(['200 M3 screws', '50 M3 nuts', '100 M3 washers']);
    expect(Object.values(f.opts.layout?.comps ?? {}).map((c) => c.labelText)).toEqual(['M3 screws', 'M3 nuts', 'M3 washers']);
    expect(f.contents).toBeUndefined();
    // The tabs show each compartment's label.
    const resolved = resolveContentLabels(f.opts, { compContents: f.compContents });
    expect(resolved.layout?.comps).toBeDefined();
    // Screws take the most room.
    const xs = f.opts.layout!.walls.map((w) => (w.pos.kind === 'ratio' ? w.pos.t : 0));
    expect(xs[0]).toBeGreaterThan(0.5);
  });

  it('groups what is left by kind, and not at all when off', () => {
    const { proposals } = propose('30 M4 screws\n20 M5 nuts\n50 resistors\n30 LEDs', ctx, []);
    expect(proposals.map((p) => p.label)).toEqual(['Fasteners', 'Electronics']);
    expect(propose('200 M3 screws\n50 M3 nuts', ctx, [], false).proposals).toHaveLength(2);
    // Big piles stay on their own.
    expect(propose('5000 M3 screws\n50 M3 nuts', ctx, []).proposals.filter((p) => p.items.length > 1)).toHaveLength(0);
  });
});

describe('packing the drawer', () => {
  it('fits the example list into the default drawer', () => {
    const c = context();
    const plan = planFill(EXAMPLE, c);
    expect(plan.placed).toHaveLength(10);
    expect(plan.left).toHaveLength(0);
    expectValid(plan, c);
    // Every bin holds what it should, except the calipers, which are flagged.
    for (const b of plan.placed) if (!b.proposal.oversize) expect(b.fill.ok).toBe(true);
    const bins = plannedBins(plan.placed);
    expect(bins.every((b) => b.contents || b.compContents)).toBe(true);
  });

  it('keeps related bins next to each other', () => {
    const plan = planFill('12 AA batteries\nhex keys 2-6mm\n4 9V batteries\ndrill bits 1-10mm\n8 AAA batteries', context());
    const batteries = plan.placed.filter((b) => b.proposal.cluster === 'Batteries').map(rectOf);
    expect(batteries).toHaveLength(3);
    // Each battery bin touches another.
    const touch = (a: CellRect, b: CellRect) => !rectsOverlap(a, b) && rectsOverlap({ x: a.x - 1, y: a.y, w: a.w + 2, d: a.d }, b) || rectsOverlap({ x: a.x, y: a.y - 1, w: a.w, d: a.d + 2 }, b);
    for (const r of batteries) expect(batteries.some((o) => o !== r && touch(r, o))).toBe(true);
  });

  it('respects blocked cells and the bins already there, or replaces them', () => {
    const existing: PlacedBin[] = [{ id: 'old', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 4, unitsY: 4 } }];
    const c = context({ mask: ['5,0', '5,1', '6,0', '6,1'] }, { bins: existing });
    const plan = planFill(EXAMPLE, c);
    expectValid(plan, c);
    expect(plan.placed.some((b) => b.x < 4 && b.y < 4)).toBe(false);
    const replaced = planFill(EXAMPLE, c, { replace: true });
    expect(replaced.placed.some((b) => b.x < 4 && b.y < 4)).toBe(true);
    expectValid(replaced, { ...c, bins: [] });
  });

  it('leaves out what does not fit and puts it in another drawer', () => {
    const c = context({ mode: 'grid', gridX: 3, gridY: 2, mask: ['1,1'] });
    const plan = planFill(EXAMPLE, c);
    expectValid(plan, c);
    expect(plan.left.length).toBeGreaterThan(0);
    expect(plan.placed.length + plan.left.length).toBe(plan.proposals.length);
    expect(plan.extra.length).toBeGreaterThan(0);
    expect(plan.extra.flat().length + plan.never.length).toBe(plan.left.length);
    for (const d of plan.extra) expectValid({ ...plan, placed: d }, c);
    // Too long for a 3-wide grid, they'd take all of it, and it has a blocked cell.
    expect(plan.never.map((p) => p.title)).toEqual(['calipers', 'zip ties']);
  });

  it('places bins on narrow edge cells only where they still hold everything', () => {
    // A 30 mm strip of partial cells along the right: too narrow for most pockets.
    const c = context({ mode: 'drawer', width: 4 * 42 + 30.5, depth: 3 * 42 + 0.5, fill: 'fit', alignX: 0 });
    expect(c.layout.nx).toBe(5);
    const plan = planFill('12 AA batteries\n4 9V batteries\nSD cards x8', c);
    for (const b of plan.placed) {
      const cells = binCellsAt(c.layout, { id: 'p', x: b.x, y: b.y, opts: b.fill.opts });
      expect(fillBin(b.proposal, b.size, cells ?? cellsFor(plan.ctx, b.size.ux, b.size.uy), plan.ctx).ok).toBe(true);
    }
  });

  it('works on a half grid, in 21 mm cells', () => {
    const c = context({ halfGrid: true });
    const plan = planFill(EXAMPLE, c);
    expectValid(plan, c);
    expect(plan.left).toHaveLength(0);
    // Nothing thinner than a full unit unless it's that small both ways.
    for (const b of plan.placed) if (Math.max(b.size.ux, b.size.uy) > 2) expect(Math.min(b.size.ux, b.size.uy)).toBeGreaterThanOrEqual(2);
    for (const b of plan.placed) expect(b.fill.opts.unitsX).toBe(b.size.ux);
  });

  it('keeps a size the user picks, and says when it is too small', () => {
    const c = context();
    const key = planFill('12 AA batteries', c).proposals[0].key;
    const plan = planFill('12 AA batteries', c, { sizes: { [key]: { ux: 1, uy: 1, h: 5 } } });
    expect(plan.placed[0].size).toEqual({ ux: 1, uy: 1, h: 5 });
    expect(plan.placed[0].warnings.join(' ')).toMatch(/Too small for everything/);
    // Never bigger than the printer takes.
    const wide = planFill('12 AA batteries', c, { sizes: { [key]: { ux: 7, uy: 1, h: 5 } } });
    expect(wide.placed[0].size).toEqual({ ux: 5, uy: 1, h: 5 });
    expect(wide.placed[0].fill.printable).toBe(true);
    expect(propose('batteries x4', plan.ctx, []).proposals[0].reason).toBe('Pocket grid for 4 batteries (AA battery size).');
    const skipped = planFill('12 AA batteries\ncalipers', c, { skip: ['calipers'] });
    expect(skipped.placed.map((b) => b.proposal.title)).toEqual(['AA batteries']);
    expect(skipped.skipped.map((p) => p.title)).toEqual(['calipers']);
  });

  it('packs into free cells only, trying other sizes in order', () => {
    // Free: the front row and the middle of the back row.
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 2, mask: ['0,1'] });
    const old: PlacedBin = { id: 'old', x: 2, y: 1, opts: DEFAULT_BIN };
    const r = packBins(layout, [old], [
      { key: 'big', cluster: 'x', sizes: [{ ux: 3, uy: 2, h: 3 }, { ux: 2, uy: 1, h: 3 }] },
      { key: 'one', cluster: 'x', sizes: [{ ux: 1, uy: 1, h: 3 }] },
      { key: 'wide', cluster: 'y', sizes: [{ ux: 3, uy: 1, h: 3 }] },
    ]);
    expect(r.placed.map((p) => [p.key, p.x, p.y, p.size.ux, p.size.uy])).toEqual([
      ['big', 0, 0, 2, 1],
      ['one', 2, 0, 1, 1],
    ]);
    expect(r.left).toEqual(['wide']);
    // A bin too small for what it's for anyway goes after the others.
    const last = packBins(layout, [], [
      { key: 'flagged', cluster: 'x', sizes: [{ ux: 3, uy: 2, h: 3 }], last: true },
      { key: 'ok', cluster: 'y', sizes: [{ ux: 1, uy: 1, h: 3 }] },
    ]);
    expect(last.placed.map((p) => p.key)).toEqual(['ok']);
    expect(last.left).toEqual(['flagged']);
  });
});

describe('the store', () => {
  const s = () => useStore.getState();
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });

  const fill = (text: string, o: { replace?: boolean } = {}) => {
    const st = s();
    const plan = planFill(text, {
      layout: computeLayout(st.drawer),
      drawer: st.drawer,
      baseplate: st.baseplate,
      setup: st.setup,
      bins: st.bins,
      tools: st.tools,
      newBin: st.newBin,
    }, o);
    return plan;
  };

  it('adds every bin in one undo step', () => {
    s().addBin(0, 0, 1, 1);
    history.checkpoint();
    const before = s().bins;
    const plan = fill(EXAMPLE);
    const ids = s().addBins(plannedBins(plan.placed));
    expect(ids).toHaveLength(plan.placed.length);
    expect(s().bins).toHaveLength(before.length + plan.placed.length);
    const added = s().bins.filter((b) => ids.includes(b.id));
    expect(added.find((b) => b.contents === '12 AA batteries')?.opts.interior).toBe('pockets');
    expect(added.find((b) => b.compContents)?.opts.labelText).toBe('M3');
    history.undo();
    expect(s().bins).toBe(before);
    history.redo();
    expect(s().bins).toHaveLength(before.length + plan.placed.length);
  });

  it('replaces the drawer’s bins and adds new drawers in the same step', () => {
    s().addBin(0, 0, 2, 2);
    history.checkpoint();
    const plan = fill(EXAMPLE, { replace: true });
    s().addBins(plannedBins(plan.placed.slice(0, 3)), { replace: true, newDrawers: [plannedBins(plan.placed.slice(3))] });
    expect(s().bins).toHaveLength(3);
    const docs = allDrawers(s());
    expect(docs).toHaveLength(2);
    expect(docs[1].bins).toHaveLength(plan.placed.length - 3);
    expect(docs[1].drawer.width).toBe(s().drawer.width);
    expect(docs[1].name).toBe('Drawer 2');
    expect(s().activeDrawerId).toBe(docs[0].id);
    history.undo();
    expect(allDrawers(s())).toHaveLength(1);
    expect(s().bins).toHaveLength(1);
  });

  it('cuts bins down to the printer and skips ones that would overlap', () => {
    const ids = s().addBins([
      { x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 7, unitsY: 1 } },
      { x: 2, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1 } },
      { x: 5, y: 0, opts: { ...DEFAULT_BIN, unitsX: 1, unitsY: 1 } },
    ]);
    expect(ids).toHaveLength(2);
    expect(s().bins[0].opts.unitsX).toBe(5);
    expect(bedOvershoot(s().bins[0].opts, null, usableBed(s().setup))).toBe(0);
  });

  it('remembers the list for each drawer, in the project, without an undo step', () => {
    const first = s().activeDrawerId;
    s().setFillList('12 AA batteries');
    expect(history.canUndo()).toBe(false);
    s().addDrawer('Second');
    expect(allDrawers(s()).find((d) => d.id === first)?.fillList).toBe('12 AA batteries');
    expect(allDrawers(s())[1].fillList).toBeUndefined();
    s().setFillList('calipers');
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    s().resetAll();
    s().loadProject(file);
    expect(allDrawers(s()).map((d) => d.fillList)).toEqual(['12 AA batteries', 'calipers']);
    // Files from before have no list.
    s().loadProject({ app: 'gridfit', drawers: [{ id: 'x', name: 'Old', drawer: DEFAULT_DRAWER, bins: [] }] });
    expect(allDrawers(s())[0].fillList).toBeUndefined();
    expect('fillList' in allDrawers(s())[0]).toBe(false);
    s().setFillList('');
    expect('fillList' in allDrawers(s())[0]).toBe(false);
  });
});
