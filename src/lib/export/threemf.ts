import { zipSync, strToU8 } from 'fflate';
import type { MeshData } from '../geometry/kernel';

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
  objects.forEach((o, i) => {
    xml.push(`<object id="${i + 1}" type="model" name="${escapeXml(o.name)}">`);
    xml.push(meshXml(o.mesh));
    xml.push('</object>\n');
  });
  xml.push('</resources>\n<build>\n');
  for (const it of items) {
    xml.push(`<item objectid="${it.object + 1}" transform="${matToString(it.transform)}"/>\n`);
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
