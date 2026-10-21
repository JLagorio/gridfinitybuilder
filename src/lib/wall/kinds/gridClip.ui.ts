import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'gridClip',
  label: 'Bin lip clip',
  description: 'Hangs one Gridfinity bin on the board by its stacking lip, from this app or anywhere.',
  group: 'gridfinity',
  fields: [
    { key: 'cells', label: 'Bin width', kind: 'number', min: 1, max: 6, step: 1, suffix: ' cells' },
    { key: 'units', label: 'Bin height', kind: 'number', min: 2, max: 20, step: 1, suffix: ' u', hint: '7 mm a unit, not counting the lip.' },
    {
      key: 'style',
      label: 'Holds it by',
      kind: 'select',
      options: [
        { value: 'lip', label: 'Its lip', title: 'Push the bin up until its lip clicks over the catches' },
        { value: 'cradle', label: 'A cradle', title: 'A ledge carries the base; lift the top in behind the clip, swing the base in and let it down' },
      ],
    },
  ],
});
