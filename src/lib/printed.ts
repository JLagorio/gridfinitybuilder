import type { JobPart, PrintJob } from './project';

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

/** A short hash of a mesh key (cyrb53: 53 bits, as 14 hex digits). */
export function fingerprint(meshKey: string): string {
  let hit = cache.get(meshKey);
  if (hit) return hit;
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
  cache.set(meshKey, hit);
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

/** The record with a print of every part on these plates that isn't covered yet. */
export function markPrinted(rec: PrintedRecord, job: PrintJob, plates: number[]): PrintedRecord {
  const covered = printedOn(job, rec);
  const counts = { ...rec.counts };
  const parts = { ...rec.parts };
  for (const i of plates) {
    for (const p of job.plates[i]?.placements ?? []) {
      if (covered.has(p.key)) continue;
      const part = job.parts[p.key];
      const f = fingerprint(part.meshKey);
      counts[f] = (counts[f] ?? 0) + 1;
      parts[partId(part)] = f;
      covered.add(p.key);
    }
  }
  return { counts, parts };
}

/** The record without the prints that cover parts on these plates. */
export function unmarkPrinted(rec: PrintedRecord, job: PrintJob, plates: number[]): PrintedRecord {
  const covered = printedOn(job, rec);
  const counts = { ...rec.counts };
  const parts = { ...rec.parts };
  for (const i of plates) {
    for (const p of job.plates[i]?.placements ?? []) {
      if (!covered.has(p.key)) continue;
      const part = job.parts[p.key];
      const f = fingerprint(part.meshKey);
      if ((counts[f] ?? 0) > 1) counts[f]--;
      else delete counts[f];
      if (parts[partId(part)] === f) delete parts[partId(part)];
      covered.delete(p.key);
    }
  }
  return { counts, parts };
}

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
