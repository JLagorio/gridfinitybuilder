/**
 * Registers every container type. Import this module once (project.ts does)
 * before planning or building containers; registry.ts holds the lookups.
 */
export * from './registry';
export { containerBase, containerRing } from './base';
import './box';
import './hopper';
