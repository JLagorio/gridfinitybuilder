import { registerAttachmentUi } from '../uiRegistry';
import type { SaddleOptions } from './saddle';

const saddle = (o: SaddleOptions) => o.mode === 'saddle';
const yoke = (o: SaddleOptions) => o.mode === 'yoke';
const MEASURE = 'Sizes vary: measure yours.';

registerAttachmentUi({
  type: 'saddle',
  label: 'Headphone & controller hanger',
  description: 'A wide curved saddle for headphones, VR straps, helmets; or a yoke for a guitar, ukulele or game controller.',
  group: 'devices',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: MEASURE,
      presets: [
        {
          value: 'headphones',
          label: 'Over-ear headphones (band up to 60 mm)',
          set: { mode: 'saddle', width: 50, radius: 70, band: 60, count: 1, lip: 10, reach: 90, arm: 8 },
        },
        { value: 'defenders', label: 'Ear defenders', set: { mode: 'saddle', width: 45, radius: 80, band: 35, count: 1, lip: 12, reach: 100, arm: 8 } },
        {
          value: 'vr',
          label: 'VR headset, by its top strap',
          set: { mode: 'saddle', width: 60, radius: 55, band: 45, count: 1, lip: 15, reach: 110, arm: 10 },
        },
        { value: 'helmet', label: 'Helmet or backpack', set: { mode: 'saddle', width: 70, radius: 60, band: 60, count: 1, lip: 20, reach: 110, arm: 12 } },
        {
          value: 'guitar',
          label: 'Guitar, electric or acoustic (46 mm gap)',
          title: 'The neck between the prongs, the headstock resting on them',
          set: { mode: 'yoke', gap: 46, prong: 14, reach: 90, tilt: 5, tip: 14, arm: 12, pad: true, heavy: true, height: 100 },
        },
        {
          value: 'classical',
          label: 'Classical guitar (55 mm gap)',
          set: { mode: 'yoke', gap: 55, prong: 14, reach: 100, tilt: 5, tip: 14, arm: 12, pad: true, heavy: true, height: 100 },
        },
        {
          value: 'ukulele',
          label: 'Ukulele (38 mm gap)',
          set: { mode: 'yoke', gap: 38, prong: 12, reach: 70, tilt: 5, tip: 12, arm: 10, pad: true, heavy: false, height: 60 },
        },
        {
          value: 'dualsense',
          label: 'PlayStation DualSense controller',
          title: 'It stands on the prongs by its grips, leaning back',
          set: { mode: 'yoke', gap: 56, prong: 12, reach: 60, tilt: 15, tip: 8, arm: 8, pad: false, heavy: false, height: 60 },
        },
        {
          value: 'xbox',
          label: 'Xbox controller',
          set: { mode: 'yoke', gap: 52, prong: 12, reach: 60, tilt: 15, tip: 8, arm: 8, pad: false, heavy: false, height: 60 },
        },
        {
          value: 'switchPro',
          label: 'Switch Pro controller',
          set: { mode: 'yoke', gap: 54, prong: 12, reach: 60, tilt: 15, tip: 8, arm: 8, pad: false, heavy: false, height: 60 },
        },
      ],
    },
    {
      key: 'mode',
      label: 'Shape',
      kind: 'select',
      options: [
        { value: 'saddle', label: 'Saddle', title: 'An arm with a wide curved top: headphones, VR straps, helmets' },
        { value: 'yoke', label: 'Yoke', title: 'Two prongs with a gap: guitars, ukuleles, game controllers' },
      ],
    },
    {
      key: 'reach',
      label: 'Reach',
      kind: 'length',
      min: 30,
      max: 200,
      hint: 'Out from the board. Ear cups clear it when the saddle is out further than half a cup.',
    },
    { key: 'width', label: 'Saddle width', kind: 'length', min: 20, max: 75, hint: 'Left to right: wider spreads the band’s weight.', when: saddle },
    { key: 'radius', label: 'Curve', kind: 'length', min: 20, max: 200, hint: 'Radius across, about the inside of the band.', when: saddle },
    { key: 'band', label: 'Band width', kind: 'length', min: 10, max: 80, hint: 'Along the arm; 4 mm is added.', when: saddle },
    { key: 'count', label: 'Saddles', kind: 'number', min: 1, max: 3, step: 1, suffix: '', hint: 'One behind the other along the arm.', when: saddle },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 0, max: 30, hint: 'Above the saddle; 0 for none.', when: saddle },
    { key: 'cleat', label: 'Cable cleat under the arm', kind: 'toggle', when: saddle },
    { key: 'shelf', label: 'Shelf', kind: 'length', min: 0, max: 80, hint: 'A small shelf at the foot of the back, this far out; 0 for none.', when: saddle },
    { key: 'gap', label: 'Gap', kind: 'length', min: 20, max: 200, hint: 'Between the prongs: a little wider than the neck at the nut.', when: yoke },
    { key: 'prong', label: 'Prong width', kind: 'length', min: 8, max: 30, when: yoke },
    { key: 'tilt', label: 'Tilt', kind: 'number', min: 0, max: 30, step: 1, suffix: '°', hint: 'The prongs point up this much.', when: yoke },
    { key: 'tip', label: 'Tip height', kind: 'length', min: 0, max: 40, when: yoke },
    { key: 'pad', label: 'Felt grooves', kind: 'toggle', hint: 'A groove along each prong for a felt strip: keeps a finish off the plastic.', when: yoke },
    { key: 'heavy', label: 'Heavy (a guitar)', kind: 'toggle', hint: 'A back at least 100 mm tall, three rows of mounts.', when: yoke },
    { key: 'arm', label: 'Arm thickness', kind: 'length', min: 5, max: 20 },
    { key: 'height', label: 'Back height', kind: 'length', min: 20, max: 200, hint: 'Taller holds more: from about 50 mm, studs go low on it.' },
  ],
});
