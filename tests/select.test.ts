import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox } from '../src/components/combobox';
import { Select } from '../src/components/fields';
import { inOpenList, isTyping } from '../src/components/shortcuts';

const root = resolve(__dirname, '..');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|jsx?|html)$/.test(name)) yield p;
  }
}

/** Ways a native select (or a datalist, its typing cousin) gets onto the page. */
const NATIVE = [
  /<(select|option|optgroup|datalist)[\s>/]/,
  /createElement\(\s*['"`](select|option|optgroup|datalist)['"`]/,
  /new Option\(/,
  /<input\b[^>]*?\slist=/s,
];

describe('pick lists', () => {
  it('uses no native select, option or datalist anywhere (fields.tsx Select and combobox.tsx Combobox instead)', () => {
    const found: string[] = [];
    for (const file of [...sources(join(root, 'src')), join(root, 'index.html')]) {
      const text = readFileSync(file, 'utf8');
      for (const re of NATIVE) {
        const m = re.exec(text);
        if (m) found.push(`${relative(root, file)}: ${m[0].slice(0, 40)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('draws a Select as a combobox button named by its field label', () => {
    const html = renderToStaticMarkup(
      createElement(Select, {
        label: 'Connectors',
        value: 'pin',
        options: [
          { value: 'none', label: 'None' },
          { value: 'pin', label: 'Filament pins' },
        ],
        onChange: () => {},
      }),
    );
    expect(html).not.toMatch(/<select|<option/);
    const button = /<button[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-haspopup="listbox"');
    expect(button).toContain('type="button"');
    const id = /\sid="([^"]+)"/.exec(button)?.[1];
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(button)?.[1];
    // The label points at the button and names it.
    expect(html).toContain(`<label class="field-label" for="${id}" id="${labelledBy}">Connectors</label>`);
    expect(html).toContain('<span class="pick-value">Filament pins</span>');
  });

  it('draws a Combobox as a text box showing the current option', () => {
    const html = renderToStaticMarkup(
      createElement(Combobox, {
        label: 'Holds',
        value: 'm3',
        options: [
          { value: 'm2', label: 'M2 screw', group: 'Screws' },
          { value: 'm3', label: 'M3 screw', group: 'Screws', keywords: ['3mm'] },
        ],
        onChange: () => {},
      }),
    );
    const input = /<input[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('value="M3 screw"');
    // React writes some attributes camel-cased (HTML doesn't mind).
    expect(input).toMatch(/autocomplete="off"/i);
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(input)?.[1];
    expect(html).toContain(`id="${labelledBy}">Holds</label>`);
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*aria-label="Show all options"/i);
  });

  it('keeps the app’s shortcuts out of a focused pick list', () => {
    // The shortcut handlers only need closest(); a stand-in element is enough.
    const el = (sel: string | null) => ({ closest: (q: string) => (sel && q.includes(sel) ? {} : null) }) as unknown as EventTarget;
    expect(isTyping(el('[role="combobox"]'))).toBe(true);
    expect(inOpenList(el('[role="combobox"][aria-expanded="true"]'))).toBe(true);
    expect(inOpenList(el(null))).toBe(false);
    expect(isTyping(el(null))).toBe(false);
  });
});
