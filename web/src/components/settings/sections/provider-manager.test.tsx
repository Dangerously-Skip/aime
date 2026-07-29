// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProviderManager, orphanCredentialIds } from './provider-manager';
import { collectFieldValues, missingRequiredFields } from '@/lib/models/provider-setup';
import { getPreset } from '@/lib/models/providers';
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
    const keyInput = screen.getByPlaceholderText('sk-…');
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
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-bad' } });
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
  // Real uuids: the classifier keys off the shape, because that is what both
  // provider-creation sites mint.
  const P1 = '11111111-1111-4111-8111-111111111111'
  const P2 = '22222222-2222-4222-8222-222222222222'
  const STRAY = '33333333-3333-4333-8333-333333333333'
  const providers = [{ id: P1 }, { id: P2 }]

  it('finds provider records no provider claims', () => {
    expect(orphanCredentialIds([P1, STRAY], providers)).toEqual([STRAY])
  })

  /**
   * The bug that shipped. Connector OAuth tokens live in the SAME encrypted
   * store under `mcp:<serverKey>` (lib/mcp/secret-store.ts writes through
   * getCredentialStore), so the original `!claimed.has(id)` reported every
   * connected account as junk and the delete button wiped them.
   */
  it('NEVER reports connector secrets — they share the store', () => {
    const stored = [P1, 'mcp:aime-mcp-github', 'mcp:aime-mcp-slack', 'mcp:anything']
    expect(orphanCredentialIds(stored, providers)).toEqual([])
  })

  it("never reports 'anthropic' — the BYOK mirror has no provider row by design", () => {
    expect(orphanCredentialIds(['anthropic', P1], providers)).toEqual([])
  })

  it('ignores ids from a namespace it does not recognise, rather than guessing', () => {
    // Safe direction: a writer added later is unclassified, not deleted.
    expect(orphanCredentialIds(['future:thing', 'legacy-key', ''], providers)).toEqual([])
  })

  it('reports nothing when every record is claimed', () => {
    expect(orphanCredentialIds([P1, P2], providers)).toEqual([])
    expect(orphanCredentialIds([], providers)).toEqual([])
  })

  /**
   * An empty provider list is ambiguous: genuinely none, or localStorage cleared
   * / read from another origin — which the dev-port bug did for real. Reporting
   * everything in that state is how working keys get deleted.
   */
  it('reports NOTHING against an empty provider list, rather than everything', () => {
    expect(orphanCredentialIds([P1, P2, STRAY], [])).toEqual([])
  })
})

describe('ProviderManager — orphaned credentials', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const STRAY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const STRAY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  /** Stored ids come back from the GET; nothing else is called on mount. */
  function mockStored(ids: string[]) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/credentials') && (!init || init.method === undefined))
        return jsonOk({ providerIds: ids });
      return jsonOk({ ok: true });
    });
  }

  function withProvider() {
    useProviderStore.setState({
      providers: [{ id: P1, presetId: 'openrouter', label: 'OpenRouter', enabled: true, createdAt: 0, models: [] }],
    });
  }

  it('offers to delete keys no provider claims, after confirmation', async () => {
    withProvider();
    mockStored([P1, 'anthropic', STRAY_A, STRAY_B]);
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmSpy);

    render(<ProviderManager />);
    await waitFor(() => expect(screen.getByText(/2 stored keys belong to providers/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Delete them/i));
    await waitFor(() => expect(screen.queryByText(/stored keys belong/i)).toBeNull());

    // The user is shown exactly what will go before it goes.
    const prompt = String(confirmSpy.mock.calls[0][0]);
    expect(prompt).toContain(STRAY_A);
    expect(prompt).toContain(STRAY_B);
    expect(prompt).toMatch(/cannot be undone/i);

    const deleted = fetchMock.mock.calls
      .filter((c) => c[1]?.method === 'DELETE')
      .map((c) => JSON.parse(c[1].body as string).providerId);
    expect(deleted.sort()).toEqual([STRAY_A, STRAY_B]);
  });

  it('deletes nothing when the confirmation is declined', async () => {
    withProvider();
    mockStored([P1, STRAY_A]);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));

    render(<ProviderManager />);
    await waitFor(() => expect(screen.getByText(/1 stored key belongs?|1 stored key/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Delete it/i));

    await waitFor(() => expect(screen.getByText(/stored key/i)).toBeTruthy());
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE')).toHaveLength(0);
  });

  /** The bug that shipped: connector tokens share this store. */
  it('never offers to delete connector logins', async () => {
    withProvider();
    mockStored([P1, 'mcp:aime-mcp-github', 'mcp:aime-mcp-slack']);

    render(<ProviderManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/stored key/i)).toBeNull();
  });

  it('stays quiet when every stored key is accounted for', async () => {
    withProvider();
    mockStored([P1, 'anthropic']);

    render(<ProviderManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/stored key/i)).toBeNull();
  });

  /** Un-hydrated provider store: ambiguous, so nothing is offered. */
  it('offers nothing when the provider list is empty', async () => {
    useProviderStore.setState({ providers: [] });
    mockStored([STRAY_A, STRAY_B]);

    render(<ProviderManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/stored key/i)).toBeNull();
  });
});

/**
 * P1.6: the add-provider form is generated from `preset.credentialFields`.
 *
 * It used to render a single hardcoded API-key input, so Bedrock, Vertex and
 * Azure — which declare `awsRegion`, `vertexProject`, `azureDeployment` and the
 * rest — had an input for none of the fields they need and could not be
 * configured at all. (The backend ignored those fields too; see
 * execution.test.ts for the half that makes them real.)
 */
describe('the add-provider form is driven by the preset', () => {
  function openForm() {
    fetchMock.mockImplementation(() => jsonOk({ models: [] }));
    render(<ProviderManager />);
    fireEvent.click(screen.getByText(/Add provider/i));
  }

  it('offers an API key for a key-based provider', () => {
    openForm();
    expect(screen.getByPlaceholderText('sk-…')).toBeTruthy();
  });

  it.each([
    ['bedrock', ['AWS region', 'AWS access key ID', 'AWS secret access key']],
    ['vertex', ['GCP project id', 'Vertex region']],
    ['azure-openai', ['API key', 'Resource name', 'Deployment name', 'API version']],
    ['local', ['Base URL']],
    ['custom', ['Base URL', 'API key']],
  ])('declares every field %s needs', (presetId, labels) => {
    // Asserted through the preset + spec table rather than by driving the
    // portalled Select, which cannot be opened in jsdom. The component maps
    // straight over `credentialFields`, so this is the set it renders.
    const preset = getPreset(presetId)!;
    const rendered = preset.credentialFields.map(
      (f) => (
        {
          apiKey: 'API key',
          baseUrl: 'Base URL',
          awsRegion: 'AWS region',
          awsAccessKeyId: 'AWS access key ID',
          awsSecretAccessKey: 'AWS secret access key',
          vertexProject: 'GCP project id',
          vertexRegion: 'Vertex region',
          azureResource: 'Resource name',
          azureDeployment: 'Deployment name',
          azureApiVersion: 'API version',
        } as const
      )[f],
    );
    for (const l of labels) expect(rendered, `${presetId} is missing ${l}`).toContain(l);
  });
});

describe('collectFieldValues', () => {
  const bedrock = getPreset('bedrock')!;

  it('keeps only the fields the preset declares', () => {
    expect(
      collectFieldValues(bedrock, { awsRegion: 'us-east-1', apiKey: 'sk-leaked' }),
    ).toEqual({ awsRegion: 'us-east-1' });
  });

  it('trims, and drops blanks entirely', () => {
    expect(collectFieldValues(bedrock, { awsRegion: '  us-east-1  ', awsAccessKeyId: '   ' }))
      .toEqual({ awsRegion: 'us-east-1' });
  });
});

describe('missingRequiredFields', () => {
  it('requires the key for a key-based provider', () => {
    expect(missingRequiredFields(getPreset('openrouter')!, {})).toEqual(['apiKey']);
    expect(missingRequiredFields(getPreset('openrouter')!, { apiKey: 'sk-x' })).toEqual([]);
  });

  /**
   * Both fall back to the machine's ambient credentials, which is the most
   * common way they are actually used — demanding the fields would make the
   * guided setup refuse the normal case.
   */
  it.each(['bedrock', 'vertex'])('requires nothing for %s, which can use ambient creds', (id) => {
    expect(missingRequiredFields(getPreset(id)!, {})).toEqual([]);
  });

  it('lets Azure default its API version but not its resource or deployment', () => {
    const azure = getPreset('azure-openai')!;
    expect(missingRequiredFields(azure, {})).toEqual(['apiKey', 'azureResource', 'azureDeployment']);
    expect(
      missingRequiredFields(azure, { apiKey: 'k', azureResource: 'r', azureDeployment: 'd' }),
    ).toEqual([]);
  });
});
