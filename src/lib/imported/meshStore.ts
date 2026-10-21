import { deflateSync, inflateSync } from 'fflate';
import { fromBase64Url, toBase64Url } from '../share';
import { decodeMesh, encodeMesh, isMeshHash, meshHash } from './format';
import { hasImported, importedMesh, putImported } from './registry';
import type { RawMesh } from './meshOps';

/**
 * Where imported meshes live on the page (external.ts). The project state
 * only names them by hash; their bytes are:
 * - in memory (imported/registry.ts), for the 3D view and the exports;
 * - in IndexedDB ("gridfit-meshes"), so they're there after a reload. When
 *   the browser won't (a private window, storage blocked or full), they stay in
 *   memory for this visit and the import dialog says to save the project file;
 * - in saved project files, deflated and base64url-encoded under `meshes`
 *   (projectWithMeshes / adoptMeshes), so a file opens complete anywhere.
 *   Share links never carry them (external.ts shareableBin).
 *
 * Meshes no drawer uses are deleted, but only once nothing has used them for
 * KEEP_DAYS days (cleanupMeshes runs at start-up and on save), so undo, other
 * tabs and a project opened again soon still find theirs.
 */

const DB_NAME = 'gridfit-meshes';
const STORE = 'meshes';
export const KEEP_DAYS = 30;
const DAY = 86_400_000;

interface Row {
  hash: string;
  bytes: Uint8Array;
  file: string;
  savedAt: number;
  usedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** False once IndexedDB has failed: meshes stay in memory only. */
let persistent: boolean | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function db(): Promise<IDBDatabase | null> {
  return (dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'hash' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((d) => {
    if (!d) persistent = false;
    return d;
  }));
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T>): Promise<T | undefined> {
  try {
    const d = await db();
    if (!d) return undefined;
    return await fn(d.transaction(STORE, mode).objectStore(STORE));
  } catch (e) {
    console.warn('[Gridfit] Mesh storage:', e);
    if (mode === 'readwrite') persistent = false;
    return undefined;
  }
}

/** Whether meshes survive a reload here: true, false (memory only), or null before the first one is stored. */
export const meshesPersist = () => persistent;

/** Whether this browser lets Gridfit keep meshes (IndexedDB opens); false in some private windows. */
export async function canKeepMeshes(): Promise<boolean> {
  return persistent !== false && !!(await db());
}

const saving = new Map<string, Promise<boolean>>();

/** Write mesh bytes to IndexedDB (once per hash per visit). Resolves to whether that worked. */
function persist(hash: string, bytes: Uint8Array, file: string): Promise<boolean> {
  let p = saving.get(hash);
  if (!p) {
    const now = Date.now();
    p = tx('readwrite', (s) => req(s.put({ hash, bytes, file, savedAt: now, usedAt: now } satisfies Row))).then((r) => {
      const ok = r !== undefined;
      if (ok && persistent === null) persistent = true;
      if (!ok) saving.delete(hash);
      return ok;
    });
    saving.set(hash, p);
  }
  return p;
}

/**
 * Keep a parsed mesh (welded and centred, imported/parse.ts): in memory now,
 * in IndexedDB in the background. Returns its content hash at once;
 * `saved` says whether it will still be there after a reload.
 */
export function keepMesh(mesh: RawMesh, file = ''): { hash: string; saved: Promise<boolean> } {
  const bytes = encodeMesh(mesh);
  const hash = meshHash(bytes);
  putImported(hash, { positions: mesh.positions, indices: mesh.indices });
  return { hash, saved: persist(hash, bytes, file) };
}

const loading = new Map<string, Promise<boolean>>();
const missing = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

/** Load a mesh from IndexedDB into memory if it isn't there yet. Resolves to whether it's in memory now. */
export function loadMesh(hash: string): Promise<boolean> {
  if (hasImported(hash)) return Promise.resolve(true);
  let p = loading.get(hash);
  if (!p) {
    p = tx('readonly', (s) => req(s.get(hash) as IDBRequest<Row | undefined>)).then((row) => {
      loading.delete(hash);
      try {
        if (row?.bytes) {
          putImported(hash, decodeMesh(new Uint8Array(row.bytes)));
          if (missing.delete(hash)) emit();
          return true;
        }
      } catch (e) {
        console.warn('[Gridfit] A stored mesh is damaged:', e);
      }
      if (!hasImported(hash) && !missing.has(hash)) {
        missing.add(hash);
        emit();
      }
      return hasImported(hash);
    });
    loading.set(hash, p);
  }
  return p;
}

/** Load every one of these meshes that isn't in memory. */
export async function loadMeshes(hashes: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(hashes)].map(loadMesh));
}

/** Meshes looked for and found neither in memory nor in this browser's storage. */
export const isMissing = (hash: string) => missing.has(hash) && !hasImported(hash);

export function subscribeMeshStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const meshStoreVersion = () => version;

/**
 * Keep the meshes the project uses in memory: `hashes` is read now and on
 * every change `subscribe` reports. Returns the unsubscribe.
 */
export function syncMeshes(subscribe: (fn: () => void) => () => void, hashes: () => string[]): () => void {
  let last = '';
  const check = () => {
    const now = hashes();
    const key = now.join(',');
    if (key === last) return;
    last = key;
    void loadMeshes(now.filter((h) => !hasImported(h)));
  };
  check();
  return subscribe(check);
}

/**
 * Forget stored meshes nothing has used for KEEP_DAYS days; the ones in
 * `used` are marked used now. Never throws. Returns how many were deleted.
 * `remove: false` only marks: for a caller that doesn't know every user
 * (a project file being saved doesn't know My bins).
 */
export async function cleanupMeshes(used: Iterable<string>, now = Date.now(), remove = true): Promise<number> {
  const keep = new Set(used);
  const n = await tx('readwrite', (s) => {
    let gone = 0;
    return new Promise<number>((resolve, reject) => {
      const cur = s.openCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(gone);
        const row = c.value as Row;
        if (keep.has(row.hash)) {
          if (now - row.usedAt > DAY) c.update({ ...row, usedAt: now });
        } else if (remove && now - (row.usedAt || row.savedAt || 0) > KEEP_DAYS * DAY) {
          c.delete();
          gone++;
        }
        c.continue();
      };
    });
  });
  return n ?? 0;
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

type WithBins = { bins?: { external?: { mesh?: { hash: string } } }[] };

/** Every mesh hash a project file's drawers (and top-level bins) use. */
export function projectMeshHashes(file: WithBins & { drawers?: WithBins[] }): string[] {
  const out = new Set<string>();
  for (const list of [file.bins ?? [], ...(file.drawers ?? []).map((d) => d.bins ?? [])]) {
    for (const b of list) if (b?.external?.mesh?.hash) out.add(b.external.mesh.hash);
  }
  return [...out];
}

/** The project file with the bytes of every mesh it uses, for saving (meshes this browser doesn't have are left out). */
export async function projectWithMeshes<T extends WithBins & { drawers?: WithBins[] }>(file: T): Promise<T & { meshes?: Record<string, string> }> {
  const hashes = projectMeshHashes(file);
  if (!hashes.length) return file;
  return { ...file, meshes: await meshesFor(hashes) };
}

/** The bytes of these meshes as a file carries them (`meshes`; ones this browser doesn't have are left out), marked used. */
export async function meshesFor(hashes: string[]): Promise<Record<string, string>> {
  await loadMeshes(hashes);
  const meshes: Record<string, string> = {};
  for (const h of hashes) {
    const m = importedMesh(h);
    if (m) meshes[h] = toBase64Url(deflateSync(encodeMesh(m), { level: 6 }));
  }
  void cleanupMeshes(hashes, Date.now(), false);
  return meshes;
}

/**
 * Take in the meshes a project file carries (`meshes`, as projectWithMeshes
 * writes them): into memory at once, into IndexedDB in the background. Ones
 * whose bytes don't match their hash are skipped. Returns how many it took.
 */
export function adoptMeshes(meshes: unknown): number {
  if (!meshes || typeof meshes !== 'object') return 0;
  let n = 0;
  for (const [hash, code] of Object.entries(meshes as Record<string, unknown>)) {
    if (!isMeshHash(hash) || typeof code !== 'string') continue;
    try {
      const bytes = inflateSync(fromBase64Url(code));
      if (meshHash(bytes) !== hash) continue;
      if (!hasImported(hash)) putImported(hash, decodeMesh(bytes));
      if (missing.delete(hash)) emit();
      void persist(hash, bytes, '');
      n++;
    } catch {
      // A damaged mesh: its bin shows as a box until it's imported again.
    }
  }
  return n;
}
