import { useEffect } from 'react';

// Opening a link (openShareLink.ts, with lib/share.ts's codec and its deflate) loads when there is one, not with the
// first screen (copying one is in the Print panel: CopyShareLink.tsx, and My attachments: MyAttachments.tsx).
/** A project's link (lib/share.ts SHARE_PREFIX) or attachments' (lib/myAttachments.ts ATTACHMENTS_PREFIX), without loading them. */
const SHARE_HASH = /^#?(project|attachments)=/;

/** On load (and when the hash changes), offer to open a project, or attachments, from a share link. */
export function useOpenSharedProject() {
  useEffect(() => {
    const run = () => void (SHARE_HASH.test(window.location.hash) && import('./openShareLink').then((m) => m.openShareLink()));
    run();
    window.addEventListener('hashchange', run);
    return () => window.removeEventListener('hashchange', run);
  }, []);
}
