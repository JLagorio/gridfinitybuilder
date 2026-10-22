import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Module from 'manifold-3d';
import type { Manifold, Vec2, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds } from '../src/lib/geometry/kernel';
import { registerFont } from '../src/lib/geometry/text';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { buildMesh, planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { encodeProject } from '../src/lib/share';
import { attachmentDef, type AttachmentLayout, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { mountBox, partBounds, printedSize, siteAt } from '../src/lib/wall/mount';
import { loadCheck } from '../src/lib/wall/load';
import { resizeAxes, resized } from '../src/lib/wall/resize';
import { CUSTOM, cleanProfile, exitAlong, overhangs, profileFaces, profileProblem, signedArea, thinnest, type Feature } from '../src/lib/wall/custom/profile';
import { PRESETS, PRESET_KEYS, presetOptions, type PresetKey } from '../src/lib/wall/custom/presets';
import { customAddOns, featureSpots } from '../src/lib/wall/custom/part';
import { addPoint, movePoint, removePoint, snapPoint } from '../src/lib/wall/custom/edit';
import { cleanCustom, customLayout, type CustomOptions } from '../src/lib/wall/kinds/custom';
import { customBuilder } from '../src/lib/wall/kinds/custom.geom';
import { attachmentsFromHash, attachmentsShareUrl, entryFromAttachments, placedOf } from '../src/lib/myAttachments';
import { fitted } from './wallFit';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const font = readFileSync(resolve(__dirname, '../public/fonts/RobotoCondensed-Bold.ttf'));
  registerFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength));
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const def = () => attachmentDef('custom')!;
const opts = (o: Partial<CustomOptions> = {}): CustomOptions => cleanCustom({ ...presetOptions('ledge'), ...o });

let live: { delete(): void }[] = [];
afterEach(() => {
  for (const m of live) m.delete();
  live = [];
});

/** A part's body in its own frame (the wall's: x across, y up, z out), without its mounts. */
function body(o: CustomOptions): { m: Manifold; layout: AttachmentLayout } {
  const layout = customLayout(o, CTX);
  const s = new Scope();
  try {
    const raw = customBuilder.body(w, s, o, layout, CTX);
    const m = ('inlays' in raw ? raw.body : raw).translate([0, 0, 0]);
    live.push(m);
    return { m, layout };
  } finally {
    s.dispose();
  }
}

/** Whether there's plastic at a point (a 0.2 mm cube round it). */
function solidAt(m: Manifold, [x, y, z]: [number, number, number]): boolean {
  const c = w.Manifold.cube([0.2, 0.2, 0.2], true).translate([x, y, z]);
  const i = m.intersect(c);
  const v = i.volume();
  c.delete();
  i.delete();
  return v > 1e-4;
}

/** A part built and print-checked in its pose: no errors, no overhangs or thin walls when upright, as big as planned. */
function buildChecked(o: CustomOptions, label: string) {
  const d = def();
  const layout = d.layout(o, CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: label, type: 'custom', opts: o, layout, ctx: CTX });
  const c = checkPart(w, mesh);
  expect(
    c.issues.filter((i) => i.severity === 'error'),
    label,
  ).toEqual([]);
  if (layout.pose === 'upright')
    expect(
      c.issues.filter((i) => i.kind === 'overhang' || i.kind === 'thin'),
      label,
    ).toEqual([]);
  const b = meshBounds(mesh);
  const want = printedSize(layout, CTX);
  expect(b.max[0] - b.min[0], label).toBeCloseTo(want.w, 1);
  expect(b.max[1] - b.min[1], label).toBeCloseTo(want.d, 1);
  expect(b.max[2] - b.min[2], label).toBeCloseTo(want.h, 1);
  return { layout, mesh, check: c };
}

describe('presets', () => {
  for (const k of PRESET_KEYS) {
    it(`${k}: builds clean in every pose it allows, as big as planned, with nothing to note`, () => {
      const base = presetOptions(k);
      const p = base.profile;
      expect(profileProblem(p), k).toBeNull();
      expect(signedArea(p), k).toBeGreaterThan(0);
      expect(thinnest(p, 60)!.t, k).toBeGreaterThanOrEqual(CUSTOM.wall);
      const poses = overhangs(p).length ? (['side'] as const) : (['upright', 'side'] as const);
      for (const pose of poses) {
        const o = cleanCustom({ ...base, pose });
        expect(customLayout(o, CTX).pose).toBe(pose);
        buildChecked(o, `${k} ${pose}`);
        // Side: its end walls print as bridges (noted); otherwise nothing to say.
        const notes = def().notes!(o, CTX).filter((n) => !n.includes('bridges'));
        expect(notes, `${k} ${pose}`).toEqual([]);
      }
      // Auto: upright where it can and stands steady; the bracket (a narrow foot) lies on its side.
      expect(customLayout(cleanCustom(base), CTX).pose).toBe(k === 'bracket' ? 'side' : 'upright');
    });
  }

  it('each starts on the plate, fits a 60 mm plate and a lattice width', () => {
    for (const k of PRESET_KEYS) {
      const p: PresetKey = k;
      expect(PRESETS[p].width % 20, k).toBe(0);
      expect(Math.max(...PRESETS[p].profile.map((q) => q[1])), k).toBeLessThanOrEqual(PRESETS[p].height);
      const l = customLayout(cleanCustom(presetOptions(p)), CTX);
      expect(l.w, k).toBe(PRESETS[p].width);
      expect(l.h, k).toBe(60);
    }
  });

  it('the angled tool holder’s holes go through its sloping top, leaning back', () => {
    const o = cleanCustom(presetOptions('tools'));
    const spots = featureSpots(o, customLayout(o, CTX), CTX);
    expect(spots).toHaveLength(5);
    expect(spots.every((s) => s.ok && s.tear === null)).toBe(true);
    // Through the block: from its top down to the 45° underside or the bed.
    for (const s of spots) expect(s.depth).toBeGreaterThan(10);
    // Into the face along its normal: down and out from the board, so a tool's handle leans back.
    expect(spots[0].face.n[0]).toBeLessThan(0);
    expect(spots[0].face.n[1]).toBeGreaterThan(0.9);
  });
});

describe('the 45° rule', () => {
  it('passes 45° and steeper, fails flatter, lets anything lie on the bed', () => {
    // A ledge on the bed: its underside is the bed.
    expect(overhangs(presetOptions('ledge').profile)).toEqual([]);
    // A ledge lifted 10 mm: its flat underside needs support.
    const lifted: Vec2[] = [
      [0, 10],
      [50, 10],
      [50, 15],
      [0, 15],
    ];
    expect(overhangs(lifted)).toEqual([0]);
    // Under at 45° and steeper: fine; flatter: not.
    const at = (deg: number): Vec2[] => {
      const t = Math.tan((deg * Math.PI) / 180);
      return [
        [0, 4],
        [4, 4],
        [44, 4 + 40 * t],
        [44, 4 + 40 * t + 5],
        [0, 4 + 40 * t + 5],
      ];
    };
    expect(overhangs(at(45))).toEqual([]);
    expect(overhangs(at(60))).toEqual([]);
    expect(overhangs(at(30))).toEqual([1]);
    expect(overhangs(at(44))).toEqual([1]);
  });

  it('ignores what is inside the plate and what faces up', () => {
    // A flat bottom edge from z 0 to 3 (inside the plate) under a 45° brace.
    expect(
      overhangs([
        [0, 10],
        [3, 10],
        [43, 50],
        [0, 50],
      ]),
    ).toEqual([]);
    // Flat tops and steps up face up.
    expect(
      overhangs([
        [0, 0],
        [30, 0],
        [30, 10],
        [20, 10],
        [20, 20],
        [0, 20],
      ]),
    ).toEqual([]);
  });

  it('a profile that can’t print upright prints on its side, unless you say upright: then it’s noted', () => {
    const lifted: Vec2[] = [
      [0, 30],
      [50, 30],
      [50, 35],
      [0, 35],
    ];
    const auto = opts({ profile: lifted });
    expect(customLayout(auto, CTX).pose).toBe('side');
    expect(def().notes!(auto, CTX)).toEqual([]);
    // On its side: a hook at its left, flush with the bed; a stud under it.
    const l = customLayout(auto, CTX);
    expect(l.mounts.map((m) => m.kind)).toEqual(['hook', 'stud']);
    expect(partBounds(l, CTX).x0).toBeGreaterThanOrEqual(0);
    buildChecked(auto, 'lifted ledge, side');
    const up = opts({ profile: lifted, pose: 'upright' });
    expect(customLayout(up, CTX).pose).toBe('upright');
    expect(def().notes!(up, CTX).join(' ')).toMatch(/flatter than 45°/);
  });
});

describe('cleaning', () => {
  it('keeps a good profile as it is, to 0.1 mm', () => {
    const p = presetOptions('jhook').profile;
    expect(cleanProfile(p)!.pts).toEqual(p);
    expect(cleanProfile(p.map(([z, y]) => [z + 0.04, y - 0.04]))!.pts).toEqual(p);
  });

  it('turns a clockwise one round, its features with their edges', () => {
    const p = presetOptions('tools').profile;
    // Clockwise, the sloping top (edge 3 of the preset: from point 3 to 4) is edge 1 (from point 4 to 3).
    const [f] = presetOptions('tools').features;
    const o = cleanCustom({ ...presetOptions('tools'), profile: [...p].reverse(), features: [{ ...f, f: 1 }] });
    expect(o.profile).toEqual(p);
    expect(signedArea(o.profile)).toBeGreaterThan(0);
    expect(o.features[0].f).toBe(3);
  });

  it('gives garbage its preset’s profile: edges crossing, off the plate, too small, NaN, not a list', () => {
    const ledge = presetOptions('ledge').profile;
    const bowtie: Vec2[] = [
      [0, 0],
      [40, 20],
      [40, 0],
      [0, 20],
    ];
    const loose: Vec2[] = [
      [20, 0],
      [40, 0],
      [40, 10],
      [20, 10],
    ];
    for (const profile of [
      bowtie,
      loose,
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      [
        [NaN, NaN],
        [0, 0],
      ],
      'a',
      5,
      null,
      { 0: [1, 2] },
    ])
      expect(cleanCustom({ profile }).profile, JSON.stringify(profile)).toEqual(ledge);
    // Garbage options all round.
    const g = cleanCustom({ width: 'x', height: -5, pose: 'flying', features: [{ f: 99 }, { f: 'q' }, 7], lip: Infinity, dividers: 1e9, ends: 3 });
    expect(g).toEqual({ ...presetOptions('ledge'), height: 20, lip: 0, dividers: 20, features: [] });
    expect(cleanCustom(undefined)).toEqual(cleanCustom(presetOptions('ledge')));
  });

  it('drops points that aren’t numbers and repeats, and thins a long list to 40', () => {
    const p = presetOptions('ledge').profile;
    expect(cleanProfile([p[0], ['a', 1], p[1], p[1], p[2], [NaN, 3], p[3], p[4], p[5], p[5]])!.pts).toEqual(p);
    // A block with a 300-point wavy top: 40 points at most, still a usable profile on the plate.
    const wave: Vec2[] = [
      [0, 0],
      [70, 0],
    ];
    for (let k = 300; k >= 0; k--) wave.push([10 + k / 5, 20 + 3 * Math.sin(k / 10)]);
    wave.push([0, 20]);
    const c = cleanProfile(wave)!;
    expect(c.pts.length).toBe(CUSTOM.points);
    expect(profileProblem(c.pts)).toBeNull();
    expect(Math.abs(signedArea(c.pts) - signedArea(wave))).toBeLessThan(0.03 * signedArea(wave));
  });

  it('clamps sizes: behind the board and below the bed onto them, nothing past 200 mm', () => {
    const c = cleanProfile([
      [-5, -5],
      [400, -1],
      [400, 6],
      [0, 6],
    ])!;
    expect(c.pts).toEqual([
      [0, 0],
      [200, 0],
      [200, 6],
      [0, 6],
    ]);
  });

  it('options round to 0.1 mm, and a part makes a short share link', () => {
    const o = cleanCustom({ ...presetOptions('tools'), width: 80.04, lip: 3.333 });
    expect(o.width).toBe(80);
    expect(o.lip).toBe(3.3);
    const project = { drawers: [{ attachments: [{ id: 'a', type: 'custom', x: 0, y: 0, opts: o }] }] };
    expect(encodeProject(project).length).toBeLessThan(400);
  });
});

describe('features', () => {
  const holes: Feature = { f: 2, k: 'round', a: 6, b: 6, d: 0, u: 0, v: 0, n: 3, m: 1, su: 15, sv: 15 };

  it('a row of holes through a ledge, where they should be: centred on its top, right through it', () => {
    const plain = body(opts());
    const holed = body(opts({ features: [holes] }));
    // The ledge's top runs from its front (z 60) back to the fillet (z 9): its middle is 34.5 out.
    for (const x of [25, 40, 55]) {
      expect(solidAt(holed.m, [x, 2.5, 34.5]), `${x}`).toBe(false);
      expect(solidAt(plain.m, [x, 2.5, 34.5])).toBe(true);
    }
    expect(solidAt(holed.m, [32.5, 2.5, 34.5])).toBe(true);
    // Upright, the holes stand up: round, no teardrop.
    expect(holed.layout.pose).toBe('upright');
    expect(solidAt(holed.m, [40 + 3.6, 2.5, 34.5])).toBe(true);
    // What they take out: three 6 mm holes through 5 mm.
    const cut = plain.m.volume() - holed.m.volume();
    expect(cut).toBeGreaterThan(0.95 * 3 * Math.PI * 9 * 5);
    expect(cut).toBeLessThan(1.02 * 3 * Math.PI * 9 * 5);
  });

  it('on its side, holes that lie down get a teardrop top, pointing up as printed', () => {
    const side = body(opts({ features: [holes], pose: 'side' }));
    expect(side.layout.pose).toBe('side');
    // Up as printed is across the part (+x): the tip reaches r√2 that way.
    expect(solidAt(side.m, [40 + 3.6, 2.5, 34.5])).toBe(false);
    expect(solidAt(side.m, [40 - 3.6, 2.5, 34.5])).toBe(true);
    expect(solidAt(side.m, [40 + 4.6, 2.5, 34.5])).toBe(true);
    const spots = featureSpots(opts({ features: [holes], pose: 'side' }), side.layout, CTX);
    expect(spots.every((s) => s.tear?.[0] === 1)).toBe(true);
    buildChecked(opts({ features: [holes], pose: 'side' }), 'ledge with holes, on its side');
  });

  it('upright, a hole through a face looking out gets its teardrop pointing up the wall', () => {
    // Through the tray's lip, out at its front (edge 1: from (70, 0) up to (70, 22)).
    const f: Feature = { f: 1, k: 'round', a: 8, b: 8, d: 0, u: 0, v: 0, n: 1, m: 1, su: 10, sv: 10 };
    const o = cleanCustom({ ...presetOptions('tray'), features: [f] });
    const l = customLayout(o, CTX);
    const [s] = featureSpots(o, l, CTX);
    expect(s.ok).toBe(true);
    expect(s.tear).toEqual([0, 1]);
    // Through the 2.4 mm lip only, not on through the tray to the plate.
    expect(s.depth).toBeCloseTo(CUSTOM.lip + 0.6, 1);
    const { m } = body(o);
    expect(solidAt(m, [50, 11, 69])).toBe(false);
    expect(solidAt(m, [50, 11 + 5.3, 69])).toBe(false);
    expect(solidAt(m, [50, 11 - 4.6, 69])).toBe(true);
    // The plate behind is whole.
    expect(solidAt(m, [50, 11, 2])).toBe(true);
    buildChecked(o, 'tray with a hole in its lip');
  });

  it('slots, rectangles, hex holes, notches and text all cut, and build clean', () => {
    const all: Feature[] = [
      { f: 2, k: 'slot', a: 20, b: 6, d: 0, u: -20, v: 10, n: 1, m: 1, su: 10, sv: 10 },
      { f: 2, k: 'rect', a: 10, b: 8, d: 2, u: 15, v: 10, n: 1, m: 1, su: 10, sv: 10 },
      { f: 2, k: 'hex', a: 6.6, b: 6.6, d: 0, u: 0, v: -10, n: 4, m: 1, su: 12, sv: 10 },
      { f: 2, k: 'text', a: 30, b: 5, d: 0.6, u: 20, v: -18, n: 1, m: 1, su: 10, sv: 10, t: 'BITS' },
    ];
    const o = opts({ features: all });
    const l = customLayout(o, CTX);
    expect(featureSpots(o, l, CTX).every((s) => s.ok)).toBe(true);
    const plain = body(opts()).m.volume();
    const each = all.map((f) => plain - body(opts({ features: [f] })).m.volume());
    for (const [k, v] of each.entries()) expect(v, all[k].k).toBeGreaterThan(1);
    // The rectangle is a 2 mm pocket: 10 × 8 × 2.
    expect(each[1]).toBeCloseTo(160, 0);
    buildChecked(o, 'ledge with everything');
    // A finger notch in the tray's lip, from its top edge down.
    const notch: Feature = { f: 1, k: 'notch', a: 20, b: 20, d: 0, u: 0, v: 3, n: 1, m: 1, su: 10, sv: 10 };
    const t = cleanCustom({ ...presetOptions('tray'), features: [notch] });
    const tm = body(t).m;
    // Its round bottom is 3 mm above the lip's middle (11 + 3), the cut open to the top (22).
    expect(solidAt(tm, [50, 20, 69])).toBe(false);
    expect(solidAt(tm, [50, 14.5, 69])).toBe(false);
    expect(solidAt(tm, [50, 2, 69])).toBe(true);
    expect(solidAt(tm, [30, 20, 69])).toBe(true);
    buildChecked(t, 'tray with a notch');
  });

  it('leaves out what doesn’t fit its face or sits over a mount, and says so', () => {
    const off: Feature = { f: 2, k: 'round', a: 6, b: 6, d: 0, u: 0, v: 40, n: 1, m: 1, su: 10, sv: 10 };
    const o = opts({ features: [off] });
    expect(featureSpots(o, customLayout(o, CTX), CTX)[0].ok).toBe(false);
    expect(def().notes!(o, CTX).join(' ')).toMatch(/left out/);
    // On the plate's front, over a clip: left out; beside it, fine.
    const l = customLayout(opts(), CTX);
    const clip = mountBox('clip', siteAt(l, l.mounts[0], CTX), CTX);
    const plate = profileFaces(opts().profile, l.h).find((f) => f.id === -1)!;
    const over: Feature = {
      f: -1,
      k: 'round',
      a: 5,
      b: 5,
      d: 0,
      u: (clip.x0 + clip.x1) / 2 - l.w / 2,
      v: (clip.y0 + clip.y1) / 2 - (plate.a[1] + plate.len / 2),
      n: 1,
      m: 1,
      su: 10,
      sv: 10,
    };
    const o2 = opts({ features: [over] });
    expect(featureSpots(o2, customLayout(o2, CTX), CTX)[0].ok).toBe(false);
    const o3 = opts({ features: [{ ...over, u: 0 }] });
    expect(featureSpots(o3, customLayout(o3, CTX), CTX)[0].ok).toBe(true);
    // Through the plate there, and only the plate.
    expect(featureSpots(o3, customLayout(o3, CTX), CTX)[0].depth).toBeCloseTo(CUSTOM.plate + 0.6, 1);
  });

  it('a wall’s depth under a face: through the plate, the ledge, the lip', () => {
    const p = presetOptions('tray').profile;
    expect(exitAlong(p, 60, [CUSTOM.plate, 40], [-1, 0])).toBeCloseTo(CUSTOM.plate, 3);
    expect(exitAlong(p, 60, [30, 3], [0, -1])).toBeCloseTo(3, 3);
    expect(exitAlong(p, 60, [70, 10], [-1, 0])).toBeCloseTo(2.4, 3);
    // From outside: nothing.
    expect(exitAlong(p, 60, [30, 10], [0, 1])).toBe(0);
  });
});

describe('add-ons', () => {
  it('a front lip, end walls and dividers make a ledge a tray, every one printable upright', () => {
    const o = opts({ lip: 15, ends: 'walls', dividers: 2 });
    const add = customAddOns(o, 60);
    expect(add.lip).not.toBeNull();
    expect(add.lipTop).toBe(20);
    expect(add.rim).toBe(20);
    const { layout } = buildChecked(o, 'ledge, lip, walls, dividers');
    expect(layout.pose).toBe('upright');
    const { m } = body(o);
    // The lip at the front, a divider a third of the way across (up to the lip's top), the end walls.
    expect(solidAt(m, [40, 15, 59])).toBe(true);
    expect(solidAt(m, [80 / 3, 15, 30])).toBe(true);
    expect(solidAt(m, [80 / 3, 21, 30])).toBe(false);
    expect(solidAt(m, [1, 15, 30])).toBe(true);
    expect(solidAt(m, [40, 15, 30])).toBe(false);
  });

  it('gussets go on top of a ledge at the foot, under one higher up, 45° either way', () => {
    const top = customAddOns(opts(), 60);
    expect(top.below).toBe(false);
    expect(top.gusset).not.toBeNull();
    const lifted: Vec2[] = [
      [0, 30],
      [4, 30],
      [50, 30],
      [50, 35],
      [0, 35],
    ];
    const o = opts({ profile: lifted, pose: 'side' });
    const under = customAddOns(o, 60);
    expect(under.below).toBe(true);
    // Under it, its slope is 45°: it rises as far as it reaches.
    const g = under.gusset!;
    const low = g.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(Math.min(...g.map((q) => q[1]))).toBeGreaterThan(0);
    expect(low[0]).toBeLessThan(CUSTOM.plate + 0.01);
    buildChecked(o, 'lifted ledge with gussets under');
  });

  it('a label goes on the front-most face looking out', () => {
    const d = def();
    const tray = cleanCustom(presetOptions('tray'));
    const f = d.labelFace!(tray, customLayout(tray, CTX))!;
    expect(f.normal).toBe('front');
    expect(f.z).toBe(70);
    expect(f.h).toBeCloseTo(22 - 1.2, 5);
    // Raised on it, it builds.
    const job = planPrint(
      [fitted(boardWith([{ id: 'c', type: 'custom', x: 100, y: 200, opts: { ...tray }, label: 'Bits', labelStyle: 'raised' }]))],
      DEFAULT_SETUP,
      { baseplate: true, bins: true },
    );
    expect(job.warnings).toEqual([]);
    expect(job.drawers[0].enclosure!.wall!.placed[0].extras?.label?.text).toBe('Bits');
  });
});

describe('load', () => {
  it('what its upward faces carry, as a shelf does: the ledge about half a kilo, 32 mm out', () => {
    const o = opts();
    const l = def().load!(o, customLayout(o, CTX));
    // 80 wide, 56 mm of it facing up (the top and the fillet), at 1 kg a square decimetre.
    expect(l.kg).toBeCloseTo((80 * 56) / 1e4, 3);
    expect(l.at).toBeGreaterThan(25);
    expect(l.at).toBeLessThan(40);
    // A hook carries less than the shelf, further out for its length; neither is over in PLA.
    const hook = cleanCustom(presetOptions('jhook'));
    expect(def().load!(hook, customLayout(hook, CTX)).kg).toBeLessThan(l.kg);
    for (const k of PRESET_KEYS) expect(loadCheck({}, def(), cleanCustom(presetOptions(k)), CTX).over, k).toBe(false);
    // A long shelf on a short back: too much, and it says what helps.
    const long = opts({
      width: 300,
      height: 20,
      profile: [
        [0, 0],
        [200, 0],
        [200, 5],
        [0, 5],
      ],
    });
    const c = loadCheck({}, def(), long, CTX);
    expect(c.over).toBe(true);
    expect(c.fixes.length).toBeGreaterThan(0);
  });
});

describe('editing', () => {
  const p = presetOptions('ledge').profile;

  it('snaps to the grid, and edges to 15° steps near them', () => {
    // Point 2 (the ledge's front top) dragged up and back, its edges far from any 15° step: onto the grid.
    expect(snapPoint(p, 2, [53.91, 7.93])).toEqual([54, 8]);
    // Near 45° from its neighbour (60, 0): onto the 45° line.
    const q = snapPoint(p, 2, [69.5, 10.4]);
    expect(Math.abs(Math.atan2(q[1] - 0, q[0] - 60) - Math.PI / 4)).toBeLessThan(0.02);
    // Never behind the board, under the bed or over the top.
    expect(snapPoint(p, 2, [-9, -9])).toEqual([0, 0]);
    expect(snapPoint(p, 2, [30, 300], 60)[1]).toBe(60);
  });

  it('won’t move a point where edges would cross or the profile would come off the plate', () => {
    expect(movePoint(p, 1, [70, 0])).not.toBeNull();
    // The front-bottom corner pulled up through the top.
    expect(movePoint(p, 1, [30, 20])).toBeNull();
    // The whole root pulled off the plate.
    const block: Vec2[] = [
      [0, 0],
      [50, 0],
      [50, 5],
      [0, 5],
    ];
    const in2 = movePoint(block, 0, [2, 0])!;
    expect(in2).not.toBeNull();
    expect(movePoint(in2, 3, [10, 5])).toBeNull();
  });

  it('adding and removing points keeps features on their faces', () => {
    const f: Feature = { f: 2, k: 'round', a: 6, b: 6, d: 0, u: 0, v: 8, n: 1, m: 1, su: 10, sv: 10 };
    const g: Feature = { ...f, f: 4, v: 0 };
    const a = addPoint(p, [f, g], 2)!;
    expect(a.profile).toHaveLength(p.length + 1);
    expect(a.profile[3]).toEqual([34.5, 5]);
    // f was on the back half of the old top (v > 0: toward its end): now edge 3; g's edge moved along.
    expect(a.features[0].f).toBe(3);
    expect(a.features[1].f).toBe(5);
    const r = removePoint(a.profile, a.features, 3)!;
    expect(r.profile).toEqual(p);
    expect(r.features.map((q) => q.f)).toEqual([2, 4]);
    // Three points stay.
    expect(removePoint(p.slice(0, 3), [], 0)).toBeNull();
  });
});

describe('on the board', () => {
  it('resizes by its edges in whole lattice steps', () => {
    const d = def();
    const o = d.sanitize({});
    const ax = resizeAxes(d, attachmentUi('custom'), o, CTX);
    expect(ax.w?.key).toBe('width');
    expect(ax.h?.key).toBe('height');
    expect(ax.w!.per).toBeCloseTo(1, 5);
    const bigger = { ...o, ...resized(d, o, ax, 37, 45) };
    const l = d.layout(d.sanitize(bigger), CTX);
    expect(l.w).toBe(120);
    expect(l.h).toBe(100);
    for (const v of [l.w, l.h]) expect(v % CTX.pitch).toBe(0);
  });

  it('places on a board via planPrint without warnings, its mounts in slots, and prints', () => {
    const list: PlacedAttachment[] = PRESET_KEYS.map((k, i) => ({
      id: k,
      type: 'custom',
      x: 40 + (i % 4) * 120,
      y: 520 - Math.floor(i / 4) * 140,
      opts: { ...presetOptions(k) },
    }));
    list.push({
      id: 'holes',
      type: 'custom',
      x: 60,
      y: 200,
      opts: { ...presetOptions('ledge'), features: [{ f: 2, k: 'round', a: 6, b: 6, d: 0, u: 0, v: 0, n: 3, m: 1, su: 15, sv: 15 }] },
    });
    const job = planPrint([fitted(boardWith(list, 560))], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    const wall = job.drawers[0].enclosure!.wall!;
    expect(wall.placed.every((p) => p.ok)).toBe(true);
    const parts = Object.values(job.parts).filter((p) => p.kind === 'attachment');
    // One each, and a lock key over each hook (the bracket prints on its side: it hangs by one).
    const keys = wall.placed.reduce((n, p) => n + (p.lock ? p.layout.mounts.filter((m) => m.kind === 'hook').length : 0), 0);
    expect(keys).toBe(1);
    expect(parts).toHaveLength(list.length + keys);
    const onPlates = new Set(job.plates.flatMap((p) => p.placements.map((q) => q.key)));
    for (const p of parts) expect(onPlates.has(p.key), p.key).toBe(true);
  });
});

describe('My attachments', () => {
  it('a custom part saves, goes through a share link and comes back the same, placing without warnings', () => {
    const o = cleanCustom({
      ...presetOptions('tray'),
      width: 120,
      lip: 4,
      dividers: 2,
      features: [{ f: 1, k: 'notch', a: 20, b: 20, d: 0, u: 0, v: 3, n: 1, m: 1, su: 10, sv: 10 }],
    });
    const part: PlacedAttachment = { id: 'a', type: 'custom', x: 100, y: 200, opts: { ...o }, name: 'Bit tray', label: 'Bits', material: 'petg' };
    const entry = entryFromAttachments([part], { pitch: 20, contents: false })!;
    expect(entry.items[0].opts).toEqual(o);
    const link = attachmentsShareUrl([entry], 'https://example.com/');
    if ('error' in link) throw new Error(link.error);
    expect(link.url.length).toBeLessThan(1000);
    const back = attachmentsFromHash(new URL(link.url).hash);
    if (!back || 'error' in back) throw new Error('no entries');
    const item = back.entries[0].items[0];
    expect(item.opts).toEqual(o);
    expect([item.name, item.label, item.material]).toEqual(['Bit tray', 'Bits', 'petg']);
    const job = planPrint([fitted(boardWith([placedOf(item, 'b', 100, 200)]))], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(job.warnings).toEqual([]);
    expect(job.drawers[0].enclosure!.wall!.placed[0].opts).toEqual(o);
  });
});

function boardWith(attachments: PlacedAttachment[], size = 400): NamedDrawer {
  return {
    id: 'b',
    name: 'Board',
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: size, height: size }, attachments },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  };
}
