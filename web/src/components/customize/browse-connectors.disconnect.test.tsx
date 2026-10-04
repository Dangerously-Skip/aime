// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowseConnectors } from './browse-connectors';
import { useConnectorStore } from '@/stores/connector-store';

/**
 * Disconnect is destructive, so it asks first and reports the real outcome.
 *
 * REGRESSION: one click disconnected with no confirmation, the card went grey
 * BEFORE the server answered, and a failed deprovision only reached
 * console.error — the UI said "disconnected" while the credential stayed on
 * disk and the tools stayed mounted. Only fetch is stubbed; the real
 * provisioner and store run.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

function serve(provisionDelete: () => Response = () => json({ success: true })) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/connectors/health')) return json({ connectors: [], needsReconnect: [] });
    if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: [] });
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    if (u.includes('/api/connectors/provision') && init?.method === 'DELETE') return provisionDelete();
    return json({ success: true });
  });
}

const deletes = () =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes('/api/connectors/provision') && (c[1] as RequestInit | undefined)?.method === 'DELETE',
  );

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useConnectorStore.setState({
    tokens: { github: 'ghp_real' },
    tokenMeta: {},
    oauthClientCreds: {},
    connectorStates: { github: { id: 'github', enabled: true, authenticated: true } },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const github = () => useConnectorStore.getState().connectorStates['github'];

describe('BrowseConnectors — Disconnect confirmation', () => {
  it('asks before doing anything, and Cancel leaves the connection alone', async () => {
    render(<BrowseConnectors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect GitHub' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Disconnect GitHub?')).toBeTruthy();
    expect(deletes()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deletes()).toHaveLength(0);
    expect(github()?.authenticated).toBe(true);
  });

  it('on confirm, the card changes only after the server agrees', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/connectors/provision') && init?.method === 'DELETE') {
        return new Promise<Response>((r) => { release = r; });
      }
      if (u.includes('/api/connectors/health')) return json({ connectors: [], needsReconnect: [] });
      if (u.includes('/api/connectors/hydrate')) return json({ connectedIds: [] });
      return json({ plugins: [], success: true });
    });
    render(<BrowseConnectors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect GitHub' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByText('Disconnecting')).toBeTruthy();
    expect(github()?.authenticated).toBe(true); // not yet — the server hasn't answered

    release(json({ success: true }));
    await waitFor(() => expect(github()?.authenticated).toBe(false));
    expect(useConnectorStore.getState().tokens['github']).toBeUndefined();
  });

  it('a refused disconnect is shown, and the connection still reads as connected', async () => {
    serve(() => json({ error: 'Could not write the MCP config' }, 500));
    render(<BrowseConnectors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect GitHub' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByText("Couldn't disconnect GitHub")).toBeTruthy();
    expect(screen.getByText('Could not write the MCP config')).toBeTruthy();
    expect(github()?.authenticated).toBe(true);
    expect(useConnectorStore.getState().tokens['github']).toBe('ghp_real');
    // And the grant is not revoked upstream for a disconnect that did not happen.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/connectors/revoke'))).toBe(false);
  });
});
