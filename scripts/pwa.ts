/**
 * Offline support for the built app: after `vite build` writes dist/, this plugin
 * lists every file in it (index.html, JS and CSS chunks, the geometry worker, the
 * Manifold WASM, fonts, icons, the Bambu printer settings, …) and writes dist/sw.js,
 * the service worker in src/pwa/sw.js with that list filled in.
 *
 * The list comes from the build output itself, so new chunks (code splitting) are
 * picked up without touching this file. Each entry carries a hash of the file, so a
 * deploy that changes any file changes sw.js, which is how browsers notice an update.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const SW_FILE = 'sw.js';
/** Markers in src/pwa/sw.js that the build replaces. */
const LIST_MARK = '/* PRECACHE */ [];';
const VERSION_MARK = "/* VERSION */ 'dev';";

export interface PrecacheEntry {
  /** Relative to the service worker (its scope): `./` for the page, else the file's path. */
  url: string;
  /** Content hash, so a changed file is fetched again even when its name stays the same. */
  rev: string;
}

/** Files that never go in the precache: the service worker itself, source maps, dot files. */
export function skipFile(path: string): boolean {
  return path === SW_FILE || path.endsWith('.map') || path.split('/').some((p) => p.startsWith('.'));
}

const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex').slice(0, 12);

/**
 * The precache list for a build's files (paths relative to the output folder, `/`-separated).
 * index.html is cached as the scope root (`./`), which is what a launch from the home screen asks for.
 * Sorted, so the same build always gives the same list.
 */
export function precacheEntries(files: { path: string; content: Uint8Array | string }[]): PrecacheEntry[] {
  return files
    .filter((f) => !skipFile(f.path))
    .map((f) => ({ url: f.path === 'index.html' ? './' : f.path, rev: hash(f.content) }))
    .sort((a, b) => (a.url === './' ? -1 : b.url === './' ? 1 : a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** One hash for the whole list: the cache version a page and its service worker agree on. */
export function precacheVersion(entries: PrecacheEntry[]): string {
  return hash(entries.map((e) => `${e.url} ${e.rev}`).join('\n'));
}

/** The service worker template with the list and version filled in. */
export function serviceWorkerSource(template: string, entries: PrecacheEntry[]): string {
  if (!template.includes(LIST_MARK) || !template.includes(VERSION_MARK)) throw new Error('src/pwa/sw.js has lost its PRECACHE / VERSION markers');
  return template
    .replace(LIST_MARK, `${JSON.stringify(entries.map((e) => [e.url, e.rev]))};`)
    .replace(VERSION_MARK, `${JSON.stringify(precacheVersion(entries))};`);
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** Vite plugin: writes sw.js into the build output. Production builds only; `vite dev` never sees it. */
export function gridfitServiceWorker(): Plugin {
  let root = process.cwd();
  return {
    name: 'gridfit-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    // After every file (public/ included) is on disk.
    writeBundle(options) {
      const outDir = options.dir ?? resolve(root, 'dist');
      const files = listFiles(outDir).map((path) => ({ path, content: readFileSync(join(outDir, path)) }));
      const entries = precacheEntries(files);
      const template = readFileSync(resolve(root, 'src/pwa/sw.js'), 'utf8');
      writeFileSync(join(outDir, SW_FILE), serviceWorkerSource(template, entries));
    },
  };
}
