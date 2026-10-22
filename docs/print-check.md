# Print check

A hardening pass on the printed geometry: every kind of part Gridfit makes was
built through the app's own code, checked for things that print badly, and
sliced with PrusaSlicer. Boards (Skådis, openGrid, Multiboard) and wall
attachments went through the same pass later ("Boards and attachments" below).
This page says what is checked, how to run it again, what it found and fixed,
and what is left.

## What is checked

### Mesh checks

`src/lib/geometry/printcheck.ts` checks one finished part (a `MeshData`, in
its print orientation). The checks are pure: they read the mesh and return
findings, so the UI's printability warnings could use them too.
`meshTopology` is plain TypeScript; the slice checks read the mesh through
Manifold's slicer at the middle of every 0.2 mm layer, like a slicer does.

| Check | Finding | Rule |
|---|---|---|
| Valid solid | error `empty`, `finite`, `manifold` | Not empty, finite coordinates, every edge shared by exactly two triangles running opposite ways, positive volume. |
| One piece | error `pieces` | Bodies past the first (edge-connected), each with its volume and place. |
| Flat on the bed | error `bed-z` | Lowest point at z = 0 (±0.001 mm): nothing floats above the bed or reaches below it. |
| First layer | error / warning `contact` | Under 5 mm² of first layer is an error; a part taller than 5 × √(first-layer area) may tip (a brim helps). |
| Islands | error `island` | A region of a layer that touches nothing in the layer below starts in mid-air. |
| Overhangs | warning `overhang` | Past a 30° slope, what a layer puts down beyond the one below: held along one edge (a ledge) it may reach 3 mm; held between edges (a bridge) 30 mm, a 60 mm span, as long as drawer-unit shelves may be. |
| Thin walls | warning `thin` | Erode each layer by just under 0.4 mm and grow it back: what goes is thinner than two 0.4 mm lines. Reported when it lasts at least 1 mm up the part, so the tips of chamfers and lips (a few layers) don't count. The width is measured where it is thinnest. |
| Printer fit | error `bed-fit` | Footprint and height within the usable bed, either way round, and clear of the printer's exclusion area (the X1 / P1 front-left corner: beside it or behind it) (`partOvershoot`, `src/lib/bedfit.ts`). |
| Overlays | error `overlay` | Inlaid text and shadow floors (filament-2 bodies) are closed, don't overlap the body, and are checked together with it. |

### PrusaSlicer

PrusaSlicer 2.7.2 slices every part headless with a 0.4 mm nozzle, 0.2 mm
layers (first layer too), 2 perimeters, 5 top / 3 bottom layers, 15 % infill,
no supports, on the default printer's 256 × 256 × 256 mm bed
(`prusaslicer.ini` in the output folder). The sampler records:

- `--info`: manifold state, open edges, facets reversed, backwards edges,
  degenerate facets removed, number of parts;
- whether slicing succeeded, its warnings and errors, and its print stability
  issues ("Long bridging extrusions", "Floating bridge anchors", "Loose
  extrusions", "Thin fragile part", "Low bed adhesion", …);
- Arachne's internal retries ("Detected non-planar Voronoi diagram…") are
  counted as noise, not reported.

### Spiral vase

Vase-mode bins (`src/lib/geometry/containers/vase.ts`, README: Vase-mode
bins) are sliced the way they print: spiral vase on, 1 perimeter, no top
layers, 0 % infill, bottom solid layers up to the spiral's start
(`vaseBottomLayers`: 30 at 0.2 mm, 5 under a flat bin's 1 mm floor) and the
external perimeter as wide as the wall line they are drawn for. The G-code is
read back (`scripts/gcode-spiral.ts`):

| Check | Finding | Rule |
|---|---|---|
| One spiral | `spiral: N of M layers not one continuous line` | After the bottom layers, every layer that extrudes is one line: Z rises along it and never goes back down, there is no travel or retraction between its extrusions (the retraction at the end of the print aside), and it starts where the layer before ended. |
| Slits fold the wall | `spiral: a turn is … mm` | One turn (the middle spiral layer's length) is within 3 % of the outline plus both sides of every slit (`SpiralPrint.path`): no slit was closed by the slicer's gap closing, none skipped. |

The same check found where a slit may end. Cutting slits from the back wall
to within 1.5 line widths of the front wall split the outline into two loops
once PrusaSlicer inset it by half a line (every layer two loops and a travel,
no spiral, one section printed); at 1.75 lines it stayed one loop with either
perimeter generator. The slits stop 2 lines short.

### Faces past 45°

The overhang check works layer by layer: a face sloping between 45° and flat
puts down only a fraction of a millimetre past the layer below, so it isn't
seen until it is nearly flat (and a flat one is a ledge or a bridge, which it
does see). `scripts/sampler-steep.ts` looks at the mesh itself: triangles
facing down more than 50° from upright and less than 85°, off the first
layer, joined where they share corners; regions of 4 mm² or more that rise at
least 0.6 mm are listed in `report.md` ("Faces past 45°") with their area,
steepest face and place. They are for a look, not findings: the tops of round
holes and the undersides of round pegs lying down show here, and print
without support up to about 10 mm across.

### Assembled attachments

Each attachment is put together as the drawer view shows it (`wall/parts.ts`:
its body, its extra parts where they sit, its lock keys and T-nuts, turned and
placed by the job's scene items) and no two of its pieces may share more than
0.05 mm³. An overlap fails the run like an error (`report.md`: "Assembled").

## Running it

```bash
npm run sampler -- out/sampler            # build and check every part (about 11 minutes, boards and attachments 9 of them)
npm run sampler -- out/sampler --slice    # and slice each with PrusaSlicer (much longer: board tiles take a minute or more each)
npm run sampler -- out/sampler --only labels/        # just the parts whose path has this in it
npm run sampler -- out/sampler --only attachments/   # the wall attachments (boards/: the boards)
npm run sampler -- --report out/sampler/report.json  # write report.md again from a run
PRUSA_SLICER=/path/to/prusa-slicer npm run sampler -- out/sampler --slice
```

`--slice` runs `/usr/bin/prusa-slicer` (or `PRUSA_SLICER`); on Ubuntu 24.04
`apt-get install prusa-slicer` installs the same 2.7.2. Without it, leave
`--slice` off: the mesh checks, faces past 45° and assembled attachments
don't need it.

Each part is written as its own binary STL (`<group>/<sample>.<part>.stl`,
overlays included as the app's STL export writes them) and each baseplate
plate as a 3MF. `report.md` lists errors, warnings and PrusaSlicer findings,
marking the ones that are there by design (`KNOWN_FINDINGS` in
`scripts/sampler-cases.ts`) so whatever is left stands out, then every part
with its size, triangles and first-layer area. `report.json` has it all. The
run fails when a part has an error.

The tests run the checks on synthetic shapes and on a representative part of
each family (`tests/printcheck.test.ts`, about 15 seconds), and hold every fix
below (`tests/print-fixes.test.ts`; the boards' and attachments' in
`tests/wall-print.test.ts`, which also checks that the sampler samples every
attachment kind, each of its presets and every extra part).

## What the sampler covers

`scripts/sampler-cases.ts`, 279 parts in 16 groups, each planned like a real
job (`planPrint`, `planTestFit`) and built with `buildMesh` (boards and
attachments, 17 groups more: "Boards and attachments" below):

- **containers:** drawer units (notch, tab, knob and grip pulls, stops, labels
  raised and engraved, flat / lip / grid tops, row sizes, compartments) with
  their drawers; parts boxes (snap and pin hinges, snap and magnet latches,
  flat / grid / lip tops, lid labels) with their lids; hoppers (dividers, lip,
  text and slot labels, steep and flat); tool racks (screwdrivers, hex keys
  with engraving, pliers with lean, wrenches, files staggered and stepped);
  dispensers (AA, coin cells with a window, D cells with a tray, tape with a
  cutter and axle, zip-tie channels);
- **bases:** standard, lite, efficient floor, flat; magnets, screws, both,
  refined slots, crush ribs, chamfers, printable hole tops, corner holes;
  heights in units, inside and outside mm;
- **lips:** normal, reduced, none, notches; stacking lids; pocket-grid lids;
- **accessories:** sliding lids (with text), lift-out trays (1 and 3), divider
  rails (x, xy), lift-out cups (tab, notch, scoop, none), egg-crate grids;
- **walls:** cutouts, finger slides, hex wall patterns, square inside corners;
- **compartments:** ramp, steps and raised floors, pocket / tool / solid
  insides, chamfered and rounded wall tops, finger notches, lowered walls,
  removable dividers (with notches, and with label tabs in front), L shapes,
  diagonal and curved walls, a 3 × 3 sorter, compartments in a lite base;
- **pockets:** round, square and hex grids, coin-cell and card slots, cone,
  round and stepped bottoms, lean 30° and 45°, grooves, thumb notches,
  magnets, graduated drill, socket and hex-key sets engraved in mm and inches;
- **tools:** traced-tool pockets with chamfer, round edge, finger notches and
  names, two-colour shadow boards;
- **labels:** raised, engraved, inlaid, small left / right / centre tabs,
  three lines, per-compartment text, icons, `{contents}`, swappable plates
  (raised, engraved, inlaid, blank), Cullenect and Pred sockets with their
  labels, front-wall labels raised, two-tone, engraved, inlaid, with a wall
  pattern and per compartment;
- **placement:** half-grid bins (magnets, lite with a lid, pockets), bins on
  partial edge cells, stretched bins;
- **vase:** vase-mode bins, sliced in spiral vase mode: 1 × 1, 2 × 1, 3 × 2
  with two dividers, 2 × 3 with three dividers across the depth and magnets,
  2 × 1 with refined slots and a 0.8 mm line, a flat 1 × 1 with a divider, a
  half-grid 3 × 2 with magnets and a 0.45 mm line;
- **baseplates:** frame, weighted, skeletonized and solid; magnets top and
  bottom with release holes, ribs, chamfers and pry slots; screws; extra floor
  and chamfer; half grid; bowtie (with keys), filament-pin, puzzle, screw-nut
  and heat-set joints over split drawers with partial cells; piece numbers;
  blocked cells filled and cut out; half-cell edge fill; TPU dots and strips;
- **enclosures:** carry cases (fold and arch handles, bumpers and printed
  feet, a lid label, split with lid keys) with lids, pins, handles and feet;
  wall grids (countersunk, keyhole with a cleat and a tall ledge); spacer
  strips (lattice with tabs, solid without);
- **testfit:** the test-fit kit with bowtie joints and magnets, puzzle joints,
  and on a half grid with pins;
- **colours** (19 more parts in 5 groups): the three ways to print in colour
  (README, "Multi-colour"): by part (red baseplate with blue keys,
  colour-coded bins, white label text, colours on plates of their own), by
  height (red feet, black walls, white lip, bins of two heights) and by
  feature (feet, floor, walls, lip, dividers, label tabs and text, a drawer
  pull, each its own volume); inlaid QR codes by part (black modules on
  white bins, a plate and a lid); vase-mode bins by height (red feet, a
  black wall, each on a spiral plate of its own).

The colour groups also write every plate as a 3MF in its colours. With
`--slice`, PrusaSlicer slices each: by part and by feature with a profile of
as many extruders as the palette has slots (`prusaslicer-mm.ini`:
single-extruder multi-material with a wipe tower, set off the plate), by
height with the one-extruder profile (a vase bin's plate in spiral vase
mode, its G-code read back as for vase/). The report's "Multi-colour plates"
table holds the tools each plate printed with, or where its colour changes
(M600) came, against what the plate asks for; on the last run every one was
as asked.

## What was found and fixed

| Defect | Where | Cause | Fix | Test |
|---|---|---|---|---|
| Chamfered magnet pockets in baseplates were cones (6.2 mm at the bottom, 8.6 at the mouth), so magnets didn't press in. | `magnetPocket` in `baseplate.ts` | One convex hull of three rings (straight, then the 45° mouth) fills the profile in. | A hull per pair of rings: a cylinder and a chamfer. | `print-fixes`: chamfered magnet pockets stay straight |
| Bowtie pockets tapered over their whole 2 mm depth (0.9 mm wider each side at the bottom), leaving 0.17 mm walls against the receptacles and loose keys. PrusaSlicer flagged all 12 bowtie pieces with "Floating bridge anchors" (2 still are, see below). | `loftConvex` in `connectors.ts` | The same hull of a flare and a straight part. | One hull per pair of neighbouring layers. Walls are now the designed 0.65 mm. | `print-fixes`: joints keep their walls |
| Puzzle sockets tapered the same way: loose tabs, 0.25 mm necks beside the receptacles. | `loftConvex` in `connectors.ts` | As above. | As above. | as above |
| Spacer-strip tab sockets in the baseplate edge tapered the same way (0.2 mm necks). | `spacerSocketCuts` in `spacers.ts` | As above. | A hull per pair of layers. | as above |
| A label tab in front of a removable divider, narrower than its compartment (left, mid, right), printed as a separate piece in mid-air, or hung off one side wall as a 37 mm ledge. Found by the printability agent too. | `tabShape` in `compartments.ts` | Tabs hang from the wall behind them; with the divider printed as a plate there is only its slot. | Such a tab spans its compartment from side wall to side wall (a bridge), or is left out when a side isn't a plain fixed wall. | `print-fixes`: a label tab in front of a removable wall |
| Knife-edge horns up to 1.2 mm tall (thinner than 0.8 mm, down to nothing) along both sides of every removable divider's slot. | `layoutCuts` in `compartments.ts` | The compartments' rounded bottoms ran into the slot's vertical side. | Trimmed back to a ledge two lines wide (`slotHornTrims`). Old projects with removable dividers change by a few mm³. | `print-fixes`: slot has no horns |
| 0.2 mm slivers the full height of a coin dispenser's window. | `buildMagazine` in `dispenser.ts` | The window stopped at the round tube's front, where the tube curves away. | The window runs back to the tube's middle. | `print-fixes`: coin dispenser window |
| A shadow board's filament-2 floor hung 7 mm over the finger notch of a deeper tool beside it. | `shadowFloors` in `shadowBoard.ts` | Floors were cleared from deeper pockets, not from their notches. | Deeper pockets' notches are taken out too (`notchCutters`, shared with `cutoutCutters`). | `print-fixes`: shadow-board floor |
| STL exports of parts with inlaid text (on a tab or the front wall) or shadow floors loaded in PrusaSlicer as "manifold = no", ~100 open edges, 0 parts. | `writeSTL` in `export/stl.ts` | Overlays touch the body face to face; STL has no topology, so slicers weld their vertices together. | Overlays are pulled in 0.002 mm: they load as closed shells, one part per body, which the slicer joins (or splits into parts for a second filament). 3MF and Bambu exports were fine and are unchanged. | `print-fixes`: STL keeps overlay bodies apart |

Every other part passed every mesh check from the start: all valid, closed
and in one piece, flat on the bed, inside the printer, and no islands.

## By design, and what is left

These are still reported, and marked as by design in `report.md`:

- **Bowtie pockets leave 0.65 mm walls** to the receptacles at their ends
  (`CONNECTOR_MIN_WALL`, README: "0.65 mm to spare on each side"). That is
  one extrusion line, for 1 mm of height under the plate.
- **Stretched bins overhang the drawer margin** from just above the
  baseplate (README): a flat ledge as wide as the stretch (up to ~20 mm) with
  nothing under it. They need supports there; PrusaSlicer says "Floating
  bridge anchors, Long bridging extrusions" too. A 45° underside would print
  without supports but take a wedge out of the bin's floor over the margin, so
  it's left for a decision; a UI warning ("print with supports under the
  overhang") would help.
- **Drawer-unit shelves bridge each bay**: 80 mm in a 2-unit-wide unit. The
  planner already warns past 60 mm and suggests more columns or supports.
- **A tab in front of a removable divider bridges its compartment**: 73 mm in
  a 2-unit bin. Better than an island; a narrower compartment shortens it.
- **Hex wall patterns** leave 0.95 mm thick webs; PrusaSlicer calls them
  "Thin fragile part". That's the Gridfinity Extended pattern.
- **Vase-mode bins have one-line walls**: they're drawn as they print, so the
  thin-wall check finds the wall (0.6 mm) and each divider's two lines.
- **Small parts have "Low bed adhesion"** in PrusaSlicer: bowtie and lid keys
  (9.7 × 2.7 × 1.8 mm), hinge pins, the narrow solid spacer strips, TPU feet.
  A brim helps.
- **PrusaSlicer's "Long bridging extrusions" and "Floating bridge anchors"**
  on weighted baseplates' pockets, keyhole slots, half-grid foot gaps, a
  box lid's hinge-pin holes, a coin dispenser's exit slot and compartments in a
  lite base: the mesh checks find no islands, ledges or long bridges there, so
  these are the slicer's heuristics on short bridges and thin anchors.
- **Zero-area facets**: Manifold's float32 output keeps a few degenerate
  triangles (about 20 per part); PrusaSlicer removes them silently
  (`degenerate_facets`, `facets_removed` in `--info`). Harmless.
- **Label text at the smallest size** (2 mm caps, `LABEL_TEXT.minCap`) has
  strokes of 0.4–0.5 mm: one line each. Raising the minimum to ~3.5 mm would
  give two-line strokes at the cost of dropping more long labels.

What the checks don't do:

- They don't check that a feature has the intended shape. The tapered magnet
  pockets passed every check; they turned up when the thin-wall check pointed
  at the bowtie pockets and the same pattern was looked for elsewhere.
- The thin-wall check skips regions under 0.4 mm² or under 1 mm tall, so the
  knife edges at the top of stacking lips and baseplate ridges (by design,
  trimmed) aren't reported, and neither is small text.
- Telling a ledge from a bridge is a heuristic (held in two places, or along
  more than half its outline).
- The sampler slices parts one by one, not whole plates, and checks one
  representative of each option rather than every combination.

## Results of the last run

On the final code (`npm run sampler -- <dir> --slice`):

| | Before the fixes | After |
|---|---|---|
| Parts | 268 | 279 (two removable-divider cases and seven vase-mode bins added) |
| Mesh errors (invalid, loose pieces, off the bed, islands, too big) | 0 | 0 |
| Parts with thin-wall warnings | 28 | 18: 12 bowtie pieces (0.65 mm) and 6 vase-mode bins (one-line walls), by design |
| Parts with overhang warnings | (not checked yet) | 6: 3 drawer units' shelves, 2 stretched bins, 1 removable-divider tab, all by design |
| PrusaSlicer: not manifold | 4 (STL with overlays) | 0; every part's shell count is 1 + its overlay bodies |
| PrusaSlicer: parts with stability notices | 47 | 37, all listed above (the half-grid vase bin's foot gaps: "Long bridging extrusions") |
| PrusaSlicer: parts with zero-area facets removed | 151 | 159 |
| Spiral vase: layers after the bottom layers that are one continuous spiral | — | all, in all 7 vase-mode bins (75–145 each); every turn the length of the outline and its slits, less the half line it runs inside |
| Findings not marked as by design | — | 0 |

Every part sliced without errors or warnings other than the stability
notices, and fits the 256 × 256 × 256 mm bed (the largest is 214.6 mm across
and 109 mm tall). Before its fix, the floating removable-divider tab the
printability agent found was reported by `checkPart` as a loose piece and an
island; the `removable-tab-*` cases now hold it.

The printability warnings in the UI could pick up from here: a stretched
bin needs supports under its overhang, and a tab in front of a removable
divider in a wide compartment is a long bridge.

## Boards and attachments

### What the sampler covers

`scripts/sampler-boards.ts`, 731 parts in 17 groups. Each sample is a board
of its own planned with `planPrint`: a board prints its tiles and board parts,
an attachment its parts and nothing of the board (planned on a bed nothing is
too big for, so the sample board is one tile with every slot).

- **boards/skadis** (86 parts): a 600 × 400 space filled (3 × 2 tiles, level
  and upright seams, tabs and joint plates where they cross) on posts, on
  spacers with plates only, with tabs and screw covers, flat on the wall with
  no joints and no numbers; hexagons filling a space; built from tiles (an L
  of rectangles, two small ones, an L of hexagons, hexagons on a square
  grid); the square pattern at 14 mm and the dense one; an 8 mm board with a
  loose fit and a 1 mm chamfer; frame rim strips, with and without the LED
  channel; zones (engraved and inlaid text, magnets, blank); a French cleat,
  door hooks, desk feet and clamps.
- **boards/opengrid** (13) and **boards/multiboard** (8): openGrid lite and
  full, corner and grid screws, chamfered corners or not, connectors (snug,
  normal, loose) and tiles of 3 squares; Multiboard plain and threaded (big
  and peg threads), grid screws, small tiles; each one's test tile.
- **attachments/…** (624 parts, one group per picker group): every
  kind at its defaults, each of its presets, each other value of each select
  and each toggle flipped (a field that shows only for another option's value:
  with it, so a battery dock's stem and body packs are sampled too); sizes
  picked by hand (long hooks, 0.8 mm walls, many dividers, wide shelves, two
  rows of drawers, stacks of tip-out bins, eight swivel trays, …); the common
  options (lock keys on every part with hooks, M3 and M4 bolts with their
  T-nuts, labels engraved, raised and inlaid, barbs); traced tools on shadow
  boards (standing up, across with two-colour shadows, kept where they were)
  and tool cradles; a model as the box that stands in for a missing mesh and
  as a real mesh, on clips and on a plate. Every extra part prints too:
  containers and drawers on rails, lids, doors, shelves, pins, diffusers,
  rods, axles, trays, saucers, caddies and fit coupons. A preset whose part is
  bigger than the bed at the kind's defaults (a cradle for a 13" tablet, a
  bottle rack of aerosol cans, …: the planner warns and leaves it out) is
  sampled with fewer columns or a shorter length, which its file name says
  (`bottle-rack-preset-aerosol-columns-3`). *Build your own*'s side-profile
  presets are in its own editor, not a preset field, so each is sampled as
  Auto picks it, on its side, and upright where its profile allows, with a
  tray of lip, dividers and end walls, a raised label and a bolt.

### What was found and fixed

| Defect | Where | Cause | Fix | Test |
|---|---|---|---|---|
| T-nut bosses beside the screw were 0.65 mm thick for an M3 and 0.1 mm for an M4 in a standard slot: the M4's don't print at all, the M3's as one line. | `tNutSolid` in `wall/mount.ts` | The boss is as wide as the slot lets it be (4.7 mm), and the screw goes through it. | Where its walls would be thinner than two lines (`TNUT_MIN_WALL`), the boss is two blocks, above and below the screw: what would print anyway, without slivers. In a wider slot it keeps its walls. | `wall-print`: T-nuts |
| Tip-out bins with Lift off: a knife edge of side wall (0.9 mm thinning to nothing over a millimetre) where the stop pin's arc slot leaves its slot down to the bin's bottom. | `tiltBinSolid` in `kinds/tiltBin.geom.ts` | Two slots as wide as each other part from one circle at an angle. | The wall between them is taken off as far as it's under 1 mm thick (a hull of the first few millimetres of both): they meet cleanly. | `wall-print`: tip-out bin with lift off (30°, 45°, 60°) |
| Wall bins: the sides' slope ran on across the front wall, so its top tapered to an edge: on a tall bin with a low front its top 1 mm was thinner than a line (0.8 mm of it at the defaults). | `binBuilder` in `kinds/bin.geom.ts` | The slope's line reached the outside of the front. | The slope ends at the front wall's inside; the front's top is flat at its height. | `wall-print`: wall bin |

Every board part passed every mesh check from the start; so did every
attachment but these and the ones below, and every attachment put together
as it sits (114 with extra parts) has no two pieces running into each other.

### By design, and what is left

- **A Multipoint receiver's heads** have a 0.4 mm rim, as the system has it:
  its top is one line.
- **A magnetic bar with the magnets under a skin** (Fix: Skin) has a 0.5 mm
  skin over each pocket, an option from 0.3 to 1 mm: thinner pulls harder.
  The print pauses to drop the magnets in (its note says where).
- **Build your own on its side** (picked, or a profile that can't print
  upright): its end walls, gussets and dividers bridge over the open profile,
  and its note says so. Forced upright, the L-bracket stands on its plate's
  edge and may tip: Auto prints it on its side for that reason.
- **Tall shadow boards** (a board as tall as its tools, 200–230 mm) print
  upright on their 5 mm edge: a brim helps.
- **"Low bed adhesion"** in PrusaSlicer: small parts (lock keys, pins, fit-test
  tabs, label tags) and parts printed upright on a narrow foot (a fold-away
  hook, a swivel tower's frame, cups open at the bottom). A brim helps.
- **Faces past 45°** in attachments: an LED bar aimed 60° down (its note says
  so: a good fan, or aim it 45°); the undersides of a Raspberry Pi plate's
  ⌀6 standoffs, 5 mm out from the plate; the tops of round holes lying down
  (a GoPro mount's ⌀5.3 bolt hole, a tip-out bin's ⌀4.6 pivots); a webcam
  mount's hex pocket, its roof tilted 15° with the platform; a desk clamp's
  M6 nut pocket standing on a corner (60° faces, 3 mm high). In the earlier
  parts: Gridfinity label tabs' undersides (54°) and the hex wall pattern's
  holes standing on a point (60°).
- **PrusaSlicer on boards**: "Long bridging extrusions" on the tiles with
  zones and "Floating bridge anchors" on an openGrid tile, its heuristics on
  short bridges (no ledge, bridge or island in the mesh checks); the threaded
  Multiboard tile is "4 parts": the threads leave thousands of zero-area
  facets in float32, which PrusaSlicer removes, and it counts the few
  zero-volume scraps left as shells.
- **PrusaSlicer on attachments**: "Long bridging extrusions" on an LED bar's
  diffuser, whose hooks stand 1 mm out along its whole length (their flat
  faces, the ones that hold it, are 1 mm ledges as it prints face down: the
  mesh checks allow 3 mm; a chamfer there would weaken the snap, so it's left
  as it is), on drawer housings' roofs over their open fronts (a drawer
  wide), on the pocket of a 60 mm block magnet, on Gridfinity wall plates
  standing up (the receptacles' profile bridges each 42 mm cell) and on the
  racks' hollow floors (10 mm at most); "Collapsing overhang" on Multiconnect
  and Multipoint receivers, whose heads' rims (1 mm and 0.4 mm, the systems'
  own) stand out round their 45° flares: not changed, the heads are the
  systems' profile and their undersides are already cut at 45°. A few
  display ledges are "3–5 parts": zero-area scraps, as the threaded
  Multiboard tile's.
- **Shadow boards with overlapping tools** (Arrange: as in the file, tools on
  top of each other: the planner says so and asks to space them out) leave a
  0.1 mm closed void under a tool's engraved name where another tool's peg or
  ledge covers it, which the mesh checks report as a loose piece of negative
  volume. Not fixed: it only happens with tools overlapping, which is to be
  fixed in the layout, and the void is closed inside the plate. The sampler
  keeps its tools apart.
- **Presets bigger than the bed** at the kind's defaults (bottle racks of
  spice jars and aerosols, cradles for a Steam Deck, Switch or tablet, box
  sleeves for glove and tissue boxes, the widest roll holders, display
  ledges in bases, cars and steps mode): the planner warns and leaves them
  out until they're narrowed; the sampler narrows them.
- **Not checked**: that a part does what it's for (the kinds' own tests
  check fits), and every combination of options (one of each).

### Results of the last run

On the final code (`npm run sampler -- <dir> --only boards/ --slice`, and
`--only attachments/`; the whole run checks 1042 parts):

| | Boards | Attachments |
|---|---|---|
| Parts | 107 | 624 (114 with extra parts put together) |
| Mesh errors (invalid, loose pieces, off the bed, islands, too big) | 0 | 0 (1 before: the overlapping shadow-board tools above, now laid out apart) |
| Parts with thin-wall warnings | 0 | 2, by design (a magnet skin, Multipoint rims); 7 before the fixes (those two, three T-nuts, a tip-out bin, a wall bin) |
| Parts with overhang warnings | 0 | 0 |
| Parts with first-layer warnings | 0 | 3 tall shadow boards (a brim helps) |
| Assembled: pieces that run into each other | — | 0 |
| Parts with faces past 45° (for a look) | 2 (a desk clamp's nut pocket) | 13 (above) |
| PrusaSlicer: failed, not manifold | 0 | 0 |
| PrusaSlicer: shells other than 1 + overlay bodies | 1 (zero-area scraps) | 4 (display ledges: zero-area scraps) |
| PrusaSlicer: stability notices | 3 parts: 2 "Long bridging extrusions" (zones), 1 "Floating bridge anchors" | 175 "Low bed adhesion", 20 "Long bridging extrusions" (LED diffusers' hooks, drawer housings, a 60 mm block magnet's pocket, Gridfinity wall plates, racks' hollow floors, a planter), 8 "Floating bridge anchors", 3 "Collapsing overhang" (receivers' rims) |
| Findings not marked as by design | 0 | 0 |

Every part sliced without errors, and fits the 256 × 256 × 256 mm bed (the
largest attachment 235 mm across, the tallest 242 mm). Slicing took 29
minutes for the boards' 107 parts and 52 for the attachments', on a machine
shared with other work.
