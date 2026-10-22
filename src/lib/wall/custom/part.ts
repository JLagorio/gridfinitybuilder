/**
 * The custom attachment's add-ons and features (kinds/custom.ts), as profiles and places: plain TypeScript for
 * planning, the geometry and the editor alike.
 *
 * - Front lip: a wall `CUSTOM.lip` thick up from the profile's front edge.
 * - Gussets: 45° triangles in the corner where the profile leaves the plate, at each end and every 150 mm or so:
 *   under it when it starts higher than 8 mm up the plate (a brace), else on top of it. Upright, the one under has
 *   a 45° underside and the one on top stands on the profile, so neither needs support.
 * - End walls: its convex hull with the plate, down to the profile's underside (sloping from the plate's top to
 *   the front), at each end.
 * - Dividers: the same, up to the front's top (the lip's, with one): a tray's pockets.
 * Every one of them follows the profile's underside, so upright it prints wherever the profile does.
 */
import type { Vec2 } from '../../geometry/kernel';
import { mountBox, siteAt } from '../mount';
import type { AttachmentLayout, MountCtx } from '../registry';
import type { CustomOptions } from '../kinds/custom';
import { CUSTOM, exitAlong, featureCentres, featureHalf, hull, lowerAt, profileFaces, reachOf, upperAt, type Face, type Feature } from './profile';

type Shape = Pick<CustomOptions, 'profile' | 'lip' | 'ends' | 'dividers'>;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The z's to follow the profile's top or bottom at, from z0 to z1: every half millimetre and every point. */
function samples(p: readonly Vec2[], z0: number, z1: number): number[] {
  const zs = new Set<number>();
  for (let z = z0; z < z1; z += 0.5) zs.add(r2(z));
  zs.add(z1);
  for (const q of p) if (q[0] > z0 && q[0] < z1) zs.add(q[0] - 0.01).add(q[0] + 0.01);
  return [...zs].sort((a, b) => a - b);
}

export interface AddOns {
  /** The front lip's profile, and its top. */
  lip: Vec2[] | null;
  lipTop: number;
  /** A gusset's profile; it goes `below` the profile or on top of it. */
  gusset: Vec2[] | null;
  below: boolean;
  /** Dividers stand up to here (the front's top). */
  rim: number;
}

/** The add-ons' profiles for a part `h` tall. */
export function customAddOns(o: Shape, h: number): AddOns {
  const p = o.profile;
  const T = CUSTOM.plate;
  const zf = reachOf(p);
  const front = upperAt(p, zf - 0.05) ?? 0;
  let lip: Vec2[] | null = null;
  let lipTop = front;
  if (o.lip > 0 && zf - CUSTOM.lip > T) {
    const zb = zf - CUSTOM.lip;
    const base = Math.min(upperAt(p, zb + 0.05) ?? front, front) - 0.3;
    lipTop = Math.min(h, front + o.lip);
    if (lipTop - front >= 1)
      lip = [
        [zb, base],
        [zf, base],
        [zf, lipTop],
        [zb, lipTop],
      ];
    else lipTop = front;
  }
  // Gussets in the corner where the profile leaves the plate.
  let gusset: Vec2[] | null = null;
  const low0 = lowerAt(p, T + 0.05);
  const top0 = upperAt(p, T + 0.05);
  const below = low0 !== null && low0 >= 8;
  if (o.ends === 'gussets' && low0 !== null && top0 !== null) {
    const run = zf - T;
    const g = Math.min(40, run, below ? low0 - 1 : h - top0 - 1);
    if (g >= 3) {
      const lo: Vec2[] = [];
      const hi: Vec2[] = [];
      for (const z of samples(p, T - 0.5, T + g + 40)) {
        const line = below ? low0 - g + (z - T) : top0 + g - (z - T);
        const edge = z <= T ? (below ? low0 : top0) : below ? lowerAt(p, z) : upperAt(p, z);
        if (edge === null) break;
        const a = below ? line : edge - 0.3;
        const b = below ? edge + 0.3 : line;
        if (b - a < 0.2) break;
        lo.push([z, r2(a)]);
        hi.push([z, r2(b)]);
      }
      if (lo.length >= 2) gusset = [...lo, ...hi.reverse()];
    }
  }
  return { lip, lipTop, gusset, below, rim: Math.max(front, lipTop) };
}

/** The profile's convex hull with the back plate's side (an end wall's outline before it's cut to the underside). */
export const endHull = (p: readonly Vec2[], h: number): Vec2[] => hull([...p, [0, 0], [CUSTOM.plate, 0], [CUSTOM.plate, h], [0, h]]);

/**
 * Under the profile: from its underside down below the bed, `lift` above it (what an end wall or a divider is
 * cut back to, so its bottom follows the profile's).
 */
export function underside(p: readonly Vec2[], lift = 0.2): Vec2[] {
  const zf = reachOf(p);
  const pts: Vec2[] = [[-1, -1]];
  for (const z of samples(p, 0, zf)) pts.push([z, z <= CUSTOM.plate ? lift : (lowerAt(p, z) ?? 0) + lift]);
  pts.push([zf, -1]);
  return pts;
}

/** Where across the end walls, gussets and dividers stand (x0, x1). */
export function customRibs(
  o: Pick<CustomOptions, 'ends' | 'dividers'>,
  w: number,
): { ends: [number, number][]; gussets: [number, number][]; dividers: [number, number][] } {
  const E = CUSTOM.end;
  const G = CUSTOM.gusset;
  const D = CUSTOM.divider;
  const ends: [number, number][] =
    o.ends === 'walls'
      ? [
          [0, E],
          [w - E, w],
        ]
      : [];
  const gussets: [number, number][] = [];
  if (o.ends === 'gussets') {
    gussets.push([0, G], [w - G, w]);
    const n = Math.max(0, Math.ceil(w / CUSTOM.gussetEvery) - 1);
    for (let k = 1; k <= n; k++) gussets.push([(w * k) / (n + 1) - G / 2, (w * k) / (n + 1) + G / 2]);
  }
  const inner = o.ends === 'walls' ? E : 0;
  const dividers: [number, number][] = [];
  for (let k = 1; k <= o.dividers; k++) {
    const x = inner + ((w - 2 * inner) * k) / (o.dividers + 1);
    dividers.push([x - D / 2, x + D / 2]);
  }
  return { ends, gussets, dividers };
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/** One hole (or text) of a feature's group, placed. */
export interface Spot {
  /** Its feature (by index in the options' list). */
  i: number;
  feature: Feature;
  face: Face;
  /** Its centre in the face's (u across from the part's left, v along from the face's start). */
  c: Vec2;
  /** The way up as printed in the face's (u, v), when the hole lies on its side (it gets a teardrop top); else null. */
  tear: Vec2 | null;
  /** How deep it cuts in from the face, mm. */
  depth: number;
  /** A notch: where along its face it runs out (the nearer end). */
  end?: number;
  /** On its face, clear of the mounts, end walls, dividers and gussets; else it's left out. */
  ok: boolean;
}

/** Where every feature's holes go on a part planned as `layout` (its faces, which way is up as printed, how deep through is). */
export function featureSpots(
  o: Shape & Pick<CustomOptions, 'features'>,
  layout: Pick<AttachmentLayout, 'w' | 'h' | 'pose' | 'anchor' | 'mounts'>,
  ctx: MountCtx,
): Spot[] {
  const p = o.profile;
  const { w, h } = layout;
  const faces = profileFaces(p, h);
  const ribs = customRibs(o, w);
  const add = customAddOns(o, h);
  const T = CUSTOM.plate;
  const uMin = ribs.ends.length ? CUSTOM.end : 0;
  const uMax = w - uMin;
  const mounts = layout.mounts.map((m) => mountBox(m.kind, siteAt(layout, m, ctx), ctx));
  const gz = add.gusset ? [Math.min(...add.gusset.map((q) => q[0])), Math.max(...add.gusset.map((q) => q[0]))] : null;
  const gy = add.gusset ? [Math.min(...add.gusset.map((q) => q[1])), Math.max(...add.gusset.map((q) => q[1]))] : null;
  const low0 = lowerAt(p, T + 0.05) ?? 0;
  // Up as printed: upright, up the wall; on its side, across it (to the right).
  const up = layout.pose === 'upright' ? [0, 1, 0] : [1, 0, 0];
  const out: Spot[] = [];
  o.features.forEach((f, i) => {
    const face = faces.find((q) => q.id === f.f);
    if (!face) return;
    // The hole's axis is the face's normal (x, y, z) = (0, n_y, n_z): lying down unless it's within 45° of upright.
    const level = Math.abs(up[1] * face.n[1] + up[2] * face.n[0]) < Math.SQRT1_2;
    let tear: Vec2 | null = null;
    if (level && f.k !== 'text' && f.k !== 'rect') {
      const tu = up[0];
      const tv = up[1] * face.e[1] + up[2] * face.e[0];
      const l = Math.hypot(tu, tv);
      if (l > 1e-6) tear = [tu / l, tv / l];
    }
    const [hu, hv] = featureHalf(f);
    for (const c of featureCentres(f, w, face.len)) {
      const end = f.k === 'notch' ? (c[1] >= face.len / 2 ? face.len + hv + 1 : -hv - 1) : undefined;
      // Through: as deep as the wall under it, anywhere along it.
      let depth = f.k === 'text' ? f.d || 0.6 : f.d;
      if (!depth) {
        for (const v of [c[1] - hv, c[1], c[1] + hv]) {
          const t = Math.min(face.len - 0.2, Math.max(0.2, v));
          depth = Math.max(depth, exitAlong(p, h, [face.a[0] + face.e[0] * t, face.a[1] + face.e[1] * t], [-face.n[0], -face.n[1]]));
        }
        depth += 0.6;
      }
      const u0 = c[0] - hu;
      const u1 = c[0] + hu;
      const v0 = end !== undefined && end < 0 ? 0.8 : c[1] - hv;
      const v1 = end !== undefined && end > face.len ? face.len - 0.8 : c[1] + hv;
      let ok = u0 >= uMin + 0.8 - 1e-6 && u1 <= uMax - 0.8 + 1e-6 && v0 >= 0.8 - 1e-6 && v1 <= face.len - 0.8 + 1e-6;
      ok &&= !ribs.dividers.some(([x0, x1]) => u1 > x0 - 0.5 && u0 < x1 + 0.5);
      // Its box on the wall (z, y) for the plate's and the gussets' sake.
      const za = face.a[0] + face.e[0] * c[1];
      const ya = face.a[1] + face.e[1] * c[1];
      if (ok && face.id === -1) {
        const y0 = ya - hv;
        const y1 = ya + hv;
        ok = !mounts.some((b) => u1 > b.x0 - 1.5 && u0 < b.x1 + 1.5 && y1 > b.y0 - 1.5 && y0 < b.y1 + 1.5);
        if (ribs.dividers.length && add.rim > low0) ok &&= !(y1 > low0 && y0 < add.rim);
        if (gy) ok &&= !ribs.gussets.some(([x0, x1]) => u1 > x0 - 0.5 && u0 < x1 + 0.5 && y1 > gy[0] && y0 < gy[1]);
      } else if (ok && gz && gy) {
        const r = Math.max(hu, hv);
        const near = za + r > gz[0] && za - r < gz[1] && ya + r > gy[0] && ya - r < gy[1];
        if (near) ok = !ribs.gussets.some(([x0, x1]) => u1 > x0 - 0.5 && u0 < x1 + 0.5);
      }
      out.push({ i, feature: f, face, c, tear, depth: r2(depth), ...(end !== undefined ? { end } : {}), ok });
    }
  });
  return out;
}
