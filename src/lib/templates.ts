import { DEFAULT_BIN, binLayout, sanitizeBin, type BinOptions } from './geometry/bin';
import { newId } from './bins';

/**
 * Saved bin settings, shared by every drawer in the project. `opts` is kept
 * whole (including fields this module doesn't know about) and only sanitized
 * when it's applied.
 */
export interface BinTemplate {
  id: string;
  name: string;
  opts: BinOptions;
}

export function makeTemplate(name: string, opts: BinOptions, taken: string[] = []): BinTemplate {
  return { id: newId(), name: uniqueTemplateName(name.trim() || 'Template', taken), opts: structuredClone(opts) };
}

export function uniqueTemplateName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Templates from a saved file or storage; anything malformed is dropped. */
export function cleanTemplates(v: unknown): BinTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: BinTemplate[] = [];
  for (const t of v) {
    if (!t || typeof t !== 'object' || !t.opts || typeof t.opts !== 'object') continue;
    const id = String(t.id ?? newId());
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, name: String(t.name ?? `Template ${out.length + 1}`), opts: { ...t.opts } });
  }
  return out;
}

/** Templates from an opened project join the library: same id replaces, new ones are added. */
export function mergeTemplates(current: BinTemplate[], incoming: BinTemplate[]): BinTemplate[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  const out = current.map((t) => byId.get(t.id) ?? t);
  for (const t of incoming) if (!current.some((c) => c.id === t.id)) out.push(t);
  return out;
}

/** A template's settings for a bin, keeping the bin's own footprint. */
export function applyTemplate(t: BinTemplate, target: Pick<BinOptions, 'unitsX' | 'unitsY'>): BinOptions {
  return sanitizeBin({ ...DEFAULT_BIN, ...structuredClone(t.opts), unitsX: target.unitsX, unitsY: target.unitsY });
}

/** One-line description: "3u · lip · magnets · 2×1 compartments". */
export function templateSummary(o: BinOptions): string {
  const parts = [`${o.heightUnits}u`];
  if (o.lip) parts.push('lip');
  if (o.holes && o.holes !== 'none') parts.push(o.holes === 'both' ? 'magnets + screws' : o.holes);
  if (o.layout) {
    const n = binLayout(o).compartments.length;
    if (n > 1) parts.push(`${n} compartments`);
  } else if (o.divX * o.divY > 1) parts.push(`${o.divX}×${o.divY} compartments`);
  if (o.scoop > 0) parts.push('scoop');
  if (o.label && o.label !== 'none') parts.push(`${o.label === 'center' ? 'mid' : o.label} label`);
  return parts.join(' · ');
}
