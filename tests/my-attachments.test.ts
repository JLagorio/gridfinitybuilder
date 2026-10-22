import { beforeEach, describe, expect, it, vi } from 'vitest';
import { history, useStore } from '../src/state/store';
import {
  MY_ATTACHMENTS_KEY,
  activeBoard,
  addToMyAttachments,
  deleteMyAttachment,
  duplicateMyAttachment,
  importMyAttachments,
  libraryMeshHashes,
  loadLibrary,
  myAttachmentLink,
  myAttachmentsFileText,
  placeMyAttachment,
  putOnBoard,
  reloadMyAttachments,
  renameMyAttachment,
  saveToMyAttachments,
  setLibraryStorage,
  suggestedName,
  undoDeleteMyAttachment,
  useMyAttachments,
  type KeyValueStore,
} from '../src/state/myAttachments';
import {
  ATTACHMENTS_PREFIX,
  LINK_MAX,
  MAX_OPTS_CHARS,
  MY_ATTACHMENTS_VERSION,
  attachmentsFromHash,
  attachmentsShareUrl,
  cleanEntry,
  cleanLibrary,
  entryFingerprint,
  entryFromAttachments,
  entryKnown,
  entryMatches,
  entryView,
  libraryData,
  mergeLibrary,
  planOnBoard,
  readLibraryData,
  type AttachmentEntry,
} from '../src/lib/myAttachments';
import { encodeProject } from '../src/lib/share';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadis';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { attachmentDef, type PlacedAttachment } from '../src/lib/wall';
import '../src/lib/wall/kinds/all';
import { placeAttachments } from '../src/lib/wall/place';
import { boardOf } from '../src/lib/wall/templates';

/** localStorage, in memory. */
class FakeStorage implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
}

/** Storage that's full: every write fails the way browsers fail it. */
class FullStorage extends FakeStorage {
  setItem() {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }
}

const s = () => useStore.getState();
const lib = () => useMyAttachments.getState();
const stored = (st: FakeStorage) => JSON.parse(st.getItem(MY_ATTACHMENTS_KEY)!);
const list = () => s().drawer.attachments ?? [];

/** A part with options of its own and every common option. */
const PLIERS: Omit<PlacedAttachment, 'id' | 'x' | 'y'> = {
  type: 'toolRack',
  opts: { ...attachmentDef('toolRack')!.defaults, mode: 'pliers', pliers: '8, 10, 12' },
  name: 'Pliers',
  colour: 3,
  lock: false,
  bolt: 'm4',
  label: 'Cutters',
  labelStyle: 'inlaid',
  barbs: 'ends',
  material: 'petg',
  contents: 'Flush cutters\nNeedle-nose pliers',
};

/** A board drawer for planPrint. */
const boardDrawer = (attachments: PlacedAttachment[], skadis: SkadisOptions = DEFAULT_SKADIS): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const plan = (attachments: PlacedAttachment[], skadis: SkadisOptions = DEFAULT_SKADIS) =>
  planPrint([boardDrawer(attachments, skadis)], DEFAULT_SETUP, { baseplate: true, bins: true });

/** A new board in the project (a big one: the standard square), active, with these parts on it. */
function newBoard(parts: PlacedAttachment[] = [], skadis: Partial<SkadisOptions> = {}) {
  s().addDrawer('Board', { skadis: true });
  s().setDrawer({ skadis: { ...DEFAULT_SKADIS, ...skadis }, attachments: parts });
  return activeBoard()!;
}

/** Three parts: pliers, a bin and a cup, apart as they would be on a board. */
function threeParts(): PlacedAttachment[] {
  return [
    { id: 'p', x: 100, y: 500, ...structuredClone(PLIERS) },
    { id: 'b', type: 'bin', x: 260, y: 500, opts: { ...attachmentDef('bin')!.defaults, width: 80 }, contents: 'M3 screws', labelFrom: 'contents' },
    { id: 'c', type: 'cup', x: 100, y: 380, opts: { ...attachmentDef('cup')!.defaults } },
  ];
}

/** An entry of a kind this version doesn't know, with a few kB of options (a part drawn in a builder, say). */
function futureEntry(): AttachmentEntry {
  const profile = Array.from({ length: 200 }, (_, i) => [Math.round(Math.cos(i / 10) * 400) / 10, Math.round(Math.sin(i / 10) * 400) / 10]);
  return cleanEntry({
    id: 'future1',
    name: 'From a newer version',
    items: [{ type: 'notYetAKind', opts: { profile, features: [{ kind: 'slot', at: [3, 4] }] }, di: 0, dj: 0, colour: 2 }],
    created: 1000,
    updated: 2000,
  })!;
}

let store: FakeStorage;

beforeEach(() => {
  s().resetAll();
  history.clear();
  store = new FakeStorage();
  setLibraryStorage(store);
});

describe('format', () => {
  it('saves a part with its kind, options and common options, and reads it back the same', () => {
    const board = newBoard([{ id: 'p', x: 100, y: 500, ...structuredClone(PLIERS) }]);
    const e = saveToMyAttachments(['p'], board.board)!;
    expect(e).not.toBeNull();
    expect(e.name).toBe('Pliers');
    expect(e.items).toHaveLength(1);
    const { di, dj, ...item } = e.items[0];
    expect([di, dj]).toEqual([0, 0]);
    const { id: _id, x: _x, y: _y, ...want } = { id: '', x: 0, y: 0, ...PLIERS, opts: attachmentDef('toolRack')!.sanitize(PLIERS.opts) };
    expect(item).toEqual(want);
    expect(e.created).toBeGreaterThan(0);
    expect(e.updated).toBe(e.created);
    // Stored as a versioned file, read back to the same entry.
    const data = stored(store);
    expect(data).toMatchObject({ app: 'gridfit', kind: 'my-attachments', version: MY_ATTACHMENTS_VERSION });
    expect(data.attachments).toEqual([e]);
    expect(loadLibrary(store)).toEqual({ entries: [e], status: 'saved' });
    // Not in the project: a new project, undo and opening a file leave it alone.
    s().resetAll();
    expect(lib().entries).toEqual([e]);
  });

  it('keeps what’s in it only when asked, and a label from it goes with it', () => {
    const board = newBoard(threeParts());
    const kept = saveToMyAttachments(['b'], board.board)!;
    expect(kept.items[0]).toMatchObject({ contents: 'M3 screws', labelFrom: 'contents' });
    const bare = saveToMyAttachments(['b'], board.board, { contents: false })!;
    expect(bare.items[0].contents).toBeUndefined();
    expect(bare.items[0].labelFrom).toBeUndefined();
    // Names don't clash; a name of its own wins.
    expect(bare.name).not.toBe(kept.name);
    expect(saveToMyAttachments(['c'], board.board, { name: '  Glue   stick ' })!.name).toBe('Glue stick');
  });

  it('goes through a file and back: export, then import into an empty library', async () => {
    const board = newBoard(threeParts());
    saveToMyAttachments(['p'], board.board);
    saveToMyAttachments(['p', 'b', 'c'], board.board);
    const before = lib().entries;
    const text = await myAttachmentsFileText();
    expect(JSON.parse(text)).toMatchObject({ app: 'gridfit', kind: 'my-attachments', version: MY_ATTACHMENTS_VERSION });
    setLibraryStorage(new FakeStorage());
    expect(importMyAttachments(text)).toEqual({ added: 2, updated: 0, same: 0, older: 0, invalid: 0 });
    expect(lib().entries).toEqual(before);
    // Again: nothing new.
    expect(importMyAttachments(text)).toMatchObject({ added: 0, same: 2 });
  });

  it('renames, duplicates, deletes and undoes the delete, each saved', () => {
    const board = newBoard(threeParts());
    const e = saveToMyAttachments(['p'], board.board)!;
    renameMyAttachment(e.id, '  Pliers   rack ');
    expect(lib().entries[0].name).toBe('Pliers rack');
    expect(lib().entries[0].updated).toBeGreaterThanOrEqual(e.updated);
    renameMyAttachment(e.id, '   ');
    expect(lib().entries[0].name).toBe('Pliers rack');
    const copy = duplicateMyAttachment(e.id)!;
    expect(lib().entries.map((x) => x.name)).toEqual(['Pliers rack', 'Pliers rack copy']);
    expect(lib().entries[1].id).toBe(copy);
    expect(entryFingerprint(lib().entries[1])).toBe(entryFingerprint(lib().entries[0]));
    expect(deleteMyAttachment(e.id)).toBe(true);
    expect(lib().entries.map((x) => x.id)).toEqual([copy]);
    expect(undoDeleteMyAttachment()).toBe(true);
    expect(lib().entries.map((x) => x.id)).toEqual([e.id, copy]);
    expect(stored(store).attachments.map((x: AttachmentEntry) => x.id)).toEqual([e.id, copy]);
  });

  it('finds entries by name, kind, part names, labels and contents', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board, { name: 'Bench' })!;
    const label = (t: string) => ({ toolRack: 'Tool rack', bin: 'Bin', cup: 'Cup' })[t] ?? t;
    for (const q of ['bench', 'pliers', 'tool rack', 'cutters', 'm3 screws', 'cup bench']) expect(entryMatches(set, q, label), q).toBe(true);
    expect(entryMatches(set, 'drill', label)).toBe(false);
    expect(entryMatches(set, '', label)).toBe(true);
  });

  it('suggests the part’s name, or the first one’s and how many more', () => {
    const board = newBoard(threeParts());
    expect(suggestedName(['p'], board.board)).toBe('Pliers');
    expect(suggestedName(['c'], board.board)).toBe(attachmentDef('cup')!.summary(attachmentDef('cup')!.sanitize({}) as never));
    expect(suggestedName(['p', 'b', 'c'], board.board)).toBe('Pliers + 2 more');
  });
});

describe('versions', () => {
  it('reads a bare list of placed attachments (a board’s list) as an entry each', () => {
    const r = readLibraryData(threeParts());
    expect(r).toEqual({ version: 0, entries: threeParts() });
    const entries = cleanLibrary((r as { entries: unknown[] }).entries);
    expect(entries.map((e) => e.name)).toEqual(['Pliers', expect.any(String), expect.any(String)]);
    expect(entries.every((e) => e.items.length === 1 && e.items[0].di === 0 && e.items[0].dj === 0)).toBe(true);
    expect(entries[0].items[0]).toMatchObject({ type: 'toolRack', bolt: 'm4', material: 'petg', colour: 3 });
  });

  it('says what a file is when it isn’t one', () => {
    expect(readLibraryData({ app: 'gridfit', kind: 'my-bins', version: 1, bins: [] })).toEqual({ error: expect.stringMatching(/My bins file/) });
    expect(readLibraryData({ app: 'gridfit', drawers: [] })).toEqual({ error: expect.stringMatching(/project file/) });
    expect(readLibraryData('nope')).toEqual({ error: expect.any(String) });
    expect(importMyAttachments('{not json')).toEqual({ error: expect.stringMatching(/isn’t JSON/) });
  });

  it('a library saved by a newer version is read but never written over', () => {
    const board = newBoard(threeParts());
    const e = saveToMyAttachments(['p'], board.board)!;
    const newer = { ...libraryData([e]), version: MY_ATTACHMENTS_VERSION + 1, somethingNew: true };
    store.setItem(MY_ATTACHMENTS_KEY, JSON.stringify(newer));
    reloadMyAttachments();
    expect(lib().status).toBe('newer');
    expect(lib().entries).toEqual([e]);
    expect(saveToMyAttachments(['b'], board.board)).toBeNull();
    renameMyAttachment(e.id, 'Changed');
    expect(deleteMyAttachment(e.id)).toBe(false);
    expect(JSON.parse(store.getItem(MY_ATTACHMENTS_KEY)!)).toEqual(newer);
    // A newer file isn't imported.
    expect(importMyAttachments(JSON.stringify(newer))).toEqual({ error: expect.stringMatching(/newer version/) });
  });

  it('keeps damaged stored text aside, and works on without storage or with it full', () => {
    store.setItem(MY_ATTACHMENTS_KEY, '{damaged');
    setLibraryStorage(store);
    expect(lib()).toMatchObject({ entries: [], status: 'saved' });
    expect(store.getItem(`${MY_ATTACHMENTS_KEY}-unreadable`)).toBe('{damaged');
    const board = newBoard(threeParts());
    setLibraryStorage(null);
    expect(saveToMyAttachments(['p'], board.board)).not.toBeNull();
    expect(lib().status).toBe('memory');
    setLibraryStorage(new FullStorage());
    expect(saveToMyAttachments(['p'], board.board)).not.toBeNull();
    expect(lib().status).toBe('full');
  });
});

describe('cleaning', () => {
  it('drops what isn’t an entry and cleans what is', () => {
    const garbage: unknown[] = [
      null,
      1,
      'x',
      [],
      {},
      { items: 'no' },
      { items: [] },
      { items: [{ type: 5 }, null, { opts: {} }, { type: '' }, { type: 'x'.repeat(61) }] },
      {
        id: 7,
        name: 42,
        created: 'yesterday',
        updated: -5,
        items: [
          {
            type: 'hook',
            opts: { reach: 'abc', width: 1e9, nonsense: { deep: true } },
            name: '  A\n\nhook  ',
            colour: 99,
            lock: 'yes',
            bolt: 'm9',
            label: 42,
            labelStyle: 'shiny',
            labelFrom: 'elsewhere',
            barbs: 'some',
            material: 'gold',
            contents: '\n\n  Keys  \n\n',
            di: 'x',
            dj: 1e9,
            follow: 'bin-1',
            id: 'gone',
            x: 3,
          },
        ],
      },
    ];
    const entries = cleanLibrary(garbage);
    expect(entries).toHaveLength(1);
    const [e] = entries;
    expect(typeof e.id).toBe('string');
    expect(e.name).toBe('A hook');
    expect([e.created, e.updated]).toEqual([0, 0]);
    const def = attachmentDef('hook')!;
    expect(e.items).toEqual([{ type: 'hook', opts: def.sanitize({ reach: 'abc', width: 1e9 }), name: 'A hook', contents: '  Keys', di: 0, dj: 0 }]);
    expect(e.items[0].opts).toEqual(def.sanitize(e.items[0].opts));
  });

  it('keeps at most 64 parts an entry, makes ids unique, and refuses options too big to be real', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ type: 'cup', opts: {}, di: i * 2, dj: 0 }));
    const [a, b] = cleanLibrary([
      { id: 'same', name: 'Many', items: many },
      { id: 'same', name: 'Again', items: many.slice(0, 2) },
    ]);
    expect(a.items).toHaveLength(64);
    expect(a.id).toBe('same');
    expect(b.id).not.toBe('same');
    const huge = { type: 'notYetAKind', opts: { blob: 'x'.repeat(MAX_OPTS_CHARS) } };
    expect(cleanEntry({ items: [huge] })).toBeNull();
  });

  it('puts the first part’s anchor at the set’s origin', () => {
    const e = cleanEntry({
      items: [
        { type: 'cup', opts: {}, di: 4, dj: -2 },
        { type: 'cup', opts: {}, di: 8, dj: 0 },
      ],
    })!;
    expect(e.items.map((it) => [it.di, it.dj])).toEqual([
      [0, 0],
      [4, 2],
    ]);
  });
});

describe('sets', () => {
  it('keep their parts’ places from one another, in lattice steps', () => {
    const board = newBoard(threeParts());
    const e = saveToMyAttachments(['c', 'p', 'b'], board.board)!;
    // The board's order; places from the first one's anchor, 20 mm steps.
    expect(e.items.map((it) => [it.type, it.di, it.dj])).toEqual([
      ['toolRack', 0, 0],
      ['bin', 8, 0],
      ['cup', 0, -6],
    ]);
    expect(e.name).toBe('Pliers + 2 more');
    // The same from the parts themselves; nothing from none.
    expect(entryFromAttachments(threeParts(), { pitch: 20, contents: true })!.items).toEqual(e.items);
    expect(entryFromAttachments([], { pitch: 20, contents: true })).toBeNull();
  });

  it('go on another board as they were arranged, at the first free spot, with no warnings', () => {
    const from = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], from.board)!;
    const one = saveToMyAttachments(['c'], from.board)!;
    // Another board, a cup already at its top left.
    const to = newBoard([{ id: 'x', type: 'cup', x: 40, y: 520, opts: { ...attachmentDef('cup')!.defaults } }]);
    const r = placeMyAttachment(set.id, to.board, to.placed);
    expect(r).toMatchObject({ ok: true, clear: true, name: set.name });
    const ids = (r as { ids: string[] }).ids;
    expect(ids).toHaveLength(3);
    // Selected, on the Attachments tab.
    expect(s().ui).toMatchObject({ tab: 'bins', selectedAttachment: ids[0], selectedAttachments: ids });
    const added = list().filter((a) => ids.includes(a.id));
    const [p, b, c] = added;
    expect([b.x - p.x, b.y - p.y]).toEqual([160, 0]);
    expect([c.x - p.x, c.y - p.y]).toEqual([0, -120]);
    expect(p).toMatchObject({ type: 'toolRack', name: 'Pliers', bolt: 'm4', label: 'Cutters', material: 'petg', colour: 3 });
    // And a single part beside them.
    const r2 = placeMyAttachment(one.id, activeBoard()!.board);
    expect(r2).toMatchObject({ ok: true, clear: true });
    const job = plan(list());
    expect(job.warnings).toEqual([]);
    const placed = job.drawers[0].enclosure!.wall!.placed;
    expect(placed).toHaveLength(5);
    expect(placed.every((q) => q.ok)).toBe(true);
    // One undo step each.
    history.undo();
    expect(list()).toHaveLength(4);
    history.undo();
    expect(list()).toHaveLength(1);
  });

  it('keep their steps on a board with another lattice step', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board)!;
    const wide = boardOf({ ...DEFAULT_SKADIS, pitch: 25 }, DEFAULT_SETUP)!;
    expect(wide.ctx.pitch).toBe(25);
    const r = planOnBoard(set, wide, [], () => `n${Math.random()}`);
    expect('list' in r && r.clear).toBe(true);
    const [p, b, c] = (r as { list: PlacedAttachment[] }).list;
    expect([b.x - p.x, b.y - p.y]).toEqual([200, 0]);
    expect([c.x - p.x, c.y - p.y]).toEqual([0, -150]);
    expect(placeAttachments((r as { list: PlacedAttachment[] }).list, wide).warnings).toEqual([]);
  });

  it('a full board: on top of other parts, red, and said so', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board)!;
    const tiny = boardOf({ ...DEFAULT_SKADIS, width: 160, height: 160 }, DEFAULT_SETUP)!;
    const r = planOnBoard(set, tiny, []);
    expect(r).toMatchObject({ clear: false });
    expect((r as { list: PlacedAttachment[] }).list).toHaveLength(3);
  });

  it('a preview from the front: each part’s body and mounts, and the box round them', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board)!;
    const v = entryView(set);
    expect(v.parts).toHaveLength(3);
    expect(v.parts.every((p) => p.w > 0 && p.h > 0 && p.mounts.length > 0 && !p.unknown)).toBe(true);
    const planned = placeAttachments(threeParts(), board.board).placed;
    const box = { x0: Math.min(...planned.map((p) => p.x0)), x1: Math.max(...planned.map((p) => p.x1)) };
    // As wide as they are on the board (from the first one's anchor).
    expect(v.box.x1 - v.box.x0).toBeCloseTo(box.x1 - box.x0, 1);
  });
});

describe('merging an import', () => {
  const entry = (id: string, name: string, updated: number, reach = 50): AttachmentEntry =>
    cleanEntry({ id, name, created: 1, updated, items: [{ type: 'hook', opts: { reach }, di: 0, dj: 0 }] })!;

  it('adds what’s new, keeps the newer copy of the same entry, and knows the same parts under another name', () => {
    const here = [entry('a', 'Hook', 100), entry('b', 'Long hook', 100, 80)];
    const incoming = [
      entry('a', 'Hook', 100),
      entry('b', 'Long hook', 50, 90),
      entry('c', 'Same parts', 10, 80),
      entry('d', 'Hook', 10, 60),
      entry('a', 'Hook renamed', 200),
    ];
    const { entries, report } = mergeLibrary(here, incoming);
    expect(report).toEqual({ added: 1, updated: 1, same: 2, older: 1 });
    expect(entries.map((e) => [e.id, e.name])).toEqual([
      ['a', 'Hook renamed'],
      ['b', 'Long hook'],
      ['d', 'Hook 2'],
    ]);
  });

  it('through the store, from a link’s entries', () => {
    const e = entry('z', 'Hook', 5);
    expect(addToMyAttachments([e])).toEqual({ added: 1, updated: 0, same: 0, older: 0 });
    expect(addToMyAttachments([e])).toEqual({ added: 0, updated: 0, same: 1, older: 0 });
    expect(stored(store).attachments).toEqual([e]);
  });
});

describe('share links', () => {
  it('carry an entry in the hash and read back the same', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board)!;
    const r = myAttachmentLink(set.id, 'https://example.com/gridfit/?x=1#old');
    expect('url' in r).toBe(true);
    const u = new URL((r as { url: string }).url);
    expect(u.pathname).toBe('/gridfit/');
    expect(u.search).toBe('?x=1');
    expect(u.hash.startsWith(`#${ATTACHMENTS_PREFIX}`)).toBe(true);
    expect(u.hash.length).toBeLessThan(JSON.stringify(set).length);
    expect(attachmentsFromHash(u.hash)).toEqual({ entries: [set], invalid: 0 });
    // Not a link of ours; damaged; from a newer version.
    expect(attachmentsFromHash('#project=abc')).toBeNull();
    expect(attachmentsFromHash(u.hash.slice(0, -12))).toEqual({ error: expect.stringMatching(/damaged/) });
    const newer = `#${ATTACHMENTS_PREFIX}${encodeProject({ ...libraryData([set]), version: MY_ATTACHMENTS_VERSION + 1 })}`;
    expect(attachmentsFromHash(newer)).toEqual({ error: expect.stringMatching(/newer version/) });
    expect(attachmentsFromHash(`#${ATTACHMENTS_PREFIX}${encodeProject({ hello: 1 })}`)).toEqual({ error: expect.any(String) });
  });

  it('hold a part with a few kB of options, and keep a kind this version doesn’t know', () => {
    const e = futureEntry();
    expect(JSON.stringify(e.items[0].opts).length).toBeGreaterThan(2000);
    const r = attachmentsShareUrl([e], 'https://example.com/');
    expect('url' in r).toBe(true);
    const url = (r as { url: string }).url;
    expect(url.length).toBeLessThan(LINK_MAX);
    expect(attachmentsFromHash(new URL(url).hash)).toEqual({ entries: [e], invalid: 0 });
  });

  it('hold a shadow board with its twelve traced tools, each of three hundred points', () => {
    const tools = Array.from({ length: 12 }, (_, k) => ({
      name: `Tool ${k}`,
      outline: Array.from({ length: 300 }, (_, i) => {
        const a = (i / 300) * 2 * Math.PI;
        return [Math.round((30 + 8 * Math.sin(7 * a) + k) * Math.cos(a) * 10) / 10, Math.round((60 + 5 * Math.cos(11 * a)) * Math.sin(a) * 10) / 10];
      }),
      x: 0,
      y: 0,
    }));
    const e = cleanEntry({ name: 'Garage tools', items: [{ type: 'shadowBoard', opts: { tools } }] })!;
    expect((e.items[0].opts.tools as unknown[]).length).toBe(12);
    const r = attachmentsShareUrl([e], 'https://example.com/') as { url: string };
    expect(r.url.length).toBeLessThan(LINK_MAX);
    expect(attachmentsFromHash(new URL(r.url).hash)).toEqual({ entries: [e], invalid: 0 });
  });

  it('leave an imported model’s mesh behind: a box of its size stands in', () => {
    const mesh = { hash: 'a'.repeat(28), file: 'drill.stl', size: [60, 40, 120], triangles: 1200, closed: true };
    const e = cleanEntry({ name: 'Drill', items: [{ type: 'model', opts: { mesh }, di: 0, dj: 0 }] })!;
    expect((e.items[0].opts.mesh as { hash?: string }).hash).toBe(mesh.hash);
    const r = attachmentsShareUrl([e], 'https://example.com/') as { url: string; models: number };
    expect(r.models).toBe(1);
    const back = attachmentsFromHash(new URL(r.url).hash) as { entries: AttachmentEntry[] };
    expect(back.entries[0].items[0].opts.mesh).toEqual({ file: 'drill.stl', size: [60, 40, 120], triangles: 1200, closed: true });
    // The library keeps its mesh while it's there.
    addToMyAttachments([e]);
    expect(libraryMeshHashes()).toEqual([mesh.hash]);
  });

  it('put on this board, or on a new one big enough, as one undo step', () => {
    const board = newBoard(threeParts());
    const set = saveToMyAttachments(['p', 'b', 'c'], board.board)!;
    const back = (
      attachmentsFromHash(new URL((myAttachmentLink(set.id, 'https://example.com/') as { url: string }).url).hash) as { entries: AttachmentEntry[] }
    ).entries;
    // A drawer that isn't a board: a new board for them.
    s().addDrawer('Drawer');
    const drawers = s().drawers.length;
    const r = putOnBoard(back);
    expect(r).toMatchObject({ ok: true, clear: true, board: set.name });
    expect(s().drawers).toHaveLength(drawers + 1);
    expect(s().drawer.enclosure).toBe('skadis');
    expect(list()).toHaveLength(3);
    expect(plan(list(), s().drawer.skadis as SkadisOptions).warnings).toEqual([]);
    history.undo();
    expect(s().drawers).toHaveLength(drawers);
    // No bigger than it needs: a cup on a board of one tile. One undo step however slow the machine (the history
    // groups changes made within 400 ms of each other: here every change is a second apart).
    const cup = cleanEntry({ name: 'Cup', items: [{ type: 'cup', opts: {} }] })!;
    let t = Date.now();
    const slow = vi.spyOn(Date, 'now').mockImplementation(() => (t += 1000));
    expect(putOnBoard([cup], { newBoard: true })).toMatchObject({ ok: true, clear: true, board: 'Cup' });
    expect(s().drawer.skadis!.tiles).toHaveLength(1);
    history.undo();
    slow.mockRestore();
    expect(s().drawers).toHaveLength(drawers);
    // On this board: beside what's there.
    newBoard(threeParts());
    const r2 = putOnBoard(back);
    expect(r2).toMatchObject({ ok: true, clear: true });
    expect(list()).toHaveLength(6);
    expect(plan(list()).warnings).toEqual([]);
    history.undo();
    expect(list()).toHaveLength(3);
  });
});

describe('a kind this version doesn’t know', () => {
  it('is kept through storage, files and merges, shown, but can’t be placed', async () => {
    const e = futureEntry();
    expect(entryKnown(e)).toBe(false);
    expect(e.items[0]).toMatchObject({ type: 'notYetAKind', colour: 2 });
    expect(addToMyAttachments([e])).toMatchObject({ added: 1 });
    setLibraryStorage(store);
    expect(lib().entries).toEqual([e]);
    const text = await myAttachmentsFileText();
    setLibraryStorage(new FakeStorage());
    expect(importMyAttachments(text)).toMatchObject({ added: 1, invalid: 0 });
    expect(lib().entries).toEqual([e]);
    // A box stands in for it in the preview.
    const v = entryView(e);
    expect(v.parts).toEqual([expect.objectContaining({ unknown: true })]);
    const board = newBoard();
    expect(placeMyAttachment(e.id, board.board)).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
    expect(putOnBoard([e])).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
    expect(list()).toEqual([]);
    // Next to known parts in a set it stays too.
    const mixed = cleanEntry({ items: [{ type: 'cup', opts: {} }, ...e.items] })!;
    expect(mixed.items.map((it) => it.type)).toEqual(['cup', 'notYetAKind']);
    expect(entryKnown(mixed)).toBe(false);
  });
});
