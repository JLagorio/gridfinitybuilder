import { zipSync, strToU8 } from 'fflate';
import { escapeXml, matToString, meshXml, type ExportObject, type Mat12 } from './threemf';

/**
 * Bambu Studio project 3MF with one plate per print plate.
 *
 * Mirrors what Bambu Studio itself writes (checked against 02.08 projects):
 *  - 3D/3dmodel.model holds one wrapper object per part; each wrapper points at
 *    a mesh object in 3D/Objects/object_<k>.model (mesh id 2k-1, wrapper id 2k).
 *  - Metadata/model_settings.config assigns instances to plates.
 *  - Plates sit side by side in world space: plate i is offset by
 *    (col · 1.2 · bedW, −row · 1.2 · bedD) with cols = ceil-ish(√n), exactly
 *    like PartPlateList::compute_origin.
 *  - Metadata/project_settings.config (optional) selects printer/process/filament.
 */

export const BAMBU_VERSION = '02.08.04.61';

export interface BambuPart {
  /** Index into objects. */
  object: number;
  /** Transform on the plate (bed coordinates, bed front-left = 0,0). */
  transform: Mat12;
  name: string;
}

export interface BambuPlate {
  name: string;
  parts: BambuPart[];
}

export interface BambuProjectInput {
  objects: ExportObject[];
  plates: BambuPlate[];
  bedW: number;
  bedD: number;
  /** Full project_settings.config JSON text, if available. */
  projectSettings?: string;
  title?: string;
}

const PLATE_GAP = 1 / 5;

/** Same as Bambu Studio's compute_colum_count. */
export function plateColumns(count: number): number {
  const value = Math.sqrt(count);
  const rounded = Math.round(value);
  return value > rounded ? rounded + 1 : Math.max(1, rounded);
}

export function plateOrigin(index: number, count: number, bedW: number, bedD: number): [number, number] {
  const cols = plateColumns(count);
  const row = Math.floor(index / cols);
  const col = index % cols;
  return [col * bedW * (1 + PLATE_GAP), -row * bedD * (1 + PLATE_GAP)];
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');
const hex4 = (n: number) => n.toString(16).padStart(4, '0');

export function writeBambuProject(input: BambuProjectInput): Uint8Array {
  const { objects, plates, bedW, bedD } = input;
  const files: Record<string, Uint8Array> = {};
  const today = new Date().toISOString().slice(0, 10);

  // Flatten parts: every placed part becomes its own Bambu object (k = 1..n).
  type Flat = { k: number; part: BambuPart; plate: number; world: Mat12 };
  const flat: Flat[] = [];
  plates.forEach((pl, pi) => {
    const [ox, oy] = plateOrigin(pi, plates.length, bedW, bedD);
    for (const part of pl.parts) {
      const t = [...part.transform] as Mat12;
      t[9] += ox;
      t[10] += oy;
      flat.push({ k: flat.length + 1, part, plate: pi, world: t });
    }
  });

  const meshXmlCache = new Map<number, string>();
  const meshFor = (i: number) => {
    let s = meshXmlCache.get(i);
    if (!s) {
      s = meshXml(objects[i].mesh);
      meshXmlCache.set(i, s);
    }
    return s;
  };

  const NS =
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

  const rels: string[] = [];
  const resources: string[] = [];
  const build: string[] = [];
  for (const f of flat) {
    const meshId = 2 * f.k - 1;
    const wrapId = 2 * f.k;
    const path = `/3D/Objects/object_${f.k}.model`;
    files[path.slice(1)] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>\n` +
        ` <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n` +
        `  <object id="${meshId}" p:UUID="${hex4(f.k)}0000-81cb-4c03-9d28-80fed5dfa1dc" type="model">\n` +
        meshFor(f.part.object) +
        `\n  </object>\n </resources>\n <build/>\n</model>\n`,
    );
    rels.push(
      ` <Relationship Target="${path}" Id="rel-${f.k}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
    );
    resources.push(
      `  <object id="${wrapId}" p:UUID="${hex8(f.k)}-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n` +
        `   <components>\n` +
        `    <component p:path="${path}" objectid="${meshId}" p:UUID="${hex4(f.k)}0000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n` +
        `   </components>\n  </object>`,
    );
    build.push(
      `  <item objectid="${wrapId}" p:UUID="${hex8(wrapId)}-b1ec-4553-aec9-835e5b724bb4" transform="${matToString(f.world)}" printable="1"/>`,
    );
  }

  const meta = (name: string, value: string) => ` <metadata name="${name}">${escapeXml(value)}</metadata>`;
  files['3D/3dmodel.model'] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<model unit="millimeter" xml:lang="en-US" ${NS}>`,
      meta('Application', `BambuStudio-${BAMBU_VERSION}`),
      meta('BambuStudio:3mfVersion', '1'),
      meta('CreationDate', today),
      meta('ModificationDate', today),
      meta('Title', input.title ?? 'Gridfit'),
      meta('Designer', 'Gridfit'),
      ' <resources>',
      ...resources,
      ' </resources>',
      ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">',
      ...build,
      ' </build>',
      '</model>',
      '',
    ].join('\n'),
  );
  files['3D/_rels/3dmodel.model.rels'] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ...rels,
      '</Relationships>',
      '',
    ].join('\n'),
  );

  // model_settings.config: objects, plates, assembly
  const cfg: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  for (const f of flat) {
    const name = escapeXml(f.part.name);
    cfg.push(
      `  <object id="${2 * f.k}">`,
      `    <metadata key="name" value="${name}"/>`,
      `    <metadata key="extruder" value="1"/>`,
      `    <part id="${2 * f.k - 1}" subtype="normal_part">`,
      `      <metadata key="name" value="${name}"/>`,
      `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
      `    </part>`,
      `  </object>`,
    );
  }
  plates.forEach((pl, pi) => {
    cfg.push(
      '  <plate>',
      `    <metadata key="plater_id" value="${pi + 1}"/>`,
      `    <metadata key="plater_name" value="${escapeXml(pl.name)}"/>`,
      '    <metadata key="locked" value="false"/>',
    );
    for (const f of flat.filter((x) => x.plate === pi)) {
      cfg.push(
        '    <model_instance>',
        `      <metadata key="object_id" value="${2 * f.k}"/>`,
        '      <metadata key="instance_id" value="0"/>',
        `      <metadata key="identify_id" value="${1000 + f.k}"/>`,
        '    </model_instance>',
      );
    }
    cfg.push('  </plate>');
  });
  cfg.push('  <assemble>');
  for (const f of flat) {
    cfg.push(
      `   <assemble_item object_id="${2 * f.k}" instance_id="0" transform="${matToString(f.world)}" offset="0 0 0" />`,
    );
  }
  cfg.push('  </assemble>', '</config>', '');
  files['Metadata/model_settings.config'] = strToU8(cfg.join('\n'));

  files['Metadata/slice_info.config'] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<config>',
      '  <header>',
      '    <header_item key="X-BBL-Client-Type" value="slicer"/>',
      `    <header_item key="X-BBL-Client-Version" value="${BAMBU_VERSION}"/>`,
      '  </header>',
      '</config>',
      '',
    ].join('\n'),
  );
  if (input.projectSettings) files['Metadata/project_settings.config'] = strToU8(input.projectSettings);

  files['[Content_Types].xml'] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
      ' <Default Extension="png" ContentType="image/png"/>',
      ' <Default Extension="gcode" ContentType="text/x.gcode"/>',
      '</Types>',
      '',
    ].join('\n'),
  );
  files['_rels/.rels'] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
      '</Relationships>',
      '',
    ].join('\n'),
  );
  return zipSync(files, { level: 6 });
}
