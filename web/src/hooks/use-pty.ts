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
  /**
   * Optional unique key to distinguish multiple terminals on the same
   * workspace. Defaults to the workspace path itself (single terminal per
   * folder). Pass a panel id when running multi-terminal.
   */
  sessionKey?: string;
}

export function usePty(workspace: string | null, opts?: UsePtyOptions) {
  // Attachment map key — workspace alone meant 2 terminals on the same
  // folder shared a PTY (visible bug). Compose with the optional
  // sessionKey so each panel gets its own shell.
  const attachKey = workspace ? `${workspace}::${opts?.sessionKey ?? "default"}` : null;
  const [session, setSession] = useState<PtySession | null>(() => {
    if (!attachKey) return null;
    return getAttachment(attachKey)?.session ?? null;
  });
  const [exited, setExited] = useState<{ code: number | null } | null>(null);
  const outputListenerRef = useRef<((data: string) => void) | null>(null);

  useEffect(() => {
    ensureIdleSweeper();
  }, []);

  useEffect(() => {
    if (!workspace || !attachKey) {
      setSession(null);
      return;
    }
    let cancelled = false;
    let cleanupOutput: (() => void) | null = null;
    let cleanupExit: (() => void) | null = null;

    const wire = (active: PtySession) => {
      const buffered = consumePendingOutput(attachKey);
      if (buffered) {
        queueMicrotask(() => outputListenerRef.current?.(buffered));
      }
      cleanupOutput = onPtyOutput((evt) => {
        if (evt.id !== active.id) return;
        const cb = outputListenerRef.current;
        if (cb) {
          cb(evt.data);
        } else {
          appendPendingOutput(attachKey, evt.data);
        }
      });
      cleanupExit = onPtyExit((evt) => {
        if (evt.id !== active.id) return;
        setExited({ code: evt.code });
        clearAttachment(attachKey);
      });
    };

    const existing = getAttachment(attachKey);
    if (existing) {
      setSession(existing.session);
      wire(existing.session);
    } else {
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
        setAttachment(attachKey, s);
        setSession(s);
        wire(s);
      })();
    }

    return () => {
      cancelled = true;
      cleanupOutput?.();
      cleanupExit?.();
    };
  }, [workspace, attachKey, opts?.cols, opts?.rows]);

  useEffect(() => {
    if (!attachKey || opts?.visible === false) return;
    touchVisible(attachKey);
    const id = setInterval(() => touchVisible(attachKey), 30_000);
    return () => clearInterval(id);
  }, [attachKey, opts?.visible]);

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
    if (attachKey) clearAttachment(attachKey);
    setSession(null);
  }, [session, attachKey]);

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
