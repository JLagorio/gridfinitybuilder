import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { binFrontLabel, binLabelPlates, binLabelTabs, binSize, binTotalHeight, type BinOptions } from '../lib/geometry/bin';
import { binBodyHeight } from '../lib/geometry/variants';
import { BASE_PROFILE_HEIGHT } from '../lib/geometry/spec';
import {
  FRONT_LABEL_MAX_SIZE,
  LABEL_MAX_LINES,
  LABEL_MAX_RAW,
  capFor,
  labelLines,
  plateTextBox,
  sanitizeLabelText,
  type Box,
  type FrontLabelStyle,
  type LabelFormat,
  type LabelTextStyle,
} from '../lib/geometry/labels';
import { CONTENTS_FRAGMENT } from '../lib/geometry/labelIcons';
import { contentsFragment, resolveContentLabels } from '../lib/geometry/labelContents';
import { FRONT_LABEL } from '../lib/geometry/frontLabel';
import { useStore, useUnits } from '../state/store';
import { Field, Segmented, Select, Slider, Toggle } from './fields';
import { FacePreview, IconPicker, LabelPreview, previewText } from './LabelIconPicker';

/** How many lines of "What's in it" the text asks for (0: none). */
function contentsLines(text: string): number {
  const m = new RegExp(CONTENTS_FRAGMENT.source, 'i').exec(text);
  return m ? Number(m[1]) || 1 : 0;
}

export interface LabelPreviewShape {
  /** Label face, mm. */
  w: number;
  h: number;
  cap: number;
  /** Where the text goes on the face (default: 1 mm margins). */
  box?: Box;
}

/** Generic label face for the preview when the field doesn't know its tab. */
const DEFAULT_PREVIEW: LabelPreviewShape = { w: 36, h: 11, cap: capFor(11) };

/**
 * Multi-line label text. Commits after a short pause and on blur, so the bin
 * isn't rebuilt on every keystroke. Enter adds a line (up to the limit). An
 * icon picker inserts `{fragments}` at the caret; a live preview shows the
 * label as it will print; "What's in it" can supply the text.
 */
export function LabelTextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  preview = DEFAULT_PREVIEW,
  contents,
  fromContents = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  /** The label face for the preview; null for none. */
  preview?: LabelPreviewShape | null;
  /** What `{contents}` stands for in the preview (undefined: not known here). */
  contents?: string;
  /** Offer taking the text from "What's in it". */
  fromContents?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
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
  const insert = (frag: string) => {
    const el = area.current;
    const a = el && focused.current ? el.selectionStart : text.length;
    const b = el && focused.current ? el.selectionEnd : text.length;
    const pad = a > 0 && !/[\s{]$/.test(text.slice(0, a)) && !frag.startsWith('{<') && !frag.startsWith('{>') ? ' ' : '';
    const next = text.slice(0, a) + pad + frag + text.slice(b);
    setText(next);
    commit(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = a + pad.length + frag.length;
      el.setSelectionRange(at, at);
    });
  };
  const lines = text.split('\n').length;
  const asks = contentsLines(text);
  const setContents = (n: number) => {
    let next: string;
    if (n === 0) {
      // Keep what it prints now, as typed text.
      const shown = previewText(text, contents);
      next = contents !== undefined && shown !== text ? shown : text.replace(new RegExp(CONTENTS_FRAGMENT.source, 'gi'), '').trim();
    } else if (asks) next = text.replace(new RegExp(CONTENTS_FRAGMENT.source, 'gi'), contentsFragment(n));
    else next = contentsFragment(n);
    setText(next);
    commit(next);
  };
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="label-text-row">
        <div className="input-wrap label-text">
          <textarea
            ref={area}
            id={id}
            rows={Math.min(LABEL_MAX_LINES, Math.max(1, lines))}
            value={text}
            maxLength={LABEL_MAX_RAW}
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
        <IconPicker onPick={insert} />
      </div>
      {fromContents && (
        <div className="lp-contents-row">
          <span>From What&apos;s in it</span>
          <Segmented
            value={asks}
            options={[
              { value: 0, label: 'Off', title: 'Type the label yourself' },
              { value: 1, label: '1st line', title: 'Print the first item of What’s in it ({contents}); it follows the list as you edit it' },
              { value: 2, label: '2 lines', title: 'Print the first two items ({contents:2})' },
            ]}
            onChange={setContents}
          />
        </div>
      )}
      {preview && text.trim() && <LabelPreview text={text} w={preview.w} h={preview.h} cap={preview.cap} box={preview.box} contents={contents} />}
    </Field>
  );
}

const STYLES: { value: LabelTextStyle; label: string; title: string }[] = [
  { value: 'raised', label: 'Raised', title: 'Letters stand 0.5 mm proud of the tab' },
  { value: 'engraved', label: 'Engraved', title: 'Letters cut 0.6 mm into the tab' },
  { value: 'inlaid', label: 'Inlaid', title: 'Engraved and filled flush in a second filament (AMS)' },
];

const FORMATS: { value: LabelFormat; label: string; title: string }[] = [
  { value: 'gridfit', label: 'Gridfit', title: 'Our plates: a 1 mm recess with a finger notch' },
  { value: 'cullenect', label: 'Cullenect', title: 'Sockets for Cullenect labels (36 × 11 mm per unit, snap ribs)' },
  { value: 'pred', label: 'Pred', title: 'Sockets for Pred’s labels (37.8 × 11.5 mm per unit, nubs under the lip)' },
];

const FRONT_STYLES: { value: FrontLabelStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'raised', label: 'Raised' },
  { value: 'two-tone', label: 'Raised, 2 colours' },
  { value: 'engraved', label: 'Engraved' },
  { value: 'inlaid', label: 'Inlaid (2 colours)' },
];

const FRONT_HINTS: Record<Exclude<FrontLabelStyle, 'none'>, string> = {
  raised: `Letters stand ${FRONT_LABEL.raise} mm proud of the wall: for bins on the front row (or a shelf). A bin right in front of it would touch them.`,
  'two-tone': `Raised ${FRONT_LABEL.raise} mm and printed in filament 2 (AMS): for bins on the front row (or a shelf).`,
  engraved: `Cut ${FRONT_LABEL.depth} mm in, flush, so bins can stand in front of it. The wall is thickened on the inside behind the text.`,
  inlaid: `Engraved and filled flush in filament 2 (AMS). The wall is thickened on the inside behind the text.`,
};

const FORMAT_HINTS: Record<LabelFormat, string> = {
  gridfit:
    'Each tab gets a shallow recess; the text goes on small plates that print with the bins and press in. Pry them out at the notch to relabel.',
  cullenect:
    'Each tab gets a Cullenect socket: 1.5 mm deep with snap ribs. Labels are 42 mm × units − 6 by 11 mm (36 × 11 for one unit); gflabel makes them too (--base cullenect).',
  pred: 'Each tab gets a socket for Pred’s labels: 42 mm × units − 4.2 by 11.5 mm (37.8 for one unit); the end nubs tuck under the lip. gflabel makes them too (--base pred).',
};

/** Bin-level label text, style, swappable plates / label sockets and the front label. */
export function LabelFields({ opts, onChange }: { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void }) {
  const { fmt } = useUnits();
  // The placed bin these options belong to (for "What's in it").
  const bin = useStore((s) => s.bins.find((b) => b.id === s.ui.selectedBinId && b.opts === opts) ?? null);
  const compTexts = Object.values(opts.layout?.comps ?? {}).some((c) => !!c.labelText?.trim());
  const tabs =
    opts.interior === 'compartments' && (opts.label !== 'none' || Object.values(opts.layout?.comps ?? {}).some((c) => c.label && c.label !== 'none'));
  const front = opts.frontLabel !== 'none';
  const any = !!opts.labelText.trim() || compTexts;
  const resolved = bin ? resolveContentLabels(opts, bin) : opts;

  // The tab (or plate) the text preview shows.
  let shape: LabelPreviewShape | null = null;
  if (tabs) {
    const plate = opts.labelPlates ? binLabelPlates({ ...resolved, labelPrint: true })[0] : undefined;
    const tab = binLabelTabs(resolved)[0];
    if (plate) shape = { w: plate.width, h: plate.depth, cap: capFor(plate.depth), box: plateTextBox(plate) };
    else if (tab) shape = { w: tab.x1 - tab.x0, h: tab.y1 - tab.y0, cap: capFor(tab.y1 - tab.y0) };
  }
  const plan = front ? binFrontLabel(resolved) : null;
  const platesFit = tabs && opts.labelPlates ? binLabelPlates({ ...resolved, labelPrint: true }).length : 0;

  const textHint = compTexts
    ? 'Used for compartments without their own text (set those in Compartments).'
    : any
      ? `Up to ${LABEL_MAX_LINES} lines; it shrinks to fit. Icons: {bolt:12}, {nut}, {washer}…${tabs ? ' Give compartments their own text in Compartments.' : ''}`
      : tabs
        ? 'No label text yet, so the tab prints blank. Type text here, or give compartments their own in Compartments.'
        : 'Type the text for the front of the bin.';

  return (
    <div className={`label-fields ${tabs ? 'indent' : ''}`}>
      {(tabs || front) && (
        <LabelTextField
          label="Label text"
          value={opts.labelText}
          onChange={(labelText) => onChange({ labelText })}
          placeholder="Type the label (e.g. M3 screws)"
          hint={textHint}
          preview={shape}
          contents={bin ? (bin.contents ?? '') : undefined}
        />
      )}
      {tabs && any && (
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
            hint={opts.labelPlates ? undefined : 'Put the text on small plates that press into the tab, so you can relabel later.'}
          />
          {opts.labelPlates && (
            <div className="indent">
              <Segmented
                label="Label format"
                value={opts.labelFormat}
                options={FORMATS}
                onChange={(labelFormat) => onChange({ labelFormat })}
                hint={
                  platesFit === 0
                    ? 'The tabs are too small for these labels, so the text goes on the tabs.'
                    : FORMAT_HINTS[opts.labelFormat]
                }
              />
              {opts.labelFormat !== 'gridfit' && (
                <Toggle
                  label="Print the labels too"
                  checked={opts.labelPrint}
                  onChange={(labelPrint) => onChange({ labelPrint })}
                  hint={opts.labelPrint ? 'One label per tab, with this text, prints with the bins.' : 'Only the sockets: bring your own labels.'}
                />
              )}
            </div>
          )}
        </>
      )}
      <Select<FrontLabelStyle>
        label="Front label"
        value={opts.frontLabel}
        options={FRONT_STYLES}
        onChange={(frontLabel) => onChange({ frontLabel })}
        hint={
          front
            ? plan
              ? FRONT_HINTS[opts.frontLabel as Exclude<FrontLabelStyle, 'none'>]
              : !any
                ? 'Type label text for the front.'
                : contentsLines(opts.labelText) && !labelLines(resolved.labelText)
                  ? 'Nothing to print yet: the label takes its text from What’s in it, which is empty.'
                  : 'No room on the front wall for text (the bin is too short, or the wall is cut away).'
            : 'Text on the outside of the front wall, for bins on the front row or a shelf.'
        }
      />
      {front && plan && (
        <div className="indent">
          <Slider
            label="Letter height"
            value={opts.frontLabelSize}
            min={0}
            max={Math.min(FRONT_LABEL_MAX_SIZE, Math.floor(plan.segments[0].box.y1 - plan.segments[0].box.y0))}
            step={0.5}
            format={(v) => (v === 0 ? 'Auto' : fmt(v))}
            onChange={(frontLabelSize) => onChange({ frontLabelSize: frontLabelSize > 0 && frontLabelSize < 2 ? 2 : frontLabelSize })}
          />
          <FrontPreview opts={resolved} />
        </div>
      )}
    </div>
  );
}

/** The bin's front face with its label, as it will print. */
function FrontPreview({ opts }: { opts: BinOptions }) {
  const plan = binFrontLabel(opts);
  if (!plan) return null;
  const { w: W } = binSize(opts);
  const total = binTotalHeight(opts);
  const H = binBodyHeight(opts);
  const bands = [...(opts.base === 'flat' ? [] : [{ y0: 0, y1: BASE_PROFILE_HEIGHT }]), ...(opts.lip ? [{ y0: H, y1: total }] : [])];
  return (
    <FacePreview
      w={W}
      h={total}
      cap={plan.cap}
      bands={bands}
      boxes={plan.segments.map((s) => ({ text: s.text, box: { x0: s.box.x0 + W / 2, x1: s.box.x1 + W / 2, y0: s.box.y0, y1: s.box.y1 } }))}
    />
  );
}
