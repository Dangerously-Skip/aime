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
import {
  getAttachment,
  setAttachment,
  appendPendingOutput,
  consumePendingOutput,
  touchVisible,
  clearAttachment,
  listAttachments,
} from '@/lib/code-workspace/pty-client';
import type { PtySession } from '@/lib/code-workspace/types';

/**
 * Renderer-side hook for a single workspace PTY.
 *
 * Phase 4 (Agent D). The PTY itself lives in the Electron main process; this
 * hook is the renderer client. It keeps the PTY alive across mount/unmount
 * cycles by parking the session in `pty-client`'s per-workspace map.
 *
 * Idle cleanup: a module-level sweeper closes PTYs whose terminal hasn't been
 * user-visible for IDLE_TTL_MS. The first hook instance starts the sweeper;
 * it stays armed across the process lifetime.
 */

/** Close PTYs that haven't had a visible terminal in this long. */
const IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** How often the sweeper checks. */
const SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute

let sweeperStarted = false;
function ensureIdleSweeper() {
  if (sweeperStarted || typeof window === 'undefined') return;
  sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const { workspace, attachment } of listAttachments()) {
      if (now - attachment.lastVisibleAt > IDLE_TTL_MS) {
        // Fire-and-forget close. Renderer doesn't await.
        closePty(attachment.session.id).catch(() => {});
        clearAttachment(workspace);
      }
    }
  }, SWEEP_INTERVAL_MS);
}

interface UsePtyOptions {
  cols?: number;
  rows?: number;
  /**
   * Whether the consuming component is currently visible. Used to update the
   * "last visible" stamp that drives idle cleanup. Defaults to true.
   */
  visible?: boolean;
}

export function usePty(workspace: string | null, opts?: UsePtyOptions) {
  const [session, setSession] = useState<PtySession | null>(() => {
    if (!workspace) return null;
    return getAttachment(workspace)?.session ?? null;
  });
  const [exited, setExited] = useState<{ code: number | null } | null>(null);
  const outputListenerRef = useRef<((data: string) => void) | null>(null);

  // Run the idle sweeper exactly once per renderer.
  useEffect(() => {
    ensureIdleSweeper();
  }, []);

  // Open / re-attach on workspace change.
  useEffect(() => {
    if (!workspace) {
      setSession(null);
      return;
    }
    let cancelled = false;
    let cleanupOutput: (() => void) | null = null;
    let cleanupExit: (() => void) | null = null;

    const wire = (active: PtySession) => {
      // Output: flush any buffered output that arrived while the panel was
      // unmounted, then feed live frames through.
      const buffered = consumePendingOutput(workspace);
      if (buffered) {
        // Defer to next tick so the consumer has a chance to register onData.
        queueMicrotask(() => outputListenerRef.current?.(buffered));
      }
      cleanupOutput = onPtyOutput((evt) => {
        if (evt.id !== active.id) return;
        const cb = outputListenerRef.current;
        if (cb) {
          cb(evt.data);
        } else {
          // No consumer attached right now — buffer it for the next mount.
          appendPendingOutput(workspace, evt.data);
        }
      });
      cleanupExit = onPtyExit((evt) => {
        if (evt.id !== active.id) return;
        setExited({ code: evt.code });
        clearAttachment(workspace);
      });
    };

    const existing = getAttachment(workspace);
    if (existing) {
      // Re-attach — PTY survived the unmount.
      setSession(existing.session);
      wire(existing.session);
    } else {
      // Open a brand-new PTY for this workspace.
      (async () => {
        const s = await openPty({
          cwd: workspace,
          cols: opts?.cols ?? 80,
          rows: opts?.rows ?? 24,
        });
        if (cancelled) {
          if (s) closePty(s.id).catch(() => {});
          return;
        }
        if (!s) return;
        setAttachment(workspace, s);
        setSession(s);
        wire(s);
      })();
    }

    return () => {
      cancelled = true;
      cleanupOutput?.();
      cleanupExit?.();
      // DO NOT close the PTY here — it's parked per-workspace so the user can
      // toggle the terminal panel off/on without losing their shell state.
      // Idle cleanup + explicit `close()` are the only paths that kill it.
    };
  }, [workspace, opts?.cols, opts?.rows]);

  // Keep the last-visible stamp fresh while this hook is mounted + visible.
  useEffect(() => {
    if (!workspace || opts?.visible === false) return;
    touchVisible(workspace);
    const id = setInterval(() => touchVisible(workspace), 30_000);
    return () => clearInterval(id);
  }, [workspace, opts?.visible]);

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
    if (workspace) clearAttachment(workspace);
    setSession(null);
  }, [session, workspace]);

  /**
   * Register an output sink. Called by the xterm.js wrapper once the terminal
   * instance exists. Replaces any previous sink — there's only one terminal
   * per workspace in v1.
   */
  const onData = useCallback((cb: (data: string) => void) => {
    outputListenerRef.current = cb;
  }, []);

  return { session, exited, write, resize, close, onData };
}
