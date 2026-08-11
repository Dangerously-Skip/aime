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
 * Every documented way an AWS credential reaches a process without anyone typing
 * anything into this app: static keys, a named profile, web identity (EKS/IRSA),
 * the ECS/EKS container credential providers, and an explicitly relocated shared
 * config or credentials file.
 *
 * NOT covered, and deliberately: the DEFAULT `~/.aws/{credentials,config}`
 * locations. Detecting those means touching the filesystem, which this module
 * must not do, so their absence from the env is treated as "unproven" rather than
 * "absent" — see the aws_iam branch.
 */
const AWS_CREDENTIAL_ENV_VARS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_SESSION_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
] as const;

function hasAwsCredentialEnv(env: Record<string, string | undefined>): boolean {
  // Set-but-empty is how a shell exports a variable it never assigned; treating
  // that as a credential would put us straight back to promising one click.
  return AWS_CREDENTIAL_ENV_VARS.some((name) => !!env[name]);
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

    /**
     * An Apple ID plus an app-specific password, over IMAP/CalDAV/CardDAV.
     *
     * Added to `types.ts` and `registry.ts` and not here, so it fell to
     * `default` → "Unsupported authentication type", and that string is not
     * cosmetic: `classifyCatalog` feeds `buildConnectorsPrompt`, which put
     * iCloud in the UNAVAILABLE bucket and told the model
     *
     *     NOT available in this installation — never offer to connect these:
     *       - iCloud — Unsupported authentication type.
     *
     * directly contradicting the `icloudConnected` block a few lines above it
     * when connected, and suppressing the offer entirely when not. Which is the
     * same "the model recommends Microsoft 365 instead" failure the connector
     * work was done to fix.
     *
     * `available` unconditionally, unlike the OAuth cases: nothing has to be
     * configured in the build for this to work. The user makes the password at
     * appleid.apple.com and pastes it, so the only thing that can be missing is
     * the user's own action, which is what `paste-token` effort means.
     */
    case 'app-password':
      return {
        effort: 'paste-token',
        available: true,
        detail: 'Sign in with your Apple ID and an app-specific password.',
      };

    case 'aws_iam':
      // "Instant" only if the credentials it depends on actually exist. The old
      // verdict was unconditional, so the chat prompt advertised AWS as one click
      // away on a laptop that had never run `aws configure` — and the connect
      // flow then reported success without checking, which is how a promise the
      // catalogue makes becomes a lie the agent repeats.
      if (hasAwsCredentialEnv(env)) {
        return {
          effort: 'instant',
          available: true,
          detail: 'Uses the AWS credentials already on this machine.',
        };
      }
      // Nothing in the environment. A profile in ~/.aws may still exist — only
      // `aws sts get-caller-identity` settles that, and a pure classifier may not
      // spawn a subprocess — so this reports the terminal step it may turn out to
      // need rather than one click. Being wrong in this direction costs an offer
      // the user can still make from Settings; being wrong the other way costs
      // their trust in every other offer.
      return {
        effort: 'needs-config',
        available: false,
        detail:
          'Needs AWS credentials on this machine — run `aws sso login` or ' +
          '`aws configure` (or set AWS_PROFILE), then connect it from Settings.',
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
