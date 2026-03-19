'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { CONNECTOR_MAP } from '@/lib/connectors/registry';

declare global {
  interface Window {
    electronAPI?: {
      onMinuteTick?: (callback: (ts: number) => void) => void;
    };
  }
}

function connectorNames(ids: string[]): string {
  return ids.map((id) => CONNECTOR_MAP[id]?.name).filter(Boolean).join(', ');
}

function buildMorningPrompt(connectors: string[]): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const names = connectorNames(connectors);
  let prompt = `Good morning! It's ${day}. Please give me a concise morning briefing.`;
  if (names) {
    prompt += ` Pull relevant information from: ${names}. Focus on open items assigned to me, anything time-sensitive today, and key updates since yesterday.`;
  }
  prompt += ` Bullet points only, under 200 words.`;
  return prompt;
}

function buildEveningPrompt(connectors: string[]): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const names = connectorNames(connectors);
  let prompt = `It's end of ${day}. Please give me a brief end-of-day wrap-up.`;
  if (names) {
    prompt += ` Check ${names} for what was completed today, anything left open, and items to prioritize tomorrow.`;
  }
  prompt += ` Bullet points only, under 150 words.`;
  return prompt;
}

function buildIdlePrompt(): string {
  return `Just checking in — you've been quiet for a while. Anything you'd like to pick up, or is there something I should flag?`;
}

/**
 * Mode-aware heartbeat hook. Fires at configured times (morning/evening)
 * or after a period of user inactivity (idle nudge).
 *
 * Returns `resetIdleTimer` — call this whenever the user sends a message
 * to reset the idle counter.
 */
export function useHeartbeat(
  onFire: (prompt: string) => void
): { resetIdleTimer: () => void } {
  const heartbeatModes = useSettingsStore((s) => s.heartbeatModes);

  // Tracks which day-scoped modes have already fired (e.g. 'morning:Thu Mar 20 2026')
  const firedRef = useRef<Set<string>>(new Set());
  // Minutes since last user activity for idle nudge
  const idleMinutesRef = useRef(0);

  const resetIdleTimer = useCallback(() => {
    idleMinutesRef.current = 0;
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = (_ts: number) => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const dateKey = now.toDateString();

      const { morning, evening, idle } = heartbeatModes;

      // Morning briefing — fires once at configured time each day
      if (morning.enabled && morning.time === hhmm) {
        const key = `morning:${dateKey}`;
        if (!firedRef.current.has(key)) {
          firedRef.current.add(key);
          onFire(buildMorningPrompt(morning.connectors));
        }
      }

      // Evening wrap-up — fires once at configured time each day
      if (evening.enabled && evening.time === hhmm) {
        const key = `evening:${dateKey}`;
        if (!firedRef.current.has(key)) {
          firedRef.current.add(key);
          onFire(buildEveningPrompt(evening.connectors));
        }
      }

      // Idle nudge — fires after N minutes of no user activity
      if (idle.enabled && idle.idleMinutes > 0) {
        idleMinutesRef.current += 1;
        if (idleMinutesRef.current >= idle.idleMinutes) {
          idleMinutesRef.current = 0;
          onFire(buildIdlePrompt());
        }
      } else {
        idleMinutesRef.current = 0;
      }
    };

    api.onMinuteTick(handler);
    // Note: Electron ipcRenderer.on accumulates listeners; acceptable for a singleton hook.
  }, [heartbeatModes, onFire]);

  return { resetIdleTimer };
}
