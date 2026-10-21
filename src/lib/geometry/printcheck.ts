/**
 * Print checks on a finished mesh, the way a slicer would see it:
 *
 * - a valid closed solid: finite, not empty, every edge shared by exactly two
 *   triangles running opposite ways;
 * - one piece: extra bodies are reported with their volume and place;
 * - flat on the bed: lowest point at z = 0, a first layer that grips;
 * - no islands that start in mid-air (a region with nothing under it), and
 *   no flat ledges or long bridges hanging off the part;
 * - inside the printer (bedfit.ts);
 * - no walls or ribs thinner than two 0.4 mm lines.
 *
 * Nothing here changes a mesh or keeps state: `meshTopology` is plain
 * TypeScript, the slice checks read the mesh through Manifold's slicer.
 * scripts/sampler.ts runs them over every kind of part (docs/print-check.md);
 * tests/printcheck.test.ts over a subset.
 */
import type { CrossSection } from 'manifold-3d';
import { Scope, type Bounds3, type MeshData, type Wasm } from './kernel';
import { partOvershoot, type Bed } from '../bedfit';

export type PrintIssueKind = 'empty' | 'finite' | 'manifold' | 'pieces' | 'bed-z' | 'contact' | 'island' | 'overhang' | 'thin' | 'bed-fit' | 'overlay';

export interface PrintIssue {
  kind: PrintIssueKind;
  /** Errors make a bad print (or none); warnings are worth a look. */
  severity: 'error' | 'warning';
  message: string;
  /** Where, in the mesh's own coordinates (mm). */
  at?: [number, number, number];
}

export interface MeshComponent {
  triangles: number;
  /** mm³ (negative when it is inside out). */
  volume: number;
  bounds: Bounds3;
}

export interface MeshTopology {
  triangles: number;
  vertices: number;
  /** Every coordinate is a finite number. */
  finite: boolean;
  /** Edges with one triangle only (holes in the surface). */
  openEdges: number;
  /** Edges shared by more than two triangles, or by two running the same way. */
  badEdges: number;
  /** Triangles with (next to) no area. */
  degenerate: number;
  volume: number;
  bounds: Bounds3;
  /** Edge-connected bodies, largest first. */
  components: MeshComponent[];
}

/** Topology of a triangle mesh: closedness, orientation and bodies. Plain TS, no WASM. */
export function meshTopology(mesh: Pick<MeshData, 'positions' | 'indices'>): MeshTopology {
  const p = mesh.positions;
  const t = mesh.indices;
  const nv = p.length / 3;
  const nt = t.length / 3;
  let finite = true;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) finite = false;

  // Directed edges: a closed, consistently oriented surface uses each once, and its reverse once.
  const directed = new Map<number, number>();
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const firstTri = new Map<number, number>();
  let degenerate = 0;
  for (let f = 0; f < nt; f++) {
    const v = [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]];
    if (triArea(p, v[0], v[1], v[2]) < 1e-9) degenerate++;
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      const key = a * nv + b;
      directed.set(key, (directed.get(key) ?? 0) + 1);
      const u = Math.min(a, b) * nv + Math.max(a, b);
      const g = firstTri.get(u);
      if (g === undefined) firstTri.set(u, f);
      else parent[find(f)] = find(g);
    }
  }
  let openEdges = 0;
  let badEdges = 0;
  for (const [key, n] of directed) {
    const a = Math.floor(key / nv);
    const b = key - a * nv;
    const back = directed.get(b * nv + a) ?? 0;
    if (n > 1) badEdges++;
    else if (back === 0) openEdges++;
  }

  const byRoot = new Map<number, MeshComponent>();
  for (let f = 0; f < nt; f++) {
    const r = find(f);
    let c = byRoot.get(r);
    if (!c) {
      c = { triangles: 0, volume: 0, bounds: emptyBounds() };
      byRoot.set(r, c);
    }
    c.triangles++;
    const a = t[f * 3] * 3;
    const b = t[f * 3 + 1] * 3;
    const d = t[f * 3 + 2] * 3;
    c.volume +=
      (p[a] * (p[b + 1] * p[d + 2] - p[b + 2] * p[d + 1]) -
        p[a + 1] * (p[b] * p[d + 2] - p[b + 2] * p[d]) +
        p[a + 2] * (p[b] * p[d + 1] - p[b + 1] * p[d])) /
      6;
    for (const i of [a, b, d]) grow(c.bounds, p[i], p[i + 1], p[i + 2]);
  }
  const components = [...byRoot.values()].sort((x, y) => y.volume - x.volume);
  const bounds = emptyBounds();
  for (let i = 0; i < p.length; i += 3) grow(bounds, p[i], p[i + 1], p[i + 2]);
  return {
    triangles: nt,
    vertices: nv,
    finite,
    openEdges,
    badEdges,
    degenerate,
    volume: components.reduce((s, c) => s + c.volume, 0),
    bounds,
    components,
  };
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

export interface SliceOptions {
  /** Layer height and first-layer height, mm. */
  layer?: number;
  firstLayer?: number;
  /** Thinnest wall that prints as two lines, mm. */
  minWidth?: number;
  /** Thin regions that last fewer mm than this up the part are tapering edges (a chamfer's tip), not walls. */
  minThinRun?: number;
  /** Thin regions smaller than this in a layer are corners and noise, mm². */
  minThinArea?: number;
  /** Islands smaller than this are noise, mm². */
  minIslandArea?: number;
  /** Shallowest wall (degrees from horizontal) that prints without support. */
  overhangAngle?: number;
  /** Overhangs smaller than this in a layer are noise (a letter's edge, a chamfer's tip), mm². */
  minOverhangArea?: number;
  /** Farthest a ledge held along one edge, or a bridge held between edges, may reach from its support, mm. */
  maxLedgeReach?: number;
  maxBridgeReach?: number;
}

const SLICE_DEFAULTS: Required<SliceOptions> = {
  layer: 0.2,
  firstLayer: 0.2,
  minWidth: 0.8,
  minThinRun: 1,
  minThinArea: 0.4,
  minIslandArea: 0.05,
  overhangAngle: 30,
  minOverhangArea: 2,
  maxLedgeReach: 3,
  // A 60 mm bridge, as long as containers/drawers.ts lets a shelf span.
  maxBridgeReach: 30,
};

export interface SliceIsland {
  /** Height of the layer it starts in. */
  z: number;
  area: number;
  /** Center of its bounding box. */
  at: [number, number];
}

/** A flat overhang: part of a layer with nothing under it, held by the part beside it. */
export interface SliceOverhang {
  z: number;
  area: number;
  at: [number, number];
  /** How far it reaches from what holds it, mm (half the span of a bridge). */
  reach: number;
  /** Held between edges (a bridge) rather than along one (a ledge). */
  bridge: boolean;
}

export interface ThinRegion {
  z0: number;
  z1: number;
  /** Center of the region's footprint, and its size. */
  at: [number, number];
  size: [number, number];
  /** About how thick it is (the thinnest layer's), mm. */
  width: number;
}

export interface SliceReport {
  layers: number;
  /** Area of the first layer, mm², and how many separate patches it has. */
  contact: number;
  contactPatches: number;
  islands: SliceIsland[];
  /** Ledges and bridges that reach too far (maxLedgeReach, maxBridgeReach). */
  overhangs: SliceOverhang[];
  thin: ThinRegion[];
}

/**
 * Slice the mesh like a slicer does (the middle of every layer) and look at
 * each layer against the one below: islands that start in mid-air, flat
 * overhangs that reach too far from what holds them, and regions narrower
 * than `minWidth` that last at least `minThinRun` up the part.
 */
export function sliceReport(w: Wasm, mesh: Pick<MeshData, 'positions' | 'indices'>, options: SliceOptions = {}): SliceReport {
  const o = { ...SLICE_DEFAULTS, ...options };
  const m = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  const scope = new Scope();
  const keep = <T extends { delete(): void }>(x: T): T => scope.t(x);
  keep(m);
  try {
    const box = m.boundingBox();
    const zMin = box.min[2];
    const zMax = box.max[2];
    // A hair off the middle of each layer, so faces at round heights never sit on a slice plane.
    const heights = [zMin + o.firstLayer / 2 + 1.3e-4];
    for (let z = zMin + o.firstLayer + o.layer / 2 + 1.3e-4; z < zMax; z += o.layer) heights.push(z);
    const islands: SliceIsland[] = [];
    const overhangs: SliceOverhang[] = [];
    let below: CrossSection | null = null;
    let contact = 0;
    let contactPatches = 0;
    // A hair under half the width, so a wall of exactly minWidth passes.
    const r = o.minWidth / 2 - 0.01;
    // Thin pieces per layer, linked up the part into regions.
    type Open = { z0: number; z1: number; x0: number; y0: number; x1: number; y1: number; width: number; seen: number };
    const open: Open[] = [];
    const done: Open[] = [];
    heights.forEach((z, k) => {
      const s = keep(m.slice(z));
      if (k === 0) {
        contact = s.area();
        contactPatches = s.isEmpty() ? 0 : s.decompose().map(keep).length;
      } else if (below) {
        // Only layers that reach past the one below can hold a new island or overhang.
        const fresh = keep(s.subtract(below));
        if (fresh.area() > o.minIslandArea) {
          const floating: CrossSection[] = [];
          for (const part of s.decompose().map(keep)) {
            const a = part.area();
            if (a < o.minIslandArea) continue;
            if (keep(part.intersect(below)).area() > 1e-4) continue;
            floating.push(part);
            islands.push({ z: r3(z), area: r3(a), at: center2(part) });
          }
          overhangs.push(...layerOverhangs(w, keep, s, below, floating, z, o));
        }
      }
      below = s;
      if (s.isEmpty()) return;
      // Opening (erode, then grow back) keeps whatever is at least minWidth wide; the rest is too thin for two lines.
      const opened = keep(keep(keep(s.offset(-r, 'Round')).offset(r + 0.02, 'Round')));
      const thin = keep(s.subtract(opened));
      if (thin.area() < o.minThinArea) return;
      for (const piece of thin.decompose().map(keep)) {
        const a = piece.area();
        if (a < o.minThinArea) continue;
        const b = piece.bounds();
        const width = thinWidth(w, keep, s, piece, r);
        const hit = open.find((q) => q.seen === k - 1 && q.x0 <= b.max[0] && b.min[0] <= q.x1 && q.y0 <= b.max[1] && b.min[1] <= q.y1);
        if (hit) {
          hit.z1 = z;
          hit.seen = k;
          hit.x0 = Math.min(hit.x0, b.min[0]);
          hit.y0 = Math.min(hit.y0, b.min[1]);
          hit.x1 = Math.max(hit.x1, b.max[0]);
          hit.y1 = Math.max(hit.y1, b.max[1]);
          hit.width = Math.min(hit.width, width);
        } else open.push({ z0: z, z1: z, x0: b.min[0], y0: b.min[1], x1: b.max[0], y1: b.max[1], width, seen: k });
      }
      for (let i = open.length - 1; i >= 0; i--) if (open[i].seen < k) done.push(...open.splice(i, 1));
    });
    done.push(...open);
    const thin = done
      .filter((q) => q.z1 - q.z0 + o.layer >= o.minThinRun - 1e-6)
      .map((q) => ({
        z0: r3(q.z0),
        z1: r3(q.z1),
        at: [r3((q.x0 + q.x1) / 2), r3((q.y0 + q.y1) / 2)] as [number, number],
        size: [r3(q.x1 - q.x0), r3(q.y1 - q.y0)] as [number, number],
        width: r3(q.width),
      }));
    return { layers: heights.length, contact: r3(contact), contactPatches, islands, overhangs, thin };
  } finally {
    scope.dispose();
  }
}

/**
 * What a layer puts down past the one below by more than a self-supporting
 * slope allows, outside islands: each piece, held along one edge (a ledge) or
 * between edges (a bridge), with how far it reaches from what holds it.
 */
function layerOverhangs(
  w: Wasm,
  keep: <T extends { delete(): void }>(x: T) => T,
  s: CrossSection,
  below: CrossSection,
  floating: CrossSection[],
  z: number,
  o: Required<SliceOptions>,
): SliceOverhang[] {
  const supported = keep(below.offset(o.layer / Math.tan((o.overhangAngle * Math.PI) / 180), 'Round'));
  let hang = keep(s.subtract(supported));
  if (floating.length) hang = keep(hang.subtract(keep(w.CrossSection.union(floating))));
  if (hang.area() < o.minOverhangArea) return [];
  const out: SliceOverhang[] = [];
  const band = 0.1;
  for (const piece of hang.decompose().map(keep)) {
    const area = piece.area();
    if (area < o.minOverhangArea) continue;
    // The supported edge it hangs from: separate stretches of it, and how much of its outline they cover.
    const anchor = keep(keep(piece.offset(band, 'Round')).intersect(supported));
    const held = anchor.area() / band / Math.max(1e-6, perimeter(piece));
    // A bridge: held in two places (stretches at least 0.1 mm long), or along more than half its outline
    // (three sides of a rectangle; a ledge held along one side never is).
    const bridge = anchor.decompose().map(keep).filter((a) => a.area() > band * 0.1).length > 1 || held > 0.5;
    // Reach: how far the anchor has to grow to cover the piece.
    const b = piece.bounds();
    let lo = 0;
    let hi = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) + band;
    if (anchor.isEmpty()) lo = hi;
    for (let i = 0; i < 12 && hi - lo > 0.05; i++) {
      const t = (lo + hi) / 2;
      if (keep(piece.subtract(keep(anchor.offset(t, 'Round')))).area() > 0.01) lo = t;
      else hi = t;
    }
    const reach = hi;
    if (reach > (bridge ? o.maxBridgeReach : o.maxLedgeReach)) out.push({ z: r3(z), area: r3(area), at: center2(piece), reach: r3(reach), bridge });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Whole part
// ---------------------------------------------------------------------------

export interface PartCheckOptions extends SliceOptions {
  /** Bodies the part is meant to be (1 unless it is several by design). */
  pieces?: number;
  /** The printer (bedfit.ts usableBed); no fit check without it. */
  bed?: Bed;
  /** Skip the slices (topology, bed and fit only). */
  noSlices?: boolean;
  /** Extra volumes smaller than this are noise, mm³ (none are expected at all). */
  minPieceVolume?: number;
}

export interface PartCheck {
  /** No errors. */
  ok: boolean;
  issues: PrintIssue[];
  topology: MeshTopology;
  /** Of the part with its overlays (they print together). */
  slices?: SliceReport;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmtAt = (a: readonly number[]) => `(${a.map(r1).join(', ')})`;

/**
 * Every check on one printed part, in its print orientation. Overlays (inlaid
 * text, shadow floors) are checked with the body they sit on.
 */
export function checkPart(w: Wasm, mesh: MeshData, options: PartCheckOptions = {}): PartCheck {
  const issues: PrintIssue[] = [];
  const add = (kind: PrintIssueKind, severity: PrintIssue['severity'], message: string, at?: [number, number, number]) =>
    issues.push({ kind, severity, message, ...(at ? { at } : {}) });
  const topology = meshTopology(mesh);
  const done = (slices?: SliceReport): PartCheck => ({ ok: !issues.some((i) => i.severity === 'error'), issues, topology, ...(slices ? { slices } : {}) });

  if (!topology.triangles) {
    add('empty', 'error', 'The mesh is empty.');
    return done();
  }
  if (!topology.finite) {
    add('finite', 'error', 'The mesh has coordinates that are not finite numbers.');
    return done();
  }
  if (topology.openEdges || topology.badEdges) {
    add('manifold', 'error', `Not a closed solid: ${topology.openEdges} open edges, ${topology.badEdges} edges shared wrongly.`);
  }
  if (topology.volume <= 0) add('manifold', 'error', 'The mesh is inside out (negative volume).');

  // One piece (or as many as meant): report the extras with their size and place.
  const want = options.pieces ?? 1;
  const minVol = options.minPieceVolume ?? 0.001;
  const extra = topology.components.slice(want).filter((c) => Math.abs(c.volume) >= minVol);
  for (const c of extra) {
    const at = center(c.bounds);
    add('pieces', 'error', `Loose piece of ${r3(c.volume)} mm³ at ${fmtAt(at)}, apart from the main body.`, at);
  }

  // Flat on the bed: the body and its overlays together (a part split by colour may stand on any of its volumes).
  const b = mesh.overlays?.length ? boundsOf([mesh, ...mesh.overlays]) : topology.bounds;
  if (b.min[2] < -1e-3) add('bed-z', 'error', `Reaches ${r3(-b.min[2])} mm below the bed.`);
  else if (b.min[2] > 1e-3) add('bed-z', 'error', `Floats ${r3(b.min[2])} mm above the bed.`);

  // Fits the printer, either way round.
  if (options.bed) {
    const size = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
    const over = partOvershoot(size[0], size[1], size[2], options.bed);
    if (over > 1e-6) add('bed-fit', 'error', `${size.map(r1).join(' × ')} mm doesn't fit the printer (${options.bed.w} × ${options.bed.d} × ${options.bed.h} mm) by ${r1(over)} mm.`);
  }

  // Overlays touch the body without overlapping it, and print with it.
  const overlays = mesh.overlays ?? [];
  for (const ov of overlays) {
    const t = meshTopology(ov);
    if (!t.triangles) add('overlay', 'error', `Overlay “${ov.name}” is empty.`);
    else if (t.openEdges || t.badEdges || t.volume <= 0) add('overlay', 'error', `Overlay “${ov.name}” is not a closed solid.`);
  }
  if (options.noSlices || issues.some((i) => i.kind === 'manifold' || i.kind === 'overlay')) return done();

  const both = overlays.length ? mergeMeshes([mesh, ...overlays]) : mesh;
  if (overlays.length) {
    const shared = overlapVolume(w, mesh, overlays);
    if (shared > 0.01) add('overlay', 'error', `Overlays overlap the body by ${r3(shared)} mm³.`);
  }
  const slices = sliceReport(w, both, options);
  // A first layer that grips: some area, and not a tall part on a tiny foot.
  const h = b.max[2] - b.min[2];
  if (slices.contact < 5) add('contact', 'error', `Only ${r1(slices.contact)} mm² touches the bed.`);
  else if (h > 5 * Math.sqrt(slices.contact)) add('contact', 'warning', `${r1(h)} mm tall on ${r1(slices.contact)} mm² of first layer: it may tip or come loose (add a brim).`);
  for (const i of slices.islands) {
    add('island', 'error', `An island of ${r1(i.area)} mm² starts in mid-air at z = ${r1(i.z)} (${fmtAt(i.at)}).`, [i.at[0], i.at[1], i.z]);
  }
  for (const h of slices.overhangs) {
    const what = h.bridge ? `A ${r1(2 * h.reach)} mm bridge` : `A ledge reaching ${r1(h.reach)} mm out`;
    add('overhang', 'warning', `${what} (${r1(h.area)} mm²) has nothing under it at z = ${r1(h.z)} (${fmtAt(h.at)}).`, [h.at[0], h.at[1], h.z]);
  }
  for (const t of slices.thin) {
    add(
      'thin',
      'warning',
      `About ${r1(t.width)} mm thick from z = ${r1(t.z0)} to ${r1(t.z1)} at ${fmtAt(t.at)} (${t.size.map(r1).join(' × ')} mm): thinner than two lines.`,
      [t.at[0], t.at[1], t.z0],
    );
  }
  return done(slices);
}

/** Bounds of several meshes together. */
function boundsOf(list: Pick<MeshData, 'positions'>[]): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of list) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
  }
  return { min, max };
}

/** One triangle list from several meshes (their vertices kept apart). */
export function mergeMeshes(list: Pick<MeshData, 'positions' | 'indices'>[]): Pick<MeshData, 'positions' | 'indices'> {
  const nv = list.reduce((s, m) => s + m.positions.length, 0);
  const ni = list.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let pv = 0;
  let pi = 0;
  for (const m of list) {
    positions.set(m.positions, pv);
    const base = pv / 3;
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + base;
    pv += m.positions.length;
    pi += m.indices.length;
  }
  return { positions, indices };
}

function overlapVolume(w: Wasm, body: MeshData, others: Pick<MeshData, 'positions' | 'indices'>[]): number {
  const of = (m: Pick<MeshData, 'positions' | 'indices'>) => w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
  const a = of(body);
  let v = 0;
  for (const o of others) {
    const b = of(o);
    const i = a.intersect(b);
    v += i.volume();
    b.delete();
    i.delete();
  }
  a.delete();
  return v;
}

/**
 * How thick the slice is where `piece` was opened away: twice the largest
 * erosion (below `r`) that still keeps half of it, found on the slice around it.
 */
function thinWidth(w: Wasm, keep: <T extends { delete(): void }>(x: T) => T, s: CrossSection, piece: CrossSection, r: number): number {
  const b = piece.bounds();
  const pad = 2 * r + 1;
  const near = keep(s.intersect(keep(w.CrossSection.square([b.max[0] - b.min[0] + 2 * pad, b.max[1] - b.min[1] + 2 * pad]).translate([b.min[0] - pad, b.min[1] - pad]))));
  const area = piece.area();
  let lo = 0;
  let hi = r;
  for (let i = 0; i < 7; i++) {
    const t = (lo + hi) / 2;
    const opened = keep(keep(near.offset(-t, 'Round')).offset(t + 0.01, 'Round'));
    if (keep(piece.intersect(opened)).area() > area / 2) lo = t;
    else hi = t;
  }
  return 2 * lo;
}

function perimeter(cs: CrossSection): number {
  let l = 0;
  for (const poly of cs.toPolygons()) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      l += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }
  return l;
}

function triArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

const emptyBounds = (): Bounds3 => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

function grow(b: Bounds3, x: number, y: number, z: number) {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}

const center2 = (cs: CrossSection): [number, number] => {
  const b = cs.bounds();
  return [r3((b.min[0] + b.max[0]) / 2), r3((b.min[1] + b.max[1]) / 2)];
};

const center = (b: Bounds3): [number, number, number] => [r3((b.min[0] + b.max[0]) / 2), r3((b.min[1] + b.max[1]) / 2), r3((b.min[2] + b.max[2]) / 2)];
