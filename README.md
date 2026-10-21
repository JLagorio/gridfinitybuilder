# Gridfit

A Gridfinity generator that works from your **drawer size**. It builds a baseplate that fills the drawer, splits it into pieces that fit your **printer's bed**, lays everything out on print plates, and lets you design the **bins** that go in it. Everything exports as 3MF, including a ready-to-slice **Bambu Studio project** with every plate set up.

It runs entirely in your browser; geometry is built locally with [Manifold](https://github.com/elalish/manifold) (WASM).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5199.

## Workflow

A project holds **all your drawers**. Switch between them, add, duplicate, rename or delete them from the drawer menu in the top bar. Each drawer has its own size, baseplate settings and bins; print one, all, or a chosen set at once.

Lengths are stored in mm. The **mm / in** switch in the top bar changes what every length field shows and accepts. Inches show as fractions (1/8 to 1/32, or decimals), and you can type `20 1/8`, `20-1/8"`, `1' 8 1/8"`, `44.5mm` or `51cm` in either mode.

**The side panels** (Drawer, Bins, Print) each start with two things:

- **Find a setting:** type what you're after and the panel shows only the matching settings, with the groups they're in opened. It knows other words for them too: *magnet*, *screw*, *lip*, *label*, *scoop*, *pocket*, *divider*, *wall*, *lid*, *feet*, *stack*, *nozzle*, *reprint*… Esc or × puts the panel back as it was. When the setting isn't there for this bin, it says when it is (*Stretch into the gap shows when one bin is selected…*).
- **Basic / All:** Basic shows the settings most bins and drawers need, plus anything you've set away from its default; All shows every setting. A line at the end of a section names what Basic leaves out. The choice is remembered in this browser (not in the project).

Folding groups say what's set in them, start open when anything in them isn't the default, and carry a dot while folded.

1. **Drawer & baseplate.**
   - **Drawer:**
     - **Size:** enter the inside width and depth. Drawers are rarely square, so add width or depth measurements taken at other spots; the smallest is used.
     - **Inside height** (optional): shows the tallest bin that fits and warns about bins that don't.
     - Gridfit fits as many 42 mm cells as possible, then places the grid left/center/right and front/center/back.
   - **Leftover space** around the grid can stay solid plastic, or become a row of **half (21 mm) cells**, **partial cells** that use the whole gap, or separate **spacer strips** (lattice or solid, split to the bed with dovetails, tabbed into the plate's edge). Bins drawn on partial cells get feet sized to each cell. Push the grid to one side to turn two thin gaps into one useful row.
   - **Drawer, case or wall:** the grid can also be the floor of a **carry case**, or a **wall grid**.
     - **Carry case:** walls sized to the tallest bin, a lid on snap-pin hinges, flexing latches, a fold-down or fixed handle, and feet. It splits into bed-sized pieces like a baseplate. The 3D view shows it with the lid closed, open or off.
     - **Wall grid:** countersunk holes or keyhole slots every few cells, an optional French cleat (with a printed wall cleat) and a ledge along the bottom. Bins stay on with magnets in both the bins and the plate.
   - **Half grid** (21 mm): the baseplate gets 21 mm receptacles and every bin stands on 21 mm half feet, so bins come in half units (1.5 × 2.5 u) and sit at any half-cell offset. Sizes still show in 42 mm units. Turning it on or off converts the drawer's bins in one undo step. Magnet holes go in the corners of each 42 mm unit, as in Gridfinity Extended.
   - **Blocked cells:** open *Blocked cells* under Grid and click or drag on the cell map to mark cells where slide hardware or a bump gets in the way. They get no receptacle (filled flat, or cut out of the plate) and bins can't go there.
   - The **Grid** section holds the leftover space and blocked cells, and in All settings the grid's position, the fit clearance and the half grid.
   - **Baseplate options:**
     - **Style:** open frame (least filament), weighted (gridfinity-rebuilt weight pockets), skeletonized, or solid floor.
     - **Magnet pockets:** top- or bottom-loaded, push-out holes, crush ribs, chamfered mouth, pry slot.
     - Countersunk screw holes, extra floor, outer corner radius, top-ridge trim, bottom chamfer.
     - **Joints between split pieces:**
       - bowtie keys: pockets underneath, plus one printed key per pocket
       - filament pins: 1.75 mm teardrop holes across each seam
       - puzzle tabs: jigsaw tabs built into the piece edges
       - M3 screws: across the seam, with a nut slot or a heat-set insert hole
       - Bowtie keys print next to the pieces. Lay the pieces upside down, press the keys in, then turn the baseplate over.
     - **Piece numbers** debossed underneath, mirrored so they read with the piece upside down. They match the assembly map.
2. **Bins.**
   - **Layout:**
     - Drag across empty cells to draw a bin, click to select it, drag to move it, press Delete to remove it.
     - Shift- or ⌘/Ctrl-click bins, or Shift-drag a box (or drag from outside the grid), to select several.
     - Drag a selection, nudge it with the arrow keys, copy and paste it (⌘C / ⌘V pastes at the cell under the pointer), duplicate it (⌘D) or delete it.
     - Drag the handles of a selected bin to resize it.
     - **Bins always fit your printer.** Drawing, resizing, the size and height fields, stretching, templates, "Make a bin" and "Fill from a list" all stop at what the bed takes (inside the edge margin, either way round) and at the printer's height. A container's own parts (a drawer unit's drawers, a box lid) count too. With two or more printers, a bin can be as big as the biggest one takes, and each of its parts only has to fit one of them; the messages name the printer that comes closest. After switching to a smaller printer (or removing the big one), bins that no longer fit turn red, aren't printed, and get a **Shrink to fit** button.
     - "Fill empty with 1×1" fills the rest of the drawer; "Fill from a list…" proposes bins for what you want to store (see below).
     - **Stretch into the gap:** a bin on the edge of the grid can reach over the solid margin to the drawer wall (Auto, or mm per side). Its feet stay on the grid. The stretched part starts just above the baseplate.
     - **Stack bins** for a second layer in a deep drawer, as many levels high as fits:
       - Select a bin and press **Stack a bin on this**. The new bin takes its footprint and the new-bin settings, as tall as the bin below or as tall as still fits the drawer and the printer.
       - The bin below needs a stacking lip, a stacking lid (not a pocket-grid one), or a drawer unit or parts box with a lip or bin sockets on top. Not a bin stretched over the margin, and not on a wall grid.
       - The grid shows one level at a time (**Floor / Level 2 / …**); a **+1** badge marks a bin with bins on it. Picking a bin in the 3D view, the Stacking list or Find shows its level.
       - A stack moves and resizes as one, from any level. Copying, cutting or deleting a bin takes the bins on top of it along. **Move to the floor** takes a stacked bin (and what's on it) off to a free spot.
       - A bin sinks 4.35 mm into the lip below, or 4 mm into a lid's or a drawer unit's sockets. With the drawer's inside height set, Gridfit warns about stacks that don't fit under it.
       - Stacked bins print like any other. The drawer map gets a page per level, and the contents list and Find give the level (`B3 · level 2`).
   - **Type:** a plain **bin**, or one of these containers, each on the same Gridfinity feet:
     - **Drawer unit:** a small chest of 1–8 pull-out drawers in up to 4 columns, with notch, tab, knob or recessed pulls, drawer stops, compartments and labels on the drawer fronts. The top can be flat, have a stacking lip, or have receptacles for bins.
     - **Parts box:** a snap-on hinged lid, a snap latch or magnets, compartments with scoops, and a label on the lid.
     - **Hopper bin:** an open front with a sloped floor, a front lip with a label slot, and dividers.
     - **Tool rack:** holes for screwdrivers, hex keys and files; slots for pliers; stepped slots for wrenches. Sizes come from presets or a typed list, with optional engraving and lean.
     - **Dispenser:** a gravity-fed magazine for batteries (AA to D, 18650, 21700), a coin-cell stack, a tape-roll holder or a zip-tie channel.
   - **Each bin has:**
     - height in 7 mm units, or as an inside depth or overall height in mm
     - **inside:** compartments, a pocket grid, or tool cutouts (see below)
     - finger scoop and label tab (full, left, mid, right), with **label text** (see below)
     - **base & holes:**
       - base: standard, lite (hollow feet, gridfinity-rebuilt "lite"), efficient floor (Gridfinity Extended) or flat (no feet)
       - holes: magnets or screws, or Gridfinity Refined side-loaded magnet slots
       - optional crush ribs, chamfered mouths, printable hole tops (no supports) and corner-only holes
     - **lip & lid:**
       - stacking lip: normal, reduced or none, with optional anti-slide notches
       - optional stacking lid, printed as its own part; its top can be a **pocket grid** instead of receptacles
     - **walls:** cutouts, finger slides and a hex wall pattern, per wall; rounded inside corners
     - **trays, lids & rails:**
       - **lift-out trays** (up to 3, stacked) on printed ledges, each with its own compartments and lift tabs
       - a **sliding lid** for bins without a stacking lip, with a click detent and optional engraved text
       - **divider rails:** guide ribs every few mm on opposite walls, so loose divider plates slide in anywhere
       - trays, the lid and the plates print as their own parts
     - **inserts:** a **lift-out cup** in every compartment (or chosen ones) to pour parts out, or a **drop-in grid**; both print separately and show in place
     - **two-colour shadow boards:** tool pockets get a thin floor in filament 2, so a missing tool stands out
     - **What's in it:** a list of what the bin holds, per bin or per compartment. It's for finding things and for the drawer map, and doesn't change the print.

     The panel goes in that order: the bin (type, size, height), **Inside** (compartments, pocket grid or tool cutouts, with the compartment tools), **Scoop & label**, **Options** (base & holes, lip & lid, walls, trays, cups), **What's in it**, stacking and stretching, then **This bin** (duplicate, delete, download it on its own). With nothing selected, the drawer's **Layout** (draw, fill, clear) comes first and the settings are for new bins.
   - **Start from** a preset: *Screws & small parts* (three compartments with scoops and labels), *Batteries* (an AA pocket grid, tall enough), *Deep bin* (one tall compartment, as tall as the drawer allows), *Tool tray* (low, a long slot and two compartments) or *Label everything* (label tabs, or a front label, with the text from *What's in it*). One click sets the selected bins, or new bins when none is selected, as one undo step. A preset only sets what it's about: the size, base, holes and lip stay, and a bin too tall for the printer is made smaller to fit.
   - **Templates** save a bin's settings by name. Apply one to the selected bins or to new bins, in any drawer.

   **Compartments.**
   - Select a bin and switch the left pane to *Compartments*. Hover inside the bin to see the wall a click would add. It runs wall to wall and snaps to 50 %, thirds and quarters of the space it splits (and of the whole bin), to other walls and to the 42 mm cell seams.
   - Keys while placing:
     - Shift flips the wall's direction.
     - R locks the direction.
     - Alt turns snapping off (1 mm or 1/16″ steps).
   - Editing walls:
     - Drag walls to move them.
     - Drag a selected wall's end handles to attach it to a different wall (for L-shaped compartments).
     - Click a size to type it (`44.5`, `1 3/4in`).
     - Walls placed by snapping stay proportional when the bin or a neighbour changes; typed sizes stay fixed.
   - The sidebar has presets and splits a compartment into equal parts, by ratio (`1:2:1`) or by minimum size. It also sets:
     - **each wall's height:** lowered so fingers reach over, or removable (a slide-in plate in slots that prints with the bins)
     - **each wall's top:** flat, chamfered or rounded, with optional U-shaped **finger notches**
     - **each compartment's** scoop, label tab, label text and floor height
     - **each compartment's inside:** open, a **pocket grid** of its own, **tool cutouts** (the bin's tools are cut only inside it), or solid
     - **each compartment's floor:** flat, a **ramp**, or 2–6 **steps** rising toward any side
   - **Diagonal / curved walls** (D): drag from point to point. They snap to corners, wall ends and midpoints, and to 25/50/75 % of a wall; drag the middle handle to bend a wall into an arc. They don't split compartments (scoops, tabs and compartment options ignore them).
   - **Mirror, rotate, copy:** mirror or rotate a layout, or copy it onto other bins in any drawer ("Copy to…", or ⌘C / ⌘V in the editor). Proportional walls adapt to the new size.

   **Pocket grids** fill the bin (or one compartment) and cut as many pockets as fit:
   - **55 presets:**
     - batteries (AA to D, 9V, 18650, 21700, CR123A, coin cells)
     - cards and cartridges (SD, microSD, CFexpress, SIM, USB sticks, Switch and Game Boy cartridges)
     - hex and power bits, router bits, M2–M8 screws
     - hobby paints, markers, pens, printer nozzles, test tubes, coins
   - **Graduated sets:** drill indexes (1–10 or 1–13 mm, 1/16–1/2″ by 1/64), ¼″ and ⅜″ socket sets, hex keys. Each pocket is sized to its item, with the size engraved in front of it. A custom list of sizes in mm or inches works too.
   - **Fit an item:** type the item's size and height; the pocket gets clearance and a depth of 2/3 its height.
   - **Pocket options:**
     - bottoms: flat, round, 118° cone, or stepped (a narrower bore for a collar)
     - **lean** up to 45° toward you
     - finger access: a **groove** along each row, or a **thumb notch** per pocket
     - a **magnet** recess under each pocket

   **Tool cutouts.** Make a shadow-board pocket for a tool:
   - **Trace it from a photo:**
     - Lay the tool on a sheet of Letter or A4 paper and take a photo from above.
     - Mark (or let Gridfit find) the paper's corners.
     - Adjust the threshold, simplify and smooth sliders.
     - Name the tool and give its thickness.
   - Or import an **SVG or DXF** outline.
   - Tools go into a library shared by every drawer. Switch the left pane to *Tool cutouts* and drag tools into the bin:
     - It snaps to centre lines, edges and other tools.
     - R rotates 15°.
     - Double-click the outline to add a finger notch.
     - Each pocket gets clearance, an optional chamfer and an optional engraved name.
   - **Make a bin** sizes a bin for the selected tools and places it in the drawer.

   **Labels.** Type label text for a bin, or per compartment. It shrinks to fit each tab, up to 3 lines, and can be:
   - **raised**, or **engraved** into the tab
   - **inlaid**: engraved and filled flush in a second filament. The Bambu project gets a second filament for it; pick its colour in *Print plates*. Needs an AMS or a filament change.
   - on **swappable label plates**: the tab gets a shallow recess with a pry notch, and small text plates print with the bins and press in, so you can relabel later. The drawer view shows them in place.
   - in **Cullenect** or **Pred** sockets, so community snap-in labels fit; Gridfit can print matching labels with your text.
   - **Icons:** type `{bolt:12}`, `{screw:socket}`, `{nut}`, `{washer}`, `{insert}`, `{battery}`, `{|}` and 15 more, like gflabel, or pick them from the Icons menu. The preview shows the real label.
   - **From What's in it:** `{contents}` (or `{contents:2}`) puts the bin's or compartment's first contents lines on the label.
   - **Front-wall labels** go on the outside of the front wall: raised, two-tone, engraved or inlaid, one per front compartment.

   **Fill from a list.** Type what you want to store, one item per line (`200 M3 screws`, `12 AA batteries`, `SD cards x8`, `hex keys 1.5–10 mm`, `calipers`), and Gridfit proposes bins for it and lays them out in the drawer:
   - **The list:** counts like `200`, `x8`, `8x`, `8 pcs` or `a dozen`; ranges like `1.5-10 mm` or `1/16–1/2in`; sizes like `M3`, `M3x12`, `AA`, `18650` or `100x60x20mm`. A line Gridfit doesn't know still gets a bin (`misc small parts` gets one with two compartments).
   - **What each item gets:**
     - a tool in your tool library with that name: tool cutouts, sized like *Make a bin*
     - drill bits, hex keys, sockets: a graduated set, cut to the range you typed
     - batteries, cards, bits, markers, paints, coins: a pocket grid from the presets
     - coin cells, zip ties, a roll of tape: a dispenser
     - screws, nuts, washers and other loose parts: a compartment with a scoop, sized from a rough volume per part and the count (filled to 80 %)
     - calipers, pliers, scissors and other things that lie flat: a bin of their typical size (trace yours for a cutout)
   - **Group small items** (on by default): small parts that go together share a bin, a compartment each, sized by volume. M3 screws, nuts and washers go in one bin; resistors and LEDs in another.
   - **Packing:** bins go on free cells, around blocked cells and the bins already there (or in their place, with *Replace the bins in this drawer*), on whole cells and whole units where they can, related bins side by side, biggest first. Every bin fits the printer. With the drawer's inside height set, bins stay low enough, and long things like markers lie flat.
   - **Review:** the preview shows the layout. Each bin says what it holds and why; change its size or leave it out. What has no room is listed, and can go in a new drawer like this one. **Add bins** puts everything in as one undo step, each bin labelled and with its *What's in it* filled from the list. The list stays with the drawer for next time.

   **3D view.** Orbit all the way under the model, or jump to Iso / Top / Front / Side / Under. The tool bar adds:
   - **Section (C):** a cut along X, Y or Z, with the cut faces filled in
   - **Measure (M):** click two points; it snaps to corners and shows ΔX / ΔY / ΔZ
   - **X-ray (X):** see-through models
   - **Lift (L):** float the bins above the baseplate to see their feet; stacked bins lift apart level by level

   **Find (⌘/Ctrl+K or /)** searches every drawer: what's in the bins, labels, compartment labels, tool names. Pick a result to jump to its drawer and bin.

3. **Print plates.** The panel goes: the printers, print checks, the exports, the plates, then the baseplate split, bill of materials, test-fit kit, drawer map and the project file.
   - **Printer:** pick it. The Bambu Lab P2S is the default, and bed sizes come from Bambu Studio's own profiles.
   - **Nozzle:** 0.4 mm unless you pick 0.2, 0.6 or 0.8. The print checks measure walls, text and fits against it (Bambu projects stay set up for the 0.4 mm nozzle; pick yours in Bambu Studio).
   - **Print checks:** before the exports, a list of what won't print well in everything being printed, from the settings alone:
     - **likely to fail:** label text that doesn't fit its tab (and is left off) or has strokes thinner than the nozzle, a label tab left off because it sits against a removable divider with a removable side wall too, drawers with too little play, very tall bins on a small base, a stretched body far over the margin
     - **prints, but worse:** raised text under 3 mm, walls between pockets, hex struts, grid inserts and drawer walls under two nozzle lines, big hex holes, magnet + screw holes without printable tops, compartments too narrow and deep to reach into, wide bridges (including a label tab spanning a wide compartment in front of a removable divider), an untrimmed baseplate ridge, and fits that are tight for a big nozzle (divider slots, the sliding lid's click, hinges, puzzle tabs and keys)
     - Most have a one-click fix ("Make them 1.2 mm", "Turn on printable hole tops"). Click a bin's name to select it, switching drawer if needed.
     - The selected bin shows its own checks above its settings, and bins with any get a small dot on the bin grid (yellow: likely to fail; blue: a tip).
   - **Two or more printers:** **Add a printer** for a big one and a small one, or two of the same. Each has its own model, bed, edge margin and height (and power draw for the cost), and can be removed again.
     - **Baseplate prints on** the biggest printer, split for its bed, or on the printer you pick, split for that one. Left to the biggest, a baseplate plate can still go to another printer that takes it.
     - Everything else is shared out so the whole job is done soonest: Gridfit balances each printer's estimated print time (the sliced estimate once the parts are sliced, a quick guess from their size before). A part that only one printer takes goes to that printer.
     - Plates are listed printer by printer, and each plate says which printer it's for.
   - **Split and pack:** Gridfit splits each baseplate on cell boundaries, so every receptacle stays whole. Each drawer's baseplate gets its own plates (named after the drawer). Bins, lids, removable dividers and label plates from every printed drawer share plates.
   - **Reprint only what changed:** for a big project printed over weeks, then tweaked.
     - **Mark as printed** on a plate (or **Mark all as printed**) records what came off the printer. Printed plates get a tick, and so do printed bins in the bin layout; a bin changed since it was printed gets a dot.
     - Parts are known by their geometry, counted per print: three identical bins are three prints of the same part, so any of them stands in for another. Moving a bin to another cell (of the same size) isn't a change; resizing it or changing its options is. Each drawer keeps its own prints: printing a drawer on its own never leaves out a bin because another drawer has an identical one.
     - **Only what's changed** leaves out what's printed already and packs the rest onto fresh plates. It says how many parts it leaves out ("14 parts already printed are left out").
     - **Forget printed** clears the record. The record is saved with the project, in project files and in share links, and marking is undoable.
   - **Exports:**
     - **Bambu Studio project (.3mf):** every plate in one file, with the printer, *0.20mm Standard* process and *PLA Basic* filament preselected (plus a second filament for inlaid labels). Open it and press **Slice all plates**. With several printers there is one project per printer, each with its own plates and settings.
     - **Plates as 3MF (.zip):** one plain 3MF per plate for any slicer, plus an assembly map per drawer showing which piece goes where (and, with several printers, on which printer's plate). With several printers, each printer's plates are in a folder of their own.
     - **Plates as STL (.zip):** one binary STL per plate, parts already arranged, in a folder per printer when there are several.
     - **STEP** for CAD (Fusion 360, FreeCAD, Onshape): the selected bin, one plate, all plates (.zip), or each drawer assembled. Flat areas become single faces.
     - Any single plate or bin, as 3MF or STL.
     - **Test-fit kit:** a small baseplate sample with your joints and magnets, plus one 1 × 1 bin, on one plate. Use it to check the fit before printing everything.
     - **Save / Open project** as a `.gridfit.json` file; it also autosaves in the browser. **Copy share link** puts the whole project, compressed, in the link itself (nothing is uploaded).
   - **Bill of materials:**
     - Counts magnets, screws, nuts or inserts, filament pins, connector keys, parts and plates. Partial and blocked cells get no holes.
     - Estimates filament per plate from the same sliced layers as the print time (Bambu's 0.20 mm Standard: 2 walls, 5 top and 3 bottom layers, 15 % infill) for 1.75 mm PLA at 1.24 g/cm³. Expect ±10 %. Until a plate's parts are sliced it shows a quicker guess from the part surfaces, which runs high on tall bins.
     - **Print time** per plate and in total for the selected printer, from a slice of each part at 0.20 mm (checked against a slicer; expect ±25 %).
     - With several printers: each plate timed on its own printer, time, filament and cost per printer and in total, and **All done in**: when the slowest printer finishes, since they print at the same time.
     - **Cost** from your filament price per kg (a second price for two-colour parts) and, optionally, electricity.
     - TPU non-slip pads (an option under Baseplate) print on their own plate.
     - Downloads as CSV or text.
   - **Drawer map & contents:** a printable top view of a drawer (or all of them) with each bin's label and contents, fit to a page or at actual size across several pages, or as an SVG; stacked bins get a map per level. Also a contents list of every bin, and a CSV of it.

Every change to the project can be undone (⌘/Ctrl+Z, redo with ⇧⌘Z or Ctrl+Y). Press **?** for all keyboard shortcuts.

### Phone, tablet and offline

- **Touch:** every editor works with a finger.
  - Drag to draw, move and resize bins; handles get bigger on touch screens.
  - Tap to add a compartment wall, then drag it into place.
  - Drag tools in the bin, and the trace dialog's paper corners.
  - Double-tap where a mouse double-clicks (finger notches).
- **No keyboard:** buttons stand in for the keys.
  - The drawer layout has **Select several** (Shift), **Duplicate** and **Delete**.
  - The compartment editor has **Flip** (Shift) and **No snap** (Alt).
- **3D view:** drag to orbit, pinch to zoom, drag with two fingers to pan.
- **On a phone** a tab bar at the bottom switches between Drawer, Bins, 3D and Print. 3D shows the step you're on, full screen.
- **Install it:** use your browser's *Install app* or *Add to Home Screen*.
- **Offline:** after the first visit Gridfit opens and works without a connection: layouts, meshes, exports and printer settings. Share links open offline too.
- **Updates:** when a new version is out, a note says *A new version is ready*. **Reload** switches to it, and the project stays (it autosaves).

### Split strategies

- **Fewest plates** (default): tries every split that uses the minimum number of pieces and keeps the one needing the fewest print plates. Small pieces share a plate when they fit. For a 510.5 × 376.5 mm drawer on a P2S (256 mm bed, 10 mm edge margin) it needs 4 baseplate plates, against 6 when every piece prints alone.
- **Even pieces**: the same number of pieces, sized as evenly as possible.
- **Biggest pieces**: full-size pieces first, with leftovers at the end.

## Dimensions

The dimensions follow the community spec (gridfinity.xyz) as implemented by [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad):

- **Grid:** 42 mm pitch, 7 mm height units.
- **Bin base:** 41.5 mm per unit, 0.8 / 1.8 / 2.15 mm profile, top of floor at 7 mm.
- **Walls and dividers:** 0.95 mm walls, 1.2 mm dividers.
- **Stacking lip:** 0.7 / 1.8 / 1.9 mm, its top trimmed 0.4 mm. A stacked bin's feet sink 4.75 − 0.4 = 4.35 mm into it (the 45° faces meet 0.35 mm under the lip's start); sockets with a floor (a stacking lid's) stop them 4 mm down.
- **Baseplate:** 0.7 / 1.8 / 2.15 mm receptacle with 0.35 mm bottom clearance (5 mm spec height). The top ridge is trimmed 0.4 mm by default so it prints cleanly.
- **Magnet holes:** 6.5 × 2.4 mm, 13 mm from the cell center. Crush ribs 5.9 mm inside, 8 ribs; refined slots 5.86 × 1.9 mm, 0.4 mm above the bed; printable tops bridge in 0.2 mm layers (all from gridfinity-rebuilt).
- **Bowtie connectors:** 10 mm long, 3 mm wide at the ends and 1.6 mm at the neck, 2 mm deep, with a 0.4 mm flare at the mouth. Keys are 0.15 mm smaller per side and 1.8 mm thick. A 3 mm pocket fits the 4.3 mm wall with 0.65 mm to spare on each side.

All constants live in `src/lib/geometry/spec.ts`.

## Development

```bash
npm test             # vitest: layout, splitting, packing, every geometry variant's validity, dividers, tracing, 3MF/STL structure
npm run typecheck
npm run build
npm run sample -- out   # build a whole drawer kit from the CLI (default: the 510.5 × 376.5 drawer)
npm run sampler -- out/sampler --slice   # every kind of part as STL, print-checked and sliced (docs/print-check.md)
```

To check an export against Bambu Studio itself, use the CLI that ships with the app. It loads the project, slices every plate, and writes a G-code file for each:

```bash
/Applications/BambuStudio.app/Contents/MacOS/BambuStudio --slice 0 --outputdir out/sliced out/drawer-bambu-project.3mf
```

### Bambu printer settings

`public/bambu/<printer>.json` holds the `project_settings.config` embedded in Bambu exports. The files are generated from your installed Bambu Studio's system presets, with inheritance and include templates flattened. Bambu Studio's CLI then fills in the remaining defaults. To regenerate them after a Bambu Studio update:

```bash
npx tsx scripts/build-bambu-settings.ts
```

### Layout

```
src/lib/geometry/   spec constants, shape helpers, baseplate + bin generators (Manifold), label text
                    (a small TrueType reader; Roboto Condensed Bold, OFL, ships in public/fonts)
src/lib/layout/     drawer → grid fit, bed splitting, plate packing; fleet.ts several printers and sharing parts out
src/lib/dividers/   bin interior layouts: walls → compartments, edits, snapping (pure TS)
src/lib/trace/      photo → tool outline (perspective, threshold, contours) and SVG/DXF import (pure TS)
src/lib/autofill/   "Fill from a list": list parser, item matching, bin sizing, grouping, packing (pure TS)
src/lib/geometry/containers/  drawer units, parts boxes, hoppers, tool racks, dispensers (a registry of container types)
src/lib/export/     plain 3MF, Bambu Studio project, binary STL and STEP writers; estimate.ts print time and cost
src/lib/project.ts  ties it together: planJob() / planPrint() for several drawers (cheap, no geometry) + exporters
src/lib/bom.ts      bill of materials; testfit.ts the test-fit kit; share.ts share links; inventory.ts contents and search;
                    printed.ts what's been printed (part fingerprints), for reprinting only what changed
src/lib/printability.ts  print checks: rule-based warnings from the options and the nozzle (cheap, no geometry)
src/lib/panelSearch.ts   "Find a setting" in the side panels: a keyword search over each panel's index (components/panelIndex.ts)
src/lib/templates.ts     bin templates and the built-in presets ("Start from")
src/lib/stacking.ts bins stacked on bins: columns, rules, heights
src/state/          zustand store, undo history (history.ts), multi-bin selection, templates and presets, the panels' Basic / All view
src/worker/         geometry Web Worker + client with a mesh queue/cache
src/components/     React UI (three.js viewer, 2D bin layout editor, panels; touch.tsx: touch helpers)
src/pwa/            offline use: the service worker and its registration
scripts/            CLI sample generator, Bambu settings baker, pwa.ts (writes dist/sw.js with every built file)
tests/              vitest suites
```

## Credits

Gridfinity was created by [Zack Freedman](https://www.youtube.com/c/ZackFreedman). The dimensions come from gridfinity-rebuilt-openscad (MIT). Several options follow other community projects: Gridfinity Extended (lip styles, efficient floor, wall cutouts, pocket grids, half-pitch grids), Gridfinity Refined (side-loaded magnets), GridFlock (pin and puzzle joints), cq-gridfinity, and Tracefinity (tool tracing). The label font is Roboto Condensed (SIL Open Font License, `public/fonts/RobotoCondensed-OFL.txt`).
