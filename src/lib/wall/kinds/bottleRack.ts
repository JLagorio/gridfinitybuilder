/**
 * Bottle & pot rack: rows of round (or square) cups for paint bottles and
 * pots, spice jars, cans, test tubes, … stepped like stadium seating (each row
 * behind stands `step` higher, so the ones at the back show over the front),
 * leaning toward you if you like, so labels and caps face you. The stick rack
 * (stickRack.ts) is the same rack with its own sizes.
 *
 * Every cup is a tube that stands on the bed (printed upright, as it hangs),
 * its walls shared with its neighbours', so a row behind stands on its own
 * walls with nothing to bridge. Under a floor the tube's hollow closes in at
 * 45°, like a funnel upside down, so the floor needs no support:
 * - closed: the cone closes to a 10 mm disc, a short bridge;
 * - hole: a lip round a hole to push the bottle up through from below (and drain);
 * - ring: no floor, things go right through (or hang by their rim);
 * - neck: upside down, a 45° funnel the shoulder rests in and a hole for the cap.
 * Tilted, every tube leans alike (no more than 30°, so they print), the rows
 * spaced so the nearest cups share a wall. Clips across the top of the back, studs
 * low on it: a rack full of paint weighs a couple of kilos.
 */
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type BackPlate, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export type RackFloor = 'closed' | 'hole' | 'ring' | 'neck';

/** What the rack's geometry needs, from either kind's options. */
export interface RackSpec {
  shape: 'round' | 'square';
  /** Inside sizes (diameters, or square sides), a list per row, the front row first; mm. */
  rows: number[][];
  /** Square cups' inside corner radius, cup wall, how much higher each row behind is, cup depth (along the cup) and the neck hole's diameter; mm. */
  corner: number;
  wall: number;
  step: number;
  /** Lean toward you, degrees. */
  tilt: number;
  cup: number;
  floor: RackFloor;
  neck: number;
  /** A sloping label strip along the front. */
  label: boolean;
}

/** Back plate, floor thickness (upright), a closed floor's bridge radius, the label strip's depth; mm. */
export const RACK = { back: 3, floor: 1.6, bridge: 5, label: 8 } as const;

/** A cup: its axis where it meets the seat (x, seat height y, z out from the board) and half its inside size; mm. */
export interface RackCup {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** The lip round a floor's hole, for a cup of inside half-size `r`. */
export const rackLip = (r: number) => Math.min(Math.max(0.3 * r, 1.5), r - 0.75);
/** The neck hole's radius in a cup of inside half-size `r`. */
export const neckRadius = (s: Pick<RackSpec, 'neck'>, r: number) => Math.max(1, Math.min(s.neck / 2, r - 1.5));

const RAD = Math.PI / 180;

/**
 * Where every cup is, the rack's width (at least `minW`), its cups' top, how far it stands out, the label strip's back
 * (`zl`, the front row's axis at the bed) and front (`zf`), and the steps the rows took (a big step at a big tilt
 * would part them, so it stops where they still share a wall).
 */
export function rackPlan(s: RackSpec, minW = 0) {
  const th = s.tilt * RAD;
  const [sin, cos, tan] = [Math.sin(th), Math.cos(th), Math.tan(th)];
  const w = s.wall;
  const rows = s.rows.filter((r) => r.length).map((row) => row.map((a) => a / 2));
  if (!rows.length) rows.push([5]);
  const n = rows.length;
  const rmax = rows.map((row) => Math.max(...row));
  const R = Math.max(...rmax);
  const widths = rows.map((row) => row.reduce((a, r) => a + 2 * r + w, w));
  const W = Math.max(minW, ...widths);
  // Across: each row centred, its cups sharing walls.
  const xs = rows.map((row, k) => {
    let x = (W - widths[k]) / 2 + w;
    return row.map((r) => {
      x += 2 * r + w;
      return x - r - w;
    });
  });
  // Between two rows, square to the tubes (they all lean alike): far enough apart that the nearest cups keep a wall
  // between them, and no further, so they share it. Leaning, a step up moves them apart that way too, and they need less
  // room out from the board; a step so big it would part them is cut back to what keeps their axes half a cup apart.
  const steps: number[] = [];
  const gaps: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    let need = 0;
    rows[k].forEach((ra, i) =>
      rows[k + 1].forEach((rb, j) => {
        const q = ra + rb + w;
        need = Math.max(need, Math.sqrt(Math.max(0, q * q - (xs[k][i] - xs[k + 1][j]) ** 2)));
      }),
    );
    steps[k] = sin > 1e-9 ? Math.min(s.step, (need * (1 - 0.5 * cos)) / sin) : s.step;
    gaps[k] = Math.max(0.5, (need - steps[k] * sin) / cos);
  }
  // The front row's seat: its floor (and a neck's funnel) clear of the bed where the tilt dips it.
  const ys = [RACK.floor + R * sin + (s.floor === 'neck' ? (R - neckRadius(s, R)) * cos : 0) + 0.4];
  for (let k = 1; k < n; k++) ys[k] = ys[k - 1] + steps[k - 1];
  // Back to front: the back row's cups against the back plate; but a closed floor's hollow, leaning back under it, must
  // still come out at the bed in front of the plate (or it's sealed in).
  const zs: number[] = [];
  const rmin = Math.min(...rows[n - 1]);
  const open = s.floor === 'closed' ? ys[n - 1] * tan - rmin / cos + Math.min(rmin, 2) : 0;
  zs[n - 1] = RACK.back + Math.max(rmax[n - 1] * cos, open);
  for (let k = n - 2; k >= 0; k--) zs[k] = zs[k + 1] + gaps[k];
  const cups: RackCup[] = [];
  let top = 0;
  let depth = 0;
  rows.forEach((row, k) =>
    row.forEach((r, i) => {
      cups.push({ x: xs[k][i], y: ys[k], z: zs[k], r });
      top = Math.max(top, ys[k] + s.cup * cos + (r + w) * sin);
      depth = Math.max(depth, zs[k] + s.cup * sin + (r + w) * cos);
    }),
  );
  const zl = zs[0] - ys[0] * tan;
  const zf = zl + (rmax[0] + w) / cos + RACK.label;
  if (s.label) depth = Math.max(depth, zf);
  return { cups, w: W, top, depth, y0: ys[0], zl, zf, steps };
}

/** Width the mounts need at the least. */
export const rackMinWidth = (ctx: MountCtx) => 2 * (mountBox('clip', [0, 0], ctx).x1 + MOUNT.margin);

/** Size on the wall and mounts: as tall as the cups, and room for a stud row under the clips (a full rack is heavy). */
export function rackLayout(s: RackSpec, ctx: MountCtx) {
  const p = rackPlan(s, rackMinWidth(ctx));
  const h = Math.max(p.top, minHeight(ctx) + 2 * ctx.pitch);
  const m = backMounts(p.w, h, ctx, { rows: 3 });
  return { w: p.w, h, depth: p.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' as const };
}

/**
 * Where a rack's back is clear for bolts: over its cups' tops, when the back stands 9 mm or more above them (the
 * clips need the height); the cups stand in front of the rest of it.
 */
export function rackBack(s: RackSpec, l: { w: number; h: number }): BackPlate | null {
  const top = rackPlan(s, l.w).top;
  return l.h - top >= 9 ? { x0: 0, x1: l.w, y0: top, y1: l.h, z: RACK.back } : null;
}

/** Too far out for its back, or a step cut back at this tilt. */
export function rackNotes(s: RackSpec, ctx: MountCtx): string[] {
  const l = rackLayout(s, ctx);
  const out = leverNotes(l.depth, l.h);
  const cut = Math.min(...rackPlan(s).steps);
  if (cut < s.step - 0.05) out.push(`At ${s.tilt}° the rows step up ${Math.floor(cut * 10) / 10} mm at most, or they'd part: less tilt for a bigger step.`);
  return out;
}

/** Rows of `columns`, every other one a cup shorter when staggered. */
export const gridRows = (size: number, columns: number, rows: number, stagger: boolean) =>
  Array.from({ length: rows }, (_, k) => Array<number>(stagger && k % 2 && columns > 1 ? columns - 1 : columns).fill(size));

export interface BottleRackOptions {
  shape: 'round' | 'square';
  /** The bottle's diameter (or a square one's width), mm. */
  diameter: number;
  corner: number;
  /** Each side, mm. */
  clearance: number;
  columns: number;
  rows: number;
  stagger: boolean;
  step: number;
  tilt: number;
  cup: number;
  floor: RackFloor;
  /** Upside down: the cap's diameter, mm. */
  neck: number;
  label: boolean;
  wall: number;
}

export const BOTTLE_RACK_DEFAULTS: BottleRackOptions = {
  shape: 'round',
  diameter: 25,
  corner: 4,
  clearance: 0.5,
  columns: 6,
  rows: 3,
  stagger: false,
  step: 12,
  tilt: 0,
  cup: 30,
  floor: 'hole',
  neck: 17,
  label: true,
  wall: 1.6,
};

export const RACK_FLOORS = ['closed', 'hole', 'ring', 'neck'] as const;

export function bottleSpec(o: BottleRackOptions): RackSpec {
  const round = o.shape === 'round';
  const a = o.diameter + 2 * o.clearance;
  return {
    shape: o.shape,
    rows: gridRows(a, o.columns, o.rows, o.stagger && round),
    corner: o.corner,
    wall: o.wall,
    step: o.step,
    tilt: o.tilt,
    cup: o.cup,
    floor: o.floor,
    neck: o.neck + 2 * o.clearance,
    label: o.label,
  };
}

registerAttachment<BottleRackOptions>({
  type: 'bottleRack',
  defaults: BOTTLE_RACK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = BOTTLE_RACK_DEFAULTS;
    return {
      shape: pick(r.shape, ['round', 'square'] as const, d.shape),
      diameter: num(r.diameter, 3, 150, d.diameter),
      corner: num(r.corner, 0, 30, d.corner),
      clearance: num(r.clearance, 0, 3, d.clearance),
      columns: int(r.columns, 1, 20, d.columns),
      rows: int(r.rows, 1, 8, d.rows),
      stagger: bool(r.stagger, d.stagger),
      step: num(r.step, 0, 60, d.step),
      tilt: num(r.tilt, 0, 30, d.tilt),
      cup: num(r.cup, 5, 150, d.cup),
      floor: pick(r.floor, RACK_FLOORS, d.floor),
      neck: num(r.neck, 4, 60, d.neck),
      label: bool(r.label, d.label),
      wall: num(r.wall, 1.2, 4, d.wall),
    };
  },
  layout: (o, ctx) => rackLayout(bottleSpec(o), ctx),
  summary: (o) => `Bottle rack ${o.columns} × ${o.rows}, ${o.shape === 'square' ? '□' : '⌀'}${Math.round(o.diameter * 10) / 10}`,
  notes: (o, ctx) => rackNotes(bottleSpec(o), ctx),
  backPlate: (o, l) => rackBack(bottleSpec(o), l),
  // A bottle about 2.5 times as tall as its cup is deep (as the presets' cups are), 0.8 g a cm³ with the air in it.
  load: (o, l) => ({
    kg: bottleSpec(o).rows.flat().length * (o.shape === 'round' ? Math.PI / 4 : 1) * o.diameter ** 2 * 2.5 * o.cup * 0.8e-6,
    at: l.depth / 2,
  }),
});
