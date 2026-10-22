/**
 * How much an attachment holds: a rough, honest estimate of what its mounts
 * take, set against what it's meant to hold (AttachmentDef.load). Planning
 * warns when it's more (plan.ts), with what would fix it, and the
 * Attachments tab says both on the selected one.
 *
 * Everything here is printed plastic, the board too, and a part hangs by its
 * mounts alone, so they are what's estimated (not the part's own arms and
 * shelves). Two ways a load works on them:
 * - Down: every peg rests on the bottom of its slot, and the slot's edge
 *   carries its share. A clip's or a stud's underside rises at 45° behind the
 *   board's front, so only the front edge bears (about 1.5 mm of it); a hook's
 *   neck bears right through the board. A peg also shears where it leaves the
 *   part: across the layers on a part printed upright, along them on one
 *   printed on its side.
 * - Out: the load's centre is `at` out from the board, so it tips the part
 *   forward about its foot (the bottom of its back and the studs low on it
 *   press on the board), and whatever catches behind the board pulls back: a
 *   clip until its legs bend in far enough to let its barbs go (they bend in
 *   the plane of the layers: the strength of the legs' roots), a hook until
 *   its lip shears off, a bolt until its T-nut's bar bends or its head pulls
 *   through. Each pulls with its strength at its height above the foot, so a
 *   taller back holds more. Studs, and the plain pegs between a row's ends
 *   when only the ends have barbs, don't catch.
 * The two add up (a part can be near its limit both ways at once): it holds
 * a weight W while W / down + W × at / out ≤ 1.
 *
 * Allowable stresses are typical datasheet strengths for 0.2 mm layers (along
 * the layers; across them, the layers' adhesion), times the share a part keeps
 * under a load that never comes off (plastics creep, PLA most: it softens
 * from about 55 °C, a sunny window or a garage in summer), over a safety
 * factor of 3 for how prints vary and things get knocked and swung. Shear is
 * taken as half the tensile strength. It is an estimate: it's rounded down
 * and said as "about".
 */
import { BOLT, MOUNT, clipHeight, clipWidth, hookWidth, siteAt, studHeight, studWidth, tNut, type BoltSize } from './mount';
import { fitsAt, planExtras, slotKeys, type WallBoard, type WallPlacement } from './plan';
import { setLoadNote } from './place';
import type { AttachmentDef, AttachmentExtras, AttachmentLayout, AttachmentLoad, MountCtx, MountKind, PlacedAttachment, PrintPose } from './registry';

export type Material = NonNullable<PlacedAttachment['material']>;

/**
 * Filaments: tensile strength along the layers and across them (layer adhesion), N/mm², typical of datasheets and
 * tests at 0.2 mm layers; and the share of it a part keeps under a load that stays on for years.
 */
export const MATERIALS: Record<Material, { label: string; along: number; across: number; lasting: number }> = {
  pla: { label: 'PLA', along: 50, across: 25, lasting: 0.25 },
  petg: { label: 'PETG', along: 45, across: 30, lasting: 0.5 },
  asa: { label: 'ASA', along: 40, across: 26, lasting: 0.55 },
};

/** Unset: PLA, what most people print (and the weakest under a load that stays on). */
export const DEFAULT_MATERIAL: Material = 'pla';

/** Over the lasting strength: for how prints vary and things get knocked. */
export const SAFETY = 3;

/** Rough weights for what attachments are meant to hold (AttachmentDef.load), kg. */
export const KG = {
  /** A bin, box or pocket full of everyday things, a mm³: about 1 kg a litre (screws weigh more, sponges less). */
  full: 1e-6,
  /** A loaded shelf, a mm²: about 1 kg a square decimetre (a row of tins or spray cans). */
  shelf: 1e-4,
  /** A roll or a spool, a mm³ of its outside: about 0.5 kg a litre (foil, tape, filament: a 1 kg spool is about 2 litres). */
  roll: 5e-7,
} as const;

const G = 9.81;
/** How much of a slot's edge a clip or a stud bears on (its underside rises at 45° behind the board's front), mm. */
const LAND = 1.5;
/** Where a clip's split starts behind the board's front (mount.ts), mm. */
const SPLIT_FROM = 0.6;

/** Allowable stresses along the layers and across them, N/mm². */
function allowable(m: Material) {
  const s = MATERIALS[m];
  return { along: (s.along * s.lasting) / SAFETY, across: (s.across * s.lasting) / SAFETY };
}

/** What one mount takes, N: `down`, its share of the weight; `out`, pulling back against the part tipping out. */
export function mountStrength(kind: MountKind, ctx: MountCtx, material: Material, pose: PrintPose, barbed = true): { down: number; out: number } {
  const { along, across } = allowable(material);
  // On a part printed upright a peg stands up from the bed: where it leaves the part, a load down shears the layers apart.
  const root = pose === 'upright' ? across : along;
  if (kind === 'clip') {
    const W = clipWidth(ctx);
    const H = clipHeight(ctx);
    const leg = (W - Math.min(MOUNT.clip.split, W - 2.4)) / 2;
    const L = ctx.t + MOUNT.clip.gap - SPLIT_FROM;
    // Its two legs bend in until the barbs let go: each a cantilever H tall and `leg` thick, L long.
    return { down: Math.min(W * LAND * along, 0.5 * W * H * root), out: barbed ? (2 * along * H * leg * leg) / 6 / L : 0 };
  }
  if (kind === 'stud') {
    const W = studWidth(ctx);
    return { down: Math.min(W * LAND * along, 0.5 * W * studHeight(ctx) * root), out: 0 };
  }
  const W = hookWidth(ctx);
  const { neck, lip } = MOUNT.hook;
  // The lip shears off its neck (across the layers if it stood up as printed); the neck pulls along them.
  return { down: Math.min(W * ctx.t * along, 0.5 * W * neck * root), out: Math.min(0.5 * W * lip * root, W * neck * along) };
}

/** What a bolt pulls back with, N: its T-nut's bar bent across the slot (the skin in front of the nut's pocket), or its head pulling through. */
export function boltStrength(size: BoltSize, ctx: MountCtx, material: Material): number {
  const { along } = allowable(material);
  const n = tNut(size, ctx);
  const B = BOLT[size];
  const bar = (4 * along * n.h * MOUNT.tnut.skin ** 2) / 6 / (ctx.slotW + 2);
  return Math.min(bar, (along * Math.PI * (B.head ** 2 - B.hole ** 2)) / 4);
}

/** What an attachment's mounts hold, about, kg (unrounded), for a load centred `at` out from the board; and its mounts. */
export interface Holding {
  kg: number;
  clips: number;
  hooks: number;
  studs: number;
  bolts: number;
}

/** What a part's mounts (`layout` as planned, with its common options' `extras`) hold for a load centred `at` out from the board. */
export function holding(layout: AttachmentLayout, ctx: MountCtx, material: Material, at: number, extras?: AttachmentExtras): Holding {
  const clips = layout.mounts.filter((m) => m.kind === 'clip');
  const top = Math.max(...clips.map((m) => m.dj));
  const row = clips.filter((m) => m.dj === top).map((m) => m.di);
  let down = 0;
  let out = 0;
  for (const m of layout.mounts) {
    // Barbs at the ends only: the clips between are plain pegs (mount.ts mountSolids).
    const barbed = m.kind !== 'clip' || extras?.barbs !== 'ends' || (m.dj === top && (m.di === Math.min(...row) || m.di === Math.max(...row)));
    const s = mountStrength(m.kind, ctx, material, layout.pose, barbed);
    down += s.down;
    out += s.out * Math.max(0, siteAt(layout, m, ctx)[1]);
  }
  const bolts = extras?.bolts ?? [];
  for (const b of bolts) out += boltStrength(b.size, ctx, material) * Math.max(0, b.y);
  const n = (kind: MountKind) => layout.mounts.filter((m) => m.kind === kind).length;
  const w = 1 / (1 / down + Math.max(0, at) / out);
  return { kg: w / G, clips: n('clip'), hooks: n('hook'), studs: n('stud'), bolts: bolts.length };
}

/** An attachment's load, checked. */
export interface LoadCheck {
  material: Material;
  /** What its mounts hold, what it's meant to hold (0: anything), kg; how far out the load's centre is, mm. */
  holds: number;
  meant: number;
  at: number;
  mounts: Holding;
  /** Meant for more than its mounts hold. */
  over: boolean;
  /** What would make it hold it (when over), each enough alone. */
  fixes: string[];
}

/** What it's meant to hold: its kind's, or nothing in particular halfway out (at least 20 mm, a thing in front of a thin plate). */
export const loadOf = (def: Pick<AttachmentDef<object>, 'load'>, opts: object, layout: AttachmentLayout): AttachmentLoad =>
  def.load?.(opts, layout) ?? { kg: 0, at: Math.max(layout.depth / 2, 20) };

/**
 * An attachment's load check: what its mounts hold as planned (its common options too: a bolt pulls, barbs at the
 * ends leave plain pegs between), what it's meant to hold, and, when that's more, what would fix it: PETG, a bolt,
 * a taller back. `has`: whether the board has a slot at a point of its frame (for bolts).
 */
export function loadCheck(
  a: Pick<PlacedAttachment, 'material' | 'bolt' | 'barbs' | 'lock' | 'label'>,
  def: AttachmentDef<object>,
  opts: object,
  ctx: MountCtx,
  has?: (x: number, y: number) => boolean,
): LoadCheck {
  const material = a.material ?? DEFAULT_MATERIAL;
  const check = (o: object, mat: Material, bolt: PlacedAttachment['bolt']) => {
    const raw = def.layout(o, ctx);
    const e = planExtras({ ...a, bolt }, def, o, raw, ctx, has);
    const load = loadOf(def, o, raw);
    const mounts = holding(e.layout, ctx, mat, load.at, e.extras);
    return { load, mounts, h: raw.h, ok: load.kg <= mounts.kg };
  };
  const now = check(opts, material, a.bolt);
  const fixes: string[] = [];
  if (!now.ok) {
    if (material === 'pla' && check(opts, 'petg', a.bolt).ok) fixes.push('print it in PETG');
    const boltable = def.backPlate?.(opts, def.layout(opts, ctx), ctx) !== null;
    if (boltable && a.bolt !== 'm4') {
      if (!a.bolt && check(opts, material, 'm3').ok) fixes.push('turn on Bolt it on');
      else if (check(opts, material, 'm4').ok) fixes.push('bolt it on with M4');
    }
    // A taller back puts its top row further up: ten millimetres at a time, as far as its kind allows (its back's
    // height, or its height: where that's what it holds, the check sees it hold more too).
    const r = opts as Record<string, unknown>;
    for (const key of ['back', 'height'].filter((k) => typeof r[k] === 'number')) {
      let found = 0;
      for (let v = Math.ceil(now.h / 10) * 10 + 10, last = now.h; v <= now.h + 200 && !found; v += 10) {
        const t = check(def.sanitize({ ...r, [key]: v }), material, a.bolt);
        if (t.h <= last) break;
        last = t.h;
        if (t.ok) found = t.h;
      }
      if (found) {
        fixes.push(`make it ${Math.round(found)} mm tall`);
        break;
      }
    }
    if (!fixes.length) {
      // PETG and a bolt together; or nothing will do.
      const sizes = (a.bolt === 'm4' ? ['m4'] : ['m3', 'm4']) as BoltSize[];
      const both = material === 'pla' && boltable ? sizes.find((b) => check(opts, 'petg', b).ok) : undefined;
      fixes.push(both ? `print it in PETG and bolt it on${both === 'm4' ? ' with M4' : ''}` : 'hang less on it, or split it in two');
    }
  }
  return { material, holds: now.mounts.kg, meant: now.load.kg, at: now.load.at, mounts: now.mounts, over: !now.ok, fixes };
}

/** A weight, about: to 0.1 kg under 2 kg, 0.5 under 10, else whole; `down`: rounded down (what something holds). */
export function kg(v: number, down = false): string {
  const step = v < 2 ? 0.1 : v < 10 ? 0.5 : 1;
  const r = Math.max(0.1, (down ? Math.floor(v / step + 1e-6) : Math.round(v / step)) * step);
  return `${+r.toFixed(1)} kg`;
}

const count = (n: number, one: string) => (n ? [`${n} ${one}${n === 1 ? '' : 's'}`] : []);

/** Its mounts, in words: "2 clips, 2 studs, 1 bolt". */
export function mountWords(h: Holding): string {
  return [...count(h.clips, 'clip'), ...count(h.hooks, 'hook'), ...count(h.studs, 'stud'), ...count(h.bolts, 'bolt')].join(', ');
}

/** "a, b or c". */
const either = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}` : l.join(''));

/** The warning for planning, when it's meant for more than it holds. */
export function loadWarning(c: LoadCheck): string | null {
  if (!c.over) return null;
  return `meant for about ${kg(c.meant)}, but its mounts hold about ${kg(c.holds, true)} in ${MATERIALS[c.material].label}: ${either(c.fixes)}.`;
}

/** One line for the Attachments tab: what it holds and what it's meant for. */
export function loadLine(c: LoadCheck): string {
  const meant = c.meant > 0 ? `; it's meant for about ${kg(c.meant)}` : '';
  const fix = c.over ? ` Too much: ${either(c.fixes)}.` : '';
  return `Its mounts hold about ${kg(c.holds, true)} in ${MATERIALS[c.material].label} (${mountWords(c.mounts)})${meant}.${fix}`;
}

/** Whether the board has a slot at a point of a placed attachment's frame (where planning puts its bolts); undefined where it doesn't fit. */
export function slotsUnder(p: Pick<WallPlacement, 'x' | 'y' | 'ok' | 'layout'>, board: Pick<WallBoard, 'slots' | 'ctx'>) {
  if (!p.ok) return undefined;
  const keys = slotKeys(board.slots);
  const ox = p.x - p.layout.anchor[0];
  const oy = p.y - p.layout.anchor[1];
  const one = { mounts: [{ di: 0, dj: 0, kind: 'stud' as const }] };
  return (x: number, y: number) => fitsAt(keys, one, board.ctx, ox + x, oy + y);
}

setLoadNote((a, def, opts, ctx, has) => loadWarning(loadCheck(a, def, opts, ctx, has)));
