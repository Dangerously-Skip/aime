'use client';

import { useState, useEffect, useRef } from 'react';
import { DATA_DIR_NAME } from '@/config/branding';

// Module-level cache so the home dir is resolved once and all hooks
// immediately return a synchronous path on subsequent renders.
let cachedHomeDir: string | null = null;

/**
 * Provides a scratch directory path for Cowork when no user folder is selected.
 * Path: ~/<DATA_DIR_NAME>/scratch/{conversationId}/
 *
 * The path is computed synchronously from a cached homeDir so it's available
 * on the very first render after the initial async lookup. This prevents a
 * race where the first message sends cwd=undefined (temp sandbox) and the
 * second message sends the real scratchDir, breaking session resumption.
 */
export function useScratchDir(conversationId: string): string | null {
  const [scratchDir, setScratchDir] = useState<string | null>(() => {
    if (!conversationId || !cachedHomeDir) return null;
    return `${cachedHomeDir}/${DATA_DIR_NAME}/scratch/${conversationId}`;
  });
  const ensuredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect resolves the path via the Electron homeDir IPC, unavailable during render/SSR
      setScratchDir(null);
      return;
    }

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.getHomeDir) {
      setScratchDir(null);
      return;
    }

    let cancelled = false;

    // If we already have a cached homeDir, compute path synchronously
    if (cachedHomeDir) {
      const path = `${cachedHomeDir}/${DATA_DIR_NAME}/scratch/${conversationId}`;
      setScratchDir(path);
      // Ensure dir exists in the background (fire-and-forget)
      if (ensuredRef.current !== path) {
        ensuredRef.current = path;
        api.ensureDir(path).catch(() => {});
      }
      return;
    }

    // First time: resolve homeDir, cache it, then set path
    api.getHomeDir().then((homeDir) => {
      if (cancelled) return;
      cachedHomeDir = homeDir;
      const path = `${homeDir}/${DATA_DIR_NAME}/scratch/${conversationId}`;
      setScratchDir(path);
      ensuredRef.current = path;
      api.ensureDir(path).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return scratchDir;
}
