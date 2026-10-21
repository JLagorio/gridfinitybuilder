import { partBands, specRole, splitsByFeature } from './geometry/colourRegions';
import {
  INLAY_ROLES,
  bandKey,
  cleanSlot,
  partRoleSlot,
  slotName,
  splitMeshKey,
  strategyOf,
  tidyBands,
  type BandProfile,
  type ColourOverride,
  type ColourRole,
  type ColourSetupFields,
} from './colours';
import type { JobPart, MeshSpec, NamedDrawer } from './project';

/**
 * Multi-colour planning (colours.ts): which role and colour each part of a
 * job has, what may share a plate, and the meshes 'feature' cuts by role.
 * planParts (project.ts) calls these; exports and estimates read the tags.
 */

/** Parts a placed bin brings (its key is `<slot>:<binId>` or `<slot>:<binId>:<n>`). */
const BIN_KINDS: ReadonlySet<JobPart['kind']> = new Set(['bin', 'lid', 'divider', 'label', 'tray']);

/** The id of the placed bin a part belongs to, from its key; null for the drawer's own parts. */
export function ownerBinId(key: string, part: Pick<JobPart, 'kind' | 'drawer' | 'bin'>, multi: boolean): string | null {
  if (part.bin) return part.bin;
  if (!BIN_KINDS.has(part.kind)) return null;
  const local = multi && part.drawer ? key.slice(part.drawer.length + 1) : key;
  const m = /^[A-Za-z][\w-]*:([^:/]+)(?::\d+)?$/.exec(local);
  return m ? m[1] : null;
}

/**
 * Tag every part with its role (from its mesh) and its own colour: its bin's
 * (`opts.colour`) or its drawer's baseplate colour (`baseplate.colour`).
 */
export function tagColours(parts: Record<string, JobPart>, meshes: Record<string, MeshSpec>, drawers: NamedDrawer[], multi: boolean): void {
  const byId = new Map(drawers.map((d) => [d.id, d]));
  const bins = new Map(drawers.map((d) => [d.id, new Map(d.bins.map((b) => [b.id, b]))]));
  for (const [key, part] of Object.entries(parts)) {
    part.role = specRole(meshes[part.meshKey]);
    const d = byId.get(part.drawer ?? '') ?? (drawers.length === 1 ? drawers[0] : undefined);
    const o: ColourOverride = {};
    const plate = cleanSlot(d?.baseplate.colour);
    if (plate) o.plate = plate;
    const binId = ownerBinId(key, part, multi);
    const bin = binId ? bins.get(d?.id ?? '')?.get(binId) : undefined;
    const own = cleanSlot(bin?.opts.colour);
    if (own) o.bin = own;
    if (o.plate || o.bin) part.colour = o;
    else delete part.colour;
  }
}

/** 'feature': point the parts that cut by role at their split mesh (geometry/colourRegions.ts). */
export function useSplitMeshes(setup: ColourSetupFields, parts: Record<string, JobPart>, meshes: Record<string, MeshSpec>): void {
  if (strategyOf(setup) !== 'feature') return;
  for (const part of Object.values(parts)) {
    const spec = meshes[part.meshKey];
    if (!spec || spec.kind === 'split' || !splitsByFeature(spec)) continue;
    const key = splitMeshKey(part.meshKey);
    meshes[key] ??= { kind: 'split', key, base: spec };
    part.meshKey = key;
  }
}

/** The slot a part's main body prints in ('part'), with its own colour. */
export function partSlot(setup: ColourSetupFields, part: Pick<JobPart, 'role' | 'colour'>, spec?: MeshSpec): number {
  return partRoleSlot(setup, part.role ?? specRole(spec), part.colour);
}

/** A part's colours by height ('height'): its bands' slots (one band for one-role parts), up to its top. */
export function partProfile(setup: ColourSetupFields, part: Pick<JobPart, 'role' | 'colour' | 'h'>, spec: MeshSpec | undefined): BandProfile {
  const bands = partBands(spec);
  if (!bands) return [{ z: 0, slot: partSlot(setup, part, spec) }];
  return tidyBands(
    bands.map((b) => ({ z: b.z, slot: partRoleSlot(setup, b.role, part.colour) })),
    part.h,
  );
}

/**
 * What a part needs from the plate it's on, as a key: parts with different
 * keys get different plates. '' when anything goes (off, 'feature', or
 * 'part' with mixing allowed).
 */
export function plateGroup(setup: ColourSetupFields, part: Pick<JobPart, 'role' | 'colour' | 'h'>, spec: MeshSpec | undefined): string {
  const st = strategyOf(setup);
  if (st === 'part' && !setup.colours?.mix) return String(partSlot(setup, part, spec));
  if (st === 'height') return bandKey(partProfile(setup, part, spec));
  return '';
}

/**
 * The slot each body of a part prints in: the main body, then the overlays.
 * `roles` are the bodies' own roles where the mesh says (null: the part's).
 * Off: the main body in filament 1, overlays in filament 2 (`legacy`, their
 * own filament numbers). 'part': the part's colour, label text and shadow
 * floors keep theirs. 'feature': each body its role's. 'height': every body
 * in the plate's first band (`base`); the changes come by layer.
 */
export function bodySlots(
  setup: ColourSetupFields,
  part: Pick<JobPart, 'role' | 'colour'>,
  spec: MeshSpec | undefined,
  roles: (ColourRole | null)[],
  legacy: number[] = roles.map((_, i) => (i ? 2 : 1)),
  base?: number,
): number[] {
  const st = strategyOf(setup);
  if (!st) return legacy;
  if (st === 'height') return roles.map(() => base ?? partSlot(setup, part, spec));
  const main = partSlot(setup, part, spec);
  return roles.map((r, i) => {
    if (st === 'part') return i > 0 && r && INLAY_ROLES.has(r) ? partRoleSlot(setup, r, part.colour) : main;
    return r ? partRoleSlot(setup, r, part.colour) : main;
  });
}

/** plateGroup for a part of one role that isn't tagged yet (connector keys, case parts, while planning). */
export function soloGroup(setup: ColourSetupFields, role: ColourRole, colour?: ColourOverride): string {
  const st = strategyOf(setup);
  if ((st === 'part' && !setup.colours?.mix) || st === 'height') return String(partRoleSlot(setup, role, colour));
  return '';
}

/** "Black" or "Black / Red" for a group key, to name its plates. */
export function groupName(setup: ColourSetupFields, key: string): string {
  if (!key) return '';
  const slots = key.split('|').map((b) => Number(b.split('@')[0]));
  return slots.map((s) => slotName(setup, s)).join(' / ');
}

/**
 * Sort items into plate groups ('height': a short one-colour part joins a
 * group whose first colour is its own and changes above its top). Group
 * order follows the items' order.
 */
export function plateGroups<T extends { key: string }>(setup: ColourSetupFields, items: T[], groupOf: (it: T) => string, heightOf: (it: T) => number): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = groupOf(it);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  if (strategyOf(setup) === 'height') {
    const multi = [...groups.keys()].filter((k) => k.includes('|'));
    for (const [k, list] of [...groups]) {
      if (k.includes('|')) continue;
      const keep: T[] = [];
      for (const it of list) {
        const into = multi.find((m) => m.startsWith(`${k}@`) && Number(m.split('|')[1].split('@')[1]) >= heightOf(it) - 1e-6);
        if (into) groups.get(into)!.push(it);
        else keep.push(it);
      }
      if (keep.length) groups.set(k, keep);
      else groups.delete(k);
    }
  }
  return [...groups];
}
