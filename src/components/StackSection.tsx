import { useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { Section } from './fields';
import { binLabel } from '../lib/geometry/bin';
import { labelCaption } from '../lib/geometry/labelContents';
import { binCellsAt, type PlacedBin, type PrintJob } from '../lib/project';
import { binForStack, columnHeight, stackProblem, stacksOf } from '../lib/stacking';
import { usableBed } from '../lib/bedfit';
import { roomForStack, stackBin, unstackBin } from '../state/stacks';
import './stackLevels.css';

const levelName = (i: number) => (i === 0 ? 'Floor' : `Level ${i + 1}`);

/**
 * The selected bin's stack (stacking.ts): stack a bin on it, pick another
 * level, or take it off the stack. Bins stack on a stacking lip and take the
 * footprint of the bin below.
 */
export function StackSection({ job, bin }: { job: PrintJob; bin: PlacedBin }) {
  const bins = useStore((s) => s.bins);
  const newBin = useStore((s) => s.newBin);
  const setup = useStore((s) => s.setup);
  const drawer = useStore((s) => s.drawer);
  const wall = drawer.enclosure === 'wall';
  const setUI = useStore((s) => s.setUI);
  const { fmt } = useUnits();
  const [msg, setMsg] = useState<string | null>(null);
  const layout = job.layout;
  const st = stacksOf(bins);
  const col = st.columns.get(st.root.get(bin.id) ?? bin.id) ?? [bin];
  const level = st.level.get(bin.id) ?? 0;
  const top = col[col.length - 1];
  const room = job.drawers[0]?.room ?? Infinity;
  const height = columnHeight(layout, col);
  // What "Stack a bin on this" adds, on the top of the stack (an auto-height carry case grows to fit it).
  const next = binForStack(layout, bins, bin, newBin, usableBed(setup), roomForStack(drawer, room), wall);
  const onTop = top.id === bin.id;
  const weak = col.slice(0, -1).flatMap((b, i) => {
    const why = stackProblem(layout, b, wall);
    return why ? [`${levelName(i)} can’t hold the bin on it. ${why}`] : [];
  });
  const name = (b: PlacedBin) => {
    const caption = labelCaption(b);
    return `${binLabel(b.opts, binCellsAt(layout, b))}${caption ? ` “${caption}”` : ''}`;
  };

  const stack = () => {
    const r = stackBin(bin.id);
    setMsg(r.error ?? null);
  };
  const unstack = () => setMsg(unstackBin(bin.id) ? null : 'No free spot on the floor for it: clear some room first.');

  return (
    <Section title="Stacking">
      {col.length > 1 && (
        <>
          <div className="stack-levels" role="group" aria-label="Levels of this stack">
            {col.map((b, i) => (
              <button key={b.id} className={`stack-level ${i === level ? 'current' : ''}`} onClick={() => setUI({ selectedBinId: b.id })} aria-pressed={i === level}>
                <b>{levelName(i)}</b>
                <span>{name(b)}</span>
              </button>
            ))}
          </div>
          <p className="muted small">
            {col.length} bins, {fmt(height)} tall{room < Infinity ? ` (${fmt(room)} of room above the baseplate)` : ''}. The stack moves and resizes as one; deleting a
            bin takes the bins on it too.
          </p>
          {height > room + 1e-6 && <div className="field-error">The stack is taller than the drawer.</div>}
          {weak.map((w) => (
            <div key={w} className="field-error">
              {w}
            </div>
          ))}
        </>
      )}
      <div className="button-row">
        <button onClick={stack} disabled={!next.bin} title={next.error}>
          {onTop ? 'Stack a bin on this' : 'Stack a bin on top'}
        </button>
        {level > 0 && <button onClick={unstack}>Move to the floor</button>}
      </div>
      <div className="field-hint">
        {next.bin
          ? `Adds a ${binLabel(next.bin.opts, binCellsAt(layout, next.bin))} bin ${onTop ? 'on its lip' : 'on the top bin'}: same footprint, new bin settings.`
          : !onTop && stackProblem(layout, top, wall)
            ? `The top bin can’t hold another. ${next.error}`
            : next.error}
      </div>
      {msg && <div className="field-error">{msg}</div>}
    </Section>
  );
}
