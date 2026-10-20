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
   - height in 7 mm units
   - stacking lip
   - compartments (columns × rows)
   - finger scoop
   - label tab (full, left, mid, right)
   - magnet or screw holes
   - rounded inside corners

   "Fill empty with 1×1" fills the rest of the drawer.
3. **Print plates.** Pick the printer (the Bambu Lab P2S is the default, and bed sizes come from Bambu Studio's own profiles). Gridfit splits the baseplate on cell boundaries, so every receptacle stays whole. It then packs pieces and bins onto plates. Exports:
   - **Bambu Studio project (.3mf):** every plate in one file, with the printer, *0.20mm Standard* process and *PLA Basic* filament preselected. Open it and press **Slice all plates**.
   - **Plates as 3MF (.zip):** one plain 3MF per plate for any slicer, plus `assembly-map.txt` showing which piece goes where.
   - Any single plate or bin.
   - **Save / Open project** as a `.gridfit.json` file. The project also autosaves in the browser.

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
- **Magnet holes:** 6.5 × 2.4 mm, 13 mm from the cell center.
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
src/lib/export/     plain 3MF and Bambu Studio project writers
src/lib/project.ts  ties it together: planJob() (cheap, no geometry) + exporters
src/worker/         geometry Web Worker + client with a mesh queue/cache
src/components/     React UI (three.js viewer, 2D bin layout editor, panels)
scripts/            CLI sample generator, Bambu settings baker
tests/              vitest suites
```

## Credits

Gridfinity was created by [Zack Freedman](https://www.youtube.com/c/ZackFreedman). The dimensions come from gridfinity-rebuilt-openscad (MIT).
