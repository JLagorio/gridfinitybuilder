import { baseplateHeight, type BaseplateOptions } from './geometry/baseplate';
import { binLabel, binSize, binTotalHeight, sanitizeBin, type BinOptions } from './geometry/bin';
import { connectorKeySize, connectorSites, jointSteps, pieceProtrusion, sitesOnPiece } from './geometry/connectors';
import { DEFAULT_DRAWER, computeLayout } from './layout/drawer';
import { packPlates, type PackItem } from './layout/pack';
import { pieceFootprint, type PrintSetup } from './layout/plan';
import { makePieces } from './layout/split';
import { binSpec, pieceMeshKey, type JobPart, type MeshSpec, type PrintJob } from './project';

/**
 * A small kit to check tolerances before printing everything: a 2 × 2 cell
 * baseplate sample with the drawer's baseplate settings and one 1 × 1 bin with
 * the new-bin settings. With connectors on, the sample is split down the
 * middle so one key crosses the seam (a 2 × 1 sample has no wall crossing its
 * seam, so it would get no key). Planned like a normal job, so every exporter works.
 *
 * On a half grid (`pitch.halfGrid`) the sample is 3 × 3 half cells (1.5 × 1.5 u)
 * and the bin is 1 × 1 u on 2 × 2 half feet, so it can be tried at a half-cell offset too.
 *
 * `o.haveBaseplate` (a "Just bins" drawer, DrawerInput.haveBaseplate): the
 * baseplate is there already, so the kit is just the bin, to try in it.
 */
export function planTestFit(
  baseplate: BaseplateOptions,
  bin: BinOptions,
  setup: PrintSetup,
  pitch: { x: number; y: number; halfGrid?: boolean } = { x: 42, y: 42 },
  o: { haveBaseplate?: boolean } = {},
): PrintJob {
  const half = !!pitch.halfGrid;
  const layout = computeLayout({
    ...DEFAULT_DRAWER,
    mode: 'grid',
    gridX: half ? 1.5 : 2,
    gridY: half ? 1.5 : 2,
    pitchX: pitch.x,
    pitchY: pitch.y,
    ...(half ? { halfGrid: true } : {}),
  });
  const split = baseplate.connector !== 'none' && !o.haveBaseplate;
  const pieces = o.haveBaseplate ? [] : makePieces(layout, split ? [0, layout.xs[1], layout.plateW] : [0, layout.plateW], [0, layout.plateD]);
  const sites = connectorSites(layout, pieces, baseplate);
  // Only bowtie joints print keys.
  const connectors = baseplate.connector === 'bowtie' ? sites : [];

  const parts: Record<string, JobPart> = {};
  const meshes: Record<string, MeshSpec> = {};
  const items: PackItem[] = [];
  const add = (part: JobPart, spec: MeshSpec) => {
    parts[part.key] = part;
    meshes[spec.key] = spec;
    items.push({ key: part.key, w: part.w, d: part.d });
  };

  for (const piece of pieces) {
    const mine = sitesOnPiece(sites, piece);
    const meshKey = pieceMeshKey(layout, piece, baseplate, mine);
    const side = pieces.length > 1 ? (piece.col === 0 ? ' (left)' : ' (right)') : '';
    add(
      {
        key: `piece:${piece.id}`,
        name: `Test-fit baseplate${side}`,
        kind: 'piece',
        meshKey,
        ...pieceFootprint(piece, pieceProtrusion(baseplate)),
        h: baseplateHeight(baseplate),
        pieceId: piece.id,
      },
      { kind: 'piece', key: meshKey, layout, piece, opts: baseplate, connectors: mine },
    );
  }
  if (connectors.length) {
    const meshKey = `key|${baseplate.connector}`;
    connectors.forEach((_, i) =>
      add(
        { key: `key:${i + 1}`, name: `Connector key ${i + 1}`, kind: 'key', meshKey, ...connectorKeySize() },
        { kind: 'key', key: meshKey, opts: baseplate },
      ),
    );
  }
  const n = half ? 2 : 1;
  const testBin = { id: 'test-bin', x: 0, y: 0, opts: sanitizeBin({ ...bin, unitsX: n, unitsY: n }) };
  const spec = binSpec(layout, testBin);
  const size = binSize(testBin.opts, spec.cells);
  add(
    {
      key: `bin:${testBin.id}`,
      name: `Test-fit bin ${binLabel(testBin.opts, spec.cells)}`,
      kind: 'bin',
      meshKey: spec.key,
      w: size.w,
      d: size.d,
      h: binTotalHeight(testBin.opts),
    },
    spec,
  );

  const packed = packPlates(items, {
    bedW: setup.bedW,
    bedD: setup.bedD,
    margin: setup.plateMargin,
    spacing: Math.max(setup.spacing, 2),
    nest: true,
  });
  const warnings = packed.oversize.map((o) => `${parts[o.key].name} is larger than the print bed.`);
  const plates = packed.plates.map((pl, i) => ({
    name: packed.plates.length > 1 ? `Test-fit kit ${i + 1}` : 'Test-fit kit',
    group: 'baseplate' as const,
    placements: pl.placements,
  }));
  const plan = {
    pieces,
    plates: packed.plates.map((pl) => ({ placements: pl.placements.filter((p) => p.key.startsWith('piece:')) })),
    cols: split ? 2 : 1,
    rows: 1,
  };
  return {
    layout,
    plan,
    connectors,
    sites,
    drawers: [
      {
        id: 'test-fit',
        name: 'Test-fit kit',
        layout,
        plan,
        connectors,
        sites,
        steps: jointSteps(baseplate, baseplate.connector === 'bowtie' ? 0 : sites.length),
        plateOffset: 0,
        plateCount: plates.length,
        ...(o.haveBaseplate ? { haveBaseplate: true as const } : {}),
      },
    ],
    parts,
    meshes,
    plates,
    warnings,
  };
}
