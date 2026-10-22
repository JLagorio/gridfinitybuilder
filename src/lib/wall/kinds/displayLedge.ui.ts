import { registerAttachmentUi } from '../uiRegistry';
import type { DisplayLedgeOptions } from './displayLedge';

type O = DisplayLedgeOptions;
const studs = (o: O) => o.mode === 'studs';
const pockets = (o: O) => o.mode === 'cars' || o.mode === 'steps';
/** Miniatures' bases: as many as keep it about 200 mm wide, a step up for each row. */
const base = (d: number, columns: number, rise: number) => ({ mode: 'bases', base: d, columns, tiers: 3, rise, recess: 2 });

registerAttachmentUi({
  type: 'displayLedge',
  label: 'Display ledge',
  description: 'Stepped shelves to show things off: LEGO studs, miniatures’ bases, die-cast cars, figures.',
  group: 'display',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        {
          value: 'minifigs',
          label: 'LEGO minifigures',
          title: 'Three tiers of studs, two rows each',
          set: { mode: 'studs', system: 'lego', columns: 16, rows: 2, tiers: 3, rise: 24 },
        },
        {
          value: 'plate',
          label: 'LEGO display plate',
          title: 'One tier, 16 × 4 studs',
          set: { mode: 'studs', system: 'lego', columns: 16, rows: 4, tiers: 1, rise: 24 },
        },
        { value: 'duplo', label: 'Duplo', set: { mode: 'studs', system: 'duplo', columns: 8, rows: 2, tiers: 2, rise: 40 } },
        { value: 'b25', label: 'Miniatures, 25 mm bases', set: base(25, 6, 20) },
        { value: 'b28', label: 'Miniatures, 28.5 mm bases', set: base(28.5, 6, 20) },
        { value: 'b32', label: 'Miniatures, 32 mm bases', set: base(32, 5, 22) },
        { value: 'b40', label: 'Miniatures, 40 mm bases', set: base(40, 4, 28) },
        { value: 'b50', label: 'Miniatures, 50 mm bases', set: base(50, 3, 32) },
        { value: 'b60', label: 'Miniatures, 60 mm bases', set: base(60, 3, 36) },
        {
          value: 'cars',
          label: 'Die-cast cars, 1:64',
          title: 'Side on, about 75 × 30 (Hot Wheels, Matchbox)',
          set: { mode: 'cars', itemW: 75, itemD: 32, columns: 2, tiers: 3, rise: 30, recess: 1.5 },
        },
        {
          value: 'funko',
          label: 'Funko Pop figures',
          title: 'Out of the box: a shallow pocket for each; measure yours',
          set: { mode: 'steps', itemW: 70, itemD: 60, columns: 2, tiers: 3, rise: 40, recess: 1 },
        },
        {
          value: 'funkoBox',
          label: 'Funko Pop boxes',
          title: 'About 115 × 90 standing',
          set: { mode: 'steps', itemW: 115, itemD: 90, columns: 1, tiers: 2, rise: 60, recess: 0 },
        },
      ],
    },
    {
      key: 'mode',
      label: 'Tiers hold',
      kind: 'select',
      options: [
        { value: 'studs', label: 'Studs', title: 'A stud plate bricks press onto' },
        { value: 'bases', label: 'Bases', title: 'Round sockets for miniatures’ bases' },
        { value: 'cars', label: 'Cars', title: 'Pockets that keep die-cast cars from rolling' },
        { value: 'steps', label: 'Steps', title: 'Deep steps with a shallow pocket per figure' },
      ],
    },
    {
      key: 'system',
      label: 'Studs',
      kind: 'select',
      options: [
        { value: 'lego', label: 'LEGO', title: '8 mm apart, ⌀4.8' },
        { value: 'duplo', label: 'Duplo', title: '16 mm apart, ⌀9.6' },
      ],
      when: studs,
    },
    { key: 'columns', label: 'Across', kind: 'number', min: 1, max: 30, step: 1, suffix: '', hint: 'Studs, or things on each tier.' },
    { key: 'rows', label: 'Rows of studs', kind: 'number', min: 1, max: 8, step: 1, suffix: '', when: studs },
    {
      key: 'tol',
      label: 'Stud fit',
      kind: 'number',
      min: -0.1,
      max: 0.1,
      step: 0.05,
      suffix: ' mm',
      hint: 'Print the coupon first: one notch is 0.05 thinner than this, two as set, three 0.05 fatter. Set the one a brick grips best.',
      when: studs,
    },
    { key: 'base', label: 'Base diameter', kind: 'length', min: 15, max: 80, when: (o: O) => o.mode === 'bases' },
    { key: 'itemW', label: 'Each across', kind: 'length', min: 15, max: 200, when: pockets },
    { key: 'itemD', label: 'Each front to back', kind: 'length', min: 10, max: 150, when: pockets },
    { key: 'recess', label: 'Pocket depth', kind: 'length', min: 0, max: 4, hint: '0 for a flat tread.', when: (o: O) => !studs(o) },
    { key: 'tiers', label: 'Tiers', kind: 'number', min: 1, max: 6, step: 1, suffix: '' },
    {
      key: 'rise',
      label: 'Step up',
      kind: 'length',
      min: 6,
      max: 120,
      hint: 'Each tier this much higher than the one in front of it.',
      when: (o: O) => o.tiers > 1,
    },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 0, max: 20, hint: 'Along the front of each tier; 0 for none.' },
  ],
});
