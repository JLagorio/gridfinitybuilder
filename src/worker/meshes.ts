/// <reference lib="webworker" />
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { cloneMesh, type MeshData, type Wasm } from '../lib/geometry/kernel';
import { buildMesh, type MeshSpec, type PrintJob } from '../lib/project';
import { splitByRoles } from '../lib/geometry/colourRegions';
import { printedVolume } from '../lib/geometry/volume';
import type { MeshPrintStats } from '../lib/estimate';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { FONT_URL_PATH, registerFont } from '../lib/geometry/text';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../pwa/chunks';

/**
 * The geometry worker's work: builds meshes with Manifold and answers the
 * client's requests (worker/client.ts). The entry (geometry.worker.ts) loads
 * this beside the WASM; the file writers and the slicer load on first use.
 */

declare const self: DedicatedWorkerGlobalScope;

// Small LRU so long editing sessions don't grow without bound.
const MAX_CACHE = 300;
const cache = new Map<string, MeshData>();
// Volumes are measured once per mesh, when it's built, and outlive the mesh cache.
const MAX_VOLUMES = 5000;
const volumes = new Map<string, number>();
// Slice data for print-time estimates, kept like the volumes.
const printStats = new Map<string, MeshPrintStats>();

let wasmReady: Promise<Wasm>;

// Label text needs the font before any mesh that uses it is built (building is synchronous).
// It loads with the first mesh that may have text, or once the WASM is ready, whichever is first.
let fontLoad: Promise<void> | null = null;
function fontReady() {
  return (fontLoad ??= fetch(`${import.meta.env.BASE_URL}${FONT_URL_PATH}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`font ${r.status}`))))
    .then((b) => void registerFont(b))
    .catch((e) => console.warn('Label font unavailable:', e)));
}

/** Baseplate pieces (without case walls) and connector keys never have text: they don't wait for the font. */
const textFree = (spec: MeshSpec): boolean => (spec.kind === 'piece' && !spec.enclosure) || spec.kind === 'key' || (spec.kind === 'split' && textFree(spec.base));

/** The file writers (3MF, Bambu, STL, STEP, zips) and the slicer, loaded on the first request that needs them. */
let writers: Promise<typeof import('./writers')> | null = null;
const loadWriters = () => (writers ??= import('./writers').catch((e) => ((writers = null), Promise.reject(e))));

/**
 * Instantiate Manifold from the WASM module the entry is already fetching and
 * compiling, and return the request handler.
 */
export function start(wasm: Promise<WebAssembly.Module>): (req: WorkerRequest) => Promise<void> {
  // Manifold's loader never settles when instantiateWasm fails; this does.
  let failed!: (e: unknown) => void;
  const failure = new Promise<never>((_, reject) => (failed = reject));
  const loaded = Module({
    locateFile: () => wasmUrl,
    instantiateWasm: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
      wasm.then((m) => WebAssembly.instantiate(m, imports).then((inst) => done(inst, m))).catch(failed);
      return {};
    },
  } as { locateFile: () => string });
  wasmReady = Promise.race([loaded, failure]).then((w) => {
    w.setup();
    return w;
  });
  void wasmReady.then(fontReady, () => {});
  return handle;
}

function getCached(key: string) {
  const m = cache.get(key);
  if (m) {
    cache.delete(key);
    cache.set(key, m);
  }
  return m;
}

async function meshFor(spec: MeshSpec): Promise<MeshData> {
  const hit = getCached(spec.key);
  if (hit) return hit;
  const text = textFree(spec) ? null : fontReady();
  // A part split by colour role (multi-colour 'feature') starts from its cached whole mesh.
  const base = spec.kind === 'split' ? await meshFor(spec.base) : null;
  const w = await wasmReady;
  await text;
  const mesh = spec.kind === 'split' ? splitByRoles(w, base!, spec.base) : buildMesh(w, spec);
  cache.set(spec.key, mesh);
  volumes.set(spec.key, printedVolume(mesh));
  while (volumes.size > MAX_VOLUMES) volumes.delete(volumes.keys().next().value!);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return mesh;
}

async function ensureJobMeshes(id: number, job: PrintJob) {
  const needed = new Set<string>();
  for (const pl of job.plates) for (const p of pl.placements) needed.add(job.parts[p.key].meshKey);
  let done = 0;
  for (const key of needed) {
    await meshFor(job.meshes[key]);
    done++;
    post({ id, type: 'progress', done, total: needed.size });
  }
  return (key: string) => getCached(key) ?? cache.get(key)!;
}

/** Build the meshes an assembled-drawer export needs (more than the cache may hold). */
async function ensureMeshes(id: number, specs: MeshSpec[]) {
  // Keep every mesh of this export, even past the cache size.
  const held = new Map<string, MeshData>();
  let done = 0;
  for (const spec of specs) {
    held.set(spec.key, await meshFor(spec));
    done++;
    post({ id, type: 'progress', done, total: specs.length });
  }
  return (key: string) => held.get(key) ?? getCached(key)!;
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function handle(req: WorkerRequest) {
  try {
    switch (req.type) {
      case 'mesh': {
        const m = await meshFor(req.spec);
        // Copy so the cached arrays stay usable in this worker.
        const mesh = cloneMesh(m);
        post({ id: req.id, type: 'mesh', mesh, volume: volumes.get(req.spec.key) });
        break;
      }
      case 'volumes': {
        const out: Record<string, number> = {};
        let done = 0;
        for (const spec of req.specs) {
          try {
            await meshFor(spec);
            // The volume can be evicted while the mesh is still cached.
            if (!volumes.has(spec.key)) volumes.set(spec.key, printedVolume(getCached(spec.key)!));
            out[spec.key] = volumes.get(spec.key)!;
          } catch {
            // Leave it out; the caller shows the part as unmeasured.
          }
          post({ id: req.id, type: 'progress', done: ++done, total: req.specs.length });
        }
        post({ id: req.id, type: 'volumes', volumes: out });
        break;
      }
      case 'print-stats': {
        const { sliceStats } = await loadWriters();
        const out: Record<string, MeshPrintStats> = {};
        let done = 0;
        for (const spec of req.specs) {
          try {
            let s = printStats.get(spec.key);
            if (!s) {
              s = sliceStats(await meshFor(spec));
              printStats.set(spec.key, s);
              while (printStats.size > MAX_VOLUMES) printStats.delete(printStats.keys().next().value!);
            }
            out[spec.key] = s;
          } catch {
            // Left out: the plate shows no estimate.
          }
          post({ id: req.id, type: 'progress', done: ++done, total: req.specs.length });
        }
        post({ id: req.id, type: 'print-stats', stats: out });
        break;
      }
      case 'export-stl-plate': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, { ...req.job, plates: [req.job.plates[req.plate]] });
        const bytes = x.exportPlateSTL(req.job, req.plate, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-stl-zip': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = x.exportPlatesStlZip(req.job, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-stl-single': {
        const x = await loadWriters();
        const bytes = x.writeSTL([{ mesh: await meshFor(req.spec) }], req.name);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-step-plate': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, { ...req.job, plates: [req.job.plates[req.plate]] });
        const bytes = x.exportPlateSTEP(req.job, req.plate, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-step-zip': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = x.exportPlatesStepZip(req.job, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-step-single': {
        const x = await loadWriters();
        const bytes = x.exportSingleSTEP(req.name, await meshFor(req.spec));
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-step-assembly': {
        const x = await loadWriters();
        const keys = new Set(req.assemblies.flatMap((a) => a.items.map((it) => it.meshKey)));
        const get = await ensureMeshes(req.id, [...keys].map((k) => req.meshes[k]));
        const bytes = x.exportAssembliesSTEP(req.assemblies, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-bambu': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = x.exportBambuProject(req.job, req.setup, get, req.settings);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-zip': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = x.exportPlatesZip(req.job, req.setup, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-plate': {
        const x = await loadWriters();
        const get = await ensureJobMeshes(req.id, { ...req.job, plates: [req.job.plates[req.plate]] });
        const bytes = x.exportPlate3MF(req.job, req.plate, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-single': {
        const x = await loadWriters();
        const m = await meshFor(req.spec);
        const bytes = x.exportSingle3MF(req.name, m);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
    }
  } catch (err) {
    // A writer that didn't load says to reload (pwa/chunks.ts).
    post({ id: req.id, type: 'error', message: isChunkError(err) ? CHUNK_ERROR_MESSAGE : err instanceof Error ? err.message : String(err) });
  }
}
