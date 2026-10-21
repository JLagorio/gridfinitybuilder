import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'rail',
  label: 'Storage rail',
  description: 'A rail of bins or drawers that slide on from the side and click into place, one row or a wall of them.',
  group: 'containers',
  fields: [
    { key: 'length', label: 'Length', kind: 'number', min: 2, max: 14, step: 1, suffix: ' units' },
    {
      key: 'unit',
      label: 'Unit',
      kind: 'select',
      options: [
        { value: '40', label: '40 mm', title: 'Two board slots' },
        { value: '42', label: '42 mm', title: 'Lines up with Gridfinity' },
      ],
    },
    { key: 'rows', label: 'Rails', kind: 'number', min: 1, max: 3, step: 1, suffix: '', hint: 'One above the other, a container height apart.' },
    {
      key: 'kind',
      label: 'Containers',
      kind: 'select',
      options: [
        { value: 'bin', label: 'Bins', title: 'Open, with a low front and a scoop inside' },
        { value: 'drawer', label: 'Drawers', title: 'A sleeve on the rail with a drawer in each unit' },
      ],
    },
    {
      key: 'size',
      label: 'Size',
      kind: 'select',
      options: [
        { value: '1x1', label: '1 × 1' },
        { value: '2x1', label: '2 × 1', title: 'Two units wide' },
        { value: '1x2', label: '1 × 2', title: 'Two units high' },
        { value: '2x2', label: '2 × 2' },
        { value: '3x1', label: '3 × 1', title: 'Three units wide' },
      ],
      hint: 'Units wide × high.',
    },
    { key: 'count', label: 'How many', kind: 'number', min: 0, max: 42, step: 1, suffix: '', hint: '0: as many as fill the rails.' },
    { key: 'depth', label: 'Depth', kind: 'length', min: 30, max: 150, hint: 'Out from the board.' },
    {
      key: 'unitH',
      label: 'Unit height',
      kind: 'length',
      min: 30,
      max: 100,
      hint: 'How far apart the rails are, twice that for 1 × 2 and 2 × 2. Containers are 10 mm lower.',
    },
    { key: 'label', label: 'Label slots on the fronts', kind: 'toggle', hint: 'Each takes a card 12.5 mm high, up to 0.5 mm thick.' },
    { key: 'links', label: 'Link side by side', kind: 'toggle', hint: 'A dovetail joins each to the next: join them, then slide them on together.' },
  ],
});
