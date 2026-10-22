import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'powerStrip',
  label: 'Power strip holder',
  description: 'A cradle for a power strip or a power brick: brackets at its ends or a full tray.',
  group: 'power',
  fields: [
    { key: 'width', label: 'Strip width', kind: 'length', min: 15, max: 150, hint: 'Out from the board.' },
    { key: 'height', label: 'Strip height', kind: 'length', min: 10, max: 150 },
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 400, hint: "With end walls, the strip's length; with open ends, the holder's." },
    {
      key: 'style',
      label: 'Style',
      kind: 'select',
      options: [
        { value: 'brackets', label: 'Brackets', title: 'A cradle at each end, the back plate between' },
        { value: 'tray', label: 'Tray', title: 'Floor and lip the whole length' },
      ],
    },
    {
      key: 'cable',
      label: 'Ends',
      kind: 'select',
      options: [
        { value: 'open', label: 'Open', title: 'No end walls: a strip longer than the holder rests in it' },
        { value: 'left', label: 'Cable left', title: 'End walls, a notch for the cable in the left one' },
        { value: 'right', label: 'Cable right', title: 'End walls, a notch for the cable in the right one' },
      ],
    },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 4, max: 150, hint: 'Keep it below the sockets.' },
    { key: 'strap', label: 'Strap slots', kind: 'toggle', hint: 'For a hook-and-loop strap round the strip at each end.' },
  ],
});
