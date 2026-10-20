import { EDGE, MAX_WALLS, type CompartmentOptions, type DividerLayout, type DividerWall, type WallPos } from './types';
import type { LabelStyle } from '../geometry/bin';
import { sanitizeLabelText } from '../geometry/labels';

const LABELS: LabelStyle[] = ['none', 'full', 'left', 'center', 'right'];
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function cleanId(v: unknown): string {
  return String(v ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 24);
}

function cleanPos(p: unknown): WallPos {
  const o = (p ?? {}) as Partial<{ kind: string; t: unknown; mm: unknown; from: unknown }>;
  if (o.kind === 'exact') {
    const mm = num(o.mm);
    return { kind: 'exact', mm: Number.isFinite(mm) ? Math.min(2000, Math.max(0, mm)) : 0, from: o.from === 'hi' ? 'hi' : 'lo' };
  }
  const t = num(o.t);
  return { kind: 'ratio', t: Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5 };
}

export function cleanCompartmentOptions(c: unknown): CompartmentOptions | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const out: CompartmentOptions = {};
  if (o.scoop !== undefined && o.scoop !== null && Number.isFinite(num(o.scoop))) out.scoop = Math.min(1, Math.max(0, num(o.scoop)));
  if (typeof o.label === 'string' && LABELS.includes(o.label as LabelStyle)) out.label = o.label as LabelStyle;
  if (o.floor !== undefined && o.floor !== null && Number.isFinite(num(o.floor))) {
    const f = Math.min(200, Math.max(0, num(o.floor)));
    if (f > 0) out.floor = round(f, 3);
  }
  if (typeof o.labelText === 'string') {
    const t = sanitizeLabelText(o.labelText);
    if (t) out.labelText = t;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Clean a layout from untrusted data (saved files, old versions). Returns null
 * for anything that isn't a layout. References to missing walls, to walls of the
 * wrong orientation or to the wall itself become EDGE, and position reference
 * cycles are broken. Idempotent.
 */
export function sanitizeLayout(input: unknown): DividerLayout | null {
  if (!input || typeof input !== 'object') return null;
  const l = input as Partial<DividerLayout>;
  const raw = Array.isArray(l.walls) ? l.walls.slice(0, MAX_WALLS) : [];
  const walls: DividerWall[] = [];
  const taken = new Set<string>([EDGE]);
  const rename = new Map<string, string>();
  raw.forEach((w0, k) => {
    const w = (w0 ?? {}) as Partial<DividerWall>;
    if (w.orient !== 'v' && w.orient !== 'h') return;
    const want = cleanId(w.id);
    let id = want || `w${k + 1}`;
    for (let n = 2; taken.has(id); n++) id = `${want || 'w'}_${n}`;
    taken.add(id);
    if (want && !rename.has(want)) rename.set(want, id);
    const lower = num(w.lower);
    const out: DividerWall = {
      id,
      orient: w.orient,
      lo: String(w.lo ?? EDGE),
      hi: String(w.hi ?? EDGE),
      pos: cleanPos(w.pos),
      start: String(w.start ?? EDGE),
      end: String(w.end ?? EDGE),
    };
    if (Number.isFinite(lower) && lower > 0) out.lower = round(Math.min(300, lower), 2);
    if (w.removable === true) out.removable = true;
    walls.push(out);
  });
  const byId = new Map(walls.map((w) => [w.id, w]));
  const fix = (w: DividerWall, ref: string, parallel: boolean) => {
    const id = ref === EDGE ? EDGE : (rename.get(cleanId(ref)) ?? EDGE);
    const r = byId.get(id);
    if (!r || r === w || (r.orient === w.orient) !== parallel) return EDGE;
    return id;
  };
  for (const w of walls) {
    w.lo = fix(w, w.lo, true);
    w.hi = fix(w, w.hi, true);
    w.start = fix(w, w.start, false);
    w.end = fix(w, w.end, false);
  }
  // Break lo/hi cycles (DFS; a back edge becomes EDGE).
  const state = new Map<string, 1 | 2>();
  const visit = (w: DividerWall) => {
    state.set(w.id, 1);
    for (const side of ['lo', 'hi'] as const) {
      const r = byId.get(w[side]);
      if (!r) continue;
      const st = state.get(r.id);
      if (st === 1) w[side] = EDGE;
      else if (!st) visit(r);
    }
    state.set(w.id, 2);
  };
  for (const w of walls) if (!state.has(w.id)) visit(w);

  const out: DividerLayout = { walls };
  if (l.comps && typeof l.comps === 'object') {
    const comps: Record<string, CompartmentOptions> = {};
    for (const [k, v] of Object.entries(l.comps).slice(0, 512)) {
      const c = cleanCompartmentOptions(v);
      if (c && k.length <= 1024) comps[k] = c;
    }
    if (Object.keys(comps).length) out.comps = comps;
  }
  return out;
}

/**
 * Canonical text for a layout, for mesh keys. Walls are sorted by id; numbers
 * are rounded. `live` limits compartment options to compartments that exist.
 */
export function layoutKey(l: DividerLayout | null | undefined, live?: Set<string>): string {
  if (!l) return '';
  const walls = [...l.walls]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((w) =>
      [
        w.id,
        w.orient,
        w.lo,
        w.hi,
        w.pos.kind === 'ratio' ? `r${round(w.pos.t, 7)}` : `e${w.pos.from}${round(w.pos.mm, 3)}`,
        w.start,
        w.end,
        round(w.lower ?? 0, 2),
        w.removable ? 'R' : '',
      ].join(':'),
    );
  const comps = Object.keys(l.comps ?? {})
    .filter((k) => !live || live.has(k))
    .sort()
    .map((k) => {
      const c = l.comps![k];
      const text = c.labelText === undefined ? '' : `/${JSON.stringify(c.labelText)}`;
      return `${k}=${c.scoop === undefined ? '' : round(c.scoop, 3)}/${c.label ?? ''}/${c.floor ?? ''}${text}`;
    });
  return `${walls.join(';')}|${comps.join(';')}`;
}
