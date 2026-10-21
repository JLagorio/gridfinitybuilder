/**
 * Sidebar fields for each container type (the geometry side is
 * src/lib/geometry/containers). Each type registers its component in ./index.ts.
 */
import type { ComponentType } from 'react';
import type { BinCells, BinOptions } from '../../lib/geometry/bin';
import type { ContainerType } from '../../lib/geometry/containers';

export interface ContainerFieldsProps<O = unknown> {
  /** The whole bin (size, height, base…), for summaries and limits. */
  bin: BinOptions;
  /** This type's cleaned options. */
  value: O;
  /** Change some of this type's options. */
  onChange: (patch: Partial<O>) => void;
  /** Bin options outside the container's own (height, base, …). */
  onBinChange: (patch: Partial<BinOptions>) => void;
  /** Cell sizes under the bin (partial edge cells). */
  cells?: BinCells;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FIELDS = new Map<ContainerType, ComponentType<ContainerFieldsProps<any>>>();

export function registerContainerFields<O>(kind: ContainerType, fields: ComponentType<ContainerFieldsProps<O>>): void {
  FIELDS.set(kind, fields as ComponentType<ContainerFieldsProps<unknown>>);
}

export function containerFields(kind: ContainerType): ComponentType<ContainerFieldsProps<unknown>> | null {
  return FIELDS.get(kind) ?? null;
}
