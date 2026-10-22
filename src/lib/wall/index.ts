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
import './kinds/shelf';
import './kinds/rod';
import './kinds/toolRack';
import './kinds/cradle';
import './kinds/plate';
import './kinds/rail';
import './kinds/ledBar';
import './kinds/cableClip';
import './kinds/cableChannel';
import './kinds/powerStrip';
import './kinds/cableComb';
import './kinds/gridShelf';
import './kinds/gridPlate';
import './kinds/gridClip';
import './kinds/tiltBin';
import './kinds/lidBox';
import './kinds/cabinet';
import './kinds/swivelTower';
import './kinds/foldHook';
