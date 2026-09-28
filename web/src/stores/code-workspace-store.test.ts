// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CODE_WORKSPACE_KEY, withLegacyKey, useCodeWorkspaceStore } from './code-workspace-store';

/**
 * The persisted key moved from `quarry:code-workspace` to the product prefix.
 * An upgrade must keep the user's layouts: the old key is READ when the new one
 * is absent, and every write goes to the new key.
 */

beforeEach(() => localStorage.clear());

describe('code-workspace persistence key', () => {
  it('uses the product prefix', () => {
    expect(CODE_WORKSPACE_KEY).toBe('aime:code-workspace');
  });

  it('reads the legacy key when the new one is absent', () => {
    localStorage.setItem('quarry:code-workspace', '{"state":{"byWorkspace":{"/ws":{}}},"version":4}');
    expect(withLegacyKey(localStorage).getItem(CODE_WORKSPACE_KEY)).toContain('/ws');
  });

  it('prefers the new key, and writes only the new key', () => {
    localStorage.setItem('quarry:code-workspace', 'old');
    const s = withLegacyKey(localStorage);
    s.setItem(CODE_WORKSPACE_KEY, 'new');
    expect(s.getItem(CODE_WORKSPACE_KEY)).toBe('new');
    expect(localStorage.getItem('quarry:code-workspace')).toBe('old');
  });

  it('the store rehydrates an old install’s layouts', async () => {
    localStorage.setItem(
      'quarry:code-workspace',
      JSON.stringify({ state: { byWorkspace: { '/legacy': { openTabs: [], activeTabId: null } } }, version: 4 }),
    );
    await useCodeWorkspaceStore.persist.rehydrate();
    expect(Object.keys(useCodeWorkspaceStore.getState().byWorkspace)).toContain('/legacy');
  });
});
