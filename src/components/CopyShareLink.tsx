import { useEffect, useState } from 'react';
import { projectFile, useStore } from '../state/store';
import { shareUrl } from '../lib/share';
import { shareableProject } from '../lib/externalShare';

/** Copies a link that holds the whole project (lib/share.ts). Imported bins and models go in it as boxes of their size: a link can't hold meshes. */
export function CopyShareLink() {
  const [status, setStatus] = useState<string | null>(null);
  const copy = async () => {
    const { file, dropped, models, photo } = shareableProject(projectFile(useStore.getState()));
    const url = shareUrl(file, window.location.href);
    const size = url.length > 1500 ? ` (${Math.round(url.length / 100) / 10} k characters)` : '';
    const what = [
      dropped && (dropped === 1 ? 'the imported bin' : `the ${dropped} imported bins`),
      models && (models === 1 ? 'the imported model' : `the ${models} imported models`),
    ].filter(Boolean);
    const note =
      (what.length
        ? ` ${what.join(' and ').replace(/^./, (c) => c.toUpperCase())} ${dropped + models === 1 ? 'goes' : 'go'} as plain boxes: a link can't hold meshes. Save the project file to pass them on.`
        : '') + (photo ? ' The wall’s photo stays behind: save the project file to pass it on.' : '');
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`Link copied${size}.${note}`);
    } catch {
      window.prompt('Copy this link:', url);
      setStatus(note.trim() || null);
    }
  };
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), status.length > 60 ? 9000 : 3000);
    return () => clearTimeout(t);
  }, [status]);
  return (
    <>
      <button
        onClick={copy}
        title="A link with the whole project in it. Nothing is uploaded. Imported bins and models go as boxes of their size (a link can't hold meshes)."
      >
        Copy share link
      </button>
      {status && <span className="field-hint share-status">{status}</span>}
    </>
  );
}
