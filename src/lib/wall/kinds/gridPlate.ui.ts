import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'gridPlate',
  label: 'Gridfinity wall plate',
  description: 'A baseplate on the board: bins with magnets stick to it, the bottom row stands on a ledge.',
  group: 'gridfinity',
  fields: [
    { key: 'cellsX', label: 'Cells wide', kind: 'number', min: 1, max: 8, step: 1, suffix: '', hint: '42 mm each.' },
    { key: 'cellsY', label: 'Cells high', kind: 'number', min: 1, max: 6, step: 1, suffix: '' },
    { key: 'magnets', label: 'Magnet pockets', kind: 'toggle', hint: '6 × 2 mm, four a cell. The bins need magnets in their bases too.' },
    { key: 'ledge', label: 'Ledge along the bottom', kind: 'toggle', hint: 'The bottom row stands on it, so bins can’t slide down.' },
  ],
});
