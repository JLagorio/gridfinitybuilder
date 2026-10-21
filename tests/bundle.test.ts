import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Rolldown } from 'vite';

/**
 * Code splitting (components/lazy.tsx, README: Development): the first screen
 * downloads only what it shows. These build the app for real and check that
 * the other tabs, the dialogs, the editors and the exporters stay out of it.
 */

const root = resolve(__dirname, '..');
/**
 * The app's own JS on the first screen (the entry and what it imports, minus the React and three.js
 * chunks), bytes. It was ~460 kB when the split was made; everything in one chunk was 1.5 MB.
 * The ammunition presets and their height check (~10 kB) are on it: the bin grid's check marks need them.
 */
const FIRST_SCREEN_BUDGET = 535_000;
const VENDOR = ['react', 'three'];

let out: string;
let chunks: Rolldown.OutputChunk[];
let html: string;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'gridfit-bundle-'));
  const res = await build({ root, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  const output = (Array.isArray(res) ? res[0] : (res as Rolldown.RolldownOutput)).output;
  chunks = output.filter((c): c is Rolldown.OutputChunk => c.type === 'chunk');
  html = readFileSync(join(out, 'index.html'), 'utf8');
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

/** The entry chunk and every chunk it imports statically. */
function firstScreen() {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const d of byFile.get(f)!.imports) walk(d);
  };
  for (const c of chunks) if (c.isEntry) walk(c.fileName);
  return [...seen].map((f) => byFile.get(f)!);
}

const rel = (id: string) => id.replace(/\\/g, '/').replace(`${root.replace(/\\/g, '/')}/`, '');

describe('bundle', () => {
  it('keeps the first screen under its budget', () => {
    const bytes = firstScreen()
      .filter((c) => !VENDOR.includes(c.name))
      .reduce((t, c) => t + c.code.length, 0);
    expect(bytes).toBeLessThan(FIRST_SCREEN_BUDGET);
  });

  it('loads the other tabs, the editors, the dialogs and the writers on first use', () => {
    const initial = new Set(firstScreen().flatMap((c) => c.moduleIds.map(rel)));
    const later = [
      'src/components/BinPanel.tsx',
      'src/components/PrintPanel.tsx',
      'src/components/BinInteriorEditor.tsx',
      'src/components/CutoutEditor.tsx',
      'src/components/TraceDialog.tsx',
      'src/components/FillFromListDialog.tsx',
      'src/components/DrawerMapDialog.tsx',
      'src/components/InventoryList.tsx',
      'src/components/LabelIconPicker.tsx',
      'src/lib/trace/pipeline.ts',
      'src/lib/trace/svg.ts',
      'src/lib/trace/dxf.ts',
      'src/lib/autofill/index.ts',
      'src/lib/bom.ts',
      'src/lib/export/step.ts',
    ];
    expect(later.filter((m) => initial.has(m))).toEqual([]);
    // Each is in some chunk (a renamed file would make this test pass for nothing).
    const all = new Set(chunks.flatMap((c) => c.moduleIds.map(rel)));
    expect(later.filter((m) => !all.has(m))).toEqual([]);
  });

  it('puts React and three.js in chunks of their own, and preloads the saved tab’s panel', () => {
    const own = (name: string) => chunks.find((c) => c.name === name);
    expect(own('react')?.moduleIds.every((id) => /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id))).toBe(true);
    expect(own('three')?.moduleIds.every((id) => /node_modules[\\/]three[\\/]/.test(id))).toBe(true);
    // The 3D view is on the first screen: three.js loads beside the entry.
    expect(html).toContain(`<link rel="modulepreload" crossorigin href="/${own('three')!.fileName}">`);
    // A returning visitor's saved tab (Bins here) preloads its panel.
    const binPanel = chunks.find((c) => c.facadeModuleId && rel(c.facadeModuleId) === 'src/components/BinPanel.tsx')!;
    expect(html).toMatch(new RegExp(`"bins":\\[\\["[^\\]]*/${binPanel.fileName.replace(/[.$]/g, '\\$&')}"`));
  });

  it('starts the geometry worker small and loads the file writers on the first export', () => {
    const assets = readdirSync(join(out, 'assets'));
    const read = (re: RegExp) => readFileSync(join(out, 'assets', assets.find((f) => re.test(f))!), 'utf8');
    // The entry only starts the WASM download and loads the mesh code beside it.
    expect(read(/^geometry\.worker-.*\.js$/).length).toBeLessThan(2_000);
    const meshes = read(/^meshes-.*\.js$/);
    const writers = read(/^writers-.*\.js$/);
    expect(meshes).not.toContain('ISO-10303-21');
    expect(writers).toContain('ISO-10303-21');
  });
});
