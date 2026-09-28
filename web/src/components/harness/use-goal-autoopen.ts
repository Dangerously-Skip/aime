'use client';

import { useEffect, useRef } from 'react';
import { useHarnessStatus } from '@/hooks/use-harness-status';

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
 * Reads the SHARED status poll (hooks/use-harness-status) rather than running a
 * 5s poll of its own. `__ideOpenGoal` is idempotent, so re-firing is a focus
 * rather than a duplicate panel — but see below for why it fires only once.
 */
export function useGoalAutoOpen(conversationId: string, workingDir: string | null): void {
  /*
   * Opened at most once per conversation.
   *
   * The old poll re-added the panel every five seconds, so closing it was
   * impossible for as long as a goal existed — the user's close was undone
   * before they let go of the mouse. And while the guard sat only in the
   * effect body, the interval kept calling the opener, which calls
   * `setActive()` on an existing panel: click Chat, get thrown back to Goal
   * five seconds later. The guard is checked on every status update now.
   */
  const opened = useRef<string>('');
  const { status } = useHarnessStatus(conversationId, workingDir);
  const hasGoal = !!status?.goal;

  useEffect(() => {
    if (!hasGoal || !conversationId || !workingDir) return;
    if (opened.current === conversationId) return;
    const open = (window as unknown as Record<string, unknown>).__ideOpenGoal;
    if (typeof open === 'function') {
      opened.current = conversationId;
      (open as () => void)();
    }
  }, [hasGoal, conversationId, workingDir]);
}
