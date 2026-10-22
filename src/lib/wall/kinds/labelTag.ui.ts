import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'labelTag',
  label: 'Label tag',
  description: 'A little card that clips into any slot, its text raised, cut in or inlaid in a second colour.',
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
        { value: 'raised', label: 'Raised', title: 'Stands out 0.6 mm inside a raised rim; in the board text colour with multi-colour on' },
        { value: 'engraved', label: 'Cut in', title: 'Cut 0.6 mm into the card' },
        { value: 'inlaid', label: 'Inlaid', title: 'Cut in and filled flush in a second filament: two colours, a smooth face' },
      ],
      hint: 'Raised and inlaid text print in the board text colour (Print plates › Colours); inlaid text needs a second filament.',
    },
  ],
});
