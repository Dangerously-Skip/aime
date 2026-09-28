import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasModelCredentials } from './credential-check';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK',
];

beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('hasModelCredentials — the built-in path', () => {
  it('is false with nothing configured', () => {
    expect(hasModelCredentials({ exec: {} })).toBe(false);
  });

  it.each([
    ['a request key', { exec: { apiKey: 'sk' } }],
    ['the Settings key mirrored into the store', { exec: {}, storedAnthropicKey: 'sk' }],
  ])('is true with %s', (_label, input) => {
    expect(hasModelCredentials(input)).toBe(true);
  });

  it.each([
    ['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: 'sk' }],
    ['an OAuth token', { CLAUDE_CODE_OAUTH_TOKEN: 't' }],
    ['Bedrock', { AWS_REGION: 'us-east-1', AWS_PROFILE: 'default' }],
    ['Vertex', { CLAUDE_CODE_USE_VERTEX: '1' }],
  ])('is true with %s in the environment', (_label, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(hasModelCredentials({ exec: {} })).toBe(true);
  });

  it('does not count a Bedrock region with no credentials', () => {
    vi.stubEnv('AWS_REGION', 'us-east-1');
    expect(hasModelCredentials({ exec: {} })).toBe(false);
  });
});

describe('hasModelCredentials — a user-added provider', () => {
  it('needs a key or a base URL', () => {
    const providerConfig = { providerId: 'p', transport: 'anthropic-native' as const };
    expect(hasModelCredentials({ exec: {}, providerConfig })).toBe(false);
    expect(hasModelCredentials({ exec: { apiKey: 'k' }, providerConfig })).toBe(true);
    expect(hasModelCredentials({ exec: { baseUrl: 'http://127.0.0.1:11434' }, providerConfig })).toBe(true);
  });

  it('does not borrow the ambient Anthropic key for somebody else’s provider', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk');
    expect(hasModelCredentials({ exec: {}, providerConfig: { providerId: 'p' } })).toBe(false);
  });

  it('accepts a configured Bedrock/Vertex provider by its environment', () => {
    expect(
      hasModelCredentials({
        exec: { env: { CLAUDE_CODE_USE_BEDROCK: '1' } },
        providerConfig: { providerId: 'b', agentMode: 'bedrock' },
      }),
    ).toBe(true);
  });

  it('never lets a capability-only provider drive a turn', () => {
    expect(
      hasModelCredentials({ exec: { apiKey: 'k' }, providerConfig: { providerId: 'fal', transport: 'native-fal' } }),
    ).toBe(false);
  });
});
