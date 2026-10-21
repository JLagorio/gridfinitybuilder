import { useEffect } from 'react';
import { useStore } from '../state/store';

// The link codec (lib/share.ts, with its deflate) loads when a link is opened, not with the first screen
// (copying one is in the Print panel: CopyShareLink.tsx).
const loadShare = () => import('../lib/share');
/** lib/share.ts SHARE_PREFIX, without loading it. */
const SHARE_HASH = /^#?project=/;

function clearHash() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** On load (and when the hash changes), offer to open a project from a share link. */
export function useOpenSharedProject() {
  useEffect(() => {
    const check = async () => {
      const hash = window.location.hash;
      if (!SHARE_HASH.test(hash)) return;
      // Clear first so a reload (or a second effect run) doesn't ask again.
      clearHash();
      let data: unknown;
      try {
        const { projectFromHash } = await loadShare();
        data = projectFromHash(hash);
      } catch (e) {
        alert((e as Error).message);
        return;
      }
      if (data == null) return;
      if (!confirm('Open the project from this link? It replaces the project you have open. (Undo brings yours back.)')) return;
      try {
        useStore.getState().loadProject(data);
      } catch (e) {
        alert(`Couldn't open the shared project: ${(e as Error).message}`);
      }
    };
    const run = () => void check();
    run();
    window.addEventListener('hashchange', run);
    return () => window.removeEventListener('hashchange', run);
  }, []);
}
