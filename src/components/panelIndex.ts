import type { FindEntry } from '../lib/panelSearch';

/**
 * What "Find a setting" searches (lib/panelSearch.ts), panel by panel, in the
 * order the panels show it. Each id is used by the component that renders the
 * entry: `<Section find>`, `<Group find>` or `<Find id>`. `words` are what
 * people might type for it (synonyms, the options it offers), not its title
 * again. `basic: false` leaves it out of the Basic view unless it's set.
 */

// ---------------------------------------------------------------------------
// Bins (BinPanel.tsx)
// ---------------------------------------------------------------------------

export const BIN_INDEX: FindEntry[] = [
  // BinPanel: what's in the drawer and filling it (first when no bin is selected, last when one is).
  {
    id: 'layout',
    title: 'Layout',
    words: ['draw', 'fill', 'empty', 'fill from a list', 'list', 'autofill', 'clear all', 'remove', 'count', 'how many', 'bins in this drawer'],
    children: [
      // ExternalBins.tsx (lib/external.ts): placeholders and imported meshes.
      {
        id: 'external',
        title: 'Bins from elsewhere',
        words: [
          'import', 'stl', '3mf', 'obj', 'mesh', 'placeholder', 'bought', 'downloaded', 'existing bin', 'bin i already have', 'already have',
          'own', 'printables', 'makerworld', 'thingiverse', 'other generator', 'model', 'file',
        ],
      },
    ],
  },
  // BinPanel: the selected bin (or the settings for new bins).
  {
    id: 'bin',
    title: 'Selected bin',
    words: ['new bins', 'settings'],
    children: [
      {
        id: 'quick',
        title: 'Start from',
        words: ['preset', 'quick start', 'starting point', 'screws', 'small parts', 'batteries', 'deep bin', 'tall', 'tool tray', 'label everything', 'one click'],
      },
      {
        id: 'type',
        title: 'Type',
        words: ['container', 'kind', 'plain bin', 'drawer unit', 'chest', 'drawers', 'parts box', 'box', 'hinged lid', 'hopper', 'tool rack', 'dispenser'],
      },
      { id: 'size', title: 'Width and depth', words: ['size', 'width', 'depth', 'units', 'footprint', 'bigger', 'smaller', 'resize'] },
      {
        id: 'height',
        title: 'Height',
        words: ['tall', 'taller', 'deep', 'depth', 'units', '7 mm', 'overall', 'inside'],
        children: [{ id: 'height-mode', title: 'Height in mm', words: ['inside depth', 'overall height', 'mm', 'units', 'internal', 'external'], basic: false }],
      },
    ],
  },
  // BinPanel: a container's own options (containers/*Fields.tsx).
  {
    id: 'container',
    title: 'Container options',
    when: 'for a drawer unit, parts box, hopper, tool rack or dispenser (Type)',
    words: [
      'drawer unit', 'drawers', 'chest', 'pull', 'knob', 'stop', 'parts box', 'box', 'lid', 'hinge', 'latch', 'magnet', 'snap',
      'hopper', 'slope', 'front lip', 'tool rack', 'screwdriver', 'hex key', 'allen', 'file', 'plier', 'wrench', 'spanner', 'lean',
      'engrave', 'dispenser', 'battery', 'coin cell', 'tape', 'zip tie', 'magazine', 'compartments', 'scoop', 'label', 'columns', 'rows',
    ],
  },
  // BinPanel + CompartmentFields: what the bin holds inside.
  {
    id: 'inside',
    title: 'Inside',
    when: 'for a plain bin (Type)',
    words: [],
    children: [
      {
        id: 'interior',
        title: 'Inside',
        words: ['compartments', 'dividers', 'pocket grid', 'pockets', 'holder', 'tool cutouts', 'shadow board', 'batteries', 'bits', 'cards', 'interior'],
      },
      {
        id: 'pockets',
        title: 'Pocket grid',
        when: 'when Inside is Pocket grid',
        words: ['pocket', 'pockets', 'holder', 'grid of holes'],
        children: [
          {
            id: 'pocket-holds',
            title: 'Holds',
            words: ['battery', 'bits', 'sd card', 'card', 'drill', 'socket', 'hex key', 'marker', 'pen', 'paint', 'nozzle', 'coin', 'test tube', 'sizes', 'set', 'fit an item', 'measure'],
          },
          { id: 'pocket-shape', title: 'Pocket shape and size', words: ['round', 'square', 'hex', 'diameter', 'size', 'depth', 'spacing', 'chamfer', 'clearance'] },
          { id: 'pocket-bottom', title: 'Pocket bottom', words: ['flat', 'round', 'cone', 'point', 'stepped', 'bore', 'collar'] },
          { id: 'pocket-lean', title: 'Lean', words: ['lean', 'tilt', 'angle', 'tip'] },
          { id: 'pocket-access', title: 'Finger access', words: ['finger', 'groove', 'notch', 'thumb', 'grab'] },
          { id: 'pocket-magnet', title: 'Magnet under each pocket', words: ['magnet', 'magnets', 'steel', 'hold'] },
        ],
      },
      { id: 'shadow', title: 'Two-colour pocket floors', when: 'for tool cutouts', words: ['shadow board', 'two colour', 'color', 'filament', 'ams', 'tool pocket', 'missing tool'] },
      {
        id: 'compartments',
        title: 'Compartments',
        when: 'when Inside is Compartments',
        words: ['dividers', 'divider', 'walls', 'split', 'sections', 'grid'],
        children: [
          { id: 'comp-split', title: 'Columns and rows', words: ['columns', 'rows', 'grid', 'equal'] },
          { id: 'comp-presets', title: 'Layout presets', words: ['preset', 'half', 'quarters', 'screw sorter', 'tool tray', 'big and small'] },
          { id: 'comp-divide', title: 'Divide', words: ['split', 'equal', 'ratio', 'min size', 'parts', 'auto divide'], basic: false },
          {
            id: 'comp-edit',
            title: 'Selected wall or compartment',
            when: 'when a wall or compartment is clicked in the Compartments view',
            words: [
              'wall height', 'lowered', 'removable', 'slide in', 'plate', 'gap', 'proportional', 'distribute', 'delete wall', 'wall top', 'chamfer',
              'rounded', 'finger notch', 'diagonal', 'curved', 'floor', 'raise floor', 'ramp', 'steps', 'scoop', 'label', 'cup', 'grid insert', 'solid',
            ],
          },
        ],
      },
    ],
  },
  // BinPanel + LabelFields: the front of the bin.
  {
    id: 'label',
    title: 'Scoop & label',
    when: 'for a plain bin (Type)',
    words: [],
    children: [
      { id: 'scoop', title: 'Finger scoop', words: ['scoop', 'curve', 'curved', 'front', 'slide out', 'reach', 'small parts', 'ramp'] },
      { id: 'label-tab', title: 'Label tab', words: ['label', 'tab', 'name', 'shelf', 'full', 'left', 'mid', 'right'] },
      { id: 'label-text', title: 'Label text', when: 'with a label tab or a front label', words: ['label', 'text', 'name', 'words', 'icon', 'symbol', 'bolt', 'contents', 'lines'] },
      { id: 'label-style', title: 'Raised, engraved or inlaid', words: ['label', 'text style', 'raised', 'embossed', 'engraved', 'debossed', 'inlaid', 'two colour', 'color', 'ams'], basic: false },
      { id: 'label-plates', title: 'Swappable label plates', words: ['label', 'plate', 'swap', 'relabel', 'removable', 'cullenect', 'pred', 'socket', 'gflabel'], basic: false },
      { id: 'front-label', title: 'Front label', words: ['label', 'front wall', 'outside', 'text', 'raised', 'engraved', 'inlaid', 'two colour', 'letter height'], basic: false },
    ],
  },
  // BinPanel: the folding option groups.
  {
    id: 'options',
    title: 'Options',
    words: [],
    children: [
      {
        id: 'base',
        title: 'Base & holes',
        words: ['bottom', 'underneath'],
        children: [
          { id: 'base-feet', title: 'Base', words: ['feet', 'foot', 'standard', 'lite', 'hollow', 'efficient floor', 'flat', 'no feet', 'less plastic'] },
          {
            id: 'holes',
            title: 'Bottom holes',
            words: ['magnet', 'magnets', 'screw', 'screws', 'refined', 'side loaded', 'press fit', 'crush ribs', 'chamfer', 'printable', 'supports', 'corners', 'half grid'],
          },
        ],
      },
      {
        id: 'lip',
        title: 'Lip & lid',
        when: 'for a plain bin (Type)',
        words: ['stack', 'stacking'],
        children: [
          { id: 'lip-style', title: 'Stacking lip', words: ['lip', 'stack', 'stacking', 'reduced', 'none', 'anti slide', 'notches', 'top edge'] },
          { id: 'lid', title: 'Stacking lid', words: ['lid', 'cover', 'cap', 'top', 'stack', 'pocket grid', 'pocket lid', 'receptacles'] },
        ],
      },
      {
        id: 'walls',
        title: 'Walls',
        when: 'for a plain bin (Type)',
        basic: false,
        words: [],
        children: [
          { id: 'wall-cutouts', title: 'Wall cutouts', words: ['cutout', 'notch', 'opening', 'reach in', 'side', 'front'] },
          { id: 'wall-slides', title: 'Finger slides', words: ['slide', 'ramp', 'curve', 'radius', 'floor', 'scoop'] },
          { id: 'wall-hex', title: 'Hex wall pattern', words: ['hex', 'honeycomb', 'holes', 'pattern', 'save plastic', 'light', 'web'] },
          { id: 'fillet', title: 'Rounded inside corners', words: ['corner', 'fillet', 'round', 'square', 'radius'] },
        ],
      },
      {
        id: 'trays',
        title: 'Trays, lids & rails',
        when: 'for a plain bin (Type)',
        basic: false,
        words: [],
        children: [
          { id: 'tray', title: 'Lift-out tray', words: ['tray', 'lift out', 'layer', 'shelf', 'level', 'ledge', 'insert'] },
          { id: 'slide-lid', title: 'Sliding lid', words: ['lid', 'slide', 'cover', 'groove', 'click', 'engraved', 'text'] },
          { id: 'rails', title: 'Divider rails', words: ['rail', 'divider', 'dividers', 'plates', 'slots', 'guide', 'adjustable', 'pitch'] },
        ],
      },
      {
        id: 'inserts',
        title: 'Cups & grid inserts',
        when: 'for a plain bin (Type)',
        basic: false,
        words: [],
        children: [
          { id: 'cups', title: 'Cups', words: ['cup', 'lift out', 'pour', 'scoop', 'pull tab', 'finger groove', 'insert'] },
          { id: 'crate', title: 'Grid insert', words: ['grid', 'egg crate', 'lattice', 'insert', 'cells', 'columns', 'rows'] },
        ],
      },
    ],
  },
  // ContentsField.tsx
  {
    id: 'contents',
    title: 'What’s in it',
    when: 'when one bin is selected',
    words: ['contents', 'inventory', 'items', 'list', 'find', 'search', 'drawer map', 'notes', 'stored'],
  },
  // StackSection.tsx
  {
    id: 'stack',
    title: 'Stacking',
    when: 'when one bin is selected',
    basic: false,
    words: ['stack', 'stacked', 'level', 'layer', 'on top', 'second layer', 'deep drawer', 'move to the floor'],
  },
  // BinPanel: StretchSection
  {
    id: 'stretch',
    title: 'Stretch into the gap',
    when: 'when one bin is selected and the grid leaves a gap to the drawer wall',
    basic: false,
    words: ['stretch', 'gap', 'margin', 'edge', 'drawer wall', 'overhang', 'wider', 'auto'],
  },
  // BinPanel: what to do with the selected bins.
  {
    id: 'actions',
    title: 'This bin',
    when: 'when a bin is selected',
    words: ['duplicate', 'copy', 'delete', 'remove', 'use for new bins', 'download', 'export', '3mf', 'stl', 'step', 'cad', 'lid'],
  },
  // TemplatesSection.tsx
  { id: 'templates', title: 'Templates', basic: false, words: ['template', 'save', 'reuse', 'apply', 'preset', 'saved settings', 'favourite', 'favorite'] },
  // ToolLibrary.tsx
  {
    id: 'tools',
    title: 'Tool library',
    basic: false,
    words: ['tool', 'tools', 'trace', 'photo', 'picture', 'svg', 'dxf', 'outline', 'shadow board', 'cutout', 'pockets', 'make a bin', 'clearance', 'chamfer'],
  },
];

// ---------------------------------------------------------------------------
// Drawer & baseplate (DrawerPanel.tsx)
// ---------------------------------------------------------------------------

export const DRAWER_INDEX: FindEntry[] = [
  {
    id: 'drawer',
    title: 'Drawer',
    words: [],
    children: [
      { id: 'drawer-name', title: 'Name', words: ['name', 'rename', 'title'] },
      { id: 'drawer-size', title: 'Size', words: ['size', 'width', 'depth', 'measure', 'inside', 'grid units', 'size from', 'not square', 'samples'] },
      { id: 'drawer-height', title: 'Inside height', words: ['height', 'tall', 'deep', 'tallest bin', 'clearance above'] },
      { id: 'inch-precision', title: 'Show inches to', when: 'with lengths in inches', words: ['inch', 'inches', 'fraction', 'decimal', '1/16', '1/32'] },
    ],
  },
  {
    id: 'grid',
    title: 'Grid',
    words: [],
    children: [
      { id: 'leftover', title: 'Leftover space', words: ['margin', 'gap', 'edge', 'solid', 'half cells', 'partial cells', 'spacer strips', 'fill', 'narrowest'] },
      {
        id: 'blocked',
        title: 'Blocked cells',
        words: ['block', 'blocked', 'obstacle', 'hardware', 'slide', 'runner', 'bump', 'skip', 'cut out', 'filled', 'mask'],
      },
      { id: 'grid-position', title: 'Grid position', words: ['align', 'alignment', 'left', 'right', 'center', 'centre', 'front', 'back', 'position', 'push'], basic: false },
      { id: 'clearance', title: 'Fit clearance', words: ['clearance', 'tolerance', 'loose', 'tight', 'play', 'binding'], basic: false },
      { id: 'half-grid', title: 'Half grid (21 mm)', words: ['half', '21 mm', 'pitch', 'half units', 'half cells', 'gridfinity extended'], basic: false },
    ],
  },
  {
    id: 'enclosure',
    title: 'Drawer, case or wall',
    words: [
      'carry case', 'case', 'box', 'lid', 'hinge', 'latch', 'handle', 'feet', 'wall', 'wall mount', 'hang', 'french cleat', 'cleat', 'keyhole',
      'countersunk', 'ledge', 'spacer strips', 'lattice', 'tabs', 'enclosure',
    ],
  },
  {
    id: 'baseplate',
    title: 'Baseplate',
    words: ['plate'],
    children: [
      { id: 'bp-style', title: 'Style', words: ['frame', 'open', 'weighted', 'weights', 'skeleton', 'skeletonized', 'solid', 'floor', 'filament', 'less plastic'] },
      { id: 'bp-magnets', title: 'Magnet pockets', words: ['magnet', 'magnets', 'pocket', 'diameter', 'fit', 'top', 'bottom', 'push out', 'crush ribs', 'chamfer', 'pry slot', 'glue'] },
      { id: 'bp-screws', title: 'Screw holes', words: ['screw', 'screws', 'countersunk', 'mount', 'fix', 'head', 'hole floor'] },
      {
        id: 'bp-connectors',
        title: 'Connectors',
        words: ['joint', 'join', 'joiner', 'connect', 'pieces', 'seam', 'split', 'bowtie', 'key', 'dovetail', 'pin', 'filament pin', 'puzzle', 'jigsaw', 'm3', 'screws', 'nut', 'heat set insert'],
      },
      { id: 'bp-numbers', title: 'Piece numbers', words: ['number', 'numbers', 'assembly', 'order', 'underneath', 'deboss'], basic: false },
      { id: 'bp-floor', title: 'Extra solid floor', words: ['floor', 'thickness', 'bottom', 'pad', 'thicker'], basic: false },
      { id: 'bp-pads', title: 'Non-slip pads', words: ['tpu', 'pad', 'pads', 'grip', 'rubber', 'non slip', 'anti slip', 'dots', 'strips'], basic: false },
      { id: 'bp-edges', title: 'Edges and fit', words: ['corner radius', 'rounded corners', 'ridge', 'trim', 'bottom clearance', 'chamfer', 'elephant foot', 'advanced'], basic: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Print plates (PrintPanel.tsx)
// ---------------------------------------------------------------------------

export const PRINT_INDEX: FindEntry[] = [
  { id: 'print-drawers', title: 'Drawers to print', when: 'with several drawers', words: ['drawers', 'all drawers', 'this drawer', 'choose', 'which'] },
  {
    id: 'printers',
    title: 'Printer',
    words: ['printers'],
    children: [
      { id: 'printer-model', title: 'Model', words: ['printer', 'model', 'bambu', 'prusa', 'creality', 'voron', 'bed', 'bed size', 'custom', 'build volume'] },
      { id: 'nozzle', title: 'Nozzle', words: ['nozzle', '0.2', '0.4', '0.6', '0.8', 'line width', 'print checks'] },
      { id: 'bed-margin', title: 'Edge margin', words: ['margin', 'edge', 'brim', 'usable bed'], basic: false },
      { id: 'part-spacing', title: 'Part spacing', words: ['spacing', 'gap', 'between parts', 'distance'], basic: false },
      {
        id: 'more-printers',
        title: 'More printers',
        words: ['add a printer', 'second printer', 'two printers', 'several', 'fleet', 'farm', 'remove', 'baseplate prints on', 'biggest', 'model', 'edge margin', 'bed'],
      },
    ],
  },
  { id: 'checks', title: 'Print checks', words: ['check', 'problems', 'warnings', 'tips', 'fix', 'fail', 'too thin', 'printability'] },
  {
    id: 'export',
    title: 'Export',
    words: [],
    children: [
      { id: 'export-what', title: 'Baseplate and bins', words: ['include', 'baseplate', 'bins', 'leave out'] },
      { id: 'label-colour', title: 'Label filament', when: 'with inlaid labels or two-colour pocket floors', words: ['colour', 'color', 'second filament', 'slot 2', 'ams', 'inlaid', 'two colour'] },
      {
        id: 'export-files',
        title: 'Files',
        words: ['download', 'bambu studio', 'project', 'slicer', 'orca', '3mf', 'zip', 'stl', 'step', 'cad', 'fusion', 'assembly map', 'assembled'],
      },
      {
        id: 'only-changed',
        title: 'Only what’s changed',
        words: ['reprint', 'printed', 'mark as printed', 'mark all', 'forget printed', 'changed', 'new parts', 'skip printed'],
        basic: false,
      },
    ],
  },
  { id: 'plates', title: 'Plates', words: ['plate', 'plates', 'download', '3mf', 'stl', 'step', 'printed', 'mark as printed', 'show'] },
  {
    id: 'split',
    title: 'Baseplate split',
    basic: false,
    words: ['split', 'pieces', 'strategy', 'fewest plates', 'even pieces', 'biggest pieces', 'share plates', 'nest', 'cut', 'solid margin'],
  },
  {
    id: 'bom',
    title: 'Bill of materials',
    words: ['bom', 'magnets', 'screws', 'hardware', 'how many', 'filament', 'grams', 'weight', 'time', 'hours', 'cost', 'price', 'currency', 'electricity', 'kwh', 'watts', 'csv'],
  },
  { id: 'testfit', title: 'Test-fit kit', words: ['test', 'sample', 'fit', 'tolerance', 'check fit', 'try first'] },
  { id: 'contents-list', title: 'Drawer map & contents', words: ['map', 'drawer map', 'print', 'paper', 'svg', 'contents', 'list', 'csv', 'inventory', 'labels'] },
  { id: 'project', title: 'Project', words: ['save', 'open', 'load', 'file', 'json', 'backup', 'share', 'link', 'url', 'copy', 'imported meshes'] },
];
