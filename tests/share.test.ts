import { beforeEach, describe, expect, it } from 'vitest';
import { SHARE_PREFIX, decodeProject, encodeProject, fromBase64Url, projectFromHash, shareUrl, toBase64Url } from '../src/lib/share';
import { allDrawers, projectFile, useStore } from '../src/state/store';
import { saveTemplate } from '../src/state/templates';

const s = () => useStore.getState();

describe('base64url', () => {
  it('round-trips every byte value without padding or unsafe characters', () => {
    for (const n of [0, 1, 2, 3, 255, 256, 70_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + (i >> 8)) & 255);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...fromBase64Url(text)]).toEqual([...bytes]);
    }
  });
});

describe('share links', () => {
  beforeEach(() => {
    s().resetAll();
    useStore.setState({ templates: [] });
  });

  it('encodes the whole project file and decodes it back', () => {
    s().addBin(0, 0, 2, 1);
    s().addBin(3, 2, 1, 1);
    s().addDrawer('Garage');
    s().setDrawer({ width: 321.5, widthSamples: [320] });
    s().setBaseplate({ magnets: true });
    saveTemplate('Deep', { ...s().newBin, heightUnits: 9 });
    const file = projectFile(s());
    const code = encodeProject(file);
    expect(code.length).toBeLessThan(JSON.stringify(file).length);
    expect(decodeProject(code)).toEqual(JSON.parse(JSON.stringify(file)));
  });

  it('puts the project in the URL hash and opens it from there', () => {
    s().addBin(1, 1, 1, 1);
    s().addDrawer('Second');
    s().addBin(0, 0, 3, 2);
    const url = shareUrl(projectFile(s()), 'https://example.com/gridfit/?x=1#old');
    const u = new URL(url);
    expect(u.pathname).toBe('/gridfit/');
    expect(u.search).toBe('?x=1');
    expect(u.hash.startsWith(`#${SHARE_PREFIX}`)).toBe(true);
    const before = allDrawers(s());

    s().resetAll();
    s().loadProject(projectFromHash(u.hash));
    expect(allDrawers(s()).map((d) => [d.name, d.bins.length])).toEqual(before.map((d) => [d.name, d.bins.length]));
    expect(s().bins[0].opts.unitsX).toBe(3);
  });

  it('ignores other hashes and rejects damaged links', () => {
    expect(projectFromHash('')).toBeNull();
    expect(projectFromHash('#section-2')).toBeNull();
    expect(() => projectFromHash(`#${SHARE_PREFIX}not-a-real-project`)).toThrow(/damaged/);
  });
});
