/**
 * Registers every attachment kind (planning side). Import this once (project.ts
 * does) before planning attachments; registry.ts holds the lookups and
 * build.ts the geometry.
 */
export * from './registry';
import './kinds/hook';
import './kinds/bin';
import './kinds/cup';
import './kinds/fitTest';
import './kinds/rail';
