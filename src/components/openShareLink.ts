import { useStore } from '../state/store';
import { openQuestion, projectFromHash } from '../lib/share';

/**
 * Opening a share link (ShareLink.tsx notices one in the URL's hash): a whole
 * project (lib/share.ts, `#project=`), or attachments for a Skådis board
 * (lib/myAttachments.ts, `#attachments=`). Loaded when a link is opened, with
 * the codec and its deflate, not with the first screen.
 */

function clearHash() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Offer to open what the link in the URL's hash holds. Clears the hash first, so a reload (or a second call) doesn't ask again. */
export async function openShareLink(): Promise<void> {
  const hash = window.location.hash;
  if (/^#?attachments=/.test(hash)) {
    clearHash();
    const { openSharedAttachments } = await import('./SharedAttachments');
    return openSharedAttachments(hash);
  }
  if (!/^#?project=/.test(hash)) return;
  clearHash();
  let data: unknown;
  let question: string | null;
  try {
    data = projectFromHash(hash);
    question = openQuestion(data);
  } catch (e) {
    alert((e as Error).message);
    return;
  }
  if (!question || !confirm(question)) return;
  try {
    useStore.getState().loadProject(data);
  } catch (e) {
    alert(`Couldn't open the shared project: ${(e as Error).message}`);
  }
}
