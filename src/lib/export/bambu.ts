import { zipSync, strToU8 } from 'fflate';
import { collectObjects, escapeXml, matToString, meshXml, placeTransform, type ExportObject, type Mat12 } from './threemf';
import type { MeshLookup, PrintJob } from '../project';
import type { PrintSetup } from '../layout/plan';

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
  /** Colours for filament slots 2+ when overlays use them (default: black, white, red…). */
  filamentColours?: string[];
}

const EXTRA_COLOURS = ['#161616', '#FFFFFF', '#C12E1F', '#0A2989', '#F4EE2A'];

/**
 * Grow single-filament project settings to `count` filaments. Bambu Studio
 * takes the filament count from `filament_diameter` and fills any shorter
 * per-filament list from its first entry, so only the lists that identify a
 * filament need to grow. Per-extruder lists (nozzle_diameter, extruder_*)
 * must not change on a single-nozzle printer.
 */
export function withFilaments(settingsJson: string, count: number, colours: string[] = []): string {
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return settingsJson;
  }
  const have = Array.isArray(cfg.filament_diameter) ? cfg.filament_diameter.length : 1;
  if (have >= count) return settingsJson;
  const grow = (key: string, fill?: (i: number) => string) => {
    const v = cfg[key];
    if (!Array.isArray(v) || !v.length) return;
    const out = [...v];
    while (out.length < count) out.push(fill ? fill(out.length) : out[out.length - 1]);
    cfg[key] = out;
  };
  for (const key of [
    'filament_diameter',
    'filament_settings_id',
    'filament_type',
    'filament_ids',
    'filament_vendor',
    'filament_density',
    'filament_cost',
    'filament_map',
    'filament_nozzle_map',
    'filament_volume_map',
    'filament_is_mixed',
    'filament_extruder_compatibility',
    'filament_flow_ratio',
    'filament_max_volumetric_speed',
    'nozzle_temperature',
    'nozzle_temperature_initial_layer',
    'default_filament_colour',
  ]) {
    grow(key);
  }
  grow('filament_colour', (i) => colours[i - 1] ?? EXTRA_COLOURS[(i - 1) % EXTRA_COLOURS.length]);
  // [process, filament 1..n, printer]
  for (const key of ['different_settings_to_system', 'inherits_group']) {
    const v = cfg[key];
    if (Array.isArray(v) && v.length === have + 2) {
      cfg[key] = [v[0], ...v.slice(1, -1), ...Array(count - have).fill(v[v.length - 2]), v[v.length - 1]];
    }
  }
  return JSON.stringify(cfg, null, 4);
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

  // Every placed part is one Bambu object: a wrapper whose components are its
  // bodies (the main mesh plus any overlays in other filaments). Ids are
  // allocated in order: the bodies first, then the wrapper.
  type Body = { id: number; name: string; filament: number; xml: () => string };
  type Placed = Flat & { wrapId: number; bodies: Body[]; path: string };
  let nextId = 1;
  const placed: Placed[] = flat.map((f) => {
    const obj = objects[f.part.object];
    const bodies: Body[] = [{ id: nextId++, name: f.part.name, filament: 1, xml: () => meshFor(f.part.object) }];
    for (const o of obj.mesh.overlays ?? []) {
      bodies.push({ id: nextId++, name: `${f.part.name} – ${o.name}`, filament: o.filament, xml: () => meshXml(o) });
    }
    return { ...f, bodies, wrapId: nextId++, path: `/3D/Objects/object_${f.k}.model` };
  });
  const filamentCount = Math.max(1, ...placed.flatMap((p) => p.bodies.map((b) => b.filament)));

  const rels: string[] = [];
  const resources: string[] = [];
  const build: string[] = [];
  for (const f of placed) {
    files[f.path.slice(1)] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>\n` +
        ` <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n` +
        f.bodies
          .map(
            (b) =>
              `  <object id="${b.id}" p:UUID="${hex4(f.k)}${hex4(b.id)}-81cb-4c03-9d28-80fed5dfa1dc" type="model">\n` +
              b.xml() +
              `\n  </object>\n`,
          )
          .join('') +
        ` </resources>\n <build/>\n</model>\n`,
    );
    rels.push(
      ` <Relationship Target="${f.path}" Id="rel-${f.k}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
    );
    resources.push(
      `  <object id="${f.wrapId}" p:UUID="${hex8(f.k)}-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n` +
        `   <components>\n` +
        f.bodies
          .map(
            (b) =>
              `    <component p:path="${f.path}" objectid="${b.id}" p:UUID="${hex4(f.k)}${hex4(b.id)}-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n`,
          )
          .join('') +
        `   </components>\n  </object>`,
    );
    build.push(
      `  <item objectid="${f.wrapId}" p:UUID="${hex8(f.wrapId)}-b1ec-4553-aec9-835e5b724bb4" transform="${matToString(f.world)}" printable="1"/>`,
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
  for (const f of placed) {
    const name = escapeXml(f.part.name);
    cfg.push(`  <object id="${f.wrapId}">`, `    <metadata key="name" value="${name}"/>`, `    <metadata key="extruder" value="1"/>`);
    for (const b of f.bodies) {
      cfg.push(
        `    <part id="${b.id}" subtype="normal_part">`,
        `      <metadata key="name" value="${escapeXml(b.name)}"/>`,
        `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
        ...(b.filament > 1 ? [`      <metadata key="extruder" value="${b.filament}"/>`] : []),
        `    </part>`,
      );
    }
    cfg.push(`  </object>`);
  }
  plates.forEach((pl, pi) => {
    cfg.push(
      '  <plate>',
      `    <metadata key="plater_id" value="${pi + 1}"/>`,
      `    <metadata key="plater_name" value="${escapeXml(pl.name)}"/>`,
      '    <metadata key="locked" value="false"/>',
    );
    for (const f of placed.filter((x) => x.plate === pi)) {
      cfg.push(
        '    <model_instance>',
        `      <metadata key="object_id" value="${f.wrapId}"/>`,
        '      <metadata key="instance_id" value="0"/>',
        `      <metadata key="identify_id" value="${1000 + f.k}"/>`,
        '    </model_instance>',
      );
    }
    cfg.push('  </plate>');
  });
  cfg.push('  <assemble>');
  for (const f of placed) {
    cfg.push(
      `   <assemble_item object_id="${f.wrapId}" instance_id="0" transform="${matToString(f.world)}" offset="0 0 0" />`,
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
  if (input.projectSettings) {
    const settings = filamentCount > 1 ? withFilaments(input.projectSettings, filamentCount, input.filamentColours) : input.projectSettings;
    files['Metadata/project_settings.config'] = strToU8(settings);
  }

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

/** The whole job as one Bambu Studio project: a plate per print plate. */
export function exportBambuProject(
  job: PrintJob,
  setup: PrintSetup,
  getMesh: MeshLookup,
  projectSettings?: string,
): Uint8Array {
  const { objects, objectFor } = collectObjects(getMesh);
  const plates: BambuPlate[] = job.plates.map((pl) => ({
    name: pl.name,
    parts: pl.placements.map((p) => {
      const part = job.parts[p.key];
      return {
        object: objectFor(part.meshKey, part.name),
        name: part.name,
        transform: placeTransform(p.x, p.y, p.rotated, part.d),
      };
    }),
  }));
  return writeBambuProject({
    objects,
    plates,
    bedW: setup.bedW,
    bedD: setup.bedD,
    projectSettings,
    title: 'Gridfinity drawer',
    // Filament 2 prints inlaid label text.
    filamentColours: setup.labelColour ? [setup.labelColour.toUpperCase()] : undefined,
  });
}
