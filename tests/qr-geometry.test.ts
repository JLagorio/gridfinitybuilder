import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import jsQR from 'jsqr';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binFrontLabel, binKey, binSize, binTotalHeight, buildBin, type BinOptions } from '../src/lib/geometry/bin';
import { setWallProps, uniformLayout } from '../src/lib/dividers';
import { LID_FLOOR, buildBinLid, lidKey } from '../src/lib/geometry/lid';
import { SLIDE, accessoryParts, slideLidBox, type SlideLidPart } from '../src/lib/geometry/accessories';
import { buildAccessoryPart } from '../src/lib/geometry/accessoryGeometry';
import { QR, qrSide, type QrSpot, type QrStyle } from '../src/lib/geometry/qrCode';
import { buildQrPlate } from '../src/lib/geometry/qrSolid';
import { binQrPlan, binQrPlate, qrContentsText, resolveQrText } from '../src/lib/geometry/binQr';
import { meshTopology } from '../src/lib/geometry/printcheck';
import { QR_QUIET } from '../src/lib/qr';
import { DEFAULT_PROJECT, buildMesh, planJob, usesSecondFilament, type PlacedBin, type ProjectState } from '../src/lib/project';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { exportBambuProject } from '../src/lib/export/bambu';
import { strFromU8, unzipSync } from 'fflate';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const URL = 'https://example.com/inventory/bin/42';
const bin = (o: Partial<BinOptions>): BinOptions => ({ ...DEFAULT_BIN, ...o });

/** Edges that are open, or shared by more than two triangles, once vertices are welded by position (as an STL reader does). */
function weldedFaults(mesh: Pick<MeshData, 'positions' | 'indices'>) {
  const key = new Map<string, number>();
  const remap = new Uint32Array(mesh.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const k = `${Math.round(mesh.positions[3 * i] * 1e4)},${Math.round(mesh.positions[3 * i + 1] * 1e4)},${Math.round(mesh.positions[3 * i + 2] * 1e4)}`;
    if (!key.has(k)) key.set(k, key.size);
    remap[i] = key.get(k)!;
  }
  const t = meshTopology({ positions: mesh.positions, indices: mesh.indices.map((v) => remap[v]) });
  return t.openEdges + t.badEdges;
}

/**
 * Valid as Manifold sees it, and no worse welded by position than the same
 * part without a code (`without`; plates and inlays: none at all). Plain bins
 * and lids already have a few such edges where their feet meet the body.
 */
function expectSound(mesh: Pick<MeshData, 'positions' | 'indices'>, what: string, without?: Pick<MeshData, 'positions' | 'indices'>) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  expect(m.status(), what).toBe('NoError');
  m.delete();
  expect(weldedFaults(mesh), `${what}: welded`).toBeLessThanOrEqual(without ? weldedFaults(without) : 0);
}

/**
 * Top-down height map of a mesh over a square (x0, y0)–(x0 + size, y0 + size),
 * `n` × `n` pixels: the highest surface under each pixel's center (NaN: none).
 * Row 0 is the +Y edge, so the image reads the way the code is laid out.
 */
function heightMap(positions: Float32Array, indices: Uint32Array, x0: number, y0: number, size: number, n: number): Float32Array {
  const out = new Float32Array(n * n).fill(NaN);
  const px = size / n;
  const y1 = y0 + size;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / px - 0.5));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / px - 0.5));
    const j0 = Math.max(0, Math.floor((y1 - Math.max(ay, by, cy)) / px - 0.5));
    const j1 = Math.min(n - 1, Math.ceil((y1 - Math.min(ay, by, cy)) / px - 0.5));
    for (let j = j0; j <= j1; j++) {
      const Y = y1 - (j + 0.5) * px;
      for (let i = i0; i <= i1; i++) {
        const X = x0 + (i + 0.5) * px;
        const l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / det;
        const l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        const k = j * n + i;
        if (!(out[k] >= z)) out[k] = z;
      }
    }
  }
  return out;
}

/** Turn a mesh so its front (−Y) faces up: (x, y, z) → (x, z, −y). */
function frontUp(p: Float32Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = p[i + 2];
    out[i + 2] = -p[i + 1];
  }
  return out;
}

/**
 * Read the code the geometry prints: rasterise the code and its quiet zone
 * from the mesh, top-down (`up` turns the face up first), with the face at
 * height `face`. Dark where filament 2 is on top (inlaid), where the body
 * stands proud (raised) or is cut in (engraved). Decoded with jsQR.
 */
function readPrinted(mesh: MeshData, spot: QrSpot, face: number, up: (p: Float32Array) => Float32Array = (p) => p, frame = { cx: spot.cx, cy: spot.cy }) {
  const ppm = 4;
  const side = qrSide(spot);
  const n = Math.round((spot.modules + 2 * QR_QUIET) * ppm);
  const x0 = frame.cx - side / 2;
  const y0 = frame.cy - side / 2;
  const body = heightMap(up(mesh.positions), mesh.indices, x0, y0, side, n);
  const inlay = mesh.overlays?.find((o) => o.name === 'QR code');
  const fill = inlay ? heightMap(up(inlay.positions), inlay.indices, x0, y0, side, n) : null;
  const dark = (k: number) =>
    spot.style === 'inlaid' ? fill![k] >= face - 0.05 : spot.style === 'raised' ? body[k] > face + spot.relief / 2 : body[k] < face - spot.relief / 2;
  // A few modules of extra white all round, as paper would have.
  const pad = 4 * ppm;
  const N = n + 2 * pad;
  const img = new Uint8ClampedArray(N * N * 4).fill(255);
  let darkCount = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!dark(j * n + i)) continue;
      darkCount++;
      const k = ((j + pad) * N + i + pad) * 4;
      img[k] = img[k + 1] = img[k + 2] = 0;
    }
  }
  const res = jsQR(img, N, N, { inversionAttempts: 'dontInvert' });
  return { text: res?.data ?? null, version: res?.version, darkShare: darkCount / (n * n) };
}

const STYLES: QrStyle[] = ['inlaid', 'raised', 'engraved'];

describe('QR codes on the front wall', () => {
  for (const style of STYLES) {
    it(`${style}: builds a sound bin whose front reads back as the code`, () => {
      const o = bin({ unitsX: 2, unitsY: 1, heightUnits: 6, qr: 'front', qrContent: 'custom', qrText: URL, qrStyle: style });
      const plan = binQrPlan(o)!;
      expect(plan.spot).not.toBeNull();
      expect(plan.where).toBe('front wall');
      const spot = plan.spot!;
      // Centered on the flat face, as large as the face is tall.
      expect(spot.cx).toBeCloseTo(0, 6);
      expect(qrSide(spot)).toBeGreaterThan(plan.room - (spot.modules + 8) * 0.01 - 1e-6);
      const mesh = buildBin(w, o);
      expectSound(mesh, `front ${style}`, buildBin(w, { ...o, qr: 'none' }));
      if (style === 'inlaid') {
        expect(mesh.overlays?.map((v) => [v.name, v.filament])).toEqual([['QR code', 2]]);
        expectSound(mesh.overlays![0], 'front inlay');
      } else expect(mesh.overlays).toBeUndefined();
      const { d: D } = binSize(o);
      const read = readPrinted(mesh, spot, D / 2, frontUp);
      expect(read.text).toBe(URL);
      expect(read.version).toBe(spot.version);
      expect(read.darkShare).toBeGreaterThan(0.2);
    });
  }

  it('changes the bin only when the code is on it, and only its key', () => {
    const plain = bin({ unitsX: 2, heightUnits: 6 });
    expect(binKey(bin({ ...plain, qr: 'lid', qrContent: 'custom', qrText: URL }))).toBe(binKey(plain));
    expect(binKey(bin({ ...plain, qr: 'plate', qrContent: 'custom', qrText: URL }))).toBe(binKey(plain));
    const front = bin({ ...plain, qr: 'front', qrContent: 'custom', qrText: URL });
    expect(binKey(front)).not.toBe(binKey(plain));
    expect(binKey({ ...front, qrEcc: 'H' })).not.toBe(binKey(front));
    expect(binKey({ ...front, qrText: 'other' })).not.toBe(binKey(front));
  });

  it('shares the face with a front label: the code at the right, the text left of it', () => {
    const o = bin({ unitsX: 3, heightUnits: 6, label: 'none', labelText: 'Resistors', frontLabel: 'engraved', qr: 'front', qrContent: 'custom', qrText: 'R 1k-10k', qrStyle: 'inlaid' });
    const plan = binQrPlan(o)!;
    const label = binFrontLabel(o)!;
    expect(label.segments).toHaveLength(1);
    const left = plan.spot!.cx - qrSide(plan.spot!) / 2;
    expect(label.segments[0].box.x1).toBeLessThanOrEqual(left + 1e-6);
    expect(plan.spot!.cx).toBeGreaterThan(0);
    const mesh = buildBin(w, o);
    expectSound(mesh, 'front + label', buildBin(w, { ...o, qr: 'none' }));
    expect(readPrinted(mesh, plan.spot!, binSize(o).d / 2, frontUp).text).toBe('R 1k-10k');
  });

  it('keeps clear of a front cutout and a hex pattern, over a removable divider', () => {
    const layout = setWallProps(uniformLayout(2, 1), 'x1', { removable: true });
    const o = bin({ unitsX: 2, heightUnits: 8, cutoutWalls: 'f', cutoutDepth: 12, patternWalls: 'f', layout, qr: 'front', qrContent: 'custom', qrText: 'CUT', qrStyle: 'engraved' });
    const plan = binQrPlan(o)!;
    expect(plan.spot).not.toBeNull();
    // Below the cutout.
    expect(plan.spot!.cy + qrSide(plan.spot!) / 2).toBeLessThan(binTotalHeight(o) - 12);
    const mesh = buildBin(w, o);
    expectSound(mesh, 'cutout + pattern', buildBin(w, { ...o, qr: 'none' }));
    expect(readPrinted(mesh, plan.spot!, binSize(o).d / 2, frontUp).text).toBe('CUT');
  });

  it('says why when it does not fit', () => {
    const tooLong = binQrPlan(bin({ unitsX: 1, heightUnits: 3, qr: 'front', qrContent: 'custom', qrText: 'x'.repeat(300) }))!;
    expect(tooLong.spot).toBeNull();
    expect(tooLong.error).toBe('too-long');
    const empty = binQrPlan(bin({ unitsX: 1, heightUnits: 6, qr: 'front' }))!;
    expect(empty.error).toBe('empty');
    // Nothing is cut when the code is left off.
    expect(buildBin(w, bin({ unitsX: 1, heightUnits: 3, qr: 'front', qrContent: 'custom', qrText: 'x'.repeat(300) })).overlays).toBeUndefined();
  });
});

describe('QR codes on lids', () => {
  for (const style of STYLES) {
    it(`stacking lid, ${style}: on a receptacle floor (raised is engraved: a stacked bin stands there)`, () => {
      const o = bin({ unitsX: 2, unitsY: 1, lid: true, qr: 'lid', qrContent: 'custom', qrText: 'LID 7', qrStyle: style });
      const plan = binQrPlan(o)!;
      expect(plan.where).toBe('stacking lid');
      const spot = plan.spot!;
      expect(spot.style).toBe(style === 'raised' ? 'engraved' : style);
      const mesh = buildBinLid(w, o);
      expectSound(mesh, `lid ${style}`, buildBinLid(w, { ...o, qr: 'none' }));
      if (style === 'inlaid') expectSound(mesh.overlays![0], 'lid inlay');
      expect(readPrinted(mesh, spot, LID_FLOOR).text).toBe('LID 7');
      expect(lidKey(o)).not.toBe(lidKey({ ...o, qr: 'none' }));
    });
  }

  for (const style of ['inlaid', 'raised'] as const) {
    it(`sliding lid, ${style}: behind the grip ridges, beside the lid's text`, () => {
      const o = bin({ unitsX: 2, unitsY: 2, heightUnits: 5, lip: false, slideLid: true, slideLidText: 'Bits', qr: 'lid', qrContent: 'custom', qrText: URL, qrStyle: style });
      const { w: W, d: D } = binSize(o);
      const plan = binQrPlan(o)!;
      expect(plan.where).toBe('sliding lid');
      const part = accessoryParts(o, W, D).find((a) => a.part.type === 'slideLid')!.part as SlideLidPart;
      expect(part.qr).toEqual(plan.spot);
      const mesh = buildAccessoryPart(w, part);
      expectSound(mesh, `sliding lid ${style}`, buildAccessoryPart(w, { ...part, qr: undefined }));
      if (style === 'inlaid') expectSound(mesh.overlays![0], 'sliding lid inlay');
      const b = slideLidBox(W, D);
      // The part is moved so its min corner is at the origin.
      const read = readPrinted(mesh, plan.spot!, SLIDE.thickness, undefined, { cx: plan.spot!.cx - b.x0, cy: plan.spot!.cy - b.y0 });
      expect(read.text).toBe(URL);
    });
  }

  it('has nowhere to go without a lid', () => {
    expect(binQrPlan(bin({ qr: 'lid', qrContent: 'custom', qrText: 'x' }))!.error).toBe('no-surface');
  });
});

describe('QR plates', () => {
  for (const style of STYLES) {
    it(`${style}: a flat square that reads back as the code`, () => {
      const o = bin({ unitsX: 1, heightUnits: 3, qr: 'plate', qrStyle: style, qrContent: 'custom', qrText: URL });
      const p = binQrPlate(o)!;
      const part = p.part!;
      // As large as the bin's front face, made larger so the modules are at least QR.autoModule.
      expect(part.spot.module).toBeGreaterThanOrEqual(QR.autoModule - 0.01);
      expect(part.side).toBeGreaterThan(p.face);
      const mesh = buildQrPlate(w, part);
      expectSound(mesh, `plate ${style}`);
      if (style === 'inlaid') expectSound(mesh.overlays![0], 'plate inlay');
      expect(readPrinted(mesh, part.spot, part.thickness).text).toBe(URL);
    });
  }

  it('takes the size asked for', () => {
    const p = binQrPlate(bin({ qr: 'plate', qrContent: 'custom', qrText: 'Hi', qrSize: 30 }))!.part!;
    expect(p.side).toBeLessThanOrEqual(30);
    expect(p.side).toBeGreaterThan(29.5);
  });
});

describe('what the code says', () => {
  const placed = (o: Partial<BinOptions>, more: Partial<PlacedBin> = {}): PlacedBin => ({ id: 'b', x: 0, y: 0, opts: bin({ qr: 'plate', ...o }), ...more });

  it('lists the label and the contents, compartments in reading order, without repeats', () => {
    const b = placed(
      { labelText: 'M3', divX: 2, divY: 1 },
      { contents: '- M3 × 8 screws\nM3 nuts\n\n', compContents: { c1: 'Washers\nm3 nuts' } },
    );
    expect(qrContentsText(b)).toBe('M3\nM3 × 8 screws\nM3 nuts\nWashers');
    expect(qrContentsText(placed({}, { contents: 'Only this' }))).toBe('Only this');
    expect(qrContentsText(placed({}))).toBe('');
  });

  it('is filled in at planning: the key follows the contents only when the code lists them', () => {
    const drawer = { ...DEFAULT_DRAWER, mode: 'grid' as const, gridX: 2, gridY: 1 };
    const state = (b: PlacedBin): ProjectState => ({ ...DEFAULT_PROJECT, drawer, bins: [b] });
    const keys = (b: PlacedBin) => Object.keys(planJob(state(b)).meshes).sort();
    const a = placed({ qr: 'front', heightUnits: 6 }, { contents: 'Bolts' });
    expect(keys(a)).not.toEqual(keys({ ...a, contents: 'Nuts' }));
    const custom = placed({ qr: 'front', heightUnits: 6, qrContent: 'custom', qrText: URL }, { contents: 'Bolts' });
    expect(keys(custom)).toEqual(keys({ ...custom, contents: 'Nuts' }));
    // Without a code, nothing changes.
    const none = placed({ qr: 'none' }, { contents: 'Bolts' });
    expect(resolveQrText(none.opts, none)).toBe(none.opts);
  });
});

describe('QR codes in the print job', () => {
  const drawer = { ...DEFAULT_DRAWER, mode: 'grid' as const, gridX: 2, gridY: 1 };
  const job = (o: Partial<BinOptions>, contents = 'Hex bolts M6\nWashers M6') =>
    planJob({ ...DEFAULT_PROJECT, drawer, bins: [{ id: 'b', x: 0, y: 0, opts: bin({ unitsX: 2, ...o }), contents }] });

  it('prints a plate with the bins, in filament 2 when inlaid, and the Bambu project gives it filament 2', async () => {
    const j = job({ qr: 'plate' });
    const plate = Object.values(j.parts).find((p) => p.key.startsWith('qr:'))!;
    expect(plate.name).toMatch(/^QR plate \d+(\.\d)? × \d+(\.\d)? mm \(bin 2×1\)$/);
    expect(j.plates.some((pl) => pl.placements.some((p) => p.key === plate.key))).toBe(true);
    expect(usesSecondFilament(j)).toBe(true);
    expect(usesSecondFilament(job({ qr: 'plate', qrStyle: 'engraved' }))).toBe(false);
    const mesh = buildMesh(w, j.meshes[plate.meshKey]);
    const spec = j.meshes[plate.meshKey];
    expect(spec.kind).toBe('qrPlate');
    if (spec.kind === 'qrPlate') expect(readPrinted(mesh, spec.plate.spot, spec.plate.thickness).text).toBe('Hex bolts M6\nWashers M6');
    // The Bambu Studio project assigns the code to filament 2, like inlaid label text.
    const meshes = Object.fromEntries(Object.entries(j.meshes).map(([k, s]) => [k, buildMesh(w, s)]));
    const files = unzipSync(exportBambuProject(j, DEFAULT_PROJECT.setup, (k) => meshes[k]));
    const settings = strFromU8(files['Metadata/model_settings.config']);
    expect(settings).toMatch(/– QR code"\/>\s*<metadata key="matrix" value="[^"]*"\/>\s*<metadata key="extruder" value="2"\/>/);
  });

  it('marks second-filament use for codes on lids and the front wall', () => {
    expect(usesSecondFilament(job({ heightUnits: 6, qr: 'front' }))).toBe(true);
    expect(usesSecondFilament(job({ heightUnits: 6, qr: 'front', qrStyle: 'raised' }))).toBe(false);
    expect(usesSecondFilament(job({ lid: true, qr: 'lid' }))).toBe(true);
    expect(usesSecondFilament(job({ lip: false, slideLid: true, heightUnits: 5, qr: 'lid' }))).toBe(true);
    // Left off: nothing to say.
    expect(usesSecondFilament(job({ heightUnits: 6, qr: 'front' }, ''))).toBe(false);
  });
});
