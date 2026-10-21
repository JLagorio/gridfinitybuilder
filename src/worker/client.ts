import type { MeshData } from '../lib/geometry/kernel';
import type { MeshSpec, PrintJob } from '../lib/project';
import type { PrintSetup } from '../lib/layout/plan';
import type { StepAssembly } from '../lib/export/step';
import type { MeshPrintStats } from '../lib/estimate';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { importedMesh } from '../lib/imported/registry';

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
  /** Solid volumes (mm³) by mesh key; small, so kept for the whole session. */
  private vols = new Map<string, number>();
  private volsInFlight = new Set<string>();
  private volsFailed = new Set<string>();
  /** Slice data for print-time estimates, by mesh key. */
  private stats = new Map<string, MeshPrintStats>();
  private statsInFlight = new Set<string>();
  private statsFailed = new Set<string>();
  private wanted: MeshSpec[] = [];
  private busy = false;
  private listeners = new Set<() => void>();
  private version = 0;
  private shownFirst!: () => void;
  private firstMeshIn = false;
  private firstShown = false;
  /**
   * Settles once the first mesh the screen asked for is in (or failed), or
   * there was nothing to build, and the page has drawn it and gone idle.
   * What the first view doesn't need (the other tabs, the label font, the
   * offline copy) waits for it, so it doesn't share the network with the
   * WASM or hold up drawing that mesh.
   */
  readonly firstView = new Promise<void>((resolve) => (this.shownFirst = resolve));

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

  /** Imported meshes the worker has (imported/registry.ts), by hash. */
  private sent = new Set<string>();

  /** Send the worker the imported meshes a request needs and it doesn't have yet (the page has them in memory). */
  private sendImported(body: Body) {
    const specs: (MeshSpec | undefined)[] = [];
    if ('spec' in body) specs.push(body.spec);
    if ('specs' in body) specs.push(...body.specs);
    if ('job' in body) specs.push(...Object.values(body.job.meshes));
    if ('meshes' in body) specs.push(...Object.values(body.meshes));
    for (const s of specs) {
      if (s?.kind !== 'imported' || this.sent.has(s.hash)) continue;
      const m = importedMesh(s.hash);
      if (!m) continue;
      this.sent.add(s.hash);
      this.worker.postMessage({ id: 0, type: 'put-mesh', hash: s.hash, mesh: { positions: m.positions, indices: m.indices } } satisfies WorkerRequest);
    }
  }

  private call(body: Body, onProgress?: Pending['onProgress']): Promise<WorkerResponse> {
    this.sendImported(body);
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

  /** Whether `firstView` has settled. */
  get firstViewIn() {
    return this.firstShown;
  }

  private markFirstView() {
    if (this.firstMeshIn) return;
    this.firstMeshIn = true;
    // After the frame that shows it, when the page has nothing else to do (or in a second at most).
    const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 200));
    requestAnimationFrame(() =>
      idle(() => {
        this.firstShown = true;
        this.shownFirst();
        this.emit();
      }),
    );
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
    if (!next) {
      this.markFirstView();
      return;
    }
    this.busy = true;
    this.emit();
    try {
      const res = await this.call({ type: 'mesh', spec: next });
      if (res.type === 'mesh') {
        this.meshes.set(next.key, res.mesh);
        if (res.volume !== undefined) this.vols.set(next.key, res.volume);
      }
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
    this.markFirstView();
    void this.pump();
  }

  async exportBambu(job: PrintJob, setup: PrintSetup, settings: string | undefined, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-bambu', job, setup, settings }, onProgress));
  }

  async exportZip(job: PrintJob, setup: PrintSetup, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-zip', job, setup }, onProgress));
  }

  async exportPlate(job: PrintJob, plate: number, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-plate', job, plate }, onProgress));
  }

  async exportSingle(spec: MeshSpec, name: string) {
    return this.bytes(await this.call({ type: 'export-single', spec, name }));
  }

  async exportStlPlate(job: PrintJob, plate: number, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-stl-plate', job, plate }, onProgress));
  }

  async exportStlZip(job: PrintJob, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-stl-zip', job }, onProgress));
  }

  async exportStlSingle(spec: MeshSpec, name: string) {
    return this.bytes(await this.call({ type: 'export-stl-single', spec, name }));
  }

  async exportStepPlate(job: PrintJob, plate: number, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-step-plate', job, plate }, onProgress));
  }

  async exportStepZip(job: PrintJob, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-step-zip', job }, onProgress));
  }

  async exportStepSingle(spec: MeshSpec, name: string) {
    return this.bytes(await this.call({ type: 'export-step-single', spec, name }));
  }

  /** Assembled drawers as STEP: one file, or a zip with one per drawer. */
  async exportStepAssembly(assemblies: StepAssembly[], meshes: Record<string, MeshSpec>, onProgress?: Pending['onProgress']) {
    return this.bytes(await this.call({ type: 'export-step-assembly', assemblies, meshes }, onProgress));
  }

  /** Measured solid volume of a mesh (mm³), if known yet. */
  volume(key: string): number | undefined {
    return this.vols.get(key);
  }

  /** True when a mesh can't be measured (its geometry failed). */
  volumeFailed(key: string) {
    return this.volsFailed.has(key) || this.errors.has(key);
  }

  /** Measure the meshes not measured yet (building them as needed). Listeners hear when it's done. */
  async measure(specs: MeshSpec[], onProgress?: Pending['onProgress']) {
    const todo = specs.filter((s) => !this.vols.has(s.key) && !this.volsInFlight.has(s.key) && !this.volumeFailed(s.key));
    if (!todo.length) return;
    for (const s of todo) this.volsInFlight.add(s.key);
    try {
      const res = await this.call({ type: 'volumes', specs: todo }, onProgress);
      if (res.type === 'volumes') {
        for (const s of todo) {
          const v = res.volumes[s.key];
          if (v === undefined) this.volsFailed.add(s.key);
          else this.vols.set(s.key, v);
        }
      }
    } finally {
      for (const s of todo) this.volsInFlight.delete(s.key);
      this.emit();
    }
  }

  /** Slice data of a mesh for the print-time estimate, if known yet. */
  printStats(key: string): MeshPrintStats | undefined {
    return this.stats.get(key);
  }

  /** How many meshes are sliced: changes only when slice data comes in. */
  get slicedCount() {
    return this.stats.size;
  }

  printStatsFailed(key: string) {
    return this.statsFailed.has(key) || this.errors.has(key);
  }

  /** Slice the meshes not sliced yet (building them as needed). Listeners hear when it's done. */
  async slice(specs: MeshSpec[], onProgress?: Pending['onProgress']) {
    const todo = specs.filter((s) => !this.stats.has(s.key) && !this.statsInFlight.has(s.key) && !this.printStatsFailed(s.key));
    if (!todo.length) return;
    for (const s of todo) this.statsInFlight.add(s.key);
    try {
      const res = await this.call({ type: 'print-stats', specs: todo }, onProgress);
      if (res.type === 'print-stats') {
        for (const s of todo) {
          const v = res.stats[s.key];
          if (v === undefined) this.statsFailed.add(s.key);
          else this.stats.set(s.key, v);
        }
      }
    } finally {
      for (const s of todo) this.statsInFlight.delete(s.key);
      this.emit();
    }
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
