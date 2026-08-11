/**
 * Whether the SDK's built-in `WebSearch` tool will actually work on this run.
 *
 * ## The finding this encodes
 *
 * The Agent SDK ships `WebSearch` as a first-class built-in — it is in
 * `sdk-tools.d.ts` alongside Read and Bash, and it was in this app's original
 * default tool list. Every run since has passed `disallowedTools: ['WebSearch']`
 * unconditionally, so the model has never once had it.
 *
 * That was almost certainly correct when it was written and nobody wrote down
 * why. `WebSearch` is Anthropic's SERVER-SIDE search: the provider executes it,
 * so it exists only where the provider implements it. This app began life
 * pointed at a corporate gateway (see the `NIB_GATEWAY_BASE_URL` removed from
 * the telemetry route), and that class of backend does not serve it — Amazon
 * Bedrock in particular does not. Disabling it and bolting on a SearXNG MCP was
 * a reasonable answer to that.
 *
 * It is the wrong answer now. On a first-party Anthropic key, web search is
 * already in the box, costs no extra configuration, and needs no third-party
 * account — and we were denying it and then telling the user to go set up
 * SearXNG. The agent guessing URLs was downstream of a capability we turned off.
 *
 * ## Why a predicate rather than just deleting the deny
 *
 * Because the deny is right for some backends and wrong for others, and
 * shipping `WebSearch` to a backend that does not implement it is worse than
 * not offering it: the model reaches for a tool that errors, which is exactly
 * the "claims a tool it does not have" failure this codebase keeps hitting.
 *
 * Per Anthropic's platform-availability matrix, server-side web search is
 * available on the first-party API and Vertex, and NOT on Bedrock. Anything
 * reached through a third-party proxy — OpenRouter, a gateway, the openai-compat
 * shim — is that proxy's surface, not Anthropic's, so it does not have it
 * either. OpenRouter has its own web plugin, which is what the `openrouter`
 * search provider uses; the two are different mechanisms and only one of them
 * is `WebSearch`.
 */

export interface NativeSearchInputs {
  /** Set when a BYOK provider overrides the endpoint — i.e. not first-party. */
  baseUrl?: string;
  /** Extra env handed to the SDK subprocess by `resolveExecution`. */
  providerEnv?: Record<string, string>;
  /**
   * The AMBIENT Bedrock path: `CLAUDE_CODE_USE_BEDROCK=1` plus AWS credentials
   * in `.env`, with no BYOK provider row selected at all.
   *
   * This function only ever saw `providerEnv`, so the documented ambient setup
   * was invisible to it: `resolveExecution` returns no env, `baseUrl` is
   * undefined, and it answered `true` — while the provider routed the
   * subprocess through `isBedrockConfigured()`/`getBedrockEnv()` anyway. The
   * model was handed Anthropic's server-side `WebSearch` on Bedrock, which does
   * not implement it, and the tool errored mid-turn. Precisely the false
   * positive the note below says must never happen.
   */
  ambientBedrock?: boolean;
  /**
   * The user chose "No search" in Settings.
   *
   * `resolveSearchRoute` honours `'none'` by returning null, which switches off
   * the PLUGGABLE path — but this function never saw the setting, so on a
   * first-party key the built-in `WebSearch` stayed mounted and the prompt was
   * upgraded to say search exists. An off-switch that switches nothing off.
   */
  userDeclinedSearch?: boolean;
}

/**
 * True when the built-in `WebSearch` tool should be offered.
 *
 * Deliberately conservative: anything this cannot positively identify as
 * first-party Anthropic or Vertex is treated as unsupported. A false negative
 * costs a capability the pluggable providers can supply; a false positive costs
 * a tool that errors mid-turn, which is the failure mode with a history here.
 */
export function supportsNativeWebSearch(inputs: NativeSearchInputs): boolean {
  const { baseUrl, providerEnv, ambientBedrock, userDeclinedSearch } = inputs;

  // An explicit "off" beats every capability check below it. It is the user's
  // decision, not a gap for a default to fill.
  if (userDeclinedSearch) return false;

  // A custom endpoint means someone else is serving the Messages API —
  // OpenRouter, a gateway, the local openai-compat shim. Anthropic's
  // server-side tools are not part of what they serve.
  if (baseUrl?.trim()) return false;

  const env = providerEnv ?? {};
  if (env.CLAUDE_CODE_USE_BEDROCK === '1') return false; // not available on Bedrock
  if (env.CLAUDE_CODE_USE_VERTEX === '1') return true; // available on Vertex

  // No per-provider env, but the process is configured for Bedrock — the
  // subprocess will route there, so the answer is the same as above.
  if (ambientBedrock) return false;

  // No override of any kind ⇒ the SDK talks to the first-party API.
  return true;
}
