import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { ScanError } from '@/lib/models/scan';

const { scanMock } = vi.hoisted(() => ({ scanMock: vi.fn() }));
vi.mock('@/lib/models/scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/scan')>();
  return { ...actual, scanModels: scanMock };
});

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/models/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  scanMock.mockReset();
});

describe('POST /api/models/scan', () => {
  it('rejects malformed JSON', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('requires presetId', async () => {
    const res = await post({ apiKey: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('presetId');
  });

  it('rejects an unknown provider', async () => {
    const res = await post({ presetId: 'nope', apiKey: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Unknown provider');
  });

  it('422s a provider that does not support discovery (before scanning)', async () => {
    const res = await post({ presetId: 'bedrock', apiKey: 'x' });
    expect(res.status).toBe(422);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('requires an API key for key-based providers', async () => {
    const res = await post({ presetId: 'openai' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('API key');
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('returns scanned models on success', async () => {
    scanMock.mockResolvedValue([{ id: 'gpt-5', label: 'gpt-5' }]);
    const res = await post({ presetId: 'openai', apiKey: 'sk-x', baseUrl: 'https://x/v1' });
    expect(res.status).toBe(200);
    expect((await res.json()).models).toEqual([{ id: 'gpt-5', label: 'gpt-5' }]);

    const [preset, opts] = scanMock.mock.calls[0];
    expect(preset.id).toBe('openai');
    expect(opts).toMatchObject({ apiKey: 'sk-x', baseUrl: 'https://x/v1' });
  });

  it('scans a keyless local provider', async () => {
    scanMock.mockResolvedValue([{ id: 'llama3', label: 'llama3' }]);
    const res = await post({ presetId: 'local', baseUrl: 'http://localhost:11434/v1' });
    expect(res.status).toBe(200);
  });

  it('maps a ScanError http failure to 502', async () => {
    scanMock.mockRejectedValue(new ScanError('OpenAI returned HTTP 401', 'http'));
    const res = await post({ presetId: 'openai', apiKey: 'bad' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('http');
  });
});
