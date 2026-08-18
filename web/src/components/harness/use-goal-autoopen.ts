'use client';

import { useEffect, useRef } from 'react';

/**
 * Open the Code surface's goal panel once a goal exists.
 *
 * The goal panel is a dynamic dockview panel rather than a `PanelSlot`, so it
 * has no entry in the Panels dropdown and nothing would ever open it. That is
 * the right trade — a slot would have reset every user's saved pane arrangement,
 * because the workspace-layout store's `migrate` discards `byWorkspace` — but it
 * does mean discoverability has to come from somewhere, and "it appears when
 * there is something to show" is better than a menu item that is greyed out
 * whenever you are not running a goal.
 *
 * Polls rather than subscribing because the run lives in the server process and
 * outlives any one request; there is no stream to attach to. `__ideOpenGoal` is
 * idempotent, so re-firing is a focus rather than a duplicate panel.
 */
export function useGoalAutoOpen(conversationId: string, workingDir: string | null): void {
  /*
   * Opened at most once per conversation.
   *
   * The poll re-added the panel every five seconds, so closing it was
   * impossible for as long as a goal existed — the user's close was undone
   * before they let go of the mouse.
   */
  const opened = useRef<string>('');

  useEffect(() => {
    if (!workingDir || !conversationId) return;
    if (opened.current === conversationId) return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(
          `/api/harness?conversationId=${encodeURIComponent(conversationId)}&workingDir=${encodeURIComponent(workingDir)}`,
        );
        if (!res.ok || cancelled) return;
        const status = (await res.json()) as { goal?: unknown };
        if (cancelled || !status.goal) return;
        const open = (window as unknown as Record<string, unknown>).__ideOpenGoal;
        if (typeof open === 'function') {
          opened.current = conversationId;
          (open as () => void)();
        }
      } catch {
        // The panel is a convenience; a failed poll is not worth surfacing.
      }
    };

    void check();
    // Slower than the panel's own 2s refresh: this only has to notice that a
    // goal has come into existence, which happens once.
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [conversationId, workingDir]);
}
