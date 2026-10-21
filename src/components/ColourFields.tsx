import { useStore } from '../state/store';
import { useFindState } from './findContext';
import { SlotPicker } from './SlotPicker';
import { roleSlot, slotName } from '../lib/colours';
import type { BinOptions } from '../lib/geometry/bin';

/**
 * A drawer's baseplate colour and a bin's own colour (lib/colours.ts), next
 * to their other settings. They only show with multi-colour on; while it's
 * off, a search for them says where to turn it on.
 */

function OffNote({ what }: { what: string }) {
  const f = useFindState();
  if (!f?.result) return null;
  return <p className="muted small">{what}: turn on several colours under Print plates › Colours first.</p>;
}

/** This drawer's baseplate colour (BaseplateOptions.colour). */
export function PlateColourField() {
  const setup = useStore((s) => s.setup);
  const colour = useStore((s) => s.baseplate.colour);
  const setBaseplate = useStore((s) => s.setBaseplate);
  if (!setup.colours?.on) return <OffNote what="Baseplate colour" />;
  return (
    <SlotPicker
      label="Baseplate colour"
      setup={setup}
      value={colour}
      unset={`As set (${slotName(setup, roleSlot(setup, 'plate'))})`}
      onChange={(slot) => setBaseplate({ colour: slot })}
      hint="This drawer's baseplate pieces (and keys, case or wall grid) in this slot."
    />
  );
}

/** A bin's own colour (BinOptions.colour): its body, lid, dividers and trays, not its label text. */
export function BinColourField({ opts, onChange }: { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void }) {
  const setup = useStore((s) => s.setup);
  if (!setup.colours?.on) return <OffNote what="Bin colour" />;
  return (
    <SlotPicker
      label="Bin colour"
      setup={setup}
      value={opts.colour}
      unset={`As set (${slotName(setup, roleSlot(setup, 'binWalls'))})`}
      onChange={(colour) => onChange({ colour })}
      hint="Colour-code bins by what's in them. Label text keeps the label colour."
    />
  );
}
