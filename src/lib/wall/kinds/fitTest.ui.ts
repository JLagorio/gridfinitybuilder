import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'fitTest',
  label: 'Fit test',
  description: 'Clip tabs, each named on its front: print them first to pick the fit. And a gauge for the board’s thickness.',
  group: 'board',
  fields: [
    {
      key: 'steps',
      label: 'Tabs',
      kind: 'select',
      options: [
        { value: '3', label: 'Snug, normal, loose', title: 'One tab per fit: pick the fit from the one that clicks in and holds' },
        { value: '5', label: 'Slot widths', title: 'Five tabs for slots 0.1 mm apart: set Slot width to the one that holds best' },
      ],
      hint: 'Pick the fit (below) or the board’s Slot width from the tab that clicks in and holds.',
    },
    {
      key: 'gauge',
      label: 'Thickness gauge',
      kind: 'toggle',
      hint: 'Notches 4.6 to 5.6 mm, numbered: push a tooth through a slot and slide the board into them. Set the board’s Thickness to the narrowest that goes on.',
    },
  ],
});
