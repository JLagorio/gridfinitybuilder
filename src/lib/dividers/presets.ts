import { uniformLayout } from './edit';
import { EDGE, type CompartmentOptions, type DividerLayout, type DividerWall } from './types';

export interface Preset {
  id: string;
  name: string;
  hint: string;
  layout: DividerLayout;
  /** Bin-level defaults the preset suggests (e.g. scoops for a sorter). */
  defaults?: CompartmentOptions;
}

const ratio = (t: number) => ({ kind: 'ratio' as const, t });
const v = (id: string, lo: string, hi: string, t: number, start = EDGE, end = EDGE): DividerWall => ({
  id,
  orient: 'v',
  lo,
  hi,
  pos: ratio(t),
  start,
  end,
});
const h = (id: string, lo: string, hi: string, t: number, start = EDGE, end = EDGE): DividerWall => ({
  id,
  orient: 'h',
  lo,
  hi,
  pos: ratio(t),
  start,
  end,
});

/** Ready-made layouts. All positions are ratios, so they fit any bin size. */
export const PRESETS: Preset[] = [
  { id: 'halves', name: 'Half and half', hint: 'One wall down the middle', layout: { walls: [v('p1', EDGE, EDGE, 1 / 2)] } },
  {
    id: 'big-3-small',
    name: '1 big + 3 small',
    hint: 'A big compartment at the back, a row of three small ones at the front',
    layout: { walls: [h('p1', EDGE, EDGE, 1 / 3), v('p2', EDGE, EDGE, 1 / 3, EDGE, 'p1'), v('p3', 'p2', EDGE, 1 / 2, EDGE, 'p1')] },
  },
  { id: 'rows-2x4', name: '2 rows × 4', hint: 'Eight equal compartments', layout: uniformLayout(4, 2) },
  {
    id: 'sorter-3x3',
    name: 'Screw sorter 3×3',
    hint: 'Nine compartments with scoops and full-width label tabs',
    layout: uniformLayout(3, 3),
    defaults: { scoop: 0.8, label: 'full' },
  },
  {
    id: 'half-quarters',
    name: 'Half, then quarters',
    hint: 'Left half open, right half in four',
    layout: { walls: [v('p1', EDGE, EDGE, 1 / 2), h('p2', EDGE, EDGE, 1 / 2, 'p1', EDGE), v('p3', 'p1', EDGE, 1 / 2)] },
  },
  {
    id: 'tool-tray',
    name: 'Tool tray',
    hint: 'A long slot on the left, two compartments on the right',
    layout: { walls: [v('p1', EDGE, EDGE, 1 / 4), h('p2', EDGE, EDGE, 1 / 2, 'p1', EDGE)] },
  },
];
