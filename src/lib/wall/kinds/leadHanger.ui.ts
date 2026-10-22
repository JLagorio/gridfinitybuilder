import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'leadHanger',
  label: 'Lead hanger',
  description: 'Leads hang by their plugs: the cable slides into a slot, the plug drops into a pocket. Test leads, probes, USB, XLR, jack leads.',
  group: 'devices',
  fields: [
    {
      key: 'preset',
      label: 'Leads',
      kind: 'preset',
      hint: 'Slot: the cable and a little; pocket: the plug or head and a little. Measure yours.',
      presets: [
        { value: 'banana', label: 'Test leads, banana plugs (cable 3–4, plug 10–12)', set: { slot: 4.5, pocket: 13, depth: 8, pitch: 18 } },
        { value: 'probe', label: 'Scope probes (cable 4–5, body 12–14)', set: { slot: 5.5, pocket: 16, depth: 10, pitch: 22 } },
        { value: 'usb', label: 'USB cables (cable 3–5, plug up to 16 × 8)', set: { slot: 5.5, pocket: 18, depth: 8, pitch: 23 } },
        { value: 'xlr', label: 'XLR leads (cable 6–7, shell 19–20)', set: { slot: 7.5, pocket: 21.5, depth: 12, pitch: 28 } },
        { value: 'jack', label: '¼″ jack leads (cable 6–7, plug 13–16)', set: { slot: 7.5, pocket: 17, depth: 12, pitch: 24 } },
        { value: 'leash', label: 'Dog leads by the clip (lead up to 12, clip 30)', set: { slot: 13, pocket: 32, depth: 12, pitch: 40 } },
      ],
    },
    { key: 'slot', label: 'Slot width', kind: 'length', min: 1.5, max: 58, hint: 'The cable slides in: its diameter and 0.5–1 mm.' },
    { key: 'pocket', label: 'Pocket diameter', kind: 'length', min: 5, max: 60, hint: 'The plug sits in it: its diameter and 1–2 mm.' },
    { key: 'depth', label: 'Pocket depth', kind: 'length', min: 2, max: 40, hint: 'How far the plug sinks in.' },
    { key: 'count', label: 'Leads', kind: 'number', min: 1, max: 16, step: 1, suffix: '' },
    { key: 'pitch', label: 'Pitch', kind: 'length', min: 6, max: 100, hint: 'Centre to centre.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 20, max: 150 },
  ],
});
