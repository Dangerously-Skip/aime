import { describe, it, expect } from 'vitest';
import { getGatewayEnv, isGatewayConfigured, mapModelForGateway } from './gateway-env';

describe('isGatewayConfigured', () => {
  it('requires an sk- prefixed key', () => {
    expect(isGatewayConfigured('sk-abc123')).toBe(true);
    expect(isGatewayConfigured('pk-abc123')).toBe(false);
    expect(isGatewayConfigured('')).toBe(false);
    expect(isGatewayConfigured(null)).toBe(false);
  });
});

describe('getGatewayEnv', () => {
  it('sets the API key and gateway base URL', () => {
    const env = getGatewayEnv('sk-test');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.ANTHROPIC_BASE_URL).toContain('ai-studio');
  });
});

describe('mapModelForGateway', () => {
  it('maps SDK/UI names to InvokeModel-backed gateway aliases', () => {
    expect(mapModelForGateway('opus')).toBe('claude-code-opus');
    expect(mapModelForGateway('claude-opus-4-6')).toBe('claude-code-opus');
    expect(mapModelForGateway('sonnet')).toBe('claude-code');
    expect(mapModelForGateway('haiku')).toBe('claude-code'); // no Haiku alias yet
  });

  it('passes through known LiteLLM aliases and defaults everything else', () => {
    expect(mapModelForGateway('claude-code')).toBe('claude-code');
    expect(mapModelForGateway('claude-code-opus')).toBe('claude-code-opus');
    expect(mapModelForGateway('gpt-5')).toBe('claude-code');
    expect(mapModelForGateway(undefined)).toBe('claude-code');
  });
});
