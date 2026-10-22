// The attachment kinds and the Skådis boards' planning load on demand in the app (src/lib/wall/ready.ts,
// src/lib/skadisBoards.ts), and their builders are handed to buildMesh by the geometry worker: the tests
// plan and build with all of them.
import '../src/lib/wall/kinds/all';
import '../src/lib/skadisBoardPlan';
import * as wallBuild from '../src/lib/wall/build';
import * as skadisBuild from '../src/lib/geometry/skadisBuild';
import { setWallBuilders } from '../src/lib/project';
import { setSkadisBoardBuilders } from '../src/lib/skadisBoards';

setWallBuilders(wallBuild);
setSkadisBoardBuilders(skadisBuild);
