import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec3, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { checkPart, sliceReport } from '../src/lib/geometry/printcheck';
import { buildMesh } from '../src/lib/project';
import { attachmentDef, attachmentDefs, type MountCtx } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { BOLT, TNUT_MIN_WALL, tNut, type BoltSize } from '../src/lib/wall/mount';
import { MOUNT_PARTS } from '../src/lib/wall/plan';
import { binFront, type BinOptions } from '../src/lib/wall/kinds/bin';
import type { TiltBinOptions } from '../src/lib/wall/kinds/tiltBin';
import { printedParts } from '../scripts/sampler-cases';
import { ATTACHMENT_GROUPS, BOARD_GROUPS, attachmentSamples } from '../scripts/sampler-boards';

/**
 * Regression tests for the print problems the sampler found in boards and attachments (scripts/sampler-boards.ts,
 * docs/print-check.md), each on the part and option that showed it. Targeted: a part or two each, checked where it was.
 */

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const live: Manifold[] = [];
const keep = (m: Manifold) => (live.push(m), m);
afterAll(() => live.forEach((m) => m.delete()));
const toManifold = (mesh: MeshData) => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));

/** Volume of the mesh inside a box (its own coordinates). */
function filled(mesh: MeshData, min: Vec3, max: Vec3): number {
  const box = keep(w.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min));
  return keep(toManifold(mesh).intersect(box)).volume();
}

/** A kind's body as printed, with its mounts. */
function body(type: string, opts: object, ctx = CTX): MeshData {
  const def = attachmentDef(type)!;
  const o = def.sanitize({ ...def.defaults, ...opts });
  return buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout: def.layout(o, ctx), ctx });
}

/** One of a kind's extra parts as printed. */
function part(type: string, opts: object, key: string, ctx = CTX): MeshData {
  const def = attachmentDef(type)!;
  const o = def.sanitize({ ...def.defaults, ...opts });
  const p = def.parts!(o, ctx).find((q) => q.key === key)!;
  return buildMesh(w, { kind: 'attachmentPart', key, type, part: p.spec, ctx });
}

const tNutMesh = (size: BoltSize, ctx = CTX) =>
  buildMesh(w, { kind: 'attachmentPart', key: `tnut-${size}`, type: MOUNT_PARTS, part: { mount: 'tnut', size }, ctx });

describe('T-nuts', () => {
  // As printed: its back on the bed, the bar `len` across (x) and `h` up (y), centred; the boss on top from z = t.
  for (const size of ['m3', 'm4'] as const) {
    it(`${size}: a boss beside the screw too thin to print is two blocks, above and below it`, () => {
      const n = tNut(size, CTX);
      const B = BOLT[size];
      // In a standard slot the boss beside the screw is under two lines (0.65 mm for an M3, 0.1 for an M4).
      expect((n.bw - B.hole) / 2).toBeLessThan(TNUT_MIN_WALL);
      const m = tNutMesh(size);
      const c = checkPart(w, m);
      expect(c.issues, c.issues.map((i) => i.message).join('\n')).toEqual([]);
      const [cx, cy] = [n.len / 2, n.h / 2];
      const top = n.t + n.bd;
      // Nothing beside the hole, the blocks whole above and below it, the screw's way clear.
      expect(filled(m, [cx - n.bw / 2 - 0.1, cy - B.hole / 2 + 0.05, n.t + 0.05], [cx + n.bw / 2 + 0.1, cy + B.hole / 2 - 0.05, top + 1])).toBeLessThan(1e-6);
      const block = (n.bw * ((n.bh - B.hole) / 2 - 0.1) * (n.bd - 0.1)) / 1;
      for (const dir of [1, -1]) {
        const y0 = cy + dir * (B.hole / 2 + 0.05);
        const y1 = cy + dir * (n.bh / 2 - 0.05);
        expect(filled(m, [cx - n.bw / 2 + 0.01, Math.min(y0, y1), n.t + 0.05], [cx + n.bw / 2 - 0.01, Math.max(y0, y1), top - 0.05])).toBeGreaterThan(
          0.95 * block,
        );
      }
      expect(filled(m, [cx - B.hole / 2 + 0.3, cy - 0.3, -1], [cx + B.hole / 2 - 0.3, cy + 0.3, top + 1])).toBeLessThan(1e-6);
      expect(sliceReport(w, m).thin).toEqual([]);
    });
  }

  it('in a wider slot the boss keeps its walls round the screw', () => {
    const wide: MountCtx = { ...CTX, slotW: 6.5 };
    const n = tNut('m3', wide);
    expect((n.bw - BOLT.m3.hole) / 2).toBeGreaterThanOrEqual(TNUT_MIN_WALL);
    const m = tNutMesh('m3', wide);
    expect(checkPart(w, m).issues).toEqual([]);
    const [cx, cy] = [n.len / 2, n.h / 2];
    const side = (n.bw - BOLT.m3.hole) / 2;
    expect(filled(m, [cx + BOLT.m3.hole / 2 + 0.05, cy - 0.5, n.t + 0.05], [cx + n.bw / 2 - 0.05, cy + 0.5, n.t + n.bd - 0.05])).toBeGreaterThan(
      0.9 * (side - 0.1) * (n.bd - 0.1),
    );
  });
});

describe('tip-out bin with lift off', () => {
  // Where the stop pin's arc slot leaves its slot down to the bin's bottom, the side wall between them came to a knife
  // edge (0.9 mm to nothing over a millimetre): it is taken off as far as it is thinner than 1 mm.
  for (const angle of [30, 45, 60])
    it(`${angle}°: the side walls have no knife edge between the slots`, () => {
      const o: Partial<TiltBinOptions> = { liftOff: true, angle };
      const m = part('tiltBin', o, 'b0');
      const c = checkPart(w, m);
      expect(c.issues, c.issues.map((i) => i.message).join('\n')).toEqual([]);
      expect(sliceReport(w, m, { minThinRun: 0.8 }).thin).toEqual([]);
    });
});

describe('wall bin', () => {
  it('a low front on a tall bin: its top is flat, not sloped to an edge too thin to print', () => {
    const o: Partial<BinOptions> = { width: 120, height: 90, front: 30 };
    const m = body('bin', o);
    expect(checkPart(w, m).issues).toEqual([]);
    expect(sliceReport(w, m, { minThinRun: 0.8 }).thin).toEqual([]);
    // Printed upright, its front on y = 0: the front wall is whole up to the front's height and nothing is above it.
    const d = attachmentDef('bin')!;
    const s = d.sanitize({ ...d.defaults, ...o }) as BinOptions;
    const fh = binFront(s, d.layout(s, CTX).h);
    const t = s.wall;
    const W = meshBounds(m).max[0];
    expect(filled(m, [t + 1, 0, fh - 0.5], [W - t - 1, t, fh - 0.01])).toBeCloseTo((W - 2 * t - 2) * t * 0.49, 1);
    expect(filled(m, [t + 1, -1, fh + 0.01], [W - t - 1, t, fh + 5])).toBeLessThan(1e-6);
  });
});

describe('the sampler', () => {
  // scripts/sampler-boards.ts, planning only: building and checking is `npm run sampler`'s.
  it('samples every attachment kind with each of its presets, its extra parts, lock keys and T-nuts', () => {
    const samples = attachmentSamples();
    const printed = ATTACHMENT_GROUPS.flatMap((g) => printedParts(g, g.job()));
    const files = new Set(printed.map((p) => p.file));
    const meshes = new Set(printed.map((p) => p.part.meshKey));
    const slug = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    for (const def of attachmentDefs()) {
      const mine = samples.filter((s) => s.type === def.type);
      const ui = attachmentUi(def.type)!;
      expect(mine[0]?.id, def.type).toBe(`${slug(def.type)}-default`);
      // A preset that is the defaults is the default sample.
      const same = (set: object) => JSON.stringify(def.sanitize({ ...def.defaults, ...set })) === JSON.stringify(def.sanitize(def.defaults));
      for (const f of ui.fields)
        if (f.kind === 'preset')
          for (const p of f.presets)
            expect(same(p.set) || mine.some((s) => s.id.includes(`${slug(f.key)}-${slug(p.value)}`)), `${def.type} ${p.value}`).toBe(true);
      // Its body and every extra part print (at its defaults).
      const at = `attachments/${ui.group}/${slug(def.type)}-default`;
      expect(files.has(`${at}.stl`), def.type).toBe(true);
      const o = def.sanitize(def.defaults);
      for (const p of def.parts?.(o, CTX) ?? [])
        expect(meshes.has(`attpart|${def.type}|${JSON.stringify(p.spec)}|${JSON.stringify(CTX)}`), `${def.type} ${p.key}`).toBe(true);
    }
    expect([...files].some((f) => /\.lock0\.stl$/.test(f))).toBe(true);
    expect([...files].filter((f) => /\.tnut0\.stl$/.test(f)).length).toBeGreaterThanOrEqual(2);
    expect(BOARD_GROUPS.map((g) => g.name)).toEqual(['boards/skadis', 'boards/opengrid', 'boards/multiboard']);
  });
});
