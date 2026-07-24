import { describe, it, expect, vi } from 'vitest';
import { scanModels, ScanError, FAL_STATIC_MODELS } from './scan';
import { getPreset } from './providers';

/** A fetch stub returning the given JSON. Captures the last call. */
function jsonFetch(payload: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok, status, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const anthropic = getPreset('anthropic')!;
const openai = getPreset('openai')!;
const openrouter = getPreset('openrouter')!;
const groq = getPreset('groq')!;
const fal = getPreset('fal')!;
const bedrock = getPreset('bedrock')!;
const local = getPreset('local')!;

describe('scanModels', () => {
  it('throws for providers without model discovery', async () => {
    await expect(scanModels(bedrock, { apiKey: 'x' })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('returns the static Fal catalog without fetching', async () => {
    const { fetchImpl } = jsonFetch({});
    const models = await scanModels(fal, { apiKey: 'x', fetchImpl });
    expect(models).toEqual(FAL_STATIC_MODELS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires an API key when the provider needs one', async () => {
    await expect(scanModels(openai, {})).rejects.toMatchObject({ code: 'no-key' });
  });

  it('normalizes an OpenAI-shape list (ids only)', async () => {
    const { fetchImpl, calls } = jsonFetch({ data: [{ id: 'gpt-5' }, { id: 'o4-mini' }, { bad: true }] });
    const models = await scanModels(openai, { apiKey: 'sk-x', fetchImpl });
    expect(models).toEqual([
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o4-mini', label: 'o4-mini' },
    ]);
    expect(calls[0].url).toBe('https://api.openai.com/v1/models');
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
  });

  it('normalizes an Anthropic-shape list and sends x-api-key', async () => {
    const { fetchImpl, calls } = jsonFetch({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] });
    const models = await scanModels(anthropic, { apiKey: 'sk-ant', fetchImpl });
    expect(models[0]).toEqual({ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', capabilities: ['chat', 'code'] });
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('normalizes an OpenRouter list with pricing, context, and inferred capabilities', async () => {
    const { fetchImpl } = jsonFetch({
      data: [
        {
          id: 'moonshotai/kimi-k2',
          name: 'Kimi K2',
          context_length: 200000,
          pricing: { prompt: '0.000002', completion: '0.000006' },
          architecture: { modality: 'text->text', output_modalities: ['text'] },
        },
        {
          id: 'black-forest-labs/flux',
          name: 'FLUX',
          architecture: { output_modalities: ['image'] },
        },
      ],
    });
    const models = await scanModels(openrouter, { apiKey: 'sk-or', fetchImpl });

    expect(models[0]).toMatchObject({
      id: 'moonshotai/kimi-k2',
      label: 'Kimi K2',
      contextWindow: 200000,
      capabilities: ['chat', 'code'],
    });
    // per-token → per-1k
    expect(models[0].pricing).toEqual({ inputPer1kUsd: 0.002, outputPer1kUsd: 0.006 });
    expect(models[1].capabilities).toEqual(['image']);
  });

  it('honours a base-URL override', async () => {
    const { fetchImpl, calls } = jsonFetch({ data: [] });
    await scanModels(local, { baseUrl: 'http://localhost:1234/v1', fetchImpl });
    expect(calls[0].url).toBe('http://localhost:1234/v1/models');
  });

  it('sends no auth header for a keyless local provider', async () => {
    const { fetchImpl, calls } = jsonFetch({ data: [{ id: 'llama3' }] });
    await scanModels(local, { fetchImpl });
    expect(calls[0].init!.headers).toEqual({});
  });

  it('throws a ScanError on an HTTP error', async () => {
    const { fetchImpl } = jsonFetch({}, false, 401);
    await expect(scanModels(groq, { apiKey: 'bad', fetchImpl })).rejects.toMatchObject({ code: 'http' });
  });

  it('throws a ScanError on a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(scanModels(openai, { apiKey: 'x', fetchImpl })).rejects.toBeInstanceOf(ScanError);
  });

  it('throws a ScanError on non-JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('bad json'); },
    }) as unknown as Response) as unknown as typeof fetch;
    await expect(scanModels(openai, { apiKey: 'x', fetchImpl })).rejects.toMatchObject({ code: 'parse' });
  });
});
