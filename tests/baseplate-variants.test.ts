import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import {
  DEFAULT_BASEPLATE,
  baseplateFloor,
  baseplateHeight,
  buildBaseplatePiece,
  screwPlacement,
  type BaseplateOptions,
  type BaseplateStyle,
} from '../src/lib/geometry/baseplate';
import { connectorSites, lowSideOf, sitesOnPiece, type ConnectorStyle } from '../src/lib/geometry/connectors';
import { textRects, textSize } from '../src/lib/geometry/digits';
import { pieceIsVoid, voidRects } from '../src/lib/geometry/mask';
import { PIECE_NUMBER, PUZZLE_PROTRUSION, SCREW_JOIN, WEIGHTED } from '../src/lib/geometry/spec';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput, type GridLayout } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, planBaseplate } from '../src/lib/layout/plan';
import { makePieces, type PieceDef } from '../src/lib/layout/split';
import { DEFAULT_BIN, DEFAULT_PROJECT, buildMesh, planJob } from '../src/lib/project';
import { billOfMaterials } from '../src/lib/bom';
import { canPlace, onBlocked, withBlocked } from '../src/lib/bins';
import { useStore } from '../src/state/store';

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
});

const toManifold = (mesh: MeshData) =>
  w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));

function check(mesh: MeshData) {
  const m = toManifold(mesh);
  const parts = m.decompose();
  const out = { status: m.status(), components: parts.length, volume: m.volume(), genus: m.genus() };
  parts.forEach((p) => p.delete());
  m.delete();
  return out;
}

const REF: DrawerInput = { ...DEFAULT_DRAWER, width: 510.5, depth: 376.5, clearance: 0.5 };
const plain = (o: Partial<BaseplateOptions> = {}): BaseplateOptions => ({ ...DEFAULT_BASEPLATE, pieceNumbers: false, ...o });

// 3 × 3 split of the reference drawer: xs = 3, 45 … 507; ys = 20, 62 … 356.
const ref = computeLayout(REF);
const refPieces = makePieces(ref, [0, 87, 213, 510], [0, 104, 230, 376]);
const corner = refPieces[0]; // front-left: two outside edges, seams right and back
const interior = refPieces[4]; // 3 × 3 cells, seams on all four sides

// Partial edge cells along the right and back (25.5 mm and 17.5 mm), split 2 × 2.
const fit = computeLayout({ ...REF, width: 320, depth: 270, fill: 'fit', alignX: 0, alignY: 0 });
const fitPlan = planBaseplate(fit, DEFAULT_SETUP);
const partial = fitPlan.pieces.find((p) => p.outer.right && p.outer.back)!;

const CASES: { name: string; layout: GridLayout; piece: PieceDef; pieces: PieceDef[] }[] = [
  { name: 'corner', layout: ref, piece: corner, pieces: refPieces },
  { name: 'interior', layout: ref, piece: interior, pieces: refPieces },
  { name: 'partial cells', layout: fit, piece: partial, pieces: fitPlan.pieces },
];

function build(c: (typeof CASES)[number], o: BaseplateOptions) {
  const sites = sitesOnPiece(connectorSites(c.layout, c.pieces, o), c.piece);
  return { mesh: buildBaseplatePiece(w, c.layout, c.piece, o, sites), sites };
}

describe('test layouts', () => {
  it('have the pieces the variant tests rely on', () => {
    expect([ref.nx, ref.ny]).toEqual([12, 8]);
    expect(interior.outer).toEqual({ left: false, right: false, front: false, back: false });
    expect(corner.outer.left && corner.outer.front).toBe(true);
    const cw = fit.xs.at(-1)! - fit.xs.at(-2)!;
    const cd = fit.ys.at(-1)! - fit.ys.at(-2)!;
    expect(cw).toBeCloseTo(25.5, 6);
    expect(cd).toBeCloseTo(17.5, 6);
    expect(partial.cells.x1).toBe(fit.nx);
    expect(partial.cells.y1).toBe(fit.ny);
    expect(fitPlan.pieces.length).toBeGreaterThan(1);
  });
});

describe('baseplate styles', () => {
  const STYLES: BaseplateStyle[] = ['frame', 'weighted', 'skeletonized', 'solid'];
  const HOLES: [string, Partial<BaseplateOptions>][] = [
    ['no holes', {}],
    ['top magnets + screws', { magnets: true, screws: true }],
    ['bottom magnets + screws', { magnets: true, magnetSide: 'bottom', screws: true }],
  ];
  for (const c of CASES) {
    for (const style of STYLES) {
      it.each(HOLES)(`${style}, ${c.name} piece, %s: one valid solid`, (_, holes) => {
        const o = { ...DEFAULT_BASEPLATE, style, ...holes, bottomChamfer: 0.4 };
        const mesh = buildBaseplatePiece(w, c.layout, c.piece, o);
        const r = check(mesh);
        expect(r.status).toBe('NoError');
        expect(r.components).toBe(1);
        const b = meshBounds(mesh);
        expect(b.max[2]).toBeCloseTo(baseplateHeight(o), 4);
        expect(b.min[0]).toBeCloseTo(c.piece.x0, 4);
        expect(b.max[0]).toBeCloseTo(c.piece.x1, 4);
      });
    }
  }

  it('floors: frame unchanged, solid ≥ 1 mm, weighted 6.4 mm, screw joints 7 mm', () => {
    expect(baseplateFloor(DEFAULT_BASEPLATE)).toBe(0);
    expect(baseplateHeight(DEFAULT_BASEPLATE)).toBeCloseTo(4.6, 6);
    expect(baseplateFloor({ ...DEFAULT_BASEPLATE, magnets: true })).toBeCloseTo(2.8, 6);
    expect(baseplateFloor({ ...DEFAULT_BASEPLATE, style: 'solid' })).toBe(1);
    expect(baseplateFloor({ ...DEFAULT_BASEPLATE, style: 'weighted' })).toBe(WEIGHTED.floor);
    expect(baseplateFloor({ ...DEFAULT_BASEPLATE, style: 'weighted', bottomPad: 1 })).toBeCloseTo(7.4, 6);
    expect(baseplateFloor({ ...DEFAULT_BASEPLATE, connector: 'screw' })).toBe(SCREW_JOIN.floor);
    // Corner screws under top magnets need room for both.
    const skel = { ...DEFAULT_BASEPLATE, style: 'skeletonized' as const, magnets: true, screws: true };
    expect(screwPlacement(skel)).toBe('corner');
    expect(baseplateFloor(skel)).toBeGreaterThan(2.2 + 1.35);
    expect(screwPlacement({ ...skel, magnetSide: 'bottom' })).toBe('none');
    expect(screwPlacement({ ...DEFAULT_BASEPLATE, style: 'solid', screws: true })).toBe('center');
  });

  it('weighted: one pocket and four channels under each full cell, blind', () => {
    const solidW = { ...plain({ style: 'solid' as const }), bottomPad: WEIGHTED.floor - 1 };
    const weighted = plain({ style: 'weighted' });
    expect(baseplateFloor(solidW)).toBe(baseplateFloor(weighted));
    const a = check(buildBaseplatePiece(w, ref, interior, solidW));
    const b = check(buildBaseplatePiece(w, ref, interior, weighted));
    const cells = (interior.cells.x1 - interior.cells.x0) * (interior.cells.y1 - interior.cells.y0);
    const pocket = WEIGHTED.pocket ** 2 * WEIGHTED.pocketDepth;
    // Channels: the part outside the pocket is a 8.5 mm wide stadium end, 2 mm deep.
    const r = WEIGHTED.channelWidth / 2;
    const reach = WEIGHTED.channelAt + WEIGHTED.channelLength / 2;
    const channel = (WEIGHTED.channelWidth * (reach - WEIGHTED.pocket / 2) + (Math.PI * r * r) / 2) * WEIGHTED.channelDepth;
    expect(b.genus).toBe(a.genus);
    expect((a.volume - b.volume) / cells).toBeCloseTo(pocket + 4 * channel, -1);
  });

  it('weighted skips pockets in cells too small for them', () => {
    const o = plain({ style: 'weighted' });
    const r = check(buildBaseplatePiece(w, fit, partial, o));
    expect(r.status).toBe('NoError');
    const full = (partial.cells.x1 - partial.cells.x0 - 1) * (partial.cells.y1 - partial.cells.y0 - 1);
    const solid = check(buildBaseplatePiece(w, fit, partial, { ...plain({ style: 'solid' }), bottomPad: WEIGHTED.floor - 1 }));
    // Only full cells (and the 25.5 mm column, which holds a pocket but no channels) lose material.
    const perCell = (solid.volume - r.volume) / full;
    expect(perCell).toBeGreaterThan(WEIGHTED.pocket ** 2 * WEIGHTED.pocketDepth);
  });

  it('skeletonized: one through-cut per cell, more material than the frame', () => {
    const cells = (interior.cells.x1 - interior.cells.x0) * (interior.cells.y1 - interior.cells.y0);
    const skel = check(buildBaseplatePiece(w, ref, interior, plain({ style: 'skeletonized', magnets: true })));
    const frame = check(buildBaseplatePiece(w, ref, interior, plain({ style: 'frame' })));
    const solid = check(buildBaseplatePiece(w, ref, interior, plain({ style: 'solid', magnets: true })));
    expect(skel.genus).toBe(cells);
    expect(skel.volume).toBeGreaterThan(frame.volume);
    expect(skel.volume).toBeLessThan(solid.volume);
  });
});

describe('magnet pocket options', () => {
  const EXTRAS: [string, Partial<BaseplateOptions>][] = [
    ['crush ribs', { magnetRibs: true }],
    ['chamfer', { magnetChamfer: true }],
    ['pry slot', { magnetSlot: true }],
    ['everything, top', { magnetRibs: true, magnetChamfer: true, magnetSlot: true, magnetRelease: true }],
    ['everything, bottom', { magnetSide: 'bottom', magnetRibs: true, magnetChamfer: true, magnetSlot: true }],
  ];
  for (const c of CASES) {
    it.each(EXTRAS)(`${c.name} piece, %s: one valid solid`, (name, extra) => {
      // Alternate styles so the extras meet the frame floor and the skeleton bosses.
      const style = EXTRAS.findIndex((e) => e[0] === name) % 2 ? 'skeletonized' : 'frame';
      const r = check(build(c, plain({ style, magnets: true, screws: style === 'skeletonized', ...extra })).mesh);
      expect(r.status).toBe('NoError');
      expect(r.components).toBe(1);
    });
  }

  it('each option removes a little more material, and the ribs leave some', () => {
    const vol = (o: Partial<BaseplateOptions>) => check(buildBaseplatePiece(w, ref, interior, plain({ magnets: true, ...o }))).volume;
    const base = vol({});
    expect(vol({ magnetChamfer: true })).toBeLessThan(base);
    expect(vol({ magnetSlot: true })).toBeLessThan(base);
    // Ribs: tips inside the magnet radius, roots outside it.
    const ribs = vol({ magnetRibs: true, magnetFit: 0 });
    const tight = vol({ magnetFit: -0.1 });
    const loose = vol({ magnetFit: 0.5 });
    expect(ribs).toBeLessThan(tight);
    expect(ribs).toBeGreaterThan(loose);
  });
});

describe('joints', () => {
  const STYLES: ConnectorStyle[] = ['bowtie', 'pin', 'puzzle', 'screw'];
  const BASES = ['frame', 'weighted', 'skeletonized', 'solid'] as const;
  for (const c of CASES) {
    for (const [k, connector] of STYLES.entries()) {
      const styles = ['frame', BASES[1 + ((k + CASES.indexOf(c)) % 3)]] as const;
      it.each(styles)(`${connector} on the ${c.name} piece (%s): one valid solid with joints`, (style) => {
        const o = { ...DEFAULT_BASEPLATE, style, connector, magnets: style !== 'frame' };
        const { mesh, sites } = build(c, o);
        expect(sites.length).toBeGreaterThan(0);
        const r = check(mesh);
        expect(r.status).toBe('NoError');
        expect(r.components).toBe(1);
      });
    }
  }

  it('pins: one blind hole per site, on the wall lines inside the grid', () => {
    const pins = connectorSites(ref, refPieces, plain({ connector: 'pin' }));
    expect(pins.length).toBeGreaterThan(20);
    for (const p of pins) {
      const v = p.axis === 'x' ? p.y : p.x;
      const bounds = p.axis === 'x' ? ref.ys : ref.xs;
      if (v < bounds[0] || v > bounds.at(-1)!) continue; // in a margin
      expect(Math.min(...bounds.map((b) => Math.abs(b - v)))).toBeLessThan(0.1);
    }
    const o = plain({ connector: 'pin' });
    const mine = sitesOnPiece(pins, interior);
    const with_ = check(buildBaseplatePiece(w, ref, interior, o, mine));
    const without = check(buildBaseplatePiece(w, ref, interior, o, []));
    expect(with_.genus).toBe(without.genus);
    expect(with_.volume).toBeLessThan(without.volume);
  });

  it('puzzle: tabs stick out of the left / front piece and fit the sockets without touching', () => {
    const o = plain({ connector: 'puzzle' });
    const sites = connectorSites(ref, refPieces, o);
    const meshOf = (p: PieceDef) => toManifold(buildBaseplatePiece(w, ref, p, o, sitesOnPiece(sites, p)));
    const a = meshOf(corner);
    const right = refPieces[1];
    const back = refPieces[3];
    const ba = a.boundingBox();
    expect(ba.max[0]).toBeCloseTo(corner.x1 + PUZZLE_PROTRUSION, 3);
    expect(ba.max[1]).toBeCloseTo(corner.y1 + PUZZLE_PROTRUSION, 3);
    expect(ba.min[0]).toBeCloseTo(corner.x0, 4);
    const touching = (m: Manifold, n: Manifold) => {
      const both = m.intersect(n);
      const v = both.volume();
      both.delete();
      return v;
    };
    for (const p of [right, back]) {
      const b = meshOf(p);
      expect(touching(a, b)).toBeLessThan(1e-6);
      // Every tab is inside the neighbor's outline: it sits in a socket.
      const slab = w.Manifold.cube([p.x1 - p.x0, p.y1 - p.y0, 20]).translate([p.x0, p.y0, -1]);
      const inNeighbor = a.intersect(slab);
      const lowSites = sites.filter((s) => lowSideOf(s, corner) && sitesOnPiece(sites, p).includes(s)).length;
      expect(lowSites).toBeGreaterThan(0);
      expect(inNeighbor.volume() / lowSites).toBeGreaterThan(5);
      inNeighbor.delete();
      slab.delete();
      b.delete();
    }
    a.delete();
  });

  it('puzzle: pieces are packed by their footprint with the tabs', () => {
    const job = planJob({ ...DEFAULT_PROJECT, baseplate: plain({ connector: 'puzzle' }), include: { baseplate: true, bins: false } });
    for (const p of job.plan.pieces) {
      const part = job.parts[`piece:${p.id}`];
      expect(part.w).toBeCloseTo(p.x1 - p.x0 + (p.outer.right ? 0 : PUZZLE_PROTRUSION), 6);
      expect(part.d).toBeCloseTo(p.y1 - p.y0 + (p.outer.back ? 0 : PUZZLE_PROTRUSION), 6);
    }
    const { bedW, bedD, plateMargin } = DEFAULT_SETUP;
    for (const pl of job.plates) {
      const rects = pl.placements.map((pp) => {
        const part = job.parts[pp.key];
        const [ww, dd] = pp.rotated ? [part.d, part.w] : [part.w, part.d];
        return { x0: pp.x, y0: pp.y, x1: pp.x + ww, y1: pp.y + dd };
      });
      for (const r of rects) {
        expect(r.x0).toBeGreaterThanOrEqual(plateMargin - 1e-6);
        expect(r.x1).toBeLessThanOrEqual(bedW - plateMargin + 1e-6);
        expect(r.y1).toBeLessThanOrEqual(bedD - plateMargin + 1e-6);
      }
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const [p, q] = [rects[i], rects[j]];
          expect(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1).toBe(false);
        }
    }
    // The mesh footprint matches the part size.
    const spec = job.meshes[job.parts['piece:1'].meshKey];
    const b = meshBounds(buildMesh(w, spec));
    expect(b.min[0]).toBeCloseTo(0, 4);
    expect(b.max[0]).toBeCloseTo(job.parts['piece:1'].w, 3);
    expect(b.max[1]).toBeCloseTo(job.parts['piece:1'].d, 3);
  });

  it('screws: the head slot goes into the deeper piece, the floor rises, nothing prints extra', () => {
    const o = plain({ connector: 'screw' });
    const sites = connectorSites(ref, refPieces, o);
    expect(sites.length).toBeGreaterThan(0);
    // The x = 87 seam: 87 mm piece on the left, 210 mm on the right, so the head goes right.
    const seam = sites.filter((s) => s.axis === 'x' && Math.abs(s.x - 87) < 1e-6);
    expect(seam.length).toBeGreaterThan(0);
    for (const s of seam) expect(s.flip).toBe(true);
    const job = planJob({ ...DEFAULT_PROJECT, baseplate: o });
    expect(job.connectors).toEqual([]);
    expect(job.sites.length).toBe(connectorSites(job.layout, job.plan.pieces, o).length);
    expect(Object.values(job.parts).some((p) => p.kind === 'key')).toBe(false);
    expect(job.parts['piece:1'].h).toBeCloseTo(SCREW_JOIN.floor + 0.35 + 4.65 - 0.4, 6);
    const bom = billOfMaterials(job);
    const count = (re: RegExp) => bom.hardware.filter((h) => re.test(h.item)).reduce((t, h) => t + h.count, 0);
    expect(count(/socket head screws \(joints\)/)).toBe(job.sites.length);
    expect(count(/hex nuts/)).toBe(job.sites.length);
    const ins = billOfMaterials(planJob({ ...DEFAULT_PROJECT, baseplate: { ...o, screwFastener: 'insert' } }));
    expect(ins.hardware.some((h) => /inserts/.test(h.item))).toBe(true);
    const pins = planJob({ ...DEFAULT_PROJECT, baseplate: plain({ connector: 'pin' }) });
    expect(billOfMaterials(pins).hardware.find((h) => /Filament pins/.test(h.item))?.count).toBe(pins.sites.length);
  });
});

describe('piece numbers', () => {
  const deboss = (o: BaseplateOptions, layout: GridLayout, piece: PieceDef, sites: ReturnType<typeof connectorSites> = []) => {
    const on = toManifold(buildBaseplatePiece(w, layout, piece, { ...o, pieceNumbers: true }, sites));
    const off = toManifold(buildBaseplatePiece(w, layout, piece, { ...o, pieceNumbers: false }, sites));
    const cut = off.subtract(on);
    const out = { status: on.status(), components: on.decompose().length, cut };
    on.delete();
    off.delete();
    return out;
  };
  /** Area of the union of a text's glyph boxes (via a 2D boolean). */
  const textArea = (text: string, h: number) => {
    const polys = textRects(text, h, h / 6).map((r) => [
      [r.x0, r.y0],
      [r.x1, r.y0],
      [r.x1, r.y1],
      [r.x0, r.y1],
    ]) as [number, number][][];
    const cs = new w.CrossSection(polys, 'Positive');
    const a = cs.area();
    cs.delete();
    return a;
  };

  it('is on by default', () => expect(DEFAULT_BASEPLATE.pieceNumbers).toBe(true));

  it.each(CASES.map((c) => [c.name, c] as const))('%s piece: fully debossed in solid material, for every style', (_, c) => {
    {
      for (const style of ['frame', 'weighted', 'skeletonized', 'solid'] as const) {
        for (const connector of style === 'frame' ? (['none', 'screw'] as const) : (['none'] as const)) {
          // Bottom magnets (keep-outs) on the skeleton; open walls on the bare frame; floors on the rest.
          const o = plain({ style, connector, magnets: style === 'skeletonized', magnetSide: 'bottom' });
          const sites = sitesOnPiece(connectorSites(c.layout, c.pieces, o), c.piece);
          const d = deboss(o, c.layout, c.piece, sites);
          expect(d.status).toBe('NoError');
          expect(d.components).toBe(1);
          const v = d.cut.volume();
          // One of the sizes, fully cut (no breakout into an opening).
          const fits = PIECE_NUMBER.heights.some((h) => Math.abs(v - textArea(String(c.piece.id), h) * PIECE_NUMBER.depth) < 1e-3);
          expect(fits, `${c.name} ${style} ${connector}: ${v}`).toBe(true);
          d.cut.delete();
        }
      }
    }
  });

  it('is mirrored, so it reads with the piece flipped over', () => {
    // Piece 2's number sits in the front margin, horizontal. A "2" has its upper stroke on the
    // right (segment b) and its lower stroke on the left (segment e); mirrored, they swap sides.
    const piece = refPieces[1];
    const d = deboss(plain(), ref, piece);
    // Clip to the front margin, under 1 mm: the boolean difference also holds zero-volume slivers.
    const margin = w.Manifold.cube([piece.x1 - piece.x0, ref.ys[0], 2]).translate([piece.x0, 0, -1]);
    const inMargin = d.cut.intersect(margin);
    expect(inMargin.volume()).toBeCloseTo(d.cut.volume(), 3);
    d.cut.delete();
    d.cut = inMargin;
    margin.delete();
    const b = d.cut.boundingBox();
    const quad = (x0: number, x1: number, y0: number, y1: number) => {
      const box = w.Manifold.cube([x1 - x0, y1 - y0, 10]).translate([x0, y0, -5]);
      const part = d.cut.intersect(box);
      const v = part.volume();
      part.delete();
      box.delete();
      return v;
    };
    const mx = (b.min[0] + b.max[0]) / 2;
    const my = (b.min[1] + b.max[1]) / 2;
    const upperLeft = quad(b.min[0], mx, my + 0.5, b.max[1]);
    const upperRight = quad(mx, b.max[0], my + 0.5, b.max[1]);
    expect(upperLeft).toBeGreaterThan(upperRight);
    d.cut.delete();
  });

  it('digits: sizes and glyph boxes', () => {
    expect(textSize('12', 6, 1).w).toBeCloseTo(2 * 3.3 + 1.3, 6);
    expect(textRects('8', 6, 1)).toHaveLength(7);
    expect(textRects('1', 6, 1)).toHaveLength(2);
    for (const r of textRects('0123456789', 6, 1)) {
      expect(r.x1).toBeGreaterThan(r.x0);
      expect(r.y0).toBeGreaterThanOrEqual(0);
      expect(r.y1).toBeLessThanOrEqual(6);
    }
  });
});

describe('blocked cells', () => {
  const masked = (mask: string[], maskStyle: 'solid' | 'void') => computeLayout({ ...REF, mask, maskStyle });

  it('only cells inside the grid count, and the layout is unchanged without any', () => {
    expect(computeLayout({ ...REF, mask: [] })).toEqual(ref);
    const l = masked(['1,1', '99,1', 'x', '1,1', '0,7'], 'void');
    expect(l.mask).toEqual(['0,7', '1,1']);
    expect(l.maskStyle).toBe('void');
  });

  it('solid: the cell is filled flat, no receptacle', () => {
    const l = masked(['3,3', '4,3'], 'solid');
    const cells = (interior.cells.x1 - interior.cells.x0) * (interior.cells.y1 - interior.cells.y0);
    for (const style of ['frame', 'weighted', 'skeletonized'] as const) {
      const r = check(buildBaseplatePiece(w, l, interior, plain({ style, magnets: style !== 'frame' })));
      expect(r.status).toBe('NoError');
      expect(r.components).toBe(1);
      expect(r.genus).toBe(style === 'weighted' ? 0 : cells - 2);
    }
  });

  it('void: cut out, out to the plate edge on the grid edge; joints stay clear', () => {
    const l = masked(['0,0', '4,4'], 'void');
    expect(voidRects(l)[0]).toEqual({ x0: -1, x1: l.xs[1], y0: -1, y1: l.ys[1] });
    for (const c of [corner, interior]) {
      for (const connector of ['bowtie', 'pin', 'puzzle', 'screw'] as const) {
        const o = plain({ connector });
        const all = connectorSites(l, refPieces, o);
        const mine = sitesOnPiece(all, c);
        expect(all.length).toBeLessThanOrEqual(connectorSites(ref, refPieces, o).length);
        const r = check(buildBaseplatePiece(w, l, c, { ...o, pieceNumbers: true }, mine));
        expect(r.status).toBe('NoError');
        expect(r.components).toBe(1);
      }
    }
    // The corner piece lost its front-left corner cell and the margin around it.
    const a = check(buildBaseplatePiece(w, ref, corner, plain()));
    const b = check(buildBaseplatePiece(w, l, corner, plain()));
    expect(b.volume).toBeLessThan(a.volume);
    expect(b.genus).toBe(a.genus - 1);
  });

  it('a piece that is all void is left out of the print', () => {
    const grid = { ...DEFAULT_DRAWER, mode: 'grid' as const, gridX: 6, gridY: 2 };
    const setup = { ...DEFAULT_SETUP, bedW: 180, bedD: 180 };
    const all = planBaseplate(computeLayout(grid), setup);
    expect(all.pieces.length).toBe(2);
    const right = all.pieces.find((p) => p.outer.right)!;
    const mask: string[] = [];
    for (let i = right.cells.x0; i < right.cells.x1; i++) for (let j = 0; j < 2; j++) mask.push(`${i},${j}`);
    const l = computeLayout({ ...grid, mask, maskStyle: 'void' });
    expect(pieceIsVoid(l, right)).toBe(true);
    expect(pieceIsVoid(l, all.pieces.find((p) => p.outer.left)!)).toBe(false);
    const job = planJob({ ...DEFAULT_PROJECT, drawer: { ...grid, mask, maskStyle: 'void' }, setup });
    expect(job.plan.pieces.map((p) => p.id)).toEqual([all.pieces.find((p) => p.outer.left)!.id]);
    for (const pl of job.plates) for (const p of pl.placements) expect(job.parts[p.key]).toBeDefined();
  });

  it('bins can’t go on blocked cells', () => {
    const mask = ['2,1'];
    expect(canPlace([], { x: 1, y: 1, w: 2, d: 1 }, 12, 8)).toBe(true);
    expect(canPlace(withBlocked([], mask), { x: 1, y: 1, w: 2, d: 1 }, 12, 8)).toBe(false);
    expect(canPlace(withBlocked([], mask), { x: 3, y: 1, w: 2, d: 1 }, 12, 8)).toBe(true);
    expect(onBlocked({ id: 'a', x: 2, y: 0, opts: { ...DEFAULT_BIN, unitsY: 2 } }, mask)).toBe(true);
  });

  describe('store', () => {
    const s = () => useStore.getState();
    beforeEach(() => s().resetAll());

    it('fill and duplicate skip blocked cells; files are sanitized', () => {
      s().setDrawer({ mode: 'grid', gridX: 3, gridY: 2, mask: ['0,0', '2,1'] });
      expect(s().fillEmpty()).toBe(4);
      expect(s().bins.some((b) => onBlocked(b, ['0,0', '2,1']))).toBe(false);
      s().loadProject({ app: 'gridfit', drawer: { width: 400, depth: 300, mask: ['1,2', 5, '1,2', 'nope'], maskStyle: 'weird' } });
      expect(s().drawer.mask).toEqual(['1,2']);
      expect(s().drawer.maskStyle).toBe('solid');
    });
  });

  it('bill of materials skips blocked cells', () => {
    const o = { ...DEFAULT_BASEPLATE, magnets: true };
    const a = billOfMaterials(planJob({ ...DEFAULT_PROJECT, baseplate: o }));
    const b = billOfMaterials(planJob({ ...DEFAULT_PROJECT, baseplate: o, drawer: { ...DEFAULT_PROJECT.drawer, mask: ['3,3', '4,4'] } }));
    const mags = (x: typeof a) => x.hardware.filter((h) => /Magnets.*baseplate/.test(h.item)).reduce((t, h) => t + h.count, 0);
    expect(mags(a) - mags(b)).toBe(8);
    const skel = billOfMaterials(planJob({ ...DEFAULT_PROJECT, baseplate: { ...o, style: 'skeletonized', screws: true } }));
    const screws = skel.hardware.find((h) => /countersunk/.test(h.item))!;
    expect(screws.count).toBe(mags(a));
  });
});
