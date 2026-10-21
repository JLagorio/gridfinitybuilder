import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { billOfMaterials, bomCsv, bomText, enclosureCounts, enclosurePartsText, estimateNote, filamentNote, slowestPrinter, type Bom, type PlateBom } from '../lib/bom';
import { currencySymbol, estimateJob, formatDuration, formatMoney, type PlateEstimate } from '../lib/estimate';
import { DEFAULT_MOTION } from '../lib/printers';
import { planTestFit } from '../lib/testfit';
import { binLabel, sanitizeBin } from '../lib/geometry/bin';
import { findPrinter } from '../lib/printers';
import type { MeshSpec, PrintJob } from '../lib/project';
import { downloadBytes, geometry } from '../worker/client';
import { bambuSettings } from './bambuSettings';
import { NumberInput, Section, TextInput } from './fields';
import { jobPrinters, printerNames } from '../lib/layout/fleet';
import { setPrinterAt } from '../state/printers';
import { paletteOf } from '../lib/colours';

const subscribe = (cb: () => void) => geometry.subscribe(cb);
const version = () => geometry.getVersion();

/** Unique mesh specs of everything on the job's plates. */
function plateSpecs(job: PrintJob): MeshSpec[] {
  const out = new Map<string, MeshSpec>();
  for (const pl of job.plates) for (const p of pl.placements) out.set(job.parts[p.key].meshKey, job.meshes[job.parts[p.key].meshKey]);
  return [...out.values()];
}

/** Measured mesh volumes for a job; asks the worker for missing ones once edits settle. */
function useJobVolumes(job: PrintJob) {
  const v = useSyncExternalStore(subscribe, version);
  const specs = useMemo(() => plateSpecs(job), [job]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  useEffect(() => {
    const missing = specs.filter((s) => geometry.volume(s.key) === undefined && !geometry.volumeFailed(s.key));
    if (!missing.length) return;
    let live = true;
    const t = setTimeout(() => {
      setProgress([0, missing.length]);
      geometry
        .measure(missing, (done, total) => live && setProgress([done, total]))
        .catch(() => undefined)
        .finally(() => live && setProgress(null));
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
      setProgress(null);
    };
  }, [specs]);
  const lookup = useMemo(() => {
    void v;
    const snapshot = new Map(specs.map((s) => [s.key, geometry.volume(s.key)]));
    return (key: string) => snapshot.get(key);
  }, [specs, v]);
  return { lookup, progress };
}

/** Slice data for the job's meshes; asks the worker for missing ones once edits settle. */
function useJobStats(job: PrintJob) {
  const v = useSyncExternalStore(subscribe, version);
  const specs = useMemo(() => plateSpecs(job), [job]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  useEffect(() => {
    const missing = specs.filter((s) => geometry.printStats(s.key) === undefined && !geometry.printStatsFailed(s.key));
    if (!missing.length) return;
    let live = true;
    // After the volumes (700 ms), so the BOM's quick grams come first; a sliced plate's replace them.
    const t = setTimeout(() => {
      setProgress([0, missing.length]);
      geometry
        .slice(missing, (done, total) => live && setProgress([done, total]))
        .catch(() => undefined)
        .finally(() => live && setProgress(null));
    }, 900);
    return () => {
      live = false;
      clearTimeout(t);
      setProgress(null);
    };
  }, [specs]);
  const lookup = useMemo(() => {
    void v;
    const snapshot = new Map(specs.map((s) => [s.key, geometry.printStats(s.key)]));
    return (key: string) => snapshot.get(key);
  }, [specs, v]);
  return { lookup, progress };
}

export interface JobEstimate {
  /** Bill of materials with filament, time and cost per plate. */
  bom: Bom;
  /** The time estimate behind each plate's figures, null until its parts are sliced. */
  plates: (PlateEstimate | null)[];
  /** What the worker is busy with, if anything. */
  busy: { label: string; done: number; total: number } | null;
}

/** "33 min printing (walls 33 %, top/bottom skin 51 %, …) + 5 min start sequence" for a time cell's tooltip. */
function timeBreakdown(e: PlateEstimate | null | undefined): string | undefined {
  if (!e?.printSeconds) return undefined;
  const b = e.breakdown;
  const share = (v: number) => Math.round((100 * v) / e.printSeconds);
  const parts = [
    ['walls', b.walls],
    ['top/bottom skin', b.skin],
    ['infill', b.infill],
    ['travel', b.travel],
    ['layer cooling', b.cooling],
    ['filament swaps', b.swaps],
  ] as const;
  const shown = parts.filter(([, v]) => share(v) >= 1).map(([k, v]) => `${k} ${share(v)} %`);
  const swaps = e.swaps ? `; ${e.swaps} filament swaps, ${Math.round(e.wasteGrams)} g purged` : '';
  return `${formatDuration(e.printSeconds)} printing (${shown.join(', ')}) + ${formatDuration(e.prepareSeconds)} start sequence${swaps}`;
}

/** Filament, print time and cost of every plate of the job, for the selected printer and prices. */
export function useJobEstimate(job: PrintJob): JobEstimate {
  const setup = useStore((s) => s.setup);
  const volumes = useJobVolumes(job);
  const stats = useJobStats(job);
  const printer = findPrinter(setup.printerId);
  // Several printers (fleet.ts): each plate is timed on its own printer, and the BOM has each one's share.
  const ids = useMemo(() => (job.printers ? jobPrinters(setup).map((p) => p.printerId) : setup.printerId), [job.printers, setup]);
  // Multi-colour: each part's colours, the purge by colour, and the printer's slots (colours.ts).
  const plates = useMemo(() => estimateJob(job, stats.lookup, ids, setup), [job, stats.lookup, ids, setup]);
  const bom = useMemo(
    () =>
      billOfMaterials(job, volumes.lookup, {
        plates,
        overlayVolume: (key) => stats.lookup(key)?.overlayVolume,
        setup,
        printer: job.printers ? listNames(job.printers) : printer.name,
        ...(job.printers ? { printers: job.printers } : {}),
      }),
    [job, volumes.lookup, plates, stats.lookup, setup, printer.name],
  );
  const busy = volumes.progress
    ? { label: 'Measuring parts', done: volumes.progress[0], total: volumes.progress[1] }
    : stats.progress
      ? { label: 'Estimating print time', done: stats.progress[0], total: stats.progress[1] }
      : null;
  return { bom, plates, busy };
}

/** "A, B and C". */
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''));

const grams = (p: Pick<PlateBom, 'grams'>) => (p.grams === null ? '…' : `${Math.round(p.grams)} g`);
const meters = (p: PlateBom) => (p.meters === null ? '…' : `${(Math.round(p.meters * 10) / 10).toFixed(1)} m`);
/** "5.2 m" for a filament cell's tooltip, flagging the quick guess shown until the plate is sliced. */
const filamentTitle = (p: PlateBom) => (p.grams === null || p.sliced ? meters(p) : `${meters(p)}; a quick guess until the parts are sliced`);
const duration = (p: Pick<PlateBom, 'seconds'>) => (p.seconds === null || p.seconds === undefined ? '…' : formatDuration(p.seconds));
const cost = (p: Pick<PlateBom, 'cost'>, symbol: string) => (p.cost ? formatMoney(p.cost.total, symbol) : '…');

/** "≈ 1 h 05 min · 46 g · $0.95" for a plate card. */
export function plateSummary(p: PlateBom | undefined, symbol: string): string {
  if (!p) return '';
  const parts = [p.seconds === null || p.seconds === undefined ? null : `≈ ${formatDuration(p.seconds)}`, p.grams === null ? null : `${Math.round(p.grams)} g`];
  if (p.cost) parts.push(formatMoney(p.cost.total, symbol));
  return parts.filter(Boolean).join(' · ');
}

/** Hardware, parts, filament, time and cost for the job, with CSV/text download. */
export function BomSection({ job, stamp, estimate }: { job: PrintJob; stamp: string; estimate: JobEstimate }) {
  const { bom, busy, plates } = estimate;
  const symbol = bom.estimate?.currency ?? '$';
  const download = (kind: 'csv' | 'txt') =>
    downloadBytes(
      new TextEncoder().encode(kind === 'csv' ? bomCsv(bom) : bomText(bom)),
      `gridfinity-drawer-${stamp}-bom.${kind}`,
      kind === 'csv' ? 'text/csv' : 'text/plain',
    );
  const { pieces, bins, lids, keys, dividers, trays = 0, pads = 0 } = bom.parts;
  return (
    <Section title="Bill of materials">
      {bom.hardware.length > 0 ? (
        <table className="bom-table">
          <tbody>
            {bom.hardware.map((h) => (
              <tr key={h.item} title={h.note}>
                <td>{h.item}</td>
                <td>{h.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">No magnets or screws needed.</p>
      )}
      <p className="small">
        {pieces} baseplate piece{pieces === 1 ? '' : 's'} · {bins} bin{bins === 1 ? '' : 's'}
        {lids > 0 && ` · ${lids} lid${lids === 1 ? '' : 's'}`}
        {trays > 0 && ` · ${trays} tray${trays === 1 ? '' : 's'}`}
        {dividers > 0 && ` · ${dividers} divider plate${dividers === 1 ? '' : 's'}`}
        {keys > 0 && ` · ${keys} connector key${keys === 1 ? '' : 's'}`}
        {pads > 0 && ` · ${pads} non-slip pad${pads === 1 ? '' : 's'} in TPU`}
        {(bom.parts.attachments ?? 0) > 0 && ` · ${bom.parts.attachments} board attachment${bom.parts.attachments === 1 ? '' : 's'}`}
        {enclosureCounts(bom).map(([k, n]) => ` · ${enclosurePartsText(k, n)}`)} · {job.plates.length} plate{job.plates.length === 1 ? '' : 's'}
      </p>
      {job.plates.length > 0 && (
        <table className="bom-table">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Parts</th>
              <th>Filament</th>
              <th>Time</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {(bom.printers ? bom.printers.map((_, k) => k) : [-1]).flatMap((k) => {
              const pr = bom.printers?.[k];
              const rows = bom.plates.map((p, i) => ({ p, i })).filter(({ p }) => k < 0 || (p.printer ?? 0) === k);
              return [
                // Several printers: each one's plates under its own subtotal.
                ...(pr
                  ? [
                      <tr key={`printer-${k}`} className="bom-printer">
                        <td>{pr.name}</td>
                        <td>{pr.parts}</td>
                        <td>{grams(pr)}</td>
                        <td>{duration(pr)}</td>
                        <td>{cost(pr, symbol)}</td>
                      </tr>,
                    ]
                  : []),
                ...rows.map(({ p, i }) => (
                  <tr key={i}>
                    <td>
                      {i + 1}. {p.name}
                    </td>
                    <td>{p.parts}</td>
                    <td title={filamentTitle(p)}>{grams(p)}</td>
                    <td title={timeBreakdown(plates[i])}>{duration(p)}</td>
                    <td title={p.cost && bom.estimate?.electricity ? `filament ${formatMoney(p.cost.filament, symbol)}, electricity ${formatMoney(p.cost.energy, symbol)}` : undefined}>
                      {cost(p, symbol)}
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{bom.total.parts}</td>
              <td title={filamentTitle(bom.total)}>{grams(bom.total)}</td>
              <td title={bom.printers ? 'All plates one after another' : undefined}>{duration(bom.total)}</td>
              <td>{cost(bom.total, symbol)}</td>
            </tr>
            {bom.printers && (
              <tr className="bom-finish" title={`The printers print at the same time: the job is done when ${slowestPrinter(bom) ? `the ${slowestPrinter(bom)!.name}` : 'the slowest one'} finishes.`}>
                <td colSpan={3}>All done in</td>
                <td>{duration({ seconds: bom.finish })}</td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      )}
      <div className="field-hint">
        {busy ? `${busy.label}… ${busy.done}/${busy.total}. ` : ''}
        Filament for {filamentNote()}.
      </div>
      <div className="field-hint">
        {estimateNote(bom.estimate?.printer ?? 'printer')}.
        {bom.total.swaps ? ` Includes ${bom.total.swaps} filament swaps (${Math.round(bom.total.wasteGrams ?? 0)} g purged).` : ''}
      </div>
      {bom.filaments && bom.filaments.length > 0 && (
        <table className="bom-table bom-filaments">
          <thead>
            <tr>
              <th>Filament</th>
              <th>Parts</th>
              <th>Purge</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {bom.filaments.map((x) => (
              <tr key={x.slot}>
                <td>
                  <i className="bom-swatch" style={{ background: paletteOf(job.colours ?? {}, x.slot)[x.slot - 1].colour }} />
                  {x.name}
                </td>
                <td>{Math.round(x.grams)} g</td>
                <td>{x.waste ? `${Math.round(x.waste * 10) / 10} g` : '–'}</td>
                <td>{formatMoney(x.cost, symbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {bom.plates.some((p) => p.manual) && <div className="field-hint">Colour changes on some plates are pauses to swap the spool by hand: the time leaves out waiting for you.</div>}
      <CostFields twoColour={bom.plates.some((p) => (p.swaps ?? 0) > 0) && !job.colours} />
      <div className="button-row">
        <button onClick={() => download('csv')}>BOM (.csv)</button>
        <button onClick={() => download('txt')}>BOM (.txt)</button>
      </div>
    </Section>
  );
}

/** Filament prices, currency and electricity for the cost column. */
function CostFields({ twoColour }: { twoColour: boolean }) {
  const setup = useStore((s) => s.setup);
  const setSetup = useStore((s) => s.setSetup);
  const symbol = currencySymbol(setup.currency);
  const price = setup.filamentPrice ?? 20;
  const watts = setup.printerWatts ?? (findPrinter(setup.printerId).motion ?? DEFAULT_MOTION).watts;
  const names = printerNames(setup);
  return (
    <div className="cost-fields">
      <div className="row2">
        <NumberInput label="Filament price" value={price} min={0} max={100000} step={1} suffix={`${symbol}/kg`} onChange={(filamentPrice) => setSetup({ filamentPrice })} />
        <TextInput label="Currency" value={setup.currency ?? ''} placeholder={symbol} onChange={(currency) => setSetup({ currency: currency.trim().slice(0, 4) })} />
      </div>
      {twoColour && (
        <NumberInput
          label="Filament 2 price (label text)"
          value={paletteOf(setup, 2)[1].price ?? price}
          min={0}
          max={100000}
          step={1}
          suffix={`${symbol}/kg`}
          // Slot 2 of the palette (colours.ts), which the label filament is.
          onChange={(p2) => setSetup({ filaments: paletteOf(setup, 2).map((f, i) => (i === 1 ? { ...f, price: p2 } : f)) })}
        />
      )}
      <div className="row2">
        <NumberInput
          label="Electricity"
          value={setup.kwhPrice ?? 0}
          min={0}
          max={1000}
          step={0.01}
          digits={3}
          suffix={`${symbol}/kWh`}
          hint={setup.kwhPrice ? undefined : '0 leaves it out'}
          onChange={(kwhPrice) => setSetup({ kwhPrice })}
        />
        {!!setup.kwhPrice && (
          <NumberInput label={setup.printers ? `${names[0]} draws` : 'Printer draws'} value={watts} min={1} max={5000} step={5} digits={0} suffix="W" onChange={(printerWatts) => setSetup({ printerWatts })} />
        )}
      </div>
      {!!setup.kwhPrice &&
        setup.printers?.map((p, i) => (
          <NumberInput
            key={i}
            label={`${names[i + 1]} draws`}
            value={p.printerWatts ?? (findPrinter(p.printerId).motion ?? DEFAULT_MOTION).watts}
            min={1}
            max={5000}
            step={5}
            digits={0}
            suffix="W"
            onChange={(printerWatts) => setPrinterAt(i + 1, { printerWatts })}
          />
        ))}
    </div>
  );
}

/** A small sample to print first: baseplate corner, a connector, one bin. */
export function TestFitSection() {
  const baseplate = useStore((s) => s.baseplate);
  const newBin = useStore((s) => s.newBin);
  const setup = useStore((s) => s.setup);
  const pitchX = useStore((s) => s.drawer.pitchX);
  const pitchY = useStore((s) => s.drawer.pitchY);
  const halfGrid = useStore((s) => !!s.drawer.halfGrid);
  // "Just bins": the baseplate is there already, so the kit is the bin to try in it.
  const haveBaseplate = useStore((s) => !!s.drawer.haveBaseplate);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kit = useMemo(
    () => planTestFit(baseplate, newBin, setup, { x: pitchX || 42, y: pitchY || 42, halfGrid }, { haveBaseplate }),
    [baseplate, newBin, setup, pitchX, pitchY, halfGrid, haveBaseplate],
  );
  const bom = useMemo(() => billOfMaterials(kit), [kit]);
  const printer = findPrinter(setup.printerId);
  const magnets = bom.hardware.filter((h) => h.item.startsWith('Magnets')).reduce((t, h) => t + h.count, 0);
  const bin = halfGrid ? binLabel(sanitizeBin({ ...newBin, unitsX: 2, unitsY: 2 }), { half: true }) : binLabel(sanitizeBin({ ...newBin, unitsX: 1, unitsY: 1 }));

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const export3mf = () =>
    run('3mf', async () => {
      const bytes = kit.plates.length === 1 ? await geometry.exportPlate(kit, 0) : await geometry.exportZip(kit, setup);
      downloadBytes(bytes, `gridfinity-test-fit.${kit.plates.length === 1 ? '3mf' : 'zip'}`, kit.plates.length === 1 ? 'model/3mf' : 'application/zip');
    });
  const exportBambu = () =>
    run('bambu', async () => {
      const bytes = await geometry.exportBambu(kit, setup, await bambuSettings(printer.id));
      downloadBytes(bytes, 'gridfinity-test-fit-bambu.3mf', 'model/3mf');
    });

  return (
    <Section title="Test-fit kit">
      {haveBaseplate ? (
        <p className="muted small">
          Print this first to check the fit in the baseplate you have: one {bin} bin with the new-bin settings{magnets ? `. Needs ${magnets} magnets` : ''}.
          No baseplate sample: this drawer prints just bins.
        </p>
      ) : (
        <p className="muted small">
          Print this first to check the fit: a {halfGrid ? '3 × 3 half-cell' : '2 × 2'} baseplate sample
          {kit.connectors.length ? ` in two pieces with ${kit.connectors.length} connector key` : ''} using this drawer's baseplate
          settings, and one {bin} bin with the new-bin settings{magnets ? `. Needs ${magnets} magnets` : ''}.
        </p>
      )}
      {kit.warnings.map((w) => (
        <div key={w} className="field-error">
          {w}
        </div>
      ))}
      <div className="button-row">
        <button disabled={!!busy} onClick={export3mf}>
          {busy === '3mf' ? 'Building…' : 'Test-fit kit (.3mf)'}
        </button>
        {printer.bambu && (
          <button disabled={!!busy} onClick={exportBambu}>
            {busy === 'bambu' ? 'Building…' : 'As Bambu project'}
          </button>
        )}
      </div>
      {error && <div className="field-error">{error}</div>}
    </Section>
  );
}
