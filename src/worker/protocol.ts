import type { MeshData } from '../lib/geometry/kernel';
import type { MeshSpec, PrintJob } from '../lib/project';
import type { PrintSetup } from '../lib/layout/plan';

export type WorkerRequest =
  | { id: number; type: 'mesh'; spec: MeshSpec }
  | { id: number; type: 'export-bambu'; job: PrintJob; setup: PrintSetup; settings?: string }
  | { id: number; type: 'export-zip'; job: PrintJob; setup: PrintSetup }
  | { id: number; type: 'export-plate'; job: PrintJob; plate: number }
  | { id: number; type: 'export-single'; spec: MeshSpec; name: string };

export type WorkerResponse =
  | { id: number; type: 'mesh'; mesh: MeshData }
  | { id: number; type: 'bytes'; bytes: Uint8Array }
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'error'; message: string };
