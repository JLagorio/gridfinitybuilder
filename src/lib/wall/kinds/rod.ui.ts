import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'rod',
  label: 'Roll holder',
  description: 'Two arms and a rod: paper towels, tape, a filament spool, thread.',
  group: 'shelves',
  fields: [
    {
      key: 'roll',
      label: 'Roll',
      kind: 'preset',
      presets: [
        { value: 'towel', label: 'Kitchen towel (core 32–42, ⌀ up to 150, 280 wide)', set: { width: 285, diameter: 150, rod: 30, source: 'dowel' } },
        { value: 'toilet', label: 'Toilet roll', set: { width: 105, diameter: 125, rod: 32, source: 'printed' } },
        { value: 'tape', label: 'Tape rolls on 3″ cores, side by side', set: { width: 160, diameter: 120, rod: 25, source: 'printed' } },
        { value: 'foil', label: 'Foil or cling film', set: { width: 300, diameter: 60, rod: 20, source: 'dowel' } },
        { value: 'spool', label: 'Filament spool, 1 kg (⌀200, bore 52+)', set: { width: 75, diameter: 205, rod: 40, source: 'printed' } },
      ],
      hint: 'Typical sizes: measure yours. Long rods are dowels: a printed one that long won’t fit most printers.',
    },
    { key: 'width', label: 'Roll width', kind: 'length', min: 10, max: 300, hint: 'Room between the arms: the widest roll, or a few side by side.' },
    { key: 'diameter', label: 'Roll diameter', kind: 'length', min: 20, max: 250, hint: 'The biggest roll: sets how far the arms reach out.' },
    {
      key: 'rod',
      label: 'Rod diameter',
      kind: 'length',
      min: 5,
      max: 40,
      hint: 'Less than the roll’s core. Its ends sit in open pockets: lift it out to change the roll.',
    },
    {
      key: 'source',
      label: 'Rod',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints alongside, lying down' },
        { value: 'dowel', label: 'Dowel', title: 'A wooden dowel or metal rod you cut to length' },
      ],
    },
    { key: 'height', label: 'Back height', kind: 'length', min: 25, max: 150, hint: 'The roll hangs below the arms, over the board.' },
  ],
});
