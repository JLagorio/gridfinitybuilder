/**
 * Undo steps on a slow machine. Changes closer together than 400 ms are one undo step (state/history.ts), so an
 * action that plans a board between two of its changes splits in two where planning is slow (a phone, a busy
 * computer): here every board planned for printing takes a second.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { history, useStore } from '../src/state/store';
import { newBoardFromTemplate } from '../src/state/boardTemplates';
import { boardTemplate } from '../src/lib/wall/templates';

const clock = vi.hoisted(() => ({ now: 0, plan: 0 }));
vi.mock('../src/lib/project', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/lib/project')>();
  return {
    ...m,
    planPrint: (...a: Parameters<typeof m.planPrint>) => {
      clock.now += clock.plan;
      return m.planPrint(...a);
    },
  };
});

const s = () => useStore.getState();

beforeEach(() => {
  s().resetAll();
  history.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  clock.plan = 1000;
});
afterEach(() => {
  vi.restoreAllMocks();
  clock.plan = 0;
});

describe('on a slow machine', () => {
  it('a new board from a template is still one undo step', () => {
    const before = s().drawers.length;
    const t = boardTemplate('print3d')!;
    expect(newBoardFromTemplate(t).added).toBe(t.items.length);
    expect(s().drawers).toHaveLength(before + 1);
    history.undo();
    expect(s().drawers).toHaveLength(before);
    expect(s().drawer.enclosure).toBeUndefined();
    history.redo();
    expect(s().drawer.attachments).toHaveLength(t.items.length);
  });
});
