/**
 * Code-split files (the other tabs, dialogs, the 3D view, the geometry
 * worker's exporters) load the first time they're needed. One that fails to
 * load almost always means a deploy replaced this page's files since it
 * opened (or the connection dropped before the offline copy was saved): a
 * reload gets the new version, and the project comes back (it autosaves).
 *
 * Plain TS, no React: the geometry worker uses it too.
 */

export const CHUNK_ERROR_MESSAGE = 'Gridfit has been updated since this page opened (or the connection dropped). Reload to update; your project is saved in this browser.';

/** Whether an error is a code-split file that failed to load (the wording differs per browser and bundler). */
export function isChunkError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload|ChunkLoadError/i.test(text);
}
