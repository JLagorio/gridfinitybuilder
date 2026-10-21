/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../pwa/chunks';

/**
 * The geometry worker's entry, kept tiny: the Manifold WASM starts
 * downloading (and compiling, as it streams in) the moment the worker starts,
 * while the mesh-building code (meshes.ts) loads beside it. Requests that
 * arrive before that code are answered, in order, once it's in.
 */

declare const self: DedicatedWorkerGlobalScope;

function compileWasm(): Promise<WebAssembly.Module> {
  // A server that doesn't say application/wasm can't stream; compile it whole instead.
  return WebAssembly.compileStreaming(fetch(wasmUrl)).catch(async () => WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer()));
}

const wasm = compileWasm();
// A failed download is reported by every mesh request (meshes.ts), not here.
wasm.catch(() => {});
const handler = import('./meshes').then((m) => m.start(wasm));

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  handler.then(
    (handle) => handle(req),
    (err) => {
      // The mesh code didn't load (pwa/chunks.ts).
      const message = isChunkError(err) ? CHUNK_ERROR_MESSAGE : err instanceof Error ? err.message : String(err);
      self.postMessage({ id: req.id, type: 'error', message } satisfies WorkerResponse);
    },
  );
};
