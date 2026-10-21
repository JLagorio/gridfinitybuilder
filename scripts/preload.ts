/**
 * Preload hints for the panel of the tab a returning visitor comes back to.
 * The tab is saved with the project, and its panel is code-split (App.tsx):
 * without a hint the browser only asks for it once the app's code has run.
 * A tiny inline script in index.html reads the saved tab while the page is
 * parsed and adds `<link rel="modulepreload">` for that panel's chunks (and
 * a preload for their CSS), so they download beside the app's own.
 */
import type { Plugin, Rolldown } from 'vite';

type OutputBundle = Rolldown.OutputBundle;
type OutputChunk = Rolldown.OutputChunk;

/** The files a code-split module needs (path from the root): its chunk, the chunks that imports, and their CSS. Files the entry loads anyway are left out. */
export function chunksToPreload(bundle: OutputBundle, modules: string[]): { js: string[]; css: string[] } {
  const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const walk = (file: string, into: Set<string>) => {
    if (into.has(file)) return;
    into.add(file);
    for (const dep of byFile.get(file)?.imports ?? []) walk(dep, into);
  };
  const entry = new Set<string>();
  for (const c of chunks) if (c.isEntry) walk(c.fileName, entry);
  const js = new Set<string>();
  for (const m of modules) {
    const c = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith(`/${m}`));
    if (!c) throw new Error(`preload: no chunk for ${m} (is it still loaded with import()?)`);
    walk(c.fileName, js);
  }
  const files = [...js].filter((f) => !entry.has(f));
  const cssOf = (f: string) => [...(byFile.get(f)?.viteMetadata?.importedCss ?? [])];
  const entryCss = new Set([...entry].flatMap(cssOf));
  return { js: files, css: [...new Set(files.flatMap(cssOf))].filter((f) => !entryCss.has(f)) };
}

export interface PreloadOptions {
  /** The localStorage entry the project is saved in; its `state.ui.tab` is the tab. */
  storageKey: string;
  /** Per tab, the code-split modules it shows. */
  tabs: Record<string, string[]>;
}

/** Vite plugin: adds the inline script to index.html. Production builds only. */
export function preloadSavedTab(opts: PreloadOptions): Plugin {
  let base = '/';
  return {
    name: 'gridfit-preload-saved-tab',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        const files: Record<string, [string[], string[]]> = {};
        for (const [tab, modules] of Object.entries(opts.tabs)) {
          const { js, css } = chunksToPreload(ctx.bundle, modules);
          files[tab] = [js.map((f) => `${base}${f}`), css.map((f) => `${base}${f}`)];
        }
        // No saved project, another tab, or storage blocked: nothing to add.
        const script =
          `(function(){try{var f=${JSON.stringify(files)}[JSON.parse(localStorage.getItem(${JSON.stringify(opts.storageKey)})).state.ui.tab];` +
          `var add=function(rel,as){return function(h){var l=document.createElement('link');l.rel=rel;if(as)l.as=as;l.crossOrigin='';l.href=h;document.head.appendChild(l)}};` +
          `f[0].forEach(add('modulepreload'));f[1].forEach(add('preload','style'))}catch(e){}})()`;
        return [{ tag: 'script', children: script, injectTo: 'head' }];
      },
    },
  };
}
