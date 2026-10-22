/**
 * Build your own: a back plate in whole lattice steps with a side profile of your own drawing in front of it,
 * extruded across its width: most pegboard parts are just that (hooks, ledges, trays, cradles, brackets). It
 * starts from a preset (custom/presets.ts) and its points are dragged in the editor (components/ProfileEditor.tsx);
 * holes, slots, hex sockets, finger notches and text go on its flat faces, one or a row or a grid of them; a front
 * lip, end walls or gussets and dividers can be added. The profile's rules (custom/profile.ts) keep whatever is
 * drawn on the board and printable without supports:
 * - upright (as it hangs: clips, studs) when every edge facing down is 45° or steeper or on the bed; otherwise on
 *   its side (the profile flat on the bed: a hook at its left, studs below), where any profile prints. 'auto'
 *   picks; you can pick yourself, and a profile that can't print upright is noted (its edges red in the editor);
 * - holes that lie on their side as printed get a teardrop top.
 */
import type { Vec2 } from '../../geometry/kernel';
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { int, num, obj, pick, registerAttachment, str, type AttachmentLayout, type MountCtx } from '../registry';
import { KG } from '../load';
import { CUSTOM, FEATURE_KINDS, cleanProfile, overhangs, plateFree, profileFaces, reachOf, thinnest, topOf, type Feature } from '../custom/profile';
import { PRESETS, PRESET_KEYS, presetOptions, type PresetKey } from '../custom/presets';
import { customRibs, featureSpots } from '../custom/part';
import { leverNotes } from './shelf';

export interface CustomOptions {
  /** The preset it started from (its name). */
  preset: PresetKey;
  /** Across and up the board, mm: the part takes the nearest whole number of lattice steps. */
  width: number;
  height: number;
  /** Its side profile: (z out from the board, y up), mm, anticlockwise (custom/profile.ts). */
  profile: Vec2[];
  /** How it prints: 'auto' upright when it can. */
  pose: 'auto' | 'upright' | 'side';
  features: Feature[];
  /** Front lip height above the profile's front, mm (0: none). */
  lip: number;
  ends: 'none' | 'walls' | 'gussets';
  dividers: number;
}

export const CUSTOM_DEFAULTS: CustomOptions = presetOptions('ledge');

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Features from saved data, on the profile's `edges` edges (or the plate). */
function cleanFeatures(raw: unknown, edges: number, flipped: boolean): Feature[] {
  if (!Array.isArray(raw)) return [];
  const out: Feature[] = [];
  for (const q of raw.slice(0, CUSTOM.features)) {
    const r = obj(q);
    let f = Math.round(Number(r.f));
    if (!Number.isFinite(f) || f < -1 || f >= edges) continue;
    // Its edge, the other way round.
    if (flipped && f >= 0) f = f === edges - 1 ? f : edges - 2 - f;
    const k = pick(r.k, FEATURE_KINDS, 'round');
    out.push({
      f,
      k,
      a: r1(num(r.a, 1, 100, 6)),
      b: r1(num(r.b, 1, 200, 6)),
      d: r1(num(r.d, 0, 60, 0)),
      u: r1(num(r.u, -400, 400, 0)),
      v: r1(num(r.v, -400, 400, 0)),
      n: int(r.n, 1, 40, 1),
      m: int(r.m, 1, 10, 1),
      su: r1(num(r.su, 1, 200, 10)),
      sv: r1(num(r.sv, 1, 200, 10)),
      ...(k === 'text' ? { t: str(r.t, 24) } : {}),
    });
  }
  return out;
}

/** Clean options (anything in): a profile that isn't usable gives way to its preset's. */
export function cleanCustom(raw: unknown): CustomOptions {
  const r = obj(raw);
  const d = CUSTOM_DEFAULTS;
  const preset = pick(r.preset, PRESET_KEYS, d.preset);
  const clean = cleanProfile(r.profile);
  const profile = clean?.pts ?? presetOptions(preset).profile;
  return {
    preset,
    width: r1(num(r.width, 20, 300, d.width)),
    height: r1(num(r.height, 20, CUSTOM.tall, d.height)),
    profile,
    pose: pick(r.pose, ['auto', 'upright', 'side'] as const, d.pose),
    // A profile that lost points has other edges: its features can't be placed.
    features: !clean ? presetOptions(preset).features : clean.kept ? cleanFeatures(r.features, profile.length, clean.flipped) : [],
    lip: r1(num(r.lip, 0, 60, d.lip)),
    ends: pick(r.ends, ['none', 'walls', 'gussets'] as const, d.ends),
    dividers: int(r.dividers, 0, 20, d.dividers),
  };
}

/** How far its profile lies on the bed printed upright, in front of the plate, mm. */
function bedRun(p: readonly Vec2[]): number {
  let run = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    if (Math.max(a[1], b[1]) <= 0.05) run += Math.abs(Math.max(CUSTOM.plate, b[0]) - Math.max(CUSTOM.plate, a[0]));
  }
  return run;
}

/**
 * Its size on the wall (whole lattice steps, as tall as its profile and its mounts need) and how it prints: as
 * picked, or ('auto') upright when nothing in its profile needs support that way and it stands steady on the bed
 * (a first layer of (h / 5)² mm² or more, as the print check asks), else on its side.
 */
export function customSize(o: CustomOptions, ctx: MountCtx): { w: number; h: number; pose: 'upright' | 'side' } {
  const P = ctx.pitch;
  const steps = (v: number) => Math.ceil(v / P - 1e-6) * P;
  const w = Math.max(1, Math.round(o.width / P)) * P;
  const tall = (least: number) => Math.max(Math.max(1, Math.round(o.height / P)) * P, steps(least), steps(topOf(o.profile)));
  const up = tall(minHeight(ctx));
  const steady = w * (CUSTOM.plate + bedRun(o.profile)) >= (up / 5) ** 2;
  const pose = o.pose !== 'auto' ? o.pose : !overhangs(o.profile).length && steady ? 'upright' : 'side';
  if (pose === 'upright') return { w, h: up, pose };
  // On its side: a hook and a stud two steps under it (one hook alone would let it turn).
  const hook = mountBox('hook', [0, 0], ctx);
  const stud = mountBox('stud', [0, -2 * P], ctx);
  return { w, h: tall(hook.y1 - stud.y0 + 2 * MOUNT.margin), pose };
}

export function customLayout(o: CustomOptions, ctx: MountCtx): AttachmentLayout {
  const { w, h, pose } = customSize(o, ctx);
  const m = pose === 'upright' ? backMounts(w, h, ctx, { rows: 3 }) : backMounts(w, h, ctx, { kind: 'hook', rows: 3, columns: 1, left: true });
  return { w, h, depth: reachOf(o.profile), anchor: m.anchor, mounts: m.mounts, pose };
}

registerAttachment<CustomOptions>({
  type: 'custom',
  defaults: CUSTOM_DEFAULTS,
  sanitize: cleanCustom,
  layout: customLayout,
  summary: (o) => `Custom ${PRESETS[o.preset].label.replace(/^.(?=[a-z])/, (c) => c.toLowerCase())} ${Math.round(reachOf(o.profile))} mm`,
  notes(o, ctx) {
    const l = customLayout(o, ctx);
    const out = leverNotes(l.depth, l.h);
    const down = overhangs(o.profile).length;
    if (o.pose === 'upright' && down)
      out.push(
        `Printed upright, ${down === 1 ? 'an edge' : `${down} edges`} underneath ${down === 1 ? 'is' : 'are'} flatter than 45° (red in the editor): print it on its side, or make them steeper.`,
      );
    if (l.pose === 'side' && (o.ends === 'walls' || o.dividers))
      out.push('On its side, its end walls and dividers print as bridges over the open profile: print it upright if you can.');
    const thin = thinnest(o.profile, l.h);
    if (thin && thin.t < CUSTOM.wall - 0.05) out.push(`A wall is only ${r1(thin.t)} mm thick: make it ${CUSTOM.wall} mm or more.`);
    const left = featureSpots(o, l, ctx).filter((s) => !s.ok).length;
    if (left)
      out.push(
        `${left === 1 ? 'A hole doesn’t' : `${left} holes don’t`} fit on ${left === 1 ? 'its' : 'their'} face (or sit over a mount or a wall): left out.`,
      );
    return out;
  },
  labelFace(o, l) {
    // The front-most face looking out (a lip, a ledge's edge) 5.2 mm tall or more, else the plate's front where it's
    // free (clear of the end walls or the gussets at its ends; not with dividers or gussets between the ends).
    const e = o.ends === 'walls' ? CUSTOM.end + 1 : 1;
    const faces = profileFaces(o.profile, l.h).filter((f) => f.id >= 0 && f.n[0] > 0.99 && f.len >= 5.2);
    const f = faces.sort((a, b) => b.a[0] - a.a[0] || b.len - a.len)[0];
    if (f) return { x: e, y: Math.min(f.a[1], f.b[1]) + 0.6, w: l.w - 2 * e, h: f.len - 1.2, z: f.a[0], normal: 'front' };
    const free = plateFree(o.profile, l.h);
    const x = o.ends === 'gussets' ? CUSTOM.gusset + 1 : e;
    return free && free[1] - free[0] >= 8 && !o.dividers && customRibs(o, l.w).gussets.length <= 2 && l.w - 2 * x > 10
      ? { x, y: free[0] + 1, w: l.w - 2 * x, h: Math.min(14, free[1] - free[0] - 2), z: CUSTOM.plate, normal: 'front' }
      : null;
  },
  backPlate(o, l) {
    // The plate's free front, between the end walls, gussets and dividers.
    const free = plateFree(o.profile, l.h);
    if (!free) return null;
    const r = customRibs(o, l.w);
    const xs = [0, ...[...r.ends, ...r.gussets, ...r.dividers].sort((a, b) => a[0] - b[0]).flatMap(([a, b]) => [a - 0.5, b + 0.5]), l.w];
    return Array.from({ length: xs.length / 2 }, (_, k) => ({ x0: xs[2 * k], x1: xs[2 * k + 1], y0: free[0], y1: free[1], z: CUSTOM.plate })).filter(
      (q) => q.x1 - q.x0 > 4,
    );
  },
  // What its upward faces carry, as a shelf does, centred where they are.
  load(o, l) {
    let run = 0;
    let at = 0;
    const p = o.profile;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const z0 = Math.max(CUSTOM.plate, b[0]);
      const z1 = Math.max(CUSTOM.plate, a[0]);
      if (z1 - z0 > 0) {
        run += z1 - z0;
        at += ((z0 + z1) / 2) * (z1 - z0);
      }
    }
    return { kg: l.w * run * KG.shelf, at: run ? at / run : l.depth / 2 };
  },
});
