/*
 * Gridfit's service worker: the app keeps working offline after one visit.
 * The build writes it to dist/sw.js with the list of the build's files filled in
 * (scripts/pwa.ts); `vite dev` never registers it.
 *
 * - Install: every file of this build goes into the cache. Files an earlier version
 *   already cached with the same content are kept, not fetched again.
 * - Pages: from the network when it answers, so an online visit always gets the
 *   latest deploy; the cached page when offline (or when the network is too slow).
 * - The build's other files: from the cache.
 * - Only this build's own files are ever stored, never responses seen while running,
 *   so a cached page and the chunks it loads always belong to the same version.
 * - A new version waits until the page asks it to take over (the "Reload" button),
 *   then drops the files only the old version needed.
 *
 * Share links keep the whole project in the URL's #hash, which never reaches a
 * service worker: every link gets the same page, and the page reads its own hash.
 */

const PRECACHE = /* PRECACHE */ [];
const VERSION = /* VERSION */ 'dev';
const CACHE = 'gridfit-precache';
/** How long a page request waits for the network before the cached page is used (ms). */
const NETWORK_WAIT = 4000;

const base = new URL('./', self.location.href);
const entries = PRECACHE.map(([path, rev]) => {
  const url = new URL(path, base).href;
  return { url, key: `${url}${url.includes('?') ? '&' : '?'}__rev=${rev}` };
});
/** File URL → its cache key (the URL plus its content hash). */
const keyOf = new Map(entries.map((e) => [e.url, e.key]));

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  await Promise.all(
    entries
      .filter((e) => !have.has(e.key))
      .map(async (e) => {
        const res = await fetch(new Request(e.url, { cache: 'reload' }));
        if (!res.ok) throw new Error(`Gridfit offline cache: ${e.url} answered ${res.status}`);
        // A redirected response can't answer a page request; store a plain copy.
        await cache.put(e.key, res.redirected ? new Response(await res.blob(), { headers: res.headers }) : res);
      }),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(entries.map((e) => e.key));
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
      for (const name of await caches.keys()) if (name.startsWith('gridfit-') && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'skip-waiting') self.skipWaiting();
  // "Is this script part of your version?": how a page tells whether it already runs this version.
  else if (msg?.type === 'has' && event.ports[0]) {
    event.ports[0].postMessage({ has: keyOf.has(new URL(msg.url, base).href), version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(base.href)) return;
  if (req.mode === 'navigate') {
    event.respondWith(page(req, url));
    return;
  }
  const key = keyOf.get(url.href);
  if (key) event.respondWith(cached(key, req));
});

async function cached(key, req) {
  return (await caches.match(key)) ?? fetch(req);
}

/** Network first, with a time limit; then the cached file, or the app's page. */
async function page(req, url) {
  const network = fetch(req).then((res) => (res.status >= 500 ? Promise.reject(new Error(`${res.status}`)) : res));
  network.catch(() => {});
  try {
    const res = await Promise.race([network, new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT, null))]);
    if (res) return res;
  } catch {
    // Offline, or the server failed: the cached copy below.
  }
  const own = `${url.origin}${url.pathname}`;
  const key = keyOf.get(own) ?? keyOf.get(base.href);
  return (key && (await caches.match(key))) || network;
}
