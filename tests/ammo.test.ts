import { describe, expect, it } from 'vitest';
import { DEFAULT_BIN, binLayout, binTotalHeight, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { AMMO, CARTRIDGES, POCKET_PRESETS, findCartridge, findPocketPreset, itemNoun, presetFields } from '../src/lib/geometry/pocketPresets';
import { binBodyHeight, binFloorZ } from '../src/lib/geometry/variants';
import { LID_SEAT_DROP, lidStackHeight } from '../src/lib/geometry/lid';
import { setCompartmentOptions, uniformLayout } from '../src/lib/dividers';
import {
  freshTop,
  presetItemH,
  standingBinHeight,
  standingGrids,
  standingNote,
  standingNoteFor,
  tipLimits,
  unitsToCover,
  unitsUnderRim,
} from '../src/lib/geometry/itemHeight';

const AMMO_PRESETS = POCKET_PRESETS.filter((p) => p.group === 'Ammunition');
const bin = (o: Partial<BinOptions> = {}) => sanitizeBin({ ...DEFAULT_BIN, ...o } as BinOptions);
const pockets = (id: string, o: Partial<BinOptions> = {}) => bin({ interior: 'pockets', ...presetFields(findPocketPreset(id)!), ...o });
const fmt = (v: number) => `${Math.round(v * 100) / 100} mm`;

describe('cartridge presets', () => {
  it('cover the common US cartridges, rimfire to shotshells, in one group', () => {
    const labels = AMMO_PRESETS.map((p) => p.label);
    for (const want of [
      '.22 LR',
      '.22 WMR / .17 HMR',
      '5.7×28',
      '.380 ACP',
      '9mm Luger (9×19)',
      '.38 Special',
      '.357 Magnum',
      '.40 S&W',
      '10mm Auto',
      '.45 ACP',
      '.44 Magnum',
      '.223 Rem / 5.56 NATO',
      '.300 AAC Blackout',
      '7.62×39',
      '5.45×39',
      '6.5 Grendel',
      '.308 Win / 7.62 NATO',
      '6.5 Creedmoor',
      '.243 Win',
      '.270 Win',
      '.30-06 Springfield',
      '.30-30 Win',
      '7.62×54R',
      '12 ga 2¾″',
      '12 ga 3″',
      '20 ga 2¾″',
      '.410 2½″',
    ])
      expect(labels, want).toContain(want);
    expect(AMMO_PRESETS).toHaveLength(CARTRIDGES.length);
    // Rimfire, pistol, rifle, shotshells.
    const kinds = AMMO_PRESETS.map((p) => findCartridge(p.id)!.kind);
    expect([...new Set(kinds)]).toEqual(['rimfire', 'pistol', 'rifle', 'shotgun']);
    expect(kinds).toEqual([...kinds].sort((a, b) => ['rimfire', 'pistol', 'rifle', 'shotgun'].indexOf(a) - ['rimfire', 'pistol', 'rifle', 'shotgun'].indexOf(b)));
  });

  it('are the SAAMI / C.I.P. maximums, spot-checked', () => {
    const c = (id: string) => findCartridge(`ammo-${id}`)!;
    expect(c('9mm')).toMatchObject({ rim: 9.96, caseL: 19.15, oal: 29.69 });
    expect(c('22lr')).toMatchObject({ rim: 7.06, caseL: 15.57, oal: 25.4 });
    expect(c('223')).toMatchObject({ rim: 9.6, caseL: 44.7, oal: 57.4 });
    expect(c('300blk')).toMatchObject({ rim: 9.6, caseL: 34.75, oal: 57.4 });
    expect(c('308')).toMatchObject({ rim: 12.01, caseL: 51.18, oal: 71.37 });
    expect(c('762x39')).toMatchObject({ rim: 11.35, oal: 56 });
    expect(c('762x54r')).toMatchObject({ rim: 14.48, oal: 77.16 });
    expect(c('3006')).toMatchObject({ caseL: 63.35, oal: 84.84 });
    expect(c('12ga')).toMatchObject({ rim: 22.5, oal: 69.85 });
    expect(c('410')).toMatchObject({ rim: 13.59, oal: 63.5 });
  });

  it('size each pocket from the rim (or a wider case) plus clearance, half the case deep, as tall as the round', () => {
    for (const p of AMMO_PRESETS) {
      const c = findCartridge(p.id)!;
      const head = Math.max(c.rim, c.base ?? 0);
      const clearance = c.kind === 'shotgun' ? AMMO.shellClearance : AMMO.clearance;
      expect(p.shape, p.id).toBe('round');
      // Rounded up to 0.05 mm.
      expect(p.w - head, p.id).toBeGreaterThanOrEqual(clearance - 1e-9);
      expect(p.w - head, p.id).toBeLessThan(clearance + 0.05);
      expect(p.depth, p.id).toBeGreaterThanOrEqual(AMMO.minDepth);
      expect(p.depth, p.id).toBeLessThanOrEqual(AMMO.maxDepth);
      if (c.caseL / 2 > AMMO.minDepth && c.caseL / 2 < AMMO.maxDepth) expect(Math.abs(p.depth - c.caseL / 2), p.id).toBeLessThanOrEqual(0.25);
      // Walls at least four lines of a 0.4 mm nozzle, and a chamfer to drop the rounds in.
      expect(p.spacing, p.id).toBeGreaterThanOrEqual(1.6);
      expect(p.chamfer, p.id).toBeGreaterThan(0);
      expect(p.itemH, p.id).toBe(c.oal);
      expect(p.itemH!, p.id).toBeGreaterThan(p.depth);
      expect(c.caseL, p.id).toBeLessThanOrEqual(c.oal);
      expect(itemNoun(p)).toBe(c.kind === 'shotgun' ? 'shells' : 'rounds');
    }
    expect(findPocketPreset('ammo-9mm')).toMatchObject({ w: 10.5, depth: 9.5, spacing: 1.6, chamfer: 0.8, itemH: 29.69 });
    expect(findPocketPreset('ammo-22lr')).toMatchObject({ w: 7.6, depth: 8, itemH: 25.4 });
    expect(findPocketPreset('ammo-308')).toMatchObject({ w: 12.55, depth: 25.5, spacing: 2, itemH: 71.37 });
    expect(findPocketPreset('ammo-12ga')).toMatchObject({ w: 23.3, depth: 30, itemH: 69.85 });
    expect(itemNoun(findPocketPreset('aa')!)).toBe('items');
  });

  it('are found by the names people type', () => {
    const named = (alias: string) => AMMO_PRESETS.filter((p) => p.aliases?.includes(alias)).map((p) => p.id);
    expect(named('556')).toEqual(['ammo-223']);
    expect(named('5.56')).toEqual(['ammo-223']);
    expect(named('223')).toEqual(['ammo-223']);
    expect(named('308')).toEqual(['ammo-308']);
    expect(named('7.62x51')).toEqual(['ammo-308']);
    expect(named('300blk')).toEqual(['ammo-300blk']);
    expect(named('blackout')).toEqual(['ammo-300blk']);
    expect(named('9mm')).toEqual(['ammo-9mm']);
    expect(named('9x19')).toEqual(['ammo-9mm']);
    expect(named('12ga')).toEqual(['ammo-12ga', 'ammo-12ga-3', 'ammo-12ga-35']);
    expect(named('12 gauge')).toEqual(['ammo-12ga', 'ammo-12ga-3', 'ammo-12ga-35']);
    for (const p of AMMO_PRESETS) {
      expect(p.aliases, p.id).toContain('ammo');
      expect(new Set(p.aliases).size, p.id).toBe(p.aliases!.length);
      for (const a of p.aliases!) expect(a, p.id).toBe(a.toLowerCase());
    }
    // Other presets have no item height.
    for (const p of POCKET_PRESETS.filter((x) => x.group !== 'Ammunition')) expect(p.itemH, p.id).toBeUndefined();
  });
});

describe('how tall the bin has to be', () => {
  it('a lid or a stacked bin sits just under the top of the walls; the rim is the top of the lip', () => {
    const o = bin({ heightUnits: 6 });
    expect(tipLimits(o)).toEqual({ seat: 42 - LID_SEAT_DROP, rim: binTotalHeight(o) });
    expect(tipLimits(bin({ heightUnits: 6, lip: false }))).toEqual({ seat: null, rim: 42 });
    expect(LID_SEAT_DROP).toBeCloseTo(0.35, 6);
  });

  it('counts units from the floor up: 9mm needs 6u for a lid, 5u for the rim', () => {
    const top = freshTop(DEFAULT_BIN, 29.69);
    expect(top).toBeCloseTo(36.69, 6);
    expect(unitsToCover(top, true)).toBe(6);
    expect(unitsUnderRim(top, true)).toBe(5);
    expect(unitsUnderRim(top, false)).toBe(6);
    // A flat base puts the rounds 5.8 mm lower.
    expect(freshTop({ base: 'flat' }, 29.69)).toBeCloseTo(30.89, 6);
    // Never under the lowest bin.
    expect(unitsToCover(5, true)).toBe(2);
    // Exactly at the seat is under it.
    expect(unitsToCover(42 - LID_SEAT_DROP, true)).toBe(6);
  });

  it('finds the tips of each grid whose preset has a height: the bin’s, a compartment’s, a pocket-grid lid’s', () => {
    const own = standingGrids(pockets('ammo-9mm', { unitsX: 2, unitsY: 2 }));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ where: 'bin', itemH: 29.69 });
    expect(own[0].top).toBeCloseTo(binFloorZ(DEFAULT_BIN) + 29.69, 6);
    // Magnets under the pockets lift the rounds.
    const lifted = standingGrids(pockets('ammo-9mm', { unitsX: 2, unitsY: 2, heightUnits: 6, pocketMagnet: true, pocketMagnetD: 6 }))[0];
    expect(lifted.top).toBeGreaterThan(own[0].top + 1);
    // Other presets, and grids that hold nothing, have none.
    expect(standingGrids(pockets('aa', { unitsX: 2, unitsY: 2 }))).toEqual([]);
    expect(standingGrids(pockets('ammo-12ga', { pocketW: 60 }))).toEqual([]);
    expect(standingGrids(bin({ ...presetFields(findPocketPreset('ammo-308')!) }))).toEqual([]);
    // A pocket compartment with its own preset.
    const split = { unitsX: 3, unitsY: 2, heightUnits: 6, layout: uniformLayout(2, 1) };
    const key = binLayout(bin(split)).compartments[0].key;
    const layout = setCompartmentOptions(split.layout, key, { inside: 'pockets', pockets: { ...presetFields(findPocketPreset('ammo-308')!) } });
    const comp = standingGrids(bin({ ...split, layout }));
    expect(comp).toHaveLength(1);
    expect(comp[0]).toMatchObject({ where: 'compartment', key, itemH: 71.37 });
    expect(comp[0].top).toBeCloseTo(binFloorZ(DEFAULT_BIN) + 71.37, 6);
    // On a pocket-grid lid they stand on the closed bin.
    const lid = standingGrids(bin({ unitsX: 2, heightUnits: 4, lid: true, lidStyle: 'pockets', lidPockets: presetFields(findPocketPreset('ammo-45acp')!) }));
    expect(lid).toHaveLength(1);
    expect(lid[0].where).toBe('lid');
    expect(lid[0].top).toBeGreaterThan(binBodyHeight(bin({ heightUnits: 4 })) + 32.39);
    expect(lid[0].top).toBeLessThan(lidStackHeight(bin({ heightUnits: 4, lid: true, lidStyle: 'pockets', lidPockets: presetFields(findPocketPreset('ammo-45acp')!) })) + 32.39);
    expect(presetItemH('ammo-45acp')).toBe(32.39);
    expect(presetItemH('aa')).toBe(0);
    expect(presetItemH('custom')).toBe(0);
  });

  it('the note says how tall they stand and which height keeps them under a lid and under the rim', () => {
    const note = (o: BinOptions) => standingNote(standingGrids(o)[0], o, fmt);
    expect(note(pockets('ammo-9mm', { unitsX: 2, heightUnits: 3 }))).toBe(
      'Rounds stand 29.69 mm tall, their tips 36.69 mm above the bin’s bottom, 11.69 mm above the rim. Make the bin 5u to keep them under it, or 6u for a lid or a bin stacked on top.',
    );
    expect(note(pockets('ammo-9mm', { unitsX: 2, heightUnits: 5 }))).toBe(
      'Rounds stand 29.69 mm tall, their tips 36.69 mm above the bin’s bottom: under the rim; a lid or a bin stacked on top needs 6u.',
    );
    expect(note(pockets('ammo-9mm', { unitsX: 2, heightUnits: 6 }))).toBe('Rounds stand 29.69 mm tall, their tips 36.69 mm above the bin’s bottom: under a lid or a bin stacked on top.');
    expect(note(pockets('ammo-9mm', { unitsX: 2, heightUnits: 3, lip: false }))).toBe(
      'Rounds stand 29.69 mm tall, their tips 36.69 mm above the bin’s bottom, 15.69 mm above the rim. Make the bin 6u to keep them under it.',
    );
    expect(note(pockets('ammo-12ga', { unitsX: 2, unitsY: 2, heightUnits: 6, base: 'flat' }))).toMatch(/^Shells stand 69\.85 mm tall, their tips 71\.05 mm/);
    const lid = bin({ unitsX: 2, heightUnits: 4, lid: true, lidStyle: 'pockets', lidPockets: presetFields(findPocketPreset('ammo-45acp')!) });
    expect(standingNoteFor(lid, null, 'lid', undefined, fmt)).toMatch(/^Rounds stand 32\.39 mm tall: on the closed bin they reach \d/);
    expect(standingNoteFor(lid, null, 'bin', undefined, fmt)).toBeUndefined();
    // With the lid on, a bin stands taller.
    expect(standingBinHeight(lid)).toBeGreaterThan(binTotalHeight(lid));
    expect(standingBinHeight(lid, { stretch: { left: 5, right: 0, front: 0, back: 0 } })).toBe(binTotalHeight(lid));
  });
});
