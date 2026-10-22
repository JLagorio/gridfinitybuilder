/**
 * Every attachment kind's planning (each registers itself; ../index.ts loads this on demand).
 * Add a kind here, in ../ui.ts and in ../build.ts.
 */
import './hook';
import './bin';
import './cup';
import './fitTest';
import './shelf';
import './rod';
import './toolRack';
import './cradle';
import './plate';
import './rail';
import './ledBar';
import './cableClip';
import './cableChannel';
import './powerStrip';
import './cableComb';
import './gridShelf';
import './gridPlate';
import './gridClip';
import { kindsLoaded } from '../ready';

kindsLoaded();
