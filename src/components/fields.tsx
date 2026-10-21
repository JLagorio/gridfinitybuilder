import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { lengthFieldText, parseLength, type Units } from '../lib/units';
import { useUnits } from '../state/store';
import { useFind } from './findContext';

/**
 * A sidebar section. `find` is its id in the panel's search index
 * (panelIndex.ts): it hides while a search doesn't match it, and in the Basic
 * view unless it's a basic section or `set` (something in it isn't the default).
 */
export function Section({ title, children, aside, find, set }: { title: string; children: ReactNode; aside?: ReactNode; find?: string; set?: boolean }) {
  const { show } = useFind(find, set);
  return (
    <section className="section" hidden={!show}>
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

/**
 * A folding group of options with a summary of what's set. It starts open when
 * anything in it isn't the default (`active`), and says so with a dot while
 * folded. A search that matches something in it opens it; clearing the search
 * folds it back the way it was. `find`: as for Section.
 */
export function Group({ title, status, active = false, find, children }: { title: string; status: string; active?: boolean; find?: string; children: ReactNode }) {
  const f = useFind(find, active);
  // Decided once (the panel is keyed by bin), so turning an option off doesn't snap the group shut.
  const [open, setOpen] = useState(active);
  return (
    <details
      className={`advanced option-group${active ? ' set' : ''}`}
      hidden={!f.show}
      open={(f.searching && f.show) || open || undefined}
      // Only the user's own folding counts, not a search opening it.
      onToggle={(e) => !f.searching && setOpen(e.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        <small>{status}</small>
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

const fmt = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);

/**
 * Length input stored in mm. Shows mm or inches (fractions to the chosen
 * precision); accepts "20 1/8in", "1' 2\"", "51cm", "44.5mm" whatever the units.
 * Units default to the app-wide setting.
 */
export function LengthInput({
  label,
  value,
  onChange,
  units: unitsProp,
  min = 0,
  max = 5000,
  hint,
  placeholder,
  allowEmpty = false,
}: {
  label: string;
  value: number;
  onChange: (mm: number) => void;
  units?: Units;
  min?: number;
  max?: number;
  hint?: ReactNode;
  placeholder?: string;
  /** Empty text means 0 (e.g. "unknown"). */
  allowEmpty?: boolean;
}) {
  const id = useId();
  const app = useUnits();
  const units = unitsProp ?? app.units;
  const shown = allowEmpty && !value ? '' : lengthFieldText(value, units, app.precision);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (allowEmpty && !text.trim()) {
      setBad(false);
      onChange(0);
      return;
    }
    const v = parseLength(text, units);
    if (v === null || v < min || v > max) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(Math.round(v * 1000) / 1000);
  };
  return (
    <Field label={label} hint={bad ? <span className="field-error-inline">Try 510.5, 20 1/8 or 1' 8 1/8"</span> : hint} id={id}>
      <div className={`input-wrap ${bad ? 'bad' : ''}`}>
        <input
          id={id}
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span className="suffix">{units}</span>
      </div>
    </Field>
  );
}

/** Plain text field that commits on blur / Enter. */
export function TextInput({
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
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onChange(text);
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="input-wrap">
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </div>
    </Field>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 0.1,
  suffix = 'mm',
  hint,
  digits = 2,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: ReactNode;
  digits?: number;
}) {
  const id = useId();
  const shown = fmt(value, digits);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  // Don't rewrite the text under the cursor while typing ("1." must stay "1.").
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = (raw = text) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < min || v > max) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(v);
  };
  return (
    <Field label={label} hint={hint} id={id}>
      <div className={`input-wrap ${bad ? 'bad' : ''}`}>
        <input
          id={id}
          type="number"
          step={step}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Apply valid values live (spinner clicks, typing); flag bad ones on blur.
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) {
              setBad(false);
              onChange(v);
            }
          }}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 99,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  hint?: ReactNode;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <Field label={label} hint={hint}>
      <div className="stepper">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
          −
        </button>
        <span className="stepper-value">
          {value}
          {suffix && <small>{suffix}</small>}
        </span>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>
          +
        </button>
      </div>
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field toggle-field">
      <label className="toggle" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden />
        <span className="toggle-label">{label}</span>
      </label>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
  ariaLabel,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  /** Its name for screen readers when it has no label (under a heading that says what it is). */
  ariaLabel?: string;
}) {
  const body = (
    <div className="segmented" role="radiogroup" aria-label={label ?? ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (label)
    return (
      <Field label={label} hint={hint}>
        {body}
      </Field>
    );
  return hint ? (
    <div className="field">
      {body}
      <div className="field-hint">{hint}</div>
    </div>
  ) : (
    body
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="select-wrap">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {groups.map((g) =>
            g ? (
              <optgroup key={g} label={g}>
                {options
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ) : (
              options
                .filter((o) => !o.group)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))
            ),
          )}
        </select>
      </div>
    </Field>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format = (v: number) => String(v),
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="slider">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
        <output htmlFor={id}>{format(value)}</output>
      </div>
    </Field>
  );
}
