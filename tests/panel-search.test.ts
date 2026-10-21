import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allEntries, basicIds, findTerms, hitTitles, searchIndex, stem, termMatches, visibleIds, type FindEntry } from '../src/lib/panelSearch';
import { BIN_INDEX, DRAWER_INDEX, PRINT_INDEX } from '../src/components/panelIndex';

const PANELS: [string, FindEntry[]][] = [
  ['bins', BIN_INDEX],
  ['drawer', DRAWER_INDEX],
  ['print', PRINT_INDEX],
];

/** Ids a search turns up by themselves. */
const hits = (index: FindEntry[], q: string) => [...(searchIndex(index, q)?.hits ?? [])];
const shows = (index: FindEntry[], q: string) => searchIndex(index, q)?.show ?? new Set<string>();

/** Every id the panels' components use: `find="…"` on sections and groups, `<Find id="…">`, and MoreInAll's `['…', set]`. */
function usedIds(): Set<string> {
  const dir = join(__dirname, '../src/components');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx'));
  const out = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bfind=(?:"([^"]+)"|\{([^}]+)\})/g)) for (const s of (m[1] ?? m[2]).matchAll(/'([^']+)'|^([\w-]+)$/g)) out.add(s[1] ?? s[2]);
    for (const m of src.matchAll(/<Find id=(?:"([^"]+)"|\{([^}]+)\})/g)) {
      if (m[1]) out.add(m[1]);
      else for (const s of m[2].matchAll(/'([^']+)'/g)) out.add(s[1]);
    }
    for (const m of src.matchAll(/<MoreInAll\s+ids=\{([\s\S]*?)\}\s*\/>/g)) for (const s of m[1].matchAll(/\[\s*'([\w-]+)',\s*(?!')/g)) out.add(s[1]);
  }
  return out;
}

describe('panel search index', () => {
  it('gives every section, group and field an id, a title and keywords of its own', () => {
    for (const [, index] of PANELS) {
      const ids = new Set<string>();
      for (const e of allEntries(index)) {
        expect(e.id, e.title).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
        ids.add(e.id);
        expect(e.title.trim(), e.id).not.toBe('');
        // Its own words, besides the title: what people might type for it.
        const own = e.words.length ? e.words : (e.children ?? []).flatMap((c) => [c.title, ...c.words]);
        expect(own.length, `${e.id} has no keywords`).toBeGreaterThan(0);
      }
    }
  });

  it('matches the components: every id they use is indexed, and every entry is on a panel', () => {
    const used = usedIds();
    const indexed = new Set(PANELS.flatMap(([, index]) => [...allEntries(index)].map((e) => e.id)));
    for (const id of used) expect(indexed.has(id), `“${id}” is used but not in panelIndex.ts`).toBe(true);
    for (const id of indexed) expect(used.has(id), `“${id}” is indexed but no component shows it`).toBe(true);
  });

  it('finds bin settings by what people call them', () => {
    const cases: [string, string[]][] = [
      ['magnet', ['holes']],
      ['screw', ['holes']],
      ['lip', ['lip-style']],
      ['label', ['label-tab', 'label-text', 'front-label']],
      ['scoop', ['scoop']],
      ['pocket', ['interior', 'pockets', 'lid']],
      ['divider', ['compartments', 'rails']],
      ['wall', ['walls', 'compartments', 'front-label']],
      ['lid', ['lip', 'lid', 'slide-lid']],
      ['feet', ['base-feet']],
      ['stack', ['stack', 'lip-style', 'lid']],
      ['tray', ['trays', 'quick']],
      ['hex', ['wall-hex']],
      ['contents', ['contents']],
      ['duplicate', ['actions']],
      ['trace', ['tools']],
    ];
    for (const [q, want] of cases) expect(hits(BIN_INDEX, q), q).toEqual(expect.arrayContaining(want));
  });

  it('opens the groups a match is in: "magnet" finds the holes, in Base & holes, in Options', () => {
    const r = searchIndex(BIN_INDEX, 'magnet')!;
    expect(r.hits.has('holes')).toBe(true);
    expect([...r.show]).toEqual(expect.arrayContaining(['holes', 'base', 'options']));
    // Not the rest of the group, or other groups.
    expect(r.show.has('base-feet')).toBe(false);
    expect(r.show.has('walls')).toBe(false);
    // A group that matches by name shows all of it.
    expect([...shows(BIN_INDEX, 'walls')]).toEqual(expect.arrayContaining(['walls', 'wall-cutouts', 'wall-slides', 'wall-hex', 'fillet']));
  });

  it('finds drawer and print settings', () => {
    expect(hits(DRAWER_INDEX, 'magnet')).toEqual(['bp-magnets']);
    expect(hits(DRAWER_INDEX, 'screw')).toEqual(expect.arrayContaining(['bp-screws', 'bp-connectors']));
    expect(hits(DRAWER_INDEX, 'half')).toEqual(expect.arrayContaining(['half-grid']));
    expect(hits(DRAWER_INDEX, 'obstacle')).toEqual(['blocked']);
    expect(hits(DRAWER_INDEX, 'cleat')).toEqual(['enclosure']);
    expect(hits(PRINT_INDEX, 'nozzle')).toEqual(['nozzle']);
    expect(hits(PRINT_INDEX, 'reprint')).toEqual(['only-changed']);
    expect(hits(PRINT_INDEX, 'magnets')).toEqual(['bom']);
    expect(hits(PRINT_INDEX, 'add a printer')).toEqual(['more-printers']);
    expect(hits(PRINT_INDEX, 'share link')).toEqual(['project']);
  });

  it('folds plurals and case, and takes the start of a word', () => {
    expect(stem('screws')).toBe('screw');
    expect(stem('batteries')).toBe('battery');
    expect(stem('boxes')).toBe('box');
    expect(stem('glass')).toBe('glass');
    expect(findTerms('Cups & grid inserts')).toEqual(['cup', 'grid', 'insert']);
    expect(termMatches('mag', 'magnet')).toBe(true);
    expect(termMatches('magnetic', 'magnet')).toBe(true);
    expect(termMatches('lidar', 'lid')).toBe(false);
    for (const q of ['Magnets', 'MAG', 'magnetic', '  magnet  ']) expect(hits(BIN_INDEX, q), q).toContain('holes');
  });

  it('needs every word to match, and nothing typed means no filter', () => {
    expect(searchIndex(BIN_INDEX, '')).toBeNull();
    expect(searchIndex(BIN_INDEX, '  & ')).toBeNull();
    expect(hits(BIN_INDEX, 'xyzzy')).toEqual([]);
    // "lid text": the sliding lid (engraved text), not the stacking lid.
    expect(hits(BIN_INDEX, 'lid text')).toContain('slide-lid');
    expect(hits(BIN_INDEX, 'lid text')).not.toContain('lid');
    // A parent's words count for its fields: "baseplate magnet" is the plate's magnet pockets.
    expect(hits(DRAWER_INDEX, 'baseplate magnet')).toEqual(['bp-magnets']);
  });

  it('only shows a section for matches the panel has', () => {
    const r = searchIndex(BIN_INDEX, 'magnet')!;
    // A bin with compartments: no pocket grid fields, so Inside doesn't show for their magnets.
    const pocketGrid = (id: string) => id === 'pockets' || id.startsWith('pocket-');
    const all = [...allEntries(BIN_INDEX)].map((e) => e.id);
    const present = new Set(all.filter((id) => !pocketGrid(id) && id !== 'container'));
    const v = visibleIds(BIN_INDEX, r, present);
    expect([...v]).toEqual(expect.arrayContaining(['options', 'base', 'holes']));
    expect(v.has('inside')).toBe(false);
    // With a pocket grid it does, with just its magnet field.
    const withPockets = visibleIds(BIN_INDEX, r, new Set([...present, ...all.filter(pocketGrid)]));
    expect([...withPockets]).toEqual(expect.arrayContaining(['inside', 'pockets', 'pocket-magnet']));
    expect(withPockets.has('pocket-shape')).toBe(false);
    // Nothing matching on the panel: the note says where it would be.
    const s = searchIndex(BIN_INDEX, 'stretch')!;
    expect(visibleIds(BIN_INDEX, s, new Set(['bin', 'layout'])).size).toBe(0);
    expect(hitTitles(BIN_INDEX, s)).toEqual([{ title: 'Stretch into the gap', when: expect.stringContaining('one bin is selected') }]);
  });

  it('marks what the Basic view leaves out, inherited by what is in it', () => {
    const b = basicIds(BIN_INDEX);
    for (const id of ['quick', 'type', 'size', 'height', 'interior', 'comp-split', 'scoop', 'label-tab', 'label-text', 'base', 'holes', 'lip', 'lid', 'contents', 'layout'])
      expect(b.get(id), id).toBe(true);
    for (const id of ['height-mode', 'comp-divide', 'label-style', 'label-plates', 'front-label', 'walls', 'wall-hex', 'trays', 'rails', 'inserts', 'cups', 'stack', 'stretch', 'templates', 'tools'])
      expect(b.get(id), id).toBe(false);
    expect(basicIds(DRAWER_INDEX).get('half-grid')).toBe(false);
    expect(basicIds(PRINT_INDEX).get('split')).toBe(false);
  });
});
