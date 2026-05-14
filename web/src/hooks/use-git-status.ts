'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGitStatus, onFsChange } from '@/lib/code-workspace/ipc';
import type { GitStatus } from '@/lib/code-workspace/types';

/**
 * Wave 2 (Agent B) — git status hook.
 *
 * Polls + debounces `git:status` from the main process. The watcher (Agent A)
 * fires per-file change events; we coalesce them into a single refresh
 * every ≥500ms so we don't thrash git on noisy events (e.g. `npm install`
 * blowing up node_modules).
 *
 * `baseRef` is reserved for Phase 3 (Agent C will wire the base-branch
 * picker). When provided it's forwarded to the IPC handler as a hint —
 * the main side decides whether to compute ahead/behind against it.
 */
export function useGitStatus(
  workspace: string | null,
  opts?: { baseRef?: string | null },
) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recent request so a slow earlier response doesn't
  // overwrite a faster newer one (e.g. a long-running `git status` on a
  // monorepo finishing after a follow-up trigger).
  const reqIdRef = useRef(0);

  const baseRef = opts?.baseRef ?? null;

  const refresh = useCallback(async () => {
    if (!workspace) {
      setStatus(null);
      setError(null);
      return;
    }
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const next = await getGitStatus(workspace);
      // Stale-response guard
      if (myReqId !== reqIdRef.current) return;
      setStatus(next);
      setError(null);
    } catch (e) {
      if (myReqId !== reqIdRef.current) return;
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false);
    }
    // `baseRef` is in the dep list for future use — Agent C will pass it
    // through to the IPC handler.
  }, [workspace, baseRef]);

  // Debounced refresh — never more than once per 500ms during a watcher
  // storm (e.g. `npm install` thrashing node_modules).
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refresh();
    }, 500);
  }, [refresh]);

  useEffect(() => {
    if (!workspace) {
      setStatus(null);
      setError(null);
      return;
    }
    refresh();
    const off = onFsChange(() => debouncedRefresh());
    return () => {
      off();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [workspace, refresh, debouncedRefresh]);

  return { status, loading, error, refresh };
}
