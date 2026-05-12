const NIB_GATEWAY_BASE_URL = 'https://ai-studio.internal.invalid';

export function getGatewayEnv(apiKey: string): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: NIB_GATEWAY_BASE_URL,
  };
}

export function isGatewayConfigured(apiKey: string | null): boolean {
  return !!apiKey && apiKey.startsWith('sk-');
}

// Map SDK model names to gateway-compatible model aliases.
//
// IMPORTANT: The Claude CLI resolves short names like "sonnet" → "claude-sonnet-4-6"
// before sending to the API. The gateway rejects those full IDs. We must use
// names the CLI won't resolve.
//
// We route through the `claude-code` / `claude-code-opus` LiteLLM aliases because
// those are wired to `bedrock/invoke/...` in config.yaml, which means they pick
// up Brad's overlay patches (ai-studio PR #38 — adaptive thinking,
// PR #37 — CountTokens InvokeModel fix). The generic `coding` / `writing` etc.
// aliases get tag-routed to per-team `code--<team>` variants which currently
// use `bedrock/converse/...` — unpatched — and 400 on Claude Code's request shape.
//
// `claude-code` is load-balanced via Synaxi tags: default → Sonnet 4.6,
// escalated/complex → Opus 4.7. `claude-code-opus` always routes to Opus 4.7.
export function mapModelForGateway(model?: string): string {
  if (!model) return 'claude-code';
  const lower = model.toLowerCase();
  // Direct passthrough for known LiteLLM alias names
  if (lower === 'claude-code' || lower === 'claude-code-opus') return lower;
  // Map SDK / UI names to the InvokeModel-backed aliases
  if (lower.includes('opus')) return 'claude-code-opus';
  if (lower.includes('sonnet')) return 'claude-code';
  if (lower.includes('haiku')) return 'claude-code'; // no Haiku InvokeModel alias yet; falls back to Sonnet
  return 'claude-code';
}
