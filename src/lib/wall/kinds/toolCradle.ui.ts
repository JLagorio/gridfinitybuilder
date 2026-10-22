import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'toolCradle',
  label: 'Holder for a traced tool',
  description: 'A tray tilted toward you with the tool’s own outline as its pocket: it lies in it, and you see when it’s gone.',
  group: 'tools',
  fields: [
    {
      key: 'tools',
      label: 'Tool',
      kind: 'outlines',
      max: 1,
      hint: 'Lay it on a sheet of paper and photograph it from straight above, or import its outline. It lies long side across. Until it has one, it’s sized for a 120 × 24 mm bar.',
    },
    { key: 'depth', label: 'Pocket depth', kind: 'length', min: 0, max: 30, allowEmpty: true, hint: 'Empty: as deep as the tool is thick, so it lies flush.' },
    { key: 'notches', label: 'Finger notches', kind: 'toggle', hint: 'At the middle of its long sides.' },
  ],
  // Its size is the tool's.
  resize: { w: null, h: null },
});
