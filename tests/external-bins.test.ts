import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import type { MeshData, Wasm } from '../src/lib/geometry/kernel';
import { DEFAULT_BIN, binTotalHeight, type BinOptions } from '../src/lib/geometry/bin';
import { meshVolume, printedVolume } from '../src/lib/geometry/volume';
import { DEFAULT_PROJECT, buildMesh, planJob, type PlacedBin, type ProjectState } from '../src/lib/project';
import { DEFAULT_DRAWER, computeLayout } from '../src/lib/layout/drawer';
import { exportPlatesStlZip, writeSTL } from '../src/lib/export/stl';
import { exportPlatesZip } from '../src/lib/export/threemf';
import { exportBambuProject } from '../src/lib/export/bambu';
import { drawerAssemblies, exportPlateSTEP, plateAssembly } from '../src/lib/export/step';
import { billOfMaterials } from '../src/lib/bom';
import { placedOvershoot, usableBeds } from '../src/lib/bedfit';
import { placedBinChecks } from '../src/lib/printability';
import { stackPlaces, stackProblem } from '../src/lib/stacking';
import { binEntries, drawerMap, searchInventory } from '../src/lib/inventory';
import { EXTERNAL_COLORS, externalBox, externalOpts, importedSpec, isOwned, printsMesh, type MeshRef } from '../src/lib/external';
import { shareableProject } from '../src/lib/externalShare';
import { parseMeshFile, type ImportedObject } from '../src/lib/imported/parse';
import { dropImported, hasImported, importedMesh, putImported } from '../src/lib/imported/registry';
import { adoptMeshes, keepMesh, projectWithMeshes } from '../src/lib/imported/meshStore';
import { decodeProject, encodeProject } from '../src/lib/share';
import { allDrawers, history, projectFile, useStore } from '../src/state/store';
import { addExternal, externalBin, setExternal, turnMesh } from '../src/state/externalBins';
import { copySelection, pasteClipboard, selectBins } from '../src/state/selection';
import { stackBin } from '../src/state/stacks';
import { applyPresetToBins, applyTemplateToBins, saveTemplate } from '../src/state/templates';
import { importMyBins, libraryMeshHashes, myBinsFileText, saveToMyBins, setLibraryStorage } from '../src/state/myBins';
import { searchIndex } from '../src/lib/panelSearch';
import { BIN_INDEX } from '../src/components/panelIndex';

let w: Wasm;
/** A Gridfit 2×1×3u bin, exported as STL and imported again. */
let imported: ImportedObject;
beforeAll(async () => {
  w = await Module();
  w.setup();
  const mesh = buildMesh(w, { kind: 'bin', key: 'x', opts: { ...DEFAULT_BIN, unitsX: 2 } });
  imported = parseMeshFile('downloaded-bin.stl', writeSTL([{ mesh }]))[0];
});

const s = () => useStore.getState();

/** The imported mesh, kept like the dialog keeps it, and its MeshRef. */
function meshRef(o: ImportedObject = imported, extra: Partial<MeshRef> = {}): MeshRef {
  const { hash } = keepMesh(o.mesh, 'downloaded-bin.stl');
  return { hash, file: 'downloaded-bin.stl', size: o.size, triangles: o.triangles, closed: o.closed, ...extra };
}

const placeholder = (id: string, x: number, y: number, o: Partial<{ w: number; d: number; u: number; stackable: boolean; name: string }> = {}): PlacedBin => ({
  ...externalBin({ name: o.name ?? 'Ammo can', unitsX: o.w ?? 1, unitsY: o.d ?? 1, heightUnits: o.u ?? 3, stackable: o.stackable }, x, y),
  id,
});

const meshBin = (id: string, x: number, y: number, print: boolean, ref = meshRef()): PlacedBin => ({
  ...externalBin({ name: print ? 'Printed one' : 'Owned one', unitsX: 2, unitsY: 1, mesh: ref, print }, x, y),
  id,
});

const project = (bins: PlacedBin[], o: Partial<ProjectState> = {}): ProjectState => ({ ...DEFAULT_PROJECT, bins, ...o });
const gridfit = (id: string, x: number, y: number, opts: Partial<BinOptions> = {}): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, ...opts } });

describe('the data model', () => {
  it('keeps only footprint and height in opts: placeholders in units, meshes at their own height', () => {
    const p = placeholder('p', 0, 0, { w: 2, d: 3, u: 4 });
    expect([p.opts.unitsX, p.opts.unitsY, p.opts.heightUnits, p.opts.heightMode, p.opts.lip]).toEqual([2, 3, 4, 'units', false]);
    expect(binTotalHeight(p.opts)).toBe(28);
    expect(binTotalHeight(placeholder('q', 0, 0, { u: 3, stackable: true }).opts)).toBe(25);
    const m = meshBin('m', 0, 0, true);
    expect(m.opts.heightMode).toBe('external');
    expect(binTotalHeight(m.opts)).toBeCloseTo(imported.size[2], 2);
    expect(isOwned(p)).toBe(true);
    expect(isOwned(meshBin('o', 0, 0, false))).toBe(true);
    expect(printsMesh(m)).toBe(true);
    expect(p.external?.color).toBe(EXTERNAL_COLORS[0]);
  });

  it('sits a mesh centred on its cells, turned when asked', () => {
    const layout = computeLayout(DEFAULT_DRAWER);
    const m = meshBin('m', 1, 1, true, meshRef(imported, { rotate: true }));
    const box = externalBox(layout, { ...m, opts: { ...m.opts, unitsX: 1, unitsY: 2 } });
    expect(box.w).toBeCloseTo(41.5, 2);
    expect(box.d).toBeCloseTo(83.5, 2);
    const cx = (layout.xs[1] + layout.xs[2]) / 2;
    expect(box.x + box.w / 2).toBeCloseTo(cx, 6);
    // The spec turns the mesh too: footprint min corner at the origin.
    const spec = importedSpec(m)!;
    expect(spec.key).toContain('|r90');
    const built = buildMesh(w, spec);
    let maxX = 0;
    let minX = Infinity;
    for (let i = 0; i < built.positions.length; i += 3) {
      maxX = Math.max(maxX, built.positions[i]);
      minX = Math.min(minX, built.positions[i]);
    }
    expect(minX).toBeCloseTo(0, 4);
    expect(maxX).toBeCloseTo(41.5, 2);
  });
});

describe('planning and exports', () => {
  const bins = () => [meshBin('print', 0, 0, true), meshBin('owned', 0, 1, false), placeholder('box', 3, 0), gridfit('g', 3, 2)];

  it('prints imported bins that print and leaves the rest out', () => {
    const job = planJob(project(bins(), { include: { baseplate: false, bins: true } }));
    expect(job.parts['bin:print']).toMatchObject({ kind: 'bin', name: '“Printed one” (imported)' });
    expect(job.parts['bin:print'].w).toBeCloseTo(83.5, 2);
    expect(job.parts['bin:owned']).toBeUndefined();
    expect(job.parts['bin:box']).toBeUndefined();
    expect(job.parts['bin:g']).toBeDefined();
    const placed = job.plates.flatMap((p) => p.placements.map((q) => q.key));
    expect(placed).toEqual(expect.arrayContaining(['bin:print', 'bin:g']));
    expect(placed).not.toContain('bin:owned');
    // The 3D view still has the owned mesh to show.
    expect(Object.values(job.meshes).filter((m) => m.kind === 'imported')).toHaveLength(1);
  });

  it('exports the mesh as it is: 3MF zip, Bambu project, STL zip', () => {
    const job = planJob(project(bins().filter((b) => b.id !== 'g'), { include: { baseplate: false, bins: true } }));
    const get = (k: string): MeshData => buildMesh(w, job.meshes[k]);
    const tris = imported.triangles;
    const zip = unzipSync(exportPlatesZip(job, DEFAULT_PROJECT.setup, get));
    const plate = unzipSync(Object.entries(zip).find(([n]) => n.endsWith('.3mf'))![1]);
    const model = strFromU8(plate['3D/3dmodel.model']);
    expect(model).toContain('“Printed one” (imported)');
    expect(model.match(/<triangle /g)).toHaveLength(tris);
    const bambu = unzipSync(exportBambuProject(job, DEFAULT_PROJECT.setup, get));
    expect(Object.keys(bambu).some((n) => n.startsWith('3D/'))).toBe(true);
    expect(strFromU8(bambu['Metadata/model_settings.config'])).toContain('Printed one');
    const stl = unzipSync(exportPlatesStlZip(job, get));
    const file = Object.entries(stl).find(([n]) => n.endsWith('.stl'))![1];
    expect(new DataView(file.buffer, file.byteOffset).getUint32(80, true)).toBe(tris);
  });

  it('STEP takes closed meshes and leaves open ones out', () => {
    // The same bin with a triangle missing: an open mesh.
    const holed = parseMeshFile('holed.stl', writeSTL([{ mesh: { positions: imported.mesh.positions, indices: imported.mesh.indices.slice(3) } }]))[0];
    expect(holed.closed).toBe(false);
    const open = meshBin('open', 0, 2, true, meshRef(holed));
    const job = planJob(project([meshBin('print', 0, 0, true), open], { include: { baseplate: false, bins: true } }));
    const keys = plateAssembly(job, 0).items.map((it) => it.name);
    expect(keys).toEqual(['“Printed one” (imported)']);
    const asm = drawerAssemblies(job, [{ id: '', name: 'D', baseplate: DEFAULT_PROJECT.baseplate, bins: [meshBin('print', 0, 0, true), open] }]);
    expect(asm[0].items.map((i) => i.name).filter((n) => !n.startsWith('Baseplate'))).toEqual(['“Printed one” (imported)']);
    // The closed one becomes a faceted solid like Gridfit's own bins.
    const step = strFromU8(exportPlateSTEP(job, 0, (k) => buildMesh(w, job.meshes[k])));
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step).toContain('Printed one');
  });

  it('counts the mesh’s filament in the BOM, from its volume', () => {
    const job = planJob(project(bins(), { include: { baseplate: false, bins: true } }));
    const vols = new Map(Object.values(job.meshes).map((m) => [m.key, printedVolume(buildMesh(w, m))]));
    const bom = billOfMaterials(job, (k) => vols.get(k));
    expect(bom.parts.bins).toBe(2);
    const spec = importedSpec(meshBin('print', 0, 0, true))!;
    expect(meshVolume(buildMesh(w, spec))).toBeCloseTo(imported.volume, 0);
    expect(bom.total.grams).toBeGreaterThan(0);
    // No magnets or screws for a mesh Gridfit didn't make.
    expect(bom.hardware).toEqual([]);
  });

  it('fits printed meshes to the printer and warns when they don’t', () => {
    const layout = computeLayout(DEFAULT_DRAWER);
    const small = { ...DEFAULT_PROJECT.setup, bedW: 60, bedD: 60 };
    expect(placedOvershoot(layout, meshBin('print', 0, 0, true), usableBeds(small))).toBeGreaterThan(0);
    // Placeholders and owned meshes never print, whatever their size.
    expect(placedOvershoot(layout, placeholder('p', 0, 0, { w: 6, d: 6, u: 30 }), usableBeds(small))).toBe(0);
    expect(placedOvershoot(layout, meshBin('owned', 0, 0, false), usableBeds(small))).toBe(0);
    const job = planJob(project([meshBin('print', 0, 0, true)], { setup: small, include: { baseplate: false, bins: true } }));
    expect(job.warnings.join(' ')).toMatch(/Printed one.*larger than the print bed/);
  });

  it('checks a printed mesh: open, too tall for the drawer', () => {
    const layout = computeLayout(DEFAULT_DRAWER);
    const open = meshBin('open', 0, 0, true, meshRef(imported, { closed: false }));
    expect(placedBinChecks(layout, open).map((c) => c.rule)).toContain('mesh-open');
    expect(placedBinChecks(layout, meshBin('ok', 0, 0, true))).toEqual([]);
    expect(placedBinChecks(layout, meshBin('owned', 0, 0, false, meshRef(imported, { closed: false })))).toEqual([]);
    const job = planJob(project([meshBin('print', 0, 0, true), placeholder('tall', 3, 0, { u: 12 })], { drawer: { ...DEFAULT_DRAWER, height: 40 } }));
    expect(job.warnings.join(' ')).toMatch(/“Ammo can” is taller than the drawer/);
    expect(job.warnings.join(' ')).not.toMatch(/Printed one/);
  });
});

describe('stacking on bins from elsewhere', () => {
  it('a flat top holds nothing; a stackable one does, at its height', () => {
    const layout = computeLayout(DEFAULT_DRAWER);
    expect(stackProblem(layout, placeholder('p', 0, 0))).toMatch(/flat/);
    const base = placeholder('p', 0, 0, { stackable: true, u: 3 });
    expect(stackProblem(layout, base)).toBeNull();
    const top = { ...gridfit('t', 0, 0), on: 'p' };
    const places = stackPlaces(layout, [base, top]);
    // On the lip: 25 mm tall, the feet sink 4.35 mm into it.
    expect(places.get('t')!.z).toBeCloseTo(25 - 4.35, 6);
  });

  it('counts a stack on a placeholder against the drawer’s height', () => {
    const bins = [placeholder('p', 0, 0, { stackable: true, u: 5 }), { ...gridfit('t', 0, 0, { heightUnits: 5 }), on: 'p' }];
    const job = planJob(project(bins, { drawer: { ...DEFAULT_DRAWER, height: 70 } }));
    expect(job.warnings.join(' ')).toMatch(/The stack on “Ammo can” is .* taller than the drawer/);
    const flat = planJob(project([placeholder('p', 0, 0, { u: 5 }), { ...gridfit('t', 0, 0), on: 'p' }]));
    expect(flat.warnings.join(' ')).toMatch(/“Ammo can” can’t hold the bin stacked on it. Its top is flat/);
  });
});

describe('in the store', () => {
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });

  it('adds a placeholder at the first free spot and selects it', () => {
    s().addBin(0, 0, 2, 2);
    const r = addExternal({ name: 'Ammo can', unitsX: 2, unitsY: 2, heightUnits: 4, contents: '9 mm\n.22 LR' });
    expect(r.error).toBeUndefined();
    const b = s().bins.find((x) => x.id === r.id)!;
    expect([b.x, b.y]).toEqual([2, 0]);
    expect(b.contents).toBe('9 mm\n.22 LR');
    expect(s().ui.selectedBinId).toBe(r.id);
    expect(addExternal({ name: 'Huge', unitsX: 12, unitsY: 12 }).error).toMatch(/No free spot/);
  });

  it('turns a mesh to fit when only that way round goes in', () => {
    s().setDrawer({ width: 100, depth: 200 });
    const r = addExternal({ name: 'Long', unitsX: 3, unitsY: 1, mesh: meshRef(), print: true });
    expect('turned' in r && r.turned).toBe(true);
    const b = s().bins[0];
    expect([b.opts.unitsX, b.opts.unitsY, b.external?.mesh?.rotate]).toEqual([1, 3, true]);
  });

  it('edits only what applies: footprint, height, stackable, name, colour, printing', () => {
    const { id } = addExternal({ name: 'Box', unitsX: 1, unitsY: 1 }) as { id: string };
    s().updateBin(id, { opts: { unitsX: 2, heightUnits: 6, lip: true, divX: 3, label: 'full', holes: 'magnets', interior: 'pockets' } });
    const o = s().bins[0].opts;
    expect([o.unitsX, o.heightUnits, o.lip, o.divX, o.label, o.holes, o.interior]).toEqual([2, 6, true, 1, 'none', 'none', 'compartments']);
    s().updateBin(id, { stretch: { left: 5 } });
    expect(s().bins[0].stretch).toBeUndefined();
    setExternal(id, { name: '  Big   box ', color: '#123456' });
    expect(s().bins[0].external).toMatchObject({ name: 'Big box', color: '#123456' });
    // A mesh's height is the mesh's.
    const m = addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: meshRef(), print: false }) as { id: string };
    s().updateBin(m.id, { opts: { heightUnits: 9 } });
    expect(binTotalHeight(s().bins.find((b) => b.id === m.id)!.opts)).toBeCloseTo(imported.size[2], 2);
    setExternal(m.id, { print: true });
    expect(s().bins.find((b) => b.id === m.id)!.external?.print).toBe(true);
  });

  it('templates, presets and copied layouts leave them alone', () => {
    const { id } = addExternal({ name: 'Box', unitsX: 2, unitsY: 2, heightUnits: 4 }) as { id: string };
    const before = s().bins[0].opts;
    const t = saveTemplate('Deep', { ...DEFAULT_BIN, heightUnits: 9, divX: 3, holes: 'magnets' });
    applyTemplateToBins(t, [id]);
    applyPresetToBins('deep', [id]);
    s().copyLayout({ layout: null, divX: 4, divY: 2 }, [{ drawerId: s().activeDrawerId, binId: id }]);
    expect(s().bins[0].opts).toBe(before);
  });

  it('copies, pastes and turns them like any bin', () => {
    const { id } = addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: meshRef(), print: true }) as { id: string };
    selectBins([id]);
    copySelection();
    const [copy] = pasteClipboard();
    const c = s().bins.find((b) => b.id === copy)!;
    expect(c.external).toEqual(s().bins.find((b) => b.id === id)!.external);
    expect(turnMesh(id)).toBe(true);
    const t = s().bins.find((b) => b.id === id)!;
    expect([t.opts.unitsX, t.opts.unitsY, t.external?.mesh?.rotate]).toEqual([1, 2, true]);
  });

  it('stacks a Gridfit bin on a stackable one', () => {
    const { id } = addExternal({ name: 'Stackable', unitsX: 2, unitsY: 2, heightUnits: 3, stackable: true }) as { id: string };
    const r = stackBin(id);
    expect(r.error).toBeUndefined();
    const top = s().bins.find((b) => b.id === r.id)!;
    expect([top.on, top.opts.unitsX, top.opts.unitsY, top.external]).toEqual([id, 2, 2, undefined]);
    const flat = addExternal({ name: 'Flat', unitsX: 1, unitsY: 1 }) as { id: string };
    expect(stackBin(flat.id).error).toMatch(/flat/);
  });

  it('undo and redo carry the mesh reference; the mesh stays in memory', () => {
    const ref = meshRef();
    addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: ref, print: true });
    expect(s().bins).toHaveLength(1);
    history.undo();
    expect(s().bins).toHaveLength(0);
    expect(hasImported(ref.hash)).toBe(true);
    history.redo();
    expect(s().bins[0].external?.mesh?.hash).toBe(ref.hash);
    // The project (what autosave and undo keep) holds the reference, never the mesh.
    const saved = JSON.stringify(projectFile(s()));
    expect(saved).toContain(ref.hash);
    expect(saved.length).toBeLessThan(20_000);
  });

  it('is found by name and contents, listed and on the drawer map', () => {
    addExternal({ name: 'Ammo can', unitsX: 2, unitsY: 2, contents: '9 mm' });
    const drawers = allDrawers(s());
    expect(searchInventory(drawers, 'ammo')[0]).toMatchObject({ kind: 'label', text: 'Ammo can' });
    expect(searchInventory(drawers, '9 mm')[0]).toMatchObject({ kind: 'contents' });
    expect(binEntries(drawers)[0].desc).toBe('2×2×3u bin you have');
    const map = drawerMap(drawers[0]);
    expect(map.body).toContain('Ammo can');
    expect(map.body).toContain('bin you have');
  });
});

describe('project files and share links', () => {
  beforeEach(() => {
    s().resetAll();
    history.clear();
  });

  it('saves the meshes in the project file and opens it complete elsewhere', async () => {
    const ref = meshRef();
    addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: ref, print: true });
    addExternal({ name: 'Box', unitsX: 1, unitsY: 1 });
    const file = JSON.parse(JSON.stringify(await projectWithMeshes(projectFile(s()))));
    expect(file.version).toBe(4);
    expect(Object.keys(file.meshes)).toEqual([ref.hash]);
    // Another device: nothing in memory.
    const mesh = importedMesh(ref.hash)!;
    dropImported(ref.hash);
    s().resetAll();
    expect(adoptMeshes(file.meshes)).toBe(1);
    s().loadProject(file);
    expect(hasImported(ref.hash)).toBe(true);
    expect([...importedMesh(ref.hash)!.indices]).toEqual([...mesh.indices]);
    expect(s().bins.map((b) => b.external?.name)).toEqual(['Mesh', 'Box']);
    expect(s().bins[0].external?.mesh).toEqual(ref);
    // A damaged mesh (bytes that don't match their hash) is skipped.
    expect(adoptMeshes({ [ref.hash]: 'AAAA' })).toBe(0);
  });

  it('share links carry the box, not the mesh', () => {
    const ref = meshRef();
    addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: ref, print: true, stackable: true });
    s().addDrawer('Other');
    addExternal({ name: 'Mesh too', unitsX: 2, unitsY: 1, mesh: ref, print: false });
    const { file, dropped } = shareableProject(projectFile(s()));
    expect(dropped).toBe(2);
    const back = decodeProject(encodeProject(file)) as ReturnType<typeof projectFile>;
    expect(JSON.stringify(back)).not.toContain(ref.hash);
    s().resetAll();
    s().loadProject(back);
    const b = allDrawers(s())[0].bins[0];
    expect(b.external).toEqual({ name: 'Mesh', color: EXTERNAL_COLORS[0] });
    expect([b.opts.unitsX, b.opts.unitsY, b.opts.lip, b.opts.heightMode]).toEqual([2, 1, true, 'units']);
    expect(binTotalHeight(b.opts)).toBeCloseTo(25, 6);
  });

  it('loads old and hand-edited files safely', () => {
    s().loadProject({
      app: 'gridfit',
      version: 2,
      bins: [
        { id: 'a', x: 0, y: 0, opts: { unitsX: 2 } },
        { id: 'b', x: 2, y: 0, opts: { unitsX: 1, interior: 'pockets', heightMode: 'external', heightMm: 999 }, external: { name: 7, color: 'red', mesh: { hash: 'nope' } }, stretch: { left: 4 } },
      ],
    });
    const [a, b] = s().bins;
    expect(a.external).toBeUndefined();
    expect(b.external).toEqual({ name: '', color: EXTERNAL_COLORS[0] });
    expect([b.opts.interior, b.opts.heightMode, b.stretch]).toEqual(['compartments', 'units', undefined]);
  });
});

describe('in My bins', () => {
  const memory = () => {
    const d = new Map<string, string>();
    return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) };
  };

  it('keeps an imported bin’s mesh: counted as used, carried in the exported file, back on import', async () => {
    setLibraryStorage(memory());
    s().resetAll();
    const ref = meshRef();
    const { id } = addExternal({ name: 'Mesh', unitsX: 2, unitsY: 1, mesh: ref, print: true }) as { id: string };
    saveToMyBins([id], { name: 'Downloaded' });
    expect(libraryMeshHashes()).toEqual([ref.hash]);
    const text = await myBinsFileText();
    expect(Object.keys(JSON.parse(text).meshes)).toEqual([ref.hash]);
    // Another browser: an empty library and no mesh.
    setLibraryStorage(memory());
    dropImported(ref.hash);
    expect(importMyBins(text)).toMatchObject({ added: 1 });
    expect(hasImported(ref.hash)).toBe(true);
    expect(libraryMeshHashes()).toEqual([ref.hash]);
    setLibraryStorage(null);
  });
});

describe('the registry', () => {
  it('builds an imported spec only when its mesh is here', () => {
    const o = parseMeshFile('c.obj', new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4'))[0];
    const { hash } = keepMesh(o.mesh);
    const bin = meshBin('t', 0, 0, true, { hash, file: 'c.obj', size: o.size, triangles: o.triangles, closed: o.closed });
    expect(buildMesh(w, importedSpec(bin)!).indices.length).toBe(12);
    dropImported(hash);
    expect(() => buildMesh(w, importedSpec(bin)!)).toThrow(/isn’t in this browser/);
    putImported(hash, o.mesh);
    expect(externalOpts({ unitsX: 1, unitsY: 1, heightMm: 5 }).heightMm).toBeGreaterThanOrEqual(10);
  });
});

describe('finding it in the Bins panel', () => {
  it('“Find a setting” knows the words for it', () => {
    for (const q of ['import', 'stl', '3mf', 'placeholder', 'bought', 'downloaded', 'existing bin', 'printables', 'already have']) {
      expect([...(searchIndex(BIN_INDEX, q)?.hits ?? [])], q).toContain('external');
    }
  });
});
