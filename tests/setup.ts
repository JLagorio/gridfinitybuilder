// The attachment kinds load on demand in the app (src/lib/wall/ready.ts), and their builders are
// handed to buildMesh by the geometry worker: the tests plan and build with all of them.
import '../src/lib/wall/kinds/all';
import * as wallBuild from '../src/lib/wall/build';
import { setWallBuilders } from '../src/lib/project';

setWallBuilders(wallBuild);
