import { registerAttachmentUi } from '../uiRegistry';
import type { PlateOptions } from './plate';

registerAttachmentUi({
  type: 'plate',
  label: 'Adapter plate',
  description: 'A plate that clips on, to screw, tie, stick or hold with magnets anything on the board: VESA, Raspberry Pi, 2.5″ drives.',
  group: 'adapters',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'grid', label: 'Anything: screw holes on a grid', set: { pattern: 'grid', width: 80, height: 80, thick: 5 } },
        { value: 'vesa75', label: 'Small monitor or arm, VESA 75', set: { pattern: 'vesa75', width: 88, height: 88, thick: 6 } },
        { value: 'vesa100', label: 'Monitor or arm, VESA 100', set: { pattern: 'vesa100', width: 120, height: 120, thick: 6 } },
        { value: 'pi', label: 'Raspberry Pi 5, 4, 3 (58 × 49 mm holes)', set: { pattern: 'pi', width: 80, height: 70, thick: 4 } },
        { value: 'piZero', label: 'Raspberry Pi Zero (58 × 23 mm holes)', set: { pattern: 'piZero', width: 80, height: 60, thick: 4 } },
        { value: 'ssd', label: '2.5″ SSD or hard drive', set: { pattern: 'ssd', width: 80, height: 100, thick: 5 } },
      ],
    },
    { key: 'width', label: 'Width', kind: 'length', min: 20, max: 300, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 20, max: 300 },
    { key: 'thick', label: 'Thickness', kind: 'length', min: 3, max: 10 },
    {
      key: 'pattern',
      label: 'Holes',
      kind: 'select',
      options: [
        { value: 'grid', label: 'On a grid' },
        { value: 'vesa75', label: 'VESA 75', title: '75 × 75 mm, M4' },
        { value: 'vesa100', label: 'VESA 100', title: '100 × 100 mm, M4' },
        { value: 'pi', label: 'Raspberry Pi', title: '58 × 49 mm, M2.5 into standoffs' },
        { value: 'piZero', label: 'Pi Zero', title: '58 × 23 mm, M2.5 into standoffs' },
        { value: 'ssd', label: '2.5″ drive', title: '61.72 × 76.6 mm, M3 into the drive’s underside' },
      ],
      hint: 'VESA and drives screw on from the back, countersunk: screw it to the device, then clip it on. A Pi sits on 5 mm standoffs.',
    },
    {
      key: 'screws',
      label: 'Screw holes',
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'm3', label: 'M3' },
        { value: 'm4', label: 'M4' },
      ],
      hint: 'On a grid, countersunk from the back: screw from behind into what it holds, then clip the plate on.',
      when: (o: PlateOptions) => o.pattern === 'grid',
    },
    { key: 'pitch', label: 'Hole spacing', kind: 'length', min: 10, max: 80, when: (o: PlateOptions) => o.pattern === 'grid' && o.screws !== 'none' },
    { key: 'ties', label: 'Zip-tie slots', kind: 'toggle', hint: 'Pairs of slots, a channel behind for the tie.' },
    { key: 'magnets', label: 'Magnet pockets', kind: 'toggle', hint: '6 × 2 mm, in the front corners.' },
    { key: 'tape', label: 'Recess for double-sided tape', kind: 'toggle' },
  ],
});
