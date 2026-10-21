import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binCells, binKey, binLabel, binSize, binTotalHeight, buildBin, sanitizeBin, type BinOptions } from '../src/lib/geometry/bin';
import { activeContainer } from '../src/lib/geometry/containers';
import {
  BOX,
  BOX_CONTAINER,
  DEFAULT_BOX,
  boxHinge,
  boxLayout,
  boxLidHeights,
  boxRimHeight,
  buildBoxLid,
  cylinderX,
  sanitizeBox,
  type BoxOptions,
} from '../src/lib/geometry/containers/box';
import { DEFAULT_HOPPER, HOPPER, HOPPER_CONTAINER, hopperLayout, sanitizeHopper, type HopperOptions } from '../src/lib/geometry/containers/hopper';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const solid = (m: MeshData): Manifold => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));

function check(m: MeshData) {
  const sol = solid(m);
  try {
    return { status: sol.status(), parts: sol.decompose().length, volume: sol.volume() };
  } finally {
    sol.delete();
  }
}

const bin = (o: Partial<BinOptions> = {}): BinOptions => ({ ...DEFAULT_BIN, unitsX: 2, unitsY: 1, heightUnits: 4, ...o });
const asBox = (o: Partial<BoxOptions> = {}, more: Partial<BinOptions> = {}) => sanitizeBin(bin({ container: 'box', containers: { box: o }, ...more }));
const asHopper = (o: Partial<HopperOptions> = {}, more: Partial<BinOptions> = {}) =>
  sanitizeBin(bin({ container: 'hopper', containers: { hopper: o }, heightUnits: 6, ...more }));
const boxOpts = (b: BinOptions) => activeContainer(b)!.opts as BoxOptions;

/** The box body (bin-centered) and its lid moved to where it sits closed, as manifolds. */
function closedBox(b: BinOptions) {
  const o = boxOpts(b);
  const cells = binCells(b);
  const body = solid(buildBin(w, b));
  const [part] = BOX_CONTAINER.parts!(b, o, cells);
  const { w: W, d: D } = binSize(b, cells);
  const lidMesh = buildBoxLid(w, part.spec as never);
  const a = part.assembled!;
  const lid = solid(lidMesh).translate([a.x - W / 2, a.y - D / 2, a.z]);
  return { body, lid, part, lidMesh, W, D, o, cells };
}

/** Volume shared by two solids (frees what it makes). */
function overlap(a: Manifold, b: Manifold): number {
  const i = a.intersect(b);
  try {
    return i.volume();
  } finally {
    i.delete();
  }
}

/**
 * Faces that point down steeper than 46° from vertical, above the bed, as
 * [z, y] centroids (bin-centered or part-local, as the mesh is). The slab
 * between Gridfinity feet (z = 4.75, 0.5 mm wide) is the usual bin bridge.
 */
function overhangs(m: MeshData): [number, number, number][] {
  const p = m.positions;
  const ix = m.indices;
  const out: [number, number, number][] = [];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (len > 1e-9 && n[2] / len < -0.72 && z > 0.01 && Math.abs(z - 4.75) > 0.01) {
      out.push([z, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a] + p[b] + p[c]) / 3]);
    }
  }
  return out;
}

describe('parts box', () => {
  it('builds valid single bodies for several sizes and every hinge, latch and top', () => {
    const cases: [Partial<BinOptions>, Partial<BoxOptions>][] = [
      [{ unitsX: 1, unitsY: 1, heightUnits: 3 }, {}],
      [{ unitsX: 2, unitsY: 1, heightUnits: 4 }, { hinge: 'pin', latch: 'magnets', top: 'grid', divX: 3, divY: 1 }],
      [{ unitsX: 2, unitsY: 2, heightUnits: 5 }, { latch: 'none', top: 'lip', labelText: 'M3', scoops: false }],
      [{ unitsX: 3, unitsY: 2, heightUnits: 6, holes: 'magnets' }, { divX: 6, divY: 4, labelText: 'SMD 0603', labelStyle: 'raised' }],
      [{ unitsX: 1, unitsY: 2, heightUnits: 3, base: 'flat' }, { latch: 'magnets', top: 'grid' }],
    ];
    for (const [more, o] of cases) {
      const b = asBox(o, more);
      const m = buildBin(w, b);
      const c = check(m);
      expect(c.status, JSON.stringify(o)).toBe('NoError');
      expect(c.parts, JSON.stringify(o)).toBe(1);
      const bb = meshBounds(m);
      const { w: W, d: D } = binSize(b);
      expect(bb.max[2]).toBeCloseTo(binTotalHeight(b), 4);
      expect(bb.min[0]).toBeGreaterThanOrEqual(-W / 2 - 1e-4);
      expect(bb.max[0]).toBeLessThanOrEqual(W / 2 + 1e-4);
      expect(bb.min[1]).toBeGreaterThanOrEqual(-D / 2 - 1e-4);
      expect(bb.max[1]).toBeLessThanOrEqual(D / 2 + 1e-4);
      const [part] = BOX_CONTAINER.parts!(b, boxOpts(b), binCells(b));
      const lid = buildMesh(w, { kind: 'container', key: part.meshKey, type: 'box', spec: part.spec });
      const lc = check(lid);
      expect(lc.status, JSON.stringify(o)).toBe('NoError');
      expect(lc.parts, JSON.stringify(o)).toBe(1);
      const lb = meshBounds(lid);
      expect(lb.min[0]).toBeCloseTo(0, 4);
      expect(lb.min[1]).toBeCloseTo(0, 4);
      expect(lb.min[2]).toBeCloseTo(0, 4);
      expect(lb.max[0]).toBeCloseTo(part.w, 3);
      expect(lb.max[1]).toBeCloseTo(part.d, 3);
      expect(lb.max[2]).toBeCloseTo(part.h, 3);
    }
  });

  it('closes without touching the box, with the hinge and latch clearances it was designed with', () => {
    for (const o of [{}, { hinge: 'pin', latch: 'magnets', top: 'grid' }, { top: 'lip', latch: 'none' }] as Partial<BoxOptions>[]) {
      const { body, lid, W, D } = closedBox(asBox(o));
      expect(overlap(body, lid), JSON.stringify(o)).toBeLessThan(1e-3);
      // Sideways the knuckles have BOX.hinge.axial of play; more than that and they hit the clips.
      const a = BOX.hinge.axial;
      for (const dx of [-0.8 * a, 0.8 * a]) {
        const moved = lid.translate([dx, 0, 0.01]);
        expect(overlap(body, moved)).toBeLessThan(1e-3);
        moved.delete();
      }
      const pushed = lid.translate([1.5 * a, 0, 0.01]);
      expect(overlap(body, pushed)).toBeGreaterThan(0.01);
      pushed.delete();
      body.delete();
      lid.delete();
      expect(W).toBeGreaterThan(0);
      expect(D).toBeGreaterThan(0);
    }
  });

  it('opens about its hinge axis to 110° without hitting the box', () => {
    for (const o of [{ latch: 'none' }, { latch: 'magnets', top: 'grid' }, { latch: 'none', top: 'lip', hinge: 'pin' }] as Partial<BoxOptions>[]) {
      const b = asBox(o);
      const { body, lid } = closedBox(b);
      const L = boxLayout(b, boxOpts(b), binCells(b));
      const zA = L.Hb + L.hinge.R;
      for (const deg of [20, 45, 70, 90, 110]) {
        // Front up: about +X by −deg (the front, −Y, swings up to +Z).
        const open = lid.translate([0, -L.hinge.yA, -zA]).rotate([-deg, 0, 0]).translate([0, L.hinge.yA, zA]);
        expect(overlap(body, open), `${JSON.stringify(o)} at ${deg}°`).toBeLessThan(1e-3);
        open.delete();
      }
      body.delete();
      lid.delete();
    }
  });

  it('seats the snap rod in the clips with the radial play, and the pin hole runs through both', () => {
    const H = BOX.hinge;
    for (const hinge of ['snap', 'pin'] as const) {
      const b = asBox({ hinge, latch: 'none' });
      const { body, lid } = closedBox(b);
      const L = boxLayout(b, boxOpts(b), binCells(b));
      const zA = L.Hb + L.hinge.R;
      const { yA, clips, Xh } = L.hinge;
      for (const [x0, x1] of clips) {
        const bore = hinge === 'snap' ? H.rod + H.play : H.pinHole;
        // Nothing of the clip inside its bore; the clip all round it just outside.
        const inBore = cylinderX(w, yA, zA, bore - 0.02, x0 + 0.1, x1 - 0.1);
        expect(overlap(body, inBore)).toBeLessThan(1e-3);
        const ring = cylinderX(w, yA, zA, bore + 0.15, x0 + 0.1, x1 - 0.1).subtract(cylinderX(w, yA, zA, bore + 0.02, x0, x1));
        expect(overlap(body, ring)).toBeGreaterThan(0.5 * ring.volume());
        inBore.delete();
        ring.delete();
      }
      if (hinge === 'snap') {
        // The rod is the lid's, on the axis, and fills its radius across the clips.
        const rod = cylinderX(w, yA, zA, H.rod - 0.02, -Xh + 0.1, Xh - 0.1);
        expect(overlap(lid, rod)).toBeCloseTo(rod.volume(), 0);
        const play = cylinderX(w, yA, zA, H.rod + H.play - 0.02, clips[0][0] + 0.1, clips[0][1] - 0.1).subtract(
          cylinderX(w, yA, zA, H.rod + 0.02, clips[0][0], clips[0][1]),
        );
        expect(overlap(lid, play) + overlap(body, play)).toBeLessThan(1e-3);
        rod.delete();
        play.delete();
        // The opening at the top of each clip is narrower than the rod (it snaps in).
        const wo = 2 * H.rod - H.snap;
        const [x0, x1] = clips[0];
        const gapBox = w.Manifold.cube([x1 - x0 - 0.2, wo - 0.04, 1]).translate([x0 + 0.1, yA - wo / 2 + 0.02, zA + 1.3]);
        expect(overlap(body, gapBox)).toBeLessThan(1e-3);
        const wider = w.Manifold.cube([x1 - x0 - 0.2, 2 * H.rod, 0.3]).translate([x0 + 0.1, yA - H.rod, zA + 1.2]);
        expect(overlap(body, wider)).toBeGreaterThan(0.01);
        gapBox.delete();
        wider.delete();
      } else {
        // A 1.75 mm pin passes right through the lid and the clips.
        const pin = cylinderX(w, yA, zA, H.pin / 2, -L.W / 2 - 1, L.W / 2 + 1);
        expect(overlap(lid, pin)).toBeLessThan(1e-3);
        expect(overlap(body, pin)).toBeLessThan(1e-3);
        pin.delete();
      }
      body.delete();
      lid.delete();
    }
  });

  it('engages the snap latch bump in the lid’s groove, and lines up the magnet holes', () => {
    {
      const b = asBox({ latch: 'snap' });
      const { body, lid, D } = closedBox(b);
      const L = boxLayout(b, boxOpts(b), binCells(b));
      const C = BOX.latch;
      // The bump reaches past the lid's notch face (into the groove) without touching the lid.
      const tabBack = -D / 2 + C.recess + C.thick;
      const bumpTip = w.Manifold.cube([2, C.bump - C.play - 0.05, 0.2]).translate([-1, tabBack + C.play + 0.02, L.latch!.bump - 0.1]);
      expect(overlap(body, bumpTip)).toBeGreaterThan(0.01);
      expect(overlap(lid, bumpTip)).toBeLessThan(1e-3);
      bumpTip.delete();
      // Lifting the lid straight up a little pushes the lid into the bump: it is held.
      const lifted = lid.translate([0, 0, 0.5]);
      expect(overlap(body, lifted)).toBeGreaterThan(1e-3);
      lifted.delete();
      body.delete();
      lid.delete();
    }
    {
      const b = asBox({ latch: 'magnets' });
      const { body, lid } = closedBox(b);
      const L = boxLayout(b, boxOpts(b), binCells(b));
      expect(L.magnets.length).toBe(2);
      const M = BOX.magnet;
      for (const [x, y] of L.magnets) {
        // A 6 × 2 mm magnet fits below the rim and above it in the lid.
        const below = w.Manifold.cylinder(2, 3, 3, 40).translate([x, y, L.Hb - 2.2]);
        const above = w.Manifold.cylinder(2, 3, 3, 40).translate([x, y, L.Hb + 0.2]);
        expect(overlap(body, below)).toBeLessThan(1e-3);
        expect(overlap(lid, above)).toBeLessThan(1e-3);
        expect(overlap(lid, below)).toBeLessThan(1e-3);
        // with solid under it
        const under = w.Manifold.cylinder(M.under - 0.1, 3, 3, 40).translate([x, y, L.Hb - M.depth - M.under + 0.05]);
        expect(overlap(body, under)).toBeCloseTo(under.volume(), 1);
        for (const m of [below, above, under]) m.delete();
      }
      body.delete();
      lid.delete();
    }
  });

  it('walls of the compartments reach the lid less the gap, and the lid seals the rim', () => {
    for (const wallGap of [0.3, 1]) {
      const b = asBox({ wallGap, divX: 2, divY: 2, latch: 'none' });
      const { body, lid } = closedBox(b);
      const L = boxLayout(b, boxOpts(b), binCells(b));
      // A thin slab just under the walls' tops crosses the dividers; one just above them is clear.
      const x = (L.cols[0][1] + L.cols[1][0]) / 2;
      const y0 = L.rows[0][0] + 2;
      const y1 = L.rows[1][0] - 2;
      const under = w.Manifold.cube([0.4, y1 - y0, 0.05]).translate([x - 0.2, y0, L.wallTop - 0.1]);
      const over = w.Manifold.cube([0.4, y1 - y0, 0.05]).translate([x - 0.2, y0, L.wallTop + 0.02]);
      expect(overlap(body, under)).toBeGreaterThan(0);
      expect(overlap(body, over)).toBeLessThan(1e-6);
      expect(L.wallTop).toBeCloseTo(L.Hb - wallGap, 6);
      // The lid covers the whole top of the inside.
      const above = w.Manifold.cube([L.W - 6, L.yBand - (-L.D / 2) - 4, 0.1]).translate([-L.W / 2 + 3, -L.D / 2 + 2, L.Hb + 0.5]);
      expect(overlap(lid, above)).toBeCloseTo(above.volume(), 1);
      for (const m of [under, over, above, body, lid]) m.delete();
    }
  });

  it('plans the lid as a part with its size, key and closed place', () => {
    const o = asBox({ top: 'grid', latch: 'magnets' }, { unitsX: 2, unitsY: 2, heightUnits: 5 });
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 3, gridY: 3 }, bins: [{ id: 'b', x: 0, y: 0, opts: o }] });
    const keys = Object.values(job.parts).map((p) => p.key);
    expect(keys).toContain('bin:b');
    expect(keys).toContain('lid:b:0');
    expect(keys.filter((k) => k.startsWith('lid:')).length).toBe(1);
    const lid = job.parts['lid:b:0'];
    const { w: W, d: D } = binSize(o);
    expect(lid).toMatchObject({ kind: 'lid', bin: 'b', w: W, d: D, h: boxLidHeights('grid').T });
    expect(lid.assembled).toEqual({ x: 0, y: 0, z: boxRimHeight(o, boxOpts(o)) });
    expect(lid.name).toContain('Lid');
    const mesh = buildMesh(w, job.meshes[lid.meshKey]);
    const bb = meshBounds(mesh);
    expect(bb.max[0]).toBeCloseTo(W, 3);
    expect(bb.max[1]).toBeCloseTo(D, 3);
    // Closed height: heightUnits × 7 to the receptacle floor, a stacking lip's 4 mm above that.
    expect(boxRimHeight(o, boxOpts(o)) + boxLidHeights('grid').solid).toBeCloseTo(35, 6);
    // Same box twice: one mesh each for the body and the lid.
    const job2 = planJob({
      ...DEFAULT_PROJECT,
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 2 },
      bins: [
        { id: 'a', x: 0, y: 0, opts: o },
        { id: 'c', x: 2, y: 0, opts: o },
      ],
    });
    expect(job2.parts['lid:a:0'].meshKey).toBe(job2.parts['lid:c:0'].meshKey);
    expect(binLabel(o)).toBe('2×2×5u parts box 2×2, magnets');
  });

  it('prints without support: the only down-facing faces are small hole tops and short bridges', () => {
    const H = BOX.hinge;
    const near = (a: number, b: number, r: number) => Math.abs(a - b) <= r;
    {
      // Snap hinge and snap latch: the body has none; the lid only the rod, bridging each clip gap.
      const b = asBox({ hinge: 'snap', latch: 'snap' });
      const L = boxLayout(b, boxOpts(b), binCells(b));
      expect(overhangs(buildBin(w, b))).toEqual([]);
      const [part] = BOX_CONTAINER.parts!(b, boxOpts(b), binCells(b));
      const lid = overhangs(buildBoxLid(w, part.spec as never));
      expect(lid.length).toBeGreaterThan(0);
      for (const [z, y, x] of lid) {
        expect(near(y - L.D / 2, L.hinge.yA, H.rod + 0.05) && near(z, L.hinge.R, H.rod + 0.05)).toBe(true);
        expect(L.hinge.clips.some(([a, c]) => x >= a - H.axial - 0.01 + L.W / 2 && x <= c + H.axial + 0.01 + L.W / 2)).toBe(true);
      }
    }
    {
      // Pin hinge, magnets, grid top: the pin holes' tops, the magnet recess ceilings, and the lid bridging each clip.
      const b = asBox({ hinge: 'pin', latch: 'magnets', top: 'grid' });
      const L = boxLayout(b, boxOpts(b), binCells(b));
      const zA = L.Hb + L.hinge.R;
      for (const [z, y] of overhangs(buildBin(w, b))) expect(near(y, L.hinge.yA, H.pinHole + 0.05) && near(z, zA, H.pinHole + 0.05)).toBe(true);
      const [part] = BOX_CONTAINER.parts!(b, boxOpts(b), binCells(b));
      const F = boxLidHeights('grid').solid;
      for (const [z, y, x] of overhangs(buildBoxLid(w, part.spec as never))) {
        const yc = y - L.D / 2;
        const xc = x - L.W / 2;
        const pin = near(yc, L.hinge.yA, H.pinHole + 0.05) && near(z, L.hinge.R, H.pinHole + 0.05);
        const magnet = near(z, BOX.magnet.depth, 0.01);
        const bridge = near(z, F, 0.01) && L.hinge.clips.some(([a, c]) => xc >= a - H.axial - 0.01 && xc <= c + H.axial + 0.01);
        expect(pin || magnet || bridge, `${z} ${yc} ${xc}`).toBe(true);
      }
    }
  });

  it('cleans its options and changes its key with every option', () => {
    expect(sanitizeBox(undefined)).toEqual(DEFAULT_BOX);
    const bad = sanitizeBox({ divX: 99, divY: -3, wallGap: 20, hinge: 'glue', latch: 7, top: 'dome', labelText: 42, labelStyle: 'x', scoops: 0 });
    expect(bad).toEqual({ ...DEFAULT_BOX, divX: BOX.maxDiv, divY: 1, wallGap: BOX.maxGap, scoops: false });
    expect(sanitizeBox({ wallGap: 0 }).wallGap).toBe(BOX.minGap);
    const base = asBox();
    const variants: Partial<BoxOptions>[] = [
      { divX: 3 },
      { divY: 1 },
      { scoops: false },
      { wallGap: 0.5 },
      { hinge: 'pin' },
      { latch: 'magnets' },
      { latch: 'none' },
      { top: 'grid' },
      { top: 'lip' },
      { labelText: 'M3' },
      { labelText: 'M3', labelStyle: 'raised' },
    ];
    const keys = new Set([binKey(base), ...variants.map((v) => binKey(asBox(v)))]);
    expect(keys.size).toBe(variants.length + 1);
    // Text style matters only with text, and text not at all on a grid top.
    expect(binKey(asBox({ labelStyle: 'raised' }))).toBe(binKey(base));
    expect(binKey(asBox({ top: 'grid', labelText: 'M3' }))).toBe(binKey(asBox({ top: 'grid' })));
  });

  it('warns when it is too short or too small, and builds anyway', () => {
    const short = asBox({}, { heightUnits: 2 });
    const notes = BOX_CONTAINER.notes!(short, boxOpts(short), binCells(short));
    expect(notes.some((n) => n.includes('built'))).toBe(true);
    expect(check(buildBin(w, short)).status).toBe('NoError');
    const tiny = asBox({ divX: 12, divY: 12 }, { unitsX: 1, unitsY: 1 });
    const n2 = BOX_CONTAINER.notes!(tiny, boxOpts(tiny), binCells(tiny));
    expect(n2.some((n) => n.includes('compartments fit'))).toBe(true);
    expect(check(buildBin(w, tiny)).parts).toBe(1);
    expect(BOX_CONTAINER.notes!(asBox(), DEFAULT_BOX, binCells(asBox()))).toEqual([]);
    // Half-grid 1×1 (20.5 mm): a single clip.
    const half = { x: [21], y: [21], half: true };
    const hb = asBox({ divX: 1, divY: 1 }, { unitsX: 1, unitsY: 1 });
    expect(boxHinge(binSize(hb, half).w, binSize(hb, half).d).clips.length).toBe(1);
    const hm = buildBin(w, hb, half);
    expect(check(hm)).toMatchObject({ status: 'NoError', parts: 1 });
    // Stretched over the drawer margin: body, grid-top lid and hopper stay single, valid bodies of the stretched size.
    const st = { x: [42, 42], y: [42], stretch: { left: 6, right: 0, front: 4, back: 0 } };
    const sb = asBox({ top: 'grid' });
    const sm = buildBin(w, sb, st);
    expect(check(sm)).toMatchObject({ status: 'NoError', parts: 1 });
    expect(meshBounds(sm).max[0] - meshBounds(sm).min[0]).toBeCloseTo(binSize(sb, st).w, 3);
    const [sp] = BOX_CONTAINER.parts!(sb, boxOpts(sb), binCells(sb, st));
    const sl = buildBoxLid(w, sp.spec as never);
    expect(check(sl)).toMatchObject({ status: 'NoError', parts: 1 });
    expect(meshBounds(sl).max[0]).toBeCloseTo(sp.w, 3);
    expect(check(buildBin(w, asHopper({ lip: true }), st))).toMatchObject({ status: 'NoError', parts: 1 });
  });
});

describe('hopper bin', () => {
  it('builds valid single bodies for several sizes and every style', () => {
    const cases: [Partial<BinOptions>, Partial<HopperOptions>][] = [
      [{ unitsX: 1, unitsY: 1, heightUnits: 4 }, {}],
      [{ unitsX: 2, unitsY: 2, heightUnits: 6 }, { dividers: 2, label: 'slot', labelText: 'M3\nM4\nM5' }],
      [{ unitsX: 2, unitsY: 1, heightUnits: 5 }, { lip: true, label: 'text', labelText: 'NUTS' }],
      [{ unitsX: 3, unitsY: 2, heightUnits: 8, holes: 'magnets' }, { lip: true, dividers: 3, angle: 70, slope: 25, front: 20 }],
      [{ unitsX: 1, unitsY: 2, heightUnits: 3, base: 'flat' }, { label: 'none', angle: 90, slope: 0 }],
    ];
    for (const [more, o] of cases) {
      const b = asHopper(o, more);
      const m = buildBin(w, b);
      const c = check(m);
      expect(c.status, JSON.stringify(o)).toBe('NoError');
      expect(c.parts, JSON.stringify(o)).toBe(1);
      const bb = meshBounds(m);
      const { w: W, d: D } = binSize(b);
      expect(bb.max[2]).toBeCloseTo(binTotalHeight(b), 3);
      expect(bb.min[1]).toBeGreaterThanOrEqual(-D / 2 - 1e-4);
      expect(bb.max[0]).toBeLessThanOrEqual(W / 2 + 1e-4);
    }
  });

  it('is open above a low front lip, with a floor sloping down to the front', () => {
    const b = asHopper({ front: 12, slope: 15, label: 'none' }, { unitsX: 1, unitsY: 2 });
    const o = activeContainer(b)!.opts as HopperOptions;
    const L = hopperLayout(b, o, binCells(b));
    const body = solid(buildBin(w, b));
    expect(L.zLip).toBeCloseTo(L.floorTop + 12, 6);
    // A probe just above the lip at the front passes; one just below hits it.
    const probe = (z: number) => w.Manifold.cube([10, 1, 0.2]).translate([-5, -L.D / 2 + 0.2, z]);
    const above = probe(L.zLip + 0.2);
    const below = probe(L.zLip - 0.4);
    expect(overlap(body, above)).toBeLessThan(1e-6);
    expect(overlap(body, below)).toBeGreaterThan(0);
    // The side wall rises along the opening angle: clear just in front of the edge, solid behind it.
    const t = Math.tan((L.angle * Math.PI) / 180);
    const yFi = -L.D / 2 + L.tf;
    const z = L.zLip + 10;
    const yEdge = yFi + 10 / t;
    const side = (y: number) => w.Manifold.cube([0.5, 0.4, 0.4]).translate([-L.W / 2 + 0.2, y, z]);
    const front = side(yEdge - 1.5);
    const back = side(yEdge + 1.5);
    expect(overlap(body, front)).toBeLessThan(1e-6);
    expect(overlap(body, back)).toBeGreaterThan(0);
    // Floor: higher at the back.
    const floorAt = (y: number) => {
      for (let zz = L.floorTop + 30; zz > L.floorTop - 1; zz -= 0.05) {
        const c = w.Manifold.cube([1, 1, 0.05]).translate([-0.5, y - 0.5, zz]);
        const hit = overlap(body, c) > 0;
        c.delete();
        if (hit) return zz;
      }
      return -1;
    };
    const zFront = floorAt(yFi + 5);
    const zBack = floorAt(L.D / 2 - 5);
    expect(zBack - zFront).toBeGreaterThan(10);
    expect(Math.atan((zBack - zFront) / (L.D / 2 - 5 - yFi - 5)) / (Math.PI / 180)).toBeCloseTo(L.slope, 0);
    for (const m of [above, below, front, back, body]) m.delete();
  });

  it('with a stacking lip keeps a lintel over the opening and the lip all round', () => {
    const b = asHopper({ lip: true, label: 'none' }, { unitsX: 1, unitsY: 1, heightUnits: 6 });
    const o = activeContainer(b)!.opts as HopperOptions;
    const L = hopperLayout(b, o, binCells(b));
    const body = solid(buildBin(w, b));
    expect(binTotalHeight(b)).toBeCloseTo(42 + 4, 6);
    // The lintel spans the front at the top; the window under it is open.
    const lintel = w.Manifold.cube([L.W - 10, 0.5, 1]).translate([-L.W / 2 + 5, -L.D / 2 + 0.2, L.zOpen + 0.5]);
    const window = w.Manifold.cube([L.W - 10, 0.5, 1]).translate([-L.W / 2 + 5, -L.D / 2 + 0.2, L.zOpen - 2]);
    expect(overlap(body, lintel)).toBeCloseTo(lintel.volume(), 2);
    expect(overlap(body, window)).toBeLessThan(1e-6);
    // The opening's back edge and the lintel's 45° roof meet in front of the back wall.
    expect(L.angle).toBeCloseTo(o.angle, 6);
    for (const m of [lintel, window, body]) m.delete();
  });

  it('cuts a label slot per section with a window, and raises text flush with the front', () => {
    const b = asHopper({ dividers: 1, label: 'slot' }, { unitsX: 2, unitsY: 1 });
    const o = activeContainer(b)!.opts as HopperOptions;
    const L = hopperLayout(b, o, binCells(b));
    const body = solid(buildBin(w, b));
    const S = HOPPER.slot;
    expect(L.sections.length).toBe(2);
    for (const [a, c] of L.sections) {
      const mid = (a + c) / 2;
      const slot = w.Manifold.cube([10, S.depth - 0.1, 3]).translate([mid - 5, -L.D / 2 + S.skin + 0.05, L.zLip - 4]);
      expect(overlap(body, slot)).toBeLessThan(1e-6);
      // Behind the slot the lip is solid.
      const back = w.Manifold.cube([10, 0.5, 3]).translate([mid - 5, -L.D / 2 + S.skin + S.depth + 0.1, L.zLip - 4]);
      expect(overlap(body, back)).toBeCloseTo(back.volume(), 2);
      slot.delete();
      back.delete();
    }
    body.delete();
    const t = asHopper({ label: 'text', labelText: 'BOLTS' }, { unitsX: 2, unitsY: 1 });
    const plain = asHopper({ label: 'text', labelText: '' }, { unitsX: 2, unitsY: 1 });
    const mt = buildBin(w, t);
    expect(check(mt)).toMatchObject({ status: 'NoError', parts: 1 });
    expect(meshBounds(mt).min[1]).toBeGreaterThanOrEqual(-binSize(t).d / 2 - 1e-4);
    expect(check(mt).volume).not.toBeCloseTo(check(buildBin(w, plain)).volume, 0);
  });

  it('prints without support, with or without the lintel', () => {
    for (const o of [{ label: 'none' }, { lip: true, dividers: 2, label: 'slot' }, { lip: true, angle: 90 }, { label: 'text' }, { angle: 30, slope: 0 }] as Partial<HopperOptions>[]) {
      expect(overhangs(buildBin(w, asHopper(o, { unitsX: 3 }))), JSON.stringify(o)).toEqual([]);
    }
  });

  it('cleans its options, changes its key per option, and warns about what it can’t do', () => {
    expect(sanitizeHopper(null)).toEqual(DEFAULT_HOPPER);
    expect(sanitizeHopper({ front: -5, angle: 5, slope: 80, dividers: 40.6, lip: 1, label: 'neon', labelText: 7 })).toEqual({
      ...DEFAULT_HOPPER,
      front: HOPPER.minFront,
      angle: HOPPER.minAngle,
      slope: HOPPER.maxSlope,
      dividers: HOPPER.maxDividers,
      lip: true,
    });
    const base = asHopper();
    const variants: Partial<HopperOptions>[] = [{ front: 15 }, { angle: 70 }, { slope: 20 }, { dividers: 1 }, { lip: true }, { label: 'text' }, { label: 'none' }, { labelText: 'A' }];
    const keys = new Set([binKey(base), ...variants.map((v) => binKey(asHopper(v)))]);
    expect(keys.size).toBe(variants.length + 1);
    expect(binKey(asHopper({ label: 'none', labelText: 'A' }))).toBe(binKey(asHopper({ label: 'none' })));
    expect(binLabel(asHopper({ dividers: 2, lip: true }))).toBe('2×1×6u hopper bin 3 sections, stackable');
    const notes = (o: Partial<HopperOptions>, more: Partial<BinOptions> = {}) => {
      const b = asHopper(o, more);
      return HOPPER_CONTAINER.notes!(b, activeContainer(b)!.opts as HopperOptions, binCells(b));
    };
    expect(notes({})).toEqual([]);
    expect(notes({ front: 60 }).some((n) => n.includes('front lip is lowered'))).toBe(true);
    expect(notes({ lip: true }, { unitsX: 3 }).some((n) => n.includes('bridges'))).toBe(true);
    expect(notes({ lip: true, dividers: 3 }, { unitsX: 3 }).some((n) => n.includes('bridges'))).toBe(false);
    expect(notes({ dividers: 11 }, { unitsX: 1 }).some((n) => n.includes('dividers fit'))).toBe(true);
    // A shallow opening edge would run out through the back wall, or lie under the floor: it is made steeper.
    expect(notes({ angle: 30, slope: 25 }).some((n) => n.includes('opening edge is'))).toBe(true);
    const steep = asHopper({ angle: 30, slope: 25 }, { unitsY: 3 });
    const SL = hopperLayout(steep, activeContainer(steep)!.opts as HopperOptions, binCells(steep));
    expect(SL.angle).toBeGreaterThanOrEqual(SL.slope + 10 - 1e-9);
  });
});
