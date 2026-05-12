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
// Available generic models: coding, writing, chat, fast, cheap, sonnet, haiku.
// IMPORTANT: The Claude CLI resolves short names like "sonnet" → "claude-sonnet-4-6"
// and "haiku" → "claude-haiku-4-5" before sending to the API. The gateway rejects
// these full IDs. We must use names the CLI won't resolve: coding, writing, chat,
// fast, cheap.
//
// Each gateway alias is tag-routed (per team) to a distinct AWS Bedrock
// application inference profile. For data-ai team in config.yaml:
//   coding  → code--data-ai  → Opus 4.7 profile  (q5lghp47wbcz)
//   writing → write--data-ai → Sonnet 4.7 profile (kvbvdy44ya1x)
//   fast    → fast--data-ai  → Haiku 4.5 profile (r99y1dv0nmzm)
// Routing opus AND sonnet to "coding" (as we did before) silently swallows the
// sonnet choice and runs Opus for everything. Keep them on different aliases.
export function mapModelForGateway(model?: string): string {
  if (!model) return 'coding';
  const lower = model.toLowerCase();
  // Gateway-native names that CLI won't resolve — pass through
  if (lower === 'coding' || lower === 'code') return 'coding';
  if (lower === 'writing' || lower === 'write') return 'writing';
  if (lower === 'chat') return 'chat';
  if (lower === 'fast') return 'fast';
  if (lower === 'cheap') return 'cheap';
  // Map well-known SDK names to gateway aliases that route to distinct
  // inference profiles per model family.
  if (lower.includes('haiku')) return 'fast';
  if (lower.includes('sonnet')) return 'writing';
  if (lower.includes('opus')) return 'coding';
  return 'coding';
}
