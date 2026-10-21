/**
 * Labels from "What's in it".
 *
 * A bin's contents live on the placed bin (`PlacedBin.contents`,
 * `compContents`), not in its options, so they never touch a mesh key. Label
 * text can ask for them with a fragment: `{contents}` is the first item of the
 * list, `{contents:2}` the first two (one per line, up to 3). Planning
 * (project.ts `binSpec`) replaces the fragment in a copy of the options, so the
 * mesh key follows the contents only while a label asks for them:
 * - the bin's text uses the bin's contents;
 * - each compartment's tab uses its own contents (its own text, or the bin's
 *   when it has none), falling back to the bin's contents;
 * - the sliding lid's text uses the bin's contents.
 * Per-compartment results go in `labelTabTexts`, keyed like the tabs (uniform
 * grids: `g<i>,<j>`).
 *
 * Bins whose labels don't ask come back unchanged (the same object).
 */
import { CONTENTS_FRAGMENT, labelPlainText } from './labelIcons';
import { labelLines, sanitizeLabelText } from './labels';
import { binLayout, type BinOptions } from './bin';
import { compartmentAt } from '../dividers';

export interface ContentsSource {
  contents?: string;
  compContents?: Record<string, string>;
}

/** The items of contents text: trimmed, non-blank lines, list bullets dropped (like inventory.ts). */
function items(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•·–]\s+/, '').trim())
    .filter(Boolean);
}

/** True when the text asks for the contents. */
export function hasContentsFragment(text: string | undefined | null): boolean {
  return !!text && new RegExp(CONTENTS_FRAGMENT.source, 'i').test(text);
}

/** The text with `{contents}` / `{contents:n}` replaced by the first n items of `contents` (nothing when there are none). */
export function fillContents(text: string, contents: string | undefined): string {
  const list = items(contents);
  return sanitizeLabelText(text.replace(new RegExp(CONTENTS_FRAGMENT.source, 'gi'), (_m, n: string | undefined) => list.slice(0, Number(n) || 1).join('\n')));
}

/** The fragment that asks for the first `lines` items. */
export const contentsFragment = (lines: number) => (lines > 1 ? `{contents:${Math.min(3, Math.round(lines))}}` : '{contents}');

/** The bin's options with every `{contents}` filled in from what's in it. */
export function resolveContentLabels(opts: BinOptions, src: ContentsSource): BinOptions {
  const comps = opts.layout?.comps ?? {};
  const binAsks = hasContentsFragment(opts.labelText);
  const compAsks = Object.values(comps).some((c) => hasContentsFragment(c.labelText));
  const lidAsks = hasContentsFragment(opts.slideLidText);
  if (!binAsks && !compAsks && !lidAsks) return opts;
  const out: BinOptions = { ...opts };
  if (binAsks) out.labelText = fillContents(opts.labelText, src.contents);
  if (lidAsks) out.slideLidText = fillContents(opts.slideLidText, src.contents);
  const own = src.compContents ?? {};
  const tabTexts: Record<string, string> = {};
  if (binAsks || compAsks) {
    const r = binLayout(opts);
    if (opts.layout) {
      for (const c of r.compartments) {
        const text = comps[c.key]?.labelText ?? opts.labelText;
        if (!hasContentsFragment(text)) continue;
        const v = fillContents(text, own[c.key] || src.contents);
        // Only where it differs from what the tab shows anyway.
        if (labelLines(v) !== labelLines(comps[c.key]?.labelText ?? out.labelText)) tabTexts[c.key] = v;
      }
    } else if (binAsks && Object.keys(own).length) {
      // Uniform grid: tab g<i>,<j> is the compartment in column i, row j (from the front).
      const nx = Math.max(1, opts.divX);
      const ny = Math.max(1, opts.divY);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const c = compartmentAt(r, ((i + 0.5) / nx) * r.innerW, ((j + 0.5) / ny) * r.innerD);
          if (!c || !own[c.key]) continue;
          const v = fillContents(opts.labelText, own[c.key]);
          if (labelLines(v) !== labelLines(out.labelText)) tabTexts[`g${i},${j}`] = v;
        }
      }
    }
  }
  if (Object.keys(tabTexts).length) out.labelTabTexts = tabTexts;
  return out;
}

/** A placed bin's label text with `{contents}` filled in from what's in it. A bin from elsewhere (external.ts) goes by its name. */
export function labelCaptionText(b: { opts: Pick<BinOptions, 'labelText'>; external?: { name: string } } & ContentsSource): string {
  if (b.external) return b.external.name;
  const t = b.opts.labelText ?? '';
  return hasContentsFragment(t) ? fillContents(t, b.contents) : t;
}

/** First line of a placed bin's label as printed, in plain words (icons by name), for captions. '' = none. */
export function labelCaption(b: { opts: Pick<BinOptions, 'labelText'>; external?: { name: string } } & ContentsSource): string {
  return labelPlainText(labelLines(labelCaptionText(b))).split('\n')[0] ?? '';
}
