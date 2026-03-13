const NIB_GATEWAY_BASE_URL = 'https://ai-studio.internal.invalid/anthropic';

export function getGatewayEnv(apiKey: string): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: NIB_GATEWAY_BASE_URL,
  };
}

export function isGatewayConfigured(apiKey: string | null): boolean {
  return !!apiKey && apiKey.startsWith('sk-');
}

// Map SDK model names to gateway-compatible short names
// LiteLLM team aliases resolve: "sonnet" -> "sonnet--{team}" -> team's inference profile
export function mapModelForGateway(model?: string): string {
  if (!model) return 'sonnet';
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  return 'sonnet'; // default to sonnet for anything else
}
