import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/**
 * Share links: the whole project file, deflated and base64url-encoded into the
 * URL hash (`#project=…`). The hash never reaches a server.
 */

export const SHARE_PREFIX = 'project=';

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeProject(project: unknown): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(project)), { level: 9 }));
}

export function decodeProject(code: string): unknown {
  return JSON.parse(strFromU8(inflateSync(fromBase64Url(code.trim()))));
}

/** `base` with the project in its hash (any existing hash is replaced). */
export function shareUrl(project: unknown, base: string): string {
  const u = new URL(base);
  u.hash = SHARE_PREFIX + encodeProject(project);
  return u.toString();
}

/** The project in a URL hash, or null when there isn't one. Throws when the link is damaged. */
export function projectFromHash(hash: string): unknown {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith(SHARE_PREFIX)) return null;
  try {
    return decodeProject(decodeURIComponent(h.slice(SHARE_PREFIX.length)));
  } catch {
    throw new Error('This share link is damaged or incomplete.');
  }
}
