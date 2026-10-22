import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'chargerCradle',
  label: 'Charger cradle',
  description: 'A pocket for a power-tool charger, flat or on its end, its cord out through the floor or the side.',
  group: 'tools',
  fields: [
    {
      key: 'charger',
      label: 'Charger',
      kind: 'preset',
      presets: [
        { value: 'dcb112', label: 'DeWalt DCB112, 145 × 115 × 65', set: { width: 145, depth: 115, height: 65 } },
        { value: 'm12m18', label: 'Milwaukee M12–M18 (M12-18C), about 170 × 148 × 76', set: { width: 170, depth: 148, height: 76 } },
        { value: 'dc18rc', label: 'Makita DC18RC, 190 × 156 × 84', set: { width: 190, depth: 156, height: 84 } },
      ],
      hint: 'Lying flat: across, front to back, top to bottom. Measure yours: models change.',
    },
    { key: 'width', label: 'Charger width', kind: 'length', min: 40, max: 300, hint: '1 mm clearance is added each side.' },
    { key: 'depth', label: 'Charger depth', kind: 'length', min: 30, max: 250, hint: 'Front to back, lying flat.' },
    { key: 'height', label: 'Charger height', kind: 'length', min: 15, max: 150, hint: 'Top to bottom, lying flat.' },
    {
      key: 'stand',
      label: 'Stands',
      kind: 'select',
      options: [
        { value: 'flat', label: 'Flat', title: 'A pack slides on and off it where it is' },
        { value: 'upright', label: 'On its end', title: 'Its bottom against the board: less out from the wall' },
      ],
    },
    {
      key: 'cord',
      label: 'Cord',
      kind: 'select',
      options: [
        { value: 'floor', label: 'Through the floor', title: 'A slot in the floor along the back' },
        { value: 'side', label: 'Out the side', title: 'A notch in the right side wall, near the back' },
        { value: 'none', label: 'Over the top' },
      ],
      hint: 'Keep its vents clear.',
    },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 4, max: 60, hint: 'Low enough to slide a pack on and see the lights.' },
    { key: 'back', label: 'Back height', kind: 'length', min: 30, max: 200, hint: 'The side walls slope from it down to the lip.' },
  ],
});
