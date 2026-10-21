import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { comboKey, filterOptions, firstEnabled, fold, groupOptions, moveActive, type PickOption } from '../lib/pickList';
import { Field, labelIdOf } from './fields';
import { Chevron, OptionList, layerFor, optionId, usePopup, useReveal, type PickProps } from './select';

/**
 * Pick one of many: like Select (fields.tsx), but a text box that filters the
 * list as you type, by label, group and `keywords` (lib/pickList.ts). For lists
 * too long to scan. In a module of its own so the first screen doesn't load it.
 */
export function Combobox<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: T;
  options: readonly PickOption<T>[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  /** Shown when the text is cleared. */
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <ComboboxInput id={id} labelId={labelIdOf(id)} value={value} options={options} onChange={onChange} placeholder={placeholder} />
    </Field>
  );
}

/**
 * Editable combobox for long lists: type to filter by label, group or
 * keywords ("556", "300 blk", "m3"), ignoring case, spaces and punctuation.
 * Arrows move, Enter picks, Tab takes an option moved to with the arrows,
 * Escape (or leaving the field without picking) puts the current value back.
 * The chevron shows the whole list; on a touch screen without opening the keyboard.
 */
export function ComboboxInput<T extends string>({ id, labelId, value, options, onChange, placeholder }: PickProps<T> & { placeholder?: string }) {
  const current = options.find((o) => o.value === value);
  /** What's typed, while filtering; null shows the current value's label and every option. */
  const [edit, setEdit] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** The active option was reached with the arrow keys (Tab takes it). */
  const navigated = useRef(false);
  const finger = useRef(false);
  const toggledBy = useRef('');
  const pointerFocus = useRef(false);
  const listId = `${id}-list`;

  const shownFor = (text: string | null) => groupOptions(text === null ? options : filterOptions(options, text));
  const groups = shownFor(edit);
  const flat = groups.flatMap((g) => g.options);
  const searching = edit !== null && !!fold(edit);

  /** Where the highlight starts for a list: the first match while searching, else the current value. */
  const startAt = (list: readonly PickOption<T>[], search: boolean) => {
    const at = search ? -1 : list.findIndex((o) => o.value === value);
    return at >= 0 ? at : firstEnabled(list);
  };
  /** Open the list: what's typed (`all`: every option, as the chevron shows them). */
  const show = (all = false) => {
    navigated.current = false;
    if (all) setEdit(null);
    setActive(all ? startAt(shownFor(null).flatMap((g) => g.options), false) : startAt(flat, searching));
    setLayer(layerFor(wrap.current));
    setOpen(true);
  };
  const revert = () => {
    setEdit(null);
    setOpen(false);
  };
  const pick = (i: number) => {
    const o = flat[i];
    if (!o || o.disabled) return;
    revert();
    if (o.value !== value) onChange(o.value);
  };
  usePopup(open, id, wrap, pop, revert);
  const activeId = open && active >= 0 && active < flat.length ? optionId(listId, active) : undefined;
  useReveal(open, pop, activeId, edit);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const act = comboKey(e, open, navigated.current);
    if (!act) return;
    switch (act.type) {
      case 'open':
        e.preventDefault();
        show();
        break;
      case 'move':
        e.preventDefault();
        navigated.current = true;
        setActive(moveActive(flat, active, act.move));
        break;
      case 'pick':
        e.preventDefault();
        pick(active);
        break;
      case 'pickAndLeave':
        pick(active);
        break;
      case 'revert':
        // Nothing to undo: leave Escape to the dialog or the app.
        if (!open && edit === null) return;
        e.preventDefault();
        e.stopPropagation();
        revert();
        break;
    }
  };

  const n = flat.length;
  return (
    <div ref={wrap} className={`input-wrap pick-combo${open ? ' open' : ''}`}>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-labelledby={labelId}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder={placeholder ?? 'Type to search'}
        value={edit ?? current?.label ?? ''}
        onChange={(e) => {
          const text = e.target.value;
          const list = shownFor(text).flatMap((g) => g.options);
          setEdit(text);
          navigated.current = false;
          setActive(startAt(list, !!fold(text)));
          if (!open) {
            setLayer(layerFor(wrap.current));
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
        onPointerDown={() => (pointerFocus.current = document.activeElement !== input.current)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => {
          // A click that focused the field selects its text (so typing replaces it) and opens the list.
          if (pointerFocus.current) e.currentTarget.select();
          pointerFocus.current = false;
          if (!open) show();
        }}
        onBlur={revert}
      />
      <button
        type="button"
        tabIndex={-1}
        className="pick-combo-toggle"
        aria-label={open ? 'Hide the options' : 'Show all options'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        // Not the focus: the text box keeps it (or, on a touch screen, nothing takes it, so no keyboard).
        onPointerDown={(e) => {
          e.preventDefault();
          toggledBy.current = e.pointerType;
        }}
        onClick={() => {
          if (open) revert();
          else {
            show(true);
            if (toggledBy.current !== 'touch' && toggledBy.current !== 'pen') input.current?.focus();
          }
          toggledBy.current = '';
        }}
      >
        <Chevron />
      </button>
      {open &&
        layer &&
        createPortal(
          <div
            ref={pop}
            className="pick-pop"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => (finger.current = e.pointerType !== 'mouse')}
          >
            <OptionList
              id={listId}
              labelId={labelId}
              groups={groups}
              value={value}
              active={active}
              onHover={setActive}
              onPick={(i) => {
                pick(i);
                // A finger's pick puts the phone's keyboard away.
                if (finger.current) input.current?.blur();
              }}
            />
            {!n && <div className="pick-empty">No matches</div>}
            <div className="pick-status" role="status">
              {searching ? (n ? `${n} match${n === 1 ? '' : 'es'}` : 'No matches') : ''}
            </div>
          </div>,
          layer,
        )}
    </div>
  );
}
