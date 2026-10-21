import { luminance, paletteOf, type FilamentSlot } from './colours';
import type { PrintSetup } from './layout/plan';

/**
 * Multi-colour presets and swatch text (colours.ts), for the Colours section:
 * apart from colours.ts so the first screen doesn't carry them.
 */

export type ColourPresetId = 'one' | 'red-black' | 'coded';

export const COLOUR_PRESETS: readonly { id: ColourPresetId; label: string; title: string }[] = [
  { id: 'one', label: 'One colour', title: 'Everything in one filament (label inlays in slot 2), as without multi-colour' },
  { id: 'red-black', label: 'Red plate, black bins', title: 'Baseplate in red, bins in black, labels in white, each part one colour' },
  { id: 'coded', label: 'Colour-coded bins', title: 'Each kind of bin its own colour (by what’s in it, else by size), labels in white' },
];

/** Put colours into palette slots (keeping prices and materials), returning the new palette. */
export function withSlotColours(s: Pick<PrintSetup, 'filaments'>, colours: Record<number, { colour: string; name: string }>): FilamentSlot[] {
  const n = Math.max(...Object.keys(colours).map(Number));
  const pal = paletteOf(s, n);
  for (const [k, v] of Object.entries(colours)) pal[Number(k) - 1] = { ...pal[Number(k) - 1], colour: v.colour, name: v.name };
  return pal;
}

/** The setup patch a preset makes (the colour-coded preset's per-bin colours are the store's: state/colours.ts). */
export function presetSetup(s: Pick<PrintSetup, 'filaments' | 'colours'>, id: ColourPresetId): Pick<PrintSetup, 'colours' | 'filaments'> {
  if (id === 'one') return { colours: undefined, filaments: s.filaments };
  if (id === 'red-black') {
    return {
      filaments: withSlotColours(s, { 1: { colour: '#161616', name: 'Black' }, 2: { colour: '#F2F2F2', name: 'White' }, 3: { colour: '#C12E1F', name: 'Red' } }),
      colours: { on: true, strategy: s.colours?.strategy, roles: { plate: 3, binWalls: 1, labelText: 2 }, mix: s.colours?.mix },
    };
  }
  return {
    filaments: withSlotColours(s, {
      1: { colour: '#161616', name: 'Black' },
      2: { colour: '#F2F2F2', name: 'White' },
      3: { colour: '#C12E1F', name: 'Red' },
      4: { colour: '#0A2989', name: 'Blue' },
      5: { colour: '#F4EE2A', name: 'Yellow' },
      6: { colour: '#00AE42', name: 'Green' },
    }),
    colours: { on: true, strategy: s.colours?.strategy === 'feature' ? 'part' : s.colours?.strategy, roles: { plate: 1, binWalls: 1, labelText: 2 }, mix: s.colours?.mix },
  };
}

/** Slots the colour-coded preset hands out to bins, in turn. */
export const CODED_SLOTS = [3, 4, 5, 6] as const;


/** Text colour that reads on a swatch. */
export const inkOn = (hex: string) => (luminance(hex) > 0.4 ? '#111' : '#fff');
