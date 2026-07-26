// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { StepProviders } from './step-providers';
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
    expect(screen.getByText('Anthropic API key')).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.getByText(/Local \(Ollama/)).toBeTruthy();
    expect(screen.getByText(/Skip — set up later/)).toBeTruthy();
  });

  it('Anthropic path saves the key AND mirrors it to the keychain', async () => {
    render(<StepProviders onContinue={noop} onBack={noop} />);
    fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-test' } });
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
    fireEvent.change(screen.getByPlaceholderText('sk-or-...'), { target: { value: 'sk-or-test' } });
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
    fireEvent.change(screen.getByPlaceholderText('sk-or-...'), { target: { value: 'sk-bad' } });
    fireEvent.click(screen.getByText('Save & verify'));

    expect(await screen.findByText(/HTTP 401/)).toBeTruthy();
    expect(useProviderStore.getState().providers).toHaveLength(0);
    expect(credCalls()).toHaveLength(0); // fail fast BEFORE persisting the key
  });

  it('local path adds a keyless provider from the base URL', async () => {
    serve({ models: [{ id: 'llama3', label: 'llama3' }] });
    render(<StepProviders onContinue={noop} onBack={noop} />);

    fireEvent.click(screen.getByText(/Local \(Ollama/));
    fireEvent.click(screen.getByText('Connect & scan models'));

    await waitFor(() => expect(useProviderStore.getState().providers).toHaveLength(1));
    expect(useProviderStore.getState().providers[0]).toMatchObject({
      presetId: 'local',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(credCalls()).toHaveLength(0); // no key involved
  });

  it('configuring flips the skip button into a Continue', async () => {
    render(<StepProviders onContinue={noop} onBack={noop} />);
    fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-test' } });
    fireEvent.click(screen.getByText('Save & verify'));
    expect(await screen.findByText('Continue')).toBeTruthy();
  });
});
