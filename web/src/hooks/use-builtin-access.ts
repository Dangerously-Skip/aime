'use client';

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * Can this install actually reach the built-in Claude models?
 *
 * Three credentials get you there and only one of them lives in the browser:
 *
 *  - the user's key in Settings → API Access (`settings-store.anthropicApiKey`)
 *  - `ANTHROPIC_API_KEY` in the server's env / `.env`
 *  - a configured Bedrock region
 *
 * The last two are server-side, so the client has to ask. `/api/models` reports
 * both as booleans (no key material). Fetched once per session and shared, since
 * every model picker and every surface's send path needs the same answer.
 *
 * Why it matters: the picker offered "Built-in (Claude)" unconditionally, so a
 * BYOK-only user (OpenRouter key, no Anthropic account) was shown three models
 * that could only ever fail, and the selector displayed "Sonnet 4.6" while every
 * turn actually routed to OpenRouter.
 */

interface ServerCredentials {
  /** `ANTHROPIC_API_KEY` present in the server environment. */
  anthropic: boolean;
  bedrock: boolean;
}

interface ServerCredentialsState {
  /** null until the server has answered. */
  server: ServerCredentials | null;
  load: () => Promise<void>;
}

/** Deduped across every mount; cleared on failure so a later mount retries. */
let inflight: Promise<void> | null = null;

export const useServerCredentialsStore = create<ServerCredentialsState>((set) => ({
  server: null,
  load: () => {
    inflight ??= fetch('/api/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        set({ server: { anthropic: !!d?.anthropic, bedrock: !!d?.bedrock } });
      })
      .catch(() => {
        inflight = null;
      });
    return inflight;
  },
}));

/** Test seam: reset the module-level dedupe and the cached answer. */
export function resetServerCredentials(): void {
  inflight = null;
  useServerCredentialsStore.setState({ server: null });
}

export interface BuiltinAccess {
  /** Anthropic reachable — the user's own key, or one in the server env. */
  hasAnthropicKey: boolean;
  hasBedrock: boolean;
  /**
   * Should the picker offer the built-in Claude models?
   *
   * Optimistic while the server answer is outstanding: a developer running with
   * `ANTHROPIC_API_KEY` in `.env` would otherwise watch the built-ins disappear
   * and come back on every boot. The BYOK-only user sees them for the one round
   * trip it takes to find out — and the dropdown is portalled, so the list isn't
   * even built until they open it, by which time the answer has landed.
   */
  hasBuiltins: boolean;
}

export function useBuiltinAccess(): BuiltinAccess {
  const server = useServerCredentialsStore((s) => s.server);
  const load = useServerCredentialsStore((s) => s.load);
  const userKey = useSettingsStore((s) => s.anthropicApiKey);

  useEffect(() => {
    void load();
  }, [load]);

  // Memoised: callers put this in `useCallback`/`useMemo` dependency lists, and a
  // fresh object every render would defeat them. A store rehydrated from an
  // effect keyed on an unstable value is exactly how the renderer once ended up
  // at 100% CPU (see the note in model-selector.tsx).
  return useMemo(() => {
    const hasAnthropicKey = !!userKey || !!server?.anthropic;
    const hasBedrock = !!server?.bedrock;
    return {
      hasAnthropicKey,
      hasBedrock,
      hasBuiltins: server === null || hasAnthropicKey || hasBedrock,
    };
  }, [userKey, server]);
}
