import type { JobPart, PrintJob } from './project';
import { baseMeshKey } from './colours';

/**
 * What has been printed, so a project printed over weeks can reprint only
 * what changed since.
 *
 * Parts are known by a fingerprint of their geometry: a hash of the mesh key
 * the worker builds and caches them by (project.ts binSpec, lidSpec,
 * pieceMeshKey, …). A bin's key doesn't say where it sits on full cells, so
 * moving it changes nothing; resizing it or changing one of its options
 * does. Prints are counted per fingerprint: three identical bins are three
 * prints of one fingerprint, and any of them can stand in for another.
 *
 * A board's parts go the same way: an attachment's key is its kind, options,
 * label and the slots it clips into (the board's thickness and fit), never
 * where it hangs or what it's called; a tile's is its outline, slots, joints
 * and number; alike hexagons, joint plates and lock keys are prints of one
 * part (printedBoards.ts has the rest).
 *
 * The record also says which part each print was (by drawer and part key),
 * so a drawer printed on its own doesn't take the prints of another drawer's
 * identical bins.
 */
export interface PrintedRecord {
  /** Prints per fingerprint. */
  counts: Record<string, number>;
  /**
   * The fingerprint each marked part had, by part (`partId`). The counts cover
   * these parts first, and one whose fingerprint has moved on shows as changed.
   */
  parts: Record<string, string>;
}

export const NO_PRINTS: PrintedRecord = { counts: {}, parts: {} };

export const hasPrints = (r: PrintedRecord | null | undefined) => !!r && Object.keys(r.counts).length > 0;

/** Parts recorded, counting each print. */
export const printCount = (r: PrintedRecord) => Object.values(r.counts).reduce((t, n) => t + n, 0);

const cache = new Map<string, string>();

/**
 * What a part's mesh key says about its geometry: the key itself, or for a board's parts whose key also says where
 * they go (a cleat's height on the board, a frame strip's place along its edge), the key without that. Boards hand it
 * in with their planning (printedBoards.ts), which isn't on the first screen.
 */
let printKey = (key: string) => key;
export function setPrintKey(f: (key: string) => string) {
  printKey = f;
  cache.clear();
}

/** A short hash of a part's mesh key (cyrb53: 53 bits, as 14 hex digits). Colours don't count: a part split by colour is the same print. */
export function fingerprint(key: string): string {
  let hit = cache.get(key);
  if (hit) return hit;
  const meshKey = printKey(baseMeshKey(key));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < meshKey.length; i++) {
    const c = meshKey.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  hit = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  if (cache.size > 5000) cache.clear();
  cache.set(key, hit);
  return hit;
}

/** The part's key in its drawer (`bin:<id>`, `piece:3`), without the prefix a job of several drawers gives it. */
export function localKey(part: Pick<JobPart, 'key' | 'drawer'>): string {
  return part.drawer && part.key.startsWith(`${part.drawer}/`) ? part.key.slice(part.drawer.length + 1) : part.key;
}

/** The part's id in the record, the same whichever drawers are printed: `d1/bin:<id>`, `d1/piece:3`. */
export function partId(part: Pick<JobPart, 'key' | 'drawer'>): string {
  return part.drawer ? `${part.drawer}/${localKey(part)}` : localKey(part);
}

/**
 * The parts on the job's plates the record covers, as far as its counts go:
 * the parts it names (with the fingerprint they have now) first, then the
 * others in plate order. Prints of drawers that aren't in the job stay theirs.
 */
export function coveredParts(job: Pick<PrintJob, 'plates' | 'parts' | 'drawers'>, rec: PrintedRecord): Set<string> {
  const out = new Set<string>();
  if (!hasPrints(rec)) return out;
  const keys = job.plates.flatMap((pl) => pl.placements.map((p) => p.key));
  const left = new Map(Object.entries(rec.counts));
  const drawers = new Set(job.drawers.map((d) => d.id));
  for (const [id, f] of Object.entries(rec.parts)) {
    const at = id.indexOf('/');
    if (at > 0 && !drawers.has(id.slice(0, at)) && (left.get(f) ?? 0) > 0) left.set(f, left.get(f)! - 1);
  }
  const take = (k: string) => {
    const f = fingerprint(job.parts[k].meshKey);
    const n = left.get(f) ?? 0;
    if (n <= 0) return;
    left.set(f, n - 1);
    out.add(k);
  };
  for (const k of keys) if (rec.parts[partId(job.parts[k])] === fingerprint(job.parts[k].meshKey)) take(k);
  for (const k of keys) if (!out.has(k)) take(k);
  return out;
}

/** The job's parts on plates that the record covers (planPrint sets `job.printed`). */
export const printedOn = (job: PrintJob, rec: PrintedRecord): Set<string> => (job.printed ? new Set(job.printed) : coveredParts(job, rec));

/** The record with a print more (`by` 1) of every part on these plates it doesn't cover yet, or without the prints (-1) that cover them. */
function count(rec: PrintedRecord, job: PrintJob, plates: number[], by: 1 | -1): PrintedRecord {
  const covered = printedOn(job, rec);
  const counts = { ...rec.counts };
  const parts = { ...rec.parts };
  for (const i of plates) {
    for (const p of job.plates[i]?.placements ?? []) {
      if (covered.has(p.key) === by > 0) continue;
      const part = job.parts[p.key];
      const f = fingerprint(part.meshKey);
      const id = partId(part);
      if ((counts[f] = (counts[f] ?? 0) + by) < 1) delete counts[f];
      if (by > 0) parts[id] = f;
      else if (parts[id] === f) delete parts[id];
      covered[by > 0 ? 'add' : 'delete'](p.key);
    }
  }
  return { counts, parts };
}

/** The record with a print of every part on these plates that isn't covered yet. */
export const markPrinted = (rec: PrintedRecord, job: PrintJob, plates: number[]) => count(rec, job, plates, 1);

/** The record without the prints that cover parts on these plates. */
export const unmarkPrinted = (rec: PrintedRecord, job: PrintJob, plates: number[]) => count(rec, job, plates, -1);

/** Bins of a drawer's job with something to show: printed, or printed before and changed since. */
export function binPrintMarks(job: PrintJob, rec: PrintedRecord): Record<string, 'printed' | 'changed'> {
  const out: Record<string, 'printed' | 'changed'> = {};
  if (!hasPrints(rec)) return out;
  const covered = coveredParts(job, rec);
  for (const part of Object.values(job.parts)) {
    if (part.kind !== 'bin') continue;
    const id = localKey(part).slice('bin:'.length);
    const was = rec.parts[partId(part)];
    if (covered.has(part.key)) out[id] = 'printed';
    else if (was && was !== fingerprint(part.meshKey)) out[id] = 'changed';
  }
  return out;
}

/** A saved record, checked (projects saved before there was one, or edited by hand). */
export function cleanPrinted(saved: unknown): PrintedRecord {
  const r = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof PrintedRecord, unknown>>;
  const counts: Record<string, number> = {};
  const parts: Record<string, string> = {};
  const ok = (k: string) => k.length > 0 && k.length <= 64;
  if (r.counts && typeof r.counts === 'object') {
    for (const [k, v] of Object.entries(r.counts).slice(0, 50000)) {
      const n = Math.floor(Number(v));
      if (ok(k) && Number.isFinite(n) && n > 0) counts[k] = Math.min(n, 100000);
    }
  }
  if (r.parts && typeof r.parts === 'object') {
    for (const [k, v] of Object.entries(r.parts).slice(0, 50000)) if (k.length <= 200 && typeof v === 'string' && ok(v)) parts[k] = v;
  }
  return { counts, parts };
}
