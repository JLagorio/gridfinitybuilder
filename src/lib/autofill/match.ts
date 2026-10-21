/**
 * "Fill from a list": what each item needs. In order: a tool from the user's
 * library, a graduated set (drill index, hex keys, sockets), a dispenser
 * (coin cells, zip ties, a roll of tape), a pocket-grid preset, loose parts
 * by volume, something that lies flat, and otherwise a general bin.
 */
import { findPocketPreset, type PocketPreset } from '../geometry/pocketPresets';
import { MM_PER_IN } from '../units';
import { findTapeRoll } from '../geometry/containers/dispenser';
import type { Tool } from '../tools';
import { MAX_SCREW_POCKETS, SCREW_POCKETS, knownObject, looseKind, pocketRule, screwLength, type LooseKind } from './catalog';
import { wordsOf, type ListItem } from './parse';

export type Holder =
  /** A pocket grid from a preset: `count` items, `per` to a pocket (coin stacks). */
  | { kind: 'pockets'; preset: PocketPreset; count: number; given: boolean; per: number; itemH: number; lay?: [number, number] }
  /** A graduated set: one pocket per size (mm, before clearance). */
  | { kind: 'set'; preset: PocketPreset; sizes: number[]; names: string[] }
  /** Tool cutouts for tools from the library. */
  | { kind: 'tools'; tools: Tool[] }
  /** A dispenser: a coin-cell magazine, channels for zip ties, or a tape roll holder. */
  | { kind: 'dispenser'; style: 'coin' | 'channel' | 'tape'; item: string; count: number | null; length: number }
  /** Loose parts in a compartment: `volume` is the pile's, mm³. */
  | { kind: 'loose'; loose: LooseKind; d: number | null; count: number; given: boolean; volume: number; family: string }
  /** Things that lie flat side by side, `l` × `w` × `h` each. */
  | { kind: 'objects'; count: number; l: number; w: number; h: number; typical: boolean }
  /** Not something Gridfit knows: a general bin. `small` gets compartments. */
  | { kind: 'general'; small: boolean };

const has = (item: ListItem, re: RegExp) => re.test(` ${item.words.join(' ')} `);
/** Words that don't help tell tools apart. */
const STOP = new Set(['a', 'an', 'the', 'my', 'of', 'set', 'and', 'for', 'with', 'small', 'big', 'large', 'old', 'new', 'spare']);
const keyWords = (words: string[]) => words.filter((w) => !STOP.has(w) && !/^\d/.test(w));

/**
 * Library tools the item names: the one called exactly that, else every tool
 * whose name contains the item's words (or whose words are all in the item).
 */
export function matchTools(item: ListItem, tools: Tool[]): Tool[] {
  const mine = keyWords(item.words);
  if (!mine.length) return [];
  const scored = tools.flatMap((t) => {
    const theirs = keyWords(wordsOf(t.name));
    if (!theirs.length) return [];
    if (theirs.join(' ') === mine.join(' ')) return [{ t, exact: true }];
    const inName = mine.every((w) => theirs.includes(w));
    const inItem = theirs.every((w) => mine.includes(w));
    return inName || inItem ? [{ t, exact: false }] : [];
  });
  const exact = scored.filter((s) => s.exact).map((s) => s.t);
  return (exact.length ? exact : scored.map((s) => s.t)).slice(0, 6);
}

/** A graduated set the item names: drills, hex keys, sockets (a typed range picks the sizes). */
function gradedSet(item: ListItem): Holder | null {
  const inch = item.range?.inch ?? /"|\bin(ch)?\b/.test(item.name.toLowerCase());
  let id: string | null = null;
  if (has(item, /\bdrill\b/)) id = inch ? 'drills-inch' : item.range && item.range.to > 10.01 ? 'drills-13' : 'drills-10';
  else if (has(item, /\b(hex|allen) (key|wrench)|\ballen\b/)) id = inch ? 'hexkeys-inch' : 'hexkeys';
  else if (has(item, /\bsocket\b/) && !has(item, /\bsocket (head|cap)|\bscrew/)) {
    const drive38 = /3\/8/.test(item.name) || (!/1\/4/.test(item.name) && (item.range?.to ?? 0) > 14.01);
    id = drive38 ? 'sockets-38' : 'sockets-14';
  }
  const preset = id ? findPocketPreset(id) : undefined;
  if (!preset?.sizes) return null;
  const names = preset.names ?? [];
  // Sockets are named by size; their pockets are sized to their outside diameters.
  const sizeOf = (i: number) => (names[i] ? Number(names[i]) : preset.sizes![i]);
  let keep = preset.sizes.map((_, i) => i);
  if (item.range) {
    const { from, to } = item.range;
    keep = keep.filter((i) => sizeOf(i) >= from - 0.05 && sizeOf(i) <= to + 0.05);
    if (!keep.length) {
      // Outside the preset: a pocket per 0.5 mm (or 1/64″) step of the range.
      const step = item.range.inch ? MM_PER_IN / 64 : 0.5;
      const sizes = Array.from({ length: Math.min(60, Math.floor((to - from) / step + 1e-6) + 1) }, (_, k) => Math.round((from + k * step) * 100) / 100);
      return { kind: 'set', preset, sizes, names: [] };
    }
  }
  return { kind: 'set', preset, sizes: keep.map((i) => preset.sizes![i]), names: names.length ? keep.map((i) => names[i]) : [] };
}

const COIN_CELLS: Record<string, string> = { cr2032: 'cr2032', cr2025: 'cr2025', cr2016: 'cr2016', cr2450: 'cr2450', lr44: 'lr44', ag13: 'lr44' };

function dispenser(item: ListItem): Holder | null {
  const coin = item.cell ? COIN_CELLS[item.cell] : has(item, /\b(coin|button) cell\b/) ? 'cr2032' : undefined;
  if (coin) return { kind: 'dispenser', style: 'coin', item: coin, count: item.qty, length: 0 };
  if (has(item, /\b(zip|cable) tie\b|\btie wrap\b/)) return { kind: 'dispenser', style: 'channel', item: 'zip ties', count: item.qty, length: item.length ?? 150 };
  // One roll of tape gets a dispenser; several lie flat in a bin.
  if (has(item, /\btape\b/) && !has(item, /\bmeasur/)) {
    const roll = has(item, /\b(electrical|insulating|insulation)\b/)
      ? 'electrical'
      : has(item, /\bwashi\b/)
        ? 'washi'
        : has(item, /\b(masking|painter)\b/)
          ? 'masking'
          : has(item, /\b(kapton|polyimide)\b/)
            ? 'kapton'
            : has(item, /\b(packing|parcel|duct)\b/)
              ? 'packing'
              : 'office';
    if ((item.qty ?? 1) <= 1) return { kind: 'dispenser', style: 'tape', item: roll, count: 1, length: 0 };
    const r = findTapeRoll(roll)!;
    return { kind: 'objects', count: item.qty!, l: r.outer, w: r.outer, h: r.width, typical: true };
  }
  return null;
}

function pockets(item: ListItem): Holder | null {
  // A few screws stand in pockets; more go loose in a compartment.
  const screwPreset = item.thread ? SCREW_POCKETS[item.thread] : undefined;
  if (screwPreset && item.qty !== null && item.qty <= MAX_SCREW_POCKETS && has(item, /\b(screw|bolt)\b/)) {
    const preset = findPocketPreset(screwPreset)!;
    return { kind: 'pockets', preset, count: item.qty, given: true, per: 1, itemH: screwLength(item.thread!, item) + 0.8 * item.thread! };
  }
  const rule = pocketRule(item);
  const preset = rule && findPocketPreset(rule.preset);
  if (!rule || !preset) return null;
  const per = rule.per ?? 1;
  return { kind: 'pockets', preset, count: item.qty ?? 0, given: item.qty !== null, per, itemH: rule.h, ...(rule.lay ? { lay: rule.lay } : {}) };
}

function loose(item: ListItem): Holder | null {
  const k = looseKind(item);
  if (!k) return null;
  const d = k.d !== undefined ? (item.thread ?? k.d) : null;
  const count = item.qty ?? k.qty;
  const volume = (count * k.solid(d ?? 0, item)) / k.packing;
  // Fasteners of one thread belong together ("M3"); other parts by what they are.
  const family = k.category === 'fasteners' && item.thread ? `M${item.thread}` : k.category;
  return { kind: 'loose', loose: k, d, count, given: item.qty !== null, volume, family };
}

function objects(item: ListItem): Holder | null {
  const count = Math.max(1, item.qty ?? 1);
  // Typed dimensions win: "power bank 100x60x20mm".
  if (item.dims && item.dims.length >= 2) {
    const [a, b, c] = [...item.dims].sort((x, y) => y - x);
    return { kind: 'objects', count, l: a, w: b, h: c ?? Math.min(b, 20), typical: false };
  }
  const o = knownObject(item);
  return o ? { kind: 'objects', count, l: o.l, w: o.w, h: o.h, typical: true } : null;
}

const SMALL = /\b(misc|miscellaneous|small|part|bit and piece|odd|end|assorted|various|spare|random|hardware|stuff)\b/;

/** What one item needs. `tools` is the tool library. */
export function matchItem(item: ListItem, tools: Tool[]): Holder {
  const own = matchTools(item, tools);
  if (own.length) {
    const exact = own.length === 1 && keyWords(wordsOf(own[0].name)).join(' ') === keyWords(item.words).join(' ');
    // "2 screwdrivers" with one screwdriver in the library: two pockets for it.
    const n = exact && item.qty ? Math.min(6, item.qty) : 1;
    return { kind: 'tools', tools: n > 1 ? Array<Tool>(n).fill(own[0]) : own };
  }
  return gradedSet(item) ?? dispenser(item) ?? pockets(item) ?? loose(item) ?? objects(item) ?? { kind: 'general', small: has(item, SMALL) };
}
