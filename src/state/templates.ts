import type { BinOptions } from '../lib/geometry/bin';
import { applyTemplate, makeTemplate } from '../lib/templates';
import { useStore } from './store';

/** Bin template library actions. Templates live in the store, so they're saved, shared in files and undoable. */

const state = () => useStore.getState();
const find = (id: string) => state().templates.find((t) => t.id === id);

export function saveTemplate(name: string, opts: BinOptions): string {
  const t = makeTemplate(name, opts, state().templates.map((x) => x.name));
  useStore.setState({ templates: [...state().templates, t] });
  return t.id;
}

export function renameTemplate(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  useStore.setState({ templates: state().templates.map((t) => (t.id === id ? { ...t, name: n } : t)) });
}

export function deleteTemplate(id: string) {
  useStore.setState({ templates: state().templates.filter((t) => t.id !== id) });
}

/** Newly drawn bins get the template's settings. */
export function applyTemplateToNew(id: string) {
  const t = find(id);
  if (t) useStore.setState({ newBin: applyTemplate(t, state().newBin) });
}

/** The bins take the template's settings but keep their size and place. */
export function applyTemplateToBins(id: string, binIds: string[]) {
  const t = find(id);
  if (!t || !binIds.length) return;
  const set = new Set(binIds);
  useStore.setState({ bins: state().bins.map((b) => (set.has(b.id) ? { ...b, opts: applyTemplate(t, b.opts) } : b)) });
}
