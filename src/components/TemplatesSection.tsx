import { useStore } from '../state/store';
import { useSelectedIds } from '../state/selection';
import { applyTemplateToBins, applyTemplateToNew, deleteTemplate, renameTemplate, saveTemplate } from '../state/templates';
import { sanitizeBin } from '../lib/geometry/bin';
import { DEFAULT_BIN } from '../lib/project';
import { templateSummary } from '../lib/templates';
import { Section } from './fields';

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
        <p className="muted small">
          Save a bin's settings to reuse them in any drawer. Apply one to the selected bins, or to new bins when nothing is selected.
        </p>
      )}
      {templates.length > 0 && <p className="field-hint">Apply goes to {target}.</p>}
    </Section>
  );
}
