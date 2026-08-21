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
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      /*
       * THE GUARD HAS TO BE IN HERE, not only in the effect body above.
       *
       * Up there it is evaluated ONCE, when the effect runs. `check` is on a
       * 5s interval, so after the panel opened it kept calling the opener
       * forever — and the opener calls `setActive()` on an existing panel. The
       * result: click Chat, get thrown back to Goal about five seconds later,
       * again and again, with no way to stay on the tab you chose.
       *
       * "Opened at most once per conversation" was the stated intent; this is
       * where it is actually enforced.
       */
      if (opened.current === conversationId) {
        if (timer) clearInterval(timer);
        return;
      }
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
    // goal has come into existence, which happens once — and once it has, the
    // guard in `check` stops the interval rather than leaving it spinning.
    timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [conversationId, workingDir]);
}
