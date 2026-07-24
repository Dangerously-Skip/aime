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
  // anthropic-native + openai-compat both reach the SDK via a base URL. The
  // openai-compat case is completed by the shim in P1.4.
  return { apiKey, baseUrl: providerConfig.baseUrl };
}
