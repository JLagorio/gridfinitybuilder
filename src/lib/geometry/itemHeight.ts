/**
 * Items that stand far taller than their pockets are deep (cartridges: presets
 * with an `itemH`, pocketPresets.ts): where their tips reach, and how tall the
 * bin has to be for them. An item stands on its pocket's floor, so its tip is
 * the floor plus its height, whatever the bin's height. What it has to clear:
 *
 * - a stacking lid, a pocket-grid lid or a bin stacked on top: their feet sit
 *   LID_SEAT_DROP (0.35 mm) below where the bin's lip starts (lid.ts), so the
 *   tips have to stay under the top of the walls less that ("the seat");
 * - otherwise the rim: the top of the lip, or of the walls without one.
 *
 * Heights are mm from the bin's bottom; bin heights are 7 mm units. The Holds
 * note (standingNote), the print check (printability.ts), the Ammo preset
 * (templates.ts) and Fill from a list (autofill/size.ts) all use these.
 */
import { MIN_HEIGHT_UNITS, binCells, binCompartmentPockets, binLayout, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from './bin';
import { binBodyHeight, binFloorZ, lipRise } from './variants';
import { HEIGHT_UNIT, LIP_SUPPORT_HEIGHT } from './spec';
import { accessoryInfillTop } from './accessories';
import { compartmentInside, compartmentPocketOpts } from './compartments';
import { LID_SEAT_DROP, hasLid, lidStackHeight } from './lid';
import { isPocketLid, lidPocketOpts, pocketLidLayout } from './pocketLid';
import { pocketLayout, type PocketLayout } from './pockets';
import { findPocketPreset, itemNoun, type PocketPreset } from './pocketPresets';
import { hasStretch } from './placement';
import { activeContainer } from './containers/registry';

const EPS = 1e-6;
const DEG = Math.PI / 180;
/** Tallest bin, 7 mm units (sanitizeBin). */
export const MAX_HEIGHT_UNITS = 30;

/** A pocket grid of the bin whose preset says how tall its items stand. */
export interface StandingGrid {
  /** The bin's own grid, a pocket compartment's (`key`), or the pocket-grid lid's. */
  where: 'bin' | 'compartment' | 'lid';
  key?: string;
  preset: PocketPreset;
  /** How tall one item stands, mm. */
  itemH: number;
  /** The highest tip, mm above the bin's bottom (on a lid: with the lid on the bin). */
  top: number;
}

/** How tall a preset's items stand, by preset id (0 when it doesn't say). */
export function presetItemH(id: string): number {
  return findPocketPreset(id)?.itemH ?? 0;
}

/** The highest tip of items `itemH` tall standing in a laid-out grid (leaning ones lean with their pockets); null when nothing fits. */
function tipOf(L: PocketLayout, itemH: number): number | null {
  if (!L.pockets.length) return null;
  return Math.max(...L.pockets.map((p) => p.bottom + itemH * Math.cos(p.tilt * DEG) + (p.w / 2) * Math.sin(p.tilt * DEG)));
}

/** Every pocket grid of the bin whose items have a height (none for containers), and where their tips reach. */
export function standingGrids(opts: BinOptions, cellsIn?: Partial<BinCells> | null): StandingGrid[] {
  const o = sanitizeBin(opts);
  if (activeContainer(o)) return [];
  const cells = binCells(o, cellsIn);
  const out: StandingGrid[] = [];
  const H = binBodyHeight(o);
  if (o.interior === 'pockets') {
    const p = findPocketPreset(o.pocketPreset);
    if (p?.itemH) {
      const { w: W, d: D } = binSize(o, cells);
      // As buildBin lays them out.
      const top = tipOf(pocketLayout(o, W, D, binFloorZ(o), accessoryInfillTop(o, W, D, o.lip ? H - LIP_SUPPORT_HEIGHT : H)), p.itemH);
      if (top !== null) out.push({ where: 'bin', preset: p, itemH: p.itemH, top });
    }
  }
  if (o.interior === 'compartments' && o.layout?.comps) {
    for (const c of binLayout(o, cells).compartments) {
      const co = o.layout.comps[c.key];
      if (compartmentInside(co) !== 'pockets') continue;
      const p = findPocketPreset(compartmentPocketOpts(o, co).pocketPreset);
      if (!p?.itemH) continue;
      const tops = binCompartmentPockets(o, cells, c).flatMap((L) => tipOf(L, p.itemH!) ?? []);
      if (tops.length) out.push({ where: 'compartment', key: c.key, preset: p, itemH: p.itemH, top: Math.max(...tops) });
    }
  }
  // Stretched bins get no lid (project.ts).
  if (hasLid(o) && isPocketLid(o) && !hasStretch(cells.stretch)) {
    const p = findPocketPreset(lidPocketOpts(o).pocketPreset);
    const top = p?.itemH ? tipOf(pocketLidLayout(o, cells), p.itemH) : null;
    if (p?.itemH && top !== null) out.push({ where: 'lid', preset: p, itemH: p.itemH, top: H - LID_SEAT_DROP + top });
  }
  return out;
}

type HeightInput = Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>;

/** How high tips may reach in a bin: under a lid or a bin stacked on top (`seat`; null without a lip, as nothing sits on it), and under the rim. */
export function tipLimits(o: HeightInput): { seat: number | null; rim: number } {
  const H = binBodyHeight(o);
  return { seat: o.lip ? H - LID_SEAT_DROP : null, rim: H + lipRise(o) };
}

const units = (mm: number) => Math.max(MIN_HEIGHT_UNITS, Math.ceil(mm / HEIGHT_UNIT - EPS));

/** The lowest wall height (units) that keeps tips reaching `top` under a lid or a bin stacked on top (without a lip: under the rim). */
export function unitsToCover(top: number, lip: boolean): number {
  return units(top + (lip ? LID_SEAT_DROP : 0));
}

/** The lowest wall height (units) that keeps tips reaching `top` under the rim. */
export function unitsUnderRim(top: number, lip: boolean): number {
  return units(top - lipRise({ lip }));
}

/** Where items `itemH` tall reach in a new bin with this base: on its floor (no magnets, no lean). */
export function freshTop(o: Pick<BinOptions, 'base'>, itemH: number): number {
  return binFloorZ(o) + itemH;
}

/** A bin's height as it stands, with its lid on (stretched bins get none). */
export function standingBinHeight(o: BinOptions, cells?: Partial<BinCells> | null): number {
  const b = sanitizeBin(o);
  return hasLid(b) && !hasStretch(cells?.stretch) ? lidStackHeight(b) : binTotalHeight(b);
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The note under a pocket grid whose items have a height: how tall they stand,
 * where their tips reach, and what bin height keeps them under a lid (or a
 * bin stacked on top) and under the rim. `fmt` writes a length.
 */
export function standingNote(s: StandingGrid, opts: BinOptions, fmt: (mm: number) => string): string {
  const o = sanitizeBin(opts);
  const stand = `${capital(itemNoun(s.preset))} stand ${fmt(s.itemH)} tall`;
  if (s.where === 'lid') return `${stand}: on the closed bin they reach ${fmt(s.top)}.`;
  const reach = `${stand}, their tips ${fmt(s.top)} above the bin’s bottom`;
  const { seat, rim } = tipLimits(o);
  const cover = unitsToCover(s.top, o.lip);
  if (seat !== null && s.top <= seat + EPS) return `${reach}: under a lid or a bin stacked on top.`;
  if (s.top <= rim + EPS) return o.lip ? `${reach}: under the rim; a lid or a bin stacked on top needs ${cover}u.` : `${reach}: under the rim.`;
  const keep = `Make the bin ${unitsUnderRim(s.top, o.lip)}u to keep them under it`;
  return `${reach}, ${fmt(s.top - rim)} above the rim. ${o.lip ? `${keep}, or ${cover}u for a lid or a bin stacked on top.` : `${keep}.`}`;
}

/** The note for one of the bin's grids, or undefined when its items have no height (for PocketSettings' `note`). */
export function standingNoteFor(o: BinOptions, cells: Partial<BinCells> | null | undefined, where: StandingGrid['where'], key: string | undefined, fmt: (mm: number) => string): string | undefined {
  const s = standingGrids(o, cells).find((g) => g.where === where && (where !== 'compartment' || g.key === key));
  return s ? standingNote(s, o, fmt) : undefined;
}
