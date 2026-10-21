/**
 * Read PrusaSlicer G-code printed in spiral vase mode and say whether it is a
 * spiral: after the bottom layers, every layer one continuous line whose Z
 * rises along it, with no travel, no retraction, no Z going back down, and
 * each layer starting where the last one ended. Used by scripts/sampler.ts
 * for vase-mode bins (geometry/containers/vase.ts).
 */

export interface GcodeLayer {
  /** Z of the layer change. */
  z: number;
  /** Extruding moves, and their XY length, mm. */
  moves: number;
  length: number;
  /** XY moves without extrusion between the layer's extrusions. */
  travels: number;
  /** Retractions (E going back) between the layer's extrusions (not the one at the end of the print). */
  retracts: number;
  /** Extruding moves whose Z is below the move before. */
  zDrops: number;
  zMin: number;
  zMax: number;
  start: [number, number];
  end: [number, number];
}

export interface SpiralReport {
  layers: number;
  /** Layers before the spiral (the bottom layers). */
  bottom: number;
  /** Layers after the bottom ones that extrude, and how many of them are one rising, continuous line. */
  spiral: number;
  continuous: number;
  /** The first layer that isn't, and why. */
  firstBreak?: { layer: number; z: number; why: string };
  /** XY length of the middle spiral layer, mm: one turn of the spiral. */
  turn: number;
  /** Travel moves and retractions in the bottom layers (normal printing; for the record). */
  bottomTravels: number;
}

/** Parse G-code into layers (PrusaSlicer's `;LAYER_CHANGE` markers). */
export function gcodeLayers(gcode: string): GcodeLayer[] {
  const layers: GcodeLayer[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let relative = false;
  let cur: GcodeLayer | null = null;
  // Travel and retraction since the last extrusion: they count once the layer extrudes again.
  let travels = 0;
  let retracts = 0;
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (line.startsWith(';LAYER_CHANGE')) {
      cur = { z, moves: 0, length: 0, travels: 0, retracts: 0, zDrops: 0, zMin: Infinity, zMax: -Infinity, start: [NaN, NaN], end: [NaN, NaN] };
      layers.push(cur);
      travels = retracts = 0;
      continue;
    }
    if (line.startsWith(';Z:') && cur) cur.z = Number(line.slice(3));
    const code = line.split(';')[0].trim();
    if (!code) continue;
    if (code === 'M83') relative = true;
    else if (code === 'M82') relative = false;
    const g = /^G9[2]\b(.*)$/.exec(code);
    if (g) {
      const m = /E(-?[\d.]+)/.exec(g[1]);
      if (m) e = Number(m[1]);
      continue;
    }
    const mv = /^G[01]\b(.*)$/.exec(code);
    if (!mv) continue;
    const w: Record<string, number> = {};
    for (const t of mv[1].trim().split(/\s+/)) if (t && /^[XYZEF]/.test(t)) w[t[0]] = Number(t.slice(1));
    const nx = w.X ?? x;
    const ny = w.Y ?? y;
    const nz = w.Z ?? z;
    const de = w.E === undefined ? 0 : relative ? w.E : w.E - e;
    if (w.E !== undefined) e = relative ? e + w.E : w.E;
    const xy = Math.hypot(nx - x, ny - y);
    if (cur) {
      if (xy > 1e-9 && de > 0) {
        if (!cur.moves) cur.start = [x, y];
        cur.travels += travels;
        cur.retracts += retracts;
        travels = retracts = 0;
        cur.moves++;
        cur.length += xy;
        cur.end = [nx, ny];
        if (nz < z - 1e-6) cur.zDrops++;
        cur.zMin = Math.min(cur.zMin, nz);
        cur.zMax = Math.max(cur.zMax, nz);
      } else if (cur.moves && xy > 1e-9 && de <= 0) travels++;
      else if (cur.moves && de < 0) retracts++;
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return layers;
}

/** Whether everything after `bottom` layers prints as one spiral. */
export function spiralReport(gcode: string, bottom: number): SpiralReport {
  const layers = gcodeLayers(gcode);
  const spiral = layers.slice(bottom).filter((l) => l.moves);
  let continuous = 0;
  let firstBreak: SpiralReport['firstBreak'];
  spiral.forEach((l, i) => {
    const why: string[] = [];
    if (l.travels) why.push(`${l.travels} travel moves`);
    if (l.retracts) why.push(`${l.retracts} retractions`);
    if (l.zDrops) why.push(`Z goes down ${l.zDrops} times`);
    if (!(l.zMax - l.zMin > 0.05)) why.push('Z does not rise along the layer');
    // Each layer picks up where the one before left off (the first spiral layer starts from the bottom layers).
    if (i > 0 && Math.hypot(l.start[0] - spiral[i - 1].end[0], l.start[1] - spiral[i - 1].end[1]) > 0.5) why.push('starts away from where the last layer ended');
    if (why.length) firstBreak ??= { layer: layers.indexOf(l), z: l.z, why: why.join(', ') };
    else continuous++;
  });
  return {
    layers: layers.length,
    bottom,
    spiral: spiral.length,
    continuous,
    ...(firstBreak ? { firstBreak } : {}),
    turn: Math.round((spiral[Math.floor(spiral.length / 2)]?.length ?? 0) * 10) / 10,
    bottomTravels: layers.slice(0, bottom).reduce((t, l) => t + l.travels + l.retracts, 0),
  };
}
