import { useState } from 'react';
import { Section } from './fields';
import { BoardTemplatesDialog } from './boardTemplatesLazy';

/** A button that opens the picker for the active board. */
export function BoardTemplatesButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="A ready set of parts for a 3D printer’s corner, an electronics bench, a paint station, …">
        {label}
      </button>
      {open && <BoardTemplatesDialog target="this" onClose={() => setOpen(false)} />}
    </>
  );
}

/** An empty board's Attachments tab, at the top: start from a template. */
export function StartFromTemplate() {
  return (
    <Section title="Start from a template">
      <p className="muted small">
        A ready set of parts for a 3D printer’s corner, an electronics bench, a paint station or the kitchen, placed to fit this board.
      </p>
      <BoardTemplatesButton label="Pick a template…" />
    </Section>
  );
}
