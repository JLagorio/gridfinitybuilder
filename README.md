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

A project holds **all your drawers**. Switch between them, add, duplicate, rename or delete them from the drawer menu in the top bar. Each drawer has its own size, baseplate settings and bins; print one, all, or a chosen set at once. Already have the baseplate? A drawer can print **just bins** (below); **New: just bins** in the drawer menu starts one in one click.

Lengths are stored in mm. The **mm / in** switch in the top bar changes what every length field shows and accepts. Inches show as fractions (1/8 to 1/32, or decimals), and you can type `20 1/8`, `20-1/8"`, `1' 8 1/8"`, `44.5mm` or `51cm` in either mode.

**The side panels** (Drawer, Bins, Print) each start with two things:

- **Find a setting:** type what you're after and the panel shows only the matching settings, with the groups they're in opened. It knows other words for them too: *magnet*, *screw*, *lip*, *label*, *scoop*, *pocket*, *divider*, *wall*, *lid*, *feet*, *stack*, *nozzle*, *reprint*… Esc or × puts the panel back as it was. When the setting isn't there for this bin, it says when it is (*Stretch into the gap shows when one bin is selected…*).
- **Basic / All:** Basic shows the settings most bins and drawers need, plus anything you've set away from its default; All shows every setting. A line at the end of a section names what Basic leaves out. The choice is remembered in this browser (not in the project).

Folding groups say what's set in them, start open when anything in them isn't the default, and carry a dot while folded.

1. **Drawer & baseplate.**
   - **Print for this drawer:** *Baseplate and bins*, or **Just bins** when you already have the baseplate (printed before, or bought):
     - Nothing of the drawer's grid prints: no baseplate pieces, connector keys, TPU pads or spacer strips. For a carry case, none of the case either (body, lid, lid keys, hinge pins, handle, feet), and for a wall grid neither its pieces nor its French cleat: you have them. Only the bins print, with their lids, dividers, label plates, trays and cups. The *Baseplate* and *Bins* switches under Export still apply on top.
     - Give the size of the baseplate you have in grid units (an empty drawer switches to them; a 21 mm half grid is under Grid), or, if Gridfit fitted it to a drawer, that drawer's size. The inside height can be given either way, for the "too tall" checks and stacking.
     - Bins are planned exactly as on a printed baseplate: same seat, sizes, fits and checks. The baseplate's own settings fold away (they only set the floor the bins stand on), the 3D view draws the grid see-through as *not printed*, and the Print panel says which drawers print no baseplate. Saved with the drawer in the project, project files and share links (drawers saved before stay as they were).
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
     - **Bins from elsewhere:** bins you already have, and Gridfinity bins downloaded from Printables, MakerWorld or made with another generator, in the layout with the rest. **Add a bin I already have…** or **Import STL / 3MF…** (Layout section), or **+ Existing bin** over the grid:
       - **A bin you already have:** a box of whole cells, its height in 7 mm units (without a lip), a name, a colour and what's in it. It takes its cells, counts for the drawer's height and for stacking, and shows in Find, the contents list and the drawer map. It's never printed. The grid hatches it in its colour; the 3D view shows a see-through box.
       - **Import STL / 3MF / OBJ:** binary or ASCII STL, 3MF (build items, components and the extra model files Bambu Studio and PrusaSlicer write, with their transforms and units; supports left out) or OBJ. A file with several objects lets you pick one. Z is up as the file has it; *Turn 90°* swaps width and depth on the drawer floor (and on the plate). STL and OBJ have no units: mm unless you say cm or inches.
       - **Footprint from the size:** a Gridfinity bin of n units is n × 42 − 0.5 mm across (0.25 mm clear of each cell edge), 1 mm either way counts. On a half grid the cells are 21 mm, so 1.5-unit bins fit; on a full grid such a bin is flagged and rounded. A size that isn't a Gridfinity size is rounded to the nearest number of cells, and the dialog says how far it reaches past them and offers the size that holds it. The height reads as units with a lip (7u + 4.4 mm) or without (7u). The mesh sits centred on its cells.
       - **Print it with my bins** packs it onto the plates and exports it exactly as the file has it: in the Bambu project, the 3MF and STL plates and single downloads. It has to fit a printer (with several, any of them). The BOM and print time come from slicing the mesh like any part. STEP files take it as a faceted solid when it's a closed solid and leave it out (and say so) when it isn't. Print checks warn when it isn't a closed solid (it still exports; the slicer usually repairs it) or may tip over, and planning warns when it's taller than the drawer. **I already have it** treats it like a bin you have: shown, never printed.
       - **Stacking:** both have a flat top unless you mark them **Stackable** (they have a Gridfinity stacking lip): then a bin can stand on them, 4.35 mm into the lip, and they count for the stack's height. They stack on other bins like any bin.
       - Select one to rename, recolour, resize, turn, print or not, list its contents or stack a bin on it; move, copy, paste, duplicate and delete work as for any bin. Compartments, labels, holes and the other options Gridfit builds don't apply, so they're not there.
       - **Where the mesh lives:** never in the project itself (autosave, undo, share links): bins name their mesh by a hash of its contents. The mesh is kept in this browser's IndexedDB (if the browser won't, a private window say, the dialog tells you to save the project file), and **Save project** puts every mesh in the file, so it opens complete on another computer. A share link can't hold meshes: imported bins go in it as boxes of their size, and copying the link says so. Meshes no drawer has used for 30 days are deleted from the browser. The 3D view shows meshes over 150 000 triangles simplified; exports always use the whole mesh.
   - **Type:** a plain **bin**, or one of these containers, each on the same Gridfinity feet:
     - **Vase-mode bin:** prints in the slicer's spiral vase mode: solid bottom layers, then one continuous wall. A bin in minutes from a few grams; dividers are folds of the wall. See [Vase-mode bins](#vase-mode-bins).
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
   - **Start from** a preset: *Screws & small parts* (three compartments with scoops and labels), *Batteries* (an AA pocket grid, tall enough), *Ammo* (a 9mm cartridge block, tall enough that a lid closes over the rounds), *Deep bin* (one tall compartment, as tall as the drawer allows), *Tool tray* (low, a long slot and two compartments) or *Label everything* (label tabs, or a front label, with the text from *What's in it*). One click sets the selected bins, or new bins when none is selected, as one undo step. A preset only sets what it's about: the size, base, holes and lip stay, and a bin too tall for the printer is made smaller to fit.
   - **Templates** save a bin's settings by name. Apply one to the selected bins or to new bins, in any drawer.
   - **My bins** is a library of whole bins of your own, there in every project: the size, height, inside, pockets, labels, inserts and lid, and (if you like) what's in it.
     - **Save to My bins…** (under *This bin*) names it from its label or contents. Several selected bins save as one set, arranged as they are (stacks included), or each on its own.
     - **Place** puts it in the active drawer at the first free spot, on full cells when there's room; with a mouse you can also drag it onto the grid, which shows where it would land. Like any new bin it's made smaller to fit the printer (the biggest one, with several) and lowered to fit the drawer's height. On a full grid, half-unit sizes round down; on a half grid, cells double. One undo step. The tools its pockets came from join the project's tool library.
     - Search, rename, duplicate, delete (with undo), or keep just its settings as a template of the project.
     - It's kept in this browser, apart from the project: a new project, opening a project file or a share link leaves it alone, and other open tabs see changes at once. In a private window, or with site data blocked, it only lasts until the tab closes, and the section says so.
     - **Export file** and **Import file…** move it to another browser or computer. Importing adds only the bins that aren't there yet; for the same bin, the newer copy wins.
     - Templates are different: they're saved with the project and copy settings onto bins that are already there.

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
   - **91 presets:**
     - batteries (AA to D, 9V, 18650, 21700, CR123A, coin cells)
     - cards and cartridges (SD, microSD, CFexpress, SIM, USB sticks, Switch and Game Boy cartridges)
     - hex and power bits, router bits, M2–M8 screws
     - hobby paints, markers, pens, printer nozzles, test tubes, coins
     - **ammunition**, 36 cartridges standing head down like in a reloading block: rimfire (.22 LR, .22 WMR / .17 HMR), pistol (5.7×28, .380 ACP, 9mm to .45 ACP, .38 Special, .357 and .44 Magnum, .45 Colt), rifle (.223 / 5.56, 5.45×39, .300 Blackout, 7.62×39, 6.5 Grendel, .22-250, .243, 6.5 Creedmoor, .308 / 7.62 NATO, .30-30, .45-70, 7.62×54R, .270, .30-06, 7mm Rem Mag, .300 Win Mag) and 12 ga, 20 ga and .410 shotshells. Each pocket is the cartridge's SAAMI or C.I.P. maximum rim (or case) diameter plus 0.5 mm (0.8 mm for shotshells), half its case deep (8 to 30 mm); search the list by what you call them (`556`, `9x19`, `300blk`, `12ga`). Rounds stand far taller than their pockets, so a note under the grid says how tall the bin has to be, in units, for their tips to stay under the rim and under a lid or a bin stacked on top. The rounds’ height goes with the pockets: it stays when you change their size or spacing, and **Item height** changes it or turns the check off.
   - **Graduated sets:** drill indexes (1–10 or 1–13 mm, 1/16–1/2″ by 1/64), ¼″ and ⅜″ socket sets, hex keys. Each pocket is sized to its item, with the size engraved in front of it. A custom list of sizes in mm or inches works too.
   - **Fit an item:** type the item's size and height; the pocket gets clearance and a depth of 2/3 its height, and the height note and print check know how tall it stands.
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

   **QR codes.** A code on the bin that any phone camera reads to show what's in it, offline:
   - **What it says:** the bin's label and each line of *What's in it* (its compartments' too) as plain text, so the phone shows the list with no app or internet; it follows the list as you edit it. Or **custom text**, such as a link to your own inventory. (Share links hold the whole project, far too much for a small code.)
   - **Where:** the outside of the **front wall** (the flat face between the feet and the lip, below or beside a front cutout, at the right-hand end when there's a front label too), the **lid** (one receptacle floor of a stacking lid, or a sliding lid's top behind the grip ridges), or a **plate**: a flat square that prints with the bins and sticks on the bin, its lid or the drawer front.
   - **How:** **inlaid** (cut in and filled flush in the second filament, like inlaid labels: the best contrast, and the Bambu project gives it filament 2), **raised** or **engraved** (one colour: only shadows show the modules, so it scans poorly unless lit from the side). On a stacking lid a raised code is engraved, since a bin stacked on the lid stands there. An inlaid code on the front wall changes filament on every layer it spans; on a plate or a lid only on its top three.
   - **Size:** error correction L, M (default), Q or H; the smallest QR version that holds the text, with modules as large as the surface allows (or the size you set), the 4-module quiet zone included. A plate is as large as the bin's front face, and larger when that's too small for 1 mm modules. The panel shows the bytes, version, module size and a live preview of the code (it scans off the screen).
   - **Will it scan:** modules want two lines of the nozzle (0.8 mm with a 0.4 mm nozzle). A smaller code warns, with the change that fixes it (lower error correction, a larger size, a plate); text too long for the surface says how much fits and what to do (shorter text, a bigger surface, a finer nozzle). With a 0.4 mm nozzle, at M (L): a stacking lid's 35 mm floor holds 62 (78) bytes, a 1-unit sliding lid 26 (32); the front wall of a 6u bin 62 (78) at 1 unit wide and 84 (106) wider, of an 8u bin 180 (230); a plate up to 80 mm 560 (718). Front walls under 5u are too low for 0.8 mm modules: use the lid or a plate.
   - The drawer map can print each bin's code in its corner.

   **Fill from a list.** Type what you want to store, one item per line (`200 M3 screws`, `12 AA batteries`, `SD cards x8`, `hex keys 1.5–10 mm`, `100 rounds 9mm`, `calipers`), and Gridfit proposes bins for it and lays them out in the drawer:
   - **The list:** counts like `200`, `x8`, `8x`, `8 pcs` or `a dozen`; ranges like `1.5-10 mm` or `1/16–1/2in`; sizes like `M3`, `M3x12`, `AA`, `18650` or `100x60x20mm`. A line Gridfit doesn't know still gets a bin (`misc small parts` gets one with two compartments).
   - **What each item gets:**
     - a tool in your tool library with that name: tool cutouts, sized like *Make a bin*
     - drill bits, hex keys, sockets: a graduated set, cut to the range you typed
     - batteries, cards, bits, markers, paints, coins: a pocket grid from the presets
     - ammunition (`9mm x 50`, `200 .22LR`, `20 rounds .308`, `box of 5.56`, `2 boxes of 12ga`): a cartridge block, a pocket per round (a box of them when the line gives no count), as tall as the rounds need for a lid over them, or for the rim when the drawer is lower. More rounds than one printable bin holds go in several.
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
     - **likely to fail:** label text that doesn't fit its tab (and is left off) or has strokes thinner than the nozzle, QR codes too long for their surface or with modules under two nozzle lines, a label tab left off because it sits against a removable divider with a removable side wall too, drawers with too little play, very tall bins on a small base, a stretched body far over the margin
     - **prints, but worse:** raised text under 3 mm, one-colour QR codes, two-colour QR codes on the front wall, walls between pockets, hex struts, grid inserts and drawer walls under two nozzle lines, big hex holes, magnet + screw holes without printable tops, compartments too narrow and deep to reach into, wide bridges (including a label tab spanning a wide compartment in front of a removable divider), an untrimmed baseplate ridge, and fits that are tight for a big nozzle (divider slots, the sliding lid's click, hinges, puzzle tabs and keys)
     - **rounds**, or anything else with an item height, in a pocket grid (the bin's, a compartment's or a pocket-grid lid's) that would hold up the bin's lid or a bin stacked on it, or reach higher than the drawer's inside height (likely to fail), or stick out above the rim (a tip). The fix raises the bin to the height in units that clears them, as far as the printer and the drawer allow.
     - Most have a one-click fix ("Make them 1.2 mm", "Turn on printable hole tops", "Make it 6u"). Click a bin's name to select it, switching drawer if needed.
     - The selected bin shows its own checks above its settings, and bins with any get a small dot on the bin grid (yellow: likely to fail; blue: a tip).
   - **Two or more printers:** **Add a printer** for a big one and a small one, or two of the same. Each has its own model, bed, edge margin and height (and power draw for the cost), and can be removed again.
     - **Baseplate prints on** the biggest printer, split for its bed, or on the printer you pick, split for that one. Left to the biggest, a baseplate plate can still go to another printer that takes it.
     - Everything else is shared out so the whole job is done soonest: Gridfit balances each printer's estimated print time (the sliced estimate once the parts are sliced, a quick guess from their size before). A part that only one printer takes goes to that printer.
     - Plates are listed printer by printer, and each plate says which printer it's for.
   - **Split and pack:** Gridfit splits each baseplate on cell boundaries, so every receptacle stays whole. Each drawer's baseplate gets its own plates (named after the drawer). Bins, lids, removable dividers and label plates from every printed drawer share plates.
   - **What to print:** this drawer, all of them, a chosen set, or **Selected bins**: just the bins selected on the Bins tab (*Print these* in their panel), with their lids and inserts and no baseplate, for "print just these three new bins". Drawers that print *just bins* say so over the export switches, and a job with nothing on its plates says why.
   - **Reprint only what changed:** for a big project printed over weeks, then tweaked.
     - **Mark as printed** on a plate (or **Mark all as printed**) records what came off the printer. Printed plates get a tick, and so do printed bins in the bin layout; a bin changed since it was printed gets a dot.
     - Parts are known by their geometry, counted per print: three identical bins are three prints of the same part, so any of them stands in for another. Moving a bin to another cell (of the same size) isn't a change; resizing it or changing its options is. Each drawer keeps its own prints: printing a drawer on its own never leaves out a bin because another drawer has an identical one.
     - **Only what's changed** leaves out what's printed already and packs the rest onto fresh plates. It says how many parts it leaves out ("14 parts already printed are left out").
     - **Forget printed** clears the record. The record is saved with the project, in project files and in share links, and marking is undoable.
   - **Exports:**
     - **Bambu Studio project (.3mf):** every plate in one file, with the printer, *0.20mm Standard* process and *PLA Basic* filament preselected (plus a second filament for inlaid labels). Vase-bin plates have spiral vase turned on and each vase bin set up for it. Open it and press **Slice all plates**. With several printers there is one project per printer, each with its own plates and settings.
     - **Plates as 3MF (.zip):** one plain 3MF per plate for any slicer, plus an assembly map per drawer showing which piece goes where (and, with several printers, on which printer's plate). With several printers, each printer's plates are in a folder of their own.
     - **Plates as STL (.zip):** one binary STL per plate, parts already arranged, in a folder per printer when there are several.
     - Vase-mode bins are named for what the slicer needs (`[spiral vase: bottom layers to 6 mm (30 at 0.2 mm), 0.6 mm wall line]`), and the 3MF zip's README (`spiral-vase.txt` in the STL zip) says which plates print in spiral vase mode.
     - **STEP** for CAD (Fusion 360, FreeCAD, Onshape): the selected bin, one plate, all plates (.zip), or each drawer assembled. Flat areas become single faces. Imported bins that aren't closed solids are left out (the panel says so).
     - Any single plate or bin, as 3MF or STL.
     - **Test-fit kit:** a small baseplate sample with your joints and magnets, plus one 1 × 1 bin, on one plate. Use it to check the fit before printing everything. For a drawer that prints just bins it's the bin alone, to try in the baseplate you have.
     - **Save / Open project** as a `.gridfit.json` file (version 3: with the meshes of imported bins in it); it also autosaves in the browser. **New project** starts over with one empty drawer (printers, templates, the tool library and My bins stay; Undo brings the old one back). **Copy share link** puts the whole project, compressed, in the link itself (nothing is uploaded; imported bins go as boxes).
   - **Bill of materials:**
     - Counts magnets, screws, nuts or inserts, filament pins, connector keys, parts and plates. Partial and blocked cells get no holes.
     - Estimates filament per plate from the same sliced layers as the print time (Bambu's 0.20 mm Standard: 2 walls, 5 top and 3 bottom layers, 15 % infill) for 1.75 mm PLA at 1.24 g/cm³. Expect ±10 %. Until a plate's parts are sliced it shows a quicker guess from the part surfaces, which runs high on tall bins.
     - **Print time** per plate and in total for the selected printer, from a slice of each part at 0.20 mm (checked against a slicer; expect ±25 %). Vase-mode bins count as they print: solid bottom layers, then one line a layer, one bin after another.
     - With several printers: each plate timed on its own printer, time, filament and cost per printer and in total, and **All done in**: when the slowest printer finishes, since they print at the same time.
     - **Cost** from your filament price per kg (a second price for two-colour parts) and, optionally, electricity.
     - TPU non-slip pads (an option under Baseplate) print on their own plate.
     - Downloads as CSV or text.
   - **Drawer map & contents:** a printable top view of a drawer (or all of them) with each bin's label and contents, fit to a page or at actual size across several pages, or as an SVG; stacked bins get a map per level. Also a contents list of every bin, and a CSV of it.

Every change to the project can be undone (⌘/Ctrl+Z, redo with ⇧⌘Z or Ctrl+Y). Press **?** for all keyboard shortcuts. Drop-down lists work from the keyboard too: arrows and Page Up / Down move, typing jumps to an option, Enter picks, Esc closes. The long ones (a pocket grid's *Holds*, the printer *Model*) filter as you type, by name or group, ignoring spaces and punctuation (`cr2032`, `m3`, `k1`).

### Phone, tablet and offline

- **Touch:** every editor works with a finger.
  - Drag to draw, move and resize bins; handles get bigger on touch screens.
  - Tap to add a compartment wall, then drag it into place.
  - Drag tools in the bin, and the trace dialog's paper corners.
  - Tap **Place** to put a bin from My bins in the drawer (dragging it onto the grid is for a mouse).
  - Double-tap where a mouse double-clicks (finger notches).
  - Drop-down lists have finger-sized rows and open above the field when there's no room below. The arrow beside *Holds* or *Model* shows the whole list without bringing up the keyboard.
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

### Vase-mode bins

A vase-mode bin (*Type: Vase-mode bin*) prints in the slicer's spiral vase mode (*Spiral vase* in PrusaSlicer, Bambu Studio and Orca, *Spiralize outer contour* in Cura): the bottom layers print as usual, then the nozzle goes round the outside in one continuous, rising line. A 1 × 1 × 3u bin takes 4.4 g and 9 minutes instead of 10.4 g and 15 (PrusaSlicer set up like Bambu’s 0.20 mm Standard); the hollow feet under the spiral print as usual, so that’s most of what’s left.

**How it prints.** Above the bottom layers the slicer keeps only each layer's outline, with its holes closed, so whatever the bin needs inside has to be part of that one outline, or below the spiral:

- **Feet.** A bin on several cells stands on a foot per cell, and the feet are separate islands below the baseplate's ridges, which one line can't go round. So the spiral starts above them, at 6 mm (the 30 bottom layers at 0.2 mm that other single-part vase designs use too), and everything under it prints as ordinary bottom layers: each foot a hollow shell two lines thick with a solid floor, joined by walls along the cell lines, with solid bosses round magnet, refined or screw holes. That's why the slicer has to be told the bottom layers (Gridfit does it in Bambu projects). Some designs print the feet separately and glue them on instead ([kennetek's gridfinity-spiral-vase](https://github.com/kennetek/gridfinity-rebuilt-openscad)); this way the bin prints in one piece.
- **Flat** (Base: Flat): no feet; the floor is the bottom layers and the spiral starts on it.
- **Dividers** are thin slits (0.15 mm) cut in from the back wall (or the right wall, for sections front to back) up through the top, stopping two lines short of the opposite wall. The outline follows the slit in and back out, so the single wall folds into a divider: two lines, joined at the tip, which touches the opposite wall. The slit has to be wider than twice the slicers' gap-closing radius (0.049 mm), or they close it; the solid at its end has to stay over a line wide once the slicer insets the outline, or the outline splits in two and the spiral stops (PrusaSlicer did at 1.5 lines). Dividers run one way only (as in kennetek's): slits that crossed would cut the bin apart. Below the spiral each divider is a real wall.
- **Wall line:** the wall is this one line, 0.6 mm by default (1.5 × a 0.4 mm nozzle); wider is stiffer. The part is drawn for it (two-line feet, the slits' ends), the Bambu project prints with it, and a print check flags a line narrower than the nozzle or over twice it, with a one-click fix for your nozzle.
- The part is drawn as it prints (one line of wall above the bottom layers): the slicer sees the same outline a solid block would give it, but this is one closed shell, the 3D view shows the bin you'll get, its volume is the filament it takes, and without vase mode it still prints, as a thin-walled bin.

**Not for vase bins:** anything inside the wall, which one line can't print: scoops, label tabs and label text, the stacking lip and lids, pockets, tool cutouts, cups, trays, rails, wall cutouts and patterns, and compartments other than the dividers. They're not shown for a vase bin (switching back to a plain bin brings them back). Nothing stacks on a vase bin (it stacks on others), and it doesn't stretch over the margin. Half grids, partial edge cells and magnets work.

**Plates.** Spiral vase is a setting of the whole print, not of a part, so vase bins get plates of their own (*Vase bins 1*, …):

- **PrusaSlicer** has it in the print settings and prints only one object in spiral vase mode (unless *Complete individual objects* prints them one after another), so on other printers each vase bin gets a plate.
- **Bambu Studio** sets it per plate (*Spiral vase* in the plate's settings, `spiral_mode` in the project's `Metadata/model_settings.config`). Several objects on such a plate must print *By object*, and then every one but the last has to clear the gantry: they stand at least the printer's `extruder_clearance_max_radius` apart (68 mm on X1 / P1, 72 P2S, 73 A1, 81 H2S, 96 H2D), and none may be taller than its rod clearance (34 mm on X1 / P1) where a later one shares its row. So on Bambu printers vase bins under the rod clearance share plates at that spacing, and taller ones print alone.
- **The Bambu project** turns spiral vase on for those plates (print sequence *By object* when they hold several bins), and gives each vase bin what Bambu Studio itself sets when you turn it on for a plate (1 wall loop, no top shells, 0 % sparse infill, no supports, thin-wall detection off, vertical shell thickness on), plus its bottom shell layers up to the spiral's start (counted for the process's layer heights: 30 at 0.2 mm) and its outer wall line width. Project-wide it switches off what spiral vase can't have (smooth timelapse, continuous Z outer-wall speed). Other plates keep the normal settings. If you change the layer height in Bambu Studio, set the vase bins' bottom shell layers to reach 6 mm again.
- **Other slicers:** turn on spiral vase, 1 wall, no top layers, 0 % infill, no supports, bottom layers to 6 mm (1 mm on a flat bin) and the wall (external perimeter) line width; each vase part's name says so, and so does the README.
- Bed fit and several printers work as for other bins.

**Checked** with PrusaSlicer 2.7.2 (`npm run sampler -- out --slice --only vase/`): each sample slices in spiral vase mode with its bottom layers and line width, and its G-code is read back: after the bottom layers every layer is one line with Z rising along it, no travel or retraction, starting where the one before ended, and one turn is as long as the outline and both sides of every slit (so the slits fold the wall rather than being closed). See docs/print-check.md.

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
npm test             # vitest: layout, splitting, packing, every geometry variant's validity, dividers, tracing, 3MF/STL structure, the bundle split
npm run typecheck
npm run build
npm run sample -- out   # build a whole drawer kit from the CLI (default: the 510.5 × 376.5 drawer)
npm run sampler -- out/sampler --slice   # every kind of part as STL, print-checked and sliced (docs/print-check.md)
```

To check an export against Bambu Studio itself, use the CLI that ships with the app. It loads the project, slices every plate, and writes a G-code file for each:

```bash
/Applications/BambuStudio.app/Contents/MacOS/BambuStudio --slice 0 --outputdir out/sliced out/drawer-bambu-project.3mf
```

### What loads when

The first screen downloads only what it shows; the rest is code-split and loads on first use (`src/components/lazy.tsx`). `tests/bundle.test.ts` builds the app and keeps it that way.

- **First screen:** the entry chunk (`index-*.js`: the app shell, the drawer panel, the bin grid, the 3D view) with the store and planning code it shares with the lazy parts (a few chunks rolldown splits off), React (`react-*.js`, with zustand) and three.js (`three-*.js`). Both libraries have chunks of their own, so a deploy that only changes the app doesn't download them again.
- **On first use:** the Bins and Print plates panels (My bins comes with the Bins panel; the bin grid only has a slot for its drop preview, `gridLayers.ts`), the compartment and tool-cutout editors, the trace dialog (the SVG / DXF readers load with the first file), *Fill from a list* (with `src/lib/autofill`), the drawer map and the STEP assembly layout, the import dialog with the STL / 3MF / OBJ readers, the mesh store (IndexedDB), and the share-link codec (when a link is opened or copied). The tabs and editors also load in the background once the first mesh is on screen, so switching is instant. A returning visitor's saved tab (Bins or Print plates) gets its panel preloaded from `index.html` (`scripts/preload.ts`).
- **Geometry worker:** its entry (`geometry.worker.ts`) is tiny. It starts downloading and compiling the Manifold WASM at once, while the mesh code (`meshes.ts`) loads beside it. The file writers, zips and the slicer (`writers.ts`) load on the first export or print-time estimate. The label font loads with the first mesh that may have text (baseplate pieces never do), or once the WASM is ready; the page loads its own copy when a label preview or a print check needs it, and for the bin grid's check marks only after the first view.
- **Offline copy:** the service worker registers once the first mesh is in and the other tabs have loaded, so saving every file doesn't compete with the first view. It checks each file with the server (`cache: 'no-cache'`), so what the page just downloaded comes from the HTTP cache instead of being downloaded again. Every lazy chunk is in its list.
- **A chunk that fails to load** (usually a deploy replaced it while the page was open) shows *Reload to update* in its place (`src/pwa/chunks.ts`, `ErrorBoundary.tsx`); exports say the same.

### Bambu printer settings

`public/bambu/<printer>.json` holds the `project_settings.config` embedded in Bambu exports. The files are generated from your installed Bambu Studio's system presets, with inheritance and include templates flattened. Bambu Studio's CLI then fills in the remaining defaults. To regenerate them after a Bambu Studio update:

```bash
npx tsx scripts/build-bambu-settings.ts
```

### Layout

```
src/lib/geometry/   spec constants, shape helpers, baseplate + bin generators (Manifold), label text
                    (a small TrueType reader; Roboto Condensed Bold, OFL, ships in public/fonts)
src/lib/layout/     drawer → grid fit, bed splitting, plate packing; fleet.ts several printers and sharing parts out; spiral.ts vase-bin plates
src/lib/dividers/   bin interior layouts: walls → compartments, edits, snapping (pure TS)
src/lib/trace/      photo → tool outline (perspective, threshold, contours) and SVG/DXF import (pure TS)
src/lib/autofill/   "Fill from a list": list parser, item matching, bin sizing, grouping, packing (pure TS)
src/lib/geometry/containers/  vase-mode bins, drawer units, parts boxes, hoppers, tool racks, dispensers (a registry of container types)
src/lib/export/     plain 3MF, Bambu Studio project, binary STL and STEP writers (a plate, every plate, one part); estimate.ts print time and cost
src/lib/project.ts  ties it together: planJob() / planPrint() for several drawers (cheap, no geometry) + buildMesh()
src/lib/bom.ts      bill of materials; testfit.ts the test-fit kit; share.ts share links; inventory.ts contents and search;
                    printed.ts what's been printed (part fingerprints), for reprinting only what changed
src/lib/printability.ts  print checks: rule-based warnings from the options and the nozzle (cheap, no geometry)
src/lib/qr.ts       QR capacity and versions (planning); qrEncode.ts the QR matrix (Reed–Solomon, masks), loaded only with the
                    mesh builders and the panels that draw codes; geometry/qrCode.ts, binQr.ts, qrFront.ts, qrSolid.ts the codes on bins
src/lib/panelSearch.ts   "Find a setting" in the side panels: a keyword search over each panel's index (components/panelIndex.ts)
src/lib/templates.ts     bin templates and the built-in presets ("Start from")
src/lib/myBins.ts        My bins: the library format and its versions, placing an entry in a drawer, merging an import
                         (state/myBins.ts keeps it in localStorage, apart from the project)
src/lib/stacking.ts bins stacked on bins: columns, rules, heights
src/lib/external.ts bins from elsewhere (placeholders, imported meshes); src/lib/imported/ STL / 3MF / OBJ readers, footprint
                    detection, the mesh format and hash, the in-memory registry and the IndexedDB / project-file mesh store
src/state/          zustand store, undo history (history.ts), multi-bin selection, templates and presets, the panels' Basic / All view
src/worker/         geometry Web Worker (a tiny entry, meshes.ts, writers.ts on first export) + client with a mesh queue/cache
src/components/     React UI (three.js viewer, 2D bin layout editor, panels; touch.tsx: touch helpers; lazy.tsx: code splitting;
                    select.tsx, combobox.tsx: the drop-down lists, with lib/pickList.ts)
src/pwa/            offline use: the service worker and its registration; chunks.ts: files that fail to load
scripts/            CLI sample generator, Bambu settings baker, pwa.ts (writes dist/sw.js with every built file),
                    preload.ts (preloads the saved tab's code-split panel)
tests/              vitest suites
```

## Credits

Gridfinity was created by [Zack Freedman](https://www.youtube.com/c/ZackFreedman). The dimensions come from gridfinity-rebuilt-openscad (MIT). Several options follow other community projects: Gridfinity Extended (lip styles, efficient floor, wall cutouts, pocket grids, half-pitch grids), Gridfinity Refined (side-loaded magnets), GridFlock (pin and puzzle joints), cq-gridfinity, and Tracefinity (tool tracing). The QR encoder follows Project Nayuki's QR Code generator (MIT). The label font is Roboto Condensed (SIL Open Font License, `public/fonts/RobotoCondensed-OFL.txt`).
