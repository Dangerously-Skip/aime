'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { ConnectorState } from '@/lib/connectors/types';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';

/** Extended token info with refresh capability. */
export interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  /** Unix timestamp (ms) when the access token expires. */
  expiresAt?: number;
}

/** BYO-credentials OAuth app pasted by the user (e.g. Google Personal). */
export interface OAuthClientCreds {
  clientId: string;
  clientSecret: string;
}

interface ConnectorStoreState {
  connectorStates: Record<string, ConnectorState>;
  tokens: Record<string, string>;
  /** Extended token metadata (refresh tokens, expiry). Keyed by connector ID. */
  tokenMeta: Record<string, TokenInfo>;
  /** User-supplied OAuth client credentials for byoCredentials connectors. */
  oauthClientCreds: Record<string, OAuthClientCreds>;
}

interface ConnectorStoreActions {
  setEnabled: (id: string, enabled: boolean) => void;
  setToken: (id: string, token: string) => void;
  setTokenMeta: (id: string, meta: TokenInfo) => void;
  /**
   * Reconciled from the provisioned MCP config: the server holds the credential
   * and the client never sees it. Marks the connector connected and switched on
   * WITHOUT inventing a token — the Connectors screen used to do this with
   * `setToken(id, 'provisioned')`, and re-enabling then POSTed that word back to
   * the server as the credential.
   */
  markProvisioned: (id: string) => void;
  clearToken: (id: string) => void;
  isAuthenticated: (id: string) => boolean;
  getConnectorState: (id: string) => ConnectorState;
  getEnabledConnectorIds: () => string[];
  /** Connected but disabled — mounted MCP servers are filtered by this (P3.5). */
  getDisabledConnectorIds: () => string[];
  getTokenMeta: (id: string) => TokenInfo | undefined;
  setOAuthClientCreds: (id: string, creds: OAuthClientCreds) => void;
  clearOAuthClientCreds: (id: string) => void;
  getOAuthClientCreds: (id: string) => OAuthClientCreds | undefined;
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
  tokenMeta: {},
  oauthClientCreds: {},
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

      setTokenMeta: (id, meta) =>
        set((state) => ({
          tokens: { ...state.tokens, [id]: meta.accessToken },
          tokenMeta: { ...state.tokenMeta, [id]: meta },
          connectorStates: {
            ...state.connectorStates,
            [id]: {
              ...(state.connectorStates[id] || defaultConnectorState(id)),
              authenticated: true,
            },
          },
        })),

      markProvisioned: (id) =>
        set((state) => ({
          connectorStates: {
            ...state.connectorStates,
            [id]: {
              ...(state.connectorStates[id] || defaultConnectorState(id)),
              authenticated: true,
              enabled: true,
            },
          },
        })),

      clearToken: (id) =>
        set((state) => {
          const { [id]: _, ...remainingTokens } = state.tokens;
          const { [id]: _m, ...remainingMeta } = state.tokenMeta;
          return {
            tokens: remainingTokens,
            tokenMeta: remainingMeta,
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

      /**
       * `connectorStates[id].authenticated` is the single answer.
       *
       * This used to also require a truthy `tokens[id]`, which left the store
       * disagreeing with itself: every badge, every row in the Connectors screen
       * and both derived id sets read the flag, while this accessor added a
       * condition they do not. Plenty of legitimately-connected services leave no
       * token in the browser — ambient AWS IAM credentials, an MCP that signs
       * itself in on first use, anything reconciled from the provisioned config
       * where the credential never leaves the server — so requiring one reported
       * them disconnected here and connected everywhere else. Whether we happen to
       * hold a copy of the credential is a different question from whether the
       * service is connected.
       */
      isAuthenticated: (id) => !!get().connectorStates[id]?.authenticated,

      getConnectorState: (id) => {
        return get().connectorStates[id] || defaultConnectorState(id);
      },

      getEnabledConnectorIds: () => {
        const { connectorStates } = get();
        return Object.values(connectorStates)
          .filter((s) => s.enabled && s.authenticated)
          .map((s) => s.id);
      },

      /**
       * Connected but switched OFF — the deny list sent with each chat request so
       * their MCP servers are not mounted (P3.5). Until this was wired, the
       * enable/disable toggle had no effect on anything.
       */
      getDisabledConnectorIds: () => {
        const { connectorStates } = get();
        return Object.values(connectorStates)
          .filter((s) => s.authenticated && !s.enabled)
          .map((s) => s.id);
      },

      getTokenMeta: (id) => get().tokenMeta[id],

      setOAuthClientCreds: (id, creds) =>
        set((state) => ({
          oauthClientCreds: { ...state.oauthClientCreds, [id]: creds },
        })),

      clearOAuthClientCreds: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.oauthClientCreds;
          return { oauthClientCreds: rest };
        }),

      getOAuthClientCreds: (id) => get().oauthClientCreds[id],
    }),
    {
      name: 'aime:connectors',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      version: 0,
      partialize: (state) => ({
        connectorStates: state.connectorStates,
        tokens: state.tokens,
        tokenMeta: state.tokenMeta,
        oauthClientCreds: state.oauthClientCreds,
      }),
    }
  )
);
