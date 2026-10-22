/**
 * Device mount: a standard fixing on a platform at the end of an arm out
 * from the board, tilted down if you like (a webcam looking at the bench).
 * The fixings:
 * - '1/4-20' and '3/8-16' camera threads: a hexagon under the platform
 *   takes the head of a short hex bolt (the same size across flats as its
 *   nut), its thread standing up through the platform as the stud the
 *   camera or ball head screws onto; a nut fits the hexagon instead, for a
 *   device with a stud of its own. Bought bolts beat printed threads.
 * - '5/8-27' microphone thread: the 3/8″ stud with a 5/8″-27 adapter on it.
 * - 'gopro': three fingers 3 mm thick, 3.2 mm apart (or two, `fingers`), an
 *   M5 bolt through them, for action cameras and their accessories.
 * - 'arca': an Arca-Swiss-style seat: a 45° dovetail channel 38.6 mm wide at
 *   its floor that a camera's plate slides into from the front, an M5 thumb
 *   screw through the side to lock it (plates vary from 38 to 38.8 mm).
 * - 'coldshoe': a cold shoe for lights and microphones, the 18.6 × 2 mm foot
 *   sliding in from the front under rails whose undersides lean 45°.
 * VESA, Raspberry Pi and 2.5″ drive hole patterns are on the adapter plate.
 *
 * Printed upright, as it hangs: the arm and the platform lie on the bed, the
 * back plate stands up from them, and the arm rises at 45° to the back
 * plate, so it is its own gusset. A tilted platform leans forward on a skirt
 * down to the bed; every face then leans at most the tilt (up to 45°).
 * Clips across the top of the back, studs below.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment, type AttachmentHardware, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export const FIXINGS = ['1/4-20', '3/8-16', '5/8-27', 'gopro', 'arca', 'coldshoe'] as const;
export type Fixing = (typeof FIXINGS)[number];

export interface MountBossOptions {
  fixing: Fixing;
  /** Out from the board to the middle of the fixing, mm. */
  reach: number;
  /** How far the platform tilts down at the front, degrees. */
  tilt: number;
  /** GoPro: two fingers or three. */
  fingers: number;
  /** The back plate's height, mm. */
  height: number;
}

export const BOSS_DEFAULTS: MountBossOptions = { fixing: '1/4-20', reach: 50, tilt: 0, fingers: 3, height: 60 };

/** The back plate's thickness, mm. */
export const BOSS_BACK = 4;

/** Each fixing's platform: width (across), depth (out from the board) and height, mm. */
export const BOSS_BLOCK: Record<Fixing, [number, number, number]> = {
  '1/4-20': [30, 30, 10],
  '3/8-16': [34, 34, 14],
  '5/8-27': [34, 34, 14],
  gopro: [24, 24, 6],
  arca: [54, 50, 12],
  coldshoe: [26, 26, 8],
};

/** GoPro fingers: their bolt's axis above the platform and their round tips' radius, mm. */
export const GOPRO_TIP = { axis: 10, r: 7.5 } as const;

/**
 * Where the platform is: its middle `zc` out from the board, its bottom's
 * middle `y0` up (its front edge on the bed once tilted), the tilt's sine
 * and cosine, and the farthest out and highest it (and what stands on it)
 * reaches.
 */
export function bossPlan(o: MountBossOptions) {
  const [bw, bd, bh] = BOSS_BLOCK[o.fixing];
  const t = (o.tilt * Math.PI) / 180;
  const sn = Math.sin(t);
  const cs = Math.cos(t);
  const zc = Math.max(o.reach, BOSS_BACK + bd / 2 + 2);
  const y0 = (bd / 2) * sn;
  let zMax = 0;
  let yMax = 0;
  for (const y of [0, bh])
    for (const z of [-bd / 2, bd / 2]) {
      zMax = Math.max(zMax, zc + y * sn + z * cs);
      yMax = Math.max(yMax, y0 + y * cs - z * sn);
    }
  if (o.fixing === 'gopro') {
    // The fingers' tips: a circle round the bolt's axis.
    const a = bh + GOPRO_TIP.axis;
    zMax = Math.max(zMax, zc + a * sn + GOPRO_TIP.r);
    yMax = Math.max(yMax, y0 + a * cs + GOPRO_TIP.r);
  }
  return { bw, bd, bh, zc, y0, sn, cs, zMax, yMax };
}

const bossSize = (o: MountBossOptions, ctx: MountCtx) => {
  const p = bossPlan(o);
  return { w: Math.max(50, p.bw + 4), h: Math.max(o.height, minHeight(ctx), Math.ceil(p.yMax + 2)), depth: p.zMax };
};

const NAMES: Record<Fixing, string> = {
  '1/4-20': '1/4″-20',
  '3/8-16': '3/8″-16',
  '5/8-27': '5/8″-27 mic',
  gopro: 'GoPro',
  arca: 'Arca 38',
  coldshoe: 'cold shoe',
};

const bolt = (size: string, long: string): AttachmentHardware => ({
  item: `${size} hex bolt, ${long} long`,
  count: 1,
  note: 'its head drops into the hexagon under the platform (or a nut, for a device with a stud)',
});

registerAttachment<MountBossOptions>({
  type: 'mountBoss',
  defaults: BOSS_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = BOSS_DEFAULTS;
    return {
      fixing: pick(r.fixing, FIXINGS, d.fixing),
      reach: num(r.reach, 20, 150, d.reach),
      tilt: num(r.tilt, 0, 45, d.tilt),
      fingers: int(r.fingers, 2, 3, d.fingers),
      height: num(r.height, 30, 150, d.height),
    };
  },
  layout(o, ctx) {
    const { w, h, depth } = bossSize(o, ctx);
    const m = backMounts(w, h, ctx, { rows: 3 });
    return { w, h, depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Device mount ${NAMES[o.fixing]}`,
  backPlate(o, l) {
    // Beside the platform and the arm under it (the arm is never wider than the platform), and over them both: the arm
    // runs back at 45° from the top of the platform's back edge to the back plate (mountBoss.geom.ts).
    const p = bossPlan(o);
    const ya = p.y0 + p.bh * p.cs + (p.bd / 2) * p.sn;
    const za = p.zc + p.bh * p.sn - (p.bd / 2) * p.cs;
    const top = Math.min(l.h - 2, ya + za - BOSS_BACK);
    return [
      { x0: 0, x1: l.w / 2 - p.bw / 2, y0: 0, y1: l.h, z: BOSS_BACK },
      { x0: l.w / 2 + p.bw / 2, x1: l.w, y0: 0, y1: l.h, z: BOSS_BACK },
      { x0: 0, x1: l.w, y0: Math.max(top, p.yMax), y1: l.h, z: BOSS_BACK },
    ];
  },
  notes(o, ctx) {
    const s = bossSize(o, ctx);
    return leverNotes(s.depth, s.h);
  },
  hardware(o) {
    if (o.fixing === '1/4-20') return [bolt('1/4″-20', '3/8″')];
    if (o.fixing === '3/8-16') return [bolt('3/8″-16', '1/2″')];
    if (o.fixing === '5/8-27')
      return [bolt('3/8″-16', '1/2″'), { item: '5/8″-27 male to 3/8″-16 female thread adapter', count: 1, note: 'screws onto the stud; the mic clip onto it' }];
    if (o.fixing === 'gopro') return [{ item: 'GoPro thumb screw (M5) and nut', count: 1 }];
    if (o.fixing === 'arca')
      return [{ item: 'M5 thumb screw, 16 mm, and M5 nut', count: 1, note: 'the nut drops into the slot in the side; the screw locks the plate' }];
    return [];
  },
  // Anything, on the fixing.
  load: (o) => ({ kg: 0, at: o.reach }),
});
