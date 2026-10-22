/**
 * The sampler's boards and wall attachments (scripts/sampler.ts prints and
 * checks them, docs/print-check.md says what it found):
 *
 * - boards/skadis: Skådis board tiles filling a space (level and upright
 *   seams) and built from tiles (rectangles and hexagons), the square and
 *   dense patterns, frame rim strips (with the LED channel), zones (text
 *   engraved and inlaid, magnets), a French cleat, door hooks, desk feet and
 *   clamps, joint plates, spacers and screw covers;
 * - boards/opengrid, boards/multiboard: their tiles, openGrid's connectors and
 *   each one's test tile;
 * - attachments/<group>: every attachment kind (by its picker group) at its
 *   defaults, each of its presets, each value of its selects and its toggles
 *   flipped (a field shown only for another option's value: with that value),
 *   a few sizes picked by hand, and the common options (lock keys, bolts and
 *   their T-nuts, labels engraved, raised and inlaid, barbs). Every extra part
 *   prints too (containers, lids, doors, diffusers, rods, fit coupons), and
 *   two-colour inlays as bodies of their own.
 *
 * Each sample is a board of its own, planned like a real job (planPrint), so
 * the parts go through the app's own code: boards print their tiles and board
 * parts (`baseplate`), attachments their parts and nothing of the board
 * (`bins`). Planning only: the jobs build when the sampler asks.
 */
// Every attachment kind and the Skådis boards' planning (kinds/all.ts brings skadisBoardPlan.ts): without it a board
// plans bare, no tiles and no attachments.
import '../src/lib/wall/kinds/all';
// openGrid and Multiboard planning, as the app loads it with the first such board.
import '../src/lib/gridBoardPlan';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { DEFAULT_SKADIS, type SkadisOptions } from '../src/lib/geometry/skadis';
import { DEFAULT_OPENGRID, type OpenGridOptions } from '../src/lib/geometry/opengrid';
import { DEFAULT_MULTIBOARD, type MultiboardOptions } from '../src/lib/geometry/multiboard';
import { Scope, meshBounds, type Vec2, type Wasm } from '../src/lib/geometry/kernel';
import { attachmentDef, attachmentDefs, type AttachmentField, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { partBounds, printedSize } from '../src/lib/wall/mount';
import { partOvershoot, usableBed } from '../src/lib/bedfit';
import { centred, weld } from '../src/lib/imported/meshOps';
import { encodeMesh, meshHash } from '../src/lib/imported/format';
import { putImported } from '../src/lib/imported/registry';
import { flatMasks } from '../src/lib/wall/modelMesh';
import type { ModelRef } from '../src/lib/wall/kinds/model';
import type { SampleGroup } from './sampler-cases';

const SETUP = DEFAULT_SETUP;
/**
 * Attachments are planned on a bed nothing is too big for, so a sample board is one tile with every slot (a seam
 * takes a column of slots) and nothing is left out; each sample is made to fit the real bed first (fitBed), and the
 * sampler checks every part against it.
 */
const ANY_BED = { ...SETUP, bedW: 4000, bedD: 4000, maxH: 4000 };

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

const skadis = (id: string, o: Partial<SkadisOptions>): NamedDrawer => ({
  id,
  name: id,
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, ...o } },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});

const boardGroup = (name: string, note: string, drawers: NamedDrawer[]): SampleGroup => ({
  name,
  note,
  job: () => planPrint(drawers, SETUP, { baseplate: true, bins: false }),
});

/** Space filled: 600 × 400 splits into 3 × 2 tiles on the sample bed, so it has level and upright seams and plates where they cross. */
const SPACE = { width: 600, height: 400 };
/** A smaller board, for what doesn't need seams everywhere: 2 × 2 tiles. */
const SMALL = { width: 400, height: 300 };

const skadisBoards = boardGroup(
  'boards/skadis',
  'Skådis board tiles and their parts: seams, tiles, hexagons, patterns, frame strips, zones, hanging parts, joint plates, spacers, screw covers',
  [
    skadis('space', SPACE),
    skadis('space-spacers-plates', { ...SPACE, standoff: 'spacers', join: 'plates' }),
    skadis('space-tabs-covers', { ...SPACE, join: 'tabs', covers: true }),
    skadis('space-flat-no-joints', { ...SMALL, standoff: 'none', join: 'none', numbers: false }),
    skadis('space-hex', { ...SPACE, shape: 'hex' }),
    skadis('tiles-rect', {
      layout: 'tiles',
      tiles: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    }),
    skadis('tiles-rect-small', {
      layout: 'tiles',
      tiles: [
        [0, 0],
        [1, 0],
      ],
      tileSize: 120,
      tileHeight: 160,
    }),
    skadis('tiles-hex', {
      layout: 'tiles',
      shape: 'hex',
      tiles: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    }),
    skadis('square-14', { ...SMALL, pattern: 'square', pitch: 14 }),
    skadis('dense', { ...SMALL, pattern: 'dense' }),
    skadis('tiles-hex-square', {
      layout: 'tiles',
      shape: 'hex',
      pattern: 'square',
      pitch: 14,
      tiles: [
        [0, 0],
        [1, 0],
      ],
    }),
    skadis('thick-8-loose', { width: 220, height: 220, thickness: 8, fit: 'loose', chamfer: 1 }),
    skadis('rim', { ...SMALL, frame: 'rim' }),
    skadis('led', { ...SMALL, frame: 'led', rimHeight: 8 }),
    skadis('zones', {
      ...SMALL,
      zones: [
        { x: 120, y: 30, w: 160, h: 60, kind: 'text', text: 'PLIERS' },
        { x: 40, y: 200, w: 100, h: 40, kind: 'magnets', text: '' },
        { x: 220, y: 180, w: 120, h: 60, kind: 'text', text: 'Bits', style: 'inlaid' },
        { x: 300, y: 100, w: 60, h: 40, kind: 'blank', text: '' },
      ],
    }),
    skadis('cleat', { width: 220, height: 160, hang: 'cleat' }),
    skadis('door', { width: 220, height: 160, hang: 'door' }),
    skadis('desk-stand', { width: 220, height: 160, hang: 'desk' }),
    skadis('desk-clamp-rim', { width: 220, height: 160, hang: 'desk', deskMount: 'clamp', frame: 'rim' }),
  ],
);

const grid = (id: string, enclosure: 'opengrid' | 'multiboard', o: Partial<OpenGridOptions> | Partial<MultiboardOptions>): NamedDrawer => ({
  id,
  name: id,
  drawer: {
    ...DEFAULT_DRAWER,
    enclosure,
    ...(enclosure === 'opengrid' ? { opengrid: { ...DEFAULT_OPENGRID, ...o } } : { multiboard: { ...DEFAULT_MULTIBOARD, ...o } }),
  },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});

const openGridBoards = boardGroup('boards/opengrid', 'openGrid tiles (lite and full, screws, chamfered corners), their connectors and the test tile', [
  grid('lite', 'opengrid', {}),
  grid('full-grid-screws', 'opengrid', { variant: 'full', screws: 'grid', screwEvery: 2, chamfer: false }),
  grid('lite-no-connectors-snug', 'opengrid', { cols: 10, rows: 6, connectors: false, fit: 'snug', screws: 'none' }),
  grid('full-loose-small-tiles', 'opengrid', { variant: 'full', cols: 6, rows: 4, maxTile: 3, fit: 'loose' }),
  grid('test', 'opengrid', { test: true }),
]);

const multiboardBoards = boardGroup('boards/multiboard', 'Multiboard tiles: plain bores and threads, screws, the test tile', [
  grid('default', 'multiboard', {}),
  grid('threads', 'multiboard', { cols: 6, rows: 4, threads: true, pegThreads: true }),
  grid('grid-screws-snug', 'multiboard', { cols: 8, rows: 5, screws: 'grid', screwEvery: 2, fit: 'snug', maxTile: 4 }),
  grid('test', 'multiboard', { test: true, threads: true }),
]);

export const BOARD_GROUPS: SampleGroup[] = [skadisBoards, openGridBoards, multiboardBoards];

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** The sample board's slots and thickness (DEFAULT_SKADIS), as attachments see them. */
const CTX: MountCtx = {
  t: DEFAULT_SKADIS.thickness,
  slotW: DEFAULT_SKADIS.slotW,
  slotL: DEFAULT_SKADIS.slotL,
  pitch: DEFAULT_SKADIS.pitch,
  fit: DEFAULT_SKADIS.fit,
  behind: DEFAULT_SKADIS.depth,
};

/** One attachment on a board of its own: its options (over the kind's defaults) and the common ones. */
export interface AttachmentSample {
  id: string;
  type: string;
  opts: Record<string, unknown>;
  common?: Partial<Omit<PlacedAttachment, 'id' | 'type' | 'x' | 'y' | 'opts'>>;
}

const slug = (v: string) =>
  v
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * A board just big enough for the sample, the part on it: its front view's bottom-left 60 mm in from the board's,
 * its anchor snapped to the nearest slot by planning (every mount then finds one: they're an even number of steps
 * apart).
 */
function attachmentBoard(s: AttachmentSample): NamedDrawer {
  const def = attachmentDef(s.type)!;
  const o = def.sanitize({ ...def.defaults, ...s.opts }) as object;
  const layout = def.layout(o, CTX);
  const b = partBounds(layout, CTX);
  const W = Math.ceil((b.x1 - b.x0 + 140) / 20) * 20;
  // Lock keys stand above the part.
  const H = Math.ceil((b.y1 - b.y0 + 160) / 20) * 20;
  const a: PlacedAttachment = { id: 'a', type: s.type, x: 60 - b.x0 + layout.anchor[0], y: 60 - b.y0 + layout.anchor[1], opts: { ...s.opts }, ...s.common };
  return {
    id: s.id,
    name: s.id,
    drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: W, height: H }, attachments: [a] },
    baseplate: DEFAULT_BASEPLATE,
    bins: [],
  };
}

type FieldWith<K extends AttachmentField['kind']> = Extract<AttachmentField, { kind: K }>;

/**
 * Options that show a field hidden at the defaults: the first select value or toggle that does ({} when it shows
 * already, null when nothing on its own does).
 */
function showing(type: string, f: AttachmentField): Record<string, unknown> | null {
  const def = attachmentDef(type)!;
  const ui = attachmentUi(type)!;
  const when = f.when as ((o: object) => boolean) | undefined;
  const shown = (more: Record<string, unknown>) => !when || when(def.sanitize({ ...def.defaults, ...more }) as object);
  if (shown({})) return {};
  for (const g of ui.fields) {
    if (g === f) continue;
    if (g.kind === 'select') for (const v of g.options) if (shown({ [g.key]: v.value })) return { [g.key]: v.value };
    if (g.kind === 'toggle') for (const v of [true, false]) if (shown({ [g.key]: v })) return { [g.key]: v };
  }
  return null;
}

/**
 * A kind's samples from its form: its defaults, each preset, each other value of a select and each toggle flipped;
 * a field hidden at the defaults with the option that shows it. Option sets that come out the same are left out.
 */
export function kindSamples(type: string): AttachmentSample[] {
  const def = attachmentDef(type)!;
  const ui = attachmentUi(type);
  const out: AttachmentSample[] = [];
  const seen = new Set<string>();
  const add = (id: string, opts: Record<string, unknown>) => {
    const key = JSON.stringify(def.sanitize({ ...def.defaults, ...opts }));
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `${slug(type)}-${id}`, type, opts });
  };
  add('default', {});
  const base = def.sanitize(def.defaults) as Record<string, unknown>;
  for (const f of ui?.fields ?? []) {
    const ctx = showing(type, f);
    if (!ctx) continue;
    const pre = Object.entries(ctx)
      .map(([k, v]) => `${slug(k)}-${slug(String(v))}-`)
      .join('');
    if (f.kind === 'preset') for (const p of (f as FieldWith<'preset'>).presets) add(`${pre}${slug(f.key)}-${slug(p.value)}`, { ...ctx, ...p.set });
    if (f.kind === 'select')
      for (const v of (f as FieldWith<'select'>).options)
        if (String(v.value) !== String(base[f.key]) || pre) add(`${pre}${slug(f.key)}-${slug(String(v.value))}`, { ...ctx, [f.key]: v.value });
    if (f.kind === 'toggle') add(`${pre}${slug(f.key)}-${base[f.key] ? 'off' : 'on'}`, { ...ctx, [f.key]: !base[f.key] });
  }
  return out;
}

// Traced tools for shadow boards and tool cradles (kinds/traced.ts), in mm.
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
  });
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** A screwdriver: a round-ended handle and a shaft, 26 × 200. */
const SCREWDRIVER: Vec2[] = [[11, 0], [15, 0], [15, 95], [26, 100], ...arc(13, 190, 13, 0, 180, 12), [0, 100], [11, 95]];
/** An open-ended spanner, 34 × 150. */
const SPANNER: Vec2[] = [
  [11, 0],
  [23, 0],
  [23, 118],
  [34, 128],
  [34, 150],
  [23, 150],
  [23, 138],
  [11, 138],
  [11, 150],
  [0, 150],
  [0, 128],
  [11, 118],
];
const tool = (name: string, outline: Vec2[], hold: string, more: object = {}) => ({ name, outline, depth: 8, clearance: 1, hold, ...more });
const TOOLS = [tool('Screwdriver', SCREWDRIVER, 'pegs', { depth: 26 }), tool('Spanner', SPANNER, 'ledge'), tool('Block', rect(0, 0, 40, 60), 'magnets')];
/** Shorter ones laid out apart as they were in a file ('keep'): x, y their centres, mm. */
const KEPT = [
  { ...tool('Spanner', SPANNER, 'pegs'), x: 20, y: 75 },
  { ...tool('Block', rect(0, 0, 40, 60), 'magnets'), x: 80, y: 45 },
  { ...tool('Gauge', rect(0, 0, 30, 90), 'ledge'), x: 140, y: 60, rotation: 15 },
];

/** An imported model kept in memory by its hash, as the import does (imported/registry.ts): an L bracket, a 60 × 5 × 80 slab with a 40 mm shelf at its foot. */
function bracketModel(w: Wasm): ModelRef {
  const s = new Scope();
  try {
    const cube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      s.t(s.t(w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
    const g = s.t(w.Manifold.union([cube(0, 0, 0, 60, 5, 80), cube(0, -40, 0, 60, 0, 5)])).getMesh();
    const raw = centred(weld(g.vertProperties, g.triVerts));
    const hash = meshHash(encodeMesh(raw));
    putImported(hash, { positions: raw.positions, indices: raw.indices });
    const b = meshBounds({ positions: raw.positions, indices: raw.indices });
    const size = [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 1000) / 1000) as [number, number, number];
    return { hash, file: 'Bracket.stl', size, triangles: raw.indices.length / 3, closed: true, flat: flatMasks(raw) };
  } finally {
    s.dispose();
  }
}

/** A model without its mesh (a share link's): a box of its size stands in. */
const BOX_MODEL: ModelRef = { file: 'Box.stl', size: [80, 30, 60], triangles: 12, closed: true };

/** Sizes and combinations picked by hand, and the common options, beside what kindSamples finds. */
const MORE: AttachmentSample[] = [
  { id: 'hook-long-tip', type: 'hook', opts: { reach: 150, tip: 40, width: 12 } },
  { id: 'hook-no-lock', type: 'hook', opts: {}, common: { lock: false } },
  { id: 'hook-bolt-m3', type: 'hook', opts: { style: 'l', width: 30 }, common: { bolt: 'm3' } },
  { id: 'bin-dividers-thin', type: 'bin', opts: { width: 160, dividers: 3, wall: 0.8, floor: 0.8 } },
  { id: 'bin-label-engraved', type: 'bin', opts: { label: true }, common: { label: 'Screws' } },
  { id: 'bin-label-raised', type: 'bin', opts: { label: true }, common: { label: 'Screws', labelStyle: 'raised' } },
  { id: 'bin-label-inlaid', type: 'bin', opts: { label: true }, common: { label: 'Screws', labelStyle: 'inlaid' } },
  { id: 'bin-bolt-m4-barbs', type: 'bin', opts: { width: 120, height: 90, front: 30 }, common: { bolt: 'm4', barbs: 'ends' } },
  { id: 'shelf-bolt-m4', type: 'shelf', opts: {}, common: { bolt: 'm4' } },
  { id: 'cup-three-open', type: 'cup', opts: { count: 3, diameter: 25, bottom: 'open' } },
  { id: 'shelf-wide-slots-sides', type: 'shelf', opts: { width: 300, depth: 150, holes: 'slots', sides: true } },
  { id: 'shelf-label-raised', type: 'shelf', opts: {}, common: { label: 'Paints', labelStyle: 'raised' } },
  { id: 'rail-two-rows-drawers', type: 'rail', opts: { rows: 2, kind: 'drawer', size: '2x1', links: true } },
  { id: 'grid-shelf-tilt-magnets', type: 'gridShelf', opts: { tilt: 30, magnets: true, cellsX: 2 } },
  { id: 'slot-rack-inlaid', type: 'slotRack', opts: {}, common: { label: 'Boards', labelStyle: 'inlaid' } },
  { id: 'faceout-label', type: 'faceout', opts: { label: true }, common: { label: 'Bags' } },
  { id: 'magnet-bar-label', type: 'magnetBar', opts: {}, common: { label: 'Bits', labelStyle: 'raised' } },
  { id: 'label-tag-inlaid-long', type: 'labelTag', opts: { style: 'inlaid', text: 'Allen keys', width: 80 } },
  { id: 'tilt-bin-stack-dividers', type: 'tiltBin', opts: { stack: 3, dividers: 2, width: 160 } },
  { id: 'cabinet-shelves-window', type: 'cabinet', opts: { shelves: 2, window: true, door: 'right' } },
  { id: 'swivel-tower-8', type: 'swivelTower', opts: { count: 8, trayH: 15 } },
  { id: 'tool-rack-hexkeys-rows', type: 'toolRack', opts: { mode: 'hexKeys', rows: 3 } },
  { id: 'shadow-board-tools', type: 'shadowBoard', opts: { tools: TOOLS } },
  { id: 'shadow-board-tools-across-fill', type: 'shadowBoard', opts: { tools: TOOLS, arrange: 'across', fill: true, names: false } },
  { id: 'shadow-board-tools-keep-magnets', type: 'shadowBoard', opts: { tools: KEPT, arrange: 'keep', magnet: '10x3', notches: false } },
  { id: 'tool-cradle-screwdriver', type: 'toolCradle', opts: { tools: [tool('Screwdriver', SCREWDRIVER, 'pegs', { depth: 26 })] } },
  { id: 'tool-cradle-spanner-deep', type: 'toolCradle', opts: { tools: [tool('Spanner', SPANNER, 'pegs')], depth: 20, notches: false } },
  { id: 'model-box-clips', type: 'model', opts: { mesh: BOX_MODEL } },
  { id: 'model-box-plate', type: 'model', opts: { mesh: BOX_MODEL, attach: 'plate' } },
];

/** Samples that need the geometry kernel to plan (an imported model is kept by its mesh's hash). */
const MORE_WITH_WASM = (w: Wasm): AttachmentSample[] => {
  const bracket = bracketModel(w);
  return [
    { id: 'model-bracket-clips', type: 'model', opts: { mesh: bracket } },
    { id: 'model-bracket-plate', type: 'model', opts: { mesh: bracket, attach: 'plate' } },
    { id: 'model-bracket-turned', type: 'model', opts: { mesh: bracket, attach: 'plate', turn: '90', scale: 50 } },
  ];
};

/** Options that make a part smaller, tried in this order when a sample is too big for the bed. */
const SHRINK = ['columns', 'count', 'cellsX', 'rows', 'tiers', 'stack', 'length', 'width', 'height', 'depth', 'reach'];

/**
 * A sample made to fit the bed: a preset at the kind's default count can come out bigger than the bed (the planner
 * leaves such a part out with a warning, and says why). Fewer columns, a shorter length, … until the part and its
 * extra parts fit; the id says what changed.
 */
function fitBed(s: AttachmentSample): AttachmentSample {
  const def = attachmentDef(s.type)!;
  const bed = usableBed(SETUP);
  const clean = (opts: Record<string, unknown>) => def.sanitize({ ...def.defaults, ...opts }) as Record<string, unknown>;
  const over = (opts: Record<string, unknown>) => {
    const o = clean(opts);
    const size = printedSize(def.layout(o, CTX), CTX);
    return Math.max(partOvershoot(size.w, size.d, size.h, bed), ...(def.parts?.(o, CTX) ?? []).map((p) => partOvershoot(p.w, p.d, p.h, bed)));
  };
  let opts = s.opts;
  const changed: string[] = [];
  for (let i = 0; i < 24 && over(opts) > 1e-6; i++) {
    const o = clean(opts);
    const less = (k: string) => ({ ...opts, [k]: Math.floor((o[k] as number) * 0.75) });
    const key = SHRINK.find((k) => typeof o[k] === 'number' && over(less(k)) < over(opts) - 1e-6);
    if (!key) break;
    opts = { ...opts, [key]: Math.floor((o[key] as number) * 0.75) };
    if (!changed.includes(key)) changed.push(key);
  }
  if (!changed.length) return s;
  const o = clean(opts);
  return { ...s, id: `${s.id}-${changed.map((k) => `${slug(k)}-${o[k]}`).join('-')}`, opts };
}

let wasm: Wasm | null = null;
/** The kernel, for samples that need it to plan (scripts/sampler.ts and the tests hand it in). */
export const setSamplerWasm = (w: Wasm) => (wasm = w);

/** Every attachment sample: each kind's from its form, then the ones picked by hand. */
export function attachmentSamples(): AttachmentSample[] {
  const more = [...MORE, ...(wasm ? MORE_WITH_WASM(wasm) : [])];
  return [...attachmentDefs().flatMap((d) => kindSamples(d.type)), ...more.filter((s) => attachmentDef(s.type))].map(fitBed);
}

/** One group per picker group (wall/uiRegistry.ts), each sample a board of its own; only the attachments print. */
function attachmentGroups(): SampleGroup[] {
  const groups = new Map<string, string[]>();
  for (const d of attachmentDefs()) {
    const g = attachmentUi(d.type)?.group ?? 'other';
    groups.set(g, [...(groups.get(g) ?? []), d.type]);
  }
  return [...groups].map(([g, types]) => ({
    name: `attachments/${g}`,
    note: `Attachments (${types.join(', ')}): defaults, presets, options, common options, extra parts`,
    job: () =>
      planPrint(
        attachmentSamples()
          .filter((s) => types.includes(s.type))
          .map(attachmentBoard),
        ANY_BED,
        { baseplate: false, bins: true },
      ),
  }));
}

export const ATTACHMENT_GROUPS: SampleGroup[] = attachmentGroups();

// ---------------------------------------------------------------------------
// Findings by design
// ---------------------------------------------------------------------------

/** Boards' and attachments' findings that are there by design (sampler-cases.ts KNOWN_FINDINGS; docs/print-check.md). */
export const BOARD_FINDINGS: { file: RegExp; what: RegExp; why: string }[] = [
  {
    file: /^attachments\/tools\/magnet-bar-.*skin/,
    what: /^thin$/,
    why: 'the magnets under a 0.5 mm skin (an option, 0.3–1 mm): thinner pulls harder; the print pauses to drop them in',
  },
  {
    file: /^attachments\/adapters\/receiver-.*(mp|multipoint)/,
    what: /^thin$/,
    why: 'a Multipoint head’s rim is 0.4 mm, as the system has it: its top is one line',
  },
  { file: /^attachments\/tools\/shadow-board-tools/, what: /^contact$/, why: 'a board as tall as its tools prints upright on its 5 mm edge: a brim helps' },
  {
    file: /^attachments\//,
    what: /Low bed adhesion/,
    why: 'printed upright on a narrow foot (a back plate’s edge, open-bottomed cups) or small (lock keys, pins, fit-test tabs, label tags): a brim helps',
  },
  {
    file: /^attachments\/power\/led-bar-.*\.diffuser/,
    what: /Long bridging extrusions/,
    why: 'the diffuser’s hooks stand 1 mm out along its length, their flat faces the ones that hold it (a ledge: the mesh checks allow 3 mm)',
  },
  {
    file: /^attachments\/containers\/rail-.*drawer.*\.c\d/,
    what: /Long bridging extrusions/,
    why: 'a drawer housing’s roof bridges its open front, a drawer wide (under 40 mm)',
  },
  {
    file: /^attachments\/hobby\/(stick|bottle)-rack/,
    what: /Long bridging extrusions/,
    why: 'the hollow under each cup’s floor closes in at 45° to a bridged top, 10 mm across at most',
  },
  {
    file: /^attachments\/adapters\/receiver-/,
    what: /Collapsing overhang/,
    why: 'a round head’s rim (1 mm, Multipoint’s 0.4, as the systems have them) stands out round its 45° flare; the head’s underside is cut at 45° and the mesh checks find no ledge',
  },
  {
    file: /^attachments\/gridfinity\/grid-plate/,
    what: /Long bridging extrusions/,
    why: 'a Gridfinity plate standing up: the receptacles’ profile bridges each 42 mm cell',
  },
  {
    file: /^attachments\/tools\/magnet-bar-preset-b60/,
    what: /Long bridging extrusions/,
    why: 'the pocket for a 60 mm block magnet: its roof bridges the magnet’s length',
  },
  {
    file: /^boards\/multiboard\/threads|^attachments\/display\/display-ledge-/,
    what: /parts \(expected/,
    why: 'a few zero-area triangles in float32 (thousands in the threads) that PrusaSlicer counts as shells of their own; split, they come to nothing: one object, the same volume',
  },
  // Faces past 45° (sampler-steep.ts), listed for a look.
  {
    file: /^attachments\/power\/led-bar-angle-60/,
    what: /^steep$/,
    why: 'the strip’s face aimed 60° down overhangs 60°: its note says so (a good fan, or aim it 45°)',
  },
  { file: /^attachments\/adapters\/plate-(preset|pattern)-pi/, what: /^steep$/, why: 'the undersides of the ⌀6 standoffs lying down, 5 mm out from the plate' },
  { file: /^attachments\/adapters\/mount-boss-(fixing-gopro|preset-action)/, what: /^steep$/, why: 'the top of the ⌀5.3 bolt hole through each finger' },
  {
    file: /^attachments\/adapters\/mount-boss-preset-webcam/,
    what: /^steep$/,
    why: 'the platform tilted 15°: the hex pocket’s roof tilts with it, a bridge on a slant',
  },
  { file: /^attachments\/storage\/tilt-bin-.*\.b\d/, what: /^steep$/, why: 'the top of the ⌀4.6 pivot hole through each side' },
  {
    file: /^boards\/skadis\/desk-clamp/,
    what: /^steep$/,
    why: 'the M6 nut’s pocket stands on a corner (60° faces, 3 mm high), and the top of the bolt’s hole',
  },
];
