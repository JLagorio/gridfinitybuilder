/**
 * What the Attachments tab shows for each kind (components/WallPanel.tsx): its
 * name, a line about it, its group in the picker and the form that edits its
 * options. Apart from the planning defs (registry.ts) so it loads with the
 * tab, not on the first screen. Each kind's `<kind>.ui.ts` registers here;
 * ./ui.ts imports them all.
 */
import type { AttachmentField, AttachmentGroup } from './registry';

/** The picker's groups, in the order it shows them. */
export const GROUP_LABELS: Record<AttachmentGroup, string> = {
  board: 'Start here',
  hooks: 'Hooks',
  storage: 'Bins & cups',
  gridfinity: 'Gridfinity',
  containers: 'Rails & containers',
  shelves: 'Shelves',
  tools: 'Tools',
  devices: 'Devices',
  hobby: 'Hobby & craft',
  kitchen: 'Kitchen',
  display: 'Display',
  power: 'Lighting and cables',
  adapters: 'Adapters & mounts',
  other: 'Other',
};

export interface AttachmentUi {
  type: string;
  label: string;
  /** One line for the picker. */
  description: string;
  group: AttachmentGroup;
  /** The form that edits it, in order. */
  fields: AttachmentField[];
  /**
   * The options its edges resize in the board editor, across (`w`) and up (`h`), when they aren't the usual names
   * (lib/wall/resize.ts); null: that edge doesn't resize it.
   */
  resize?: { w?: string | null; h?: string | null };
}

const UIS = new Map<string, AttachmentUi>();

export function registerAttachmentUi(ui: AttachmentUi): void {
  UIS.set(ui.type, ui);
}

export const attachmentUi = (type: string): AttachmentUi | null => UIS.get(type) ?? null;
export const attachmentUis = (): AttachmentUi[] => [...UIS.values()];
