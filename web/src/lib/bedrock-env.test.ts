import { describe, it, expect, afterEach, vi } from 'vitest';
import { getBedrockEnv, isBedrockConfigured, resolveModel } from './bedrock-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

const clearAws = () => {
  for (const key of ['AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK']) {
    vi.stubEnv(key, '');
  }
};

describe('isBedrockConfigured', () => {
  it('requires both a region and some credential source', () => {
    clearAws();
    expect(isBedrockConfigured()).toBe(false);

    vi.stubEnv('AWS_REGION', 'ap-southeast-2');
    expect(isBedrockConfigured()).toBe(false); // region only

    vi.stubEnv('AWS_PROFILE', 'dev');
    expect(isBedrockConfigured()).toBe(true);
  });

  it('accepts AWS_DEFAULT_REGION and access-key credentials', () => {
    clearAws();
    vi.stubEnv('AWS_DEFAULT_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA...');
    expect(isBedrockConfigured()).toBe(true);
  });
});

describe('getBedrockEnv', () => {
  it('always sets CLAUDE_CODE_USE_BEDROCK and passes through configured credentials', () => {
    clearAws();
    vi.stubEnv('AWS_REGION', 'ap-southeast-2');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA123');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret');

    const env = getBedrockEnv();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(env.AWS_REGION).toBe('ap-southeast-2');
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA123');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret');
    expect(env.AWS_PROFILE).toBeUndefined();
  });

  it('prefers AWS_REGION over AWS_DEFAULT_REGION', () => {
    clearAws();
    vi.stubEnv('AWS_REGION', 'ap-southeast-2');
    vi.stubEnv('AWS_DEFAULT_REGION', 'us-east-1');
    expect(getBedrockEnv().AWS_REGION).toBe('ap-southeast-2');
  });
});

describe('resolveModel', () => {
  it('maps UI names to SDK short names, defaulting to sonnet', () => {
    expect(resolveModel('opus')).toBe('opus');
    expect(resolveModel('OPUS-4.6')).toBe('opus');
    expect(resolveModel('haiku-4.5')).toBe('haiku');
    expect(resolveModel('unknown-model')).toBe('sonnet');
    expect(resolveModel(undefined)).toBe('sonnet');
  });
});
