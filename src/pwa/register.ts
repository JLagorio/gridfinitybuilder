/**
 * Offline install: registers the service worker (src/pwa/sw.js, built by scripts/pwa.ts)
 * in production builds, and notices when a new version is waiting to take over.
 */
import { create } from 'zustand';

interface AppUpdate {
  /** A new version, installed and waiting for the page to say "Reload". */
  waiting: ServiceWorker | null;
}

export const useAppUpdate = create<AppUpdate>(() => ({ waiting: null }));

let reloadAsked = false;

/**
 * Register once the page has loaded and `after` has settled: installing saves
 * every file of the build, which shouldn't share the network with what the
 * first view still needs (main.tsx waits for its first mesh).
 */
export function registerServiceWorker(after: Promise<unknown> = Promise.resolve()) {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    // One left over from a preview build on this address would serve old files to `vite dev`.
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }
  const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => window.addEventListener('load', r, { once: true }));
  void Promise.all([loaded, after.catch(() => {})]).then(start);
}

async function start() {
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (reloadAsked) {
      window.location.reload();
      return;
    }
    // The first install just took over this page: nothing changes.
    if (!hadController) return;
    // Another tab switched to a new version: this page needs a reload unless it's the same one.
    void sameVersion(sw.controller).then((same) => !same && useAppUpdate.setState({ waiting: sw.controller }));
  });
  let reg: ServiceWorkerRegistration;
  try {
    reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
  } catch (e) {
    console.warn('[Gridfit] Offline support is off: the service worker did not register.', e);
    return;
  }
  if (reg.waiting && sw.controller) void offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && sw.controller) void offer(w);
    });
  });
  // Look for a new version every hour, and whenever the app comes back on screen.
  const check = () => void reg.update().catch(() => {});
  setInterval(check, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
}

/** Offer a waiting version, or let it take over quietly when this page already runs it (loaded from the network). */
async function offer(w: ServiceWorker) {
  if (await sameVersion(w)) w.postMessage({ type: 'skip-waiting' });
  else useAppUpdate.setState({ waiting: w });
}

/** Whether a service worker's version holds the script this page runs. */
function sameVersion(w: ServiceWorker | null): Promise<boolean> {
  if (!w) return Promise.resolve(false);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(false), 3000);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      resolve(!!(e.data as { has?: boolean } | null)?.has);
    };
    w.postMessage({ type: 'has', url: import.meta.url }, [ch.port2]);
  });
}

/** Switch to the waiting version and reload. The project is autosaved, so it comes back as it was. */
export function applyUpdate() {
  const w = useAppUpdate.getState().waiting;
  reloadAsked = true;
  if (w && w.state === 'installed') w.postMessage({ type: 'skip-waiting' });
  else window.location.reload();
}
