import type { FindEntry } from '../lib/panelSearch';

/**
 * What "Find a setting" searches on a Skådis board's first tab
 * (SkadisPanel.tsx), as panelIndex.ts does for the other panels. Apart from
 * them so it loads with that panel, not on the first screen.
 */
export const SKADIS_INDEX: FindEntry[] = [
  {
    id: 'skadis',
    title: 'Skådis board',
    words: ['skadis', 'pegboard', 'peg board', 'ikea', 'board', 'wall'],
    children: [
      {
        id: 'skadis-print',
        title: 'Print for this board',
        words: ['just attachments', 'have a board', 'ikea board', 'already have', 'own', 'bought', 'not printed', 'only attachments', '56 cm', '76 cm', '36 cm'],
      },
      { id: 'skadis-name', title: 'Name', words: ['name', 'rename', 'title'] },
      { id: 'skadis-space', title: 'Space on the wall', words: ['size', 'width', 'height', 'space', 'measure', 'wall', 'fill', '56 cm', '76 cm'] },
      {
        id: 'skadis-shape',
        title: 'Tiles',
        words: ['tile', 'tiles', 'rectangle', 'square', 'hexagon', 'hex', 'honeycomb', 'split', 'seam', 'pieces', 'shape'],
      },
      { id: 'skadis-hex', title: 'Hexagon size', when: 'with hexagon tiles', words: ['hexagon', 'hex', 'size', 'width', 'gap', 'spacing', 'corner to corner'] },
    ],
  },
  {
    id: 'skadis-mount',
    title: 'Joining and hanging',
    words: [],
    children: [
      {
        id: 'skadis-join',
        title: 'Join the tiles with',
        when: 'with rectangle tiles',
        words: ['join', 'joint', 'connector', 'connect', 'dovetail', 'tab', 'puzzle', 'plate', 'pin', 'interlock', 'glue', 'seam'],
      },
      {
        id: 'skadis-standoff',
        title: 'Off the wall on',
        words: ['standoff', 'spacer', 'post', 'riser', 'gap', 'depth', 'behind', 'clearance', 'hook room', 'distance from wall'],
      },
      { id: 'skadis-screws', title: 'Screws', words: ['screw', 'screws', 'countersunk', 'mount', 'fix', 'hang', 'wall plug', 'anchor', 'how many'] },
    ],
  },
  {
    id: 'skadis-board',
    title: 'Board',
    words: [],
    children: [
      { id: 'skadis-slots', title: 'Slots', words: ['slot', 'hole', 'width', 'length', 'tolerance', 'loose', 'tight', 'chamfer', '5 x 15'], basic: false },
      { id: 'skadis-thickness', title: 'Thickness', words: ['thick', 'thickness', 'thin', '5 mm', 'stiff'], basic: false },
      { id: 'skadis-edge', title: 'Border and corners', words: ['border', 'edge', 'margin', 'corner', 'radius', 'round'], basic: false },
      {
        id: 'skadis-numbers',
        title: 'Tile numbers',
        when: 'with rectangle tiles',
        words: ['number', 'numbers', 'assembly', 'order', 'back', 'deboss'],
        basic: false,
      },
    ],
  },
];
