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
  return { apiKey, baseUrl: providerConfig.baseUrl };
}
