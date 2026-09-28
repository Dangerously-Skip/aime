// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSelectionListenerScript,
  getSelectionCleanupScript,
  isSelectionClearMessage,
  SELECTION_CLEAR_MESSAGE,
} from './browser-interactions';

/** The selection listener's page globals were `__quarrySelection*`; they are AIME's now. */

type W = Window & Record<string, unknown>;
const w = window as unknown as W;
const run = (code: string) => new Function(`return (${code.trim()})`)();

beforeEach(() => {
  for (const k of ['__aimeSelectionActive', '__aimeSelectionCleanup', '__quarrySelectionActive', '__quarrySelectionCleanup']) delete w[k];
});

describe('selection listener', () => {
  it('installs under the AIME names, once', () => {
    run(getSelectionListenerScript());
    expect(w.__aimeSelectionActive).toBe(true);
    expect(typeof w.__aimeSelectionCleanup).toBe('function');
    expect(w.__quarrySelectionActive).toBeUndefined();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    run(getSelectionListenerScript()); // second injection is a no-op
    document.dispatchEvent(new MouseEvent('mousedown'));
    expect(log.mock.calls.filter(([m]) => m === SELECTION_CLEAR_MESSAGE)).toHaveLength(1);
    log.mockRestore();
    run(getSelectionCleanupScript());
    expect(w.__aimeSelectionActive).toBe(false);
  });

  it('retires a listener injected under the old name', () => {
    const oldCleanup = vi.fn();
    w.__quarrySelectionCleanup = oldCleanup;
    run(getSelectionListenerScript());
    expect(oldCleanup).toHaveBeenCalled();
  });

  it('accepts both the new and the old clear message', () => {
    expect(isSelectionClearMessage('__AIME_SELECTION_CLEAR__')).toBe(true);
    expect(isSelectionClearMessage('__QUARRY_SELECTION_CLEAR__')).toBe(true);
    expect(isSelectionClearMessage('hello')).toBe(false);
  });
});
