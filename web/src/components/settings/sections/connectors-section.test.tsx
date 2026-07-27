// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { ConnectorsSection } from './connectors-section';
import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';
import {
  createCredentialStore,
  type CredentialStore,
} from '@/lib/models/credentials';

/**
 * Settings → API Access. This section used to lead with an org team picker that
 * mapped a team name to a bundled API key; the org concept moved to a separate
 * product, so the Anthropic key entry is the front door now.
 *
 * The second block routes the component's fetch through the REAL route handler
 * and a REAL (encrypted, on-disk) credential store: "the key is saved" is the
 * claim, and a mocked store would have agreed with a section that POSTs nothing.
 */

// A real store over a temp file, swapped in per test.
let realStore: CredentialStore | null = null;
vi.mock('@/lib/models/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/credentials')>();
  return { ...actual, getCredentialStore: () => realStore! };
});

const fetchMock = vi.fn();
const callsTo = (fragment: string, method?: string) =>
  fetchMock.mock.calls.filter(
    (c) =>
      String(c[0]).includes(fragment) &&
      (!method || (c[1] as RequestInit | undefined)?.method === method),
  );

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  useSettingsStore.setState({ anthropicApiKey: null });
  useProviderStore.setState({ providers: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const statusConfigured = () =>
  screen.getByTestId('anthropic-key-status').getAttribute('data-configured');

describe('ConnectorsSection — the team picker is gone', () => {
  it('leads with the Anthropic API key entry, not a team list', () => {
    render(<ConnectorsSection />);
    expect(screen.getByText('Anthropic API Key')).toBeTruthy();
    expect(screen.getByLabelText('Anthropic API key')).toBeTruthy();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeTruthy();
  });

  it('renders no team selector and no team copy', () => {
    render(<ConnectorsSection />);
    expect(screen.queryByText(/Select your team/i)).toBeNull();
    expect(screen.queryByText(/configure AI access automatically/i)).toBeNull();
    expect(screen.queryByText(/team admin/i)).toBeNull();
  });

  it('still offers ProviderManager for the other inference providers', () => {
    render(<ConnectorsSection />);
    expect(screen.getByText(/No custom providers yet/i)).toBeTruthy();
  });
});

describe('ConnectorsSection — the configured indicator follows the key', () => {
  it('is unconfigured with no key', () => {
    render(<ConnectorsSection />);
    expect(statusConfigured()).toBe('false');
    expect(screen.queryByText('Configured')).toBeNull();
  });

  it('flips to configured once a key is saved', () => {
    render(<ConnectorsSection />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-abc' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(statusConfigured()).toBe('true');
    expect(screen.getByText('Configured')).toBeTruthy();
    // the saved key is shown (masked) rather than an empty entry field
    expect((screen.getByLabelText('Anthropic API key') as HTMLInputElement).value).toBe('sk-ant-abc');
  });

  it('reflects a key that was already in settings', () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-existing' });
    render(<ConnectorsSection />);
    expect(statusConfigured()).toBe('true');
  });

  it('drops back to unconfigured when the key is removed', () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-existing' });
    render(<ConnectorsSection />);
    fireEvent.click(screen.getByTitle('Remove key'));

    expect(statusConfigured()).toBe('false');
    expect(useSettingsStore.getState().anthropicApiKey).toBeNull();
  });

  it('ignores a blank key', () => {
    render(<ConnectorsSection />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: '   ' } });
    expect((screen.getByText('Save').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConnectorsSection — the key reaches the credentials endpoint', () => {
  it('POSTs the key under providerId "anthropic"', async () => {
    render(<ConnectorsSection />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: '  sk-ant-trimmed  ' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(callsTo('/credentials', 'POST')).toHaveLength(1));
    const body = JSON.parse((callsTo('/credentials', 'POST')[0][1] as RequestInit).body as string);
    expect(body).toEqual({ providerId: 'anthropic', values: { apiKey: 'sk-ant-trimmed' } });
  });

  it('DELETEs the mirrored credential when the key is cleared', async () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-existing' });
    render(<ConnectorsSection />);
    fireEvent.click(screen.getByTitle('Remove key'));

    await waitFor(() => expect(callsTo('/credentials', 'DELETE')).toHaveLength(1));
    const body = JSON.parse((callsTo('/credentials', 'DELETE')[0][1] as RequestInit).body as string);
    expect(body).toEqual({ providerId: 'anthropic' });
  });

  it('a failing mirror never loses the key locally', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<ConnectorsSection />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-offline' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(useSettingsStore.getState().anthropicApiKey).toBe('sk-ant-offline');
  });
});

/**
 * The round-trip, against the real route handler + real encrypted store. Proves
 * the save actually persists rather than merely calling fetch.
 */
describe('ConnectorsSection — round-trips to the real credential store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-apiaccess-test-'));
    realStore = createCredentialStore(randomBytes(32), path.join(dir, 'credentials.enc'));

    const route = await import('@/app/api/models/providers/credentials/route');
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(String(url).startsWith('http') ? String(url) : `http://localhost${url}`, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: init?.body as string | undefined,
      });
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') return route.POST(req as Parameters<typeof route.POST>[0]);
      if (method === 'DELETE') return route.DELETE(req as Parameters<typeof route.DELETE>[0]);
      return route.GET();
    });
  });

  afterEach(() => {
    realStore = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a saved key is readable back out of the encrypted store', async () => {
    render(<ConnectorsSection />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-roundtrip' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(async () =>
      expect(await realStore!.getField('anthropic', 'apiKey')).toBe('sk-ant-roundtrip'),
    );
  });

  it('clearing the key removes it from the store', async () => {
    await realStore!.set('anthropic', { apiKey: 'sk-ant-old' });
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-old' });

    render(<ConnectorsSection />);
    fireEvent.click(screen.getByTitle('Remove key'));

    await waitFor(async () => expect(await realStore!.get('anthropic')).toBeUndefined());
  });
});
