'use client';

import { useCallback, useEffect, useState } from 'react';
import { getGitLog } from '@/lib/code-workspace/ipc';
import type { GitCommit } from '@/lib/code-workspace/types';

/**
 * Wave 2 (Agent C) — git log backend.
 *
 * Returns the recent commits for a workspace (and optionally a file path,
 * for per-file history shown in the history view).
 */
export function useGitLog(workspace: string | null, opts: { path?: string; limit?: number } = {}) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) {
      setCommits([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getGitLog(workspace, { path: opts.path, limit: opts.limit ?? 50 });
      setCommits(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace, opts.path, opts.limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { commits, loading, error, refresh };
}
