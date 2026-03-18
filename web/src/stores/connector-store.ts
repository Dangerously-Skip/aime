'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { ConnectorState } from '@/lib/connectors/types';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';

interface ConnectorStoreState {
  connectorStates: Record<string, ConnectorState>;
  tokens: Record<string, string>;
}

interface ConnectorStoreActions {
  setEnabled: (id: string, enabled: boolean) => void;
  setToken: (id: string, token: string) => void;
  clearToken: (id: string) => void;
  isAuthenticated: (id: string) => boolean;
  getConnectorState: (id: string) => ConnectorState;
  getEnabledConnectorIds: () => string[];
}

export type ConnectorStore = ConnectorStoreState & ConnectorStoreActions;

const defaultConnectorState = (id: string): ConnectorState => ({
  id,
  enabled: false,
  authenticated: false,
  tokenStorageKey: `connector:${id}:token`,
});

const initialState: ConnectorStoreState = {
  connectorStates: Object.fromEntries(
    CONNECTOR_REGISTRY.map((c) => [c.id, defaultConnectorState(c.id)])
  ),
  tokens: {},
};

export const useConnectorStore = create<ConnectorStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setEnabled: (id, enabled) =>
        set((state) => ({
          connectorStates: {
            ...state.connectorStates,
            [id]: {
              ...(state.connectorStates[id] || defaultConnectorState(id)),
              enabled,
            },
          },
        })),

      setToken: (id, token) =>
        set((state) => ({
          tokens: { ...state.tokens, [id]: token },
          connectorStates: {
            ...state.connectorStates,
            [id]: {
              ...(state.connectorStates[id] || defaultConnectorState(id)),
              authenticated: true,
            },
          },
        })),

      clearToken: (id) =>
        set((state) => {
          const { [id]: _, ...remainingTokens } = state.tokens;
          return {
            tokens: remainingTokens,
            connectorStates: {
              ...state.connectorStates,
              [id]: {
                ...(state.connectorStates[id] || defaultConnectorState(id)),
                authenticated: false,
                enabled: false,
              },
            },
          };
        }),

      isAuthenticated: (id) => {
        const state = get();
        return !!state.tokens[id] && !!state.connectorStates[id]?.authenticated;
      },

      getConnectorState: (id) => {
        return get().connectorStates[id] || defaultConnectorState(id);
      },

      getEnabledConnectorIds: () => {
        const { connectorStates } = get();
        return Object.values(connectorStates)
          .filter((s) => s.enabled && s.authenticated)
          .map((s) => s.id);
      },
    }),
    {
      name: 'nibcowork:connectors',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      version: 0,
      partialize: (state) => ({
        connectorStates: state.connectorStates,
        tokens: state.tokens,
      }),
    }
  )
);
