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
 * (manifold, repairs, parts). --only keeps groups or parts whose path contains
 * the text. Results go to report.json and report.md in outDir (see
 * docs/print-check.md).
 */
import Module from 'manifold-3d';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildMesh, exportPlate3MF } from '../src/lib/project';
import { meshBounds, type MeshData } from '../src/lib/geometry/kernel';
import { checkPart, meshTopology, type PrintIssue } from '../src/lib/geometry/printcheck';
import { FONT_URL_PATH, registerFont } from '../src/lib/geometry/text';
import { writeSTL } from '../src/lib/export/stl';
import { usableBed } from '../src/lib/bedfit';
import { SAMPLE_GROUPS, SAMPLE_SETUP, printedParts } from './sampler-cases';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--only', '--jobs'].includes(args[i - 1]));
const outDir = resolve(positional[0] ?? 'out/sampler');
const only = value('--only');
const jobs = Math.max(1, Number(value('--jobs')) || Math.max(1, Math.floor(cpus().length / 2)));
const slice = flag('--slice');

const wasm = await Module();
const fontBytes = readFileSync(resolve('public', FONT_URL_PATH));
registerFont(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));
wasm.setup();

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
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
const r2 = (v: number) => Math.round(v * 100) / 100;

const bed = usableBed(SAMPLE_SETUP);
const records: PartRecord[] = [];
const warnings: Record<string, string[]> = {};
const t0 = performance.now();
mkdirSync(outDir, { recursive: true });

for (const group of SAMPLE_GROUPS) {
  // Planning is cheap: plan every group and filter its parts by path.
  const job = group.job();
  if (job.warnings.length) warnings[group.name] = job.warnings;
  const dir = join(outDir, group.name);
  for (const { part, file, same } of printedParts(group, job)) {
    if (only && !file.includes(only)) continue;
    const rec: PartRecord = { group: group.name, file, part: part.key, name: part.name, kind: part.kind, same, size: [], triangles: 0, volume: 0, overlayBodies: 0, ms: 0, issues: [] };
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
    const b = meshBounds(mesh);
    rec.size = b.max.map((v, i) => r2(v - b.min[i]));
    const check = checkPart(wasm, mesh, { bed });
    rec.triangles = check.topology.triangles;
    rec.volume = r2(check.topology.volume);
    rec.overlayBodies = (mesh.overlays ?? []).reduce((n, o) => n + meshTopology(o).components.length, 0);
    rec.contact = check.slices?.contact;
    rec.issues = check.issues;
    rec.ms = Math.round(performance.now() - t);
    const errors = check.issues.filter((i) => i.severity === 'error').length;
    const warns = check.issues.length - errors;
    console.log(`${errors ? '✗' : warns ? '~' : '✓'} ${file} ${rec.size.join('×')} ${rec.ms} ms${check.issues.length ? `: ${check.issues.map((i) => i.message).join(' | ')}` : ''}`);
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
console.log(`Built and checked ${records.length} parts in ${Math.round((performance.now() - t0) / 1000)} s.`);

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
  const s = await run(['--loglevel', '2', '--load', ini, '--export-gcode', '--output', gcode, stl]);
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
  rec.slicer = { ok: s.code === 0, messages, stability, noise, info: fields };
  const bad = !rec.slicer.ok || messages.length || stability.length || fields.manifold !== 'yes';
  const notes = [...stability.map((t) => `stability: ${t}`), ...messages];
  console.log(`${bad ? '!' : '·'} ${rec.file}: ${fields.manifold === 'yes' ? 'manifold' : `manifold=${fields.manifold}`}, parts ${fields.number_of_parts}${notes.length ? `, ${notes.join('; ')}` : ''}`);
}

if (slice) {
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

writeFileSync(join(outDir, 'report.json'), JSON.stringify({ setup: SAMPLE_SETUP, bed, warnings, parts: records }, null, 1));

const md: string[] = ['# Sampler report', '', `${records.length} parts, ${new Date().toISOString()}`, ''];
const errored = records.filter((r) => r.error || r.issues.some((i) => i.severity === 'error'));
const warned = records.filter((r) => !errored.includes(r) && r.issues.length);
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
  return out;
}
const slicerNotes = records.filter((r) => slicerFindings(r).length);
md.push(`- ${errored.length} with errors, ${warned.length} with warnings only`);
if (slice) md.push(`- ${slicerNotes.length} with PrusaSlicer findings; ${records.filter((r) => Number(r.slicer?.info.degenerate_facets) > 0).length} had zero-area facets it removed`);
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
    for (const i of r.issues) md.push(`  - ${i.severity} ${i.kind}: ${i.message}`);
  }
  md.push('');
}
if (slicerNotes.length) {
  md.push('## PrusaSlicer', '');
  for (const r of slicerNotes) {
    md.push(`- \`${r.file}\``);
    for (const m of slicerFindings(r)) md.push(`  - ${m}`);
  }
  md.push('');
}
if (Object.keys(warnings).length) {
  md.push('## Planning warnings', '');
  for (const [g, list] of Object.entries(warnings)) for (const w of list) md.push(`- ${g}: ${w}`);
  md.push('');
}
md.push('## Parts', '', '| Part | Size (mm) | Triangles | Contact (mm²) | Issues | Slicer |', '|---|---|---|---|---|---|');
for (const r of records) {
  const sl = r.slicer ? slicerFindings(r).join('; ') || 'ok' : '';
  md.push(`| \`${r.file}\` | ${r.size.join(' × ')} | ${r.triangles} | ${r.contact ?? ''} | ${r.error ? 'build failed' : r.issues.map((i) => i.kind).join(', ')} | ${sl} |`);
}
writeFileSync(join(outDir, 'report.md'), md.join('\n') + '\n');
console.log(`${errored.length} parts with errors, ${warned.length} with warnings${slice ? `, ${slicerNotes.length} with slicer messages` : ''}. Report: ${join(outDir, 'report.md')}`);
