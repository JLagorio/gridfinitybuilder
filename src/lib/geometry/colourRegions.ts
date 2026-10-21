import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, INNER_RADIUS, LIP_DEPTH, LIP_SUPPORT_HEIGHT, TAB_SUPPORT_ANGLE_DEG, TAB_TIP_HEIGHT, WALL } from './spec';
import { binCells, binLabelTabs, binLayout, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from './bin';
import { binBodyHeight, binFloorZ } from './variants';
import { activeContainer } from './containers/registry';
import { drawerPullBox, type DrawerSpec } from './containers/drawers';
import { boxAt, extrudePolygon, roundedRectRing } from './shapes';
import { DIVIDER } from './spec';
import { snapZ, type ColourRole } from '../colours';
import { roleLabel } from '../colourText';
import type { MeshSpec } from '../project';

/**
 * Where each colour role is on a part (colours.ts).
 *
 * - `specRole`: the role a whole part prints in ('part' strategy).
 * - `partBands`: horizontal bands by role, from the bottom up: a bin's feet,
 *   floor, walls and lip ('height' strategy, and the estimate).
 * - `splitByRoles`: the part cut into one disjoint volume per role with
 *   Manifold ('feature' strategy). Each role has a region (a prism, a band, a
 *   ring); in order, a role takes what of the part is left inside its region,
 *   and the last one takes the rest, so the volumes never overlap and add up
 *   to the part.
 *
 * Bins (mesh frame: min corner at 0, bottom at z = 0), first match wins:
 *   label tabs   the tab prisms (front edge to the back wall, top down past the support);
 *   lip          above where the lip starts, outside the lip's inner edge;
 *   dividers     a box around each fixed divider wall (diagonal and curved ones too), above the floor;
 *   feet         below the top of the feet;
 *   walls        outside the cavity (the outer wall from the feet up);
 *   floor        the rest: the floor, scoops, filled compartments, pocket fills.
 * Containers: feet, then the shell. Drawers of a drawer unit: the pull (tab or
 * knob, in front of the front face), then the drawer.
 *
 * No region boundary runs along one of the part's faces (FACE_GAP): a cut
 * along a face leaves slivers where two outlines of the same rounded corner
 * differ by a hair, and those don't survive being written as float32.
 */

/** The role a whole part prints in, from what the mesh is. */
export function specRole(spec: MeshSpec | undefined): ColourRole {
  if (!spec) return 'binWalls';
  switch (spec.kind) {
    case 'split':
      return specRole(spec.base);
    case 'piece':
      return spec.enclosure?.kind === 'case' ? 'caseShell' : spec.enclosure?.kind === 'wall' ? 'wallGrid' : 'plate';
    case 'key':
      return 'plateAccent';
    case 'lid':
      return 'lids';
    case 'divider':
      return 'dividers';
    case 'label':
      return 'labelTabs';
    case 'accessory':
      return spec.part.type === 'slideLid' ? 'lids' : spec.part.type === 'railPlate' ? 'dividers' : 'inserts';
    case 'insertPart':
      return spec.part.type === 'pad' ? 'pads' : 'inserts';
    case 'container':
      return spec.type === 'drawers' ? 'containerFront' : spec.type === 'box' ? 'lids' : 'containerShell';
    case 'enclosure': {
      const k = spec.part.kind;
      return k === 'lid' ? 'caseLid' : k === 'handle' ? 'caseHandle' : k === 'spacer' ? 'plateAccent' : k === 'cleat' ? 'wallGrid' : 'caseHardware';
    }
    case 'bin':
      return activeContainer(spec.opts) ? 'containerShell' : 'binWalls';
  }
  return 'binWalls';
}

/** A horizontal band: `role` from `z` up to the next band. */
export interface RoleBand {
  role: ColourRole;
  z: number;
}

/** Heights a plain bin's bands start at (unsnapped), mm. */
export function binBandHeights(opts: BinOptions) {
  const o = sanitizeBin(opts);
  const H = binBodyHeight(o);
  const feet = o.base === 'flat' ? 0 : BASE_PROFILE_HEIGHT;
  const floor = binFloorZ(o);
  // The lip: where the cavity starts to narrow (reduced lips: at the wall top).
  const lip = o.lip ? (o.lipStyle === 'reduced' ? H : H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL)) : null;
  return { feet, floor, lip, top: binTotalHeight(o) };
}

/**
 * The part's horizontal bands by role, snapped to layer boundaries, bottom
 * first; null for parts that are one role all the way up.
 */
export function partBands(spec: MeshSpec | undefined): RoleBand[] | null {
  if (!spec) return null;
  if (spec.kind === 'split') return partBands(spec.base);
  if (spec.kind !== 'bin') return null;
  const o = sanitizeBin(spec.opts);
  if (activeContainer(o)) return o.base === 'flat' ? null : [{ role: 'binFeet', z: 0 }, { role: 'containerShell', z: snapZ(BASE_PROFILE_HEIGHT) }];
  const h = binBandHeights(o);
  const out: RoleBand[] = [];
  if (h.feet > 0) out.push({ role: 'binFeet', z: 0 });
  if (h.floor > h.feet + 1e-6) out.push({ role: 'binFloor', z: snapZ(h.feet) });
  out.push({ role: 'binWalls', z: snapZ(h.floor) });
  if (h.lip !== null && h.lip > h.floor) out.push({ role: 'binLip', z: snapZ(h.lip) });
  out[0] = { ...out[0], z: 0 };
  return out;
}

/**
 * Parts that can be cut into volumes by role ('feature'). The others print
 * as one body in their role's colour.
 *
 * Hook for bins that must print as one body: vase-mode bins (a single wall,
 * sliced in spiral mode) and imported meshes return false here.
 */
export function splitsByFeature(spec: MeshSpec | undefined): boolean {
  if (!spec) return false;
  if (spec.kind === 'bin') return true;
  if (spec.kind === 'container') return spec.type === 'drawers' && !!drawerPullBox(spec.spec as DrawerSpec);
  return false;
}

/** Why a part prints as one body in 'feature' mode, or null when it can be split (see splitsByFeature). */
export function featureSplitBlocked(spec: MeshSpec | undefined): string | null {
  return spec && spec.kind === 'bin' && !splitsByFeature(spec) ? 'prints as one body' : null;
}

/**
 * How far region boundaries stay off the part's own faces, mm: a cut along a
 * face (the cavity wall, the lip's inner edge, a compartment floor) leaves
 * slivers where the two outlines differ by a hair. Each boundary sits this far
 * into the air (or the solid) next to the face instead.
 */
export const FACE_GAP = 0.3;

interface Region {
  role: ColourRole;
  /** Null: the rest of the part. */
  m: Manifold | null;
}

const BIG = 1e4;

/** Bin regions in the mesh frame (see the module comment). */
function binRegions(w: Wasm, s: Scope, opts: BinOptions, cells: Partial<BinCells> | null | undefined): Region[] {
  const o = sanitizeBin(opts);
  const c = binCells(o, cells);
  const { w: W, d: D } = binSize(o, c);
  const h = binBandHeights(o);
  const top = h.top + 1;
  const feetTop = snapZ(h.feet);
  const floorTop = snapZ(h.floor);
  const lipZ = h.lip === null ? null : snapZ(h.lip);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => s.t(boxAt(w, x0, y0, z0, x1, y1, z1));
  const prism = (inset: number, r: number, z0: number, z1: number) =>
    s.t(extrudePolygon(w, roundedRectRing(inset, inset, W - inset, D - inset, Math.max(0.3, r)), z0, z1));
  // The cavity, a little inside its walls (FACE_GAP): what's outside it is the wall.
  const cavity = prism(WALL + FACE_GAP, INNER_RADIUS - FACE_GAP, -1, top + 1);
  const out: Region[] = [];

  // Label tabs: from the tab's front edge to the back wall, down past the support (bin-centered → mesh frame).
  const tan = Math.tan((TAB_SUPPORT_ANGLE_DEG * Math.PI) / 180);
  const tabs = binLabelTabs(o, c).map((t) => {
    // To just off the back wall (the tab is joined to it there).
    const yBack = D - WALL - 0.02;
    const yf = t.y0 + D / 2;
    const zb = Math.max(floorTop + FACE_GAP, t.z - (tan * (yBack - yf) + TAB_TIP_HEIGHT) - 0.3);
    // A tab ends at a divider's face: its region goes a little into the divider, off the face.
    return box(t.x0 + W / 2 - FACE_GAP, yf - 0.05, zb, t.x1 + W / 2 + FACE_GAP, yBack, t.z + 0.05);
  });
  if (tabs.length) out.push({ role: 'labelTabs', m: s.t(s.t(w.Manifold.union(tabs)).intersect(cavity)) });

  // Lip: above where it starts, outside its inner tip.
  if (lipZ !== null) {
    const band = box(-1, -1, lipZ, W + 1, D + 1, top + 1);
    out.push({ role: 'binLip', m: s.t(band.subtract(prism(LIP_DEPTH + FACE_GAP, BASE_TOP_RADIUS - LIP_DEPTH - FACE_GAP, lipZ - 1, top + 2))) });
  }

  // Dividers: a box around each fixed wall's footprint (cavity frame → mesh frame: + WALL), and the free walls' paths.
  if (o.interior === 'compartments' || !o.interior) {
    const r = binLayout(o, c);
    const m = 0.4;
    // From a layer above the floor, so the region's bottom isn't the compartments' floor.
    const z0 = snapZ(floorTop + FACE_GAP);
    const half = DIVIDER / 2 + m;
    const walls: Manifold[] = [];
    for (const wl of r.walls) {
      if (wl.removable) continue;
      if (wl.orient === 'v') walls.push(box(WALL + wl.pos - half, WALL + wl.start - DIVIDER / 2, z0, WALL + wl.pos + half, WALL + wl.end + DIVIDER / 2, top));
      else walls.push(box(WALL + wl.start - DIVIDER / 2, WALL + wl.pos - half, z0, WALL + wl.end + DIVIDER / 2, WALL + wl.pos + half, top));
    }
    for (const fw of r.free) {
      for (let i = 1; i < fw.path.length; i++) {
        const [ax, ay] = fw.path[i - 1];
        const [bx, by] = fw.path[i];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-6) continue;
        const nx = (-(by - ay) / len) * half;
        const ny = ((bx - ax) / len) * half;
        const ex = ((bx - ax) / len) * m;
        const ey = ((by - ay) / len) * m;
        const pts: [number, number][] = [
          [WALL + ax - ex + nx, WALL + ay - ey + ny],
          [WALL + ax - ex - nx, WALL + ay - ey - ny],
          [WALL + bx + ex - nx, WALL + by + ey - ny],
          [WALL + bx + ex + nx, WALL + by + ey + ny],
        ];
        // Counter-clockwise for the extrusion.
        const area = pts.reduce((t, p, k) => t + p[0] * pts[(k + 1) % 4][1] - pts[(k + 1) % 4][0] * p[1], 0);
        walls.push(s.t(extrudePolygon(w, area < 0 ? pts.reverse() : pts, z0, top)));
      }
    }
    if (walls.length) out.push({ role: 'dividers', m: s.t(s.t(w.Manifold.union(walls)).intersect(cavity)) });
  }

  if (feetTop > 0) out.push({ role: 'binFeet', m: box(-BIG, -BIG, -1, BIG, BIG, feetTop) });
  out.push({ role: 'binWalls', m: s.t(box(-1, -1, feetTop, W + 1, D + 1, top + 1).subtract(cavity)) });
  out.push({ role: 'binFloor', m: null });
  return out;
}

/** Regions of a part, in the order they take their share (see the module comment); null when the part is one role. */
/** Exported for tests and probes. */
export function regionsOf(w: Wasm, s: Scope, spec: MeshSpec): Region[] | null {
  if (spec.kind === 'bin') {
    const o = sanitizeBin(spec.opts);
    if (activeContainer(o)) {
      if (o.base === 'flat') return null;
      return [
        { role: 'binFeet', m: s.t(boxAt(w, -BIG, -BIG, -1, BIG, BIG, snapZ(BASE_PROFILE_HEIGHT))) },
        { role: 'containerShell', m: null },
      ];
    }
    return binRegions(w, s, o, spec.cells);
  }
  if (spec.kind === 'container' && spec.type === 'drawers') {
    const b = drawerPullBox(spec.spec as DrawerSpec);
    if (!b) return null;
    return [
      // Off the pull's sides, and a hair in front of the front face.
      { role: 'containerPull', m: s.t(boxAt(w, b.x0 - FACE_GAP, -BIG, b.z0, b.x1 + FACE_GAP, b.y - 0.05, b.z1)) },
      { role: 'containerFront', m: null },
    ];
  }
  return null;
}

/** Pieces smaller than this stay with the rest, mm³ (slivers where a region grazes the part). */
export const MIN_VOLUME = 0.5;

/**
 * The part cut into one volume per role: the main body is the first volume,
 * the others (and the part's own overlays: label text, shadow floors) are
 * overlays, every body tagged with its role. Parts with one role come back as
 * they are, with the main body's role set.
 */
export function splitByRoles(w: Wasm, mesh: MeshData, spec: MeshSpec): MeshData {
  const s = new Scope();
  try {
    const regions = splitsByFeature(spec) ? regionsOf(w, s, spec) : null;
    if (!regions) return { ...mesh, role: specRole(spec) };
    let rest: Manifold | null = s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
    assertValid(rest, 'part to split');
    const pieces: { role: ColourRole; m: Manifold }[] = [];
    for (const r of regions) {
      if (!rest || rest.isEmpty()) break;
      if (!r.m) {
        pieces.push({ role: r.role, m: rest });
        rest = null;
        break;
      }
      const [inside, outside]: [Manifold, Manifold] = rest.split(r.m);
      s.t(inside);
      s.t(outside);
      if (inside.isEmpty() || inside.volume() < MIN_VOLUME) continue;
      pieces.push({ role: r.role, m: inside });
      rest = outside;
    }
    // The rest without a region of its own goes with the last volume (or is the part itself).
    if (rest && !rest.isEmpty() && rest.volume() > 1e-9) {
      if (pieces.length) pieces[pieces.length - 1] = { ...pieces[pieces.length - 1], m: s.t(w.Manifold.union([pieces[pieces.length - 1].m, rest])) };
      else pieces.push({ role: specRole(spec), m: rest });
    }
    if (pieces.length <= 1) return { ...mesh, role: pieces[0]?.role ?? specRole(spec) };
    // The biggest is the main body.
    pieces.sort((a, b) => b.m.volume() - a.m.volume());
    const bodies = pieces.map((p) => {
      assertValid(p.m, `${p.role} volume`);
      return { role: p.role, ...toMeshData(p.m) };
    });
    const [main, ...more] = bodies;
    return {
      positions: main.positions,
      indices: main.indices,
      role: main.role,
      overlays: [
        ...more.map((b) => ({ name: roleLabel(b.role), filament: 1, role: b.role, positions: b.positions, indices: b.indices })),
        ...(mesh.overlays ?? []),
      ],
    };
  } finally {
    s.dispose();
  }
}
