/**
 * Starting shapes for the custom attachment (kinds/custom.ts): side profiles (z out from the board, y up, mm; see
 * ./profile.ts) for the usual pegboard accessories, with the add-ons and features that suit them. Each reaches into
 * the back plate (z from 0) and fits a 60 mm plate. Every one prints upright except where noted.
 */
import type { Vec2 } from '../../geometry/kernel';
import type { Feature } from './profile';

export interface ProfilePreset {
  label: string;
  title: string;
  profile: Vec2[];
  width: number;
  height: number;
  ends: 'none' | 'walls' | 'gussets';
  features?: Feature[];
}

/** A quarter-to-half circle of points round (cz, cy), from a0 to a1 degrees. */
const arc = (cz: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    return [Math.round((cz + r * Math.cos(a)) * 10) / 10, Math.round((cy + r * Math.sin(a)) * 10) / 10] as Vec2;
  });

export const PRESETS = {
  ledge: {
    label: 'Ledge',
    title: 'A flat shelf at the foot of the plate, a fillet where they meet, gussets at the ends',
    profile: [
      [0, 0],
      [60, 0],
      [60, 5],
      [9, 5],
      [4, 10],
      [0, 10],
    ],
    width: 80,
    height: 60,
    ends: 'gussets',
  },
  tray: {
    label: 'Lipped tray',
    title: 'A floor with a lip along its front, closed at the ends',
    profile: [
      [0, 0],
      [70, 0],
      [70, 22],
      [67.6, 22],
      [67.6, 3],
      [0, 3],
    ],
    width: 100,
    height: 60,
    ends: 'walls',
  },
  jhook: {
    label: 'J-hook',
    title: 'An arm out from the foot of the plate with an upturned tip',
    profile: [
      [0, 0],
      [46, 0],
      [50, 4],
      [50, 18],
      [44, 18],
      [44, 8],
      [42, 6],
      [0, 6],
    ],
    width: 20,
    height: 60,
    ends: 'none',
  },
  cradle: {
    label: 'U-cradle',
    title: 'A round-bottomed cradle for a hose, a cable or a tool',
    profile: [[0, 0], [34, 0], [34, 24], [29, 24], ...arc(16.5, 16, 12.5, 0, -180, 8), [0, 16]],
    width: 40,
    height: 60,
    ends: 'none',
  },
  tilted: {
    label: 'Tilted tray',
    title: 'Its floor slopes back 15°, so things lean against the plate; a 45° underside',
    profile: [
      [0, 0],
      [43, 0],
      [60, 17],
      [60, 26],
      [57.6, 26],
      [57.6, 19.5],
      [4, 5],
      [0, 5],
    ],
    width: 80,
    height: 60,
    ends: 'walls',
  },
  bracket: {
    label: 'L-bracket',
    title: 'A shelf bracket: an arm along the top of the plate on a 45° brace',
    profile: [
      [0, 4],
      [2, 4],
      [54, 56],
      [54, 60],
      [0, 60],
    ],
    width: 20,
    height: 60,
    ends: 'none',
  },
  tools: {
    label: 'Angled tool holder',
    title: 'A block whose top leans back 18°, with holes so the tools lean against the board',
    profile: [
      [0, 0],
      [24, 0],
      [40, 16],
      [40, 24],
      [4, 12],
      [0, 12],
    ],
    width: 80,
    height: 60,
    ends: 'none',
    features: [{ f: 3, k: 'round', a: 8, b: 8, d: 0, u: 0, v: 0, n: 5, m: 1, su: 14, sv: 14 }],
  },
} satisfies Record<string, ProfilePreset>;

export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/** The options a preset sets (kinds/custom.ts CustomOptions), its add-ons reset. */
export function presetOptions(key: PresetKey) {
  const p: ProfilePreset = PRESETS[key];
  return {
    preset: key,
    width: p.width,
    height: p.height,
    profile: p.profile.map((q) => [...q] as Vec2),
    pose: 'auto' as const,
    features: (p.features ?? []).map((f) => ({ ...f })),
    lip: 0,
    dividers: 0,
    ends: p.ends,
  };
}
