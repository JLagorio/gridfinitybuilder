import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { billOfMaterials, bomCsv, bomText, filamentNote, type PlateBom } from '../lib/bom';
import { planTestFit } from '../lib/testfit';
import { binLabel, sanitizeBin } from '../lib/geometry/bin';
import { findPrinter } from '../lib/printers';
import type { MeshSpec, PrintJob } from '../lib/project';
import { downloadBytes, geometry } from '../worker/client';
import { bambuSettings } from './bambuSettings';
import { Section } from './fields';

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

const grams = (p: PlateBom) => (p.grams === null ? '…' : `${Math.round(p.grams)} g`);
const meters = (p: PlateBom) => (p.meters === null ? '…' : `${(Math.round(p.meters * 10) / 10).toFixed(1)} m`);

/** Hardware, parts and filament for the job, with CSV/text download. */
export function BomSection({ job, stamp }: { job: PrintJob; stamp: string }) {
  const { lookup, progress } = useJobVolumes(job);
  const bom = useMemo(() => billOfMaterials(job, lookup), [job, lookup]);
  const download = (kind: 'csv' | 'txt') =>
    downloadBytes(
      new TextEncoder().encode(kind === 'csv' ? bomCsv(bom) : bomText(bom)),
      `gridfinity-drawer-${stamp}-bom.${kind}`,
      kind === 'csv' ? 'text/csv' : 'text/plain',
    );
  const { pieces, bins, lids, keys } = bom.parts;
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
        {keys > 0 && ` · ${keys} connector key${keys === 1 ? '' : 's'}`} · {job.plates.length} plate{job.plates.length === 1 ? '' : 's'}
      </p>
      {job.plates.length > 0 && (
        <table className="bom-table">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Parts</th>
              <th>Filament</th>
              <th>Length</th>
            </tr>
          </thead>
          <tbody>
            {bom.plates.map((p, i) => (
              <tr key={i}>
                <td>
                  {i + 1}. {p.name}
                </td>
                <td>{p.parts}</td>
                <td>{grams(p)}</td>
                <td>{meters(p)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{bom.total.parts}</td>
              <td>{grams(bom.total)}</td>
              <td>{meters(bom.total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <div className="field-hint">
        {progress ? `Measuring parts… ${progress[0]}/${progress[1]}. ` : ''}
        Estimate for {filamentNote()}.
      </div>
      <div className="button-row">
        <button onClick={() => download('csv')}>BOM (.csv)</button>
        <button onClick={() => download('txt')}>BOM (.txt)</button>
      </div>
    </Section>
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kit = useMemo(
    () => planTestFit(baseplate, newBin, setup, { x: pitchX || 42, y: pitchY || 42, halfGrid }),
    [baseplate, newBin, setup, pitchX, pitchY, halfGrid],
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
      <p className="muted small">
        Print this first to check the fit: a {halfGrid ? '3 × 3 half-cell' : '2 × 2'} baseplate sample
        {kit.connectors.length ? ` in two pieces with ${kit.connectors.length} connector key` : ''} using this drawer's baseplate
        settings, and one {bin} bin with the new-bin settings{magnets ? `. Needs ${magnets} magnets` : ''}.
      </p>
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
