import { useRef, useState } from 'react';
import { projectFile, projectOf, useStore } from '../state/store';
import { NumberInput, Section, Segmented, Select, Toggle } from './fields';
import { PRINTERS, findPrinter } from '../lib/printers';
import type { PrintJob } from '../lib/project';
import { assemblyMap } from '../lib/layout/plan';
import { downloadBytes, geometry } from '../worker/client';
import { pieceColor } from './colors';

async function bambuSettings(printerId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bambu/${printerId}.json`);
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

export function PrintPanel({ job }: { job: PrintJob }) {
  const store = useStore();
  const { setup, include, ui } = store;
  const printer = findPrinter(setup.printerId);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, fn: (p: (d: number, t: number) => void) => Promise<void>) => {
    setError(null);
    setProgress({ label, done: 0, total: 1 });
    try {
      await fn((done, total) => setProgress({ label, done, total }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const stamp = `${job.layout.nx}x${job.layout.ny}`;
  const exportBambu = () =>
    run('Building project', async (p) => {
      const settings = printer.bambu ? await bambuSettings(printer.id) : undefined;
      const bytes = await geometry.exportBambu(job, setup, settings, p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}.3mf`, 'model/3mf');
    });
  const exportZip = () =>
    run('Building plates', async (p) => {
      const bytes = await geometry.exportZip(job, projectOf(store), p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}-plates.zip`, 'application/zip');
    });
  const exportPlate = (i: number) =>
    run(`Building plate ${i + 1}`, async (p) => {
      const bytes = await geometry.exportPlate(job, i, p);
      const name = job.plates[i].name.toLowerCase().replace(/\s+/g, '-');
      downloadBytes(bytes, `gridfinity-${name}.3mf`, 'model/3mf');
    });
  const exportMap = () =>
    downloadBytes(new TextEncoder().encode(assemblyMap(job.layout, job.plan)), 'assembly-map.txt', 'text/plain');

  const fileInput = useRef<HTMLInputElement>(null);
  const saveProject = () =>
    downloadBytes(
      new TextEncoder().encode(JSON.stringify(projectFile(store), null, 2)),
      `gridfinity-drawer-${stamp}.gridfit.json`,
      'application/json',
    );
  const openProject = async (file: File) => {
    setError(null);
    try {
      store.loadProject(JSON.parse(await file.text()));
    } catch (e) {
      setError(`Couldn't open ${file.name}: ${(e as Error).message}`);
    }
  };

  const nBasePlates = job.plates.filter((p) => p.group === 'baseplate').length;
  const nBinPlates = job.plates.length - nBasePlates;

  return (
    <>
      <Section title="Printer">
        <Select
          label="Model"
          value={setup.printerId}
          options={PRINTERS.map((p) => ({
            value: p.id,
            label: p.id === 'custom' ? p.name : `${p.name} — ${p.bedW}×${p.bedD}`,
            group: p.brand,
          }))}
          onChange={(id) => store.setPrinter(id)}
        />
        {setup.printerId === 'custom' && (
          <div className="row3">
            <NumberInput label="Bed X" value={setup.bedW} min={80} max={1000} step={1} onChange={(bedW) => store.setSetup({ bedW })} />
            <NumberInput label="Bed Y" value={setup.bedD} min={80} max={1000} step={1} onChange={(bedD) => store.setSetup({ bedD })} />
            <NumberInput label="Max Z" value={setup.maxH} min={20} max={1000} step={1} onChange={(maxH) => store.setSetup({ maxH })} />
          </div>
        )}
        <div className="row2">
          <NumberInput
            label="Edge margin"
            value={setup.plateMargin}
            min={0}
            max={40}
            step={1}
            onChange={(plateMargin) => store.setSetup({ plateMargin })}
          />
          <NumberInput label="Part spacing" value={setup.spacing} min={1} max={30} step={1} onChange={(spacing) => store.setSetup({ spacing })} />
        </div>
      </Section>

      <Section title="Baseplate split">
        <Segmented
          label="Strategy"
          value={setup.splitStyle}
          options={[
            { value: 'auto', label: 'Fewest plates', title: 'Try every split and keep the one that needs the fewest print plates' },
            { value: 'balanced', label: 'Even pieces', title: 'Pieces as equal as possible' },
            { value: 'largest', label: 'Biggest pieces', title: 'Full-size pieces first, leftovers at the end' },
          ]}
          onChange={(splitStyle) => store.setSetup({ splitStyle })}
        />
        <Toggle
          label="Share plates between pieces"
          checked={setup.nest}
          onChange={(nest) => store.setSetup({ nest })}
          hint="Small pieces go on the same plate when they fit."
        />
        <Toggle
          label="Allow cuts through the solid margin"
          checked={setup.splitMargins}
          onChange={(splitMargins) => store.setSetup({ splitMargins })}
        />
        <div className="summary">
          <div className="summary-big">
            {job.plan.pieces.length} <small>pieces</small> · {nBasePlates} <small>plates</small>
          </div>
          <dl>
            <dt>Piece grid</dt>
            <dd>
              {job.plan.cols} × {job.plan.rows}
            </dd>
            <dt>Usable bed</dt>
            <dd>
              {setup.bedW - 2 * setup.plateMargin} × {setup.bedD - 2 * setup.plateMargin} mm
            </dd>
          </dl>
        </div>
      </Section>

      <Section title="Export">
        <Toggle label="Baseplate" checked={include.baseplate} onChange={(v) => store.setInclude({ baseplate: v })} />
        <Toggle
          label={`Bins (${store.bins.length})`}
          checked={include.bins}
          onChange={(v) => store.setInclude({ bins: v })}
          hint={nBinPlates ? `${nBinPlates} plate${nBinPlates > 1 ? 's' : ''} of bins` : undefined}
        />
        {job.warnings.map((w) => (
          <div key={w} className="field-error">
            {w}
          </div>
        ))}
        <button className="primary wide" disabled={!!progress || !job.plates.length} onClick={exportBambu}>
          {printer.bambu ? 'Bambu Studio project (.3mf)' : 'Slicer project (.3mf)'}
        </button>
        <div className="field-hint">
          {printer.bambu
            ? `All ${job.plates.length} plates in one file, set up for the ${printer.name}: 0.20 mm Standard, PLA Basic. Open it and press Slice all.`
            : 'All plates in one Bambu/Orca-style project. Other slicers: use the per-plate zip.'}
        </div>
        <div className="button-row">
          <button disabled={!!progress || !job.plates.length} onClick={exportZip}>
            Plates as 3MF (.zip)
          </button>
          <button disabled={!job.plan.pieces.length} onClick={exportMap}>
            Assembly map
          </button>
        </div>
        {progress && (
          <div className="progress">
            <div className="progress-label">
              {progress.label}… {progress.done}/{progress.total}
            </div>
            <div className="progress-bar">
              <span style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            </div>
          </div>
        )}
        {error && <div className="field-error">{error}</div>}
      </Section>

      <Section title="Project">
        <p className="muted small">Your work is kept in this browser automatically. Save a file to back it up or move it to another computer.</p>
        <div className="button-row">
          <button onClick={saveProject}>Save project</button>
          <button onClick={() => fileInput.current?.click()}>Open project…</button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openProject(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title={`Plates (${job.plates.length})`}>
        <div className="plate-list">
          <button className={`plate-card all ${ui.plate < 0 ? 'active' : ''}`} onClick={() => store.setUI({ plate: -1 })}>
            Show all plates
          </button>
          {job.plates.map((pl, i) => (
            <div key={i} className={`plate-card ${ui.plate === i ? 'active' : ''}`}>
              <button className="plate-thumb" onClick={() => store.setUI({ plate: i })} title="Show this plate">
                <PlateThumb job={job} plate={i} bedW={setup.bedW} bedD={setup.bedD} />
              </button>
              <div className="plate-meta">
                <b>
                  {i + 1}. {pl.name}
                </b>
                <span className="muted small">{pl.placements.map((p) => job.parts[p.key].name.replace('Baseplate piece', 'Piece')).join(', ')}</span>
                <button className="link" disabled={!!progress} onClick={() => exportPlate(i)}>
                  Download .3mf
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function PlateThumb({ job, plate, bedW, bedD }: { job: PrintJob; plate: number; bedW: number; bedD: number }) {
  const pl = job.plates[plate];
  return (
    <svg viewBox={`0 0 ${bedW} ${bedD}`} className="thumb">
      <rect x={0} y={0} width={bedW} height={bedD} className="thumb-bed" />
      {pl.placements.map((p) => {
        const part = job.parts[p.key];
        const w = p.rotated ? p.d : p.w;
        const d = p.rotated ? p.w : p.d;
        const color = part.kind === 'piece' ? pieceColor(Number(p.key.split(':')[1])) : '#cfd5de';
        return (
          <g key={p.key}>
            <rect x={p.x} y={bedD - p.y - d} width={w} height={d} rx={4} fill={color} fillOpacity={0.85} />
            {part.kind === 'piece' && (
              <text x={p.x + w / 2} y={bedD - p.y - d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={40} className="thumb-label">
                {p.key.split(':')[1]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
