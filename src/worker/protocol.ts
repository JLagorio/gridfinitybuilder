import type { MeshData } from '../lib/geometry/kernel';
import type { MeshSpec, PrintJob } from '../lib/project';
import type { PrintSetup } from '../lib/layout/plan';
import type { StepAssembly } from '../lib/export/step';
import type { MeshPrintStats } from '../lib/estimate';

export type WorkerRequest =
  | { id: number; type: 'mesh'; spec: MeshSpec }
  | { id: number; type: 'export-bambu'; job: PrintJob; setup: PrintSetup; settings?: string }
  | { id: number; type: 'export-zip'; job: PrintJob; setup: PrintSetup }
  | { id: number; type: 'export-plate'; job: PrintJob; plate: number }
  | { id: number; type: 'export-single'; spec: MeshSpec; name: string }
  | { id: number; type: 'export-stl-plate'; job: PrintJob; plate: number }
  | { id: number; type: 'export-stl-zip'; job: PrintJob }
  | { id: number; type: 'export-stl-single'; spec: MeshSpec; name: string }
  | { id: number; type: 'export-step-plate'; job: PrintJob; plate: number }
  | { id: number; type: 'export-step-zip'; job: PrintJob }
  | { id: number; type: 'export-step-single'; spec: MeshSpec; name: string }
  /** Assembled drawers: one .step, or a zip of them when there are several. */
  | { id: number; type: 'export-step-assembly'; assemblies: StepAssembly[]; meshes: Record<string, MeshSpec> }
  /** Solid volume (mm³) of each mesh, building any that aren't cached. */
  | { id: number; type: 'volumes'; specs: MeshSpec[] }
  /** Layer-by-layer slice data for the print-time estimate (estimate.ts). */
  | { id: number; type: 'print-stats'; specs: MeshSpec[] };

export type WorkerResponse =
  | { id: number; type: 'mesh'; mesh: MeshData; volume?: number }
  | { id: number; type: 'volumes'; volumes: Record<string, number> }
  | { id: number; type: 'print-stats'; stats: Record<string, MeshPrintStats> }
  | { id: number; type: 'bytes'; bytes: Uint8Array }
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'error'; message: string };
