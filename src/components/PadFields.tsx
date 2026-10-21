import { useUnits } from '../state/store';
import { Segmented } from './fields';
import type { BaseplateOptions } from '../lib/geometry/baseplate';
import { PAD, padStyle, type PadStyle } from '../lib/geometry/pads';
import type { PrintJob } from '../lib/project';

/** TPU non-slip pads under the baseplate: recesses at the cell corners or along the rows, and the pads to press in. */
export function PadFields({ bp, setBp, job }: { bp: BaseplateOptions; setBp: (p: Partial<BaseplateOptions>) => void; job: PrintJob }) {
  const { fmt } = useUnits();
  const style = padStyle(bp);
  const pads = Object.values(job.parts).filter((p) => p.kind === 'pad');
  let hint = 'Shallow recesses underneath and matching pads printed in TPU, so the baseplate doesn’t slide in the drawer.';
  if (style) {
    const where = style === 'dots' ? 'at the cell corners' : `under the walls between ${job.layout.ny > (job.layout.halfGrid ? 2 : 1) ? 'rows' : 'columns'}`;
    hint = pads.length
      ? `${pads.length} TPU ${style === 'dots' ? 'pad' : 'strip'}${pads.length === 1 ? '' : 's'} ${where}, on a plate of their own (print them in TPU). Press them into the ${fmt(PAD.depth)} recesses; they stand ${fmt(PAD.proud)} proud, raising the plate that much.`
      : style === 'strips'
        ? 'No room for strips: they run under the walls between rows (or columns) of cells, inside one piece. Try dots.'
        : 'No room for pads: the cell corners are too close to the edges or the seams.';
  }
  return (
    <Segmented<PadStyle | 'none'>
      label="Non-slip pads (TPU)"
      value={style ?? 'none'}
      options={[
        { value: 'none', label: 'None' },
        { value: 'dots', label: 'Dots', title: 'A round pad at every cell corner' },
        { value: 'strips', label: 'Strips', title: 'A strip under every wall between two rows of cells' },
      ]}
      // Off leaves the field unset, so the plate's mesh is the same as before pads existed.
      onChange={(v) => setBp({ pads: v === 'none' ? undefined : v })}
      hint={hint}
    />
  );
}
