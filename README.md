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

A project holds **all your drawers**. Switch between them, add, duplicate, rename or delete them from the drawer menu in the top bar. Each drawer has its own size, baseplate settings and bins; print one, all, or a chosen set at once. Already have the baseplate? A drawer can print **just bins** (below); **New: just bins** in the drawer menu starts one in one click. **New: Skådis board** starts a Skådis-pattern pegboard for the wall instead, **New: board from a template…** one with its parts already on it, and **New: openGrid board** / **New: Multiboard board** boards for those systems (see [Skådis boards](#skådis-boards)); the **Wall planner** lays them all out on one wall.

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
     - **Bins always fit your printer.** Drawing, resizing, the size and height fields, stretching, templates, "Make a bin" and "Fill from a list" all stop at what the bed takes (inside the edge margin, either way round, clear of an X1 / P1's front-left corner) and at the printer's height. A container's own parts (a drawer unit's drawers, a box lid) count too. With two or more printers, a bin can be as big as the biggest one takes, and each of its parts only has to fit one of them; the messages name the printer that comes closest. After switching to a smaller printer (or removing the big one), bins that no longer fit turn red, aren't printed, and get a **Shrink to fit** button.
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
   - **inlaid**: engraved and filled flush in a second filament. The Bambu project gets a second filament for it; pick its colour under *Colours* in *Print plates*. Needs an AMS or a filament change.
   - on **swappable label plates**: the tab gets a shallow recess with a pry notch, and small text plates print with the bins and press in, so you can relabel later. The drawer view shows them in place.
   - in **Cullenect** or **Pred** sockets, so community snap-in labels fit; Gridfit can print matching labels with your text.
   - **Icons:** type `{bolt:12}`, `{screw:socket}`, `{nut}`, `{washer}`, `{insert}`, `{battery}`, `{|}` and 15 more, like gflabel, or pick them from the Icons menu. The preview shows the real label.
   - **From What's in it:** `{contents}` (or `{contents:2}`) puts the bin's or compartment's first contents lines on the label.
   - **Front-wall labels** go on the outside of the front wall: raised, two-tone, engraved or inlaid, one per front compartment.

   **QR codes.** A code on the bin that any phone camera reads to show what's in it, offline:
   - **What it says:** the bin's label and each line of *What's in it* (its compartments' too) as plain text, so the phone shows the list with no app or internet; it follows the list as you edit it. Or **custom text**, such as a link to your own inventory. (Share links hold the whole project, far too much for a small code.)
   - **Where:** the outside of the **front wall** (the flat face between the feet and the lip, below or beside a front cutout, at the right-hand end when there's a front label too), the **lid** (one receptacle floor of a stacking lid, or a sliding lid's top behind the grip ridges), or a **plate**: a flat square that prints with the bins and sticks on the bin, its lid or the drawer front.
   - **How:** **inlaid** (cut in and filled flush in the second filament, like inlaid labels: the best contrast, and the Bambu project gives it filament 2, or the *QR codes* colour with multi-colour on), **raised** or **engraved** (one colour: only shadows show the modules, so it scans poorly unless lit from the side). On a stacking lid a raised code is engraved, since a bin stacked on the lid stands there. An inlaid code on the front wall changes filament on every layer it spans; on a plate or a lid only on its top three.
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

3. **Print plates.** The panel goes: the printers, colours, print checks, the exports, the plates, then the baseplate split, bill of materials, test-fit kit, drawer map and the project file.
   - **Printer:** pick it. The Bambu Lab P2S is the default, and bed sizes come from Bambu Studio's own profiles.
     - **Exclusion areas:** the X1 Carbon, X1E, P1S and P1P keep an 18 × 28 mm corner at the front left of the bed free (`bed_exclude_area` in their profiles), and Bambu Studio won't slice a plate with a part in it. Nothing is placed there or within the part spacing of it, plates are centred only as far as that allows, and a part fits these printers only if it fits beside the corner (the full depth) or behind it (the full width): 225 × 236 or 236 × 215 mm with the default margin and spacing. That limits bins, the baseplate split and every printer of a multi-printer job by its own corner. The other printers here have none. The plate thumbnails and the 3D plates view hatch the corner.
   - **Nozzle:** 0.4 mm unless you pick 0.2, 0.6 or 0.8. The print checks measure walls, text and fits against it (Bambu projects stay set up for the 0.4 mm nozzle; pick yours in Bambu Studio).
   - **Print checks:** before the exports, a list of what won't print well in everything being printed, from the settings alone:
     - **likely to fail:** label text that doesn't fit its tab (and is left off) or has strokes thinner than the nozzle, QR codes too long for their surface or with modules under two nozzle lines, a label tab left off because it sits against a removable divider with a removable side wall too, drawers with too little play, very tall bins on a small base, a stretched body far over the margin
     - **prints, but worse:** raised text under 3 mm, one-colour QR codes, two-colour QR codes on the front wall, walls between pockets, hex struts, grid inserts and drawer walls under two nozzle lines, big hex holes, magnet + screw holes without printable tops, compartments too narrow and deep to reach into, wide bridges (including a label tab spanning a wide compartment in front of a removable divider), an untrimmed baseplate ridge, and fits that are tight for a big nozzle (divider slots, the sliding lid's click, hinges, puzzle tabs and keys)
     - **rounds**, or anything else with an item height, in a pocket grid (the bin's, a compartment's or a pocket-grid lid's) that would hold up the bin's lid or a bin stacked on it, or reach higher than the drawer's inside height (likely to fail), or stick out above the rim (a tip). The fix raises the bin to the height in units that clears them, as far as the printer and the drawer allow.
     - Most have a one-click fix ("Make them 1.2 mm", "Turn on printable hole tops", "Make it 6u"). Click a bin's name to select it, switching drawer if needed.
     - The selected bin shows its own checks above its settings, and bins with any get a small dot on the bin grid (yellow: likely to fail; blue: a tip).
   - **Colours:** print the baseplate red and the bins black, colour-code bins by what's in them, or give feet, walls and lips colours of their own: see [Multi-colour](#multi-colour).
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
     - **Save / Open project** as a `.gridfit.json` file (version 4: with the meshes of imported bins and the wall's photo in it); it also autosaves in the browser. **New project** starts over with one empty drawer (printers, templates, the tool library and My bins stay; Undo brings the old one back). **Copy share link** puts the whole project, compressed, in the link itself (nothing is uploaded; imported bins go as boxes).
   - **Bill of materials:**
     - Counts magnets, screws, nuts or inserts, filament pins, connector keys, parts and plates. Partial and blocked cells get no holes.
     - Estimates filament per plate from the same sliced layers as the print time (Bambu's 0.20 mm Standard: 2 walls, 5 top and 3 bottom layers, 15 % infill) for 1.75 mm PLA at 1.24 g/cm³. Expect ±10 %. Until a plate's parts are sliced it shows a quicker guess from the part surfaces, which runs high on tall bins.
     - **Print time** per plate and in total for the selected printer, from a slice of each part at 0.20 mm (checked against a slicer; expect ±25 %). Vase-mode bins count as they print: solid bottom layers, then one line a layer, one bin after another.
     - With several printers: each plate timed on its own printer, time, filament and cost per printer and in total, and **All done in**: when the slowest printer finishes, since they print at the same time.
     - **Cost** from your filament price per kg (a second price for two-colour parts; with multi-colour, each filament slot's price) and, optionally, electricity.
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
- **Boards with a finger:**
  - On a phone the board tab shows its tiles over the panel: tap **+** to add one, **✕** (a fingertip wide) to take one away.
  - On the Attachments tab, tap a part to select it (a tap just beside a thin hook takes it) and drag it to move it; hold a part still to add it to the selection or take it out. A bar over the board has **Select several**, **Duplicate**, **Copy**, **Paste** and **Delete**; the resize handles take a press a fingertip wide, and *Move to the nearest spot that fits* sits under the board. A second finger calls a drag off; two fingers zoom the page.
  - In the 3D view a finger drags a selected attachment; on any other it orbits, unless you hold it still a moment, which picks it up.
  - In the wall planner, drag boards and what's in the way, tap an empty spot to add a board, and double-tap a board to open it. On a phone a finger on the empty wall scrolls the page.
- **On a phone** a tab bar at the bottom switches between Drawer, Bins, 3D and Print (Board, Attachments, 3D and Print for a board). 3D shows the step you're on, full screen.
- **Install it:** use your browser's *Install app* or *Add to Home Screen*.
- **Offline:** after the first visit Gridfit opens and works without a connection: layouts, meshes, exports and printer settings. Share links open offline too.
- **Updates:** when a new version is out, a note says *A new version is ready*. **Reload** switches to it, and the project stays (it autosaves).

### Split strategies

- **Fewest plates** (default): tries every split that uses the minimum number of pieces and keeps the one needing the fewest print plates. Small pieces share a plate when they fit. For a 510.5 × 376.5 mm drawer on a P2S (256 mm bed, 10 mm edge margin) it needs 4 baseplate plates, against 6 when every piece prints alone.
- **Even pieces**: the same number of pieces, sized as evenly as possible.
- **Biggest pieces**: full-size pieces first, with leftovers at the end.

### Multi-colour

Turn on **Print in several colours** under *Colours* in *Print plates* (search *colour*, *color*, *multi colour*, *AMS*, *filament* or *paint*). Off, everything prints as before: one filament, and a second for inlaid label text and tool shadows.

- **Filament slots:** a palette of up to 16 slots (four AMS units), each with a colour, a name, a material and, in All settings, a price per kg. Slot 2 is the old label filament: projects, files and share links from before open unchanged, their label colour and second price in slot 2.
- **Presets:** *One colour* (back to one filament), *Red plate, black bins* (labels white), *Colour-coded bins* (each kind of bin its own colour, by what's in it or else by size). Each is one undo step.
- **Surfaces:** Basic sets three, *Baseplate*, *Bins* and *Labels*. All sets each surface on its own: connector keys & spacer strips, wall grid & cleats, non-slip pads; carry-case shell, lid, handle, hinge pins & feet; bin feet, floor, walls, stacking lip, dividers, label tabs & plates, lids, trays & inserts, container shells, drawer fronts, pulls; label text & icons, QR codes, tool shadows. A surface not set follows its group (the lip follows the bin walls, the walls follow *Bins*, QR codes the label text).
- **Colours of their own:** a drawer's baseplate (Drawer & baseplate tab) and a bin (Bins tab; it's one of the bin's options, so it's saved with templates and in My bins). The bin grid tints bins in their own colour. A bin's colour doesn't change its label text or QR code. A baseplate you already have (*Just bins*) isn't printed, so it takes no filament; neither do bins you already have.
- **With the other features:**
  - **QR codes:** inlaid codes print in the *QR codes* slot. Phone cameras read dark modules on a light ground best, so a print check flags a code no darker than what it's on, and offers your darkest slot.
  - **Vase-mode bins** print by part or by height (feet in one colour, the wall in another), always as one body. Their spiral plates come per colour like the other bins. By height, a vase bin that changes colour gets a plate of its own: several on a plate print by object, and Bambu Studio only changes filament by layer on plates printed by layer.
  - **Imported bins** that print go on the plates as they are, in one filament: the bins' colour or their own.
  - Plates of every colour keep clear of the X1 / P1 bed exclusion corner.
- **How it prints**, picked with the plates, swaps, purge and time each way takes side by side:
  - **By part** (default): each part in one filament (label text and tool shadows keep theirs). Parts of different colours go on plates of their own (*Bins 2 · Red*), so no plate swaps filament. Turn off **Keep colours on separate plates** for fewer plates; then every layer two colours share swaps filament.
  - **By height:** the filament changes at heights, so bin feet, floor, walls and lip can each have a colour (a container: feet and shell). Changes snap to the 0.2 mm layers (first layer 0.2 mm): the new colour starts on the first layer above. Parts on a plate share their changes, so plates group parts by their colours by height; short one-colour parts join a plate they're done on before its first change. Works without an AMS: with fewer slots than colours, each change is a pause to swap the spool by hand.
  - **By feature:** each part is split into a volume per surface, each in its own filament (needs an AMS or several toolheads). Every layer with two colours swaps filament and purges.
- **The split (by feature):** Manifold cuts each part into disjoint volumes in turn: label tabs (their boxes), stacking lip (from the lip's foot up, less the inside), dividers (inside walls from just above the floor), feet (below 4.75 mm), walls (the outer shell, wall thickness in from the outside) and the floor (the rest); drawer fronts and their tab or knob pulls; container feet and shell. Cuts keep 0.3 mm off the model's faces so no slivers are left, and scraps under 0.5 mm³ stay with the volume they came from. The tests hold every volume to be a valid manifold, apart from the others, all of them adding up to the part, and put back together right in the exported 3MF. Vase-mode and imported bins print as one body in their colour, and a print check says how many.
- **3D view:** parts in their filament colours, by height in bands, with a legend of the slots in view.
- **Exports:**
  - **Bambu Studio project:** every slot up to the highest used in the filament list (`filament_colour`, `filament_type`, `filament_settings_id` and every other per-filament setting, for each nozzle variant the printer's profile has, grown in step; the flush matrix sized to match). Each object prints in its main volume's filament, other volumes in theirs. By height, `Metadata/custom_gcode_per_layer.xml` holds each plate's filament changes by layer (`type="2"` tool changes, mode `MultiAsSingle`), or pauses (`M400 U1`) when the printer feeds fewer slots.
  - **Plates as 3MF:** colours as 3MF core `basematerials` (a `displaycolor` per slot), one object per part with its volumes and their extruders in `Metadata/Slic3r_PE_model.config` (PrusaSlicer), and by height PrusaSlicer's `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml` (`M600` colour changes).
  - **Plates as STL:** STL has no colour, so one file per slot per plate (`01-bins-1.slot3-red.stl`); by height one per plate, with the change heights in the README.
  - **STEP:** each solid in its filament's colour (by height, the part's main colour). Single-bin downloads are in one colour.
  - Bambu projects start every slot as *PLA Basic*: pick the preset for other materials in Bambu Studio (a print check says which).
- **Estimates:** filament and cost per slot; swaps, purge and prime tower per plate. A swap purges more going lighter (black to white about 1.1 g, white to black 0.35 g); the prime tower prints on each layer up to the last swap. Swaps by hand take about 150 s each, without a tower.
- **Print checks** (under *Colours*): more filaments on a plate than the printer feeds (fix: *Print by part*; by height it pauses instead), a plate that purges more than 25 g or more than half what it prints, plates of mixed colours (fix: keep them separate), colour bands under two layers, inlaid text and QR codes by height (they print in their band's colour), QR codes no darker than what they're on, parts that can't be split by feature, and slots of other materials in a Bambu project.
- **Filament slots the printer feeds:** Bambu printers 4 (an AMS; the P1P 1), Prusa XL 5, Creality K2 Plus 4, others 1. Change it in All settings for more AMS units or none.
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

### Skådis boards

**New: Skådis board** in the drawer menu adds a pegboard to the project, beside the drawers: Skådis hooks, shelves and containers hang in it, and so do the attachments Gridfit makes for it (below). Its first tab (*Skådis board*) takes the place of *Drawer & baseplate*, its second (*Attachments*) the place of *Bins*, and it prints, exports and shares like any drawer: on its own plates, in the Bambu project, the 3MF / STL / STEP files and the assembly map. Have a board already? *Print for this board: Just attachments* prints only what hangs on it; the standard-size buttons set its size (36, 56 or 76 × 56 cm) and its measured 5.1 mm thickness and 5.1 × 15.2 mm slots.

- **The standard pattern:** upright 5 × 15 mm slots, columns 20 mm apart, the slots in a column 40 mm apart and every other column 20 mm higher, in a 5 mm board, chamfered on both faces. Slot size, chamfer and thickness can change (*All* settings), say for a looser fit.
- **Or another pattern** (*Slot pattern*), on a lattice of any step from 14 to 40 mm: a **square grid** (a slot where both lattice indices are even: openGrid-like 28 mm squares at a 14 mm step) or **dense** (a slot at every step; the step stays at least the slot length + 4 mm). Attachments' mounts are two steps apart, so they fit all three. Seams never cost a square grid any slots; a dense board loses the column or row a seam takes.
- **Built from tiles** (new boards): a board starts as one tile, the largest your printer takes or a size you pick, and grows from its picture on the *Skådis board* tab: click a **+** by its edge to add a tile, the **✕** on one (or select it and press Delete) to take it away; each is an undo step, and the attachments stay on their slots. No sizes to work out: add tiles until it's as big as you want. Every tile's slots are on one lattice, so a shelf or rack can span two. Rectangle tiles are whole steps of the lattice and join as seams do, in any shape (a frame or other ways to hang need a whole rectangle). Hexagons stand on a corner, spaced so every one is still the same part (a few % taller or flatter than a regular hexagon); side by side, every other row of slots runs on across the gap, and joint plates on the back hold them in line.
- **Or fill a space** (*Board: Fill a space*, the first boards' way): give the width and height of the space on the wall. A rectangle board fills it, the slots centred with at least the border (10 mm) around them; hexagons fit in it. Switching a board to tiles keeps about its size.
- **Rectangle tiles:** the board is split into the fewest, most even tiles that fit the bed (its edge margin, either way round, clear of an X1 / P1's front-left corner), as MOSS 3D's Skadis Pegboard Generator does it:
  - An **upright seam** takes the place of a column of slots, so there is 17.5 mm of plastic on each side of it. A **level seam** runs through a row of slots: every other slot along it is cut in half, and whole again once the tiles are together; the slots beside it are 12.5 mm clear.
  - **Joints:** dovetail tabs (in the plane of the board: the tile to the left or below carries them), joint plates (a 20 mm square with four pins, pressed into pockets on the back across a seam, flush; always where seams cross), both (the default: they take turns along each seam), or nothing. A board under 3.8 mm is too thin for the plates' pockets and pins; it gets tabs.
  - Joints and mounting points only go where the pattern has plastic, never into a slot.
- **Hexagon tiles** (like [Azntek's hexagonal Skadis board](https://makerworld.com/models/1592040-10-hexagonal-skadis-board-v1)): a honeycomb of hexagon boards with the gap you give between them, each as large as the bed and the space take (or the width you give, corner to corner). Every hexagon is the same part (no number on it: they go up in any order), so it builds once; the slots are centred on it inside the border.
- **Hanging it:**
  - **Posts** (default) print on the back of each tile, standing up as it prints face down: no supports and nothing to lose. Or separate **spacers** (tubes behind each screw, printed with the joint plates), or **nothing**, for a frame. The gap behind the board is 20 mm by default: room for the hooks' tails.
  - **Screws:** countersunk on the front (⌀4 by default, head ⌀8.5). A rectangle tile gets one near each corner and more about every 200 mm (*Screws about every*); a hexagon two, in its left and right corners, with posts in the other four (spacers need a screw each). The parts list counts them and says how long they need to be. *Screw covers* (screwed through posts) adds a snap-on cap over each screw head.
  - **Or without screws in the wall** (rectangle boards, *Hang it*): on a **French cleat** (a board cleat and a wall cleat as thick as the gap, split to fit the bed, both printed with the 45° face up), **over a door** on two hooks (three over 700 mm wide; *Door thickness*), or **on a desk**, standing in feet with a groove for its bottom edge or clamped to the desk's back edge with an M6 bolt. Each part screws to the board from the front through countersunk holes; the posts left become rests.
- **Frame** (rectangle boards): rim strips round the front border (tiles print face down, so the rim is separate flat strips with pins, pressed into holes in the border and glued; cut to fit the bed, clear of the seams, so they also hold the tiles in line), and with *LED* a channel round the back edge for a strip (8, 10 or 12 mm) that lights the wall behind.
- **Solid zones** (rectangle boards): areas with no slots, snapped to the lattice, blank, with **text** engraved in the front, or with 6 × 2 mm **magnet** pockets from the back for knives and bits (the parts list counts them). Attachments can't use their slots.
- **Printing:** every tile prints face down, so the front is the side on the bed, and the slots and countersinks open toward the bed with a chamfer; a rectangle tile's number is debossed on the back. *Spread pieces* pulls the tiles apart in the 3D view. The assembly map shows the tiles as seen from the front, with the steps: tabs into sockets, plates into pockets (a drop of glue makes it one board), screws into the wall.
- **Colours:** tiles print in the *Wall grid* role's colour, joint plates and spacers in *Connector keys & spacer strips*.
- **The 3D view** shows the board face up, as it hangs (the wall's up is away from you), with its attachments standing on it.

#### Attachments

The *Attachments* tab puts things on the board: pick one from the list and it goes on the first free spot; drag it on the board (the left pane, the board from the front, every slot drawn) or in the 3D view and it snaps to slots where all its mounts fit; drag the handles on the selected one's edges and corner to make it wider or taller (the options that size it change with it, in whole slots). Its options are on the left; they print with the bins, on plates of their own (*Board attachments 1*, …).

Attachments stay where you put them: one whose mounts don't all find slots there shows red (in the board view and the 3D view), and the planner offers the nearest spot where it fits, clear of the others when it can (*Move to the nearest spot that fits*, in its panel and over the board). Select several with Shift- or Ctrl-click, by dragging a box over the empty board, or Ctrl+A; drag any of them (on the board or in the 3D view) and they move together by whole slots, keeping their places to each other. Arrow keys nudge the selection a slot, Delete removes it, and Ctrl+C / V / D copy, paste (at the pointer, beside the originals, or on another board where they were) and duplicate. With several selected the panel lines them up by their edges or centres and spaces them out evenly, as near as the slots allow, and light guides show while dragging where edges line up and how far it is to the neighbours. Each of these is one undo step.

- **One mount standard, made for this board.** Every attachment holds on the same way, sized from the board it's for (its thickness, slot size, and the fit picked under *Fit*), so it fits the board as printed:
  - **Clips** for parts printed upright, as they hang (bins, cups, …): a peg as tall as most of a slot, split down the middle, a barb on each half. It pushes straight in, the halves spring out behind the board, and the part drops onto the bottoms of the slots; lifting it doesn't free it. It stands up from the bed, so the halves flex along the layers, and its underside rises at 45°, so no supports.
  - **Hooks** for parts printed on their side (hooks, brackets, arms): the classic pegboard hook, a lip that drops behind the board below its slot; its profile lies on the bed, so the arm is strong. The lip closes in toward the neck, so the part drops on easily and its weight pulls it snug, and each hook sits flush with its part's top.
  - **Studs** in the slots two below keep a tall or heavy part from tilting.
  - Clips go every 40 mm across the top row, studs 40 mm below them, all on the lattice. A clip reaches 2.3 mm behind the board, so the board needs its standoffs (a warning says so).
- **Mounting options** (every kind, above its own options):
  - **Lock keys** (on by default for parts with hooks: parts lifting off is the most common complaint about printed pegboard parts): a small printed plug pushed into the slot over each hook's neck, with a flange and pull tab on the board and crush ribs to hold it.
  - **Bolt it on**: an M3 or M4 countersunk screw through a free slot behind the part's back into a printed T-nut with a captive nut, for heavy things; the screws and nuts go in the bill of materials.
  - **Barbs** on the end clips only, for wide parts that are hard to push on, and a **Label** cut into the kind's front.
- **Fit:** *Snug*, *Normal* or *Loose*. Print the **Fit test** first: named tabs, one notch per step looser, or a five-step slot-width ladder; keep the fit of the one that clicks in and holds. Its numbered **gauge** (4.6–5.6 mm) measures the board's real thickness (boards vary): set *Thickness* from it. A **label tag** is a small card that clips into any slot.
- **What hangs on it** — 56 kinds; the picker groups them and searches them, and most have presets for real products (*For*: pick one and its sizes are set; measure yours when it says so):
  - **Build your own** (*Start here*): a back plate in whole lattice steps and a side profile you draw in front of it, extruded across its width: most pegboard parts are just that. Start from a ledge, lipped tray, J-hook, U-cradle, tilted tray, L-bracket or angled tool holder and drag its points on a 1 mm grid (edges snap to 15° steps; double-click an edge to add a point, Delete removes one); a move that would cross edges or pull it off the plate is refused, and walls under 1.6 mm are ringed. It prints upright, on clips, when every edge facing down is 45° or steeper or on the bed and it stands steady, else on its side, the profile flat on the bed and a hook at its left, where any shape prints; edges that would need support upright show red, and you can pick the pose yourself. Holes, slots, rectangles, hex holes, finger notches and text go on any flat face, one or a row or grid, dragged into place on a drawing of the face: through holes go as deep as the wall under them, and holes that lie on their side as printed get teardrop tops. Add a front lip, end walls or 45° gussets and dividers; a label goes on its front-most face, and what it's meant to hold is what its upward faces carry, as a shelf's.
  - **Hooks, bins and cups:** hooks (J, L, U, double, peg), a **folding hook** or cup holder that folds flat against the board, a **glasses rest**, bins (a lower front, dividers, a label ledge), cups and rings.
  - **Gridfinity on the wall:** a **Gridfinity shelf** of baseplate receptacles (1–10 × 1–4 cells, magnets, flat or tilted 15° / 30°, a front lip; it prints upright with no supports, braced by a cheek at each end, the lip and a fillet, and studs in every slot below against the sag and tilt such shelves are known for), a **wall plate** (bins with magnets stick to it) and a **bin lip clip** that hangs one bin by its stacking lip or on a cradle.
  - **Storage rail** ("infinite storage"): a rail of 2–14 units (40 mm, or 42 to line up with Gridfinity), up to three stacked, with bins or drawer sleeves of 1 × 1 to 3 × 1 units that slide on and click into place at every unit; the containers hook behind the rail's lip and tuck under its flare, 0.2 / 0.3 / 0.4 mm clear at the snug / normal / loose fit, so they can only slide along. Rails with open ends butt together into runs longer than the bed (at 40 mm units the units line up with the slot columns; a run sits between the seams of a tiled board, as a seam column has no slots).
  - **Closed and moving storage** (separate parts joined by pins, each printed without support, shown closed in the 3D view): a **tip-out bin** (1–4 in a frame, tipping out on pins to a stop at 30–60°), a **box with a lid** (sliding, hinged with a magnet catch, or a drop-front flap), a **cabinet** with a hinged door, shelves and a window, and a **swivel tower** of trays that each swing out on an upright axle. Pins are printed (⌀4, the head sunk flush) or a 3 mm steel rod.
  - **Shelves and racks:** a **shelf** (rectangular, rounded, half a hexagon or half round; a lip, side walls or gussets, drain slots), a **roll holder** (towels, tape, foil, a filament spool), a **slot rack** (a vertical file for build plates, laptops, tablets, cutting boards, lids, mail, quilting rulers), a **bottle & pot rack** (rows of cups stepped up toward the back like stadium seats and leaning toward you: dropper bottles, Citadel and Pro Acryl pots, Tamiya jars, spice jars, spray cans, test tubes) and a **pen & brush rack** (one size in staggered rows, or a list such as a set of knitting needles).
  - **Tools:** a **tool rack** (a ledge the tools hang through, from a typed list of sizes: screwdrivers, pliers, wrenches, 1/4″ bits, hex keys, sockets on square posts, a drill index with each size engraved), a **tool holster** (a ring a drill, glue gun, soldering pen, hair dryer or spray bottle drops into nose down; a heat-safe mode with ribs and air between), a **handle gripper** (C-clips for broom handles, flashlights, a pump), a **magnetic tool bar** (magnets glued in from the back, or sealed under a skin at a pause in the print: the notes give the height), a **measuring tool hanger** (calipers, squares, rulers, tape measures), a **clamp rack**, a **clip tab** for belt and pen clips, a **battery dock** for power-tool packs (on slide rails like the tool's foot, by the stem, or in a pocket; brands don't publish their rails, so the presets are starting points and it prints three fit coupons to try first), a **drill dock** and a **charger cradle**.
  - **Devices:** a **device holder** (a pocket the device's size plus 0.5 mm all round: Steam Deck, Switch, phones, tablets, meters, label printers, a network switch, a MagSafe puck…), a **headphone & controller hanger** (a wide curved saddle so the headband doesn't dent, or a yoke for a guitar, ukulele or game controller), a **card and media block** (SD, microSD, CFexpress, USB sticks, game cards, picks, business cards) and a **lead hanger** (test leads, probes, USB, XLR: the cable slides into a slot, the plug drops into a pocket).
  - **Hobby, kitchen and display:** a **battery dispenser** (a chute per column loaded from the top, the bottom cell rolling out onto a tray: AA to D, 9V, 18650, 21700, coin cells), a **spool rack** (wire, solder, washi tape, ribbon, filament on bearings; or pegs for thread), a **box sleeve** (gloves, tissues, foil, zip bags, sticky notes, index cards), a **lift-off caddy** that hangs on 45° cleats and goes to the bench, a **planter** with a twist-out saucer (or a test-tube rack for cuttings), a **display ledge** (LEGO or Duplo studs with a fit coupon, miniature bases, die-cast cars, collectible steps) and a **faceout** arm with notches and a label plate.
  - **Lighting and cables:** an **LED light bar** (8, 10 or 12 mm strips aimed out or down, a snap-in diffuser in clear or white PETG), **cable clips**, a **cable channel** with a snap-on lid, a **power strip holder** and a **cable comb**.
  - **Adapters and mounts:** a plate of **other systems' heads** (Multiconnect at 25 or 28 mm, openGrid's openConnect, Multipoint) so their accessories hang on this board; a **1″ pegboard plate** for metal pegboard and locking hooks; a **French cleat strip** with a matching hanger; a **DIN rail** (TS35); a **device mount** on a tilting arm (a 1/4″-20 or 3/8″-16 stud, 5/8″-27 for microphones, GoPro fingers, an Arca-Swiss seat, a cold shoe); and the **adapter plate** (screw holes, zip-tie slots, magnet pockets, a tape recess, or VESA 75 / 100, Raspberry Pi and 2.5″ drive patterns).
  - **Your own model** (*Other*) hangs anything you've downloaded. Choose an STL, 3MF or OBJ in its form and it's read like an imported bin: the mesh stays in this browser and in saved project files, never in the project itself, and a share link carries a box of its size in its place. Pick which face of the file goes against the board, or let it take the face with the most flat back, then turn and scale it. *Clips on its back* fuses clips and studs straight onto the model, only where its back is flat and solid; *A back plate* puts it on a 3 mm plate with clips that fills in behind a curved or uneven back, never steeper than 45°. It prints standing as it hangs: the clips and the plate need no support, but the model's own overhangs may.
  - **Shadow boards from a photo:** trace your tools from a photo on a sheet of paper, or import their outlines from an SVG or DXF file (or take them from the tool library), and a *Shadow board* cuts each outline 1 mm into a plate that clips on, so you see what's missing. Lay them out standing up or lying across, or keep them where they were in the file. Hold each tool with two pegs under it, a ledge it drops into, magnets in its shadow, or nothing; add finger notches, the tools' names, and the shadows filled in a second colour. It prints upright with nothing to support: every cut's top slopes back at 45° and the pegs stand on 45° gussets. A *Holder for a traced tool* is a tray tilted 45° toward you with the tool's own outline as its pocket. The outlines are simplified to at most 300 points on a 0.1 mm grid, 12 to a board, so a full board is still a short share link.
  - Extra parts (containers, drawers, lids, doors, a diffuser, a rod, lock keys, T-nuts, fit coupons) print alongside and show in place in the 3D view. The parts list counts what to buy: magnets, the LED strip, dowels, pins, screws and nuts, zip ties, straps.
- **Starter boards and what's on them:** *New: board from a template…* in the drawer menu (or *Start from a template* on an empty board's Attachments tab) gives a ready board in one click: a 3D printing corner, an electronics bench, a paint station, a kitchen wall, garage tools, a desk & gaming board or craft & sewing, each a board (built from tiles, enough to hold it all) and a set of parts from the presets, every one placed on slots where it fits. On a board that has parts already it asks whether to replace them or add the new ones where they fit, and says what had no room. Every attachment has a *What's in it* list like a bin's: the top-bar search, the contents list and its CSV find board parts too, and a result opens the board with the part selected. The drawer map draws each board from the front with every part numbered and what's in it. *Label from what's in it* cuts the part's one item (or a few short ones, or the first) into its label face.
- **Two colours:** an attachment's label can be cut in, raised 0.6 mm, or inlaid (cut in and filled flush), and a label tag's text the same; a board's text zones can be engraved or inlaid, the inlay filling the tile's first layers on the bed. Raised and inlaid text is a body of its own in the *Board & attachment text* colour (Print plates › Colours; it follows the label text), so the 3D view, the plates and the Bambu project print it in its own filament; with multi-colour off, inlaid text prints in filament 2 like inlaid bin labels, and raised text with the part. Attachments have a colour of their own too (*Board attachments*, following the bins).
- **What it holds:** every attachment shows a rough estimate of what its mounts take. The slots' edges carry its weight down; against the load's lever about the part's foot, the clips' legs (bending in the plane of their layers until the barbs let go), the hooks' lips and any bolt pull back, each at its height. So more clip columns and a taller back hold more, and a load further out holds less. Stresses are typical datasheet strengths along and across the layers, times what the filament keeps under a load that never comes off (PLA creeps most), over a safety factor of 3, rounded down and said as "about". Kinds say what they're meant to hold (a drill dock 2 kg a tool, a guitar 4.5 kg, a shelf 1 kg a square decimetre…); when that's more, planning warns and names the fixes that alone would do: print it in PETG, turn on *Bolt it on*, or make it N mm tall. Each attachment's *Printed in* option picks PLA, PETG or ASA.
- **My attachments** is a library of a board's parts of your own, set up the way you like them, there for every board in every project (like My bins, it stays in this browser, not in the project file). **Save to My attachments…** under the selected part keeps its kind and every option, its name, lock keys, bolt, label, barbs, material and filament, and (if you like) what's in it; several selected save as one set, their places to each other kept in whole slots, so a set goes on any board as it was arranged, whatever its slot spacing. They come first in the picker, under *Mine*, each with a front view, and the picker's search finds them; **Add** puts one on the first free spot that fits, a set kept together (one undo step). Click one to rename, duplicate, delete (with undo) or **Copy share link**: the entry, compressed, in the link itself (nothing is uploaded; an imported model goes as a box of its size). Opening such a link offers **Add to My attachments** and **Put on this board** (a new board just big enough when the open drawer isn't a board). **Export file** and **Import file…** move the library between browsers: importing adds only what isn't there yet, the newer copy of the same entry wins, and a name that's taken gets a number. A part of a kind this version doesn't know (saved by a newer one) is kept, shown greyed out, until the page updates.
- **Holding a bin you designed:** a *Bin lip clip*, *Gridfinity shelf*, *Gridfinity wall plate* or *Box sleeve* can hold one of the project's bins: pick it under *Holds* in its form (the project's bins, drawer by drawer, with their labels and what's in them). It's then sized from that bin: the clip to its width and height (on the cradle when the bin has no lip or isn't a whole number of units tall), the shelf and the plate to its footprint, the sleeve to its outside. Those options show as set by the bin, and the board editor's handles leave them alone. Change the bin and the holder follows, in the board editor, the 3D view and the print; the bin's own panel says which board it's *Held on*, with a way there. Delete the bin (or its drawer) and the holder keeps its last size, with a note; *Unlink* sizes it by hand again. Linking and unlinking are undo steps, and the link goes in project files and share links (one to a bin that's gone is left out).
- **Checks:** an attachment whose mounts find no slots where it is turns red and says so; two that overlap are named; one reaching out more than three times as far as its back is tall, or meant to hold more than its mounts take, gets a warning; the parts list counts them.

**Adding a kind** (developers): three files in `src/lib/wall/kinds/`: `<kind>.ts` registers its planning (options and their cleaning, size on the wall, mounts, print pose: `registerAttachment`), `<kind>.ui.ts` its name, description, picker group and form (`registerAttachmentUi`), `<kind>.geom.ts` its body in the part's frame (the mounts are added for it). List them in `src/lib/wall/kinds/all.ts`, `ui.ts` and `build.ts`; `tests/wall.test.ts` then builds and print-checks it with the others. The kinds' planning loads with the first board (`ready.ts`), not on the first screen, and their builders reach `buildMesh` from the geometry worker (`setWallBuilders`). `backMounts()` places the mounts across a part's back; extra parts (`parts()`) can say where they sit (`place`) to show in the 3D view; a `'preset'` field sets several options in one pick; `labelFace` and `backPlate` on its def say where a label goes and where a bolt can go (without them the Label field is hidden and bolts go beside the top clips); keep the planning file lean (it loads with every board). A kind can bring coloured inlays of its own: its builder returns `{ body, inlays }` (split off flush with `splitInlay`, `geometry/inlay.ts`), each with a colour role, and `AttachmentDef.inlaid` tells planning when they need filament 2; `AttachmentDef.load` says what it's meant to hold (`wall/load.ts`); `AttachmentDef.follow` lets a kind hold a bin: given the bin's cells, units, outside and lip (`HeldBin`), it returns the options the bin sets (`wall/follow.ts`).

**Old projects.** Projects saved before attachments stayed where they're put (project files before version 4, share links and the browser's autosave) open as they were: a part whose saved slot no longer fits it (made wider, or a pair, after it was put on) is planned on the nearest slot where it fits, as it was then, until it's moved; from then on it stays where it's put like any other. The tests open projects and share links saved by three older versions (the first boards, the first attachments, and the round of tiles and templates part way) and check every board, attachment, warning and part comes back the same.

#### Printing only what changed, on boards

A board's parts go into *Only what's changed* just as bins do. Each is known by what shapes it: an attachment by its kind, options, label and the slots it clips into; a tile by its outline, slots, joints and number. Where it hangs, its name and its id don't count. Moving or renaming a part reprints nothing. Resizing one reprints it, and its lid or container if they change too. A new slot fit reprints every attachment, and a new board thickness the tiles as well. Alike parts are prints of one part, so a third hook, one more hexagon, or more joint plates and screw covers print only the new ones; door hooks, cleats and frame strips count as the same part wherever they sit on the board. Rectangle tiles are numbered in the order they're added and keep their slots when one goes on to their left or below, so adding a tile reprints only the tiles it joins. The board's editors show a ✓ on printed parts and a dot on ones changed since, and the Print panel lists what has changed and what is new.

#### The whole wall

**Wall planner** in the drawer menu lays out the project's boards and wall grids on one wall. Give the wall's width and height and mark what's in the way (*Window*, *Door*, *Socket*, *Light switch* or anything else, each with its place and size), then drag the boards onto it from *Not on the wall yet* (or *Place* / *Place all*: the first free spot from the top left). Each keeps the size its own tab gives it and is drawn with its tiles, slots and attachments (a wall grid with its cells, pieces and bins); dragged, it snaps to the wall's edges and to the other boards' and obstacles' edges, the *Gap* apart or lined up, and the arrow keys nudge it 10 mm (Shift: 100). One that runs off the wall, covers something in the way or overlaps another turns red, and *Check* says so. Click an empty spot (or drag out an area) to add a board there: a Skådis board filling it, the biggest that prints as one tile, or a wall grid; it opens on its own tab. The 3D view shows every board on the wall with what hangs on it, and *Print everything on this wall* opens the Print tab with those drawers chosen. The wall is saved with the project (files and share links too), and every change undoes.

**Plan on a photo of the wall:** *Add a photo…* in the planner puts one behind the plan. Put its four handles on the wall's own corners (it's as big as you measured it), or on a sheet of A4 or Letter taped to it, upright or across, which is found in the photo to start with; say where the sheet's bottom-left corner is on the wall, or *Move it* and drag the photo until it lines up with what you marked. The corners correct the perspective and the known size gives the scale, so the photo is straightened onto the wall's millimetres (and can reach past it); the wall, a half-metre grid and what's in the way are drawn on it as you go, to check by eye. It shows behind the boards in the front view and as the wall in the 3D view, with an opacity slider and *Show it behind the boards*. Photos are kept at most 2048 px on their long side, in this browser and in saved project files; share links leave them behind (opening one says so, and picking the same photo again lines it up as it was). Putting one up, lining it up again, moving it and taking it away each undo.

#### openGrid and Multiboard boards

The drawer menu's **New: openGrid board** and **New: Multiboard board** make boards for those systems' own snaps and accessories, sized in squares and split into the fewest tiles that fit the bed (`lib/gridBoards.ts`, `geometry/opengrid.ts`, `geometry/multiboard.ts`). openGrid's follow its published numbers: 28 mm squares, Full 6.8 or Lite 4 mm, openings 25 mm at the lips with the undercut behind, squares turned 45° at the crossings and the corners cut 4.2 mm. Connector holes run along the seams, the connectors that click into them print with the tiles, and screws go through countersunk holes at the crossings. Multiboard doesn't publish its dimensions, so its board uses measured ones, each an option: 25 mm octagons, large holes 21.4 / 23.4 mm across, ⌀6.1 peg holes, 6.4 mm thick. The big and small threads are optional, teeth lock the tiles together, and screws go through countersunk peg holes. Print the 2 × 2 test tile first. Both print with an assembly map and their screws on the bill. Gridfit's attachments are for Skådis-pattern boards: the board's Attachments tab says so, and points to the adapter plate for the other way round.

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

**Skådis boards** (`src/lib/geometry/skadis.ts`, rim strips and hanging parts in `skadisParts.ts`): 5 × 15 mm slots on a 20 mm lattice (every lattice point whose column and row add up to an even number), a 5 mm board, 0.6 mm chamfers. Joint plates 20 × 20 × 1.4 mm with ⌀5 pins 2.3 mm long, in 1.5 mm pockets (0.2 mm clear round) with ⌀5.3 holes 2.5 mm deep. Dovetail tabs 8 mm long, 8 mm wide at the seam and 12 at the end, 0.15 mm clear in their sockets. Posts ⌀13 at the board, ⌀10 at the wall.

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
- **On first use:** the Bins and Print plates panels (My bins comes with the Bins panel; the bin grid only has a slot for its drop preview, `gridLayers.ts`), the compartment and tool-cutout editors, the trace dialog (the SVG / DXF readers load with the first file), *Fill from a list* (with `src/lib/autofill`), the drawer map and the STEP assembly layout, a Skådis board's panel and its tile editor, Skådis boards' planning and the attachments' kinds and placing (with the first board), the custom builder's profile editor, My attachments (with the Attachments tab), the wall planner and the wall's photo (with the first one), the starter boards, the import dialog with the STL / 3MF / OBJ readers, the mesh store (IndexedDB), and the share-link codec (when a link is opened or copied). The tabs and editors also load in the background once the first mesh is on screen, so switching is instant. A returning visitor's saved tab (Bins or Print plates) gets its panel preloaded from `index.html` (`scripts/preload.ts`).
- **Boards:** Skådis boards' planning (`src/lib/skadisBoardPlan.ts`, with `geometry/skadis.ts` and the attachments' placing in `wall/plan.ts`) loads with the first board, as openGrid boards' does. Until it's in, a board plans bare and the app plans again when it arrives (`skadisBoards.ts`). The first screen keeps only a board's options and their cleaning (`geometry/skadisOptions.ts`) and the slot math for dragging attachments in the 3D view (`wall/board.ts`). The geometry worker hands the boards' builders to `buildMesh` (`setSkadisBoardBuilders`, `geometry/skadisBuild.ts`), as it does the attachments'. The divider-wall tools load with the compartment editor.
- **Geometry worker:** its entry (`geometry.worker.ts`) is tiny. It starts downloading and compiling the Manifold WASM at once, while the mesh code (`meshes.ts`) loads beside it. The file writers, zips and the slicer (`writers.ts`) load on the first export or print-time estimate. The label font loads with the first mesh that may have text (baseplate pieces and Skådis tiles never do), or once the WASM is ready; the page loads its own copy when a label preview or a print check needs it, and for the bin grid's check marks only after the first view.
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
src/lib/geometry/skadis.ts    Skådis pegboards: the slot patterns, tiles split to the bed, hexagons, joints, mounting, frame, zones, the tiles' solids;
                              skadisTiles.ts boards built from tiles; skadisOptions.ts its options; skadisBuild.ts its builders for the worker
src/lib/geometry/opengrid.ts, multiboard.ts  openGrid and Multiboard tiles (lib/gridBoards.ts, gridBoardPlan.ts their planning)
src/lib/geometry/skadisParts.ts  rim strips, cleats, door hooks and desk feet / clamps for a board
src/lib/wall/                 what hangs on a board: the mount standard (mount.ts), what each needs (plan.ts), placing on slots (place.ts),
                              into a print job (parts.ts), what it holds (load.ts), starter boards (templates.ts), holding a bin (follow.ts),
                              the custom builder's profiles (custom/), the kinds (kinds/); lib/myAttachments.ts the My attachments library
src/lib/wallPlanner/          the whole wall: boards and what's in the way on one wall, snapping, checks (state/wallPlanner.ts); photo.ts its photo
src/lib/enclosures.ts         carry cases, wall grids, spacer strips: their pieces, extra parts and drawer view; skadisBoardPlan.ts plans Skådis boards
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

Gridfinity was created by [Zack Freedman](https://www.youtube.com/c/ZackFreedman). The dimensions come from gridfinity-rebuilt-openscad (MIT). Several options follow other community projects: Gridfinity Extended (lip styles, efficient floor, wall cutouts, pocket grids, half-pitch grids), Gridfinity Refined (side-loaded magnets), GridFlock (pin and puzzle joints), cq-gridfinity, and Tracefinity (tool tracing). Skådis boards follow MOSS 3D's Fully Customisable Skadis Pegboard Generator (seams through the pattern, plates on the back) and Azntek's Hexagonal Skadis board. The attachments take ideas from the community's pegboard accessories and generators: Play Conveyor's Cargo storage (the storage rail), the Multiconnect and openGrid connectors (their heads' published sizes), Gridfinity-on-pegboard shelves and lip clips, Underware cable channels, and parametric generators such as skapa, QuackWorks and gridfinity_extended (presets and fit coupons); no code or models are copied. The QR encoder follows Project Nayuki's QR Code generator (MIT). The label font is Roboto Condensed (SIL Open Font License, `public/fonts/RobotoCondensed-OFL.txt`).
