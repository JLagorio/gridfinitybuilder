import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'swivelTower',
  label: 'Swivel tower',
  description: 'A stack of trays on an upright axle, each swinging out on its own.',
  group: 'storage',
  fields: [
    { key: 'count', label: 'Trays', kind: 'number', min: 1, max: 8, step: 1, suffix: '' },
    { key: 'trayH', label: 'Tray height', kind: 'length', min: 10, max: 75 },
    { key: 'length', label: 'Tray length', kind: 'length', min: 50, max: 200, hint: 'From the axle out, along the board.' },
    { key: 'width', label: 'Tray width', kind: 'length', min: 30, max: 120, hint: 'Front to back.' },
    { key: 'spacer', label: 'Gap between trays', kind: 'length', min: 1, max: 10 },
    {
      key: 'source',
      label: 'Axle',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints with it, lying down' },
        { value: 'dowel', label: 'Dowel', title: 'A wooden dowel cut to length' },
        { value: 'bolt', label: 'Rod or bolt', title: 'Threaded rod or a long bolt' },
      ],
    },
    { key: 'axle', label: 'Axle ⌀', kind: 'length', min: 6, max: 16, hint: 'Measure a dowel or rod: they vary.' },
  ],
});
