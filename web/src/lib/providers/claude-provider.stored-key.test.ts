import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { QueryParams } from './base-provider';

/**
 * The Anthropic key saved in Settings reaches the SDK when a request carries
 * none.
 *
 * The surfaces are taking the key out of the browser and stop sending it, so
 * this is the path every built-in turn takes. The credential store here is the
 * REAL encrypted file under a temp home with a real master key — a mocked
 * `getServerAnthropicKey` would agree with a provider that never asked it.
 * Only the SDK subprocess is stubbed.
 */

const { queryMock, homeRef } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  homeRef: { value: '' },
}));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: { ...actual, homedir: () => homeRef.value }, homedir: () => homeRef.value };
});

vi.mock('../security/settings', async (orig) => {
  const actual = await orig<typeof import('../security/settings')>();
  return {
    ...actual,
    loadSecuritySettings: async () => ({
      blockDangerousCommands: false,
      restrictToProjectFolder: false,
      disableBashTool: false,
    }),
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
  tool: (name: string, description: string, schema: unknown, handler: unknown) =>
    ({ name, description, schema, handler }),
  createSdkMcpServer: (config: unknown) => config,
}));

import { ClaudeProvider } from './claude-provider';
import { getCredentialStore } from '../models/credentials';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-stored-key-'));
  homeRef.value = home;
  vi.stubEnv('AIME_CRED_KEY', randomBytes(32).toString('hex'));
  for (const k of ['ANTHROPIC_API_KEY', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_USE_BEDROCK']) {
    vi.stubEnv(k, '');
  }
  queryMock.mockReset();
  queryMock.mockImplementation(async function* () {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

async function sdkEnv(params: Partial<QueryParams>): Promise<Record<string, string>> {
  const provider = new ClaudeProvider();
  for await (const _ of provider.query({ prompt: 'hi', chatId: 'c1', ...params } as QueryParams)) {
    // drain
  }
  const call = queryMock.mock.calls.at(-1)![0] as { options: { env: Record<string, string> } };
  return call.options.env;
}

describe('ClaudeProvider — the stored Anthropic key', () => {
  it('is used when the request carries no key', async () => {
    await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored' });
    const env = await sdkEnv({});
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-stored');
  });

  it('loses to a key the request did carry', async () => {
    await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored' });
    const env = await sdkEnv({ apiKey: 'sk-ant-request' });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-request');
  });

  it('is never handed to a user-added provider (base URL) or a Bedrock/Vertex env', async () => {
    await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored' });
    const viaBaseUrl = await sdkEnv({ baseUrl: 'http://127.0.0.1:11434' });
    expect(viaBaseUrl.ANTHROPIC_API_KEY ?? '').not.toBe('sk-ant-stored');
    const viaEnv = await sdkEnv({ providerEnv: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' } });
    expect(viaEnv.ANTHROPIC_API_KEY ?? '').not.toBe('sk-ant-stored');
  });

  it('does not let a keyless user-added provider inherit the HOST’s ANTHROPIC_API_KEY', async () => {
    // Regression: the subprocess env is a copy of process.env, so with a base
    // URL and no key it presented the host's Anthropic key to that URL.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-host');
    const env = await sdkEnv({ baseUrl: 'https://openrouter.ai/api' });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();

    // The provider's own key still goes through.
    const withKey = await sdkEnv({ baseUrl: 'https://openrouter.ai/api', apiKey: 'sk-or' });
    expect(withKey.ANTHROPIC_API_KEY).toBe('sk-or');
    // And the built-in path keeps the host key.
    expect((await sdkEnv({})).ANTHROPIC_API_KEY).toBe('sk-ant-host');
  });

  it('leaves the env alone when nothing is stored', async () => {
    const env = await sdkEnv({});
    expect(env.ANTHROPIC_API_KEY ?? '').toBe('');
  });
});
