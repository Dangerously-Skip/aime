"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useCoworkStore } from "@/stores/cowork-store";
import { useCodeStore } from "@/stores/code-store";
import { useBrowserStore } from "@/stores/browser-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectStore } from "@/stores/project-store";
import { useMemoryStore } from "@/stores/memory-store";
import { useConnectorStore } from "@/stores/connector-store";
import { useCronStore } from "@/stores/cron-store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { openStorageGate } from "@/lib/gated-storage";

// Module-level hydration flag + listener set
let hydrated = false;
const listeners = new Set<() => void>();

function setHydrated() {
  hydrated = true;
  listeners.forEach((l) => l());
}

/** Returns true once all Zustand stores have been rehydrated from localStorage. */
export function useHydrated() {
  const [ready, setReady] = useState(hydrated);
  useEffect(() => {
    // Race guard: rehydration can complete between the useState read above and
    // this effect running, in which case no listener would ever fire.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- required for that race; removing it can leave the app stuck on the loading spinner
    if (hydrated) { setReady(true); return; }
    const cb = () => setReady(true);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return ready;
}

function applyTheme(theme: 'light' | 'dark' | 'system' | 'emma', animate = true) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const isEmma = theme === 'emma';

  const html = document.documentElement;
  if (animate) html.classList.add('transitioning');

  // Remove all theme classes first
  html.classList.remove('dark', 'emma');

  if (isEmma) {
    html.classList.add('emma');
  } else if (isDark) {
    html.classList.add('dark');
  }

  if (animate) setTimeout(() => html.classList.remove('transitioning'), 350);
}

export function StoreHydration({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // The inline <script> in layout.tsx already applied the correct theme class
    // from localStorage before React hydrated. We just need to rehydrate stores
    // and set up the subscriber for subsequent changes.
    //
    // Use Promise.allSettled so one failing store doesn't prevent the rest from
    // loading.  Previously Promise.all meant a single error would leave ALL
    // stores stuck on default values, causing settings (like API keys) to be
    // "lost" — and worse, persisted over the real saved values.
    Promise.allSettled([
      useAppStore.persist.rehydrate(),
      useConversationStore.persist.rehydrate(),
      useChatStore.persist.rehydrate(),
      useCoworkStore.persist.rehydrate(),
      useCodeStore.persist.rehydrate(),
      useBrowserStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
      useProjectStore.persist.rehydrate(),
      useMemoryStore.persist.rehydrate(),
      useConnectorStore.persist.rehydrate(),
      useCronStore.persist.rehydrate(),
      useHeartbeatStore.persist.rehydrate(),
    ]).then((results) => {
      // Log any individual failures
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const names = ['app', 'conversation', 'chat', 'cowork', 'code', 'browser', 'settings', 'project', 'memory', 'connector', 'cron', 'heartbeat'];
          console.error(`[StoreHydration] ${names[i]} store rehydration failed:`, r.reason);
        }
      });

      // Re-apply theme after rehydration without animation to ensure consistency
      const theme = useAppStore.getState().theme;
      applyTheme(theme, false);

      // Open the storage gate so stores can now safely persist changes.
      // Until this point, all setItem calls to localStorage were blocked to
      // prevent default values from overwriting previously saved data.
      openStorageGate();

      setHydrated();
    });

    // Timeout fallback: hydrate with defaults if localStorage read takes too long.
    // Still open the storage gate so the app remains functional.
    setTimeout(() => {
      if (!hydrated) {
        console.warn('[StoreHydration] Timed out waiting for localStorage, using defaults');
        openStorageGate();
        setHydrated();
      }
    }, 3000);

    // Listen for theme changes (user toggling theme in settings)
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.theme !== prev.theme) {
        applyTheme(state.theme);
      }
    });

    // Listen for system preference changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (useAppStore.getState().theme === 'system') {
        applyTheme('system');
      }
    };
    mq.addEventListener('change', handleChange);

    return () => {
      unsub();
      mq.removeEventListener('change', handleChange);
    };
  }, []);

  return <>{children}</>;
}
