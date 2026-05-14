'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openPty,
  writePty,
  resizePty,
  closePty,
  onPtyOutput,
  onPtyExit,
} from '@/lib/code-workspace/ipc';
import type { PtySession } from '@/lib/code-workspace/types';

/**
 * Wave 2 (Agent D) — terminal backend.
 *
 * Opens a PTY for the given workspace + cwd, exposes input/resize, and
 * fires `onOutput` for each output chunk so the renderer can feed xterm.js.
 *
 * The PTY lives in the Electron main process; this hook is the renderer's
 * client. Agent D fills in the main-side pty manager.
 */
export function usePty(workspace: string | null, opts?: { cols?: number; rows?: number }) {
  const [session, setSession] = useState<PtySession | null>(null);
  const [exited, setExited] = useState<{ code: number | null } | null>(null);
  const outputListenerRef = useRef<((data: string) => void) | null>(null);

  // Open lifecycle
  useEffect(() => {
    if (!workspace) return;
    let mounted = true;
    let cleanupOutput: (() => void) | null = null;
    let cleanupExit: (() => void) | null = null;
    (async () => {
      const s = await openPty({ cwd: workspace, cols: opts?.cols ?? 80, rows: opts?.rows ?? 24 });
      if (!mounted || !s) return;
      setSession(s);
      cleanupOutput = onPtyOutput((evt) => {
        if (evt.id !== s.id) return;
        outputListenerRef.current?.(evt.data);
      });
      cleanupExit = onPtyExit((evt) => {
        if (evt.id !== s.id) return;
        setExited({ code: evt.code });
      });
    })();
    return () => {
      mounted = false;
      cleanupOutput?.();
      cleanupExit?.();
      // Don't close the PTY here — it's tied to the conversation lifecycle
      // and lives until the user closes the conversation explicitly. Agent
      // D wires that into the surface state.
    };
  }, [workspace, opts?.cols, opts?.rows]);

  const write = useCallback(
    async (data: string) => {
      if (!session) return;
      await writePty(session.id, data);
    },
    [session],
  );

  const resize = useCallback(
    async (cols: number, rows: number) => {
      if (!session) return;
      await resizePty(session.id, cols, rows);
    },
    [session],
  );

  const close = useCallback(async () => {
    if (!session) return;
    await closePty(session.id);
  }, [session]);

  /** Wire xterm.js (or any consumer) up to receive PTY output. */
  const onData = useCallback((cb: (data: string) => void) => {
    outputListenerRef.current = cb;
  }, []);

  return { session, exited, write, resize, close, onData };
}
