/**
 * "Find a setting" for the side panels: each panel declares a small keyword
 * index of its sections, groups and fields (components/panelIndex.ts), and
 * typing filters the panel to the entries that match. Nothing is read from the
 * page, so a search is a walk over a few hundred words.
 *
 * An entry matches when every typed word matches one of its words (its title
 * and keywords) or one of its parents', and at least one matches its own. A
 * match shows the entry, everything in it, and the groups it sits in (opened).
 */

export interface FindEntry {
  /** Stable id; the component that renders the entry uses the same one (`<Find id>`, `Section find`). */
  id: string;
  /** What the panel calls it. */
  title: string;
  /** Other words people look for it by: synonyms, what's inside, the options it offers. */
  words: string[];
  /**
   * Shown in the Basic view. Entries without it take their parent's; top-level
   * entries are basic unless they say otherwise. Anything set away from its
   * default shows in Basic too (the component knows, see `<Find set>`).
   */
  basic?: boolean;
  /** When the panel only shows it for some bins or setups, said in the "nothing here" note. */
  when?: string;
  children?: FindEntry[];
}

/** What a search turns up. */
export interface FindResult {
  /** Typed words, as matched. */
  terms: string[];
  /** Ids to show: matches, what's in them, and the groups they sit in. */
  show: Set<string>;
  /** Ids of the entries that matched themselves (not just through a parent or child). */
  hits: Set<string>;
}

/** A word as searched: lower case, plurals folded ("screws" → "screw", "batteries" → "battery"). */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The words of a text: letters and digits, stemmed. "Cups & grid inserts" → ["cup", "grid", "insert"]. */
export function findTerms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
}

/** A typed word against an indexed one: a prefix ("mag" finds "magnet"), or the other way for longer words ("magnetic" finds "magnet"). */
export function termMatches(term: string, word: string): boolean {
  return word.startsWith(term) || (word.length >= 4 && term.startsWith(word));
}

const ownWords = new WeakMap<FindEntry, string[]>();
function wordsOf(e: FindEntry): string[] {
  let w = ownWords.get(e);
  if (!w) {
    w = [...new Set([e.title, ...e.words].flatMap(findTerms))];
    ownWords.set(e, w);
  }
  return w;
}

const hasTerm = (words: string[], term: string) => words.some((w) => termMatches(term, w));

/** Every entry of an index, depth first. */
export function* allEntries(index: readonly FindEntry[]): Generator<FindEntry> {
  for (const e of index) {
    yield e;
    if (e.children) yield* allEntries(e.children);
  }
}

/** Filter an index by what was typed; null when nothing was (the panel shows as it is). */
export function searchIndex(index: readonly FindEntry[], query: string): FindResult | null {
  const terms = [...new Set(findTerms(query))];
  if (!terms.length) return null;
  const show = new Set<string>();
  const hits = new Set<string>();
  const addAll = (e: FindEntry) => {
    show.add(e.id);
    e.children?.forEach(addAll);
  };
  // `above`: the words of the entry's parents.
  const walk = (e: FindEntry, above: string[], path: string[]) => {
    const own = wordsOf(e);
    const all = [...above, ...own];
    if (terms.every((t) => hasTerm(all, t)) && terms.some((t) => hasTerm(own, t))) {
      hits.add(e.id);
      addAll(e);
      path.forEach((id) => show.add(id));
    }
    e.children?.forEach((c) => walk(c, all, [...path, e.id]));
  };
  index.forEach((e) => walk(e, [], []));
  return { terms, show, hits };
}

/**
 * What a search shows of a panel, given the entries the panel has on it right
 * now (`present`: a bin without compartments has no Compartments fields). A
 * matched entry shows with everything in it; a group or section shows when
 * something that matched, and is present, is in it. So a section never shows
 * just for a field it doesn't have.
 */
export function visibleIds(index: readonly FindEntry[], r: FindResult, present: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  // Returns whether anything present and matching is at or under `e`.
  const walk = (e: FindEntry, matched: boolean): boolean => {
    const m = matched || r.hits.has(e.id);
    let any = m && present.has(e.id);
    for (const c of e.children ?? []) if (walk(c, m)) any = true;
    if (any) out.add(e.id);
    return any;
  };
  index.forEach((e) => walk(e, false));
  return out;
}

/** Whether each entry shows in the Basic view (inherited from its parent), by id. */
export function basicIds(index: readonly FindEntry[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const walk = (e: FindEntry, parent: boolean) => {
    const basic = e.basic ?? parent;
    out.set(e.id, basic);
    e.children?.forEach((c) => walk(c, basic));
  };
  index.forEach((e) => walk(e, true));
  return out;
}

/** The top-level matches' titles, with where they show up, for the "nothing here" note. */
export function hitTitles(index: readonly FindEntry[], r: FindResult): { title: string; when?: string }[] {
  const out: { title: string; when?: string }[] = [];
  const walk = (e: FindEntry, when?: string) => {
    const w = e.when ?? when;
    if (r.hits.has(e.id)) out.push({ title: e.title, when: w });
    else e.children?.forEach((c) => walk(c, w));
  };
  index.forEach((e) => walk(e));
  return out;
}
