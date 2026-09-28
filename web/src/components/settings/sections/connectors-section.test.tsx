// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { ConnectorsSection } from './connectors-section';
import { legacyAnthropicRow, savedMessage } from './provider-manager';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';
import { createCredentialStore, type CredentialStore } from '@/lib/models/credentials';

/**
 * Settings → Models & API keys. The Anthropic key has ONE home now — the
 * provider list — instead of a card of its own beside an Anthropic preset.
 *
 * Credential writes go through the REAL route handler into a REAL encrypted
 * store: "the key is saved" and "the key is gone" are the claims, and a mocked
 * store would agree with a section that POSTs nothing. Only the scan (a call to
 * api.anthropic.com) is stubbed.
 */

let realStore: CredentialStore | null = null;
vi.mock('@/lib/models/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/credentials')>();
  return {
    ...actual,
    // No store ⇒ what the real one does without AIME_CRED_KEY.
    getCredentialStore: () => {
      if (!realStore) throw new actual.CredentialStoreUnavailable('AIME_CRED_KEY is not set');
      return realStore;
    },
  };
});

let dir: string;
let scanStatus = 200;
const fetchMock = vi.fn();

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-apiaccess-test-'));
  realStore = createCredentialStore(randomBytes(32), path.join(dir, 'credentials.enc'));
  scanStatus = 200;
  const route = await import('@/app/api/models/providers/credentials/route');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/models/scan')) {
      return scanStatus === 200
        ? new Response(JSON.stringify({ models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }] }), { status: 200 })
        : new Response(JSON.stringify({ error: 'invalid x-api-key' }), { status: scanStatus });
    }
    if (u.includes('/credentials')) {
      const req = new Request(`http://localhost${u}`, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: init?.body as string | undefined,
      });
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') return route.POST(req as Parameters<typeof route.POST>[0]);
      if (method === 'DELETE') return route.DELETE(req as Parameters<typeof route.DELETE>[0]);
      return route.GET();
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useSettingsStore.setState({ anthropicApiKey: null });
  useProviderStore.setState({ providers: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  realStore = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function addAnthropic(key: string) {
  render(<ConnectorsSection />);
  // With no Anthropic row yet, the form opens on Anthropic (the old card's job).
  fireEvent.click(screen.getByText(/Add provider/i));
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: key } });
  fireEvent.click(screen.getByText(/Add & scan/i));
}

describe('one place for the Anthropic key', () => {
  it('has no separate Anthropic key card', () => {
    render(<ConnectorsSection />);
    expect(screen.queryByText('Anthropic API Key')).toBeNull();
    expect(screen.queryByTestId('anthropic-key-status')).toBeNull();
    expect(screen.getByText(/Model providers/)).toBeTruthy();
  });

  it('adding Anthropic checks the key, stores it under `anthropic`, and mirrors it for requests', async () => {
    await addAnthropic('sk-ant-good');
    await waitFor(() => expect(useProviderStore.getState().providers.map((p) => p.presetId)).toEqual(['anthropic']));
    expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-good');
    expect(await realStore!.getField('anthropic', 'apiKey')).toBe('sk-ant-good');
    expect(useProviderStore.getState().providers.map((p) => p.id)).toEqual(['anthropic']);
    expect(await screen.findByText(/Verified — 1 model found/)).toBeTruthy();
  });

  it('a key the provider rejects is reported and stored nowhere', async () => {
    scanStatus = 401;
    await addAnthropic('sk-ant-typo');
    expect(await screen.findByText('invalid x-api-key')).toBeTruthy();
    expect(await realStore!.get('anthropic')).toBeUndefined();
    expect(useSettingsStore.getState().anthropicApiKey).toBeNull();
    expect(useProviderStore.getState().providers).toHaveLength(0);
  });

  it('removing the Anthropic row removes the key from the store AND the settings mirror', async () => {
    await realStore!.set('anthropic', { apiKey: 'sk-ant-old' });
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-old' });
    useProviderStore.setState({
      providers: [{ id: 'anthropic', presetId: 'anthropic', label: 'Anthropic', enabled: true, createdAt: 0, models: [] }],
    });
    render(<ConnectorsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Anthropic' }));
    await waitFor(() => expect(useSettingsStore.getState().anthropicApiKey).toBeNull());
    expect(await realStore!.get('anthropic')).toBeUndefined();
    expect(useProviderStore.getState().providers).toHaveLength(0);
  });

  it('a key set through the old card gets a row, so it can be seen and removed', async () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-legacy' });
    render(<ConnectorsSection />);
    await waitFor(() =>
      expect(useProviderStore.getState().providers.map((p) => p.presetId)).toEqual(['anthropic']),
    );
    expect(screen.getByRole('button', { name: 'Remove Anthropic' })).toBeTruthy();
  });
});

describe('when the credential store has no master key (503)', () => {
  it('says so up front instead of failing silently', async () => {
    realStore = null; // getCredentialStore now throws → the real route answers 503
    render(<ConnectorsSection />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Restart the app/);
  });
});

describe('legacyAnthropicRow', () => {
  it('only when there is a key and no Anthropic row', () => {
    expect(legacyAnthropicRow(null, [])).toBeNull();
    expect(legacyAnthropicRow('k', [{ presetId: 'anthropic' }])).toBeNull();
    expect(legacyAnthropicRow('k', [{ presetId: 'openrouter' }])?.id).toBe('anthropic');
  });
});

describe('savedMessage', () => {
  it('says "Verified" only when something was checked', () => {
    expect(savedMessage(true, 3)).toMatch(/^Verified — 3 models/);
    expect(savedMessage(false, 0)).toMatch(/^Saved \(not checked\)/);
    expect(savedMessage(false, 0)).not.toMatch(/verified/i);
  });
});
