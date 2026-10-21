import './colours.css';
import { useId, type ReactNode } from 'react';
import { paletteOf, MIN_SHOWN_SLOTS } from '../lib/colours';
import { inkOn } from '../lib/colourPresets';
import type { PrintSetup } from '../lib/layout/plan';

/**
 * Pick a filament slot: a swatch per palette slot (colours.ts), and an
 * optional "none" choice (`unset`: follow the default). A radio group, so
 * the arrow keys move along it.
 */
export function SlotPicker({
  label,
  setup,
  value,
  onChange,
  unset,
  hint,
  count,
}: {
  label: string;
  setup: Pick<PrintSetup, 'filaments'>;
  /** The slot picked, or undefined for `unset`. */
  value: number | undefined;
  onChange: (slot: number | undefined) => void;
  /** Text of the choice that sets nothing ("Bins colour"); none: a slot must be picked. */
  unset?: string;
  hint?: ReactNode;
  /** Slots to offer; default: the palette's (at least MIN_SHOWN_SLOTS). */
  count?: number;
}) {
  const id = useId();
  const palette = paletteOf(setup, count ?? MIN_SHOWN_SLOTS);
  const shown = count ? palette.slice(0, count) : palette;
  return (
    <div className="field slot-picker">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="slot-swatches" role="radiogroup" aria-labelledby={id}>
        {unset && (
          <button type="button" role="radio" aria-checked={value === undefined} className={`slot-swatch unset${value === undefined ? ' active' : ''}`} onClick={() => onChange(undefined)} title={unset}>
            {unset}
          </button>
        )}
        {shown.map((f, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i + 1}
            aria-label={`Slot ${i + 1}: ${f.name ?? f.colour}`}
            title={`Slot ${i + 1} · ${f.name ?? f.colour}`}
            className={`slot-swatch${value === i + 1 ? ' active' : ''}`}
            style={{ background: f.colour, color: inkOn(f.colour) }}
            onClick={() => onChange(i + 1)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}
