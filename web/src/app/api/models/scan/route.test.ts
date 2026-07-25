import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { ScanError } from '@/lib/models/scan';

const { scanMock, getFieldMock } = vi.hoisted(() => ({ scanMock: vi.fn(), getFieldMock: vi.fn() }));
vi.mock('@/lib/models/scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/scan')>();
  return { ...actual, scanModels: scanMock };
});
vi.mock('@/lib/models/credentials', () => ({
  getCredentialStore: () => ({ getField: getFieldMock }),
  CredentialStoreUnavailable: class extends Error {},
}));

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
  getFieldMock.mockReset();
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

  it('rescan: reads the stored key from the keychain by providerId', async () => {
    getFieldMock.mockResolvedValue('sk-stored');
    scanMock.mockResolvedValue([{ id: 'gpt-5', label: 'gpt-5' }]);
    const res = await post({ presetId: 'openai', providerId: 'prov-1', baseUrl: 'https://x/v1' });
    expect(res.status).toBe(200);
    expect(getFieldMock).toHaveBeenCalledWith('prov-1', 'apiKey');
    expect(scanMock.mock.calls[0][1]).toMatchObject({ apiKey: 'sk-stored' });
  });

  it('rescan: a transient key still wins over the keychain', async () => {
    getFieldMock.mockResolvedValue('sk-stored');
    scanMock.mockResolvedValue([]);
    await post({ presetId: 'openai', providerId: 'prov-1', apiKey: 'sk-transient' });
    expect(getFieldMock).not.toHaveBeenCalled();
    expect(scanMock.mock.calls[0][1]).toMatchObject({ apiKey: 'sk-transient' });
  });

  it('rescan: keychain unavailable falls through to the needs-key error', async () => {
    getFieldMock.mockRejectedValue(new Error('unavailable'));
    const res = await post({ presetId: 'openai', providerId: 'prov-1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('API key');
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('maps a ScanError http failure to 502', async () => {
    scanMock.mockRejectedValue(new ScanError('OpenAI returned HTTP 401', 'http'));
    const res = await post({ presetId: 'openai', apiKey: 'bad' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('http');
  });
});
