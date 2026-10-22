import type { PrintSetup } from './layout/plan';

/**
 * Multi-colour printing: a palette of filament slots, colour roles
 * ("surfaces": the baseplate, bin walls, label text, …) mapped to slots, and
 * how the colours get onto the print (the strategy).
 *
 * - Off (the default): one filament, plus filament 2 for the bodies that have
 *   always printed in a second filament (inlaid label text, two-colour shadow
 *   floors). Exports, estimates and the 3D view are as before.
 * - 'part': every part is one filament (label inlays keep theirs). Parts of
 *   different colours go on different plates unless `mix` lets them share.
 * - 'height': colours change at layer heights (bin feet, floor, walls, lip):
 *   one swap per change per plate, by AMS or a pause. Parts on a plate share
 *   their change heights.
 * - 'feature': true multi-material: parts split into a volume per role
 *   (geometry/colourRegions.ts), each in its own filament.
 *
 * Nothing here changes a mesh key: colours are applied to the bodies a mesh
 * already has, at export and in the view. Only 'feature' builds other meshes
 * (the split, `splitMeshKey`), and those don't depend on the colours either.
 *
 * Kept small and free of geometry: the first screen loads it.
 */

export type ColourStrategy = 'part' | 'height' | 'feature';

export const STRATEGIES: readonly ColourStrategy[] = ['part', 'height', 'feature'];

/** Filament materials the palette offers, with their densities (g/cm³) for the BOM. */
export const MATERIALS = [
  { id: 'PLA', density: 1.24 },
  { id: 'PLA Matte', density: 1.32 },
  { id: 'PLA Silk', density: 1.32 },
  { id: 'PETG', density: 1.27 },
  { id: 'ABS', density: 1.04 },
  { id: 'ASA', density: 1.07 },
  { id: 'TPU', density: 1.21 },
] as const;

export type FilamentMaterial = (typeof MATERIALS)[number]['id'];

/** One filament slot (an AMS slot, a toolhead, or a spool to swap in by hand). */
export interface FilamentSlot {
  /** #RRGGBB. */
  colour: string;
  /** What to call it ("Black"); unset: from the colour. */
  name?: string;
  /** Unset: PLA. */
  material?: FilamentMaterial;
  /** Price per kg; unset: the setup's filament price. */
  price?: number;
}

/** Slots a palette can have (AMS setups go to 16). */
export const MAX_SLOTS = 16;
/** Slots the palette editor shows at least. */
export const MIN_SHOWN_SLOTS = 4;

/** The palette before it's edited: slot 2 is the old label filament's black. */
export const DEFAULT_PALETTE: readonly FilamentSlot[] = [
  { colour: '#F2F2F2', name: 'White' },
  { colour: '#161616', name: 'Black' },
  { colour: '#C12E1F', name: 'Red' },
  { colour: '#0A2989', name: 'Blue' },
  { colour: '#F4EE2A', name: 'Yellow' },
  { colour: '#00AE42', name: 'Green' },
  { colour: '#8E9089', name: 'Grey' },
  { colour: '#FF6A13', name: 'Orange' },
  { colour: '#5E43B7', name: 'Purple' },
  { colour: '#0086D6', name: 'Cyan' },
  { colour: '#F55A74', name: 'Pink' },
  { colour: '#7D6556', name: 'Brown' },
  { colour: '#F7E6DE', name: 'Beige' },
  { colour: '#BECF00', name: 'Lime' },
  { colour: '#545454', name: 'Dark grey' },
  { colour: '#A6A9AA', name: 'Silver' },
];

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type ColourRole =
  | 'plate'
  | 'plateAccent'
  | 'wallGrid'
  | 'pads'
  | 'caseShell'
  | 'caseLid'
  | 'caseHandle'
  | 'caseHardware'
  | 'binWalls'
  | 'binFeet'
  | 'binFloor'
  | 'binLip'
  | 'dividers'
  | 'labelTabs'
  | 'lids'
  | 'inserts'
  | 'containerShell'
  | 'containerFront'
  | 'containerPull'
  | 'attachments'
  | 'labelText'
  | 'qrCode'
  | 'shadow'
  | 'wallText';

export type RoleGroup = 'plate' | 'case' | 'bins' | 'labels';

export interface RoleDef {
  id: ColourRole;
  group: RoleGroup;
  /** Takes this role's slot until set itself. Unset: `slot`. */
  follows?: ColourRole;
  /** Slot when nothing is set. */
  slot?: number;
}

/**
 * Every role, in the order the All view lists them. The three without
 * `follows` are the Basic view's. What they're called: colourText.ts.
 */
export const ROLES: readonly RoleDef[] = [
  { id: 'plate', group: 'plate', slot: 1 },
  { id: 'plateAccent', group: 'plate', follows: 'plate' },
  { id: 'wallGrid', group: 'plate', follows: 'plate' },
  { id: 'pads', group: 'plate', follows: 'plate' },
  { id: 'caseShell', group: 'case', follows: 'plate' },
  { id: 'caseLid', group: 'case', follows: 'caseShell' },
  { id: 'caseHandle', group: 'case', follows: 'caseLid' },
  { id: 'caseHardware', group: 'case', follows: 'caseShell' },
  { id: 'binWalls', group: 'bins', slot: 1 },
  { id: 'binFeet', group: 'bins', follows: 'binWalls' },
  { id: 'binFloor', group: 'bins', follows: 'binWalls' },
  { id: 'binLip', group: 'bins', follows: 'binWalls' },
  { id: 'dividers', group: 'bins', follows: 'binWalls' },
  { id: 'labelTabs', group: 'bins', follows: 'binWalls' },
  { id: 'lids', group: 'bins', follows: 'binWalls' },
  { id: 'inserts', group: 'bins', follows: 'binWalls' },
  { id: 'containerShell', group: 'bins', follows: 'binWalls' },
  { id: 'containerFront', group: 'bins', follows: 'containerShell' },
  { id: 'containerPull', group: 'bins', follows: 'containerFront' },
  { id: 'attachments', group: 'bins', follows: 'binWalls' },
  { id: 'labelText', group: 'labels', slot: 2 },
  { id: 'qrCode', group: 'labels', follows: 'labelText' },
  { id: 'shadow', group: 'labels', follows: 'labelText' },
  { id: 'wallText', group: 'labels', follows: 'labelText' },
];

const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

export const roleDef = (id: ColourRole): RoleDef => ROLE_BY_ID.get(id)!;
export const isRole = (v: unknown): v is ColourRole => typeof v === 'string' && ROLE_BY_ID.has(v as ColourRole);

/** The roles the Basic view shows: plate, bins, labels. */
export const BASIC_ROLES: readonly ColourRole[] = ['plate', 'binWalls', 'labelText'];

/**
 * Inlays (today's filament-2 overlays): label text, QR codes, tool shadows,
 * text on a board and its attachments. By part they keep their own filament,
 * and a per-bin (per-attachment) colour doesn't change them, so they keep
 * their contrast.
 */
export const INLAY_ROLES: ReadonlySet<ColourRole> = new Set(['labelText', 'qrCode', 'shadow', 'wallText']);

/** Roles a per-drawer baseplate colour changes. */
const PLATE_ROLES: ReadonlySet<ColourRole> = new Set(['plate', 'plateAccent', 'wallGrid', 'caseShell']);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface ColourSetup {
  /** Print in the role colours. Off (unset): one filament plus filament 2 for label inlays, as always. */
  on?: boolean;
  /** Unset: 'part'. */
  strategy?: ColourStrategy;
  /** Slot (1-based) per role; a missing role takes what it follows. */
  roles?: Partial<Record<ColourRole, number>>;
  /** By part: let parts of different colours share a plate (a swap on every layer they share). */
  mix?: boolean;
}

export type ColourFields = Pick<PrintSetup, 'colours' | 'filaments' | 'filamentSlots' | 'filamentPrice'> & {
  /** Before the palette: filament 2's colour and price (migrated into slot 2 by cleanColourFields). */
  labelColour?: string;
  filamentPrice2?: number;
};

/** The setup fields colours depend on (a print job carries them: PrintJob.colours). */
export type ColourSetupFields = Pick<PrintSetup, 'colours' | 'filaments' | 'filamentSlots' | 'printerId'>;

/** The colour fields of a setup, for a print job to carry (null with multi-colour off). */
export function colourSetupOf(s: PrintSetup): ColourSetupFields | null {
  if (!s.colours?.on) return null;
  return { colours: s.colours, filaments: s.filaments, printerId: s.printerId, ...(s.filamentSlots ? { filamentSlots: s.filamentSlots } : {}) };
}

export const coloursOn = (s: Pick<PrintSetup, 'colours'> | null | undefined): boolean => !!s?.colours?.on;

/** The strategy in use, or null when multi-colour is off. */
export function strategyOf(s: Pick<PrintSetup, 'colours'> | null | undefined): ColourStrategy | null {
  if (!coloursOn(s)) return null;
  const v = s!.colours!.strategy;
  return v && STRATEGIES.includes(v) ? v : 'part';
}

const HEX = /^#[0-9a-f]{6}$/i;
export const cleanHex = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toUpperCase() : null);

const validSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_SLOTS;

/** A slot number as saved (bin, drawer, role), or undefined when it isn't one. */
export const cleanSlot = (v: unknown): number | undefined => (validSlot(v) ? v : undefined);

function cleanPrice(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 100000) : undefined;
}

export function cleanFilament(v: unknown, i: number): FilamentSlot {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<FilamentSlot>;
  const out: FilamentSlot = { colour: cleanHex(o.colour) ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length].colour };
  if (typeof o.name === 'string' && o.name.trim()) out.name = o.name.trim().slice(0, 24);
  if (MATERIALS.some((m) => m.id === o.material) && o.material !== 'PLA') out.material = o.material;
  const p = cleanPrice(o.price);
  if (p !== undefined) out.price = p;
  return out;
}

/**
 * The colour fields of a saved setup, checked, with the label filament of
 * setups saved before the palette (`labelColour`, `filamentPrice2`) moved into
 * slot 2. Changes `s` in place. Fields that are unset stay unset, so a setup
 * that never used colours stays exactly as it was.
 */
export function cleanColourFields(s: ColourFields): void {
  let filaments = Array.isArray(s.filaments) ? s.filaments.slice(0, MAX_SLOTS).map(cleanFilament) : undefined;
  const legacyColour = cleanHex(s.labelColour);
  const legacyPrice = cleanPrice(s.filamentPrice2);
  if (!filaments && (legacyColour || legacyPrice !== undefined)) {
    // Slot 1 stays the printer's own (exports leave it alone while colours are off).
    filaments = [{ ...DEFAULT_PALETTE[0] }, { ...DEFAULT_PALETTE[1] }];
  }
  if (filaments && filaments.length < 2 && (legacyColour || legacyPrice !== undefined)) filaments.push({ ...DEFAULT_PALETTE[1] });
  if (filaments) {
    if (legacyColour) filaments[1] = { ...filaments[1], colour: legacyColour };
    if (legacyPrice !== undefined && filaments[1].price === undefined) filaments[1] = { ...filaments[1], price: legacyPrice };
  }
  delete s.labelColour;
  delete s.filamentPrice2;
  if (filaments?.length) s.filaments = filaments;
  else delete s.filaments;

  const c = s.colours && typeof s.colours === 'object' ? s.colours : null;
  if (c) {
    const roles: Partial<Record<ColourRole, number>> = {};
    for (const [k, v] of Object.entries(c.roles ?? {})) if (isRole(k) && validSlot(v)) roles[k] = v;
    const out: ColourSetup = {};
    if (c.on === true) out.on = true;
    if (c.strategy && STRATEGIES.includes(c.strategy) && c.strategy !== 'part') out.strategy = c.strategy;
    if (Object.keys(roles).length) out.roles = roles;
    if (c.mix === true) out.mix = true;
    if (Object.keys(out).length) s.colours = out;
    else delete s.colours;
  } else delete s.colours;

  if (validSlot(s.filamentSlots)) s.filamentSlots = s.filamentSlots;
  else delete s.filamentSlots;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** The palette as edited, filled out with the defaults to `count` slots. */
export function paletteOf(s: Pick<PrintSetup, 'filaments'> & { labelColour?: string; filamentPrice2?: number }, count = 0): FilamentSlot[] {
  const own = s.filaments?.length ? s.filaments : null;
  const out: FilamentSlot[] = own ? own.map((f, i) => ({ ...cleanFilament(f, i) })) : [];
  // Setups that never went through cleanSetup (tests, older callers): the label filament is slot 2.
  if (!own) {
    const legacy = cleanHex(s.labelColour);
    const price = cleanPrice(s.filamentPrice2);
    if (legacy || price !== undefined) {
      out.push({ ...DEFAULT_PALETTE[0] }, { ...DEFAULT_PALETTE[1], ...(legacy ? { colour: legacy } : {}), ...(price !== undefined ? { price } : {}) });
    }
  }
  const n = Math.min(MAX_SLOTS, Math.max(count, out.length));
  for (let i = out.length; i < n; i++) out.push({ ...DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] });
  return out;
}

/** Slot `slot`'s filament (1-based), from the palette or the defaults. */
export function slotFilament(s: Pick<PrintSetup, 'filaments'>, slot: number): FilamentSlot {
  const n = Math.max(1, Math.min(MAX_SLOTS, Math.round(slot) || 1));
  return paletteOf(s, n)[n - 1];
}

/** "Black", or the colour when it has no name. */
export function slotName(s: Pick<PrintSetup, 'filaments'>, slot: number): string {
  const f = slotFilament(s, slot);
  return f.name ?? f.colour;
}

/** "Slot 2 · Black". */
export const slotLabel = (s: Pick<PrintSetup, 'filaments'>, slot: number) => `Slot ${slot} · ${slotName(s, slot)}`;

/** Price per kg of a slot. */
export function slotPrice(s: Pick<PrintSetup, 'filaments' | 'filamentPrice'> & { filamentPrice2?: number }, slot: number, fallback = 20): number {
  const base = s.filamentPrice ?? fallback;
  const own = s.filaments?.[slot - 1]?.price;
  if (own !== undefined) return own;
  // Setups that never went through cleanSetup: filament 2's old price.
  if (slot === 2 && !s.filaments?.length && s.filamentPrice2 !== undefined) return s.filamentPrice2;
  return base;
}

/** Density of a slot's material, g/cm³. */
export function slotDensity(s: Pick<PrintSetup, 'filaments'>, slot: number): number {
  const m = s.filaments?.[slot - 1]?.material ?? 'PLA';
  return MATERIALS.find((x) => x.id === m)?.density ?? MATERIALS[0].density;
}

/** Slots the printer feeds without a manual change (AMS slots, toolheads): the setting, or the printer's own. */
export function printerSlots(s: Pick<PrintSetup, 'filamentSlots'>, printerDefault: number | undefined): number {
  return s.filamentSlots ?? printerDefault ?? 1;
}

// ---------------------------------------------------------------------------
// Which slot prints what
// ---------------------------------------------------------------------------

/** The slot a role prints in, from the roles alone (no per-bin or per-drawer colour). */
export function roleSlot(s: Pick<PrintSetup, 'colours'>, role: ColourRole): number {
  const set = s.colours?.roles;
  for (let r: ColourRole | undefined = role, guard = 0; r && guard < 8; guard++) {
    const v = set?.[r];
    if (validSlot(v)) return v;
    const d = roleDef(r);
    if (!d.follows) return d.slot ?? 1;
    r = d.follows;
  }
  return 1;
}

/** Who set a part's colour over its roles: a bin's own colour, or its drawer's baseplate colour. */
export interface ColourOverride {
  /** The bin's (or its container's) own colour. */
  bin?: number;
  /** The drawer's baseplate colour. */
  plate?: number;
}

/** The slot a role of one part prints in: the part's own colour where it applies, else the role's. */
export function partRoleSlot(s: Pick<PrintSetup, 'colours'>, role: ColourRole, o?: ColourOverride | null): number {
  if (o?.bin && !INLAY_ROLES.has(role) && !PLATE_ROLES.has(role)) return o.bin;
  if (o?.plate && PLATE_ROLES.has(role)) return o.plate;
  return roleSlot(s, role);
}

/** Role of an overlay body (inlaid label text, shadow floors, QR codes…) that doesn't say: filament 2's is the label text. */
export function overlayRole(o: { role?: ColourRole; filament: number }): ColourRole {
  return o.role ?? (o.filament <= 1 ? 'binWalls' : 'labelText');
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Layers colour changes snap to: Bambu's 0.20 mm Standard (first layer 0.2 mm too). */
export const LAYERS = { first: 0.2, height: 0.2 } as const;

/** The layer boundary nearest `z` (0 stays 0; nothing snaps inside the first layer). */
export function snapZ(z: number, l: { first: number; height: number } = LAYERS): number {
  if (z <= l.first / 2) return 0;
  if (z <= l.first) return l.first;
  const k = Math.round((z - l.first) / l.height);
  return Math.round((l.first + k * l.height) * 1000) / 1000;
}

/** Top of the first layer printed at or above `z` (what slicers call the layer's print_z). */
export function layerTop(z: number, l: { first: number; height: number } = LAYERS): number {
  return z < l.first - 1e-6 ? l.first : Math.round((z + l.height) * 1000) / 1000;
}

/** A colour change: from `z` up, print in `slot`. */
export interface BandChange {
  z: number;
  slot: number;
}

/** A part's colours by height: from 0 up, each band until the next; equal neighbours merged. */
export type BandProfile = BandChange[];

/** Merge equal neighbours and drop changes at or above `top`. */
export function tidyBands(bands: BandChange[], top = Infinity): BandProfile {
  const out: BandChange[] = [];
  for (const b of [...bands].sort((x, y) => x.z - y.z)) {
    if (b.z >= top - 1e-6 && out.length) continue;
    if (out.length && out[out.length - 1].slot === b.slot) continue;
    if (out.length && Math.abs(out[out.length - 1].z - b.z) < 1e-6) out[out.length - 1] = b;
    else out.push(b);
  }
  if (out.length) out[0] = { ...out[0], z: 0 };
  return out;
}

/** Stable text for a profile, for grouping parts on plates ("1" or "3@0|1@4.8"). */
export const bandKey = (p: BandProfile) => (p.length === 1 ? String(p[0].slot) : p.map((b) => `${b.slot}@${b.z}`).join('|'));

/** The slot printing at height z. */
export function bandSlot(p: BandProfile, z: number): number {
  let slot = p[0]?.slot ?? 1;
  for (const b of p) if (b.z <= z + 1e-6) slot = b.slot;
  return slot;
}

// ---------------------------------------------------------------------------
// Mesh keys
// ---------------------------------------------------------------------------

/** Suffix of a mesh split into a volume per role ('feature'). */
export const SPLIT_SUFFIX = '#roles';
export const splitMeshKey = (key: string) => (key.endsWith(SPLIT_SUFFIX) ? key : key + SPLIT_SUFFIX);
/** The mesh a split mesh was cut from (any other key unchanged). */
export const baseMeshKey = (key: string) => (key.endsWith(SPLIT_SUFFIX) ? key.slice(0, -SPLIT_SUFFIX.length) : key);

// ---------------------------------------------------------------------------
// Colour maths (contrast, purge)
// ---------------------------------------------------------------------------

/** Relative luminance (0 black … 1 white) of #RRGGBB. */
export function luminance(hex: string): number {
  const h = cleanHex(hex) ?? '#808080';
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
