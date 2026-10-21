import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useSelectedIds } from '../state/selection';
import { applyPresetToBins, applyPresetToNew, applyTemplateToBins, applyTemplateToNew, deleteTemplate, renameTemplate, saveTemplate } from '../state/templates';
import { sanitizeBin } from '../lib/geometry/bin';
import { DEFAULT_BIN } from '../lib/project';
import { BIN_PRESETS, templateSummary, type BinPreset } from '../lib/templates';
import { Section } from './fields';

/**
 * The built-in presets (lib/templates.ts), as a row of buttons: one click sets
 * the selected bins, or the settings for new bins when none is selected. One
 * undo step each.
 */
export function BinPresets() {
  const selIds = useSelectedIds();
  const [msg, setMsg] = useState<string | null>(null);
  const key = selIds.join();
  useEffect(() => setMsg(null), [key]);
  const pick = (p: BinPreset) => {
    const r = selIds.length ? applyPresetToBins(p.id, selIds) : applyPresetToNew(p.id);
    const to = selIds.length ? (selIds.length > 1 ? `the ${selIds.length} selected bins` : 'this bin') : 'new bins';
    const cut = !r.shrunk ? '' : selIds.length > 1 ? ` ${r.shrunk} of them were made smaller to fit the printer.` : ' Made smaller to fit the printer.';
    setMsg(r.changed ? `“${p.name}” set for ${to}.${cut} Undo puts it back.` : `“${p.name}” has nothing to change on ${to}.`);
  };
  return (
    <div className="field">
      <span className="field-label">Start from</span>
      <div className="quick-presets" role="group" aria-label="Start from a preset">
        {BIN_PRESETS.map((p) => (
          <button key={p.id} type="button" title={p.hint} onClick={() => pick(p)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="field-hint">{msg ?? 'Sets the inside, scoop, labels or height in one click. The size stays.'}</div>
    </div>
  );
}

/** Named bin settings, shared by every drawer: save, apply, rename, delete. */
export function TemplatesSection() {
  const templates = useStore((s) => s.templates);
  const bins = useStore((s) => s.bins);
  const newBin = useStore((s) => s.newBin);
  const selIds = useSelectedIds();
  const selected = bins.filter((b) => selIds.includes(b.id));
  const primary = selected.find((b) => b.id === selIds[0]);
  const source = primary?.opts ?? newBin;

  const save = () => {
    // Applying a template keeps each bin's size, so the suggested name leaves it out.
    const name = prompt('Name for this template', templateSummary(sanitizeBin({ ...DEFAULT_BIN, ...source })));
    if (name !== null) saveTemplate(name, source);
  };
  const target = selected.length ? `${selected.length} selected bin${selected.length > 1 ? 's' : ''}` : 'new bins';

  return (
    <Section
      title="Templates"
      find="templates"
      set={templates.length > 0}
      aside={
        <button className="link" onClick={save} title={primary ? "Save the selected bin's settings" : 'Save the new-bin settings'}>
          {primary ? 'Save selected' : 'Save current'}
        </button>
      }
    >
      {templates.length ? (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.id}>
              <span className="template-name" title={t.name}>
                {t.name}
              </span>
              <button
                className="link"
                onClick={() => (selected.length ? applyTemplateToBins(t.id, selIds) : applyTemplateToNew(t.id))}
                title={`Apply to ${target} (size stays the same)`}
              >
                Apply
              </button>
              <span className="template-summary">{templateSummary(sanitizeBin({ ...DEFAULT_BIN, ...t.opts }))}</span>
              <span className="template-actions">
                {selected.length > 0 && (
                  <button className="link" onClick={() => applyTemplateToNew(t.id)}>
                    Use for new bins
                  </button>
                )}
                <button
                  className="link"
                  onClick={() => {
                    const name = prompt('Rename template', t.name);
                    if (name) renameTemplate(t.id, name);
                  }}
                >
                  Rename
                </button>
                <button className="link" onClick={() => confirm(`Delete the template "${t.name}"?`) && deleteTemplate(t.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Save a bin’s settings to reuse them in any drawer. Apply one to the selected bins, or to new bins when nothing is selected.</p>
      )}
      {templates.length > 0 && <p className="field-hint">Apply goes to {target}.</p>}
    </Section>
  );
}
