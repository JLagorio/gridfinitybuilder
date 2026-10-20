import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BinOptions } from '../lib/geometry/bin';
import { LABEL_MAX_CHARS, LABEL_MAX_LINES, sanitizeLabelText, type LabelTextStyle } from '../lib/geometry/labels';
import { Field, Segmented, Toggle } from './fields';

/**
 * Multi-line label text. Commits after a short pause and on blur, so the bin
 * isn't rebuilt on every keystroke. Enter adds a line (up to the limit).
 */
export function LabelTextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
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
    const clean = sanitizeLabelText(v);
    if (clean !== value) onChange(clean);
  };
  const lines = text.split('\n').length;
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="input-wrap label-text">
        <textarea
          id={id}
          rows={Math.min(LABEL_MAX_LINES, Math.max(1, lines))}
          value={text}
          maxLength={LABEL_MAX_CHARS}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            const v = e.target.value.split('\n').length > LABEL_MAX_LINES ? text : e.target.value;
            setText(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(v), 600);
          }}
          onBlur={() => {
            focused.current = false;
            commit(text);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(text);
            if (e.key === 'Escape') {
              setText(value);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
      </div>
    </Field>
  );
}

const STYLES: { value: LabelTextStyle; label: string; title: string }[] = [
  { value: 'raised', label: 'Raised', title: 'Letters stand 0.5 mm proud of the tab' },
  { value: 'engraved', label: 'Engraved', title: 'Letters cut 0.6 mm into the tab' },
  { value: 'inlaid', label: 'Inlaid', title: 'Engraved and filled flush in a second filament (AMS)' },
];

/** Bin-level label text, style and swappable plates. Shown while the bin has label tabs. */
export function LabelFields({ opts, onChange }: { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void }) {
  const compTexts = Object.values(opts.layout?.comps ?? {}).some((c) => !!c.labelText?.trim());
  const tabs = opts.label !== 'none' || Object.values(opts.layout?.comps ?? {}).some((c) => c.label && c.label !== 'none');
  if (opts.interior !== 'compartments' || !tabs) return null;
  const any = !!opts.labelText.trim() || compTexts;
  return (
    <div className="indent label-fields">
      <LabelTextField
        label="Label text"
        value={opts.labelText}
        onChange={(labelText) => onChange({ labelText })}
        placeholder="M3 screws"
        hint={
          compTexts
            ? 'Used for compartments without their own text (set those in Compartments).'
            : `Up to ${LABEL_MAX_LINES} lines; it shrinks to fit each tab. Give compartments their own text in Compartments.`
        }
      />
      {any && (
        <>
          <Segmented
            label="Text"
            value={opts.labelStyle}
            options={STYLES}
            onChange={(labelStyle) => onChange({ labelStyle })}
            hint={opts.labelStyle === 'inlaid' ? 'Prints the letters in filament 2: needs an AMS or a filament change. Pick the colour in Print plates.' : undefined}
          />
          <Toggle
            label="Swappable label plates"
            checked={opts.labelPlates}
            onChange={(labelPlates) => onChange({ labelPlates })}
            hint={
              opts.labelPlates
                ? 'Each tab gets a shallow recess; the text goes on small plates that print with the bins and press in. Pry them out at the notch to relabel.'
                : 'Put the text on small plates that press into the tab, so you can relabel later.'
            }
          />
        </>
      )}
    </div>
  );
}
