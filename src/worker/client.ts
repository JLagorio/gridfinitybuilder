import type { MeshData } from '../lib/geometry/kernel';
import type { MeshSpec, PrintJob, ProjectState } from '../lib/project';
import type { PrintSetup } from '../lib/layout/plan';
import type { WorkerRequest, WorkerResponse } from './protocol';

type Pending = {
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

// Distributive Omit so each request variant keeps its own fields.
type Body = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

/**
 * Talks to the geometry worker. Preview meshes go through a single queue that
 * always works on what the screen currently needs (stale requests are dropped).
 */
class GeometryClient {
  private worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private meshes = new Map<string, MeshData>();
  private errors = new Map<string, string>();
  private wanted: MeshSpec[] = [];
  private busy = false;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
  }

  private call(body: Body, onProgress?: Pending['onProgress']): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...body, id } as WorkerRequest);
    });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion() {
    return this.version;
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  mesh(key: string) {
    return this.meshes.get(key);
  }

  error(key: string) {
    return this.errors.get(key);
  }

  /** Declare which meshes the screen needs right now. */
  want(specs: MeshSpec[]) {
    this.wanted = specs;
    void this.pump();
  }

  get queueLength() {
    return this.wanted.filter((s) => !this.meshes.has(s.key) && !this.errors.has(s.key)).length + (this.busy ? 1 : 0);
  }

  private async pump() {
    if (this.busy) return;
    const next = this.wanted.find((s) => !this.meshes.has(s.key) && !this.errors.has(s.key));
    if (!next) return;
    this.busy = true;
    this.emit();
    try {
      const res = await this.call({ type: 'mesh', spec: next });
      if (res.type === 'mesh') this.meshes.set(next.key, res.mesh);
    } catch (e) {
      this.errors.set(next.key, (e as Error).message);
    }
    // Keep the main-thread copy bounded too.
    if (this.meshes.size > 400) {
      const keep = new Set(this.wanted.map((s) => s.key));
      for (const k of this.meshes.keys()) if (!keep.has(k)) this.meshes.delete(k);
    }
    this.busy = false;
    this.emit();
    void this.pump();
  }

  async exportBambu(job: PrintJob, setup: PrintSetup, settings: string | undefined, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-bambu', job, setup, settings }, onProgress));
  }

  async exportZip(job: PrintJob, state: ProjectState, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-zip', job, state }, onProgress));
  }

  async exportPlate(job: PrintJob, plate: number, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-plate', job, plate }, onProgress));
  }

  async exportSingle(spec: MeshSpec, name: string) {
    return this.bytes(await this.call({ type: 'export-single', spec, name }));
  }

  private bytes(r: WorkerResponse): Uint8Array {
    if (r.type !== 'bytes') throw new Error('unexpected worker response');
    return r.bytes;
  }
}

export const geometry = new GeometryClient();

export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
