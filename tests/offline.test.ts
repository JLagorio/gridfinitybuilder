import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { SW_FILE, listFiles, precacheEntries, precacheVersion, serviceWorkerSource, skipFile, type PrecacheEntry } from '../scripts/pwa';

const root = resolve(__dirname, '..');
const template = readFileSync(join(root, 'src/pwa/sw.js'), 'utf8');

describe('precache list', () => {
  const files = [
    { path: 'index.html', content: '<html>' },
    { path: 'assets/index-abc.js', content: 'js' },
    { path: 'assets/index-abc.js.map', content: '{}' },
    { path: 'assets/geometry.worker-def.js', content: 'worker' },
    { path: 'assets/manifold-123.wasm', content: new Uint8Array([0, 97, 115, 109]) },
    { path: 'bambu/p2s.json', content: '{}' },
    { path: 'fonts/RobotoCondensed-Bold.ttf', content: 'ttf' },
    { path: SW_FILE, content: 'old worker' },
    { path: '.DS_Store', content: 'x' },
  ];

  it('lists every built file once, the page as the scope root and first', () => {
    const urls = precacheEntries(files).map((e) => e.url);
    expect(urls[0]).toBe('./');
    expect(urls).toEqual(['./', 'assets/geometry.worker-def.js', 'assets/index-abc.js', 'assets/manifold-123.wasm', 'bambu/p2s.json', 'fonts/RobotoCondensed-Bold.ttf']);
  });

  it('leaves out the service worker, source maps and dot files', () => {
    expect(skipFile(SW_FILE)).toBe(true);
    expect(skipFile('assets/a.js.map')).toBe(true);
    expect(skipFile('.well-known/x')).toBe(true);
    expect(skipFile('assets/a.js')).toBe(false);
  });

  it('gives a changed file a new revision, and the list a new version', () => {
    const a = precacheEntries(files);
    const b = precacheEntries(files.map((f) => (f.path === 'bambu/p2s.json' ? { ...f, content: '{"changed":1}' } : f)));
    expect(a).toEqual(precacheEntries([...files].reverse()));
    expect(b.find((e) => e.url === 'bambu/p2s.json')!.rev).not.toBe(a.find((e) => e.url === 'bambu/p2s.json')!.rev);
    expect(b.find((e) => e.url === './')!.rev).toBe(a.find((e) => e.url === './')!.rev);
    expect(precacheVersion(b)).not.toBe(precacheVersion(a));
  });

  it('fills the list into the service worker', () => {
    const entries = precacheEntries(files);
    const src = serviceWorkerSource(template, entries);
    expect(src).toContain(JSON.stringify(entries.map((e) => [e.url, e.rev])));
    expect(src).toContain(JSON.stringify(precacheVersion(entries)));
    expect(() => new Function(src)).not.toThrow();
    expect(() => serviceWorkerSource('const PRECACHE = [];', entries)).toThrow(/markers/);
  });
});

/** The service worker running against an in-memory Cache Storage and a scripted network. */
function runWorker(entries: PrecacheEntry[], net: { online: boolean; files: Record<string, string>; hang?: boolean }, opts: { instantTimers?: boolean } = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const store = new Map<string, Map<string, Response>>();
  const keyUrl = (k: Request | string) => (typeof k === 'string' ? k : k.url);
  const open = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      put: async (k: Request | string, res: Response) => void m.set(keyUrl(k), res),
      match: async (k: Request | string) => m.get(keyUrl(k))?.clone(),
      delete: async (k: Request | string) => m.delete(keyUrl(k)),
    };
  };
  const fetched: string[] = [];
  const modes: string[] = [];
  const fetch = async (req: Request | { url: string }) => {
    fetched.push(req.url);
    if (req instanceof Request) modes.push(req.cache);
    if (net.hang) return new Promise<Response>(() => {});
    if (!net.online) throw new TypeError('Failed to fetch');
    const path = new URL(req.url).pathname.replace('/app/', '') || './';
    const body = net.files[path];
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 });
  };
  const caches = {
    open: async (n: string) => open(n),
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (k: Request | string) => {
      for (const m of store.values()) if (m.has(keyUrl(k))) return m.get(keyUrl(k))!.clone();
      return undefined;
    },
  };
  let skipped = 0;
  const self = {
    location: new URL('https://example.test/app/sw.js'),
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f),
    skipWaiting: () => void skipped++,
    clients: { claim: async () => {} },
  };
  const setTimeout = opts.instantTimers ? (fn: (a: unknown) => void, _ms: number, arg: unknown) => queueMicrotask(() => fn(arg)) : globalThis.setTimeout;
  runInNewContext(serviceWorkerSource(template, entries), { self, caches, fetch, Request, Response, URL, setTimeout, console });

  const emit = async (type: string, extra: Record<string, unknown>) => {
    let wait: Promise<unknown> | undefined;
    let answer: Promise<Response> | undefined;
    const e = { ...extra, waitUntil: (p: Promise<unknown>) => void (wait = p), respondWith: (p: Promise<Response>) => void (answer = p) };
    for (const f of listeners[type] ?? []) f(e);
    await wait;
    return answer;
  };
  return {
    store,
    fetched,
    modes,
    skipped: () => skipped,
    install: () => emit('install', {}),
    activate: () => emit('activate', {}),
    /** What the worker answers, or undefined when it leaves the request to the browser. */
    request: async (url: string, mode = 'no-cors') => {
      const r = await emit('fetch', { request: { method: 'GET', url, mode } });
      return r && (await r).text();
    },
    message: (data: unknown) =>
      new Promise((resolve) => {
        void emit('message', { data, ports: [{ postMessage: resolve }] });
      }),
  };
}

describe('service worker', () => {
  const files: Record<string, string> = { './': '<html>v1</html>', 'assets/index-a.js': 'js v1', 'assets/manifold-1.wasm': 'wasm', 'bambu/p2s.json': '{"v":1}' };
  const entries = precacheEntries(Object.entries(files).map(([path, content]) => ({ path: path === './' ? 'index.html' : path, content })));

  it('caches every file of the build on install, fresh from the server', async () => {
    const sw = runWorker(entries, { online: true, files });
    await sw.install();
    const cached = [...sw.store.get('gridfit-precache')!.keys()];
    expect(cached).toHaveLength(entries.length);
    expect(cached.every((k) => /\?__rev=[0-9a-f]{12}$/.test(k))).toBe(true);
    expect(sw.fetched.sort()).toEqual(entries.map((e) => new URL(e.url, 'https://example.test/app/').href).sort());
  });

  it('checks each file with the server instead of downloading what the page just loaded again', async () => {
    const sw = runWorker(entries, { online: true, files });
    await sw.install();
    // "no-cache" revalidates: an unchanged file comes back as a 304 from the browser's HTTP cache.
    expect(sw.modes).toEqual(entries.map(() => 'no-cache'));
  });

  it('works offline: the page, the chunks, the WASM and the printer settings come from the cache', async () => {
    const net = { online: true, files };
    const sw = runWorker(entries, net);
    await sw.install();
    await sw.activate();
    net.online = false;
    expect(await sw.request('https://example.test/app/', 'navigate')).toBe('<html>v1</html>');
    expect(await sw.request('https://example.test/app/assets/index-a.js')).toBe('js v1');
    expect(await sw.request('https://example.test/app/assets/manifold-1.wasm')).toBe('wasm');
    expect(await sw.request('https://example.test/app/bambu/p2s.json')).toBe('{"v":1}');
  });

  it('opens any share link or query on the same page, and never caches what it sees', async () => {
    const net = { online: true, files };
    const sw = runWorker(entries, net);
    await sw.install();
    const before = [...sw.store.get('gridfit-precache')!.keys()];
    // Online: the page comes from the network, as it is now.
    net.files = { ...files, './': '<html>v2</html>' };
    expect(await sw.request('https://example.test/app/?drawer=2', 'navigate')).toBe('<html>v2</html>');
    expect([...sw.store.get('gridfit-precache')!.keys()]).toEqual(before);
    // Offline: the cached page of this version, whatever the query (a #hash never reaches the worker).
    net.online = false;
    expect(await sw.request('https://example.test/app/?drawer=2', 'navigate')).toBe('<html>v1</html>');
    expect(await sw.request('https://example.test/app/index.html', 'navigate')).toBe('<html>v1</html>');
  });

  it('uses the cached page when the network is too slow', async () => {
    const sw = runWorker(entries, { online: true, files }, { instantTimers: true });
    await sw.install();
    const slow = runWorker(entries, { online: true, files, hang: true }, { instantTimers: true });
    // Same cache contents, network that never answers.
    slow.store.set('gridfit-precache', sw.store.get('gridfit-precache')!);
    expect(await slow.request('https://example.test/app/', 'navigate')).toBe('<html>v1</html>');
  });

  it('leaves other sites, other files and non-GET requests alone', async () => {
    const sw = runWorker(entries, { online: true, files });
    await sw.install();
    expect(await sw.request('https://elsewhere.test/app/assets/index-a.js')).toBeUndefined();
    expect(await sw.request('https://example.test/app/assets/unknown.js')).toBeUndefined();
    expect(await sw.request('https://example.test/app/assets/index-a.js?v=2')).toBeUndefined();
    expect(await sw.request('https://example.test/other/', 'navigate')).toBeUndefined();
  });

  it('fetches only what changed for a new version, and drops what only the old one used', async () => {
    const net = { online: true, files };
    const v1 = runWorker(entries, net);
    await v1.install();
    await v1.activate();
    const files2 = { './': '<html>v2</html>', 'assets/index-b.js': 'js v2', 'assets/manifold-1.wasm': 'wasm', 'bambu/p2s.json': '{"v":1}' };
    const entries2 = precacheEntries(Object.entries(files2).map(([path, content]) => ({ path: path === './' ? 'index.html' : path, content })));
    net.files = files2;
    const v2 = runWorker(entries2, net);
    v2.store.set('gridfit-precache', v1.store.get('gridfit-precache')!);
    await v2.install();
    expect(v2.fetched.map((u) => u.replace('https://example.test/app/', '')).sort()).toEqual(['', 'assets/index-b.js']);
    // Until it takes over, the old version still has everything it needs.
    expect(v2.store.get('gridfit-precache')!.size).toBe(entries.length + 2);
    await v2.activate();
    expect([...v2.store.get('gridfit-precache')!.keys()].map((k) => k.replace(/^https:\/\/example\.test\/app\//, '').replace(/\?.*/, '')).sort()).toEqual(
      ['', 'assets/index-b.js', 'assets/manifold-1.wasm', 'bambu/p2s.json'],
    );
  });

  it('says whether a script belongs to its version, and takes over when asked', async () => {
    const sw = runWorker(entries, { online: true, files });
    expect(await sw.message({ type: 'has', url: 'https://example.test/app/assets/index-a.js' })).toMatchObject({ has: true, version: precacheVersion(entries) });
    expect(await sw.message({ type: 'has', url: 'https://example.test/app/assets/index-old.js' })).toMatchObject({ has: false });
    void sw.message({ type: 'skip-waiting' });
    expect(sw.skipped()).toBe(1);
  });
});

describe('build', () => {
  const out = mkdtempSync(join(tmpdir(), 'gridfit-build-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('writes sw.js listing every file the build produced (lazy chunks, worker, WASM, fonts, printer settings)', async () => {
    await build({ root, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
    const src = readFileSync(join(out, SW_FILE), 'utf8');
    const list = JSON.parse(src.match(/const PRECACHE = (\[.*?\]);/)![1]) as [string, string][];
    const urls = list.map(([u]) => u);
    const built = listFiles(out).filter((f) => !skipFile(f)).map((f) => (f === 'index.html' ? './' : f));
    expect(urls.sort()).toEqual(built.sort());
    // The code-split parts (README: Development) are saved too, so every tab, dialog and export works offline.
    const lazy = [/^assets\/BinPanel-.*\.js$/, /^assets\/PrintPanel-.*\.js$/, /^assets\/TraceDialog-.*\.js$/, /^assets\/three-.*\.js$/, /^assets\/meshes-.*\.js$/, /^assets\/writers-.*\.js$/];
    for (const want of [...lazy, /^assets\/index-.*\.js$/, /^assets\/index-.*\.css$/, /^assets\/geometry\.worker-.*\.js$/, /^assets\/manifold-.*\.wasm$/, /^fonts\/RobotoCondensed-Bold\.ttf$/, /^bambu\/p2s\.json$/, /^manifest\.webmanifest$/, /^icons\/icon-512\.png$/]) {
      expect(urls.some((u) => want.test(u)), String(want)).toBe(true);
    }
  });
});
