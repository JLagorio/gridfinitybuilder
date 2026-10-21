import type { ScenePaint, SceneItem } from './Viewer';
import type { EnclosureScene, EnclosureSceneItem } from '../lib/enclosures';

/** How the drawer view shows a carry case's lid. */
export type LidView = 'closed' | 'open' | 'off';

const COLORS: Record<EnclosureSceneItem['role'], string> = {
  lid: '#9db4cc',
  hardware: '#5f6b7a',
  handle: '#e0a849',
  foot: '#3b3f46',
  strip: '#c8a86e',
  cleat: '#8d6e63',
};

/** The enclosure's extra parts for the drawer view (plate coordinates; spread with the pieces). */
export function enclosureSceneItems(enc: EnclosureScene, lid: LidView, gap: number, paint?: (role: EnclosureSceneItem['role']) => ScenePaint | undefined): SceneItem[] {
  const out: SceneItem[] = [];
  for (const it of enc.items) {
    if (it.when === 'closed' && lid !== 'closed') continue;
    if (it.when === 'open' && lid !== 'open') continue;
    if (lid === 'off' && (it.role === 'lid' || it.role === 'handle')) continue;
    out.push({
      id: it.id,
      meshKey: it.meshKey,
      x: it.x + (it.col ?? 0) * gap,
      y: it.y + (it.row ?? 0) * gap,
      z: it.z,
      w: it.w,
      d: it.d,
      h: it.h,
      color: COLORS[it.role],
      ...(paint?.(it.role) ? { paint: paint(it.role) } : {}),
    });
  }
  return out;
}

/** Move a whole scene (spacer drawers: the grid sits inside its strips, in the drawer outline). */
export function shiftItems(items: SceneItem[], shift: { x: number; y: number } | undefined): SceneItem[] {
  if (!shift || (!shift.x && !shift.y)) return items;
  return items.map((it) => ({ ...it, x: it.x + shift.x, y: it.y + shift.y }));
}
