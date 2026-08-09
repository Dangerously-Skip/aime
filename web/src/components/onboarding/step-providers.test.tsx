// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { StepProviders, RECOMMENDED_PATHS, otherPresetIds } from './step-providers';
import { PROVIDER_PRESETS } from '@/lib/models/providers';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';

/**
 * The P2 onboarding rework: provider paths wired to the REAL machinery — the
 * same scan/credential endpoints Settings uses — not a form that only writes
 * localStorage and hopes.
 */

const fetchMock = vi.fn();
const scanCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/models/scan'));
const credCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/credentials'));

function serve(opts: { scanOk?: boolean; models?: unknown[] } = {}) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/models/scan')) {
      if (opts.scanOk === false) {
        return new Response(JSON.stringify({ error: 'OpenRouter returned HTTP 401' }), { status: 502 });
      }
      return new Response(JSON.stringify({ models: opts.models ?? [{ id: 'm1', label: 'M1' }] }), { status: 200 });
    }
    return new Response('{"ok":true}', { status: 200 });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  useSettingsStore.setState({ anthropicApiKey: null });
  useProviderStore.setState({ providers: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noop = () => {};

describe('StepProviders', () => {
  it('offers the three provider paths and a skip', () => {
    render(<StepProviders onContinue={noop} onBack={noop} />);
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.getByText(/Local \(Ollama/)).toBeTruthy();
    expect(screen.getByText(/Skip — set up later/)).toBeTruthy();
  });

  it('Anthropic path saves the key AND mirrors it to the keychain', async () => {
    render(<StepProviders onContinue={noop} onBack={noop} />);
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-ant-test' } });
    fireEvent.click(screen.getByText('Save & verify'));

    await waitFor(() => expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-test'));
    // the mirror is what makes server-side scheduled runs work for BYOK users
    await waitFor(() => expect(credCalls()).toHaveLength(1));
    const body = JSON.parse((credCalls()[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ providerId: 'anthropic', values: { apiKey: 'sk-ant-test' } });
  });

  it('OpenRouter path scans, stores the key, and adds the provider', async () => {
    serve({ models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }] });
    render(<StepProviders onContinue={noop} onBack={noop} />);

    fireEvent.click(screen.getByText('OpenRouter'));
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-or-test' } });
    fireEvent.click(screen.getByText('Save & verify'));

    await waitFor(() => expect(useProviderStore.getState().providers).toHaveLength(1));
    const provider = useProviderStore.getState().providers[0];
    expect(provider).toMatchObject({ presetId: 'openrouter', enabled: true, hasCredentials: true });
    expect(provider.models).toEqual([{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }]);
    expect(scanCalls()).toHaveLength(1);
  });

  it('a failed scan surfaces the error and persists NOTHING', async () => {
    serve({ scanOk: false });
    render(<StepProviders onContinue={noop} onBack={noop} />);

    fireEvent.click(screen.getByText('OpenRouter'));
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByText('Save & verify'));

    expect(await screen.findByText(/HTTP 401/)).toBeTruthy();
    expect(useProviderStore.getState().providers).toHaveLength(0);
    expect(credCalls()).toHaveLength(0); // fail fast BEFORE persisting the key
  });

  it('local path adds a keyless provider from the base URL', async () => {
    serve({ models: [{ id: 'llama3', label: 'llama3' }] });
    render(<StepProviders onContinue={noop} onBack={noop} />);

    fireEvent.click(screen.getByText(/Local \(Ollama/));
    fireEvent.click(screen.getByText('Save & verify'));

    await waitFor(() => expect(useProviderStore.getState().providers).toHaveLength(1));
    expect(useProviderStore.getState().providers[0]).toMatchObject({
      presetId: 'local',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(credCalls()).toHaveLength(0); // no key involved
  });

  it('configuring flips the skip button into a Continue', async () => {
    render(<StepProviders onContinue={noop} onBack={noop} />);
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-ant-test' } });
    fireEvent.click(screen.getByText('Save & verify'));
    expect(await screen.findByText('Continue')).toBeTruthy();
  });
});

/**
 * P1.6: every preset is reachable from onboarding.
 *
 * The previous version hardcoded `anthropic | openrouter | local` and had no
 * route to Bedrock, Vertex, OpenAI, Gemini, Groq, Azure, Fal or a custom
 * endpoint — eight of eleven presets could only be added later, in Settings,
 * assuming the user found it.
 */
describe('StepProviders — the other presets', () => {
  it('leaves nothing out: recommended + other covers the whole catalogue', () => {
    const recommended = RECOMMENDED_PATHS.map((p) => p.presetId as string);
    const all = [...recommended, ...otherPresetIds()].sort();
    expect(all).toEqual(PROVIDER_PRESETS.map((p) => p.id).sort());
  });

  it('does not repeat a recommended path in the others list', () => {
    for (const r of RECOMMENDED_PATHS) {
      expect(otherPresetIds()).not.toContain(r.presetId);
    }
  });

  it('reveals them behind one click, and lets one be chosen', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    // Hidden by default — a first-run screen listing eleven presets is worse
    // than one that leads with a choice.
    expect(screen.queryByText('AWS Bedrock')).toBeNull();

    fireEvent.click(screen.getByText(/Other providers/));
    expect(screen.getByText('AWS Bedrock')).toBeTruthy();
    expect(screen.getByText('Google Vertex (Claude)')).toBeTruthy();
  });

  it('shows the fields Bedrock needs — it previously had none', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText(/Other providers/));
    fireEvent.click(screen.getByText('AWS Bedrock'));

    expect(screen.getByText('AWS region')).toBeTruthy();
    expect(screen.getByText('AWS access key ID')).toBeTruthy();
    expect(screen.getByText('AWS secret access key')).toBeTruthy();
    // ...and says that leaving them blank is a real choice.
    expect(screen.getByText(/ambient AWS credentials/)).toBeTruthy();
  });

  it('warns when a provider cannot list its models, instead of scanning to nothing', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText(/Other providers/));
    fireEvent.click(screen.getByText('AWS Bedrock'));
    expect(screen.getByText(/cannot list its models/)).toBeTruthy();
    // The button stops promising verification it cannot perform.
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('clears typed fields when switching preset, so a key is never resubmitted elsewhere', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    const key = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'sk-ant-secret' } });
    expect(key.value).toBe('sk-ant-secret');

    fireEvent.click(screen.getByText('OpenRouter'));
    expect((screen.getByPlaceholderText('sk-…') as HTMLInputElement).value).toBe('');
  });
});

/**
 * The report that produced these: "I add my name, select OpenRouter, add my key
 * then skip. The name is picked up but not the other options and data, so the
 * retry makes it seem as though I haven't set up my key."
 *
 * It was exactly right, and the data was never lost. The profile in question had
 * the OpenRouter provider in this store, all four tiers in `tierModels` pointing
 * at it, and its credentials on the server — while this step opened on a blank
 * Anthropic form. A screen asking for a key reads as "no key is set", so the key
 * gets entered again, and every re-entry writes ANOTHER credential: that profile
 * held 13 copies of one key.
 */
describe('what the user already configured', () => {
  const openrouter = {
    id: '7e48f16c-1d4e-4ac6-9660-cbed224150f7',
    presetId: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    enabled: true,
    models: [],
  };

  beforeEach(() => {
    useProviderStore.setState({ providers: [openrouter] });
  });
  afterEach(() => {
    cleanup();
    useProviderStore.setState({ providers: [] });
  });

  it('says so, instead of presenting an empty form', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    expect(
      screen.getByText(/OpenRouter is already set up/i),
      'nothing tells the user their key is already stored',
    ).toBeDefined();
  });

  it('opens on the provider they use, not the catalogue default', () => {
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    const openRouterCard = screen.getByText('OpenRouter').closest('button');
    expect(openRouterCard?.className, 'OpenRouter is not the selected card').toMatch(/border-primary/);
  });

  /**
   * The tick is the per-row version of the same claim. Before, it appeared only
   * for a provider configured in THIS session, so a returning user saw an
   * unticked row for a provider they had set up weeks earlier.
   */
  it('ticks a provider configured in an earlier session', () => {
    const { container } = render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    const card = screen.getByText('OpenRouter').closest('button');
    expect(card?.querySelector('svg.text-emerald-500'), 'no tick on a configured provider').toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('still opens on the default when genuinely nothing is set up', () => {
    useProviderStore.setState({ providers: [] });
    render(<StepProviders onContinue={() => {}} onBack={() => {}} />);
    expect(screen.queryByText(/already set up/i)).toBeNull();
    expect(screen.getByText('Anthropic').closest('button')?.className).toMatch(/border-primary/);
  });
});
