/**
 * Adapter plate: a flat plate with clips on its back, to fix anything to the
 * board. Screw holes on a grid, countersunk from the back (screw from behind
 * into what it holds, then clip it on); pairs of zip-tie slots with a channel
 * behind for the tie; 6 × 2 mm magnet pockets in the front corners; a shallow
 * recess in the front for double-sided tape. Holes keep clear of the mounts.
 * Printed upright, as it hangs.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type AttachmentHardware, type AttachmentLayout, type MountCtx } from '../registry';

export interface PlateOptions {
  width: number;
  height: number;
  thick: number;
  screws: 'none' | 'm3' | 'm4';
  /** Screw hole grid step, mm. */
  pitch: number;
  ties: boolean;
  magnets: boolean;
  /** A recess in the front for VHB tape. */
  tape: boolean;
}

export const PLATE_DEFAULTS: PlateOptions = { width: 80, height: 80, thick: 5, screws: 'm3', pitch: 20, ties: false, magnets: false, tape: false };

/** Screw holes: clearance hole and countersunk head diameters, mm. */
export const PLATE_SCREWS = { m3: [3.4, 6.4], m4: [4.5, 8.6] } as const;

/** The screw hole grid: centred, `ni` and `nj` holes each side of the middle, `edge` clear of the plate's edges (the head's radius + 1). */
export function screwGrid(o: PlateOptions, h: number) {
  const edge = (o.screws === 'none' ? 0 : PLATE_SCREWS[o.screws][1]) / 2 + 1;
  const n = (size: number) => Math.max(-1, Math.floor((size - 2 * edge) / o.pitch / 2 + 1e-9));
  return { edge, ni: n(o.width), nj: n(h) };
}

/** Zip-tie slot pairs across a plate `w` wide: one every 30 mm. */
export const tiePairs = (w: number) => (w < 26 ? 0 : Math.floor((w - 6) / 30) || 1);

/** Height of the row of zip-tie slots: a step below the clips, clear of them and of the studs; null when that's off the plate. */
export const tieRow = (l: Pick<AttachmentLayout, 'anchor'>, ctx: MountCtx) => (l.anchor[1] - ctx.pitch >= 5 ? l.anchor[1] - ctx.pitch : null);

const plateLayout = (o: PlateOptions, ctx: MountCtx): AttachmentLayout => {
  const h = Math.max(o.height, minHeight(ctx));
  const m = backMounts(o.width, h, ctx, { rows: 3 });
  return { w: o.width, h, depth: o.thick, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
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
      screws: pick(r.screws, ['none', 'm3', 'm4'] as const, d.screws),
      pitch: num(r.pitch, 10, 80, d.pitch),
      ties: bool(r.ties, d.ties),
      magnets: bool(r.magnets, d.magnets),
      tape: bool(r.tape, d.tape),
    };
  },
  layout: plateLayout,
  summary: (o) => `Adapter plate ${Math.round(o.width)} × ${Math.round(o.height)}`,
  notes: (o, ctx) =>
    o.ties && (!tiePairs(o.width) || tieRow(plateLayout(o, ctx), ctx) === null)
      ? ['Too small for zip-tie slots: they need about 26 × 35 mm below the clips.']
      : [],
  labelFace: (o, l) => (o.tape ? null : { x: 3, y: 1.5, w: l.w - 6, h: Math.min(8, l.h / 4), z: o.thick, normal: 'front' }),
  backPlate: (o, l) => ({ x0: 0, x1: l.w, y0: 0, y1: l.h, z: o.thick }),
  hardware(o) {
    const out: AttachmentHardware[] = [];
    const g = screwGrid(o, o.height);
    const holes = Math.max(0, 2 * g.ni + 1) * Math.max(0, 2 * g.nj + 1);
    if (o.screws !== 'none' && holes > 0)
      out.push({
        item: `Countersunk screws ${o.screws.toUpperCase()}`,
        count: Math.min(4, holes),
        note: `from the back, into what it holds (the plate is ${o.thick} mm)`,
      });
    if (o.magnets) out.push({ item: 'Magnets 6 × 2 mm (adapter plate)', count: 4, note: 'glued into the front' });
    if (o.ties && tiePairs(o.width)) out.push({ item: 'Zip ties, up to 5 mm wide', count: tiePairs(o.width) });
    if (o.tape) out.push({ item: 'VHB double-sided tape', count: 1, note: `${Math.round(o.width - 6)} × ${Math.round(o.height - 6)} mm` });
    return out;
  },
});
