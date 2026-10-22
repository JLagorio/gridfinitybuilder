import { registerAttachmentUi } from '../uiRegistry';
import type { ShelfOptions } from './shelf';

registerAttachmentUi({
  type: 'shelf',
  label: 'Shelf',
  description: 'A flat shelf with a lip, side walls or gussets, and drain slots if you like.',
  group: 'shelves',
  fields: [
    { key: 'width', label: 'Width', kind: 'length', min: 30, max: 400, hint: 'Clips go every 40 mm across the back.' },
    { key: 'depth', label: 'Depth', kind: 'length', min: 20, max: 250, hint: 'Out from the board.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 25, max: 200, hint: 'Taller holds more: from about 56 mm, studs go low on it.' },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 0, max: 40, hint: 'Above the shelf; 0 for none.' },
    {
      key: 'shape',
      label: 'Shape',
      kind: 'select',
      options: [
        { value: 'rect', label: 'Square', title: 'Square front corners' },
        { value: 'rounded', label: 'Rounded', title: 'Its front corners rounded' },
        { value: 'hexagon', label: 'Hexagon', title: 'Half a hexagon: its front corners cut at 60°' },
        { value: 'halfRound', label: 'Half round', title: 'Half an ellipse, as wide and deep as set' },
      ],
      hint: 'Seen from above; the lip follows the front round.',
    },
    { key: 'sides', label: 'Side walls', kind: 'toggle', hint: 'In place of the gussets at the ends.', when: (o: ShelfOptions) => o.shape === 'rect' },
    {
      key: 'holes',
      label: 'Shelf',
      kind: 'select',
      options: [
        { value: 'none', label: 'Solid' },
        { value: 'slots', label: 'Drain slots', title: 'Slots front to back: for wet things, plants, brushes' },
      ],
    },
    { key: 'floor', label: 'Thickness', kind: 'length', min: 2, max: 8 },
  ],
});
