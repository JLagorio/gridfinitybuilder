/**
 * Minimal TrueType reader: just enough to turn text into outlines for
 * embossed labels. Reads cmap (formats 4 and 12), hmtx, loca and glyf
 * (simple and composite glyphs). No hinting, no kerning.
 */

export type Contour = [number, number][];

export interface Glyph {
  /** Outline in font units, y up. */
  contours: Contour[];
  advance: number;
}

export interface Font {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Height of a capital letter in font units. */
  capHeight: number;
  glyph(codePoint: number): Glyph;
}

/** Quadratic segments per curve when flattening. */
const CURVE_STEPS = 4;

export function parseFont(buffer: ArrayBuffer): Font {
  const view = new DataView(buffer);
  const u16 = (o: number) => view.getUint16(o);
  const i16 = (o: number) => view.getInt16(o);
  const u32 = (o: number) => view.getUint32(o);

  const tables = new Map<string, number>();
  const numTables = u16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    tables.set(tag, u32(rec + 8));
  }
  const table = (tag: string) => {
    const o = tables.get(tag);
    if (o === undefined) throw new Error(`Font is missing the ${tag} table.`);
    return o;
  };

  const head = table('head');
  const unitsPerEm = u16(head + 18);
  const longLoca = i16(head + 50) === 1;
  const numGlyphs = u16(table('maxp') + 4);
  const hhea = table('hhea');
  const ascender = i16(hhea + 4);
  const descender = i16(hhea + 6);
  const numHMetrics = u16(hhea + 34);
  const hmtx = table('hmtx');
  const loca = table('loca');
  const glyf = table('glyf');
  const os2 = tables.get('OS/2');
  // sCapHeight lives in OS/2 version 2+.
  const capHeight = os2 !== undefined && u16(os2) >= 2 ? i16(os2 + 88) : Math.round(ascender * 0.7);

  const advanceOf = (g: number) => u16(hmtx + 4 * Math.min(g, numHMetrics - 1));
  const glyphOffset = (g: number) => (longLoca ? u32(loca + 4 * g) : u16(loca + 2 * g) * 2);

  // Character map: prefer a Unicode format 12 subtable, then format 4.
  const cmap = table('cmap');
  let fmt4 = -1;
  let fmt12 = -1;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    const platform = u16(rec);
    const encoding = u16(rec + 2);
    const sub = cmap + u32(rec + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = u16(sub);
    if (format === 12) fmt12 = sub;
    if (format === 4) fmt4 = sub;
  }
  const glyphIndex = (cp: number): number => {
    if (fmt12 >= 0) {
      const n = u32(fmt12 + 12);
      for (let i = 0; i < n; i++) {
        const g = fmt12 + 16 + i * 12;
        const start = u32(g);
        const end = u32(g + 4);
        if (cp >= start && cp <= end) return u32(g + 8) + (cp - start);
      }
      return 0;
    }
    if (fmt4 < 0 || cp > 0xffff) return 0;
    const segX2 = u16(fmt4 + 6);
    const ends = fmt4 + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2; i += 2) {
      if (cp > u16(ends + i)) continue;
      const start = u16(starts + i);
      if (cp < start) return 0;
      const delta = i16(deltas + i);
      const range = u16(ranges + i);
      if (!range) return (cp + delta) & 0xffff;
      const g = u16(ranges + i + range + 2 * (cp - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };

  const outline = (g: number, depth = 0): Contour[] => {
    if (g >= numGlyphs || depth > 8) return [];
    const start = glyphOffset(g);
    const end = glyphOffset(g + 1);
    if (end <= start) return [];
    const o = glyf + start;
    const nContours = i16(o);
    if (nContours >= 0) return simpleGlyph(o, nContours);
    return compositeGlyph(o, depth);
  };

  const simpleGlyph = (o: number, nContours: number): Contour[] => {
    const endPts: number[] = [];
    for (let i = 0; i < nContours; i++) endPts.push(u16(o + 10 + 2 * i));
    const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
    let p = o + 10 + 2 * nContours;
    p += 2 + u16(p); // skip instructions
    const flags: number[] = [];
    while (flags.length < nPts) {
      const f = view.getUint8(p++);
      flags.push(f);
      if (f & 8) {
        let r = view.getUint8(p++);
        while (r-- > 0) flags.push(f);
      }
    }
    const coords = (shortBit: number, sameBit: number) => {
      const out: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & shortBit) {
          const d = view.getUint8(p++);
          v += f & sameBit ? d : -d;
        } else if (!(f & sameBit)) {
          v += i16(p);
          p += 2;
        }
        out.push(v);
      }
      return out;
    };
    const xs = coords(2, 16);
    const ys = coords(4, 32);

    const contours: Contour[] = [];
    let first = 0;
    for (const last of endPts) {
      const pts: { x: number; y: number; on: boolean }[] = [];
      for (let k = first; k <= last; k++) pts.push({ x: xs[k], y: ys[k], on: !!(flags[k] & 1) });
      first = last + 1;
      if (pts.length >= 2) contours.push(flatten(pts));
    }
    return contours;
  };

  const compositeGlyph = (o: number, depth: number): Contour[] => {
    const out: Contour[] = [];
    let p = o + 10;
    for (;;) {
      const flags = u16(p);
      const g = u16(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flags & 1) {
        dx = i16(p);
        dy = i16(p + 2);
        p += 4;
      } else {
        dx = view.getInt8(p);
        dy = view.getInt8(p + 1);
        p += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const f2dot14 = (q: number) => i16(q) / 16384;
      if (flags & 8) {
        a = d = f2dot14(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2dot14(p);
        d = f2dot14(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2dot14(p);
        b = f2dot14(p + 2);
        c = f2dot14(p + 4);
        d = f2dot14(p + 6);
        p += 8;
      }
      // Only offset-style (ARGS_ARE_XY_VALUES) components; point matching is rare in Latin fonts.
      if (!(flags & 2)) dx = dy = 0;
      for (const contour of outline(g, depth + 1)) {
        out.push(contour.map(([x, y]) => [a * x + c * y + dx, b * x + d * y + dy]));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  };

  const cache = new Map<number, Glyph>();
  return {
    unitsPerEm,
    ascender,
    descender,
    capHeight,
    glyph(cp) {
      let gl = cache.get(cp);
      if (!gl) {
        const g = glyphIndex(cp);
        gl = { contours: outline(g), advance: advanceOf(g) };
        cache.set(cp, gl);
      }
      return gl;
    },
  };
}

/** TrueType quadratic B-spline → polyline (implied on-curve points between two off-curve ones). */
function flatten(pts: { x: number; y: number; on: boolean }[]): Contour {
  const n = pts.length;
  // Start on an on-curve point (or the midpoint of the first two off-curve points).
  let startIdx = pts.findIndex((q) => q.on);
  const ring = startIdx >= 0 ? [...pts.slice(startIdx), ...pts.slice(0, startIdx)] : pts;
  if (startIdx < 0) {
    startIdx = 0;
    ring.unshift({ x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2, on: true });
  }
  const out: Contour = [];
  let cur = ring[0];
  out.push([cur.x, cur.y]);
  for (let i = 1; i <= ring.length; i++) {
    const p = ring[i % ring.length];
    if (p.on) {
      if (i < ring.length) out.push([p.x, p.y]);
      cur = p;
      continue;
    }
    const next = ring[(i + 1) % ring.length];
    const end = next.on ? next : { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2, on: true };
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const u = 1 - t;
      out.push([u * u * cur.x + 2 * u * t * p.x + t * t * end.x, u * u * cur.y + 2 * u * t * p.y + t * t * end.y]);
    }
    cur = end;
    if (next.on) i++;
  }
  // Drop a duplicated closing point.
  const [fx, fy] = out[0];
  const [lx, ly] = out[out.length - 1];
  if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) out.pop();
  return out;
}
