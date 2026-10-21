import { registerAttachmentUi } from '../uiRegistry';
import type { PlateOptions } from './plate';

registerAttachmentUi({
  type: 'plate',
  label: 'Adapter plate',
  description: 'A plate that clips on, to screw, tie, stick or hold with magnets anything on the board.',
  group: 'other',
  fields: [
    { key: 'width', label: 'Width', kind: 'length', min: 20, max: 300, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 20, max: 300 },
    { key: 'thick', label: 'Thickness', kind: 'length', min: 3, max: 10 },
    {
      key: 'screws',
      label: 'Screw holes',
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'm3', label: 'M3' },
        { value: 'm4', label: 'M4' },
      ],
      hint: 'On a grid, countersunk from the back: screw from behind into what it holds, then clip the plate on.',
    },
    { key: 'pitch', label: 'Hole spacing', kind: 'length', min: 10, max: 80, when: (o: PlateOptions) => o.screws !== 'none' },
    { key: 'ties', label: 'Zip-tie slots', kind: 'toggle', hint: 'Pairs of slots, a channel behind for the tie.' },
    { key: 'magnets', label: 'Magnet pockets', kind: 'toggle', hint: '6 × 2 mm, in the front corners.' },
    { key: 'tape', label: 'Recess for double-sided tape', kind: 'toggle' },
  ],
});
