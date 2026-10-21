import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { registerFont } from '../src/lib/geometry/text';
import type { ColourSetup } from '../src/lib/colours';
import { exportBambuProject } from '../src/lib/export/bambu';
import { estimatePlate, sliceStats } from '../src/lib/estimate';
import { colourChecks } from '../src/lib/colourChecks';
import { featureSplitBlocked } from '../src/lib/geometry/colourRegions';
import { binSpiral } from '../src/lib/geometry/containers/vase';
import { cleanExternalOpts, patchExternalOpts } from '../src/lib/external';
import { putImported } from '../src/lib/imported/registry';
import { cleanBins } from '../src/state/store';
import { plateBed } from '../src/lib/layout/pack';

/**
 * Multi-colour (colours.ts) with the features that came beside it: QR codes,
 * vase-mode bins, imported bins, drawers whose baseplate you have, the X1 / P1
 * bed exclusion corner, and My bins (bin options as saved).
 */

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
const vase = (id: string, o: Partial<BinOptions> = {}, x = 0, y = 0): PlacedBin => ({
  id,
  x,
  y,
  opts: sanitizeBin({ ...DEFAULT_BIN, heightUnits: 3, ...o, container: 'vase', containers: { vase: {} } } as BinOptions),
});
const drawer = (bins: PlacedBin[], gridX = 6, gridY = 3, more: Partial<NamedDrawer['drawer']> = {}): NamedDrawer => ({
  id: 'd',
  name: 'd',
  drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY, ...more },
  baseplate: DEFAULT_BASEPLATE,
  bins,
});
const QR = { qr: 'front', qrContent: 'custom', qrText: 'https://example.com/bins/1', qrStyle: 'inlaid' } as Partial<BinOptions>;

function meshes(job: PrintJob) {
  const cache = new Map<string, MeshData>();
  return (k: string) => cache.get(k) ?? cache.set(k, buildMesh(w, job.meshes[k])).get(k)!;
}
const bambu = (job: PrintJob, s: PrintSetup) => unzipSync(exportBambuProject(job, s, meshes(job), readFileSync('public/bambu/x1c.json', 'utf8')));
const objects = (cfg: string) =>
  cfg
    .split('<object id=')
    .slice(1)
    .map((o) => ({
      name: /key="name" value="([^"]*)"/.exec(o)![1],
      extruder: /key="extruder" value="(\d+)"/.exec(o)![1],
      parts: [...o.matchAll(/<part id="\d+"[^>]*>([\s\S]*?)<\/part>/g)].map((m) => ({
        name: /key="name" value="([^"]*)"/.exec(m[1])![1],
        extruder: /key="extruder" value="(\d+)"/.exec(m[1])?.[1],
      })),
    }));

describe('QR codes', () => {
  it('an inlaid code is the QR code role: filament 2 with colours off, as before; its own slot with them on', () => {
    const d = drawer([bin('q', { unitsX: 2, heightUnits: 6, ...QR })], 2, 1);
    const off = planPrint([d], DEFAULT_SETUP, { baseplate: false, bins: true });
    const mesh = meshes(off)(off.parts['bin:q'].meshKey);
    expect(mesh.overlays?.map((o) => [o.name, o.filament, o.role])).toEqual([['QR code', 2, 'qrCode']]);
    const before = objects(strFromU8(bambu(off, DEFAULT_SETUP)['Metadata/model_settings.config']));
    expect(before[0].parts.map((p) => p.extruder)).toEqual([undefined, '2']);

    // On, by part: it follows the label text (slot 2) until set; then its own slot.
    const s = withColours({ roles: { binWalls: 2, labelText: 1 } });
    const on = planPrint([d], s, { baseplate: false, bins: true });
    expect(objects(strFromU8(bambu(on, s)['Metadata/model_settings.config']))[0]).toMatchObject({ extruder: '2', parts: [{}, { extruder: '1' }] });
    const s4 = withColours({ roles: { binWalls: 2, labelText: 1, qrCode: 4 } });
    const on4 = planPrint([d], s4, { baseplate: false, bins: true });
    expect(objects(strFromU8(bambu(on4, s4)['Metadata/model_settings.config']))[0].parts[1].extruder).toBe('4');
    // A bin's own colour doesn't change its code.
    const own = planPrint([drawer([bin('q', { unitsX: 2, heightUnits: 6, colour: 3, ...QR })], 2, 1)], s4, { baseplate: false, bins: true });
    expect(objects(strFromU8(bambu(own, s4)['Metadata/model_settings.config']))[0]).toMatchObject({ extruder: '3', parts: [{}, { extruder: '4' }] });
  });

  it('a code no darker than what it is on gets a check, with a darker slot as the fix', () => {
    const d = drawer([bin('q', { unitsX: 2, heightUnits: 6, ...QR })], 2, 1);
    const s = withColours({ roles: { binWalls: 2, labelText: 2 } });
    const job = planPrint([d], s, { baseplate: false, bins: true });
    const c = colourChecks(job, s).find((x) => x.rule === 'colour-qr')!;
    expect(c.message).toMatch(/1 QR code prints in White on White/);
    expect(c.fix?.label).toBe('QR codes in Black');
    const fixed = { ...s, ...c.fix!.setup } as PrintSetup;
    expect(colourChecks(planPrint([d], fixed, { baseplate: false, bins: true }), fixed).some((x) => x.rule === 'colour-qr')).toBe(false);
    // By height it prints in its band's colour, which colour-inlay says.
    const h = withColours({ strategy: 'height' });
    expect(colourChecks(planPrint([d], h, { baseplate: false, bins: true }), h).map((x) => x.rule)).toContain('colour-inlay');
  });
});

describe('vase-mode bins', () => {
  const bins = [vase('v1', {}, 0, 0), vase('v2', {}, 1, 0), bin('b', {}, 2, 0), vase('v3', { colour: 3 }, 3, 0)];

  it('by part: spiral plates of their own, a colour group after another', () => {
    const s = withColours({ roles: { binWalls: 1 } });
    const job = planPrint([drawer(bins, 4, 1)], s, { baseplate: false, bins: true });
    const names = job.plates.map((p) => `${p.name}${p.spiral ? ' (spiral)' : ''}: ${p.placements.map((q) => q.key).join(' ')}`);
    expect(names).toEqual(['Bins 1 · Black: bin:b', 'Vase bins 1 · Black (spiral): bin:v1 bin:v2', 'Vase bins 2 · Red (spiral): bin:v3']);
  });

  it('by height: a vase bin that changes colour prints alone (Bambu Studio changes filament by layer only on plates printed by layer)', () => {
    const s = withColours({ strategy: 'height', roles: { binFeet: 3, binWalls: 1 } });
    const job = planPrint([drawer(bins, 4, 1)], s, { baseplate: false, bins: true });
    const spiral = job.plates.filter((p) => p.spiral);
    expect(spiral.map((p) => p.placements.length)).toEqual([1, 1, 1]);
    const files = bambu(job, s);
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    const plates = cfg.split('<plate>').slice(1);
    const ids = job.plates.flatMap((p, i) => (p.spiral ? [i + 1] : []));
    for (const id of ids) {
      expect(plates[id - 1]).toContain('<metadata key="spiral_mode" value="true"/>');
      expect(plates[id - 1]).not.toContain('print_sequence');
    }
    // The layer changes and the spiral plates in one project: each plate starts red, black from 5 mm (feet top 4.8 + one layer).
    const changes = strFromU8(files['Metadata/custom_gcode_per_layer.xml']);
    for (const id of job.plates.map((_, i) => i + 1)) {
      const red = job.plates[id - 1].placements.every((p) => job.parts[p.key].colour?.bin === 3);
      if (red) continue;
      expect(changes).toContain(`<plate_info id="${id}"/>\n<layer top_z="5" type="2" extruder="1" color="#161616" extra="" gcode="tool_change"/>`);
    }
    const objs = objects(cfg).filter((o) => o.name.includes('spiral vase'));
    expect(objs.map((o) => o.extruder)).toEqual(['3', '3', '3']);
    // Each vase bin keeps its spiral settings (bottom layers to 6 mm, one wall loop).
    expect(cfg.match(/key="wall_loops" value="1"/g)?.length).toBe(3);
  });

  it('by height, one colour: vase bins still share a plate, printed by object', () => {
    const s = withColours({ strategy: 'height' });
    const job = planPrint([drawer(bins.slice(0, 2), 2, 1)], s, { baseplate: false, bins: true });
    expect(job.plates.filter((p) => p.spiral).map((p) => p.placements.length)).toEqual([2]);
    const cfg = strFromU8(bambu(job, s)['Metadata/model_settings.config']);
    expect(cfg).toContain('<metadata key="print_sequence" value="by object"/>');
  });

  it('by feature: one body (featureSplitBlocked), and a check says so', () => {
    const s = withColours({ strategy: 'feature' });
    const job = planPrint([drawer(bins, 4, 1)], s, { baseplate: false, bins: true });
    expect(job.parts['bin:v1'].meshKey).not.toContain('#roles');
    expect(job.parts['bin:b'].meshKey).toContain('#roles');
    expect(featureSplitBlocked(job.meshes[job.parts['bin:v1'].meshKey])).toMatch(/vase-mode/);
    expect(colourChecks(job, s).find((c) => /print as one body/.test(c.message))?.message).toMatch(/^3 parts/);
  });

  it('estimates: a spiral plate swaps as each bin rises, then back for the next (no prime tower)', () => {
    const v = vase('v').opts;
    const mesh = buildMesh(w, { kind: 'bin', key: 'v', opts: v });
    const stats = sliceStats(mesh);
    const spiral = binSpiral(v)!;
    const part = { stats, w: 41.5, d: 41.5, spiral, colour: { bodies: [], bands: [{ z: 0, slot: 3 }, { z: 4.8, slot: 1 }] } };
    const one = estimatePlate([part], undefined, { colourOf: (s) => PALETTE[s - 1].colour });
    expect(one.swaps).toBe(1);
    const two = estimatePlate([part, part], undefined, { colourOf: (s) => PALETTE[s - 1].colour });
    expect(two.swaps).toBe(3);
    expect(two.wasteGrams).toBeGreaterThan(one.wasteGrams);
    expect(estimatePlate([{ stats, w: 41.5, d: 41.5, spiral }]).swaps).toBe(0);
  });
});

describe('imported bins', () => {
  // A closed box mesh, 41.5 × 41.5 × 20.
  const box = (): MeshData => {
    const m = w.Manifold.cube([41.5, 41.5, 20]).getMesh();
    return { positions: new Float32Array(m.vertProperties), indices: new Uint32Array(m.triVerts) };
  };
  const ref = { hash: 'colour-box', file: 'box.stl', size: [41.5, 41.5, 20] as [number, number, number], triangles: 12, closed: true };
  const imported = (id: string, x: number, print: boolean, colour?: number): PlacedBin => ({
    id,
    x,
    y: 0,
    opts: cleanExternalOpts({ unitsX: 1, unitsY: 1, ...(colour ? { colour } : {}) }, { name: id, color: '#888888', mesh: ref, print }),
    external: { name: id, color: '#888888', mesh: ref, print },
  });

  it('print as one body in their own colour; ones you have never print', () => {
    putImported(ref.hash, box());
    const s = withColours({ strategy: 'feature', roles: { binWalls: 1 } });
    const job = planPrint([drawer([imported('mine', 0, true, 4), imported('owned', 1, false, 3), bin('b', {}, 2, 0)], 3, 1)], s, { baseplate: false, bins: true });
    expect(job.parts['bin:owned']).toBeUndefined();
    expect(job.parts['bin:mine'].colour).toEqual({ bin: 4 });
    expect(job.parts['bin:mine'].meshKey).not.toContain('#roles');
    const cfg = strFromU8(bambu(job, s)['Metadata/model_settings.config']);
    const mine = objects(cfg).find((o) => o.name.includes('mine'))!;
    expect(mine).toMatchObject({ extruder: '4', parts: [{}] });
    expect(colourChecks(job, s).some((c) => /1 part prints as one body/.test(c.message))).toBe(true);
  });

  it('keep their colour through cleaning and edits (project files, My bins)', () => {
    const b = imported('mine', 0, true, 4);
    expect(b.opts.colour).toBe(4);
    expect(cleanBins([b])[0].opts.colour).toBe(4);
    expect(patchExternalOpts(b, { unitsX: 2 }).colour).toBe(4);
    expect(patchExternalOpts(b, { colour: undefined }).colour).toBeUndefined();
    expect(cleanBins([bin('g', { colour: 5 })])[0].opts.colour).toBe(5);
  });
});

describe('drawers whose baseplate you have (Just bins)', () => {
  it('print their bins by colour and nothing of the baseplate, whatever its colour', () => {
    const s = withColours({ roles: { plate: 3, binWalls: 1 } });
    const d = { ...drawer([bin('a'), bin('b', { colour: 4 }, 1)], 2, 1, { haveBaseplate: true }), baseplate: { ...DEFAULT_BASEPLATE, colour: 2 } };
    const job = planPrint([d], s, { baseplate: true, bins: true });
    expect(job.plates.map((p) => p.name)).toEqual(['Bins 1 · Black', 'Bins 2 · Blue']);
    const files = bambu(job, s);
    expect(objects(strFromU8(files['Metadata/model_settings.config'])).map((o) => o.extruder).sort()).toEqual(['1', '4']);
    // No baseplate slot in the filament list beyond what prints (slots up to the highest used).
    expect(JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour).toHaveLength(4);
  });
});

describe('the X1 / P1 bed exclusion corner', () => {
  it('every colour group packs clear of it', () => {
    const s = withColours({ roles: { binWalls: 1 } }, { printerId: 'x1c', bedW: 256, bedD: 256 });
    const many = Array.from({ length: 30 }, (_, i) => bin(`b${i}`, { colour: (i % 3) + 1 }, i % 6, Math.floor(i / 6)));
    const job = planPrint([drawer(many, 6, 5)], s, { baseplate: false, bins: true });
    expect(new Set(job.plates.map((p) => p.name.split(' · ')[1]))).toEqual(new Set(['Black', 'White', 'Red']));
    const corner = plateBed(s).exclude![0];
    for (const pl of job.plates) {
      // The corner is at the bed's front-left, inside the edge margin: a part is clear when it's right of it or behind it.
      for (const p of pl.placements) expect(p.x >= corner.x + corner.w - 1e-6 || p.y >= corner.y + corner.d - 1e-6, `${pl.name}: ${p.key}`).toBe(true);
    }
  });
});
