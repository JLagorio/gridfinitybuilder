/**
 * Planning attachments on a board: each one snapped to the slots its mounts
 * need, checked, and turned into parts and meshes for the print job and items
 * for the drawer view (project.ts planParts calls planWallParts for a board).
 *
 * Every kind also takes the common options (PlacedAttachment's lock, bolt,
 * label and barbs), planned here from its layout, its label face and its back
 * plate (AttachmentDef.labelFace, .backPlate): what they add to its mesh
 * (AttachmentExtras) and the extra parts they bring (lock keys, T-nuts).
 */
import type { Vec2 } from '../geometry/kernel';
import type { SkadisOptions, SkadisPlan } from '../geometry/skadis';
import { boardSlots, plannedSkadis, rimWidth, skadisBehind, skadisGap, tileOutlines } from '../geometry/skadis';
import { BOLT, boltSeat, lockKey, mountBox, partBounds, printedSize, siteAt, tNut, viewTurn, type BoltSize } from './mount';
import {
  attachmentDef,
  type AttachmentDef,
  type AttachmentExtras,
  type AttachmentHardware,
  type AttachmentLayout,
  type AttachmentPart,
  type BoltSite,
  type MountCtx,
  type MountKind,
  type PlacedAttachment,
} from './index';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const keyOf = (x: number, y: number) => `${r2(x)},${r2(y)}`;

/** A board as attachments see it (wall coordinates). */
export interface WallBoard {
  /** The space, mm. */
  W: number;
  H: number;
  /** Every usable slot's centre. */
  slots: Vec2[];
  ctx: MountCtx;
  /** Tile outlines, for drawing. */
  outlines: Vec2[][];
  /** Height of the board's front in the drawer view (it lies face up on its standoffs). */
  front: number;
  /** A frame's rim round the edge: how wide, mm (attachments keep off it). */
  rim?: number;
  /** Hexagon tiles: each has slots of its own, not in line with its neighbours'. */
  hex?: boolean;
}

export function wallBoard(plan: SkadisPlan, raw: SkadisOptions): WallBoard {
  const o = plannedSkadis(raw);
  const behind = skadisBehind(o);
  return {
    W: o.width,
    H: o.height,
    slots: boardSlots(plan, o),
    ctx: { t: o.thickness, slotW: o.slotW, slotL: o.slotL, pitch: o.pitch, fit: o.fit, behind },
    outlines: tileOutlines(plan, o),
    front: skadisGap(o) + o.thickness,
    ...(o.frame !== 'none' ? { rim: rimWidth(o) } : {}),
    ...(plan.shape === 'hex' ? { hex: true } : {}),
  };
}

/** An attachment where it ended up. */
export interface WallPlacement {
  id: string;
  type: string;
  name: string;
  /** Its anchor slot, snapped (wall coordinates). */
  x: number;
  y: number;
  /** Its front view on the wall, and how far it stands out. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
  /** Every mount on a slot of the board. */
  ok: boolean;
  /** Its mounts, wall coordinates. */
  mounts: { x: number; y: number; kind: MountKind }[];
  layout: AttachmentLayout;
  opts: object;
  /** What its common options add to its mesh (bolts, label, barbs). */
  extras?: AttachmentExtras;
  /** A lock key over each of its hooks. */
  lock?: boolean;
}

// ---------------------------------------------------------------------------
// Common options: lock keys, bolts, labels, barbs
// ---------------------------------------------------------------------------

/** Whether parts with hooks get lock keys when their `lock` is unset: yes, parts popping off is the most common complaint about printed pegboard parts. */
export const LOCK_DEFAULT = true;

/** Whether a part takes lock keys: it has hooks, each flush with its top (so the slot over the neck is open) with room over it for a key. */
export function canLock(layout: AttachmentLayout, ctx: MountCtx): boolean {
  const hooks = layout.mounts.filter((m) => m.kind === 'hook');
  return (
    hooks.length > 0 &&
    hooks.every((m) => {
      const at = siteAt(layout, m, ctx);
      const k = lockKey(at, ctx);
      return mountBox('hook', at, ctx).y1 >= layout.h - 0.01 && k.y1 - k.y0 >= 2;
    })
  );
}

/** Countersunk screw lengths to pick from (overall), mm. */
const SCREWS = [8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60];

/**
 * Where a part's bolts go: lattice slots behind its back plate (AttachmentDef.backPlate) clear of its mounts, the
 * head flush with the plate's front; failing a free slot, a stud's (the bolt holds better than the stud). A kind
 * that doesn't say gets them one step down and across from a top-row mount (its back is solid there), on a boss as
 * thick as the head needs. One bolt, high and near the middle; two, as far apart as they go, on a part three
 * lattice columns wide. `has`: whether the board has a slot at a point of the part's frame.
 */
export function boltSites(
  def: Pick<AttachmentDef<object>, 'backPlate'>,
  opts: object,
  layout: AttachmentLayout,
  ctx: MountCtx,
  size: BoltSize,
  has: (x: number, y: number) => boolean = () => true,
): (BoltSite & { stud: boolean })[] {
  const declared = def.backPlate ? def.backPlate(opts, layout, ctx) : undefined;
  if (declared === null) return [];
  const plates = declared === undefined ? null : Array.isArray(declared) ? declared : [declared];
  const R = BOLT[size].head / 2;
  const need = boltSeat(size);
  const nut = tNut(size, ctx);
  const p = ctx.pitch;
  const [ax, ay] = layout.anchor;
  const mountAt = new Map(layout.mounts.map((m) => [`${m.di},${m.dj}`, m]));
  const top = Math.max(...layout.mounts.map((m) => m.dj));
  const boxes = layout.mounts.map((m) => ({ m, b: mountBox(m.kind, siteAt(layout, m, ctx), ctx) }));
  const found: (BoltSite & { stud: boolean; dj: number })[] = [];
  for (let dj = top; ay + dj * p > 0; dj--) {
    for (let di = -Math.floor(ax / p); ax + di * p < layout.w; di++) {
      if (Math.abs(di + dj) % 2) continue;
      const m = mountAt.get(`${di},${dj}`);
      if (m && m.kind !== 'stud') continue;
      const x = r3(ax + di * p);
      const y = r3(ay + dj * p);
      let back = 0.5;
      if (plates) {
        const pl = plates.find((q) => x - R - 1 >= q.x0 - 1e-6 && x + R + 1 <= q.x1 + 1e-6 && y - R - 1 >= q.y0 - 1e-6 && y + R + 1 <= q.y1 + 1e-6);
        if (!pl) continue;
        back = pl.z;
      } else if (m || dj !== top - 1 || !layout.mounts.some((q) => q.kind !== 'stud' && q.dj === top && Math.abs(q.di - di) === 1)) continue;
      const boss = back < need - 1e-6;
      // What it takes on the part's back: the head and 1 mm round it, or the boss (its 45° point too).
      const ro = boss ? (R + 1.6) * Math.SQRT2 : R + 1;
      if (x - ro < 0 || x + ro > layout.w || y - ro < 0 || y + ro > layout.h) continue;
      if (boxes.some(({ m: q, b }) => q !== m && x + ro > b.x0 - 0.5 && x - ro < b.x1 + 0.5 && y + ro > b.y0 - 0.5 && y - ro < b.y1 + 0.5)) continue;
      const seat = r3(Math.max(back, need));
      if (seat > layout.depth || !has(x, y)) continue;
      // Through the part, the board and the T-nut's bar to the nut's far face.
      const len = seat + ctx.t + nut.t - 0.2;
      found.push({ x, y, size, seat, boss, screw: SCREWS.find((l) => l >= len - 1e-6) ?? SCREWS[SCREWS.length - 1], stud: !!m, dj });
    }
  }
  if (!found.length) return [];
  // Free slots before studs', high before low, then near the middle; two: the leftmost and rightmost (the highest of each).
  found.sort((a, b) => +a.stud - +b.stud || b.dj - a.dj || Math.abs(a.x - layout.w / 2) - Math.abs(b.x - layout.w / 2));
  const best = found.filter((f) => f.stud === found[0].stud);
  const end = (k: 1 | -1) => best.reduce((q, f) => (k * (f.x - q.x) > 1e-6 || (Math.abs(f.x - q.x) < 1e-6 && f.dj > q.dj) ? f : q));
  const pick = layout.w >= 6 * p && end(-1) !== end(1) ? [end(-1), end(1)] : [found[0]];
  return pick.map(({ dj: _, ...b }) => b);
}

/**
 * An attachment's common options, planned: what they add to its mesh, its lock keys, its layout (a bolt takes a
 * stud's place) and anything worth a note. `has`: whether the board has a slot at a point of the part's frame.
 */
export function planExtras(
  a: Pick<PlacedAttachment, 'lock' | 'bolt' | 'label' | 'barbs'>,
  def: Pick<AttachmentDef<object>, 'labelFace' | 'backPlate'>,
  opts: object,
  layout: AttachmentLayout,
  ctx: MountCtx,
  has?: (x: number, y: number) => boolean,
): { extras?: AttachmentExtras; lock: boolean; layout: AttachmentLayout; notes: string[] } {
  const notes: string[] = [];
  const extras: AttachmentExtras = {};
  let out = layout;
  if (a.barbs === 'ends' && layout.mounts.filter((m) => m.kind === 'clip').length > 2) extras.barbs = 'ends';
  const text = typeof a.label === 'string' ? a.label.trim().slice(0, 40) : '';
  const face = text && def.labelFace ? def.labelFace(opts, layout) : null;
  if (face) extras.label = { text, face };
  if (a.bolt === 'm3' || a.bolt === 'm4') {
    const sites = boltSites(def, opts, layout, ctx, a.bolt, has);
    if (!sites.length) notes.push('No room for a bolt: it needs a free slot behind a flat part of its back.');
    else {
      extras.bolts = sites.map(({ stud: _, ...b }) => b);
      const taken = sites.filter((b) => b.stud);
      if (taken.length)
        out = {
          ...layout,
          mounts: layout.mounts.filter((m) => m.kind !== 'stud' || !taken.some((b) => b.x === siteAt(layout, m, ctx)[0] && b.y === siteAt(layout, m, ctx)[1])),
        };
      const n = tNut(a.bolt, ctx);
      const room = n.t + Math.max(0, ...sites.map((b) => b.screw - b.seat - ctx.t - n.t));
      if (ctx.behind < room - 1e-6) notes.push(`Its bolts need ${r2(room)} mm behind the board for their T-nuts: hang it on standoffs.`);
    }
  }
  const lock = (a.lock ?? LOCK_DEFAULT) && canLock(out, ctx);
  return { ...(Object.keys(extras).length ? { extras } : {}), lock, layout: out, notes };
}

/** Lock keys and T-nuts are built by build.ts's own part builder: their mesh specs have this for a type. */
export const MOUNT_PARTS = '@mount';

/** What MOUNT_PARTS builds: a lock key, or a T-nut. */
export type MountPartSpec = { mount: 'key' } | { mount: 'tnut'; size: BoltSize };

/** The extra parts an attachment's common options bring: a lock key over each hook, a T-nut for each bolt, each shown where it sits. */
export function mountParts(p: Pick<WallPlacement, 'layout' | 'lock' | 'extras'>, ctx: MountCtx): AttachmentPart[] {
  const out: AttachmentPart[] = [];
  if (p.lock)
    p.layout.mounts
      .filter((m) => m.kind === 'hook')
      .forEach((m, i) => {
        const k = lockKey(siteAt(p.layout, m, ctx), ctx);
        const spec: MountPartSpec = { mount: 'key' };
        out.push({
          key: `lock${i}`,
          name: 'Lock key',
          spec,
          w: r3(k.x1 - k.x0),
          d: r3(k.zt - k.z0),
          h: r3(k.top - k.y0),
          place: { at: [k.x0, k.y0, k.z0], turn: viewTurn('upright') },
        });
      });
  (p.extras?.bolts ?? []).forEach((b, i) => {
    const n = tNut(b.size, ctx);
    const spec: MountPartSpec = { mount: 'tnut', size: b.size };
    const at: [number, number, number] = [r3(b.x - n.len / 2), r3(b.y - n.h / 2), -r3(ctx.t + n.t)];
    out.push({ key: `tnut${i}`, name: `T-nut ${b.size.toUpperCase()}`, spec, w: n.len, d: n.h, h: r3(n.t + n.bd), place: { at, turn: [0, 0, 0] } });
  });
  return out;
}

/** The screws and nuts an attachment's bolts take (bom.ts adds them to its kind's hardware). */
export function extrasHardware(e: AttachmentExtras | undefined): AttachmentHardware[] {
  const out = new Map<string, AttachmentHardware>();
  const add = (item: string, note?: string) => {
    const line = out.get(item) ?? { item, count: 0, ...(note ? { note } : {}) };
    line.count++;
    out.set(item, line);
  };
  for (const b of e?.bolts ?? []) {
    const s = b.size.toUpperCase();
    add(`Countersunk screws ${s} × ${b.screw} (bolt-on)`, 'through the part and a slot into its printed T-nut');
    add(`${s} hex nuts (bolt-on)`, 'pressed into the T-nuts');
  }
  return [...out.values()];
}

/** Whether every mount of `layout` lands on a slot when its anchor is at (x, y). */
export function fitsAt(slots: ReadonlySet<string>, layout: Pick<AttachmentLayout, 'mounts'>, ctx: Pick<MountCtx, 'pitch'>, x: number, y: number): boolean {
  return layout.mounts.every((m) => slots.has(keyOf(x + m.di * ctx.pitch, y + m.dj * ctx.pitch)));
}

export const slotKeys = (slots: Vec2[]): Set<string> => new Set(slots.map(([x, y]) => keyOf(x, y)));

/** The slot nearest (x, y) where the whole layout fits, or null. */
export function snapAnchor(
  slots: Vec2[],
  keys: ReadonlySet<string>,
  layout: Pick<AttachmentLayout, 'mounts'>,
  ctx: Pick<MountCtx, 'pitch'>,
  x: number,
  y: number,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d < bestD && fitsAt(keys, layout, ctx, s[0], s[1])) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** The slot nearest (x, y), or null on a board without slots. */
export function nearestSlot(slots: Vec2[], x: number, y: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where an attachment dragged to (x, y) goes: the nearest slot where it fits, if one is near (within three lattice
 * steps), else the slot under the pointer, so it follows the drag even where it doesn't fit (it shows red there).
 */
export function dragAnchor(
  slots: Vec2[],
  keys: ReadonlySet<string>,
  layout: Pick<AttachmentLayout, 'mounts'>,
  ctx: Pick<MountCtx, 'pitch'>,
  x: number,
  y: number,
): { at: Vec2; fits: boolean } | null {
  const near = slots.filter((s) => Math.hypot(s[0] - x, s[1] - y) <= 3 * ctx.pitch);
  const fit = snapAnchor(near, keys, layout, ctx, x, y);
  if (fit) return { at: fit, fits: true };
  const at = nearestSlot(slots, x, y);
  return at ? { at, fits: false } : null;
}

/** Each attachment's kind, cleaned options and layout (null: a kind that isn't registered). */
export function attachmentLayout(a: Pick<PlacedAttachment, 'type' | 'opts'>, ctx: MountCtx): { opts: object; layout: AttachmentLayout } | null {
  const def = attachmentDef(a.type);
  if (!def) return null;
  const opts = def.sanitize(a.opts);
  return { opts, layout: def.layout(opts, ctx) };
}

/** A warning when an attachment is meant to hold more than its mounts take, or null. */
export type LoadNote = (a: PlacedAttachment, def: AttachmentDef<object>, opts: object, ctx: MountCtx, has?: (x: number, y: number) => boolean) => string | null;

let loadNote: LoadNote | null = null;

/** The load check (load.ts) sets this as it loads, with the kinds: it stays off the first screen. */
export function setLoadNote(f: LoadNote): void {
  loadNote = f;
}

export function placeAttachments(list: readonly PlacedAttachment[], board: WallBoard): { placed: WallPlacement[]; warnings: string[] } {
  const keys = slotKeys(board.slots);
  const warnings: string[] = [];
  const placed: WallPlacement[] = [];
  // How high each takes the board (its lock keys stand above it), wall y.
  const tops: number[] = [];
  for (const a of list) {
    const def = attachmentDef(a.type);
    const l = attachmentLayout(a, board.ctx);
    if (!def || !l) {
      warnings.push(`An attachment of a kind this version doesn't know (“${a.type}”) is left out.`);
      continue;
    }
    const name = a.name?.trim() || def.summary(l.opts as never);
    const at = snapAnchor(board.slots, keys, l.layout, board.ctx, a.x, a.y);
    const ok = !!at;
    // Planning puts it on the nearest slot where it fits, anywhere: one that doesn't fit, fits nowhere on this board.
    if (!ok)
      warnings.push(
        `${name} doesn't fit anywhere on this board: no spot has slots for all its mounts${board.hex ? ' (each hexagon has slots of its own, so it must fit on one)' : ''}. Make it narrower or shorter.`,
      );
    const [x, y] = at ?? [a.x, a.y];
    const ox = x - l.layout.anchor[0];
    const oy = y - l.layout.anchor[1];
    for (const msg of def.notes?.(l.opts as never, board.ctx) ?? []) warnings.push(`${name}: ${msg}`);
    // Its common options: bolts go through slots the board has.
    const has = ok ? (px: number, py: number) => keys.has(keyOf(ox + px, oy + py)) : undefined;
    const e = planExtras(a, def, l.opts, l.layout, board.ctx, has);
    for (const msg of e.notes) warnings.push(`${name}: ${msg}`);
    // More than its mounts take.
    const heavy = loadNote?.(a, def, l.opts, board.ctx, has);
    if (heavy) warnings.push(`${name}: ${heavy}`);
    const layout = e.layout;
    const b = partBounds(layout, board.ctx);
    // Lock keys stand on the board above it.
    const hooks = e.lock ? layout.mounts.filter((m) => m.kind === 'hook') : [];
    tops.push(Math.max(oy + b.y1, ...hooks.map((m) => oy + lockKey(siteAt(layout, m, board.ctx), board.ctx).top)));
    placed.push({
      id: a.id,
      type: a.type,
      name,
      x,
      y,
      x0: r2(ox + b.x0),
      y0: r2(oy + b.y0),
      x1: r2(ox + b.x1),
      y1: r2(oy + b.y1),
      depth: l.layout.depth,
      ok,
      mounts: layout.mounts.map((m) => {
        const [mx, my] = siteAt(layout, m, board.ctx);
        return { x: r2(ox + mx), y: r2(oy + my), kind: m.kind };
      }),
      layout,
      opts: l.opts,
      ...(e.extras ? { extras: e.extras } : {}),
      ...(e.lock ? { lock: true } : {}),
    });
  }
  // Two in the same place (lock keys included).
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      if (p.x0 < q.x1 - 0.5 && q.x0 < p.x1 - 0.5 && p.y0 < tops[j] - 0.5 && q.y0 < tops[i] - 0.5) warnings.push(`${p.name} and ${q.name} overlap.`);
    }
  }
  // A frame's rim stands proud of the front round the edge.
  const r = board.rim ?? 0;
  placed.forEach((p, i) => {
    if (r && (p.x0 < r || p.y0 < r || p.x1 > board.W - r || tops[i] > board.H - r)) warnings.push(`${p.name} stands on the frame: move it in from the edge.`);
  });
  // A clip needs room behind the board for its barbs.
  if (placed.some((p) => p.mounts.some((m) => m.kind === 'clip' || m.kind === 'hook'))) {
    const reach = Math.max(...placed.flatMap((p) => p.mounts.map((m) => -mountBox(m.kind, [0, 0], board.ctx).z0 - board.ctx.t)));
    if (board.ctx.behind < reach - 1e-6)
      warnings.push(`The clips and hooks reach ${r2(reach)} mm behind the board: hang it on standoffs (Off the wall on), or they'll hit the wall.`);
  }
  return { placed, warnings };
}

/** Mesh key text for an attachment: its kind, options and the board it's for (and its common options' extras, when it has some). */
export const attachmentKey = (type: string, opts: object, ctx: MountCtx, extras?: AttachmentExtras) =>
  `att|${type}|${JSON.stringify(opts)}|${JSON.stringify(ctx)}${extras ? `|${JSON.stringify(extras)}` : ''}`;

/** Its printed size, and the turn and min corner that put its mesh where it hangs in the drawer view. */
export function attachmentView(
  p: WallPlacement,
  board: WallBoard,
): { size: { w: number; d: number; h: number }; turn: [number, number, number]; at: [number, number, number] } {
  const b = partBounds(p.layout, board.ctx);
  const ox = p.x - p.layout.anchor[0];
  const oy = p.y - p.layout.anchor[1];
  return {
    size: printedSize(p.layout, board.ctx),
    turn: viewTurn(p.layout.pose),
    at: [r2(ox + b.x0), r2(oy + b.y0), r2(board.front + b.z0)],
  };
}
