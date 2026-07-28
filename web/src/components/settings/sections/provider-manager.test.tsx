// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProviderManager, orphanCredentialIds } from './provider-manager';
import { useProviderStore } from '@/stores/provider-store';

const fetchMock = vi.fn();

/** The credential writes, ignoring the GET the orphan scan issues on mount. */
function credentialWrites() {
  return fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes('/credentials') && c[1]?.method === 'POST',
  );
}

beforeEach(() => {
  useProviderStore.setState({ providers: [] });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no crypto.randomUUID in some setups — provide a stable one.
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1' });
  } else {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('test-uuid-1' as `${string}-${string}-${string}-${string}-${string}`);
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonOk(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('ProviderManager', () => {
  it('shows an empty state until a provider is added', () => {
    render(<ProviderManager />);
    expect(screen.getByText(/No custom providers yet/i)).toBeTruthy();
  });

  it('adds a provider: scans models, stores the key, and lists it', async () => {
    // scan → models; credentials → ok
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/models/scan')) return jsonOk({ models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }] });
      if (String(url).includes('/credentials')) return jsonOk({ ok: true });
      return jsonOk({});
    });

    render(<ProviderManager />);
    fireEvent.click(screen.getByText(/Add provider/i));

    // openrouter (default) needs a key → enter it to enable the button
    const keyInput = screen.getByPlaceholderText('sk-...');
    fireEvent.change(keyInput, { target: { value: 'sk-or-test' } });
    fireEvent.click(screen.getByText(/Add & scan/i));

    // 'Kimi K2' is unique to the rendered provider row (OpenRouter appears in
    // both the row label and the preset tag, so it is not a safe anchor).
    await waitFor(() => expect(screen.getByText('Kimi K2')).toBeTruthy());
    expect(screen.getAllByText('OpenRouter').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 model/)).toBeTruthy();

    // store reflects the new provider with its scanned model + credential flag
    const providers = useProviderStore.getState().providers;
    expect(providers).toHaveLength(1);
    expect(providers[0].presetId).toBe('openrouter');
    expect(providers[0].models).toEqual([{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }]);
    expect(providers[0].hasCredentials).toBe(true);

    // scan called with the transient key; credentials POSTed under the new id
    const scanCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/scan'))!;
    expect(JSON.parse(scanCall[1].body as string)).toMatchObject({ presetId: 'openrouter', apiKey: 'sk-or-test' });
    const credCall = credentialWrites()[0]!;
    expect(JSON.parse(credCall[1].body as string)).toEqual({ providerId: 'test-uuid-1', values: { apiKey: 'sk-or-test' } });
  });

  it('surfaces a scan error without persisting a provider', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/models/scan')) return Promise.resolve(new Response(JSON.stringify({ error: 'bad key' }), { status: 400 }));
      return jsonOk({});
    });

    render(<ProviderManager />);
    fireEvent.click(screen.getByText(/Add provider/i));
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByText(/Add & scan/i));

    await waitFor(() => expect(screen.getByText('bad key')).toBeTruthy());
    expect(useProviderStore.getState().providers).toHaveLength(0);
    // credentials never written when the scan fails first
    expect(credentialWrites()).toHaveLength(0);
  });

  it('removes a provider and deletes its stored credential', async () => {
    useProviderStore.setState({
      providers: [{ id: 'p1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, createdAt: 0, models: [], hasCredentials: true }],
    });
    fetchMock.mockImplementation(() => jsonOk({ ok: true }));

    render(<ProviderManager />);
    fireEvent.click(screen.getByTitle('Remove provider'));

    await waitFor(() => expect(useProviderStore.getState().providers).toHaveLength(0));
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')!;
    expect(JSON.parse(del[1].body as string)).toEqual({ providerId: 'p1' });
  });
});

/**
 * The cleanup half of the onboarding-uuid bug (see step-providers.test.ts): keys
 * already written under ids no provider claims. This helper only *reports* them
 * — the delete is a user click, because a false positive here destroys secrets.
 */
describe('orphanCredentialIds', () => {
  const providers = [{ id: 'uuid-openrouter' }, { id: 'uuid-local' }];

  it('finds records no provider claims', () => {
    expect(orphanCredentialIds(['uuid-openrouter', 'stray-1', 'stray-2'], providers)).toEqual([
      'stray-1',
      'stray-2',
    ]);
  });

  it("never reports 'anthropic' — the BYOK mirror has no provider row by design", () => {
    expect(orphanCredentialIds(['anthropic'], [])).toEqual([]);
    expect(orphanCredentialIds(['anthropic'], providers)).toEqual([]);
  });

  it('reports nothing when every record is claimed', () => {
    expect(orphanCredentialIds(['uuid-openrouter', 'uuid-local'], providers)).toEqual([]);
    expect(orphanCredentialIds([], providers)).toEqual([]);
  });

  // The dangerous case, spelled out: an un-hydrated provider list makes every
  // key look orphaned. That is why the caller chains off rehydrate() rather than
  // scanning alongside it — the ordering is load-bearing, not incidental.
  it('would report everything against an empty provider list', () => {
    expect(orphanCredentialIds(['uuid-openrouter', 'uuid-local'], [])).toHaveLength(2);
  });
});

describe('ProviderManager — orphaned credentials', () => {
  /** Stored ids come back from the GET; nothing else is called on mount. */
  function mockStored(ids: string[]) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/credentials') && (!init || init.method === undefined))
        return jsonOk({ providerIds: ids });
      return jsonOk({ ok: true });
    });
  }

  it('offers to delete keys no provider claims', async () => {
    useProviderStore.setState({
      providers: [{ id: 'p1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, createdAt: 0, models: [] }],
    });
    mockStored(['p1', 'anthropic', 'stray-a', 'stray-b']);

    render(<ProviderManager />);
    await waitFor(() => expect(screen.getByText(/2 stored keys belong to providers/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Delete them/i));
    await waitFor(() => expect(screen.queryByText(/stored keys belong/i)).toBeNull());

    const deleted = fetchMock.mock.calls
      .filter((c) => c[1]?.method === 'DELETE')
      .map((c) => JSON.parse(c[1].body as string).providerId);
    expect(deleted.sort()).toEqual(['stray-a', 'stray-b']);
  });

  it('stays quiet when every stored key is accounted for', async () => {
    useProviderStore.setState({
      providers: [{ id: 'p1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, createdAt: 0, models: [] }],
    });
    mockStored(['p1', 'anthropic']);

    render(<ProviderManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/stored key/i)).toBeNull();
  });
});
