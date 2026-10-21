/**
 * Open-front hopper bin (container kind 'hopper'), like a shop pick bin: a
 * tall back, a low front lip with an opening above it, and a floor that
 * slopes down to the front so parts slide to where you reach in.
 *
 * Side view (Y forward-back, Z up): the front lip rises `front` mm above the
 * floor's front edge. Above it the opening's edge runs back up at `angle`
 * degrees from horizontal. Without a stacking lip it runs out through the top
 * of the side walls (an open-topped hopper). With one, a lintel across the
 * front closes the ring the lip needs, so a bin stacks on top and the opening
 * stays reachable: the opening's top is a 45° roof running down and back from
 * the window top under the lintel, and the opening ends where the two edges
 * meet. Dividers (`dividers`, evenly across the width) follow the same profile,
 * so every section is a small hopper.
 *
 * Printing: the side walls under the sloped edge are plain walls; above the
 * roof (stacking lip) they overhang at 45°, and the lintel starts as a bridge
 * across each section (notes() warns when it is long) and grows forward at
 * 45°. The floor is a solid wedge. The label slot and the text panel are open
 * at the top. Nothing needs support.
 *
 * Label on the front lip: 'slot' gives each section a pocket for a paper or
 * card label with a window in front of it (slide the card in from the top);
 * the text, if any, is engraved in the back of the pockets (one line per
 * section when there are as many lines as sections), visible without a card.
 * 'text' raises the text from a recessed panel across the lip, flush with the
 * front so it never sticks out of the footprint.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from '../kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, DIVIDER, HEIGHT_UNIT, LIP_DEPTH, LIP_SUPPORT_HEIGHT, WALL } from '../spec';
import { boxAt, extrudePolygon, loftRoundedRect } from '../shapes';
import { binSize, type BinCells, type BinOptions } from '../bin';
import { binFloorZ, lipRise } from '../variants';
import { lipCavityKnots } from '../lip';
import { fitText, labelLines, sanitizeLabelText, LABEL_TEXT } from '../labels';
import { hasFont, textSolid } from '../text';
import { containerBase, containerRing } from './base';
import { registerContainer, type ContainerDef } from './registry';
import { prismX } from './box';

const DEG = Math.PI / 180;

export type HopperLabel = 'none' | 'slot' | 'text';

export interface HopperOptions {
  /** Height of the front lip above the floor's front edge, mm. */
  front: number;
  /** Slope of the opening's edge from horizontal, degrees (90 = straight up from the lip). */
  angle: number;
  /** Floor slope down to the front, degrees. */
  slope: number;
  /** Dividers across the width (sections = dividers + 1). */
  dividers: number;
  /** Stacking lip on top (with a lintel over the opening so it goes all the way round). */
  lip: boolean;
  label: HopperLabel;
  /** Raised on the lip ('text'), or engraved in the back of the label slots ('slot'). */
  labelText: string;
}

export const DEFAULT_HOPPER: HopperOptions = {
  front: 12,
  angle: 55,
  slope: 15,
  dividers: 0,
  lip: false,
  label: 'slot',
  labelText: '',
};

export const HOPPER = {
  minFront: 3,
  maxFront: 120,
  minAngle: 30,
  maxAngle: 90,
  /** Steepest floor; and the floor rises at most this share of the inside height. */
  maxSlope: 35,
  maxRise: 0.5,
  maxDividers: 11,
  /** Narrowest section between dividers. */
  minSection: 10,
  /** The opening's edge stops at least this far in front of the back wall. */
  backKeep: 8,
  /** Walls must rise at least this far above the front lip. */
  minOpening: 4,
  /** With a stacking lip: the lintel's depth, and how far the window top stays under the lip's support. */
  lintelDepth: 3,
  lintelDrop: 0.5,
  /** Longest lintel bridge before notes() warns. */
  bridgeWarn: 45,
  /** Front lip thickness per label style. */
  lip: { none: 1.6, text: 2.2, slot: 3 },
  slot: { skin: 0.8, depth: 0.9, frame: 1.5, ledge: 1.2, margin: 3, minWidth: 10, textDepth: 0.5 },
  text: { recess: 0.8, margin: 4 },
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const LABELS: readonly HopperLabel[] = ['none', 'slot', 'text'];
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sanitizeHopper(raw: unknown): HopperOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HopperOptions>;
  const d = DEFAULT_HOPPER;
  return {
    front: round2(num(r.front, HOPPER.minFront, HOPPER.maxFront, d.front)),
    angle: round2(num(r.angle, HOPPER.minAngle, HOPPER.maxAngle, d.angle)),
    slope: round2(num(r.slope, 0, HOPPER.maxSlope, d.slope)),
    dividers: Math.round(num(r.dividers, 0, HOPPER.maxDividers, d.dividers)),
    lip: !!(r.lip ?? d.lip),
    label: LABELS.includes(r.label as HopperLabel) ? (r.label as HopperLabel) : d.label,
    labelText: sanitizeLabelText(r.labelText),
  };
}

export function hopperKey(o: HopperOptions): string {
  const t = o.label !== 'none' ? labelLines(o.labelText) : '';
  return `f${o.front}/a${o.angle}/s${o.slope}/d${o.dividers}/${o.lip ? 'L' : 'n'}/${o.label}${t ? JSON.stringify(t) : ''}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface HopperLayout {
  W: number;
  D: number;
  floorTop: number;
  /** Wall height (the lip, if any, sits on top) and overall height. */
  H: number;
  top: number;
  /** Front lip: thickness, top (box Z). */
  tf: number;
  zLip: number;
  /** Front lip height actually used (it is lowered on short bins). */
  front: number;
  /** Opening angle used, degrees, and where its edge stops (window top with a lip, else above the walls). */
  angle: number;
  zOpen: number;
  /** Floor: rise from front to back, and the slope used, degrees. */
  rise: number;
  slope: number;
  /** Divider centers (X) and the sections between them. */
  dividers: number[];
  sections: [number, number][];
  /** Longest lintel bridge (lip only), mm. */
  bridge: number;
  /** Bottom of the label slot / text panel on the front lip. */
  zLabel: number;
}

export function hopperLayout(bin: BinOptions, o: HopperOptions, cells?: Partial<BinCells> | null): HopperLayout {
  const { w: W, d: D } = binSize(bin, cells);
  const floorTop = binFloorZ(bin);
  const H = HEIGHT_UNIT * bin.heightUnits;
  const top = H + lipRise({ lip: o.lip });
  const tf = HOPPER.lip[o.label];
  const yFi = -D / 2 + tf;
  const yB = D / 2 - WALL;
  // With a lip: top of the window at the front face, just under the lip's support; else above the walls.
  const zOpen = o.lip ? H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL) - HOPPER.lintelDrop : top + 1;
  const wallTop = o.lip ? zOpen - tf : H;
  const front = Math.min(o.front, Math.max(0.5, wallTop - floorTop - HOPPER.minOpening));
  const zLip = floorTop + front;
  // Floor: at most HOPPER.maxRise of the inside height.
  const run = yB - yFi;
  const riseMax = HOPPER.maxRise * Math.max(0, H - floorTop);
  const rise = Math.min(Math.tan(o.slope * DEG) * run, riseMax);
  const slope = run > 0 ? Math.atan(rise / run) / DEG : 0;
  // The opening's edge must stop short of the back wall (an open top) and stay steeper than the floor.
  const minByDepth = o.lip ? 0 : Math.atan2(Math.max(0, H - zLip), Math.max(1, run - HOPPER.backKeep)) / DEG;
  const angle = clamp(Math.max(o.angle, minByDepth, slope + 10), HOPPER.minAngle, HOPPER.maxAngle);
  // Dividers, evenly across the inside.
  const Wi = W - 2 * WALL;
  const maxDiv = Math.max(0, Math.floor((Wi + DIVIDER) / (HOPPER.minSection + DIVIDER)) - 1);
  const n = Math.min(o.dividers, maxDiv);
  const pitch = Wi / (n + 1);
  const dividers = Array.from({ length: n }, (_, k) => -Wi / 2 + pitch * (k + 1));
  const edges = [-Wi / 2, ...dividers, Wi / 2];
  const sections = edges.slice(1).map((x1, i): [number, number] => [edges[i] + (i ? DIVIDER / 2 : 0), x1 - (i < n ? DIVIDER / 2 : 0)]);
  const bridge = o.lip ? Math.max(...sections.map(([a, b]) => b - a)) : 0;
  const zLabel = (bin.base === 'flat' ? 0 : BASE_PROFILE_HEIGHT) + 0.6;
  return { W, D, floorTop, H, top, tf, zLip, front, angle, zOpen, rise, slope, dividers, sections, bridge, zLabel };
}

/**
 * With a stacking lip: where the opening's edge (up from the lip at `angle`)
 * meets the 45° roof under the lintel (down and back from the window top at
 * the front face). Bin-centered Y, Z.
 */
export function hopperApex(L: HopperLayout): { y: number; z: number } {
  const yFi = -L.D / 2 + L.tf;
  const t = Math.tan(L.angle * DEG);
  // zLip + (y − yFi)·t = zOpen − (y + D/2)
  const y = Number.isFinite(t) && t < 1e6 ? (L.zOpen - L.zLip + yFi * t - L.D / 2) / (t + 1) : yFi;
  return { y: Math.max(yFi, y), z: L.zOpen - (Math.max(yFi, y) + L.D / 2) };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Text laid out in the XZ plane, extruded along Y from y0 to y1 (reads from the front). */
function frontText(w: Wasm, s: Scope, text: string, box: { x0: number; x1: number; z0: number; z1: number }, y0: number, y1: number): Manifold | null {
  const fit = fitText(text, { x0: box.x0, x1: box.x1, y0: box.z0, y1: box.z1 }, Math.min(LABEL_TEXT.maxCap, 0.8 * (box.z1 - box.z0)));
  if (!fit) return null;
  // Extruded along +Z at z ∈ [−y1, −y0], then turned up: (x, y, z) → (x, −z, y).
  const m = textSolid(w, fit.outline, fit.cx, fit.cy, -y1, y1 - y0);
  return m ? s.t(s.t(m).rotate([90, 0, 0])) : null;
}

export function buildHopper(w: Wasm, bin: BinOptions, o: HopperOptions, cells: BinCells): MeshData {
  const L = hopperLayout(bin, o, cells);
  const { W, D, floorTop, H, top, tf, zLip } = L;
  const flat = bin.base === 'flat';
  const wallBottom = flat ? 0 : BASE_PROFILE_HEIGHT;
  const s = new Scope();
  try {
    const ring = containerRing(bin, cells);
    const outline = (z0: number, z1: number) => s.t(extrudePolygon(w, ring, z0, z1));
    const yFi = -D / 2 + tf;
    const yB = D / 2 - WALL;

    // 1. Outer wall (with the stacking lip), dividers, lintel; then the opening is cut through them.
    const cavity = s.t(loftRoundedRect(w, 0, 0, W, D, BASE_TOP_RADIUS, lipCavityKnots({ lip: o.lip, lipStyle: 'normal' }, H, wallBottom, floorTop)));
    const walls: Manifold[] = [s.t(outline(wallBottom, top).subtract(cavity))];
    const lipSupport = H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL);
    for (const x of L.dividers) walls.push(s.t(boxAt(w, x - DIVIDER / 2, yFi - 0.5, floorTop - 0.5, x + DIVIDER / 2, yB + 0.5, o.lip ? lipSupport : H)));
    // The lintel: a deeper front wall under the lip, its underside the opening's 45° roof.
    if (o.lip) {
      const y0 = -D / 2 + 0.3;
      const y1 = Math.max(y0 + 0.5, Math.min(-D / 2 + HOPPER.lintelDepth, hopperApex(L).y));
      const roof = (y: number) => L.zOpen - (y + D / 2) - 0.01;
      const lintel = prismX(
        w,
        [
          [y0, roof(y0)],
          [y1, roof(y1)],
          [y1, lipSupport],
          [y0, lipSupport],
        ],
        -W / 2,
        W / 2,
      );
      walls.push(s.t(s.t(lintel).intersect(outline(0, top))));
    }
    // Side view: up from the lip's inner face at the opening angle; with a lip, under a 45° roof from the window top.
    const tA = Math.tan(L.angle * DEG);
    const profile: [number, number][] = [
      [-D / 2 - 1, zLip],
      [yFi, zLip],
    ];
    if (o.lip) {
      const apex = hopperApex(L);
      profile.push([apex.y, apex.z], [-D / 2 - 1, L.zOpen + 1]);
    } else profile.push([yFi + (top + 1 - zLip) / tA, top + 1], [-D / 2 - 1, top + 1]);
    const opening = s.t(prismX(w, profile, -W / 2 - 1, W / 2 + 1));
    let body = s.t(s.t(w.Manifold.union(walls)).subtract(opening));

    // 2. Front lip and sloped floor.
    const frontLip = s.t(s.t(boxAt(w, -W / 2, -D / 2 - 1, floorTop - 0.5, W / 2, yFi, zLip)).intersect(outline(wallBottom, zLip)));
    const k = L.rise / Math.max(1e-6, yB - yFi);
    const floor = s.t(
      s.t(
        prismX(
          w,
          [
            [yFi - 0.5, floorTop - 0.5],
            [yB + 0.5, floorTop - 0.5],
            [yB + 0.5, floorTop + L.rise + 0.5 * k],
            [yFi - 0.5, floorTop - 0.5 * k],
          ],
          -W / 2,
          W / 2,
        ),
      ).intersect(outline(floorTop - 0.5, floorTop + L.rise + 1)),
    );
    body = s.t(w.Manifold.union([body, frontLip, floor, containerBase(w, s, bin, cells, floorTop)]));

    // 3. Label slots or the text panel on the front lip.
    const zl0 = L.zLabel;
    const text = labelLines(o.labelText);
    if (o.label === 'slot') {
      const S = HOPPER.slot;
      const cuts: Manifold[] = [];
      const ys = -D / 2 + S.skin;
      const lines = text ? text.split('\n') : [];
      L.sections.forEach(([a, b], i) => {
        const x0 = a + S.margin;
        const x1 = b - S.margin;
        if (x1 - x0 < S.minWidth || zLip - zl0 < S.ledge + 3) return;
        cuts.push(s.t(boxAt(w, x0, ys, zl0, x1, ys + S.depth, zLip + 1)));
        cuts.push(s.t(boxAt(w, x0 + S.frame, -D / 2 - 1, zl0 + S.ledge, x1 - S.frame, ys + 0.01, zLip + 1)));
        const t = L.sections.length === 1 ? text : lines.length === L.sections.length ? lines[i] : (lines[i] ?? '');
        if (t) {
          const yb = ys + S.depth;
          const m = frontText(w, s, t, { x0: x0 + S.frame + 0.5, x1: x1 - S.frame - 0.5, z0: zl0 + S.ledge + 0.5, z1: zLip - 0.5 }, yb - 0.5, yb + S.textDepth);
          if (m) cuts.push(m);
        }
      });
      if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    } else if (o.label === 'text' && text) {
      const T = HOPPER.text;
      const x0 = -W / 2 + T.margin;
      const x1 = W / 2 - T.margin;
      const yr = -D / 2 + T.recess;
      const m = frontText(w, s, text, { x0: x0 + 1, x1: x1 - 1, z0: zl0 + 0.6, z1: zLip - 0.6 }, -D / 2 + 0.05, yr + 0.02);
      if (m) {
        // Recess open at the top, text raised from its floor to just inside the front.
        body = s.t(body.subtract(s.t(boxAt(w, x0, -D / 2 - 1, zl0, x1, yr, zLip + 1))));
        body = s.t(w.Manifold.union([body, m]));
      }
    }

    assertValid(body, 'hopper');
    return toMeshData(body);
  } finally {
    s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const HOPPER_CONTAINER: ContainerDef<HopperOptions> = {
  kind: 'hopper',
  label: 'Hopper bin',
  description: 'An open-front pick bin: tall back, low front lip, and a floor that slopes down to the front so parts come to you.',
  defaults: DEFAULT_HOPPER,
  sanitize: (raw) => sanitizeHopper(raw),
  key: hopperKey,
  height: (bin, o) => HEIGHT_UNIT * bin.heightUnits + lipRise({ lip: o.lip }),
  build: (w, bin, o, cells) => buildHopper(w, bin, o, cells),
  summary(_bin, o) {
    const parts = [o.dividers ? `${o.dividers + 1} sections` : '', o.lip ? 'stackable' : ''];
    return parts.filter(Boolean).join(', ');
  },
  notes(bin, o, cells) {
    const L = hopperLayout(bin, o, cells);
    const out: string[] = [];
    if (L.front < o.front - 0.01) out.push(`the front lip is lowered to ${round1(L.front)} mm to leave an opening; make it taller for a higher lip.`);
    if (L.slope < o.slope - 0.05) out.push(`the floor slopes ${round1(L.slope)}°, not ${round1(o.slope)}°, so it rises at most half the bin’s inside height.`);
    if (L.angle > o.angle + 0.05) out.push(`the opening edge is ${round1(L.angle)}°, so it stays steeper than the floor and stops short of the back.`);
    if (L.dividers.length < o.dividers) out.push(`only ${L.dividers.length} dividers fit.`);
    if (o.lip && L.bridge > HOPPER.bridgeWarn) out.push(`the lintel over the opening bridges ${round1(L.bridge)} mm; dividers shorten the bridge.`);
    if (o.label === 'slot' && L.sections.some(([a, b]) => b - a - 2 * HOPPER.slot.margin < HOPPER.slot.minWidth)) out.push('some sections are too narrow for a label slot.');
    if (o.label === 'slot' && L.zLip - L.zLabel < HOPPER.slot.ledge + 3) out.push('the front lip is too low for a label slot.');
    if (o.label !== 'none' && labelLines(o.labelText) && hasFont()) {
      // Text that can't be laid out is left off.
      const box = o.label === 'text' ? { x0: -L.W / 2 + HOPPER.text.margin + 1, x1: L.W / 2 - HOPPER.text.margin - 1, y0: L.zLabel + 0.6, y1: L.zLip - 0.6 } : null;
      if (box && !fitText(labelLines(o.labelText), box, Math.min(LABEL_TEXT.maxCap, 0.8 * (box.y1 - box.y0)))) out.push('the label text doesn’t fit on the front lip.');
    }
    return out;
  },
};

registerContainer(HOPPER_CONTAINER);
