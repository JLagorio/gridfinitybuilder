import { useStore, useUnits } from '../state/store';
import { LengthInput, Select } from './fields';
import { Combobox } from './combobox';
import { PRINTERS } from '../lib/printers';
import { bedText, usableBed } from '../lib/bedfit';
import { MAX_PRINTERS, baseplatePicked, biggestPrinter, printerNames } from '../lib/layout/fleet';
import { addPrinter, removePrinter, setBaseplatePrinter, setPrinterAt } from '../state/printers';
import './printers.css';

/** The printer list, as the model pickers show it. */
export const PRINTER_OPTIONS = PRINTERS.map((p) => ({
  value: p.id,
  label: p.id === 'custom' ? p.name : `${p.name} — ${p.bedW}×${p.bedD}`,
  group: p.brand,
}));

/**
 * The printers after the first (fleet.ts): each with its own model, bed and
 * edge margin; add or remove them, and pick which one prints the baseplate.
 */
export function MorePrinters() {
  const setup = useStore((s) => s.setup);
  const { fmt } = useUnits();
  const list = setup.printers ?? [];
  const names = printerNames(setup);
  const biggest = biggestPrinter(setup);
  const picked = baseplatePicked(setup) ? String(setup.baseplatePrinter) : 'auto';
  return (
    <div className="more-printers">
      {list.map((p, i) => (
        <div key={i} className="printer-card">
          <div className="printer-card-head">
            <b>Printer {i + 2}</b>
            <button className="link" onClick={() => removePrinter(i + 1)}>
              Remove
            </button>
          </div>
          <Combobox label="Model" value={p.printerId} options={PRINTER_OPTIONS} onChange={(printerId) => setPrinterAt(i + 1, { printerId })} />
          {p.printerId === 'custom' && (
            <div className="row3">
              <LengthInput label="Bed X" value={p.bedW} min={80} max={1000} onChange={(bedW) => setPrinterAt(i + 1, { bedW })} />
              <LengthInput label="Bed Y" value={p.bedD} min={80} max={1000} onChange={(bedD) => setPrinterAt(i + 1, { bedD })} />
              <LengthInput label="Max Z" value={p.maxH} min={20} max={1000} onChange={(maxH) => setPrinterAt(i + 1, { maxH })} />
            </div>
          )}
          <LengthInput
            label="Edge margin"
            value={p.plateMargin}
            max={40}
            onChange={(plateMargin) => setPrinterAt(i + 1, { plateMargin })}
            hint={`Usable bed ${bedText(usableBed({ ...p, bedW: Math.max(p.bedW, 2 * p.plateMargin), bedD: Math.max(p.bedD, 2 * p.plateMargin), spacing: setup.spacing }), fmt)}`}
          />
        </div>
      ))}
      {list.length + 1 < MAX_PRINTERS && (
        <button onClick={addPrinter} title="A second printer prints part of the job at the same time">
          {list.length ? 'Add another printer' : 'Add a printer'}
        </button>
      )}
      {list.length > 0 && (
        <Select
          label="Baseplate prints on"
          value={picked}
          options={[
            { value: 'auto', label: `The biggest (${names[biggest]})` },
            ...names.map((n, i) => ({ value: String(i), label: n })),
          ]}
          onChange={(v) => setBaseplatePrinter(v === 'auto' ? undefined : Number(v))}
          hint={
            picked === 'auto'
              ? 'The baseplate is split for the biggest bed. Its plates can go to another printer that takes them. Everything else is shared out so the printers finish at about the same time.'
              : 'The baseplate is split for this printer and prints on it. Everything else is shared out so the printers finish at about the same time.'
          }
        />
      )}
    </div>
  );
}
