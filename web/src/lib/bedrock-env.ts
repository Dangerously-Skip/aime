/**
 * Get environment variables for AWS Bedrock inference.
 * The Agent SDK's underlying Claude Code CLI supports Bedrock natively
 * via CLAUDE_CODE_USE_BEDROCK=1 and standard AWS credential chain.
 */
export function getBedrockEnv(): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_USE_BEDROCK: '1',
  };

  // AWS Region (required)
  if (process.env.AWS_REGION) {
    env.AWS_REGION = process.env.AWS_REGION;
  } else if (process.env.AWS_DEFAULT_REGION) {
    env.AWS_REGION = process.env.AWS_DEFAULT_REGION;
  }

  // AWS Credentials -- pass through whichever method is configured
  // Method 1: Access key + secret
  if (process.env.AWS_ACCESS_KEY_ID) {
    env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  }
  if (process.env.AWS_SECRET_ACCESS_KEY) {
    env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  }
  if (process.env.AWS_SESSION_TOKEN) {
    env.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
  }

  // Method 2: Named profile
  if (process.env.AWS_PROFILE) {
    env.AWS_PROFILE = process.env.AWS_PROFILE;
  }

  // Method 3: Bedrock bearer token
  if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
    env.AWS_BEARER_TOKEN_BEDROCK = process.env.AWS_BEARER_TOKEN_BEDROCK;
  }

  // Optional: Pin model versions for Bedrock
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  }
  if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  }

  return env;
}

/**
 * Check if Bedrock is configured (has required env vars).
 */
export function isBedrockConfigured(): boolean {
  const hasRegion = !!(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
  const hasCredentials = !!(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_BEARER_TOKEN_BEDROCK
  );
  return hasRegion && hasCredentials;
}

/**
 * Model name mapping (UI names to SDK model parameter).
 * The Agent SDK accepts short names ('sonnet', 'opus', 'haiku')
 * and resolves them to the correct Bedrock model IDs internally.
 */
export const MODEL_MAP: Record<string, string> = {
  'opus': 'opus',
  'opus-4.6': 'opus',
  'sonnet': 'sonnet',
  'sonnet-4.6': 'sonnet',
  'haiku': 'haiku',
  'haiku-4.5': 'haiku',
};

export function resolveModel(modelName?: string): string {
  return MODEL_MAP[modelName?.toLowerCase() || ''] || 'sonnet';
}
