import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, binTotalHeight } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, baseplateHeight, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { makePieces } from '../src/lib/layout/split';
import { placeTransform, write3MF } from '../src/lib/export/threemf';
import { plateColumns, plateOrigin, writeBambuProject } from '../src/lib/export/bambu';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

function check(mesh: MeshData) {
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

describe('bins', () => {
  it.each([
    { name: '1×1 plain', o: {} },
    { name: '2×1 dividers + scoop + label', o: { unitsX: 2, divX: 2, scoop: 0.7, label: 'full' as const } },
    { name: '3×2 grid of compartments', o: { unitsX: 3, unitsY: 2, divX: 3, divY: 2, label: 'left' as const } },
    { name: '1×1 no lip, magnets + screws', o: { lip: false, holes: 'both' as const, heightUnits: 2 } },
    { name: '2×2 no fillet, right tab', o: { unitsX: 2, unitsY: 2, fillet: false, label: 'right' as const, heightUnits: 6 } },
  ])('$name is one closed solid with spec dimensions', ({ o }) => {
    const opts = { ...DEFAULT_BIN, ...o };
    const mesh = buildBin(w, opts);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const b = meshBounds(mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(42 * opts.unitsX - 0.5, 3);
    expect(b.max[1] - b.min[1]).toBeCloseTo(42 * opts.unitsY - 0.5, 3);
    expect(b.min[2]).toBeCloseTo(0, 5);
    expect(b.max[2]).toBeCloseTo(binTotalHeight(opts), 3);
  });

  it('base bottom is 35.6 mm per spec', () => {
    const mesh = buildBin(w, DEFAULT_BIN);
    const p = mesh.positions;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 2]) < 1e-6) {
        minX = Math.min(minX, p[i]);
        maxX = Math.max(maxX, p[i]);
      }
    }
    expect(maxX - minX).toBeCloseTo(35.6, 3);
  });
});

describe('baseplate pieces', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });
  const pieces = makePieces(layout, [0, 87, 297, 510], [0, 146, 376]);

  it.each([
    { name: 'frame', o: {} },
    { name: 'magnets from top with release holes', o: { magnets: true, magnetRelease: true } },
    { name: 'magnets from bottom', o: { magnets: true, magnetSide: 'bottom' as const } },
    { name: 'screws + chamfer + pad', o: { screws: true, bottomChamfer: 0.6, bottomPad: 1 } },
  ])('$name: corner piece is one valid solid', ({ o }) => {
    const opts = { ...DEFAULT_BASEPLATE, ...o };
    const piece = pieces[0];
    const mesh = buildBaseplatePiece(w, layout, piece, opts);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    const b = meshBounds(mesh);
    expect(b.min[0]).toBeCloseTo(piece.x0, 4);
    expect(b.max[0]).toBeCloseTo(piece.x1, 4);
    expect(b.max[2]).toBeCloseTo(baseplateHeight(opts), 4);
  });

  it('an open frame has one through-hole per cell', () => {
    const piece = pieces[4]; // 5 × 5 interior-ish piece
    const cells = (piece.cells.x1 - piece.cells.x0) * (piece.cells.y1 - piece.cells.y0);
    const c = check(buildBaseplatePiece(w, layout, piece, DEFAULT_BASEPLATE));
    expect(c.genus).toBe(cells);
  });
});

describe('3MF output', () => {
  const cube: MeshData = (() => {
    // box: 10 × 20 × 5
    const v = [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0, 0, 0, 5, 10, 0, 5, 10, 20, 5, 0, 20, 5];
    const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    return { positions: new Float32Array(v), indices: new Uint32Array(t) };
  })();

  it('rotated placement lands the footprint where the packer put it', () => {
    const t = placeTransform(50, 60, true, 20);
    // transform the box corners: x' = x*m00 + y*m10 + tx
    const pts = [
      [0, 0],
      [10, 20],
    ].map(([x, y]) => [x * t[0] + y * t[3] + t[9], x * t[1] + y * t[4] + t[10]]);
    const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
    const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
    expect(xs).toEqual([50, 70]); // rotated width = original depth (20)
    expect(ys).toEqual([60, 70]); // rotated depth = original width (10)
  });

  it('plain 3MF has the core parts', () => {
    const files = unzipSync(write3MF([{ name: 'box', mesh: cube }], [{ object: 0, transform: placeTransform(1, 2, false, 20) }]));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<vertex /g)?.length).toBe(8);
    expect(model.match(/<triangle /g)?.length).toBe(12);
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 1 2 0"');
  });

  it('Bambu project places plate 2 at the 1.2 × bed stride and assigns plates', () => {
    const bytes = writeBambuProject({
      objects: [{ name: 'box', mesh: cube }],
      plates: [
        { name: 'A', parts: [{ object: 0, name: 'a', transform: placeTransform(10, 10, false, 20) }] },
        { name: 'B', parts: [{ object: 0, name: 'b', transform: placeTransform(10, 10, false, 20) }] },
      ],
      bedW: 256,
      bedD: 256,
      projectSettings: '{"printer_settings_id":"Bambu Lab P2S 0.4 nozzle"}',
    });
    const files = unzipSync(bytes);
    expect(files['3D/Objects/object_1.model']).toBeDefined();
    expect(files['3D/Objects/object_2.model']).toBeDefined();
    expect(files['Metadata/project_settings.config']).toBeDefined();
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('<metadata name="Application">BambuStudio-');
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 317.2 10 0"'); // 10 + 256 * 1.2
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(cfg.match(/<plate>/g)?.length).toBe(2);
  });

  it('plate grid matches Bambu Studio', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10].map(plateColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 4]);
    expect(plateOrigin(3, 4, 256, 256)).toEqual([256 * 1.2, -256 * 1.2]);
  });
});
