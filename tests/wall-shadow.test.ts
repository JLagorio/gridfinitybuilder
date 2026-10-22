import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Vec2, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, usesSecondFilament, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { encodeProject } from '../src/lib/share';
import { parseSVG } from '../src/lib/trace/svg';
import { bounds, polygonsIntersect, signedArea } from '../src/lib/trace/polygon';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { partBounds, printedSize, viewTurn } from '../src/lib/wall/mount';
import { attachmentUi } from '../src/lib/wall/ui';
import { TRACED, cleanOutline, cleanTraced, pegSpots, turned, uprightTurn, type TracedTool } from '../src/lib/wall/kinds/traced';
import { MAGNETS, SHADOW, shadowPlan, type ShadowBoardOptions } from '../src/lib/wall/kinds/shadowBoard';
import { shadowBoardBuilder, slope45 } from '../src/lib/wall/kinds/shadowBoard.geom';
import type { AttachmentBody } from '../src/lib/wall/build';
import { TOOL_CRADLE, cradlePlan, type ToolCradleOptions } from '../src/lib/wall/kinds/toolCradle';
import { fitted } from './wallFit';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

let live: { delete(): void }[] = [];
const keep = <T extends { delete(): void }>(m: T) => (live.push(m), m);
afterEach(() => {
  const all = new Set(live);
  live = [];
  for (const m of all) m.delete();
});

// ---------------------------------------------------------------------------
// Tools, as the trace dialog gives them (mm, y up, anywhere)
// ---------------------------------------------------------------------------

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 24): Vec2[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
/** A screwdriver standing up: a 26 × 95 handle over a 6 mm shaft 90 long. */
const SCREWDRIVER: Vec2[] = [[13, 0], [16, 5], [16, 90], [26, 90], ...arc(18, 177, 8, 0, 90, 6), ...arc(8, 177, 8, 90, 180, 6), [0, 90], [10, 90], [10, 5]];
/** An open-end wrench lying across: 147 long, a 14 mm shaft, a round head each end, an open jaw in the left one. */
const WRENCH: Vec2[] = [
  ...arc(133, 0, 15, 208, 512, 40),
  ...arc(17, 0, 17, 25, 158, 24),
  [2, 6.5],
  [19, 6.5],
  [19, -6.5],
  [2, -6.5],
  ...arc(17, 0, 17, 202, 335, 24),
];
/** Pliers-like, 40 × 198: two prongs spread apart at one end, a round pivot, the other end narrowing to a point. */
const HALF: Vec2[] = [[30, 102], [36, 2], [50, 0], [44, 104], ...arc(30, 128, 14, -60, 60, 10), [36, 175], [33, 196], [30, 198]];
const PLIERS: Vec2[] = [
  ...HALF,
  ...HALF.slice(0, -1)
    .reverse()
    .map(([x, y]) => [60 - x, y] as Vec2),
];
const rectangle = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const tool = (name: string, outline: Vec2[], hold: string, extra: object = {}) => ({ name, outline, depth: 8, clearance: 1, hold, ...extra });
const THREE = (holds: [string, string, string] = ['pegs', 'pegs', 'pegs']) => [
  tool('Screwdriver', SCREWDRIVER, holds[0], { depth: 26 }),
  tool('Wrench', WRENCH, holds[1]),
  tool('Pliers', PLIERS, holds[2]),
];

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const toManifold = (mesh: MeshData) => keep(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));

interface Built {
  o: object;
  layout: AttachmentLayout;
  mesh: MeshData;
  /** As it hangs, in its own frame. */
  hung: Manifold;
}

function build(type: string, opts: object): Built {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const layout = def.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout, ctx: CTX });
  const turnedBack = keep(toManifold(mesh).rotate(viewTurn(layout.pose)));
  const bb = turnedBack.boundingBox();
  const pb = partBounds(layout, CTX);
  return { o, layout, mesh, hung: keep(turnedBack.translate([pb.x0 - bb.min[0], pb.y0 - bb.min[1], pb.z0 - bb.min[2]])) };
}

/** No errors, nothing that needs support (overhangs, islands) and no walls too thin to print, and as big as planned. */
function expectClean(b: Built, what: string) {
  const c = checkPart(w, b.mesh);
  expect(
    c.issues.filter((i) => i.severity === 'error' || i.kind === 'overhang' || i.kind === 'thin'),
    what,
  ).toEqual([]);
  const mb = meshBounds(b.mesh);
  const want = printedSize(b.layout, CTX);
  expect(mb.max[0] - mb.min[0], what).toBeCloseTo(want.w, 1);
  expect(mb.max[1] - mb.min[1], what).toBeCloseTo(want.d, 1);
  expect(mb.max[2] - mb.min[2], what).toBeCloseTo(want.h, 1);
}

const prism = (pts: Vec2[], z0: number, z1: number) => keep(keep(keep(new w.CrossSection([pts], 'NonZero')).extrude(z1 - z0)).translate([0, 0, z0]));
const overlap = (a: Manifold, b: Manifold) => keep(a.intersect(b)).volume();
const moved = (m: Manifold, x: number, y: number, z: number) => keep(m.translate([x, y, z]));

// ---------------------------------------------------------------------------

describe('traced tools in options', () => {
  it('keep the bins’ pocket format, centred, with where they were in the file', () => {
    const [t] = cleanTraced([{ name: 'Bar', outline: rectangle(100, 50, 160, 70), depth: 6, clearance: 0.5, toolId: 'abc' }]);
    expect(t).toMatchObject({ name: 'Bar', depth: 6, clearance: 0.5, toolId: 'abc', x: 130, y: 60, rotation: 0, hold: 'pegs' });
    const b = bounds(t.outline);
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([-30, -10, 30, 10]);
    expect(signedArea(t.outline)).toBeGreaterThan(0);
    // Cleaning twice changes nothing.
    expect(cleanTraced(cleanTraced([{ name: 'P', outline: PLIERS.map(([x, y]) => [x + 0.037, y - 12.3]) }]))).toEqual(
      cleanTraced([{ name: 'P', outline: PLIERS.map(([x, y]) => [x + 0.037, y - 12.3]) }]),
    );
  });

  it('are capped: points, tools, sizes, and junk dropped', () => {
    // A traced outline with thousands of points comes down to TRACED.points, its shape kept.
    const dense = arc(0, 0, 40, 0, 359.9, 5000);
    const c = cleanOutline(dense)!;
    expect(c.outline.length).toBeLessThanOrEqual(TRACED.points);
    expect(Math.abs(signedArea(c.outline)) / (Math.PI * 40 * 40)).toBeCloseTo(1, 2);
    // On the 0.1 mm grid.
    for (const [x, y] of c.outline) {
      expect(Math.abs(x * 10 - Math.round(x * 10))).toBeLessThan(1e-9);
      expect(Math.abs(y * 10 - Math.round(y * 10))).toBeLessThan(1e-9);
    }
    // A dozen at most; points that aren't numbers, slivers, and things that aren't outlines dropped.
    expect(cleanTraced(Array.from({ length: 20 }, () => ({ outline: rectangle(0, 0, 10, 10) })))).toHaveLength(TRACED.tools);
    expect(
      cleanTraced([
        {
          outline: [
            [0, 0],
            [10, 'x'],
            [10, 10],
            [NaN, 3],
            [0, 10],
          ],
        },
      ])[0].outline,
    ).toHaveLength(3);
    expect(cleanTraced([{ outline: rectangle(0, 0, 1, 50) }, { outline: 'no' }, null, 7, { outline: rectangle(0, 0, 500, 10) }])).toEqual([]);
    const [t] = cleanTraced([{ name: 'x'.repeat(200), outline: rectangle(0, 0, 10, 10), depth: 900, clearance: -2, rotation: -90, hold: 'glue' }]);
    expect(t).toMatchObject({ depth: 60, clearance: 0, rotation: 270, hold: 'pegs' });
    expect(t.name).toHaveLength(40);
    // A holder keeps one.
    expect((attachmentDef('toolCradle')!.sanitize({ tools: THREE() }) as ToolCradleOptions).tools).toHaveLength(1);
  });

  it('fit in a project and its share link', () => {
    // A full board: a dozen different tools, each with as many points as it may keep (stars too jagged to simplify).
    const star = (i: number): Vec2[] =>
      Array.from({ length: TRACED.points }, (_, k) => {
        const r = (k % 2 ? 56.37 : 61.13) + Math.sin(k * (i + 1.7)) * 1.9;
        const a = (2 * Math.PI * k) / TRACED.points;
        return [r * Math.cos(a) + 0.0371 * k * i, r * Math.sin(a) * (1 + i / 17)];
      });
    const full = attachmentDef('shadowBoard')!.sanitize({
      tools: Array.from({ length: 20 }, (_, i) => tool(`Tool ${i}`, star(i), 'pegs')),
    }) as ShadowBoardOptions;
    expect(full.tools).toHaveLength(TRACED.tools);
    expect(full.tools.map((t) => t.outline.length)).toEqual(full.tools.map(() => TRACED.points));
    // About 46 kB of project, a 22 kB share link.
    expect(JSON.stringify(full).length).toBeLessThan(50_000);
    expect(encodeProject({ attachments: [{ type: 'shadowBoard', opts: full }] }).length).toBeLessThan(25_000);
    // Three ordinary tools: a few kB of link.
    const three = attachmentDef('shadowBoard')!.sanitize({ tools: THREE() });
    expect(encodeProject({ attachments: [{ type: 'shadowBoard', opts: three }] }).length).toBeLessThan(3000);
  });

  it('come from an SVG file, where they were in it', () => {
    const path = (pts: Vec2[], dx: number, dy: number) =>
      `<path d="M${pts.map(([x, y]) => `${(x + dx).toFixed(2)},${(210 - y - dy).toFixed(2)}`).join(' L')} Z"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="210mm" viewBox="0 0 300 210">${path(SCREWDRIVER, 10, 5)}${path(WRENCH, 60, 110)}${path(PLIERS, 225, 5)}</svg>`;
    const r = parseSVG(svg);
    expect(r.shapes).toHaveLength(3);
    const tools = cleanTraced(r.shapes.map((s, i) => ({ name: `Tool ${i + 1}`, outline: s.points, depth: 8, clearance: 1 })));
    const size = (t: TracedTool) => {
      const b = bounds(t.outline);
      return [Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0)];
    };
    expect(tools.map(size)).toEqual([
      [26, 185],
      [147, 34],
      [40, 198],
    ]);
    // Kept as in the file: the wrench is right of the screwdriver and above its middle, as drawn.
    const o = attachmentDef('shadowBoard')!.sanitize({ tools, arrange: 'keep' }) as ShadowBoardOptions;
    const p = shadowPlan(o, CTX);
    const mid = (i: number) => {
      const b = bounds(p.items[i].pts);
      return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    };
    expect(mid(1)[0] - mid(0)[0]).toBeCloseTo(tools[1].x - tools[0].x, 1);
    expect(mid(1)[1] - mid(0)[1]).toBeCloseTo(tools[1].y - tools[0].y, 1);
    expect(p.notes).toEqual([]);
  });
});

describe('shadow board', () => {
  it('cuts each outline in as big as the tool and its clearance, its top sloped at 45°', () => {
    const o = attachmentDef('shadowBoard')!.sanitize({
      tools: [tool('Bar', rectangle(0, 0, 60, 20), 'none', { clearance: 1 })],
      arrange: 'keep',
      notches: false,
      names: false,
      pocket: 2,
    }) as ShadowBoardOptions;
    const p = shadowPlan(o, CTX);
    const layout = attachmentDef('shadowBoard')!.layout(o, CTX);
    const s = new Scope();
    try {
      const body = shadowBoardBuilder.body(w, s, o as never, layout, CTX) as Manifold;
      const plate = layout.w * layout.h;
      const cut = (z: number) => plate - s.t(body.slice(z)).area();
      // On the front: the 60 × 20 bar grown by 1 mm all round (round corners), 0.05 mm in 0.05 mm off its top.
      expect(cut(p.t - 0.05)).toBeCloseTo(62 * 21.95 - (4 - Math.PI), 0);
      // 1.5 mm in: 1.5 mm off its top.
      expect(cut(p.t - 1.5)).toBeCloseTo(62 * 20.5 - (4 - Math.PI), 0);
      // Behind the shadow: nothing cut.
      expect(cut(p.t - 2.05)).toBeLessThan(0.01);
      // In two colours the cut is the inlay: it and the body make the plate, touching but not overlapping.
      expect(attachmentDef('shadowBoard')!.inlaid!(o)).toBe(false);
      const two = { ...o, fill: true };
      expect(attachmentDef('shadowBoard')!.inlaid!(two)).toBe(true);
      const split = shadowBoardBuilder.body(w, s, two as never, layout, CTX) as AttachmentBody;
      expect(split.inlays.map((i) => [i.name, i.role, i.filament])).toEqual([['Tool shadows', 'shadow', 2]]);
      const fill = split.inlays[0].m;
      expect(fill.volume() + split.body.volume()).toBeCloseTo(plate * p.t, 0);
      expect(s.t(fill.intersect(split.body)).volume()).toBeLessThan(0.01);
      expect(fill.volume()).toBeCloseTo((62 * 22 - (4 - Math.PI)) * 2 - (62 * 2 * 2) / 2, 0);
      expect(split.body.volume()).toBeCloseTo(body.volume(), 1);
    } finally {
      s.dispose();
    }
  });

  it('in two colours, prints its shadows as a body of their own', () => {
    const b = build('shadowBoard', { tools: THREE(['pegs', 'magnets', 'ledge']), fill: true });
    expectClean(b, 'two colours');
    expect(b.mesh.overlays?.map((o) => [o.name, o.role, o.filament])).toEqual([['Tool shadows', 'shadow', 2]]);
    // Planning knows it needs a second filament.
    const job = planPrint(
      [
        {
          id: 'b',
          name: 'Board',
          drawer: {
            ...DEFAULT_DRAWER,
            enclosure: 'skadis',
            skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 },
            attachments: [{ id: 's', type: 'shadowBoard', x: 280, y: 280, opts: { tools: THREE(), fill: true } }],
          },
          baseplate: DEFAULT_BASEPLATE,
          bins: [],
        },
      ],
      DEFAULT_SETUP,
      { baseplate: true, bins: true },
    );
    expect(usesSecondFilament(job)).toBe(true);
  });

  it('slope45 drops a recess’s top as it goes in, and raises a peg’s underside as it goes out', () => {
    const s = new Scope();
    try {
      const sq = s.t(s.t(w.CrossSection.square([10, 10])).translate([0, 0]));
      const cut = slope45(s, sq, 0, 5, 5);
      // At the face the square, 3 mm in its top 3 mm lower.
      expect(s.t(cut.slice(4.99)).bounds().max[1]).toBeCloseTo(10, 1);
      expect(s.t(cut.slice(2)).bounds().max[1]).toBeCloseTo(7, 1);
      const peg = slope45(s, sq, 5, 10, 5);
      expect(s.t(peg.slice(8)).bounds().min[1]).toBeCloseTo(3, 1);
      expect(s.t(peg.slice(8)).bounds().max[1]).toBeCloseTo(10, 1);
    } finally {
      s.dispose();
    }
  });

  for (const [arrange, holds] of [
    ['upright', ['pegs', 'pegs', 'pegs']],
    ['upright', ['ledge', 'magnets', 'none']],
    ['across', ['ledge', 'magnets', 'ledge']],
    ['across', ['pegs', 'ledge', 'pegs']],
  ] as const) {
    it(`prints upright with nothing to support: ${arrange}, held with ${holds.join(', ')}`, () => {
      const b = build('shadowBoard', { tools: THREE([...holds]), arrange });
      expectClean(b, `${arrange} ${holds}`);
      const def = attachmentDef('shadowBoard')!;
      expect(def.notes!(b.o, CTX)).toEqual([]);
    });
  }

  it('hangs a screwdriver on pegs straddling its shaft under the handle, an upright wrench under its top head', () => {
    const sd = turned(SCREWDRIVER, uprightTurn(SCREWDRIVER));
    const b = bounds(sd);
    // Handle up.
    expect(sd.filter(([, y]) => y > b.y1 - 5).length).toBeGreaterThan(2);
    const pegs = pegSpots(sd, SHADOW.peg.w, 1, 14);
    expect(pegs).toHaveLength(2);
    // Under the handle (95 long at the top of 185), either side of the shaft: the shaft passes between them.
    const handleBottom = b.y1 - 95;
    for (const g of pegs) expect(g.y).toBeCloseTo(handleBottom - 1, 0);
    const shaft = (b.x0 + b.x1) / 2;
    expect(Math.min(...pegs.map((g) => g.x))).toBeLessThan(shaft - 3 - 1 - SHADOW.peg.w / 2 + 1e-6);
    expect(Math.max(...pegs.map((g) => g.x))).toBeGreaterThan(shaft + 3 + 1 + SHADOW.peg.w / 2 - 1e-6);
    // An upright wrench: under its top head, clear of the bottom one.
    const wr = turned(WRENCH, uprightTurn(WRENCH));
    const wb = bounds(wr);
    for (const g of pegSpots(wr, SHADOW.peg.w, 1, 14)) expect(g.y).toBeGreaterThan(wb.y1 - 40);
  });

  it('holds each tool: it rests on its pegs or in its ledge, a lip in front, magnets under it', () => {
    const b = build('shadowBoard', { tools: THREE(['pegs', 'magnets', 'ledge']), names: false });
    const p = shadowPlan(b.o as ShadowBoardOptions, CTX);
    const front = p.t;
    for (const it of p.items) {
      const t = it.tool;
      // The tool where it hangs: its outline, as thick as it is, on the plate's front.
      const solid = prism(it.pts, front + 0.05, front + t.depth);
      expect(overlap(b.hung, solid), t.name).toBeLessThan(0.05);
      if (t.hold === 'none') continue;
      if (t.hold === 'magnets') {
        // Two pockets, each taking its magnet flush with the shadow's floor.
        expect(it.magnets).toHaveLength(2);
        const [md, mt] = MAGNETS[(b.o as ShadowBoardOptions).magnet];
        for (const [x, y] of it.magnets) {
          const magnet = keep(keep(w.Manifold.cylinder(mt, md / 2, md / 2, 32)).translate([x, y, front - (b.o as ShadowBoardOptions).pocket - mt]));
          expect(overlap(b.hung, magnet), t.name).toBeLessThan(0.01);
          expect(overlap(b.hung, moved(magnet, 0, 0, -0.5)), t.name).toBeGreaterThan(1);
        }
        continue;
      }
      // Dropped a little (its clearance and a bit), it lands on its pegs or ledge; pushed out from the board past its
      // thickness, it meets their lips.
      expect(overlap(b.hung, moved(solid, 0, -t.clearance - 0.5, 0)), `${t.name} rests`).toBeGreaterThan(1);
      expect(overlap(b.hung, moved(solid, 0, 0, t.clearance + 1)), `${t.name} lip`).toBeGreaterThan(0.5);
    }
  });

  it('lays tools out in rows within its width, standing up or across, and grows to fit', () => {
    const def = attachmentDef('shadowBoard')!;
    const up = shadowPlan(def.sanitize({ tools: THREE(), width: 400 }) as ShadowBoardOptions, CTX);
    // One row: side by side, their tops lined up, inside the board with room round them.
    const tops = up.items.map((i) => i.box[3]);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1e-6);
    for (const it of up.items) {
      expect(it.box[0]).toBeGreaterThanOrEqual(SHADOW.margin - 1e-6);
      expect(it.box[2]).toBeLessThanOrEqual(up.w - SHADOW.margin + 1e-6);
      expect(it.box[1]).toBeGreaterThanOrEqual(SHADOW.margin - 1e-6);
      expect(it.box[3]).toBeLessThanOrEqual(up.h - SHADOW.margin + 1e-6);
      // Standing up: taller than wide.
      const b = bounds(it.pts);
      expect(b.y1 - b.y0, it.tool.name).toBeGreaterThan(b.x1 - b.x0);
    }
    for (let i = 1; i < up.items.length; i++) expect(up.items[i].box[0] - up.items[i - 1].box[2]).toBeCloseTo(12, 6);
    expect(up.w).toBe(400);
    // Narrow: a row each, and taller.
    const narrow = shadowPlan(def.sanitize({ tools: THREE(), width: 40 }) as ShadowBoardOptions, CTX);
    expect(new Set(narrow.items.map((i) => Math.round(i.box[3]))).size).toBe(3);
    expect(narrow.h).toBeGreaterThan(up.h + 300);
    // Across: lying down, wider than tall.
    const across = shadowPlan(def.sanitize({ tools: THREE(), arrange: 'across' }) as ShadowBoardOptions, CTX);
    for (const it of across.items) {
      const b = bounds(it.pts);
      expect(b.x1 - b.x0, it.tool.name).toBeGreaterThan(b.y1 - b.y0);
    }
    // A turn of its own turns a tool a quarter.
    const turnedOne = shadowPlan(def.sanitize({ tools: [{ ...THREE()[1], rotation: 90 }], arrange: 'across' }) as ShadowBoardOptions, CTX);
    const tb = bounds(turnedOne.items[0].pts);
    expect(tb.y1 - tb.y0).toBeGreaterThan(tb.x1 - tb.x0);
  });

  it('takes a label along its bottom, under the tools', () => {
    const def = attachmentDef('shadowBoard')!;
    for (const opts of [{}, { tools: THREE() }, { tools: THREE(), arrange: 'across', height: 300 }]) {
      const o = def.sanitize(opts);
      const f = def.labelFace!(o, def.layout(o, CTX))!;
      expect(f.h).toBeGreaterThanOrEqual(4);
      for (const it of shadowPlan(o as ShadowBoardOptions, CTX).items) expect(it.box[1]).toBeGreaterThan(f.y + f.h);
    }
  });

  it('says what’s off, and lists the magnets', () => {
    const def = attachmentDef('shadowBoard')!;
    // An empty board is a plain plate: nothing to warn about.
    expect(def.notes!(def.sanitize({}), CTX)).toEqual([]);
    const thin = [tool('Rod', rectangle(0, 0, 4, 120), 'pegs'), tool('Pin', rectangle(0, 0, 5, 60), 'magnets')];
    const notes = def.notes!(def.sanitize({ tools: thin }), CTX).join(' ');
    expect(notes).toMatch(/Rod is too narrow for two pegs/);
    expect(notes).toMatch(/Pin is too narrow for 8 mm magnets/);
    expect(
      def.notes!(
        def.sanitize({ tools: [tool('A', rectangle(0, 0, 50, 50), 'none'), tool('B', rectangle(20, 20, 70, 70), 'none')], arrange: 'keep' }),
        CTX,
      ).join(),
    ).toMatch(/overlap/);
    expect(def.hardware!(def.sanitize({ tools: THREE(['magnets', 'magnets', 'pegs']), magnet: '10x3' }))).toEqual([
      { item: 'Magnets 10 × 3 mm (shadow board)', count: 4, note: expect.stringMatching(/glued/) },
    ]);
    expect(def.hardware!(def.sanitize({ tools: THREE() }))).toEqual([]);
    // Thicker where 3 mm magnets need it.
    expect(shadowPlan(def.sanitize({ tools: THREE(['pegs', 'magnets', 'pegs']), magnet: '10x3', thick: 3 }) as ShadowBoardOptions, CTX).t).toBeCloseTo(
      1 + 3.2 + 1.2,
      6,
    );
    expect(def.summary(def.sanitize({ tools: THREE() }))).toBe('Shadow board, 3 tools');
  });

  it('engraves the tools’ names under them', () => {
    const font = readFileSync(resolve(__dirname, '../public/fonts/RobotoCondensed-Bold.ttf'));
    registerFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
    const named = build('shadowBoard', { tools: THREE(), names: true });
    expectClean(named, 'names');
    const p = shadowPlan(named.o as ShadowBoardOptions, CTX);
    for (const it of p.items) {
      // Its strip under the tool is the plate's front, but for the letters cut 0.6 mm into it.
      const n = it.name!;
      const strip = keep(keep(w.Manifold.cube([n.w, SHADOW.name.size, 0.5])).translate([n.x - n.w / 2, n.y - SHADOW.name.size / 2, p.t - 0.5]));
      expect(strip.volume() - overlap(named.hung, strip), it.tool.name).toBeGreaterThan(2);
      expect(overlap(named.hung, moved(strip, 0, 0, -0.6)), it.tool.name).toBeCloseTo(strip.volume(), 1);
    }
  });
});

describe('holder for a traced tool', () => {
  for (const [name, outline, depth] of [
    ['wrench', WRENCH, 8],
    ['pliers', PLIERS, 10],
    ['screwdriver', SCREWDRIVER, 26],
  ] as const) {
    it(`a ${name} lies in its own outline on a 45° tray, and it prints with nothing to support`, () => {
      const b = build('toolCradle', { tools: [tool(name, outline, 'pegs', { depth })] });
      expectClean(b, name);
      const k = cradlePlan(b.o as ToolCradleOptions, CTX);
      expect(k.p).toBe(depth);
      // The tool as it lies in the pocket: its outline (in the tray's frame), as thick as it is, its back on the
      // pocket's floor, stood at 45° like the tray.
      const lie = (dv: number, dw: number) =>
        keep(keep(keep(prism(k.pts, -k.p + 0.05 + dw, -k.p + depth + dw).translate([0, dv, 0])).rotate([-45, 0, 0])).translate([0, 0, k.d]));
      expect(overlap(b.hung, lie(0, 0)), 'fits').toBeLessThan(0.05);
      // Slid down the slope past its clearance, it meets the pocket's bottom wall: that's what holds it.
      expect(overlap(b.hung, lie(-k.tool.clearance - 0.6, 0)), 'rests').toBeGreaterThan(1);
      // The tray: its face at 45°, meeting the back plate's front at `meet`, its foot on the bed `d` out.
      expect(b.layout.depth).toBeCloseTo(k.d, 6);
      expect(overlap(b.hung, keep(keep(w.Manifold.cube([b.layout.w - 2, 1, 1])).translate([1, 0, k.d - 3])))).toBeGreaterThan(0.1);
      expect(k.meet).toBeCloseTo(k.d - TOOL_CRADLE.back, 6);
    });
  }

  it('stands in for a tool until one is traced, sized from the tool, with a label and a bolt above the tray', () => {
    const def = attachmentDef('toolCradle')!;
    const o = def.sanitize({});
    expect(def.notes?.(o, CTX) ?? []).toEqual([]);
    expect(def.summary(o)).toBe('Tool holder');
    const wr = def.sanitize({ tools: [tool('Spanner', WRENCH, 'pegs')] });
    expect(def.summary(wr)).toBe('Holder for Spanner');
    expect(def.notes?.(wr, CTX) ?? []).toEqual([]);
    const l = def.layout(wr, CTX);
    // As wide as the wrench lying across, with its clearance and plastic each side.
    const wb = bounds(WRENCH);
    expect(l.w).toBeCloseTo(wb.x1 - wb.x0 + 2 + 2 * TOOL_CRADLE.side, 0);
    expect(def.labelFace!(wr, l)!.y).toBeGreaterThan(l.h - TOOL_CRADLE.above);
    expect(attachmentUi('toolCradle')!.resize).toEqual({ w: null, h: null });
    // Its pocket's depth: the tool's thickness, or as asked.
    expect(cradlePlan(def.sanitize({ tools: [tool('Spanner', WRENCH, 'pegs', { depth: 7 })] }) as ToolCradleOptions, CTX).p).toBe(7);
    expect(cradlePlan(def.sanitize({ tools: [tool('Spanner', WRENCH, 'pegs', { depth: 7 })], depth: 4 }) as ToolCradleOptions, CTX).p).toBe(4);
  });
});

describe('on a board', () => {
  const board = (attachments: PlacedAttachment[]): NamedDrawer => ({
    id: 'b',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 560, height: 560 }, attachments },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  });

  it('places, builds and prints with the board, and takes a bolt and a label', () => {
    // Put where they fit (planning leaves parts where they're put: tests/wallFit.ts).
    const job = planPrint(
      [
        fitted(
          board([
            { id: 's', type: 'shadowBoard', x: 160, y: 400, opts: { tools: THREE(['pegs', 'ledge', 'magnets']) }, bolt: 'm3' },
            { id: 'c', type: 'toolCradle', x: 440, y: 160, opts: { tools: [tool('Wrench', WRENCH, 'pegs')] }, label: 'SPANNER', bolt: 'm4' },
          ]),
        ),
      ],
      DEFAULT_SETUP,
      { baseplate: true, bins: true },
    );
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.map((p) => p.ok)).toEqual([true, true]);
    for (const p of wall.placed) expect(p.extras?.bolts?.length, p.type).toBeGreaterThan(0);
    expect(wall.placed[1].extras?.label?.text).toBe('SPANNER');
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.name).toBe(true);
    for (const p of wall.placed) {
      const mesh = buildMesh(w, job.meshes[parts.find((q) => q.attachment === p.id && q.name.includes(p.name))!.meshKey]);
      expect(
        checkPart(w, mesh).issues.filter((i) => i.severity === 'error'),
        p.type,
      ).toEqual([]);
    }
  });

  it('its form has the outlines field, and every field is an option', () => {
    for (const type of ['shadowBoard', 'toolCradle']) {
      const ui = attachmentUi(type)!;
      expect(ui.group).toBe('tools');
      const f = ui.fields.find((x) => x.kind === 'outlines');
      expect(f && f.key).toBe('tools');
      expect(Object.keys(attachmentDef(type)!.defaults)).toEqual(expect.arrayContaining(ui.fields.map((x) => x.key)));
    }
    expect(attachmentUi('shadowBoard')!.fields.find((x) => x.kind === 'outlines')).toMatchObject({ max: TRACED.tools, hold: true });
    expect(attachmentUi('toolCradle')!.fields.find((x) => x.kind === 'outlines')).toMatchObject({ max: 1 });
  });

  it('keeps its tools clear of each other and of the plate’s edge', () => {
    const p = shadowPlan(attachmentDef('shadowBoard')!.sanitize({ tools: THREE(['pegs', 'ledge', 'pegs']), width: 120 }) as ShadowBoardOptions, CTX);
    for (let i = 0; i < p.items.length; i++)
      for (let j = i + 1; j < p.items.length; j++) {
        const a = p.items[i].box;
        const b = p.items[j].box;
        expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);
        expect(polygonsIntersect(p.items[i].pts, p.items[j].pts)).toBe(false);
      }
  });
});
