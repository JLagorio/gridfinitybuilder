import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, cleanSetup, type PrintSetup } from '../src/lib/layout/plan';
import { buildMesh, planJob, planPrint, DEFAULT_PROJECT, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { registerFont } from '../src/lib/geometry/text';
import {
  LAYERS,
  MAX_SLOTS,
  bandKey,
  layerTop,
  paletteOf,
  partRoleSlot,
  roleSlot,
  slotPrice,
  snapZ,
  tidyBands,
  type ColourSetup,
} from '../src/lib/colours';
import { partProfile } from '../src/lib/colourPlan';
import { FILAMENT_VARIANT_KEYS, exportBambuProject, withFilaments } from '../src/lib/export/bambu';
import { exportPlate3MF } from '../src/lib/export/threemf';
import { exportPlatesStlZip } from '../src/lib/export/stl';
import { estimateJob, estimatePlate, sliceStats, type MeshPrintStats } from '../src/lib/estimate';
import { billOfMaterials } from '../src/lib/bom';
import { colourChecks } from '../src/lib/colourChecks';
import { searchIndex } from '../src/lib/panelSearch';
import { BIN_INDEX, DRAWER_INDEX, PRINT_INDEX } from '../src/components/panelIndex';
import { decodeProject, encodeProject } from '../src/lib/share';
import { history, projectFile, useStore } from '../src/state/store';
import { applyColourPreset } from '../src/state/colours';
import { fingerprint } from '../src/lib/printed';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const PALETTE = [
  { colour: '#161616', name: 'Black' },
  { colour: '#F2F2F2', name: 'White' },
  { colour: '#C12E1F', name: 'Red' },
  { colour: '#0A2989', name: 'Blue' },
];
const withColours = (c: ColourSetup, more: Partial<PrintSetup> = {}): PrintSetup => ({ ...DEFAULT_SETUP, filaments: PALETTE, colours: { on: true, ...c }, ...more });
const bin = (id: string, o: Partial<BinOptions> = {}, x = 0, y = 0): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, ...o } });
const drawer = (bins: PlacedBin[], gridX = 6, gridY = 3, id = 'd'): NamedDrawer => ({
  id,
  name: id,
  drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY },
  baseplate: DEFAULT_BASEPLATE,
  bins,
});
const slotsOnPlate = (job: PrintJob, setup: PrintSetup, i: number) =>
  new Set(job.plates[i].placements.map((p) => partRoleSlot(setup, job.parts[p.key].role!, job.parts[p.key].colour)));

function meshes(job: PrintJob) {
  const cache = new Map<string, MeshData>();
  return (k: string) => cache.get(k) ?? cache.set(k, buildMesh(w, job.meshes[k])).get(k)!;
}

// ---------------------------------------------------------------------------

describe('the palette, and setups saved before it', () => {
  beforeEach(() => useStore.getState().resetAll());

  it('moves the old label filament (labelColour, filamentPrice2) into slot 2', () => {
    const s = cleanSetup({ labelColour: '#ff8800', filamentPrice2: 31 });
    expect('labelColour' in s).toBe(false);
    expect('filamentPrice2' in s).toBe(false);
    expect(s.filaments?.[1]).toEqual({ colour: '#FF8800', name: 'Black', price: 31 });
    expect(slotPrice(s, 2)).toBe(31);
    expect(slotPrice(s, 1)).toBe(20);
    expect(s.colours).toBeUndefined();
    // A setup that never had a label filament stays as it was.
    expect('filaments' in cleanSetup({})).toBe(false);
  });

  it('old project files and share links open unchanged, and export the label filament as before', () => {
    const old = { app: 'gridfit', setup: { ...DEFAULT_SETUP, labelColour: '#00ff00' }, bins: [bin('a', { label: 'full', labelText: 'M3', labelStyle: 'inlaid' })] };
    useStore.getState().loadProject(decodeProject(encodeProject(old)));
    const st = useStore.getState();
    expect(st.setup.filaments?.[1].colour).toBe('#00FF00');
    expect(st.setup.colours).toBeUndefined();
    // Saved again and reopened: the same.
    const again = JSON.parse(JSON.stringify(projectFile(st)));
    useStore.getState().loadProject(again);
    expect(useStore.getState().setup).toEqual(st.setup);
    // The Bambu project: filament 1 the preset's, filament 2 the old label colour.
    const job = planJob({ ...DEFAULT_PROJECT, setup: st.setup, include: { baseplate: false, bins: true }, bins: st.bins });
    const settings = JSON.stringify({ filament_diameter: ['1.75'], filament_colour: ['#00AE42'], filament_settings_id: ['PLA'] });
    const files = unzipSync(exportBambuProject(job, st.setup, meshes(job), settings));
    expect(JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour).toEqual(['#00AE42', '#00FF00']);
    expect(files['Metadata/custom_gcode_per_layer.xml']).toBeUndefined();
    expect(job.colours).toBeUndefined();
  });

  it('cleans what it keeps: hex colours, known roles and slots, up to 16 slots', () => {
    const s = cleanSetup({
      filaments: Array.from({ length: 20 }, () => ({ colour: 'red' })) as never,
      colours: { on: true, strategy: 'nope', roles: { plate: 3, binWalls: 99, bogus: 1 }, mix: 'yes' } as never,
      filamentSlots: 0,
    });
    expect(s.filaments).toHaveLength(MAX_SLOTS);
    expect(s.filaments![0].colour).toMatch(/^#[0-9A-F]{6}$/);
    expect(s.colours).toEqual({ on: true, roles: { plate: 3 } });
    expect('filamentSlots' in s).toBe(false);
  });

  it('roles follow their group until set: the Basic view sets three', () => {
    const s = withColours({ roles: { plate: 3, binWalls: 4, labelText: 1 } });
    expect(roleSlot(s, 'plateAccent')).toBe(3);
    expect(roleSlot(s, 'caseHandle')).toBe(3);
    expect(roleSlot(s, 'binLip')).toBe(4);
    expect(roleSlot(s, 'containerPull')).toBe(4);
    expect(roleSlot(s, 'shadow')).toBe(1);
    // A bin's own colour is its body's, not its label text's; a drawer's is its plate's.
    expect(partRoleSlot(s, 'binLip', { bin: 2 })).toBe(2);
    expect(partRoleSlot(s, 'labelText', { bin: 2 })).toBe(1);
    expect(partRoleSlot(s, 'plate', { bin: 2, plate: 1 })).toBe(1);
    // Defaults: everything slot 1, label text slot 2.
    expect(roleSlot(DEFAULT_SETUP, 'binWalls')).toBe(1);
    expect(roleSlot(DEFAULT_SETUP, 'labelText')).toBe(2);
    expect(paletteOf(DEFAULT_SETUP, 8)).toHaveLength(8);
  });

  it('colours never change a mesh, nor what counts as printed', () => {
    const plain = planPrint([drawer([bin('a')])], DEFAULT_SETUP, { baseplate: true, bins: true });
    const red = planPrint(
      [{ ...drawer([bin('a', { colour: 3 })]), baseplate: { ...DEFAULT_BASEPLATE, colour: 3 } }],
      withColours({ roles: { plate: 2 } }),
      { baseplate: true, bins: true },
    );
    expect(Object.keys(red.meshes).sort()).toEqual(Object.keys(plain.meshes).sort());
    const feature = planPrint([drawer([bin('a')])], withColours({ strategy: 'feature' }), { baseplate: false, bins: true });
    expect(fingerprint(feature.parts['bin:a'].meshKey)).toBe(fingerprint(plain.parts['bin:a'].meshKey));
  });
});

describe('layers', () => {
  it('snaps change heights to layer boundaries and starts the new colour on the next layer', () => {
    expect(snapZ(4.75)).toBe(4.8);
    expect(snapZ(7)).toBe(7);
    expect(snapZ(18.15)).toBe(18.2);
    expect(snapZ(0.05)).toBe(0);
    expect(layerTop(4.8)).toBe(5);
    expect(layerTop(0)).toBe(LAYERS.first);
    expect(tidyBands([{ z: 0, slot: 1 }, { z: 4.8, slot: 1 }, { z: 7, slot: 2 }, { z: 30, slot: 3 }], 25)).toEqual([
      { z: 0, slot: 1 },
      { z: 7, slot: 2 },
    ]);
    expect(bandKey([{ z: 0, slot: 1 }])).toBe('1');
    expect(bandKey([{ z: 0, slot: 1 }, { z: 7, slot: 2 }])).toBe('1@0|2@7');
  });
});

// ---------------------------------------------------------------------------

describe('plates by colour', () => {
  const bins = [bin('a', {}, 0, 0), bin('b', { colour: 3 }, 1, 0), bin('c', {}, 2, 0), bin('d', { colour: 3 }, 3, 0)];

  it('by part: each colour on plates of its own, unless mixing is allowed', () => {
    const s = withColours({ strategy: 'part' });
    const job = planPrint([drawer(bins)], s, { baseplate: false, bins: true });
    expect(job.plates).toHaveLength(2);
    for (let i = 0; i < job.plates.length; i++) expect(slotsOnPlate(job, s, i).size).toBe(1);
    expect(job.plates.map((p) => p.name)).toEqual(['Bins 1 · Black', 'Bins 2 · Red']);
    const mixed = planPrint([drawer(bins)], withColours({ strategy: 'part', mix: true }), { baseplate: false, bins: true });
    expect(mixed.plates).toHaveLength(1);
    expect(mixed.plates[0].name).toBe('Bins 1');
  });

  it('by part: connector keys in another colour than the pieces get plates of their own', () => {
    const big = { ...drawer([], 9, 9), baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' as const } };
    const same = planPrint([big], withColours({ strategy: 'part' }), { baseplate: true, bins: false });
    const apart = planPrint([big], withColours({ strategy: 'part', roles: { plateAccent: 2 } }), { baseplate: true, bins: false });
    const keyPlates = (j: PrintJob) => j.plates.filter((p) => p.placements.some((x) => j.parts[x.key].kind === 'key'));
    expect(keyPlates(same).every((p) => p.placements.some((x) => same.parts[x.key].kind === 'piece'))).toBe(true);
    expect(keyPlates(apart).every((p) => p.placements.every((x) => apart.parts[x.key].kind === 'key'))).toBe(true);
  });

  it('by height: plates group parts that share their change heights; short parts join where they fit', () => {
    const s = withColours({ strategy: 'height', roles: { binFeet: 3, binLip: 2 } });
    const job = planPrint([drawer([bin('a', { heightUnits: 3 }), bin('b', { heightUnits: 6 }, 1), bin('c', { heightUnits: 3 }, 2)])], s, { baseplate: false, bins: true });
    expect(job.plates).toHaveLength(2);
    const prof = (k: string) => partProfile(s, job.parts[k], job.meshes[job.parts[k].meshKey]);
    expect(prof('bin:a')).toEqual([{ z: 0, slot: 3 }, { z: 4.8, slot: 1 }, { z: 18.2, slot: 2 }]);
    expect(prof('bin:b')).toEqual([{ z: 0, slot: 3 }, { z: 4.8, slot: 1 }, { z: 39.2, slot: 2 }]);
    for (const pl of job.plates) expect(new Set(pl.placements.map((p) => bandKey(prof(p.key)))).size).toBe(1);
  });

  it('by feature: bins use their split meshes; one plate for every colour', () => {
    const s = withColours({ strategy: 'feature', roles: { binLip: 2 } });
    const job = planPrint([drawer(bins)], s, { baseplate: false, bins: true });
    expect(job.plates).toHaveLength(1);
    for (const k of ['bin:a', 'bin:b']) expect(job.meshes[job.parts[k].meshKey].kind).toBe('split');
    expect(job.colours?.colours?.strategy).toBe('feature');
  });

  it('tags each part with its role and its own colour', () => {
    const job = planPrint(
      [{ ...drawer([bin('a', { colour: 4 }), bin('b', {}, 1)]), baseplate: { ...DEFAULT_BASEPLATE, colour: 2 } }],
      withColours({}),
      { baseplate: true, bins: true },
    );
    expect(job.parts['bin:a']).toMatchObject({ role: 'binWalls', colour: { bin: 4, plate: 2 } });
    expect(job.parts['bin:b']).toMatchObject({ role: 'binWalls', colour: { plate: 2 } });
    const piece = Object.values(job.parts).find((p) => p.kind === 'piece')!;
    expect(piece.role).toBe('plate');
  });

  it('multi-colour off plans as before', () => {
    const job = planPrint([drawer(bins)], DEFAULT_SETUP, { baseplate: false, bins: true });
    expect(job.plates.map((p) => p.name)).toEqual(['Bins 1']);
    expect(job.colours).toBeUndefined();
    expect(Object.values(job.meshes).some((m) => m.kind === 'split')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Bambu project settings for several filaments', () => {
  for (const printer of ['p2s', 'x1c', 'a1', 'h2d']) {
    it(`${printer}: every per-filament list grows to the filament count, variant lists by filament`, () => {
      const json = readFileSync(`public/bambu/${printer}.json`, 'utf8');
      const before = JSON.parse(json) as Record<string, string[]>;
      const variants = before.filament_extruder_variant.length;
      const n = 5;
      const cfg = JSON.parse(withFilaments(json, n, ['#111111', '#222222', '#333333', '#444444'], '#000000')) as Record<string, string[]>;
      expect(cfg.filament_diameter).toHaveLength(n);
      expect(cfg.filament_colour).toEqual(['#000000', '#111111', '#222222', '#333333', '#444444']);
      expect(cfg.filament_settings_id).toHaveLength(n);
      // Bambu Studio refuses fewer variant entries than filaments, and reads them by filament_self_index.
      expect(cfg.filament_extruder_variant).toHaveLength(n * variants);
      expect(cfg.filament_self_index).toEqual(Array.from({ length: n * variants }, (_, i) => String(Math.floor(i / variants) + 1)));
      for (const k of FILAMENT_VARIANT_KEYS) {
        if (!Array.isArray(before[k])) continue;
        expect(cfg[k], k).toHaveLength(n * variants);
        // Each new filament is a copy of filament 1's block.
        expect(cfg[k].slice(variants, 2 * variants), k).toEqual(before[k].slice(0, variants));
      }
      const nozzles = before.flush_multiplier.length;
      expect(cfg.flush_volumes_matrix).toHaveLength(n * n * nozzles);
      expect(cfg.flush_volumes_vector).toHaveLength(2 * n);
      expect(cfg.different_settings_to_system).toHaveLength(n + 2);
      // Per-extruder lists stay as they are.
      expect(cfg.nozzle_diameter).toEqual(before.nozzle_diameter);
      expect(cfg.extruder_colour).toEqual(before.extruder_colour);
    });
  }
});

describe('exports by strategy', () => {
  it('by height: Bambu per-layer filament changes, every object in the first band, PrusaSlicer colour changes', () => {
    const s = withColours({ strategy: 'height', roles: { binFeet: 3, binLip: 2 } });
    const job = planPrint([drawer([bin('a'), bin('b', {}, 1)], 2, 1)], s, { baseplate: false, bins: true });
    const get = meshes(job);
    const settings = readFileSync('public/bambu/p2s.json', 'utf8');
    const files = unzipSync(exportBambuProject(job, s, get, settings));
    const xml = strFromU8(files['Metadata/custom_gcode_per_layer.xml']);
    expect(xml).toContain('<custom_gcodes_per_layer>');
    expect(xml).toContain('<plate_info id="1"/>');
    // The new colour from the layer above each change: feet red to 4.8, black walls, white lip from 18.2.
    expect(xml).toContain('<layer top_z="5" type="2" extruder="1" color="#161616" extra="" gcode="tool_change"/>');
    expect(xml).toContain('<layer top_z="18.4" type="2" extruder="2" color="#F2F2F2" extra="" gcode="tool_change"/>');
    expect(xml).toContain('<mode value="MultiAsSingle"/>');
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(new Set([...cfg.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1]))).toEqual(new Set(['3']));
    // Plain 3MF: PrusaSlicer's colour changes (M600) at the same layers.
    const plain = unzipSync(exportPlate3MF(job, 0, get));
    const ps = strFromU8(plain['Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml']);
    expect(ps).toContain('<code print_z="5" type="0" extruder="1" color="#161616" extra="" gcode="M600"/>');
    expect(ps).toContain('<mode value="SingleExtruder"/>');
    // A printer without an AMS: pauses to swap by hand.
    const p1p = { ...s, printerId: 'p1p' };
    const paused = strFromU8(unzipSync(exportBambuProject(job, p1p, get, settings))['Metadata/custom_gcode_per_layer.xml']);
    expect(paused).toContain('type="1"');
    expect(paused).toContain('<mode value="SingleExtruder"/>');
    expect(paused).toContain('extra="Load Black (slot 1)"');
  });

  it('by part: each part in its colour, label text in the label colour; STL zip: a file per slot', () => {
    const s = withColours({ strategy: 'part', mix: true });
    const job = planPrint([drawer([bin('a', { label: 'full', labelText: 'AB', labelStyle: 'inlaid' }), bin('b', { colour: 3 }, 1)], 2, 1)], s, { baseplate: false, bins: true });
    const get = meshes(job);
    const files = unzipSync(exportBambuProject(job, s, get, readFileSync('public/bambu/x1c.json', 'utf8')));
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    const objects = cfg.split('<object id=').slice(1);
    const own = objects.map((o) => /key="extruder" value="(\d+)"/.exec(o)![1]);
    expect(own.sort()).toEqual(['1', '3']);
    expect(cfg).toContain('<metadata key="extruder" value="2"/>');
    const zip = unzipSync(exportPlatesStlZip(job, get));
    const names = Object.keys(zip).filter((n) => n.endsWith('.stl')).sort();
    expect(names).toEqual(['01-bins-1.slot1-black.stl', '01-bins-1.slot2-white.stl', '01-bins-1.slot3-red.stl']);
    expect(strFromU8(zip['README.txt'])).toContain('one STL per filament slot');
  });
});

// ---------------------------------------------------------------------------

describe('estimates by strategy', () => {
  let a: MeshPrintStats;
  let b: MeshPrintStats;
  beforeAll(() => {
    a = sliceStats(buildMesh(w, { kind: 'bin', key: 'a', opts: { ...DEFAULT_BIN } }));
    b = sliceStats(buildMesh(w, { kind: 'bin', key: 'b', opts: { ...DEFAULT_BIN, heightUnits: 3 } }));
  });

  it('two colours on every shared layer swap once a layer, and purge more going lighter', () => {
    const one = estimatePlate([{ stats: a, w: 41.5, d: 41.5, colour: { bodies: [1] } }, { stats: b, w: 41.5, d: 41.5, colour: { bodies: [1] } }]);
    expect(one.swaps).toBe(0);
    const colourOf = (s: number) => PALETTE[s - 1].colour;
    const two = estimatePlate([{ stats: a, w: 41.5, d: 41.5, colour: { bodies: [1] } }, { stats: b, w: 41.5, d: 41.5, colour: { bodies: [2] } }], undefined, { colourOf });
    expect(two.swaps).toBe(two.layers);
    expect(two.wasteGrams).toBeGreaterThan(two.swaps * 0.35);
    expect(two.seconds).toBeGreaterThan(one.seconds);
    // Both parts' filament, by slot, adds up to what's extruded.
    expect(two.slotVolume![1] + two.slotVolume![2]).toBeCloseTo(two.extruded, 3);
    expect(two.slotVolume![1]).toBeCloseTo(two.slotVolume![2], 0);
  });

  it('by height: one swap per change, by AMS or by hand', () => {
    const bands = [{ z: 0, slot: 3 }, { z: 4.8, slot: 1 }, { z: 18.2, slot: 2 }];
    const est = estimatePlate([{ stats: a, w: 41.5, d: 41.5, colour: { bodies: [], bands } }]);
    expect(est.swaps).toBe(2);
    const byHand = estimatePlate([{ stats: a, w: 41.5, d: 41.5, colour: { bodies: [], bands } }], undefined, { manual: true });
    expect(byHand.manual).toBe(true);
    expect(byHand.swaps).toBe(2);
    // No prime tower by hand: only the purge.
    expect(byHand.wasteGrams).toBeLessThan(est.wasteGrams);
    expect(byHand.breakdown.swaps).toBe(2 * 150);
  });

  it('the job: colours from the setup, a printer without slots changes by hand, the BOM by slot', () => {
    const s = withColours({ strategy: 'height', roles: { binLip: 2 } }, { printerId: 'p1p' });
    const job = planPrint([drawer([bin('a'), bin('b', {}, 1)], 2, 1)], s, { baseplate: false, bins: true });
    const stats = (k: string) => (job.parts['bin:a'].meshKey === k ? a : a);
    const est = estimateJob(job, stats, 'p1p', s);
    expect(est[0]!.swaps).toBe(1);
    expect(est[0]!.manual).toBe(true);
    const bom = billOfMaterials(job, () => undefined, { plates: est, setup: s, printer: 'P1P' });
    expect(bom.plates[0].slots!.map((x) => x.slot)).toEqual([1, 2]);
    expect(bom.filaments!.reduce((t, x) => t + x.grams, 0)).toBeCloseTo(bom.total.grams!, 6);
    expect(bom.plates[0].manual).toBe(true);
    expect(bom.total.cost!.filament).toBeCloseTo(bom.filaments!.reduce((t, x) => t + x.cost, 0), 9);
  });
});

describe('colour print checks', () => {
  it('by feature on a printer with one slot needs an AMS, with a fix', () => {
    const s = withColours({ strategy: 'feature', roles: { binLip: 2 } }, { printerId: 'p1p' });
    const job = planPrint([drawer([bin('a')], 1, 1)], s, { baseplate: false, bins: true });
    const c = colourChecks(job, s);
    const slots = c.find((x) => x.rule === 'colour-slots')!;
    expect(slots.severity).toBe('warn');
    expect(slots.fix?.setup?.colours?.strategy).toBeUndefined();
    expect(slots.group).toBe('Colours');
  });

  it('mixed plates, inlaid text by height, and other materials in a Bambu project', () => {
    const mixed = withColours({ strategy: 'part', mix: true });
    const job = planPrint([drawer([bin('a'), bin('b', { colour: 3 }, 1)], 2, 1)], mixed, { baseplate: false, bins: true });
    expect(colourChecks(job, mixed).map((c) => c.rule)).toContain('colour-mixed');
    const h = withColours({ strategy: 'height' }, { filaments: [...PALETTE.slice(0, 2), { ...PALETTE[2], material: 'PETG' }] });
    const inlaid = planPrint([drawer([bin('a', { label: 'full', labelText: 'M3', labelStyle: 'inlaid', colour: 3 })], 1, 1)], h, { baseplate: false, bins: true });
    const rules = colourChecks(inlaid, h).map((c) => c.rule);
    expect(rules).toContain('colour-inlay');
    expect(rules).toContain('colour-material');
    expect(colourChecks(job, DEFAULT_SETUP)).toEqual([]);
  });
});

describe('the Colours section and the colour fields', () => {
  const hits = (index: Parameters<typeof searchIndex>[0], q: string) => [...(searchIndex(index, q)?.hits ?? [])];

  it('is found by what people call it, in both spellings', () => {
    for (const q of ['colour', 'color', 'multi colour', 'multi color', 'AMS', 'filament', 'paint']) expect(hits(PRINT_INDEX, q), q).toContain('colours');
    for (const q of ['by height', 'purge', 'swap']) expect(hits(PRINT_INDEX, q), q).toContain('colour-strategy');
    expect(hits(PRINT_INDEX, 'palette')).toContain('colour-palette');
    for (const q of ['colour', 'color']) {
      expect(hits(DRAWER_INDEX, q), q).toContain('bp-colour');
      expect(hits(BIN_INDEX, q), q).toContain('bin-colour');
    }
  });

  it('presets: "Colour-coded bins" gives each kind of bin its colour, as one undo step', () => {
    const st = useStore.getState();
    st.resetAll();
    st.addBin(0, 0, 1, 1);
    st.addBin(1, 0, 1, 1);
    st.addBin(2, 0, 2, 1);
    const [x, y] = useStore.getState().bins.map((b) => b.id);
    useStore.getState().setBinContents(x, 'M3 screws');
    useStore.getState().setBinContents(y, 'M3 screws');
    history.checkpoint();
    applyColourPreset('coded');
    const after = useStore.getState();
    expect(after.setup.colours?.on).toBe(true);
    const colours = after.bins.map((b) => b.opts.colour);
    expect(colours[0]).toBe(colours[1]);
    expect(colours[2]).not.toBe(colours[0]);
    expect(colours.every((c) => c && c >= 3)).toBe(true);
    history.undo();
    expect(useStore.getState().bins.every((b) => b.opts.colour === undefined)).toBe(true);
    expect(useStore.getState().setup.colours).toBeUndefined();
  });

  it('presets: "Red plate, black bins" and "One colour"', () => {
    useStore.getState().resetAll();
    applyColourPreset('red-black');
    const s = useStore.getState().setup;
    expect(roleSlot(s, 'plate')).toBe(3);
    expect(paletteOf(s)[2].colour).toBe('#C12E1F');
    expect(roleSlot(s, 'binWalls')).toBe(1);
    expect(paletteOf(s)[0].colour).toBe('#161616');
    applyColourPreset('one');
    expect(useStore.getState().setup.colours).toBeUndefined();
  });
});
