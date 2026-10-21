import { strFromU8, unzipSync } from 'fflate';
import { bounds, boxSize, centred, composeTransforms, flipped, isClosed, signedVolume, transformPositions, weld, type RawMesh } from './meshOps';

/**
 * Reading bins made elsewhere: STL (binary and ASCII), 3MF (zipped XML, with
 * build items, components and Bambu/Prusa's production-extension parts in
 * other model files) and OBJ. Every object comes back welded, centred on its
 * footprint with its bottom at z = 0, Z up as the file has it, in mm.
 *
 * Loaded with the import dialog (components/ExternalBinDialog.tsx), never on
 * the first screen.
 */

/** One object found in a file, ready to place. */
export interface ImportedObject {
  name: string;
  /** Welded and centred (imported/meshOps.ts centred). */
  mesh: RawMesh;
  /** Bounding box, mm: x, y, z. */
  size: [number, number, number];
  triangles: number;
  /** A closed solid (imported/meshOps.ts isClosed). */
  closed: boolean;
  /** Enclosed volume, mm³ (the triangles' signed volume; only meaningful when closed). */
  volume: number;
}

/** Most triangles an imported bin may have. */
export const MAX_TRIANGLES = 4_000_000;

type Soup = { name: string; positions: number[] | Float32Array; indices?: number[] | Uint32Array };

const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** The objects in an STL, 3MF or OBJ file. `scale` converts the file's units to mm (STL and OBJ have none). Throws with a message for the user. */
export function parseMeshFile(fileName: string, bytes: Uint8Array, scale = 1): ImportedObject[] {
  const ext = extOf(fileName);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let soups: Soup[];
  if (ext === '3mf' || (zip && ext !== 'stl' && ext !== 'obj')) soups = parse3MF(bytes);
  else if (ext === 'obj') soups = parseOBJ(strFromU8(bytes));
  else if (ext === 'stl' || !ext) soups = [parseSTL(bytes)];
  else throw new Error(`Gridfit reads .stl, .3mf and .obj files, not .${ext}.`);
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported bin';
  const out = soups.map((s, i) => finish({ ...s, name: s.name || (soups.length > 1 ? `${base} ${i + 1}` : base) }, scale)).filter((o) => o.triangles > 0);
  if (!out.length) throw new Error('No triangles in this file.');
  return out;
}

function finish(s: Soup, scale: number): ImportedObject {
  const n = (s.indices ? s.indices.length : s.positions.length / 3) / 3;
  if (n > MAX_TRIANGLES) throw new Error(`“${s.name}” has ${Math.round(n / 1e5) / 10} million triangles; Gridfit takes up to ${MAX_TRIANGLES / 1e6} million.`);
  const pos = s.positions instanceof Float32Array ? s.positions : Float32Array.from(s.positions);
  if (scale !== 1) for (let i = 0; i < pos.length; i++) pos[i] *= scale;
  let mesh = weld(pos, s.indices);
  const closed = isClosed(mesh);
  let volume = signedVolume(mesh);
  // A closed mesh that's inside out (some exporters): turn it the right way.
  if (closed && volume < 0) {
    mesh = flipped(mesh);
    volume = -volume;
  }
  mesh = centred(mesh);
  return { name: s.name, mesh, size: boxSize(bounds(mesh.positions)), triangles: mesh.indices.length / 3, closed, volume: Math.abs(volume) };
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

/** Binary or ASCII STL: one object. */
export function parseSTL(bytes: Uint8Array): Soup {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? dv.getUint32(80, true) : -1;
  // Binary files say how many triangles follow; ASCII ones start with "solid" (binary headers may too, so the size decides first).
  const head = strFromU8(bytes.subarray(0, Math.min(bytes.length, 512)));
  const binary = count >= 0 && (84 + count * 50 === bytes.length || (!/^\s*solid[\s\S]*facet/.test(head) && 84 + count * 50 <= bytes.length));
  if (binary) {
    const p = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) p[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    const name = strFromU8(bytes.subarray(0, 80)).replace(/\0[\s\S]*$/, '').replace(/^solid\s*/i, '').trim();
    return { name: name.length < 60 && /^[\w .,()-]+$/.test(name) ? name : '', positions: p };
  }
  const text = strFromU8(bytes);
  if (!/^\s*solid/i.test(text)) throw new Error('This isn’t an STL file (it’s neither binary STL nor starts with “solid”).');
  const p: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) p.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (p.length % 9) p.length -= p.length % 9;
  return { name: text.match(/^\s*solid[ \t]+([^\r\n]*)/i)?.[1]?.trim().slice(0, 60) ?? '', positions: p };
}

// ---------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------

const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

interface ModelObject {
  name: string;
  type: string;
  mesh?: { positions: number[]; indices: number[] };
  components: { path: string; id: string; transform: number[] }[];
}

const attrRes = new Map<string, RegExp>();
function attr(s: string, name: string): string | undefined {
  let re = attrRes.get(name);
  if (!re) attrRes.set(name, (re = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`)));
  return s.match(re)?.[1];
}

function parseTransform(v: string | undefined): number[] {
  if (!v) return IDENTITY;
  const n = v.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY;
}

/** Objects in one .model file, by id, in their units' scale. */
function parseModel(xml: string, path: string): { objects: Map<string, ModelObject>; items: { path: string; id: string; transform: number[] }[]; scale: number } {
  const unit = attr(xml.match(/<(?:\w+:)?model\b([^>]*)>/)?.[1] ?? '', 'unit') ?? 'millimeter';
  const scale = UNIT_MM[unit] ?? 1;
  const objects = new Map<string, ModelObject>();
  const objRe = /<(?:\w+:)?object\b([^>]*?)(\/?)>/g;
  const endRe = /<\/(?:\w+:)?object>/g;
  for (let m = objRe.exec(xml); m; m = objRe.exec(xml)) {
    const head = m[1];
    let body = '';
    if (m[2] !== '/') {
      endRe.lastIndex = objRe.lastIndex;
      const end = endRe.exec(xml);
      body = xml.slice(objRe.lastIndex, end ? end.index : xml.length);
      if (end) objRe.lastIndex = endRe.lastIndex;
    }
    const id = attr(head, 'id');
    if (!id) continue;
    const o: ModelObject = { name: attr(head, 'name') ?? '', type: attr(head, 'type') ?? 'model', components: [] };
    const meshStart = body.search(/<(?:\w+:)?mesh\b/);
    if (meshStart >= 0) {
      const positions: number[] = [];
      const indices: number[] = [];
      const vRe = /<(?:\w+:)?vertex\b([^>]*)>/g;
      for (let v = vRe.exec(body); v; v = vRe.exec(body)) positions.push(Number(attr(v[1], 'x')) * scale, Number(attr(v[1], 'y')) * scale, Number(attr(v[1], 'z')) * scale);
      const tRe = /<(?:\w+:)?triangle\b([^>]*)>/g;
      for (let t = tRe.exec(body); t; t = tRe.exec(body)) indices.push(Number(attr(t[1], 'v1')), Number(attr(t[1], 'v2')), Number(attr(t[1], 'v3')));
      o.mesh = { positions, indices };
    }
    const cRe = /<(?:\w+:)?component\b([^>]*)>/g;
    for (let c = cRe.exec(body); c; c = cRe.exec(body)) {
      const cid = attr(c[1], 'objectid');
      if (cid) o.components.push({ path: normPath(attr(c[1], 'path') ?? path), id: cid, transform: scaleTransform(parseTransform(attr(c[1], 'transform')), scale) });
    }
    objects.set(id, o);
  }
  const items: { path: string; id: string; transform: number[] }[] = [];
  const build = xml.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/)?.[1] ?? '';
  const iRe = /<(?:\w+:)?item\b([^>]*)>/g;
  for (let it = iRe.exec(build); it; it = iRe.exec(build)) {
    const id = attr(it[1], 'objectid');
    if (id) items.push({ path: normPath(attr(it[1], 'path') ?? path), id, transform: scaleTransform(parseTransform(attr(it[1], 'transform')), scale) });
  }
  return { objects, items, scale };
}

/** A transform's translation is in the file's units; vertices are already in mm. */
const scaleTransform = (t: number[], s: number) => (s === 1 ? t : [...t.slice(0, 9), t[9] * s, t[10] * s, t[11] * s]);

const normPath = (p: string) => '/' + p.replace(/\\/g, '/').replace(/^\/+/, '');

/** The objects a 3MF prints: one per build item (components and their transforms applied). */
export function parse3MF(bytes: Uint8Array): Soup[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /\.(model|rels)$/i.test(f.name) });
  } catch {
    throw new Error('This 3MF file is damaged (it isn’t a readable zip).');
  }
  const byPath = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) byPath.set(normPath(name).toLowerCase(), data);
  const rels = byPath.get('/_rels/.rels');
  const rootTarget = rels ? strFromU8(rels).match(/Target="([^"]+\.model)"[^>]*Type="[^"]*3dmodel"|Type="[^"]*3dmodel"[^>]*Target="([^"]+\.model)"/) : null;
  const rootPath = normPath(rootTarget?.[1] ?? rootTarget?.[2] ?? '/3D/3dmodel.model');
  const models = new Map<string, ReturnType<typeof parseModel>>();
  const model = (path: string) => {
    const key = path.toLowerCase();
    let m = models.get(key);
    if (!m) {
      const data = byPath.get(key);
      if (!data) return undefined;
      m = parseModel(strFromU8(data), path);
      models.set(key, m);
    }
    return m;
  };
  const root = model(rootPath) ?? [...byPath.keys()].filter((k) => k.endsWith('.model')).map((k) => model(k)).find(Boolean);
  if (!root) throw new Error('No 3D model in this 3MF file.');

  const collect = (path: string, id: string, transform: number[], out: { positions: number[]; indices: number[] }, depth: number): string => {
    const o = model(path)?.objects.get(id);
    if (!o || depth > 16 || o.type === 'support' || o.type === 'other') return '';
    if (o.mesh) {
      const base = out.positions.length / 3;
      const p = o.mesh.positions.slice();
      transformPositions(p, transform);
      for (let i = 0; i < p.length; i++) out.positions.push(p[i]);
      for (const i of o.mesh.indices) out.indices.push(base + i);
    }
    let name = o.name;
    for (const c of o.components) {
      const n = collect(c.path, c.id, composeTransforms(c.transform, transform), out, depth + 1);
      name ||= n;
    }
    return name;
  };
  const items = root.items.length ? root.items : [...root.objects.keys()].map((id) => ({ path: rootPath, id, transform: IDENTITY }));
  const soups: Soup[] = [];
  for (const it of items) {
    const out = { positions: [] as number[], indices: [] as number[] };
    const name = collect(it.path, it.id, it.transform, out, 0);
    if (out.indices.length) soups.push({ name, positions: out.positions, indices: out.indices });
  }
  if (!soups.length) throw new Error('This 3MF file has no printable objects.');
  return soups;
}

// ---------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------

/** Wavefront OBJ: vertices and faces (polygons fanned into triangles), one object per `o`. */
export function parseOBJ(text: string): Soup[] {
  const verts: number[] = [];
  const soups: { name: string; faces: number[] }[] = [];
  let cur: { name: string; faces: number[] } | null = null;
  const at = () => (cur ??= (soups.push({ name: '', faces: [] }), soups[soups.length - 1]));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(Number(x), Number(y), Number(z));
    } else if (line.startsWith('f ')) {
      const nv = verts.length / 3;
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((t) => {
          const i = parseInt(t, 10);
          return i < 0 ? nv + i : i - 1;
        })
        .filter((i) => Number.isInteger(i) && i >= 0 && i < nv);
      const f = at().faces;
      for (let k = 1; k + 1 < idx.length; k++) f.push(idx[0], idx[k], idx[k + 1]);
    } else if (line.startsWith('o ')) {
      cur = { name: line.slice(2).trim().slice(0, 60), faces: [] };
      soups.push(cur);
    }
  }
  const out = soups.filter((s) => s.faces.length).map((s) => ({ name: s.name, positions: verts, indices: s.faces }));
  if (!out.length) throw new Error('No faces in this OBJ file.');
  return out;
}
