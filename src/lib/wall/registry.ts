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
  | { key: string; label: string; kind: 'text'; placeholder?: string; hint?: string; when?: (o: never) => boolean };

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

/** A line of the bill of materials. */
export interface AttachmentHardware {
  item: string;
  count: number;
  note?: string;
}

export type AttachmentGroup = 'hooks' | 'storage' | 'gridfinity' | 'containers' | 'shelves' | 'tools' | 'devices' | 'board' | 'other';

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
