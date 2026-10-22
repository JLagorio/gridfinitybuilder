/**
 * Folding hook: a hook, or a cup holder, on a pin between two cheeks, that
 * folds up flat in front of the board when it isn't in use. Folded is its
 * home. Unfolded it stops level: under a load its heel, behind and below the
 * pin, swings back onto the back plate, which bears the load. A bump on the
 * arm's side clicks into a dimple in the cheek folded and open, so it stays
 * where it's put.
 *
 * The base prints upright as it hangs (back plate and cheeks standing on the
 * bed, teardrop pin holes, the pin's head sunk in the left cheek); the hook's
 * arm prints on its side, its profile flat on the bed so its layers run
 * along it; the cup holder's arm prints flat, as it lies open. Clips across
 * the top of the back, studs below.
 */
import { backMounts, minHeight } from '../mount';
import { num, obj, pick, registerAttachment, type AttachmentPart } from '../registry';
import { PIN, pinAlongX, pinHardware, pinPart, type PinKind } from './hinge';

export interface FoldHookOptions {
  style: 'hook' | 'cup';
  /** The hook's reach from the pin, mm. */
  reach: number;
  /** The arm's width across, mm. */
  width: number;
  /** The hook's arm, top to bottom, and its tip, mm. */
  arm: number;
  tip: number;
  /** The cup holder's inside diameter, mm. */
  cup: number;
  pin: PinKind;
}

export const FOLD_DEFAULTS: FoldHookOptions = { style: 'hook', reach: 60, width: 10, arm: 8, tip: 12, cup: 70, pin: 'printed' };

/**
 * mm: back plate; cheeks, the gap each side of the arm; the knuckle's radius round the pin (the arm's root), the
 * cheeks' radius round it, how high the pin is (the heel swings down past the pin, folding, and stays 1 mm up); the
 * heel's reach behind the pin at most, the gap between it and what it stops on;
 * the gap between heel and back plate; the cup holder's ring wall, height and floor; the detent bump's distance
 * from the pin, its height and the dimple's radius and depth.
 */
export const FOLD = {
  back: 3,
  cheek: 4,
  gap: 0.3,
  knuckle: 6,
  boss: 9,
  yp: 11,
  heel: 8,
  stop: 0.3,
  ring: 2.4,
  ringH: 14,
  floor: 2,
  bump: 4.2,
  bumpH: 0.5,
  dimple: 1.5,
  dimpleD: 0.8,
} as const;

/**
 * Where things are: the pin (z, y), how far the heel reaches back and the front of what stops it, the cup's ring
 * (outer radius, its centre out from the pin), how far the arm reaches from the pin, how high its top is above the
 * pin when open (the tip), the cheeks' width across, the width and the arm's middle across it, and the height.
 */
export function foldPlan(o: FoldHookOptions) {
  const F = FOLD;
  const k = F.knuckle;
  const cup = o.style === 'cup';
  const ro = o.cup / 2 + 0.5 + F.ring;
  const rc = ro + F.boss + 3;
  // Folded, what stood up from the arm points back at the board: it stops 1 mm short of the back plate.
  const top = cup ? F.ringH - k : o.arm - k + o.tip;
  const zp = F.back + 1 + Math.max(top, k);
  const reach = cup ? rc + ro : o.reach;
  const base = 2 * F.cheek + 2 * F.gap + o.width;
  const w = cup ? Math.max(base, 2 * ro + 2) : base;
  // The heel reaches back to the back plate, or to a pad on it when the pin is far out.
  const heel = Math.min(F.heel, zp - F.back - F.stop);
  return { k, zp, yp: F.yp, heel, pad: zp - heel - F.stop, ro, rc, reach, top, base, w, xc: w / 2, h: F.yp + reach + 2 };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

registerAttachment<FoldHookOptions>({
  type: 'foldHook',
  defaults: FOLD_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = FOLD_DEFAULTS;
    return {
      style: pick(r.style, ['hook', 'cup'] as const, d.style),
      reach: num(r.reach, 30, 150, d.reach),
      width: num(r.width, 8, 30, d.width),
      arm: num(r.arm, 6, 12, d.arm),
      tip: num(r.tip, 5, 30, d.tip),
      cup: num(r.cup, 40, 110, d.cup),
      pin: pick(r.pin, ['printed', 'steel'] as const, d.pin),
    };
  },
  layout(o, ctx) {
    const p = foldPlan(o);
    const h = Math.max(p.h, minHeight(ctx));
    const m = backMounts(p.w, h, ctx, { rows: 3 });
    return { w: p.w, h, depth: p.zp + FOLD.boss, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => (o.style === 'cup' ? `Folding cup holder ⌀${Math.round(o.cup)}` : `Folding hook ${Math.round(o.reach)} mm`),
  backPlate(o, l) {
    // Over the cheeks, and beside them on a wide base (over its feet): unfold the arm to reach it.
    const p = foldPlan(o);
    const xl = p.xc - p.base / 2;
    const xr = p.xc + p.base / 2;
    const plate = (x0: number, x1: number, y0: number) => ({ x0, x1, y0, y1: l.h, z: FOLD.back });
    return [plate(0, l.w, p.yp + FOLD.boss), plate(0, xl, 2), plate(xr, l.w, 2)];
  },
  parts(o) {
    const p = foldPlan(o);
    const F = FOLD;
    const x0 = p.xc - o.width / 2;
    const out: AttachmentPart[] = [];
    // Shown folded up. Open, the arm spans z −heel..reach and y −k..max(k, top) from the pin; folded, z → −y, y → z.
    const zTop = Math.max(p.k, p.top);
    if (o.style === 'hook')
      // Printed on its side (its +x face, with the bump, up).
      out.push({
        key: 'arm',
        name: 'Hook arm',
        spec: { ...o, p: 'arm' },
        w: r2(p.k + zTop),
        d: r2(p.heel + p.reach),
        h: r2(o.width + F.bumpH),
        place: { at: [r2(x0), r2(p.yp - p.heel), r2(p.zp - zTop)], turn: [0, 90, 0] },
      });
    else
      // Printed flat, as it lies open; folded, half a turn about x from as printed.
      out.push({
        key: 'arm',
        name: 'Cup holder',
        spec: { ...o, p: 'arm' },
        w: r2(2 * p.ro),
        d: r2(p.heel + p.reach),
        h: F.ringH,
        place: { at: [r2(p.xc - p.ro), r2(p.yp - p.heel), r2(p.zp - p.top)], turn: [180, 0, 0] },
      });
    if (o.pin === 'printed') {
      // Through the cheeks, its head sunk in the left one.
      const len = p.base - PIN.boreT - 0.5;
      out.push(pinPart('pin', len, pinAlongX(p.xc - p.base / 2 + PIN.boreT - PIN.headT, p.yp, p.zp, len)));
    }
    return out;
  },
  hardware: (o) => pinHardware(o.pin, 1, foldPlan(o).base - 1),
});
