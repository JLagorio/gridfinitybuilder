/**
 * "Fill from a list": reading the list. One item per line, the way people
 * write them: "200 M3 screws", "SD cards x8", "a dozen AA batteries",
 * "drill bits 1-10mm", "hex keys 1/16–3/8in", "calipers". Every non-blank
 * line is an item, so nothing typed is lost: what isn't understood stays in
 * the item's name. Pure TS.
 */
import { MM_PER_IN } from '../units';

export interface ListItem {
  /** The line as typed (trimmed, list bullets dropped): the bin's "What's in it". */
  text: string;
  /** The line without its quantity ("M3 screws"): for labels. */
  name: string;
  /** How many, when the line says. */
  qty: number | null;
  /** Metric thread ("M3" → 3, "M2.5" → 2.5), mm. */
  thread?: number;
  /** Length after a thread ("M3x12" → 12), mm. */
  threadLength?: number;
  /** Battery size ("aa", "9v", "18650", "cr2032"), lower case. */
  cell?: string;
  /** Sizes from … to ("1.5-10 mm", "1/16–1/2in"), mm; `inch` when written in inches. */
  range?: { from: number; to: number; inch: boolean };
  /** One length ("200mm", "8 in"), mm. */
  length?: number;
  /** Dimensions ("100x60x20mm"), mm, as written. */
  dims?: number[];
  /** Words of the name, lower case and singular ("screws" → "screw"), for matching. */
  words: string[];
}

/** Battery sizes Gridfit knows by name. C and D only count next to "battery" or "cell". */
const CELLS = ['aaa', 'aa', '9v', '14500', '18650', '21700', 'cr123a', 'cr2032', 'cr2025', 'cr2016', 'cr2450', 'lr44', 'ag13'];
const CELL_NUMBERS = new Set(['14500', '18650', '21700']);
/** A number up front that names a cartridge ("308 Win", "12 gauge", "22 LR", "223 ammo"), not how many. */
const CALIBER_FIRST =
  /^\s(?:10|12|16|17|20|22|28|30|38|40|44|45|223|243|270|300|308|357|380|410)\s+(?:lr|wmr|hmr|mag|magnum|win|winchester|rem|remington|acp|auto|spl|special|sig|s&w|sw|colt|lc|govt|blk|blackout|aac|nato|ga|gauge|bore|cal|caliber|calibre|ammo|ammunition)(?=[\s.,;:]|$)/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};

/** A number: 12, 1.5, 1/16, 0,5. */
const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?`;
const UNIT = String.raw`mm|cm|in|inch|inches|"`;

const IRREGULAR: Record<string, string> = {
  knives: 'knife',
  halves: 'half',
  shelves: 'shelf',
  leaves: 'leaf',
  dice: 'die',
  sharpies: 'sharpie',
  cookies: 'cookie',
  hoodies: 'hoodie',
  series: 'series',
};

/** "screws" → "screw", "batteries" → "battery", "boxes" → "box", "zip ties" → "zip tie". */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 2 || /(ss|us|is)$/.test(w)) return w;
  // "ties", "pies": just the s.
  if (/ies$/.test(w)) return w.length <= 4 ? w.slice(0, -1) : w.slice(0, -3) + 'y';
  if (/(x|ch|sh|ss|zz)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lower-case singular words of a name. "AA batteries" → ["aa", "battery"]; "USB-C sticks" → ["usb", "c", "stick"]. */
export function wordsOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/€\s*(\d)/g, '$1 euro')
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map(singular);
}

function num(s: string): number {
  const t = s.replace(/\s+/g, '').replace(',', '.');
  const f = /^(\d+)\/(\d+)$/.exec(t);
  return f ? Number(f[1]) / Math.max(1, Number(f[2])) : Number(t);
}

const isInch = (u: string | undefined) => !!u && /^(in|inch|inches|")$/i.test(u);
const toMm = (v: number, u: string | undefined) => (isInch(u) ? v * MM_PER_IN : u?.toLowerCase() === 'cm' ? v * 10 : v);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The same characters every way people type them: dashes, × and inch marks. */
export function normalizeText(s: string): string {
  return s
    .replace(/[   ]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[″“”]|''/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLine(raw: string): ListItem | null {
  const text = raw
    .trim()
    .replace(/^(?:[-*•·]\s+|\d{1,2}[.)]\s+)/, '')
    .trim();
  if (!text) return null;
  // `s` is what's left once a quantity is found and blanked out; the name is what remains.
  let s = ` ${normalizeText(text)} `;
  let qty: number | null = null;
  const take = (re: RegExp, value: (m: RegExpExecArray) => number | null) => {
    if (qty !== null) return;
    const m = re.exec(s);
    if (!m) return;
    const v = value(m);
    if (v === null || !(v > 0)) return;
    qty = Math.round(v);
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  };
  take(/\shalf\s+a\s+dozen(?:\s+of)?(?=\s)/i, () => 6);
  take(/\s(?:(\d+)\s+|an?\s+)?dozens?(?:\s+of)?(?=\s)/i, (m) => 12 * (m[1] ? Number(m[1]) : 1));
  take(/\s(?:(\d+)\s+pairs|an?\s+pair|pair)\s+of(?=\s)/i, (m) => 2 * (m[1] ? Number(m[1]) : 1));
  take(/\sa\s+couple(?:\s+of)?(?=\s)/i, () => 2);
  take(/\sa\s+few(?=\s)/i, () => 3);
  take(/\s(?:qty|quantity)\.?\s*:?\s*(\d+)(?=\s)/i, (m) => Number(m[1]));
  take(/\s\((\d+)\)(?=\s)/, (m) => Number(m[1]));
  take(/\s(\d+)\s*(?:pcs|pc|pieces|piece|ea|each|count|ct)\.?(?=\s)/i, (m) => Number(m[1]));
  // "x8" after a word, or glued to its count after a battery or a length ("18650 x4", "5mm x100");
  // not between two numbers ("100 x 60", "M3 x 12").
  take(/\sx(\s?)(\d+)(?=\s)/i, (m) => {
    const before = s.slice(0, m.index);
    if (!/\d[a-z"]*\s*$/i.test(before)) return Number(m[2]);
    const prev = /(\S+)\s*$/.exec(before)?.[1] ?? '';
    return !m[1] && (CELL_NUMBERS.has(prev) || /\d(mm|cm|in|")$/i.test(prev)) ? Number(m[2]) : null;
  });
  // "8x" or "8 x" before a word.
  take(/\s(\d+)\s?x\s(?=[a-z])/i, (m) => Number(m[1]));

  // Sizes, read from the rest of the line (they stay in the name).
  const low = s.toLowerCase();
  const out: Omit<ListItem, 'text' | 'name' | 'qty' | 'words'> = {};
  const thread = new RegExp(String.raw`(?:^|[^a-z0-9])m(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?)?(?![a-z0-9])`, 'i').exec(low);
  if (thread) {
    out.thread = num(thread[1]);
    if (thread[2]) out.threadLength = num(thread[2]);
  }
  const rest = thread ? low.replace(thread[0], ' ') : low;
  const range = new RegExp(String.raw`(?:^|[^a-z0-9./])(${NUM})\s*(${UNIT})?\s*(?:-|to)\s*(${NUM})\s*(${UNIT})?(?![a-z0-9])`, 'i').exec(rest);
  if (range) {
    const a = num(range[1]);
    const b = num(range[3]);
    const unit = range[4] ?? range[2];
    // No unit given: fractions are inches, anything else mm.
    const inch = isInch(unit) || (!unit && (range[1].includes('/') || range[3].includes('/')));
    const from = inch ? a * MM_PER_IN : toMm(a, unit);
    const to = inch ? b * MM_PER_IN : toMm(b, unit);
    if (from > 0 && to > 0) out.range = { from: r2(Math.min(from, to)), to: r2(Math.max(from, to)), inch };
  }
  const dims = new RegExp(String.raw`(?:^|[^a-z0-9.])(${NUM})\s*x\s*(${NUM})(?:\s*x\s*(${NUM}))?\s*(${UNIT})?(?![a-z0-9])`, 'i').exec(rest);
  if (dims) out.dims = [dims[1], dims[2], dims[3]].filter((v): v is string => !!v).map((v) => r2(toMm(num(v), dims[4])));
  if (!range && !dims) {
    const len = new RegExp(String.raw`(?:^|[^a-z0-9./])(${NUM})\s*(${UNIT})(?![a-z0-9])`, 'i').exec(rest);
    if (len) out.length = r2(toMm(num(len[1]), len[2]));
  }

  // A number up front is how many ("200 M3 screws"), unless it's a battery size ("18650 cells") or a cartridge ("308 Win").
  take(/^\s(\d+)(?=\s)(?!\s*(?:x\s*\d|-\s*\d|to\s+\d|mm|cm|in\b|inch|"))/i, (m) =>
    (CELL_NUMBERS.has(m[1]) && !/^\s\d+\s+\d/.test(s)) || CALIBER_FIRST.test(s) ? null : Number(m[1]),
  );
  // "a calipers" is one; "a box of screws" says nothing about how many.
  take(/^\s(an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)(?=\s)/i, (m) =>
    /^an?$/i.test(m[1]) ? (/^\s\S+\s+(box|bag|bunch|handful|lot|pile|pack|tub|tube|jar|tin|bucket|load)/i.test(s) ? null : 1) : NUMBER_WORDS[m[1].toLowerCase()],
  );
  // Or a plain number at the end ("screws 50"), when it isn't part of a size.
  if (!out.range && !out.length && !out.dims) take(/\s(\d+)\s$/, (m) => (CELL_NUMBERS.has(m[1]) ? null : Number(m[1])));

  let name = s.replace(/\s+/g, ' ').replace(/^[\s,:;-]+|[\s,:;-]+$/g, '').trim();
  if (!name) name = normalizeText(text);
  const words = wordsOf(name);
  const battery = words.some((w) => /^(battery|batterie|cell)$/.test(w));
  out.cell = words.find((w) => CELLS.includes(w)) ?? (battery ? words.find((w) => w === 'c' || w === 'd') : undefined);
  if (!out.cell) delete out.cell;
  return { text, name, qty, ...out, words };
}

/** Every item in the list, in order. */
export function parseList(text: string): ListItem[] {
  return text.split(/\r?\n/).flatMap((l) => parseLine(l) ?? []);
}
