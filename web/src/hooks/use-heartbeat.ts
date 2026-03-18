'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settings-store';

declare global {
  interface Window {
    electronAPI?: {
      onMinuteTick?: (callback: (ts: number) => void) => void;
    };
  }
}

/**
 * Subscribes to minute:tick IPC events and fires a heartbeat agent run
 * on the configured interval when heartbeat is enabled.
 *
 * Call this once in the root layout or a top-level client component.
 */
export function useHeartbeat(
  onFire: (prompt: string) => void
) {
  const heartbeatEnabled = useSettingsStore((s) => s.heartbeatEnabled);
  const heartbeatIntervalMinutes = useSettingsStore((s) => s.heartbeatIntervalMinutes);

  // Track elapsed minutes since last heartbeat
  const minutesSinceLastRef = useRef(0);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = (_ts: number) => {
      if (!heartbeatEnabled) {
        minutesSinceLastRef.current = 0;
        return;
      }
      minutesSinceLastRef.current += 1;
      if (minutesSinceLastRef.current >= heartbeatIntervalMinutes) {
        minutesSinceLastRef.current = 0;
        onFire(
          'Check for anything worth noting, review pending tasks, and surface any proactive insights you have.'
        );
      }
    };

    api.onMinuteTick(handler);
    // Note: Electron ipcRenderer.on accumulates listeners; this is acceptable
    // for a singleton hook mounted once.
  }, [heartbeatEnabled, heartbeatIntervalMinutes, onFire]);
}
