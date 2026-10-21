import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { Scope, meshBounds, translateMesh } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, buildBin, binTotalHeight } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, baseplateHeight, buildBaseplatePiece } from '../src/lib/geometry/baseplate';
import {
  buildConnectorKey,
  connectorKeySize,
  connectorPocket,
  connectorSites,
  sitesOnPiece,
  type ConnectorSite,
} from '../src/lib/geometry/connectors';
import { computeLayout, DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { makePieces } from '../src/lib/layout/split';
import { DEFAULT_PROJECT, planJob, type MeshSpec } from '../src/lib/project';
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

describe('connectors', () => {
  const layout = computeLayout({ ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 });
  // The split "auto" picks for this drawer: 3 × 2 pieces, seams at x = 87, 297 and y = 146.
  const pieces = makePieces(layout, [0, 87, 297, 510], [0, 146, 376]);
  const bowtie = { ...DEFAULT_BASEPLATE, connector: 'bowtie' as const };
  const sites = connectorSites(layout, pieces, bowtie);

  const toManifold = (mesh: MeshData) =>
    w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

  /** Volume of a whole pocket inside a baseplate of the given height. */
  function pocketVolume(height: number) {
    const s = new Scope();
    try {
      const pocket = connectorPocket(w, s, { x: 0, y: 0, axis: 'x' });
      const slab = s.t(w.Manifold.cube([40, 40, height]).translate([-20, -20, 0]));
      return s.t(pocket.intersect(slab)).volume();
    } finally {
      s.dispose();
    }
  }

  it('puts one key wherever a wall or a solid margin crosses a seam', () => {
    // 2 seams × (2 + 4 walls + front and back margin) + seam y = 146 × (9 walls + left and right margin)
    expect(sites.length).toBe(27);
    const onGrid = (v: number, origin: number) => Math.abs((v - origin) / 42 - Math.round((v - origin) / 42)) < 1e-9;
    const margin = sites.filter((s) =>
      s.axis === 'x' ? s.y < layout.originY || s.y > layout.originY + 8 * 42 : s.x < layout.originX || s.x > layout.originX + 12 * 42,
    );
    expect(margin.length).toBe(6);
    for (const s of sites.filter((x) => !margin.includes(x))) {
      expect(onGrid(s.axis === 'x' ? s.y : s.x, s.axis === 'x' ? layout.originY : layout.originX)).toBe(true);
    }
    expect(connectorSites(layout, pieces, DEFAULT_BASEPLATE)).toEqual([]);
  });

  it('pockets line up: each site is half in one piece and half in the piece across the seam', () => {
    for (const s of sites) {
      const owners = pieces.filter((p) => sitesOnPiece(sites, p).includes(s));
      expect(owners.length).toBe(2);
      const [a, b] = owners;
      if (s.axis === 'x') expect([a.x1, b.x0]).toEqual([s.x, s.x]);
      else expect([a.y1, b.y0]).toEqual([s.y, s.y]);
    }
  });

  it('skips the outside edges when there is no margin to hold a pocket', () => {
    const grid = computeLayout({ ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3 });
    const s = connectorSites(grid, makePieces(grid, [0, 84, 168], [0, 126]), bowtie);
    expect(s).toEqual<ConnectorSite[]>([
      { x: 84, y: 42, axis: 'x' },
      { x: 84, y: 84, axis: 'x' },
    ]);
  });

  it.each([
    { name: 'frame', o: {} },
    { name: 'magnets from bottom', o: { magnets: true, magnetSide: 'bottom' as const } },
    { name: 'screws + chamfer + pad', o: { screws: true, bottomChamfer: 0.6, bottomPad: 1 } },
  ])('$name: seamed piece with pockets is one valid solid, every pocket fully in solid material', ({ o }) => {
    const opts = { ...bowtie, ...o };
    const piece = pieces[1]; // front middle: seams left, right and back
    const mine = sitesOnPiece(connectorSites(layout, pieces, opts), piece);
    expect(mine.length).toBe(10);
    const plain = check(buildBaseplatePiece(w, layout, piece, { ...opts, connector: 'none' }));
    const keyed = check(buildBaseplatePiece(w, layout, piece, opts, mine));
    expect(keyed.status).toBe('NoError');
    expect(keyed.components).toBe(1);
    // Blind pockets: no new holes, and exactly half a pocket's volume gone per site.
    // A pocket that broke into a receptacle or an edge would remove less.
    expect(keyed.genus).toBe(plain.genus);
    expect(plain.volume - keyed.volume).toBeCloseTo((mine.length * pocketVolume(baseplateHeight(opts))) / 2, 2);
  });

  it('the key is one valid solid that fits inside its pocket', () => {
    const mesh = buildConnectorKey(w);
    const c = check(mesh);
    expect(c.status).toBe('NoError');
    expect(c.components).toBe(1);
    expect(c.genus).toBe(0);
    const size = connectorKeySize();
    const b = meshBounds(mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(size.w, 4);
    expect(b.max[1] - b.min[1]).toBeCloseTo(size.d, 4);
    expect(b.max[2] - b.min[2]).toBeCloseTo(size.h, 4);

    // Centered on a site, nothing of the key sticks out of the pocket.
    const s = new Scope();
    try {
      const key = s.t(toManifold(translateMesh(mesh, -size.w / 2, -size.d / 2, 0)));
      const pocket = connectorPocket(w, s, { x: 0, y: 0, axis: 'x' });
      expect(s.t(key.subtract(pocket)).volume()).toBeLessThan(1e-6);
      expect(key.volume()).toBeLessThan(pocketVolume(10));
    } finally {
      s.dispose();
    }
  });

  it('planJob prints one key per pocket', () => {
    const job = planJob({ ...DEFAULT_PROJECT, baseplate: bowtie });
    const placements = job.plates.flatMap((pl) => pl.placements);
    const keys = placements.filter((p) => job.parts[p.key].kind === 'key');
    expect(keys.length).toBe(job.connectors.length);
    expect(keys.length).toBe(27);
    // Every key fills two half pockets, one in each piece of its seam.
    const halves = job.plan.pieces.reduce((n, p) => {
      const spec = job.meshes[job.parts[`piece:${p.id}`].meshKey] as Extract<MeshSpec, { kind: 'piece' }>;
      return n + spec.connectors.length;
    }, 0);
    expect(halves).toBe(2 * keys.length);
    // The keys fit next to the pieces, so connectors don't cost a plate.
    expect(job.plates.length).toBe(planJob(DEFAULT_PROJECT).plates.length);

    const off = planJob(DEFAULT_PROJECT);
    expect(off.connectors).toEqual([]);
    expect(Object.values(off.parts).some((p) => p.kind === 'key')).toBe(false);
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

describe('multi-filament parts', () => {
  const box = (x: number): MeshData => {
    const v = [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0, 0, 0, 5, 10, 0, 5, 10, 20, 5, 0, 20, 5].map((c, i) => (i % 3 === 0 ? c + x : c));
    const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    return { positions: new Float32Array(v), indices: new Uint32Array(t) };
  };
  const withText: MeshData = { ...box(0), overlays: [{ name: 'label', filament: 2, ...box(20) }] };

  it('Bambu project writes overlays as extra parts on filament 2 and grows the filament list', () => {
    const settings = JSON.stringify({
      filament_diameter: ['1.75'],
      filament_colour: ['#00AE42'],
      filament_settings_id: ['Bambu PLA Basic @BBL P2S'],
      nozzle_diameter: ['0.4'],
      different_settings_to_system: ['', '', ''],
    });
    const files = unzipSync(
      writeBambuProject({
        objects: [{ name: 'bin', mesh: withText }],
        plates: [{ name: 'A', parts: [{ object: 0, name: 'bin', transform: placeTransform(10, 10, false, 20) }] }],
        bedW: 256,
        bedD: 256,
        projectSettings: settings,
      }),
    );
    const obj = strFromU8(files['3D/Objects/object_1.model']);
    expect(obj.match(/<object id=/g)?.length).toBe(2);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<component /g)?.length).toBe(2);
    const cfg = strFromU8(files['Metadata/model_settings.config']);
    expect(cfg.match(/<part /g)?.length).toBe(2);
    expect(cfg).toContain('<metadata key="extruder" value="2"/>');
    const ps = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(ps.filament_diameter).toEqual(['1.75', '1.75']);
    expect(ps.filament_colour).toEqual(['#00AE42', '#161616']);
    expect(ps.filament_settings_id).toHaveLength(2);
    expect(ps.nozzle_diameter).toEqual(['0.4']);
    expect(ps.different_settings_to_system).toHaveLength(4);
  });

  it('plain 3MF writes a part and its overlays as one object with a volume each (PrusaSlicer keeps them in place)', () => {
    const files = unzipSync(write3MF([{ name: 'bin', mesh: withText }], [{ object: 0, transform: placeTransform(0, 0, false, 20) }]));
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<object /g)?.length).toBe(1);
    expect(model.match(/<triangle /g)?.length).toBe(24);
    expect(model).toContain('<metadata name="slic3rpe:Version3mf">1</metadata>');
    const cfg = strFromU8(files['Metadata/Slic3r_PE_model.config']);
    expect(cfg).toContain('<volume firstid="0" lastid="11">');
    expect(cfg).toContain('<volume firstid="12" lastid="23">');
    expect(cfg).toContain('key="extruder" value="2"');
  });

  it('translateMesh moves overlays too', () => {
    const m = translateMesh({ ...box(0), overlays: [{ name: 'l', filament: 2, ...box(0) }] }, 5, 0, 0);
    expect(m.overlays![0].positions[0]).toBe(5);
  });
});
