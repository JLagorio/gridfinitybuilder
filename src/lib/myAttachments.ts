/**
 * "My attachments": a board's parts of your own, set up the way you like them,
 * kept in the browser rather than in the project, so every board has them
 * (state/myAttachments.ts keeps them; the Attachments tab's picker lists them
 * under Mine: components/MyAttachments.tsx). Modelled on My bins (myBins.ts).
 *
 * An entry is one attachment, or a few saved together (a set), with
 * everything a placed one carries except its id and where it is: its kind and
 * options, its name, its common options (lock keys, bolt, label, barbs,
 * material, filament) and, when wanted, what's in it. A set keeps its parts'
 * places from one another in lattice steps, not millimetres: every board's
 * slots are on a lattice, whatever its step, so a set goes on any board the
 * way it was arranged.
 *
 * A kind this version doesn't know (saved by a newer one) is kept as it is,
 * so nothing is lost, but it can't be placed until the page updates.
 *
 * Share links (lib/share.ts's codec and its link format): `#attachments=` and
 * the entries, as a My attachments file holds them, deflated.
 *
 * Pure: no storage, no store. Loaded with the Attachments tab.
 */
import type { Vec2 } from './geometry/kernel';
import { newId } from './bins';
import { sanitizeContents } from './inventory';
import { uniqueTemplateName } from './templates';
import { decodeProject, encodeProject } from './share';
import { shareableAttachment } from './externalShare';
import { attachmentDef, type AttachmentLayout, type MountCtx, type MountKind, type PlacedAttachment } from './wall';
import { MATERIALS, type Material } from './wall/load';
import { partBounds, siteAt } from './wall/mount';
import { fitsAt, slotKeys, type WallBoard, type WallPlacement } from './wall/plan';
import { onBoard, overlaps, placeAttachments, type Box } from './wall/place';
import { bounds, pasteSpot, type PasteItem } from './wall/arrange';

/** Version of the stored library, of exported files and of share links. Older ones are read and brought up to date (cleanEntry). */
export const MY_ATTACHMENTS_VERSION = 1;
export const MY_ATTACHMENTS_KIND = 'my-attachments';
/** Most entries kept, and most parts in one entry, so a file or a link can't flood the browser's storage. */
export const MAX_ENTRIES = 500;
export const MAX_ENTRY_ITEMS = 64;
export const NAME_MAX = 80;
/**
 * Most the options of a kind this version doesn't know may take, as JSON text (a kind it knows bounds its own when it
 * cleans them). Kinds' options are a few hundred characters; a part drawn in the custom builder a few thousand, a
 * shadow board's traced tools up to some forty thousand: this leaves room and still stops a damaged file.
 */
export const MAX_OPTS_CHARS = 100_000;
/** The share link's hash: lib/share.ts's `project=`, for attachments. */
export const ATTACHMENTS_PREFIX = 'attachments=';
/** Longest link made or opened, characters: anything longer is a file's job. */
export const LINK_MAX = 200_000;
/** A link longer than this may be cut short by chat apps and mail, characters. */
export const LINK_LONG = 8_000;

/** A board, as the previews draw it when there's none at hand: the standard Skådis lattice. */
export const DEFAULT_CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

/** The common options an entry keeps (PlacedAttachment's, less its id and place). */
type Common = Pick<PlacedAttachment, 'name' | 'colour' | 'lock' | 'bolt' | 'label' | 'labelStyle' | 'labelFrom' | 'barbs' | 'material' | 'contents'>;

/** One part of an entry: a placed attachment without its id and place. */
export interface LibraryItem extends Common {
  type: string;
  opts: Record<string, unknown>;
  /** Its anchor slot from the first part's, in lattice steps (right, up). The first part's is 0, 0. */
  di: number;
  dj: number;
}

export interface AttachmentEntry {
  id: string;
  name: string;
  items: LibraryItem[];
  /** When it was saved, and last changed (ms since 1970); the newer copy wins when importing. 0 = unknown. */
  created: number;
  updated: number;
}

/** The stored library, an exported .json file and what a share link holds. */
export interface AttachmentLibraryData {
  app: 'gridfit';
  kind: typeof MY_ATTACHMENTS_KIND;
  version: number;
  attachments: AttachmentEntry[];
}

// ---------------------------------------------------------------------------
// Reading: files, links and storage, any version
// ---------------------------------------------------------------------------

export function libraryData(entries: AttachmentEntry[]): AttachmentLibraryData {
  return { app: 'gridfit', kind: MY_ATTACHMENTS_KIND, version: MY_ATTACHMENTS_VERSION, attachments: entries };
}

/**
 * The entries in a stored library, a file or a link, before cleaning, and the version that wrote them. Version 0
 * is a bare list (of entries, or of placed attachments: a board's list). A newer version is read too (the caller
 * decides what to do with it).
 */
export function readLibraryData(data: unknown): { version: number; entries: unknown[] } | { error: string } {
  if (Array.isArray(data)) return { version: 0, entries: data };
  if (!isObject(data)) return { error: 'This isn’t a My attachments file.' };
  if (data.kind === MY_ATTACHMENTS_KIND && Array.isArray(data.attachments)) {
    const v = Number(data.version);
    return { version: Number.isFinite(v) && v >= 0 ? v : 0, entries: data.attachments };
  }
  if (data.kind === 'my-bins') return { error: 'This is a My bins file: import it from My bins, on a drawer’s Bins tab.' };
  if (data.app === 'gridfit' && (Array.isArray(data.drawers) || data.drawer))
    return { error: 'This is a Gridfit project file: open it with Open project… (Print plates tab).' };
  return { error: 'This isn’t a My attachments file.' };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

const MATERIAL_KEYS = Object.keys(MATERIALS) as Material[];
const step = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(-1000, Math.min(1000, n)) : 0;
};

/** The common options, cleaned (only the ones set). */
function cleanCommon(v: Record<string, unknown>): Common {
  const out: Common = {};
  const name = cleanName(v.name);
  if (name) out.name = name;
  if (typeof v.colour === 'number' && Number.isInteger(v.colour) && v.colour >= 1 && v.colour <= 16) out.colour = v.colour;
  if (typeof v.lock === 'boolean') out.lock = v.lock;
  if (v.bolt === 'm3' || v.bolt === 'm4') out.bolt = v.bolt;
  const label = typeof v.label === 'string' ? v.label.replace(/[\r\n\t]+/g, ' ').slice(0, NAME_MAX) : '';
  if (label.trim()) out.label = label;
  if (v.labelStyle === 'raised' || v.labelStyle === 'inlaid') out.labelStyle = v.labelStyle;
  if (v.barbs === 'ends') out.barbs = 'ends';
  if (MATERIAL_KEYS.includes(v.material as Material)) out.material = v.material as Material;
  const contents = sanitizeContents(v.contents);
  if (contents) out.contents = contents;
  if (v.labelFrom === 'contents') out.labelFrom = 'contents';
  return out;
}

/**
 * One part from storage, a file or a link, or null when there's nothing usable in it. A kind this version knows has
 * its options cleaned by the kind (with defaults for anything added since); one it doesn't is kept as it came.
 */
export function cleanItem(v: unknown): LibraryItem | null {
  if (!isObject(v) || typeof v.type !== 'string' || !v.type.trim() || v.type.length > 60) return null;
  const def = attachmentDef(v.type);
  let opts: Record<string, unknown>;
  try {
    opts = def ? (def.sanitize(v.opts) as Record<string, unknown>) : isObject(v.opts) ? structuredClone(v.opts) : {};
    if (!def && JSON.stringify(opts).length > MAX_OPTS_CHARS) return null;
  } catch {
    return null;
  }
  return { type: v.type, opts, ...cleanCommon(v), di: step(v.di), dj: step(v.dj) };
}

/** Whether this version knows every kind in it (else it's kept, shown, but can't be placed). */
export const itemKnown = (it: Pick<LibraryItem, 'type'>) => !!attachmentDef(it.type);
export const entryKnown = (e: Pick<AttachmentEntry, 'items'>) => e.items.every(itemKnown);

const time = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * One entry from storage, a file or a link, brought up to date, or null when there's nothing usable in it. An older
 * shape, a placed attachment on its own (version 0: a board's list), is an entry of one part.
 */
export function cleanEntry(v: unknown): AttachmentEntry | null {
  if (!isObject(v)) return null;
  const list = Array.isArray(v.items) ? v.items : typeof v.type === 'string' ? [{ ...v, di: 0, dj: 0 }] : null;
  if (!list) return null;
  const items = list
    .slice(0, MAX_ENTRY_ITEMS)
    .map(cleanItem)
    .filter((it): it is LibraryItem => !!it);
  if (!items.length) return null;
  // The first part's anchor is the set's origin.
  const [i0, j0] = [items[0].di, items[0].dj];
  for (const it of items) [it.di, it.dj] = [it.di - i0, it.dj - j0];
  const created = time(v.created);
  return {
    id: typeof v.id === 'string' && v.id.trim() ? v.id.trim().slice(0, 40) : newId(),
    // A placed attachment's own name is its part's; the entry takes it too.
    name: (Array.isArray(v.items) && cleanName(v.name)) || defaultEntryName(items),
    items,
    created,
    updated: Math.max(created, time(v.updated)),
  };
}

/** A whole library from storage, a file or a link: every usable entry, ids made unique. */
export function cleanLibrary(list: unknown[]): AttachmentEntry[] {
  const out: AttachmentEntry[] = [];
  const ids = new Set<string>();
  for (const v of list) {
    if (out.length >= MAX_ENTRIES) break;
    const e = cleanEntry(v);
    if (!e) continue;
    if (ids.has(e.id)) e.id = newId();
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** What a part is called: its own name, else its kind's summary ("J hook 50 mm"), else its kind (one this version doesn't know). */
export function itemName(it: Pick<LibraryItem, 'type' | 'opts' | 'name'>): string {
  if (it.name?.trim()) return it.name.trim();
  const def = attachmentDef(it.type);
  return def ? def.summary(def.sanitize(it.opts) as never) : it.type;
}

/** A name for parts about to be saved: the one's name, or the first one's and how many more. */
export function defaultEntryName(items: readonly Pick<LibraryItem, 'type' | 'opts' | 'name'>[]): string {
  if (!items.length) return 'Part';
  const first = itemName(items[0]);
  return cleanName(items.length === 1 ? first : `${first} + ${items.length - 1} more`) || 'Part';
}

export interface EntryOptions {
  /** Its name ('' or missing: defaultEntryName). */
  name?: string;
  /** The board's lattice step, mm: places become steps. */
  pitch: number;
  /** Keep what's in them (and a label that says so). */
  contents: boolean;
  /** Names already in the library (the new name is made unique). */
  taken?: readonly string[];
  now?: number;
}

/**
 * Placed attachments as a library entry: a set when there are several, each part's anchor kept from the first one's
 * in lattice steps. Every common option is kept; what's in them only when asked (a label from it goes with it).
 */
export function entryFromAttachments(list: readonly PlacedAttachment[], o: EntryOptions): AttachmentEntry | null {
  if (!list.length || !(o.pitch > 0)) return null;
  const [x0, y0] = [list[0].x, list[0].y];
  const raw = list.map(({ id: _id, x, y, ...rest }) => {
    const it: Record<string, unknown> = { ...rest, di: (x - x0) / o.pitch, dj: (y - y0) / o.pitch };
    if (!o.contents) delete it.contents;
    if (!o.contents && it.labelFrom === 'contents') delete it.labelFrom;
    return it;
  });
  const now = o.now ?? Date.now();
  const e = cleanEntry({ id: newId(), items: raw, created: now, updated: now });
  if (!e) return null;
  return { ...e, name: uniqueTemplateName(cleanName(o.name) || e.name, [...(o.taken ?? [])]) };
}

/** A part as it goes on a board: a placed attachment of its own (a fresh copy of its options). */
export function placedOf(it: LibraryItem, id: string, x: number, y: number): PlacedAttachment {
  const { di: _di, dj: _dj, type, opts, ...common } = it;
  return { id, type, x, y, opts: structuredClone(opts), ...common };
}

// ---------------------------------------------------------------------------
// Showing
// ---------------------------------------------------------------------------

/** A part in an entry's front view: its body, its mounts, both in mm from the first part's anchor. */
export interface ViewPart {
  x: number;
  y: number;
  w: number;
  h: number;
  mounts: { x: number; y: number; kind: MountKind }[];
  /** A kind this version doesn't know: a box where its anchor is. */
  unknown?: true;
}

/** An entry seen from the front on a board of `ctx`: its parts, and the box round them (mounts included), mm. */
export function entryView(e: Pick<AttachmentEntry, 'items'>, ctx: MountCtx = DEFAULT_CTX): { parts: ViewPart[]; box: Box } {
  const parts: ViewPart[] = [];
  const boxes: Box[] = [];
  for (const it of e.items) {
    const ax = it.di * ctx.pitch;
    const ay = it.dj * ctx.pitch;
    const def = attachmentDef(it.type);
    let laid: AttachmentLayout | null = null;
    try {
      laid = def ? def.layout(def.sanitize(it.opts), ctx) : null;
    } catch {
      // Options it can't lay out: shown like a kind it doesn't know.
    }
    if (!laid) {
      const s = 2 * ctx.pitch;
      parts.push({ x: ax - s / 2, y: ay - s, w: s, h: s, mounts: [], unknown: true });
      boxes.push({ x0: ax - s / 2, y0: ay - s, x1: ax + s / 2, y1: ay });
      continue;
    }
    const layout = laid;
    const ox = ax - layout.anchor[0];
    const oy = ay - layout.anchor[1];
    const b = partBounds(layout, ctx);
    parts.push({
      x: ox,
      y: oy,
      w: layout.w,
      h: layout.h,
      mounts: layout.mounts.map((m) => {
        const [mx, my] = siteAt(layout, m, ctx);
        return { x: ox + mx, y: oy + my, kind: m.kind };
      }),
    });
    boxes.push({ x0: ox + b.x0, y0: oy + b.y0, x1: ox + b.x1, y1: oy + b.y1 });
  }
  return { parts, box: bounds(boxes) };
}

/** Does the entry match a search? Every word has to be in its name, its parts' names, kinds (`kindLabel`), labels or contents. */
export function entryMatches(e: AttachmentEntry, query: string, kindLabel: (type: string) => string = (t) => t): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [e.name, ...e.items.flatMap((it) => [itemName(it), kindLabel(it.type), it.label ?? '', it.contents ?? ''])].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ---------------------------------------------------------------------------
// Importing: merge, de-duplicated
// ---------------------------------------------------------------------------

/** Plain data with object keys sorted, so the same part always reads the same. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!isObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonical(v[k]);
  return out;
}

/** What makes two entries the same parts (not their name, id or dates). */
export function entryFingerprint(e: Pick<AttachmentEntry, 'items'>): string {
  return JSON.stringify(canonical(e.items));
}

export interface MergeReport {
  /** New to the library. */
  added: number;
  /** Same id, the incoming copy newer: it replaced the one here. */
  updated: number;
  /** In the library already (same id, or the same parts under another name). */
  same: number;
  /** Same id, the copy here newer: kept. */
  older: number;
}

/**
 * Entries from a file or a link joined to the library. Same id: the newer copy stays. The same parts under another
 * id are there already. New names that clash get a number.
 */
export function mergeLibrary(current: AttachmentEntry[], incoming: AttachmentEntry[]): { entries: AttachmentEntry[]; report: MergeReport } {
  const report: MergeReport = { added: 0, updated: 0, same: 0, older: 0 };
  let out = [...current];
  for (const inc of incoming) {
    const fp = entryFingerprint(inc);
    const at = out.findIndex((e) => e.id === inc.id);
    if (at >= 0) {
      const cur = out[at];
      if (entryFingerprint(cur) === fp && cur.name === inc.name) report.same++;
      else if (inc.updated > cur.updated) {
        out = out.map((e, i) => (i === at ? inc : e));
        report.updated++;
      } else report.older++;
      continue;
    }
    if (out.some((e) => entryFingerprint(e) === fp)) {
      report.same++;
      continue;
    }
    if (out.length >= MAX_ENTRIES) break;
    out.push({
      ...inc,
      name: uniqueTemplateName(
        inc.name,
        out.map((e) => e.name),
      ),
    });
    report.added++;
  }
  return { entries: out, report };
}

// ---------------------------------------------------------------------------
// Placing on a board
// ---------------------------------------------------------------------------

const shift = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/**
 * Where an entry goes on a board, and the attachments it becomes there. Like any part added from the picker, at the
 * first free spot that fits, looking out from the board's top left; a set as it was arranged (wall/arrange.ts
 * pasteSpot, as pasting does). `clear`: on slots, on the board and clear of `taken` (the board's parts); when there's
 * no such spot it goes where its mounts all find slots, else near the top left, and shows red there like any part.
 */
export function planOnBoard(
  e: Pick<AttachmentEntry, 'items'>,
  board: WallBoard,
  taken: readonly WallPlacement[],
  id: () => string = newId,
): { list: PlacedAttachment[]; clear: boolean } | { error: string } {
  if (!entryKnown(e)) return { error: 'It was saved by a newer version of Gridfit: reload the page to update, then add it.' };
  if (!board.slots.length) return { error: 'This board has no slots.' };
  const p = board.ctx.pitch;
  const src = e.items.map((it, i) => placedOf(it, `#${i}`, it.di * p, it.dj * p));
  // Each one's front view on this board (its lock keys included), from its anchor.
  const tmp = placeAttachments(src, board).placed;
  const items: PasteItem[] = [];
  for (const a of src) {
    const q = tmp.find((t) => t.id === a.id);
    if (!q) return { error: 'It can’t be planned on this board.' };
    items.push({ x: a.x, y: a.y, layout: q.layout, box: { x0: q.x0 - q.x, y0: q.y0 - q.y, x1: q.x1 - q.x, y1: (q.top ?? q.y1) - q.y } });
  }
  // Its top left on the board's (inside a frame's rim): the first anchor there.
  const around = bounds(items.map((it) => shift(it.box, it.x, it.y)));
  const rim = board.rim ?? 0;
  const near: Vec2 = [items[0].x + rim - around.x0, items[0].y + board.H - rim - around.y1];
  const keys = slotKeys(board.slots);
  const others = taken.map((t) => ({ x0: t.x0, y0: t.y0, x1: t.x1, y1: t.top ?? t.y1 }));
  const at = pasteSpot(board, keys, items, others, near);
  if (!at) return { error: 'This board has no slots.' };
  const boxes = at.map(([x, y], i) => shift(items[i].box, x, y));
  const clear =
    at.every(([x, y], i) => fitsAt(keys, items[i].layout, board.ctx, x, y)) &&
    boxes.every((b, i) => onBoard(b, board) && !others.some((q) => overlaps(b, q)) && !boxes.slice(0, i).some((q) => overlaps(b, q)));
  return { list: src.map((a, i) => ({ ...a, id: id(), x: at[i][0], y: at[i][1] })), clear };
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

/**
 * Entries as a link carries them: an imported model (wall/kinds/model.ts) without its mesh's hash, as a project's
 * link has it (externalShare.ts), so a box of its size stands in. `models`: how many parts that left as boxes.
 */
export function linkData(entries: readonly AttachmentEntry[]): { data: AttachmentLibraryData; models: number } {
  let models = 0;
  const strip = (it: LibraryItem): LibraryItem => {
    const a = shareableAttachment({ id: '', x: 0, y: 0, type: it.type, opts: it.opts });
    if (a.opts === it.opts) return it;
    models++;
    return { ...it, opts: a.opts };
  };
  return { data: libraryData(entries.map((e) => ({ ...e, items: e.items.map(strip) }))), models };
}

/** `base` with the entries in its hash (any hash it had is replaced), or why it can't be: too long for a link. */
export function attachmentsShareUrl(entries: readonly AttachmentEntry[], base: string): { url: string; models: number } | { error: string } {
  const { data, models } = linkData(entries);
  const u = new URL(base);
  u.hash = ATTACHMENTS_PREFIX + encodeProject(data);
  const url = u.toString();
  if (url.length > LINK_MAX) return { error: 'It’s too big for a link: export a file instead (Export file, under Mine).' };
  return { url, models };
}

/** Whether a URL hash is an attachments link (without decoding it). */
export const isAttachmentsHash = (hash: string) => hash.replace(/^#/, '').startsWith(ATTACHMENTS_PREFIX);

/**
 * The entries in an attachments link's hash, cleaned (`invalid`: how many had nothing usable), or why they can't be
 * read; null when the hash isn't one.
 */
export function attachmentsFromHash(hash: string): { entries: AttachmentEntry[]; invalid: number } | { error: string } | null {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith(ATTACHMENTS_PREFIX)) return null;
  const code = h.slice(ATTACHMENTS_PREFIX.length);
  let data: unknown;
  try {
    if (code.length > LINK_MAX) throw new Error('too long');
    data = decodeProject(decodeURIComponent(code));
  } catch {
    return { error: 'This link is damaged or incomplete.' };
  }
  const r = readLibraryData(data);
  if ('error' in r) return { error: 'This link has no attachments in it.' };
  if (r.version > MY_ATTACHMENTS_VERSION) return { error: 'This link comes from a newer version of Gridfit. Reload the page to update, then open it again.' };
  const entries = cleanLibrary(r.entries);
  return { entries, invalid: r.entries.length - entries.length };
}
