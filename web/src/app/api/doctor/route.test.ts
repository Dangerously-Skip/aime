import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { createCredentialStore } from '@/lib/models/credentials';
import {
  agentSdkCheck,
  identityFileCheck,
  logFileCheck,
  modelAccessCheck,
  parseProviderSummaries,
  type HealthCheck,
  type ModelAccessInputs,
} from './checks';

/**
 * The doctor used to check one thing for model access — ANTHROPIC_API_KEY in
 * the server env — so it told everyone who saved a key in Settings, or used
 * OpenRouter or a local model, that they had none; and it passed Bedrock on
 * AWS_REGION alone.
 *
 * The route tests use the REAL encrypted credential store on a temp HOME: "a
 * key saved in Settings counts" is exactly a claim about that store.
 */

const ENV_KEYS = [
  'HOME', 'AIME_CRED_KEY', 'ANTHROPIC_API_KEY', 'AWS_REGION', 'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK', 'AIME_USER_DATA_DIR', 'AIME_SDK_CLI_PATH',
] as const;
let saved: Record<string, string | undefined>;
let home: string;
const hexKey = randomBytes(32).toString('hex');

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-doctor-'));
  process.env.HOME = home;
  process.env.AIME_CRED_KEY = hexKey;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(home, { recursive: true, force: true });
});

const store = () =>
  createCredentialStore(Buffer.from(hexKey, 'hex'), path.join(home, '.aime', 'credentials.enc'));

async function check(res: Response, id: string): Promise<HealthCheck> {
  const body = (await res.json()) as { checks: HealthCheck[] };
  return body.checks.find((c) => c.id === id)!;
}

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/doctor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/doctor model access (real credential store)', () => {
  it('warns when there is genuinely nothing', async () => {
    const c = await check(await GET(new NextRequest('http://localhost/api/doctor')), 'model_access');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/No model is configured/);
  });

  it('counts an Anthropic key saved in Settings, with no env key at all', async () => {
    await store().set('anthropic', { apiKey: 'sk-ant-x' });
    const c = await check(await GET(new NextRequest('http://localhost/api/doctor')), 'model_access');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/Anthropic key saved in Settings/);
  });

  it('counts an OpenRouter key the client reports and the store holds', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    await store().set(id, { apiKey: 'sk-or-x' });
    const res = await POST(post({
      providers: [{ id, presetId: 'openrouter', label: 'OpenRouter', enabled: true, modelCount: 300, hasCredentials: true }],
    }));
    const c = await check(res, 'model_access');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/OpenRouter key saved/);
  });

  it('counts a keyless local provider, which only the client knows about', async () => {
    const res = await POST(post({
      providers: [{ id: 'l1', presetId: 'local', label: 'Ollama', enabled: true, modelCount: 2, hasCredentials: false }],
    }));
    const c = await check(res, 'model_access');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/Ollama \(2 models\)/);
  });

  it('does not pass Bedrock on AWS_REGION alone', async () => {
    process.env.AWS_REGION = 'us-east-1';
    const c = await check(await GET(new NextRequest('http://localhost/api/doctor')), 'model_access');
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/no AWS credentials/);
  });

  it('treats missing identity files as information, not a warning', async () => {
    const body = (await (await GET(new NextRequest('http://localhost/api/doctor'))).json()) as { checks: HealthCheck[] };
    for (const id of ['soul_md', 'user_md', 'memory_md']) {
      const c = body.checks.find((x) => x.id === id)!;
      expect(c.status).toBe('ok');
      expect(c.message).toMatch(/optional/);
    }
  });

  it('reports the log file and the Agent SDK', async () => {
    process.env.AIME_USER_DATA_DIR = path.join(home, 'userData');
    const res = await GET(new NextRequest('http://localhost/api/doctor'));
    const body = (await res.json()) as { checks: HealthCheck[] };
    expect(body.checks.find((c) => c.id === 'log_file')!.message).toContain(path.join(home, 'userData', 'logs', 'aime.log'));
    expect(body.checks.find((c) => c.id === 'agent_sdk')).toBeTruthy();
  });
});

describe('modelAccessCheck', () => {
  const none: ModelAccessInputs = {
    envAnthropicKey: false,
    bedrock: { region: false, credentials: false },
    store: { status: 'ok', ids: [] },
    providers: [],
  };

  it('flags a key the client thinks is saved but the store does not have', () => {
    const c = modelAccessCheck({
      ...none,
      envAnthropicKey: true,
      providers: [{ id: 'p1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, modelCount: 1, hasCredentials: true }],
    });
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/missing from the credential store/);
  });

  it('says why saved keys cannot be read when the store has no master key', () => {
    const c = modelAccessCheck({ ...none, store: { status: 'unavailable', ids: [] } });
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/restart the app/);
  });

  it('accepts Bedrock with region AND credentials', () => {
    expect(modelAccessCheck({ ...none, bedrock: { region: true, credentials: true } }).status).toBe('ok');
  });
});

describe('parseProviderSummaries', () => {
  it('keeps well-formed entries, drops the rest, and caps the list', () => {
    const good = { id: 'a', presetId: 'local', label: 'L', enabled: true, modelCount: 1, hasCredentials: false };
    expect(parseProviderSummaries([good, { id: 5 }, null, 'x'])).toEqual([good]);
    expect(parseProviderSummaries('nope')).toEqual([]);
    expect(parseProviderSummaries(Array.from({ length: 80 }, () => good))).toHaveLength(50);
  });
});

describe('agentSdkCheck', () => {
  it('finds the per-platform native binary', () => {
    const c = agentSdkCheck({
      nodeModulesDir: '/nm', platform: 'darwin', arch: 'arm64',
      exists: (p) => p === path.join('/nm', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'),
    });
    expect(c.status).toBe('ok');
  });

  it('errors when the packaged path is missing', () => {
    const c = agentSdkCheck({ envCliPath: '/x/cli.js', nodeModulesDir: '/nm', platform: 'linux', arch: 'x64', exists: () => false });
    expect(c.status).toBe('error');
  });
});

describe('logFileCheck / identityFileCheck', () => {
  it('says where logs go in development', () => {
    expect(logFileCheck(undefined, () => false).message).toMatch(/terminal/);
  });
  it('reports a present identity file as found', () => {
    expect(identityFileCheck('soul_md', 'SOUL.md', '/h/.claude/SOUL.md', true).message).toMatch(/found/);
  });
});
