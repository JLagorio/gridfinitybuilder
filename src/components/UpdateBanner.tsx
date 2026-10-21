import { useState } from 'react';
import { applyUpdate, useAppUpdate } from '../pwa/register';

/** "A new version is ready", once a new deploy has been downloaded for offline use. */
export function UpdateBanner() {
  const waiting = useAppUpdate((s) => s.waiting);
  const [later, setLater] = useState<ServiceWorker | null>(null);
  if (!waiting || later === waiting) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button className="primary" onClick={applyUpdate}>
        Reload
      </button>
      <button className="link" aria-label="Not now" title="Not now" onClick={() => setLater(waiting)}>
        ✕
      </button>
    </div>
  );
}
