import { registerAttachmentUi } from '../uiRegistry';

const caddy = (width: number, depth: number, height: number, dividers: number, handle: number) => ({ width, depth, height, dividers, handle });

registerAttachmentUi({
  type: 'caddy',
  label: 'Lift-off caddy',
  description: 'A carry tote that hangs on a cleat dock: lift it off and take it to the bench.',
  group: 'hobby',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'paints', label: 'Paints', title: 'Dropper bottles and pots stand in it, tops showing', set: caddy(160, 70, 50, 0, 50) },
        { value: 'brushes', label: 'Brushes and tools', set: caddy(120, 60, 90, 2, 40) },
        { value: 'soldering', label: 'Soldering kit', title: 'Iron stand, solder, flux, wick, cutters', set: caddy(200, 100, 70, 2, 50) },
        { value: 'sewing', label: 'Sewing kit', set: caddy(180, 90, 60, 3, 40) },
      ],
    },
    { key: 'width', label: 'Width', kind: 'length', min: 60, max: 240, hint: 'Across the board; the dock is as wide.' },
    { key: 'depth', label: 'Depth', kind: 'length', min: 40, max: 150, hint: 'Out from the board.' },
    { key: 'height', label: 'Height', kind: 'length', min: 35, max: 150, hint: 'Its walls.' },
    { key: 'dividers', label: 'Dividers', kind: 'number', min: 0, max: 8, step: 1, suffix: '', hint: 'Across it, front to back.' },
    { key: 'handle', label: 'Handle', kind: 'length', min: 0, max: 100, hint: 'How far it stands above the rim; 0 for none.' },
  ],
});
