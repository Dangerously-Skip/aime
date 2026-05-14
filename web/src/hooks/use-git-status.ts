'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGitStatus, onFsChange } from '@/lib/code-workspace/ipc';
import type { GitStatus } from '@/lib/code-workspace/types';

/**
 * Wave 2 (Agent B) — git status backend.
 *
 * Polls + debounces. Agent B fills in `getGitStatus` IPC handler in
 * main-web.js; this hook already wires the debounce + watcher.
 */
export function useGitStatus(workspace: string | null) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const next = await getGitStatus(workspace);
      setStatus(next);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // Debounced refresh — never more than once per 500ms during a watcher
  // storm (e.g. `npm install` thrashing node_modules).
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refresh();
    }, 500);
  }, [refresh]);

  useEffect(() => {
    if (!workspace) return;
    refresh();
    const off = onFsChange(() => debouncedRefresh());
    return () => {
      off();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [workspace, refresh, debouncedRefresh]);

  return { status, loading, refresh };
}
