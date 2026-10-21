import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'fitTest',
  label: 'Fit test',
  description: 'Three clip tabs, snug, normal and loose: print them first to pick the fit.',
  group: 'other',
  fields: [],
});
