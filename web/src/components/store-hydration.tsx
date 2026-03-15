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
    if (hydrated) { setReady(true); return; }
    const cb = () => setReady(true);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return ready;
}

function applyTheme(theme: 'light' | 'dark' | 'system', animate = true) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const html = document.documentElement;
  if (animate) html.classList.add('transitioning');
  if (isDark) {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  if (animate) setTimeout(() => html.classList.remove('transitioning'), 350);
}

export function StoreHydration({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // The inline <script> in layout.tsx already applied the correct theme class
    // from localStorage before React hydrated. We just need to rehydrate stores
    // and set up the subscriber for subsequent changes.
    Promise.all([
      useAppStore.persist.rehydrate(),
      useConversationStore.persist.rehydrate(),
      useChatStore.persist.rehydrate(),
      useCoworkStore.persist.rehydrate(),
      useCodeStore.persist.rehydrate(),
      useBrowserStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
      useProjectStore.persist.rehydrate(),
      useMemoryStore.persist.rehydrate(),
    ]).then(() => {
      // Re-apply theme after rehydration without animation to ensure consistency
      const theme = useAppStore.getState().theme;
      applyTheme(theme, false);
      setHydrated();
    }).catch((err) => {
      console.error('[StoreHydration] Rehydration error:', err);
      setHydrated(); // proceed with defaults
    });

    // Timeout fallback: hydrate with defaults if localStorage read takes too long
    // Kept independent of the promise chain so it's a true safety net
    setTimeout(() => {
      if (!hydrated) {
        console.warn('[StoreHydration] Timed out waiting for localStorage, using defaults');
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
