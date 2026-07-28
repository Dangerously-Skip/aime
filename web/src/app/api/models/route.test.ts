import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

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

    it('reports false with no env key', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      const body = await (await GET()).json();
      expect(body.anthropic).toBe(false);
    });

    it('still reports Bedrock alongside it', async () => {
      const body = await (await GET()).json();
      expect(typeof body.bedrock).toBe('boolean');
    });
  });
});
