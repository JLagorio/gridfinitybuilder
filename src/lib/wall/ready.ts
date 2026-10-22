/**
 * Whether the attachment kinds' planning (./kinds/all.ts) has loaded. It isn't on the first
 * screen: App loads it (loadKinds, ./index.ts) once the project has a board and plans again when
 * it's in; until then a board plans without its attachments. The Attachments tab, the store's
 * attachment edits and the tests import ./kinds/all.ts themselves.
 */
let version = 0;
const listeners = new Set<() => void>();

export const kindsVersion = () => version;
export const kindsReady = () => version > 0;

export function subscribeKinds(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** ./kinds/all.ts calls this once every kind is registered. */
export function kindsLoaded(): void {
  version++;
  for (const l of listeners) l();
}
