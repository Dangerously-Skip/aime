import { describe, it, expect, vi } from 'vitest';
import { runCapability, CapabilityError, type CapabilityCall } from './capabilities';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

const base = (over: Partial<CapabilityCall>): CapabilityCall => ({
  capability: 'image',
  transport: 'native-fal',
  model: 'fal-ai/flux/dev',
  apiKey: 'fal-key',
  ...over,
});

describe('runCapability — FAL images', () => {
  it('POSTs to <base>/<model> with a Key auth header and normalizes images', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ images: [{ url: 'https://cdn/img.png' }] }));
    const res = await runCapability(base({ prompt: 'a cat' }), fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux/dev');
    expect((init.headers as Record<string, string>).authorization).toBe('Key fal-key');
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a cat' });
    expect(res).toEqual({ capability: 'image', images: [{ url: 'https://cdn/img.png' }] });
  });

  it('extracts a mesh URL from a FAL mesh payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ model_mesh: { url: 'https://cdn/model.glb' } }));
    const res = await runCapability(
      base({ capability: 'mesh3d', model: 'fal-ai/triposr', prompt: 'https://cdn/in.png' }),
      fetchMock,
    );
    expect(res).toEqual({ capability: 'mesh3d', mesh: { url: 'https://cdn/model.glb', format: 'glb' } });
  });

  it('rejects FAL without a key', async () => {
    await expect(runCapability(base({ apiKey: undefined }), vi.fn())).rejects.toMatchObject({ code: 'no-key' });
  });

  it('rejects embeddings on FAL', async () => {
    await expect(runCapability(base({ capability: 'embedding' }), vi.fn())).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('runCapability — OpenAI-compat', () => {
  it('generates an image via /images/generations with a Bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: 'AAAA' }] }));
    const res = await runCapability(
      base({ transport: 'openai-compat', model: 'dall-e-3', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', prompt: 'x', size: '1024x1024' }),
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk');
    expect(res).toEqual({ capability: 'image', images: [{ url: undefined, b64: 'AAAA' }] });
  });

  it('embeds text via /embeddings and orders vectors by index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] }),
    );
    const res = await runCapability(
      base({ capability: 'embedding', transport: 'openai-compat', model: 'text-embedding-3-small', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', input: ['a', 'b'] }),
      fetchMock,
    );
    expect(res).toEqual({
      capability: 'embedding',
      model: 'text-embedding-3-small',
      embeddings: [[1, 2], [3, 4]],
    });
  });

  it('rejects mesh3d on openai-compat', async () => {
    await expect(
      runCapability(base({ capability: 'mesh3d', transport: 'openai-compat', baseUrl: 'https://x' }), vi.fn()),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('surfaces an upstream 401 as an http CapabilityError with status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(
      runCapability(base({ transport: 'openai-compat', baseUrl: 'https://x', apiKey: 'sk', prompt: 'p' }), fetchMock),
    ).rejects.toMatchObject({ code: 'http', status: 401 });
  });
});

describe('runCapability — anthropic-native', () => {
  it('refuses capability calls (agent-loop models only)', async () => {
    await expect(
      runCapability(base({ transport: 'anthropic-native' }), vi.fn()),
    ).rejects.toBeInstanceOf(CapabilityError);
  });
});
