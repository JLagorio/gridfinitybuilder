/**
 * How attachments hold on to a board: the one mount standard every attachment
 * shares, generated from the board it's for (its thickness, slot size and the
 * fit picked for it), so they fit the board as printed.
 *
 * - Clip (parts printed upright, as they hang): a peg as tall as most of a slot,
 *   split down the middle, with a barb on each half. It pushes straight in, the
 *   halves spring back behind the board, and the part drops onto the bottom of
 *   the slots. Lifting it doesn't free it: the barbs stay behind the board. It
 *   is a prism standing up from the bed, so the halves flex in the plane of
 *   the layers, and its underside rises at 45° so it needs no support.
 * - Stud: a plain peg in a slot lower down, so a heavy part can't tilt.
 * - Hook (parts printed on their side): a peg with a lip that drops behind the
 *   board below its slot, the classic pegboard hook; its profile lies on the
 *   bed, so it is strong and needs no support. The lip's face narrows toward
 *   the neck (0.6 mm clear at its foot, 0.2 mm at the neck): it drops on
 *   easily and the part's weight pulls it snug instead of rattling. A hook
 *   sits flush with the part's top, so the slot over its neck is open from the
 *   front for a lock key.
 * - Lock key (an extra part, plan.ts): a plug pushed into that slot over the
 *   hook's neck, filling it to the slot's end, so the part can't be lifted off
 *   (lifting is how a hook comes out). A flange on the board's face stops it,
 *   a tab on top pulls it out, crush ribs hold it in.
 * - Bolt (a common option, plan.ts): a countersunk screw through the part's
 *   back and a free slot into a printed T-nut behind the board: a bar wider
 *   than the slot with a hex nut pressed in, and a boss in the slot so it
 *   can't turn as the screw tightens.
 *
 * Mounts sit on the slot lattice: columns two steps (40 mm on the standard spacing)
 * apart in the top row, studs two steps below. Units: wall coordinates of the
 * part's own frame (registry.ts).
 */
import type { Manifold, Vec2, Wasm } from '../geometry/kernel';
import type { Scope } from '../geometry/kernel';
import type { AttachmentLayout, MountCtx, MountKind, MountSite, PrintPose } from './registry';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Fit adjustments: clearance each side of a peg in its slot, and how far a clip's barbs reach past the slot, mm. */
const FIT = {
  snug: { side: 0.05, barb: 0.6 },
  normal: { side: 0.1, barb: 0.45 },
  loose: { side: 0.2, barb: 0.3 },
} as const;

export const MOUNT = {
  /** Clip: height (capped by the slot), split, barb length, gap between the board's back and the barbs. */
  clip: { height: 12, split: 1.8, barb: 2, gap: 0.3, lead: 0.2, tipIn: 0.3 },
  /** Stud: height (capped by the slot), clearance each side, depth into the slot (capped by the board). */
  stud: { height: 10, side: 0.3, depth: 3 },
  /**
   * Hook: clearance each side, neck height, lip drop and thickness, gap behind the board (to the lip's back);
   * the lip's face is `grip` off the board's back at the neck, opening to `lead` `ramp` mm further down.
   */
  hook: { side: 0.35, neck: 5, drop: 7, lip: 3, gap: 0.35, grip: 0.2, lead: 0.6, ramp: 2.5 },
  /**
   * Lock key: clearance over the hook's neck and under the slot's end, the flange's thickness and width and how far it
   * covers the board above the slot, the pull tab, and how much the crush ribs press on the slot's sides.
   */
  key: { under: 0.3, over: 0.15, flange: 2.4, width: 10, above: 3, tab: 2, crush: 0.15 },
  /** T-nut: how far its bar reaches past the slot each side, plastic between nut and board, the boss into the slot (clearance each side, depth). */
  tnut: { side: 6, skin: 2.4, fit: 0.2, boss: 2.5 },
  /** Pegs sit this far above where the round end of the slot meets them. */
  seat: 0.05,
  /** Least plastic between a mount and the part's edge, mm. */
  margin: 2,
} as const;

/** How much higher than the bottom of a round-ended slot a flat peg `w` wide rests. */
export function seatOf(ctx: Pick<MountCtx, 'slotW'>, w: number): number {
  const r = ctx.slotW / 2;
  const h = Math.min(w / 2, r);
  return r - Math.sqrt(r * r - h * h) + MOUNT.seat;
}

/** A clip's width at the board and its height. */
export const clipWidth = (ctx: MountCtx) => r3(ctx.slotW - 2 * FIT[ctx.fit].side);
export const clipHeight = (ctx: MountCtx) => r3(Math.min(MOUNT.clip.height, ctx.slotL - seatOf(ctx, clipWidth(ctx)) - 2));
/** How far a clip reaches behind the board's front. */
export const clipReach = (ctx: MountCtx) => r3(ctx.t + MOUNT.clip.gap + MOUNT.clip.barb);
export const studWidth = (ctx: MountCtx) => r3(ctx.slotW - 2 * MOUNT.stud.side);
export const studHeight = (ctx: MountCtx) => r3(Math.min(MOUNT.stud.height, ctx.slotL - seatOf(ctx, studWidth(ctx)) - 3));
export const studDepth = (ctx: MountCtx) => r3(Math.max(1, Math.min(MOUNT.stud.depth, ctx.t - 1)));
export const hookWidth = (ctx: MountCtx) => r3(ctx.slotW - 2 * MOUNT.hook.side);
/** A hook's lip drop: what still lets neck and lip through the slot together. */
export const hookDrop = (ctx: MountCtx) => r3(Math.max(2, Math.min(MOUNT.hook.drop, ctx.slotL - 2 * seatOf(ctx, hookWidth(ctx)) - MOUNT.hook.neck - 0.5)));
export const hookReach = (ctx: MountCtx) => r3(ctx.t + MOUNT.hook.gap + MOUNT.hook.lip);

/**
 * A lock key over the hook at slot `at` (part frame): its shank fills the slot from just over the hook's neck
 * (`y0`) to just under the slot's end (`y1`), `kw` wide, back to `z0`; its flange lies on the board's face,
 * x0..x1 across, out to `zf`, from y0 up to `top`, with a pull tab out to `zt` at the top.
 */
export function lockKey(at: Vec2, ctx: MountCtx) {
  const K = MOUNT.key;
  const kw = hookWidth(ctx);
  const neck = at[1] - ctx.slotL / 2 + seatOf(ctx, kw) + MOUNT.hook.neck;
  return {
    kw,
    x0: r3(at[0] - K.width / 2),
    x1: r3(at[0] + K.width / 2),
    y0: r3(neck + K.under),
    y1: r3(at[1] + ctx.slotL / 2 - seatOf(ctx, kw) - K.over),
    top: r3(at[1] + ctx.slotL / 2 + K.above),
    z0: -r3(Math.max(1, ctx.t - 0.4)),
    zf: K.flange,
    zt: K.flange + K.tab,
  };
}

/** Bolts: clearance hole, countersunk head, hex nut across flats and thickness, mm. */
export const BOLT = { m3: { hole: 3.4, head: 6.4, nut: 5.5, nutT: 2.4 }, m4: { hole: 4.5, head: 8.6, nut: 7, nutT: 3.2 } } as const;
export type BoltSize = keyof typeof BOLT;

/** How thick a part's back must be under a countersunk head: the cone and 0.8 mm. */
export const boltSeat = (size: BoltSize) => r3((BOLT[size].head - BOLT[size].hole) / 2 + 0.8);

/** A T-nut for `size`: its bar (`len` across the slot, `h` up, `t` thick) and the boss into the slot (bw × bh, bd deep). */
export function tNut(size: BoltSize, ctx: MountCtx) {
  const T = MOUNT.tnut;
  const B = BOLT[size];
  const bh = r3(Math.max(B.hole + 1, Math.min(9, ctx.slotL - ctx.slotW - 0.4)));
  return {
    len: r3(ctx.slotW + 2 * T.side),
    h: r3(Math.max(B.nut + 4.5, bh + 2)),
    t: r3(B.nutT + 0.2 + T.skin),
    bw: r3(ctx.slotW - 2 * T.fit),
    bh,
    bd: r3(Math.max(0.6, Math.min(T.boss, ctx.t - 1))),
  };
}

/** Where a mount is in the part's frame: the slot centre it uses. */
export function siteAt(layout: Pick<AttachmentLayout, 'anchor'>, site: MountSite, ctx: Pick<MountCtx, 'pitch'>): Vec2 {
  return [r3(layout.anchor[0] + site.di * ctx.pitch), r3(layout.anchor[1] + site.dj * ctx.pitch)];
}

/** A mount's box in the part's frame (x0..x1, y0..y1, z0..z1; behind the board is z < 0). */
export function mountBox(kind: MountKind, at: Vec2, ctx: MountCtx): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const bottom = at[1] - ctx.slotL / 2;
  if (kind === 'clip') {
    const w = clipWidth(ctx);
    const yb = bottom + seatOf(ctx, w);
    const half = w / 2 + FIT[ctx.fit].barb;
    return { x0: at[0] - half, x1: at[0] + half, y0: yb, y1: yb + clipHeight(ctx), z0: -clipReach(ctx), z1: 0 };
  }
  if (kind === 'stud') {
    const w = studWidth(ctx);
    const yb = bottom + seatOf(ctx, w);
    return { x0: at[0] - w / 2, x1: at[0] + w / 2, y0: yb, y1: yb + studHeight(ctx), z0: -studDepth(ctx), z1: 0 };
  }
  const w = hookWidth(ctx);
  const yb = bottom + seatOf(ctx, w);
  return { x0: at[0] - w / 2, x1: at[0] + w / 2, y0: yb - hookDrop(ctx), y1: yb + MOUNT.hook.neck, z0: -hookReach(ctx), z1: 0 };
}

/** Bounds of a part in its own frame: its body box and its mounts. */
export function partBounds(layout: AttachmentLayout, ctx: MountCtx): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const b = { x0: 0, x1: layout.w, y0: 0, y1: layout.h, z0: 0, z1: layout.depth };
  for (const m of layout.mounts) {
    const mb = mountBox(m.kind, siteAt(layout, m, ctx), ctx);
    b.x0 = Math.min(b.x0, mb.x0);
    b.x1 = Math.max(b.x1, mb.x1);
    b.y0 = Math.min(b.y0, mb.y0);
    b.y1 = Math.max(b.y1, mb.y1);
    b.z0 = Math.min(b.z0, mb.z0);
  }
  return b;
}

/** Printed size (footprint w × d, height h) of a part in its pose. */
export function printedSize(layout: AttachmentLayout, ctx: MountCtx): { w: number; d: number; h: number } {
  const b = partBounds(layout, ctx);
  const sx = r3(b.x1 - b.x0);
  const sy = r3(b.y1 - b.y0);
  const sz = r3(b.z1 - b.z0);
  // Upright: the front faces the front of the bed, wall up is up. Side: on its left side, the board's face upright.
  return layout.pose === 'upright' ? { w: sx, d: sz, h: sy } : { w: sz, d: sy, h: sx };
}

/** The turn (degrees about x, y, z) that stands a part posed for printing back as it hangs on the wall. */
export function viewTurn(pose: PrintPose): [number, number, number] {
  return pose === 'upright' ? [-90, 0, 0] : [0, 90, 0];
}

// ---------------------------------------------------------------------------
// Placing mounts
// ---------------------------------------------------------------------------

export interface MountPlan {
  anchor: Vec2;
  mounts: MountSite[];
}

/**
 * Mounts across the back of a part `w` wide and `h` tall: a column every two
 * lattice steps, as many as fit, centred; the top row `kind` (clips, or hooks
 * for parts printed on their side), and studs two steps below each, row after
 * row, up to `rows` rows in all. `top`: how far down from the part's top the
 * top row may sit at the least.
 */
export function backMounts(
  w: number,
  h: number,
  ctx: MountCtx,
  o: { kind?: 'clip' | 'hook'; rows?: number; columns?: number; top?: number; left?: boolean } = {},
): MountPlan {
  const kind = o.kind ?? 'clip';
  const step = 2 * ctx.pitch;
  const box0 = mountBox(kind, [0, 0], ctx);
  const half = (box0.x1 - box0.x0) / 2;
  const m = half + MOUNT.margin;
  let n = Math.max(1, Math.floor((w - 2 * m) / step + 1e-9) + 1);
  if (o.columns) n = Math.max(1, Math.min(n, o.columns));
  // Parts printed on their side keep their mounts at the left, flush with the bed (a stud is a little wider than a hook); the others centre them.
  const stud0 = mountBox('stud', [0, 0], ctx);
  const x = o.left ? r3(Math.max(half, -stud0.x0)) : r3((w - (n - 1) * step) / 2);
  // Highest the top row's slot centre can be: its peg ends below the part's top; a hook's neck at it (a lock key goes in over it).
  const y = r3(h - (o.top ?? (kind === 'hook' ? 0 : MOUNT.margin)) - box0.y1);
  const mounts: MountSite[] = [];
  for (let c = 0; c < n; c++) mounts.push({ di: 2 * c, dj: 0, kind });
  const rows = Math.max(1, o.rows ?? 2);
  for (let r = 1; r < rows; r++) {
    // Its stud stays on the part.
    if (y - r * step + stud0.y0 < MOUNT.margin) break;
    for (let c = 0; c < n; c++) mounts.push({ di: 2 * c, dj: -2 * r, kind: 'stud' });
  }
  return { anchor: [x, y], mounts };
}

/** The least height a part needs for one row of `kind` mounts. */
export function minHeight(ctx: MountCtx, kind: 'clip' | 'hook' = 'clip'): number {
  const b = mountBox(kind, [0, 0], ctx);
  return r3(b.y1 - Math.min(b.y0, 0) + 2 * MOUNT.margin);
}

// ---------------------------------------------------------------------------
// Geometry (geometry worker)
// ---------------------------------------------------------------------------

/** A polygon CCW (positive area). */
export function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a >= 0 ? pts : [...pts].reverse();
}

/** A prism along y: the polygon is in (x, d), d behind the board's front (z = -d), from y0 up `height`. */
export function prismY(w: Wasm, s: Scope, pts: Vec2[], y0: number, height: number): Manifold {
  const e = s.t(w.Manifold.extrude([ccw(pts)], height));
  // (px, pd, e) → (px, e, -pd)
  return s.t(s.t(e.rotate([-90, 0, 0])).translate([0, y0, 0]));
}

/** A prism along x: the polygon is in (d, y), d behind the board's front (z = -d), from x0 across `width`. */
export function prismX(w: Wasm, s: Scope, pts: Vec2[], x0: number, width: number): Manifold {
  const e = s.t(w.Manifold.extrude([ccw(pts)], width));
  // (pd, py, e) → (e, py, -pd)
  return s.t(s.t(e.rotate([0, 90, 0])).translate([x0, 0, 0]));
}

/** A prism along z (front to back): the polygon is in (x, y), from z0 to z1. */
export function prismZ(w: Wasm, s: Scope, pts: Vec2[], z0: number, z1: number): Manifold {
  return s.t(s.t(w.Manifold.extrude([ccw(pts)], z1 - z0)).translate([0, 0, z0]));
}

/** Everything under a 45° line rising backward from the board's front at height `y`, around x0..x1 (to take off a peg's overhang). */
function underside(w: Wasm, s: Scope, x0: number, x1: number, y: number, reach: number): Manifold {
  return prismX(
    w,
    s,
    [
      [-0.6, y - 0.6],
      [reach + 2, y - 0.6],
      [reach + 2, y + reach + 2],
    ],
    x0 - 1,
    x1 - x0 + 2,
  );
}

function clipSolid(w: Wasm, s: Scope, at: Vec2, ctx: MountCtx, barbed = true): Manifold {
  const W = clipWidth(ctx);
  const H = clipHeight(ctx);
  const { split, barb, gap, lead, tipIn } = MOUNT.clip;
  const i = FIT[ctx.fit].barb;
  const catchAt = ctx.t + gap;
  const tip = catchAt + barb;
  const hw = W / 2;
  const sp = Math.min(split, W - 2.4) / 2;
  const splitFrom = 0.6;
  const yb = at[1] - ctx.slotL / 2 + seatOf(ctx, W);
  if (!barbed) {
    // A plain peg through the slot, just past the board.
    const peg = prismY(w, s, rect(at[0] - hw, -0.5, at[0] + hw, catchAt), yb, H);
    return s.t(peg.subtract(underside(w, s, at[0] - hw, at[0] + hw, yb, catchAt)));
  }
  // Its section across the slot (x) and back from the board's front (d): two legs joined at the root, each with a barb.
  const pts: Vec2[] = [
    [-hw, -0.5],
    [hw, -0.5],
    [hw, catchAt],
    [hw + i, catchAt + lead],
    [hw - tipIn, tip],
    [sp, tip],
    [sp, splitFrom],
    [-sp, splitFrom],
    [-sp, tip],
    [-hw + tipIn, tip],
    [-hw - i, catchAt + lead],
    [-hw, catchAt],
  ].map(([x, d]) => [r3(at[0] + x), r3(d)] as Vec2);
  const body = prismY(w, s, pts, yb, H);
  return s.t(body.subtract(underside(w, s, at[0] - hw - i, at[0] + hw + i, yb, tip)));
}

function studSolid(w: Wasm, s: Scope, at: Vec2, ctx: MountCtx): Manifold {
  const W = studWidth(ctx);
  const yb = at[1] - ctx.slotL / 2 + seatOf(ctx, W);
  const d = studDepth(ctx);
  const body = prismZ(
    w,
    s,
    [
      [at[0] - W / 2, yb],
      [at[0] + W / 2, yb],
      [at[0] + W / 2, yb + studHeight(ctx)],
      [at[0] - W / 2, yb + studHeight(ctx)],
    ],
    -d,
    0.5,
  );
  return s.t(body.subtract(underside(w, s, at[0] - W / 2, at[0] + W / 2, yb, d)));
}

function hookSolid(w: Wasm, s: Scope, at: Vec2, ctx: MountCtx): Manifold {
  const W = hookWidth(ctx);
  const yb = at[1] - ctx.slotL / 2 + seatOf(ctx, W);
  const { neck, gap, lip, grip, lead, ramp } = MOUNT.hook;
  const drop = hookDrop(ctx);
  const t = ctx.t;
  const back = t + gap + lip;
  // The lip's face: snug at the neck, opening out further down (a lead-in as it drops behind the board), its foot chamfered.
  const r = Math.min(ramp, drop - 0.8);
  return prismX(
    w,
    s,
    [
      [-0.5, yb],
      [t + grip, yb],
      [t + lead, yb - r],
      [t + lead, yb - drop + 0.4],
      [t + lead + 0.4, yb - drop],
      [back, yb - drop],
      [back, yb + neck],
      [-0.5, yb + neck],
    ],
    at[0] - W / 2,
    W,
  );
}

/** The solids of a part's mounts, in its frame. `barbs: 'ends'`: only the clips at the ends of the top row have barbs. */
export function mountSolids(w: Wasm, s: Scope, layout: AttachmentLayout, ctx: MountCtx, barbs?: 'ends'): Manifold[] {
  const clips = layout.mounts.filter((m) => m.kind === 'clip');
  const top = Math.max(...clips.map((m) => m.dj));
  const row = clips.filter((m) => m.dj === top).map((m) => m.di);
  const barbed = (m: MountSite) => barbs !== 'ends' || (m.dj === top && (m.di === Math.min(...row) || m.di === Math.max(...row)));
  return layout.mounts.map((m) => {
    const at = siteAt(layout, m, ctx);
    return m.kind === 'clip' ? clipSolid(w, s, at, ctx, barbed(m)) : m.kind === 'stud' ? studSolid(w, s, at, ctx) : hookSolid(w, s, at, ctx);
  });
}

/** A circle as a polygon round (x, y). */
const circle = (x: number, y: number, r: number, n = 40): Vec2[] =>
  Array.from({ length: n }, (_, k) => [x + r * Math.cos((2 * Math.PI * k) / n), y + r * Math.sin((2 * Math.PI * k) / n)] as Vec2);

/** A rectangle as a polygon, (x0, y0) to (x1, y1). */
function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** A lock key (lockKey) over the hook at `at`, in the part's frame, as it sits. */
export function lockKeySolid(w: Wasm, s: Scope, at: Vec2, ctx: MountCtx): Manifold {
  const k = lockKey(at, ctx);
  const hw = k.kw / 2;
  const x = at[0];
  const parts = [prismZ(w, s, rect(x - hw, k.y0, x + hw, k.y1), k.z0, 0.5), prismZ(w, s, rect(k.x0, k.y0, k.x1, k.top), 0, k.zf)];
  // Crush ribs on its sides, up the straight part of the slot: 45° each way, so they lead in and print upright.
  const ribTop = Math.min(k.y1, at[1] + ctx.slotL / 2 - ctx.slotW / 2 - 0.3);
  const proud = (ctx.slotW - k.kw) / 2 - FIT[ctx.fit].side + MOUNT.key.crush;
  for (const d of [1.2, -k.z0 - 1.2]) {
    for (const sx of [-1, 1]) {
      const e = x + sx * (hw - 0.1);
      const tri: Vec2[] = [
        [e, d - proud - 0.1],
        [x + sx * (hw + proud), d],
        [e, d + proud + 0.1],
      ];
      parts.push(prismY(w, s, tri, k.y0, ribTop - k.y0));
    }
  }
  // The pull tab: a lip across the flange's top for a fingernail, its underside at 45°.
  const tab = MOUNT.key.tab;
  const lip: Vec2[] = [
    [-(k.zf - 0.5), k.top - 2 * tab - 0.5],
    [-k.zt, k.top - tab],
    [-k.zt, k.top],
    [-(k.zf - 0.5), k.top],
  ];
  parts.push(prismX(w, s, lip, k.x0, k.x1 - k.x0));
  return s.t(w.Manifold.union(parts));
}

/**
 * A T-nut (tNut) as printed: its back on the bed (z = 0) with the nut's hex pocket open there, the boss on top,
 * centred on x = y = 0. Where it sits, its back is `ctx.t + t` behind the board's front.
 */
export function tNutSolid(w: Wasm, s: Scope, size: BoltSize, ctx: MountCtx): Manifold {
  const n = tNut(size, ctx);
  const B = BOLT[size];
  const body = s.t(
    w.Manifold.union([
      prismZ(w, s, rect(-n.len / 2, -n.h / 2, n.len / 2, n.h / 2), 0, n.t),
      prismZ(w, s, rect(-n.bw / 2, -n.bh / 2, n.bw / 2, n.bh / 2), n.t - 0.5, n.t + n.bd),
    ]),
  );
  // The hex (flats left and right, so the bridge over it is short) and the screw's hole through.
  const hex = circle(0, 0, (B.nut + 0.3) / 2 / Math.cos(Math.PI / 6), 6);
  const holes = s.t(w.Manifold.union([prismZ(w, s, hex, -1, B.nutT + 0.2), prismZ(w, s, circle(0, 0, B.hole / 2), -1, n.t + n.bd + 1)]));
  return s.t(body.subtract(holes));
}

/** A bolt as the part's geometry needs it (registry.ts BoltSite). */
type Bolt = { x: number; y: number; size: BoltSize; seat: number };

/**
 * What a bolt takes out of a part (its frame): the clearance hole through its back, the countersink up to the
 * seat, and a bore for the head and the screwdriver on out through anything in front (to `front`).
 */
export function boltCut(w: Wasm, s: Scope, b: Bolt, front: number): Manifold {
  const B = BOLT[b.size];
  const r = B.hole / 2;
  const R = B.head / 2;
  const at = (m: Manifold, z: number) => s.t(s.t(m).translate([b.x, b.y, z]));
  return s.t(
    w.Manifold.union([
      at(w.Manifold.cylinder(b.seat + 2, r, r, 32), -1),
      at(w.Manifold.cylinder(R - r + 0.01, r, R + 0.01, 48), b.seat - (R - r)),
      at(w.Manifold.cylinder(Math.max(1, front - b.seat + 1), R + 0.3, R + 0.3, 48), b.seat),
    ]),
  );
}

/**
 * A boss round a bolt from the part's back out to its seat, for a back thinner than the head needs. Its outline
 * comes to a 45° point underneath as printed (`down`: the print's down in the part's front view), so it needs no support.
 */
export function boltBoss(w: Wasm, s: Scope, b: Bolt, down: 'y' | 'x'): Manifold {
  const rb = BOLT[b.size].head / 2 + 1.6;
  const pts: Vec2[] = [];
  for (let k = 0; k <= 36; k++) {
    const a = -Math.PI / 4 + (k / 36) * 1.5 * Math.PI;
    pts.push([rb * Math.cos(a), rb * Math.sin(a)]);
  }
  pts.push([0, -rb * Math.SQRT2]);
  return prismZ(
    w,
    s,
    pts.map(([u, v]) => (down === 'y' ? [b.x + u, b.y + v] : [b.x + v, b.y - u]) as Vec2),
    0,
    b.seat,
  );
}

/** Turn a part from its wall frame into its print pose (rotation only; the caller moves it to the origin). */
export function toPrintPose(s: Scope, m: Manifold, pose: PrintPose): Manifold {
  // Upright: (x, y, z) → (x, -z, y). Side: (x, y, z) → (-z, y, x).
  return pose === 'upright' ? s.t(m.rotate([90, 0, 0])) : s.t(m.rotate([0, -90, 0]));
}
