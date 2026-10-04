import type { ProviderExecConfig, ResolvedExecution } from './execution';
import { isBedrockConfigured } from '../bedrock-env';

/**
 * Can this turn reach a model at all?
 *
 * Answered BEFORE the Agent SDK is spawned. Without it a user with nothing
 * configured waited for a subprocess to boot, got "Not logged in · Please run
 * /login" back as the assistant's reply, and was pointed at a command this app
 * does not have. With it the turn fails in milliseconds with `no_model`, which
 * the client renders as "Connect a model" linking to Settings.
 *
 * Deliberately generous: anything that could plausibly authenticate counts. A
 * false "no model" would block a working setup outright; a false "yes" only
 * falls through to the SDK's own auth error, which is now typed as well.
 */
export interface CredentialCheckInput {
  /** What `resolveExecution` produced for this request. */
  exec: ResolvedExecution;
  /** The user-added provider the turn targets, if any. */
  providerConfig?: ProviderExecConfig | null;
  /** The Anthropic key mirrored into the credential store by Settings. */
  storedAnthropicKey?: string | null;
}

export function hasModelCredentials(input: CredentialCheckInput): boolean {
  const { exec, providerConfig, storedAnthropicKey } = input;
  const env = process.env;

  // A configured Bedrock/Vertex provider carries its own environment.
  if (exec.env && Object.keys(exec.env).length > 0) return true;

  if (providerConfig) {
    // Capability-only (image) providers can never drive an agent turn.
    if (providerConfig.transport === 'native-fal') return false;
    // A key, or a base URL — a local server (Ollama, LM Studio) needs no key.
    return Boolean(exec.apiKey || exec.baseUrl);
  }

  // The built-in path: any of the ways the Agent SDK can authenticate itself.
  return Boolean(
    exec.apiKey ||
      exec.baseUrl ||
      storedAnthropicKey ||
      env.ANTHROPIC_API_KEY ||
      env.ANTHROPIC_AUTH_TOKEN ||
      env.CLAUDE_CODE_OAUTH_TOKEN ||
      isBedrockConfigured() ||
      env.CLAUDE_CODE_USE_VERTEX,
  );
}

/** Shown when `hasModelCredentials` says no. The client renders its own copy by code. */
export const NO_MODEL_MESSAGE =
  'No model is configured. Add an API key or a provider in Settings.';
