import { Toggle, TextInput } from './fields';
import { ContentsText } from './ContentsField';
import { sanitizeContents } from '../lib/inventory';
import { contentsLabel, type PlacedAttachment } from '../lib/wall';
import { updateAttachment } from '../state/wall';

/**
 * What's in a board's attachment (PlacedAttachment.contents), on its form on
 * the Attachments tab: like a bin's "What's in it", for finding it from the
 * top bar and the contents list. Not geometry, unless its label follows it.
 */
export function AttachmentContentsField({ a }: { a: PlacedAttachment }) {
  return (
    <ContentsText
      label="What’s in it"
      value={a.contents ?? ''}
      onChange={(t) => updateAttachment(a.id, { contents: sanitizeContents(t) || undefined })}
      placeholder={'One thing per line, e.g.\nM3 screws\nM3 nuts'}
      minRows={2}
      hint={
        <>
          For finding it (<kbd>/</kbd>) and the contents list. It doesn’t change the print{a.labelFrom === 'contents' ? ', but for its label' : ''}.
        </>
      }
    />
  );
}

/** An attachment's label (kinds with a label face): text of its own, or what's in it. */
export function AttachmentLabelField({ a }: { a: PlacedAttachment }) {
  const from = a.labelFrom === 'contents';
  const said = contentsLabel(a.contents);
  return (
    <>
      <Toggle
        label="Label from what’s in it"
        checked={from}
        hint={
          from
            ? said
              ? `It says “${said}”: the one thing in it, a few short ones, or the first.`
              : 'List what’s in it above, and the label says it.'
            : undefined
        }
        onChange={(on) => updateAttachment(a.id, { labelFrom: on ? 'contents' : undefined })}
      />
      {!from && <TextInput label="Label" value={a.label ?? ''} placeholder="Text on its front" onChange={(label) => updateAttachment(a.id, { label })} />}
    </>
  );
}
