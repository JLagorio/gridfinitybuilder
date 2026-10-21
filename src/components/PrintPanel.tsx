import { Fragment, useMemo, useRef, useState } from 'react';
import { allDrawers, history, printDrawers, projectFile, selectedIds, useStore, useUnits } from '../state/store';
import { LengthInput, Section, Segmented, Toggle } from './fields';
import { Combobox } from './combobox';
import { bedExclusion, findPrinter, type BedRect } from '../lib/printers';
import { bedText, usableBed } from '../lib/bedfit';
import { assemblyMaps, jobForPrinter, plateContents, usesSecondFilament, type PrintJob } from '../lib/project';
import { downloadBytes, geometry } from '../worker/client';
import { LID_COLOR, pieceColor } from './colors';
import { bambuSettings } from './bambuSettings';
import { BomSection, TestFitSection, plateSummary, useJobEstimate } from './PrintExtras';
import { CopyShareLink } from './CopyShareLink';
import { ContentsSection } from './InventoryList';
import { NozzleField, PrintChecksSection } from './PrintChecks';
import { baseplatePrinter, jobPrinters, printerNames, printerSetup, shortName } from '../lib/layout/fleet';
import { hasPrints, printedOn } from '../lib/printed';
import { formatDuration } from '../lib/estimate';
import { MorePrinters, PRINTER_OPTIONS } from './PrinterFields';
import { OnlyChangedField, PlatePrintedMark } from './PrintedMarks';
import { DEFAULT_SETUP } from '../lib/layout/plan';
import { Find } from './findContext';
import { FindPanel, MoreInAll } from './find';
import { PRINT_INDEX } from './panelIndex';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../pwa/chunks';
import { HaveBaseplateNotes, NothingToPrint } from './PrintWhat';
import { isOwned } from '../lib/external';
import { adoptMeshes, projectWithMeshes } from '../lib/imported/meshStore';

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
      setError(isChunkError(e) ? CHUNK_ERROR_MESSAGE : (e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const drawers = allDrawers(store);
  const printing = printDrawers(store);
  const multi = job.drawers.length > 1;
  // Just the bins selected on the Bins tab (store PrintScope 'selected').
  const selected = store.printScope === 'selected';
  const nSelected = selectedIds(ui).filter((id) => store.bins.some((b) => b.id === id)).length;
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = (multi ? `${job.drawers.length}-drawers` : slug(printing[0]?.name ?? '') || `${job.layout.nx}x${job.layout.ny}`) + (selected ? '-selected-bins' : '');
  // Pieces of a baseplate you have ("Just bins") are only drawn, never printed.
  const nPieces = job.drawers.reduce((t, d) => t + (d.haveBaseplate ? 0 : d.plan.pieces.length), 0);
  // Bins you already have (lib/external.ts) never print.
  const nBins = printing.reduce((t, d) => t + d.bins.filter((b) => !isOwned(b)).length, 0);
  const allHave = printing.every((d) => d.drawer.haveBaseplate);
  const someHave = printing.filter((d) => d.drawer.haveBaseplate);
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
      // The STEP writer's layout half loads with the first assembled export.
      const { drawerAssemblies } = await import('../lib/export/step');
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
  // With the meshes of imported bins in it, so the file opens complete anywhere (lib/imported/meshStore.ts).
  const saveProject = () =>
    run('Saving the project', async () => {
      const file = await projectWithMeshes(projectFile(store));
      downloadBytes(new TextEncoder().encode(JSON.stringify(file, null, 2)), `gridfinity-drawer-${stamp}.gridfit.json`, 'application/json');
    });
  const [started, setStarted] = useState(false);
  const openProject = async (file: File) => {
    setError(null);
    setStarted(false);
    try {
      const data = JSON.parse(await file.text());
      // Imported bins' meshes first (version 3 files), then the project.
      adoptMeshes(data?.meshes);
      store.loadProject(data);
    } catch (e) {
      setError(`Couldn't open ${file.name}: ${(e as Error).message}`);
    }
  };

  const twoColour = usesSecondFilament(job);
  // Imported bins that aren't closed solids can't be STEP solids (export/step.ts stepSkips).
  const notInStep = job.plates.flatMap((pl) => pl.placements).filter((p) => {
    const spec = job.meshes[job.parts[p.key].meshKey];
    return spec?.kind === 'imported' && !!spec.open;
  }).length;
  const estimate = useJobEstimate(job);
  const currency = estimate.bom.estimate?.currency ?? '$';
  const nBasePlates = job.plates.filter((p) => p.group === 'baseplate').length;
  const nBinPlates = job.plates.length - nBasePlates;
  // Parts on the plates that are printed already (printed.ts).
  const printedNow = useMemo(() => printedOn(job, store.printed), [job, store.printed]);
  const baseAt = baseplatePrinter(setup);

  const { fmt } = useUnits();
  const splitSet = setup.splitStyle !== DEFAULT_SETUP.splitStyle || setup.nest !== DEFAULT_SETUP.nest || setup.splitMargins !== DEFAULT_SETUP.splitMargins;
  const marginSet = setup.plateMargin !== DEFAULT_SETUP.plateMargin;
  const spacingSet = setup.spacing !== DEFAULT_SETUP.spacing;
  const onlySet = store.onlyChanged || hasPrints(store.printed);
  // The first printer's own fields; with several, in a card like the others (PrinterFields.tsx).
  const firstPrinter = (
    <>
      <Find id="printer-model">
        <Combobox label="Model" value={setup.printerId} options={PRINTER_OPTIONS} onChange={(id) => store.setPrinter(id)} />
        {setup.printerId === 'custom' && (
          <div className="row3">
            <LengthInput label="Bed X" value={setup.bedW} min={80} max={1000} onChange={(bedW) => store.setSetup({ bedW })} />
            <LengthInput label="Bed Y" value={setup.bedD} min={80} max={1000} onChange={(bedD) => store.setSetup({ bedD })} />
            <LengthInput label="Max Z" value={setup.maxH} min={20} max={1000} onChange={(maxH) => store.setSetup({ maxH })} />
          </div>
        )}
      </Find>
      {/* With several printers each card has its margin, like the others' (PrinterFields.tsx). */}
      <Find id="bed-margin" set={marginSet || !!setup.printers}>
        <LengthInput
          label="Edge margin"
          value={setup.plateMargin}
          max={40}
          onChange={(plateMargin) => store.setSetup({ plateMargin })}
          hint={`Usable bed ${bedText(usableBed({ ...setup, bedW: Math.max(setup.bedW, 2 * setup.plateMargin), bedD: Math.max(setup.bedD, 2 * setup.plateMargin) }), fmt)}`}
        />
      </Find>
    </>
  );

  return (
    <FindPanel index={PRINT_INDEX} placeholder="Find a setting…">
      {(drawers.length > 1 || nSelected > 0 || selected) && (
        <Section title={drawers.length > 1 ? 'Drawers to print' : 'What to print'} find="print-drawers">
          <Segmented
            ariaLabel={drawers.length > 1 ? 'Drawers to print' : 'What to print'}
            value={store.printScope}
            options={[
              { value: 'active', label: 'This drawer' },
              ...(drawers.length > 1
                ? [
                    { value: 'all' as const, label: `All ${drawers.length}` },
                    { value: 'pick' as const, label: 'Choose' },
                  ]
                : []),
              { value: 'selected', label: `Selected bins (${nSelected})`, title: 'Just the bins selected on the Bins tab, without the baseplate' },
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
          {selected ? (
            <p className="muted small">
              Only the bins selected on the Bins tab print, with their lids and inserts, and no baseplate. Select more there with Shift-click,
              or Shift-drag around them.
            </p>
          ) : (
            drawers.length > 1 && (
              <p className="muted small">
                Each drawer's baseplate prints on its own plates. Bins from every drawer share plates, and their names say which
                drawer they're for.
              </p>
            )
          )}
        </Section>
      )}
      <Section title={setup.printers ? 'Printers' : 'Printer'} find="printers">
        {setup.printers ? (
          <div className="printer-card first">
            <div className="printer-card-head">
              <b>Printer 1</b>
            </div>
            {firstPrinter}
          </div>
        ) : (
          firstPrinter
        )}
        <Find id="more-printers">
          <MorePrinters />
        </Find>
        <Find id="nozzle">
          <NozzleField />
        </Find>
        <Find id="part-spacing" set={spacingSet}>
          <LengthInput
            label="Part spacing"
            value={setup.spacing}
            min={1}
            max={30}
            onChange={(spacing) => store.setSetup({ spacing })}
            hint={setup.printers ? 'Between parts on a plate, on every printer.' : 'Between parts on a plate.'}
          />
        </Find>
        <MoreInAll ids={[['bed-margin', marginSet || !!setup.printers], ['part-spacing', spacingSet]]} />
      </Section>

      <Find id="checks">
        <PrintChecksSection job={job} />
      </Find>

      <Section title="Export" find="export">
        <Find id="export-what">
          <HaveBaseplateNotes drawers={printing} selected={selected} />
          <Toggle
            label="Baseplate"
            checked={include.baseplate}
            onChange={(v) => store.setInclude({ baseplate: v })}
            hint={
              selected
                ? 'Not with the selected bins.'
                : allHave
                  ? 'No difference here: no baseplate prints (see above).'
                  : someHave.length
                    ? `Not for ${someHave.map((d) => d.name).join(', ')}: you have ${someHave.length > 1 ? 'theirs' : 'its'}.`
                    : undefined
            }
          />
          <Toggle
            label={`Bins (${nBins})`}
            checked={include.bins}
            onChange={(v) => store.setInclude({ bins: v })}
            hint={nBinPlates ? `${nBinPlates} plate${nBinPlates > 1 ? 's' : ''} of bins` : undefined}
          />
        </Find>
        <Find id="only-changed" set={onlySet}>
          <OnlyChangedField job={job} printed={printedNow} />
        </Find>
        {job.warnings.map((w) => (
          <div key={w} className="field-error">
            {w}
          </div>
        ))}
        <NothingToPrint plates={job.plates.length} leftOut={job.leftOut?.length ?? 0} drawers={printing} include={include} selected={selected} />
        {twoColour && (
          <Find id="label-colour">
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
                <span className="muted small">Inlaid label text, inlaid QR codes and two-colour tool pocket floors print in this filament; the Bambu project gets a second filament set to it.</span>
              </div>
            </div>
          </Find>
        )}
        <Find id="export-files">
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
          <div className="field">
            <span className="field-label">Other files</span>
            <div className="button-row">
              <button disabled={!!progress || !job.plates.length} onClick={exportZip}>
                Plates as 3MF (.zip)
              </button>
              <button disabled={!!progress || !job.plates.length} onClick={exportStlZip}>
                Plates as STL (.zip)
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
            {notInStep > 0 && (
              <div className="field-hint">
                STEP files leave out {notInStep === 1 ? 'the imported bin that isn’t' : `the ${notInStep} imported bins that aren’t`} a closed solid; the 3MF,
                Bambu and STL files have {notInStep === 1 ? 'it' : 'them'}.
              </div>
            )}
            <div className="button-row">
              <button disabled={!nPieces} onClick={exportMap}>
                {multi ? 'Assembly maps (.txt)' : 'Assembly map (.txt)'}
              </button>
            </div>
          </div>
        </Find>
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
        <MoreInAll ids={[['only-changed', onlySet]]} />
      </Section>

      <Section title={`Plates (${job.plates.length})`} find="plates">
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
                  <PlateThumb
                    job={job}
                    plate={i}
                    bedW={printers[pl.printer ?? 0]?.bedW ?? setup.bedW}
                    bedD={printers[pl.printer ?? 0]?.bedD ?? setup.bedD}
                    exclude={bedExclusion(printers[pl.printer ?? 0]?.printerId ?? setup.printerId)}
                  />
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
        <MoreInAll ids={nPieces ? [['split', splitSet]] : []} />
      </Section>

      {/* Nothing to split when no baseplate prints (you have them, or just the selected bins). */}
      {nPieces > 0 && (
      <Section title="Baseplate split" find="split" set={splitSet}>
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
                  <dd>{d.haveBaseplate ? 'not printed' : `${d.plan.cols} × ${d.plan.rows} pieces`}</dd>
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
            <dd>{bedText(usableBed({ ...printers[baseAt], spacing: setup.spacing }), fmt)}</dd>
          </dl>
        </div>
      </Section>
      )}

      <Find id="bom">
        <BomSection job={job} stamp={stamp} estimate={estimate} />
      </Find>
      <Find id="testfit">
        <TestFitSection />
      </Find>
      <Find id="contents-list">
        <ContentsSection />
      </Find>

      <Section title="Project" find="project">
        <p className="muted small">
          Your work is kept in this browser automatically. Save a file to back it up or move it to another computer: it holds imported bins&apos; meshes too. A share
          link has them as plain boxes.
        </p>
        <div className="button-row">
          <button onClick={saveProject}>Save project</button>
          <button onClick={() => fileInput.current?.click()}>Open project…</button>
          <button
            onClick={() => {
              store.newProject();
              setStarted(true);
            }}
          >
            New project
          </button>
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
        {started && (
          <p className="muted small" role="status">
            Started a new project. Printers, templates, the tool library and My bins are kept.{' '}
            <button
              className="link"
              onClick={() => {
                history.undo();
                setStarted(false);
              }}
            >
              Undo
            </button>
          </p>
        )}
      </Section>
    </FindPanel>
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

/** A plate's parts on its bed, front at the bottom; the areas the printer keeps free (printers.ts `exclude`) hatched. */
function PlateThumb({ job, plate, bedW, bedD, exclude }: { job: PrintJob; plate: number; bedW: number; bedD: number; exclude: readonly BedRect[] }) {
  const pl = job.plates[plate];
  return (
    <svg viewBox={`0 0 ${bedW} ${bedD}`} className="thumb">
      <rect x={0} y={0} width={bedW} height={bedD} className="thumb-bed" />
      {exclude.length > 0 && (
        <defs>
          <pattern id="thumb-hatch" width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={10} height={10} className="thumb-exclude" />
            <line x1={5} y1={0} x2={5} y2={10} className="thumb-hatch" />
          </pattern>
        </defs>
      )}
      {exclude.map((e, k) => (
        <rect key={k} x={e.x} y={bedD - e.y - e.d} width={e.w} height={e.d} fill="url(#thumb-hatch)">
          <title>Kept free by the printer: Bambu Studio won’t slice a part here</title>
        </rect>
      ))}
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
