import { resolveExecution, type ProviderExecConfig, type ResolvedExecution } from './execution';
import { getCredentialStore, getServerAnthropicKey } from './credentials';
import { hasModelCredentials } from './credential-check';
import { createDefaultRegistry, resolveRoute } from './registry';
import { getSurfaceRoute } from './surface-routes';
import { isBedrockConfigured } from '../bedrock-env';
import type { Capability, Tier } from './types';

/**
 * The server half of a turn's model route, shared by every route that starts
 * an Agent SDK run from a client request (`/api/chat/[surfaceId]`,
 * `/api/subagent`).
 *
 * The CLIENT decides the route — `resolveSendRoute` turns the user's tier grid
 * and providers into `{ model, providerConfig }`. The server's job is only to
 * turn that into credentials, and, when nothing was pinned, to pick the
 * surface's built-in default. `/api/subagent` used to skip both and run
 * `surfaceConfig.model` against the built-in registry with whatever key the
 * body carried — dead for an OpenRouter-only user, which is the exact defect
 * `send-route-coverage.test.ts` exists to prevent on the client side.
 */

export interface TurnExecution {
  exec: ResolvedExecution;
  /** False when nothing configured could serve the turn — see credential-check.ts. */
  usable: boolean;
}

/**
 * Credentials for the turn: the keychain entry for a user-added provider (or
 * the transient request key), Bedrock/Vertex environment, or — on the built-in
 * path with no request key — the Anthropic key Settings mirrored into the
 * credential store, which is then USED, so it cannot pass the usability check
 * and fail at the SDK.
 */
export async function resolveTurnExecution(opts: {
  providerConfig?: ProviderExecConfig | null;
  requestApiKey?: string | null;
  /** This server's origin; openai-compat providers route through its shim. */
  shimOrigin: string;
}): Promise<TurnExecution> {
  const { providerConfig } = opts;
  const exec = await resolveExecution({
    providerConfig,
    requestApiKey: opts.requestApiKey,
    shimOrigin: opts.shimOrigin,
    // Every stored field, not just the key: Bedrock and Vertex are driven by
    // environment built from region/project/credentials.
    loadFields: async (id) => {
      try {
        return await getCredentialStore().get(id);
      } catch {
        return undefined;
      }
    },
    loadKey: async (id) => {
      try {
        return await getCredentialStore().getField(id, 'apiKey');
      } catch {
        // CredentialStoreUnavailable (no AIME_CRED_KEY) or read error → fall
        // back to whatever the request supplied.
        return undefined;
      }
    },
  });

  const storedAnthropicKey = providerConfig || exec.apiKey ? undefined : await getServerAnthropicKey();
  if (storedAnthropicKey) exec.apiKey = storedAnthropicKey;

  return { exec, usable: hasModelCredentials({ exec, providerConfig, storedAnthropicKey }) };
}

/**
 * The built-in model for a surface when the client pinned none: the surface's
 * (capability, tier) intent — or the request's override of it — resolved
 * through the registry against what this server can actually reach.
 *
 * Returns null when nothing resolves; the caller keeps its surface default.
 */
export function resolveBuiltinSurfaceModel(opts: {
  surfaceId: string;
  capability?: Capability | null;
  tier?: Tier | null;
  /** An Anthropic key is available (request, store or env). */
  hasAnthropicKey: boolean;
}): { model: string; capability: Capability; tier: Tier; degraded: boolean } | null {
  const available = new Set<string>();
  if (opts.hasAnthropicKey || process.env.ANTHROPIC_API_KEY) available.add('anthropic');
  if (isBedrockConfigured()) available.add('bedrock');

  const route = getSurfaceRoute(opts.surfaceId);
  const capability = opts.capability ?? route.capability;
  const tier = opts.tier ?? route.tier;
  const resolved = resolveRoute(createDefaultRegistry(), capability, tier, (p) => available.has(p.id));
  return resolved
    ? { model: resolved.model.driverModel, capability, tier, degraded: resolved.degraded }
    : null;
}
