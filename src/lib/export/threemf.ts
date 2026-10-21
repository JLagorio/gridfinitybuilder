import { zipSync, strToU8 } from 'fflate';
import type { MeshData } from '../geometry/kernel';
import { assemblyMaps, plateContents, printerFolder, type JobPlate, type MeshLookup, type PrintJob } from '../project';
import { connectorSteps, type PrintSetup } from '../layout/plan';
import { jobPrinters } from '../layout/fleet';
import { findPrinter } from '../printers';
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

/** `<mesh>…</mesh>` for one object. Indentation is skipped to keep files small. */
export function meshXml(mesh: MeshData): string {
  const p = mesh.positions;
  const t = mesh.indices;
  const parts: string[] = ['<mesh><vertices>\n'];
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`<vertex x="${fmtNum(p[i])}" y="${fmtNum(p[i + 1])}" z="${fmtNum(p[i + 2])}"/>\n`);
  }
  parts.push('</vertices><triangles>\n');
  for (let i = 0; i < t.length; i += 3) {
    parts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
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

/**
 * Plain 3MF (core spec) that any slicer opens: one object per part, placed by build items.
 * Meshes shared by several items are written once.
 */
export function write3MF(objects: ExportObject[], items: ExportItem[], title = 'Gridfit'): Uint8Array {
  const xml: string[] = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  xml.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
  );
  xml.push(`<metadata name="Title">${escapeXml(title)}</metadata>\n`);
  xml.push('<metadata name="Application">Gridfit</metadata>\n');
  xml.push('<resources>\n');
  // Objects with overlays (bodies in another filament) become a wrapper with one component per body,
  // which slicers import as one object made of several parts.
  let nextId = 1;
  const ids = objects.map((o) => {
    if (!o.mesh.overlays?.length) {
      const id = nextId++;
      xml.push(`<object id="${id}" type="model" name="${escapeXml(o.name)}">`);
      xml.push(meshXml(o.mesh));
      xml.push('</object>\n');
      return id;
    }
    const bodies = [{ name: o.name, mesh: o.mesh as MeshData }, ...o.mesh.overlays.map((ov) => ({ name: `${o.name} – ${ov.name}`, mesh: ov }))];
    const bodyIds = bodies.map((b) => {
      const id = nextId++;
      xml.push(`<object id="${id}" type="model" name="${escapeXml(b.name)}">`);
      xml.push(meshXml(b.mesh));
      xml.push('</object>\n');
      return id;
    });
    const id = nextId++;
    xml.push(`<object id="${id}" type="model" name="${escapeXml(o.name)}"><components>`);
    for (const b of bodyIds) xml.push(`<component objectid="${b}"/>`);
    xml.push('</components></object>\n');
    return id;
  });
  xml.push('</resources>\n<build>\n');
  for (const it of items) {
    xml.push(`<item objectid="${ids[it.object]}" transform="${matToString(it.transform)}"/>\n`);
  }
  xml.push('</build>\n</model>\n');
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      '3D/3dmodel.model': strToU8(xml.join('')),
    },
    { level: 6 },
  );
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

/** One plate as a 3MF, parts already arranged. */
export function exportPlate3MF(job: PrintJob, plateIndex: number, getMesh: MeshLookup): Uint8Array {
  const pl = job.plates[plateIndex];
  const { objects, objectFor } = collectObjects(getMesh);
  const items = pl.placements.map((p) => {
    const part = job.parts[p.key];
    return { object: objectFor(part.meshKey, part.name), transform: placeTransform(p.x, p.y, p.rotated, part.d) };
  });
  return write3MF(objects, items, pl.name);
}

/** Single part, at the origin — for "download this bin". */
export function exportSingle3MF(name: string, mesh: MeshData): Uint8Array {
  return write3MF([{ name, mesh }], [{ object: 0, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }], name);
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawer';

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
        `${d.layout.nx} × ${d.layout.ny} cells, ${d.plan.pieces.length} pieces`,
    ),
    '',
    'Each .3mf file is one print plate with parts already arranged.',
    'Baseplate pieces are numbered; see the assembly map for where each one goes.',
    ...(keys ? ['', ...connectorSteps(keys)] : []),
    ...job.drawers.flatMap((d) => (d.steps.length ? ['', ...(job.drawers.length > 1 ? [`${d.name}:`] : []), ...d.steps] : [])),
    // Vase-mode bins need the slicer set up for them (layout/spiral.ts).
    ...(spiralNotes(job).length ? ['', ...spiralNotes(job)] : []),
    '',
    ...job.plates.map((pl, i) => `Plate ${i + 1} (${pl.name}${on(pl)}): ${plateContents(job, pl).join(', ')}`),
    '',
  ];
  return lines.join('\n');
}
