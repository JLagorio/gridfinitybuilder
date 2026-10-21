import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binLayout, buildBin, sanitizeBin, type BinCells, type BinOptions } from '../src/lib/geometry/bin';
import { registerFont } from '../src/lib/geometry/text';
import { containerDefs } from '../src/lib/geometry/containers';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, NOZZLES, cleanSetup } from '../src/lib/layout/plan';
import { setCompartmentOptions, setWallProps, uniformLayout, type DividerLayout } from '../src/lib/dividers';
import type { BinCutout } from '../src/lib/geometry/cutouts';
import { findPocketPreset, presetFields } from '../src/lib/geometry/pocketPresets';
import {
  binChecks,
  drawerChecks,
  projectChecks,
  setupChecks,
  worstSeverity,
  type CheckOptions,
  type CheckRule,
  type PrintCheck,
} from '../src/lib/printability';

let w: Wasm;

beforeAll(async () => {
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  w = (await Module()) as unknown as Wasm;
  w.setup();
});

const bin = (o: Partial<BinOptions>): BinOptions => ({ ...DEFAULT_BIN, ...o });
const find = (checks: PrintCheck[], rule: CheckRule) => checks.find((c) => c.rule === rule);
const rules = (checks: PrintCheck[]) => checks.map((c) => c.rule);

/** The bin's check for `rule`, and the same bin with its fix applied (which must clear it). */
function expectFixed(o: BinOptions, rule: CheckRule, cells?: Partial<BinCells> | null, opts?: CheckOptions) {
  const c = find(binChecks(o, cells, opts), rule);
  expect(c?.fix?.bin, `${rule} has a fix`).toBeTruthy();
  const fixed = sanitizeBin({ ...o, ...c!.fix!.bin });
  expect(rules(binChecks(fixed, cells, opts))).not.toContain(rule);
  return c!;
}

const removableSplit = (): DividerLayout => setWallProps(uniformLayout(1, 2), 'y1', { removable: true });
const tool = (o: Partial<BinCutout> = {}): BinCutout => ({
  toolId: 't1',
  name: 'Screwdriver',
  x: 0,
  y: 0,
  rotation: 0,
  outline: [
    [-12, -5],
    [12, -5],
    [12, 5],
    [-12, 5],
  ],
  depth: 10,
  clearance: 0.5,
  label: true,
  ...o,
});

describe('print checks stay quiet on the defaults', () => {
  it('a default bin, at every nozzle', () => {
    for (const nozzle of NOZZLES) expect(binChecks(DEFAULT_BIN, null, { nozzle })).toEqual([]);
  });

  it('every container type with its own defaults', () => {
    const defs = containerDefs();
    expect(defs.length).toBeGreaterThanOrEqual(5);
    for (const d of defs) {
      const o = bin({ container: d.kind, heightUnits: Math.max(DEFAULT_BIN.heightUnits, d.minHeightUnits ?? 0) });
      expect(binChecks(o), d.kind).toEqual([]);
      expect(binChecks({ ...o, unitsX: 2, unitsY: 2 }), `${d.kind} 2 × 2`).toEqual([]);
    }
  });

  it('the default drawer, carry case, wall grid and spacer strips', () => {
    expect(drawerChecks(DEFAULT_DRAWER, DEFAULT_BASEPLATE)).toEqual([]);
    expect(drawerChecks({ ...DEFAULT_DRAWER, enclosure: 'case' }, DEFAULT_BASEPLATE)).toEqual([]);
    expect(drawerChecks({ ...DEFAULT_DRAWER, enclosure: 'case', carryCase: { label: 'Tools' } }, DEFAULT_BASEPLATE)).toEqual([]);
    expect(drawerChecks({ ...DEFAULT_DRAWER, enclosure: 'wall' }, DEFAULT_BASEPLATE)).toEqual([]);
    expect(drawerChecks({ ...DEFAULT_DRAWER, fill: 'spacers' }, DEFAULT_BASEPLATE)).toEqual([]);
    for (const connector of ['bowtie', 'pin', 'puzzle', 'screw'] as const) expect(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, connector })).toEqual([]);
  });

  it('the default printer setup', () => {
    expect(setupChecks(DEFAULT_SETUP, { bins: true })).toEqual([]);
    expect(projectChecks([{ id: 'd1', name: 'Drawer 1', drawer: DEFAULT_DRAWER, baseplate: DEFAULT_BASEPLATE, bins: [{ id: 'b', x: 0, y: 0, opts: DEFAULT_BIN }] }], DEFAULT_SETUP, { baseplate: true, bins: true })).toEqual([]);
  });

  it('common, sensible bins', () => {
    const fine: Partial<BinOptions>[] = [
      { unitsX: 2, unitsY: 2, heightUnits: 6, divX: 2, divY: 2, scoop: 1, label: 'full', labelText: 'Screws' },
      { unitsX: 2, unitsY: 1, divX: 2, label: 'full', labelText: 'M3 nuts' },
      { holes: 'magnets', holeCrushRibs: true },
      { holes: 'both', holePrintable: true },
      { interior: 'pockets' },
      { heightUnits: 6, patternWalls: 'lr' },
      { unitsX: 2, unitsY: 2, heightUnits: 6, cups: true, divX: 2 },
      { unitsX: 2, unitsY: 2, heightUnits: 6, layout: removableSplit() },
      { lip: false, slideLid: true, slideLidText: 'Bits' },
      { unitsX: 2, frontLabel: 'raised', labelText: 'Screws' },
    ];
    for (const o of fine) expect(binChecks(bin(o)), JSON.stringify(o)).toEqual([]);
  });
});

describe('label text', () => {
  it('text too long for its tab is left off, and full-width tabs fix it', () => {
    const o = bin({ unitsX: 2, label: 'center', labelText: 'M3 socket head cap screws, 12 mm long' });
    const c = expectFixed(o, 'label-fit');
    expect(c.severity).toBe('warn');
    expect(c.fix!.bin).toEqual({ label: 'full' });
    expect(c.message).toContain('left off');
  });

  it('strokes thinner than the nozzle, against the nozzle size', () => {
    const o = bin({ divX: 2, divY: 2, label: 'full', labelText: 'Washers M3' });
    const c = find(binChecks(o), 'label-thin');
    expect(c?.severity).toBe('warn');
    expect(c?.message).toMatch(/2\.\d mm/);
    // A finer nozzle draws them.
    expect(rules(binChecks(o, null, { nozzle: 0.2 }))).not.toContain('label-thin');
  });

  it('raised text under 3 mm is a tip; engraved text of that size is not', () => {
    const o = bin({ divX: 3, label: 'full', labelText: 'Screws' });
    expect(find(binChecks(o), 'label-small')?.severity).toBe('info');
    expect(rules(binChecks({ ...o, labelStyle: 'engraved' }))).not.toContain('label-small');
  });

  it('label plates, the front label, the sliding lid', () => {
    expect(find(binChecks(bin({ label: 'full', labelPlates: true, labelText: 'M3 socket head cap screws long' })), 'label-fit')?.part).toBe('Label plates');
    const front = bin({ unitsX: 2, frontLabel: 'raised', frontLabelSize: 2.4, labelText: 'Screws' });
    expect(expectFixed(front, 'label-thin').fix!.bin).toEqual({ frontLabelSize: 0 });
    const lid = find(binChecks(bin({ lip: false, slideLid: true, slideLidText: 'M3 socket head cap screws, 12 mm and 16 mm long' })), 'label-fit');
    expect(lid?.part).toBe('Sliding lid');
  });

  it('tool names and graduated-set sizes', () => {
    const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 4, interior: 'cutouts', cutouts: [tool()], cutoutStyle: { labelSize: 2 } });
    const c = expectFixed(o, 'label-thin');
    expect(c.part).toBe('Tool names');
    expect(binChecks({ ...o, cutouts: [tool({ label: false })] })).toEqual([]);
    const set = bin({ unitsX: 2, interior: 'pockets', pocketSizes: [2, 3, 4, 5, 6, 8], pocketSizeLabels: 'mm' });
    expect(rules(binChecks(set))).not.toContain('label-thin');
    expect(find(binChecks(set, null, { nozzle: 0.6 }), 'label-thin')?.part).toBe('Size labels');
  });

  it('a carry case label shrunk to fit its lid', () => {
    const drawer: DrawerInput = {
      ...DEFAULT_DRAWER,
      mode: 'grid',
      gridX: 2,
      gridY: 2,
      enclosure: 'case',
      carryCase: { label: 'Allen keys, Torx bits, screwdrivers, pliers and a tape measure', labelSize: 12 },
    };
    const c = find(drawerChecks(drawer, DEFAULT_BASEPLATE), 'label-thin');
    expect(c?.part).toBe('Carry case');
  });

  it('project checks report them with the drawer and bin they are about', () => {
    const o = bin({ divX: 2, divY: 2, label: 'full', labelText: 'Washers M3' });
    const found = projectChecks([{ id: 'd1', name: 'D', drawer: DEFAULT_DRAWER, baseplate: DEFAULT_BASEPLATE, bins: [{ id: 'b1', x: 0, y: 0, opts: o }] }], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(found.map((c) => c.rule)).toEqual(rules(binChecks(o)));
    expect(found.every((c) => c.drawerId === 'd1' && c.binId === 'b1')).toBe(true);
  });
});

describe('walls, struts and fixed parts against the nozzle', () => {
  it('walls between pockets: weak under two lines, may not print under one', () => {
    const o = bin({ interior: 'pockets', pocketSpacing: 0.8 });
    expect(binChecks(o)).toEqual([]);
    const c = expectFixed(o, 'pocket-walls', null, { nozzle: 0.6 });
    expect(c.severity).toBe('info');
    expect(c.fix!.bin).toEqual({ pocketSpacing: 1.2 });
    expect(find(binChecks(o, null, { nozzle: 1 }), 'pocket-walls')?.severity).toBe('warn');
  });

  it('pocket compartments and pocket-grid lids', () => {
    const two = uniformLayout(2, 1);
    const key = binLayout(bin({ unitsX: 2, layout: two })).compartments[0].key;
    // A compartment on the bin's pocket settings: the bin's spacing fixes it.
    const shared = bin({ unitsX: 2, heightUnits: 4, pocketSpacing: 0.9, layout: setCompartmentOptions(two, key, { inside: 'pockets' }) });
    expect(binChecks(shared)).toEqual([]);
    expect(expectFixed(shared, 'pocket-walls', null, { nozzle: 0.6 }).fix!.bin).toEqual({ pocketSpacing: 1.2 });
    // Its own spacing is set in the compartment: no one-click fix here.
    const own = bin({ unitsX: 2, heightUnits: 4, layout: setCompartmentOptions(two, key, { inside: 'pockets', pockets: { pocketSpacing: 0.9 } }) });
    const c = find(binChecks(own, null, { nozzle: 0.6 }), 'pocket-walls');
    expect(c?.severity).toBe('info');
    expect(c?.fix).toBeUndefined();
    const lid = bin({ lid: true, lidStyle: 'pockets', lidPockets: { pocketSpacing: 0.9 } });
    expect(expectFixed(lid, 'pocket-walls', null, { nozzle: 0.6 }).fix!.bin).toEqual({ lidPockets: { pocketSpacing: 1.2 } });
  });

  it('hex pattern struts and big hex holes', () => {
    const o = bin({ heightUnits: 6, patternWalls: 'fblr', patternWeb: 1.2 });
    expect(binChecks(o, null, { nozzle: 0.6 })).toEqual([]);
    expectFixed(o, 'hex-struts', null, { nozzle: 0.8 });
    const big = expectFixed(bin({ heightUnits: 8, patternWalls: 'lr', patternSize: 16 }), 'hex-holes');
    expect(big.severity).toBe('info');
  });

  it('grid insert walls', () => {
    const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, crate: true, crateWall: 0.8 });
    expect(binChecks(o)).toEqual([]);
    expectFixed(o, 'crate-walls', null, { nozzle: 0.6 });
  });

  it('cup walls and divider ribs that only a big nozzle makes thin', () => {
    const cups = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, divX: 2, cups: true });
    expect(find(binChecks(cups, null, { nozzle: 0.6 }), 'thin-parts')?.message).toContain('cup walls');
    const plates = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, layout: removableSplit() });
    const checks = binChecks(plates, null, { nozzle: 0.6 });
    expect(find(checks, 'thin-parts')?.message).toContain('divider ribs');
    expect(find(checks, 'divider-fit')?.severity).toBe('info');
    expect(find(binChecks(bin({ unitsX: 2, unitsY: 2, heightUnits: 6, rails: 'x' }), null, { nozzle: 0.6 }), 'divider-fit')).toBeTruthy();
  });

  it('the sliding lid click', () => {
    const o = bin({ lip: false, slideLid: true });
    expect(binChecks(o)).toEqual([]);
    expect(find(binChecks(o, null, { nozzle: 0.6 }), 'lid-detent')?.severity).toBe('info');
  });
});

describe('overhangs, holes and tipping', () => {
  it('magnet + screw holes without printable tops', () => {
    const c = expectFixed(bin({ holes: 'both' }), 'hole-tops');
    expect(c.fix!.bin).toEqual({ holePrintable: true });
    expect(binChecks(bin({ holes: 'both', base: 'flat' }))).toEqual([]);
  });

  it('a label tab against a removable divider', () => {
    // Nothing behind it: the tab bridges side wall to side wall, which sags across a 2-unit compartment.
    const bridging = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, label: 'center', layout: removableSplit() });
    const c = expectFixed(bridging, 'tab-floating');
    expect(c.severity).toBe('info');
    expect(find(binChecks({ ...bridging, label: 'full' }), 'tab-floating')?.severity).toBe('info');
    // A short bridge is fine.
    expect(rules(binChecks({ ...bridging, unitsX: 1 }))).not.toContain('tab-floating');
    expect(binChecks({ ...bridging, layout: uniformLayout(1, 2) })).toEqual([]);
    // With a removable side wall too there is nothing to hold it, so the geometry leaves it off.
    let both = setWallProps(uniformLayout(2, 2), 'y1', { removable: true });
    both = setWallProps(both, 'x1', { removable: true });
    const lost = expectFixed(bin({ unitsX: 2, unitsY: 2, heightUnits: 6, label: 'center', layout: both }), 'tab-floating');
    expect(lost.severity).toBe('warn');
    expect(lost.message).toMatch(/2 label tabs .* are left off/);
  });

  it('…which is one piece in the mesh either way (no tab floats)', () => {
    const islands = (o: BinOptions) => {
      const m = buildBin(w, o);
      const solid = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
      const parts = solid.decompose();
      const n = parts.length;
      for (const p of parts) p.delete();
      solid.delete();
      return n;
    };
    const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 6, label: 'center', layout: removableSplit() });
    expect(islands(o)).toBe(1);
    expect(islands({ ...o, label: 'full' })).toBe(1);
  });

  it('compartments too narrow to reach into', () => {
    const o = bin({ divX: 3, divY: 3, heightUnits: 6 });
    const c = expectFixed(o, 'finger-room');
    expect(c.fix!.bin).toEqual({ divX: 2, divY: 2 });
    // Shallow ones tip out fine; cups lift out.
    expect(rules(binChecks({ ...o, heightUnits: 3 }))).not.toContain('finger-room');
    expect(rules(binChecks({ ...o, cups: true }))).not.toContain('finger-room');
    expect(find(binChecks(bin({ unitsX: 2, divX: 6, heightUnits: 6 })), 'finger-room')?.fix?.bin).toEqual({ divX: 5, divY: 1 });
  });

  it('tall bins on a small base', () => {
    expect(binChecks(bin({ heightUnits: 12 }))).toEqual([]);
    expect(find(binChecks(bin({ heightUnits: 16 })), 'tip-over')?.severity).toBe('info');
    expect(find(binChecks(bin({ heightUnits: 26 })), 'tip-over')?.severity).toBe('warn');
    // A bigger footprint stands.
    expect(binChecks(bin({ unitsX: 2, unitsY: 2, heightUnits: 26 }))).toEqual([]);
    // Containers too.
    expect(find(binChecks(bin({ heightUnits: 26, container: 'drawers' })), 'tip-over')).toBeTruthy();
  });

  it('a stretched body over the margin', () => {
    const at = (left: number): Partial<BinCells> => ({ x: [42], y: [42], stretch: { left, right: 0, front: 0, back: 0 } });
    expect(binChecks(DEFAULT_BIN, at(2))).toEqual([]);
    expect(find(binChecks(DEFAULT_BIN, at(5)), 'stretch-overhang')?.severity).toBe('info');
    expect(find(binChecks(DEFAULT_BIN, at(12)), 'stretch-overhang')?.severity).toBe('warn');
  });
});

describe('rounds standing in their pockets', () => {
  const ammo = (id: string, o: Partial<BinOptions> = {}) => bin({ unitsX: 2, unitsY: 2, interior: 'pockets', ...presetFields(findPocketPreset(id)!), ...o });
  const item = (o: BinOptions, opts?: CheckOptions) => find(binChecks(o, null, opts), 'item-height');

  it('stay quiet when the bin is tall enough, and for presets without a height', () => {
    expect(binChecks(ammo('ammo-9mm', { unitsX: 3, heightUnits: 6 }))).toEqual([]);
    expect(binChecks(ammo('ammo-308', { heightUnits: 12, lid: true }))).toEqual([]);
    // Under the rim but in the lip: fine until something sits on it.
    expect(item(ammo('ammo-9mm', { heightUnits: 5 }))).toBeUndefined();
    // AA batteries stick out by design.
    expect(item(ammo('aa', { heightUnits: 3 }))).toBeUndefined();
  });

  it('sticking out above the rim is a tip, with a fix that clears a lid or a stacked bin', () => {
    const c = expectFixed(ammo('ammo-9mm', { heightUnits: 3 }), 'item-height');
    expect(c).toMatchObject({ severity: 'info', part: 'Pockets', fix: { label: 'Make it 6u', bin: { heightMode: 'units', heightUnits: 6 } } });
    expect(c.message).toBe('Rounds stick out 11.69 mm above the rim: they stand 29.69 mm tall, their tips 36.69 mm above the bin’s bottom. 6u keeps them under a lid or a bin stacked on top.');
    // Given in mm, the fix switches to units.
    expect(item(ammo('ammo-9mm', { heightMode: 'internal', heightMm: 14 }))?.fix?.bin).toEqual({ heightMode: 'units', heightUnits: 6 });
    // Without a lip: under the walls.
    expect(expectFixed(ammo('ammo-9mm', { heightUnits: 3, lip: false }), 'item-height').fix?.label).toBe('Make it 6u');
    // Shotshells on a flat base.
    expect(expectFixed(ammo('ammo-12ga', { heightUnits: 4, base: 'flat' }), 'item-height').message).toMatch(/^Shells stick out/);
    // Pockets edited away from the preset keep the height, and the check.
    const edited = expectFixed(ammo('ammo-9mm', { heightUnits: 3, pocketPreset: 'custom', pocketSpacing: 2.5 }), 'item-height');
    expect(edited).toMatchObject({ severity: 'info', fix: { label: 'Make it 6u' } });
    expect(edited.message).toMatch(/^Items stick out 11\.69 mm above the rim/);
    // Turned off: no check.
    expect(item(ammo('ammo-9mm', { heightUnits: 3, pocketItemH: -1 }))).toBeUndefined();
  });

  it('holding up a lid or a stacked bin is a problem', () => {
    const lid = ammo('ammo-9mm', { heightUnits: 5, lid: true });
    const c = expectFixed(lid, 'item-height');
    expect(c).toMatchObject({ severity: 'warn', fix: { label: 'Make it 6u' } });
    expect(c.message).toMatch(/higher than the lid sits \(34\.65 mm\), so it won’t sit down\. 6u keeps them under a lid or a bin stacked on top\.$/);
    const stacked = item(ammo('ammo-9mm', { heightUnits: 5 }), { stacked: true });
    expect(stacked).toMatchObject({ severity: 'warn', fix: { label: 'Make it 6u' } });
    expect(stacked?.message).toMatch(/the bin stacked on it sits/);
    // A pocket compartment's rounds count too.
    const split = { unitsX: 3, unitsY: 2, heightUnits: 6, lid: true, layout: uniformLayout(2, 1) };
    const key = binLayout(bin(split)).compartments[0].key;
    const layout = setCompartmentOptions(split.layout, key, { inside: 'pockets', pockets: presetFields(findPocketPreset('ammo-308')!) });
    expect(expectFixed(bin({ ...split, layout }), 'item-height').fix?.label).toBe('Make it 12u');
  });

  it('raises the bin only as far as the printer and the drawer allow', () => {
    // .308 under a lid needs 12u (88 mm with the lip, 89.6 with the lid on); under the rim 11u.
    expect(item(ammo('ammo-308', { heightUnits: 6 }), { room: 100 })?.fix?.label).toBe('Make it 12u');
    const rim = item(ammo('ammo-308', { heightUnits: 6 }), { room: 85 });
    expect(rim?.fix?.label).toBe('Make it 11u');
    expect(rim?.message).toMatch(/11u keeps them under the rim\.$/);
    const lid = item(ammo('ammo-308', { heightUnits: 6, lid: true }), { room: 85 });
    expect(lid).toMatchObject({ severity: 'warn' });
    expect(lid?.fix).toBeUndefined();
    expect(lid?.message).toMatch(/At 12u the bin is too tall for the drawer\.$/);
    // A short printer.
    const bed = { w: 250, d: 250, h: 60 };
    const short = item(ammo('ammo-3006', { heightUnits: 6 }), { bed });
    expect(short?.fix).toBeUndefined();
    expect(short?.message).toMatch(/too tall for the printer\.$/);
    expect(item(ammo('ammo-9mm', { heightUnits: 3 }), { bed })?.fix?.label).toBe('Make it 6u');
  });

  it('taller than the drawer: the drawer won’t close, even on a pocket-grid lid', () => {
    const tall = item(ammo('ammo-12ga', { heightUnits: 6 }), { room: 60 });
    expect(tall).toMatchObject({ severity: 'warn', part: 'Pockets' });
    expect(tall?.fix).toBeUndefined();
    expect(tall?.message).toMatch(/more than the 60 mm of room above the bin, so the drawer won’t close\.$/);
    const onLid = bin({ unitsX: 2, heightUnits: 4, lid: true, lidStyle: 'pockets', lidPockets: presetFields(findPocketPreset('ammo-45acp')!) });
    expect(item(onLid)).toBeUndefined();
    expect(item(onLid, { room: 50 })).toMatchObject({ severity: 'warn', part: 'Pocket-grid lid' });
  });

  it('project checks know the drawer’s height and what is stacked', () => {
    const o = ammo('ammo-9mm', { heightUnits: 5 });
    const drawers = (height: number, on = false) => [
      {
        id: 'd1',
        name: 'D',
        drawer: { ...DEFAULT_DRAWER, height },
        baseplate: DEFAULT_BASEPLATE,
        bins: [{ id: 'b1', x: 0, y: 0, opts: o }, ...(on ? [{ id: 'b2', x: 0, y: 0, on: 'b1', opts: bin({ unitsX: 2, unitsY: 2 }) }] : [])],
      },
    ];
    const at = (height: number, on = false) => projectChecks(drawers(height, on), DEFAULT_SETUP, { baseplate: false, bins: true }).filter((c) => c.rule === 'item-height');
    expect(at(0)).toEqual([]);
    expect(at(0, true)).toMatchObject([{ severity: 'warn', binId: 'b1', fix: { label: 'Make it 6u' } }]);
    // 36.69 mm tips in 35 mm of room above the plate.
    expect(at(36)).toMatchObject([{ severity: 'warn', binId: 'b1' }]);
    // With a bin on it, raising it raises that bin too: no room for 6u under a 60 mm drawer.
    const stuck = at(60, true);
    expect(stuck[0]?.fix).toBeUndefined();
    expect(stuck[0]?.message).toMatch(/too tall for the drawer/);
  });
});

describe('containers', () => {
  const drawers = (o: Record<string, unknown>) => bin({ unitsX: 2, unitsY: 2, heightUnits: 6, container: 'drawers', containers: { drawers: o } });

  it('drawers without enough play', () => {
    const c = expectFixed(drawers({ clearance: 0.15 }), 'drawer-gap');
    expect(c.severity).toBe('warn');
    expect(binChecks(drawers({ clearance: 0.3 }))).toEqual([]);
    expect(rules(binChecks(drawers({ clearance: 0.3 }), null, { nozzle: 0.6 }))).toContain('drawer-gap');
  });

  it('thin drawer walls', () => {
    expect(binChecks(drawers({ drawerWall: 0.8 }))).toEqual([]);
    expectFixed(drawers({ drawerWall: 0.8 }), 'drawer-walls', null, { nozzle: 0.6 });
  });

  it('a wide coin slot', () => {
    const coin = (d: number) => bin({ unitsX: 2, unitsY: 2, heightUnits: 6, container: 'dispenser', containers: { dispenser: { item: 'custom', shape: 'coin', itemD: d, itemL: 3 } } });
    expect(binChecks(coin(20))).toEqual([]);
    expect(find(binChecks(coin(50)), 'coin-bridge')?.severity).toBe('info');
  });

  it('a parts box hinge with a big nozzle', () => {
    const box = bin({ container: 'box', heightUnits: 4 });
    expect(binChecks(box, null, { nozzle: 0.6 })).toEqual([]);
    expect(find(binChecks(box, null, { nozzle: 0.8 }), 'hinge-fit')).toBeTruthy();
  });
});

describe('baseplates and the printer', () => {
  it('an untrimmed ridge', () => {
    const c = find(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, topTrim: 0.1 }), 'ridge-trim');
    expect(c?.fix?.baseplate).toEqual({ topTrim: 0.4 });
    expect(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, ...c!.fix!.baseplate })).toEqual([]);
  });

  it('snug joints with a big nozzle', () => {
    expect(find(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, connector: 'puzzle' }, { nozzle: 0.6 }), 'joint-fit')?.message).toMatch(/^Puzzle tabs/);
    expect(find(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, connector: 'bowtie' }, { nozzle: 0.6 }), 'joint-fit')).toBeTruthy();
    expect(find(drawerChecks({ ...DEFAULT_DRAWER, fill: 'spacers' }, DEFAULT_BASEPLATE, { nozzle: 0.6 }), 'joint-fit')?.message).toMatch(/^Spacer dovetails/);
    expect(drawerChecks(DEFAULT_DRAWER, { ...DEFAULT_BASEPLATE, connector: 'pin' }, { nozzle: 0.6 })).toEqual([]);
  });

  it('a big nozzle on bin walls, and a Bambu project set up for 0.4', () => {
    const s = { ...DEFAULT_SETUP, nozzle: 0.6 };
    expect(rules(setupChecks(s, { bins: true }))).toEqual(['nozzle-walls', 'bambu-nozzle']);
    expect(rules(setupChecks(s, { bins: false }))).toEqual(['bambu-nozzle']);
    expect(setupChecks({ ...s, printerId: 'prusa-mk4s' }, { bins: false })).toEqual([]);
    expect(setupChecks({ ...DEFAULT_SETUP, nozzle: 0.2 }, { bins: true }).map((c) => c.rule)).toEqual(['bambu-nozzle']);
  });

  it('project checks follow what is printed', () => {
    const drawers = [
      { id: 'd1', name: 'One', drawer: DEFAULT_DRAWER, baseplate: { ...DEFAULT_BASEPLATE, topTrim: 0 }, bins: [{ id: 'b1', x: 0, y: 0, opts: bin({ holes: 'both' }) }] },
    ];
    const both = projectChecks(drawers, DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(both.map((c) => [c.rule, c.drawerId, c.binId])).toEqual([
      ['ridge-trim', 'd1', undefined],
      ['hole-tops', 'd1', 'b1'],
    ]);
    expect(rules(projectChecks(drawers, DEFAULT_SETUP, { baseplate: false, bins: true }))).toEqual(['hole-tops']);
    expect(rules(projectChecks(drawers, DEFAULT_SETUP, { baseplate: true, bins: false }))).toEqual(['ridge-trim']);
    expect(worstSeverity(both)).toBe('info');
    expect(worstSeverity([])).toBeNull();
  });

  it('a full drawer of labelled bins checks quickly', () => {
    const bins = Array.from({ length: 96 }, (_, i) => ({
      id: `b${i}`,
      x: i % 12,
      y: Math.floor(i / 12),
      opts: bin({ divX: 1 + (i % 3), divY: 1 + (i % 2), label: 'full', labelText: `M${i % 8} x ${i}` }),
    }));
    const t = performance.now();
    projectChecks([{ id: 'd1', name: 'D', drawer: DEFAULT_DRAWER, baseplate: DEFAULT_BASEPLATE, bins }], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('the nozzle setting', () => {
  it('loads from old projects, keeps offered sizes, drops anything else', () => {
    expect(cleanSetup({ printerId: 'p2s' }).nozzle).toBeUndefined();
    expect(cleanSetup({ nozzle: 0.6 }).nozzle).toBe(0.6);
    expect(cleanSetup({ nozzle: 0.8 }).nozzle).toBe(0.8);
    expect(cleanSetup({ nozzle: 0.4 })).not.toHaveProperty('nozzle');
    for (const bad of [0.55, -1, 0, '0.6', null, NaN]) expect(cleanSetup({ nozzle: bad as unknown as number })).not.toHaveProperty('nozzle');
  });
});
