/**
 * Every attachment kind's planning (each registers itself; ../index.ts loads this on demand), and
 * the load check planning runs on them (../load.ts). Add a kind here, in ../ui.ts and in ../build.ts.
 */
// The boards themselves plan with this (it brings boards built from tiles too), loaded with the first board as well (skadisBoards.ts).
import '../../skadisBoardPlan';
import '../load';
// A board's attachments in a print job (project.ts setWallParts).
import '../parts';
// Its parts in what's been printed (lib/printed.ts setPrintKey).
import '../../printedBoards';
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
import './batteryDock';
import './toolDock';
import './chargerCradle';
import './cellDispenser';
import './mediaBlock';
import './spoolRack';
import './boxSleeve';
import './leadHanger';
import './labelTag';
import './receiver';
import './pegboardBridge';
import './cleatStrip';
import './dinRail';
import './mountBoss';
import './slotRack';
import './displayLedge';
import './planter';
import './caddy';
import './faceout';
import './saddle';
import './magnetBar';
import './measureHanger';
import './eyewear';
import './clampRack';
import './clipTab';
import './bottleRack';
import './stickRack';
import './holster';
import './gripper';
import './tiltBin';
import './lidBox';
import './cabinet';
import './swivelTower';
import './foldHook';
import './model';
import './shadowBoard';
import './toolCradle';
import { kindsLoaded } from '../ready';

kindsLoaded();
