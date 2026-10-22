import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cradle',
  label: 'Device holder',
  description: 'A pocket sized from the device: a power strip, phone, tablet, USB hub, router.',
  group: 'devices',
  fields: [
    {
      key: 'device',
      label: 'Device',
      kind: 'preset',
      presets: [
        { value: 'steamDeck', label: 'Steam Deck', set: { width: 298, depth: 49, height: 60, front: 'u' } },
        { value: 'switch2', label: 'Nintendo Switch 2', set: { width: 272, depth: 30, height: 50, front: 'open' } },
        { value: 'switchOled', label: 'Nintendo Switch OLED', set: { width: 242, depth: 28, height: 45, front: 'open' } },
        { value: 'phoneL', label: 'Phone, large, in a case', set: { width: 82, depth: 13, height: 60, front: 'u' } },
        { value: 'phoneS', label: 'Phone, small, in a case', set: { width: 75, depth: 12, height: 55, front: 'u' } },
        { value: 'tablet11', label: 'Tablet 11″, in a case', set: { width: 255, depth: 10, height: 60, front: 'u' } },
        { value: 'tablet13', label: 'Tablet 13″, in a case', set: { width: 287, depth: 10, height: 70, front: 'u' } },
        { value: 'fluke', label: 'Multimeter (Fluke 117 in its holster)', set: { width: 90, depth: 50, height: 70, front: 'lip' } },
        { value: 'ptouch', label: 'Label printer (Brother P-touch)', set: { width: 112, depth: 60, height: 80, front: 'lip' } },
        { value: 'switch8', label: 'Network switch, 8 ports (TP-Link, 158 × 101 × 25)', set: { width: 158, depth: 25, height: 60, front: 'open' } },
        { value: 'magsafe', label: 'MagSafe charger (⌀56 × 6)', set: { width: 57, depth: 6.5, height: 40, front: 'open', cable: true } },
        { value: 'pi5', label: 'Raspberry Pi 5 in its case', set: { width: 95, depth: 31, height: 50, front: 'open' } },
        { value: 'router', label: 'Router', set: { width: 230, depth: 40, height: 80, front: 'open' } },
      ],
      hint: 'It stands on its edge, its width across: typical sizes, measure yours.',
    },
    {
      key: 'width',
      label: 'Device width',
      kind: 'length',
      min: 10,
      max: 300,
      hint: 'Left to right; 0.5 mm clearance is added each side. A phone is about 75, a tablet 250, a power strip 250–350.',
    },
    { key: 'depth', label: 'Device depth', kind: 'length', min: 4, max: 150, hint: 'Out from the board: a phone about 9, a USB hub 15, a router 30–40.' },
    { key: 'height', label: 'Pocket height', kind: 'length', min: 10, max: 200, hint: 'How much of it the walls cover: the device can stand taller.' },
    {
      key: 'front',
      label: 'Front',
      kind: 'select',
      options: [
        { value: 'open', label: 'Open', title: 'Only the corners hold it: sockets, ports and screen in reach' },
        { value: 'lip', label: 'Low lip' },
        { value: 'u', label: 'U cut-out', title: 'Full height with a U down the middle, for the screen, buttons or a cable' },
      ],
    },
    { key: 'cable', label: 'Cable hole in the floor', kind: 'toggle' },
    { key: 'notches', label: 'Cable notches in the sides', kind: 'toggle' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.2, max: 5 },
  ],
});
