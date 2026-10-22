import { fromBase64Url, toBase64Url } from '../share';
import { isMeshHash, meshHash } from '../imported/format';

/**
 * Where the wall's photo lives (./photo.ts; the wall names it by hash,
 * ./data.ts WallPhoto), as imported meshes do (lib/imported/meshStore.ts):
 * - in memory, for the planner;
 * - in IndexedDB ("gridfit-photos"), so it's there after a reload (when the
 *   browser won't, in memory for this visit: save the project file);
 * - in saved project files, base64url-encoded under `photos` (withWallPhoto /
 *   adoptPhotos), so a file opens complete anywhere.
 * Share links never carry it (lib/externalShare.ts shareableProject): the wall
 * keeps how it was lined up, without the hash, and opening the link says the
 * photo stayed behind.
 *
 * Photos are JPEGs at most 2048 px on their long side (photo.ts
 * MAX_PHOTO_SIDE), hashed by content like meshes. Ones no wall has used for
 * KEEP_DAYS days are deleted (cleanupPhotos, when the planner shows a photo).
 */

const DB_NAME = 'gridfit-photos';
const STORE = 'photos';
export const KEEP_DAYS = 30;
const DAY = 86_400_000;

interface Row {
  hash: string;
  bytes: Uint8Array;
  name: string;
  savedAt: number;
  usedAt: number;
}

/** A photo's content hash (the mesh store's: 28 hex digits). */
export const photoHash = (bytes: Uint8Array) => meshHash(bytes);
export const isPhotoHash = isMeshHash;

const photos = new Map<string, Uint8Array>();
const missing = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

/** Change notifications (a photo came in, or was looked for and isn't here), for useSyncExternalStore. */
export function subscribePhotos(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const photosVersion = () => version;

/** The photo's bytes, when they are in memory. */
export const photoBytes = (hash: string): Uint8Array | undefined => photos.get(hash);

/** Looked for and found neither in memory nor in this browser's storage. */
export const isPhotoMissing = (hash: string) => missing.has(hash) && !photos.has(hash);

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** False once IndexedDB has failed: photos stay in memory only. */
let persistent: boolean | null = null;

/** Whether photos survive a reload here: true, false (memory only), or null before the first one is stored. */
export const photosPersist = () => persistent;

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
    console.warn('[Gridfit] Photo storage:', e);
    if (mode === 'readwrite') persistent = false;
    return undefined;
  }
}

const saving = new Map<string, Promise<boolean>>();

function persist(hash: string, bytes: Uint8Array, name: string): Promise<boolean> {
  let p = saving.get(hash);
  if (!p) {
    const now = Date.now();
    p = tx('readwrite', (s) => req(s.put({ hash, bytes, name, savedAt: now, usedAt: now } satisfies Row))).then((r) => {
      const ok = r !== undefined;
      if (ok && persistent === null) persistent = true;
      if (!ok) saving.delete(hash);
      return ok;
    });
    saving.set(hash, p);
  }
  return p;
}

function put(hash: string, bytes: Uint8Array) {
  if (photos.get(hash) === bytes) return;
  photos.set(hash, bytes);
  missing.delete(hash);
  emit();
}

/**
 * Keep a photo (its JPEG bytes, already made small): in memory now, in IndexedDB in the background. Returns its
 * content hash at once; `saved` says whether it will still be there after a reload.
 */
export function keepPhoto(bytes: Uint8Array, name = ''): { hash: string; saved: Promise<boolean> } {
  const hash = photoHash(bytes);
  put(hash, bytes);
  return { hash, saved: persist(hash, bytes, name) };
}

const loading = new Map<string, Promise<Uint8Array | null>>();

/** The photo's bytes: from memory, else from IndexedDB; null when this browser hasn't got it. */
export function loadPhoto(hash: string): Promise<Uint8Array | null> {
  const have = photos.get(hash);
  if (have) return Promise.resolve(have);
  if (!isPhotoHash(hash)) return Promise.resolve(null);
  let p = loading.get(hash);
  if (!p) {
    p = tx('readonly', (s) => req(s.get(hash) as IDBRequest<Row | undefined>)).then((row) => {
      loading.delete(hash);
      const bytes = row?.bytes ? new Uint8Array(row.bytes) : null;
      if (bytes && photoHash(bytes) === hash) {
        put(hash, bytes);
        return bytes;
      }
      if (!photos.has(hash) && !missing.has(hash)) {
        missing.add(hash);
        emit();
      }
      return photos.get(hash) ?? null;
    });
    loading.set(hash, p);
  }
  return p;
}

/**
 * Forget stored photos no wall has used for KEEP_DAYS days; the ones in `used` are marked used now. Never throws.
 * Returns how many were deleted.
 */
export async function cleanupPhotos(used: Iterable<string>, now = Date.now()): Promise<number> {
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
        } else if (now - (row.usedAt || row.savedAt || 0) > KEEP_DAYS * DAY) {
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

type WithWall = { wall?: { photo?: { hash?: unknown } } };

/** The project file with the wall photo's bytes in it (`photos`), for saving; left out when this browser hasn't got them. */
export async function withWallPhoto<T extends WithWall>(file: T): Promise<T & { photos?: Record<string, string> }> {
  const hash = file.wall?.photo?.hash;
  if (typeof hash !== 'string' || !hash) return file;
  const bytes = await loadPhoto(hash);
  return bytes ? { ...file, photos: { [hash]: toBase64Url(bytes) } } : file;
}

/**
 * Take in the photos a project file carries (`photos`, as withWallPhoto writes them): into memory at once, into
 * IndexedDB in the background. Ones whose bytes don't match their hash are skipped. Returns how many it took.
 */
export function adoptPhotos(v: unknown): number {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
  let n = 0;
  for (const [hash, code] of Object.entries(v as Record<string, unknown>).slice(0, 8)) {
    if (!isPhotoHash(hash) || typeof code !== 'string') continue;
    try {
      const bytes = fromBase64Url(code);
      if (photoHash(bytes) !== hash) continue;
      put(hash, bytes);
      void persist(hash, bytes, '');
      n++;
    } catch {
      // A damaged photo: the planner says it's missing, to pick it again.
    }
  }
  return n;
}
