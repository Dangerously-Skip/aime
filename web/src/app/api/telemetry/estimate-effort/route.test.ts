import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';

/**
 * The effort estimate runs on the key saved in Settings when the request
 * carries none. The credential store is the real encrypted file under a temp
 * home; only the Anthropic HTTP client is stubbed, to record which key it got.
 */

const { homeRef, clientKeys } = vi.hoisted(() => ({
  homeRef: { value: '' },
  clientKeys: [] as Array<string | undefined>,
}));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  const homedir = () => homeRef.value || actual.homedir();
  return { ...actual, default: { ...actual, homedir }, homedir };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: '{"estimatedHours":2,"complexity":"low","reasoning":"r","taskType":"bug-fix","domain":"other","language":"ts"}' }],
      }),
    };
    constructor(opts: { apiKey?: string }) {
      clientKeys.push(opts.apiKey);
    }
  },
}));

import { POST } from './route';
import { getCredentialStore } from '@/lib/models/credentials';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-effort-'));
  homeRef.value = home;
  clientKeys.length = 0;
  vi.stubEnv('AIME_CRED_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('ANTHROPIC_API_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  homeRef.value = '';
  fs.rmSync(home, { recursive: true, force: true });
});

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/telemetry/estimate-effort', {
    method: 'POST',
    body: JSON.stringify({ toolCalls: [{ name: 'Edit', count: 2 }], artifactCount: 1, ...body }),
  }));

describe('POST /api/telemetry/estimate-effort', () => {
  it('uses the key saved in Settings when the request carries none', async () => {
    await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored' });
    const body = await (await post({})).json();
    expect(body.method).toBe('llm');
    expect(clientKeys).toEqual(['sk-ant-stored']);
  });

  it('falls back to the heuristic with no key anywhere', async () => {
    const body = await (await post({})).json();
    expect(body.method).toBe('heuristic');
    expect(clientKeys).toEqual([]);
  });

  it('prefers a key the request did carry', async () => {
    await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored' });
    await post({ apiKey: 'sk-ant-request' });
    expect(clientKeys).toEqual(['sk-ant-request']);
  });
});
