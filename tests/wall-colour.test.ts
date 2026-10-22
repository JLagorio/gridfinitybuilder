import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { meshBounds } from '../src/lib/geometry/kernel';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { buildMesh, planPrint, usesSecondFilament, type NamedDrawer, type PrintJob } from '../src/lib/project';
import { DEFAULT_SKADIS, buildSkadisTile, planSkadis, sanitizeSkadis, skadisTileSpecs, type SkadisOptions } from '../src/lib/geometry/skadis';
import { checkPart } from '../src/lib/geometry/printcheck';
import { registerFont } from '../src/lib/geometry/text';
import { INLAY_ROLES, partRoleSlot, roleSlot, type ColourSetup } from '../src/lib/colours';
import { specRole } from '../src/lib/geometry/colourRegions';
import { colourChecks } from '../src/lib/colourChecks';
import { exportBambuProject } from '../src/lib/export/bambu';
import { partPaint } from '../src/components/sceneColours';
import { cleanAttachments } from '../src/lib/enclosureOptions';
import { attachmentDef, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentKey, labelRelief, planExtras, wallInlaid } from '../src/lib/wall/plan';
import { printedSize } from '../src/lib/wall/mount';

/**
 * Two-colour labels and inlays on boards and their attachments: raised and inlaid attachment labels, label tags,
 * inlaid zone text on a board, the colour roles they print in (attachments, board text), and the 3D view and Bambu
 * project carrying them.
 */

let w: Wasm;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const buf = readFileSync('public/fonts/RobotoCondensed-Bold.ttf');
  registerFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const PALETTE = [
  { colour: '#161616', name: 'Black' },
  { colour: '#F2F2F2', name: 'White' },
  { colour: '#C12E1F', name: 'Red' },
  { colour: '#0A2989', name: 'Blue' },
];
const withColours = (c: ColourSetup): PrintSetup => ({ ...DEFAULT_SETUP, filaments: PALETTE, colours: { on: true, ...c } });

const board = (attachments: PlacedAttachment[], skadis: Partial<SkadisOptions> = {}): NamedDrawer => ({
  id: 'b',
  name: 'Board',
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS, width: 400, height: 300, ...skadis }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const att = (id: string, type: string, x: number, y: number, opts: object = {}, common: Partial<PlacedAttachment> = {}): PlacedAttachment => ({
  id,
  type,
  x,
  y,
  opts: { ...opts },
  ...common,
});
const ATTS = { baseplate: false, bins: true };
const ALL = { baseplate: true, bins: true };

function meshes(job: PrintJob) {
  const cache = new Map<string, MeshData>();
  return (k: string) => cache.get(k) ?? cache.set(k, buildMesh(w, job.meshes[k])).get(k)!;
}
const bambu = (job: PrintJob, s: PrintSetup) => unzipSync(exportBambuProject(job, s, meshes(job), readFileSync('public/bambu/x1c.json', 'utf8')));
const objects = (cfg: string) =>
  cfg
    .split('<object id=')
    .slice(1)
    .map((o) => ({
      name: /key="name" value="([^"]*)"/.exec(o)![1],
      extruder: /key="extruder" value="(\d+)"/.exec(o)![1],
      parts: [...o.matchAll(/<part id="\d+"[^>]*>([\s\S]*?)<\/part>/g)].map((m) => ({
        name: /key="name" value="([^"]*)"/.exec(m[1])![1],
        extruder: /key="extruder" value="(\d+)"/.exec(m[1])?.[1],
      })),
    }));
const settings = (job: PrintJob, s: PrintSetup) => objects(strFromU8(bambu(job, s)['Metadata/model_settings.config']));

/** An attachment planned with its common options, and built in its print pose. */
function built(type: string, opts: object = {}, common: Pick<PlacedAttachment, 'label' | 'labelStyle'> = {}) {
  const def = attachmentDef(type)!;
  const o = def.sanitize(opts);
  const e = planExtras(common, def, o, def.layout(o, CTX), CTX);
  const mesh = buildMesh(w, { kind: 'attachment', key: type, type, opts: o, layout: e.layout, ctx: CTX, ...(e.extras ? { extras: e.extras } : {}) });
  return { def, o, layout: e.layout, extras: e.extras, mesh };
}

/** Volume of one body (not its overlays), mm³. */
function vol(m: Pick<MeshData, 'positions' | 'indices'>): number {
  const s = w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }));
  const v = s.volume();
  s.delete();
  return v;
}

/** Bounds of a mesh with its overlays. */
function allBounds(m: MeshData) {
  const bs = [m, ...(m.overlays ?? [])].map((b) => meshBounds(b as MeshData));
  return { min: [0, 1, 2].map((k) => Math.min(...bs.map((b) => b.min[k]))), max: [0, 1, 2].map((k) => Math.max(...bs.map((b) => b.max[k]))) };
}

const tags = (m: MeshData) => (m.overlays ?? []).map((o) => [o.name, o.filament, o.role]);
const errors = (m: MeshData) => checkPart(w, m).issues.filter((i) => i.severity === 'error');

describe('colour roles', () => {
  it('board attachments follow the bin walls and their text the label text, so nothing changes until they are set', () => {
    const s = withColours({});
    expect(roleSlot(s, 'attachments')).toBe(roleSlot(s, 'binWalls'));
    expect(roleSlot(s, 'wallText')).toBe(2);
    expect(roleSlot(withColours({ roles: { binWalls: 3, labelText: 4 } }), 'attachments')).toBe(3);
    expect(roleSlot(withColours({ roles: { binWalls: 3, labelText: 4 } }), 'wallText')).toBe(4);
    expect(roleSlot(withColours({ roles: { labelText: 4, wallText: 1 } }), 'wallText')).toBe(1);
    // Board text keeps its colour by part, whatever the attachment's own colour.
    expect(INLAY_ROLES.has('wallText')).toBe(true);
    expect(partRoleSlot(s, 'wallText', { bin: 3 })).toBe(2);
    expect(partRoleSlot(s, 'attachments', { bin: 3 })).toBe(3);
    const spec = { kind: 'attachment', key: 'k', type: 'bin', opts: {}, layout: built('bin').layout, ctx: CTX } as const;
    expect(specRole(spec)).toBe('attachments');
  });
});

describe('attachment labels', () => {
  const cases: [string, object][] = [
    ['bin', { label: true }],
    ['bin', {}],
    ['shelf', {}],
    ['cradle', {}],
    ['toolRack', {}],
  ];

  it('cut in as before: one body, and the mesh key it always had', () => {
    const { def, o, layout, extras, mesh } = built('bin', { label: true }, { label: 'Screws' });
    expect(extras?.label).toEqual({ text: 'Screws', face: def.labelFace!(o, layout) });
    expect(attachmentKey('bin', o, CTX, extras)).toBe(
      `att|bin|${JSON.stringify(o)}|${JSON.stringify(CTX)}|${JSON.stringify({ label: { text: 'Screws', face: def.labelFace!(o, layout) } })}`,
    );
    expect(mesh.overlays).toBeUndefined();
  });

  for (const [type, opts] of cases) {
    it(`${type} ${JSON.stringify(opts)}: inlaid text is what it cuts out of the part, flush, a body of its own`, () => {
      const plain = built(type, opts);
      const cut = built(type, opts, { label: 'Screws' });
      const inlaid = built(type, opts, { label: 'Screws', labelStyle: 'inlaid' });
      expect(inlaid.extras?.label?.style).toBe('inlaid');
      expect(tags(inlaid.mesh)).toEqual([['Label text', 2, 'wallText']]);
      // Valid, and the text doesn't overlap the part (checkPart measures it).
      expect(errors(inlaid.mesh)).toEqual([]);
      const text = vol(inlaid.mesh.overlays![0]);
      expect(text).toBeGreaterThan(1);
      expect(vol(inlaid.mesh)).toBeCloseTo(vol(cut.mesh), 1);
      expect(vol(inlaid.mesh) + text).toBeCloseTo(vol(plain.mesh), 1);
      // Flush: the part's size, nothing standing out.
      const b = allBounds(inlaid.mesh);
      const want = printedSize(inlaid.layout, CTX);
      expect(b.min).toEqual([0, 0, 0]);
      expect(b.max[0]).toBeCloseTo(want.w, 1);
      expect(b.max[1]).toBeCloseTo(want.d, 1);
      expect(b.max[2]).toBeCloseTo(want.h, 1);
    });
  }

  it('raised text stands on the face, a body of its own that prints with the part while colours are off', () => {
    const plain = built('bin', { label: true });
    const raised = built('bin', { label: true }, { label: 'Screws', labelStyle: 'raised' });
    expect(tags(raised.mesh)).toEqual([['Label text', 1, 'wallText']]);
    expect(errors(raised.mesh)).toEqual([]);
    expect(vol(raised.mesh)).toBeCloseTo(vol(plain.mesh), 1);
    expect(vol(raised.mesh.overlays![0])).toBeGreaterThan(1);
    // It stands 0.6 mm out past the label ledge, the part's front: printed upright, that's its depth on the bed.
    expect(labelRelief(raised.extras, raised.layout)).toEqual({ dz: 0.6, dy: 0 });
    const b = allBounds(raised.mesh);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max[1]).toBeCloseTo(printedSize(raised.layout, CTX).d + 0.6, 2);
    expect(meshBounds(raised.mesh).max[1]).toBeCloseTo(printedSize(raised.layout, CTX).d + 0.6, 2);
    expect(meshBounds(raised.mesh).min[1]).toBeCloseTo(0.6, 2);
  });

  it('a face that leans (a slot rack) takes text in, not standing out', () => {
    const def = attachmentDef('slotRack')!;
    const o = def.sanitize({});
    expect(def.labelFace!(o, def.layout(o, CTX))!.flat).toBe(false);
    expect(planExtras({ label: 'Saws', labelStyle: 'raised' }, def, o, def.layout(o, CTX), CTX).extras?.label?.style).toBeUndefined();
    const inlaid = built('slotRack', {}, { label: 'Saws', labelStyle: 'inlaid' });
    expect(tags(inlaid.mesh)).toEqual([['Label text', 2, 'wallText']]);
    expect(errors(inlaid.mesh)).toEqual([]);
  });

  it('saves its style with the attachment', () => {
    const a = att('a', 'bin', 1, 2, {}, { label: 'Screws', labelStyle: 'inlaid' });
    expect(cleanAttachments([a, { ...att('b', 'bin', 3, 4), labelStyle: 'glow' }, { ...att('c', 'bin', 5, 6), labelStyle: 'raised' }])).toEqual([
      a,
      att('b', 'bin', 3, 4),
      { ...att('c', 'bin', 5, 6), labelStyle: 'raised' },
    ]);
  });
});

describe('label tag', () => {
  it('raised and inlaid letters are a body of their own; cut in, the card is one', () => {
    const blank = built('labelTag', { text: '' });
    expect(blank.mesh.overlays).toBeUndefined();
    const raised = built('labelTag', { text: 'Tools' });
    expect(tags(raised.mesh)).toEqual([['Label text', 1, 'wallText']]);
    const inlaid = built('labelTag', { text: 'Tools', style: 'inlaid' });
    expect(tags(inlaid.mesh)).toEqual([['Label text', 2, 'wallText']]);
    expect(built('labelTag', { text: 'Tools', style: 'engraved' }).mesh.overlays).toBeUndefined();
    for (const m of [raised.mesh, inlaid.mesh]) expect(errors(m)).toEqual([]);
    // Inlaid: the card and its letters fill the plain card exactly; flush, no rim (as thick as the card).
    expect(vol(inlaid.mesh) + vol(inlaid.mesh.overlays![0])).toBeCloseTo(vol(built('labelTag', { text: '', style: 'inlaid' }).mesh), 1);
    expect(printedSize(inlaid.layout, CTX).d).toBeLessThan(printedSize(raised.layout, CTX).d);
    // Only inlaid text needs a second filament while colours are off.
    const def = attachmentDef('labelTag')!;
    expect(def.inlaid!(def.sanitize({ style: 'inlaid' }))).toBe(true);
    expect(def.inlaid!(def.sanitize({ style: 'inlaid', text: ' ' }))).toBe(false);
    expect(def.inlaid!(def.sanitize({}))).toBe(false);
  });
});

describe('board zones', () => {
  const zone = (style?: 'inlaid') =>
    sanitizeSkadis({ ...DEFAULT_SKADIS, width: 200, height: 160, zones: [{ x: 40, y: 40, w: 120, h: 60, kind: 'text', text: 'PLIERS', style }] });

  it('saves an inlaid style, and nothing for engraved text', () => {
    expect(zone('inlaid').zones[0].style).toBe('inlaid');
    expect('style' in zone().zones[0]).toBe(false);
    expect('style' in sanitizeSkadis({ ...DEFAULT_SKADIS, zones: [{ x: 0, y: 0, w: 60, h: 40, kind: 'text', text: 'A', style: 'glow' }] }).zones[0]).toBe(
      false,
    );
  });

  it('inlaid text fills its engraving flush, in the first layers on the bed, a body of its own', () => {
    const o = zone('inlaid');
    const spec = skadisTileSpecs(planSkadis(o, [{ w: 256, d: 256 }]), o)[0];
    expect(spec.text).toHaveLength(1);
    expect(spec.text![0].inlay).toBe(true);
    const mesh = buildSkadisTile(w, spec);
    expect(tags(mesh)).toEqual([['Zone text', 2, 'wallText']]);
    expect(errors(mesh)).toEqual([]);
    const tb = meshBounds(mesh.overlays![0] as MeshData);
    expect(tb.min[2]).toBeCloseTo(0, 3);
    expect(tb.max[2]).toBeCloseTo(0.8, 3);
    const engraved = buildSkadisTile(w, { ...spec, text: spec.text!.map(({ inlay: _, ...t }) => t) });
    expect(engraved.overlays).toBeUndefined();
    const plain = buildSkadisTile(w, { ...spec, text: undefined });
    expect(vol(mesh)).toBeCloseTo(vol(engraved), 1);
    expect(vol(mesh) + vol(mesh.overlays![0])).toBeCloseTo(vol(plain), 1);
  });
});

describe('a board in the print job', () => {
  const inlaidBoard = () =>
    board([att('a', 'bin', 100, 150, { label: true }, { label: 'Screws', labelStyle: 'inlaid' }), att('t', 'labelTag', 300, 250, { text: 'Tools' })], {
      width: 200,
      height: 160,
      zones: [{ x: 40, y: 20, w: 120, h: 40, kind: 'text', text: 'PLIERS', style: 'inlaid' }],
    });

  it('plans without warnings, and needs the label filament as inlaid bin labels do', () => {
    const job = planPrint([inlaidBoard()], DEFAULT_SETUP, ALL);
    expect(job.warnings).toEqual([]);
    expect(usesSecondFilament(job)).toBe(true);
    expect(wallInlaid(job.meshes[job.parts['att:a'].meshKey])).toBe(true);
    expect(wallInlaid(job.meshes[job.parts['att:t'].meshKey])).toBe(false);
    expect(Object.values(job.parts).some((p) => p.kind === 'piece' && wallInlaid(job.meshes[p.meshKey]))).toBe(true);
    // Raised text and engraved text print in one filament.
    const one = board([
      att('a', 'bin', 100, 150, { label: true }, { label: 'Screws', labelStyle: 'raised' }),
      att('t', 'labelTag', 300, 250, { text: 'Tools' }),
    ]);
    expect(usesSecondFilament(planPrint([one], DEFAULT_SETUP, ATTS))).toBe(false);
  });

  it('a raised label makes the part that much bigger on its plate', () => {
    const job = planPrint([board([att('a', 'bin', 100, 150, { label: true }, { label: 'Screws', labelStyle: 'raised' })])], DEFAULT_SETUP, ATTS);
    const part = job.parts['att:a'];
    const b = allBounds(buildMesh(w, job.meshes[part.meshKey]));
    expect(b.max[0]).toBeCloseTo(part.w, 2);
    expect(b.max[1]).toBeCloseTo(part.d, 2);
    expect(b.max[2]).toBeCloseTo(part.h, 2);
  });

  it('Bambu project, colours off: the text is a part of its object in filament 2 (raised text in the part’s)', () => {
    const job = planPrint([inlaidBoard()], DEFAULT_SETUP, ALL);
    const objs = settings(job, DEFAULT_SETUP);
    const bin = objs.find((o) => o.name.includes('Bin'))!;
    expect(bin.parts.map((p) => [p.name, p.extruder])).toEqual([
      [expect.any(String), undefined],
      [expect.stringContaining('Label text'), '2'],
    ]);
    const tag = objs.find((o) => o.name.includes('Tools'))!;
    expect(tag.parts).toHaveLength(2);
    expect(tag.parts[1].extruder ?? tag.extruder).toBe('1');
    const tile = objs.find((o) => o.parts.some((p) => p.name.includes('Zone text')))!;
    expect(tile.parts.find((p) => p.name.includes('Zone text'))!.extruder).toBe('2');
  });

  it('Bambu project, colours on: each in its role’s slot, the attachment’s own colour on its body only', () => {
    const s = withColours({ roles: { attachments: 3, wallText: 4, wallGrid: 2 } });
    const job = planPrint([inlaidBoard()], s, ALL);
    const objs = settings(job, s);
    const bin = objs.find((o) => o.name.includes('Bin'))!;
    expect(bin).toMatchObject({ extruder: '3', parts: [{}, { extruder: '4' }] });
    // Raised text too (by part, text keeps its colour).
    const tag = objs.find((o) => o.name.includes('Tools'))!;
    expect(tag).toMatchObject({ extruder: '3', parts: [{}, { extruder: '4' }] });
    const tile = objs.find((o) => o.parts.some((p) => p.name.includes('Zone text')))!;
    expect(tile.extruder).toBe('2');
    expect(tile.parts.find((p) => p.name.includes('Zone text'))!.extruder).toBe('4');

    // An attachment's own colour.
    const own = inlaidBoard();
    own.drawer.attachments = own.drawer.attachments!.map((a) => (a.id === 'a' ? { ...a, colour: 1 } : a));
    const owned = planPrint([own], s, ATTS);
    expect(owned.parts['att:a'].colour).toEqual({ bin: 1 });
    expect(settings(owned, s).find((o) => o.name.includes('Bin'))).toMatchObject({ extruder: '1', parts: [{}, { extruder: '4' }] });

    // By feature: the same bodies, each its role's filament.
    const f = withColours({ strategy: 'feature', roles: { attachments: 3, wallText: 4 } });
    const fj = planPrint([inlaidBoard()], f, ATTS);
    expect(settings(fj, f).find((o) => o.name.includes('Bin'))).toMatchObject({ extruder: '3', parts: [{}, { extruder: '4' }] });
  });

  it('the 3D view paints the text in its colour', () => {
    const s = withColours({ roles: { attachments: 3, wallText: 4 } });
    const job = planPrint([inlaidBoard()], s, ALL);
    const p = partPaint(job, 'att:a')!;
    expect(p.main).toBe('#C12E1F');
    expect(p.roles?.wallText).toBe('#0A2989');
    const tile = Object.values(job.parts).find((q) => q.kind === 'piece')!;
    expect(partPaint(job, tile.key)!.roles?.wallText).toBe('#0A2989');
    // Off: no paint, the view's own colours (filament 2's stand-in for the text).
    expect(partPaint(planPrint([inlaidBoard()], DEFAULT_SETUP, ALL), 'att:a')).toBeUndefined();
  });

  it('by height, inlaid board text gets the same note as inlaid bin labels', () => {
    const s = withColours({ strategy: 'height' });
    const job = planPrint([inlaidBoard()], s, ATTS);
    expect(colourChecks(job, s).some((c) => c.rule === 'colour-inlay')).toBe(true);
    const plain = planPrint([board([att('a', 'bin', 100, 150, { label: true }, { label: 'Screws' })])], s, ATTS);
    expect(colourChecks(plain, s).some((c) => c.rule === 'colour-inlay')).toBe(false);
  });
});
