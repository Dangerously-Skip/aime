import type { AgentMode, Transport } from './providers';

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
  /**
   * How the Agent SDK reaches this provider. `bedrock` and `vertex` are driven
   * by environment rather than a key + base URL, so they need naming here.
   *
   * Absent ⇒ 'api-key', which is what every previously-shipped config meant.
   */
  agentMode?: AgentMode;
}

export interface ResolvedExecution {
  /** Key handed to the Agent SDK as ANTHROPIC_API_KEY (undefined ⇒ env/Bedrock). */
  apiKey?: string;
  /** Anthropic-compatible base URL for the SDK, or undefined for default. */
  baseUrl?: string;
  /**
   * Extra environment for the SDK subprocess — how Bedrock and Vertex are
   * configured.
   *
   * Until this existed, both were reachable ONLY through the server's own
   * `process.env`: their presets declared `awsRegion`, `vertexProject` and the
   * rest, the UI could not collect them, and nothing read them if it had. A
   * provider you could add but never use is worse than one that is not offered.
   */
  env?: Record<string, string>;
}

/** Build the SDK environment for a configured (not ambient) Bedrock provider. */
export function bedrockEnvFrom(values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_CODE_USE_BEDROCK: '1' };
  if (values.awsRegion) env.AWS_REGION = values.awsRegion;
  // Both or neither: a lone access key id cannot authenticate, and passing it
  // would shadow the ambient credentials that might otherwise have worked.
  if (values.awsAccessKeyId && values.awsSecretAccessKey) {
    env.AWS_ACCESS_KEY_ID = values.awsAccessKeyId;
    env.AWS_SECRET_ACCESS_KEY = values.awsSecretAccessKey;
    if (values.awsSessionToken) env.AWS_SESSION_TOKEN = values.awsSessionToken;
  }
  return env;
}

/** Build the SDK environment for a configured Vertex provider. */
export function vertexEnvFrom(values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_CODE_USE_VERTEX: '1' };
  if (values.vertexProject) env.ANTHROPIC_VERTEX_PROJECT_ID = values.vertexProject;
  if (values.vertexRegion) env.CLOUD_ML_REGION = values.vertexRegion;
  return env;
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
  /** All stored fields for a provider — needed for Bedrock/Vertex env. */
  loadFields?: (providerId: string) => Promise<Record<string, string> | undefined>;
  /** Origin (scheme+host+port) of this server, used to build the shim URL. */
  shimOrigin?: string;
}): Promise<ResolvedExecution> {
  const { providerConfig, requestApiKey } = opts;
  if (!providerConfig) return { apiKey: requestApiKey || undefined };

  let apiKey = requestApiKey || undefined;
  if (!apiKey && opts.loadKey) {
    apiKey = await opts.loadKey(providerConfig.providerId);
  }

  // Bedrock and Vertex are configured by environment, not by key + base URL.
  const agentMode = providerConfig.agentMode ?? 'api-key';
  if (agentMode === 'bedrock' || agentMode === 'vertex') {
    const values = (await opts.loadFields?.(providerConfig.providerId)) ?? {};
    return {
      env: agentMode === 'bedrock' ? bedrockEnvFrom(values) : vertexEnvFrom(values),
    };
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
