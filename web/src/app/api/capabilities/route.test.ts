import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/capabilities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/capabilities', () => {
  it('runs a FAL image generation with a transient key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ images: [{ url: 'https://cdn/x.png' }] }), { status: 200 }),
    );
    const res = await POST(
      req({
        capability: 'image',
        model: 'fal-ai/flux/dev',
        apiKey: 'fal-key',
        providerConfig: { providerId: 'fal-1', transport: 'native-fal', baseUrl: 'https://fal.run' },
        prompt: 'a fox',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ capability: 'image', images: [{ url: 'https://cdn/x.png' }] });
  });

  it('rejects an unknown capability', async () => {
    const res = await POST(req({ capability: 'video', model: 'm', providerConfig: { transport: 'native-fal' } }));
    expect(res.status).toBe(400);
  });

  it('requires a model', async () => {
    const res = await POST(req({ capability: 'image', providerConfig: { transport: 'native-fal' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('model');
  });

  it('requires a transport', async () => {
    const res = await POST(req({ capability: 'image', model: 'm' }));
    expect(res.status).toBe(400);
  });

  it('maps a CapabilityError status/code through to the response', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 401 }));
    const res = await POST(
      req({
        capability: 'embedding',
        model: 'text-embedding-3-small',
        apiKey: 'sk',
        providerConfig: { providerId: 'oa', transport: 'openai-compat', baseUrl: 'https://api.openai.com/v1' },
        input: 'hello',
      }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('http');
  });
});
