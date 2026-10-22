/**
 * Building attachments (geometry worker): each kind's body, its mounts added,
 * turned into its print pose. Apart from the defs (registry.ts) so the
 * geometry only loads with the mesh builders: buildMesh is the only caller,
 * and the builders are listed here, not registered as a side effect.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from '../geometry/kernel';
import { hasFont, textOutline, textSolid } from '../geometry/text';
import { boltBoss, boltCut, lockKeySolid, mountSolids, tNutSolid, toPrintPose } from './mount';
import { MOUNT_PARTS, type MountPartSpec } from './plan';
import type { AttachmentExtras, AttachmentLayout, LabelFace, MountCtx } from './registry';
import { hookBuilder } from './kinds/hook.geom';
import { binBuilder } from './kinds/bin.geom';
import { cupBuilder } from './kinds/cup.geom';
import { fitTestBuilder } from './kinds/fitTest.geom';
import { shelfBuilder } from './kinds/shelf.geom';
import { rodBuilder } from './kinds/rod.geom';
import { toolRackBuilder } from './kinds/toolRack.geom';
import { cradleBuilder } from './kinds/cradle.geom';
import { plateBuilder } from './kinds/plate.geom';
import { railBuilder } from './kinds/rail.geom';
import { ledBarBuilder } from './kinds/ledBar.geom';
import { cableClipBuilder } from './kinds/cableClip.geom';
import { cableChannelBuilder } from './kinds/cableChannel.geom';
import { powerStripBuilder } from './kinds/powerStrip.geom';
import { cableCombBuilder } from './kinds/cableComb.geom';
import { gridShelfBuilder } from './kinds/gridShelf.geom';
import { gridPlateBuilder } from './kinds/gridPlate.geom';
import { gridClipBuilder } from './kinds/gridClip.geom';
import { batteryDockBuilder } from './kinds/batteryDock.geom';
import { toolDockBuilder } from './kinds/toolDock.geom';
import { chargerCradleBuilder } from './kinds/chargerCradle.geom';
import { cellDispenserBuilder } from './kinds/cellDispenser.geom';
import { mediaBlockBuilder } from './kinds/mediaBlock.geom';
import { spoolRackBuilder } from './kinds/spoolRack.geom';
import { boxSleeveBuilder } from './kinds/boxSleeve.geom';
import { leadHangerBuilder } from './kinds/leadHanger.geom';
import { labelTagBuilder } from './kinds/labelTag.geom';
import { receiverBuilder } from './kinds/receiver.geom';
import { pegboardBridgeBuilder } from './kinds/pegboardBridge.geom';
import { cleatStripBuilder } from './kinds/cleatStrip.geom';
import { dinRailBuilder } from './kinds/dinRail.geom';
import { mountBossBuilder } from './kinds/mountBoss.geom';
import { slotRackBuilder } from './kinds/slotRack.geom';
import { displayLedgeBuilder } from './kinds/displayLedge.geom';
import { planterBuilder } from './kinds/planter.geom';
import { caddyBuilder } from './kinds/caddy.geom';
import { faceoutBuilder } from './kinds/faceout.geom';
import { saddleBuilder } from './kinds/saddle.geom';
import { magnetBarBuilder } from './kinds/magnetBar.geom';
import { measureHangerBuilder } from './kinds/measureHanger.geom';
import { eyewearBuilder } from './kinds/eyewear.geom';
import { clampRackBuilder } from './kinds/clampRack.geom';
import { clipTabBuilder } from './kinds/clipTab.geom';
import { bottleRackBuilder } from './kinds/bottleRack.geom';
import { stickRackBuilder } from './kinds/stickRack.geom';
import { holsterBuilder } from './kinds/holster.geom';
import { gripperBuilder } from './kinds/gripper.geom';

export interface AttachmentBuilder<O = never> {
  /**
   * The body in the part's frame: its front view's bottom-left at the origin,
   * its back on the board (z = 0), out to +z. It must be solid 0.5 mm in from
   * its back wherever a mount is (the mounts are added after). The common options
   * are added after too: bolt holes (and bosses) where AttachmentDef.backPlate
   * says, label text on AttachmentDef.labelFace (withExtras).
   */
  body(w: Wasm, s: Scope, o: O, layout: AttachmentLayout, ctx: MountCtx): Manifold;
  /** An extra part (AttachmentDef.parts), in its print pose, min corner at the origin. */
  part?(w: Wasm, spec: never, ctx: MountCtx): MeshData;
}

const BUILDERS: Record<string, AttachmentBuilder<never>> = {
  hook: hookBuilder as AttachmentBuilder<never>,
  bin: binBuilder as AttachmentBuilder<never>,
  cup: cupBuilder as AttachmentBuilder<never>,
  fitTest: fitTestBuilder as AttachmentBuilder<never>,
  shelf: shelfBuilder as AttachmentBuilder<never>,
  rod: rodBuilder as AttachmentBuilder<never>,
  toolRack: toolRackBuilder as AttachmentBuilder<never>,
  cradle: cradleBuilder as AttachmentBuilder<never>,
  plate: plateBuilder as AttachmentBuilder<never>,
  rail: railBuilder as AttachmentBuilder<never>,
  ledBar: ledBarBuilder as AttachmentBuilder<never>,
  cableClip: cableClipBuilder as AttachmentBuilder<never>,
  cableChannel: cableChannelBuilder as AttachmentBuilder<never>,
  powerStrip: powerStripBuilder as AttachmentBuilder<never>,
  cableComb: cableCombBuilder as AttachmentBuilder<never>,
  gridShelf: gridShelfBuilder as AttachmentBuilder<never>,
  gridPlate: gridPlateBuilder as AttachmentBuilder<never>,
  gridClip: gridClipBuilder as AttachmentBuilder<never>,
  batteryDock: batteryDockBuilder as AttachmentBuilder<never>,
  toolDock: toolDockBuilder as AttachmentBuilder<never>,
  chargerCradle: chargerCradleBuilder as AttachmentBuilder<never>,
  cellDispenser: cellDispenserBuilder as AttachmentBuilder<never>,
  mediaBlock: mediaBlockBuilder as AttachmentBuilder<never>,
  spoolRack: spoolRackBuilder as AttachmentBuilder<never>,
  boxSleeve: boxSleeveBuilder as AttachmentBuilder<never>,
  leadHanger: leadHangerBuilder as AttachmentBuilder<never>,
  labelTag: labelTagBuilder as AttachmentBuilder<never>,
  receiver: receiverBuilder as AttachmentBuilder<never>,
  pegboardBridge: pegboardBridgeBuilder as AttachmentBuilder<never>,
  cleatStrip: cleatStripBuilder as AttachmentBuilder<never>,
  dinRail: dinRailBuilder as AttachmentBuilder<never>,
  mountBoss: mountBossBuilder as AttachmentBuilder<never>,
  slotRack: slotRackBuilder as AttachmentBuilder<never>,
  displayLedge: displayLedgeBuilder as AttachmentBuilder<never>,
  planter: planterBuilder as AttachmentBuilder<never>,
  caddy: caddyBuilder as AttachmentBuilder<never>,
  faceout: faceoutBuilder as AttachmentBuilder<never>,
  saddle: saddleBuilder as AttachmentBuilder<never>,
  magnetBar: magnetBarBuilder as AttachmentBuilder<never>,
  measureHanger: measureHangerBuilder as AttachmentBuilder<never>,
  eyewear: eyewearBuilder as AttachmentBuilder<never>,
  clampRack: clampRackBuilder as AttachmentBuilder<never>,
  clipTab: clipTabBuilder as AttachmentBuilder<never>,
  bottleRack: bottleRackBuilder as AttachmentBuilder<never>,
  stickRack: stickRackBuilder as AttachmentBuilder<never>,
  holster: holsterBuilder as AttachmentBuilder<never>,
  gripper: gripperBuilder as AttachmentBuilder<never>,
};

function builder(type: string): AttachmentBuilder<never> {
  const b = BUILDERS[type];
  if (!b) throw new Error(`No builder for attachment “${type}”.`);
  return b;
}

/** A part in its frame turned into its print pose, its min corner at the origin. */
export function posed(s: Scope, m: Manifold, layout: Pick<AttachmentLayout, 'pose'>, what: string): MeshData {
  const p = toPrintPose(s, m, layout.pose);
  const b = p.boundingBox();
  const out = s.t(p.translate([-b.min[0], -b.min[1], -b.min[2]]));
  assertValid(out, what);
  return toMeshData(out);
}

/**
 * Text cut into a label face (registry.ts LabelFace), as large as fits up to 8 mm capitals; null without text
 * or before the font is loaded (the geometry worker loads it before building attachments).
 */
export function labelCut(w: Wasm, s: Scope, text: string, f: LabelFace): Manifold | null {
  if (!text.trim() || !hasFont()) return null;
  const depth = f.depth ?? 0.6;
  const m = textSolid(w, textOutline(text, { size: Math.min(8, f.h * 0.7), maxWidth: f.w, maxHeight: f.h }), 0, 0, 0, depth + 1);
  if (!m) return null;
  s.t(m);
  if (f.normal === 'front') return s.t(m.translate([f.x + f.w / 2, f.y + f.h / 2, f.z - depth]));
  // Up: the text's top toward the board, cut down into the face.
  return s.t(s.t(m.rotate([-90, 0, 0])).translate([f.x + f.w / 2, f.y - depth, f.z + f.h / 2]));
}

/** A body with what its common options add (registry.ts AttachmentExtras): bosses for bolts, then their holes and the label cut in. */
function withExtras(w: Wasm, s: Scope, body: Manifold, e: AttachmentExtras, layout: AttachmentLayout): Manifold {
  const down = layout.pose === 'upright' ? 'y' : 'x';
  const bolts = e.bolts ?? [];
  const bosses = bolts.filter((b) => b.boss).map((b) => boltBoss(w, s, b, down));
  let m = bosses.length ? s.t(w.Manifold.union([body, ...bosses])) : body;
  const cuts = bolts.map((b) => boltCut(w, s, b, layout.depth));
  const text = e.label ? labelCut(w, s, e.label.text, e.label.face) : null;
  if (text) cuts.push(text);
  if (cuts.length) m = s.t(m.subtract(s.t(w.Manifold.union(cuts))));
  return m;
}

/** An attachment with its mounts, ready to print. */
export function buildAttachment(w: Wasm, spec: { type: string; opts: object; layout: AttachmentLayout; ctx: MountCtx; extras?: AttachmentExtras }): MeshData {
  const s = new Scope();
  try {
    let body = builder(spec.type).body(w, s, spec.opts as never, spec.layout, spec.ctx);
    if (spec.extras) body = withExtras(w, s, body, spec.extras, spec.layout);
    const all = s.t(w.Manifold.union([body, ...mountSolids(w, s, spec.layout, spec.ctx, spec.extras?.barbs)]));
    return posed(s, all, spec.layout, `attachment ${spec.type}`);
  } finally {
    s.dispose();
  }
}

/** A lock key (printed upright, as it sits) or a T-nut (on its back), min corner at the origin. */
function buildMountPart(w: Wasm, spec: MountPartSpec, ctx: MountCtx): MeshData {
  const s = new Scope();
  try {
    if (spec.mount === 'key') return posed(s, lockKeySolid(w, s, [0, 0], ctx), { pose: 'upright' }, 'lock key');
    const m = tNutSolid(w, s, spec.size, ctx);
    const b = m.boundingBox();
    const out = s.t(m.translate([-b.min[0], -b.min[1], -b.min[2]]));
    assertValid(out, 'T-nut');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

/** One of an attachment's extra parts (or a lock key or T-nut: type MOUNT_PARTS). */
export function buildAttachmentPart(w: Wasm, spec: { type: string; part: unknown; ctx: MountCtx }): MeshData {
  if (spec.type === MOUNT_PARTS) return buildMountPart(w, spec.part as MountPartSpec, spec.ctx);
  const b = builder(spec.type);
  if (!b.part) throw new Error(`Attachment “${spec.type}” has no extra parts.`);
  return b.part(w, spec.part as never, spec.ctx);
}
