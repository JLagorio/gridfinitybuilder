import { useEffect, useState } from 'react';
import { projectFile, useStore } from '../state/store';
import { shareUrl } from '../lib/share';
import { shareableProject } from '../lib/externalShare';

/** Copies a link that holds the whole project (lib/share.ts). Imported bins go in it as boxes of their size: a link can't hold meshes. */
export function CopyShareLink() {
  const [status, setStatus] = useState<string | null>(null);
  const copy = async () => {
    const { file, dropped } = shareableProject(projectFile(useStore.getState()));
    const url = shareUrl(file, window.location.href);
    const size = url.length > 1500 ? ` (${Math.round(url.length / 100) / 10} k characters)` : '';
    const note = dropped
      ? ` ${dropped === 1 ? 'The imported bin goes' : `The ${dropped} imported bins go`} as plain boxes: a link can't hold meshes. Save the project file to pass them on.`
      : '';
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
      <button onClick={copy} title="A link with the whole project in it. Nothing is uploaded. Imported bins go as boxes of their size (a link can't hold meshes).">
        Copy share link
      </button>
      {status && <span className="field-hint share-status">{status}</span>}
    </>
  );
}
