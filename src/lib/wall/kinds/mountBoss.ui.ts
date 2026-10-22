import { registerAttachmentUi } from '../uiRegistry';
import type { MountBossOptions } from './mountBoss';

registerAttachmentUi({
  type: 'mountBoss',
  label: 'Device mount',
  description: 'A camera thread, GoPro, Arca-Swiss or cold-shoe mount on an arm, tilted down if you like.',
  group: 'adapters',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'webcam', label: 'Webcam or small camera (1/4″ stud, 15° down)', set: { fixing: '1/4-20', reach: 50, tilt: 15 } },
        { value: 'action', label: 'Action camera (GoPro mount)', set: { fixing: 'gopro', fingers: 3, reach: 40, tilt: 0 } },
        { value: 'ballhead', label: 'Ball head or magic arm (3/8″ stud)', set: { fixing: '3/8-16', reach: 50, tilt: 0 } },
        { value: 'mic', label: 'Microphone clip (5/8″, with an adapter)', set: { fixing: '5/8-27', reach: 80, tilt: 0 } },
        { value: 'arca', label: 'Camera on an Arca-Swiss plate', set: { fixing: 'arca', reach: 60, tilt: 0 } },
        { value: 'shoe', label: 'Light or microphone with a cold-shoe foot', set: { fixing: 'coldshoe', reach: 40, tilt: 0 } },
      ],
      hint: 'Monitors (VESA), a Raspberry Pi or a 2.5″ drive: the adapter plate has their hole patterns.',
    },
    {
      key: 'fixing',
      label: 'Fixing',
      kind: 'select',
      options: [
        { value: '1/4-20', label: '1/4″-20 stud', title: 'A hex bolt’s head in the platform: cameras, webcams, phone clamps' },
        { value: '3/8-16', label: '3/8″-16 stud', title: 'Ball heads, magic arms' },
        { value: '5/8-27', label: '5/8″-27 (microphones)', title: 'The 3/8″ stud with a 5/8″ adapter on it' },
        { value: 'gopro', label: 'GoPro', title: 'Fingers 3 mm thick, 3.2 apart, an M5 bolt' },
        { value: 'arca', label: 'Arca-Swiss seat', title: 'A 38 mm plate slides in from the front, a thumb screw locks it' },
        { value: 'coldshoe', label: 'Cold shoe', title: 'An 18.6 × 2 mm foot slides in from the front' },
      ],
    },
    {
      key: 'fingers',
      label: 'Fingers',
      kind: 'select',
      options: [
        { value: '3', label: 'Three', title: 'For a camera or an accessory with two' },
        { value: '2', label: 'Two', title: 'For an accessory with three' },
      ],
      when: (o: MountBossOptions) => o.fixing === 'gopro',
    },
    { key: 'reach', label: 'Out from the board', kind: 'length', min: 20, max: 150, hint: 'To the middle of the fixing: leave room for the device behind it.' },
    { key: 'tilt', label: 'Tilt down', kind: 'number', min: 0, max: 45, step: 5, suffix: '°' },
    { key: 'height', label: 'Back height', kind: 'length', min: 30, max: 150, hint: 'Taller takes more studs: for heavy things and long arms.' },
  ],
});
