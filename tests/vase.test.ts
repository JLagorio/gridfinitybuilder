import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { CrossSection } from 'manifold-3d';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binCells, binLabel, binTotalHeight, buildBin, sanitizeBin, type BinCells, type BinOptions } from '../src/lib/geometry/bin';
import { meshTopology } from '../src/lib/geometry/printcheck';
import { printedVolume, meshVolume } from '../src/lib/geometry/volume';
import { containerDefs } from '../src/lib/geometry/containers';
import {
  VASE,
  binSpiral,
  sanitizeVase,
  vaseBottomLayers,
  vaseLayout,
  vaseLineFor,
  type VaseOptions,
} from '../src/lib/geometry/containers/vase';
import { buildMesh, planPrint, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { findPrinter } from '../src/lib/printers';
import { packSpiral, SPIRAL_PLATE } from '../src/lib/layout/spiral';
import { exportBambuProject, spiralObjectSettings, withProcessSettings } from '../src/lib/export/bambu';
import { exportPlatesZip } from '../src/lib/export/threemf';
import { exportPlatesStlZip } from '../src/lib/export/stl';
import { binChecks } from '../src/lib/printability';
import { estimatePlate, sliceStats } from '../src/lib/estimate';
import { roughSeconds } from '../src/lib/layout/fleet';
import { DEFAULT_MOTION } from '../src/lib/printers';
import { stretchRoom } from '../src/lib/layout/stretch';
import { computeLayout } from '../src/lib/layout/drawer';
import { stackProblem } from '../src/lib/stacking';
import { searchIndex } from '../src/lib/panelSearch';
import { BIN_INDEX } from '../src/components/panelIndex';
import { spiralReport } from '../scripts/gcode-spiral';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VaseFields } from '../src/components/containers/VaseFields';
import { BaseField } from '../src/components/BinVariantFields';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const vase = (o: Partial<BinOptions> = {}, v: Partial<VaseOptions> = {}): BinOptions =>
  sanitizeBin({ ...DEFAULT_BIN, heightUnits: 3, ...o, container: 'vase', containers: { vase: v } } as BinOptions);

const solid = (m: MeshData) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));

/** A cross-section's islands, contours, area, and the length of its outer contour. */
function section(m: MeshData, z: number) {
  const man = solid(m);
  const cs: CrossSection = man.slice(z);
  const polys = cs.toPolygons();
  const area = (p: [number, number][]) => p.reduce((t, q, i) => t + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]) / 2, 0);
  const outer = polys.reduce((a, p) => (area(p) > area(a) ? p : a), polys[0]);
  const length = outer.reduce((s, q, i) => s + Math.hypot(q[0] - outer[(i + 1) % outer.length][0], q[1] - outer[(i + 1) % outer.length][1]), 0);
  const islands = cs.decompose();
  const out = { islands: islands.length, contours: cs.numContour(), length, area: cs.area() };
  for (const i of islands) i.delete();
  cs.delete();
  man.delete();
  return out;
}

describe('vase-mode bin geometry', () => {
  const cases: [string, BinOptions, BinCells?][] = [
    ['1×1', vase()],
    ['2×1', vase({ unitsX: 2 })],
    ['3×2 with 2 dividers and magnets', vase({ unitsX: 3, unitsY: 2, heightUnits: 4, holes: 'magnets' }, { dividers: 2 })],
    ['1×3 with 4 dividers across the depth, screws and magnets', vase({ unitsX: 1, unitsY: 3, heightUnits: 5, holes: 'both', holePrintable: true }, { dividers: 4, axis: 'y' })],
    ['2×1 refined magnets, 0.45 mm line', vase({ unitsX: 2, holes: 'refined' }, { dividers: 1, line: 0.45 })],
    ['flat 1×1 with a divider', vase({ base: 'flat' }, { dividers: 1 })],
    ['half grid 3 × 1 half cells', vase({ unitsX: 3 }), { x: [21, 21, 21], y: [21], half: true }],
    ['partial edge cells', vase({ unitsX: 2, unitsY: 1 }), { x: [42, 30], y: [25] }],
  ];

  for (const [name, o, cellsIn] of cases) {
    it(`${name}: a closed solid in one piece, the bin's size`, () => {
      const cells = binCells(o, cellsIn);
      const m = buildBin(w, o, cells);
      const topo = meshTopology(m);
      expect(topo.openEdges + topo.badEdges, name).toBe(0);
      expect(topo.components.length, name).toBe(1);
      expect(topo.volume).toBeGreaterThan(0);
      const b = meshBounds(m);
      const L = vaseLayout(o, sanitizeVase(o.containers?.vase), cells);
      expect(b.min[2]).toBeCloseTo(0, 3);
      expect(b.max[2]).toBeCloseTo(binTotalHeight(o), 3);
      expect(b.max[0] - b.min[0]).toBeCloseTo(L.W, 2);
      expect(b.max[1] - b.min[1]).toBeCloseTo(L.D, 2);
    });
  }

  it('above the bottom layers every layer is one outline (a line thick round each section), folding into every slit', () => {
    for (const [o, dividers] of [
      [vase({ unitsX: 3, unitsY: 2, heightUnits: 4 }, { dividers: 2 }), 2],
      [vase({ unitsX: 2, unitsY: 1 }, { dividers: 1, axis: 'y' }), 1],
      [vase({ base: 'flat' }, { dividers: 1 }), 1],
      [vase({ unitsX: 2 }), 0],
    ] as const) {
      const cells = binCells(o);
      const m = buildBin(w, o, cells);
      const L = vaseLayout(o, sanitizeVase(o.containers?.vase), cells);
      for (const z of [L.start + 0.1, (L.start + L.H) / 2, L.H - 0.1]) {
        const s = section(m, z);
        expect(s.islands).toBe(1);
        // The outside, and a hole per section: the slicer closes those and prints the outside.
        expect(s.contours).toBe(1 + dividers + 1);
        // The outline plus both sides of each slit.
        expect(s.length).toBeCloseTo(L.path, 0);
        expect(L.dividers.length).toBe(dividers);
        // One line of wall, and each divider two lines and the slit.
        const wall = L.path * 0.6 + dividers * (L.D > L.W ? L.W : L.D) * (L.divider - 2 * 0.6);
        expect(s.area).toBeGreaterThan(0.9 * (L.path * 0.6));
        expect(s.area).toBeLessThan(1.1 * wall);
      }
    }
  });

  it('a multi-cell bin is separate feet below the ridge line and one hollow piece above it, up to the spiral start', () => {
    const o = vase({ unitsX: 2, unitsY: 2, holes: 'magnets' });
    const m = buildBin(w, o);
    // Feet: four islands, each a shell (outline and hollow) or with magnet bosses inside.
    const feet = section(m, 3.5);
    expect(feet.islands).toBeGreaterThanOrEqual(4);
    expect(feet.contours).toBeGreaterThan(feet.islands);
    // The band joining the feet: one piece, four hollows.
    const band = section(m, 5.5);
    expect(band.islands).toBe(1);
    expect(band.contours).toBe(5);
    // Each foot's floor is solid.
    expect(section(m, 0.5).contours).toBe(4 + 4 * 4);
  });

  it('feet walls are two lines thick', () => {
    const o = vase({}, { line: 0.5 });
    const L = vaseLayout(o, sanitizeVase(o.containers?.vase), binCells(o));
    expect(L.shell).toBeCloseTo(1, 6);
    const m = buildBin(w, o);
    // At the vertical band of the profile the foot's outside is 41.5 − 2 × 2.15 wide; its hollow two lines less a side.
    const s = section(m, 2);
    const outside = 41.5 - 2 * 2.15;
    const inside = outside - 2 * 1;
    expect(s.area).toBeGreaterThan(outside ** 2 - inside ** 2 - 20);
    expect(s.area).toBeLessThan(outside ** 2 - inside ** 2 + 1);
  });

  it('dividers stop where there is no room; the slit ends two lines short of the opposite wall', () => {
    const o = vase({}, { dividers: 11 });
    const L = vaseLayout(o, sanitizeVase(o.containers?.vase), binCells(o));
    expect(L.dividers.length).toBe(Math.floor(41.5 / VASE.minSection) - 1);
    expect(L.sections.every((s) => s >= VASE.minSection - 1e-6)).toBe(true);
    expect(L.gap).toBeCloseTo(2 * 0.6, 6);
    expect(L.slit).toBeGreaterThan(2 * 0.049);
    const def = containerDefs().find((d) => d.kind === 'vase')!;
    expect(def.notes?.(o, sanitizeVase(o.containers?.vase), binCells(o))).toEqual([expect.stringContaining('dividers fit')]);
  });

  it('sanitizes its options and names the bin', () => {
    expect(sanitizeVase({ dividers: 99, axis: 'z', line: 9, floor: -1 })).toEqual({ dividers: VASE.maxDividers, axis: 'x', line: VASE.line.max, floor: VASE.floor.min });
    expect(sanitizeVase(undefined)).toEqual({ dividers: 0, axis: 'x', line: 0.6, floor: 1 });
    expect(binLabel(vase({ unitsX: 2 }, { dividers: 2 }))).toBe('2×1×3u vase-mode bin 3 sections');
    expect(binTotalHeight(vase({ heightUnits: 5, lip: true }))).toBe(35);
  });

  it('bottom layers reach the spiral start at common layer heights', () => {
    expect(vaseBottomLayers(6, 0.2, 0.2)).toBe(30);
    expect(vaseBottomLayers(6, 0.3, 0.3)).toBe(20);
    expect(vaseBottomLayers(6, 0.28, 0.2)).toBe(22);
    expect(vaseBottomLayers(1, 0.2)).toBe(5);
    // The last bottom layer is sliced below the start, the first spiral layer above it.
    for (const [h, h1] of [
      [0.2, 0.2],
      [0.12, 0.2],
      [0.16, 0.2],
      [0.24, 0.24],
      [0.3, 0.3],
    ]) {
      const n = vaseBottomLayers(6, h, h1);
      expect(h1 + (n - 1.5) * h).toBeLessThan(6);
      expect(h1 + (n - 0.5) * h).toBeGreaterThan(6);
    }
  });

  it('suits the line to the nozzle', () => {
    expect(vaseLineFor(0.4)).toBe(0.6);
    expect(vaseLineFor(0.6)).toBeCloseTo(0.9, 6);
    expect(vaseLineFor(0.2)).toBeCloseTo(0.3, 6);
    expect(vaseLineFor(0.8)).toBeCloseTo(1.2, 6);
  });

  it('is drawn as it prints, so its volume is its filament: a fraction of a normal bin’s', () => {
    const o = vase({ unitsX: 2, heightUnits: 6 });
    const m = buildBin(w, o);
    const plain = buildBin(w, sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, heightUnits: 6 }));
    const v = meshVolume(m);
    expect(printedVolume(m)).toBeCloseTo(v, -1);
    expect(v).toBeLessThan(0.5 * printedVolume(plain));
  });
});

// ---------------------------------------------------------------------------
// Planning and exports
// ---------------------------------------------------------------------------

function drawerWith(bins: [number, number, BinOptions][], gridX = 6, gridY = 6): NamedDrawer {
  return {
    id: 'd',
    name: 'Drawer',
    drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY },
    baseplate: DEFAULT_BASEPLATE,
    bins: bins.map(([x, y, opts], i) => ({ id: `b${i}`, x, y, opts })),
  };
}

const setupFor = (printerId: string): PrintSetup => {
  const p = findPrinter(printerId);
  return { ...DEFAULT_SETUP, printerId, bedW: p.bedW, bedD: p.bedD, maxH: p.maxH };
};

const plan = (bins: [number, number, BinOptions][], setup: PrintSetup = DEFAULT_SETUP) => planPrint([drawerWith(bins)], setup, { baseplate: false, bins: true });

const plateParts = (job: PrintJob) => job.plates.map((pl) => pl.placements.map((p) => job.parts[p.key]));

describe('vase-mode bins on plates', () => {
  it('get plates of their own, apart from other bins', () => {
    const job = plan([
      [0, 0, vase()],
      [1, 0, sanitizeBin(DEFAULT_BIN)],
      [2, 0, vase({ unitsX: 2 })],
    ]);
    const vasePlates = job.plates.filter((p) => p.spiral);
    expect(vasePlates.length).toBeGreaterThan(0);
    for (const pl of job.plates) {
      const parts = pl.placements.map((p) => job.parts[p.key]);
      expect(parts.every((p) => !!p.spiral)).toBe(!!pl.spiral);
    }
    expect(vasePlates[0].name).toMatch(/^Vase bins 1/);
    const part = Object.values(job.parts).find((p) => p.spiral)!;
    expect(part.spiral).toMatchObject({ start: 6, line: 0.6 });
    expect(part.name).toContain('spiral vase: bottom layers to 6 mm (30 at 0.2 mm), 0.6 mm wall line');
  });

  it('share a plate on a Bambu printer when short, spaced for the gantry; tall ones print alone', () => {
    const setup = setupFor('x1c');
    const clearance = findPrinter('x1c').sequential!;
    const job = plan(
      [
        [0, 0, vase()],
        [1, 0, vase()],
        [2, 0, vase()],
        [3, 0, vase({ heightUnits: 6 })],
      ],
      setup,
    );
    const plates = job.plates.filter((p) => p.spiral);
    const sizes = plates.map((p) => p.placements.length).sort();
    // Three 21 mm bins (two fit a row at 70 mm apart), and the 42 mm one alone.
    expect(sizes).toEqual([1, 3]);
    for (const pl of plates) {
      const ps = pl.placements;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          const gapX = Math.max(b.x - (a.x + (a.rotated ? a.d : a.w)), a.x - (b.x + (b.rotated ? b.d : b.w)));
          const gapY = Math.max(b.y - (a.y + (a.rotated ? a.w : a.d)), a.y - (b.y + (b.rotated ? b.w : b.d)));
          expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(clearance.radius);
        }
      }
      if (ps.length > 1) for (const p of ps) expect(job.parts[p.key].h).toBeLessThanOrEqual(clearance.rod - SPIRAL_PLATE.heightMargin);
    }
  });

  it('print one per plate on other printers (PrusaSlicer prints one object in spiral vase mode)', () => {
    const job = plan(
      [
        [0, 0, vase()],
        [1, 0, vase()],
        [2, 0, vase({ base: 'flat' })],
      ],
      setupFor('prusa-mk4s'),
    );
    const plates = job.plates.filter((p) => p.spiral);
    expect(plates.length).toBe(3);
    expect(plates.every((p) => p.placements.length === 1)).toBe(true);
    expect(plateParts(job).flat().find((p) => p.spiral?.start === 1)).toBeTruthy();
  });

  it('pack by the clearance and put too-tall ones alone', () => {
    const items = [
      { key: 'a', w: 41.5, d: 41.5, h: 21 },
      { key: 'b', w: 41.5, d: 41.5, h: 21 },
      { key: 'c', w: 41.5, d: 41.5, h: 40 },
    ];
    const bed = { bedW: 256, bedD: 256, margin: 10 };
    expect(packSpiral(items, bed, { radius: 68, rod: 34 }).plates.map((p) => p.placements.length)).toEqual([2, 1]);
    expect(packSpiral(items, bed).plates.map((p) => p.placements.length)).toEqual([1, 1, 1]);
  });

  it('share out between printers like other bins, on spiral plates of each printer', () => {
    const setup: PrintSetup = { ...setupFor('x1c'), printers: [{ printerId: 'prusa-mk4s', bedW: 250, bedD: 210, maxH: 220, plateMargin: 10 }] } as PrintSetup;
    const job = plan(
      [
        [0, 0, vase()],
        [1, 0, vase()],
        [2, 0, vase()],
        [3, 0, sanitizeBin(DEFAULT_BIN)],
      ],
      setup,
    );
    expect(job.printers?.length).toBe(2);
    const spiral = job.plates.filter((p) => p.spiral);
    expect(spiral.length).toBeGreaterThan(0);
    for (const pl of spiral) {
      expect(pl.printer).toBeDefined();
      // The Prusa prints one at a time.
      if (pl.printer === 1) expect(pl.placements.length).toBe(1);
      expect(pl.placements.every((p) => job.parts[p.key].spiral)).toBe(true);
    }
    const names = job.plates.filter((p) => p.spiral).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('don’t stretch, and nothing stacks on them', () => {
    const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'drawer', width: 140, depth: 100 });
    expect(stretchRoom(layout, { x: 0, y: 0, opts: vase() })).toEqual({ left: 0, right: 0, front: 0, back: 0 });
    expect(stackProblem(layout, { id: 'b', x: 0, y: 0, opts: vase() })).toMatch(/no stacking lip/);
  });
});

describe('Bambu Studio project with vase plates', () => {
  const get = (job: PrintJob) => {
    const cache = new Map<string, MeshData>();
    return (k: string) => cache.get(k) ?? cache.set(k, buildMesh(w, job.meshes[k])).get(k)!;
  };
  const settings = JSON.stringify({ layer_height: '0.2', initial_layer_print_height: '0.2', timelapse_type: '0', z_direction_outwall_speed_continuous: '1', different_settings_to_system: ['', '', ''] });

  it('turns on spiral vase for the vase plates only, with each object set up for it', () => {
    const setup = setupFor('x1c');
    const job = plan(
      [
        [0, 0, vase()],
        [1, 0, vase({ base: 'flat' }, { line: 0.5 })],
        [2, 0, sanitizeBin(DEFAULT_BIN)],
      ],
      setup,
    );
    const files = unzipSync(exportBambuProject(job, setup, get(job), settings));
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    const plates = cfg.split('<plate>').slice(1);
    expect(plates.length).toBe(job.plates.length);
    job.plates.forEach((pl, i) => {
      expect(plates[i].includes('<metadata key="spiral_mode" value="true"/>')).toBe(!!pl.spiral);
      expect(plates[i].includes('<metadata key="print_sequence" value="by object"/>')).toBe(!!pl.spiral && pl.placements.length > 1);
    });
    const objects = cfg.split('<object id=').slice(1);
    const spiralObjects = objects.filter((o) => o.includes('key="wall_loops" value="1"'));
    expect(spiralObjects.length).toBe(2);
    for (const o of spiralObjects) {
      for (const k of ['top_shell_layers" value="0', 'sparse_infill_density" value="0%', 'enable_support" value="0', 'detect_thin_wall" value="0', 'ensure_vertical_shell_thickness" value="enabled']) expect(o).toContain(k);
    }
    expect(spiralObjects.some((o) => o.includes('bottom_shell_layers" value="30"') && o.includes('outer_wall_line_width" value="0.6"'))).toBe(true);
    expect(spiralObjects.some((o) => o.includes('bottom_shell_layers" value="5"') && o.includes('outer_wall_line_width" value="0.5"'))).toBe(true);
    // The plain bin keeps the project's settings.
    expect(objects.filter((o) => !o.includes('wall_loops')).length).toBe(1);
    // Project-wide: what Bambu Studio sets when spiral vase is turned on for a plate.
    const project = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(project.z_direction_outwall_speed_continuous).toBe('0');
    expect(project.timelapse_type).toBe('0');
    expect(project.different_settings_to_system[0]).toContain('z_direction_outwall_speed_continuous');
  });

  it('leaves projects without vase bins as they were', () => {
    const job = plan([[0, 0, sanitizeBin(DEFAULT_BIN)]]);
    const files = unzipSync(exportBambuProject(job, DEFAULT_SETUP, get(job), settings));
    expect(strFromU8(files['Metadata/model_settings.config'])).not.toContain('spiral_mode');
    expect(strFromU8(files['Metadata/project_settings.config'])).toBe(settings);
  });

  it('follows the process layer height for the bottom layers', () => {
    expect(spiralObjectSettings({ start: 6, line: 0.6, path: 160 }, 0.3, 0.3).bottom_shell_layers).toBe('20');
    expect(withProcessSettings('{"a":"1"}', { a: '1' })).toBe('{"a":"1"}');
  });

  it('plain 3MF and STL plate exports say which plates print in spiral vase mode', () => {
    const job = plan([
      [0, 0, vase()],
      [1, 0, sanitizeBin(DEFAULT_BIN)],
    ]);
    const zip = unzipSync(exportPlatesZip(job, DEFAULT_SETUP, get(job)));
    const readme = strFromU8(zip['README.txt']);
    const i = job.plates.findIndex((p) => p.spiral);
    expect(readme).toContain('VASE-MODE BINS');
    expect(readme).toContain(`Plate ${i + 1} (Vase bins 1): bottom layers to 6 mm (30 at 0.2 mm), 0.6 mm wall line`);
    expect(Object.keys(zip).some((f) => /vase-bins-1\.3mf$/.test(f))).toBe(true);
    const stl = unzipSync(exportPlatesStlZip(job, get(job)));
    expect(strFromU8(stl['spiral-vase.txt'])).toContain('Spiral vase');
  });
});

describe('vase-mode bin checks and estimates', () => {
  it('flag a wall line that doesn’t suit the nozzle, with a fix sized to it', () => {
    expect(binChecks(vase())).toEqual([]);
    for (const [nozzle, want] of [
      [0.8, 1.2],
      [0.2, 0.3],
    ] as const) {
      const c = binChecks(vase(), null, { nozzle }).find((k) => k.rule === 'vase-line')!;
      expect(c.severity).toBe('warn');
      expect(c.fix?.bin?.containers?.vase).toMatchObject({ line: want });
      // The fix clears it.
      expect(binChecks(sanitizeBin({ ...vase(), ...c.fix!.bin }), null, { nozzle }).filter((k) => k.rule === 'vase-line')).toEqual([]);
    }
  });

  it('time and filament: one line of wall, a bin after another', () => {
    const o = vase({ unitsX: 2, heightUnits: 6 });
    const plain = sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, heightUnits: 6 });
    const vs = sliceStats(buildBin(w, o));
    const ps = sliceStats(buildBin(w, plain));
    const spiral = binSpiral(o)!;
    const one = estimatePlate([{ stats: vs, w: 83.5, d: 41.5, spiral }]);
    const normal = estimatePlate([{ stats: ps, w: 83.5, d: 41.5 }]);
    expect(one.extruded).toBeLessThan(0.5 * normal.extruded);
    expect(one.printSeconds).toBeLessThan(0.8 * normal.printSeconds);
    // The spiral: one 0.6 mm line along the outline each layer.
    const L = vaseLayout(o, sanitizeVase(undefined), binCells(o));
    const spiralVolume = (L.H - L.start) * L.path * 0.6;
    expect(one.extruded).toBeGreaterThan(spiralVolume);
    // Two of them print one after another, each layer at least the minimum layer time.
    const two = estimatePlate([
      { stats: vs, w: 83.5, d: 41.5, spiral },
      { stats: vs, w: 83.5, d: 41.5, spiral },
    ]);
    expect(two.printSeconds).toBeGreaterThan(1.9 * one.printSeconds);
    expect(two.extruded).toBeCloseTo(2 * one.extruded, 0);
    // The quick guess before slicing (sharing parts out between printers) is near it.
    const rough = roughSeconds({ kind: 'bin', w: 83.5, d: 41.5, h: L.H, spiral }, DEFAULT_MOTION);
    expect(rough / one.printSeconds).toBeGreaterThan(0.7);
    expect(rough / one.printSeconds).toBeLessThan(1.4);
  });

  it('are found by vase, spiral, single wall and fast', () => {
    for (const q of ['vase', 'spiral', 'single wall', 'fast']) expect(searchIndex(BIN_INDEX, q)?.hits.has('type'), q).toBe(true);
  });
});

describe('reading spiral vase G-code back (scripts/gcode-spiral.ts)', () => {
  // Two bottom layers (with a travel between islands), then two spiral turns of a 10 mm square.
  const turn = (z0: number, e0: number) => {
    const pts = [
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    return pts.map(([x, y], i) => `G1 X${x} Y${y} Z${(z0 + ((i + 1) * 0.2) / 4).toFixed(3)} E${(e0 + i + 1).toFixed(3)}`);
  };
  const bottom = (z: number, e: number) => [';LAYER_CHANGE', `;Z:${z}`, `G1 Z${z}`, 'G1 X0 Y0', `G1 X10 Y0 E${e + 1}`, 'G1 X20 Y20', `G1 X30 Y20 E${e + 2}`];
  const good = ['M82', 'G92 E0', ...bottom(0.2, 0), ...bottom(0.4, 2), ';LAYER_CHANGE', ';Z:0.6', ...turn(0.4, 4), ';LAYER_CHANGE', ';Z:0.8', ...turn(0.6, 8), 'G1 E10 F2100'];

  it('passes one rising, continuous line per layer, and ignores the retraction at the end', () => {
    const r = spiralReport(good.join('\n'), 2);
    expect(r).toMatchObject({ layers: 4, bottom: 2, spiral: 2, continuous: 2, turn: 40, bottomTravels: 2 });
    expect(r.firstBreak).toBeUndefined();
  });

  it('flags travel, Z going back down, and a layer that doesn’t rise', () => {
    const travel = [...good];
    travel.splice(travel.indexOf(';Z:0.8') + 2, 0, 'G1 X5 Y5');
    expect(spiralReport(travel.join('\n'), 2).firstBreak?.why).toContain('travel');
    const flat = good.map((l) => (l.startsWith('G1 X') && / Z0\.[5-8]/.test(l) ? l.replace(/ Z[\d.]+/, ' Z0.8') : l));
    expect(spiralReport(flat.join('\n'), 2).firstBreak?.why).toMatch(/does not rise/);
    const drop = good.map((l) => l.replace('Z0.650', 'Z0.500'));
    expect(spiralReport(drop.join('\n'), 2).firstBreak?.why).toMatch(/Z goes down/);
  });
});

describe('vase-mode bin panel', () => {
  const fields = (o: BinOptions) => renderToStaticMarkup(createElement(VaseFields, { bin: o, value: sanitizeVase(o.containers?.vase), onChange: () => {}, onBinChange: () => {} }));

  it('shows the dividers, the wall line for the nozzle, the slicer settings and what a vase bin leaves out', () => {
    const html = fields(vase({ unitsX: 2 }, { dividers: 2 }));
    expect(html).toContain('3 sections');
    expect(html).toContain('Front to back');
    expect(html).toContain('0.6 mm suits the 0.4 mm nozzle');
    expect(html).not.toContain('use it');
    expect(html).toContain('bottom layers up to 6 mm (30 at 0.2 mm');
    expect(html).toContain('no scoop, label tab');
    // Another line width offers the nozzle's.
    expect(fields(vase({}, { line: 0.45 }))).toContain('use it');
    // A flat bin's spiral starts on its floor.
    expect(fields(vase({ base: 'flat' }))).toContain('bottom layers up to 1 mm (5 at 0.2 mm)');
  });

  it('offers feet or a flat bottom, not the hollow base styles', () => {
    const html = renderToStaticMarkup(createElement(BaseField, { opts: vase({ base: 'lite' }), onChange: () => {} }));
    expect(html).toContain('Feet');
    expect(html).toContain('Flat');
    expect(html).not.toContain('Lite');
    expect(html).not.toContain('Efficient');
  });
});
