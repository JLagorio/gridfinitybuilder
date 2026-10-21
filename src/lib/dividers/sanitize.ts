import { EDGE, MAX_WALLS, type CompartmentOptions, type CompartmentPockets, type DividerLayout, type DividerWall, type WallPos } from './types';
import { MAX_FREE_WALLS, type FreeWall, type WallNotch } from './types';
import type { LabelStyle } from '../geometry/bin';
import { sanitizeLabelText } from '../geometry/labels';
import { sanitizeVariants } from '../geometry/variants';

const LABELS: LabelStyle[] = ['none', 'full', 'left', 'center', 'right'];
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
/** Step count range for 'tiers' floors. */
export const MIN_TIERS = 2;
export const MAX_TIERS = 6;

function cleanId(v: unknown): string {
  return String(v ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 24);
}

/** A finger notch, or null for none / nonsense. */
export function cleanNotch(n: unknown): WallNotch | null {
  if (!n || typeof n !== 'object') return null;
  const o = n as Partial<Record<keyof WallNotch, unknown>>;
  const width = num(o.width);
  const depth = num(o.depth);
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(depth) && depth > 0)) return null;
  return { width: round(Math.min(300, Math.max(1, width)), 2), depth: round(Math.min(300, Math.max(0.5, depth)), 2) };
}

/** Diagonal / curved walls: ends clamped to the cavity, ids unique (also against `taken`, the straight walls' ids). */
function cleanFreeWalls(input: unknown, taken: Set<string>): FreeWall[] {
  if (!Array.isArray(input)) return [];
  const out: FreeWall[] = [];
  const frac = (v: unknown) => {
    const x = num(v);
    return Number.isFinite(x) ? round(Math.min(1, Math.max(0, x)), 6) : 0;
  };
  const pt = (p: unknown): [number, number] | null => (Array.isArray(p) && p.length >= 2 ? [frac(p[0]), frac(p[1])] : null);
  input.slice(0, MAX_FREE_WALLS).forEach((f0, k) => {
    const f = (f0 ?? {}) as Partial<Record<keyof FreeWall, unknown>>;
    const a = pt(f.a);
    const b = pt(f.b);
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return;
    const want = cleanId(f.id);
    let id = want || `f${k + 1}`;
    for (let n = 2; taken.has(id); n++) id = `${want || 'f'}_${n}`;
    taken.add(id);
    const fw: FreeWall = { id, a, b };
    const bend = num(f.bend);
    if (Number.isFinite(bend) && Math.abs(bend) >= 0.01) fw.bend = round(Math.min(1000, Math.max(-1000, bend)), 2);
    const lower = num(f.lower);
    if (Number.isFinite(lower) && lower > 0) fw.lower = round(Math.min(300, lower), 2);
    out.push(fw);
  });
  return out;
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
  // Defaults ('open', 'flat', 'back') are left out, so they key like old layouts.
  if (o.inside === 'pockets' || o.inside === 'tools' || o.inside === 'solid') out.inside = o.inside;
  const pockets = cleanPockets(o.pockets);
  if (pockets) out.pockets = pockets;
  if (o.floorShape === 'ramp' || o.floorShape === 'tiers') out.floorShape = o.floorShape;
  if (o.floorRise !== undefined && o.floorRise !== null && Number.isFinite(num(o.floorRise))) {
    out.floorRise = round(Math.min(200, Math.max(0, num(o.floorRise))), 3);
  }
  if (o.floorHigh === 'front' || o.floorHigh === 'left' || o.floorHigh === 'right') out.floorHigh = o.floorHigh;
  if (o.tiers !== undefined && o.tiers !== null && Number.isFinite(num(o.tiers))) out.tiers = Math.min(MAX_TIERS, Math.max(MIN_TIERS, Math.round(num(o.tiers))));
  return Object.keys(out).length ? out : null;
}

/**
 * A compartment's pocket overrides. Each `pocket*` field is cleaned the way the
 * bin's own field is (sanitizeVariants), so fields added there later are
 * handled too; values that aren't a valid setting are dropped.
 */
function cleanPockets(v: unknown): CompartmentPockets | null {
  if (!v || typeof v !== 'object') return null;
  const src = v as Record<string, unknown>;
  const clean = sanitizeVariants({ ...src, heightUnits: 3, lip: true }) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(src)) {
    if (!k.startsWith('pocket') || !(k in clean) || raw === undefined || raw === null) continue;
    const c = clean[k];
    if (typeof c === 'number' && (typeof raw === 'number' || typeof raw === 'string') && Number.isFinite(num(raw))) out[k] = c;
    else if (typeof c === 'string' && c === raw) out[k] = c;
    else if (typeof c === 'boolean' && typeof raw === 'boolean') out[k] = c;
  }
  return Object.keys(out).length ? (out as CompartmentPockets) : null;
}

/** Canonical text for pocket overrides (the preset name is UI only). */
function pocketsKey(p: CompartmentPockets): string {
  const parts = Object.entries(p)
    .filter(([k]) => k !== 'pocketPreset')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k.slice(6)}${v}`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

/** Extra key text for a compartment's inside and floor shape; '' for defaults (old layouts). */
function compartmentExtraKey(c: CompartmentOptions): string {
  const filled = c.inside !== undefined && c.inside !== 'open';
  let s = filled ? `/I${c.inside}${c.inside === 'pockets' && c.pockets ? pocketsKey(c.pockets) : ''}` : '';
  if (!filled && c.floorShape && c.floorShape !== 'flat') {
    s += `/S${c.floorShape}${c.floorRise ?? ''}${c.floorHigh ?? ''}${c.floorShape === 'tiers' ? `x${c.tiers ?? ''}` : ''}`;
  }
  return s;
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
    const notch = cleanNotch(w.notch);
    if (notch) out.notch = notch;
    if (w.top === 'chamfer' || w.top === 'round') out.top = w.top;
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
  const free = cleanFreeWalls(l.free, taken);
  if (free.length) out.free = free;
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
        ...wallExtrasKey(w),
      ].join(':'),
    );
  const comps = Object.keys(l.comps ?? {})
    .filter((k) => !live || live.has(k))
    .sort()
    .map((k) => {
      const c = l.comps![k];
      const text = c.labelText === undefined ? '' : `/${JSON.stringify(c.labelText)}`;
      return `${k}=${c.scoop === undefined ? '' : round(c.scoop, 3)}/${c.label ?? ''}/${c.floor ?? ''}${text}${compartmentExtraKey(c)}`;
    });
  return `${walls.join(';')}|${comps.join(';')}${freeWallsKey(l.free)}`;
}

/** Key parts for a wall's notch and top shape; none when it has neither (so older layouts keep their keys). */
function wallExtrasKey(w: DividerWall): string[] {
  const out: string[] = [];
  if (w.notch) out.push(`n${round(w.notch.width, 2)}x${round(w.notch.depth, 2)}`);
  if (w.top && w.top !== 'flat') out.push(`t${w.top}`);
  return out;
}

/** Key part for the diagonal / curved walls ('' without any). */
function freeWallsKey(free: FreeWall[] | undefined): string {
  if (!free?.length) return '';
  const f = [...free]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => [x.id, round(x.a[0], 6), round(x.a[1], 6), round(x.b[0], 6), round(x.b[1], 6), round(x.bend ?? 0, 2), round(x.lower ?? 0, 2)].join(':'));
  return `|F${f.join(';')}`;
}
