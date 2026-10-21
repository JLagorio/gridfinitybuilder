import { zipSync, strToU8 } from 'fflate';
import type { MeshData } from '../geometry/kernel';
import { assemblyMaps, plateContents, printerFolder, type JobPlate, type MeshLookup, type PrintJob } from '../project';
import { connectorSteps, type PrintSetup } from '../layout/plan';
import { jobPrinters } from '../layout/fleet';
import { findPrinter } from '../printers';
import { changesText, meshBodySlots, plateChanges, prusaLayerChanges, slotColours } from './colourExport';
import { slotLabel, type ColourSetupFields } from '../colours';
import { spiralNotes } from './spiralNotes';

/** 3MF affine transform: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz (row-vector convention). */
export type Mat12 = [number, number, number, number, number, number, number, number, number, number, number, number];

export interface ExportObject {
  name: string;
  mesh: MeshData;
}

export interface ExportItem {
  /** Index into the objects array. */
  object: number;
  transform: Mat12;
  /** Filament slot of each body (the mesh, then its overlays), with multi-colour; unset: 1, and each overlay's own `filament`. */
  bodies?: number[];
}

/** Multi-colour for a plain 3MF (colours.ts). */
export interface ThreeMFColours {
  /** Colour of each slot (index 0 = slot 1). */
  palette: string[];
  /** Name of each slot, for the materials. */
  names: string[];
  /** PrusaSlicer's colour changes by height for the plate (colourExport.ts). */
  layerChanges?: string | null;
}

export const IDENTITY: Mat12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Place a part with its min corner at (x, y), optionally rotated 90° CCW about Z first. */
export function placeTransform(x: number, y: number, rotated: boolean, partD: number): Mat12 {
  // Rotation (x, y) -> (-y, x) moves the footprint to [-d, 0] × [0, w]; shift it back by d.
  return rotated ? [0, 1, 0, -1, 0, 0, 0, 0, 1, x + partD, y, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, 0];
}

export function fmtNum(v: number): string {
  const r = Math.round(v * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
}

export function matToString(m: Mat12): string {
  return m.map(fmtNum).join(' ');
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/**
 * `<mesh>…</mesh>` for one object. Indentation is skipped to keep files small.
 * With `triAttrs`, each triangle gets the attributes it returns for its body
 * (the triangles of `bodies` one after another): per-triangle materials.
 */
export function meshXml(mesh: Pick<MeshData, 'positions' | 'indices'>, triAttrs?: (body: number) => string, bodies?: Pick<MeshData, 'indices'>[]): string {
  const p = mesh.positions;
  const t = mesh.indices;
  const parts: string[] = ['<mesh><vertices>\n'];
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`<vertex x="${fmtNum(p[i])}" y="${fmtNum(p[i + 1])}" z="${fmtNum(p[i + 2])}"/>\n`);
  }
  parts.push('</vertices><triangles>\n');
  let body = 0;
  let end = bodies ? bodies[0].indices.length : Infinity;
  let attr = triAttrs ? triAttrs(0) : '';
  for (let i = 0; i < t.length; i += 3) {
    while (bodies && i >= end && body + 1 < bodies.length) {
      body++;
      end += bodies[body].indices.length;
      attr = triAttrs ? triAttrs(body) : '';
    }
    parts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"${attr}/>\n`);
  }
  parts.push('</triangles></mesh>');
  return parts.join('');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
</Types>
`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

const PE_NS = 'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"';

/**
 * Plain 3MF (core spec) that any slicer opens: one object per part, placed by
 * build items. A part of several bodies (inlaid label text, shadow floors,
 * the volumes of a part split by colour) is one object whose mesh holds every
 * body, with Metadata/Slic3r_PE_model.config saying which triangles are
 * which body and its filament: PrusaSlicer loads that as one object with a
 * volume per body (a component per body would load as separate objects, each
 * dropped onto the bed). With `colours`, a <basematerials> group holds the
 * palette's slots, each object and triangle points at its slot's colour, and
 * colour changes by height go in PrusaSlicer's per-print-z file.
 *
 * Meshes used by several items are written once, unless they have several
 * bodies or print in a slot other than 1: PrusaSlicer copies an object for
 * each extra instance without its volumes and filament.
 */
export function write3MF(objects: ExportObject[], items: ExportItem[], title = 'Gridfit', colours?: ThreeMFColours): Uint8Array {
  const xml: string[] = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  xml.push(`<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ${PE_NS}>\n`);
  xml.push(`<metadata name="Title">${escapeXml(title)}</metadata>\n`);
  xml.push('<metadata name="Application">Gridfit</metadata>\n');
  // PrusaSlicer reads Slic3r_PE_model.config, and keeps each object's volumes where they are, only for its own 3MF version.
  xml.push('<metadata name="slic3rpe:Version3mf">1</metadata>\n');
  xml.push('<resources>\n');
  const bodiesOf = (o: ExportObject) => [o.mesh as Pick<MeshData, 'positions' | 'indices'> & { name?: string }, ...(o.mesh.overlays ?? [])];
  const slotsOf = (it: ExportItem) => {
    const o = objects[it.object];
    return bodiesOf(o).map((_, i) => it.bodies?.[i] ?? (i === 0 ? 1 : o.mesh.overlays![i - 1].filament));
  };
  // Materials: the slots in use, in slot order.
  const used = colours ? [...new Set(items.flatMap(slotsOf))].sort((a, b) => a - b) : [];
  const MAT = 1;
  if (colours) {
    xml.push(`<basematerials id="${MAT}">\n`);
    for (const s of used) {
      const c = (colours.palette[s - 1] ?? '#808080').replace('#', '').toUpperCase();
      xml.push(`<base name="${escapeXml(colours.names[s - 1] ?? `Slot ${s}`)}" displaycolor="#${c}FF"/>\n`);
    }
    xml.push('</basematerials>\n');
  }
  const pindex = (slot: number) => used.indexOf(slot);
  let nextId = colours ? 2 : 1;
  const config: string[] = [];
  const shared = new Map<number, number>();
  const ids = items.map((it) => {
    const o = objects[it.object];
    const bodies = bodiesOf(o);
    const slots = slotsOf(it);
    const one = bodies.length === 1 && slots[0] === 1;
    if (one && shared.has(it.object)) return shared.get(it.object)!;
    const id = nextId++;
    if (one) shared.set(it.object, id);
    const mat = colours ? ` pid="${MAT}" pindex="${pindex(slots[0])}"` : '';
    xml.push(`<object id="${id}" type="model" name="${escapeXml(o.name)}"${mat}>`);
    xml.push(meshXml(mergeBodies(bodies), colours ? (b) => (slots[b] === slots[0] ? '' : ` pid="${MAT}" p1="${pindex(slots[b])}"`) : undefined, bodies));
    xml.push('</object>\n');
    if (!one) {
      // A volume per body: its triangles, name and filament.
      let first = 0;
      const vols = bodies.map((b, i) => {
        const n = b.indices.length / 3;
        const name = i === 0 ? o.name : `${o.name} – ${(b as { name?: string }).name ?? `body ${i + 1}`}`;
        const v =
          ` <volume firstid="${first}" lastid="${first + n - 1}">\n` +
          `  <metadata type="volume" key="name" value="${escapeXml(name)}"/>\n` +
          `  <metadata type="volume" key="extruder" value="${slots[i]}"/>\n` +
          ' </volume>';
        first += n;
        return v;
      });
      config.push(
        ` <object id="${id}" instances_count="1">\n  <metadata type="object" key="name" value="${escapeXml(o.name)}"/>\n  <metadata type="object" key="extruder" value="${slots[0]}"/>\n${vols.join('\n')}\n </object>`,
      );
    }
    return id;
  });
  xml.push('</resources>\n<build>\n');
  items.forEach((it, i) => xml.push(`<item objectid="${ids[i]}" transform="${matToString(it.transform)}"/>\n`));
  xml.push('</build>\n</model>\n');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    '3D/3dmodel.model': strToU8(xml.join('')),
  };
  if (config.length) files['Metadata/Slic3r_PE_model.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${config.join('\n')}\n</config>\n`);
  if (colours?.layerChanges) files['Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml'] = strToU8(colours.layerChanges);
  return zipSync(files, { level: 6 });
}

/** Several bodies as one mesh (their vertices one after another). */
function mergeBodies(bodies: Pick<MeshData, 'positions' | 'indices'>[]): Pick<MeshData, 'positions' | 'indices'> {
  if (bodies.length === 1) return bodies[0];
  const nv = bodies.reduce((t, b) => t + b.positions.length, 0);
  const nt = bodies.reduce((t, b) => t + b.indices.length, 0);
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(nt);
  let pv = 0;
  let pt = 0;
  for (const b of bodies) {
    positions.set(b.positions, pv);
    for (let i = 0; i < b.indices.length; i++) indices[pt + i] = b.indices[i] + pv / 3;
    pv += b.positions.length;
    pt += b.indices.length;
  }
  return { positions, indices };
}

/** The 3MF colour fields of a job with multi-colour on, else undefined. */
export function jobColours3MF(cs: ColourSetupFields | undefined, layerChanges?: string | null): ThreeMFColours | undefined {
  if (!cs) return undefined;
  const palette = slotColours(cs, 16);
  return { palette, names: palette.map((_, i) => slotLabel(cs, i + 1)), layerChanges };
}

/** One object per distinct mesh, in the order parts first use them. */
export function collectObjects(getMesh: MeshLookup) {
  const objects: ExportObject[] = [];
  const index = new Map<string, number>();
  const objectFor = (meshKey: string, name: string) => {
    let i = index.get(meshKey);
    if (i === undefined) {
      i = objects.length;
      objects.push({ name, mesh: getMesh(meshKey) });
      index.set(meshKey, i);
    }
    return i;
  };
  return { objects, objectFor };
}

/** One plate as a 3MF, parts already arranged; in the job's colours with multi-colour (PrintJob.colours). */
export function exportPlate3MF(job: PrintJob, plateIndex: number, getMesh: MeshLookup): Uint8Array {
  const pl = job.plates[plateIndex];
  const { objects, objectFor } = collectObjects(getMesh);
  const cs = job.colours;
  const changes = cs ? plateChanges(cs, job, plateIndex, cs.printerId) : null;
  const items = pl.placements.map((p) => {
    const part = job.parts[p.key];
    const object = objectFor(part.meshKey, part.name);
    return {
      object,
      transform: placeTransform(p.x, p.y, p.rotated, part.d),
      ...(cs ? { bodies: meshBodySlots(cs, job, p.key, objects[object].mesh, changes?.base) } : {}),
    };
  });
  return write3MF(objects, items, pl.name, jobColours3MF(cs, cs ? prusaLayerChanges(cs, changes) : null));
}

/** Single part, at the origin — for "download this bin". */
export function exportSingle3MF(name: string, mesh: MeshData): Uint8Array {
  return write3MF([{ name, mesh }], [{ object: 0, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }], name);
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer';

/** README lines on colours (multi-colour): what each file does, and every plate's colour changes by height. */
export function colourNotes(job: PrintJob): string[] {
  const cs = job.colours;
  if (!cs) return [];
  const out = ['', 'Colours: each part (and each body of a part in several colours) carries its filament slot; PrusaSlicer reads it as the extruder.'];
  job.plates.forEach((_, i) => {
    const t = changesText(cs, plateChanges(cs, job, i, cs.printerId));
    if (t) out.push(`  Plate ${i + 1}: ${t}`);
  });
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Every plate as its own 3MF, plus the assembly map(s) and a README. */
export function exportPlatesZip(job: PrintJob, setup: PrintSetup, getMesh: MeshLookup): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  job.plates.forEach((pl, i) => {
    const name = `${printerFolder(job, pl)}${String(i + 1).padStart(2, '0')}-${slug(pl.name)}.3mf`;
    files[name] = [exportPlate3MF(job, i, getMesh), { level: 0 }];
  });
  for (const [name, text] of Object.entries(assemblyMaps(job))) files[name] = strToU8(text);
  files['README.txt'] = strToU8(readme(job, setup));
  return zipSync(files);
}

function readme(job: PrintJob, setup: PrintSetup) {
  const printer = findPrinter(setup.printerId);
  const keys = job.drawers.reduce((t, d) => t + d.connectors.length, 0);
  // Several printers: each with its plates, which are in a folder named after it.
  const on = (pl: JobPlate) => (job.printers ? `, on the ${job.printers[pl.printer ?? 0]}` : '');
  const printers = jobPrinters(setup).map((p, k) => {
    const mine = job.plates.map((pl, i) => ((pl.printer ?? 0) === k ? i + 1 : 0)).filter(Boolean);
    return `  ${job.printers?.[k]} (${p.bedW} × ${p.bedD} mm bed, ${p.plateMargin} mm edge margin): ${mine.length ? `plates ${mine.join(', ')}` : 'no plates'}`;
  });
  const lines = [
    'Gridfinity drawer kit generated by Gridfit',
    '',
    ...(job.printers ? ['Printers (each one\'s plates are in a folder named after it):', ...printers] : [`Printer: ${printer.name} (${setup.bedW} × ${setup.bedD} mm bed, ${setup.plateMargin} mm edge margin)`]),
    ...job.drawers.map(
      (d) =>
        `${d.name ? `${d.name}: ` : ''}baseplate ${round(d.layout.plateW)} × ${round(d.layout.plateD)} mm, ` +
        `${d.layout.nx} × ${d.layout.ny} cells, ${d.haveBaseplate ? 'not printed (you have it): just bins' : `${d.plan.pieces.length} pieces`}`,
    ),
    '',
    'Each .3mf file is one print plate with parts already arranged.',
    ...(job.drawers.some((d) => !d.haveBaseplate) ? ['Baseplate pieces are numbered; see the assembly map for where each one goes.'] : []),
    ...(keys ? ['', ...connectorSteps(keys)] : []),
    ...job.drawers.flatMap((d) => (d.steps.length ? ['', ...(job.drawers.length > 1 ? [`${d.name}:`] : []), ...d.steps] : [])),
    // Vase-mode bins need the slicer set up for them (layout/spiral.ts).
    ...(spiralNotes(job).length ? ['', ...spiralNotes(job)] : []),
    '',
    ...job.plates.map((pl, i) => `Plate ${i + 1} (${pl.name}${on(pl)}): ${plateContents(job, pl).join(', ')}`),
    ...colourNotes(job),
    '',
  ];
  return lines.join('\n');
}
