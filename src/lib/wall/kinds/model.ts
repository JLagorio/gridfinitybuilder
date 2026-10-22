/**
 * Your own model: a holder, box or bracket made elsewhere (STL, 3MF or OBJ, read like an imported bin's:
 * imported/parse.ts), hung on the board. Its options hold its mesh by content hash with its file name, size and
 * where its faces are flat (ModelRef), never the bytes: those live in this browser and in saved project files
 * (imported/meshStore.ts), and the geometry worker gets them as it gets an imported bin's.
 *
 * One face of its bounding box goes on the board (the file's −Y/+Y/±X/±Z, or 'auto': the face with the most flat,
 * solid back), turned about that face's normal and scaled; its front view's box is its size on the wall, and the
 * face's depth how far it stands out. It attaches by:
 * - 'clips': clips and studs fused straight onto its back, only where the back is flat (within 0.3 mm of the
 *   board) and solid (1.2 mm or more) all round them. The import maps each face's flat cells on a grid of up to
 *   32 × 32 (wall/modelMesh.ts flatMasks); the clip row goes as high as it finds room for two clips (one on a
 *   narrow part), the studs as low as they find flat back. No flat spot for a clip: a back plate instead.
 * - 'plate': a 3 mm plate the size of its back (as tall as a row of clips at least), the mount standard's clips
 *   on it, the model standing on its front at the bottom edge; between them the plate fills in up to the model's
 *   back, rising no steeper than 45° (kinds/model.geom.ts), so it prints without support.
 *
 * It prints upright, as it hangs: the clips and the plate never need support; the model's own overhangs are its
 * own (supports in the slicer, or another face on the board).
 */
import { MOUNT, backMounts, minHeight, mountBox, type MountPlan } from '../mount';
import { num, obj, pick, registerAttachment, type AttachmentLayout, type MountCtx, type MountSite } from '../registry';

/** The faces of its bounding box as the file has it, the one that goes on the board. */
export const MODEL_FACES = ['+y', '-y', '+x', '-x', '-z', '+z'] as const;
export type ModelFace = (typeof MODEL_FACES)[number];

/** A model as an attachment's options hold it (like an imported bin's external.ts MeshRef). */
export interface ModelRef {
  /** Content hash of its mesh (imported/format.ts); unset: not in this project (a share link carries no meshes), a box of its size stands in. */
  hash?: string;
  /** The file it came from. */
  file: string;
  /** Bounding box as the file has it (x, y, z), mm. */
  size: [number, number, number];
  triangles: number;
  /** A closed solid (imported/meshOps.ts isClosed): only those take clips. */
  closed: boolean;
  /** Each face's flat, solid cells (modelMesh.ts flatMasks): "{across}x{up}:{hex}", a bit a cell, rows from the bottom. */
  flat?: Partial<Record<ModelFace, string>>;
}

export interface ModelOptions {
  /** Unset: none chosen yet, a box stands in. */
  mesh: ModelRef | null;
  back: 'auto' | ModelFace;
  /** Turned about the back's normal, degrees anticlockwise as seen from the front. */
  turn: '0' | '90' | '180' | '270';
  /** Of the file's size, %. */
  scale: number;
  attach: 'clips' | 'plate';
}

export const MODEL_DEFAULTS: ModelOptions = { mesh: null, back: 'auto', turn: '0', scale: 100, attach: 'clips' };

/**
 * The back plate's thickness; how flat (off the board) and solid (thick) the back must be under a mount, at 100 %;
 * the most cells across a face's map; the box (x, y, z) that stands in for a model not chosen yet; mm.
 */
export const MODEL = { plate: 3, flat: 0.3, solid: 1.2, cells: 32, standIn: [60, 40, 60] } as const;

/** For each face: the file's axis and its sign along the wall's x (across), y (up) and z (out of the board), unturned. */
export const FACE_AXES: Record<ModelFace, [number, number][]> = {
  '+y': [
    [0, 1],
    [2, 1],
    [1, -1],
  ],
  '-y': [
    [0, -1],
    [2, 1],
    [1, 1],
  ],
  '+x': [
    [1, -1],
    [2, 1],
    [0, -1],
  ],
  '-x': [
    [1, 1],
    [2, 1],
    [0, 1],
  ],
  '-z': [
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  '+z': [
    [0, -1],
    [1, 1],
    [2, -1],
  ],
};

// ---------------------------------------------------------------------------
// Flat maps
// ---------------------------------------------------------------------------

/** A face's map: `nu` cells across, `nv` up, 1 where it's flat and solid. */
export interface FlatMask {
  nu: number;
  nv: number;
  bits: Uint8Array;
}

export function encodeMask(m: FlatMask): string {
  let hex = '';
  for (let k = 0; k < m.bits.length; k += 4)
    hex += ((m.bits[k] << 3) | ((m.bits[k + 1] ?? 0) << 2) | ((m.bits[k + 2] ?? 0) << 1) | (m.bits[k + 3] ?? 0)).toString(16);
  return `${m.nu}x${m.nv}:${hex}`;
}

export function decodeMask(s: unknown): FlatMask | null {
  const m = typeof s === 'string' ? s.match(/^(\d+)x(\d+):([0-9a-f]*)$/) : null;
  if (!m) return null;
  const nu = +m[1];
  const nv = +m[2];
  if (nu < 1 || nv < 1 || nu > MODEL.cells || nv > MODEL.cells || m[3].length !== Math.ceil((nu * nv) / 4)) return null;
  const bits = new Uint8Array(nu * nv);
  for (let k = 0; k < bits.length; k++) bits[k] = (parseInt(m[3][k >> 2], 16) >> (3 - (k & 3))) & 1;
  return { nu, nv, bits };
}

/** The map turned 90° anticlockwise as seen from the front, `times` times. */
function turnMask(m: FlatMask, times: number): FlatMask {
  let cur = m;
  for (let t = 0; t < times; t++) {
    const { nu, nv, bits } = cur;
    const out = new Uint8Array(nu * nv);
    // (x, y) → (−y, x): cell (i, j) goes to (nv − 1 − j, i) of an nv × nu map.
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) out[i * nv + (nv - 1 - j)] = bits[j * nu + i];
    cur = { nu: nv, nv: nu, bits: out };
  }
  return cur;
}

/** How much of a face is flat, mm² of the file. */
function flatArea(ref: ModelRef, face: ModelFace): number {
  const m = decodeMask(ref.flat?.[face]);
  if (!m) return 0;
  const [a, b] = FACE_AXES[face].map(([ax]) => ref.size[ax]);
  return (m.bits.reduce((t, v) => t + v, 0) * a * b) / (m.nu * m.nv);
}

/** The face that goes on the board: the one picked, or (auto) the one with the most flat back (+Y, a CAD model's back, without maps). */
export function backFace(o: Pick<ModelOptions, 'back' | 'mesh'>): ModelFace {
  if (o.back !== 'auto') return o.back;
  let best: ModelFace = '+y';
  let most = 0;
  if (o.mesh)
    for (const f of MODEL_FACES) {
      const a = flatArea(o.mesh, f);
      if (a > most * 1.001 + 1e-6) [best, most] = [f, a];
    }
  return best;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** How it hangs: its size on the wall, the plate or not, and where the model is in the part's frame. */
export interface ModelPlan {
  mode: 'clips' | 'plate';
  face: ModelFace;
  /** The model's front view and depth, scaled and turned, mm. */
  mw: number;
  mh: number;
  md: number;
  /** The part: its front view, depth and mounts. */
  w: number;
  h: number;
  depth: number;
  mounts: MountPlan;
  /** Where the model's box starts across, and out from the board (on the plate's front), mm. */
  x: number;
  z: number;
  /** Clips were asked for, but its back has no flat spot for one. */
  fellBack: boolean;
}

/** A test for whether a box of the part's front view (x0, y0, x1, y1) is all flat back. */
function flatTest(mask: FlatMask | null, w: number, h: number) {
  const inside = (x0: number, y0: number, x1: number, y1: number) => x0 >= -1e-9 && y0 >= -1e-9 && x1 <= w + 1e-9 && y1 <= h + 1e-9;
  if (!mask) return inside;
  const { nu, nv, bits } = mask;
  // Running counts of the cells that aren't flat.
  const N = nu + 1;
  const sat = new Int32Array(N * (nv + 1));
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) sat[(j + 1) * N + i + 1] = 1 - bits[j * nu + i] + sat[j * N + i + 1] + sat[(j + 1) * N + i] - sat[j * N + i];
  const cw = w / nu;
  const ch = h / nv;
  const at = (v: number, n: number) => Math.max(0, Math.min(n, v));
  return (x0: number, y0: number, x1: number, y1: number) => {
    if (!inside(x0, y0, x1, y1)) return false;
    const i0 = at(Math.floor(x0 / cw + 1e-9), nu);
    const i1 = at(Math.ceil(x1 / cw - 1e-9), nu);
    const j0 = at(Math.floor(y0 / ch + 1e-9), nv);
    const j1 = at(Math.ceil(y1 / ch - 1e-9), nv);
    return sat[j1 * N + i1] - sat[j0 * N + i1] - sat[j1 * N + i0] + sat[j0 * N + i0] === 0;
  };
}

/**
 * Clips and studs straight on a back `w` × `h` where it's flat: the clip row as high as it finds room for two
 * clips (one when it's narrower), its columns centred as well as the flat back lets them; studs in the lowest
 * row (two lattice steps at a time) with any flat spot. Null: no flat spot for a clip.
 */
function flatMounts(w: number, h: number, flat: ReturnType<typeof flatTest>, ctx: MountCtx): MountPlan | null {
  const clip = mountBox('clip', [0, 0], ctx);
  const stud = mountBox('stud', [0, 0], ctx);
  const m = MOUNT.margin;
  // Flat back this far round a mount.
  const pad = 0.5;
  const ok = (b: typeof clip, x: number, y: number) =>
    x + b.x0 - pad >= m - 1e-9 &&
    x + b.x1 + pad <= w - m + 1e-9 &&
    y + b.y0 - pad >= m - 1e-9 &&
    y + b.y1 + pad <= h - m + 1e-9 &&
    flat(x + b.x0 - pad, y + b.y0 - pad, x + b.x1 + pad, y + b.y1 + pad);
  const step = 2 * ctx.pitch;
  const xa = m + pad - clip.x0;
  const xb = w - m - pad - clip.x1;
  if (xb < xa - 1e-9) return null;
  const most = Math.floor((xb - xa) / step + 1e-9) + 1;
  const want = Math.min(2, most);
  // The first column's place: centred as backMounts has it first, then every millimetre across a step.
  const starts = [(w - (most - 1) * step) / 2];
  for (let x = xa; x <= Math.min(xa + step, xb) + 1e-9; x += 1) starts.push(x);
  let best: { y: number; x0: number; cols: number[]; off: number } | null = null;
  for (let y = h - m - pad - clip.y1; y >= m + pad - clip.y0 - 1e-9; y -= 1) {
    for (const x0 of starts) {
      const cols: number[] = [];
      for (let k = 0; x0 + k * step <= xb + 1e-9; k++) if (ok(clip, x0 + k * step, y)) cols.push(k);
      if (!cols.length) continue;
      const off = Math.abs(x0 + ((cols[0] + cols[cols.length - 1]) / 2) * step - w / 2);
      const n = Math.min(cols.length, want);
      const bn = best ? Math.min(best.cols.length, want) : 0;
      if (n > bn || (best && n === bn && best.y === y && (cols.length > best.cols.length || (cols.length === best.cols.length && off < best.off - 1e-6))))
        best = { y, x0, cols, off };
    }
    // Nothing lower beats a row with as many clips as it wants.
    if (best && Math.min(best.cols.length, want) === want) break;
  }
  if (!best) return null;
  const { y, x0, cols } = best;
  const k0 = cols[0];
  const mounts: MountSite[] = cols.map((k) => ({ di: 2 * (k - k0), dj: 0, kind: 'clip' }));
  // Studs: the lowest row with flat back for any.
  for (let r = Math.floor((y - (m + pad - stud.y0)) / step + 1e-9); r >= 1; r--) {
    const row: MountSite[] = [];
    for (let k = -1; k <= most; k++) if (ok(stud, x0 + k * step, y - r * step)) row.push({ di: 2 * (k - k0), dj: -2 * r, kind: 'stud' });
    if (row.length) {
      mounts.push(...row);
      break;
    }
  }
  return { anchor: [round(x0 + k0 * step), round(y)], mounts };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const plans = new Map<string, ModelPlan>();

/** How the model hangs, from its options, on the board `ctx` (kept: the planner asks often). */
export function modelPlan(o: ModelOptions, ctx: MountCtx): ModelPlan {
  const key = JSON.stringify([o, ctx]);
  let p = plans.get(key);
  if (!p) {
    p = planModel(o, ctx);
    if (plans.size > 64) plans.delete(plans.keys().next().value!);
    plans.set(key, p);
  }
  return p;
}

function planModel(o: ModelOptions, ctx: MountCtx): ModelPlan {
  const face = backFace(o);
  const k = o.scale / 100;
  const [a, b, d] = FACE_AXES[face].map(([ax]) => round((o.mesh?.size ?? MODEL.standIn)[ax] * k));
  const turns = +o.turn / 90;
  const [mw, mh] = turns % 2 ? [b, a] : [a, b];
  const base = { face, mw, mh, md: d };
  if (o.attach === 'clips') {
    // No map (a box stands in): flat all over.
    const mask = o.mesh ? decodeMask(o.mesh.flat?.[face]) : null;
    const mounts = o.mesh?.hash && !mask ? null : flatMounts(mw, mh, flatTest(mask && turnMask(mask, turns), mw, mh), ctx);
    if (mounts) return { ...base, mode: 'clips', w: mw, h: mh, depth: d, mounts, x: 0, z: 0, fellBack: false };
  }
  const clip = mountBox('clip', [0, 0], ctx);
  const w = Math.max(mw, round(clip.x1 - clip.x0 + 2 * MOUNT.margin));
  const h = Math.max(mh, minHeight(ctx));
  return {
    ...base,
    mode: 'plate',
    w,
    h,
    depth: round(MODEL.plate + d),
    mounts: backMounts(w, h, ctx, { rows: 3 }),
    x: round((w - mw) / 2),
    z: MODEL.plate,
    fellBack: o.attach === 'clips',
  };
}

const HASH = /^[0-9a-f]{28}$/;

/** A saved ModelRef made safe; null when it isn't one. */
function cleanRef(raw: unknown): ModelRef | null {
  const r = obj(raw);
  const size = Array.isArray(r.size) ? r.size.map(Number) : [];
  if (size.length !== 3 || !size.every((v) => Number.isFinite(v) && v > 0 && v < 5000)) return null;
  const flat: Partial<Record<ModelFace, string>> = {};
  for (const f of MODEL_FACES) if (decodeMask(obj(r.flat)[f])) flat[f] = obj(r.flat)[f] as string;
  return {
    ...(typeof r.hash === 'string' && HASH.test(r.hash) ? { hash: r.hash } : {}),
    file: typeof r.file === 'string' ? r.file.slice(0, 200) : '',
    size: size as [number, number, number],
    triangles: Math.max(0, Math.floor(Number(r.triangles) || 0)),
    closed: r.closed === true,
    ...(Object.keys(flat).length ? { flat } : {}),
  };
}

const modelLayout = (o: ModelOptions, ctx: MountCtx): AttachmentLayout => {
  const p = modelPlan(o, ctx);
  return { w: p.w, h: p.h, depth: p.depth, anchor: p.mounts.anchor, mounts: p.mounts.mounts, pose: 'upright' };
};

registerAttachment<ModelOptions>({
  type: 'model',
  defaults: MODEL_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = MODEL_DEFAULTS;
    return {
      mesh: r.mesh ? cleanRef(r.mesh) : null,
      back: pick(r.back, ['auto', ...MODEL_FACES] as const, d.back),
      turn: pick(String(r.turn ?? ''), ['0', '90', '180', '270'] as const, d.turn),
      scale: num(r.scale, 25, 400, d.scale),
      attach: pick(r.attach, ['clips', 'plate'] as const, d.attach),
    };
  },
  layout: modelLayout,
  summary: (o) => (o.mesh?.file.replace(/\.[^.]*$/, '').trim() || 'Your own model').slice(0, 40),
  notes(o, ctx) {
    const out: string[] = [];
    if (!o.mesh) out.push('Choose its file (STL, 3MF or OBJ): a box stands in for it till then.');
    else if (!o.mesh.hash) out.push('Its mesh didn’t come with the link (a link can’t carry one): choose its file again. A box of its size stands in.');
    else if (!o.mesh.closed) out.push('Its mesh isn’t a closed solid, so nothing can be fused to it: repair it (most slicers can) and choose it again.');
    if (modelPlan(o, ctx).fellBack) out.push('Its back has no flat, solid spot for a clip: it gets a back plate.');
    return out;
  },
  // Its front is the model's: nowhere for a screw's head.
  backPlate: () => null,
});
