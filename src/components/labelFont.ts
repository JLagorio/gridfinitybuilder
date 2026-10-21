import { useEffect, useState } from 'react';
import { FONT_URL_PATH, hasFont, registerFont } from '../lib/geometry/text';

// The same font the worker uses for the geometry, loaded once per page.
let fontLoad: Promise<void> | null = null;

/**
 * The label font, for label previews and the text print checks: true once
 * it's in. It starts loading when `when` is (and stays) true, so a screen
 * that doesn't need text yet doesn't download it.
 */
export function useLabelFont(when = true): boolean {
  const [ok, setOk] = useState(hasFont());
  useEffect(() => {
    if (ok || !when) return;
    fontLoad ??= fetch(`${import.meta.env.BASE_URL}${FONT_URL_PATH}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!hasFont()) registerFont(b);
      });
    fontLoad.then(() => setOk(true)).catch(() => {});
  }, [ok, when]);
  return ok;
}
