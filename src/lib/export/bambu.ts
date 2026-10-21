import { zipSync, strToU8 } from 'fflate';
import { collectObjects, escapeXml, matToString, meshXml, placeTransform, type ExportObject, type Mat12 } from './threemf';
import type { MeshLookup, PrintJob } from '../project';
import type { PrintSetup } from '../layout/plan';
import { bambuLayerChanges, meshBodySlots, plateChanges, slotColours, type PlateChanges } from './colourExport';
import { coloursOn, paletteOf } from '../colours';

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
 *  - Multi-colour (colours.ts): each part's bodies get their filament
 *    (`<metadata key="extruder">` on the object and on parts that differ),
 *    the filament lists grow to the slots used (withFilaments), and plates
 *    with colour changes by height get Metadata/custom_gcode_per_layer.xml
 *    (colourExport.ts).
 */

export const BAMBU_VERSION = '02.08.04.61';

export interface BambuPart {
  /** Index into objects. */
  object: number;
  /** Transform on the plate (bed coordinates, bed front-left = 0,0). */
  transform: Mat12;
  name: string;
  /** Filament slot of each body (the mesh, then its overlays); unset: 1, and each overlay's own `filament`. */
  bodies?: number[];
}

export interface BambuPlate {
  name: string;
  parts: BambuPart[];
  /** Filament changes by height on this plate (colours.ts 'height'). */
  changes?: PlateChanges | null;
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
  /** Multi-colour: every slot's colour from slot 1 (the palette); slot 1 then replaces the preset's. */
  palette?: string[];
  /** The per-layer changes file (colourExport.ts bambuLayerChanges), when plates have changes. */
  layerChanges?: string | null;
}

const EXTRA_COLOURS = ['#161616', '#FFFFFF', '#C12E1F', '#0A2989', '#F4EE2A'];

/**
 * Per-filament settings with one value per extruder variant of the printer
 * (BambuStudio PrintConfig.cpp `filament_options_with_variant`): a filament's
 * values sit together, `filament_self_index` says which filament each belongs
 * to, and `filament_extruder_variant` which variant. Bambu Studio refuses a
 * project whose `filament_extruder_variant` has fewer entries than filaments.
 */
export const FILAMENT_VARIANT_KEYS = [
  'filament_flow_ratio',
  'filament_max_volumetric_speed',
  'filament_ramming_volumetric_speed',
  'filament_pre_cooling_temperature',
  'filament_ramming_travel_time',
  'filament_ramming_volumetric_speed_nc',
  'filament_pre_cooling_temperature_nc',
  'filament_ramming_travel_time_nc',
  'filament_extruder_variant',
  'filament_retraction_length',
  'filament_retract_length_nc',
  'filament_z_hop',
  'filament_z_hop_types',
  'filament_retract_restart_extra',
  'filament_retraction_speed',
  'filament_deretraction_speed',
  'filament_retraction_minimum_travel',
  'filament_retract_when_changing_layer',
  'filament_wipe',
  'filament_wipe_distance',
  'filament_retract_before_wipe',
  'filament_long_retractions_when_cut',
  'filament_retraction_distances_when_cut',
  'long_retractions_when_ec',
  'retraction_distances_when_ec',
  'nozzle_temperature_initial_layer',
  'nozzle_temperature',
  'filament_flush_volumetric_speed',
  'filament_flush_temp',
  'filament_flush_temp_fast',
  'filament_enable_overhang_speed',
  'filament_bridge_speed',
  'filament_overhang_1_4_speed',
  'filament_overhang_2_4_speed',
  'filament_overhang_3_4_speed',
  'filament_overhang_4_4_speed',
  'filament_overhang_totally_speed',
  'override_process_overhang_speed',
  'volumetric_speed_coefficients',
  'filament_adaptive_volumetric_speed',
  'filament_preheat_temperature_delta',
  'filament_cooling_before_tower',
  'slow_down_min_speed',
] as const;

/** One value per filament: grown by repeating the last (Bambu Studio would fill them from the first anyway). */
const FILAMENT_KEYS = [
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
  'default_filament_colour',
] as const;

/**
 * Grow single-filament project settings to `count` filaments, all copies of
 * filament 1's preset (PLA Basic), coloured `colours[i]` for slot i + 2
 * (default: black, white, red…) and slot 1 `first` when given.
 *
 * Bambu Studio takes the filament count from `filament_diameter`. Lists of
 * one value per filament grow by repeating the last; lists with a value per
 * filament and extruder variant (FILAMENT_VARIANT_KEYS) get filament 1's
 * block again for each new filament, with `filament_self_index` numbering
 * them; per-extruder lists (nozzle_diameter, extruder_*) don't change. The
 * flush volume matrix is count × count per nozzle (as PresetBundle sizes it).
 */
export function withFilaments(settingsJson: string, count: number, colours: string[] = [], first?: string): string {
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return settingsJson;
  }
  const have = Array.isArray(cfg.filament_diameter) ? cfg.filament_diameter.length : 1;
  if (have >= count && !first) return settingsJson;
  const grow = (key: string, fill?: (i: number) => string) => {
    const v = cfg[key];
    if (!Array.isArray(v) || !v.length) return;
    const out = [...v];
    while (out.length < count) out.push(fill ? fill(out.length) : out[out.length - 1]);
    cfg[key] = out;
  };
  if (have < count) {
    for (const key of FILAMENT_KEYS) grow(key);
    // Values per filament and extruder variant: filament 1's block once more for each new filament.
    const self = Array.isArray(cfg.filament_self_index) ? (cfg.filament_self_index as string[]).map(String) : null;
    const variants = Array.isArray(cfg.filament_extruder_variant) ? (cfg.filament_extruder_variant as unknown[]).length : 0;
    if (self && self.length === variants && variants >= have) {
      const block = self.map((v, i) => (v === '1' ? i : -1)).filter((i) => i >= 0);
      for (const key of FILAMENT_VARIANT_KEYS) {
        const v = cfg[key];
        if (!Array.isArray(v) || v.length !== self.length) continue;
        const out = [...v];
        for (let f = have + 1; f <= count; f++) for (const i of block) out.push(v[i]);
        cfg[key] = out;
      }
      const ids = [...self];
      for (let f = have + 1; f <= count; f++) for (let i = 0; i < block.length; i++) ids.push(String(f));
      cfg.filament_self_index = ids;
    } else {
      // An older settings file without variants: one value per filament.
      for (const key of FILAMENT_VARIANT_KEYS) grow(key);
    }
    // [process, filament 1..n, printer]
    for (const key of ['different_settings_to_system', 'inherits_group']) {
      const v = cfg[key];
      if (Array.isArray(v) && v.length === have + 2) {
        cfg[key] = [v[0], ...v.slice(1, -1), ...Array(count - have).fill(v[v.length - 2]), v[v.length - 1]];
      }
    }
    // Flush volumes: count × count per nozzle (no flush onto itself), and two per filament in the vector.
    const nozzles = Array.isArray(cfg.flush_multiplier) ? Math.max(1, (cfg.flush_multiplier as unknown[]).length) : 1;
    const mx = Array.isArray(cfg.flush_volumes_matrix) ? (cfg.flush_volumes_matrix as string[]) : null;
    if (mx) {
      const off = mx.find((v) => Number(v) > 0) ?? '280';
      const matrix: string[] = [];
      for (let n = 0; n < nozzles; n++) for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) matrix.push(i === j ? '0' : off);
      cfg.flush_volumes_matrix = matrix;
    }
    const vec = Array.isArray(cfg.flush_volumes_vector) ? (cfg.flush_volumes_vector as string[]) : null;
    if (vec?.length) cfg.flush_volumes_vector = Array.from({ length: 2 * count }, (_, i) => vec[i % 2] ?? vec[0]);
  }
  grow('filament_colour', (i) => colours[i - 1] ?? EXTRA_COLOURS[(i - 1) % EXTRA_COLOURS.length]);
  if (Array.isArray(cfg.filament_colour)) {
    const c = [...(cfg.filament_colour as string[])];
    colours.forEach((v, i) => i + 1 < c.length && v && (c[i + 1] = v));
    if (first) c[0] = first;
    cfg.filament_colour = c;
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
    const slot = (i: number, own: number) => f.part.bodies?.[i] ?? own;
    const bodies: Body[] = [{ id: nextId++, name: f.part.name, filament: slot(0, 1), xml: () => meshFor(f.part.object) }];
    (obj.mesh.overlays ?? []).forEach((o, i) => {
      bodies.push({ id: nextId++, name: `${f.part.name} – ${o.name}`, filament: slot(i + 1, o.filament), xml: () => meshXml(o) });
    });
    return { ...f, bodies, wrapId: nextId++, path: `/3D/Objects/object_${f.k}.model` };
  });
  const filamentCount = Math.max(1, ...placed.flatMap((p) => p.bodies.map((b) => b.filament)), ...plates.flatMap((pl) => pl.changes?.changes.map((c) => c.slot) ?? []));

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
    // The object's filament is its main body's; parts in another one say so.
    const own = f.bodies[0].filament;
    cfg.push(`  <object id="${f.wrapId}">`, `    <metadata key="name" value="${name}"/>`, `    <metadata key="extruder" value="${own}"/>`);
    for (const b of f.bodies) {
      cfg.push(
        `    <part id="${b.id}" subtype="normal_part">`,
        `      <metadata key="name" value="${escapeXml(b.name)}"/>`,
        `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
        ...(b.filament !== own ? [`      <metadata key="extruder" value="${b.filament}"/>`] : []),
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
    const settings = input.palette
      ? withFilaments(input.projectSettings, filamentCount, input.palette.slice(1, filamentCount), input.palette[0])
      : filamentCount > 1
        ? withFilaments(input.projectSettings, filamentCount, input.filamentColours)
        : input.projectSettings;
    files['Metadata/project_settings.config'] = strToU8(settings);
  }
  // Colour changes by height, per plate (colourExport.ts).
  if (input.layerChanges) files['Metadata/custom_gcode_per_layer.xml'] = strToU8(input.layerChanges);

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
  const multi = coloursOn(setup);
  const plates: BambuPlate[] = job.plates.map((pl, i) => {
    // 'height': every object on the plate in its first band's filament, the changes by layer.
    const changes = plateChanges(setup, job, i);
    return {
      name: pl.name,
      changes,
      parts: pl.placements.map((p) => {
        const part = job.parts[p.key];
        const object = objectFor(part.meshKey, part.name);
        return {
          object,
          name: part.name,
          transform: placeTransform(p.x, p.y, p.rotated, part.d),
          ...(multi ? { bodies: meshBodySlots(setup, job, p.key, objects[object].mesh, changes?.base) } : {}),
        };
      }),
    };
  });
  const legacy = paletteOf(setup);
  return writeBambuProject({
    objects,
    plates,
    bedW: setup.bedW,
    bedD: setup.bedD,
    projectSettings,
    title: 'Gridfinity drawer',
    // Filament 2 prints inlaid label text; with multi-colour, every slot is the palette's.
    ...(multi
      ? { palette: slotColours(setup, 16), layerChanges: bambuLayerChanges(setup, plates.map((pl, i) => ({ plate: i, changes: pl.changes ?? null }))) }
      : { filamentColours: legacy.length > 1 ? [legacy[1].colour.toUpperCase()] : undefined }),
  });
}
