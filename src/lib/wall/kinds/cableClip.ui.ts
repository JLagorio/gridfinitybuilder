import { registerAttachmentUi } from '../uiRegistry';
import type { CableClipOptions } from './cableClip';

const round = (o: CableClipOptions) => o.style === 'round';

registerAttachmentUi({
  type: 'cableClip',
  label: 'Cable clip',
  description: 'Cables snap into a row of C-shaped seats and run along the board; round or flat cables.',
  group: 'power',
  fields: [
    {
      key: 'style',
      label: 'Cables',
      kind: 'select',
      options: [
        { value: 'round', label: 'Round' },
        { value: 'flat', label: 'Flat', title: 'Ribbon and flat cables, slid in edge first' },
      ],
    },
    { key: 'diameter', label: 'Cable diameter', kind: 'length', min: 2, max: 30, when: round },
    { key: 'flatW', label: 'Cable width', kind: 'length', min: 3, max: 40, when: (o: CableClipOptions) => !round(o) },
    { key: 'flatT', label: 'Cable thickness', kind: 'length', min: 1, max: 10, when: (o: CableClipOptions) => !round(o) },
    { key: 'count', label: 'How many', kind: 'number', min: 1, max: 8, step: 1, suffix: '', hint: 'One above the other.' },
    { key: 'gap', label: 'Gap between', kind: 'length', min: 1, max: 20, when: (o: CableClipOptions) => o.count > 1 },
    { key: 'width', label: 'Width', kind: 'length', min: 5, max: 40, hint: 'Along the cables.' },
  ],
});
