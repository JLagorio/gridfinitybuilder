import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { once } from '../src/components/lazy';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../src/pwa/chunks';

describe('code-split loading', () => {
  it('knows a file that failed to load, in every browser’s words', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x.test/assets/BinPanel-abc.js'))).toBe(true);
    expect(isChunkError(new TypeError('error loading dynamically imported module: https://x.test/assets/BinPanel-abc.js'))).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new Error('Unable to preload CSS for /assets/BinPanel-abc.css'))).toBe(true);
    expect(isChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkError('nope')).toBe(false);
  });

  it('loads once for prefetching and rendering alike, and tries again after a failure', async () => {
    let calls = 0;
    let fail = true;
    const load = once(async () => {
      calls++;
      if (fail) throw new TypeError('Failed to fetch dynamically imported module: x');
      return 'module';
    });
    await expect(load()).rejects.toThrow(/dynamically imported/);
    fail = false;
    const [a, b] = await Promise.all([load(), load()]);
    expect([a, b]).toEqual(['module', 'module']);
    expect(calls).toBe(2);
  });

  it('says "Reload to update" when a part fails to load, instead of offering to try again', () => {
    const shown = (error: Error, compact = true) => {
      const b = new ErrorBoundary({ children: null, scope: 'The Bins panel', compact });
      b.state = { error };
      return renderToStaticMarkup(b.render() as ReactElement);
    };
    const chunk = shown(new TypeError('Failed to fetch dynamically imported module: https://x.test/assets/BinPanel-abc.js'));
    expect(chunk).toContain('The Bins panel couldn’t load.');
    expect(chunk).toContain('Reload to update');
    expect(chunk).toContain(CHUNK_ERROR_MESSAGE.slice(0, 40));
    expect(chunk).not.toContain('Try again');
    expect(shown(new TypeError('Importing a module script failed.'), false)).toContain('Reload to update');
    // Other errors keep their message and the retry.
    const other = shown(new Error('boom'));
    expect(other).toContain('boom');
    expect(other).toContain('Try again');
  });
});
