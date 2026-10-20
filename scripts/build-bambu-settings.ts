/**
 * Bake Bambu Studio "project settings" for each Bambu printer into public/bambu/<id>.json.
 *
 *   npx tsx scripts/build-bambu-settings.ts [/Applications/BambuStudio.app]
 *
 * Embedding these in the exported 3MF makes it open in Bambu Studio with the
 * right printer, process (0.20mm Standard) and filament (PLA Basic) already
 * selected — ready to slice. The settings come from your installed Bambu
 * Studio's system profiles: presets are flattened (inherits + include
 * templates), then Bambu Studio's own CLI fills every remaining default by
 * exporting a throwaway project, whose project_settings.config we keep.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PRINTERS } from '../src/lib/printers';

const app = process.argv[2] ?? '/Applications/BambuStudio.app';
const exe = join(app, 'Contents/MacOS/BambuStudio');
const profiles = join(app, 'Contents/Resources/profiles/BBL');
const outDir = resolve('public/bambu');
mkdirSync(outDir, { recursive: true });

type Json = Record<string, unknown>;
const index = new Map<string, Json>();
for (const sub of ['machine', 'process', 'filament']) {
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) {
        try {
          const d = JSON.parse(readFileSync(p, 'utf8')) as Json;
          if (typeof d.name === 'string') index.set(`${sub}:${d.name}`, d);
        } catch {
          /* not a preset */
        }
      }
    }
  };
  walk(join(profiles, sub));
}

function flatten(sub: string, name: string): Json {
  const d = index.get(`${sub}:${name}`);
  if (!d) throw new Error(`missing ${sub} preset "${name}"`);
  const base = typeof d.inherits === 'string' && d.inherits ? flatten(sub, d.inherits) : {};
  const out: Json = { ...base };
  for (const inc of (d.include as string[] | undefined) ?? []) Object.assign(out, flatten(sub, inc));
  Object.assign(out, d);
  delete out.inherits;
  delete out.include;
  return out;
}

function compatible(sub: string, prefix: string, printerPreset: string): string | undefined {
  for (const [key] of index) {
    if (!key.startsWith(`${sub}:${prefix}`)) continue;
    const name = key.slice(sub.length + 1);
    try {
      const f = flatten(sub, name);
      if (f.instantiation === 'false') continue;
      if ((f.compatible_printers as string[] | undefined)?.includes(printerPreset)) return name;
    } catch {
      /* broken chain */
    }
  }
  return undefined;
}

// 10 mm cube, binary STL
function cubeStl(): Buffer {
  const q = (a: number[], b: number[], c: number[], d: number[]) => [
    [a, b, c],
    [a, c, d],
  ];
  const v = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10];
  const tris = [
    ...q(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)),
    ...q(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...q(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...q(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
    ...q(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
    ...q(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
  ];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    // Bambu Studio drops facets with a zero normal, so write real ones.
    const [a, b, c] = t;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const o = 84 + i * 50;
    n.forEach((c, k) => buf.writeFloatLE(c / len, o + k * 4));
    t.flat().forEach((c, k) => buf.writeFloatLE(c, o + 12 + k * 4));
  });
  return buf;
}

mkdirSync(resolve('.cache'), { recursive: true });
const work = mkdtempSync(join(resolve('.cache'), 'bbs-'));
const stl = join(work, 'cube.stl');
writeFileSync(stl, cubeStl());
const manifest: Record<string, { printer: string; process: string; filament: string }> = {};

for (const p of PRINTERS.filter((x) => x.bambu)) {
  const printerPreset = p.bambu!.printerPreset;
  try {
    const processName =
      (index.has(`process:${p.bambu!.processPreset}`) && p.bambu!.processPreset) ||
      compatible('process', '0.20mm Standard @BBL', printerPreset);
    const filamentName =
      (index.has(`filament:${p.bambu!.filamentPreset}`) && p.bambu!.filamentPreset) ||
      compatible('filament', 'Bambu PLA Basic @BBL', printerPreset);
    if (!processName || !filamentName) throw new Error('no compatible process/filament preset');

    const dir = join(work, p.id);
    mkdirSync(dir, { recursive: true });
    const files = {
      machine: { ...flatten('machine', printerPreset), from: 'system', name: printerPreset },
      process: { ...flatten('process', processName), from: 'system', name: processName },
      filament: { ...flatten('filament', filamentName), from: 'system', name: filamentName },
    };
    for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(v, null, 1));
    execFileSync(
      exe,
      [
        '--load-settings',
        `${join(dir, 'machine.json')};${join(dir, 'process.json')}`,
        '--load-filaments',
        join(dir, 'filament.json'),
        '--outputdir',
        dir,
        '--export-3mf',
        'template.3mf',
        stl,
      ],
      { stdio: 'pipe', cwd: dir },
    );
    const zip = unzipSync(readFileSync(join(dir, 'template.3mf')));
    const settings = JSON.parse(strFromU8(zip['Metadata/project_settings.config'])) as Json;
    // Bambu printers ship with the textured PEI plate; the CLI defaults to Cool Plate.
    settings.curr_bed_type = 'Textured PEI Plate';
    writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(settings, null, 4));
    manifest[p.id] = { printer: printerPreset, process: processName, filament: filamentName };
    console.log(`✓ ${p.name}: ${processName} / ${filamentName}`);
  } catch (e) {
    const err = e as Error & { stdout?: Buffer };
    const tail = err.stdout ? String(err.stdout).split('\n').filter((l) => /error|fail/i.test(l)).slice(-3).join(' | ') : '';
    console.warn(`✗ ${p.name}: ${tail || err.message.split('\n')[0]}`);
  }
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (!process.env.KEEP) rmSync(work, { recursive: true, force: true });
