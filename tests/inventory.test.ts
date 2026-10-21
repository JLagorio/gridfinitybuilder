import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BIN, binLayout, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER, computeLayout } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { uniformLayout } from '../src/lib/dividers';
import { binSpec, planPrint, type NamedDrawer, type PlacedBin } from '../src/lib/project';
import {
  binEntries,
  carryContents,
  cellName,
  cleanBinContents,
  columnName,
  combinedMapSvg,
  contentLines,
  drawerMap,
  fitLines,
  inventoryCsv,
  inventoryRows,
  mapSvg,
  mapTiles,
  PAPERS,
  sanitizeContents,
  searchInventory,
  textWidth,
  tilePlan,
  withCompContents,
  withContents,
  wrapText,
} from '../src/lib/inventory';
import { allDrawers, projectFile, useStore } from '../src/state/store';
import { decodeProject, encodeProject } from '../src/lib/share';

const s = () => useStore.getState();

const opts = (p: Partial<BinOptions> = {}) => sanitizeBin({ ...DEFAULT_BIN, ...p });
const bin = (id: string, x: number, y: number, p: Partial<BinOptions> = {}, extra: Partial<PlacedBin> = {}): PlacedBin => ({
  id,
  x,
  y,
  opts: opts(p),
  ...extra,
});
const drawer = (id: string, name: string, bins: PlacedBin[]): NamedDrawer => ({
  id,
  name,
  drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 6, gridY: 4 },
  baseplate: DEFAULT_BASEPLATE,
  bins,
});
/** Compartment keys of a bin, in layout order. */
const keys = (o: BinOptions) => binLayout(o).compartments.map((c) => c.key);

describe('contents text', () => {
  it('sanitizes user input', () => {
    expect(sanitizeContents('\r\n\n  M3 screws  \r\nM4\tnuts\u0007\n\n\n')).toBe('  M3 screws\nM4 nuts');
    expect(sanitizeContents(42)).toBe('');
    expect(sanitizeContents(null)).toBe('');
    expect(sanitizeContents('a\n'.repeat(500)).split('\n')).toHaveLength(200);
    expect([...sanitizeContents('x'.repeat(9000))]).toHaveLength(4000);
  });

  it('reads items from lines, dropping bullets and blanks', () => {
    expect(contentLines('- M3 screws\n\n• M3 nuts\n  * washers \n-5V rail')).toEqual(['M3 screws', 'M3 nuts', 'washers', '-5V rail']);
    expect(contentLines(undefined)).toEqual([]);
  });

  it('cleans saved bins and keeps old ones unchanged', () => {
    expect(cleanBinContents({ id: 'a', x: 0, y: 0, opts: {} })).toEqual({});
    expect(cleanBinContents(null)).toEqual({});
    expect(
      cleanBinContents({ contents: 'Pliers\n', compContents: { k1: 'M3\u0000', k2: '   ', k3: 7, '': 'x' } }),
    ).toEqual({ contents: 'Pliers', compContents: { k1: 'M3' } });
    expect(cleanBinContents({ compContents: ['nope'] })).toEqual({});
  });

  it('sets and clears contents without leaving empty fields', () => {
    const b = bin('a', 0, 0);
    const c = withContents(b, 'Screws');
    expect(c.contents).toBe('Screws');
    expect('contents' in withContents(c, '  \n')).toBe(false);
    const k = withCompContents(b, 'key', 'Nuts');
    expect(k.compContents).toEqual({ key: 'Nuts' });
    expect('compContents' in withCompContents(k, 'key', '')).toBe(false);
  });
});

describe('contents are not geometry', () => {
  it('leave mesh keys and part names alone', () => {
    const layout = computeLayout(drawer('d', 'D', []).drawer);
    const plain = bin('a', 0, 0, { unitsX: 2, divX: 2, labelText: 'M3' });
    const full: PlacedBin = { ...plain, contents: 'M3 × 8\nM3 × 12', compContents: { [keys(plain.opts)[0]]: 'nuts' } };
    expect(binSpec(layout, full).key).toBe(binSpec(layout, plain).key);
    const a = planPrint([drawer('d', 'D', [plain])], DEFAULT_SETUP, { baseplate: true, bins: true });
    const b = planPrint([drawer('d', 'D', [full])], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(Object.keys(b.meshes)).toEqual(Object.keys(a.meshes));
    expect(b.parts).toEqual(a.parts);
  });
});

describe('store', () => {
  beforeEach(() => s().resetAll());

  it('edits contents of the active drawer’s bins (and skips no-op edits)', () => {
    const id = s().addBin(0, 0, 2, 1);
    s().setBinContents(id, 'M3 screws\nM3 nuts\n');
    expect(s().bins[0].contents).toBe('M3 screws\nM3 nuts');
    const before = s().bins;
    s().setBinContents(id, 'M3 screws\nM3 nuts');
    expect(s().bins).toBe(before);
    s().setCompContents(id, 'k', 'washers');
    expect(s().bins[0].compContents).toEqual({ k: 'washers' });
    s().setBinContents(id, '');
    expect('contents' in s().bins[0]).toBe(false);
  });

  it('keeps contents in project files and share links, and opens old files', () => {
    const id = s().addBin(0, 0, 1, 1);
    s().setBinContents(id, 'Hex keys');
    s().addDrawer('Garage');
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    expect(file.drawers[0].bins[0].contents).toBe('Hex keys');
    s().resetAll();
    s().loadProject(decodeProject(encodeProject(file)));
    expect(allDrawers(s())[0].bins[0].contents).toBe('Hex keys');
    // Files from before contents existed open unchanged.
    s().loadProject({ app: 'gridfit', version: 2, drawers: [{ id: 'x', name: 'Old', bins: [{ id: 'b', x: 0, y: 0, opts: { unitsX: 2 } }] }] });
    expect(s().bins[0]).toEqual({ id: 'b', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2 } });
    // Damaged contents are cleaned on the way in.
    s().loadProject({ app: 'gridfit', drawers: [{ id: 'y', name: 'Bad', bins: [{ id: 'c', x: 0, y: 0, opts: {}, contents: 5, compContents: 'x' }] }] });
    expect(s().bins[0]).toEqual({ id: 'c', x: 0, y: 0, opts: DEFAULT_BIN });
  });

  it('moves compartment contents along when walls change', () => {
    const id = s().addBin(0, 0, 2, 1);
    s().updateBin(id, { opts: { divX: 2 } });
    const [left, right] = keys(s().bins[0].opts);
    s().setCompContents(id, left, 'M3');
    s().setCompContents(id, right, 'M4');
    // Resizing keeps the compartments.
    s().updateBin(id, { opts: { unitsY: 2 } });
    expect(s().bins[0].compContents).toEqual({ [left]: 'M3', [right]: 'M4' });
    // Unrelated edits don't touch them.
    const before = s().bins[0].compContents;
    s().updateBin(id, { opts: { scoop: 0.5 } });
    expect(s().bins[0].compContents).toBe(before);
    // Down to one compartment: everything joins the bin's own contents.
    s().setBinContents(id, 'spares');
    s().updateBin(id, { opts: { divX: 1 } });
    expect(s().bins[0].contents).toBe('spares\nM3\nM4');
    expect(s().bins[0].compContents).toBeUndefined();
  });

  it('locates a bin in another drawer', () => {
    const first = s().activeDrawerId;
    const id = s().addBin(1, 1, 1, 1);
    s().addDrawer('Garage');
    s().setUI({ tab: 'print' });
    s().locateBin(first, id);
    expect(s().activeDrawerId).toBe(first);
    expect(s().ui.tab).toBe('bins');
    expect(s().ui.selectedBinId).toBe(id);
    s().locateBin('nope', id);
    expect(s().activeDrawerId).toBe(first);
  });
});

describe('carryContents', () => {
  it('hands a removed compartment’s contents to the one that took its place', () => {
    const o3 = opts({ unitsX: 3, divX: 3 });
    const [a, b, c] = keys(o3);
    const src = bin('x', 0, 0, { unitsX: 3, divX: 3 }, { compContents: { [a]: 'A', [b]: 'B', [c]: 'C' } });
    const o2 = opts({ unitsX: 3, divX: 3, layout: { walls: uniformLayout(3, 1).walls.slice(0, 1) } });
    const out = carryContents(src, o2);
    expect(out.opts).toBe(o2);
    const k2 = keys(o2);
    expect(k2).toHaveLength(2);
    // Nothing is lost.
    const all = Object.values(out.compContents ?? {}).join('\n').split('\n').sort();
    expect([...all, ...(out.contents ? out.contents.split('\n') : [])].sort()).toEqual(['A', 'B', 'C']);
  });

  it('leaves bins without compartment contents alone', () => {
    const b = bin('x', 0, 0, { divX: 2 }, { contents: 'kept' });
    const next = opts({ divX: 3 });
    expect(carryContents(b, next)).toEqual({ ...b, opts: next });
  });
});

describe('inventory entries', () => {
  it('names cells like a spreadsheet, front row first', () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
    expect(cellName(1, 2)).toBe('B3');
  });

  it('lists compartments by place, with leftovers kept on the bin', () => {
    const o = opts({ unitsX: 2, unitsY: 2, divX: 2, divY: 2 });
    const [k0] = keys(o);
    const e = binEntries([drawer('d', 'Desk', [bin('b', 0, 0, { unitsX: 2, unitsY: 2, divX: 2, divY: 2 }, { compContents: { [k0]: 'Fuses', gone: 'Old stuff' } })])])[0];
    expect(e.comps.map((c) => c.name)).toEqual(['back left', 'back right', 'front left', 'front right']);
    expect(e.comps.flatMap((c) => c.contents)).toEqual(['Fuses']);
    expect(e.contents).toEqual(['Old stuff']);
  });

  it('includes tool cutout names', () => {
    const cut = { toolId: 't', name: 'Side cutters', x: 0, y: 0, rotation: 0, outline: [[-5, -5], [5, -5], [5, 5]] as [number, number][], depth: 5, clearance: 0.5 };
    const e = binEntries([drawer('d', 'D', [bin('b', 0, 0, { unitsX: 2, interior: 'cutouts', cutouts: [cut] })])])[0];
    expect(e.tools).toEqual(['Side cutters']);
  });
});

function workspace(): NamedDrawer[] {
  const layout = { walls: uniformLayout(2, 1).walls, comps: {} as Record<string, { labelText?: string }> };
  const split = opts({ unitsX: 2, divX: 2, layout });
  const [l, r] = keys(split);
  layout.comps[l] = { labelText: 'Fuses' };
  const cut = { toolId: 't', name: 'Wire strippers', x: 0, y: 0, rotation: 0, outline: [[-5, -5], [5, -5], [5, 5]] as [number, number][], depth: 5, clearance: 0.5 };
  return [
    drawer('d1', 'Workbench top', [
      bin('b1', 0, 0, { labelText: 'M3 screws' }, { contents: 'M3 × 8 socket head\nM3 × 12 socket head' }),
      bin('b2', 1, 0, {}, { contents: 'Washers for M3 and M4' }),
      bin('b3', 2, 0, { unitsX: 2, divX: 2, layout }, { compContents: { [l]: '5 A blade fuses', [r]: 'Spare relays' } }),
    ]),
    drawer('d2', 'Garage', [
      bin('g1', 0, 0, { labelText: 'Screws' }, { contents: 'Wood screws\nDrywall screws' }),
      bin('g2', 1, 0, { unitsX: 2, interior: 'cutouts', cutouts: [cut] }),
      bin('g3', 3, 1, {}, { contents: 'M3 nuts' }),
    ]),
  ];
}

describe('search', () => {
  const ws = workspace();
  const find = (q: string, active = 'd1') => searchInventory(ws, q, { activeDrawerId: active });

  it('needs every word, in any case and with accents ignored', () => {
    expect(find('')).toEqual([]);
    expect(find('m3 SOCKET').map((r) => r.binId)).toEqual(['b1']);
    expect(find('socket nothing')).toEqual([]);
    const accented = searchInventory([drawer('x', 'Atelier', [bin('a', 0, 0, {}, { contents: 'Crème brûlée torch' })])], 'creme brulee');
    expect(accented[0].text).toBe('Crème brûlée torch');
    expect(accented[0].marks).toEqual([
      [0, 5],
      [6, 12],
    ]);
  });

  it('searches every drawer and ranks whole words and labels first', () => {
    const r = find('screws');
    // The label "Screws" (in another drawer) is an exact match; "M3 screws" is a label too.
    expect(r[0]).toMatchObject({ drawerId: 'd2', binId: 'g1', kind: 'label', text: 'Screws', more: 2 });
    expect(r[1]).toMatchObject({ drawerId: 'd1', binId: 'b1', kind: 'label' });
    expect(r.map((x) => x.binId)).not.toContain('b2');
  });

  it('prefers the active drawer on ties', () => {
    expect(find('m3 nuts', 'd2')[0].binId).toBe('g3');
    const tie = searchInventory(
      [drawer('a', 'A', [bin('x', 0, 0, {}, { contents: 'Tape' })]), drawer('b', 'B', [bin('y', 0, 0, {}, { contents: 'Tape' })])],
      'tape',
      { activeDrawerId: 'b' },
    );
    expect(tie.map((x) => x.drawerId)).toEqual(['b', 'a']);
  });

  it('finds compartment labels and contents, tools and drawers', () => {
    const fuses = find('fuses');
    expect(fuses[0]).toMatchObject({ binId: 'b3', compKey: expect.any(String), comp: 'Fuses', kind: 'label' });
    const relays = find('relays')[0];
    expect(relays).toMatchObject({ binId: 'b3', comp: 'right', text: 'Spare relays' });
    expect(find('strippers')[0]).toMatchObject({ binId: 'g2', kind: 'tool' });
    expect(find('garage')[0]).toMatchObject({ kind: 'drawer', drawerId: 'd2', binId: undefined });
  });

  it('lets other words match what a line belongs to', () => {
    // "garage" is the drawer, "wood" the line.
    const r = find('garage wood');
    expect(r[0]).toMatchObject({ binId: 'g1', text: 'Wood screws' });
  });

  it('tolerates a typo in longer words', () => {
    expect(find('wahsers')[0]?.binId).toBe('b2');
    expect(find('relay')[0]?.binId).toBe('b3');
    expect(find('xq')).toEqual([]);
  });

  it('matches word parts and letter/digit boundaries', () => {
    expect(find('3').map((r) => r.binId)).toContain('b1');
    expect(find('ocket')[0]?.binId).toBe('b1');
    // A single letter only matches at the start of a word.
    expect(find('o').map((r) => r.binId)).not.toContain('b1');
  });

  it('limits results', () => {
    expect(searchInventory(ws, 's').length).toBeGreaterThan(2);
    expect(searchInventory(ws, 's', { limit: 2 })).toHaveLength(2);
  });
});

describe('CSV inventory', () => {
  it('has one row per item and quotes what needs quoting', () => {
    const rows = inventoryRows(workspace());
    expect(rows[0]).toEqual(['Drawer', 'Position', 'Bin', 'Label', 'Compartment', 'Item']);
    expect(rows).toContainEqual(['Workbench top', 'A1', '1×1×3u', 'M3 screws', '', 'M3 × 8 socket head']);
    expect(rows).toContainEqual(['Workbench top', 'C1', '2×1×3u 2 compartments', '', 'left (Fuses)', '5 A blade fuses']);
    expect(rows).toContainEqual(['Garage', 'B1', '2×1×3u 1 tool pocket', '', 'Tool pocket', 'Wire strippers']);
    const csv = inventoryCsv([drawer('d', 'Shop, east', [bin('a', 0, 0, { labelText: 'Say "hi"' }, { contents: '=1+1' }), bin('b', 1, 0)])]);
    expect(csv).toBe(
      'Drawer,Position,Bin,Label,Compartment,Item\r\n' + '"Shop, east",A1,1×1×3u,"Say ""hi""",,\'=1+1\r\n' + '"Shop, east",B1,1×1×3u,,,\r\n',
    );
  });
});

describe('drawer map', () => {
  it('draws every bin with its label and contents, escaped', () => {
    const ws = workspace();
    ws[0].bins.push(bin('b4', 5, 3, { labelText: 'Tom & Jerry <3' }));
    const m = drawerMap(ws[0], { units: 'mm' });
    const svg = mapSvg(m);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${Math.round(m.w * 100) / 100}mm"`);
    expect(svg).toContain('Workbench top');
    expect(svg).toContain('6 × 4 grid');
    for (const id of ['b1', 'b2', 'b3', 'b4']) expect(svg).toContain(`data-bin="${id}"`);
    expect(svg).toContain('M3 screws');
    expect(svg).toContain('>Spare relays</text>');
    expect(svg).toContain('>Tom &amp;</text>');
    expect(svg).toContain('>Jerry &lt;3</text>');
    expect(svg).not.toContain('<3');
    // Column letters and row numbers.
    expect(svg).toContain('>F</text>');
    expect(svg).toContain('>4</text>');
    // Well-formed enough to parse.
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length);
  });

  it('uses the chosen units and marks an empty bin with its size', () => {
    const d: NamedDrawer = { ...drawer('d', 'Inch', [bin('a', 0, 0, { unitsX: 2 })]), drawer: { ...DEFAULT_DRAWER, width: 508, depth: 381 } };
    const svg = mapSvg(drawerMap(d, { units: 'in', precision: 8 }));
    expect(svg).toContain('Drawer 20″ × 15″');
    expect(svg).toContain('>2″</text>');
    expect(svg).toContain('>2×1</text>');
  });

  it('marks blocked cells and draws tool outlines and compartments', () => {
    const ws = workspace();
    const d: NamedDrawer = { ...ws[1], drawer: { ...ws[1].drawer, mask: ['5,3'] } };
    const svg = mapSvg(drawerMap(d));
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+L/);
    expect(svg).toContain('<polygon points=');
    expect(svg).toContain('>Wire strippers</text>');
    const comps = mapSvg(drawerMap(ws[0]));
    // Two white compartment rectangles inside bin b3.
    const b3 = comps.slice(comps.indexOf('data-bin="b3"'));
    expect(b3.slice(0, b3.indexOf('</g>')).match(/fill="#ffffff"/g)).toHaveLength(2);
  });

  it('stacks several drawers into one SVG', () => {
    const maps = workspace().map((d) => drawerMap(d));
    const svg = combinedMapSvg(maps);
    expect(svg).toContain('Workbench top');
    expect(svg).toContain('Garage');
    expect(svg).toContain(`translate(0 ${Math.round((maps[0].h + 12) * 100) / 100})`);
  });

  it('splits actual-size maps into overlapping pages', () => {
    expect(mapTiles(100, 100, 190, 270)).toEqual([{ x: 0, y: 0, w: 100, h: 100, row: 0, col: 0 }]);
    const t = mapTiles(400, 300, 190, 270, 10);
    expect(t.map((x) => [x.col, x.row])).toEqual([
      [0, 0], [1, 0], [2, 0],
      [0, 1], [1, 1], [2, 1],
    ]);
    expect(t[1].x).toBe(180);
    expect(t[2].x + t[2].w).toBe(400);
    expect(t[3].y).toBe(260);
    expect(t[3].h).toBe(40);
    // A wide map goes landscape when that needs fewer pages.
    const a4 = PAPERS.find((p) => p.id === 'a4')!;
    const plan = tilePlan(270, 180, a4);
    expect(plan).toMatchObject({ landscape: true });
    expect(plan.tiles).toHaveLength(1);
    expect(tilePlan(180, 260, a4).landscape).toBe(false);
  });

  it('fits text: wraps, shrinks and cuts off', () => {
    expect(wrapText('M3 socket head cap screws', 10)).toEqual(['M3 socket', 'head cap', 'screws']);
    expect(wrapText('Superlongword', 6)).toEqual(['Super-', 'longw-', 'ord']);
    const big = fitLines([{ text: 'Fuses' }], 40, 40);
    expect(big.fits).toBe(true);
    expect(big.lines[0].size).toBe(6);
    const small = fitLines([{ text: 'A fairly long line of text' }], 20, 8);
    expect(small.fits).toBe(true);
    expect(small.lines[0].size).toBeLessThan(6);
    const cut = fitLines(Array.from({ length: 30 }, (_, i) => ({ text: `Item ${i}` })), 20, 10);
    expect(cut.fits).toBe(false);
    expect(cut.lines.at(-1)!.text.endsWith('…')).toBe(true);
    expect(textWidth(cut.lines.at(-1)!.text, cut.lines.at(-1)!.size)).toBeLessThanOrEqual(20);
    // A list keeps one item per line while the text stays readable.
    const list = ['M3 × 8 socket head', 'M3 × 12 socket head', 'M3 × 20 button head'].map((text) => ({ text }));
    const fitted = fitLines([{ text: 'M3 screws', bold: true, scale: 1.15 }, ...list], 37, 37);
    expect(fitted.lines.map((l) => l.text)).toEqual(['M3 screws', ...list.map((l) => l.text)]);
    expect(fitted.lines[1].size).toBeGreaterThanOrEqual(3);
  });

  it('measures text roughly like Helvetica', () => {
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('MMMM', 10) / 3);
    expect(textWidth('Fuses', 10, true)).toBeGreaterThan(textWidth('Fuses', 10));
    expect(textWidth('é', 10)).toBeCloseTo(textWidth('e', 10));
  });
});
