/**
 * Starter boards (lib/wall/templates.ts) into the project: a new board from a
 * template, or a template's parts on the active board, each one undo step.
 */
import { history, projectOf, useStore } from './store';
import { planJob } from '../lib/project';
import { sanitizeSkadis } from '../lib/geometry/skadis';
import { boardOf, fitTemplate, templateSkadis, type BoardTemplate } from '../lib/wall/templates';

/** What became of a template's parts: how many went on, and the names of those with no room. */
export interface TemplateResult {
  added: number;
  left: string[];
}

/** A new board the template's size, named after it, with its parts on; the Attachments tab open. */
export function newBoardFromTemplate(t: BoardTemplate): TemplateResult {
  history.checkpoint();
  useStore.getState().addDrawer(t.name, { skadis: true });
  const s = useStore.getState();
  const skadis = templateSkadis(t, sanitizeSkadis(s.drawer.skadis));
  const board = boardOf(skadis, s.setup);
  const fit = board ? fitTemplate(t, board) : { list: [], left: t.items.map((i) => i.name ?? i.type) };
  s.setDrawer({ skadis, attachments: fit.list });
  useStore.getState().setUI({ tab: 'bins', selectedAttachment: null });
  history.checkpoint();
  return { added: fit.list.length, left: fit.left };
}

/**
 * The template's parts on the active board (it keeps its size): in place of what's on it ('replace'), or around it
 * ('add'). Null when the active drawer isn't a board that plans.
 */
export function applyTemplate(t: BoardTemplate, mode: 'replace' | 'add'): TemplateResult | null {
  const s = useStore.getState();
  const wall = s.drawer.enclosure === 'skadis' ? planJob(projectOf(s)).drawers[0]?.enclosure?.wall : undefined;
  if (!wall) return null;
  const fit = fitTemplate(t, wall.board, mode === 'add' ? wall.placed : []);
  history.checkpoint();
  s.setDrawer({ attachments: mode === 'add' ? [...(s.drawer.attachments ?? []), ...fit.list] : fit.list });
  useStore.getState().setUI({ tab: 'bins', selectedAttachment: null });
  history.checkpoint();
  return { added: fit.list.length, left: fit.left };
}
