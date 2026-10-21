import type { Pt } from './image';
import { dedupe, perimeter } from './polygon';

/**
 * Minimal SVG outline reader (no DOM): closed shapes from <path>, <polygon>,
 * <polyline>, <rect>, <circle> and <ellipse>, with <g>/element transforms.
 * Curves and arcs are flattened. Output is in mm with y up.
 */

export interface ImportedShape {
  points: Pt[];
  /** Element it came from, e.g. "path#handle". */
  source: string;
}

export interface ImportResult {
  shapes: ImportedShape[];
  /** mm per drawing unit that was applied. */
  mmPerUnit: number;
  /** True when the file didn't say (we assumed 1 unit = 1 mm). */
  unitsAssumed: boolean;
  warnings: string[];
}

/** 2D affine [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f (SVG order). */
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function mul(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m: Affine, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Average linear scale of a transform (for picking curve resolution). */
const scaleOf = (m: Affine) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

export function parseTransform(s: string | undefined): Affine {
  let m = IDENTITY;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    const v = numbers(t[2]);
    let n: Affine = IDENTITY;
    const rad = ((v[0] ?? 0) * Math.PI) / 180;
    switch (t[1]) {
      case 'matrix':
        if (v.length >= 6) n = [v[0], v[1], v[2], v[3], v[4], v[5]];
        break;
      case 'translate':
        n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const c = Math.cos(rad);
        const si = Math.sin(rad);
        const r: Affine = [c, si, -si, c, 0, 0];
        if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]);
        else n = r;
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

function numbers(s: string): number[] {
  return (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/** Length with CSS units → mm (null if unitless or px, which we can't trust). */
function lengthMm(v: string | undefined): { mm: number; unit: string } | null {
  if (!v) return null;
  const m = v.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-z%]*)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const k: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25, m: 1000 };
  if (unit in k) return { mm: n * k[unit], unit };
  return { mm: n, unit: unit || 'none' };
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

/** Segments for a curve of the given length (in mm), ~0.4 mm chords. */
const segsFor = (lenMm: number, lo = 4, hi = 96) => Math.max(lo, Math.min(hi, Math.ceil(lenMm / 0.4)));

/** Flatten SVG path data into subpaths (in user units), with closed flags. */
export function flattenPath(d: string, mmPerUnit = 1): { points: Pt[]; closed: boolean }[] {
  const out: { points: Pt[]; closed: boolean }[] = [];
  let i = 0;
  const n = d.length;
  const skip = () => {
    while (i < n && /[\s,]/.test(d[i])) i++;
  };
  const num = (): number => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = (): number => {
    skip();
    const c = d[i++];
    if (c !== '0' && c !== '1') throw new Error('Bad arc flag in path data');
    return c === '1' ? 1 : 0;
  };
  const hasNum = () => {
    skip();
    return i < n && /[-+.\d]/.test(d[i]);
  };

  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null;
  let lastCmd = '';
  const finish = (closed: boolean) => {
    if (cur.length > 1) out.push({ points: cur, closed });
    cur = [];
  };
  const lineTo = (nx: number, ny: number) => {
    if (!cur.length) cur.push([x, y]);
    cur.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const len = (Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) * mmPerUnit;
    const k = segsFor(len);
    const [x0, y0] = [x, y];
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      const u = 1 - t;
      lineTo(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    const len = (Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1)) * mmPerUnit;
    const k = segsFor(len);
    const [x0, y0] = [x, y];
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      const u = 1 - t;
      lineTo(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
  };
  const arc = (rx: number, ry: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number) => {
    // SVG spec F.6.5: endpoint → center parameterisation.
    const x1 = x;
    const y1 = y;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry || (x1 === x2 && y1 === y2)) {
      lineTo(x2, y2);
      return;
    }
    const phi = (phiDeg * Math.PI) / 180;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let coef = Math.sqrt(Math.max(0, num2 / den));
    if (large === sweep) coef = -coef;
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
    const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const k = segsFor(Math.abs(dt) * Math.max(rx, ry) * mmPerUnit);
    for (let s = 1; s <= k; s++) {
      const t = t1 + (dt * s) / k;
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      if (s === k) lineTo(x2, y2);
      else lineTo(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy);
    }
  };

  while (i < n) {
    skip();
    if (i >= n) break;
    let cmd = d[i];
    if (/[a-zA-Z]/.test(cmd)) i++;
    else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
    else throw new Error('Path data must start with a command');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case 'M': {
        finish(false);
        x = num() + ox;
        y = num() + oy;
        sx = x;
        sy = y;
        cur = [[x, y]];
        lastCtrl = null;
        break;
      }
      case 'L':
        lineTo(num() + ox, num() + oy);
        lastCtrl = null;
        break;
      case 'H':
        lineTo(num() + ox, y);
        lastCtrl = null;
        break;
      case 'V':
        lineTo(x, num() + oy);
        lastCtrl = null;
        break;
      case 'C': {
        const x1 = num() + ox;
        const y1 = num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        const x3 = num() + ox;
        const y3 = num() + oy;
        cubic(x1, y1, x2, y2, x3, y3);
        lastCtrl = [x2, y2];
        break;
      }
      case 'S': {
        const r: Pt = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const x2 = num() + ox;
        const y2 = num() + oy;
        const x3 = num() + ox;
        const y3 = num() + oy;
        cubic(r[0], r[1], x2, y2, x3, y3);
        lastCtrl = [x2, y2];
        break;
      }
      case 'Q': {
        const x1 = num() + ox;
        const y1 = num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        quad(x1, y1, x2, y2);
        lastCtrl = [x1, y1];
        break;
      }
      case 'T': {
        const r: Pt = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const x2 = num() + ox;
        const y2 = num() + oy;
        quad(r[0], r[1], x2, y2);
        lastCtrl = r;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const phi = num();
        const large = flag();
        const sweep = flag();
        arc(rx, ry, phi, large, sweep, num() + ox, num() + oy);
        lastCtrl = null;
        break;
      }
      case 'Z':
        if (cur.length) {
          finish(true);
        }
        x = sx;
        y = sy;
        lastCtrl = null;
        break;
      default:
        throw new Error(`Unsupported path command "${cmd}"`);
    }
    lastCmd = cmd;
    // Implicit repeats: more numbers after the command's arguments.
    if (C !== 'Z' && hasNum()) continue;
  }
  finish(false);
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, mmPerUnit: number): Pt[] {
  const k = segsFor(2 * Math.PI * Math.max(rx, ry) * mmPerUnit, 16, 180);
  return Array.from({ length: k }, (_, s) => {
    const t = (2 * Math.PI * s) / k;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt;
  });
}

function rectPoints(a: Record<string, string>, mmPerUnit: number): Pt[] | null {
  const x = parseFloat(a.x ?? '0') || 0;
  const y = parseFloat(a.y ?? '0') || 0;
  const w = parseFloat(a.width ?? '');
  const h = parseFloat(a.height ?? '');
  if (!(w > 0) || !(h > 0)) return null;
  let rx = parseFloat(a.rx ?? a.ry ?? '0') || 0;
  let ry = parseFloat(a.ry ?? a.rx ?? '0') || 0;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!rx || !ry) return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const pts: Pt[] = [];
  const k = segsFor((Math.PI / 2) * Math.max(rx, ry) * mmPerUnit, 3, 24);
  const corner = (cx: number, cy: number, a0: number) => {
    for (let s = 0; s <= k; s++) {
      const t = a0 + ((Math.PI / 2) * s) / k;
      pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
  };
  corner(x + w - rx, y + ry, -Math.PI / 2);
  corner(x + w - rx, y + h - ry, 0);
  corner(x + rx, y + h - ry, Math.PI / 2);
  corner(x + rx, y + ry, Math.PI);
  return pts;
}

/** Elements whose children never render. */
const HIDDEN = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'lineargradient', 'radialgradient', 'filter', 'title', 'desc', 'metadata', 'style', 'script']);

export function parseSVG(text: string, o: { mmPerUnit?: number } = {}): ImportResult {
  const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  const shapes: ImportedShape[] = [];
  const warnings: string[] = [];
  const stack: { name: string; m: Affine; hidden: boolean }[] = [];
  let mmPerUnit = o.mmPerUnit ?? 1;
  let unitsAssumed = o.mmPerUnit === undefined;
  let root: Affine | null = null;
  let openPaths = 0;
  let t: RegExpExecArray | null;

  while ((t = tagRe.exec(src))) {
    const closing = t[1] === '/';
    const name = t[2].toLowerCase().replace(/^svg:/, '');
    const selfClose = t[4] === '/';
    if (closing) {
      // Pop to the matching open tag.
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const a = attrs(t[3]);
    const parent = stack[stack.length - 1];
    const hidden = (parent?.hidden ?? false) || HIDDEN.has(name) || a.display === 'none' || /display\s*:\s*none/.test(a.style ?? '');
    let m = parent?.m ?? IDENTITY;

    if (name === 'svg' && !root) {
      // Root: viewBox + width/height give the drawing scale.
      const vb = a.viewBox ? numbers(a.viewBox) : [];
      const wl = lengthMm(a.width);
      const hl = lengthMm(a.height);
      const physical = (l: { unit: string } | null) => !!l && l.unit !== 'none' && l.unit !== 'px' && l.unit !== '%';
      if (o.mmPerUnit === undefined) {
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0 && (physical(wl) || physical(hl))) {
          const sx = physical(wl) ? wl!.mm / vb[2] : Infinity;
          const sy = physical(hl) ? hl!.mm / vb[3] : Infinity;
          mmPerUnit = Math.min(sx, sy);
          unitsAssumed = false;
        } else if (vb.length !== 4 && physical(wl)) {
          // No viewBox: user units are px, but the size is physical: px → mm via width.
          mmPerUnit = 25.4 / 96;
          unitsAssumed = false;
        }
      }
      const vx = vb.length === 4 ? vb[0] : 0;
      const vy = vb.length === 4 ? vb[1] : 0;
      // mm, y up.
      root = [mmPerUnit, 0, 0, -mmPerUnit, -vx * mmPerUnit, vy * mmPerUnit];
      m = root;
    } else if (name === 'svg') {
      m = mul(m, [1, 0, 0, 1, parseFloat(a.x ?? '0') || 0, parseFloat(a.y ?? '0') || 0]);
    }
    if (!root) {
      root = [mmPerUnit, 0, 0, -mmPerUnit, 0, 0];
      m = mul(root, m);
    }
    if (a.transform) m = mul(m, parseTransform(a.transform));
    if (!selfClose && !['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line'].includes(name)) {
      stack.push({ name, m, hidden });
    }
    if (hidden) continue;

    const label = `${name}${a.id ? `#${a.id}` : ''}`;
    const k = scaleOf(m);
    const add = (pts: Pt[] | null) => {
      if (!pts) return;
      const p = dedupe(pts.map((q) => apply(m, q)));
      if (p.length >= 3) shapes.push({ points: p, source: label });
    };
    try {
      switch (name) {
        case 'path':
          for (const sp of flattenPath(a.d ?? '', k)) {
            const p = dedupe(sp.points);
            if (p.length < 3) {
              openPaths++;
              continue;
            }
            const gap = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
            if (sp.closed || gap * k < 0.05 || gap < perimeter(p) * 0.001) add(p);
            else openPaths++;
          }
          break;
        case 'polygon':
        case 'polyline': {
          const v = numbers(a.points ?? '');
          const p: Pt[] = [];
          for (let q = 0; q + 1 < v.length; q += 2) p.push([v[q], v[q + 1]]);
          const gap = p.length ? Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) : 0;
          if (name === 'polygon' || gap * k < 0.05) add(p);
          else openPaths++;
          break;
        }
        case 'rect':
          add(rectPoints(a, k));
          break;
        case 'circle': {
          const r = parseFloat(a.r ?? '');
          if (r > 0) add(ellipsePoints(parseFloat(a.cx ?? '0') || 0, parseFloat(a.cy ?? '0') || 0, r, r, k));
          break;
        }
        case 'ellipse': {
          const rx = parseFloat(a.rx ?? '');
          const ry = parseFloat(a.ry ?? '');
          if (rx > 0 && ry > 0) add(ellipsePoints(parseFloat(a.cx ?? '0') || 0, parseFloat(a.cy ?? '0') || 0, rx, ry, k));
          break;
        }
        case 'line':
          openPaths++;
          break;
      }
    } catch (e) {
      warnings.push(`${label}: ${(e as Error).message}`);
    }
  }
  if (!root) throw new Error('Not an SVG file.');
  if (openPaths) warnings.push(`${openPaths} open path${openPaths === 1 ? '' : 's'} skipped (outlines must be closed).`);
  return { shapes, mmPerUnit, unitsAssumed, warnings };
}
