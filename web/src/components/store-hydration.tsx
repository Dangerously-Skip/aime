"use client";

import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useCoworkStore } from "@/stores/cowork-store";
import { useCodeStore } from "@/stores/code-store";
import { useBrowserStore } from "@/stores/browser-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectStore } from "@/stores/project-store";

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const html = document.documentElement;
  html.classList.add('transitioning');
  if (isDark) {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  // Remove transition class after animation
  setTimeout(() => html.classList.remove('transitioning'), 350);
}

export function StoreHydration({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useAppStore.persist.rehydrate();
    useConversationStore.persist.rehydrate();
    useChatStore.persist.rehydrate();
    useCoworkStore.persist.rehydrate();
    useCodeStore.persist.rehydrate();
    useBrowserStore.persist.rehydrate();
    useSettingsStore.persist.rehydrate();
    useProjectStore.persist.rehydrate();

    // Apply theme after hydration
    const theme = useAppStore.getState().theme;
    applyTheme(theme);

    // Listen for theme changes
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
