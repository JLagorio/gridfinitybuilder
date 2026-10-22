/**
 * Building attachments (geometry worker): each kind's body, its mounts added,
 * turned into its print pose. Apart from the defs (registry.ts) so the
 * geometry only loads with the mesh builders: buildMesh is the only caller,
 * and the builders are listed here, not registered as a side effect.
 *
 * Two colours: a kind's body can come with inlays (AttachmentBody: inlaid
 * text, two-colour pocket floors), and a raised or inlaid label is one too.
 * Each is a body of its own on the mesh (an overlay, geometry/inlay.ts), posed
 * with the part, so the 3D view and the 3MF give it its colour role's filament.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from '../geometry/kernel';
import { hasFont, textOutline, textSolid } from '../geometry/text';
import { addInlay, splitInlay, type InlayTag } from '../geometry/inlay';
import { boltBoss, boltCut, lockKeySolid, mountSolids, tNutSolid, toPrintPose } from './mount';
import { LABEL_RELIEF, MOUNT_PARTS, type MountPartSpec } from './plan';
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
import { tiltBinBuilder } from './kinds/tiltBin.geom';
import { lidBoxBuilder } from './kinds/lidBox.geom';
import { cabinetBuilder } from './kinds/cabinet.geom';
import { swivelTowerBuilder } from './kinds/swivelTower.geom';
import { foldHookBuilder } from './kinds/foldHook.geom';

/** A body in another colour, in the part's frame: it touches the body without overlapping it (splitInlay makes one). */
export interface AttachmentInlay extends InlayTag {
  m: Manifold;
}

/** A kind's body with its inlays (AttachmentBuilder.body; AttachmentDef.inlaid says when it has filament-2 ones). */
export interface AttachmentBody {
  body: Manifold;
  inlays: AttachmentInlay[];
}

export interface AttachmentBuilder<O = never> {
  /**
   * The body in the part's frame: its front view's bottom-left at the origin,
   * its back on the board (z = 0), out to +z. It must be solid 0.5 mm in from
   * its back wherever a mount is (the mounts are added after). The common options
   * are added after too: bolt holes (and bosses) where AttachmentDef.backPlate
   * says, label text on AttachmentDef.labelFace (withExtras). With inlays (bodies
   * in another colour) it returns them beside it.
   */
  body(w: Wasm, s: Scope, o: O, layout: AttachmentLayout, ctx: MountCtx): Manifold | AttachmentBody;
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
  tiltBin: tiltBinBuilder as AttachmentBuilder<never>,
  lidBox: lidBoxBuilder as AttachmentBuilder<never>,
  cabinet: cabinetBuilder as AttachmentBuilder<never>,
  swivelTower: swivelTowerBuilder as AttachmentBuilder<never>,
  foldHook: foldHookBuilder as AttachmentBuilder<never>,
};

function builder(type: string): AttachmentBuilder<never> {
  const b = BUILDERS[type];
  if (!b) throw new Error(`No builder for attachment “${type}”.`);
  return b;
}

/** A part in its frame turned into its print pose, its min corner at the origin (its inlays' too, posed with it). */
export function posed(s: Scope, m: Manifold, layout: Pick<AttachmentLayout, 'pose'>, what: string, inlays: readonly AttachmentInlay[] = []): MeshData {
  const p = toPrintPose(s, m, layout.pose);
  const more = inlays.map((i) => ({ ...i, m: toPrintPose(s, i.m, layout.pose) }));
  const min = p.boundingBox().min.map((v, k) => Math.min(v, ...more.map((i) => i.m.boundingBox().min[k])));
  const out = s.t(p.translate([-min[0], -min[1], -min[2]]));
  assertValid(out, what);
  const mesh = toMeshData(out);
  for (const i of more) addInlay(mesh, s.t(i.m.translate([-min[0], -min[1], -min[2]])), i);
  return mesh;
}

/**
 * Label text on a face (registry.ts LabelFace), as large as fits up to 8 mm capitals, from `from` to `to` out along
 * the face's normal (negative: into the part); null without text or before the font is loaded (the geometry worker
 * loads it before building attachments).
 */
function labelSolid(w: Wasm, s: Scope, text: string, f: LabelFace, from: number, to: number): Manifold | null {
  if (!text.trim() || !hasFont()) return null;
  const m = textSolid(w, textOutline(text, { size: Math.min(8, f.h * 0.7), maxWidth: f.w, maxHeight: f.h }), 0, 0, 0, to - from);
  if (!m) return null;
  s.t(m);
  if (f.normal === 'front') return s.t(m.translate([f.x + f.w / 2, f.y + f.h / 2, f.z + from]));
  // Up: the text's top toward the board, standing up out of the face.
  return s.t(s.t(m.rotate([-90, 0, 0])).translate([f.x + f.w / 2, f.y + from, f.z + f.h / 2]));
}

/** Text cut into a label face (as deep as it says, else 0.6 mm), or null (labelSolid). */
export function labelCut(w: Wasm, s: Scope, text: string, f: LabelFace): Manifold | null {
  return labelSolid(w, s, text, f, -(f.depth ?? 0.6), 1);
}

/** Raised and inlaid labels: the board text's colour (colours.ts); inlaid ones in filament 2 with multi-colour off, raised ones with the part. */
const LABEL_INLAID: InlayTag = { name: 'Label text', role: 'wallText', filament: 2 };
const LABEL_RAISED: InlayTag = { name: 'Label text', role: 'wallText', filament: 1 };

/**
 * A body with what its common options add (registry.ts AttachmentExtras): bosses for bolts, then their holes, and the
 * label cut in, inlaid (what the text cuts out of the part is the inlay) or raised (standing on the face, reaching a
 * hair into it where the face isn't quite there). The bolt holes go through the kind's inlays too.
 */
function withExtras(w: Wasm, s: Scope, b: AttachmentBody, e: AttachmentExtras, layout: AttachmentLayout): AttachmentBody {
  const down = layout.pose === 'upright' ? 'y' : 'x';
  const bolts = e.bolts ?? [];
  const bosses = bolts.filter((x) => x.boss).map((x) => boltBoss(w, s, x, down));
  let m = bosses.length ? s.t(w.Manifold.union([b.body, ...bosses])) : b.body;
  const cuts = bolts.map((x) => boltCut(w, s, x, layout.depth));
  const label = e.label;
  const style = label?.style;
  const text = !label ? null : style === 'raised' ? labelSolid(w, s, label.text, label.face, -0.3, LABEL_RELIEF) : labelCut(w, s, label.text, label.face);
  if (text && !style) cuts.push(text);
  const holes = cuts.length ? s.t(w.Manifold.union(cuts)) : null;
  if (holes) m = s.t(m.subtract(holes));
  let inlays = holes ? b.inlays.map((i) => ({ ...i, m: s.t(i.m.subtract(holes)) })) : b.inlays;
  if (text && style === 'inlaid') {
    const split = splitInlay(s, m, text);
    m = split.body;
    if (split.fill) inlays = [...inlays, { ...LABEL_INLAID, m: split.fill }];
  }
  if (text && style === 'raised') inlays = [...inlays, { ...LABEL_RAISED, m: s.t(text.subtract(m)) }];
  return { body: m, inlays };
}

/** An attachment with its mounts, ready to print. */
export function buildAttachment(w: Wasm, spec: { type: string; opts: object; layout: AttachmentLayout; ctx: MountCtx; extras?: AttachmentExtras }): MeshData {
  const s = new Scope();
  try {
    const raw = builder(spec.type).body(w, s, spec.opts as never, spec.layout, spec.ctx);
    let b: AttachmentBody = 'inlays' in raw ? raw : { body: raw, inlays: [] };
    if (spec.extras) b = withExtras(w, s, b, spec.extras, spec.layout);
    const mounts = mountSolids(w, s, spec.layout, spec.ctx, spec.extras?.barbs);
    const all = s.t(w.Manifold.union([b.body, ...mounts]));
    // The mounts reach into the body's back: an inlay there gives way to them.
    const back = b.inlays.length && mounts.length ? s.t(w.Manifold.union(mounts)) : null;
    const inlays = back ? b.inlays.map((i) => ({ ...i, m: s.t(i.m.subtract(back)) })) : b.inlays;
    return posed(s, all, spec.layout, `attachment ${spec.type}`, inlays);
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
