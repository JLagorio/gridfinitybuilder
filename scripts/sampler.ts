/**
 * Print every kind of part Gridfit makes and check each one.
 *
 *   npm run sampler -- [outDir] [--slice] [--only <text>] [--jobs <n>]
 *
 * Plans the groups in scripts/sampler-cases.ts with the app's own code
 * (planPrint / planTestFit, buildMesh), writes each printed part as its own
 * binary STL (overlays such as inlaid text included, as the app's STL export
 * does) and each baseplate plate as a 3MF, then runs the print checks of
 * src/lib/geometry/printcheck.ts on every part.
 *
 * --slice also slices every STL with PrusaSlicer (0.4 mm nozzle, 0.2 mm
 * layers, the default printer's bed) and records its warnings and `--info`
 * (manifold, repairs, parts). Vase-mode bins are sliced in spiral vase mode
 * with the bottom layers and wall line they are drawn for, and their G-code is
 * read back to check that it is one continuous spiral (scripts/gcode-spiral.ts). Boards and wall attachments
 * (scripts/sampler-boards.ts) are sampled the same way, and faces hanging past 45° are listed for a look
 * (scripts/sampler-steep.ts). --only keeps groups or parts whose path contains
 * the text. Results go to report.json and report.md in outDir (see
 * docs/print-check.md); findings listed in KNOWN_FINDINGS are marked as by
 * design. `--report <report.json>` only writes report.md again from a run.
 *
 * Multi-colour groups (colours/…, colours.ts) also write every plate as a 3MF
 * in its colours. With --slice, PrusaSlicer slices each one: by part and by
 * feature with a profile of as many extruders as the palette has slots
 * (single-extruder multi-material with a wipe tower), by height with the
 * single-extruder profile; the report says which tools printed and where the
 * colour changes (M600) came, against what the plate asks for.
 */
import Module from 'manifold-3d';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildMesh, setWallBuilders, type PrintJob } from '../src/lib/project';
import * as wallBuild from '../src/lib/wall/build';
import { setGridBoardBuilders } from '../src/lib/gridBoards';
import * as gridBuild from '../src/lib/geometry/gridBoardBuild';
import { exportPlate3MF } from '../src/lib/export/threemf';
import { meshBodySlots, plateChanges } from '../src/lib/export/colourExport';
import { LAYERS, layerTop, paletteOf, strategyOf } from '../src/lib/colours';
import { meshBounds, type MeshData } from '../src/lib/geometry/kernel';
import { checkPart, meshTopology, type PrintIssue } from '../src/lib/geometry/printcheck';
import { FONT_URL_PATH, registerFont } from '../src/lib/geometry/text';
import { writeSTL } from '../src/lib/export/stl';
import { usableBed } from '../src/lib/bedfit';
import { KNOWN_FINDINGS, SAMPLE_GROUPS, SAMPLE_SETUP, printedParts } from './sampler-cases';
import { setSamplerWasm } from './sampler-boards';
import { spiralReport, type SpiralReport } from './gcode-spiral';
import { steepFaces, type SteepRegion } from './sampler-steep';
import { vaseBottomLayers, type SpiralPrint } from '../src/lib/geometry/containers/vase';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--only', '--jobs', '--report'].includes(args[i - 1]));
const fromReport = value('--report');
const outDir = resolve(fromReport ? dirname(fromReport) : (positional[0] ?? 'out/sampler'));
const only = value('--only');
const jobs = Math.max(1, Number(value('--jobs')) || Math.max(1, Math.floor(cpus().length / 2)));
const slice = flag('--slice');

const wasm = await Module();
const fontBytes = readFileSync(resolve('public', FONT_URL_PATH));
registerFont(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));
wasm.setup();
// Attachments' and grid boards' builders, as the geometry worker hands them to buildMesh; an imported model's sample needs the kernel to plan.
setWallBuilders(wallBuild);
setGridBoardBuilders(gridBuild);
setSamplerWasm(wasm);

interface SlicerResult {
  ok: boolean;
  /** Warnings and errors PrusaSlicer printed (progress lines and Arachne's internal retries left out). */
  messages: string[];
  /** Its "print stability issues" (support-spot check): "Loose extrusions", "Floating bridge anchors", … */
  stability: string[];
  /** Log lines left out as noise. */
  noise: number;
  /** `--info` fields: manifold, number_of_parts, facets_removed, open_edges, … */
  info: Record<string, string>;
  /** Vase-mode bins: the G-code read back (spiral vase mode). */
  spiral?: SpiralReport;
}

interface PartRecord {
  group: string;
  file: string;
  part: string;
  name: string;
  kind: string;
  /** Other parts of the job with the same mesh. */
  same: string[];
  size: number[];
  triangles: number;
  volume: number;
  /** Bodies in the overlays (inlaid text, shadow floors). */
  overlayBodies: number;
  contact?: number;
  ms: number;
  issues: PrintIssue[];
  error?: string;
  slicer?: SlicerResult;
  /** Vase-mode bins: how they print (sliced in spiral vase mode). */
  spiral?: SpiralPrint;
  /** Faces hanging past 45° (sampler-steep.ts), for a look. */
  steep?: SteepRegion[];
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A multi-colour plate: what it asks for, and what PrusaSlicer made of it. */
interface ColourPlateRecord {
  group: string;
  file: string;
  strategy: string;
  /** Filament slots its bodies print in. */
  slots: number[];
  /** By height: where the colour changes (print_z of the first layer in the new colour). */
  changes: number[];
  /** A spiral plate's one vase bin: sliced in spiral vase mode. */
  spiral?: SpiralPrint;
  slicer?: { ok: boolean; tools: number[]; m600: number[]; messages: string[]; spiral?: SpiralReport };
}

const bed = usableBed(SAMPLE_SETUP);
const records: PartRecord[] = [];
const colourPlates: ColourPlateRecord[] = [];
/** Attachments put together as the drawer view shows them (assemble): how many, and pieces of one that run into each other. */
const assembled = { checked: 0, overlaps: [] as { file: string; a: string; b: string; volume: number }[] };
const warnings: Record<string, string[]> = {};
const t0 = performance.now();
mkdirSync(outDir, { recursive: true });
if (fromReport) {
  if (!existsSync(fromReport)) throw new Error(`No report at ${fromReport}`);
  const saved = JSON.parse(readFileSync(fromReport, 'utf8')) as { warnings: typeof warnings; parts: PartRecord[]; assembled?: typeof assembled };
  records.push(...saved.parts);
  Object.assign(warnings, saved.warnings);
  if (saved.assembled) Object.assign(assembled, saved.assembled);
}

for (const group of fromReport ? [] : SAMPLE_GROUPS) {
  // Planning is cheap: plan every group and filter its parts by path.
  const job = group.job();
  if (job.warnings.length) warnings[group.name] = job.warnings;
  const dir = join(outDir, group.name);
  // Attachments' meshes, to put each together after (assemble).
  const built = new Map<string, MeshData>();
  for (const { part, file, same } of printedParts(group, job)) {
    if (only && !file.includes(only)) continue;
    const rec: PartRecord = { group: group.name, file, part: part.key, name: part.name, kind: part.kind, same, size: [], triangles: 0, volume: 0, overlayBodies: 0, ms: 0, issues: [] };
    if (part.spiral) rec.spiral = part.spiral;
    records.push(rec);
    const t = performance.now();
    let mesh: MeshData;
    try {
      mesh = buildMesh(wasm, job.meshes[part.meshKey]);
    } catch (e) {
      rec.error = String((e as Error).message ?? e);
      console.log(`✗ ${file}: build failed: ${rec.error}`);
      continue;
    }
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    writeFileSync(join(outDir, file), writeSTL([{ mesh }], part.name));
    // The body and its overlays together (a part split by colour is several volumes).
    const all = [mesh, ...(mesh.overlays ?? [])].map((m) => meshBounds(m));
    const b = { min: [0, 1, 2].map((k) => Math.min(...all.map((x) => x.min[k]))), max: [0, 1, 2].map((k) => Math.max(...all.map((x) => x.max[k]))) };
    rec.size = b.max.map((v, i) => r2(v - b.min[i]));
    const check = checkPart(wasm, mesh, { bed });
    rec.triangles = check.topology.triangles;
    rec.volume = r2(check.topology.volume);
    rec.overlayBodies = (mesh.overlays ?? []).reduce((n, o) => n + meshTopology(o).components.length, 0);
    rec.contact = check.slices?.contact;
    rec.issues = check.issues;
    const faces = steepFaces(mesh);
    if (faces.length) rec.steep = faces;
    if (part.kind === 'attachment') built.set(part.meshKey, mesh);
    rec.ms = Math.round(performance.now() - t);
    const errors = check.issues.filter((i) => i.severity === 'error').length;
    const warns = check.issues.length - errors;
    console.log(`${errors ? '✗' : warns ? '~' : '✓'} ${file} ${rec.size.join('×')} ${rec.ms} ms${check.issues.length ? `: ${check.issues.map((i) => i.message).join(' | ')}` : ''}`);
  }
  if (built.size) assemble(job, group.name, built);
  // Multi-colour groups: every plate as a 3MF in its colours.
  if (group.setup && strategyOf(group.setup) && (!only || group.name.includes(only))) {
    const cache = new Map<string, MeshData>();
    const get = (k: string) => cache.get(k) ?? cache.set(k, buildMesh(wasm, job.meshes[k])).get(k)!;
    mkdirSync(dir, { recursive: true });
    job.plates.forEach((pl, i) => {
      const file = join(group.name, `plate-${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.3mf`);
      writeFileSync(join(outDir, file), exportPlate3MF(job, i, get));
      const ch = plateChanges(group.setup!, job, i);
      const slots = new Set<number>(ch ? [ch.base, ...ch.changes.map((c) => c.slot)] : []);
      if (!ch) for (const p of pl.placements) for (const s of meshBodySlots(group.setup!, job, p.key, get(job.parts[p.key].meshKey))) slots.add(s);
      const spiral = pl.spiral && pl.placements.length === 1 ? job.parts[pl.placements[0].key].spiral : undefined;
      colourPlates.push({
        group: group.name,
        file,
        strategy: strategyOf(group.setup!)!,
        slots: [...slots].sort((a, b) => a - b),
        changes: (ch?.changes ?? []).map((c) => layerTop(c.z, LAYERS)),
        ...(spiral ? { spiral } : {}),
      });
    });
  }
  // Baseplate plates (pieces and keys as laid out) as 3MF, for a slicer that wants the whole plate.
  if (!only || group.name.includes(only)) {
    job.plates.forEach((pl, i) => {
      if (pl.group !== 'baseplate') return;
      const cache = new Map<string, MeshData>();
      const get = (k: string) => cache.get(k) ?? cache.set(k, buildMesh(wasm, job.meshes[k])).get(k)!;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `plate-${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.3mf`), exportPlate3MF(job, i, get));
    });
  }
}
/**
 * Each attachment put together as the drawer view shows it (wall/parts.ts: its body, its extra parts where they sit,
 * its lock keys and T-nuts): no two of its pieces may share more than 0.05 mm³. Only where all its meshes were built.
 */
function assemble(job: PrintJob, group: string, built: Map<string, MeshData>): void {
  for (const d of job.drawers) {
    const items = (d.enclosure?.items ?? []).filter((it) => it.role === 'attachment');
    for (const pick of new Set(items.map((it) => it.pick))) {
      const mine = items.filter((it) => it.pick === pick);
      if (mine.length < 2 || mine.some((it) => !built.has(it.meshKey))) continue;
      const solids = mine.map((it) => {
        const mesh = built.get(it.meshKey)!;
        const m = wasm.Manifold.ofMesh(new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
        const r = it.turn ? m.rotate(it.turn) : m;
        const b = r.boundingBox();
        const out = r.translate([it.x - b.min[0], it.y - b.min[1], it.z - b.min[2]]);
        if (r !== m) r.delete();
        m.delete();
        return { id: it.id, m: out };
      });
      assembled.checked++;
      for (let i = 0; i < solids.length; i++)
        for (let j = i + 1; j < solids.length; j++) {
          const both = solids[i].m.intersect(solids[j].m);
          const volume = both.volume();
          both.delete();
          if (volume > 0.05) {
            const file = `${group}/${d.id}`;
            assembled.overlaps.push({ file, a: solids[i].id, b: solids[j].id, volume: r2(volume) });
            console.log(`✗ ${file}: ${solids[i].id} and ${solids[j].id} share ${r2(volume)} mm³ where they sit`);
          }
        }
      for (const x of solids) x.m.delete();
    }
  }
}

if (!fromReport) console.log(`Built and checked ${records.length} parts in ${Math.round((performance.now() - t0) / 1000)} s.`);

// ---------------------------------------------------------------------------
// PrusaSlicer
// ---------------------------------------------------------------------------

const PRUSA = process.env.PRUSA_SLICER ?? '/usr/bin/prusa-slicer';
const ini = join(outDir, 'prusaslicer.ini');

function run(argv: string[]): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const p = spawn(PRUSA, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 600_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      res({ code: code ?? -1, out });
    });
  });
}

async function sliceOne(rec: PartRecord): Promise<void> {
  const stl = join(outDir, rec.file);
  const info = await run(['--info', stl]);
  const fields: Record<string, string> = {};
  for (const m of info.out.matchAll(/^(\w+) = (.*)$/gm)) fields[m[1]] = m[2].trim();
  const gcode = stl.replace(/\.stl$/, '.gcode');
  // Vase-mode bins: spiral vase, one wall of their line, bottom layers up to the spiral's start.
  const bottom = rec.spiral ? vaseBottomLayers(rec.spiral.start, 0.2, 0.2) : 0;
  const vase = rec.spiral
    ? ['--spiral-vase', '--perimeters', '1', '--top-solid-layers', '0', '--fill-density', '0%', '--bottom-solid-layers', String(bottom), '--external-perimeter-extrusion-width', String(rec.spiral.line), '--perimeter-extrusion-width', String(rec.spiral.line)]
    : [];
  const s = await run(['--loglevel', '2', '--load', ini, ...vase, '--export-gcode', '--output', gcode, stl]);
  const spiral = rec.spiral && s.code === 0 && existsSync(gcode) ? spiralReport(readFileSync(gcode, 'utf8'), bottom) : undefined;
  rmSync(gcode, { force: true });
  const lines = s.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+ => /.test(l) && !/^Slicing result exported to/.test(l) && l !== rec.file.split('/').pop());
  const messages: string[] = [];
  const stability: string[] = [];
  let noise = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // "Detected print stability issues:", then the object's name, the issues, and "Consider enabling supports."
    if (/^print warning: Detected print stability issues/.test(l)) {
      for (i++; i < lines.length && !/^(Consider|Also consider)/.test(lines[i]); i++) stability.push(...lines[i].split(/,\s*/));
      while (i + 1 < lines.length && /^(Consider|Also consider)/.test(lines[i + 1])) i++;
      continue;
    }
    if (/^(Consider|Also consider)/.test(l)) continue;
    // PrusaSlicer's own log lines ("[time] [thread] [level] text"): Arachne retrying a Voronoi diagram is its internal noise.
    const log = /^\[[^\]]*\] \[[^\]]*\] \[(\w+)\]\s*(.*)$/.exec(l);
    if (log && /Voronoi|wall line causes/.test(log[2])) noise++;
    else messages.push(log ? `${log[1]}: ${log[2]}` : l);
  }
  rec.slicer = { ok: s.code === 0, messages, stability, noise, info: fields, ...(spiral ? { spiral } : {}) };
  const bad = !rec.slicer.ok || messages.length || stability.length || fields.manifold !== 'yes';
  const notes = [...stability.map((t) => `stability: ${t}`), ...messages];
  const sp = spiral ? `, spiral ${spiral.continuous}/${spiral.spiral} layers continuous after ${spiral.bottom} bottom layers, turn ${spiral.turn} mm` : '';
  console.log(`${bad ? '!' : '·'} ${rec.file}: ${fields.manifold === 'yes' ? 'manifold' : `manifold=${fields.manifold}`}, parts ${fields.number_of_parts}${sp}${notes.length ? `, ${notes.join('; ')}` : ''}`);
}

if (slice && !fromReport) {
  // 0.4 mm nozzle, 0.2 mm layers (first layer too), Bambu-like walls and infill, no supports; the default printer's bed.
  writeFileSync(
    ini,
    [
      `bed_shape = 0x0,${SAMPLE_SETUP.bedW}x0,${SAMPLE_SETUP.bedW}x${SAMPLE_SETUP.bedD},0x${SAMPLE_SETUP.bedD}`,
      `max_print_height = ${SAMPLE_SETUP.maxH}`,
      'nozzle_diameter = 0.4',
      'layer_height = 0.2',
      'first_layer_height = 0.2',
      'perimeters = 2',
      'top_solid_layers = 5',
      'bottom_solid_layers = 3',
      'fill_density = 15%',
      'fill_pattern = grid',
      'support_material = 0',
      'gcode_flavor = marlin2',
      'filament_diameter = 1.75',
      '',
    ].join('\n'),
  );
  // Multi-colour plates: as many extruders as the palette has slots (single-extruder multi-material, a wipe tower).
  const slotsUsed = Math.max(2, ...colourPlates.flatMap((c) => c.slots));
  const mmIni = join(outDir, 'prusaslicer-mm.ini');
  const many = (v: string) => Array(slotsUsed).fill(v).join(',');
  const pal = paletteOf({ filaments: undefined }, slotsUsed).map((f) => f.colour);
  writeFileSync(
    mmIni,
    [
      // The one-extruder settings, less those that now come once per extruder.
      ...readFileSync(ini, 'utf8').trim().split('\n').filter((l) => !/^(nozzle_diameter|filament_diameter|bed_shape) =/.test(l)),
      // A full plate leaves no room for the wipe tower: a bigger bed, the tower past the plate's corner.
      `bed_shape = 0x0,${SAMPLE_SETUP.bedW + 120}x0,${SAMPLE_SETUP.bedW + 120}x${SAMPLE_SETUP.bedD + 120},0x${SAMPLE_SETUP.bedD + 120}`,
      `wipe_tower_x = ${SAMPLE_SETUP.bedW + 40}`,
      `wipe_tower_y = ${SAMPLE_SETUP.bedD + 40}`,
      `nozzle_diameter = ${many('0.4')}`,
      `filament_diameter = ${many('1.75')}`,
      `extruder_offset = ${many('0x0')}`,
      `retract_length = ${many('0.8')}`,
      `retract_lift = ${many('0.4')}`,
      `temperature = ${many('215')}`,
      `first_layer_temperature = ${many('215')}`,
      `extruder_colour = ${pal.map((c) => `"${c}"`).join(';')}`,
      `filament_colour = ${pal.map((c) => `"${c}"`).join(';')}`,
      'single_extruder_multi_material = 1',
      'wipe_tower = 1',
      'use_relative_e_distances = 1',
      'layer_gcode = G92 E0',
      '',
    ].join('\n'),
  );
  for (const c of colourPlates) {
    const src = join(outDir, c.file);
    const gcode = src.replace(/\.3mf$/, '.gcode');
    // A vase bin's plate: spiral vase mode, as for the vase parts.
    const bottom = c.spiral ? vaseBottomLayers(c.spiral.start, 0.2, 0.2) : 0;
    const vase = c.spiral
      ? ['--spiral-vase', '--perimeters', '1', '--top-solid-layers', '0', '--fill-density', '0%', '--bottom-solid-layers', String(bottom), '--external-perimeter-extrusion-width', String(c.spiral.line), '--perimeter-extrusion-width', String(c.spiral.line)]
      : [];
    const s = await run(['--loglevel', '1', '--load', c.strategy === 'height' ? ini : mmIni, ...vase, '--dont-arrange', '--export-gcode', '--output', gcode, src]);
    const spiral = c.spiral && s.code === 0 && existsSync(gcode) ? spiralReport(readFileSync(gcode, 'utf8'), bottom) : undefined;
    const tools = new Set<number>();
    const m600: number[] = [];
    let z = 0;
    let started = false;
    let current = 0;
    if (existsSync(gcode)) {
      for (const line of readFileSync(gcode, 'utf8').split('\n')) {
        const zm = /^;Z:([\d.]+)/.exec(line);
        // Tools that print: the one each layer starts with, and the ones it changes to (the start G-code primes them all).
        if (zm) {
          z = Number(zm[1]);
          started = true;
          tools.add(current + 1);
        }
        const t = /^T(\d+)\s*$/.exec(line);
        if (t) {
          current = Number(t[1]);
          if (started) tools.add(current + 1);
        }
        if (/^M600\b/.test(line)) m600.push(z);
      }
      rmSync(gcode, { force: true });
    }
    const messages = s.out.split('\n').map((l) => l.trim()).filter((l) => l && !/^\d+ => /.test(l) && !/^Slicing result exported/.test(l));
    c.slicer = { ok: s.code === 0, tools: [...tools].sort((a, b) => a - b), m600, messages, ...(spiral ? { spiral } : {}) };
    const want = c.strategy === 'height' ? `M600 at ${c.changes.join(', ') || 'none'}` : `tools ${c.slots.join(', ')}`;
    const got = c.strategy === 'height' ? `M600 at ${m600.join(', ') || 'none'}` : `tools ${c.slicer.tools.join(', ')}`;
    const sp = spiral ? `, spiral vase ${spiral.continuous}/${spiral.spiral} layers continuous` : c.spiral ? ', spiral vase: no G-code' : '';
    const good = want === got && s.code === 0 && (!c.spiral || (!!spiral && spiral.continuous === spiral.spiral));
    console.log(`${good ? '·' : '!'} ${c.file}: wants ${want}, sliced ${got}${sp}${messages.length ? `; ${messages.slice(0, 2).join(' | ')}` : ''}`);
  }
  const queue = records.filter((r) => !r.error);
  const t1 = performance.now();
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) await sliceOne(r);
    }),
  );
  console.log(`Sliced ${records.filter((r) => r.slicer).length} parts in ${Math.round((performance.now() - t1) / 1000)} s.`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (!fromReport) writeFileSync(join(outDir, 'report.json'), JSON.stringify({ setup: SAMPLE_SETUP, bed, warnings, parts: records, colourPlates, assembled }, null, 1));
const sliced = records.some((r) => r.slicer);

/** Why a finding is there by design (KNOWN_FINDINGS), or null. `what` is the issue kind or the slicer finding. */
const known = (r: PartRecord, what: string) => KNOWN_FINDINGS.find((k) => k.file.test(r.file) && k.what.test(what))?.why ?? null;
const note = (r: PartRecord, what: string, text: string) => {
  const why = known(r, what);
  return why ? `${text} — by design: ${why}` : text;
};

const md: string[] = ['# Sampler report', '', `${records.length} parts, ${new Date().toISOString()}`, ''];
const errored = records.filter((r) => r.error || r.issues.some((i) => i.severity === 'error'));
const warned = records.filter((r) => !errored.includes(r) && r.issues.length);
const unexplained = records.filter((r) => r.issues.some((i) => !known(r, i.kind)) || slicerFindings(r).some((f) => !known(r, f)));
/** What PrusaSlicer had to say: failures, repairs, unexpected part counts, stability issues, other warnings. */
function slicerFindings(r: PartRecord): string[] {
  const sl = r.slicer;
  if (!sl) return [];
  const info = sl.info;
  const out: string[] = [];
  if (!sl.ok) out.push('slicing failed');
  if (info.manifold !== 'yes') out.push(`not manifold (${['open_edges', 'facets_reversed', 'backwards_edges', 'edges_fixed'].filter((k) => info[k]).map((k) => `${k} ${info[k]}`).join(', ')})`);
  // The body plus one shell per overlay body (inlaid letters…).
  const parts = Number(info.number_of_parts);
  if (parts !== 1 + r.overlayBodies) out.push(`${parts} parts (expected ${1 + r.overlayBodies})`);
  out.push(...sl.stability.map((t) => `stability: ${t}`), ...sl.messages);
  // Vase-mode bins: one continuous spiral, going round every slit (the turn is the outline plus both sides of each).
  if (r.spiral && !sl.spiral && sl.ok) out.push('spiral: no G-code to read');
  if (r.spiral && sl.spiral) {
    const g = sl.spiral;
    if (!g.spiral) out.push('spiral: no layers after the bottom layers');
    if (g.firstBreak) out.push(`spiral: ${g.spiral - g.continuous} of ${g.spiral} layers not one continuous line, from layer ${g.firstBreak.layer} (z ${g.firstBreak.z}): ${g.firstBreak.why}`);
    // The slicer's line runs half a line inside the outline: a turn is a few mm shorter than the outline.
    if (Math.abs(g.turn - r.spiral.path) > 0.03 * r.spiral.path) out.push(`spiral: a turn is ${g.turn} mm, the outline and slits ${r.spiral.path} mm`);
  }
  return out;
}
const slicerNotes = records.filter((r) => slicerFindings(r).length);
md.push(`- ${errored.length} with errors, ${warned.length} with warnings only`);
md.push(`- ${unexplained.length} with findings not marked as by design`);
if (sliced) md.push(`- ${slicerNotes.length} with PrusaSlicer findings; ${records.filter((r) => Number(r.slicer?.info.degenerate_facets) > 0).length} had zero-area facets it removed`);
md.push(`- ${records.filter((r) => r.steep?.length).length} with faces past 45° (listed for a look, not findings)`);
if (assembled.checked) md.push(`- ${assembled.checked} attachments with extra parts put together: ${assembled.overlaps.length} pairs of pieces run into each other`);
md.push('');
for (const [title, list] of [
  ['Errors', errored],
  ['Warnings', warned],
] as const) {
  if (!list.length) continue;
  md.push(`## ${title}`, '');
  for (const r of list) {
    md.push(`- \`${r.file}\` (${r.name}, ${r.size.join(' × ')} mm)`);
    if (r.error) md.push(`  - build failed: ${r.error}`);
    for (const i of r.issues) md.push(`  - ${note(r, i.kind, `${i.severity} ${i.kind}: ${i.message}`)}`);
  }
  md.push('');
}
if (assembled.overlaps.length) {
  md.push('## Assembled', '', 'Pieces of an attachment that run into each other where they sit (its body, extra parts, lock keys, T-nuts).', '');
  for (const o of assembled.overlaps) md.push(`- \`${o.file}\`: ${o.a} and ${o.b} share ${o.volume} mm³`);
  md.push('');
}
if (slicerNotes.length) {
  md.push('## PrusaSlicer', '');
  for (const r of slicerNotes) {
    md.push(`- \`${r.file}\``);
    for (const m of slicerFindings(r)) md.push(`  - ${note(r, m, m)}`);
  }
  md.push('');
}
if (Object.keys(warnings).length) {
  md.push('## Planning warnings', '');
  for (const [g, list] of Object.entries(warnings)) for (const w of list) md.push(`- ${g}: ${w}`);
  md.push('');
}
if (colourPlates.length) {
  md.push('## Multi-colour plates', '', '| Plate | Way | Slots | Colour changes | PrusaSlicer |', '|---|---|---|---|---|');
  for (const c of colourPlates) {
    const sl = c.slicer;
    const sp = sl?.spiral ? `; spiral vase, ${sl.spiral.continuous}/${sl.spiral.spiral} layers continuous` : '';
    const res = !sl ? '' : (c.strategy === 'height' ? `M600 at ${sl.m600.join(', ') || 'none'}` : `tools ${sl.tools.join(', ')}`) + sp;
    const ok = !sl || (sl.ok && (c.strategy === 'height' ? sl.m600.join() === c.changes.join() : sl.tools.join() === c.slots.join()));
    md.push(`| \`${c.file}\` | ${c.strategy} | ${c.slots.join(', ')} | ${c.changes.join(', ')} | ${sl ? `${ok ? 'as asked' : 'differs'}: ${res}` : ''} |`);
  }
  md.push('');
}
const steep = records.filter((r) => r.steep?.length);
if (steep.length) {
  md.push(
    '## Faces past 45°',
    '',
    'Faces hanging between 45° and flat, off the first layer (scripts/sampler-steep.ts): the layer checks only see flat ledges. For a look, not counted as findings; round holes and pegs lying down show here and print without support up to about 10 mm across.',
    '',
  );
  for (const r of steep) {
    md.push(`- \`${r.file}\``);
    for (const g of r.steep!) md.push(`  - ${note(r, 'steep', `${g.area} mm² up to ${g.angle}° at z ${g.z.join('–')} (x ${g.min[0]}–${g.max[0]}, y ${g.min[1]}–${g.max[1]})`)}`);
  }
  md.push('');
}
const vases = records.filter((r) => r.slicer?.spiral);
if (vases.length) {
  md.push('## Spiral vase', '', 'Vase-mode bins sliced in spiral vase mode, their G-code read back.', '');
  md.push('| Part | Layers | Bottom layers | Spiral layers continuous | One turn (mm) | Outline + slits (mm) |', '|---|---|---|---|---|---|');
  for (const r of vases) {
    const g = r.slicer!.spiral!;
    md.push(`| \`${r.file}\` | ${g.layers} | ${g.bottom} | ${g.continuous} / ${g.spiral} | ${g.turn} | ${r.spiral?.path ?? ''} |`);
  }
  md.push('');
}
md.push('## Parts', '', '| Part | Size (mm) | Triangles | Contact (mm²) | Issues | Slicer |', '|---|---|---|---|---|---|');
for (const r of records) {
  const sl = r.slicer ? slicerFindings(r).join('; ') || 'ok' : '';
  md.push(`| \`${r.file}\` | ${r.size.join(' × ')} | ${r.triangles} | ${r.contact ?? ''} | ${r.error ? 'build failed' : r.issues.map((i) => i.kind).join(', ')} | ${sl} |`);
}
writeFileSync(join(outDir, 'report.md'), md.join('\n') + '\n');
console.log(
  `${errored.length} parts with errors, ${warned.length} with warnings${sliced ? `, ${slicerNotes.length} with slicer findings` : ''}; ` +
    `${unexplained.length} not marked as by design. Report: ${join(outDir, 'report.md')}`,
);
// Errors (not warnings, not slicer findings) fail the run.
if (errored.length || assembled.overlaps.length) process.exitCode = 1;
