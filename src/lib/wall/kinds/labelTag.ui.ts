import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'labelTag',
  label: 'Label tag',
  description: 'A little card that clips into any slot, its text raised or cut in.',
  group: 'board',
  fields: [
    { key: 'text', label: 'Text', kind: 'text', placeholder: 'What it says' },
    { key: 'size', label: 'Text size', kind: 'length', min: 3, max: 30, hint: 'Capital letters this tall, or as big as fits.' },
    { key: 'width', label: 'Width', kind: 'length', min: 20, max: 250 },
    { key: 'height', label: 'Height', kind: 'length', min: 15, max: 100 },
    {
      key: 'style',
      label: 'Text',
      kind: 'select',
      options: [
        { value: 'raised', label: 'Raised', title: 'Stands out 0.6 mm inside a raised rim: swap filament at the rim for two colours' },
        { value: 'engraved', label: 'Cut in', title: 'Cut 0.6 mm into the card' },
      ],
    },
  ],
});
