'use client';

import { useState, useEffect } from 'react';

/**
 * Provides a scratch directory path for Cowork when no user folder is selected.
 * Path: ~/.tricoder/scratch/{conversationId}/
 * Returns null if not in Electron or not ready.
 */
export function useScratchDir(conversationId: string): string | null {
  const [scratchDir, setScratchDir] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setScratchDir(null);
      return;
    }

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.getHomeDir) {
      setScratchDir(null);
      return;
    }

    let cancelled = false;

    api.getHomeDir().then((homeDir) => {
      if (cancelled) return;
      const path = `${homeDir}/.tricoder/scratch/${conversationId}`;
      // Ensure the directory exists
      api.ensureDir(path).then(() => {
        if (!cancelled) setScratchDir(path);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return scratchDir;
}
