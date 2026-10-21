import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import {
  DEFAULT_BIN,
  binFrontLabel,
  binKey,
  binLabelPlatePlaces,
  binLabelPlates,
  binLabelTabs,
  binLabelTexts,
  binSize,
  binUsesInlay,
  buildBin,
  sanitizeBin,
  type BinOptions,
} from '../src/lib/geometry/bin';
import { binBodyHeight } from '../src/lib/geometry/variants';
import {
  CULLENECT,
  LABEL_MAX_CHARS,
  LABEL_MAX_RAW,
  PRED,
  buildLabelPlate,
  fitText,
  labelPlateKey,
  planTabLabels,
  predOutline,
  sanitizeLabelText,
} from '../src/lib/geometry/labels';
import {
  ICONS,
  ICON_GAP,
  hasFragments,
  iconDef,
  iconShape,
  labelPlainText,
  labelTokens,
  parseFragment,
  signedArea,
  truncateLabel,
} from '../src/lib/geometry/labelIcons';
import { FRONT_LABEL, frontLabelClashes, planFrontLabel } from '../src/lib/geometry/frontLabel';
import { contentsFragment, fillContents, hasContentsFragment, resolveContentLabels } from '../src/lib/geometry/labelContents';
import { registerFont, textOutline, textSolid, type TextOutline } from '../src/lib/geometry/text';
import type { Contour, Font } from '../src/lib/geometry/font';
import { parseFont } from '../src/lib/geometry/font';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, LIP_DEPTH, WALL } from '../src/lib/geometry/spec';
import { meshVolume } from '../src/lib/geometry/volume';
import { setCompartmentOptions, setWallProps, uniformLayout } from '../src/lib/dividers';
import { DEFAULT_PROJECT, binSpec, buildMesh, planJob, usesSecondFilament, type PlacedBin } from '../src/lib/project';
import { DEFAULT_DRAWER, computeLayout } from '../src/lib/layout/drawer';
import { buildSlideLid } from '../src/lib/geometry/slidingLid';
import { accessoryParts } from '../src/lib/geometry/accessories';

let w: Wasm;
let font: Font;

beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  registerFont(bytes);
  font = parseFont(bytes);
});

const solid = (mesh: { positions: Float32Array; indices: Uint32Array }) =>
  w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = solid(mesh);
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const bin = (o: Partial<BinOptions> = {}): BinOptions => ({ ...DEFAULT_BIN, unitsX: 2, label: 'full', ...o });

/** Area of contours under the nonzero rule. */
function fillArea(cs: Contour[]): number {
  const x = new w.CrossSection(cs, 'NonZero');
  const a = x.area();
  x.delete();
  return a;
}

/** The text layout as it was before icons (reference for "plain text is unchanged"). */
function legacyOutline(text: string, o: { size: number; maxWidth?: number; maxHeight?: number; align?: 'left' | 'center' | 'right'; letterSpacing?: number }) {
  const f = font;
  const lines = text.replace(/\r/g, '').split('\n');
  const lineHeight = 1.45;
  const spacingUnits = ((o.letterSpacing ?? 0) / Math.max(o.size, 1e-6)) * f.capHeight;
  const widths = lines.map((line) => {
    let x = 0;
    for (const ch of line) x += f.glyph(ch.codePointAt(0)!).advance + spacingUnits;
    return Math.max(0, x - spacingUnits);
  });
  const rawW = Math.max(0, ...widths);
  const rawH = f.capHeight * (1 + lineHeight * (lines.length - 1));
  let size = o.size;
  if (o.maxWidth && rawW > 0) size = Math.min(size, (o.maxWidth / rawW) * f.capHeight);
  if (o.maxHeight && rawH > 0) size = Math.min(size, (o.maxHeight / rawH) * f.capHeight);
  const k = size / f.capHeight;
  const contours: Contour[] = [];
  const totalH = rawH * k;
  lines.forEach((line, li) => {
    const lw = widths[li] * k;
    let x = o.align === 'left' ? 0 : o.align === 'right' ? -lw : -lw / 2;
    const baseline = totalH / 2 - size - li * lineHeight * size;
    for (const ch of line) {
      const g = f.glyph(ch.codePointAt(0)!);
      for (const c of g.contours) contours.push(c.map(([gx, gy]) => [x + gx * k, baseline + gy * k] as [number, number]));
      x += g.advance * k + spacingUnits * k;
    }
  });
  return { contours, width: rawW * k, height: totalH, size };
}

function inkX(t: TextOutline) {
  const xs = t.contours.flat().map((p) => p[0]);
  return { x0: Math.min(...xs), x1: Math.max(...xs) };
}

describe('icons', () => {
  it('every icon is clean closed outlines, filled under nonzero, one cap height tall', () => {
    const variants = ICONS.flatMap((d) => [iconShape(d, []), ...(d.name === 'bolt' || d.name === 'screw' ? ['5', '50', 'socket', 'flat', 'wood', 'button', 'hex'].map((a) => iconShape(d, [a])) : [])]);
    expect(ICONS.length).toBeGreaterThanOrEqual(21);
    for (const s of variants) {
      expect(s.width).toBeGreaterThan(0);
      let positive = 0;
      for (const c of s.contours) {
        expect(c.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of c) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(-1e-9);
          expect(x).toBeLessThanOrEqual(s.width + 1e-9);
          expect(y).toBeGreaterThanOrEqual(-0.15);
          expect(y).toBeLessThanOrEqual(1.15);
        }
        const a = signedArea(c);
        expect(Math.abs(a)).toBeGreaterThan(1e-4);
        if (a > 0) positive += a;
      }
      const filled = fillArea(s.contours);
      expect(filled).toBeGreaterThan(0.05);
      // Holes take away, overlapping strokes don't add twice.
      expect(filled).toBeLessThanOrEqual(positive + 1e-6);
    }
  });

  it('icons with holes keep them (washer, nut, bearing) and extrude to valid solids', () => {
    const washer = iconShape(iconDef('washer')!, []);
    expect(fillArea(washer.contours)).toBeCloseTo(Math.PI * (0.25 - 0.22 ** 2), 1);
    for (const d of ICONS) {
      const t: TextOutline = { contours: iconShape(d, []).contours.map((c) => c.map(([x, y]) => [x * 6, y * 6] as [number, number])), width: 6, height: 6, size: 6 };
      const m = textSolid(w, t, 0, 0, 0, 0.6)!;
      expect(m.status()).toBe('NoError');
      expect(m.volume()).toBeGreaterThan(0.05 * 36 * 0.6);
      m.delete();
    }
  });

  it('fragments parse; aliases and gflabel spellings work; unknown ones stay text', () => {
    expect(labelTokens('M3 {bolt:12} x').map((t) => t.kind)).toEqual(['text', 'icon', 'text']);
    const [, b] = labelTokens('M3 {bolt:12}');
    expect(b).toMatchObject({ kind: 'icon', name: 'bolt' });
    expect(parseFragment('bolt(12)')).toMatchObject({ kind: 'icon', name: 'bolt' });
    expect(parseFragment('hexnut')).toMatchObject({ name: 'nut' });
    expect(parseFragment('lockwasher')).toMatchObject({ name: 'spring_washer' });
    expect(parseFragment('threaded_insert')).toMatchObject({ name: 'insert' });
    expect(parseFragment('ZIP')).toMatchObject({ name: 'zip' });
    expect(parseFragment('|')).toMatchObject({ kind: 'icon', divider: true });
    expect(parseFragment('<')).toEqual({ kind: 'align', align: 'left' });
    expect(parseFragment('>')).toEqual({ kind: 'align', align: 'right' });
    expect(parseFragment('...')).toEqual({ kind: 'spring' });
    expect(parseFragment('contents')).toEqual({ kind: 'blank' });
    expect(parseFragment('contents:2')).toEqual({ kind: 'blank' });
    expect(parseFragment('contents:9')).toBeNull();
    expect(parseFragment('bogus')).toBeNull();
    expect(parseFragment('M3 x 8')).toBeNull();
    expect(labelTokens('{bogus} {nut')).toEqual([{ kind: 'text', text: '{bogus} {nut' }]);
    expect(labelTokens('a{}b')).toEqual([{ kind: 'text', text: 'a{}b' }]);
    // Screw heads and lengths change the drawing.
    const len = (a: string[]) => iconShape(iconDef('screw')!, a).width;
    expect(len(['50'])).toBeGreaterThan(len(['8']));
    expect(iconShape(iconDef('screw')!, ['socket']).contours[0]).not.toEqual(iconShape(iconDef('screw')!, ['pan']).contours[0]);
    expect(hasFragments('M3 screws')).toBe(false);
    expect(hasFragments('M3 {nut}')).toBe(true);
    expect(hasFragments('{x}')).toBe(false);
    expect(labelPlainText('M3 {bolt:12}\n{nut} {|} {washer}')).toBe('M3 bolt\nnut | washer');
  });

  it('the length limit counts a fragment as one character, and never splits one', () => {
    expect([...sanitizeLabelText('x'.repeat(500))]).toHaveLength(LABEL_MAX_CHARS);
    const many = sanitizeLabelText('{nut}'.repeat(80));
    expect(many.length).toBeLessThanOrEqual(LABEL_MAX_RAW);
    expect(many).toMatch(/^(\{nut\})+$/);
    const mixed = sanitizeLabelText('{bolt:12}' + 'a'.repeat(70));
    expect(mixed.startsWith('{bolt:12}')).toBe(true);
    expect(mixed.length).toBe(9 + LABEL_MAX_CHARS - 1);
    expect(truncateLabel('ab{nut}cd', 3, 100)).toBe('ab{nut}');
  });
});

describe('text with icons', () => {
  it('plain text lays out exactly as before', () => {
    for (const [t, o] of [
      ['M3 SCREWS', { size: 5 }],
      ['Hex bits\n¼" & M4', { size: 7, maxWidth: 30, maxHeight: 9 }],
      ['L', { size: 10, align: 'left' as const }],
      ['{bogus} braces', { size: 4, letterSpacing: 0.3 }],
      ['Right', { size: 6, align: 'right' as const }],
    ] as const) {
      const a = textOutline(t, o);
      const b = legacyOutline(t, o);
      expect(a.contours).toEqual(b.contours);
      expect(a.width).toBe(b.width);
      expect(a.size).toBe(b.size);
      expect(a.spread).toBeUndefined();
    }
  });

  it('icons sit inline, one cap height tall, with a gap next to letters but not next to spaces', () => {
    const size = 5;
    const nut = iconShape(iconDef('nut')!, []);
    const text = textOutline('M3', { size });
    const spaced = textOutline('M3 {nut}', { size });
    const tight = textOutline('M3{nut}', { size });
    const space = textOutline('M3 ', { size }).width;
    expect(spaced.width).toBeCloseTo(space + nut.width * size, 6);
    expect(tight.width).toBeCloseTo(text.width + (ICON_GAP + nut.width) * size, 6);
    // The icon's ink spans the cap height: from the baseline to the top of the capitals.
    const iconPts = tight.contours.slice(-2).flat();
    const ys = iconPts.map((p) => p[1]);
    const caps = text.contours.flat().map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...caps.filter((y) => y > -0.5 * size)) , 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(size, 6);
    // Icons count toward fitting: the same width limit makes text with an icon smaller.
    expect(textOutline('M3 {bolt:40}', { size: 8, maxWidth: 20 }).size).toBeLessThan(textOutline('M3', { size: 8, maxWidth: 20 }).size);
    // A blank {contents} adds nothing.
    expect(textOutline('M3{contents}', { size }).width).toBeCloseTo(text.width, 9);
  });

  it('{<}, {>} and {...} put lines at the edges of the label', () => {
    const t = textOutline('{<}LEFT\n{>}RIGHT', { size: 5, maxWidth: 60 });
    expect(t.spread).toBe(true);
    expect(t.width).toBeCloseTo(60, 6);
    const fit = fitText('{<}LEFT\n{>}RIGHT', { x0: 0, y0: 0, x1: 60, y1: 16 }, 5)!;
    const pts = fit.outline.contours.map((c) => c.map(([x, y]) => [x + fit.cx, y + fit.cy]));
    const top = pts.filter((c) => c.some(([, y]) => y > 8)).flat();
    const bottom = pts.filter((c) => c.every(([, y]) => y < 8)).flat();
    expect(Math.min(...top.map((p) => p[0]))).toBeLessThan(1.5);
    expect(Math.max(...bottom.map((p) => p[0]))).toBeGreaterThan(58.5);
    for (const [x] of pts.flat()) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(60 + 1e-6);
    }
    // {...}: text left, icon right.
    const sp = fitText('M3{...}{bolt:20}', { x0: 0, y0: 0, x1: 50, y1: 10 }, 6)!;
    const ink = inkX({ ...sp.outline, contours: sp.outline.contours.map((c) => c.map(([x, y]) => [x + sp.cx, y] as [number, number])) });
    expect(ink.x0).toBeLessThan(1);
    expect(ink.x1).toBeGreaterThan(49);
  });
});

describe('labels with icons build valid meshes', () => {
  it('on tabs: raised, engraved and inlaid', () => {
    const plain = meshVolume(buildBin(w, bin()));
    for (const labelStyle of ['raised', 'engraved', 'inlaid'] as const) {
      const mesh = buildBin(w, bin({ labelText: 'M3 {bolt:12}\n{nut} {|} {washer}', labelStyle }));
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      if (labelStyle === 'raised') expect(meshVolume(mesh)).toBeGreaterThan(plain + 5);
      if (labelStyle === 'engraved') expect(meshVolume(mesh)).toBeLessThan(plain - 5);
      if (labelStyle === 'inlaid') {
        expect(mesh.overlays).toHaveLength(1);
        expect(check(mesh.overlays![0]).status).toBe('NoError');
        // The fill touches the body but doesn't overlap it.
        const body = solid(mesh);
        const fill = solid(mesh.overlays![0]);
        expect(w.Manifold.intersection(body, fill).volume()).toBeLessThan(1e-3);
        body.delete();
        fill.delete();
      }
    }
  });

  it('on compartments, plates and sliding lids', () => {
    let layout = uniformLayout(2, 1);
    const keys = binLabelTabs(sanitizeBin(bin({ layout }))).map((t) => t.key);
    layout = setCompartmentOptions(layout, keys[0], { labelText: '{screw:socket:12} M3' });
    const o = bin({ layout, labelText: '{magnet}', labelStyle: 'inlaid' });
    expect(binLabelTexts(o)).toEqual(['{screw:socket:12} M3', '{magnet}']);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    expect(mesh.overlays).toHaveLength(1);

    const plates = binLabelPlates(bin({ labelText: '{battery} AA', labelPlates: true, labelStyle: 'inlaid' }));
    const pm = buildLabelPlate(w, plates[0]);
    expect(check(pm)).toMatchObject({ status: 'NoError', components: 1 });
    expect(check(pm.overlays![0]).status).toBe('NoError');

    const lidBin = sanitizeBin({ ...DEFAULT_BIN, unitsX: 2, heightUnits: 4, lip: false, slideLid: true, slideLidText: '{resistor} 10k' });
    const { w: W, d: D } = binSize(lidBin);
    const lid = accessoryParts(lidBin, W, D).find((p) => p.part.type === 'slideLid')!;
    const lm = buildSlideLid(w, lid.part as never);
    expect(check(lm)).toMatchObject({ status: 'NoError', components: 1 });
  });
});

describe('front labels', () => {
  const front = (o: Partial<BinOptions> = {}) => bin({ label: 'none', labelText: 'M3 {bolt:12}', frontLabel: 'raised', heightUnits: 3, ...o });

  it('are off by default and keep old keys', () => {
    expect(binKey(bin({ labelText: 'A' }))).toBe(binKey(bin({ labelText: 'A', frontLabel: 'none' })));
    expect(binKey(bin())).toBe(binKey(bin({ frontLabel: 'raised' })));
    expect(binKey(front())).not.toBe(binKey(front({ frontLabel: 'none' })));
    expect(binKey(front())).not.toBe(binKey(front({ frontLabelSize: 5 })));
    expect(sanitizeBin({ ...DEFAULT_BIN, frontLabel: 'bogus' as never, frontLabelSize: -4 })).toMatchObject({ frontLabel: 'none', frontLabelSize: 0 });
    expect(sanitizeBin({ ...DEFAULT_BIN, frontLabelSize: 400 }).frontLabelSize).toBe(20);
  });

  it('raised: on the front face, clear of the feet, the lip and the rounded corners', () => {
    const o = front();
    const so = sanitizeBin(o);
    const { w: W, d: D } = binSize(so);
    const H = binBodyHeight(so);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    expect(meshVolume(mesh)).toBeGreaterThan(meshVolume(buildBin(w, front({ frontLabel: 'none' }))) + 5);
    const b = meshBounds(mesh);
    expect(b.min[1]).toBeCloseTo(-D / 2 - FRONT_LABEL.raise, 3);
    // Everything in front of the face is text, inside the face's flat part and band.
    const p = mesh.positions;
    let n = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < -D / 2 - 0.01) {
        n++;
        expect(Math.abs(p[i])).toBeLessThanOrEqual(W / 2 - BASE_TOP_RADIUS);
        expect(p[i + 2]).toBeGreaterThan(BASE_PROFILE_HEIGHT);
        expect(p[i + 2]).toBeLessThan(H);
      }
    }
    expect(n).toBeGreaterThan(50);
    const plan = binFrontLabel(o)!;
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].box.y1).toBeCloseTo(H - FRONT_LABEL.margin, 6);
  });

  it('two-tone and inlaid go on filament 2: touching the wall, never overlapping it', () => {
    for (const frontLabel of ['two-tone', 'inlaid'] as const) {
      const o = front({ frontLabel });
      const { d: D } = binSize(sanitizeBin(o));
      const mesh = buildBin(w, o);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      expect(mesh.overlays).toHaveLength(1);
      const ov = mesh.overlays![0];
      expect(check(ov).status).toBe('NoError');
      const ob = meshBounds(ov);
      if (frontLabel === 'two-tone') {
        expect(ob.min[1]).toBeCloseTo(-D / 2 - FRONT_LABEL.raise, 3);
        expect(ob.max[1]).toBeCloseTo(-D / 2, 3);
      } else {
        expect(ob.min[1]).toBeCloseTo(-D / 2, 3);
        expect(ob.max[1]).toBeCloseTo(-D / 2 + FRONT_LABEL.depth, 3);
        // Flush: the body's front is still the face.
        expect(meshBounds(mesh).min[1]).toBeCloseTo(-D / 2, 3);
      }
      const body = solid(mesh);
      const fill = solid(ov);
      expect(w.Manifold.intersection(body, fill).volume()).toBeLessThan(1e-3);
      // Pushed 0.01 mm into the wall it overlaps: no gap between them.
      expect(w.Manifold.intersection(body, fill.translate([0, 0.01, 0])).volume()).toBeGreaterThan(0);
      body.delete();
      fill.delete();
      expect(binUsesInlay(o)).toBe(true);
    }
    expect(binUsesInlay(front())).toBe(false);
  });

  it('engraved and inlaid text gets a thicker wall behind it, clear of removable dividers', () => {
    const o = front({ frontLabel: 'engraved' });
    const so = sanitizeBin(o);
    const { d: D } = binSize(so);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    // Material behind the engraving: a probe just inside the wall finds plastic.
    const body = solid(mesh);
    const seg = binFrontLabel(o)!.segments[0].box;
    const probe = w.Manifold.cube([4, 0.6, 2], true).translate([(seg.x0 + seg.x1) / 2, -D / 2 + WALL + 0.4, (seg.y0 + seg.y1) / 2]);
    expect(w.Manifold.intersection(body, probe).volume()).toBeCloseTo(4 * 0.6 * 2, 1);
    const plainBody = solid(buildBin(w, front({ frontLabel: 'none' })));
    expect(w.Manifold.intersection(plainBody, probe).volume()).toBeLessThan(0.01);
    [body, probe, plainBody].forEach((m) => m.delete());
    // A removable divider meeting the front wall keeps its slot.
    const layout = setWallProps(uniformLayout(2, 1), 'x1', { removable: true });
    const withSlot = buildBin(w, front({ frontLabel: 'inlaid', layout, unitsX: 2 }));
    expect(check(withSlot)).toMatchObject({ status: 'NoError', components: 1 });
    const sb = solid(withSlot);
    const slot = w.Manifold.cube([0.8, 0.6, 2], true).translate([0, -D / 2 + WALL + 0.4, (seg.y0 + seg.y1) / 2]);
    expect(w.Manifold.intersection(sb, slot).volume()).toBeLessThan(0.01);
    [sb, slot].forEach((m) => m.delete());
  });

  it('compartments along the front get their own text under them', () => {
    let layout = uniformLayout(3, 1);
    const keys = binLabelTabs(sanitizeBin(bin({ unitsX: 3, layout }))).map((t) => t.key);
    layout = setCompartmentOptions(layout, keys[0], { labelText: 'M3' });
    layout = setCompartmentOptions(layout, keys[2], { labelText: 'M5' });
    const o = front({ unitsX: 3, layout, labelText: 'M4' });
    const plan = binFrontLabel(o)!;
    expect(plan.segments.map((s) => s.text)).toEqual(['M3', 'M4', 'M5']);
    for (let i = 1; i < 3; i++) expect(plan.segments[i].box.x0).toBeGreaterThan(plan.segments[i - 1].box.x1);
    // Same text side by side: one label.
    expect(binFrontLabel(front({ unitsX: 3, divX: 3, labelText: 'ALL' }))!.segments).toHaveLength(1);
    expect(check(buildBin(w, o))).toMatchObject({ status: 'NoError', components: 1 });
    // Without tabs, with other interiors, on short bins.
    expect(binFrontLabel(front({ interior: 'pockets' }))!.segments).toHaveLength(1);
    expect(check(buildBin(w, front({ interior: 'pockets', frontLabel: 'inlaid' })))).toMatchObject({ status: 'NoError', components: 1 });
    expect(binFrontLabel(front({ heightUnits: 2 }))).not.toBeNull();
    expect(binFrontLabel(front({ labelText: '' }))).toBeNull();
  });

  it('respect wall cutouts, hex patterns and sliding lids', () => {
    // A deep front cutout on a short bin: the text goes beside it.
    const cut = front({ unitsX: 3, cutoutWalls: 'f', cutoutWidth: 0.4, cutoutDepth: 30 });
    const so = sanitizeBin(cut);
    const plan = binFrontLabel(cut)!;
    const { w: W } = binSize(so);
    const notch = (0.4 * (W - 2 * WALL)) / 2;
    for (const s of plan.segments) expect(s.box.x1 <= -notch || s.box.x0 >= notch).toBe(true);
    expect(check(buildBin(w, cut))).toMatchObject({ status: 'NoError', components: 1 });
    // A shallow cutout on a tall bin: the text goes below it.
    const below = front({ heightUnits: 6, cutoutWalls: 'f', cutoutDepth: 10 });
    const H6 = binBodyHeight(sanitizeBin(below));
    expect(binFrontLabel(below)!.segments[0].box.y1).toBeLessThan(H6 + 4.4 - 10);
    // A hex pattern leaves the label's area solid.
    const hex = front({ frontLabel: 'inlaid', patternWalls: 'f', heightUnits: 6 });
    const hm = buildBin(w, hex);
    expect(check(hm)).toMatchObject({ status: 'NoError', components: 1 });
    expect(meshVolume(hm)).toBeGreaterThan(meshVolume(buildBin(w, { ...hex, frontLabel: 'none' })));
    // Sliding lid: below its front opening.
    const lidBin = sanitizeBin(front({ lip: false, slideLid: true, heightUnits: 5 }));
    const { w: LW, d: LD } = binSize(lidBin);
    const lp = planFrontLabel(lidBin, LW, LD, BASE_PROFILE_HEIGHT)!;
    expect(lp.segments[0].box.y1).toBeLessThan(binBodyHeight(lidBin) - 2);
    expect(check(buildBin(w, lidBin))).toMatchObject({ status: 'NoError', components: 1 });
  });

  it('planning warns when a raised front label would touch the bin in front', () => {
    const a: PlacedBin = { id: 'a', x: 0, y: 1, opts: front() };
    const b: PlacedBin = { id: 'b', x: 0, y: 0, opts: bin() };
    expect(frontLabelClashes([a, b], () => true).map((x) => x.id)).toEqual(['a']);
    expect(frontLabelClashes([a, { ...b, x: 2 }], () => true)).toEqual([]);
    expect(frontLabelClashes([{ ...a, opts: front({ frontLabel: 'inlaid' }) }, b], () => true)).toEqual([]);
    const project = { ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid' as const, gridX: 4, gridY: 3 }, bins: [a, b] };
    expect(planJob(project).warnings.some((m) => m.includes('front label'))).toBe(true);
    expect(planJob({ ...project, bins: [a] }).warnings.some((m) => m.includes('front label'))).toBe(false);
    // Part names say what's on the front.
    expect(planJob({ ...project, bins: [a] }).parts['bin:a'].name).toContain('“M3 bolt”');
    expect(usesSecondFilament(planJob({ ...project, bins: [{ ...a, opts: front({ frontLabel: 'two-tone' }) }] }))).toBe(true);
  });
});

describe('labels from "What\'s in it"', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 });
  const placed = (o: Partial<BinOptions>, contents?: string, compContents?: Record<string, string>): PlacedBin => ({
    id: 'p',
    x: 0,
    y: 0,
    opts: bin(o),
    ...(contents ? { contents } : {}),
    ...(compContents ? { compContents } : {}),
  });

  it('fill in the first line(s), and change the key only while a label asks for them', () => {
    expect(fillContents('{contents}', '- M3 × 8 screws\nM3 nuts')).toBe('M3 × 8 screws');
    expect(fillContents('{contents:2}', 'A\n\nB\nC')).toBe('A\nB');
    expect(fillContents('{nut} {contents}', 'M3 nuts')).toBe('{nut} M3 nuts');
    expect(fillContents('{contents}', undefined)).toBe('');
    expect(contentsFragment(1)).toBe('{contents}');
    expect(contentsFragment(2)).toBe('{contents:2}');
    expect(hasContentsFragment('x {Contents}')).toBe(true);
    expect(hasContentsFragment('contents')).toBe(false);

    const off = placed({ labelText: 'SCREWS' }, 'M3 × 8 screws');
    const offKey = binSpec(layout, off).key;
    expect(binSpec(layout, { ...off, contents: 'something else' }).key).toBe(offKey);
    expect(binSpec(layout, off).opts).toBe(off.opts);

    const on = placed({ labelText: '{contents}' }, 'M3 × 8 screws\nM3 nuts');
    const spec = binSpec(layout, on);
    expect(spec.opts.labelText).toBe('M3 × 8 screws');
    expect(spec.key).toBe(binSpec(layout, placed({ labelText: 'M3 × 8 screws' })).key);
    expect(binSpec(layout, { ...on, contents: 'M4 washers' }).key).not.toBe(spec.key);
    // The planned bin is named after what's printed.
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 }, bins: [on] });
    expect(job.parts['bin:p'].name).toContain('“M3 × 8 screws”');
  });

  it('each compartment uses its own contents, falling back to the bin’s', () => {
    // Uniform grid (no layout): tab keys g<i>,<j>.
    const r = resolveContentLabels(bin({ divX: 2, labelText: '{contents}' }), { contents: 'MISC', compContents: {} });
    expect(binLabelTexts(r)).toEqual(['MISC', 'MISC']);
    const lay = uniformLayout(2, 1);
    const base = bin({ layout: lay, labelText: '{contents}' });
    const keys = binLabelTabs(sanitizeBin(base)).map((t) => t.key);
    const res = resolveContentLabels(base, { contents: 'MISC', compContents: { [keys[1]]: 'M5 nuts' } });
    expect(binLabelTexts(res)).toEqual(['MISC', 'M5 nuts']);
    expect(binKey(res)).not.toBe(binKey(resolveContentLabels(base, { contents: 'MISC' })));
    // A compartment of its own asking, the bin not.
    const one = bin({ layout: setCompartmentOptions(lay, keys[0], { labelText: '{contents}' }), labelText: 'BIN' });
    expect(binLabelTexts(resolveContentLabels(one, { compContents: { [keys[0]]: 'Fuses' } }))).toEqual(['Fuses', 'BIN']);
    // Uniform grid whose compartments have their own lists.
    const grid = bin({ divX: 2, labelText: '{contents}' });
    const gridKeys = Object.keys(resolveContentLabels(grid, { contents: 'X' }).labelTabTexts ?? {});
    expect(gridKeys).toEqual([]);
    const built = buildBin(w, resolveContentLabels(base, { contents: 'MISC', compContents: { [keys[1]]: 'M5 {nut}' } }));
    expect(check(built)).toMatchObject({ status: 'NoError', components: 1 });
    // Unresolved, {contents} prints nothing.
    expect(meshVolume(buildBin(w, bin({ labelText: '{contents}' })))).toBeCloseTo(meshVolume(buildBin(w, bin())), 3);
  });
});

describe('Cullenect and Pred label sockets', () => {
  const sockets = (labelFormat: 'cullenect' | 'pred', o: Partial<BinOptions> = {}) =>
    bin({ unitsX: 1, labelText: 'M3 {bolt:12}', labelPlates: true, labelFormat, labelStyle: 'inlaid', ...o });

  it('standard label sizes per unit; formats in the key only with plates on', () => {
    const c = binLabelPlates(sockets('cullenect'));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ width: 36, depth: CULLENECT.depth, thickness: CULLENECT.thickness, format: 'cullenect' });
    const p = binLabelPlates(sockets('pred'));
    expect(p[0]).toMatchObject({ width: 37.8, depth: PRED.depth, thickness: PRED.thickness, format: 'pred' });
    expect(binLabelPlates(sockets('cullenect', { unitsX: 2 }))[0].width).toBe(78);
    expect(binLabelPlates(sockets('pred', { unitsX: 2 }))[0].width).toBe(79.8);
    expect(labelPlateKey(c[0])).not.toBe(labelPlateKey({ ...c[0], format: undefined }));
    expect(binKey(bin({ labelFormat: 'cullenect' }))).toBe(binKey(bin()));
    expect(binKey(sockets('cullenect'))).not.toBe(binKey(sockets('pred')));
    expect(binKey(sockets('cullenect'))).toBe(binKey(sockets('cullenect', { labelPrint: false })));
    // Without printing: sockets, no parts.
    expect(binLabelPlates(sockets('pred', { labelPrint: false }))).toEqual([]);
    expect(sanitizeBin({ ...DEFAULT_BIN, labelFormat: 'x' as never })).toMatchObject({ labelFormat: 'gridfit', labelPrint: true });
  });

  for (const fmt of ['cullenect', 'pred'] as const) {
    it(`${fmt}: the bin and its label build, and the label fits the socket`, () => {
      const o = sockets(fmt);
      const mesh = buildBin(w, o);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      expect(mesh.overlays).toBeUndefined();
      const [plate] = binLabelPlates(o);
      const pm = buildLabelPlate(w, plate);
      expect(check(pm)).toMatchObject({ status: 'NoError', components: 1 });
      expect(pm.overlays?.[0].filament).toBe(2);
      const pb = meshBounds(pm);
      expect(pb.max[0]).toBeCloseTo(plate.width, 3);
      expect(pb.max[1]).toBeCloseTo(plate.depth, 3);
      expect(pb.max[2]).toBeCloseTo(plate.thickness, 3);
      // Pressed in: no overlap with the bin, top below the tab's top.
      const { w: W, d: D } = binSize(sanitizeBin(o));
      const [at] = binLabelPlatePlaces(o);
      const body = solid(mesh).translate([W / 2, D / 2, 0]);
      const label = solid(pm).translate([at.x, at.y, at.z]);
      expect(body.intersect(label).volume()).toBeLessThan(0.02);
      const so = sanitizeBin(o);
      const [L] = planTabLabels(so, binLabelTabs(so), binBodyHeight(so), W);
      expect(at.z + plate.thickness).toBeLessThan(L.tab.z);
      // It sits on the socket's floor: lowered a hair, it hits the bin.
      expect(body.intersect(label.translate([0, 0, -0.05])).volume()).toBeGreaterThan(0.1);
      if (fmt === 'cullenect') {
        // The ribs reach into the label's groove: widen the label to a plain block and it collides.
        const block = w.Manifold.cube([plate.width, plate.depth, plate.thickness]).translate([at.x, at.y, at.z]);
        expect(body.intersect(block).volume()).toBeGreaterThan(0.05);
        block.delete();
        expect(L.plate!.recess.x1 - L.plate!.recess.x0).toBeCloseTo(36.3, 6);
      } else {
        // The nubs tuck under the lip at the side walls: plastic right above them.
        const lim = W / 2 - LIP_DEPTH;
        expect(L.plate!.slots![0].x0).toBeLessThan(-lim - 0.5);
        const above = w.Manifold.cube([0.6, 3, 0.5]).translate([W / 2 - lim - 0.8, at.y + plate.depth / 2 - 1.5 + D * 0, at.z + plate.thickness + 0.1]);
        expect(body.intersect(above).volume()).toBeGreaterThan(0.3);
        above.delete();
      }
      body.delete();
      label.delete();
    });
  }

  it('Pred labels: nubs, flex holes and a text area clear of them', () => {
    const { outer, holes } = predOutline(37.8);
    const area = fillArea([outer, ...holes]);
    expect(area).toBeLessThan(37.8 * 11.5);
    expect(area).toBeGreaterThan((37.8 - 2) * 11.5 * 0.9);
    expect(signedArea(outer)).toBeGreaterThan(0);
    for (const h of holes) expect(signedArea(h)).toBeLessThan(0);
    const xs = outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBeCloseTo(37.8, 9);
  });

  it('narrow compartments get custom-width labels; too small falls back to text on the tab', () => {
    const o = bin({ unitsX: 2, divX: 2, labelText: 'AB', labelPlates: true, labelFormat: 'cullenect' });
    const plates = binLabelPlates(o);
    expect(plates).toHaveLength(2);
    for (const p of plates) expect(p.width).toBeLessThan(36.4);
    expect(check(buildBin(w, o))).toMatchObject({ status: 'NoError', components: 1 });
    const tiny = bin({ unitsX: 2, divX: 6, labelText: 'AB', labelPlates: true, labelFormat: 'pred', labelStyle: 'inlaid' });
    expect(binLabelPlates(tiny)).toEqual([]);
    expect(buildBin(w, tiny).overlays).toHaveLength(1);
  });

  it('planning names the labels and builds them', () => {
    const job = planJob({
      ...DEFAULT_PROJECT,
      drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 },
      bins: [
        { id: 'c', x: 0, y: 0, opts: sockets('cullenect') },
        { id: 'p', x: 1, y: 0, opts: sockets('pred') },
        { id: 'n', x: 2, y: 0, opts: sockets('pred', { labelPrint: false }) },
      ],
    });
    expect(job.parts['label:c:0'].name).toMatch(/^Cullenect label “M3 bolt”/);
    expect(job.parts['label:p:0'].name).toMatch(/^Pred label “M3 bolt”/);
    expect(job.parts['label:n:0']).toBeUndefined();
    expect(job.parts['label:p:0'].assembled).toBeDefined();
    for (const k of ['label:c:0', 'label:p:0']) {
      const mesh = buildMesh(w, job.meshes[job.parts[k].meshKey]);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    }
    expect(fitText('M3 {bolt:12}', { x0: 0, y0: 0, x1: 30, y1: 10 }, 7)).not.toBeNull();
  });
});

// Keep Manifold's type in use for the helpers above.
export type { Manifold };
