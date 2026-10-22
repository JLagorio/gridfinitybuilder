/**
 * Wall attachments: what hangs on a Skådis-pattern board (geometry/skadis.ts):
 * hooks, bins, cups, shelves, Gridfinity shelves, rails and containers, tool
 * holders, … Each kind is three files in ./kinds:
 * - `<kind>.ts`: an AttachmentDef registered here (./index.ts imports them):
 *   plain planning, its options, size on the wall and mounts. It is on the
 *   first screen (planning a print needs it), so it stays small.
 * - `<kind>.ui.ts`: its name, description and form (AttachmentUi, ./ui.ts),
 *   loaded with the Attachments tab.
 * - `<kind>.geom.ts`: its geometry (./build.ts), loaded with the mesh builders.
 *
 * Coordinates are the wall's, seen from the front: x to the right, y up, z out
 * of the board's front face (behind the board is z < 0). A part's own frame has
 * the bottom-left of its front view at (0, 0) and its back on the board (z = 0).
 */
import type { Vec2 } from '../geometry/kernel';
import type { SlotFit } from '../geometry/skadis';

/** An attachment placed on a board (DrawerInput.attachments). */
export interface PlacedAttachment {
  id: string;
  /** Its kind (AttachmentDef.type). */
  type: string;
  /** Where its anchor mount's slot is, wall coordinates (mm, the slot's centre). Planning snaps it to a slot. */
  x: number;
  y: number;
  /** The kind's own options (AttachmentDef.sanitize cleans them). */
  opts: Record<string, unknown>;
  /** A name of its own ("Pliers"); unset: the kind's summary. */
  name?: string;
  /** Multi-colour: its own filament slot (1-based); unset: the role's. */
  colour?: number;
  // Options every kind has (plan.ts plans them, WallPanel edits them above the kind's own):
  /** Lock keys: a printed key pushed into the slot above each hook, so the part can't lift off (parts with hooks). */
  lock?: boolean;
  /** Bolt it on: a countersunk screw through its back and a slot into a printed T-nut behind the board. */
  bolt?: 'm3' | 'm4';
  /** Text on its label face (kinds with AttachmentDef.labelFace). */
  label?: string;
  /**
   * How the label's text is made: cut in (unset), raised on the face, or inlaid (cut in and filled flush). Raised and
   * inlaid text is a body of its own, in the board text's colour (colours.ts 'wallText'): inlaid text prints in filament
   * 2 with multi-colour off, raised text with the part.
   */
  labelStyle?: 'raised' | 'inlaid';
  /** Barbs on the clips at the ends of its top row only (the rest plain pegs): easier to push on and off. */
  barbs?: 'ends';
}

/** The board an attachment is for: its slots and thickness. */
export interface MountCtx {
  /** Board thickness, mm. */
  t: number;
  /** Slot width and length, mm. */
  slotW: number;
  slotL: number;
  /** Lattice step, mm (slots are 2 steps apart in a row or a column). */
  pitch: number;
  fit: SlotFit;
  /** Room behind the board (its standoffs), mm; 0 when it lies on a wall. */
  behind: number;
}

/**
 * How a mount holds on:
 * - 'clip': a split peg whose barbs spring out behind the board (parts printed upright);
 * - 'stud': a plain peg in a lower slot, against tilting (no catch);
 * - 'hook': a peg with a lip that drops behind the board (parts printed on their side).
 */
export type MountKind = 'clip' | 'stud' | 'hook';

/** A mount, by lattice steps from the anchor (the first mount): `di` to the right, `dj` up. */
export interface MountSite {
  di: number;
  dj: number;
  kind: MountKind;
}

/** How a part prints: 'upright' as it hangs (its back stands up from the bed), 'side' on its left side (its profile flat on the bed). */
export type PrintPose = 'upright' | 'side';

/** An attachment's size and mounts, from its options. */
export interface AttachmentLayout {
  /** Front view size on the wall, mm. */
  w: number;
  h: number;
  /** How far it stands out from the board, mm. */
  depth: number;
  /** The anchor mount's slot centre in the part's frame (from its front view's bottom-left), mm. */
  anchor: Vec2;
  mounts: MountSite[];
  pose: PrintPose;
}

/** One field of the generic attachment form (components/WallPanel.tsx). */
export type AttachmentField =
  | { key: string; label: string; kind: 'length'; min: number; max: number; hint?: string; allowEmpty?: boolean; when?: (o: never) => boolean }
  | { key: string; label: string; kind: 'number'; min: number; max: number; step?: number; suffix?: string; hint?: string; when?: (o: never) => boolean }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string; title?: string }[]; hint?: string; when?: (o: never) => boolean }
  | { key: string; label: string; kind: 'toggle'; hint?: string; when?: (o: never) => boolean }
  | { key: string; label: string; kind: 'text'; placeholder?: string; hint?: string; when?: (o: never) => boolean }
  /**
   * Sizes of a known thing in one pick ("Vallejo dropper bottle"): each preset sets several options at
   * once. It shows the preset the options match, or "Custom" once one is edited; `key` only names the field.
   */
  | { key: string; label: string; kind: 'preset'; presets: AttachmentPreset[]; hint?: string; when?: (o: never) => boolean }
  /** A model file (STL, 3MF, OBJ) to hang (kinds/model.ts ModelRef): "Choose a model…", its name and size (components/ModelField.tsx). */
  | { key: string; label: string; kind: 'model'; hint?: string; when?: (o: never) => boolean };

/** One choice of a 'preset' field: the options it sets. */
export interface AttachmentPreset {
  value: string;
  label: string;
  title?: string;
  set: Record<string, unknown>;
}

/** An extra printed part of an attachment (dividers, a drawer, a diffuser, …). */
export interface AttachmentPart {
  /** Unique within the attachment. */
  key: string;
  name: string;
  /** Data for the kind's part builder (structured-cloneable). */
  spec: unknown;
  /** Footprint and height as printed. */
  w: number;
  d: number;
  h: number;
  /**
   * Where it sits when it's in use, to show it in place in the 3D view (a container on its rail, a lid on its
   * channel): `turn` (degrees about x, then y, then z, as Manifold's rotate()) stands the part as printed the way it
   * sits, and `at` is where its min corner then lands in the attachment's own frame. Unset: it shows on the plates only.
   */
  place?: { at: [number, number, number]; turn: [number, number, number] };
}

/**
 * A flat face of a part for a label, in its frame: 'front' a face looking out
 * from the board at `z`, the text box x..x + w, y..y + h; 'up' a face looking
 * up at height `y`, the text box x..x + w across and z..z + h out from the
 * board (the text reads from the front). `depth`: how deep text may go (0.6 mm
 * unless the wall behind is thin).
 */
export interface LabelFace {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  normal: 'front' | 'up';
  depth?: number;
  /** False for a face that isn't flat (it leans): text can go in, not stand out on it. */
  flat?: false;
}

/**
 * Where a part's back is solid `z` thick with nothing in front of it, in its
 * frame: a screw can go in there from the front (x0..x1 across, y0..y1 up).
 */
export interface BackPlate {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
}

/** A bolt through a part's back and a slot: its centre (the slot's), the head's seat (flush with what's in front, on a boss when the back is thinner) and the screw. */
export interface BoltSite {
  x: number;
  y: number;
  size: 'm3' | 'm4';
  /** Where the countersunk head sits, out from the board, mm. */
  seat: number;
  /** A round boss out to the seat (the back is thinner there). */
  boss: boolean;
  /** Screw length (countersunk: overall), mm. */
  screw: number;
}

/** What the common options add to a part's mesh (planned from PlacedAttachment's lock, bolt, label and barbs). */
export interface AttachmentExtras {
  barbs?: 'ends';
  bolts?: BoltSite[];
  label?: { text: string; face: LabelFace; style?: 'raised' | 'inlaid' };
}

/** A line of the bill of materials. */
export interface AttachmentHardware {
  item: string;
  count: number;
  note?: string;
}

export type AttachmentGroup =
  | 'hooks'
  | 'storage'
  | 'gridfinity'
  | 'containers'
  | 'shelves'
  | 'tools'
  | 'devices'
  | 'board'
  | 'other'
  | 'power'
  | 'hobby'
  | 'kitchen'
  | 'display'
  | 'adapters';

export interface AttachmentDef<O extends object = Record<string, unknown>> {
  type: string;
  defaults: O;
  /** Clean saved or edited options (`raw` may be anything). */
  sanitize(raw: unknown): O;
  /** Size on the wall, mounts and print pose. */
  layout(o: O, ctx: MountCtx): AttachmentLayout;
  /** Short text for its name ("J hook 50 mm"). */
  summary(o: O): string;
  /** Planning warnings. */
  notes?(o: O, ctx: MountCtx): string[];
  /** Extra printed parts. */
  parts?(o: O, ctx: MountCtx): AttachmentPart[];
  /** Hardware to buy. */
  hardware?(o: O): AttachmentHardware[];
  /** Where a label goes (the Label option shows only when this gives a face); unset: no label. */
  labelFace?(o: O, layout: AttachmentLayout): LabelFace | null;
  /**
   * Where its back is solid with nothing in front, for bolts (one region, or several), on the board `ctx`; null: no
   * bolts. Unset: next to its top row's mounts, on a boss as thick as the screw head needs (plan.ts).
   */
  backPlate?(o: O, layout: AttachmentLayout, ctx: MountCtx): BackPlate | BackPlate[] | null;
  /**
   * Whether its body has inlays that print in filament 2 with multi-colour off (inlaid text, two-colour pocket
   * floors: the builder returns them, build.ts AttachmentBody), for planning; unset: none.
   */
  inlaid?(o: O): boolean;
}

const DEFS = new Map<string, AttachmentDef<object>>();

export function registerAttachment<O extends object>(def: AttachmentDef<O>): void {
  DEFS.set(def.type, def as unknown as AttachmentDef<object>);
}

export function attachmentDef(type: string): AttachmentDef<object> | null {
  return DEFS.get(type) ?? null;
}

/** Every registered kind, in the order registered. */
export function attachmentDefs(): AttachmentDef<object>[] {
  return [...DEFS.values()];
}

// ---------------------------------------------------------------------------
// Helpers for kinds' sanitize()
// ---------------------------------------------------------------------------

export const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
export const int = (v: unknown, lo: number, hi: number, dflt: number) => Math.round(num(v, lo, hi, dflt));
export const pick = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);
export const bool = (v: unknown, dflt: boolean) => (v === undefined ? dflt : !!v);
export const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.slice(0, max) : '');
export const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
