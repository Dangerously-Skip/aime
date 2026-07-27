/**
 * How much work is it to connect this service? (P3.2)
 *
 * The catalogue used to list every connector identically, so a user could not
 * tell that clicking "Google Workspace" on a fresh install fails with a 500
 * (no OAuth app configured) while clicking "Atlassian" just works. That is the
 * single biggest reason connecting feels hard: the fast paths and the dead ends
 * look the same until you click.
 *
 * The classification is a function of the connector definition plus which
 * credentials the *server* can see, so it must be computed server-side and
 * shipped to the UI — the renderer has no access to env vars.
 *
 * Pure: env is passed in.
 */
import type { ConnectorDefinition } from './types';
import { OAUTH_CREDENTIALS, OAUTH_CLIENT_ID_ENV } from './credentials';

/**
 * Ordered best-first; the catalogue sorts on this so one-click services surface
 * above ones needing a console visit.
 */
export const EFFORT_ORDER = ['instant', 'paste-token', 'needs-oauth-app', 'needs-config'] as const;
export type ConnectEffort = (typeof EFFORT_ORDER)[number];

export interface Connectability {
  effort: ConnectEffort;
  /** True when the user can complete this from inside the app right now. */
  available: boolean;
  /** Short, user-facing explanation of what connecting involves. */
  detail: string;
  /** For needs-config: the env var whoever packages the app must set. */
  requiresEnv?: string;
}

const EFFORT_RANK: Record<ConnectEffort, number> = Object.fromEntries(
  EFFORT_ORDER.map((e, i) => [e, i]),
) as Record<ConnectEffort, number>;

export function effortRank(effort: ConnectEffort): number {
  return EFFORT_RANK[effort];
}

/**
 * Classify one connector.
 *
 * `env` is injected rather than read from process.env so this is testable and
 * so a caller can ask "what would this look like for a clean install?".
 */
export function classifyConnectability(
  connector: ConnectorDefinition,
  env: Record<string, string | undefined> = process.env,
): Connectability {
  const { auth } = connector;

  switch (auth.type) {
    case 'api_key':
      return {
        effort: 'paste-token',
        available: true,
        detail: 'Paste an API token from the service.',
      };

    case 'aws_iam':
      return {
        effort: 'instant',
        available: true,
        detail: 'Uses the AWS credentials already on this machine.',
      };

    case 'mcp-self-auth':
      return {
        effort: 'instant',
        available: true,
        detail: 'Sign in the first time the agent uses it.',
      };

    case 'mcp-oauth': {
      // Dynamic Client Registration (RFC 7591) means neither we nor the user
      // register anything — the server issues a client on demand. This is the
      // fastest path there is and the one to prefer.
      if (auth.dcr !== 'unsupported') {
        return {
          effort: 'instant',
          available: true,
          detail: 'One click — the service registers this app automatically.',
        };
      }
      // No DCR: something must supply a client_id.
      if (auth.fallbackClientId) {
        return {
          effort: 'instant',
          available: true,
          detail: 'One click — signs in with a published app registration.',
        };
      }
      if (auth.fallbackClientIdEnv) {
        const configured = !!env[auth.fallbackClientIdEnv];
        return configured
          ? {
              effort: 'instant',
              available: true,
              detail: 'One click — signs in with the configured app registration.',
            }
          : {
              effort: 'needs-config',
              available: false,
              detail: `Needs an app registration from your IT admin (${auth.fallbackClientIdEnv}).`,
              requiresEnv: auth.fallbackClientIdEnv,
            };
      }
      return {
        effort: 'needs-config',
        available: false,
        detail: 'This service needs a pre-registered app and none is configured.',
      };
    }

    case 'oauth2': {
      // The user supplies their own OAuth app — works anywhere, but it is a
      // console visit, so it must never outrank a one-click path.
      if (auth.byoCredentials) {
        return {
          effort: 'needs-oauth-app',
          available: true,
          detail: 'Requires creating your own OAuth app in the provider console.',
        };
      }
      // We ship or configure the client. A public client (PKCE, no secret) is
      // baked into the build and needs no env at all; otherwise the client_id
      // comes from the env var declared alongside the credential lookups.
      const creds = OAUTH_CREDENTIALS[connector.id];
      if (creds?.publicClient && creds.clientId) {
        return {
          effort: 'instant',
          available: true,
          detail: 'One click — signs in with a published app registration.',
        };
      }
      const envVar = OAUTH_CLIENT_ID_ENV[connector.id];
      if (envVar ? !!env[envVar] : !!creds?.clientId) {
        return {
          effort: 'instant',
          available: true,
          detail: 'One click — signs in with the configured app registration.',
        };
      }
      return {
        effort: 'needs-config',
        available: false,
        detail: 'Needs OAuth credentials to be configured for this build.',
        ...(envVar ? { requiresEnv: envVar } : {}),
      };
    }

    default:
      return {
        effort: 'needs-config',
        available: false,
        detail: 'Unsupported authentication type.',
      };
  }
}

export interface ClassifiedConnector extends Connectability {
  id: string;
  name: string;
  description: string;
  category: ConnectorDefinition['category'];
  authType: ConnectorDefinition['auth']['type'];
  comingSoon?: boolean;
}

/**
 * Classify a catalogue and order it fast-path-first, alphabetically within a
 * tier so the list is stable between renders.
 */
export function classifyCatalog(
  connectors: ConnectorDefinition[],
  env: Record<string, string | undefined> = process.env,
): ClassifiedConnector[] {
  return connectors
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      authType: c.auth.type,
      ...(c.comingSoon ? { comingSoon: true } : {}),
      ...classifyConnectability(c, env),
    }))
    .sort((a, b) => effortRank(a.effort) - effortRank(b.effort) || a.name.localeCompare(b.name));
}
