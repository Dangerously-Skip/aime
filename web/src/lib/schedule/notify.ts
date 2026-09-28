'use client';

import { useSettingsStore } from '@/stores/settings-store';
import { inQuietHours } from '@/lib/widgets/alerting';

/**
 * A desktop notification from scheduled work — respecting quiet hours.
 *
 * ONE PLACE, because there were two ways to raise one and neither asked the
 * user's quiet hours: standing-order results called `new Notification(...)`
 * directly (and only when the web permission happened to be granted), while the
 * widget digest went through the Electron bridge. Scheduled work is exactly the
 * notification that arrives at 3am, so it is the one that must ask.
 *
 * Returns whether it was delivered, so a caller can fall back to something
 * quieter (the card is always there regardless).
 */
export function notifyDesktop(title: string, body: string, now: Date = new Date()): boolean {
  if (typeof window === 'undefined') return false;
  if (inQuietHours(now, useSettingsStore.getState().quietHours)) return false;

  const bridge = (window as unknown as { electronAPI?: { showNotification?: (t: string, b: string) => unknown } })
    .electronAPI;
  if (bridge?.showNotification) {
    void Promise.resolve(bridge.showNotification(title, body)).catch(() => {});
    return true;
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
    return true;
  }
  return false;
}
