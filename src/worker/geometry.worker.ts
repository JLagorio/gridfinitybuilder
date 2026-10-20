/// <reference lib="webworker" />
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { cloneMesh, type MeshData, type Wasm } from '../lib/geometry/kernel';
import {
  buildMesh,
  exportBambuProject,
  exportPlate3MF,
  exportPlatesZip,
  exportSingle3MF,
  type MeshSpec,
  type PrintJob,
} from '../lib/project';
import { exportPlateSTL, exportPlatesStlZip, writeSTL } from '../lib/export/stl';
import { printedVolume } from '../lib/geometry/volume';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { FONT_URL_PATH, registerFont } from '../lib/geometry/text';

declare const self: DedicatedWorkerGlobalScope;

// Label text needs the font before any mesh that uses it is built (building is synchronous).
const fontReady = fetch(`${import.meta.env.BASE_URL}${FONT_URL_PATH}`)
  .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`font ${r.status}`))))
  .then(registerFont)
  .catch((e) => console.warn('Label font unavailable:', e));

const wasmReady: Promise<Wasm> = Promise.all([Module({ locateFile: () => wasmUrl }), fontReady]).then(([w]) => {
  w.setup();
  return w;
});

// Small LRU so long editing sessions don't grow without bound.
const MAX_CACHE = 300;
const cache = new Map<string, MeshData>();
// Volumes are measured once per mesh, when it's built, and outlive the mesh cache.
const MAX_VOLUMES = 5000;
const volumes = new Map<string, number>();

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
  const w = await wasmReady;
  const mesh = buildMesh(w, spec);
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

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
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
      case 'export-stl-plate': {
        const get = await ensureJobMeshes(req.id, { ...req.job, plates: [req.job.plates[req.plate]] });
        const bytes = exportPlateSTL(req.job, req.plate, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-stl-zip': {
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = exportPlatesStlZip(req.job, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-stl-single': {
        const bytes = writeSTL([{ mesh: await meshFor(req.spec) }], req.name);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-bambu': {
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = exportBambuProject(req.job, req.setup, get, req.settings);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-zip': {
        const get = await ensureJobMeshes(req.id, req.job);
        const bytes = exportPlatesZip(req.job, req.setup, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-plate': {
        const get = await ensureJobMeshes(req.id, { ...req.job, plates: [req.job.plates[req.plate]] });
        const bytes = exportPlate3MF(req.job, req.plate, get);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
      case 'export-single': {
        const m = await meshFor(req.spec);
        const bytes = exportSingle3MF(req.name, m);
        post({ id: req.id, type: 'bytes', bytes }, [bytes.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
