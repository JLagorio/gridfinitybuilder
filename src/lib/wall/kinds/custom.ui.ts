import { registerAttachmentUi } from '../uiRegistry';
import type { CustomOptions } from './custom';
import { CUSTOM, reachOf, upperAt } from '../custom/profile';

/** Whether it holds things in: its front stands higher than where it leaves the plate (a tray, a cradle), or it has a lip or end walls. */
const pocket = (o: CustomOptions) =>
  o.lip > 0 ||
  o.ends === 'walls' ||
  o.dividers > 0 ||
  (upperAt(o.profile, reachOf(o.profile) - 0.05) ?? 0) > (upperAt(o.profile, CUSTOM.plate + 0.05) ?? 0) + 3;

registerAttachmentUi({
  type: 'custom',
  label: 'Build your own',
  description: 'Draw its side profile (a ledge, tray, hook, cradle or bracket), then add holes, slots and text: it always clips on and prints.',
  group: 'board',
  fields: [
    { key: 'profile', label: 'Side profile', kind: 'profile' },
    { key: 'width', label: 'Width', kind: 'number', min: 20, max: 300, step: 20, suffix: 'mm', hint: 'In whole steps of the board’s lattice (20 mm on most).' },
    {
      key: 'height',
      label: 'Back height',
      kind: 'number',
      min: 20,
      max: 200,
      step: 20,
      suffix: 'mm',
      hint: 'At least as tall as the profile; taller holds more.',
    },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 0, max: 60, hint: 'A wall up from its front edge; 0 for none.' },
    {
      key: 'ends',
      label: 'Ends',
      kind: 'select',
      options: [
        { value: 'none', label: 'Open' },
        { value: 'walls', label: 'Walls', title: 'Close both ends, sloping from the plate’s top to the front' },
        { value: 'gussets', label: 'Gussets', title: '45° braces where it meets the plate: at the ends and every 150 mm' },
      ],
    },
    {
      key: 'dividers',
      label: 'Dividers',
      kind: 'number',
      min: 0,
      max: 20,
      step: 1,
      suffix: '',
      hint: 'Walls across it, up to its front’s top (a lip’s, with one).',
      when: pocket,
    },
  ],
  resize: { w: 'width', h: 'height' },
});
