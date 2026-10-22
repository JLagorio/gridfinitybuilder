/**
 * Attachments' planning side: the registry (registry.ts) and, loaded on demand, the kinds
 * (kinds/all.ts): they aren't on the first screen, so the app loads them once the project has a
 * board (ready.ts). build.ts has their geometry, ui.ts their forms.
 */
export * from './registry';
export { kindsReady, kindsVersion, subscribeKinds } from './ready';

let loading: Promise<unknown> | null = null;

/** Load every kind's planning (once). */
export const loadKinds = () => (loading ??= import('./kinds/all'));
