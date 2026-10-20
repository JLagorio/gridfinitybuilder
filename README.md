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

1. **Drawer & baseplate.** Enter the inside width and depth of the drawer, in mm or inches (`20 1/8 in` works). Gridfit fits as many 42 mm cells as possible. The leftover space becomes a solid margin, placed wherever you choose (centered by default). Options:
   - magnet pockets (top- or bottom-loaded, push-out holes)
   - countersunk screw holes
   - extra floor
   - outer corner radius
   - top-ridge trim
   - bottom chamfer
   - bowtie connectors: pockets in the underside wherever a wall or a solid margin crosses a seam, plus one key per pocket. The keys print in the free space next to the pieces. Lay the pieces upside down, press the keys in, then turn the baseplate over into the drawer.
2. **Bins.** Drag across empty cells to draw a bin, click to select it, drag to move it, press Delete to remove it. Each bin has:
   - height in 7 mm units, or as an inside depth or overall height in mm
   - stacking lip: normal, reduced (Gridfinity Extended) or none, with optional anti-slide notches at the cell lines
   - optional stacking lid, printed as its own part: feet that sit in the lip, and a receptacle per cell on top
   - base: standard, lite (hollow feet, gridfinity-rebuilt "lite"), efficient floor (Gridfinity Extended) or flat (no feet)
   - compartments: columns × rows, presets, or walls you place yourself (below)
   - finger scoop
   - label tab (full, left, mid, right)
   - magnet or screw holes, or Gridfinity Refined side-loaded magnet slots; optional crush ribs, chamfered mouths, printable hole tops (no supports) and corner-only holes
   - wall cutouts, finger slides and a hex wall pattern, per wall
   - or, instead of compartments, a pocket grid for batteries, coin cells, memory cards, hex bits or screws (or custom round, square or hex pockets), fitted automatically
   - rounded inside corners

   "Fill empty with 1×1" fills the rest of the drawer.

   **Compartments.** Select a bin and switch the left pane to *Compartments*. Hover inside the bin to see the wall a click would add; it runs wall to wall and snaps to 50 %, thirds and quarters of the space it splits (and of the whole bin), to other walls and to the 42 mm cell seams. Hold Shift to flip its direction, R to lock it, Alt to turn snapping off (1 mm or 1/16″ steps). Drag walls to move them, drag a selected wall's end handles to attach it to a different wall (for L-shaped compartments), click a size to type it (`44.5`, `1 3/4in`). Walls placed by snapping stay proportional when the bin or a neighbour changes; typed sizes stay fixed. The sidebar splits a compartment into equal parts, by ratio (`1:2:1`) or by minimum size, and sets each wall's height (lowered so fingers reach over, or removable: a slide-in plate in slots) and each compartment's scoop, label tab and floor height.

   Shift- or ⌘/Ctrl-click bins, or Shift-drag a box (or drag from outside the grid), to select several; drag them, nudge them with the arrow keys, copy and paste (⌘C / ⌘V pastes at the cell under the pointer), duplicate (⌘D) or delete them together. Drag the handles of a selected bin to resize it. **Templates** save a bin's settings by name; apply one to the selected bins or to new bins, in any drawer.
3. **Print plates.** Pick the printer (the Bambu Lab P2S is the default, and bed sizes come from Bambu Studio's own profiles). Gridfit splits the baseplate on cell boundaries, so every receptacle stays whole. It then packs pieces and bins onto plates. Exports:
   - **Bambu Studio project (.3mf):** every plate in one file, with the printer, *0.20mm Standard* process and *PLA Basic* filament preselected. Open it and press **Slice all plates**.
   - **Plates as 3MF (.zip):** one plain 3MF per plate for any slicer, plus `assembly-map.txt` showing which piece goes where.
   - **Plates as STL (.zip):** one binary STL per plate, parts already arranged.
   - Any single plate or bin, as 3MF or STL.
   - **Test-fit kit:** a 2 × 2 baseplate sample (split with one connector key when connectors are on) and one 1 × 1 bin, on one plate, to check the fit and the magnets before printing everything.
   - **Save / Open project** as a `.gridfit.json` file. The project also autosaves in the browser. **Copy share link** puts the whole project, compressed, in the link itself (nothing is uploaded).

   The **bill of materials** counts magnets and screws (four holes per full cell; partial edge cells get none), connector keys, parts and plates, and estimates filament per plate from the mesh volumes: 1.75 mm PLA at 1.24 g/cm³, taking 90 % of the solid volume because the thin walls print almost solid. It downloads as CSV or text.

Every change to the project can be undone (⌘/Ctrl+Z, redo with ⇧⌘Z or Ctrl+Y). Press **?** for all keyboard shortcuts.

### Split strategies

- **Fewest plates** (default): tries every split that uses the minimum number of pieces and keeps the one needing the fewest print plates. Small pieces share a plate when they fit. For a 510.5 × 376.5 mm drawer on a P2S (256 mm bed, 10 mm edge margin) it needs 4 baseplate plates, against 6 when every piece prints alone.
- **Even pieces**: the same number of pieces, sized as evenly as possible.
- **Biggest pieces**: full-size pieces first, with leftovers at the end.

## Dimensions

The dimensions follow the community spec (gridfinity.xyz) as implemented by [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad):

- **Grid:** 42 mm pitch, 7 mm height units.
- **Bin base:** 41.5 mm per unit, 0.8 / 1.8 / 2.15 mm profile, top of floor at 7 mm.
- **Walls and dividers:** 0.95 mm walls, 1.2 mm dividers.
- **Stacking lip:** 0.7 / 1.8 / 1.9 mm.
- **Baseplate:** 0.7 / 1.8 / 2.15 mm receptacle with 0.35 mm bottom clearance (5 mm spec height). The top ridge is trimmed 0.4 mm by default so it prints cleanly.
- **Magnet holes:** 6.5 × 2.4 mm, 13 mm from the cell center. Crush ribs 5.9 mm inside, 8 ribs; refined slots 5.86 × 1.9 mm, 0.4 mm above the bed; printable tops bridge in 0.2 mm layers (all from gridfinity-rebuilt).
- **Bowtie connectors:** 10 mm long, 3 mm wide at the ends and 1.6 mm at the neck, 2 mm deep, with a 0.4 mm flare at the mouth. Keys are 0.15 mm smaller per side and 1.8 mm thick. A 3 mm pocket fits the 4.3 mm wall with 0.65 mm to spare on each side.

All constants live in `src/lib/geometry/spec.ts`.

## Development

```bash
npm test             # vitest: layout, splitting, packing, geometry validity, 3MF structure
npm run typecheck
npm run build
npm run sample -- out   # build a whole drawer kit from the CLI (default: the 510.5 × 376.5 drawer)
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
src/lib/geometry/   spec constants, shape helpers, baseplate + bin generators (Manifold)
src/lib/layout/     drawer → grid fit, bed splitting, plate packing
src/lib/dividers/   bin interior layouts: walls → compartments, edits, snapping (pure TS)
src/lib/export/     plain 3MF, Bambu Studio project and binary STL writers
src/lib/project.ts  ties it together: planJob() (cheap, no geometry) + exporters
src/lib/bom.ts      bill of materials; testfit.ts the test-fit kit; share.ts share links
src/state/          zustand store, undo history (history.ts), multi-bin selection, templates
src/worker/         geometry Web Worker + client with a mesh queue/cache
src/components/     React UI (three.js viewer, 2D bin layout editor, panels)
scripts/            CLI sample generator, Bambu settings baker
tests/              vitest suites
```

## Credits

Gridfinity was created by [Zack Freedman](https://www.youtube.com/c/ZackFreedman). The dimensions come from gridfinity-rebuilt-openscad (MIT).
