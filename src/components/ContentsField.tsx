import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { Field } from './fields';
import { CONTENTS_MAX_CHARS, binEntry, contentLines, sanitizeContents, type CompEntry } from '../lib/inventory';
import { binCellsAt, type PlacedBin } from '../lib/project';
import type { GridLayout } from '../lib/layout/drawer';
import { sanitizeLabelText } from '../lib/geometry/labels';
import { selectCompartment, useInterior } from './interiorState';

/**
 * Contents text, one item per line. Commits after a short pause and on blur
 * (so typing is one undo step, not one per key); Esc puts the old text back.
 */
export function ContentsText({
  label,
  value,
  onChange,
  placeholder,
  hint,
  minRows = 2,
  maxRows = 10,
  ariaLabel,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  minRows?: number;
  maxRows?: number;
  ariaLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (sanitizeContents(v) !== value) onChange(v);
  };
  const rows = Math.min(maxRows, Math.max(minRows, text.split('\n').length));
  const area = (
    <div className="input-wrap contents-text">
      <textarea
        id={id}
        rows={rows}
        value={text}
        maxLength={CONTENTS_MAX_CHARS}
        placeholder={placeholder}
        aria-label={label ? undefined : ariaLabel}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), 700);
        }}
        onBlur={() => {
          focused.current = false;
          commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(text);
          if (e.key === 'Escape') {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            setText(value);
            focused.current = false;
            (e.target as HTMLTextAreaElement).blur();
            e.stopPropagation();
          }
        }}
      />
    </div>
  );
  return label ? (
    <Field label={label} hint={hint} id={id}>
      {area}
    </Field>
  ) : (
    area
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One compartment's contents, in the bin sidebar. Clicking its name selects it in the compartment editor. */
function CompRow({ binId, c, active }: { binId: string; c: CompEntry; active: boolean }) {
  const setCompContents = useStore((s) => s.setCompContents);
  const bin = useStore((s) => s.bins.find((b) => b.id === binId));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  return (
    <div ref={ref} className={`contents-comp ${active ? 'active' : ''}`}>
      <button className="contents-comp-name" onClick={() => selectCompartment(binId, c.key)} title="Select this compartment in the Compartments view">
        {capital(c.name)}
        {c.label && <span className="muted"> · “{c.label}”</span>}
      </button>
      <ContentsText
        ariaLabel={`What's in the ${c.name} compartment`}
        value={bin?.compContents?.[c.key] ?? ''}
        onChange={(t) => setCompContents(binId, c.key, t)}
        placeholder="Nothing listed"
        minRows={1}
        maxRows={6}
      />
    </div>
  );
}

/**
 * "What's in it" for the selected bin: free text for the whole bin, and per
 * compartment when it has several. Not geometry: nothing is rebuilt, and it's
 * what search, the drawer map and the contents list use.
 */
export function BinContentsFields({ bin, grid, onLabel }: { bin: PlacedBin; grid: GridLayout; onLabel?: (labelText: string) => void }) {
  const setBinContents = useStore((s) => s.setBinContents);
  const entry = useMemo(() => binEntry({ id: '', name: '' }, bin, binCellsAt(grid, bin)), [bin, grid]);
  const sel = useInterior();
  const selComp = sel.binId === bin.id ? sel.compKey : null;
  const lines = contentLines(bin.contents);
  const filled = entry.comps.filter((c) => c.contents.length).length;
  const [open, setOpen] = useState(filled > 0);
  useEffect(() => {
    if (selComp && entry.comps.some((c) => c.key === selComp)) setOpen(true);
  }, [selComp, entry.comps]);
  const tabs = bin.opts.interior === 'compartments' && bin.opts.label !== 'none';
  const suggest = onLabel && tabs && !bin.opts.labelText.trim() && lines.length > 0 ? sanitizeLabelText(lines[0]) : '';

  return (
    <div className="contents-fields">
      <ContentsText
        label="What's in it"
        value={bin.contents ?? ''}
        onChange={(t) => setBinContents(bin.id, t)}
        placeholder={'One thing per line, e.g.\nM3 × 8 screws\nM3 nuts'}
        hint={
          <>
            For finding things (<kbd>/</kbd>) and the drawer map. It doesn't change the print.
            {suggest && (
              <>
                {' '}
                <button className="link" onClick={() => onLabel!(suggest)}>
                  Print “{suggest}” on the label
                </button>
              </>
            )}
          </>
        }
      />
      {entry.comps.length > 0 && (
        <details className="advanced option-group contents-comps" open={open || undefined} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            <span>By compartment</span>
            <small>
              {filled ? `${filled} of ${entry.comps.length} listed` : `${entry.comps.length} compartments`}
            </small>
          </summary>
          {entry.comps.map((c) => (
            <CompRow key={c.key} binId={bin.id} c={c} active={c.key === selComp} />
          ))}
        </details>
      )}
    </div>
  );
}
