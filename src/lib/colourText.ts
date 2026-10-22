import type { ColourRole } from './colours';

/**
 * What the colour roles (colours.ts ROLES) are called and cover, for the
 * Colours section and the names of split volumes. Apart from colours.ts so
 * the first screen doesn't carry the text.
 */
export const ROLE_TEXT: Record<ColourRole, { label: string; note: string; basic?: string }> = {
  plate: { label: 'Baseplate', note: 'Baseplate pieces.', basic: 'Baseplate' },
  plateAccent: { label: 'Connector keys & spacer strips', note: 'Bowtie keys and the spacer strips around a grid, a Skådis board’s joint plates and spacers.' },
  wallGrid: { label: 'Wall grid & cleats', note: 'A wall-mounted grid and its French cleat, and Skådis boards.' },
  pads: { label: 'Non-slip pads', note: 'TPU pads under the baseplate (their own plates).' },
  caseShell: { label: 'Carry-case shell', note: 'The case body with its floor grid.' },
  caseLid: { label: 'Case lid', note: 'Lid pieces and their keys.' },
  caseHandle: { label: 'Case handle', note: 'The carry handle.' },
  caseHardware: { label: 'Hinge pins & feet', note: 'Printed hinge pins and feet.' },
  binWalls: { label: 'Bin walls', note: 'Bin walls; the rest of the bin follows them until set.', basic: 'Bins' },
  binFeet: { label: 'Bin feet', note: 'The Gridfinity feet under each cell.' },
  binFloor: { label: 'Bin floor', note: 'Inside floor, scoops and filled compartments.' },
  binLip: { label: 'Stacking lip', note: 'The lip (top edge) bins stack on.' },
  dividers: { label: 'Dividers', note: 'Divider walls and slide-in divider plates.' },
  labelTabs: { label: 'Label tabs & plates', note: 'Label tabs and swappable label plates.' },
  lids: { label: 'Lids', note: 'Stacking lids, sliding lids, pocket-grid lids.' },
  inserts: { label: 'Trays, cups & inserts', note: 'Lift-out trays, cups and grid inserts.' },
  containerShell: { label: 'Container shells', note: 'Drawer units, parts boxes, hoppers, racks, dispensers.' },
  containerFront: { label: 'Drawer fronts', note: 'The drawers of a drawer unit.' },
  containerPull: { label: 'Pulls', note: 'Tab and knob pulls on drawer fronts.' },
  attachments: { label: 'Board attachments', note: 'Hooks, bins, shelves and everything else that hangs on a Skådis board, with their extra parts.' },
  labelText: { label: 'Label text & icons', note: 'Inlaid and two-tone label text and icons, and the text on boards and their attachments.', basic: 'Labels' },
  qrCode: { label: 'QR codes', note: 'The dark modules of inlaid QR codes: keep them darker than what they’re on.' },
  shadow: { label: 'Tool shadows', note: 'Two-colour floors of tool pockets.' },
  wallText: { label: 'Board & attachment text', note: 'Inlaid and raised text on a board’s zones, attachment labels and label tags.' },
};

export const roleLabel = (r: ColourRole) => ROLE_TEXT[r].label;
