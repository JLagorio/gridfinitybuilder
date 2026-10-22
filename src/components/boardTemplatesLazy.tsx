import { LazyDialog, lazyNamed } from './lazy';

// The picker and the templates (BoardTemplates.tsx, lib/wall/templates.ts) load when it first opens.
const Dialog = lazyNamed(() => import('./BoardTemplates'), 'BoardTemplatesDialog');

/** Where a template goes: a new board, or the active one. */
export type TemplateTarget = 'new' | 'this';

/** The starter-board picker, loaded on first use. */
export function BoardTemplatesDialog(props: { target: TemplateTarget; onClose: () => void }) {
  return (
    <LazyDialog scope="The board templates" onClose={props.onClose}>
      <Dialog {...props} />
    </LazyDialog>
  );
}
