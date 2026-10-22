import { registerAttachmentUi } from '../uiRegistry';
import type { LidBoxOptions } from './lidBox';

registerAttachmentUi({
  type: 'lidBox',
  label: 'Box with a lid',
  description: 'A box with a sliding lid, a lid on a pin hinge, or a front flap that drops open.',
  group: 'storage',
  fields: [
    {
      key: 'lid',
      label: 'Lid',
      kind: 'select',
      options: [
        { value: 'slide', label: 'Sliding', title: 'Slides in from the front in grooves along the top' },
        { value: 'hinge', label: 'Hinged', title: 'A pin hinge along the back; it swings up and leans on the board' },
        { value: 'flip', label: 'Front flap', title: 'The front drops open onto a ledge; a top plate slides in above' },
      ],
    },
    { key: 'width', label: 'Width', kind: 'length', min: 40, max: 250, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 30, max: 200 },
    { key: 'depth', label: 'Depth', kind: 'length', min: 30, max: 200, hint: 'Out from the board.' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.6, max: 4 },
    { key: 'magnets', label: 'Magnet catch', kind: 'toggle', hint: 'Four 6 × 2 mm magnets hold it shut.', when: (o: LidBoxOptions) => o.lid !== 'slide' },
    {
      key: 'pin',
      label: 'Hinge pin',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints with it, lying down' },
        { value: 'steel', label: 'Steel ⌀3', title: 'A 3 mm rod or a nail, cut to length' },
      ],
      when: (o: LidBoxOptions) => o.lid !== 'slide',
    },
    { key: 'label', label: 'Label slot on the front', kind: 'toggle', hint: 'Takes a card 12.5 mm high.', when: (o: LidBoxOptions) => o.lid !== 'flip' },
  ],
});
