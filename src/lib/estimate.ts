import type { MeshData } from './geometry/kernel';
import { meshVolume } from './geometry/volume';
import { DEFAULT_MOTION, findPrinter, type PrinterMotion } from './printers';
import type { PrintSetup } from './layout/plan';
import type { PrintJob } from './project';

/**
 * Print-time and cost estimates.
 *
 * The worker slices every mesh once at the 0.20 mm layers of Bambu's
 * "0.20 mm Standard" process (`sliceStats`: area, contour length, contours and
 * islands, up- and down-facing area per layer). Those numbers don't depend on
 * the printer, so the main thread turns them into time for whichever printer
 * is selected (`estimatePlate`): walls, solid top/bottom skin and 15 % sparse
 * infill as the slicer would lay them down, each at its feature speed capped
 * by the hotend's volumetric flow, with a stop-and-go at every corner or line
 * end, travel between islands, a per-layer overhead and Bambu PLA's 4 s
 * minimum layer time, plus the start sequence and any filament swaps.
 *
 * Calibrated against PrusaSlicer 2.7 (whose G-code time estimator Bambu
 * Studio's is derived from) set up like 0.20 mm Standard on an X1C: Bambu's
 * speeds, accelerations, line widths, 21 mm³/s, jerk 9, 4 s layer time,
 * retraction only when crossing walls, solid-over-sparse infill at solid
 * speed. Model ÷ slicer, printing time without the start sequence:
 *   20 mm cube 0.91 (8.3 min), 40×40×60 block 1.11, 1×1×3u bin 1.01
 *   (14.1 min), 1×1×6u 0.93, 1×1×10u 0.90, 2×1×3u with magnets 1.05,
 *   2×2×6u with a label 1.10, 3×2×3u with dividers 0.98, 4×1×2u 1.04,
 *   2×2×3u scoop + magnets/screws 1.07, frame baseplates 5×5 1.16 and 2×2
 *   1.20, 4×4 with magnets 0.82, 3×3 weighted 0.92, a plate of 12 bins 1.05,
 *   a mixed plate with label plates 1.06. Bambu Studio slices a little
 *   differently, so expect ±25 % against it.
 */

/** Bambu Studio "0.20 mm Standard" with Bambu PLA Basic, as the estimate assumes. */
export const STANDARD_PROCESS = {
  layerHeight: 0.2,
  wallLoops: 2,
  topLayers: 5,
  bottomLayers: 3,
  infill: 0.15,
  /** Line widths, mm. */
  width: { outer: 0.42, inner: 0.45, sparse: 0.45, solid: 0.42, top: 0.42, first: 0.5, bridge: 0.4 },
  /** Feature speeds, mm/s. */
  speed: { outer: 200, inner: 300, sparse: 270, solid: 250, top: 200, bridge: 50, first: 50, firstInfill: 105, travel: 500 },
  /** Accelerations, mm/s². */
  accel: { default: 10000, outer: 5000, top: 2000, first: 500, travel: 10000 },
  /** PLA cooling: layers faster than this are slowed down to it, s. */
  minLayerTime: 4,
} as const;

/** Model constants fitted to the slicer (see the module comment). */
export const ESTIMATE_MODEL = {
  /** Corners per contour that slow the walls to a near stop. */
  wallStops: 6,
  /** Gap fill between the walls of a section too thin for all its loops, as a share of the contour length. */
  gapFill: 0.25,
  /** Sparse infill is longer than area × density / width: anchors along the walls and overlap. */
  infillLength: 1.2,
  /** Solid skin overlaps the walls a little. */
  skinLength: 1.05,
  /** Sparse infill lines break at anchors and crossings: this share of the mean chord. */
  chordShare: 0.6,
  /** Retract, lift, travel and unretract to start another island, s (plus the move itself). */
  island: 0.1,
  /** Moving between the wall loops of a contour, s per contour. */
  contour: 0.25,
  /** Infill split up by holes (baseplate cells, magnet pockets): s per hole, when the section has room for infill. */
  fragment: 0.4,
  /** Layer change: lift, travel to the first island, s. */
  layer: 0.2,
  /** Prime tower per layer while it's needed, s and g (2-colour plates). */
  towerSeconds: 1.6,
  towerGrams: 0.03,
  /** Filament flushed per swap, g. */
  flushGrams: 0.45,
} as const;

/** What the time model needs to know about one mesh, per 0.2 mm layer (index 0 = first layer). */
export interface MeshPrintStats {
  layerHeight: number;
  /** Cross-section area, mm². */
  area: Float32Array;
  /** Total contour length, mm. */
  perimeter: Float32Array;
  /** Closed contours (outer boundaries and holes). */
  contours: Uint16Array;
  /** Separate regions (outer boundaries). */
  islands: Uint16Array;
  /** Area of upward-facing surface within the layer (top skin starts under it), mm². */
  up: Float32Array;
  /** Area of downward-facing surface within the layer (bottom skin starts on it), mm². */
  down: Float32Array;
  /** Cross-section area of bodies in filament 2 (inlaid text), mm². */
  overlay: Float32Array;
  /** Solid volume, mm³, and the part of it in filament 2. */
  volume: number;
  overlayVolume: number;
}

/** Slice a mesh (and its overlay bodies) at the layer mid-heights. */
export function sliceStats(mesh: MeshData, layerHeight: number = STANDARD_PROCESS.layerHeight): MeshPrintStats {
  const bodies = [mesh, ...(mesh.overlays ?? [])];
  let top = 0;
  for (const b of bodies) for (let i = 2; i < b.positions.length; i += 3) top = Math.max(top, b.positions[i]);
  const n = Math.max(1, Math.ceil(top / layerHeight - 1e-6));
  const stats: MeshPrintStats = {
    layerHeight,
    area: new Float32Array(n),
    perimeter: new Float32Array(n),
    contours: new Uint16Array(n),
    islands: new Uint16Array(n),
    up: new Float32Array(n),
    down: new Float32Array(n),
    overlay: new Float32Array(n),
    volume: 0,
    overlayVolume: 0,
  };
  bodies.forEach((b, bi) => {
    const v = meshVolume({ positions: b.positions, indices: b.indices });
    stats.volume += v;
    if (bi) stats.overlayVolume += v;
    sliceBody(b.positions, b.indices, layerHeight, n, stats, bi > 0);
  });
  return stats;
}

function sliceBody(pos: ArrayLike<number>, idx: ArrayLike<number>, lh: number, n: number, out: MeshPrintStats, overlay: boolean) {
  const nv = pos.length / 3;
  // Segments, kept for counting contours: layer, the two mesh edges they end on, and their share of the area.
  const segLayer: number[] = [];
  const segA: number[] = [];
  const segB: number[] = [];
  const segArea: number[] = [];
  const area = new Float64Array(n);
  // A vertex exactly on a slicing plane counts as above it.
  const above = (z: number, zk: number) => z >= zk;
  const zs = [0, 0, 0];
  const vs = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    vs[0] = idx[t];
    vs[1] = idx[t + 1];
    vs[2] = idx[t + 2];
    for (let k = 0; k < 3; k++) zs[k] = pos[vs[k] * 3 + 2];
    const ax = pos[vs[0] * 3], ay = pos[vs[0] * 3 + 1];
    const ux = pos[vs[1] * 3] - ax, uy = pos[vs[1] * 3 + 1] - ay, uz = zs[1] - zs[0];
    const wx = pos[vs[2] * 3] - ax, wy = pos[vs[2] * 3 + 1] - ay, wz = zs[2] - zs[0];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const zmin = Math.min(zs[0], zs[1], zs[2]);
    const zmax = Math.max(zs[0], zs[1], zs[2]);
    // Up/down-facing area, spread over the layers the triangle spans. On steep slopes each layer
    // only shows a strip h / tan(slope) wide, which the walls mostly cover.
    const len = Math.hypot(nx, ny, nz);
    const flat = len > 0 ? Math.abs(nz) / len : 0;
    const strip = flat >= 1 ? Infinity : (lh * flat) / Math.sqrt(1 - flat * flat);
    const proj = (nz / 2) * Math.min(1, strip / STANDARD_PROCESS.width.solid);
    if (Math.abs(proj) > 1e-12) {
      const into = proj > 0 ? out.up : out.down;
      const span = zmax - zmin;
      if (span < 1e-6) {
        const k = proj > 0 ? Math.ceil(zmax / lh - 1e-6) - 1 : Math.floor(zmin / lh + 1e-6);
        if (k >= 0 && k < n) into[k] += Math.abs(proj);
      } else {
        const k0 = Math.max(0, Math.floor(zmin / lh));
        const k1 = Math.min(n - 1, Math.ceil(zmax / lh) - 1);
        for (let k = k0; k <= k1; k++) {
          const overlap = Math.min(zmax, (k + 1) * lh) - Math.max(zmin, k * lh);
          if (overlap > 0) into[k] += (Math.abs(proj) * overlap) / span;
        }
      }
    }
    // Cross-sections at layer mid-heights.
    const kFirst = Math.max(0, Math.ceil(zmin / lh - 0.5));
    for (let k = kFirst; k < n; k++) {
      const zk = (k + 0.5) * lh;
      if (zk >= zmax) break;
      if (zk < zmin) continue;
      let px = 0, py = 0, qx = 0, qy = 0;
      let ka = -1, kb = -1;
      let found = 0;
      for (let e = 0; e < 3; e++) {
        const i = e, j = (e + 1) % 3;
        if (above(zs[i], zk) === above(zs[j], zk)) continue;
        const f = (zk - zs[i]) / (zs[j] - zs[i]);
        const x = pos[vs[i] * 3] + f * (pos[vs[j] * 3] - pos[vs[i] * 3]);
        const y = pos[vs[i] * 3 + 1] + f * (pos[vs[j] * 3 + 1] - pos[vs[i] * 3 + 1]);
        const key = Math.min(vs[i], vs[j]) * nv + Math.max(vs[i], vs[j]);
        if (found === 0) {
          px = x;
          py = y;
          ka = key;
        } else {
          qx = x;
          qy = y;
          kb = key;
        }
        found++;
      }
      if (found !== 2) continue;
      // Solid on the left: the contour runs along z × normal.
      if ((qx - px) * -ny + (qy - py) * nx < 0) {
        [px, qx] = [qx, px];
        [py, qy] = [qy, py];
        [ka, kb] = [kb, ka];
      }
      const a = (px * qy - qx * py) / 2;
      area[k] += a;
      out.perimeter[k] += Math.hypot(qx - px, qy - py);
      segLayer.push(k);
      segA.push(ka);
      segB.push(kb);
      segArea.push(a);
    }
  }
  for (let k = 0; k < n; k++) {
    out.area[k] += Math.max(0, area[k]);
    if (overlay) out.overlay[k] += Math.max(0, area[k]);
  }
  // Contours: segments joined through the mesh edges they end on, layer by layer.
  const count = new Int32Array(n + 1);
  for (const k of segLayer) count[k + 1]++;
  for (let k = 0; k < n; k++) count[k + 1] += count[k];
  const order = new Int32Array(segLayer.length);
  const fill = count.slice();
  segLayer.forEach((k, i) => (order[fill[k]++] = i));
  for (let k = 0; k < n; k++) {
    const node = new Map<number, number>();
    const parent: number[] = [];
    const find = (x: number): number => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    const id = (key: number) => {
      let v = node.get(key);
      if (v === undefined) {
        v = parent.length;
        parent.push(v);
        node.set(key, v);
      }
      return v;
    };
    const segs = order.subarray(count[k], count[k + 1]);
    for (const s of segs) {
      const a = find(id(segA[s]));
      const b = find(id(segB[s]));
      if (a !== b) parent[a] = b;
    }
    const loopArea = new Map<number, number>();
    for (const s of segs) {
      const r = find(id(segA[s]));
      loopArea.set(r, (loopArea.get(r) ?? 0) + segArea[s]);
    }
    let contours = 0;
    let islands = 0;
    for (const a of loopArea.values()) {
      if (Math.abs(a) < 1e-4) continue;
      contours++;
      if (a > 0) islands++;
    }
    out.contours[k] = Math.min(65535, out.contours[k] + contours);
    out.islands[k] = Math.min(65535, out.islands[k] + islands);
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Time to print `length` mm as lines of `segment` mm, stopping at each end
 * (trapezoid profile). Zig-zag fills (`step` = line spacing) also pay for the
 * short connector between one line and the next.
 */
export function moveTime(length: number, segment: number, speed: number, accel: number, step = 0): number {
  if (length <= 0) return 0;
  const s = Math.max(1e-3, Math.min(segment, length));
  const count = length / s;
  // Too short to reach full speed: accelerate for half, brake for half.
  const each = s >= (speed * speed) / accel ? s / speed + speed / accel : 2 * Math.sqrt(s / accel);
  return count * (each + (step > 0 ? 2 * Math.sqrt(step / accel) : 0));
}

/** The process's feature speeds and accelerations, limited by the printer. */
export function featureMotion(m: PrinterMotion) {
  const P = STANDARD_PROCESS;
  const h = P.layerHeight;
  const cap = (v: number, w: number) => Math.min(v, m.speed, m.flow / (w * h));
  const acc = (a: number) => Math.min(a, m.accel);
  return {
    outer: { v: cap(P.speed.outer, P.width.outer), a: acc(P.accel.outer) },
    inner: { v: cap(P.speed.inner, P.width.inner), a: acc(P.accel.default) },
    sparse: { v: cap(P.speed.sparse, P.width.sparse), a: acc(P.accel.default) },
    solid: { v: cap(P.speed.solid, P.width.solid), a: acc(P.accel.default) },
    top: { v: cap(P.speed.top, P.width.top), a: acc(P.accel.top) },
    bridge: { v: cap(P.speed.bridge, P.width.bridge), a: acc(P.accel.default) },
    firstWall: { v: cap(P.speed.first, P.width.first), a: acc(P.accel.first) },
    firstInfill: { v: cap(P.speed.firstInfill, P.width.first), a: acc(P.accel.first) },
    travel: { v: Math.min(P.speed.travel, m.speed), a: acc(P.accel.travel) },
  };
}

type Motion = ReturnType<typeof featureMotion>;

/** Where the time goes. */
export interface TimeBreakdown {
  walls: number;
  /** Solid top and bottom skin (first layer and bridges included). */
  skin: number;
  /** Sparse infill. */
  infill: number;
  /** Travel, retraction and layer changes. */
  travel: number;
  /** Slowed down to the minimum layer time. */
  cooling: number;
  /** Filament swaps and the prime tower. */
  swaps: number;
}

const emptyBreakdown = (): TimeBreakdown => ({ walls: 0, skin: 0, infill: 0, travel: 0, cooling: 0, swaps: 0 });

/** One part's share of a layer: seconds (added to `into`) and extruded mm³. */
function partLayer(s: MeshPrintStats, k: number, mo: Motion, footprint: number, into: TimeBreakdown) {
  const P = STANDARD_PROCESS;
  const M = ESTIMATE_MODEL;
  const h = P.layerHeight;
  const A = s.area[k];
  const perim = s.perimeter[k];
  const contours = s.contours[k];
  if (A <= 0 || perim <= 0) return { seconds: 0, volume: 0 };
  const t0 = { ...into };
  const first = k === 0;
  // Walls: two loops on every contour, or all of a section too thin for them (with gap fill between).
  const wWall = first ? P.width.first : (P.width.outer + P.width.inner) / 2;
  const fullWalls = perim * P.wallLoops * wWall;
  const wallArea = Math.min(A, fullWalls);
  const thin = Math.min(1, Math.max(0, (4 * (fullWalls - A)) / fullWalls));
  const wallLen = wallArea / wWall + thin * M.gapFill * perim;
  const outerLen = Math.min(wallLen, perim);
  const innerLen = wallLen - outerLen;
  const corner = perim / Math.max(1, contours * M.wallStops);
  // Inside the walls: skin under top surfaces / over bottom surfaces, sparse infill elsewhere.
  const inside = A - wallArea;
  let skin = 0;
  let topSkin = 0;
  let bridge = 0;
  if (first) skin = inside;
  else {
    let upNear = 0;
    for (let j = k; j < Math.min(s.area.length, k + P.topLayers); j++) upNear += s.up[j];
    let downNear = 0;
    for (let j = Math.max(0, k - P.bottomLayers + 1); j <= k; j++) downNear += s.down[j];
    skin = Math.min(inside, upNear + downNear);
    topSkin = Math.min(skin, s.up[k]);
    bridge = Math.min(skin - topSkin, s.down[k]);
  }
  const sparse = inside - skin;
  // Solid lines zig-zag across a region, each about as long as its mean chord (Cauchy: π·A / perimeter);
  // sparse lines are broken up shorter.
  const line = Math.max(1, (Math.PI * Math.max(inside, 0)) / perim);
  const sparseLine = Math.max(1, M.chordShare * line);
  const solid = (area: number, w: number) => (area * M.skinLength) / w;
  let vol = 0;
  if (first) {
    into.walls += moveTime(wallLen, corner, mo.firstWall.v, mo.firstWall.a);
    into.skin += moveTime(solid(inside, P.width.first), line, mo.firstInfill.v, mo.firstInfill.a, P.width.first);
    vol = A * h;
  } else {
    into.walls += moveTime(outerLen, corner, mo.outer.v, mo.outer.a) + moveTime(innerLen, corner, mo.inner.v, mo.inner.a);
    into.skin +=
      moveTime(solid(topSkin, P.width.top), line, mo.top.v, mo.top.a, P.width.top) +
      moveTime(solid(bridge, P.width.bridge), line, mo.bridge.v, mo.bridge.a, P.width.bridge) +
      moveTime(solid(skin - topSkin - bridge, P.width.solid), line, mo.solid.v, mo.solid.a, P.width.solid);
    into.infill += moveTime((sparse * P.infill * M.infillLength) / P.width.sparse, sparseLine, mo.sparse.v, mo.sparse.a);
    vol = (wallArea + skin + sparse * P.infill) * h;
  }
  // Getting there: a hop to each island (the first from the previous part), between wall loops, and between
  // pieces of infill that holes split up.
  const islands = Math.max(1, s.islands[k]);
  const holes = Math.max(0, contours - s.islands[k]);
  const hop = Math.sqrt(Math.max(footprint, 1));
  into.travel +=
    islands * (M.island + moveTime(hop, hop, mo.travel.v, mo.travel.a)) +
    contours * M.contour +
    holes * Math.min(1, inside / Math.max(wallArea, 1e-6)) * M.fragment;
  const seconds = into.walls + into.skin + into.infill + into.travel - (t0.walls + t0.skin + t0.infill + t0.travel);
  return { seconds, volume: vol };
}

export interface PlateEstimate {
  /** Start sequence included, s. */
  seconds: number;
  /** Printing alone, s. */
  printSeconds: number;
  /** Start sequence (heating, levelling, purge line), s. */
  prepareSeconds: number;
  layers: number;
  /** Filament swaps for parts in two colours. */
  swaps: number;
  /** Filament flushed and printed into the prime tower for the swaps, g. */
  wasteGrams: number;
  /** Extruded volume the estimate lays down, mm³ (a cross-check on the filament figure). */
  extruded: number;
  breakdown: TimeBreakdown;
}

export interface EstimatePart {
  stats: MeshPrintStats;
  /** Footprint on the bed, mm. */
  w: number;
  d: number;
}

/** Print time of one plate on a printer. */
export function estimatePlate(parts: EstimatePart[], motion: PrinterMotion = DEFAULT_MOTION): PlateEstimate {
  const P = STANDARD_PROCESS;
  const M = ESTIMATE_MODEL;
  const mo = featureMotion(motion);
  const layers = parts.reduce((t, p) => Math.max(t, p.stats.area.length), 0);
  const breakdown = emptyBreakdown();
  let print = 0;
  let extruded = 0;
  let swaps = 0;
  let lastSwap = -1;
  for (let k = 0; k < layers; k++) {
    let t = M.layer;
    breakdown.travel += M.layer;
    let twoColour = false;
    for (const p of parts) {
      if (k >= p.stats.area.length) continue;
      const r = partLayer(p.stats, k, mo, p.w * p.d, breakdown);
      t += r.seconds;
      extruded += r.volume;
      if (p.stats.overlay[k] > 0) twoColour = true;
    }
    if (twoColour) {
      swaps++;
      lastSwap = k;
    }
    breakdown.cooling += Math.max(0, P.minLayerTime - t);
    print += Math.max(t, P.minLayerTime);
  }
  // The prime tower is printed on every layer up to the last swap.
  const tower = lastSwap + 1;
  breakdown.swaps = swaps * motion.swap + tower * M.towerSeconds;
  print += breakdown.swaps;
  return {
    seconds: print + (layers ? motion.prepare : 0),
    printSeconds: print,
    prepareSeconds: layers ? motion.prepare : 0,
    layers,
    swaps,
    wasteGrams: swaps * M.flushGrams + tower * M.towerGrams,
    extruded,
    breakdown,
  };
}

/** Per-plate estimates for a job; null for plates with parts not sliced yet. */
export function estimateJob(
  job: PrintJob,
  stats: (meshKey: string) => MeshPrintStats | undefined,
  printerId: string,
): (PlateEstimate | null)[] {
  const motion = findPrinter(printerId).motion ?? DEFAULT_MOTION;
  return job.plates.map((pl) => {
    const parts: EstimatePart[] = [];
    for (const p of pl.placements) {
      const part = job.parts[p.key];
      const s = stats(part.meshKey);
      if (!s) return null;
      parts.push({ stats: s, w: part.w, d: part.d });
    }
    return estimatePlate(parts, motion);
  });
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export const DEFAULT_FILAMENT_PRICE = 20;

export interface CostBreakdown {
  filament: number;
  energy: number;
  total: number;
}

/**
 * Cost of a plate: filament 1 and 2 at their prices per kg (purge waste at the
 * mean of the two), and electricity for the whole run when a kWh price is set.
 */
export function plateCost(
  grams: { main: number; second: number; waste: number },
  seconds: number,
  setup: Pick<PrintSetup, 'filamentPrice' | 'filamentPrice2' | 'kwhPrice' | 'printerWatts' | 'printerId'>,
): CostBreakdown {
  const p1 = setup.filamentPrice ?? DEFAULT_FILAMENT_PRICE;
  const p2 = setup.filamentPrice2 ?? p1;
  const filament = (grams.main * p1 + grams.second * p2 + grams.waste * ((p1 + p2) / 2)) / 1000;
  const watts = setup.printerWatts ?? (findPrinter(setup.printerId).motion ?? DEFAULT_MOTION).watts;
  const energy = setup.kwhPrice ? ((watts * seconds) / 3600 / 1000) * setup.kwhPrice : 0;
  return { filament, energy, total: filament + energy };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "45 min", "3 h 05 min". */
export function formatDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

const LOCALE_CURRENCY: Record<string, string> = {
  US: '$', CA: '$', AU: '$', NZ: '$', MX: '$', GB: '£', JP: '¥', CN: '¥', IN: '₹', KR: '₩', CH: 'CHF', SE: 'kr', NO: 'kr', DK: 'kr',
  PL: 'zł', CZ: 'Kč', BR: 'R$', ZA: 'R', IL: '₪', TR: '₺', RU: '₽', UA: '₴', HU: 'Ft', SG: '$', HK: '$',
};
const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);

/** The currency symbol to show: the setting, or a guess from the browser's locale. */
export function currencySymbol(setting: string | undefined, locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language): string {
  if (setting?.trim()) return setting.trim();
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase() ?? '';
  if (EURO.has(region)) return '€';
  return LOCALE_CURRENCY[region] ?? '$';
}

/** "$1.24", "12 kr" (symbols of more than one character go after the amount). */
export function formatMoney(amount: number, symbol: string): string {
  const v = amount.toFixed(2);
  return symbol.length > 1 && !symbol.endsWith('$') ? `${v} ${symbol}` : `${symbol}${v}`;
}
