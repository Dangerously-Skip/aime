'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settings-store';

interface UseSessionResetOptions {
  chatId: string | null;
  lastActivityAt: number | null;
  onReset: () => void;
}

/**
 * Implements session reset policies (manual/daily/idle).
 * Fires onReset when the policy conditions are met.
 */
export function useSessionReset({ chatId, lastActivityAt, onReset }: UseSessionResetOptions) {
  const sessionResetMode = useSettingsStore((s) => s.sessionResetMode);
  const sessionResetTime = useSettingsStore((s) => s.sessionResetTime);
  const sessionIdleMinutes = useSettingsStore((s) => s.sessionIdleMinutes);
  const hasResetRef = useRef(false);

  useEffect(() => {
    if (!chatId || sessionResetMode === 'manual') return;

    hasResetRef.current = false;

    const check = () => {
      if (hasResetRef.current) return;

      if (sessionResetMode === 'idle' && lastActivityAt) {
        const idleMs = sessionIdleMinutes * 60 * 1000;
        if (Date.now() - lastActivityAt > idleMs) {
          hasResetRef.current = true;
          console.log('[SessionReset] Idle threshold exceeded — resetting session');
          onReset();
        }
      }

      if (sessionResetMode === 'daily' && lastActivityAt) {
        // Check if the daily reset time has passed since last activity
        const [hours, minutes] = sessionResetTime.split(':').map(Number);
        const now = new Date();
        const resetToday = new Date();
        resetToday.setHours(hours, minutes, 0, 0);

        // If last activity was before today's reset time, reset
        if (lastActivityAt < resetToday.getTime() && now > resetToday) {
          hasResetRef.current = true;
          console.log('[SessionReset] Daily reset time passed — resetting session');
          onReset();
        }
      }
    };

    // Check on focus (app regains focus)
    window.addEventListener('focus', check);
    // Also check immediately
    check();

    return () => {
      window.removeEventListener('focus', check);
    };
  }, [chatId, sessionResetMode, sessionResetTime, sessionIdleMinutes, lastActivityAt, onReset]);
}
