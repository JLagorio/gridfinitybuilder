import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'rod',
  label: 'Roll holder',
  description: 'Two arms and a rod: paper towels, tape, a filament spool, thread.',
  group: 'shelves',
  fields: [
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
