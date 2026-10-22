/**
 * Charger cradle: a pocket for a power-tool charger, lying flat (a pack
 * slides on and off it in place) or stood on its end, 1 mm clear all round.
 * Side walls slope from the back plate down to a low front lip, so the pack
 * and the charger's lights stay in reach; the cord goes out through the floor
 * at the back or a notch in the side. Printed upright as it hangs: the floor
 * on the bed, the walls standing on it, which carry the floor like gussets.
 * Clips across the top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';
import { KG } from '../load';

export interface ChargerCradleOptions {
  /** The charger lying flat, mm: across, front to back, top to bottom. */
  width: number;
  depth: number;
  height: number;
  /** Lying flat, or stood on its end (its bottom against the board). */
  stand: 'flat' | 'upright';
  cord: 'floor' | 'side' | 'none';
  /** Front lip above the floor, mm. */
  lip: number;
  /** Back plate height, mm. */
  back: number;
}

/** DeWalt DCB112. */
export const CHARGER_DEFAULTS: ChargerCradleOptions = { width: 145, depth: 115, height: 65, stand: 'flat', cord: 'floor', lip: 15, back: 70 };

/** Back plate, floor, side and front walls, clearance each side, the cord's slot (width, length), mm. */
export const CHARGER = { back: 4, floor: 4, side: 3, front: 3, fit: 1, cord: 14, cordL: 22 } as const;

/** The front lip's height above the floor (no taller than the charger). */
const chargerLip = (o: ChargerCradleOptions) => Math.min(o.lip, o.stand === 'flat' ? o.height : o.depth);

/** The pocket: across x0..x1, out z0..z1, how tall the charger stands in it, the lip; the part's size. */
export function chargerPocket(o: ChargerCradleOptions, ctx: MountCtx) {
  const c = CHARGER;
  const out = o.stand === 'flat' ? o.depth : o.height;
  const tall = o.stand === 'flat' ? o.height : o.depth;
  const x1 = c.side + o.width + 2 * c.fit;
  const z1 = c.back + out + 2 * c.fit;
  const lip = chargerLip(o);
  const h = Math.max(o.back, minHeight(ctx), c.floor + lip);
  return { x0: c.side, x1, z0: c.back, z1, tall, lip, w: x1 + c.side, d: z1 + c.front, h };
}

registerAttachment<ChargerCradleOptions>({
  type: 'chargerCradle',
  defaults: CHARGER_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CHARGER_DEFAULTS;
    return {
      width: num(r.width, 40, 300, d.width),
      depth: num(r.depth, 30, 250, d.depth),
      height: num(r.height, 15, 150, d.height),
      stand: pick(r.stand, ['flat', 'upright'] as const, d.stand),
      cord: pick(r.cord, ['floor', 'side', 'none'] as const, d.cord),
      lip: num(r.lip, 4, 60, d.lip),
      back: num(r.back, 30, 200, d.back),
    };
  },
  layout(o, ctx) {
    const p = chargerPocket(o, ctx);
    const m = backMounts(p.w, p.h, ctx, { rows: 3 });
    return { w: p.w, h: p.h, depth: p.d, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Charger cradle ${Math.round(o.width)} × ${Math.round(o.depth)}${o.stand === 'upright' ? ', on its end' : ''}`,
  labelFace(o, l) {
    // The front lip.
    const lip = CHARGER.floor + chargerLip(o);
    return { x: CHARGER.side + 1, y: 0.6, w: l.w - 2 * CHARGER.side - 2, h: lip - 1.2, z: l.depth, normal: 'front' };
  },
  backPlate(o, l) {
    // Over the front lip (a screwdriver reaches in over it), between the side walls.
    return { x0: CHARGER.side, x1: l.w - CHARGER.side, y0: CHARGER.floor + chargerLip(o), y1: l.h, z: CHARGER.back };
  },
  notes(o, ctx) {
    const p = chargerPocket(o, ctx);
    return leverNotes(p.d, p.h);
  },
  // The charger, and a pack on it: about 1 kg a litre.
  load: (o) => ({ kg: o.width * o.depth * o.height * KG.full, at: CHARGER.back + (o.stand === 'flat' ? o.depth : o.height) / 2 }),
});
