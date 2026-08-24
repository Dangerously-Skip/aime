"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useCoworkStore } from "@/stores/cowork-store";
import { useCodeStore } from "@/stores/code-store";
import { useBrowserStore } from "@/stores/browser-store";
import { THEME_CLASSES, themeSpec, type ThemeId } from '@/lib/themes/app-themes';
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectStore } from "@/stores/project-store";
import { useProviderStore } from "@/stores/provider-store";
import { useMemoryStore } from "@/stores/memory-store";
import { useConnectorStore } from "@/stores/connector-store";
import { openStorageGate } from "@/lib/gated-storage";
import { isHydrationApplying } from "@/lib/hydration-signal";

/**
 * Two flags, not one, and the difference is the whole point.
 *
 * `hydrated` means "the UI may render". `rehydrated` means "the persisted data
 * actually arrived". They diverge on the timeout path below, and conflating them
 * caused two user-visible bugs at once:
 *
 *   - The onboarding wizard reappeared for a user who had completed it, because
 *     `onboardingComplete` was still at its default when the page rendered.
 *   - Worse, the timeout also opened the storage gate. That gate exists for the
 *     single purpose of stopping default values from being written over saved
 *     ones (see `lib/gated-storage.ts`), so opening it before the read finished
 *     defeated it exactly when it was needed: the next settings change persisted
 *     a defaults-shaped payload over the real one. API keys included.
 *
 * So the gate is now opened in ONE place — when rehydration genuinely resolves.
 * A slow read can still render the app; it can no longer destroy anything.
 */
let hydrated = false;
let rehydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function setHydrated() {
  hydrated = true;
  notify();
}

/** Subscribe to the module-level flags. Shared by both hooks below. */
function useHydrationFlag(read: () => boolean) {
  const [ready, setReady] = useState(read);
  useEffect(() => {
    // Race guard: rehydration can complete between the useState read above and
    // this effect running, in which case no listener would ever fire.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- required for that race; removing it can leave the app stuck on the loading spinner
    if (read()) { setReady(true); return; }
    const cb = () => { if (read()) setReady(true); };
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, [read]);
  return ready;
}

/** True once the app may render — including the defaults-only timeout path. */
export function useHydrated() {
  return useHydrationFlag(() => hydrated);
}

/**
 * True only when persisted state actually loaded.
 *
 * Anything that would be WRONG rather than merely unstyled when read from
 * defaults must wait for this, not `useHydrated`. The onboarding wizard is the
 * motivating case: `onboardingComplete: false` is indistinguishable from "this
 * user is new", so rendering it early tells a returning user to introduce
 * themselves again.
 */
export function useRehydrated() {
  return useHydrationFlag(() => rehydrated);
}

/**
 * Put the right class on <html>.
 *
 * Driven by the THEMES table rather than a chain of `theme === '...'` checks:
 * the branch version needed editing in four places to add a theme, and one of
 * those places (the diff viewer) had already drifted into calling the light
 * pink theme dark.
 */
function applyTheme(theme: ThemeId, animate = true) {
  const spec = themeSpec(theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const html = document.documentElement;
  if (animate) html.classList.add('transitioning');

  // Strip every theme class before adding one, so switching never leaves two on.
  html.classList.remove(...THEME_CLASSES);

  if (spec.className) html.classList.add(spec.className);
  // `system` owns no class of its own; it borrows dark's when the OS is dark.
  else if (spec.dark === 'auto' && prefersDark) html.classList.add('dark');

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
    /**
     * Edits the user makes before the slow read lands, so it cannot revert them.
     *
     * This is the half that neither gate timing could fix. If rehydration is
     * slow and the user acts in that window, the read eventually resolves
     * carrying its PRE-EDIT snapshot and zustand applies it — reverting what
     * they just did. That is the "click Get started, nothing happens" report:
     * the wizard sets `onboardingComplete`, the stale read unsets it, and every
     * retry loses the same race.
     *
     * The old code hid this by opening the storage gate on timeout, so the edit
     * was written to storage and the late read happened to find it. That worked
     * and cost the profile: an open gate before hydration is exactly what lets
     * default state overwrite saved state. Recording the edits here fixes the
     * revert without needing the gate open, so the two concerns stop trading
     * against each other.
     */
    const dirty: Record<string, unknown> = {};
    const trackEdits = useSettingsStore.subscribe((state, prev) => {
      // Ignore the rehydrate's own write. Without this the stale persisted
      // value is recorded as a user edit and then restored over the fresh one.
      if (rehydrated || isHydrationApplying()) return;
      for (const [k, v] of Object.entries(state)) {
        if (typeof v !== 'function' && v !== (prev as unknown as Record<string, unknown>)[k]) {
          dirty[k] = v;
        }
      }
    });

    Promise.allSettled([
      useAppStore.persist.rehydrate(),
      useConversationStore.persist.rehydrate(),
      useChatStore.persist.rehydrate(),
      useCoworkStore.persist.rehydrate(),
      useCodeStore.persist.rehydrate(),
      useBrowserStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
      useProjectStore.persist.rehydrate(),
      useProviderStore.persist.rehydrate(),
      useMemoryStore.persist.rehydrate(),
      useConnectorStore.persist.rehydrate(),
    ]).then((results) => {
      // Log any individual failures
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const names = ['app', 'conversation', 'chat', 'cowork', 'code', 'browser', 'settings', 'project', 'provider', 'memory', 'connector', 'cron', 'heartbeat'];
          console.error(`[StoreHydration] ${names[i]} store rehydration failed:`, r.reason);
        }
      });

      // Re-apply theme after rehydration without animation to ensure consistency
      const theme = useAppStore.getState().theme;
      applyTheme(theme, false);

      // The ONLY place the gate opens. Reaching here means the reads finished,
      // so what gets persisted from now on is real state rather than defaults.
      rehydrated = true;
      trackEdits();

      /*
       * The gate opens FIRST, then the replay — the other order swallowed it.
       *
       * zustand's persist middleware writes synchronously inside `setState`, so
       * a `setState` made while the gate is still shut hits a `setItem` that
       * drops it on the floor. The value was restored in memory and never
       * reached disk, so the very case this block exists for — onboarding
       * completed during a slow (>15s) rehydrate, which renders from defaults —
       * came back to the wizard on the next launch, having looked fine all
       * session.
       */
      openStorageGate();

      // Re-apply anything the user changed while the read was in flight. The
      // persisted snapshot predates those edits, so without this the newer
      // value loses to the older one.
      if (Object.keys(dirty).length > 0) {
        useSettingsStore.setState(dirty as Partial<ReturnType<typeof useSettingsStore.getState>>);
      }

      setHydrated();
    });

    /**
     * Render-anyway fallback, so a slow disk cannot leave the user on a spinner
     * forever.
     *
     * It deliberately does NOT open the storage gate. Rendering from defaults is
     * recoverable — the real values land a moment later and the UI updates.
     * WRITING from defaults is not: it overwrites the saved payload, and the
     * saved payload is where the API keys and the whole conversation list live.
     * Given the choice between a stale-looking screen and a destroyed profile,
     * this takes the stale screen.
     *
     * 3s was too tight to be a "something is wrong" signal and fired routinely
     * on a cold start — a dev-mode first compile with thirteen stores reading a
     * 300KB store is comfortably past it, which is why this reproduced as "why
     * am I in onboarding again". 15s is long enough that firing means a real
     * fault.
     */
    const timer = setTimeout(() => {
      if (!hydrated) {
        console.warn(
          '[StoreHydration] localStorage read exceeded 15s — rendering from defaults. ' +
            'Writes stay blocked until the real state arrives, so nothing will be overwritten.',
        );
        setHydrated();
      }
    }, 15_000);

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
      clearTimeout(timer);
      trackEdits();
      unsub();
      mq.removeEventListener('change', handleChange);
    };
  }, []);

  return <>{children}</>;
}
