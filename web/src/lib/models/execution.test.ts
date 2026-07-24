import { describe, it, expect, vi } from 'vitest';
import { resolveExecution, buildShimBaseUrl } from './execution';

describe('resolveExecution', () => {
  it('passes a transient request key through and sets no base URL by default', async () => {
    const exec = await resolveExecution({ requestApiKey: 'sk-byok' });
    expect(exec).toEqual({ apiKey: 'sk-byok' });
  });

  it('returns an empty key when nothing is supplied (env/Bedrock path)', async () => {
    const exec = await resolveExecution({});
    expect(exec).toEqual({ apiKey: undefined });
  });

  it('drives an anthropic-native provider directly against its base URL', async () => {
    const loadKey = vi.fn(async () => 'sk-keychain');
    const exec = await resolveExecution({
      providerConfig: {
        providerId: 'openrouter-1',
        transport: 'anthropic-native',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      loadKey,
    });
    expect(loadKey).toHaveBeenCalledWith('openrouter-1');
    expect(exec).toEqual({ apiKey: 'sk-keychain', baseUrl: 'https://openrouter.ai/api/v1' });
  });

  it('prefers a transient request key over the keychain and does not read it', async () => {
    const loadKey = vi.fn(async () => 'sk-keychain');
    const exec = await resolveExecution({
      providerConfig: { providerId: 'p', baseUrl: 'https://x' },
      requestApiKey: 'sk-transient',
      loadKey,
    });
    expect(loadKey).not.toHaveBeenCalled();
    expect(exec.apiKey).toBe('sk-transient');
  });

  it('defaults an unspecified transport to anthropic-native (base URL kept)', async () => {
    const exec = await resolveExecution({
      providerConfig: { providerId: 'gw', baseUrl: 'https://gw.internal/v1' },
    });
    expect(exec.baseUrl).toBe('https://gw.internal/v1');
  });

  it('routes an openai-compat provider through the shim when an origin is known', async () => {
    const exec = await resolveExecution({
      providerConfig: {
        providerId: 'local-1',
        transport: 'openai-compat',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
      shimOrigin: 'http://127.0.0.1:3100',
    });
    expect(exec.baseUrl).toBe(buildShimBaseUrl('http://127.0.0.1:3100', 'local-1', 'http://127.0.0.1:11434/v1'));
    expect(exec.baseUrl).toContain('/api/llm-proxy/local-1/');
    // the upstream must NOT leak in plaintext (it is base64url-encoded)
    expect(exec.baseUrl).not.toContain('11434/v1');
  });

  it('yields no base URL for openai-compat when the shim origin is unknown', async () => {
    const exec = await resolveExecution({
      providerConfig: { providerId: 'local-1', transport: 'openai-compat', baseUrl: 'http://x/v1' },
    });
    expect(exec.baseUrl).toBeUndefined();
  });

  it('never hands a base URL to a native-fal (capability-only) provider', async () => {
    const exec = await resolveExecution({
      providerConfig: {
        providerId: 'fal-1',
        transport: 'native-fal',
        baseUrl: 'https://fal.run',
      },
      requestApiKey: 'fal-key',
    });
    expect(exec).toEqual({ apiKey: 'fal-key' });
    expect(exec.baseUrl).toBeUndefined();
  });

  it('builds a shim URL that round-trips the upstream via base64url', async () => {
    const url = buildShimBaseUrl('http://127.0.0.1:3100/', 'prov-1', 'https://api.openai.com/v1');
    const m = url.match(/^http:\/\/127\.0\.0\.1:3100\/api\/llm-proxy\/prov-1\/(.+)$/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64url').toString('utf8')).toBe('https://api.openai.com/v1');
  });

  it('tolerates a keychain miss by leaving the key undefined', async () => {
    const exec = await resolveExecution({
      providerConfig: { providerId: 'missing', baseUrl: 'https://x' },
      loadKey: async () => undefined,
    });
    expect(exec.apiKey).toBeUndefined();
    expect(exec.baseUrl).toBe('https://x');
  });
});
