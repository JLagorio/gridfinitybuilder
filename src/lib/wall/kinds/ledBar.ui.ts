import { registerAttachmentUi } from '../uiRegistry';
import type { LedBarOptions } from './ledBar';

registerAttachmentUi({
  type: 'ledBar',
  label: 'LED light bar',
  description: 'An LED strip in a channel, aimed out or down at the desk, under a snap-on diffuser.',
  group: 'power',
  fields: [
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 400, hint: 'Clips go every 40 mm across the back.' },
    {
      key: 'strip',
      label: 'Strip width',
      kind: 'select',
      options: [
        { value: '8', label: '8 mm' },
        { value: '10', label: '10 mm' },
        { value: '12', label: '12 mm' },
      ],
    },
    {
      key: 'angle',
      label: 'Aimed',
      kind: 'select',
      options: [
        { value: '0', label: 'Out', title: 'Straight out from the board' },
        { value: '30', label: '30°', title: '30° down' },
        { value: '45', label: '45°', title: '45° down' },
        { value: '60', label: '60°', title: '60° down, at the desk below' },
      ],
    },
    { key: 'diffuser', label: 'Diffuser', kind: 'toggle', hint: 'Snaps over the channel; print it in clear or white PETG.' },
    { key: 'caps', label: 'End caps', kind: 'toggle' },
    {
      key: 'wire',
      label: 'Wire leaves',
      kind: 'select',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'both', label: 'Both ends' },
      ],
      hint: 'Through a hole in the end cap.',
      when: (o: LedBarOptions) => o.caps,
    },
  ],
});
