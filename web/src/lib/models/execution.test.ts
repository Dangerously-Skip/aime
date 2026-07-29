import { describe, it, expect, vi } from 'vitest';
import { resolveExecution, buildShimBaseUrl , bedrockEnvFrom, vertexEnvFrom } from './execution';

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
    // The SDK appends `/v1/messages`, so the trailing /v1 must be gone or the
    // request becomes /api/v1/v1/messages — a 404 the SDK reports as "issue with
    // the selected model".
    expect(exec).toEqual({ apiKey: 'sk-keychain', baseUrl: 'https://openrouter.ai/api' });
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
    expect(exec.baseUrl).toBe('https://gw.internal'); // trailing /v1 dropped for the SDK
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

/**
 * P1.6: Bedrock and Vertex are configured by ENVIRONMENT, not by key + base URL.
 *
 * Until this existed, both were reachable only through the server's own
 * `process.env`. Their presets declared `awsRegion`, `vertexProject` and the
 * rest, the Settings form had inputs for none of them, and nothing read them if
 * it had — a provider you could add but never use. Same shape as the security
 * toggles that filtered a name out of a list and changed nothing.
 */
describe('bedrockEnvFrom', () => {
  it('always turns Bedrock on, and passes the region through', () => {
    expect(bedrockEnvFrom({ awsRegion: 'us-east-1' })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
    });
  });

  it('passes a key pair through, with the session token when present', () => {
    expect(
      bedrockEnvFrom({
        awsRegion: 'eu-west-1',
        awsAccessKeyId: 'AKIA1',
        awsSecretAccessKey: 'secret',
        awsSessionToken: 'tok',
      }),
    ).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'eu-west-1',
      AWS_ACCESS_KEY_ID: 'AKIA1',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_SESSION_TOKEN: 'tok',
    });
  });

  /**
   * A lone id cannot authenticate, and exporting it would SHADOW the ambient
   * credentials that would otherwise have worked — turning a half-filled form
   * into a broken provider rather than a working one.
   */
  it('emits neither half of an incomplete key pair', () => {
    expect(bedrockEnvFrom({ awsRegion: 'us-east-1', awsAccessKeyId: 'AKIA1' })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
    });
    expect(bedrockEnvFrom({ awsSecretAccessKey: 'secret' })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: '1',
    });
  });

  it('with nothing configured, still selects Bedrock and leaves auth ambient', () => {
    expect(bedrockEnvFrom({})).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1' });
  });
});

describe('vertexEnvFrom', () => {
  it('maps project and region onto the SDK names', () => {
    expect(vertexEnvFrom({ vertexProject: 'proj-1', vertexRegion: 'us-east5' })).toEqual({
      CLAUDE_CODE_USE_VERTEX: '1',
      ANTHROPIC_VERTEX_PROJECT_ID: 'proj-1',
      CLOUD_ML_REGION: 'us-east5',
    });
  });

  it('still selects Vertex with nothing configured', () => {
    expect(vertexEnvFrom({})).toEqual({ CLAUDE_CODE_USE_VERTEX: '1' });
  });
});

describe('resolveExecution — environment-driven providers', () => {
  it('returns env for a Bedrock provider, and no key or base URL', async () => {
    const out = await resolveExecution({
      providerConfig: { providerId: 'p1', agentMode: 'bedrock' },
      loadFields: async () => ({ awsRegion: 'us-east-1', awsAccessKeyId: 'A', awsSecretAccessKey: 'S' }),
    });
    expect(out.env).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' });
    expect(out.apiKey).toBeUndefined();
    expect(out.baseUrl).toBeUndefined();
  });

  it('returns env for a Vertex provider', async () => {
    const out = await resolveExecution({
      providerConfig: { providerId: 'p2', agentMode: 'vertex' },
      loadFields: async () => ({ vertexProject: 'proj-1' }),
    });
    expect(out.env).toMatchObject({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_PROJECT_ID: 'proj-1' });
  });

  it('works with no stored fields at all — ambient credentials', async () => {
    const out = await resolveExecution({ providerConfig: { providerId: 'p3', agentMode: 'bedrock' } });
    expect(out.env).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1' });
  });

  it('leaves an ordinary key-based provider on the key path', async () => {
    const out = await resolveExecution({
      providerConfig: { providerId: 'p4', agentMode: 'api-key', baseUrl: 'https://openrouter.ai/api/v1' },
      loadKey: async () => 'sk-or',
    });
    expect(out.env).toBeUndefined();
    expect(out.apiKey).toBe('sk-or');
  });

  it('treats a missing agentMode as api-key, so existing configs are unchanged', async () => {
    const out = await resolveExecution({
      providerConfig: { providerId: 'p5', baseUrl: 'https://openrouter.ai/api/v1' },
      loadKey: async () => 'sk-or',
    });
    expect(out.env).toBeUndefined();
    expect(out.apiKey).toBe('sk-or');
  });
});
