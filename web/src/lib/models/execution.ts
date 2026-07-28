import type { Transport } from './providers';

/**
 * Non-secret execution descriptor the client sends for a chat request that
 * targets a user-added provider. The client builds this from the provider
 * store; the API key itself never rides in it — it is read from the keychain
 * server-side by `providerId` (a transient BYOK key may still be supplied
 * separately on the request).
 */
export interface ProviderExecConfig {
  providerId: string;
  transport?: Transport;
  /** The provider's real base URL (its own anthropic/openai endpoint). */
  baseUrl?: string;
}

export interface ResolvedExecution {
  /** Key handed to the Agent SDK as ANTHROPIC_API_KEY (undefined ⇒ env/Bedrock). */
  apiKey?: string;
  /** Anthropic-compatible base URL for the SDK, or undefined for default. */
  baseUrl?: string;
}

/**
 * Build the local translation-shim base URL for an `openai-compat` provider.
 * The Agent SDK will append `/v1/messages`, so the URL ends at the encoded
 * upstream segment. The provider id and its real (OpenAI-format) base URL are
 * carried in the path — the upstream base is base64url-encoded so arbitrary
 * URLs survive routing. The key rides separately as the SDK's x-api-key header.
 */
export function buildShimBaseUrl(shimOrigin: string, providerId: string, upstreamBaseUrl: string): string {
  const origin = shimOrigin.replace(/\/$/, '');
  const upstream = Buffer.from(upstreamBaseUrl, 'utf8').toString('base64url');
  return `${origin}/api/llm-proxy/${encodeURIComponent(providerId)}/${upstream}`;
}

/**
 * Compute the execution env (key + Anthropic-compatible base URL) for a chat
 * request. Credentials are resolved from the keychain (by `providerId`) unless
 * a transient request key is supplied, which wins.
 *
 * - No `providerConfig` → default path (BYOK/env Anthropic or Bedrock), no base URL.
 * - `anthropic-native` → drive the SDK directly against the provider's base URL
 *   (OpenRouter's anthropic endpoint, a self-hosted gateway, …).
 * - `openai-compat` → routed through the local translation shim (wired in P1.4);
 *   for now the provider base URL passes through unchanged.
 * - `native-fal` → capability-only, never drives the agent loop (P1.5); no base URL.
 *
 * `loadKey` is injected so the route wires it to the keychain and tests can
 * stub it without an OS credential store.
 */
/**
 * Normalise a provider base URL for the Agent SDK, which appends `/v1/messages`
 * itself.
 *
 * A preset's `defaultBaseUrl` serves three consumers with different
 * expectations: model scanning wants `<base>/models`, the openai-compat shim
 * wants `<base>/chat/completions`, and the SDK wants the base WITHOUT `/v1`.
 * OpenRouter's is `https://openrouter.ai/api/v1`, which suits the first two and
 * made the SDK request `/api/v1/v1/messages`.
 *
 * Verified against the live API: `/api/v1/messages` answers 401 for a bad key
 * (the route exists), `/api/v1/v1/messages` answers 404 with an HTML error page.
 * The SDK reported that 404 as "There's an issue with the selected model
 * (anthropic/claude-opus-5-fast). It may not exist or you may not have access to
 * it" — which reads as a catalogue or permissions problem and sent the search in
 * entirely the wrong direction.
 *
 * Only a TRAILING `/v1` is removed, so a gateway mounted at `/v1/proxy`, or a
 * base with no version segment, is untouched.
 */
export function baseUrlForSdk(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/v1\/?$/, '');
}

export async function resolveExecution(opts: {
  providerConfig?: ProviderExecConfig | null;
  requestApiKey?: string | null;
  loadKey?: (providerId: string) => Promise<string | undefined>;
  /** Origin (scheme+host+port) of this server, used to build the shim URL. */
  shimOrigin?: string;
}): Promise<ResolvedExecution> {
  const { providerConfig, requestApiKey } = opts;
  if (!providerConfig) return { apiKey: requestApiKey || undefined };

  let apiKey = requestApiKey || undefined;
  if (!apiKey && opts.loadKey) {
    apiKey = await opts.loadKey(providerConfig.providerId);
  }

  const transport: Transport = providerConfig.transport ?? 'anthropic-native';
  if (transport === 'native-fal') {
    // Capability-only provider — it can never drive the agent loop.
    return { apiKey };
  }
  if (transport === 'openai-compat') {
    // Route through the local translation shim (DR-11). Without a base URL to
    // translate, or without knowing our own origin, we can't build the shim
    // target — surface no base URL so the caller falls back / errors cleanly.
    if (providerConfig.baseUrl && opts.shimOrigin) {
      return {
        apiKey,
        baseUrl: buildShimBaseUrl(opts.shimOrigin, providerConfig.providerId, providerConfig.baseUrl),
      };
    }
    return { apiKey };
  }
  // anthropic-native: drive the SDK directly against the provider's base URL.
  return { apiKey, baseUrl: baseUrlForSdk(providerConfig.baseUrl) };
}
