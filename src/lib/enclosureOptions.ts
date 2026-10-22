import type { DrawerInput } from './layout/drawer';
import { sanitizeCase } from './geometry/case';
import { sanitizeWall } from './geometry/wallmount';
import { sanitizeSpacers } from './geometry/spacers';
import { sanitizeSkadis } from './geometry/skadisOptions';
import { isGridBoard } from './gridBoards';
import type { PlacedAttachment } from './wall/registry';
import { sanitizeContents } from './inventory';

/**
 * Clean a saved drawer's enclosure fields (carry case, wall grid, spacer
 * strips, Skådis, openGrid and Multiboard boards). Each is only kept when it was there, so drawers saved
 * before they existed come back exactly as they were (same layout, same mesh
 * keys).
 */
export function cleanEnclosure(d: DrawerInput): DrawerInput {
  const out = { ...d };
  if (out.enclosure !== 'case' && out.enclosure !== 'wall' && out.enclosure !== 'skadis' && !isGridBoard(out.enclosure)) delete out.enclosure;
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (obj(out.carryCase)) out.carryCase = sanitizeCase(out.carryCase);
  else delete out.carryCase;
  if (obj(out.wallMount)) out.wallMount = sanitizeWall(out.wallMount);
  else delete out.wallMount;
  if (obj(out.spacers)) out.spacers = sanitizeSpacers(out.spacers);
  else delete out.spacers;
  if (obj(out.skadis)) out.skadis = sanitizeSkadis(out.skadis);
  else delete out.skadis;
  // openGrid and Multiboard boards' options are cleaned as they're planned (gridBoardPlan.ts).
  for (const k of ['opengrid', 'multiboard'] as const) {
    if (obj(out[k])) out[k] = { ...out[k] };
    else delete out[k];
  }
  const atts = cleanAttachments(out.attachments);
  if (atts.length) out.attachments = atts;
  else delete out.attachments;
  return out;
}

/** Attachments as saved: each with an id, a kind and a place; their options are cleaned by their kind when planned. */
export function cleanAttachments(raw: unknown): PlacedAttachment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlacedAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id ? r.id : '';
    const x = Number(r.x);
    const y = Number(r.y);
    if (!id || seen.has(id) || typeof r.type !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen.add(id);
    const opts = r.opts && typeof r.opts === 'object' && !Array.isArray(r.opts) ? { ...(r.opts as Record<string, unknown>) } : {};
    const contents = sanitizeContents(r.contents);
    out.push({
      id,
      type: r.type,
      x,
      y,
      opts,
      ...(typeof r.name === 'string' && r.name.trim() ? { name: r.name.slice(0, 80) } : {}),
      ...(Number.isInteger(r.colour) && (r.colour as number) > 0 ? { colour: r.colour as number } : {}),
      // The options every kind has (wall/registry.ts).
      ...(typeof r.lock === 'boolean' ? { lock: r.lock } : {}),
      ...(r.bolt === 'm3' || r.bolt === 'm4' ? { bolt: r.bolt } : {}),
      ...(typeof r.label === 'string' && r.label.trim() ? { label: r.label.slice(0, 40) } : {}),
      ...(r.labelStyle === 'raised' || r.labelStyle === 'inlaid' ? { labelStyle: r.labelStyle } : {}),
      ...(r.barbs === 'ends' ? { barbs: 'ends' as const } : {}),
      // What's in it (like a bin's contents), and a label that follows it.
      ...(contents ? { contents } : {}),
      ...(r.labelFrom === 'contents' ? { labelFrom: 'contents' as const } : {}),
      ...(r.material === 'pla' || r.material === 'petg' || r.material === 'asa' ? { material: r.material } : {}),
      ...(r.snap === true ? { snap: true as const } : {}),
    });
  }
  return out;
}

/**
 * A project saved before a board's attachments stayed where they're put (project files before version 4, autosave
 * before 3), copied with every attachment of its drawers marked to be planned as it was then (PlacedAttachment.snap).
 */
export function snapOld<T>(project: T): T {
  const p = structuredClone(project) as { drawer?: { attachments?: unknown }; drawers?: unknown } | null;
  for (const d of [p, ...(Array.isArray(p?.drawers) ? p.drawers : [])]) {
    const list = d?.drawer?.attachments;
    if (Array.isArray(list)) for (const a of list) if (a && typeof a == 'object') a.snap = true;
  }
  return p as T;
}
