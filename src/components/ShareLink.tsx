import { useEffect, useState } from 'react';
import { projectFile, useStore } from '../state/store';
import { projectFromHash, shareUrl } from '../lib/share';

function clearHash() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** On load (and when the hash changes), offer to open a project from a share link. */
export function useOpenSharedProject() {
  useEffect(() => {
    const check = () => {
      let data: unknown;
      try {
        data = projectFromHash(window.location.hash);
      } catch (e) {
        clearHash();
        alert((e as Error).message);
        return;
      }
      if (data == null) return;
      // Clear first so a reload (or a second effect run) doesn't ask again.
      clearHash();
      if (!confirm('Open the project from this link? It replaces the project you have open. (Undo brings yours back.)')) return;
      try {
        useStore.getState().loadProject(data);
      } catch (e) {
        alert(`Couldn't open the shared project: ${(e as Error).message}`);
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
}

/** Copies a link that holds the whole project. */
export function CopyShareLink() {
  const [status, setStatus] = useState<string | null>(null);
  const copy = async () => {
    const url = shareUrl(projectFile(useStore.getState()), window.location.href);
    const size = url.length > 1500 ? ` (${Math.round(url.length / 100) / 10} k characters)` : '';
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`Link copied${size}.`);
    } catch {
      window.prompt('Copy this link:', url);
      setStatus(null);
    }
  };
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);
  return (
    <>
      <button onClick={copy} title="A link with the whole project in it. Nothing is uploaded.">
        Copy share link
      </button>
      {status && <span className="field-hint share-status">{status}</span>}
    </>
  );
}
