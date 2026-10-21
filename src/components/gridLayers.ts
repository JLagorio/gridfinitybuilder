import { useSyncExternalStore, type ComponentType, type RefObject } from 'react';
import type { GridLayout } from '../lib/layout/drawer';
import type { PlacedBin } from '../lib/project';

/**
 * Layers drawn in the drawer grid's svg (BinGridEditor) by parts that load
 * later, like My bins' drop preview (MyBinsDrop.tsx). The grid is on the
 * first screen; this keeps their code out of it.
 */
export interface GridLayerProps {
  svg: RefObject<SVGSVGElement | null>;
  layout: GridLayout;
  /** The drawer's floor bins and blocked cells (bins.ts withBlocked). */
  taken: PlacedBin[];
}

let layers: ComponentType<GridLayerProps>[] = [];
const listeners = new Set<() => void>();

export function addGridLayer(layer: ComponentType<GridLayerProps>) {
  if (layers.includes(layer)) return;
  layers = [...layers, layer];
  for (const l of listeners) l();
}

export function useGridLayers() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => layers,
  );
}
