// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

const h = vi.hoisted(() => ({ rehydrated: false, pull: vi.fn(async () => 0) }));
vi.mock('@/components/store-hydration', () => ({ useRehydrated: () => h.rehydrated }));
vi.mock('@/lib/memory/pending-pull', () => ({ pullPendingMemories: h.pull }));

import { usePendingMemoryPull } from './use-pending-memory-pull';

beforeEach(() => {
  h.rehydrated = false;
  h.pull.mockClear();
});

describe('usePendingMemoryPull', () => {
  it('pulls once the persisted stores have loaded, and only once per launch', () => {
    const { rerender } = renderHook(() => usePendingMemoryPull());
    expect(h.pull).not.toHaveBeenCalled();

    h.rehydrated = true;
    rerender();
    expect(h.pull).toHaveBeenCalledTimes(1);
    // On start: nothing to wait for, so no wait.
    expect(h.pull).toHaveBeenCalledWith();

    rerender();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('is mounted in the shell, where it runs whatever surface is open', () => {
    // Wired-and-unreachable is this codebase's signature failure; check the call site.
    const src = fs.readFileSync(path.join(__dirname, '../components/layout/schedulers.tsx'), 'utf8');
    expect(src).toMatch(/\busePendingMemoryPull\(\)/);
  });
});
