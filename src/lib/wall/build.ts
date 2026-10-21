/**
 * Building attachments (geometry worker): each kind's body, its mounts added,
 * turned into its print pose. Apart from the defs (registry.ts) so the
 * geometry only loads with the mesh builders: buildMesh is the only caller,
 * and the builders are listed here, not registered as a side effect.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from '../geometry/kernel';
import { mountSolids, toPrintPose } from './mount';
import type { AttachmentLayout, MountCtx } from './registry';
import { hookBuilder } from './kinds/hook.geom';
import { binBuilder } from './kinds/bin.geom';
import { cupBuilder } from './kinds/cup.geom';
import { fitTestBuilder } from './kinds/fitTest.geom';
import { railBuilder } from './kinds/rail.geom';

export interface AttachmentBuilder<O = never> {
  /**
   * The body in the part's frame: its front view's bottom-left at the origin,
   * its back on the board (z = 0), out to +z. It must be solid 0.5 mm in from
   * its back wherever a mount is (the mounts are added after).
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
  rail: railBuilder as AttachmentBuilder<never>,
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

/** An attachment with its mounts, ready to print. */
export function buildAttachment(w: Wasm, spec: { type: string; opts: object; layout: AttachmentLayout; ctx: MountCtx }): MeshData {
  const s = new Scope();
  try {
    const body = builder(spec.type).body(w, s, spec.opts as never, spec.layout, spec.ctx);
    const all = s.t(w.Manifold.union([body, ...mountSolids(w, s, spec.layout, spec.ctx)]));
    return posed(s, all, spec.layout, `attachment ${spec.type}`);
  } finally {
    s.dispose();
  }
}

/** One of an attachment's extra parts. */
export function buildAttachmentPart(w: Wasm, spec: { type: string; part: unknown; ctx: MountCtx }): MeshData {
  const b = builder(spec.type);
  if (!b.part) throw new Error(`Attachment “${spec.type}” has no extra parts.`);
  return b.part(w, spec.part as never, spec.ctx);
}
