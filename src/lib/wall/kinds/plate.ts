/**
 * Adapter plate: a flat plate with clips on its back, to fix anything to the
 * board. Screw holes on a grid, countersunk from the back (screw from behind
 * into what it holds, then clip it on), or a device's own hole pattern:
 * VESA 75 / 100 (M4) and 2.5″ drives (M3) the same way, a Raspberry Pi or Pi
 * Zero on four 5 mm standoffs on the front (M2.5 screws through the board
 * into them, clear of the parts under it); pairs of zip-tie slots with a
 * channel behind for the tie; 6 × 2 mm magnet pockets in the front corners;
 * a shallow recess in the front for double-sided tape. Grid holes keep clear
 * of the mounts; a pattern's holes are where the device has them (the
 * presets' sizes keep them off the mounts). Printed upright, as it hangs.
 */
import { backMounts, minHeight, mountBox, siteAt } from '../mount';
import { bool, num, obj, pick, registerAttachment, type AttachmentHardware, type AttachmentLayout, type MountCtx } from '../registry';
import type { Vec2 } from '../../geometry/kernel';

export const PLATE_PATTERNS = ['grid', 'vesa75', 'vesa100', 'pi', 'piZero', 'ssd'] as const;
export type PlatePattern = (typeof PLATE_PATTERNS)[number];

export interface PlateOptions {
  width: number;
  height: number;
  thick: number;
  /** Screw holes on a grid, or a device's hole pattern. */
  pattern: PlatePattern;
  screws: 'none' | 'm3' | 'm4';
  /** Screw hole grid step, mm. */
  pitch: number;
  ties: boolean;
  magnets: boolean;
  /** A recess in the front for VHB tape. */
  tape: boolean;
}

export const PLATE_DEFAULTS: PlateOptions = {
  width: 80,
  height: 80,
  thick: 5,
  pattern: 'grid',
  screws: 'm3',
  pitch: 20,
  ties: false,
  magnets: false,
  tape: false,
};

/** Screw holes: clearance hole and countersunk head diameters, mm. */
export const PLATE_SCREWS = { m3: [3.4, 6.4], m4: [4.5, 8.6] } as const;

/** Device hole patterns: the holes' spacing across and up, mm, and their screw ('m2.5': the Pi's, into standoffs). */
export const HOLE_PATTERNS = {
  vesa75: [75, 75, 'm4'],
  vesa100: [100, 100, 'm4'],
  pi: [58, 49, 'm2.5'],
  piZero: [58, 23, 'm2.5'],
  ssd: [61.72, 76.6, 'm3'],
} as const;

/** A Pi's standoffs on the front: diameter, height and the pilot hole for an M2.5 screw, mm. */
export const PI_STANDOFF = { d: 6, h: 5, pilot: 2.3 } as const;

const NAMES = { vesa75: 'VESA 75', vesa100: 'VESA 100', pi: 'Raspberry Pi', piZero: 'Pi Zero', ssd: '2.5″ drive' } as const;

/** The screw hole grid: centred, `ni` and `nj` holes each side of the middle, `edge` clear of the plate's edges (the head's radius + 1). */
export function screwGrid(o: PlateOptions, h: number) {
  const edge = (o.screws === 'none' ? 0 : PLATE_SCREWS[o.screws][1]) / 2 + 1;
  const n = (size: number) => Math.max(-1, Math.floor((size - 2 * edge) / o.pitch / 2 + 1e-9));
  return { edge, ni: n(o.width), nj: n(h) };
}

/** A pattern's holes and how much room each needs round it (a head's or a standoff's radius), on a plate `w` × `h`; none on a grid plate. */
export function patternHoles(o: PlateOptions, w: number, h: number): { at: Vec2[]; r: number } {
  if (o.pattern === 'grid') return { at: [], r: 0 };
  const [dx, dy, screw] = HOLE_PATTERNS[o.pattern];
  const at: Vec2[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) at.push([w / 2 + (sx * dx) / 2, h / 2 + (sy * dy) / 2]);
  return { at, r: screw === 'm2.5' ? PI_STANDOFF.d / 2 : PLATE_SCREWS[screw][1] / 2 };
}

/** Zip-tie slot pairs across a plate `w` wide: one every 30 mm. */
export const tiePairs = (w: number) => (w < 26 ? 0 : Math.floor((w - 6) / 30) || 1);

/** Height of the row of zip-tie slots: a step below the clips, clear of them and of the studs; null when that's off the plate. */
export const tieRow = (l: Pick<AttachmentLayout, 'anchor'>, ctx: MountCtx) => (l.anchor[1] - ctx.pitch >= 5 ? l.anchor[1] - ctx.pitch : null);

const plateLayout = (o: PlateOptions, ctx: MountCtx): AttachmentLayout => {
  // A pattern needs the plate at least as big as its holes and the room round them.
  const p = o.pattern === 'grid' ? null : HOLE_PATTERNS[o.pattern];
  const r = patternHoles(o, 0, 0).r + 1;
  const w = p ? Math.max(o.width, p[0] + 2 * r) : o.width;
  const h = Math.max(o.height, minHeight(ctx), p ? p[1] + 2 * r : 0);
  const m = backMounts(w, h, ctx, { rows: 3 });
  const pi = p?.[2] === 'm2.5';
  return { w, h, depth: o.thick + (pi ? PI_STANDOFF.h : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
};

registerAttachment<PlateOptions>({
  type: 'plate',
  defaults: PLATE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = PLATE_DEFAULTS;
    return {
      width: num(r.width, 20, 300, d.width),
      height: num(r.height, 20, 300, d.height),
      thick: num(r.thick, 3, 10, d.thick),
      pattern: pick(r.pattern, PLATE_PATTERNS, d.pattern),
      screws: pick(r.screws, ['none', 'm3', 'm4'] as const, d.screws),
      pitch: num(r.pitch, 10, 80, d.pitch),
      ties: bool(r.ties, d.ties),
      magnets: bool(r.magnets, d.magnets),
      tape: bool(r.tape, d.tape),
    };
  },
  layout: plateLayout,
  summary: (o) => (o.pattern === 'grid' ? `Adapter plate ${Math.round(o.width)} × ${Math.round(o.height)}` : `${NAMES[o.pattern]} plate`),
  notes(o, ctx) {
    const l = plateLayout(o, ctx);
    const out: string[] = [];
    if (o.ties && (!tiePairs(o.width) || tieRow(l, ctx) === null)) out.push('Too small for zip-tie slots: they need about 26 × 35 mm below the clips.');
    // Screws from the back go through the plate: none where a mount is (standoffs are on the front).
    const { at, r } = patternHoles(o, l.w, l.h);
    const boxes = l.mounts.map((m) => mountBox(m.kind, siteAt(l, m, ctx), ctx));
    if (!/pi/.test(o.pattern) && at.some(([x, y]) => boxes.some((b) => x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r)))
      out.push('A screw hole lands on a clip or stud: make the plate a little wider or taller.');
    if (/vesa/.test(o.pattern)) out.push('For a monitor: keep it to 2 kg, and screw the board to the wall studs.');
    return out;
  },
  hardware(o) {
    const out: AttachmentHardware[] = [];
    const g = screwGrid(o, o.height);
    const holes = Math.max(0, 2 * g.ni + 1) * Math.max(0, 2 * g.nj + 1);
    if (o.pattern === 'grid' && o.screws !== 'none' && holes > 0)
      out.push({
        item: `Countersunk screws ${o.screws.toUpperCase()}`,
        count: Math.min(4, holes),
        note: `from the back, into what it holds (the plate is ${o.thick} mm)`,
      });
    if (/vesa/.test(o.pattern)) out.push({ item: `Countersunk screws M4 × ${Math.ceil(o.thick + 4)}`, count: 4, note: 'from the back, into the monitor' });
    if (o.pattern === 'ssd') out.push({ item: `Countersunk screws M3 × ${Math.ceil(o.thick + 3)}`, count: 4, note: 'from the back, into the drive' });
    if (/pi/.test(o.pattern)) out.push({ item: 'Screws M2.5 × 6', count: 4, note: 'through the board, into the standoffs' });
    if (o.magnets) out.push({ item: 'Magnets 6 × 2 mm (adapter plate)', count: 4, note: 'glued into the front' });
    if (o.ties && tiePairs(o.width)) out.push({ item: 'Zip ties, up to 5 mm wide', count: tiePairs(o.width) });
    if (o.tape) out.push({ item: 'VHB double-sided tape', count: 1, note: `${Math.round(o.width - 6)} × ${Math.round(o.height - 6)} mm` });
    return out;
  },
});
