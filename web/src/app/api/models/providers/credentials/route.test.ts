import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from './route';
import { CredentialStoreUnavailable } from '@/lib/models/credentials';

const store = {
  get: vi.fn(),
  getField: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};
const { getStoreMock } = vi.hoisted(() => ({ getStoreMock: vi.fn() }));
vi.mock('@/lib/models/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/credentials')>();
  return { ...actual, getCredentialStore: getStoreMock };
});

const req = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/models/providers/credentials', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getStoreMock.mockReturnValue(store);
});

describe('POST (set credentials)', () => {
  it('stores non-empty string values and never echoes them', async () => {
    const res = await POST(req('POST', { providerId: 'openai', values: { apiKey: 'sk-secret', empty: '', n: 5 } }));
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    // only the non-empty string field is stored
    expect(store.set).toHaveBeenCalledWith('openai', { apiKey: 'sk-secret' });
  });

  it('requires providerId and an object of values', async () => {
    expect((await POST(req('POST', { values: { apiKey: 'x' } })).then((r) => r.status))).toBe(400);
    expect((await POST(req('POST', { providerId: 'openai' })).then((r) => r.status))).toBe(400);
    expect((await POST(req('POST', { providerId: 'openai', values: {} })).then((r) => r.status))).toBe(400);
    expect(store.set).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    expect((await POST(req('POST', 'nope'))).status).toBe(400);
  });

  it('returns 503 when the keychain is unavailable', async () => {
    getStoreMock.mockImplementation(() => { throw new CredentialStoreUnavailable('no key'); });
    const res = await POST(req('POST', { providerId: 'openai', values: { apiKey: 'x' } }));
    expect(res.status).toBe(503);
  });
});

describe('DELETE / GET', () => {
  it('deletes a provider record', async () => {
    const res = await DELETE(req('DELETE', { providerId: 'openai' }));
    expect(res.status).toBe(200);
    expect(store.delete).toHaveBeenCalledWith('openai');
  });

  it('DELETE requires providerId', async () => {
    expect((await DELETE(req('DELETE', {}))).status).toBe(400);
  });

  it('GET lists provider ids that have credentials (no secrets)', async () => {
    store.list.mockResolvedValue(['openai', 'groq']);
    const res = await GET();
    expect(await res.json()).toEqual({ providerIds: ['openai', 'groq'] });
  });

  it('GET returns 503 when the keychain is unavailable', async () => {
    getStoreMock.mockImplementation(() => { throw new CredentialStoreUnavailable('no key'); });
    expect((await GET()).status).toBe(503);
  });
});
