import { describe, it, expect, vi } from 'vitest';
import { createTurnClient, toBedrockModelId, toVertexModelId } from './turn-client';

/**
 * The browser surface used to refuse Bedrock with a 501 because it calls the raw
 * Messages API and Bedrock support lives in the Agent SDK's subprocess. These
 * tests pin the three constructions apart, since the failure mode is silent: a
 * Bedrock user routed to the plain Anthropic client does not get an error about
 * Bedrock, they get an authentication failure about a key they never had.
 *
 * The Anthropic and Bedrock constructors are REAL, because their behaviour is
 * what the route depends on — in particular Bedrock throwing when it cannot
 * resolve a region, which is why the route wraps construction in a try/catch.
 *
 * Vertex is the exception and is mocked: its constructor starts a Google
 * application-default-credentials lookup in the background, which on a machine
 * with no GCP credentials resolves to an unhandled rejection AFTER the test has
 * passed. That is a real side effect, not a nuisance — it would leave a
 * permanent "1 unhandled error" in every suite run, which is exactly the kind of
 * ambient noise that trains people to ignore a red line. What this file needs
 * from Vertex is that the right class is chosen and the id is left bare; both
 * survive the mock.
 */
vi.mock('@anthropic-ai/vertex-sdk', () => {
  class FakeVertex {
    messages = { stream: vi.fn() };
    constructor(public opts: Record<string, unknown>) {}
  }
  return { AnthropicVertex: FakeVertex };
});

const bedrockEnv = {
  CLAUDE_CODE_USE_BEDROCK: '1',
  AWS_REGION: 'ap-southeast-2',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'secret',
};

const vertexEnv = {
  CLAUDE_CODE_USE_VERTEX: '1',
  ANTHROPIC_VERTEX_PROJECT_ID: 'my-project',
  CLOUD_ML_REGION: 'us-east5',
};

describe('model id spelling per backend', () => {
  it('namespaces for Bedrock', () => {
    expect(toBedrockModelId('claude-opus-5')).toBe('anthropic.claude-opus-5');
  });

  // `anthropic.anthropic.claude-…` is a 404 that reads like a missing model.
  it('never double-namespaces an id the user already pinned', () => {
    expect(toBedrockModelId('anthropic.claude-opus-5')).toBe('anthropic.claude-opus-5');
  });

  it('leaves Vertex ids bare', () => {
    expect(toVertexModelId('claude-opus-5')).toBe('claude-opus-5');
  });
});

describe('createTurnClient picks the backend from the resolved execution', () => {
  it('builds a Bedrock client from a provider-configured Bedrock env', () => {
    const target = createTurnClient({ exec: { env: bedrockEnv }, model: 'claude-opus-5' });
    expect(target.backend).toBe('bedrock');
    expect(target.model).toBe('anthropic.claude-opus-5');
    expect(target.client.messages.stream).toBeTypeOf('function');
  });

  /**
   * The half of the bug that was easy to miss: a user whose SERVER env is set up
   * for Bedrock never adds a provider in Settings, so `resolveExecution` returns
   * nothing at all. The route fills `env` from `getBedrockEnv()` in that case —
   * which is what this shape represents — rather than carrying a second
   * "ambient" flag that could disagree with the env.
   */
  it('builds a Bedrock client for an ambient server configuration', () => {
    const target = createTurnClient({
      exec: { env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'ap-southeast-2' } },
      model: 'claude-opus-5',
    });
    expect(target.backend).toBe('bedrock');
    expect(target.model).toBe('anthropic.claude-opus-5');
  });

  /**
   * The Bedrock client THROWS on incomplete config rather than returning an
   * error. The route catches it and answers 400; this pins the behaviour so the
   * catch there is not mistaken for defensive habit and removed.
   */
  it('throws when the region cannot be resolved, rather than half-working', () => {
    const priorRegion = process.env.AWS_REGION;
    const priorDefault = process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    try {
      expect(() =>
        createTurnClient({ exec: { env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, model: 'claude-opus-5' }),
      ).toThrow(/region/i);
    } finally {
      if (priorRegion !== undefined) process.env.AWS_REGION = priorRegion;
      if (priorDefault !== undefined) process.env.AWS_DEFAULT_REGION = priorDefault;
    }
  });

  it('builds a Vertex client from a Vertex env', () => {
    const target = createTurnClient({ exec: { env: vertexEnv }, model: 'claude-opus-5' });
    expect(target.backend).toBe('vertex');
    expect(target.model).toBe('claude-opus-5');
    expect(target.client.messages.stream).toBeTypeOf('function');
  });

  it('builds a plain Anthropic client when there is a key and no gateway env', () => {
    const target = createTurnClient({ exec: { apiKey: 'sk-x' }, model: 'claude-opus-5' });
    expect(target.backend).toBe('anthropic');
    expect(target.model).toBe('claude-opus-5');
  });

  it('honours a user provider base URL on the plain path', () => {
    const target = createTurnClient({
      exec: { apiKey: 'sk-x', baseUrl: 'http://localhost:3000/api/shim/p1' },
      model: 'kimi-k2',
    });
    expect(target.backend).toBe('anthropic');
    expect(target.model).toBe('kimi-k2');
  });

  // Bedrock wins over a stray key, matching the Agent SDK path where the env
  // decides the backend. Otherwise a leftover ANTHROPIC_API_KEY would silently
  // bill the wrong account.
  it('prefers Bedrock over an api key when both are present', () => {
    const target = createTurnClient({
      exec: { env: bedrockEnv, apiKey: 'sk-leftover' },
      model: 'claude-opus-5',
    });
    expect(target.backend).toBe('bedrock');
  });

  it('does not require AWS credentials — the default chain is valid config', () => {
    // Instance roles, SSO and named profiles all resolve inside the SDK. Making
    // credentials mandatory here would break exactly those setups.
    const target = createTurnClient({
      exec: { env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' } },
      model: 'claude-opus-5',
    });
    expect(target.backend).toBe('bedrock');
  });
});
