'use client';

import { useCallback, useEffect, useState } from 'react';
import { walkFs, onFsChange, watchPath, unwatchPath } from '@/lib/code-workspace/ipc';
import type { FsNode } from '@/lib/code-workspace/types';

/**
 * Wave 2 (Agent A) — file-tree backend.
 *
 * Returns the current tree state, an expand-node action, and a refresh.
 * This Wave-1 stub already wires the IPC + watcher lifecycle; Agent A only
 * needs to flesh out tree shape, gitignore handling, and search filters.
 */
export function useFileTree(workspace: string | null) {
  const [nodes, setNodes] = useState<FsNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) {
      setNodes([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await walkFs(workspace, { depth: 1, respectGitignore: true });
      setNodes(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // Initial load + watcher
  useEffect(() => {
    if (!workspace) return;
    let watchId: string | null = null;
    let mounted = true;
    (async () => {
      await refresh();
      const id = await watchPath(workspace);
      if (mounted && id) {
        watchId = id;
      }
    })();
    const off = onFsChange(() => {
      // Debounced refresh — coarse for now; Agent A can refine.
      refresh();
    });
    return () => {
      mounted = false;
      off();
      if (watchId) unwatchPath(watchId);
    };
  }, [workspace, refresh]);

  return { nodes, loading, error, refresh };
}
