/**
 * Generate a full drawer kit from the command line and sanity-check every mesh.
 *
 *   npm run sample -- [outDir]
 *
 * Uses the same code as the web app. Writes a Bambu Studio project, per-plate
 * 3MFs, and a single bin, then prints plate/part stats.
 */
import Module from 'manifold-3d';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_BIN,
  DEFAULT_PROJECT,
  buildMesh,
  exportBambuProject,
  exportPlatesZip,
  exportSingle3MF,
  planJob,
  type ProjectState,
} from '../src/lib/project';
import { meshBounds, type MeshData } from '../src/lib/geometry/kernel';
import { assemblyMap } from '../src/lib/layout/plan';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { POCKET_PRESETS, presetFields } from '../src/lib/geometry/pockets';
import { FONT_URL_PATH, registerFont } from '../src/lib/geometry/text';

const outDir = resolve(process.argv[2] ?? 'out');
mkdirSync(outDir, { recursive: true });

const wasm = await Module();
const fontBytes = readFileSync(resolve('public', FONT_URL_PATH));
registerFont(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));
wasm.setup();

const state: ProjectState = {
  ...DEFAULT_PROJECT,
  baseplate: { ...DEFAULT_BASEPLATE, connector: 'bowtie' },
  bins: [
    { id: 'a', x: 0, y: 0, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 1, heightUnits: 3, divX: 2, scoop: 0.7, label: 'full' } },
    { id: 'b', x: 2, y: 0, opts: { ...DEFAULT_BIN, unitsX: 1, unitsY: 1, heightUnits: 6, holes: 'magnets' } },
    { id: 'c', x: 3, y: 0, opts: { ...DEFAULT_BIN, unitsX: 3, unitsY: 2, heightUnits: 4, divX: 3, divY: 2, label: 'left' } },
    { id: 'd', x: 6, y: 0, opts: { ...DEFAULT_BIN, unitsX: 1, unitsY: 1, heightUnits: 2, lip: false, holes: 'both' } },
    { id: 'e', x: 7, y: 0, opts: { ...DEFAULT_BIN, unitsX: 1, unitsY: 1, heightUnits: 6, holes: 'magnets' } },
    // Variants: bases, lips, holes, height modes, walls, pocket grid, lids.
    {
      id: 'f',
      x: 0,
      y: 2,
      opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, base: 'lite', lipNotches: true, holes: 'both', holePrintable: true, holeCorners: true, divX: 2, lid: true },
    },
    { id: 'g', x: 2, y: 2, opts: { ...DEFAULT_BIN, base: 'flat', cutoutWalls: 'f', heightUnits: 4 } },
    {
      id: 'h',
      x: 3,
      y: 2,
      opts: { ...DEFAULT_BIN, unitsX: 2, heightUnits: 6, interior: 'pockets', lipStyle: 'reduced', ...presetFields(POCKET_PRESETS[0]) },
    },
    {
      id: 'i',
      x: 5,
      y: 2,
      opts: { ...DEFAULT_BIN, unitsX: 2, heightMode: 'external', heightMm: 40, holes: 'refined', slideWalls: 'f', lid: true },
    },
    { id: 'j', x: 7, y: 2, opts: { ...DEFAULT_BIN, base: 'efficient', holes: 'magnets', holeCrushRibs: true, holeChamfer: true } },
    { id: 'k', x: 8, y: 2, opts: { ...DEFAULT_BIN, unitsX: 2, unitsY: 2, heightUnits: 8, patternWalls: 'fblr', divX: 2 } },
  ],
};

const t0 = performance.now();
const job = planJob(state);
console.log(`Plan: ${job.layout.nx}×${job.layout.ny} cells, plate ${job.layout.plateW}×${job.layout.plateD} mm`);
console.log('Margins', job.layout.margins);
console.log(
  `Pieces: ${job.plan.pieces.length} (${job.plan.cols}×${job.plan.rows}), connector keys: ${job.connectors.length}, plates: ${job.plates.length}`,
);
if (job.warnings.length) console.log('Warnings:', job.warnings);
console.log(assemblyMap(job.layout, job.plan, job.connectors.length));

const cache = new Map<string, MeshData>();
let ok = true;
for (const [key, spec] of Object.entries(job.meshes)) {
  const t = performance.now();
  const mesh = buildMesh(wasm, spec);
  cache.set(key, mesh);
  const b = meshBounds(mesh);
  // Re-import to check the mesh is a valid closed manifold.
  const m = wasm.Manifold.ofMesh(
    new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }),
  );
  const parts = m.decompose();
  const info = {
    status: m.status(),
    tris: mesh.indices.length / 3,
    volume: Math.round(m.volume()),
    genus: m.genus(),
    components: parts.length,
    size: b.max.map((v, i) => Math.round((v - b.min[i]) * 100) / 100),
    ms: Math.round(performance.now() - t),
  };
  parts.forEach((p) => p.delete());
  m.delete();
  if (info.status !== 'NoError' || info.components !== 1) ok = false;
  const label = spec.kind === 'piece' ? `piece ${spec.piece.id} (${spec.connectors.length} pockets)` : `${spec.kind} ${spec.key}`;
  console.log(label, JSON.stringify(info));
}

const getMesh = (k: string) => cache.get(k)!;
const settingsPath = resolve('public/bambu', `${state.setup.printerId}.json`);
const settings = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : undefined;
writeFileSync(join(outDir, 'drawer-bambu-project.3mf'), exportBambuProject(job, state.setup, getMesh, settings));
writeFileSync(join(outDir, 'drawer-plates.zip'), exportPlatesZip(job, state.setup, getMesh));
const firstBin = Object.values(job.meshes).find((m) => m.kind === 'bin')!;
writeFileSync(join(outDir, 'single-bin.3mf'), exportSingle3MF('bin', getMesh(firstBin.key)));
console.log(`Done in ${Math.round(performance.now() - t0)} ms → ${outDir}`);
job.plates.forEach((pl, i) =>
  console.log(
    `Plate ${i + 1} ${pl.name}:`,
    pl.placements
      .filter((p) => job.parts[p.key].kind !== 'key')
      .map((p) => `${p.key}@(${p.x.toFixed(1)},${p.y.toFixed(1)})${p.rotated ? 'R' : ''}`)
      .join(' '),
    pl.placements.some((p) => job.parts[p.key].kind === 'key')
      ? `+ ${pl.placements.filter((p) => job.parts[p.key].kind === 'key').length} keys`
      : '',
  ),
);
// Baseplate variants: every style and joint, magnet extras and blocked cells,
// on a drawer with partial edge cells. One plates zip per variant.
const variantDrawer = { ...state.drawer, width: 320, depth: 270, fill: 'fit' as const, alignX: 0, alignY: 0 };
const variants: [string, Partial<ProjectState['drawer']>, Partial<ProjectState['baseplate']>][] = [
  ['weighted-puzzle', {}, { style: 'weighted', connector: 'puzzle', magnets: true, magnetRibs: true, magnetChamfer: true, magnetSlot: true }],
  ['skeleton-screws', {}, { style: 'skeletonized', connector: 'screw', magnets: true, screws: true }],
  [
    'solid-pins-cutout',
    { mask: ['0,0', '3,2', '7,5'], maskStyle: 'void' },
    { style: 'solid', connector: 'pin', magnets: true, magnetSide: 'bottom', magnetChamfer: true },
  ],
  ['frame-bowtie-filled', { mask: ['2,2', '2,3'], maskStyle: 'solid' }, { connector: 'bowtie', screws: true }],
  ['frame-inserts', {}, { connector: 'screw', screwFastener: 'insert', magnets: true, magnetRelease: true, bottomChamfer: 0.6 }],
];
const variantDir = join(outDir, 'baseplate-variants');
mkdirSync(variantDir, { recursive: true });
for (const [name, d, bp] of variants) {
  const t = performance.now();
  const v: ProjectState = {
    ...state,
    drawer: { ...variantDrawer, ...d },
    baseplate: { ...DEFAULT_BASEPLATE, ...bp },
    bins: [],
    include: { baseplate: true, bins: false },
  };
  const vjob = planJob(v);
  const meshes = new Map<string, MeshData>();
  const bad: string[] = [];
  for (const [key, spec] of Object.entries(vjob.meshes)) {
    const mesh = buildMesh(wasm, spec);
    meshes.set(key, mesh);
    const m = wasm.Manifold.ofMesh(new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
    const parts = m.decompose();
    if (m.status() !== 'NoError' || parts.length !== 1) bad.push(`${spec.kind === 'piece' ? `piece ${spec.piece.id}` : spec.key}: ${m.status()}, ${parts.length} components`);
    parts.forEach((p) => p.delete());
    m.delete();
  }
  if (bad.length) ok = false;
  writeFileSync(join(variantDir, `${name}.zip`), exportPlatesZip(vjob, v.setup, (k) => meshes.get(k)!));
  console.log(
    `Variant ${name}: ${vjob.layout.nx}×${vjob.layout.ny} cells, ${vjob.plan.pieces.length} pieces, ${vjob.sites.length} joints, ` +
      `${vjob.plates.length} plates, ${Math.round(performance.now() - t)} ms${bad.length ? ` — BAD: ${bad.join('; ')}` : ''}`,
  );
}

if (!ok) {
  console.error('Some meshes are invalid or have more than one component');
  process.exit(1);
}
