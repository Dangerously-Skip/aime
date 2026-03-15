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
// Available generic models: coding, writing, chat, fast, cheap, sonnet, haiku
// IMPORTANT: The Claude CLI resolves short names like "sonnet" → "claude-sonnet-4-6"
// and "haiku" → "claude-haiku-4-5" before sending to the API. The gateway rejects
// these full IDs. We must use names the CLI won't resolve: coding, writing, chat, fast, cheap.
// No bare "opus" exists on gateway.
export function mapModelForGateway(model?: string): string {
  if (!model) return 'coding';
  const lower = model.toLowerCase();
  // Gateway-native names that CLI won't resolve — pass through
  if (lower === 'coding' || lower === 'code') return 'coding';
  if (lower === 'writing' || lower === 'write') return 'writing';
  if (lower === 'chat') return 'chat';
  if (lower === 'fast') return 'fast';
  if (lower === 'cheap') return 'cheap';
  // Map well-known SDK names to gateway names the CLI won't resolve
  if (lower.includes('haiku')) return 'fast';
  if (lower.includes('opus') || lower.includes('sonnet')) return 'coding';
  return 'coding';
}
