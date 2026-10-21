/**
 * "Fill from a list": "Group small items". Small loose parts that belong
 * together share one bin, a compartment each: first by thread (M3 screws,
 * nuts and washers), then what's left by kind (resistors, LEDs and
 * capacitors; M4 screws and M5 nuts). Groups keep the list's order and hold
 * at most MAX_GROUP items.
 */
import type { ListItem } from './parse';
import type { Holder } from './match';

export interface Entry {
  key: string;
  item: ListItem;
  holder: Holder;
}

export interface Group {
  key: string;
  entries: Entry[];
  /** Label for the bin: the thread ("M3") or the kind ("Electronics"). */
  title: string;
}

export const MAX_GROUP = 4;

/** Compartment volume an entry needs, mm³ (0 for anything that isn't loose parts). */
export type NeedOf = (e: Entry) => number;

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Entries and groups in list order (a group stands where its first item was).
 * `small`: most an item may need to join a group by thread; `tiny`: to join
 * one by kind; `most`: most a group may need in all.
 */
export function groupEntries(entries: Entry[], need: NeedOf, limits: { small: number; tiny: number; most: number }): (Entry | Group)[] {
  const taken = new Map<Entry, Group>();
  const make = (bucket: Entry[], title: string) => {
    // Chunks of at most MAX_GROUP items and `most` mm³.
    let cur: Entry[] = [];
    let vol = 0;
    const flush = () => {
      if (cur.length > 1) {
        const g: Group = { key: `group:${cur.map((e) => e.key).join('+')}`, entries: cur, title };
        for (const e of cur) taken.set(e, g);
      }
      cur = [];
      vol = 0;
    };
    for (const e of bucket) {
      if (cur.length >= MAX_GROUP || (cur.length && vol + need(e) > limits.most)) flush();
      cur.push(e);
      vol += need(e);
    }
    flush();
  };
  const loose = entries.filter((e) => e.holder.kind === 'loose');
  const by = (pick: (e: Entry) => string | null, list: Entry[]) => {
    const out = new Map<string, Entry[]>();
    for (const e of list) {
      const k = pick(e);
      if (k) out.set(k, [...(out.get(k) ?? []), e]);
    }
    return out;
  };
  // By thread: M3 screws, M3 nuts, M3 washers.
  for (const [family, bucket] of by((e) => (e.holder.kind === 'loose' && /^M/.test(e.holder.family) && need(e) <= limits.small ? e.holder.family : null), loose)) {
    if (bucket.length > 1) make(bucket, family);
  }
  // Then by kind, for what's left and tiny.
  const rest = loose.filter((e) => !taken.has(e) && need(e) <= limits.tiny);
  for (const [kind, bucket] of by((e) => (e.holder.kind === 'loose' ? e.holder.loose.category : null), rest)) {
    if (bucket.length > 1) make(bucket, capital(kind));
  }
  const out: (Entry | Group)[] = [];
  const seen = new Set<Group>();
  for (const e of entries) {
    const g = taken.get(e);
    if (!g) out.push(e);
    else if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

export const isGroup = (x: Entry | Group): x is Group => 'entries' in x;

/** The items of a group, in order. */
export const groupItems = (g: Group): ListItem[] => g.entries.map((e) => e.item);
