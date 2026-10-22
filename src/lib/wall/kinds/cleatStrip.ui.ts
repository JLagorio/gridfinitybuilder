import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cleatStrip',
  label: 'French cleat strip',
  description: 'A 45° cleat along the board for French-cleat tool holders, and a hanger to make your own.',
  group: 'adapters',
  fields: [
    {
      key: 'preset',
      label: 'Cleat',
      kind: 'preset',
      presets: [
        { value: 'wood', label: 'Cleats cut from 3/4″ board (19 mm)', set: { size: 19, height: 60, angle: 45 } },
        { value: 'small', label: 'Small printed cleats (12 mm)', set: { size: 12, height: 30, angle: 45 } },
      ],
    },
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 300, hint: 'Clips go every 40 mm across the back.' },
    { key: 'size', label: 'Thickness', kind: 'length', min: 8, max: 25, hint: 'Out from the board: as thick as the holders’ own cleats.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 15, max: 120, hint: 'Under the bevel. From 56 mm it takes a row of studs too.' },
    { key: 'angle', label: 'Bevel', kind: 'number', min: 30, max: 45, step: 1, suffix: '°' },
    { key: 'hanger', label: 'A hanger to build on', kind: 'toggle', hint: 'A plate with the matching cleat on its back: screw or glue your own holder to it.' },
  ],
});
