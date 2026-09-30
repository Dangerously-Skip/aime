import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';

const homeRef = vi.hoisted(() => ({ value: '' }));
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  const homedir = () => homeRef.value || actual.homedir();
  return { ...actual, default: { ...actual, homedir }, homedir };
});

import { GET } from './route';
import { getCredentialStore } from '@/lib/models/credentials';

let home: string;
beforeEach(() => {
  // A temp home and NO master key by default, so the real ~/.aime store on the
  // machine running this can never answer for a test.
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-models-route-'));
  homeRef.value = home;
  vi.stubEnv('AIME_CRED_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  homeRef.value = '';
  fs.rmSync(home, { recursive: true, force: true });
});

describe('GET /api/models', () => {
  it('returns registry models including Fable, with metadata', async () => {
    const body = await (await GET()).json();
    const ids = body.models.map((m: { id: string }) => m.id);
    expect(ids).toContain('claude-fable');
    expect(ids).toContain('claude-opus');

    const fable = body.models.find((m: { id: string }) => m.id === 'claude-fable');
    expect(fable.driverModel).toBe('claude-fable-5');
    expect(fable.capabilities).toContain('code');
    expect(fable.pricing).toEqual({ inputPer1kUsd: 0.01, outputPer1kUsd: 0.05 });
  });

  it('exposes the tier order with stallion premium-most', async () => {
    const body = await (await GET()).json();
    expect(body.tiers).toEqual(['stallion', 'smort', 'good', 'cheap']);
    expect(body.default).toEqual({ capability: 'chat', tier: 'good' });
  });

  it('reports which tiers each capability can route to', async () => {
    const body = await (await GET()).json();
    // code has a stallion tier; chat does not
    expect(body.routing.code).toContain('stallion');
    expect(body.routing.chat).not.toContain('stallion');
    expect(body.capabilities).toEqual(expect.arrayContaining(['chat', 'code']));
  });

  // The picker gates the "Built-in (Claude)" group on this: a BYOK-only user was
  // offered three Claude models their key could never reach.
  describe('built-in credential reporting', () => {
    it('reports an env Anthropic key as a boolean, never the key', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret');
      const body = await (await GET()).json();
      expect(body.anthropic).toBe(true);
      expect(JSON.stringify(body)).not.toContain('sk-ant-secret');
    });

    it('reports the key saved in Settings (the credential store), never the key', async () => {
      // The surfaces no longer hold the key, so this is how the client learns
      // the built-in models are reachable. A real encrypted store, not a mock.
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('AIME_CRED_KEY', randomBytes(32).toString('hex'));
      expect((await (await GET()).json()).anthropic).toBe(false);
      await getCredentialStore().set('anthropic', { apiKey: 'sk-ant-stored-secret' });
      const body = await (await GET()).json();
      expect(body.anthropic).toBe(true);
      expect(JSON.stringify(body)).not.toContain('sk-ant-stored-secret');
    });

    it('reports false with no env key', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      const body = await (await GET()).json();
      expect(body.anthropic).toBe(false);
    });

    it('reports Bedrock from the real detector, both ways', async () => {
      // `expect(typeof body.bedrock).toBe('boolean')` passed for a hardcoded
      // false, which would have removed every Claude model from the picker for a
      // Bedrock-only user with no failing test anywhere.
      // isBedrockConfigured wants a region AND a credential source.
      vi.stubEnv('AWS_REGION', 'us-east-1');
      vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAEXAMPLE');
      expect((await (await GET()).json()).bedrock).toBe(true);

      // Region alone is not enough — assert the AND, not just the happy path.
      vi.stubEnv('AWS_ACCESS_KEY_ID', '');
      vi.stubEnv('AWS_PROFILE', '');
      vi.stubEnv('AWS_BEARER_TOKEN_BEDROCK', '');
      expect((await (await GET()).json()).bedrock).toBe(false);

      vi.stubEnv('AWS_REGION', '');
      vi.stubEnv('AWS_DEFAULT_REGION', '');
      expect((await (await GET()).json()).bedrock).toBe(false);
    });
  });
});
