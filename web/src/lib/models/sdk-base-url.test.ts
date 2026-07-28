import { describe, it, expect } from 'vitest';
import { baseUrlForSdk, resolveExecution } from './execution';

/**
 * The Agent SDK appends `/v1/messages` to whatever base URL it is given.
 *
 * OpenRouter's preset base is `https://openrouter.ai/api/v1` — correct for model
 * scanning (`<base>/models`) and for the openai-compat shim
 * (`<base>/chat/completions`), but it made the SDK request
 * `/api/v1/v1/messages`. Verified against the live API while diagnosing:
 *
 *   POST https://openrouter.ai/api/v1/messages     -> 401 (route exists)
 *   POST https://openrouter.ai/api/v1/v1/messages  -> 404 (HTML error page)
 *
 * The SDK surfaced that 404 as "There's an issue with the selected model
 * (anthropic/claude-opus-5-fast). It may not exist or you may not have access to
 * it", which reads as a catalogue/permissions failure and hid the real cause.
 * Non-Claude models were unaffected, because the shim builds its own URL — so
 * Kimi worked while every Claude model on the same provider failed.
 */

describe('baseUrlForSdk', () => {
  it('drops a trailing /v1, with or without a slash', () => {
    expect(baseUrlForSdk('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api');
    expect(baseUrlForSdk('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api');
  });

  it('leaves a base with no version segment alone', () => {
    expect(baseUrlForSdk('https://api.anthropic.com')).toBe('https://api.anthropic.com');
    expect(baseUrlForSdk('https://gw.internal')).toBe('https://gw.internal');
  });

  it('only strips a TRAILING /v1, never one in the middle of a path', () => {
    // A gateway mounted under /v1 must keep it, or the SDK targets the wrong host path.
    expect(baseUrlForSdk('https://gw.internal/v1/proxy')).toBe('https://gw.internal/v1/proxy');
    expect(baseUrlForSdk('https://gw.internal/v1/anthropic')).toBe('https://gw.internal/v1/anthropic');
  });

  it('passes undefined through', () => {
    expect(baseUrlForSdk(undefined)).toBeUndefined();
  });
});

describe('resolveExecution — anthropic-native base URL', () => {
  it('hands the SDK a base that will not double the version segment', async () => {
    const out = await resolveExecution({
      providerConfig: {
        providerId: 'or-1',
        transport: 'anthropic-native',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      requestApiKey: 'sk-or-test',
    });
    // The SDK will append /v1/messages to this.
    expect(out.baseUrl).toBe('https://openrouter.ai/api');
    expect(`${out.baseUrl}/v1/messages`).toBe('https://openrouter.ai/api/v1/messages');
  });

  it('does not disturb the openai-compat shim URL', async () => {
    const out = await resolveExecution({
      providerConfig: {
        providerId: 'or-1',
        transport: 'openai-compat',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      requestApiKey: 'sk-or-test',
      shimOrigin: 'http://localhost:3000',
    });
    // The shim carries the upstream base itself and appends /chat/completions,
    // so it still needs the /v1 that the SDK path must not have.
    expect(out.baseUrl).toContain('/api/llm-proxy/');
    const upstream = Buffer.from(out.baseUrl!.split('/').pop()!, 'base64url').toString('utf8');
    expect(upstream).toBe('https://openrouter.ai/api/v1');
  });
});
