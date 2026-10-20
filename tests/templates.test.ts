import { beforeEach, describe, expect, it } from 'vitest';
import { history, projectFile, useStore } from '../src/state/store';
import { selectBins } from '../src/state/selection';
import { applyTemplateToBins, applyTemplateToNew, deleteTemplate, renameTemplate, saveTemplate } from '../src/state/templates';
import { applyTemplate, cleanTemplates, mergeTemplates } from '../src/lib/templates';
import { DEFAULT_BIN, type BinOptions } from '../src/lib/geometry/bin';

const s = () => useStore.getState();

beforeEach(() => {
  s().resetAll();
  useStore.setState({ templates: [] });
  history.clear();
});

describe('bin templates', () => {
  it('saves, renames and deletes, with unique names', () => {
    const a = saveTemplate('Deep', { ...DEFAULT_BIN, heightUnits: 9 });
    saveTemplate('Deep', DEFAULT_BIN);
    expect(s().templates.map((t) => t.name)).toEqual(['Deep', 'Deep 2']);
    renameTemplate(a, '  Tall  ');
    renameTemplate(a, '   '); // ignored
    expect(s().templates[0].name).toBe('Tall');
    deleteTemplate(a);
    expect(s().templates.map((t) => t.name)).toEqual(['Deep 2']);
  });

  it('applies to new bins and to selected bins, keeping each bin’s size', () => {
    const t = saveTemplate('Magnets', { ...DEFAULT_BIN, unitsX: 3, heightUnits: 6, holes: 'magnets', label: 'full' });
    applyTemplateToNew(t);
    expect(s().newBin).toMatchObject({ heightUnits: 6, holes: 'magnets', unitsX: 1 });
    s().setNewBin(DEFAULT_BIN);
    const a = s().addBin(0, 0, 2, 1);
    const b = s().addBin(2, 0, 1, 2);
    const c = s().addBin(4, 0, 1, 1);
    selectBins([a, b]);
    history.checkpoint();
    applyTemplateToBins(t, [a, b]);
    const opts = (id: string) => s().bins.find((x) => x.id === id)!.opts;
    expect(opts(a)).toMatchObject({ unitsX: 2, unitsY: 1, heightUnits: 6, label: 'full' });
    expect(opts(b)).toMatchObject({ unitsX: 1, unitsY: 2, heightUnits: 6 });
    expect(opts(c).heightUnits).toBe(3);
    history.undo();
    expect(opts(a).heightUnits).toBe(3);
  });

  it('keeps unknown fields and sanitizes on use', () => {
    const odd = { ...DEFAULT_BIN, heightUnits: 999, futureField: { walls: [1, 2] } } as BinOptions;
    const [t] = cleanTemplates([{ id: 'x', name: 'Odd', opts: odd }, { bogus: true }, null]);
    expect((t.opts as unknown as { futureField: unknown }).futureField).toEqual({ walls: [1, 2] });
    const applied = applyTemplate(t, { unitsX: 2, unitsY: 2 });
    expect(applied.heightUnits).toBe(30);
    expect((applied as unknown as { futureField: unknown }).futureField).toEqual({ walls: [1, 2] });
    // Fields the template lacks fall back to defaults.
    const [partial] = cleanTemplates([{ id: 'p', name: 'P', opts: { heightUnits: 4 } }]);
    expect(applyTemplate(partial, { unitsX: 1, unitsY: 1 })).toEqual({ ...DEFAULT_BIN, heightUnits: 4 });
  });

  it('travels in project files; opening one adds to the library instead of replacing it', () => {
    saveTemplate('Mine', DEFAULT_BIN);
    const file = JSON.parse(JSON.stringify(projectFile(s())));
    expect(file.templates).toHaveLength(1);
    useStore.setState({ templates: [] });
    saveTemplate('Local', DEFAULT_BIN);
    s().loadProject(file);
    expect(s().templates.map((t) => t.name)).toEqual(['Local', 'Mine']);
    expect(mergeTemplates([{ id: 'a', name: 'A', opts: DEFAULT_BIN }], [{ id: 'a', name: 'A2', opts: DEFAULT_BIN }])).toHaveLength(1);
  });
});
