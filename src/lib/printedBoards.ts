/**
 * What's been printed (printed.ts), for boards: loaded with the first board
 * (lib/wall/kinds/all.ts), so none of it is on the first screen.
 *
 * - A board's parts whose mesh key says where they go: a cleat, door hook or
 *   desk part has its height on the board in it, a frame strip its place along
 *   the edge. Their fingerprints go by the part as it prints, so a hook that
 *   moves up with a taller board, or the second of two alike, is a print of
 *   the same part.
 * - Marks for the board's editors: each attachment with its extra parts (lids,
 *   containers, lock keys, T-nuts) and each tile, printed or changed since.
 */
import { coveredParts, fingerprint, hasPrints, localKey, partId, setPrintKey, type PrintedRecord } from './printed';
import type { JobPart, PrintJob } from './project';
import type { SkadisHangPart, SkadisRimPart } from './geometry/skadis';

export type PrintMark = 'printed' | 'changed';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const HANG = 'skadishang|';
const RIM = 'skadisrim|';

/**
 * A part the board hangs from, as it prints: built from its profile, holes along it and up, a clamp's bolt and a
 * foot's window, its box's corner at the origin (skadisParts.ts), so where it runs from (`x`) and how high it is on
 * the board are no part of it.
 */
function hangKey(h: SkadisHangPart): string {
  const y0 = Math.min(...h.profile.map((p) => p[1]));
  const up = (y: number) => r3(y - y0);
  const { x: _, ...rest } = h;
  return JSON.stringify({
    ...rest,
    profile: h.profile.map(([z, y]) => [z, up(y)]),
    holes: h.holes.map((o) => ({ ...o, y: up(o.y) })),
    ...(h.bolt ? { bolt: { ...h.bolt, y0: up(h.bolt.y0), y1: up(h.bolt.y1) } } : {}),
    ...(h.window ? { window: h.window.map(([z, y]) => [z, up(y)]) } : {}),
  });
}

/**
 * A frame strip as it prints: its box inside the board's rounded outline, and its pins, from its corner. Only the
 * board's corners within reach of the strip shape it, so each edge of the outline comes in to just past the
 * corner's radius: a top strip is the same part on a board 300 or 400 mm tall.
 */
function rimKey(p: SkadisRimPart): string | null {
  const { x0, y0, x1, y1, pins, W, H, R, ...rest } = p;
  const w = r3(x1 - x0);
  const h = r3(y1 - y0);
  // A strip outside the board's box is drawn as it is.
  if (x0 < -1e-6 || y0 < -1e-6 || x1 > W + 1e-6 || y1 > H + 1e-6) return null;
  const m = R + 1;
  const clamp = (v: number, lo: number, hi: number) => r3(Math.min(hi, Math.max(lo, v)));
  return JSON.stringify({
    ...rest,
    w,
    h,
    R,
    board: [clamp(-x0, -m, 0), clamp(-y0, -m, 0), clamp(W - x0, w, w + m), clamp(H - y0, h, h + m)],
    pins: pins.map(([x, y]) => [r3(x - x0), r3(y - y0)]),
  });
}

/** A mesh key without where its part goes, for its fingerprint (printed.ts setPrintKey). */
export function boardPrintKey(key: string): string {
  try {
    if (key.startsWith(HANG)) return `skadishang@|${hangKey(JSON.parse(key.slice(HANG.length)))}`;
    if (key.startsWith(RIM)) {
      const k = rimKey(JSON.parse(key.slice(RIM.length)));
      if (k) return `skadisrim@|${k}`;
    }
  } catch {
    // Not one of ours after all: as it is.
  }
  return key;
}

setPrintKey(boardPrintKey);

/** Whose a part is, for its mark: an attachment's extra parts are its own (`att:<id>`), anything else its key in its drawer (`piece:3`, `bin:<id>`). */
const owner = (part: JobPart) => (part.attachment ? `att:${part.attachment}` : localKey(part));

/**
 * The parts of a drawer's job with something to show, by owner (an attachment with its extra parts, `att:<id>`; a
 * tile, `piece:3`): printed, all of it; or changed, when some of it was printed and isn't now (changed since, or
 * printed in part).
 */
export function partMarks(job: PrintJob, rec: PrintedRecord): Record<string, PrintMark> {
  const out: Record<string, PrintMark> = {};
  if (!hasPrints(rec)) return out;
  const covered = coveredParts(job, rec);
  const seen = new Map<string, { n: number; done: number; was: boolean }>();
  for (const part of Object.values(job.parts)) {
    const k = owner(part);
    const s = seen.get(k) ?? { n: 0, done: 0, was: false };
    seen.set(k, s);
    s.n++;
    const was = rec.parts[partId(part)];
    if (covered.has(part.key)) s.done++;
    else if (was && was !== fingerprint(part.meshKey)) s.was = true;
  }
  for (const [k, s] of seen) {
    if (s.done === s.n) out[k] = 'printed';
    else if (s.done || s.was) out[k] = 'changed';
  }
  return out;
}

/** A mark's symbol, ✓ printed or ● changed since, and what it says. */
export const markText = (m: PrintMark) => (m === 'printed' ? '✓' : '●');
export const markTitle = (m: PrintMark) => (m === 'printed' ? 'Printed' : 'Changed since it was printed: it prints again with “Only what’s changed”');
