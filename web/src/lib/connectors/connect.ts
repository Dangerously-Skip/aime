/**
 * Shared connect orchestrator (P3.2).
 *
 * Connecting a service used to be implemented once, inside the Customize
 * browser. Onboarding could only do the plain oauth2 case, so clicking any of
 * its other featured services called `setOnboardingSkippedAt()` and jumped to
 * Customize — the user asked to connect GitHub and onboarding *ended*. Four of
 * the five featured connectors behaved that way.
 *
 * So the policy — which flow a connector needs, in what order, and what has to
 * be collected first — lives here, with every side effect injected. Any surface
 * can host connecting by supplying its own prompts, which is what makes it
 * possible to connect at the moment of need rather than in a settings screen.
 *
 * Deliberately not a hook: no React, so the decision table is directly testable.
 */
import type { ConnectorDefinition } from './types';

export interface ConnectOutcome {
  status: 'connected' | 'cancelled' | 'unsupported' | 'error';
  /** Present when status is 'connected' and the flow yielded a token. */
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  /** For byoCredentials connectors — persisted so refresh works unattended. */
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthTokenEndpoint?: string;
  /** User-facing message for 'error' / 'unsupported', or a next step for the UI. */
  message?: string;
  /**
   * Set when the service defers authentication to first use (mcp-self-auth):
   * the connector is provisioned but the user signs in later, in chat.
   */
  deferredAuthHint?: string;
}

/**
 * Everything the orchestrator needs from the outside world. A caller that
 * cannot prompt (e.g. an agent-initiated card) may omit the prompts; the
 * orchestrator then reports what it needed instead of hanging.
 */
export interface ConnectDeps {
  /** Ask for a secret (API token, client secret). Return null to cancel. */
  requestSecret?: (
    connector: ConnectorDefinition,
    field: { label: string; placeholder?: string; hint?: string },
  ) => Promise<string | null>;
  /** Ask for a non-secret value (client id, account name, work email). */
  requestText?: (
    connector: ConnectorDefinition,
    field: { label: string; placeholder?: string; hint?: string },
  ) => Promise<string | null>;
  /** Previously stored BYO OAuth app credentials, if any. */
  getStoredOAuthApp?: (connectorId: string) => { clientId: string; clientSecret: string } | null;
  /** The plain OAuth2 browser dance. */
  runOAuth2: (
    connector: ConnectorDefinition,
    byoCreds?: { clientId: string; clientSecret: string },
  ) => Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
  /** The MCP OAuth 2.1 / DCR flow. */
  runMcpOAuth: (
    connectorId: string,
    mcpUrl: string,
    opts: { fallbackClientId?: string; fallbackClientIdEnv?: string },
  ) => Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
  /** Authenticate via ambient cloud credentials. */
  runAwsAuth?: () => Promise<void>;
  /** Resolve `{tenant_id}` / `{account}` style placeholders in an MCP URL. */
  resolveMcpUrl?: (connector: ConnectorDefinition, url: string) => Promise<string | null>;
  /** Clock, injected so expiry maths is testable. */
  now?: () => number;
}

const cancelled: ConnectOutcome = { status: 'cancelled' };

function expiryFrom(expiresIn: number | undefined, now: () => number): number | undefined {
  return expiresIn ? now() + expiresIn * 1000 : undefined;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A user closing the auth window is not a failure worth reporting as one. */
function isCancellation(err: unknown): boolean {
  return /cancel/i.test(describe(err));
}

/**
 * Run the right connect flow for a connector.
 *
 * Never throws: every path resolves to a ConnectOutcome so callers render one
 * consistent result rather than each inventing their own error handling.
 */
export async function connectConnector(
  connector: ConnectorDefinition,
  deps: ConnectDeps,
): Promise<ConnectOutcome> {
  const now = deps.now ?? Date.now;
  const { auth } = connector;

  try {
    switch (auth.type) {
      case 'api_key': {
        if (!deps.requestSecret) {
          return { status: 'unsupported', message: 'This service needs an API token.' };
        }
        const token = await deps.requestSecret(connector, {
          label: 'API token',
          hint: auth.hint,
        });
        if (!token) return cancelled;
        return { status: 'connected', token };
      }

      case 'aws_iam': {
        if (deps.runAwsAuth) await deps.runAwsAuth();
        // The MCP server reads ambient credentials; no token is injected.
        return { status: 'connected', token: '' };
      }

      case 'mcp-self-auth': {
        return {
          status: 'connected',
          token: '',
          deferredAuthHint:
            auth.hint ??
            "Next: open a chat and use this service. You'll be asked to sign in the first time it's needed.",
        };
      }

      case 'mcp-oauth': {
        if (!auth.mcpUrl) {
          return { status: 'unsupported', message: `${connector.name} is missing its MCP URL.` };
        }
        let url = auth.mcpUrl;
        // Some endpoints are tenant- or account-specific and need a value from
        // the user before the URL even exists.
        if (/\{[a-z_]+\}/.test(url)) {
          if (!deps.resolveMcpUrl) {
            return {
              status: 'unsupported',
              message: `${connector.name} needs extra details — connect it from Settings.`,
            };
          }
          const resolved = await deps.resolveMcpUrl(connector, url);
          if (!resolved) return cancelled;
          url = resolved;
        }

        try {
          const r = await deps.runMcpOAuth(connector.id, url, {
            fallbackClientId: auth.fallbackClientId,
            fallbackClientIdEnv: auth.fallbackClientIdEnv,
          });
          return {
            status: 'connected',
            token: r.accessToken,
            refreshToken: r.refreshToken,
            expiresAt: expiryFrom(r.expiresIn, now),
          };
        } catch (err) {
          if (isCancellation(err)) return cancelled;
          // DCR is the zero-config path; when a server doesn't implement it and
          // no client_id is configured, say who can fix it rather than surfacing
          // a protocol error.
          const msg = describe(err);
          if (/Dynamic Client Registration/i.test(msg) && auth.fallbackClientIdEnv) {
            return {
              status: 'error',
              message:
                `${connector.name} needs an app registration from your IT admin ` +
                `(${auth.fallbackClientIdEnv}).`,
            };
          }
          return { status: 'error', message: msg };
        }
      }

      case 'oauth2': {
        let byoCreds: { clientId: string; clientSecret: string } | undefined;
        if (auth.byoCredentials) {
          byoCreds = deps.getStoredOAuthApp?.(connector.id) ?? undefined;
          if (!byoCreds) {
            if (!deps.requestText || !deps.requestSecret) {
              return {
                status: 'unsupported',
                message: `${connector.name} needs your own OAuth app — set it up in Settings.`,
              };
            }
            const clientId = await deps.requestText(connector, {
              label: 'OAuth Client ID',
              hint: auth.hint,
            });
            if (!clientId) return cancelled;
            const clientSecret = await deps.requestSecret(connector, {
              label: 'OAuth Client Secret',
            });
            if (!clientSecret) return cancelled;
            byoCreds = { clientId, clientSecret };
          }
        }

        const r = await deps.runOAuth2(connector, byoCreds);
        return {
          status: 'connected',
          token: r.accessToken,
          refreshToken: r.refreshToken,
          expiresAt: expiryFrom(r.expiresIn, now),
          // Persisted so server-side refresh works without the browser. Only
          // meaningful for BYO apps; the registry supplies the endpoint.
          ...(byoCreds && auth.tokenUrl
            ? {
                oauthClientId: byoCreds.clientId,
                oauthClientSecret: byoCreds.clientSecret,
                oauthTokenEndpoint: auth.tokenUrl,
              }
            : {}),
        };
      }

      default:
        return {
          status: 'unsupported',
          message: `${connector.name} uses an authentication type this build doesn't support.`,
        };
    }
  } catch (err) {
    if (isCancellation(err)) return cancelled;
    return { status: 'error', message: describe(err) };
  }
}
