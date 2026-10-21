# Print check

A hardening pass on the printed geometry: every kind of part Gridfit makes was
built through the app's own code, checked for things that print badly, and
sliced with PrusaSlicer. This page says what is checked, how to run it again,
what it found and fixed, and what is left.

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

## Running it

```bash
npm run sampler -- out/sampler            # build and check every part (about 2½ minutes)
npm run sampler -- out/sampler --slice    # and slice each with PrusaSlicer (8–10 minutes more with --jobs 3)
npm run sampler -- out/sampler --only labels/        # just the parts whose path has this in it
npm run sampler -- --report out/sampler/report.json  # write report.md again from a run
PRUSA_SLICER=/path/to/prusa-slicer npm run sampler -- out/sampler --slice
```

Each part is written as its own binary STL (`<group>/<sample>.<part>.stl`,
overlays included as the app's STL export writes them) and each baseplate
plate as a 3MF. `report.md` lists errors, warnings and PrusaSlicer findings,
marking the ones that are there by design (`KNOWN_FINDINGS` in
`scripts/sampler-cases.ts`) so whatever is left stands out, then every part
with its size, triangles and first-layer area. `report.json` has it all. The
run fails when a part has an error.

The tests run the checks on synthetic shapes and on a representative part of
each family (`tests/printcheck.test.ts`, about 15 seconds), and hold every fix
below (`tests/print-fixes.test.ts`).

## What the sampler covers

`scripts/sampler-cases.ts`, 279 parts in 16 groups, each planned like a real
job (`planPrint`, `planTestFit`) and built with `buildMesh`:

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
- **colours** (12 more parts in 3 groups): the three ways to print in colour
  (README, "Multi-colour"): by part (red baseplate with blue keys,
  colour-coded bins, white label text, colours on plates of their own), by
  height (red feet, black walls, white lip, bins of two heights) and by
  feature (feet, floor, walls, lip, dividers, label tabs and text, a drawer
  pull, each its own volume).

The colour groups also write every plate as a 3MF in its colours. With
`--slice`, PrusaSlicer slices each: by part and by feature with a profile of
as many extruders as the palette has slots (`prusaslicer-mm.ini`:
single-extruder multi-material with a wipe tower, set off the plate), by
height with the one-extruder profile. The report's "Multi-colour plates"
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
