/**
 * Lift-off caddy: a carry tote (paints, brushes, a soldering or sewing kit)
 * that hangs on a dock on the board and lifts off to go to the bench. The
 * dock is a back plate with short 45° French cleats along its top (their tops
 * slope down toward the board) and a bumper low down; the caddy's hooks drop
 * behind the cleats, so its weight wedges it toward the board and it can't
 * slide forward off them: lift it 8 mm and it comes away. The caddy has a
 * handle down its middle (a wall with a grip along its top), dividers across.
 *
 * Both print upright without support: the cleats and the bumper stand on 45°
 * undersides; the caddy prints open side up, each hook a finger over a cleat
 * between two ribs that run down to its back wall at 45° (the finger's first
 * layers bridge 9 mm between them), the grip's undersides at 45°. The dock
 * is as big as the caddy on the wall (the planner keeps clear of it), clips
 * across its top, studs low on it.
 */
import { backMounts } from '../mount';
import { int, num, obj, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';
import { KG } from '../load';

export interface CaddyOptions {
  /** The caddy outside: across, out from its back, and its walls' height, mm. */
  width: number;
  depth: number;
  height: number;
  /** Dividers across it. */
  dividers: number;
  /** How far the handle stands above the rim, mm (0: none). */
  handle: number;
}

export const CADDY_DEFAULTS: CaddyOptions = { width: 160, depth: 90, height: 70, dividers: 2, handle: 50 };

/** The dock's back plate, how far its cleats stand out, the gap between them and the caddy, the caddy's floor above the dock's foot; mm. */
export const CADDY = { back: 3, cleat: 8, gap: 0.5, foot: 2 } as const;

/**
 * The cleats and hooks, mm: a cleat's width, the hook's bar over it, the clearances (behind the finger, over the
 * cleat's top, each side), a rib's thickness.
 */
export const HOOK = { tooth: 8, bar: 5, back: 0.5, over: 0.5, side: 0.5, rib: 3 } as const;

/** The bumper along the dock's foot: its height over the caddy's floor and how close it comes to the caddy, mm. */
export const CADDY_BUMP = { h: 12, gap: 0.5 } as const;

/** Where the caddy is on the dock, mm: its back `zc`, its foot, rim and handle's top, and its hooks' centres across. */
export function caddyPlan(o: CaddyOptions) {
  const y0 = CADDY.foot;
  const rim = y0 + o.height;
  const n = Math.max(2, Math.round(o.width / 60));
  return {
    zc: CADDY.back + CADDY.cleat + CADDY.gap,
    y0,
    rim,
    top: rim + o.handle,
    hooks: Array.from({ length: n }, (_, i) => (o.width * (i + 0.5)) / n),
  };
}

const dockHeight = (o: CaddyOptions) => caddyPlan(o).top + 2;

registerAttachment<CaddyOptions>({
  type: 'caddy',
  defaults: CADDY_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CADDY_DEFAULTS;
    return {
      width: num(r.width, 60, 240, d.width),
      depth: num(r.depth, 40, 150, d.depth),
      height: num(r.height, 35, 150, d.height),
      dividers: int(r.dividers, 0, 8, d.dividers),
      handle: num(r.handle, 0, 100, d.handle),
    };
  },
  layout(o, ctx: MountCtx) {
    const h = dockHeight(o);
    const m = backMounts(o.width, h, ctx, { rows: 4 });
    return { w: o.width, h, depth: CADDY.back + CADDY.cleat, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Lift-off caddy ${Math.round(o.width)} × ${Math.round(o.depth)}`,
  backPlate(o, l) {
    // Over the bumper: between the cleats, and under and over their row (lift the caddy off first).
    const p = caddyPlan(o);
    const c = CADDY.cleat;
    const top = p.rim - HOOK.bar - HOOK.over;
    const y0 = p.y0 + CADDY_BUMP.h;
    const plate = (x0: number, x1: number, ya: number, yb: number) => ({ x0, x1, y0: ya, y1: yb, z: CADDY.back });
    const xs = [0, ...p.hooks.flatMap((x) => [x - HOOK.tooth / 2, x + HOOK.tooth / 2]), l.w];
    return [
      ...Array.from({ length: xs.length / 2 }, (_, k) => plate(xs[2 * k], xs[2 * k + 1], y0, l.h)),
      plate(0, l.w, y0, top - 2 * c - 4.5),
      plate(0, l.w, top, l.h),
    ];
  },
  notes: (o) => leverNotes(caddyPlan(o).zc + o.depth, dockHeight(o)),
  parts(o) {
    const p = caddyPlan(o);
    const z0 = CADDY.back + CADDY.gap;
    return [
      {
        key: 'caddy',
        name: 'Caddy',
        spec: { ...o },
        w: o.width,
        d: p.zc + o.depth - z0,
        h: p.top - p.y0,
        place: { at: [0, p.y0, z0], turn: [-90, 0, 0] },
      },
    ];
  },
  // The caddy, full, hanging in front of the dock.
  load: (o) => ({ kg: o.width * o.depth * o.height * KG.full, at: caddyPlan(o).zc + o.depth / 2 }),
});
