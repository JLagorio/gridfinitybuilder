/**
 * A board's attachments in a print job (project.ts planParts hands each Skådis board here): each placed on the board
 * (plan.ts), its mesh and its part to print with the bins, its kind's extra parts and the mount standard's own (lock
 * keys, T-nuts), and the drawer view's items, extra parts shown where they sit. Loaded with the kinds (kinds/all.ts),
 * so the placing, the mount standard and the common options aren't on the first screen.
 */
import { setWallParts, type WallParts } from '../project';
import { attachmentDef } from './registry';
import { MOUNT_PARTS, attachmentKey, mountParts } from './plan';
import { attachmentView, placeAttachments } from './place';

export const planWallParts: WallParts = ({ list, board, drawer, prefix, label, bins, meshes, parts, binItems, items, warn }) => {
  const { placed, warnings } = placeAttachments(list, board);
  for (const msg of warnings) warn(msg);
  const ctx = board.ctx;
  for (const p of placed) {
    const def = attachmentDef(p.type)!;
    const meshKey = attachmentKey(p.type, p.opts, ctx, p.extras);
    meshes[meshKey] = { kind: 'attachment', key: meshKey, type: p.type, opts: p.opts, layout: p.layout, ctx, ...(p.extras ? { extras: p.extras } : {}) };
    const v = attachmentView(p, board);
    const key = `${prefix}att:${p.id}`;
    parts[key] = { key, name: `${label}${p.name}`, kind: 'attachment', meshKey, ...v.size, drawer, attachment: p.id };
    if (bins) binItems.push({ key, w: v.size.w, d: v.size.d });
    items.push({ id: `att-${p.id}`, pick: p.id, meshKey, x: v.at[0], y: v.at[1], z: v.at[2], ...v.size, turn: v.turn, role: 'attachment', when: 'always' });
    // Its kind's extra parts, then its lock keys and T-nuts (the mount standard's own, build.ts builds them).
    const extra = [...(def.parts?.(p.opts, ctx) ?? []).map((xp) => ({ xp, type: p.type })), ...mountParts(p, ctx).map((xp) => ({ xp, type: MOUNT_PARTS }))];
    for (const { xp, type } of extra) {
      const pk = `attpart|${type}|${JSON.stringify(xp.spec)}|${JSON.stringify(ctx)}`;
      meshes[pk] = { kind: 'attachmentPart', key: pk, type, part: xp.spec, ctx };
      const k = `${prefix}att:${p.id}:${xp.key}`;
      parts[k] = { key: k, name: `${label}${xp.name} (${p.name})`, kind: 'attachment', meshKey: pk, w: xp.w, d: xp.d, h: xp.h, drawer, attachment: p.id };
      if (bins) binItems.push({ key: k, w: xp.w, d: xp.d });
      // Shown where it sits: the attachment's frame has its origin at the board's front, the anchor on its slot.
      if (xp.place) {
        const [ax, ay, az] = xp.place.at;
        const [x, y, z] = [p.x - p.layout.anchor[0] + ax, p.y - p.layout.anchor[1] + ay, board.front + az];
        const size = { w: xp.w, d: xp.d, h: xp.h };
        items.push({ id: `att-${p.id}-${xp.key}`, pick: p.id, meshKey: pk, x, y, z, ...size, turn: xp.place.turn, role: 'attachment', when: 'always' });
      }
    }
  }
  return placed;
};

setWallParts(planWallParts);
