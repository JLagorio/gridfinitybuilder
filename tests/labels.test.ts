import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import {
  DEFAULT_BIN,
  binKey,
  binLabelPlatePlaces,
  binLabelPlates,
  binLabelTabs,
  binSize,
  binLabelTexts,
  binTotalHeight,
  buildBin,
  sanitizeBin,
  type BinOptions,
} from '../src/lib/geometry/bin';
import { binBodyHeight } from '../src/lib/geometry/variants';
import {
  LABEL_PLATE,
  buildLabelPlate,
  fitText,
  labelLines,
  labelPlateKey,
  planTabLabels,
  sanitizeLabelText,
} from '../src/lib/geometry/labels';
import { registerFont, textSolid } from '../src/lib/geometry/text';
import { meshVolume } from '../src/lib/geometry/volume';
import { setCompartmentOptions, setWallProps, uniformLayout, sanitizeLayout, layoutKey } from '../src/lib/dividers';
import { DEFAULT_PROJECT, buildMesh, exportBambuProject, planJob, plateContents, usesSecondFilament, type PlacedBin } from '../src/lib/project';
import { billOfMaterials } from '../src/lib/bom';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';

let w: Wasm;

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

describe('labels without the font', () => {
  beforeAll(async () => {
    w = await Module();
    w.setup();
  });

  it('builds the bin without text instead of failing', () => {
    const plain = buildBin(w, bin());
    const labelled = buildBin(w, bin({ labelText: 'M3 SCREWS', labelStyle: 'inlaid' }));
    expect(check(labelled).status).toBe('NoError');
    expect(labelled.overlays).toBeUndefined();
    expect(meshVolume(labelled)).toBeCloseTo(meshVolume(plain), 3);
    expect(fitText('M3', { x0: 0, y0: 0, x1: 30, y1: 10 }, 7)).toBeNull();
  });
});

describe('label text', () => {
  beforeAll(() => {
    const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
    registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });

  /** Volume of the text as laid out on the bin's first tab, per mm of height. */
  function textArea(o: BinOptions) {
    const so = sanitizeBin(o);
    const [L] = planTabLabels(so, binLabelTabs(so), binBodyHeight(so));
    const fit = fitText(L.text, L.box, Math.min(8, 0.7 * (L.tab.y1 - L.tab.y0)))!;
    const m = textSolid(w, fit.outline, fit.cx, fit.cy, 0, 1)!;
    const a = m.volume();
    m.delete();
    return { area: a, tab: L.tab, box: L.box, fit };
  }

  const plain = () => buildBin(w, bin());

  it('raised text adds its volume on top of the tab, below a stacked bin’s feet', () => {
    const o = bin({ labelText: 'M3 SCREWS', labelStyle: 'raised' });
    const mesh = buildBin(w, o);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(mesh.overlays).toBeUndefined();
    const { area, tab, box } = textArea(o);
    expect(area).toBeGreaterThan(20);
    expect(meshVolume(mesh) - meshVolume(plain())).toBeCloseTo(area * 0.5, 0);
    // Same outside; the text rises 0.5 mm above the tab and stays 0.3 mm under the feet of a bin stacked in the lip.
    const b = meshBounds(mesh);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(o), 3);
    let top = -Infinity;
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      // (Away from the lip's rounded corners, which reach into the tab's back corners.)
      const inBox = p[i] > box.x0 && p[i] < box.x1 && p[i + 1] > box.y0 && p[i + 1] < box.y1 && Math.abs(p[i]) < 83.5 / 2 - 3.75;
      if (inBox && p[i + 2] > tab.z + 0.01) top = Math.max(top, p[i + 2]);
    }
    expect(top).toBeCloseTo(tab.z + 0.5, 4);
    expect(top).toBeLessThanOrEqual(binBodyHeight(o) - 0.35 - 0.3 + 1e-6);
  });

  it('engraved text removes its volume', () => {
    const o = bin({ labelText: 'M3 SCREWS', labelStyle: 'engraved' });
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    expect(mesh.overlays).toBeUndefined();
    expect(meshVolume(plain()) - meshVolume(mesh)).toBeCloseTo(textArea(o).area * 0.6, 0);
  });

  it('inlaid text fills the engraving flush with an overlay on filament 2 that touches but never overlaps the body', () => {
    const o = bin({ labelText: 'Hex bits\n¼" & M4', labelStyle: 'inlaid' });
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    expect(mesh.overlays).toHaveLength(1);
    const ov = mesh.overlays![0];
    expect(ov.filament).toBe(2);
    const { area, tab } = textArea(o);
    const body = solid(mesh);
    const fill = solid(ov);
    expect(fill.status()).toBe('NoError');
    expect(fill.volume()).toBeCloseTo(area * 0.6, 1);
    expect(meshVolume(plain()) - body.volume()).toBeCloseTo(area * 0.6, 1);
    // No overlap: the union is exactly the sum. Touching: no gap between the two.
    const both = w.Manifold.union(body, fill);
    expect(Math.abs(both.volume() - body.volume() - fill.volume())).toBeLessThan(1e-3 * fill.volume());
    expect(w.Manifold.intersection(body, fill).volume()).toBeLessThan(1e-3);
    const grown = fill.translate([0, 0, -0.01]);
    expect(w.Manifold.intersection(body, grown).volume()).toBeGreaterThan(0.005 * area * 0.01);
    // Flush: the fill's top is the tab's top, its bottom 0.6 mm down.
    const fb = meshBounds(ov);
    expect(fb.max[2]).toBeCloseTo(tab.z, 4);
    expect(fb.min[2]).toBeCloseTo(tab.z - 0.6, 4);
    // Whole-mesh volume counts both filaments.
    expect(meshVolume(mesh)).toBeCloseTo(meshVolume(plain()), 1);
    for (const m of [body, fill, both, grown]) m.delete();
  });

  it('text reads upright from the front: letter tops toward the back (+Y)', () => {
    const o = bin({ labelText: 'T', labelStyle: 'inlaid' });
    const ov = buildBin(w, o).overlays![0];
    // A "T": its bar (the widest part) is at the back end of the glyph.
    const b = meshBounds(ov);
    const p = ov.positions;
    let wBack = 0;
    let wFront = 0;
    const span = (lo: number, hi: number) => {
      let a = Infinity;
      let z = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 1] >= lo && p[i + 1] <= hi) {
          a = Math.min(a, p[i]);
          z = Math.max(z, p[i]);
        }
      }
      return z - a;
    };
    const h = b.max[1] - b.min[1];
    wBack = span(b.max[1] - h * 0.1, b.max[1]);
    wFront = span(b.min[1], b.min[1] + h * 0.1);
    expect(wBack).toBeGreaterThan(wFront * 2);
  });

  it('fits the tab: margins, cap height ≤ 70 % of the depth, shrinks to the width', () => {
    const o = bin({ unitsX: 1, label: 'full', labelText: 'A rather long label for one cell' });
    const { tab, fit } = textArea(o);
    const ink = meshBounds({ positions: new Float32Array(fit.outline.contours.flat().flatMap(([x, y]) => [x + fit.cx, y + fit.cy, 0])), indices: new Uint32Array() });
    expect(ink.min[0]).toBeGreaterThanOrEqual(tab.x0 + 1 - 1e-6);
    expect(ink.max[0]).toBeLessThanOrEqual(tab.x1 - 1 + 1e-6);
    expect(ink.min[1]).toBeGreaterThanOrEqual(tab.y0 + 1 - 1e-6);
    expect(ink.max[1]).toBeLessThanOrEqual(tab.y1 - 1 + 1e-6);
    expect(fit.outline.size).toBeLessThan(0.7 * (tab.y1 - tab.y0));
    const short = textArea(bin({ labelText: 'M3' })).fit;
    expect(short.outline.size).toBeCloseTo(Math.min(8, 0.7 * (tab.y1 - tab.y0)), 4);
  });

  it('keeps text clear of the stacking lip', () => {
    const o = sanitizeBin(bin({ labelText: 'X' }));
    const [tab] = binLabelTabs(o);
    // The lip support reaches 2.6 mm in from the outside at the tab's height.
    expect(tab.y1).toBeCloseTo((42 - 0.5) / 2 - 2.6, 3);
    const [noLip] = binLabelTabs(sanitizeBin({ ...o, lip: false }));
    expect(noLip.y1).toBeGreaterThan(tab.y1 + 1.5);
  });

  it('raised text with no headroom under the lip is engraved instead', () => {
    const o = sanitizeBin(bin({ labelText: 'X', labelStyle: 'raised' }));
    const H = binBodyHeight(o);
    const [tab] = binLabelTabs(o);
    expect(planTabLabels(o, [tab], H)[0]).toMatchObject({ style: 'raised', relief: 0.5 });
    expect(planTabLabels(o, [{ ...tab, z: H - 0.8 }], H)[0]).toMatchObject({ style: 'engraved', relief: 0.6 });
    // Without a lip nothing stacks on the bin.
    expect(planTabLabels({ ...o, lip: false }, [{ ...tab, z: H - 0.1 }], H)[0]).toMatchObject({ style: 'raised', relief: 0.5 });
  });

  it('tabs too small for text, bins without tabs and blank text degrade gracefully', () => {
    for (const o of [
      bin({ unitsX: 1, divX: 8, labelText: 'MMMMMMMMMMMM', labelStyle: 'inlaid' }),
      bin({ unitsX: 1, heightUnits: 2, divY: 3, labelText: 'Tiny' }),
      bin({ label: 'none', labelText: 'No tab' }),
      bin({ labelText: '  \n  ', labelStyle: 'engraved' }),
      bin({ interior: 'pockets', labelText: 'Pockets' }),
    ]) {
      const mesh = buildBin(w, o);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    }
    expect(buildBin(w, bin({ label: 'none', labelText: 'No tab' })).overlays).toBeUndefined();
    expect(binLabelTexts(bin({ label: 'none', labelText: 'No tab' }))).toEqual([]);
    expect(meshVolume(buildBin(w, bin({ labelText: '  \n  ' })))).toBeCloseTo(meshVolume(plain()), 3);
    expect(fitText('MMMMMMMMMMMMMMMM', { x0: 0, y0: 0, x1: 8, y1: 10 }, 7)).toBeNull();
  });

  it('compartments can have their own text; the bin text fills the rest', () => {
    let layout = uniformLayout(3, 1);
    const keysOf = (o: BinOptions) => binLabelTabs(sanitizeBin(o)).map((t) => t.key);
    const base = bin({ unitsX: 3, layout, labelText: 'MISC' });
    const keys = keysOf(base);
    expect(keys).toHaveLength(3);
    layout = setCompartmentOptions(layout, keys[0], { labelText: 'M3' });
    layout = setCompartmentOptions(layout, keys[2], { labelText: 'M5' });
    const o = bin({ unitsX: 3, layout, labelText: 'MISC' });
    expect(binLabelTexts(o)).toEqual(['M3', 'MISC', 'M5']);
    expect(binKey(o)).not.toBe(binKey(base));
    expect(binKey(bin({ ...o, layout: setCompartmentOptions(layout, keys[0], { labelText: 'M4' }) }))).not.toBe(binKey(o));
    const mesh = buildBin(w, { ...o, labelStyle: 'inlaid' });
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    // Three separate labels in the overlay.
    const parts = solid(mesh.overlays![0]).decompose();
    expect(parts.length).toBeGreaterThanOrEqual(6);
    parts.forEach((p: Manifold) => p.delete());
    // Uniform bins without a layout use the bin text on every tab.
    expect(binLabelTexts(bin({ unitsX: 3, divX: 3, labelText: 'ALL' }))).toEqual(['ALL', 'ALL', 'ALL']);
  });

  it('text is part of the mesh key and sanitized', () => {
    const a = bin();
    expect(binKey(bin({ labelText: '' }))).toBe(binKey(a));
    expect(binKey(bin({ labelText: 'A' }))).not.toBe(binKey(a));
    expect(binKey(bin({ labelText: 'A', labelStyle: 'engraved' }))).not.toBe(binKey(bin({ labelText: 'A' })));
    expect(binKey(bin({ labelText: ' A ' }))).toBe(binKey(bin({ labelText: 'A' })));
    expect(sanitizeLabelText('a\tb\u0007c\r\nd')).toBe('a bc\nd');
    expect(sanitizeLabelText('1\n2\n3\n4\n5')).toBe('1\n2\n3 4 5');
    expect([...sanitizeLabelText('x'.repeat(500))]).toHaveLength(60);
    expect(sanitizeLabelText(42)).toBe('');
    expect(labelLines('\n  M3  \n\n')).toBe('M3');
    expect(sanitizeBin({ ...a, labelStyle: 'bogus' as never, labelText: 5 as never })).toMatchObject({ labelStyle: 'raised', labelText: '' });
    const l = sanitizeLayout({ walls: [], comps: { k: { labelText: 'x'.repeat(100) }, e: { labelText: '' } } })!;
    expect(l.comps!.k.labelText).toHaveLength(60);
    expect(l.comps!.e).toBeUndefined();
    expect(layoutKey({ walls: [], comps: { k: { scoop: 0.5 } } })).toBe('|k=0.5//');
  });
});

describe('label plates', () => {
  it('are placed pressed into their recesses for the assembled view', () => {
    const o = bin({ unitsX: 2, divX: 2, labelText: 'M3 SCREWS', labelPlates: true });
    const plates = binLabelPlates(o);
    const places = binLabelPlatePlaces(o);
    expect(places).toHaveLength(plates.length);
    const { w: W, d: D } = binSize(o);
    const body = solid(buildBin(w, o)).translate([W / 2, D / 2, 0]);
    const so = sanitizeBin(o);
    const tabs = planTabLabels(so, binLabelTabs(so), binBodyHeight(so));
    places.forEach((at, i) => {
      // Top of the plate flush with the tab, inside the recess, not overlapping the bin.
      expect(at.z + plates[i].thickness).toBeCloseTo(tabs[i].tab.z, 6);
      expect(at.x - W / 2).toBeCloseTo(tabs[i].plate!.recess.x0 + LABEL_PLATE.clearance, 6);
      const plate = solid(buildLabelPlate(w, plates[i])).translate([at.x, at.y, at.z]);
      expect(body.intersect(plate).volume()).toBeLessThan(0.05);
    });
    // Planned parts carry the place, so the drawer view can show them in the bin.
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 2, gridY: 1 }, bins: [{ id: 'b', x: 0, y: 0, opts: o }] });
    expect(job.parts['label:b:0'].assembled).toEqual(places[0]);
  });

  it('cut a recess with room for the plate and plan one plate per tab', () => {
    const o = bin({ unitsX: 2, divX: 2, labelText: 'M3 SCREWS', labelPlates: true, labelStyle: 'inlaid' });
    const plates = binLabelPlates(o);
    expect(plates).toHaveLength(2);
    const so = sanitizeBin(o);
    const [L] = planTabLabels(so, binLabelTabs(so), binBodyHeight(so));
    const p = plates[0];
    expect(p.width).toBeLessThanOrEqual(36.4);
    // Tab width − 2 mm, at most 36.4, less room for the finger notch on narrower tabs.
    const tw = L.tab.x1 - L.tab.x0;
    expect(p.width).toBeCloseTo(Math.min(36.4, tw - 2, tw - 1.6 - 0.3 - 3), 1);
    expect(p.depth).toBeCloseTo(Math.min(11, L.tab.y1 - L.tab.y0 - 2), 2);
    expect(p.thickness).toBe(LABEL_PLATE.thickness);
    // Both compartments have the same text: one mesh.
    expect(labelPlateKey(plates[1])).toBe(labelPlateKey(p));
    expect(L.plate!.recess.x1 - L.plate!.recess.x0).toBeCloseTo(p.width + 0.3, 6);
    expect(L.plate!.recess.y1 - L.plate!.recess.y0).toBeCloseTo(p.depth + 0.3, 6);
    // Recess and notch stay on the tab.
    expect(L.plate!.recess.x0).toBeGreaterThan(L.tab.x0);
    expect(L.plate!.notch.x + L.plate!.notch.r).toBeLessThan(L.tab.x1);
    expect(L.plate!.recess.y0).toBeGreaterThan(L.tab.y0);
    expect(L.plate!.recess.y1).toBeLessThan(L.tab.y1);

    // The bin gets recesses but no text of its own.
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    expect(mesh.overlays).toBeUndefined();
    const lost = meshVolume(buildBin(w, bin({ unitsX: 2, divX: 2 }))) - meshVolume(mesh);
    expect(lost).toBeGreaterThan(2 * (p.width + 0.3) * (p.depth + 0.3) * 1);

    // The plate: flat, valid, text inlaid on filament 2.
    const pm = buildLabelPlate(w, p);
    expect(check(pm)).toMatchObject({ status: 'NoError', components: 1 });
    const b = meshBounds(pm);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max[0]).toBeCloseTo(p.width, 4);
    expect(b.max[1]).toBeCloseTo(p.depth, 4);
    expect(b.max[2]).toBeCloseTo(1, 4);
    expect(pm.overlays?.[0].filament).toBe(2);
    expect(meshVolume(pm)).toBeCloseTo(check(pm).volume + check(pm.overlays![0]).volume, 3);
  });

  it('raised and blank plates; tabs too small for a plate keep text on the tab', () => {
    const raised = binLabelPlates(bin({ labelText: 'BOLTS', labelPlates: true }))[0];
    expect(raised.style).toBe('raised');
    const rm = buildLabelPlate(w, raised);
    expect(check(rm).components).toBe(1);
    expect(meshBounds(rm).max[2]).toBeCloseTo(1.5, 4);
    const blank = binLabelPlates(bin({ labelPlates: true }))[0];
    expect(blank.text).toBe('');
    expect(meshBounds(buildLabelPlate(w, blank)).max[2]).toBeCloseTo(1, 4);
    // Eight narrow compartments: no room for plates, so the text goes on the tabs.
    const narrow = bin({ unitsX: 2, divX: 8, labelText: 'AB', labelPlates: true, labelStyle: 'inlaid' });
    expect(binLabelPlates(narrow)).toEqual([]);
    expect(buildBin(w, narrow).overlays).toHaveLength(1);
  });
});

describe('label tabs and back-wall cutouts', () => {
  // Three compartments, centered tabs: the back cutout takes the wall the middle tab hangs from.
  const cutBin = (o: Partial<BinOptions> = {}): BinOptions => ({
    ...DEFAULT_BIN,
    unitsX: 2,
    unitsY: 1,
    heightUnits: 2,
    divX: 3,
    label: 'center',
    cutoutWalls: 'b',
    ...o,
  });
  /** Half the cutout's width: `cutoutWidth` of the back wall's inside length. */
  const halfCut = (o: BinOptions) => (o.cutoutWidth * (binSize(o).w - 2 * 0.95)) / 2;
  const spans = (o: BinOptions) => binLabelTabs(o).map((t) => [t.x0, t.x1]);

  it('leaves no tab floating where the cutout took its wall', () => {
    for (const o of [
      cutBin(),
      cutBin({ cutoutWalls: 'fb' }),
      cutBin({ scoop: 1 }),
      cutBin({ cutoutWalls: 'fb', scoop: 1 }),
      cutBin({ layout: uniformLayout(3, 1) }),
      // A wide, deep cutout in a tall bin: the loose tab was over 2000 mm³.
      cutBin({ heightUnits: 6, divX: 1, cutoutWidth: 1, cutoutDepth: 30 }),
    ]) {
      expect(check(buildBin(w, o))).toMatchObject({ status: 'NoError', components: 1 });
    }
  });

  it('trims tabs back to the cutout’s edge, leaves out the ones inside it and keeps tabs that bridge it', () => {
    const o = cutBin();
    const hw = halfCut(o);
    const tabs = binLabelTabs(o);
    expect(tabs.map((t) => t.key)).toEqual(['g0,0', 'g2,0']);
    expect(tabs[0].x1).toBeCloseTo(-hw, 6);
    expect(tabs[1].x0).toBeCloseTo(hw, 6);
    // The same compartments as a divider layout get the same tabs.
    const fromLayout = spans(cutBin({ layout: uniformLayout(3, 1) }));
    expect(fromLayout).toHaveLength(2);
    fromLayout.flat().forEach((v, i) => expect(v).toBeCloseTo(spans(o).flat()[i], 6));
    // Full-width tabs hang from the dividers: the middle one bridges the cutout.
    expect(binLabelTabs(cutBin({ label: 'full' }))).toHaveLength(3);
    // In a tall bin the 12 mm cutout leaves enough wall under the tabs: nothing changes.
    expect(spans(cutBin({ heightUnits: 6 }))).toEqual(spans(cutBin({ heightUnits: 6, cutoutWalls: '' })));
  });

  it('in a divider layout, tabs bridge the cutout only between plain walls', () => {
    const lowered = setWallProps(setWallProps(uniformLayout(3, 1), 'x1', { lower: 4 }), 'x2', { lower: 4 });
    expect(binLabelTabs(cutBin({ label: 'full', layout: uniformLayout(3, 1) }))).toHaveLength(3);
    // Between two lowered walls the middle tab would hang from nothing: it is left out.
    const o = cutBin({ label: 'full', layout: lowered });
    expect(binLabelTabs(o)).toHaveLength(2);
    expect(check(buildBin(w, o))).toMatchObject({ status: 'NoError', components: 1 });
  });

  it('puts label text and plates only on what is left of the tabs', () => {
    const o = cutBin({ unitsX: 3, heightUnits: 6, cutoutDepth: 30, labelText: 'M3', labelStyle: 'inlaid' });
    const hw = halfCut(o);
    expect(binLabelTabs(o).map((t) => t.key)).toEqual(['g0,0', 'g2,0']);
    expect(binLabelTexts(o)).toEqual(['M3', 'M3']);
    const mesh = buildBin(w, o);
    expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
    // The inlaid text sits on the tabs beside the cutout, inside their margins.
    const p = mesh.overlays![0].positions;
    let inner = Infinity;
    for (let i = 0; i < p.length; i += 3) inner = Math.min(inner, Math.abs(p[i]));
    expect(inner).toBeGreaterThan(hw + 1 - 1e-3);

    const po = { ...o, labelPlates: true };
    expect(binLabelPlates(po)).toHaveLength(2);
    expect(binLabelPlatePlaces(po)).toHaveLength(2);
    const so = sanitizeBin(po);
    for (const L of planTabLabels(so, binLabelTabs(so), binBodyHeight(so), binSize(so).w)) {
      const { recess, notch } = L.plate!;
      expect(Math.max(recess.x1, notch.x + notch.r) <= -hw || recess.x0 >= hw).toBe(true);
    }
    expect(check(buildBin(w, po))).toMatchObject({ status: 'NoError', components: 1 });
  });
});

describe('planning', () => {
  const removable = () => setWallProps(uniformLayout(2, 1), 'x1', { removable: true });
  const placed = (id: string, x: number, y: number, o: Partial<BinOptions>): PlacedBin => ({ id, x, y, opts: bin(o) });
  const project = (bins: PlacedBin[], include = { baseplate: true, bins: true }) => ({
    ...DEFAULT_PROJECT,
    drawer: { ...DEFAULT_DRAWER, mode: 'grid' as const, gridX: 6, gridY: 3 },
    bins,
    include,
  });

  it('plans divider inserts and label plates as parts, meshes shared between identical ones', () => {
    const bins = [
      placed('a', 0, 0, { layout: removable(), labelText: 'NUTS', labelPlates: true, labelStyle: 'inlaid' }),
      placed('b', 2, 0, { layout: removable(), labelText: 'NUTS', labelPlates: true, labelStyle: 'inlaid' }),
      placed('c', 4, 0, { labelText: 'WASHERS', labelStyle: 'raised' }),
    ];
    const job = planJob(project(bins));
    const kinds = (k: string) => Object.values(job.parts).filter((p) => p.kind === k);
    expect(kinds('divider')).toHaveLength(2);
    expect(kinds('label')).toHaveLength(4);
    expect(new Set(kinds('divider').map((p) => p.meshKey)).size).toBe(1);
    expect(new Set(kinds('label').map((p) => p.meshKey)).size).toBe(1);
    expect(kinds('divider')[0].name).toMatch(/^Divider [\d.]+ × [\d.]+ mm \(bin 2×1\)$/);
    expect(kinds('label')[0].name).toBe('Label plate “NUTS” (bin 2×1)');
    expect(job.parts['bin:c'].name).toContain('“WASHERS”');
    // Packed with the bins.
    const binPlates = job.plates.filter((p) => p.group === 'bins');
    const onPlates = binPlates.flatMap((p) => p.placements.map((x) => job.parts[x.key].kind));
    expect(onPlates.filter((k) => k === 'divider')).toHaveLength(2);
    expect(onPlates.filter((k) => k === 'label')).toHaveLength(4);
    expect(plateContents(job, binPlates[0]).join(', ')).toMatch(/2 dividers, 4 label plates/);
    // Every planned mesh builds.
    for (const spec of Object.values(job.meshes).filter((m) => m.kind === 'divider' || m.kind === 'label')) {
      const mesh = buildMesh(w, spec);
      expect(check(mesh)).toMatchObject({ status: 'NoError', components: 1 });
      expect(meshBounds(mesh).min[2]).toBeCloseTo(0, 6);
    }
    const bom = billOfMaterials(job, (k) => (k.startsWith('label|') || k.startsWith('insert|') ? 100 : 1000));
    expect(bom.parts).toMatchObject({ bins: 3, dividers: 2, labels: 4 });
    expect(bom.total.volume).toBeGreaterThan(0);
    expect(usesSecondFilament(job)).toBe(true);
    expect(usesSecondFilament(planJob(project([bins[2]])))).toBe(false);
  });

  it('leaves them off the plates when bins are not exported', () => {
    const job = planJob(project([placed('a', 0, 0, { layout: removable(), labelPlates: true })], { baseplate: true, bins: false }));
    expect(Object.values(job.parts).some((p) => p.kind === 'divider')).toBe(true);
    expect(job.plates.every((p) => p.group === 'baseplate')).toBe(true);
  });

  it('Bambu export of a labelled bin has an extruder-2 part in the chosen colour', () => {
    const job = planJob(project([placed('a', 0, 0, { labelText: 'SPARE\nPARTS', labelStyle: 'inlaid' })], { baseplate: false, bins: true }));
    const cache = new Map<string, MeshData>();
    const get = (k: string) => {
      if (!cache.has(k)) cache.set(k, buildMesh(w, job.meshes[k]));
      return cache.get(k)!;
    };
    const settings = JSON.stringify({ filament_diameter: ['1.75'], filament_colour: ['#00AE42'], filament_settings_id: ['PLA'] });
    const files = unzipSync(exportBambuProject(job, { ...DEFAULT_PROJECT.setup, labelColour: '#ff8800' }, get, settings));
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(cfg).toContain('<metadata key="extruder" value="2"/>');
    expect(cfg).toContain('Label text');
    const ps = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(ps.filament_colour).toEqual(['#00AE42', '#FF8800']);
  });
});
