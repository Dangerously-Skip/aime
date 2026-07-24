'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { ProviderConfig, ScannedModel } from '@/lib/models/providers';

/**
 * A user-configured provider plus the models they scanned and kept. Secrets
 * live server-side in the keychain (keyed by `id`); `hasCredentials` is only a
 * UI hint. See .planning/p1-model-registry.md (DR-12).
 */
export interface ConfiguredProvider extends ProviderConfig {
  /** Scanned models the user enabled for this provider. */
  models: ScannedModel[];
  /** UI hint — the actual secret lives in the server-side credential store. */
  hasCredentials?: boolean;
}

interface ProviderState {
  providers: ConfiguredProvider[];
}

interface ProviderActions {
  addProvider: (
    config: Omit<ConfiguredProvider, 'createdAt' | 'models' | 'enabled'> &
      Partial<Pick<ConfiguredProvider, 'models' | 'enabled'>>,
  ) => void;
  updateProvider: (id: string, patch: Partial<ConfiguredProvider>) => void;
  removeProvider: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  /** Replace a provider's scanned/kept model list. */
  setModels: (id: string, models: ScannedModel[]) => void;
  setHasCredentials: (id: string, hasCredentials: boolean) => void;
  getProvider: (id: string) => ConfiguredProvider | undefined;
  /** Enabled models across all enabled providers, tagged with their provider. */
  getEnabledModels: () => Array<ScannedModel & { providerId: string }>;
}

export type ProviderStore = ProviderState & ProviderActions;

export const useProviderStore = create<ProviderStore>()(
  persist(
    (set, get) => ({
      providers: [],

      addProvider: (config) =>
        set((state) => {
          // Upsert by id so re-adding a provider updates rather than duplicates.
          const rest = state.providers.filter((p) => p.id !== config.id);
          return {
            providers: [
              ...rest,
              {
                models: [],
                enabled: true,
                ...config,
                createdAt: Date.now(),
              },
            ],
          };
        }),

      updateProvider: (id, patch) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),

      removeProvider: (id) =>
        set((state) => ({ providers: state.providers.filter((p) => p.id !== id) })),

      setEnabled: (id, enabled) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, enabled } : p)),
        })),

      setModels: (id, models) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, models } : p)),
        })),

      setHasCredentials: (id, hasCredentials) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, hasCredentials } : p)),
        })),

      getProvider: (id) => get().providers.find((p) => p.id === id),

      getEnabledModels: () =>
        get()
          .providers.filter((p) => p.enabled)
          .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.id }))),
    }),
    {
      name: 'aime:providers',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
    },
  ),
);
