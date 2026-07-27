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

/**
 * Non-secret markers for flows that produce no credential at all.
 *
 * They are NOT tokens and must never be injected into an MCP entry — the
 * provision route refuses to, because `AWS_PROFILE=aws-iam` names a profile that
 * does not exist and `Authorization: Bearer mcp-self-auth` is a 401 waiting to
 * happen. They exist because the client store's `isAuthenticated()` requires a
 * truthy token, so reporting `token: ''` for a successful connect left
 * `connectorStates[id].authenticated === true` disagreeing with the accessor
 * every badge reads. The Connectors screen has always written exactly these two
 * strings for the same reason; the orchestrator now matches it.
 */
export const AMBIENT_CREDENTIAL_SENTINEL = 'aws-iam';
export const DEFERRED_AUTH_SENTINEL = 'mcp-self-auth';

export interface ConnectOutcome {
  status: 'connected' | 'cancelled' | 'unsupported' | 'error';
  /**
   * Present when status is 'connected'. Either the credential the flow yielded,
   * or one of the sentinels above when the flow yields none.
   */
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
  /**
   * PROVE the machine's ambient cloud credentials are usable.
   *
   * Contract: resolve only when a real check succeeded; REJECT with a
   * user-facing message otherwise. There is no token to validate afterwards —
   * this call is the entire evidence that connecting worked — so an
   * implementation that resolves unconditionally makes the 'connected' outcome a
   * lie. `verifyAwsCredentials` below is the implementation to pass; it runs
   * `aws sts get-caller-identity` server-side.
   */
  runAwsAuth?: () => Promise<void>;
  /** Resolve `{tenant_id}` / `{account}` style placeholders in an MCP URL. */
  resolveMcpUrl?: (connector: ConnectorDefinition, url: string) => Promise<string | null>;
  /** Clock, injected so expiry maths is testable. */
  now?: () => number;
}

const cancelled: ConnectOutcome = { status: 'cancelled' };

/**
 * The `runAwsAuth` implementation every surface should pass.
 *
 * `/api/connectors/aws/auth` runs `aws sts get-caller-identity` through the
 * standard credential chain and answers non-2xx with an actionable message
 * ("Run `aws sso login` or `aws configure`"). Lives here rather than being
 * re-implemented per surface so no caller can accidentally supply a check that
 * always passes — which is precisely how aws_iam came to fail open.
 *
 * Browser-side (it posts to a relative URL); `connectConnector` itself stays
 * transport-free and testable.
 */
export async function verifyAwsCredentials(): Promise<void> {
  const res = await fetch('/api/connectors/aws/auth', { method: 'POST' });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(
    typeof body?.error === 'string' && body.error
      ? body.error
      : 'Could not verify the AWS credentials on this machine. Run `aws sso login` or `aws configure`, then try again.',
  );
}

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
        // Fails CLOSED, like every other flow whose dependency is missing.
        //
        // This used to be `if (deps.runAwsAuth) await …` and then report success
        // regardless — the only optional dep in the table whose absence was
        // ignored. Neither the agent's connect card nor onboarding passes it, so
        // clicking Connect opened no window, checked nothing, and told the paused
        // turn the service was connected. Ambient credentials are the entire
        // mechanism here: with nothing verifying them there is no evidence at all,
        // so there is nothing to report as connected.
        if (!deps.runAwsAuth) {
          return {
            status: 'unsupported',
            message:
              `${connector.name} uses the AWS credentials on this machine, and this ` +
              `screen cannot check them — connect it from Settings.`,
          };
        }
        await deps.runAwsAuth();
        // The MCP server reads ambient credentials; no token is injected. The
        // sentinel is a client-store marker, not a credential.
        return { status: 'connected', token: AMBIENT_CREDENTIAL_SENTINEL };
      }

      case 'mcp-self-auth': {
        return {
          status: 'connected',
          token: DEFERRED_AUTH_SENTINEL,
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
