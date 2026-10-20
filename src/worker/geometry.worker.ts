/// <reference lib="webworker" />
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { MeshData, Wasm } from '../lib/geometry/kernel';
import {
  buildMesh,
  exportBambuProject,
  exportPlate3MF,
  exportPlatesZip,
  exportSingle3MF,
  type MeshSpec,
  type PrintJob,
} from '../lib/project';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const wasmReady: Promise<Wasm> = Module({ locateFile: () => wasmUrl }).then((w) => {
  w.setup();
  return w;
});

// Small LRU so long editing sessions don't grow without bound.
const MAX_CACHE = 300;
const cache = new Map<string, MeshData>();

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
        post({ id: req.id, type: 'mesh', mesh: { positions: m.positions.slice(), indices: m.indices.slice() } });
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
        const bytes = exportPlatesZip(req.job, req.state, get);
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
