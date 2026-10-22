import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'mediaBlock',
  label: 'Card and media block',
  description: 'Rows of slots stepping down to the front: SD and microSD cards, CFexpress, USB sticks, game cards, business cards, picks.',
  group: 'devices',
  fields: [
    {
      key: 'preset',
      label: 'Holds',
      kind: 'preset',
      hint: 'Width × thickness, and how deep it goes in. Cases and plugs vary: measure yours.',
      presets: [
        { value: 'sd', label: 'SD card (24 × 2.1)', set: { width: 24, thick: 2.1, depth: 16, pitch: 8 } },
        { value: 'microsd', label: 'microSD card (11 × 1)', set: { width: 11, thick: 1, depth: 8, pitch: 6 } },
        { value: 'cfexpressB', label: 'CFexpress type B (29.8 × 3.8)', set: { width: 29.8, thick: 3.8, depth: 19, pitch: 11 } },
        { value: 'cfexpressA', label: 'CFexpress type A (20 × 2.8)', set: { width: 20, thick: 2.8, depth: 14, pitch: 9 } },
        { value: 'cf', label: 'CompactFlash (36 × 3.3)', set: { width: 36, thick: 3.3, depth: 21, pitch: 11 } },
        { value: 'usbA', label: 'USB-A stick, by its plug (12 × 4.5)', set: { width: 12, thick: 4.5, depth: 12, pitch: 10 } },
        { value: 'usbC', label: 'USB-C stick, by its plug (8.4 × 2.6)', set: { width: 8.4, thick: 2.6, depth: 6.5, pitch: 9 } },
        { value: 'switch', label: 'Switch game card (21 × 3.3)', set: { width: 21, thick: 3.3, depth: 15, pitch: 10 } },
        { value: 'businessEU', label: 'Business cards 85 × 55, a stack', set: { width: 85, thick: 12, depth: 30, pitch: 22 } },
        { value: 'businessUS', label: 'Business cards 89 × 51, a stack', set: { width: 89, thick: 12, depth: 28, pitch: 22 } },
        { value: 'picks', label: 'Guitar picks, a stack (30 wide)', set: { width: 30, thick: 8, depth: 14, pitch: 16 } },
        { value: 'blades', label: 'Utility blades, a stack (61 × 19)', set: { width: 61, thick: 5, depth: 12, pitch: 12 } },
      ],
    },
    { key: 'width', label: 'Width', kind: 'length', min: 3, max: 120, hint: 'Left to right in the slot.' },
    { key: 'thick', label: 'Thickness', kind: 'length', min: 0.5, max: 30, hint: 'One card, or a stack of them.' },
    { key: 'depth', label: 'Slot depth', kind: 'length', min: 3, max: 60, hint: 'How far it goes in; the rest stands out to grab.' },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 2, hint: 'Added to the width and the thickness.' },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 12, step: 1, suffix: '', hint: 'Front to back, each a step lower than the one behind.' },
    { key: 'count', label: 'Slots per row', kind: 'number', min: 1, max: 12, step: 1, suffix: '' },
    { key: 'pitch', label: 'Row pitch', kind: 'length', min: 2, max: 60, hint: 'Front to back, centre to centre: room for your fingers.' },
    { key: 'tilt', label: 'Lean back', kind: 'number', min: 0, max: 30, step: 5, suffix: '°' },
    { key: 'label', label: 'Label ledge on the front', kind: 'toggle' },
  ],
});
