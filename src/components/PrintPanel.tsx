import { Fragment, useMemo, useRef, useState } from 'react';
import { allDrawers, printDrawers, projectFile, useStore } from '../state/store';
import { NumberInput, Section, Segmented, Select, Toggle } from './fields';
import { PRINTERS, findPrinter } from '../lib/printers';
import { assemblyMaps, jobForPrinter, plateContents, usesSecondFilament, type PrintJob } from '../lib/project';
import { downloadBytes, geometry } from '../worker/client';
import { LID_COLOR, pieceColor } from './colors';
import { bambuSettings } from './bambuSettings';
import { BomSection, TestFitSection, plateSummary, useJobEstimate } from './PrintExtras';
import { drawerAssemblies } from '../lib/export/step';
import { CopyShareLink } from './ShareLink';
import { ContentsSection } from './InventoryList';
import { baseplatePrinter, jobPrinters, printerNames, printerSetup, shortName } from '../lib/layout/fleet';
import { printedOn } from '../lib/printed';
import { formatDuration } from '../lib/estimate';
import { MorePrinters } from './PrinterFields';
import { OnlyChangedField, PlatePrintedMark } from './PrintedMarks';

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

  const drawers = allDrawers(store);
  const printing = printDrawers(store);
  const multi = job.drawers.length > 1;
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = multi ? `${job.drawers.length}-drawers` : slug(printing[0]?.name ?? '') || `${job.layout.nx}x${job.layout.ny}`;
  const nPieces = job.drawers.reduce((t, d) => t + d.plan.pieces.length, 0);
  const nBins = printing.reduce((t, d) => t + d.bins.length, 0);
  // Several printers (fleet.ts): each gets its own project, with its plates and settings.
  const printers = jobPrinters(setup);
  const names = printerNames(setup);
  const platesFor = (k: number) => job.plates.filter((pl) => !job.printers || (pl.printer ?? 0) === k).length;
  const exportBambu = (k?: number) =>
    run('Building project', async (p) => {
      const pr = k === undefined ? printer : findPrinter(printers[k].printerId);
      const settings = pr.bambu ? await bambuSettings(pr.id) : undefined;
      const bytes = await geometry.exportBambu(k === undefined ? job : jobForPrinter(job, k), k === undefined ? setup : printerSetup(setup, k), settings, p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}${k === undefined ? '' : `-${slug(names[k])}`}.3mf`, 'model/3mf');
    });
  const exportZip = () =>
    run('Building plates', async (p) => {
      const bytes = await geometry.exportZip(job, setup, p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}-plates.zip`, 'application/zip');
    });
  const exportPlate = (i: number) =>
    run(`Building plate ${i + 1}`, async (p) => {
      const bytes = await geometry.exportPlate(job, i, p);
      const name = job.plates[i].name.toLowerCase().replace(/\s+/g, '-');
      downloadBytes(bytes, `gridfinity-${name}.3mf`, 'model/3mf');
    });
  const exportStlZip = () =>
    run('Building STL plates', async (p) => {
      const bytes = await geometry.exportStlZip(job, p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}-plates-stl.zip`, 'application/zip');
    });
  const exportStlPlate = (i: number) =>
    run(`Building plate ${i + 1}`, async (p) => {
      const bytes = await geometry.exportStlPlate(job, i, p);
      const name = job.plates[i].name.toLowerCase().replace(/\s+/g, '-');
      downloadBytes(bytes, `gridfinity-${name}.stl`, 'model/stl');
    });
  const exportStepZip = () =>
    run('Building STEP plates', async (p) => {
      const bytes = await geometry.exportStepZip(job, p);
      downloadBytes(bytes, `gridfinity-drawer-${stamp}-plates-step.zip`, 'application/zip');
    });
  const exportStepPlate = (i: number) =>
    run(`Building plate ${i + 1}`, async (p) => {
      const bytes = await geometry.exportStepPlate(job, i, p);
      const name = job.plates[i].name.toLowerCase().replace(/\s+/g, '-');
      downloadBytes(bytes, `gridfinity-${name}.step`, 'model/step');
    });
  const exportAssembled = () =>
    run('Building the assembled drawer', async (p) => {
      const assemblies = drawerAssemblies(job, printing);
      const bytes = await geometry.exportStepAssembly(assemblies, job.meshes, p);
      if (assemblies.length > 1) downloadBytes(bytes, `gridfinity-${stamp}-assembled-step.zip`, 'application/zip');
      else downloadBytes(bytes, `gridfinity-drawer-${stamp}-assembled.step`, 'model/step');
    });
  const exportMap = () =>
    downloadBytes(
      new TextEncoder().encode(Object.values(assemblyMaps(job)).join('\n\n')),
      multi ? 'assembly-maps.txt' : 'assembly-map.txt',
      'text/plain',
    );

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

  const twoColour = usesSecondFilament(job);
  const estimate = useJobEstimate(job);
  const currency = estimate.bom.estimate?.currency ?? '$';
  const nBasePlates = job.plates.filter((p) => p.group === 'baseplate').length;
  const nBinPlates = job.plates.length - nBasePlates;
  // Parts on the plates that are printed already (printed.ts).
  const printedNow = useMemo(() => printedOn(job, store.printed), [job, store.printed]);
  const baseAt = baseplatePrinter(setup);

  return (
    <>
      {drawers.length > 1 && (
        <Section title="Drawers to print">
          <Segmented
            value={store.printScope}
            options={[
              { value: 'active', label: 'This drawer' },
              { value: 'all', label: `All ${drawers.length}` },
              { value: 'pick', label: 'Choose' },
            ]}
            onChange={(scope) =>
              store.setPrintScope(scope, scope === 'pick' && !store.printPick.length ? [store.activeDrawerId] : undefined)
            }
          />
          {store.printScope === 'pick' && (
            <div className="drawer-picks">
              {drawers.map((d) => (
                <Toggle
                  key={d.id}
                  label={`${d.name} · ${d.bins.length} bins`}
                  checked={store.printPick.includes(d.id)}
                  onChange={(on) =>
                    store.setPrintScope(
                      'pick',
                      on ? [...store.printPick, d.id] : store.printPick.filter((p) => p !== d.id),
                    )
                  }
                />
              ))}
            </div>
          )}
          <p className="muted small">
            Each drawer's baseplate prints on its own plates. Bins from every drawer share plates, and their names say which
            drawer they're for.
          </p>
        </Section>
      )}
      <Section title={setup.printers ? 'Printers' : 'Printer'}>
        <Select
          label={setup.printers ? 'Printer 1' : 'Model'}
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
        <MorePrinters />
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
            {nPieces} <small>pieces</small> · {nBasePlates} <small>plates</small>
          </div>
          <dl>
            {multi ? (
              job.drawers.map((d) => (
                <div key={d.id} className="dl-row">
                  <dt>{d.name}</dt>
                  <dd>
                    {d.plan.cols} × {d.plan.rows} pieces
                  </dd>
                </div>
              ))
            ) : (
              <>
                <dt>Piece grid</dt>
                <dd>
                  {job.plan.cols} × {job.plan.rows}
                </dd>
              </>
            )}
            <dt>{setup.printers ? `Split for the ${names[baseAt]}` : 'Usable bed'}</dt>
            <dd>
              {printers[baseAt].bedW - 2 * printers[baseAt].plateMargin} × {printers[baseAt].bedD - 2 * printers[baseAt].plateMargin} mm
            </dd>
          </dl>
        </div>
      </Section>

      <Section title="Export">
        <Toggle label="Baseplate" checked={include.baseplate} onChange={(v) => store.setInclude({ baseplate: v })} />
        <Toggle
          label={`Bins (${nBins})`}
          checked={include.bins}
          onChange={(v) => store.setInclude({ bins: v })}
          hint={nBinPlates ? `${nBinPlates} plate${nBinPlates > 1 ? 's' : ''} of bins` : undefined}
        />
        <OnlyChangedField job={job} printed={printedNow} />
        {job.warnings.map((w) => (
          <div key={w} className="field-error">
            {w}
          </div>
        ))}
        {twoColour && (
          <div className="field label-colour">
            <label className="field-label" htmlFor="label-colour">
              Label filament (slot 2)
            </label>
            <div className="field-control colour-row">
              <input
                id="label-colour"
                type="color"
                value={setup.labelColour ?? '#161616'}
                onChange={(e) => store.setSetup({ labelColour: e.target.value })}
              />
              <span className="muted small">Inlaid label text and two-colour tool pocket floors print in this filament; the Bambu project gets a second filament set to it.</span>
            </div>
          </div>
        )}
        <button className="primary wide" disabled={!!progress || !platesFor(0)} onClick={() => exportBambu(job.printers ? 0 : undefined)}>
          {printer.bambu ? 'Bambu Studio project' : 'Slicer project'}{job.printers ? ` · ${shortName(names[0])}` : ''} (.3mf)
        </button>
        {/* Several printers: a project each, with its own plates and settings. */}
        {job.printers?.slice(1).map((name, i) => (
          <button key={i} className="primary wide" disabled={!!progress || !platesFor(i + 1)} onClick={() => exportBambu(i + 1)}>
            {findPrinter(printers[i + 1].printerId).bambu ? 'Bambu Studio project' : 'Slicer project'} · {shortName(name)} (.3mf)
          </button>
        ))}
        <div className="field-hint">
          {job.printers
            ? 'One file per printer, with its own plates, set up for it (Bambu printers: 0.20 mm Standard, PLA Basic). Open each one and press Slice all.'
            : printer.bambu
            ? `All ${job.plates.length} plates in one file, set up for the ${printer.name}: 0.20 mm Standard, PLA Basic. Open it and press Slice all.`
            : 'All plates in one Bambu/Orca-style project. Other slicers: use the per-plate zip.'}
        </div>
        <div className="button-row">
          <button disabled={!!progress || !job.plates.length} onClick={exportZip}>
            Plates as 3MF (.zip)
          </button>
          <button disabled={!!progress || !job.plates.length} onClick={exportStlZip}>
            Plates as STL (.zip)
          </button>
          <button disabled={!nPieces} onClick={exportMap}>
            {multi ? 'Assembly maps' : 'Assembly map'}
          </button>
        </div>
        <div className="button-row">
          <button disabled={!!progress || !job.plates.length} onClick={exportStepZip} title="One STEP file per plate, parts arranged, flat faces for CAD">
            Plates as STEP (.zip)
          </button>
          <button
            disabled={!!progress || (!nPieces && !nBins)}
            onClick={exportAssembled}
            title="Baseplate, bins, lids and label plates put together, one solid per part, for CAD"
          >
            {multi ? 'Drawers assembled (.step)' : 'Drawer assembled (.step)'}
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

      <BomSection job={job} stamp={stamp} estimate={estimate} />
      <ContentsSection />
      <TestFitSection />

      <Section title="Project">
        <p className="muted small">Your work is kept in this browser automatically. Save a file to back it up or move it to another computer.</p>
        <div className="button-row">
          <button onClick={saveProject}>Save project</button>
          <button onClick={() => fileInput.current?.click()}>Open project…</button>
          <CopyShareLink />
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
            <Fragment key={i}>
              {job.printers && (pl.printer ?? 0) !== (job.plates[i - 1]?.printer ?? -1) && (
                <PrinterHeading job={job} printer={pl.printer ?? 0} seconds={estimate.bom.printers?.[pl.printer ?? 0]?.seconds} />
              )}
              <div className={`plate-card ${ui.plate === i ? 'active' : ''}`}>
                <button className="plate-thumb" onClick={() => store.setUI({ plate: i })} title="Show this plate">
                  <PlateThumb job={job} plate={i} bedW={printers[pl.printer ?? 0]?.bedW ?? setup.bedW} bedD={printers[pl.printer ?? 0]?.bedD ?? setup.bedD} />
                </button>
                <div className="plate-meta">
                  <b>
                    {i + 1}. {pl.name}
                  </b>
                  <span className="muted small">{plateContents(job, pl).map((n) => n.replace('Baseplate piece', 'Piece')).join(', ')}</span>
                  {plateSummary(estimate.bom.plates[i], currency) && <span className="small plate-estimate">{plateSummary(estimate.bom.plates[i], currency)}</span>}
                  <span className="plate-downloads">
                    <button className="link" disabled={!!progress} onClick={() => exportPlate(i)}>
                      Download .3mf
                    </button>
                    <button className="link" disabled={!!progress} onClick={() => exportStlPlate(i)}>
                      .stl
                    </button>
                    <button className="link" disabled={!!progress} onClick={() => exportStepPlate(i)}>
                      .step
                    </button>
                  </span>
                  <PlatePrintedMark job={job} plate={i} printed={printedNow} />
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </Section>
    </>
  );
}

/** Above a printer's plates, with several: its name, plate count and print time. */
function PrinterHeading({ job, printer, seconds }: { job: PrintJob; printer: number; seconds: number | null | undefined }) {
  const n = job.plates.filter((pl) => (pl.printer ?? 0) === printer).length;
  return (
    <div className="plate-printer">
      {job.printers?.[printer]}
      <span>
        {n} plate{n === 1 ? '' : 's'}
        {seconds ? ` · ≈ ${formatDuration(seconds)}` : ''}
      </span>
    </div>
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
        const color = part.kind === 'piece' ? pieceColor(part.pieceId ?? 0) : part.kind === 'lid' ? LID_COLOR : '#cfd5de';
        return (
          <g key={p.key}>
            <rect x={p.x} y={bedD - p.y - d} width={w} height={d} rx={4} fill={color} fillOpacity={0.85} />
            {part.kind === 'piece' && (
              <text x={p.x + w / 2} y={bedD - p.y - d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={40} className="thumb-label">
                {part.pieceId}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
