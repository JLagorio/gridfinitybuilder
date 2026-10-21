import { describe, expect, it } from 'vitest';
import {
  PAGE,
  comboKey,
  filterOptions,
  firstEnabled,
  fold,
  groupOptions,
  moveActive,
  optionMatches,
  selectKey,
  typeahead,
  type PickOption,
} from '../src/lib/pickList';
import { POCKET_PRESETS } from '../src/lib/geometry/pockets';

const AMMO: PickOption[] = [
  { value: '556', label: '5.56 NATO', group: 'Ammunition', keywords: ['223 rem', 'ar15'] },
  { value: '300blk', label: '.300 BLK', group: 'Ammunition', keywords: ['300 blackout'] },
  { value: '9mm', label: '9 mm Luger', group: 'Ammunition', keywords: ['9x19', 'parabellum'] },
];
const OPTIONS: PickOption[] = [
  { value: 'aa', label: 'AA battery', group: 'Batteries' },
  { value: 'aaa', label: 'AAA battery', group: 'Batteries' },
  { value: 'cr2032', label: 'CR2032 coin cell', group: 'Batteries' },
  { value: 'm3', label: 'M3 screw', group: 'Screws' },
  { value: 'm4', label: 'M4 screw', group: 'Screws' },
  { value: 'euro1', label: '€1 stack', group: 'Coins' },
  ...AMMO,
  { value: 'custom', label: 'Custom size', group: 'Custom' },
];
const labels = (os: PickOption[]) => os.map((o) => o.label);

describe('pick list matching', () => {
  it('folds case, accents, spaces and punctuation away', () => {
    expect(fold('5.56 NATO')).toBe('556nato');
    expect(fold('.300 BLK')).toBe('300blk');
    expect(fold('Crème Brûlée')).toBe('cremebrulee');
    expect(fold('1/4″ hex bit')).toBe('14hexbit');
    expect(fold('  ')).toBe('');
  });

  it('finds an option by its label whatever the punctuation', () => {
    expect(labels(filterOptions(OPTIONS, '556'))).toEqual(['5.56 NATO']);
    expect(labels(filterOptions(OPTIONS, '5.56'))).toEqual(['5.56 NATO']);
    expect(labels(filterOptions(OPTIONS, '300 blk'))).toEqual(['.300 BLK']);
    expect(labels(filterOptions(OPTIONS, '300BLK'))).toEqual(['.300 BLK']);
    expect(labels(filterOptions(OPTIONS, 'cr 2032'))).toEqual(['CR2032 coin cell']);
    expect(labels(filterOptions(OPTIONS, 'M3'))).toEqual(['M3 screw']);
  });

  it('finds an option by its keywords and its group', () => {
    expect(labels(filterOptions(OPTIONS, '223'))).toEqual(['5.56 NATO']);
    expect(labels(filterOptions(OPTIONS, 'blackout'))).toEqual(['.300 BLK']);
    expect(labels(filterOptions(OPTIONS, 'parabellum'))).toEqual(['9 mm Luger']);
    expect(labels(filterOptions(OPTIONS, 'screws'))).toEqual(['M3 screw', 'M4 screw']);
    expect(labels(filterOptions(OPTIONS, 'ammunition'))).toEqual(['5.56 NATO', '.300 BLK', '9 mm Luger']);
  });

  it('needs every typed word, in any order, somewhere in the option', () => {
    expect(labels(filterOptions(OPTIONS, 'battery aa'))).toEqual(['AA battery', 'AAA battery']);
    expect(labels(filterOptions(OPTIONS, 'screw m4'))).toEqual(['M4 screw']);
    expect(filterOptions(OPTIONS, 'screw 556')).toEqual([]);
    expect(filterOptions(OPTIONS, 'zzz')).toEqual([]);
  });

  it('shows everything for empty or punctuation-only text', () => {
    expect(filterOptions(OPTIONS, '')).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, ' . ')).toEqual(OPTIONS);
    expect(optionMatches(OPTIONS[0], '')).toBe(true);
  });

  it('keeps groups as headings, in the order they first appear', () => {
    const groups = groupOptions(filterOptions(OPTIONS, 'a'));
    expect(groups.map((g) => g.name)).toEqual(['Batteries', 'Coins', 'Ammunition']);
    // Ungrouped options sit where the first of them is; a group split in two is listed together.
    const mixed = groupOptions<PickOption>([
      { value: '1', label: 'One' },
      { value: '2', label: 'Two', group: 'G' },
      { value: '3', label: 'Three' },
      { value: '4', label: 'Four', group: 'G' },
    ]);
    expect(mixed.map((g) => [g.name, g.options.map((o) => o.value)])).toEqual([
      ['', ['1', '3']],
      ['G', ['2', '4']],
    ]);
  });

  it('finds the pocket presets by what people type', () => {
    const opts: PickOption[] = POCKET_PRESETS.map((p) => ({ value: p.id, label: p.label, group: p.group }));
    expect(filterOptions(opts, '18650').map((o) => o.value)).toEqual(['18650']);
    expect(filterOptions(opts, 'cr 2032').map((o) => o.value)).toEqual(['cr2032']);
    expect(filterOptions(opts, 'micro sd').map((o) => o.value)).toEqual(['microsd']);
    expect(filterOptions(opts, 'm2.5').map((o) => o.value)).toEqual(['m2.5']);
    expect(filterOptions(opts, 'coins').length).toBeGreaterThanOrEqual(6);
  });
});

describe('pick list navigation', () => {
  const list: PickOption[] = [
    { value: 'a', label: 'Apple', disabled: true },
    { value: 'b', label: 'Banana' },
    { value: 'c', label: 'Cherry' },
    { value: 'd', label: 'Date', disabled: true },
    { value: 'e', label: 'Elderberry' },
    { value: 'f', label: 'Fig', disabled: true },
  ];

  it('moves without wrapping and skips disabled options', () => {
    expect(firstEnabled(list)).toBe(1);
    expect(moveActive(list, -1, 'next')).toBe(1);
    expect(moveActive(list, 1, 'next')).toBe(2);
    expect(moveActive(list, 2, 'next')).toBe(4);
    expect(moveActive(list, 4, 'next')).toBe(4);
    expect(moveActive(list, 4, 'prev')).toBe(2);
    expect(moveActive(list, 1, 'prev')).toBe(1);
    expect(moveActive(list, 2, 'first')).toBe(1);
    expect(moveActive(list, 1, 'last')).toBe(4);
    expect(moveActive([], -1, 'next')).toBe(-1);
  });

  it('pages by ten, stopping at the ends', () => {
    const many = Array.from({ length: 25 }, (_, i): PickOption => ({ value: String(i), label: `Item ${i}` }));
    expect(moveActive(many, 0, 'pageDown')).toBe(PAGE);
    expect(moveActive(many, 20, 'pageDown')).toBe(24);
    expect(moveActive(many, 15, 'pageUp')).toBe(5);
    expect(moveActive(many, 3, 'pageUp')).toBe(0);
    // Ends on a disabled option: the nearest one that isn't.
    expect(moveActive(list, 2, 'pageDown')).toBe(4);
    expect(moveActive(list, 4, 'pageUp')).toBe(1);
  });

  it('jumps to an option by its first letters', () => {
    const fruit: PickOption[] = [
      { value: 'a', label: 'Apple' },
      { value: 'ap', label: 'Apricot' },
      { value: 'b', label: 'Banana' },
      { value: 'bl', label: 'Blueberry' },
      { value: 'c', label: 'Cherry', keywords: ['griotte'] },
    ];
    expect(typeahead(fruit, -1, 'b')).toBe(2);
    // The same letter again steps through the options starting with it, and around.
    expect(typeahead(fruit, 2, 'b')).toBe(3);
    expect(typeahead(fruit, 3, 'b')).toBe(2);
    expect(typeahead(fruit, 0, 'aa')).toBe(1);
    // Longer text stays on the active option while it still matches.
    expect(typeahead(fruit, 0, 'ap')).toBe(0);
    expect(typeahead(fruit, 0, 'apr')).toBe(1);
    expect(typeahead(fruit, 2, 'bl')).toBe(3);
    expect(typeahead(fruit, 0, 'gri')).toBe(4);
    expect(typeahead(fruit, 0, 'x')).toBe(-1);
    // Punctuation and case don't count; disabled options are skipped.
    expect(typeahead(AMMO, -1, '30')).toBe(1);
    expect(typeahead([{ value: 'x', label: 'Xylophone', disabled: true }], -1, 'x')).toBe(-1);
  });
});

describe('pick list keys', () => {
  const k = (key: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => ({ key, ...mods });

  it('opens a closed Select with Enter, Space and the arrows, and jumps with Home / End and letters', () => {
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) expect(selectKey(k(key), false)).toEqual({ type: 'open' });
    expect(selectKey(k('Home'), false)).toEqual({ type: 'move', move: 'first' });
    expect(selectKey(k('End'), false)).toEqual({ type: 'move', move: 'last' });
    expect(selectKey(k('m'), false)).toEqual({ type: 'type', char: 'm' });
    // Shortcuts and keys it doesn't use pass through.
    expect(selectKey(k('z', { ctrlKey: true }), false)).toBeNull();
    expect(selectKey(k('Escape'), false)).toBeNull();
    expect(selectKey(k('Tab'), false)).toBeNull();
    expect(selectKey(k('PageDown'), false)).toBeNull();
  });

  it('moves, picks and closes an open Select', () => {
    expect(selectKey(k('ArrowDown'), true)).toEqual({ type: 'move', move: 'next' });
    expect(selectKey(k('ArrowUp'), true)).toEqual({ type: 'move', move: 'prev' });
    expect(selectKey(k('Home'), true)).toEqual({ type: 'move', move: 'first' });
    expect(selectKey(k('End'), true)).toEqual({ type: 'move', move: 'last' });
    expect(selectKey(k('PageDown'), true)).toEqual({ type: 'move', move: 'pageDown' });
    expect(selectKey(k('PageUp'), true)).toEqual({ type: 'move', move: 'pageUp' });
    expect(selectKey(k('Enter'), true)).toEqual({ type: 'pick' });
    expect(selectKey(k(' '), true)).toEqual({ type: 'pick' });
    expect(selectKey(k('ArrowUp', { altKey: true }), true)).toEqual({ type: 'pick' });
    expect(selectKey(k('Tab'), true)).toEqual({ type: 'pickAndLeave' });
    expect(selectKey(k('Escape'), true)).toEqual({ type: 'close' });
    expect(selectKey(k('c'), true)).toEqual({ type: 'type', char: 'c' });
    // Space in the middle of typing a name is part of it ("US quarter").
    expect(selectKey(k(' '), true, true)).toEqual({ type: 'type', char: ' ' });
    expect(selectKey(k(' '), false, true)).toEqual({ type: 'type', char: ' ' });
  });

  it('leaves the Combobox’s text keys to the text box', () => {
    expect(comboKey(k('ArrowDown'), false, false)).toEqual({ type: 'open' });
    expect(comboKey(k('ArrowUp'), false, false)).toEqual({ type: 'open' });
    expect(comboKey(k('ArrowDown'), true, false)).toEqual({ type: 'move', move: 'next' });
    expect(comboKey(k('ArrowUp'), true, false)).toEqual({ type: 'move', move: 'prev' });
    expect(comboKey(k('PageDown'), true, false)).toEqual({ type: 'move', move: 'pageDown' });
    expect(comboKey(k('Enter'), true, false)).toEqual({ type: 'pick' });
    expect(comboKey(k('Enter'), false, false)).toBeNull();
    expect(comboKey(k('Escape'), true, false)).toEqual({ type: 'revert' });
    expect(comboKey(k('ArrowUp', { altKey: true }), true, false)).toEqual({ type: 'revert' });
    // Tab takes an option only when the arrows went to it; otherwise leaving puts the value back.
    expect(comboKey(k('Tab'), true, true)).toEqual({ type: 'pickAndLeave' });
    expect(comboKey(k('Tab'), true, false)).toBeNull();
    for (const key of ['Home', 'End', 'a', ' ', 'Backspace', 'ArrowLeft']) expect(comboKey(k(key), true, true)).toBeNull();
  });
});
