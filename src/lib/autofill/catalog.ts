/**
 * "Fill from a list": what Gridfit knows about common items. Rough numbers on
 * purpose: enough to pick a sensible bin, which the user can then change.
 *
 * - Loose parts (screws, nuts, washers, resistors, clips…): the solid volume
 *   of one item and how densely a pile of them packs, so a count becomes a
 *   compartment volume.
 * - Things that lie flat (calipers, pliers, scissors…): a typical size.
 * - Items with a pocket-grid preset (pocketPresets.ts): the words that name
 *   them and how tall they stand.
 *
 * Patterns run on the item's singular words joined by spaces (parse.ts).
 */
import type { ListItem } from './parse';

const PI4 = Math.PI / 4;

// ---------------------------------------------------------------------------
// Loose parts
// ---------------------------------------------------------------------------

export type LooseCategory = 'fasteners' | 'electronics' | 'hardware' | 'office' | 'craft';

export interface LooseKind {
  id: string;
  /** What it's called in reasons ("screws"). */
  label: string;
  re: RegExp;
  category: LooseCategory;
  /** Solid volume of one, mm³. `d` is the thread (mm) for fasteners. */
  solid: (d: number, item: ListItem) => number;
  /** Thread assumed when the line gives none. */
  d?: number;
  /** Share of a loose pile that is parts (the rest is air). */
  packing: number;
  /** How many when the line doesn't say. */
  qty: number;
}

/** Typical length of a machine screw by thread, mm. */
const SCREW_LENGTH: Record<number, number> = { 2: 6, 2.5: 8, 3: 10, 4: 12, 5: 16, 6: 20, 8: 25, 10: 30, 12: 35 };
/** Hex nut width across flats by thread, mm (ISO 4032). */
const NUT_AF: Record<number, number> = { 2: 4, 2.5: 5, 3: 5.5, 4: 7, 5: 8, 6: 10, 8: 13, 10: 16, 12: 18 };

const screwLength = (d: number, item: ListItem) => item.threadLength ?? item.length ?? SCREW_LENGTH[d] ?? Math.round(3 * d + 2);
const nutAF = (d: number) => NUT_AF[d] ?? 1.7 * d;
const hexArea = (af: number) => (Math.sqrt(3) / 2) * af * af;

export const LOOSE_KINDS: LooseKind[] = [
  // Fasteners, most specific first.
  { id: 'grub', label: 'set screws', re: /\b(grub|set) screw/, category: 'fasteners', d: 3, packing: 0.45, qty: 50, solid: (d, i) => PI4 * d * d * (i.threadLength ?? i.length ?? d + 2) },
  { id: 'woodscrew', label: 'screws', re: /\b(wood|drywall|deck|chipboard|sheet metal|self tapping) screw/, category: 'fasteners', d: 4, packing: 0.35, qty: 50, solid: (d, i) => PI4 * d * d * (i.length ?? 30) * 0.8 + PI4 * (2 * d) ** 2 * 0.6 * d },
  {
    id: 'screw',
    label: 'screws',
    re: /\b(screw|bolt|machine screw|cap screw|shcs|bhcs)\b/,
    category: 'fasteners',
    d: 3,
    packing: 0.4,
    qty: 50,
    solid: (d, i) => PI4 * d * d * screwLength(d, i) + PI4 * (1.7 * d) ** 2 * 0.8 * d,
  },
  { id: 'tnut', label: 'T-nuts', re: /\bt ?nut\b|\btnut\b|\bhammer nut/, category: 'fasteners', d: 5, packing: 0.45, qty: 30, solid: () => 10 * 6 * 4 },
  {
    id: 'nut',
    label: 'nuts',
    re: /\b(nut|nyloc|locknut)\b/,
    category: 'fasteners',
    d: 3,
    packing: 0.5,
    qty: 50,
    solid: (d, i) => (hexArea(nutAF(d)) - PI4 * d * d) * (/\b(nyloc|lock|locknut)\b/.test(i.words.join(' ')) ? 1.2 : 0.8) * d,
  },
  { id: 'washer', label: 'washers', re: /\bwasher\b/, category: 'fasteners', d: 3, packing: 0.45, qty: 50, solid: (d) => PI4 * ((2.1 * d + 0.5) ** 2 - (1.07 * d) ** 2) * Math.max(0.3, 0.18 * d) },
  { id: 'insert', label: 'inserts', re: /\binsert\b/, category: 'fasteners', d: 3, packing: 0.45, qty: 50, solid: (d) => PI4 * (1.55 * d) ** 2 * 1.6 * d * 0.7 },
  { id: 'standoff', label: 'standoffs', re: /\b(standoff|spacer)\b/, category: 'fasteners', d: 3, packing: 0.4, qty: 20, solid: (d, i) => (hexArea(nutAF(d)) - PI4 * d * d) * (i.threadLength ?? i.length ?? 10) },
  { id: 'rivet', label: 'rivets', re: /\brivet\b/, category: 'fasteners', d: 4, packing: 0.35, qty: 50, solid: (d, i) => PI4 * d * d * (i.length ?? 10) + PI4 * (2 * d) ** 2 * 0.4 * d },
  { id: 'nail', label: 'nails', re: /\b(nail|brad|tack)\b/, category: 'fasteners', d: 2, packing: 0.35, qty: 50, solid: (d, i) => PI4 * d * d * (i.length ?? 30) },
  { id: 'pin', label: 'pins', re: /\b(dowel|cotter|roll|spring) pin\b/, category: 'fasteners', d: 3, packing: 0.45, qty: 30, solid: (d, i) => PI4 * d * d * (i.length ?? 12) },
  // Hardware.
  { id: 'spring', label: 'springs', re: /\bspring\b/, category: 'hardware', packing: 0.2, qty: 20, solid: () => 250 },
  { id: 'oring', label: 'O-rings', re: /\bo ring\b|\boring\b/, category: 'hardware', packing: 0.3, qty: 30, solid: () => 60 },
  { id: 'magnet', label: 'magnets', re: /\bmagnet\b/, category: 'hardware', packing: 0.7, qty: 20, solid: (_d, i) => (i.dims && i.dims.length >= 2 ? PI4 * i.dims[0] ** 2 * i.dims[1] : PI4 * 36 * 2) },
  { id: 'bearing', label: 'bearings', re: /\bbearing\b/, category: 'hardware', packing: 0.55, qty: 10, solid: () => PI4 * (22 * 22 - 8 * 8) * 7 },
  { id: 'clip', label: 'clips', re: /\b(cable clip|circlip|e clip|retaining ring|hose clamp)\b/, category: 'hardware', packing: 0.3, qty: 20, solid: () => 300 },
  // Electronics.
  { id: 'resistor', label: 'resistors', re: /\bresistor\b/, category: 'electronics', packing: 0.12, qty: 50, solid: () => 30 },
  { id: 'capacitor', label: 'capacitors', re: /\bcapacitor\b/, category: 'electronics', packing: 0.2, qty: 30, solid: () => 120 },
  { id: 'led', label: 'LEDs', re: /\bled\b/, category: 'electronics', packing: 0.18, qty: 30, solid: () => 150 },
  { id: 'diode', label: 'diodes', re: /\bdiode\b/, category: 'electronics', packing: 0.15, qty: 30, solid: () => 40 },
  { id: 'transistor', label: 'transistors', re: /\b(transistor|mosfet|regulator)\b/, category: 'electronics', packing: 0.2, qty: 20, solid: () => 100 },
  { id: 'chip', label: 'chips', re: /\b(ic|chip|microcontroller)\b/, category: 'electronics', packing: 0.4, qty: 10, solid: () => 250 },
  { id: 'header', label: 'headers', re: /\b(pin )?header\b/, category: 'electronics', packing: 0.4, qty: 10, solid: () => 1000 },
  { id: 'jumper', label: 'jumper wires', re: /\b(jumper|dupont)( wire| cable)?\b/, category: 'electronics', packing: 0.12, qty: 40, solid: () => 400 },
  { id: 'fuse', label: 'fuses', re: /\bfuse\b/, category: 'electronics', packing: 0.45, qty: 20, solid: () => 1200 },
  { id: 'crimp', label: 'terminals', re: /\b(crimp|terminal|ferrule|spade connector)\b/, category: 'electronics', packing: 0.3, qty: 50, solid: () => 120 },
  { id: 'connector', label: 'connectors', re: /\b(connector|jst|xt60|xt30|plug)\b/, category: 'electronics', packing: 0.35, qty: 20, solid: () => 400 },
  { id: 'switch', label: 'switches', re: /\b(tactile|push button|microswitch|switch)\b/, category: 'electronics', packing: 0.35, qty: 20, solid: () => 200 },
  { id: 'heatshrink', label: 'heat shrink', re: /\bheat ?shrink\b/, category: 'electronics', packing: 0.2, qty: 30, solid: () => 400 },
  { id: 'pot', label: 'potentiometers', re: /\b(potentiometer|pot)\b/, category: 'electronics', packing: 0.4, qty: 10, solid: () => 2000 },
  // Office and craft.
  { id: 'paperclip', label: 'paper clips', re: /\bpaper ?clip\b/, category: 'office', packing: 0.12, qty: 50, solid: () => 80 },
  { id: 'binderclip', label: 'binder clips', re: /\bbinder clip\b/, category: 'office', packing: 0.35, qty: 20, solid: () => 1800 },
  { id: 'pushpin', label: 'push pins', re: /\b(push pin|thumbtack|drawing pin)\b/, category: 'office', packing: 0.25, qty: 50, solid: () => 120 },
  { id: 'rubberband', label: 'rubber bands', re: /\brubber band\b|\belastic band\b/, category: 'office', packing: 0.3, qty: 50, solid: () => 120 },
  { id: 'bead', label: 'beads', re: /\bbead\b/, category: 'craft', packing: 0.55, qty: 100, solid: () => 60 },
  { id: 'button', label: 'buttons', re: /\bbutton\b/, category: 'craft', packing: 0.45, qty: 30, solid: () => 300 },
  { id: 'pick', label: 'picks', re: /\b(guitar )?pick\b/, category: 'craft', packing: 0.5, qty: 20, solid: () => 700 },
  { id: 'dice', label: 'dice', re: /\b(die|dice|d6|d20)\b/, category: 'craft', packing: 0.55, qty: 20, solid: () => 16 ** 3 },
];

/** The loose-part kind an item names, or null. A thread size alone ("M3", "M4x20") means screws. */
export function looseKind(item: ListItem): LooseKind | null {
  const w = ` ${item.words.join(' ')} `;
  const k = LOOSE_KINDS.find((x) => x.re.test(w));
  if (k) return k;
  if (item.thread && item.words.length <= 2) return LOOSE_KINDS.find((x) => x.id === 'screw')!;
  return null;
}

// ---------------------------------------------------------------------------
// Things that lie flat
// ---------------------------------------------------------------------------

export interface KnownObject {
  re: RegExp;
  /** Typical size: length × width × thickness, mm. */
  l: number;
  w: number;
  h: number;
}

/** Most specific first. */
export const KNOWN_OBJECTS: KnownObject[] = [
  { re: /\bcaliper/, l: 235, w: 80, h: 18 },
  { re: /\b(needle|long) nose/, l: 150, w: 50, h: 13 },
  { re: /\b(side|flush|wire|diagonal) cutter|\bsnip\b|\bnipper/, l: 130, w: 50, h: 12 },
  { re: /\bstripper/, l: 170, w: 60, h: 16 },
  { re: /\bplier/, l: 170, w: 55, h: 16 },
  { re: /\bprecision screwdriver/, l: 150, w: 14, h: 14 },
  { re: /\bscrewdriver/, l: 200, w: 32, h: 32 },
  { re: /\badjustable (wrench|spanner)/, l: 200, w: 60, h: 13 },
  { re: /\b(wrench|spanner)\b/, l: 150, w: 35, h: 6 },
  { re: /\bscissor/, l: 210, w: 80, h: 12 },
  { re: /\btape measure|\bmeasuring tape/, l: 75, w: 75, h: 45 },
  { re: /\b(utility|craft|hobby|box) knife|\bbox cutter|\bx ?acto|\bscalpel/, l: 160, w: 30, h: 18 },
  { re: /\bknife\b/, l: 200, w: 30, h: 15 },
  { re: /\btweezer/, l: 120, w: 12, h: 8 },
  { re: /\bmultimeter/, l: 190, w: 90, h: 50 },
  { re: /\bsoldering iron/, l: 220, w: 30, h: 30 },
  { re: /\b(flashlight|torch)\b/, l: 140, w: 30, h: 30 },
  { re: /\bdeburr/, l: 150, w: 20, h: 20 },
  { re: /\bspudger/, l: 150, w: 12, h: 5 },
  { re: /\b(ruler|steel rule)\b/, l: 160, w: 20, h: 2 },
  { re: /\bstapler/, l: 150, w: 40, h: 60 },
  { re: /\bsticky note|\bpost it/, l: 76, w: 76, h: 25 },
  { re: /\bhot glue/, l: 200, w: 11, h: 11 },
  { re: /\bglue stick/, l: 95, w: 20, h: 20 },
  { re: /\bsuper ?glue|\bca glue/, l: 60, w: 25, h: 15 },
  { re: /\bpower ?bank/, l: 100, w: 65, h: 22 },
  { re: /\bcharger|\bpower (brick|supply|adapter)/, l: 60, w: 50, h: 30 },
  { re: /\b(cable|cord)\b/, l: 90, w: 90, h: 20 },
  { re: /\bsafety glass|\bgoggle/, l: 160, w: 60, h: 50 },
  { re: /\b(paint ?)?brush\b/, l: 200, w: 12, h: 12 },
  { re: /\blighter\b/, l: 80, w: 25, h: 12 },
];

export function knownObject(item: ListItem): KnownObject | null {
  const w = ` ${item.words.join(' ')} `;
  return KNOWN_OBJECTS.find((o) => o.re.test(w)) ?? null;
}

// ---------------------------------------------------------------------------
// Pocket-grid items (presets in pocketPresets.ts)
// ---------------------------------------------------------------------------

export interface PocketRule {
  /** Pocket preset id. */
  preset: string;
  re?: RegExp;
  /** Battery size token instead of words. */
  cell?: string;
  /** How tall one stands, mm (a coin stack: the pocket's depth). */
  h: number;
  /** Long items can lie flat instead: length and diameter, mm. */
  lay?: [number, number];
  /** Items per pocket (coins stack). */
  per?: number;
}

export const POCKET_RULES: PocketRule[] = [
  { preset: 'microsd', re: /\bmicro ?sd\b|\btf card/, h: 15 },
  { preset: 'sd', re: /\bsd\b/, h: 32 },
  { preset: 'cfexpress-b', re: /\bcf ?express/, h: 38.5 },
  { preset: 'nanosim', re: /\bsim( card)?\b/, h: 12.3 },
  { preset: 'usb-c', re: /\busb c (stick|drive|key)/, h: 30 },
  { preset: 'usb-a', re: /\b(usb|flash|thumb|pen) (stick|drive|key)|\bmemory stick/, h: 40 },
  { preset: 'switch', re: /\bswitch (cartridge|cart|game)/, h: 31 },
  { preset: 'gameboy', re: /\bgame ?boy/, h: 65 },
  { preset: 'aa', cell: 'aa', h: 50.5, lay: [50.5, 14.5] },
  { preset: 'aaa', cell: 'aaa', h: 44.5, lay: [44.5, 10.5] },
  { preset: 'c', cell: 'c', h: 50, lay: [50, 26.2] },
  { preset: 'd', cell: 'd', h: 61.5, lay: [61.5, 34.2] },
  { preset: '9v', cell: '9v', h: 48.5 },
  { preset: '14500', cell: '14500', h: 50, lay: [50, 14.5] },
  { preset: '18650', cell: '18650', h: 65, lay: [65.5, 18.6] },
  { preset: '21700', cell: '21700', h: 70, lay: [70.5, 21.4] },
  { preset: 'cr123a', cell: 'cr123a', h: 34.5 },
  // "Batteries" without a size: AA, the most common.
  { preset: 'aa', re: /\bbattery\b/, h: 50.5, lay: [50.5, 14.5] },
  { preset: 'hexbit-4', re: /\bprecision bit/, h: 28 },
  { preset: 'powerbit', re: /\b(power|impact) bit/, h: 50 },
  { preset: 'router-14', re: /\brouter bit/, h: 55 },
  { preset: 'hexbit', re: /\b(hex|screwdriver|driver|torx|phillips|security|insert) bit|\bbit\b/, h: 25 },
  { preset: 'citadel', re: /\bcitadel|\bpaint pot/, h: 38 },
  { preset: 'dropper', re: /\bdropper|\bvallejo|\barmy painter|\bpaint\b/, h: 92 },
  { preset: 'copic', re: /\bcopic/, h: 150, lay: [150, 17] },
  { preset: 'marker', re: /\b(marker|sharpie|highlighter|felt tip)/, h: 137, lay: [137, 13] },
  { preset: 'pen', re: /\b(pen|pencil|biro)\b/, h: 145, lay: [145, 11] },
  { preset: 'nozzle', re: /\bnozzle/, h: 13 },
  { preset: 'testtube', re: /\btest tube/, h: 150, lay: [150, 16] },
  { preset: 'oil5', re: /\bessential oil|\boil bottle/, h: 55 },
  { preset: 'quarter', re: /\bquarter\b/, h: 15, per: 8 },
  { preset: 'dime', re: /\bdime\b/, h: 15, per: 11 },
  { preset: 'nickel', re: /\bnickel\b/, h: 15, per: 7 },
  { preset: 'penny', re: /\b(penny|pennie|cent)\b/, h: 15, per: 9 },
  { preset: 'euro2', re: /\b2 euro\b|\beuro 2\b/, h: 15, per: 6 },
  { preset: 'euro1', re: /\b(1 )?euro\b/, h: 15, per: 6 },
];

/** Router bit presets by shank, mm. */
export const ROUTER_SHANKS: [number, string][] = [
  [6.35, 'router-14'],
  [8, 'router-8'],
  [12.7, 'router-12'],
];

/** Screw pocket presets by thread (M2–M8). */
export const SCREW_POCKETS: Record<number, string> = { 2: 'm2', 2.5: 'm2.5', 3: 'm3', 4: 'm4', 5: 'm5', 6: 'm6', 8: 'm8' };
/** Screws stand in pockets only when there are this few; more go loose in a compartment. */
export const MAX_SCREW_POCKETS = 12;

export function pocketRule(item: ListItem): PocketRule | null {
  const w = ` ${item.words.join(' ')} `;
  for (const r of POCKET_RULES) {
    if (r.cell ? item.cell === r.cell : r.re!.test(w)) {
      if (r.preset !== 'router-14') return r;
      // Router bits: the shank size picks the preset.
      const shank = item.length ?? (/\b1\/2\b|\bhalf inch/.test(item.name) ? 12.7 : undefined);
      const hit = shank ? ROUTER_SHANKS.find(([s]) => Math.abs(s - shank) < 0.6) : undefined;
      return hit ? { ...r, preset: hit[1] } : r;
    }
  }
  return null;
}

/** Usual length of a screw by thread, for pockets that hold one each. */
export { screwLength };
