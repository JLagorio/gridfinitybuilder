/**
 * Icons for label text, after the fragments of the open-source gflabel tool:
 * `{bolt}`, `{bolt:12}` (a length in mm), `{screw:socket}`, `{nut}`, `{washer}`,
 * `{magnet}`, `{|}` (a divider), `{<}` / `{>}` (align the line), `{...}` (a
 * spring that pushes what follows to the right edge) and so on. gflabel's
 * `{bolt(12)}` spelling works too, and so do its names (`{hexnut}`,
 * `{lockwasher}`, `{threaded_insert}` …).
 *
 * Icons are clean 2D vector outlines: closed contours, nonzero fill (holes run
 * the other way, and only ever sit inside exactly one outer shape), in "cap
 * units": the icon stands on the baseline (y = 0) and is one cap height tall
 * (y = 1), so it lines up with capitals. `textOutline` lays them out inline
 * with the letters, so they work wherever text does: label tabs, plates,
 * inlaid colour, front labels, sliding lids, pocket and tool-cutout names.
 *
 * Unknown fragments are not fragments: they print as typed, braces and all.
 * `{contents}` is replaced by the first line(s) of the bin's "What's in it" at
 * planning time (labelContents.ts); unresolved it prints nothing.
 *
 * Pure: no WASM, no DOM.
 */
import type { Contour } from './font';

/** An icon in cap units: y from 0 (baseline) to 1 (cap height); x from 0 to `width`. */
export interface IconShape {
  contours: Contour[];
  width: number;
}

export interface IconDef {
  /** Fragment name: `{name}`. */
  name: string;
  /** Other names that mean the same icon (gflabel's, common spellings). */
  aliases?: string[];
  /** For the picker. */
  title: string;
  /** What the picker inserts (default `{name}`). */
  insert?: string;
  /** Picker group. */
  group: 'Fasteners' | 'Hardware' | 'Electronics' | 'Layout';
  build(args: string[]): IconShape;
}

/** Space between an icon and the letter or icon next to it (cap units). */
export const ICON_GAP = 0.2;
/** Space either side of a `{|}` divider. */
export const DIVIDER_GAP = 0.4;

// ---------------------------------------------------------------------------
// 2D helpers (cap units)
// ---------------------------------------------------------------------------

type P = [number, number];

export function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += c[j][0] * c[i][1] - c[i][0] * c[j][1];
  return a / 2;
}

/** Counter-clockwise (filled). */
const ccw = (c: Contour): Contour => (signedArea(c) < 0 ? [...c].reverse() : c);
/** Clockwise (a hole in the one shape around it). */
const hole = (c: Contour): Contour => ccw(c).reverse();

const rect = (x0: number, y0: number, x1: number, y1: number): Contour => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Rounded rectangle; radii per corner [bottom-left, bottom-right, top-right, top-left]. */
function rrect(x0: number, y0: number, x1: number, y1: number, r: number | [number, number, number, number], seg = 6): Contour {
  const rs = typeof r === 'number' ? [r, r, r, r] : r;
  const corners: [number, number, number][] = [
    [x0 + rs[0], y0 + rs[0], 180],
    [x1 - rs[1], y0 + rs[1], 270],
    [x1 - rs[2], y1 - rs[2], 0],
    [x0 + rs[3], y1 - rs[3], 90],
  ];
  const out: Contour = [];
  corners.forEach(([cx, cy, a0], i) => {
    const rr = rs[i];
    if (rr <= 1e-9) {
      out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]][i] as P);
      return;
    }
    for (let k = 0; k <= seg; k++) {
      const a = ((a0 + (90 * k) / seg) * Math.PI) / 180;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  });
  return out;
}

function circle(cx: number, cy: number, r: number, n = 28): Contour {
  const out: Contour = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Annular sector from angle a0 to a1 (degrees, a1 > a0), one CCW contour. */
function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n = 24): Contour {
  const out: Contour = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]);
  }
  for (let i = n; i >= 0; i--) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)]);
  }
  return out;
}

/** A polyline drawn with a round pen of this width: a quad per segment and a disc per vertex (they overlap; nonzero fills the union). */
function stroke(pts: P[], width: number): Contour[] {
  const h = width / 2;
  const out: Contour[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const nx = (-(by - ay) / len) * h;
    const ny = ((bx - ax) / len) * h;
    out.push(
      ccw([
        [ax + nx, ay + ny],
        [ax - nx, ay - ny],
        [bx - nx, by - ny],
        [bx + nx, by + ny],
      ]),
    );
  }
  for (const [x, y] of pts) out.push(circle(x, y, h, 12));
  return out;
}

/** Pointy-top hexagon. */
function hexagon(cx: number, cy: number, R: number): Contour {
  const out: Contour = [];
  for (let i = 0; i < 6; i++) {
    const a = ((90 + 60 * i) * Math.PI) / 180;
    out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return out;
}

/**
 * Threaded shaft from x0 to x1 between y0 and y1 (crests), teeth `depth` deep
 * at `pitch`. `tip` > 0 tapers the last `tip` to a point (wood / tapping screws).
 */
function threaded(x0: number, x1: number, y0: number, y1: number, pitch: number, depth: number, tip = 0): Contour {
  const yc = (y0 + y1) / 2;
  const half = pitch / 2;
  const n = Math.max(1, Math.floor((x1 - x0 - (tip ? 0.05 : depth)) / half));
  const taper = (x: number) => (tip > 0 ? Math.min(1, Math.max(0, (x - (x1 - tip)) / tip)) : 0);
  const lo: P[] = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + k * half;
    const t = taper(x);
    const root = k % 2 ? depth * (1 - t) : 0;
    lo.push([x, y0 + (yc - y0) * t + root]);
  }
  const hi: P[] = lo.map(([x, y]) => [x, y1 - (y - y0)]);
  const end: P[] = tip > 0 ? [[x1, yc]] : [
    [x1, y0 + depth],
    [x1, y1 - depth],
  ];
  return ccw([...lo, ...end, ...hi.reverse()]);
}

const num = (v: string) => (/^\d+(\.\d+)?\s*(mm)?$/i.test(v.trim()) ? parseFloat(v) : null);

// ---------------------------------------------------------------------------
// Fasteners
// ---------------------------------------------------------------------------

type Head = 'hex' | 'pan' | 'flat' | 'socket' | 'button';

const HEADS: Record<string, Head> = {
  hex: 'hex',
  hexagon: 'hex',
  bolt: 'hex',
  pan: 'pan',
  round: 'pan',
  cheese: 'pan',
  flat: 'flat',
  countersunk: 'flat',
  csk: 'flat',
  socket: 'socket',
  allen: 'socket',
  cap: 'socket',
  shcs: 'socket',
  button: 'button',
  dome: 'button',
};

/** Shaft: 0.46 cap units across, on the middle of the line. */
const SHAFT_Y0 = 0.27;
const SHAFT_Y1 = 0.73;

function headShape(head: Head): { contours: Contour[]; width: number } {
  switch (head) {
    case 'hex':
      // Side view across the corners: two face lines along the axis.
      return {
        width: 0.42,
        contours: [rrect(0, 0, 0.42, 1, 0.05), hole(rect(0.07, 0.21, 0.35, 0.31)), hole(rect(0.07, 0.69, 0.35, 0.79))],
      };
    case 'socket':
      // Cylinder head, the socket's opening notched into its face.
      return {
        width: 0.42,
        contours: [
          ccw([
            [0.08, 0.06],
            [0.42, 0.06],
            [0.42, 0.94],
            [0.08, 0.94],
            [0, 0.86],
            [0, 0.65],
            [0.13, 0.65],
            [0.13, 0.35],
            [0, 0.35],
            [0, 0.14],
          ]),
        ],
      };
    case 'flat':
      return {
        width: 0.4,
        contours: [
          ccw([
            [0, 0],
            [0.07, 0],
            [0.4, SHAFT_Y0],
            [0.4, SHAFT_Y1],
            [0.07, 1],
            [0, 1],
          ]),
        ],
      };
    case 'button':
      return { width: 0.3, contours: [rrect(0, 0.12, 0.3, 0.88, [0.28, 0, 0, 0.28], 8)] };
    case 'pan':
    default:
      return { width: 0.38, contours: [rrect(0, 0.06, 0.38, 0.94, [0.24, 0, 0, 0.24], 8)] };
  }
}

/**
 * A screw or bolt in side view, head on the left. Arguments in any order: a
 * length in mm (the shaft is drawn longer for longer screws), a head style
 * (hex, pan, flat / countersunk, socket, button) and `wood` / `tapping` for a
 * pointed tip.
 */
function screw(args: string[], defHead: Head): IconShape {
  let head = defHead;
  let len: number | null = null;
  let tip = false;
  for (const raw of args) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    const n = num(v);
    if (n !== null) len = n;
    else if (HEADS[v]) head = HEADS[v];
    else if (v === 'wood' || v === 'tapping' || v === 'pointed' || v === 'self-tapping') tip = true;
  }
  const L = len === null ? 1.5 : Math.min(3.5, Math.max(0.8, 0.5 + len * 0.05));
  const h = headShape(head);
  const x0 = h.width - 0.04;
  const x1 = h.width + L;
  return { width: x1, contours: [...h.contours, threaded(x0, x1, SHAFT_Y0, SHAFT_Y1, 0.15, 0.07, tip ? 0.32 : 0)] };
}

function nut(): IconShape {
  const R = 0.5;
  const cx = (Math.sqrt(3) / 2) * R;
  return { width: 2 * cx, contours: [hexagon(cx, 0.5, R), hole(circle(cx, 0.5, 0.22))] };
}

function locknut(): IconShape {
  // Side view: the hex body and its nylon dome.
  return {
    width: 0.78,
    contours: [
      rrect(0, 0, 0.5, 1, 0.05),
      hole(rect(0.07, 0.21, 0.43, 0.31)),
      hole(rect(0.07, 0.69, 0.43, 0.79)),
      rrect(0.46, 0.14, 0.78, 0.86, [0, 0.24, 0.24, 0], 8),
    ],
  };
}

function washer(): IconShape {
  return { width: 1, contours: [circle(0.5, 0.5, 0.5, 40), hole(circle(0.5, 0.5, 0.22))] };
}

function springWasher(): IconShape {
  // A split ring: the gap at the top.
  return { width: 1, contours: [sector(0.5, 0.5, 0.24, 0.5, 103, 437, 36)] };
}

function insert(): IconShape {
  // Heat-set insert in side view: a knurled body with a groove in the middle.
  const lo: P[] = [
    [0, 0.24],
    [0.1, 0.1],
  ];
  const teeth = (xa: number, xb: number, base: number, dir: 1 | -1) => {
    const out: P[] = [];
    const n = Math.max(1, Math.round((xb - xa) / 0.14));
    const step = (xb - xa) / n;
    for (let i = 0; i < n; i++) {
      out.push([xa + i * step, base], [xa + (i + 0.6) * step, base + dir * 0.09]);
    }
    out.push([xb, base]);
    return out;
  };
  lo.push(...teeth(0.12, 0.44, 0.1, 1), [0.47, 0.22], [0.53, 0.22], ...teeth(0.56, 0.9, 0.1, 1), [1, 0.2]);
  const hi: P[] = lo.map(([x, y]) => [x, 1 - y]);
  return { width: 1, contours: [ccw([...lo, ...hi.reverse()])] };
}

function standoff(): IconShape {
  // Male–female hex standoff: threaded stud on the left.
  return {
    width: 1.3,
    contours: [
      rrect(0.3, 0.1, 1.3, 0.9, 0.05),
      hole(rect(0.37, 0.27, 1.23, 0.35)),
      hole(rect(0.37, 0.65, 1.23, 0.73)),
      threaded(0, 0.34, 0.3, 0.7, 0.12, 0.06),
    ],
  };
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

function magnet(): IconShape {
  // Horseshoe, open at the top, its pole tips set off by a gap.
  const R = 0.5;
  const r = 0.2;
  const cx = 0.5;
  const cy = 0.5;
  const legTop = 0.7;
  const pts: P[] = [[0, legTop]];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI + (Math.PI * i) / 24;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  pts.push([1, legTop], [cx + r, legTop]);
  for (let i = 24; i >= 0; i--) {
    const a = Math.PI + (Math.PI * i) / 24;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts.push([cx - r, legTop]);
  return { width: 1, contours: [ccw(pts), rect(0, 0.78, 0.3, 1), rect(0.7, 0.78, 1, 1)] };
}

function battery(): IconShape {
  return {
    width: 1.62,
    contours: [
      rrect(0, 0.18, 1.46, 0.82, 0.1),
      hole(rrect(0.1, 0.28, 1.36, 0.72, 0.04)),
      rect(1.41, 0.36, 1.62, 0.64),
      // + at the nub end, − at the other.
      rect(0.96, 0.46, 1.2, 0.54),
      rect(1.04, 0.38, 1.12, 0.62),
      rect(0.24, 0.46, 0.48, 0.54),
    ],
  };
}

function spring(): IconShape {
  const coils = 5;
  const x0 = 0.06;
  const x1 = 1.26;
  const pts: P[] = [];
  for (let i = 0; i <= 2 * coils; i++) pts.push([x0 + ((x1 - x0) * i) / (2 * coils), i % 2 ? 0.94 : 0.06]);
  return { width: x1 + x0, contours: stroke(pts, 0.11) };
}

function bearing(): IconShape {
  const c = 0.5;
  const balls: Contour[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    balls.push(circle(c + 0.275 * Math.cos(a), c + 0.275 * Math.sin(a), 0.066, 14));
  }
  return {
    width: 1,
    contours: [circle(c, c, 0.5, 40), hole(circle(c, c, 0.38, 40)), ...balls, circle(c, c, 0.17, 24), hole(circle(c, c, 0.08, 16))],
  };
}

function zipTie(): IconShape {
  return {
    width: 1.95,
    contours: [
      rrect(0, 0.18, 0.42, 0.82, 0.08),
      hole(rect(0.12, 0.4, 0.3, 0.6)),
      ccw([
        [0.4, 0.42],
        [1.7, 0.42],
        [1.95, 0.47],
        [1.95, 0.53],
        [1.7, 0.58],
        [0.4, 0.58],
      ]),
    ],
  };
}

function drill(): IconShape {
  const flutes: Contour[] = [];
  for (let i = 0; i < 3; i++) {
    const x = 0.64 + i * 0.25;
    flutes.push(
      hole([
        [x, 0.37],
        [x + 0.09, 0.37],
        [x + 0.21, 0.63],
        [x + 0.12, 0.63],
      ]),
    );
  }
  return {
    width: 1.76,
    contours: [
      rect(0, 0.34, 0.52, 0.66),
      ccw([
        [0.5, 0.3],
        [1.46, 0.3],
        [1.76, 0.5],
        [1.46, 0.7],
        [0.5, 0.7],
      ]),
      ...flutes,
    ],
  };
}

// ---------------------------------------------------------------------------
// Electronics
// ---------------------------------------------------------------------------

function fuse(): IconShape {
  // Glass cartridge fuse: end caps, tube, wire.
  return {
    width: 1.5,
    contours: [
      rect(0, 0.22, 0.3, 0.78),
      rect(1.2, 0.22, 1.5, 0.78),
      rect(0.26, 0.3, 1.24, 0.7),
      hole(rect(0.34, 0.38, 1.16, 0.62)),
      rect(0.3, 0.46, 1.2, 0.54),
    ],
  };
}

function led(): IconShape {
  return {
    width: 0.7,
    contours: [
      rect(0.03, 0.3, 0.67, 0.4),
      rrect(0.1, 0.38, 0.6, 1, [0, 0, 0.25, 0.25], 10),
      rect(0.16, 0, 0.26, 0.32),
      rect(0.44, 0.1, 0.54, 0.32),
    ],
  };
}

function resistor(): IconShape {
  const bands = [0.58, 0.75, 0.92, 1.1].map((x) => hole(rect(x, 0.27, x + 0.08, 0.73)));
  return {
    width: 1.7,
    contours: [rect(0, 0.46, 0.42, 0.54), rect(1.28, 0.46, 1.7, 0.54), rrect(0.35, 0.22, 1.35, 0.78, 0.2), ...bands],
  };
}

function capacitor(): IconShape {
  return {
    width: 1.24,
    contours: [rect(0, 0.46, 0.5, 0.54), rect(0.74, 0.46, 1.24, 0.54), rect(0.44, 0.1, 0.56, 0.9), rect(0.68, 0.1, 0.8, 0.9)],
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function divider(): IconShape {
  return { width: 0.1, contours: [rect(0, -0.12, 0.1, 1.12)] };
}

export const ICONS: readonly IconDef[] = [
  { name: 'bolt', title: 'Bolt (hex head); {bolt:12} for a 12 mm one', insert: '{bolt:12}', group: 'Fasteners', build: (a) => screw(a, 'hex') },
  { name: 'screw', title: 'Screw (pan head); {screw:socket:12}, {screw:flat}, {screw:wood} …', group: 'Fasteners', build: (a) => screw(a, 'pan') },
  { name: 'socket', aliases: ['shcs', 'capscrew'], title: 'Socket head cap screw', insert: '{screw:socket}', group: 'Fasteners', build: (a) => screw(a, 'socket') },
  { name: 'countersunk', aliases: ['csk'], title: 'Countersunk (flat head) screw', insert: '{screw:flat}', group: 'Fasteners', build: (a) => screw(a, 'flat') },
  { name: 'woodscrew', title: 'Wood / tapping screw', insert: '{screw:wood}', group: 'Fasteners', build: (a) => screw([...a, 'wood'], 'pan') },
  { name: 'nut', aliases: ['hexnut', 'hex_nut'], title: 'Hex nut', group: 'Fasteners', build: nut },
  { name: 'locknut', aliases: ['locknut_profile', 'nylock', 'lock_nut'], title: 'Lock nut (nylon insert)', group: 'Fasteners', build: locknut },
  { name: 'washer', title: 'Washer', group: 'Fasteners', build: washer },
  { name: 'spring_washer', aliases: ['lockwasher', 'lock_washer', 'springwasher', 'split_washer'], title: 'Spring (split) washer', group: 'Fasteners', build: springWasher },
  { name: 'insert', aliases: ['threaded_insert', 'heatset', 'heat_set', 'heatset_insert'], title: 'Heat-set threaded insert', group: 'Fasteners', build: insert },
  { name: 'standoff', aliases: ['spacer_hex'], title: 'Hex standoff', group: 'Fasteners', build: standoff },
  { name: 'magnet', title: 'Magnet', group: 'Hardware', build: magnet },
  { name: 'spring', title: 'Spring', group: 'Hardware', build: spring },
  { name: 'bearing', title: 'Ball bearing', group: 'Hardware', build: bearing },
  { name: 'zip', aliases: ['ziptie', 'zip_tie', 'cable_tie'], title: 'Zip tie', group: 'Hardware', build: zipTie },
  { name: 'drill', aliases: ['drill_bit', 'bit'], title: 'Drill bit', group: 'Hardware', build: drill },
  { name: 'battery', aliases: ['cell'], title: 'Battery', group: 'Electronics', build: battery },
  { name: 'fuse', title: 'Fuse', group: 'Electronics', build: fuse },
  { name: 'led', title: 'LED', group: 'Electronics', build: led },
  { name: 'resistor', title: 'Resistor', group: 'Electronics', build: resistor },
  { name: 'capacitor', aliases: ['cap'], title: 'Capacitor', group: 'Electronics', build: capacitor },
  { name: '|', title: 'Divider line', group: 'Layout', build: divider },
];

const BY_NAME = new Map<string, IconDef>();
for (const d of ICONS) for (const n of [d.name, ...(d.aliases ?? [])]) BY_NAME.set(n, d);

/** The icon definition for a fragment name (or alias), case-insensitive. */
export function iconDef(name: string): IconDef | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

const shapeCache = new Map<string, IconShape>();

/** An icon's outline (cached per name and arguments). */
export function iconShape(def: IconDef, args: string[]): IconShape {
  const k = `${def.name}|${args.join(',')}`;
  let s = shapeCache.get(k);
  if (!s) {
    s = def.build(args);
    shapeCache.set(k, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

export type LabelToken =
  /** Ordinary text (may be one character or many). */
  | { kind: 'text'; text: string }
  | { kind: 'icon'; name: string; icon: IconShape; divider: boolean }
  /** `{...}`: soaks up the line's spare width (pushes what follows right). */
  | { kind: 'spring' }
  /** `{<}` / `{>}`: align this line to the left / right of the label. */
  | { kind: 'align'; align: 'left' | 'right' }
  /** `{contents}` not resolved yet: prints nothing. */
  | { kind: 'blank' };

/** Longest fragment body we look at. */
const MAX_FRAGMENT = 48;
const FRAGMENT_AT = /^\{([^{}\n]{1,48})\}/;

/** `{contents}` and `{contents:2}`: the first line(s) of "What's in it". */
export const CONTENTS_FRAGMENT = /\{\s*contents?\s*(?:[:(]\s*([1-3])\s*\)?)?\s*\}/gi;

/** What a fragment body (between the braces) means, or null when it isn't one (it then prints as text). */
export function parseFragment(body: string): Exclude<LabelToken, { kind: 'text' }> | null {
  const b = body.trim();
  if (b === '<') return { kind: 'align', align: 'left' };
  if (b === '>') return { kind: 'align', align: 'right' };
  if (b === '...' || b === '…') return { kind: 'spring' };
  if (b === '|') return { kind: 'icon', name: '|', icon: iconShape(BY_NAME.get('|')!, []), divider: true };
  const m = /^([a-z_][a-z0-9_-]*)\s*(?:\((.*)\)|:(.*))?$/i.exec(b);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (name === 'contents' || name === 'content') {
    const arg = (m[2] ?? m[3] ?? '').trim();
    return !arg || /^[1-3]$/.test(arg) ? { kind: 'blank' } : null;
  }
  const def = BY_NAME.get(name);
  if (!def) return null;
  const args = (m[2] ?? m[3] ?? '')
    .split(/[,:]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 4);
  return { kind: 'icon', name: def.name, icon: iconShape(def, args), divider: false };
}

/** Split one line of label text into text and fragments. Unknown fragments stay text. */
export function labelTokens(line: string): LabelToken[] {
  const out: LabelToken[] = [];
  let text = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '{') {
      const m = FRAGMENT_AT.exec(line.slice(i, i + MAX_FRAGMENT + 2));
      const f = m && parseFragment(m[1]);
      if (m && f) {
        if (text) out.push({ kind: 'text', text });
        text = '';
        out.push(f);
        i += m[0].length;
        continue;
      }
    }
    text += line[i];
    i++;
  }
  if (text) out.push({ kind: 'text', text });
  return out;
}

/** True when the text has any fragment (icons, alignment, `{contents}`). */
export function hasFragments(text: string): boolean {
  if (!text.includes('{')) return false;
  return text.split('\n').some((l) => labelTokens(l).some((t) => t.kind !== 'text'));
}

/**
 * Length of label text the way the limit counts it: a fragment is one
 * character. Returns the longest prefix of `text` within `maxChars` (and
 * `maxRaw` code units in all).
 */
export function truncateLabel(text: string, maxChars: number, maxRaw: number): string {
  let i = 0;
  let n = 0;
  while (i < text.length && n < maxChars) {
    let step = 0;
    if (text[i] === '{') {
      const m = FRAGMENT_AT.exec(text.slice(i, i + MAX_FRAGMENT + 2));
      if (m && parseFragment(m[1])) step = m[0].length;
    }
    if (!step) step = text.codePointAt(i)! > 0xffff ? 2 : 1;
    if (i + step > maxRaw) break;
    i += step;
    n++;
  }
  return text.slice(0, i);
}

/** Plain-words version of label text, for part names and lists: icons as their names. */
export function labelPlainText(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      labelTokens(line)
        .map((t) => (t.kind === 'text' ? t.text : t.kind === 'icon' ? (t.divider ? ' | ' : ` ${t.name.replace(/_/g, ' ')} `) : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n');
}
